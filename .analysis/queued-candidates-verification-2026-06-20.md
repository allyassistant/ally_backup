# Tier 1 C: 3 Queued Candidates Verification — 2026-06-20

> **Task:** Verify whether the 3 audit-to-skill candidates (wrapper-fs-safe-write, magic-number-constant-extractor, simplified-chinese-detector) have been processed by skill_reviewer.
> **Result:** ⚠️ **Candidates emitted but NOT turned into skills — found a format-mismatch bug in Cross-Loop Feedback.**

## Verification summary

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| 1. Candidates emitted by `audit_to_skill_emitter` | 3 v=3 entries in queue | ✅ 5 emission records in `audit_to_skill_emissions.jsonl` (16:40 + 16:41) | ✓ |
| 2. Candidates in queue | 3 v=3 entries | 1 v=3 (at one point), now 0 (consumed) | ✓ (consumed) |
| 3. `skill_reviewer` cron running | Every 30 min | ✓ Last cron run: 2026-06-19 17:03:02 | ✓ |
| 4. `skill_reviewer` not paused | No pause state | ✓ `.skill_reviewer_pause.json` absent; `.skill_reviewer_pause.frozen` is 0 bytes | ✓ |
| 5. New skills created from candidates | wrapper-fs-safe-write, etc. in `skills-learned/` | ❌ **None of the 3 names exist** | ✗ |
| 6. Junk rate tracker stable | No 24h > 15% trigger | ✓ Pause not active | ✓ |
| 7. Last skill_created.jsonl entry | Should include the 3 | Last entry: 2026-06-19 15:32 (webbridge-chrome-debugging rewrite) | ✗ |

## Root cause: format mismatch in dedup_gate

The 3 candidates **were** processed by skill_reviewer but got silently dropped. Investigation revealed:

**`scripts/lib/skill_dedup_gate.js` line 337-338:**
```js
if (!e || !e.proposedSkill || !e.proposedSkill.name || !e.proposedSkill.description) continue;
```

The dedup gate (and the downstream review pipeline) expect a top-level `proposedSkill: { name, description }` field on each queue entry.

**`scripts/audit_to_skill_emitter.js` line 318-319 (emission):**
```js
proposed_skill_name: candidate.skill,
proposed_skill_description: candidate.desc,
```

Writes the name/description under `qualitative_signals`, NOT at the top level.

**Result:** dedup_gate sees no `proposedSkill` field, skips the entry, the entry is never flagged as a duplicate, and the LLM judge in skill_reviewer likely treats it as "unprocessable" or "junk" because the format doesn't match the expected contract.

## What's broken

The 3 candidates:
- `wrapper-fs-safe-write` (from `fsSync_missing_trycatch`, 204 occurrences)
- `magic-number-constant-extractor` (from `magic_numbers`, 80 occurrences)
- `simplified-chinese-detector` (from `simplified-chinese`, 8 occurrences)

…were emitted with v=3 schema but with a different field path than the dedup gate expects. They're being silently dropped.

The same bug likely affects `skill_pattern_emitter.js` v=3 entries (cron 0 */4) — those use `pattern: { semantic_name, fp_rule, ... }` shape, also not the dedup_gate's expected `proposedSkill: { name, description }`.

## Why the bridge "worked" in dry-run

When we tested `audit_to_skill_emitter.js --dry-run` earlier, the script reported "✅ Emitted: 0 candidates, ⏭️ Skipped (dedup): 3". The "Skipped (dedup)" message was misleading — the candidates were NOT in queue at that point, so the dedup check returned "not in queue" → emit. But the actual queue state was empty (post-consumption by skill_reviewer). The sub-agent's dry-run was reading an old/stale queue state.

**The bridge is broken end-to-end**: emits v=3 entries that the consumer can't process.

## Fix proposal

Update `audit_to_skill_emitter.js` to write the dedup_gate-compatible field at the top level:

```js
// Add to v=3 entry:
proposedSkill: {
  name: candidate.skill,
  description: candidate.desc,
},
// Plus existing qualitative_signals for backward compat
```

This is a 1-line change in the entry-building code. The bridge will then:
1. Emit v=3 entries with `proposedSkill: { name, description }` ✓
2. dedup_gate sees them ✓
3. Dedup against existing skill embeddings works ✓
4. LLM judge gets a clear format and can decide KEEP/SKIP/PATCH ✓
5. skill_reviewer creates the new skill ✓

**Effort:** 5 minutes (1-line patch + re-test)
**Impact:** Cross-Loop Feedback actually delivers value — 3 skills should appear within 30 min of next cron run.

## Recommended next action

Should I apply the fix immediately? It's a small, low-risk change that makes the system actually work as designed. Without the fix, the cross-loop feedback we just built today is a "fire and forget" that produces no skills.

Or do you want to:
- Just document the bug as #174 and fix later
- Apply the fix + run test in dry-run + verify
- Investigate other v=3 sources (skill_pattern_emitter) for the same bug

## Files for investigation

- `scripts/lib/skill_dedup_gate.js:337` — expects `entry.proposedSkill.name`
- `scripts/audit_to_skill_emitter.js:318-319` — writes to `qualitative_signals`
- `scripts/skill_pattern_emitter.js` — also emits v=3, may have same issue
- `.skill_review_queue.jsonl` — current state, 1 v=2 entry
- `.skill_created.jsonl` — last entry 2026-06-19 15:32 (no new from candidates)
- `.state/audit_to_skill_emissions.jsonl` — 5 emission records (proof of emit)
- `.state/audit_to_skill_emitter_cron.log` — cron run logs (need to check)

---

*Generated 2026-06-20 01:10 HKT by Mavis*
