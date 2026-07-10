# Verifier Migration Plan — Phase 2g

**Date:** 2026-06-19
**Owner:** migration planner (Phase 2g)
**Goal:** Replace 3 divergent validators with `scripts/lib/unified_verifier.js` (tier-aware). Eliminate the `passedAndQuarantined` inconsistency (10 skills in latest 7-day window, 6 in earlier baseline).

## Background

Three validators currently make conflicting decisions on the same skill:

| Validator | Location | Tier assumed | Blocking |
|---|---|---|---|
| Pre-write gate | `skill_reviewer_bot.js:867` (`validateSkillContent`) | implicit "draft" | yes |
| Post-write validator | `scripts/validate_skill_file.js` (195 LOC) | implicit "draft" | yes |
| Curator quarantine | periodic scan, writes `.skill_junk_rate.jsonl` | implicit "active" | soft (logs `junkRatePercent`) |

**Symptom:** A skill can pass the validator (2-of-3 stub signals OK) yet still be flagged as junk by the curator's heuristic scan. Conversely, a skill promoted to `active` with `status: draft` frontmatter still gets `active`-tier evaluation in the next scan, with relaxed thresholds it shouldn't have.

**Latest 7-day window (`2026-06-18T13:47:37Z`):** 10 passed-and-quarantined skills:
`loop-engineering-implementation`, `m3-subagent-article-analysis`, `cron-troubleshooting`,
`rapaport-email-summary`, `subagent-fix-orchestration`, `subagent-code-tuning-workflow`,
`main-session-execution-loop-recovery`, `daily-synthesis`, `webbridge-chrome-debugging`,
`webbridge-youtube-analysis`.

**Audit baseline (`2026-06-19`):**
- 72 active skills + 22 archived = 94 total
- By tier: `draft=30, active=42, archived=22, unknown=0`
- Validator: 64 pass / 30 fail
- See `.analysis/skill-tier-audit-2026-06-19.json`

---

## Phase A — Wrap unified_verifier inside the existing validator (immediate, zero-risk)

**Trigger criteria:**
- ✅ `scripts/lib/unified_verifier.js` exists and exports `verifySkill`, `verifySkillContent`, `RULES`, `getRulesForTier`, `VALID_TIERS` (verified 2026-06-19).
- ✅ All 3 production callers compile against current `validate_skill_file.js` (verified: skill_reviewer_bot.js imports it).
- ✅ `.analysis/skill-tier-audit-2026-06-19.json` written.

**Steps:**

1. Refactor `scripts/validate_skill_file.js` so `validateSkillContent(content)` is a thin wrapper that calls `verifySkillContent(content, 'draft')` and re-shapes the response:
   ```js
   const { verifySkillContent } = require('./lib/unified_verifier');
   function validateSkillContent(content) {
     const { valid, errors, warnings } = verifySkillContent(content, 'draft');
     return { valid, errors };
   }
   ```
2. Keep the legacy `validateSkill(filePath)` wrapper, the module exports, and the CLI behavior **bit-identical**. External callers (skill_reviewer_bot.js line 843, 931) keep working without changes.
3. Add a smoke test: re-run audit; expect identical 64 pass / 30 fail counts.

**Rollback plan:**
- `validate_skill_file.js` is git-tracked; revert the file in one commit.
- No CLI flags or new error shapes introduced, so no caller recompile needed.
- Estimated rollback time: <2 minutes.

**Success metric:**
- `node scripts/audit_skill_tiers.js` returns the same 64/30 split as the baseline (functional equivalence).
- No new errors logged in `skill_reviewer_bot.js` next 24h cron run.

---

## Phase B — Tier backfill for all active skills (1 week)

**Trigger criteria:**
- ✅ Phase A complete and audited (≥48h in production, zero false-negatives reported).
- ✅ `scripts/backfill_skill_tiers.js` written (see Phase B deliverable in this PR).
- ✅ A draft PR exists updating `scripts/lib/frontmatter.js` `extractField('status')` callers — no runtime behavior change yet.

**Steps:**

1. Run `node scripts/backfill_skill_tiers.js --dry-run` first; capture the proposed change set.
2. Inspect the dry-run output for edge cases (skills already archived, skills with no `status:` field but already in `_archive/`).
3. Run `node scripts/backfill_skill_tiers.js` to apply. Idempotent — safe to re-run.
4. Re-run `node scripts/audit_skill_tiers.js` and compare to baseline:
   - Expect `unknown` count → 0
   - Expect `draft`, `active`, `archived` counts ≥ baseline (existing values preserved)
   - Expect zero file-content changes for skills that already had `status:`
5. Spot-check 3 passed-and-quarantined skills (`loop-engineering-implementation`, `m3-subagent-article-analysis`, `cron-troubleshooting`): their tier classification must match what the curator's quarantine scan would flag.

**Rollback plan:**
- `scripts/backfill_skill_tiers.js` is git-tracked and **only adds frontmatter lines**, never deletes content. Revert the SKILL.md diffs with `git checkout HEAD -- skills-learned/`.
- Each frontmatter change is a single `status:` line addition; `git log -p` shows the exact additions for surgical undo.
- Estimated rollback time: <5 minutes.

**Success metric:**
- `unknown` tier count drops to 0 in the audit JSON.
- The 10 passed-and-quarantined skills from the latest 7-day window now have a tier classification that matches their quarantine reason (4 should be demoted from `active` → `draft`, 2 already `draft`, 4 need verification).

---

## Phase C — Replace pre-write gate in skill_reviewer_bot.js (2 weeks)

**Trigger criteria:**
- ✅ Phase A and B complete; ≥7 days production stability.
- ✅ `unified_verifier.js` is the only `validateSkillContent` caller in the bot (verified via grep).
- ✅ Curator quarantine logic uses `unified_verifier.verifySkill(content, 'active')` instead of its own heuristic.

**Steps:**

1. Replace the inline `validateSkillContent` import + QW-3 composite check in `skill_reviewer_bot.js:843-884` with a tier-aware call:
   ```js
   var { verifySkillContent } = require('./lib/unified_verifier');
   var preResult = verifySkillContent(block.content, 'draft'); // tier='draft' for new skills
   ```
2. Replace the post-symlink `execFileSync('node', ['scripts/validate_skill_file.js', absPath])` (line 929-933) with the in-process call:
   ```js
   var postResult = verifySkillContent(block.content, 'draft');
   ```
   This eliminates the subprocess overhead and ensures tier-aware blocking.
3. Update the `recordSkillCreated` reasons to include `tier: 'draft'` and the unified score.
4. Keep the legacy CLI entry point (`scripts/validate_skill_file.js`) callable for external integrations — it remains a thin wrapper around unified_verifier after Phase A.

**Rollback plan:**
- The new calls are inside a `try { ... } catch` block; revert the two line edits in `skill_reviewer_bot.js`.
- Validator subprocess path remains as a fallback in the same function (kept commented during transition, then deleted in Phase D).
- Estimated rollback time: <10 minutes.

**Success metric:**
- Zero new `pre-write validator fail (QW-3)` entries in the telemetry log (those entries indicate the OLD pre-write gate fired).
- Subprocess spawn count for `validate_skill_file.js` drops by ~70% (one subprocess per skill → zero).

---

## Phase D — Retire curator quarantine as a separate step (3 weeks)

**Trigger criteria:**
- ✅ Phase A, B, C complete; ≥14 days production stability.
- ✅ Tier classification stable across the audit JSON for 7 consecutive days.
- ✅ `passedAndQuarantined` count in `.skill_junk_rate.jsonl` drops to 0 or stays at the expected noise floor.

**Steps:**

1. Replace the curator's heuristic quarantine logic with `unified_verifier.verifySkill(content, 'active')`:
   ```js
   const { verifySkill } = require('./lib/unified_verifier');
   const result = verifySkill(skillPath, 'active');
   if (!result.valid) quarantine(skillPath, result.errors);
   ```
2. Move the quarantine entry from `.skill_junk_rate.jsonl` into `.skill_verifier_results.jsonl` with the full rule breakdown (so post-mortems can see WHY each skill failed).
3. Delete the legacy `scripts/validate_skill_file.js` CLI entry only after the 14-day window; keep the wrapper for backward compat for an additional 14 days (total 28 days), then delete.
4. Update `closed_loop_v11_runner.js` (or whichever cron fires the curator scan) to call unified_verifier directly.

**Rollback plan:**
- Phase D changes are isolated to the curator script + cron entry; restore from git.
- The wrapper `validate_skill_file.js` remains until 14 days after Phase D, so any rollback can re-enable it as the entry point.
- Estimated rollback time: <30 minutes (re-enable CLI + restore curator heuristic).

**Success metric:**
- `.skill_junk_rate.jsonl` field `passedAndQuarantined` is empty or absent for 7 consecutive days.
- All quarantine events include `tier`, `score`, and `ruleResults` fields — no orphan events.
- `scripts/validate_skill_file.js` deleted from the repo with zero broken callers (verified by `grep -r "validate_skill_file" scripts/`).

---

## Risk Register

| Risk | Phase | Mitigation |
|---|---|---|
| Tier classification wrong → false block on real skills | B | Dry-run + spot-check; preserve existing `status:` values |
| Subprocess removal breaks log scraping | C | Keep CLI wrapper as backup for 14 days (until Phase D) |
| Curator heuristic deletion loses niche detections | D | Replicate the heuristic as one rule in `unified_verifier.js` RULES table |

## Out of Scope

- Rewriting the curator's heuristic into unified_verifier rules (deferred to Phase 2h)
- Adding new tiers beyond `draft`/`active`/`deprecated` (deferred to Phase 2h)
- Migrating `closed_loop_v11_runner.js` to the new verifier (separate ticket)

## References

- `.analysis/skill-tier-audit-2026-06-19.json` — Phase 2g audit baseline
- `scripts/lib/unified_verifier.js` — new tier-aware verifier
- `scripts/validate_skill_file.js` — current post-write validator (will become wrapper in Phase A)
- `scripts/skill_reviewer_bot.js:843-933` — pre-write gate + post-write subprocess call
- `.skill_junk_rate.jsonl` — quarantine log (latest 7-day window has 10 inconsistencies)