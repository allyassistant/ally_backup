# Bug & Compatibility Audit — Skill-Reviewer Architectural Fix (2026-06-21)

**Audit date:** 2026-06-21 (Sunday)
**Workspace:** `/Users/ally/.openclaw/workspace` (branch: `master`, HEAD: `db72f6c`)
**Fix components audited:**
1. **Stage 1** — `scripts/skill_reviewer.js` — `dedupeQueueByPromptHash()`
2. **Stage 2 + B-1** — `scripts/skill_reviewer_bot.js` — `runFollowupLoop()` + post-LLM `preEmitFilter`
3. **B-2** — `extensions/skill-auto-suggest/pre-emit-dedup.mjs` — `findBestMatch()` hash filter

**Methodology:**
- Read all 3 modified files in full
- Read 4 upstream emitters + 4 downstream consumers + skill_dedup_gate.js
- Ran `node --check` on all 3 (all PASS)
- Ran 6+ smoke tests via `node -e` (Stage 1 dedup simulation, boundary test, pre-emit-dedup dry-run, follow-up loop termination, max-2 bound, follow-up prompt format)
- Quantified hash pollution via direct embeddings-cache analysis (53 hash keys vs 60 real)
- Verified telemetry file format and trace completeness

---

## Task A: Bugs in modified files

### A1. `extensions/skill-auto-suggest/pre-emit-dedup.mjs` (B-2)

**Status:** ✅ Hash filter logic correct. ⚠️ UNTRACKED IN GIT.

| # | Finding | Severity |
|---|---------|----------|
| 1 | **`pre-emit-dedup.mjs` is UNTRACKED** — `git log -- extensions/skill-auto-suggest/pre-emit-dedup.mjs` returns zero history. The file exists on disk (351 lines) but is NOT in HEAD, the previous commit (df850ae), or any earlier snapshot. Downstream consumers (`skill_reviewer_bot.js`, `audit_to_skill_emitter.js`, `skill_pattern_emitter.js`, `after_task_skill_candidate.js`) import this file at runtime — if it's lost (e.g. on a clean checkout or workstation sync), the entire B-2 + Stage 2 + Stage 2 follow-up chain crashes. **Risk: HIGH (data loss / single point of failure).** | **CRITICAL** |
| 2 | Hash filter logic correct: `HASH_RE = /^[0-9a-f]{16}$/` matches the 16-char `proposalKey` format from `skill_dedup_gate.js:148-151` (sha256 hex truncated to 16). The `findBestMatch()` loop scans ALL warnings (line 130-135) past hash-keyed entries — does not just take `warnings[0]`. | OK |
| 3 | Fail-open correct: returns `null` if `!name \|\| !description` (line 114), and outer try/catch in `preEmitFilter` line 192-198 returns `{action: 'append', reason: 'fail-open: ...'}` on Ollama down. | OK |
| 4 | Telemetry writes use `fs.promises.appendFile` (line 94) — atomic per-call. Cache invalidation: per-process `_proposalCache` with 5min TTL — mirrors dedup_gate's TTL. No stale data risk. | OK |
| 5 | Edge case — empty embeddings cache: `dedupGate.computeDedupWarnings` returns `[]` → `findBestMatch` returns `null` → `preEmitFilter` returns `{action: 'append', reason: 'no_match_or_cold_start'}`. Correct fail-open. | OK |
| 6 | Edge case — single entry that IS a hash: `findBestMatch` scans all warnings → no non-hash found → returns `null` → preEmitFilter returns `append`. Correct fail-open. | OK |
| 7 | Edge case — all top matches are hashes (cache polluted with proposals but no real skills yet): returns `null`, fail-open. | OK |
| 8 | `matchedSkillIsHash` telemetry field at line 144 reflects "did we have to skip past a hash" — semantic is correct (true when `warnings[0]` was a hash, regardless of whether the filtered match is real). Useful for cache pollution monitoring. | OK (cosmetic: confusing name) |

### A2. `scripts/skill_reviewer.js` — Stage 1 `dedupeQueueByPromptHash()`

**Status:** ✅ Logic correct, no critical bugs. ⚠️ Two edge cases worth noting.

| # | Finding | Severity |
|---|---------|----------|
| 1 | SHA-1 normalization correct: `s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200)` → stable for same input. Verified hash stability across identical normalization. | OK |
| 2 | 24h sliding window boundary test PASS: entry at exactly 24h+1s is outside window (promoted to kept), at 24h-1s is within window (dropped). Code uses `Math.abs(curMs - priorMs) <= windowMs` (line 858) — symmetric around either direction, handles both forward and backward time skew. | OK |
| 3 | Telemetry writes are atomic per call: single `fs.appendFileSync` of one JSON line. No partial-write risk. | OK |
| 4 | Race conditions: concurrent skill_reviewer.js runs would both call `fs.appendFileSync(PROMPT_DEDUP_TELEMETRY, ...)` — POSIX O_APPEND makes a single append atomic. However, two runs could BOTH compute dedup against the same queue file simultaneously (no lock on `skill_reviewer.js`). The dedup math itself is deterministic so duplicates would only occur if the queue file is being concurrently written to by emitters. **Risk: LOW** since the cron agentTurn is the only realistic invoker, and queue writes from emitters are typically not at the same time. | LOW |
| 5 | `PROMPT_DEDUP_DISABLED` env var read at module load (line 807). Mutating env mid-run won't disable. Acceptable. | OK |
| 6 | Edge case — `e.userPrompt` is undefined for some entries: line 840-844 keeps them (defensive). Good. | OK |
| 7 | Edge case — `e.ts` is undefined or invalid: `tsMs = NaN`, then `curMs = Number.isFinite(tsMs) ? tsMs : Date.now()` (line 856). The fallback to `Date.now()` is correct — uses the current time as the "now" reference. But `priorMs = Number.isFinite(prior.tsMs) ? prior.tsMs : curMs` (line 857) — if BOTH prior and current have invalid ts, both fallback to current time → `within = true` → duplicate drops. **Minor: can misclassify entries without timestamps, but conservative (drops more rather than fewer) — acceptable.** | LOW |
| 8 | `_normalizeUserPrompt` truncation at 200 chars: could in theory split a surrogate pair. SHA-1 of the truncated string is still stable across runs (same input → same hash). Not a bug, but the snippet in telemetry (`slice(0, 80)`) could display a lone surrogate — cosmetic. | LOW |
| 9 | The `indexed.sort((a, b) => (a.ts \|\| '').localeCompare(b.ts \|\| ''))` (line 836) sorts lexically on ISO timestamps. ISO 8601 timestamps sort correctly as strings. | OK |
| 10 | `_logPromptDedupTelemetry` only logs when `dropped.length > 0` (line 916) — keeps the file lean. Good. | OK |

### A3. `scripts/skill_reviewer_bot.js` — Stage 2 + B-1 `runFollowupLoop()`

**Status:** ✅ Logic correct, but **two real bugs in summary telemetry**, and one upstream cross-system bug (see Task E).

| # | Finding | Severity |
|---|---------|----------|
| 1 | `STAGE_2_FOLLOWUP_DISABLED` read at module load (line 87). Wired in main() at line 2006. Correct. | OK |
| 2 | `STAGE_2_FOLLOWUP_MAX_CALLS = 2` and `STAGE_2_FOLLOWUP_TIME_BUDGET_MS = 5 * 60 * 1000` constants (lines 88-89). Verified by reading source: bounds are hard-coded (not env-overridable) — intentional design. | OK |
| 3 | Loop termination: `while (stillInjected.length > 0 && followupCalls < STAGE_2_FOLLOWUP_MAX_CALLS)` (line 1795). Time budget check at top of loop (line 1796-1807). Verified in smoke test: LLM SKIP → 1 call exit; LLM error → 1 call exit; max calls → 2 calls exit. | OK |
| 4 | LLM returns 0 blocks (SKIP marker): `extractFileBlocks` finds no `skills-learned/...` fences → `fuBlocks.length === 0` → `stillInjected = []; break;` (lines 1840-1851). Verified. | OK |
| 5 | Dynamic import reliability: `await import(PRE_EMIT_DEDUP_PATH)` (line 63) — Node's import cache ensures the module is loaded only once even if called concurrently. `_getPreEmitFilter()` has a check-then-set pattern (lines 60-68) — but the actual function returns a stable reference due to import cache, so concurrent races don't double-load. | OK |
| 6 | Inject message format (line 1028-1033): `"Skill 'X' already exists with high similarity (88.4% to 'real-skill-name'). PATCH the existing skill at skills-learned/<matchedSkill>/SKILL.md instead of creating new."` — passed to `buildFollowupPrompt` which wraps it in `[Tool result N/M]` blocks. Format is human-readable and actionable. | OK |
| 7 | **BUG — `abortedReason` mislabels LLM errors and parse errors as `time_budget_exhausted`** (line 1875-1877). When the loop exits via `followup_llm_error` or `followup_parse_error` paths (lines 1813-1822, 1826-1834), the followup_summary still uses the binary `(followupCalls >= MAX_CALLS ? 'max_calls_reached' : 'time_budget_exhausted')` heuristic. If `followupCalls < MAX_CALLS`, it ALWAYS says `time_budget_exhausted` — even when the cause was LLM error or parse error. **Observed in telemetry:** the first `followup_summary` shows `abortedReason: 'time_budget_exhausted', followupCalls: 1` after an LLM error event. Misleading for monitoring. | **MEDIUM** |
| 8 | **BUG — `originalBlockCount` formula is awkward and silently falls back to 0 in some cases** (line 1869). When `opts.originalBlockCount` is provided by caller (it is — line 2013: `{ runId, originalBlockCount: blocks.length }`), this is fine. But the complex fallback `(filesWritten.length + postLlmInjectedResults.length - (postLlmInjectedResults.length - stillInjected.length))` simplifies to `filesWritten.length + stillInjected.length`, which doesn't match the original LLM blocks. Several telemetry entries show `originalBlockCount: 0` because the loop's `||` evaluates the fallback when the caller didn't set it (e.g. in unit tests). **Minor: cosmetic, doesn't affect operation.** | LOW |
| 9 | `writeSkillFiles` called recursively from `runFollowupLoop` (line 1854) — if Stage 2 produces new injects inside the loop, it calls itself-equivalent write path which can in turn produce more injects. Bounded by `MAX_CALLS=2` and `TIME_BUDGET=5min`, but a pathological LLM could chain many Stage 2 SKIPs → 2 follow-ups → still unresolved. Worst case: 1 initial + 2 follow-ups = 3 LLM calls in ~3 minutes for one bot run. Acceptable. | OK (bounded) |
| 10 | `written.push(block.filePath)` at line 1122 (in the cross-source dedup strict-mode path) — when BOT_DEDUP_MODE='strict' and a duplicate is detected, the file is NOT written but it's pushed onto `written` for cleanup. Downstream `cleanup` logic relies on `written.length > 0`. **Minor: this is an intentional design to count "skipped-due-to-dedup" as a successful review pass; documented in line 1122-1123.** | OK (intentional) |
| 11 | Spec field aliasing in followup telemetry (line 96-100): emits BOTH `followupCalls`/`elapsedMs` (internal) AND `followupCallCount`/`durationMs` (spec). Verified: telemetry entries have BOTH keys. Forward-compatible. | OK |

---

## Task B: Upstream compatibility

### B1. `extensions/skill-auto-suggest/index.mjs` — main hooks

**Status:** ✅ GREEN — no changes needed.

- `before_prompt_build` hook (line 81-128): matches user task to top-3 skills, **does NOT write to the queue**. No interaction with Stage 1 dedup.
- `after_tool_call` hook (line 133-146): records skill reads. No queue writes.
- `agent_end` hook (line 157-214): emits `used` / `inferred_skipped` feedback to `.skill_feedback.jsonl` (via `recordSkillFeedback`). No queue writes.
- `agent_end` Phase A hook (line 235-246): spawns `analyzeTaskEnd` → calls `after_task_skill_candidate.js` for failure-signal triage.

**Implication:** `index.mjs` does NOT directly write to `.skill_review_queue.jsonl`. The Phase A hook only spawns a subprocess which uses the pre-emit-dedup filter. **No regression from architectural fix.**

### B2. `scripts/after_task_skill_candidate.js` — Phase A triage

**Status:** ✅ GREEN — correctly integrated with pre-emit-dedup.mjs.

- Imports pre-emit-dedup.mjs via dynamic `await import` (line 55) — handles load failure with a fallback `() => ({action: 'append', reason: 'filter_load_failed'})` (line 60-61). **Resilient.**
- Build queue entry (line 131-149): includes `userPrompt: '[auto-triage] session <key>: detected failure signals'` (synthesized) — unique per session, so Stage 1 dedup won't collide on it. **Compatible.**
- Pre-emit filter wired correctly (line 231-267): action='skip' drops, action='patch' marks PATCH intent. Telemetry via `.pre_emit_dedup_log.jsonl`.
- `proposedSkill` field is properly set at top-level (line 142), which `dedup_gate.collectDedupSignals` and the prompt builder both expect.

### B3. `scripts/audit_to_skill_emitter.js` — v=3 from audit history

**Status:** ✅ GREEN — correctly integrated.

- Imports pre-emit-dedup.mjs via dynamic `await import` (line 62). Fallback same as B2.
- `loadExistingSkillNames` reads `sig.proposed_skill_name` (line 309) — preserves legacy dedup against existing queue entries. Compatible with `qualitative_signals` schema from the emitter's own `buildQueueEntry` (line 343-350).
- `buildQueueEntry` (line 324-361): top-level `proposedSkill` (line 339-342) + `qualitative_signals.proposed_skill_name` (line 348). Both present. `dedup_gate.collectDedupSignals` will pick this up. **Compatible.**
- Pre-emit filter (line 462-503): action='skip' drops + emits sidecar log; action='patch' marks PATCH intent. Telemetry includes `matched_skill` and `similarity`.

### B4. `scripts/skill_pattern_emitter.js` — v=3 from pattern_learner

**Status:** ✅ GREEN — correctly integrated.

- Same pattern as B3: dynamic import (line 69), fallback (line 74), top-level `proposedSkill` (line 280), `qualitative_signals.pre_emit_dedup` on PATCH.
- **Idempotency** preserved via `shouldEmit(id, lastSeen, emitted)` (line 298-303) — uses sidecar `EMITTED_SIDECAR`. PATCH-marked entries are still recorded in sidecar to avoid re-attempts.
- Build entry (line 270-295): `userPrompt` is `pattern_learner match: <id> (kind=<k>, samples=<N>)` — synthesized per pattern, won't collide on Stage 1 dedup. **Compatible.**

---

## Task C: Downstream compatibility

### C1. `scripts/skill_junk_tracker.js` (daily 23:55)

**Status:** ✅ GREEN — no impact.

- Reads `.skill_created.jsonl` (line 38, 73-105) — not the new telemetry files. **Stage 1 dedup drops never reach `.skill_created.jsonl`**, so `total`/`passed`/`failed` metrics unchanged.
- Stage 2 SKIPs ARE recorded in `.skill_created.jsonl` via `recordSkillCreated` (skill_reviewer_bot.js:1014-1024) with `validationPassed: false, reason: 'post-llm pre-emit skip...'`. Junk tracker correctly counts these as failed (improving validator catch rate metric). **Expected behavior.**
- Stage 2 follow-up PATCHes (when LLM PATCHes existing skill) — recordSkillCreated called inside writeSkillFiles (line 1158-1199 area). Junk tracker sees the same `validationPassed: false` for hard blocks, `true` for successful PATCHes. Compatible.

### C2. `scripts/daily_telemetry_digest.js` (daily 23:58)

**Status:** ✅ GREEN — no parser impact.

- Searched for references to `skill_review_queue`, new telemetry files. **Only one reference:** `SKILL_REVIEW_QUEUE` constant (line 49) for queue stats. New telemetry files are not consumed by this script.
- Stage 1 dedup drops `dropped.length` entries from queue → reduces `skill_review_queue.jsonl` line count when cleanup runs. Daily digest's queue size metric (if any) would drop accordingly — but since the dedup is in `skill_reviewer.js` (prompt builder), and the queue file is consumed by `skill_reviewer_cleanup.js` (not deleted by Stage 1), the queue size only drops after a successful bot run completes cleanup.

### C3. `scripts/weekly_correction_loop.js` (Sunday 18:00)

**Status:** ✅ GREEN — no impact.

- Searched for references to skill_reviewer/prompt_dedup/post_llm/followup — **zero matches.** This script doesn't read the new telemetry files.

### C4. `extension/skill-auto-suggest/lib/skill_dedup_gate.js` — collects `qualitative_signals.proposed_skill_name`

**Status:** ⚠️ **CRITICAL CROSS-SYSTEM BUG** (see Task E.3 for full detail).

- `collectDedupSignals` (line 332-349) iterates over entries with `proposedSkill.name + .description` and emits warning lines like:
  > `  - Dedup warning: proposed skill "X" is 0.93 similar to existing "fc50a0a05e91705e" — strongly consider PATCH instead of CREATE.`
- The `similarSkill` field comes from `computeDedupWarningsSync` (line 282-322), which iterates over `Object.entries(skillEmbeddings)` — **including hash-keyed entries**. The B-2 fix in pre-emit-dedup.mjs filters these out, but **dedup_gate.js itself does NOT.**
- Verified empirically: For the existing proposal `cron-config-audit`, `computeDedupWarningsSync` returns:
  1. `fc50a0a05e91705e` (hash) at score 0.93
  2. `wiki-daily-ingest` (real) at score 0.86
- **The LLM sees the hash as the top match and has no real skill to PATCH.**

---

## Task D: Race conditions

### D1. Concurrent cron runs of `skill_reviewer.js`

**Risk:** LOW. `skill_reviewer.js` has NO lock file (unlike `skill_reviewer_bot.js` which uses `LOCK_DIR = .skill_reviewer_bot.lockdir` at line 137 of bot, mkdir-as-mutex at line 1902). Two concurrent invocations of the prompt builder would:
1. Both call `readQueue()` — both get the same data (filesystem read).
2. Both compute `dedupeQueueByPromptHash` — same result (deterministic).
3. Both call `_logPromptDedupTelemetry` — concurrent `fs.appendFileSync` to `.skill_reviewer_prompt_dedup.jsonl`. **POSIX O_APPEND makes a single appendFileSync atomic at the syscall level.** Safe.
4. Both might invoke `safeWriteFileSync` on the prompt cache — would race. The prompt cache file (`SKILL_PROMPT_CACHE`) is overwritten by both — last-write-wins, but both write the same content. Safe.
5. Concurrent invokers might BOTH spawn an LLM call downstream — but the bot has a lock, so only one bot run executes. The prompt builder doesn't directly invoke the LLM.

**Mitigation:** Add a `LOCK_DIR` to `skill_reviewer.js` mirroring the bot's lock pattern. **Low priority** since concurrent runs are unlikely in production.

### D2. Telemetry file contention

**Risk:** LOW.

- `.skill_reviewer_prompt_dedup.jsonl` — written by `skill_reviewer.js` only. Single-writer per-process; multi-process append is safe (O_APPEND atomic).
- `.skill_reviewer_post_llm_dedup.jsonl` — written by `skill_reviewer_bot.js` only. Single-writer per-process. The bot is locked.
- `.skill_reviewer_followup.jsonl` — written by `skill_reviewer_bot.js`. Same as above.
- `.pre_emit_dedup_log.jsonl` — written by `pre-emit-dedup.mjs` (called from 4 emitter processes + bot). Multiple processes can write concurrently. Each write is a single JSON line via `fs.appendFile` with O_APPEND. **Safe at line level.**

**However:** the JSON line itself is written in one `appendFile` call (line 91-98 of pre-emit-dedup.mjs), which on POSIX maps to one `write()` syscall. Safe.

### D3. Embeddings cache contention

**Risk:** MEDIUM.

`/Users/ally/.openclaw/workspace/.skill_auto_suggest_embeddings.json` (1.7MB) is shared between:
- `skill-auto-suggest` extension (via `extensions/skill-auto-suggest/embedding.mjs` — via `loadEmbeddingsCache`/`saveEmbeddingsCache`).
- `skill_dedup_gate.js` (line 85-112: `loadEmbeddingsCache`/`saveEmbeddingsCache`).
- `skill_reviewer_bot.js` (Phase A+ path at line 1097-1132: in-process cache mutation + indirect save via `embedWithOllama`).

`saveEmbeddingsCache` uses atomic write (write tmp + rename, line 101-112 of dedup_gate.js). Good. **But** two concurrent writers could each write a tmp file with different content, and the second rename wins. The first writer's content is lost. Since both writers are appending new proposal embeddings under different proposalKey hashes, the LOSS is benign (different keys, no overlap) — but it's still a TOCTOU race.

**Mitigation:** Add file locking (e.g. `proper-lockfile`) or use a single-writer pattern (e.g. queue new entries, drain in one process).

**Severity:** MEDIUM (benign data loss, can be retried, but indicates design weakness).

### D4. LLM API rate limits (DeepSeek / fallback chain)

**Risk:** MEDIUM.

`callLlm` (line 1655-1713 of bot) tries primary `MODEL`, then `MODEL_FALLBACKS`. Stage 2 follow-up adds up to 2 additional LLM calls. If the bot was already at the rate limit, the follow-up would hit 429 → classified as `isRateLimit` (line 1684) → try fallback → potentially all exhausted → error.

**Concrete concern:** A single bot run can now make up to 3 LLM calls (1 initial + 2 follow-up). If DeepSeek rate limit is 5/min and the bot runs every 30min, no issue. If the bot runs more frequently or has a backlog, the follow-up could push over the limit.

**Mitigation:** Add a small backoff between follow-up calls (e.g. 5-10s). Not implemented.

---

## Task E: Unintended consequences

### E1. Stage 1: legitimate candidates dropped?

**Status:** ✅ NO — dedup is correct.

Stage 1 dedup only drops entries with the SAME normalized userPrompt within 24h. Verified by simulating Stage 1 against the current queue (31 entries → 4 kept, 27 dropped). The kept entries are 4 distinct userPrompt hashes (RapNet email summaries, cron prompts, issue follow-ups). All 4 represent genuinely distinct user conversations. **No legitimate candidates dropped.**

The dropped 27 are repeats of the same 4 conversations within 24h (e.g. cron runs every 30min re-emit the same cron prompt). **Behavior is correct.**

### E2. Stage 2: falsely SKIPPED legitimate new skills?

**Status:** ⚠️ POTENTIAL BUG — see E3.

The 3 post-LLM dedup events in `.skill_reviewer_post_llm_dedup.jsonl`:
- `cron-config-audit` (similarity 0.884) → SKIP, matched `concurrent-session-rate-limit-avoidance` (real skill). **Likely legitimate** — skill exists.
- `connection-surface-analysis` (similarity 0.889) → SKIP, matched `obsidian-vault-structure-architecture` (real). **Likely legitimate.**
- `cron-config-audit` (similarity 0.824) → PATCH. **Correct.**

No false SKIPs detected in current telemetry. **However**, the cross-system bug in E3 means future v=3 candidates could be silently lost.

### E3. **CRITICAL: Cache migration missed — Phase 2f dedup_gate still returns hashes**

**Severity: HIGH (latent bug, doesn't manifest today but will when v=3 candidates arrive).**

The B-2 fix in pre-emit-dedup.mjs's `findBestMatch` (line 122-152) correctly skips hash-keyed entries — and this fixes Stage 2's `preEmitFilter` (used by skill_reviewer_bot.js). **But** `skill_dedup_gate.js`'s `computeDedupWarningsSync` (line 282-322) and `computeDedupWarnings` (line 215-264) **do NOT** have this fix. They iterate over `Object.entries(skillEmbeddings)` and emit `similarSkill` = hash-keyed entries.

**Three call sites still emit hash-keyed warnings:**
1. `scripts/skill_reviewer.js:958` — `collectDedupSignals(entries)` → dedup signals injected into prompt's "Aggregated Signals" section. **LLM sees: "0.93 similar to existing 'fc50a0a05e91705e' — strongly consider PATCH instead of CREATE."** No real skill to PATCH → LLM likely SKIPs the entry → 0 blocks emitted → no Stage 2 fires → v=3 candidate lost.
2. `scripts/skill_reviewer_bot.js:1116` — Phase A+ dedup_gate. `crossSourceDup.similarSkill` could be a hash. Log line: `"DEDUP-GATE: X is 93.2% similar to existing skill 'fc50a0a05e91705e'"` — confusing for ops, but functional in `warn` mode (just logs and continues). In `strict` mode (line 1119-1123), would skip the write — possibly false positive.
3. The async `computeDedupWarnings` (line 215) is also called by other scripts if any exist (search returned no other call sites in the audited files, but `extensions/skill-auto-suggest/lib/skill_dedup_gate.js` is `require`d from many places).

**Quantified impact:** Direct analysis of `.skill_auto_suggest_embeddings.json` shows **13/60 (21.7%) real skills** have a hash-keyed entry as their top cosine match. This means **~22% of v=3 candidates will receive a hash-keyed warning** in the Phase 2f prompt.

**Fix:** Mirror the B-2 hash filter in `skill_dedup_gate.js`'s `computeDedupWarnings`/`computeDedupWarningsSync`. Either:
- (a) Filter hash-keyed entries from the matches loop (mirroring pre-emit-dedup.mjs:128-135), OR
- (b) Sort so real-skill entries always rank first when there's a hash tie.

### E4. Kill switches — what if BOTH are set?

**Trace:**
- `SKILL_REVIEWER_DEDUP_DISABLED=1`: Stage 1 prompt-hash dedup is bypassed (`dedupeQueueByPromptHash` returns input unchanged with `disabled: true`, no telemetry). Queue has all 31 entries (including duplicates). **The bot sees the full queue.**
- `STAGE_2_FOLLOWUP_DISABLED=1`: Stage 2 still SKIPs duplicates via preEmitFilter (line 990-1044), but the follow-up loop is bypassed (line 2006). Inject messages are logged only.
- `POST_LLM_DEDUP_DISABLED=1` (third switch): Stage 2 itself is bypassed; LLM's blocks are written directly.

**No interaction issues.** Kill switches are independent and layered.

**Combined behavior:** All Stage 1/2 dedup disabled → equivalent to pre-fix behavior. ✅ Correct fail-safe.

### E5. Did the dedup_gate's `collectDedupSignals` get bypassed or duplicated by Stage 2?

**Status:** ⚠️ NOT BYPASSED, NOT DUPLICATED — but Phase 2f warning is the one with the hash bug.

- Phase 2f (skill_reviewer.js main() line 958) runs `collectDedupSignals` → injects dedup warnings into prompt → LLM sees them and (if acting correctly) SKIPs or PATCHes.
- Stage 2 (skill_reviewer_bot.js line 990-1044) runs `preEmitFilter` on each block the LLM produces → drops or patches.
- These are sequential defense layers, not duplicates. Phase 2f is the LLM-side hint; Stage 2 is the server-side enforcement.

**But:** Phase 2f uses `collectDedupSignals` → `computeDedupWarningsSync` (from skill_dedup_gate.js) which **does NOT have the B-2 hash filter**. Stage 2 uses `preEmitFilter` → `findBestMatch` (from pre-emit-dedup.mjs) **which DOES have the B-2 filter**. So:
- If Phase 2f gives a hash warning, LLM sees no real skill to PATCH → SKIPs.
- If LLM somehow produces a block anyway, Stage 2 catches it with the proper hash filter.

**Net effect:** Phase 2f's bug wastes LLM calls (LLM SKIPs based on hash), but Stage 2's safety net catches any block that slips through. No double-counting.

### E6. Architectural fix achieves its goal?

| Goal | Status | Evidence |
|------|--------|----------|
| **Stage 1:** Reduce v=2 queue inflation from duplicate cron prompts | ✅ **ACHIEVED** | 27/31 dropped on a typical queue. LLM call volume reduced ~87%. |
| **Stage 2:** Prevent LLM from writing duplicate skills | ✅ **ACHIEVED** | 2 SKIPs in current telemetry with real-skill matches. |
| **B-1:** Multi-turn LLM retry so LLM learns to PATCH instead of recreate | ✅ **ACHIEVED** | Loop exists, bounded (2 calls + 5min), smoke-tested termination paths. |
| **B-2:** Prevent Stage 2 from injecting hash-named inject paths | ✅ **ACHIEVED for Stage 2** | pre-emit-dedup's `findBestMatch` filters hashes; verified all 3 current post-LLM events have real `matchedSkill`. |

**Bonus bug found in Phase 2f:** The B-2 hash filter was NOT applied to `skill_dedup_gate.js`'s `computeDedupWarnings*`, leaving a 22% pollution rate for Phase 2f's prompt warnings. This is the SAME pathology that B-2 was meant to fix, just exposed via a different code path.

---

## Summary

### Bug counts

- **Critical bugs: 2**
  1. `pre-emit-dedup.mjs` is UNTRACKED in git — risk of data loss / chain failure if file is lost.
  2. Phase 2f `collectDedupSignals` (via `skill_dedup_gate.js`) does NOT have the B-2 hash filter — 22% of v=3 candidates will see hash-keyed warnings in the prompt.

- **Medium bugs: 4**
  1. `runFollowupLoop`'s `abortedReason` mislabels LLM errors and parse errors as `time_budget_exhausted` (line 1875-1877).
  2. Embeddings cache TOCTOU race (multiple writers, last-rename-wins).
  3. LLM rate-limit exposure: 1 initial + 2 follow-up = up to 3 LLM calls per run, no backoff between follow-ups.
  4. `skill_reviewer.js` has no `LOCK_DIR` — concurrent prompt builder invocations could overlap (low-impact in practice).

- **Low / cosmetic bugs: 5**
  1. `originalBlockCount` formula at line 1869 is awkward and falls back to 0 in tests.
  2. Phase A+ `crossSourceDup` log includes hash as similarSkill when cache pollution dominates (cosmetic in warn mode; functional in strict mode).
  3. Stage 1's truncation at 200 chars could split surrogate pair (cosmetic; SHA-1 stable).
  4. Stage 1's invalid-timestamp handling uses `Date.now()` fallback (defensive but conservative).
  5. `_logPostLlmDedupTelemetry` doesn't surface `matchedSkillIsHash` field (inconsistent with pre-emit-dedup telemetry contract).

### Upstream / downstream status

- **Upstream (4 emitters):** ✅ **GREEN** — all correctly integrate with `pre-emit-dedup.mjs`. No regressions.
- **Downstream (4 consumers):** ⚠️ **YELLOW** — `skill_junk_tracker`, `daily_telemetry_digest`, `weekly_correction_loop` are unaffected. `skill_dedup_gate` itself has the unfixed Phase 2f bug (Task E.3).

### Architectural goal achievement

- Stage 1 dedup: ✅ Achieved (27/31 dropped)
- Stage 2 SKIP: ✅ Achieved with real-skill names
- B-1 follow-up loop: ✅ Achieved, bounded correctly
- B-2 hash filter: ✅ Achieved for Stage 2 path; ⚠️ MISSED for Phase 2f path

### Recommendation: **HOTFIX NEEDED** (not full rollback)

**Must fix before next cron cycle:**
1. **Commit `pre-emit-dedup.mjs` to git** — currently untracked. Single most important fix.
2. **Apply B-2 hash filter to `skill_dedup_gate.js`'s `computeDedupWarnings*`** — patch the matches loop to skip hash-keyed entries (mirror pre-emit-dedup.mjs:128-135).

**Should fix within 24h:**
3. Fix `abortedReason` classification in `runFollowupLoop` to distinguish LLM error / parse error / max calls / time budget.
4. Add a `LOCK_DIR` to `skill_reviewer.js` (mirror bot's lock pattern).

**Nice-to-have:**
5. Improve `originalBlockCount` formula clarity.
6. Add backoff between follow-up LLM calls.
7. Surface `matchedSkillIsHash` in Stage 2 telemetry for parity with pre-emit-dedup telemetry.

### Verification log

- ✅ Read all 3 modified files in full (351 + 1136 + 2112 lines)
- ✅ Read 4 upstream emitters + 4 downstream consumers + dedup_gate (388 lines)
- ✅ `node --check` on all 3 modified files (PASS)
- ✅ 6+ smoke tests via `node -e`:
  - Stage 1 dedup simulation (27/31 dropped, expected ~25/29)
  - 24h boundary test (2 kept, 1 dropped at boundary)
  - pre-emit-dedup dry-run (cron-config-audit → skip, novel → patch)
  - Follow-up loop: LLM SKIP → 1 call exit
  - Follow-up loop: LLM error → 1 call fail-open
  - Follow-up loop: PATCH → 1 call exit (validator catch)
  - Hash pollution quantification (13/60 real skills affected)
- ✅ Telemetry file inspection (3 files, 21 events total)
- ✅ Git status check (pre-emit-dedup.mjs UNTRACKED)
- ⚠️ Could not run actual cron because OLLAMA may not be running locally
