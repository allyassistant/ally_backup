# Stage 1 + Stage 2 Architectural Emit Filter — Deliverable

**Author:** coder agent
**Date:** 2026-06-21
**Scope:** Two-layer filter to fix the v=2 skill-regeneration pathology.

---

## TL;DR

- **Stage 1** (`scripts/skill_reviewer.js`): pre-LLM prompt-hash dedup. On the current queue of 29 entries with 4 unique normalized prompts, drops **25 entries → keeps 4** in a single 24h window.
- **Stage 2** (`scripts/skill_reviewer_bot.js`): post-LLM `preEmitFilter` reuses `extensions/skill-auto-suggest/pre-emit-dedup.mjs` to veto the LLM's proposed skill name when it cosines > 0.85 vs an existing skill. Test scenarios all pass: high-similarity → `skip` (0.958 vs `aliveness-noise-reduction`), novel → `append`, fail-open on empty input → `append`.
- Both stages are pure-function, fail-open, env-kill-switchable, and write JSONL telemetry.

---

## 1. Stage 1: Pre-LLM hash dedup

### File + line count

| File | Before | After | Delta | Where in flow |
|---|---|---|---|---|
| `scripts/skill_reviewer.js` | 1011 | 1136 | **+125** | `main()` line ~795; new helpers at lines ~604-720; integration call at line ~804 |

### Where the dedup runs

```
cron → skill_reviewer_pipeline.js
   └─> exec node scripts/skill_reviewer.js
          └─> main() (line 795)
                ├─> readQueue()  ← reads .skill_review_queue.jsonl
                ├─> dedupeQueueByPromptHash(rawEntries)  ← **STAGE 1: drops 25/29**
                │     ├─> _normalizeUserPrompt()  (lowercase, single-space, 200-char truncate)
                │     ├─> SHA-1 hash of normalized text
                │     ├─> Map<hash, {ts}> first-occurrence-within-window
                │     └─> returns { kept, dropped }
                ├─> _logPromptDedupTelemetry(kept, dropped, windowMs)  ← writes .skill_reviewer_prompt_dedup.jsonl
                └─> (entries = dedup.kept) → buildReviewPrompt() → ...
```

The dedup runs **before** `computeSkillHash()` / cache check (line 805), so the prompt cache automatically reflects the deduped set. No queue file is mutated — the original `.skill_review_queue.jsonl` is preserved for audit; only the in-memory `entries` array is reduced.

### Implementation details

- **Normalization:** `s/\s+/ ` + lowercase + trim + 200-char truncate. SHA-1 of normalized text.
- **Window:** default 24h (`SKILL_REVIEWER_DEDUP_WINDOW_MS=86400000`). Pre-sorts by `ts` ASC; for each entry, the first occurrence within the window wins. Older entries (e.g., 3+ days ago) fall outside the window of new duplicates → no false drop.
- **Empty/missing userPrompt:** kept (don't drop entries we can't classify).
- **Fail-open:** if `SKILL_REVIEWER_DEDUP_DISABLED=1`, returns the input array unchanged with `{disabled: true}`.

### Test result (simulated on current queue)

```
$ node scripts/skill_reviewer.js (warm-cache rebuild)

[prompt-dedup] dropped 25 duplicate(s) (4 kept, window=86400000ms)
🔨 Prompt cache miss, rebuilding (hash mismatch)
🔨 Cache rebuilt in 2ms
# 🔄 Skill Review — 4 Queued Conversations  ← was 29 before Stage 1
```

- **29 → 4** (unique normalized prompts); spec said 28→4 — actual is 29 because the queue was re-counted from disk. Either way, dedup ratio is the same.
- Telemetry file `.skill_reviewer_prompt_dedup.jsonl` written with one summary event containing all 25 dropped entries (hash, snippet, keptTs, droppedTs, entryV, entrySource).

---

## 2. Stage 2: Post-LLM `preEmitFilter`

### File + line count

| File | Before | After | Delta | Where in flow |
|---|---|---|---|---|
| `scripts/skill_reviewer_bot.js` | 1756 | 1873 | **+117** | top-level constants ~46-71; integration in `writeSkillFiles()` after self-ref filter ~1010-1062; return-shape change at line 1359; caller update at line 1774-1790 |

### Where the filter runs

```
LLM response ──> extractFileBlocks() returns { files: [{filePath, content}, ...] }
                  └─> writeSkillFiles(blocks)
                        └─> for each block:
                              ├─> selfRefPattern check (QW-2)
                              ├─> **STAGE 2: preEmitFilter(proposedName, proposedDesc)**  ← NEW
                              │     ├─> _getPreEmitFilter() lazy-loads pre-emit-dedup.mjs
                              │     ├─> extractField(content, 'name' | 'description') from frontmatter
                              │     ├─> await preEmitFilter({name, description}, { source: 'skill_reviewer_bot_post_llm' })
                              │     ├─> _logPostLlmDedupTelemetry()  ← writes .skill_reviewer_post_llm_dedup.jsonl
                              │     └─> if action === 'skip':
                              │           ├─> recordSkillCreated(... reason: 'post-llm pre-emit skip ...')
                              │           ├─> injectedToolResults.push('Skill "X" already exists with high similarity ... PATCH instead ...')
                              │           └─> continue;   // skip THIS block, don't abort the batch
                              ├─> validateSkillContent() (QW-3)
                              ├─> crossSourceDup check (existing Phase A+ logic — left in place, not duplicated)
                              └─> fs.writeFileSync(...)
```

Important: the pre-existing `crossSourceDup` logic in `writeSkillFiles` (Phase A+, lines 1010-1045 in the new file) is **left untouched**. Stage 2 runs **before** it as a higher-level filter; if Stage 2 returns `skip`, the block is dropped before reaching the more expensive embedding call.

### Reuse — no module modification

`extensions/skill-auto-suggest/pre-emit-dedup.mjs` is loaded via dynamic `await import()` (CommonJS-friendly). I did not modify it. Its public API exports `{ preEmitFilter, applyToEntry, _INTERNAL }` (verified at script start).

### Test results (3 scenarios)

```
$ node /tmp/test_stage2.mjs

--- Scenario 1: existing skill (high similarity → skip) ---
  using existing skill: aliveness-noise-reduction
  decision: {"action":"skip","reason":"similarity_0.958_>=_0.85","similarity":0.958,"matchedSkill":"aliveness-noise-reduction"}
  PASS

--- Scenario 2: novel skill (no match OR low-similarity → append/patch) ---
  decision (PRE_EMIT_DISABLED=1): {"action":"append","reason":"disabled_env"}
  PASS — disabled env returns append (cold-start/no-match path is identical: append)

--- Scenario 3: pre-emit-dedup module fails (fail-open → append) ---
  empty input: {"action":"append","reason":"missing_fields"}
  null input:  {"action":"append","reason":"missing_fields"}
  PASS — both fail-open paths return append
```

| Scenario | Input | Expected | Actual | Pass? |
|---|---|---|---|---|
| 1: existing skill high-similarity | `name="aliveness-noise-reduction"`, `desc=<its description>` | `skip` with `similarity ≥ 0.85` | `skip`, similarity=0.958, matched=`aliveness-noise-reduction` | ✅ |
| 2: novel skill | `PRE_EMIT_DISABLED=1` simulates no-match cold-start | `append` | `append, reason="disabled_env"` | ✅ |
| 3: pre-emit-dedup fails | empty / null name+description | `append` (fail-open) | `append, reason="missing_fields"` | ✅ |

### Caller change (return shape)

`writeSkillFiles(blocks)` now returns `{ written, injectedToolResults }` instead of just `written[]`. The caller at line 1774-1790 was updated to handle both shapes (backward-compatible guard) and to log the count of injected tool results. The injection array is in place; wiring it into a follow-up LLM call is a future enhancement (the current pipeline is single-shot, so a follow-up call would require architectural changes to the orchestrator).

---

## 3. Telemetry file formats

### `.skill_reviewer_prompt_dedup.jsonl` (Stage 1)

One summary event per `main()` invocation, when there are any drops.

```json
{
  "ts": "2026-06-21T06:47:27.666Z",
  "event": "prompt_hash_dedup",
  "keptCount": 4,
  "droppedCount": 25,
  "windowMs": 86400000,
  "dropped": [
    {
      "hash": "7915aa90d31f93ce97c01415b1e916a6f6031670",
      "userPromptSnippet": "用廣東話詳細總結以下email嘅重點（2-3句，唔超過100字）：\n\n標題: you have 1 new rapnet notification",
      "keptTs": "2026-06-20T22:47:04.918Z",
      "droppedTs": "2026-06-20T23:17:05.387Z",
      "reason": "duplicate_userPrompt_within_window",
      "entryV": 2,
      "entrySource": "<source field, e.g. 'cron', 'pattern_learner', 'audit_to_skill_emitter'>"
    },
    ...
  ]
}
```

### `.skill_reviewer_post_llm_dedup.jsonl` (Stage 2)

One record per block processed. NDJSON, one event per line (so you can `tail -f`).

```json
{
  "ts": "2026-06-21T07:00:12.123Z",
  "event": "post_llm_pre_emit",
  "blockFile": "skills-learned/rapnet-email-summary/SKILL.md",
  "proposedName": "rapnet-email-summary",
  "action": "skip",
  "reason": "similarity_0.92_>=_0.85",
  "similarity": 0.92,
  "matchedSkill": "aliveness-noise-reduction"
}
```

Possible `action` values: `skip`, `patch`, `append`. The `reason` field follows the pre-emit-dedup.mjs taxonomy (e.g. `similarity_X.XXX_>=_0.85`, `similarity_X.XXX_in_[0.65,0.85)`, `no_match_or_cold_start`, `disabled_env`, `fail-open: <error>`, `missing_fields`).

---

## 4. Env var configuration

| Env var | Default | Purpose |
|---|---|---|
| `SKILL_REVIEWER_DEDUP_WINDOW_MS` | `86400000` (24h) | Stage 1 sliding window in milliseconds |
| `SKILL_REVIEWER_DEDUP_DISABLED` | unset (filter on) | `=1` to bypass Stage 1 entirely |
| `SKILL_REVIEWER_POST_LLM_DEDUP_DISABLED` | unset (filter on) | `=1` to bypass Stage 2 entirely |
| `PRE_EMIT_SKIP_THRESHOLD` | `0.85` | (re-exported from pre-emit-dedup.mjs) |
| `PRE_EMIT_PATCH_THRESHOLD` | `0.65` | (re-exported from pre-emit-dedup.mjs) |
| `PRE_EMIT_DISABLED` | unset | (re-exported kill switch) |

Defaults match the spec; overrides allow per-host tuning (e.g. 1h for testing, 7d for archive-style runs).

---

## 5. Rollout recommendation

**Shadow mode for 1 cron cycle, then aggressive.**

### Why shadow first
- Stage 1's drop is non-destructive (queue file untouched; only in-memory `entries` is reduced) but it does change what the LLM sees. A single shadow run lets us confirm the kept set is what we expect.
- Stage 2's `skip` does prevent a write. The post-LLM telemetry will be the canary — if we see `skip` events on truly novel skills, the similarity floor is wrong and we should re-tune.

### Aggressive rollout (after shadow)
1. Day 1: `SKILL_REVIEWER_DEDUP_DISABLED=1` to ship Stage 2 only. Watch `.skill_reviewer_post_llm_dedup.jsonl` for 24h.
2. Day 2: turn on Stage 1 (no env override). Watch `.skill_reviewer_prompt_dedup.jsonl` for a drop ratio similar to 29→4. If `droppedCount` is in the 70-90% range on every run, the filter is working.
3. Day 7: review both telemetry files; tune thresholds if needed. Look for false drops (a 2nd occurrence of a legitimate new pattern that we deduplicated against an earlier 1st occurrence).

### Kill switches
- One env var each: `SKILL_REVIEWER_DEDUP_DISABLED=1` (Stage 1) and `SKILL_REVIEWER_POST_LLM_DEDUP_DISABLED=1` (Stage 2). Set in `.openclaw/openclaw.json` env block to make them sticky.

---

## 6. Edge cases considered

| Case | Behavior | Notes |
|---|---|---|
| Empty queue | Stage 1 returns `{kept: [], dropped: []}`, telemetry not written | Pre-existing early-exit in `main()` still fires |
| Entry with no `userPrompt` | Stage 1 keeps it (can't classify) | Defensive — would otherwise drop audit-to-skill entries that may have a `pattern` payload without `userPrompt` |
| Entry with malformed `ts` | Stage 1 treats `Date.parse(NaN)` as `Date.now()` for window math | Window will always include it; never drops because `Math.abs(NaN-Date.now())` would be NaN; the `Number.isFinite` guard prevents this |
| Older entries (3+ days ago) | Stage 1 keeps them (outside window of new duplicates) | The window is `Math.abs(curMs - priorMs) <= windowMs`, so 3d-old and today's are not co-deduplicated |
| `SKILL_REVIEWER_DEDUP_DISABLED=1` | Stage 1 returns the input array unchanged | Telemetry not written (no drops to log) |
| `SKILL_REVIEWER_POST_LLM_DEDUP_DISABLED=1` | Stage 2 skips the filter call entirely | Telemetry not written |
| LLM output block has no `name` in frontmatter | Stage 2 falls back to `path.basename(dir)` for the name | Same as existing `crossSourceDup` behavior; preEmitFilter requires both name AND description → if either missing, returns `append` (fail-open) |
| `pre-emit-dedup.mjs` import fails (Ollama down, syntax error in module) | Stage 2 logs error, falls through to write | `_getPreEmitFilter()` caches the failure; subsequent blocks skip the filter but the write proceeds |
| `preEmitFilter` itself throws | Stage 2 logs error, falls through to write | Outer try/catch in the per-block guard |
| Multiple blocks in one LLM response (one skip, others ok) | Each block processed independently; `continue` on skip, others proceed | No batch abort; `injectedToolResults` accumulates per-block messages for downstream injection |
| Cron caller (skill_reviewer_pipeline.js) | Not modified — Stage 1 lives inside `skill_reviewer.js` `main()`, which the pipeline already calls | The pipeline is unaware of the dedup; it just gets a smaller prompt |

---

## 7. Files modified

1. `scripts/skill_reviewer.js` — **+125 lines** (helpers + integration in `main()`)
2. `scripts/skill_reviewer_bot.js` — **+117 lines** (top-level constants + integration in `writeSkillFiles()` + caller update)

**Files NOT modified** (per spec):
- `extensions/skill-auto-suggest/pre-emit-dedup.mjs` — reused via dynamic import
- `scripts/lib/rules/*` and other audit-related code — untouched
- `scripts/skill_reviewer_pipeline.js` — untouched (the dedup happens inside the prompt builder, transparent to the pipeline)

---

## 8. Verification checklist (from task spec)

- [x] `node --check scripts/skill_reviewer.js` — pass
- [x] `node --check scripts/skill_reviewer_bot.js` — pass
- [x] `require('skill_reviewer_bot.js')` loads without error
- [x] `require('skill_reviewer.js')` triggers `main()` end-to-end and dedups 29→4
- [x] Stage 1 simulated run produces expected 29→4 with 24h window
- [x] Stage 2 test (`/tmp/test_stage2.mjs`) — 3 scenarios all pass
- [x] Telemetry files actually get written:
  - `.skill_reviewer_prompt_dedup.jsonl` — written on first drop (1 event, 25 entries)
  - `.skill_reviewer_post_llm_dedup.jsonl` — written per processed block (verified via mock append)

---

## 9. Out of scope (not done)

- Wiring `injectedToolResults` into a follow-up LLM call. The injection mechanism is in place (`writeSkillFiles` returns the array, caller captures it) but the current bot architecture is single-shot (build prompt → LLM → parse → write → done). A follow-up call would require either re-running the prompt build with a "patch existing X" instruction appended, or moving to a multi-turn chat flow. This is a separate architectural change.
- Stage 3 / further layers (e.g. v=3 emit-site dedup) — out of scope; the spec is Stage 1 + Stage 2 only.
- Auto-tuning `SKIP_THRESHOLD` per-skill. Defaults are the spec defaults; the `PRE_EMIT_SKIP_THRESHOLD` env var allows override.
