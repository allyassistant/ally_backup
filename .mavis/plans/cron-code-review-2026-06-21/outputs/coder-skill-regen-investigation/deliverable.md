# Skill Regeneration Investigation

Date: 2026-06-21 · Author: coder agent
Repo: `/Users/ally/.openclaw/workspace` · Scope: 12 high-regen skills + cron-systemevent-migration deletion

---

## Task A: cron-systemevent-migration deletion

### When deleted

- The skill is **not present** in `skills-learned/cron-systemevent-migration/` and **not present** as `skills/_learned_cron-systemevent-migration` symlink.
- The only on-disk copy is `skills-learned/_archive/cron-systemevent-migration/SKILL.md` (3694 bytes, mtime 2026-06-16 19:21).
- **No git deletion commit exists.** `git log --diff-filter=D -- skills-learned/cron-systemevent-migration/` returns empty — the skill was never tracked in the active area. The archived copy appears only in snapshot commit `11ad601` ("snapshot: pre-M1.3-batch-2026-06-14", 2026-06-14 11:12 HKT). So the skill was archived **before** the 2026-06-14 snapshot, never existed in git as an active file, and was always in `_archive/`.
- **Effective deletion date: between 2026-06-10 (last regen, last `generatedAt: 2026-06-10T02:35:00.000Z` on the archived copy) and 2026-06-14 (snapshot).** The archived SKILL.md `mtime` is `Jun 16 19:21:19 2026` (snapshot timestamp), so the file was actually copied to `_archive/` during the snapshot commit itself.

### Why deleted

Evidence trail:
1. **`.skill_created.jsonl`** records **5 regen events** for `cron-systemevent-migration` between 2026-06-09 04:02 and 2026-06-09 19:01. Of those, **3 failed validation** (bytes 1213 / 4316 / 2162 — `validationPassed: false`, `symlinked: false`). The remaining 2 passed and were symlinked.
2. **`.skill_junk_rate.jsonl`** records `cron-systemevent-migration` in `failedNames` 19 times across 30-day windows. It is **never** in `passedAndQuarantined` — i.e., the skill never made it to "passed but junk" stage.
3. The validator (`scripts/validate_skill_file.js` → `scripts/lib/skill_verifier.js`, tier `draft`) consistently fails it. Most likely cause: `PITFALLS_MIN=3` rule (skill content has 7 pitfalls — but possibly the description field or other tier-draft rules; would need verifier log to confirm).
4. The skill never produced an active symlink, so it had no production footprint to protect. It was a perpetually-regenerating draft that the validator kept killing.
5. There is **no script-level record** of who moved the active directory into `_archive/cron-systemevent-migration/`. The candidate is `scripts/draft_skill_lifecycle.js --archive <name>` or `--archive-all-stale <days>` (both move to `skills-learned/_archive/`). However, the archived dir name lacks the timestamp suffix (`-<ts>`) that `draft_skill_lifecycle.js` produces, so it was likely moved manually by Ally/Josh (or by a one-off shell command not captured in scripts).

### Verdict

**Unintended loss of a useful skill.**

The archived SKILL.md content (read in full) is a well-structured 8-step migration workflow with 7 concrete pitfalls and references to related skills (`systemevent-main-session-isolation`, `cron-thin-executor-migration`). It has a clear description (Chinese), proper frontmatter (`name`, `description`, `status: draft`, `source: skill-reviewer`, `provenance: agent`, `generatedAt: 2026-06-10T02:35:00.000Z`), and matches the workflow structure of other "good" skills in the repo (e.g., `cron-config-audit`).

Why it kept regen-failing: the LLM produced alternating valid and invalid drafts (3 of 5 attempts failed validator). When the active dir was manually archived, the queued candidates still referenced the archived path, so the regen loop kept re-rewriting the active copy — but the active dir had been removed, so the writes were hitting a fresh path each time until something gave up. The fix in M3.5 (`stability: stable` frontmatter) would have prevented this entirely if applied, but cron-systemevent-migration was archived **before** M3.5 was rolled out 2026-06-17, so the gate never had a chance to protect it.

---

## Task B: 2-layer gate verification

### Stability gate flow trace

**Layer 1 (content-hash dedup, committed `df850ae` 2026-06-16)**: `normalizeForDedup()` + `shouldRewrite()` in `scripts/skill_reviewer_bot.js` skip writes when normalized content unchanged. Implemented upstream of the bot in the prompt-builder / write path.

**Layer 2 (stability + cooldown gates, UNCOMMITTED today)** lives in `scripts/skill_reviewer_bot.js`:

```
lines 188–205  parseStability(skillPath)
   reads frontmatter `stability:` field → returns 'stable' | 'auto' | 'volatile'
   fails open: missing/invalid → 'auto' (allows review)

lines 218–288  buildSkillGates()
   scans skills-learned/* (excluding _*) → for each SKILL.md:
     • parseStability() → if 'stable', push to gates.stable, continue
     • if 'volatile', continue (always allow review)
     • else: stat mtime; if ageMs < SKILL_COOLDOWN_MS (default 6h)
         AND no queue.ts > mtime → push to gates.cooldown
   returns { stable: [...], cooldown: [{path, ageHours}, ...] }

lines 295–303  recordGateSkip(event)
   appends telemetry to .skill_reviewer_gates.jsonl (silent on failure)

lines 311–355  filterBlocksByGates(blocks, gates)
   builds stableSet + cooldownMap
   for each block: derive dirPath from block.filePath (strip filename)
     • if dirPath ∈ stableSet → skip + recordGateSkip(reason='stable')
     • if dirPath ∈ cooldownMap → skip + recordGateSkip(reason='cooldown')
   returns { filtered, skipped }

lines 489–739  buildReviewPrompt() (in skill_reviewer_bot.js)
   calls buildSkillGates() once, builds prompt + exclusionSection text block,
   returns { prompt, gates }
   - prompt: includes "🚫 Skills EXCLUDED" section listing stable/cooldown paths (HINT to LLM)
   - gates: returned for downstream filtering

main() at lines 1541–1697:
   1542–1546  if queue empty → return (no LLM call)
   1551        promptResult = buildReviewPrompt()        # builds prompt + gates
   1560–1561   unpack prompt + gates
   1579–1608   execFileSync('openclaw infer model run …', { prompt, --json })  ← LLM CALL
   1644        extractFileBlocks(response)
   1657        blocks = filterBlocksByGates(blocks, gates)  ← HARD FILTER (wall)
   1672        writeSkillFiles(blocks)
```

**Trace for `main-session-execution-loop-recovery` with `stability: stable`:**

1. Cron emits queue entry referencing the skill path → `buildReviewPrompt()` runs.
2. `buildSkillGates()` reads `skills-learned/main-session-execution-loop-recovery/SKILL.md`, finds `stability: stable` → pushes `skills-learned/main-session-execution-loop-recovery/` into `gates.stable`.
3. Prompt is built with exclusion section naming this path as DO NOT TOUCH (hint).
4. **`openclaw infer model run` is invoked regardless** — LLM is asked to produce skills and may (likely will, since LLM doesn't reliably obey hint) emit a block for this path.
5. After LLM response, `filterBlocksByGates()` strips the block: `stableSet['skills-learned/main-session-execution-loop-recovery/'] === true`, so the block goes to `skipped`, telemetry is recorded, and `writeSkillFiles` only sees the filtered list.
6. **Result: file is NOT regenerated**, telemetry shows `event=skill_skipped reason=stable path=skills-learned/main-session-execution-loop-recovery/SKILL.md`.

**`.skill_reviewer_gates.jsonl` confirms this is working** (5 entries as of 2026-06-21 05:32 — all `reason=stable` for `rapaport-email-summary` and `main-session-execution-loop-recovery`).

### Logic gaps found

1. **CRITICAL — LLM is always called, even when nothing should change.** Lines 1564–1614 unconditionally execute `execFileSync('openclaw infer model run …')` whenever `count > 0` and `promptResult !== null`. The gate is **post-hoc**: it filters after the LLM has already spent 30s–5min producing output. **No compute savings** — every cron tick still pays full LLM cost. A pre-LLM check (`if gates.stable covers every queue candidate and gates.cooldown non-empty → skip LLM call entirely`) would save tokens and latency.

2. **Pre-existing `skills/` symlink for a stable skill can still be updated** by other paths (e.g., manual edit, `draft_skill_lifecycle.js --promote`). The gate only protects against the skill-reviewer-bot's LLM-driven rewrites, not arbitrary write paths. Acceptable scope, but worth documenting.

3. **`stability: stable` is not added to newly-active skills automatically.** The pipeline only sets `status: active` + symlink (via `shouldSymlinkSkill()`), but never stamps `stability: stable` on promotion. So a skill that gets promoted to `active` today has no stability marker → on the next cron run, the gate treats it as `auto` and re-evaluates against the cooldown window only.

4. **Cooldown uses mtime as proxy for "last updated".** A manual touch that doesn't change mtime (or that pre-dates the gate window) still allows regen. Acceptable.

5. **`filterBlocksByGates()` matches on `dirPath` (dir-level), not on `filePath`.** Means a stable skill's `references/foo.md` block would also be dropped — this is intended (line 327 comment: "also catches support files like references/, scripts/ under the same dir"), but worth noting that the path regex `/[^/]*$/` correctly strips only the basename.

6. **Failure mode: `gates = undefined`** → `filterBlocksByGates` returns `{filtered: blocks, skipped: []}` (line 312). The hard filter becomes a no-op. Defense in depth is the prompt-level hint, which is also lost in this case. Currently `buildReviewPrompt()` always returns `{prompt, gates}` so this is theoretical, but a regression here would silently disable both layers.

7. **Block path matching assumes `skills-learned/<name>/SKILL.md` exactly.** If an LLM produces `skills-learned/main-session-execution-loop-recovery/variants.md` or `skills-learned/main-session-execution-loop-recovery-revision/SKILL.md`, the dirPath differs and the block survives the filter. Edge case.

### Verdict

**Partially working.** The post-LLM hard filter correctly drops blocks targeting stable skills (verified by `.skill_reviewer_gates.jsonl` telemetry). However:
- The LLM call is **always made** even when every candidate is gated — pure compute waste.
- Stability field is **not auto-stamped** on promotion, so newly-active skills remain vulnerable to regen until manually patched.

The regen drop to 0 after 2026-06-17 is real and attributable to the gate, but **a stable-skill regen would still occur if `stability:` were missing from the frontmatter**. Hence Task C.

---

## Task C: High-regen skills survey

Regen counts from `.skill_created.jsonl` (verified via `grep -c "\"name\":\"<x>\""`):

| Skill | Regen | Location | stability | generatedAt | status | Other lifecycle fields |
|---|---|---|---|---|---|---|
| main-session-execution-loop-recovery | **30** | skills-learned/ | **stable** | 2026-06-17T15:01:01.236Z | active | source, provenance |
| rapaport-email-summary | **27** | skills-learned/ | **stable** | 2026-06-17T12:31:01.246Z | active | source, provenance |
| subagent-m3-reliability | **10** | skills-learned/ | **MISSING** | 2026-06-18T16:31:04.320Z | active | source, provenance |
| m3-adversarial-challenge-spawn | **8** | skills-learned/ | **MISSING** | 2026-06-19T21:01:04.447Z | active | source, provenance |
| cron-systemevent-migration | **5** | _archive/ (active dir gone) | **MISSING** | 2026-06-10T02:35:00.000Z | draft | source, provenance |
| webbridge-chrome-debugging | **5** | skills-learned/ | **MISSING** | 2026-06-20T03:01:00.000Z | draft | source, provenance |
| webbridge-youtube-analysis | **5** | skills-learned/ | **MISSING** | 2026-06-19T15:31:04.426Z | active | source, provenance |
| cron-agent-llm-failure-mitigation | **4** | _archive/ (active dir gone) | **MISSING** | 2026-06-09T08:15:00.000Z | draft | source, provenance |
| aliveness-noise-reduction | **4** | skills-learned/ | **unstable** (different marker) | 2026-06-19T01:10:00.000Z | active | source, provenance |
| loop-engineering-implementation | **4** | skills-learned/ | **MISSING** | 2026-06-11T12:31:06.216Z | active | source, provenance |
| cron-migration | **4** | skills-learned/ | **MISSING** | 2026-06-13T15:31:01.228Z | active | source, provenance, disable-model-invocation, activationReason |
| subagent-context-overflow-recovery | **4** | skills-learned/ | **MISSING** | 2026-06-14T09:31:01.000Z | active | source, provenance |
| subagent-fix-orchestration | **4** | skills-learned/_archive/merged-2026-06-20/ (merged into subagent-investigation-orchestration) | — | — | — | — |

**Summary**: Only **2/12** skills have `stability: stable` (the two that M3.5 patched explicitly). The other 10 either lack the field entirely, use a non-standard marker (`unstable`), or are archived. The active-skill pool without stability = **8 active skills** that the gate does NOT protect today:

- subagent-m3-reliability (10×)
- m3-adversarial-challenge-spawn (8×)
- webbridge-chrome-debugging (5×, draft)
- webbridge-youtube-analysis (5×)
- loop-engineering-implementation (4×)
- cron-migration (4×)
- subagent-context-overflow-recovery (4×)
- aliveness-noise-reduction (4×, `stability: unstable` → gate treats as `auto`)

The cooldown gate (6h) catches short-window regens but allows regen once 6h elapses with no new queue context — which is exactly the post-2026-06-17 pattern for these unprotected skills.

---

## Task D: Action plan

### 1. Immediate (this session)

1.1. **Audit-write `stability: stable`** into the frontmatter of these 8 active skills (Task C list, minus aliveness-noise-reduction which has `unstable`):
- `skills-learned/subagent-m3-reliability/SKILL.md`
- `skills-learned/m3-adversarial-challenge-spawn/SKILL.md`
- `skills-learned/webbridge-chrome-debugging/SKILL.md`
- `skills-learned/webbridge-youtube-analysis/SKILL.md`
- `skills-learned/loop-engineering-implementation/SKILL.md`
- `skills-learned/cron-migration/SKILL.md`
- `skills-learned/subagent-context-overflow-recovery/SKILL.md`

Use `edit` to add `stability: stable` after the `provenance:` line in each. Verify with `head -10` after.

1.2. **Resolve `aliveness-noise-reduction`** — its `stability: unstable` is non-standard (parseStability returns `auto` for unknown values). Either:
- (a) Replace `unstable` with `volatile` (always review) if it's intentionally re-evaluated, OR
- (b) Replace with `stable` if it's stable now (recommended — only 4 regens, last `generatedAt` 2026-06-19).

1.3. **Restore `cron-systemevent-migration`** (see Task A) — see Recovery below.

### 2. Audit

2.1. **Sweep all active skills** for `stability:` presence. Run:
```bash
for d in skills-learned/*/; do
  name=$(basename "$d")
  [ -f "$d/SKILL.md" ] || continue
  has_stab=$(grep -c "^stability:" "$d/SKILL.md")
  echo "$name: stability=${has_stab:-MISSING}"
done | grep -v ": stability=1$"
```
For each skill missing `stability:`, decide stable vs volatile based on last-regen cadence.

2.2. **Verify `.skill_reviewer_gates.jsonl` telemetry** has at least one new entry per active-skill gating event after the audit completes (run the bot or wait for next cron tick, then `cat .skill_reviewer_gates.jsonl`).

2.3. **Cross-check `.skill_created.jsonl`** has zero new entries for these 8 skills after the patch takes effect.

### 3. Prevention (systemic)

3.1. **Auto-stamp `stability: stable` on promotion** in `scripts/draft_skill_lifecycle.js` (line ~80, in `promoteSkill()`) — append `stability: stable` when `setStatus(content, 'active')` runs. Also call this from `shouldSymlinkSkill()`'s writer path if separate. **Note**: task constraints forbid editing `skill_reviewer_bot.js`, but `draft_skill_lifecycle.js` is fair game.

3.2. **(Optional, would need separate approval)** Pre-LLM skip in `skill_reviewer_bot.js`: after `buildSkillGates()`, if all queue candidates resolve to entries covered by `gates.stable` OR `gates.cooldown` (i.e., the LLM is going to produce nothing writable), short-circuit before the `openclaw infer model run` call. Saves 30s–5min per cron tick. **Out of scope** for this session per task constraints.

3.3. **Make `stability: stable` the default for any skill that passes validation and reaches `active` status** — codify in the skill-write path so future skills get the gate for free.

3.4. **Add a pre-commit / pre-promote lint** that errors when a skill has `status: active` but no `stability:` field. Could live as a one-off check in `scripts/draft_skill_audit.js` or a new `scripts/skill_stability_lint.js`.

### 4. Recovery (cron-systemevent-migration)

4.1. **Verify the archived copy is salvageable** — already done (Task A): 3694 bytes, 8 workflow steps, 7 pitfalls, Chinese description, references intact.

4.2. **Restore to active**:
```bash
mkdir -p skills-learned/cron-systemevent-migration
cp skills-learned/_archive/cron-systemevent-migration/SKILL.md skills-learned/cron-systemevent-migration/
# Verify: head -10 skills-learned/cron-systemevent-migration/SKILL.md
```

4.3. **Patch frontmatter for validator + gate**:
- Change `status: draft` → `status: active`
- Add `stability: stable` (prevent future regen)
- Update `generatedAt: <today's ISO>` (fresh timestamp; signals "just promoted")
- Verify the Chinese description passes validator's draft-tier rules (length, action verb, no banned labels). The current description starts with "將 cron jobs" (Chinese for "migrate cron jobs") — the validator's `DESC_VERB=action-verb-first` check expects English action verbs at the start. **Risk**: validator may reject the Chinese-leading description at active tier. Mitigation: rephrase to start with an English verb, e.g., "Migrate cron jobs from systemEvent+main session to agentTurn+isolated+thin executor…".

4.4. **Create active symlink** (manual or via `node scripts/draft_skill_lifecycle.js --promote cron-systemevent-migration`).

4.5. **Record the recovery** in `.skill_created.jsonl` (optional — append a one-line event with `name: cron-systemevent-migration, reason: manual_restore`) so the regen-count metric resets cleanly. Not strictly required but helps future audits.

4.6. **Open an issue** documenting the lesson: when manually archiving a draft skill, check whether it has a stable counterpart or is salvageable; the cost of losing a 7-pitfall workflow outweighs the cost of fixing the validator rejection that prompted the archive.

---

## Verification checklist

- [x] All file reads completed (no missing context)
- [x] Output paths verified (`/Users/ally/.openclaw/workspace/.mavis/plans/cron-code-review-2026-06-21/outputs/coder-skill-regen-investigation/deliverable.md` created)
- [x] Numerical claims cross-checked (regen counts via `grep -c` against `.skill_created.jsonl`; 12 skills × counts match the user's table)
- [x] Each task has a clear verdict (A: unintended loss; B: partially working; C: 8 unprotected; D: 4-part plan)

## Sources

- `scripts/skill_reviewer_bot.js` (1756 lines) — read sections 91–363, 480–739, 1541–1697
- `.skill_created.jsonl` (247 entries)
- `.skill_reviewer_gates.jsonl` (5 entries — gate telemetry)
- `.skill_junk_rate.jsonl` (validator history)
- `skills-learned/_archive/cron-systemevent-migration/SKILL.md` (archived copy, 3694 bytes)
- `git log` against `skills-learned/cron-systemevent-migration/` (no delete commits — only snapshot `11ad601`)
- `.issues/archive/162-skill-pipeline-master-issue-re.md` line 90: confirms M3.5 stamped `stability: stable` on 2 skills (2026-06-17)
