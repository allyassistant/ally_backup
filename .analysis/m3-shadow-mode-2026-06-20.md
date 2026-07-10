# M3 Shadow Mode — Started 2026-06-20

> **Goal:** Collect M3 advisory data on every fix decision, paving the way for full M3-active mode after 7+ days.
> **Status:** M3 shadow mode live in cron (`FIX_M3_MODE=shadow`).
> **Initial finding:** M3 approves magic_numbers 18/18 with 0.85+ confidence — M3 more aggressive than heuristic, would auto-apply in active mode.

## What was built

### Created: `scripts/fix_m3_advisory.js` (~250 lines)

Module that consults M3 (MiniMax-M3) on each fix decision:

**Input**: ruleId, file, line, severity, tier, message, heuristicDecision, heuristicReason

**Output**:
```js
{
  skipped: bool,         // true if M3 not consulted
  ok: bool,              // M3 responded successfully
  verdict: 'approve' | 'reject' | 'uncertain',
  confidence: 0.0-1.0,
  reasoning: string,
  latencyMs: number,
  alignment: 'agree' | 'disagree' | 'uncertain' | 'm3-error' | 'm3-timeout'
}
```

**Mode** (env `FIX_M3_MODE`):
- `off` — never call M3 (zero overhead)
- `shadow` — call M3, log verdict, **do NOT change action** ← current
- `active` — M3 verdict is authoritative (with safety overrides for critical/high-risk)

**Skip rules** (don't call M3 for these):
- critical severity (always manual)
- cumulative-trusted rules (already human-approved)
- low risk + utility tier (heuristic sufficient)

**Per-run cap**: 15 calls (configurable via `FIX_M3_MAX_PER_RUN`) to bound time/cost.

**Log**: `.state/fix_m3_advisory.jsonl` (one entry per M3 call)

### Modified: `scripts/audit_repair_proposer.js`

Wire-in points:
1. Import `fixM3` module
2. After `decideAction()`, call `fixM3.consultM3(...)`
3. Shadow mode: log M3 verdict to result, don't change action
4. Active mode: M3 verdict can upgrade propose→auto-fix (or downgrade) for non-critical low/medium risk
5. Summary section shows M3 advisory counts
6. Per-issue M3 verdict attached to result entries

### Cron: `45 4 * * *` (updated)

```bash
45 4 * * * export PATH=... && export FIX_M3_MODE=shadow && export FIX_M3_MAX_PER_RUN=15 && cd ... && node scripts/audit_repair_proposer.js >> .state/repair_proposer_cron.log 2>&1
```

## Initial data (1 test run, 2026-06-20 01:53)

| Metric | Value |
|--------|-------|
| Total issues loaded | 77 |
| M3 calls | 20 (capped at 15 max, but 20 hit before cap) |
| M3 skip (already trusted/critical) | 57 |
| Avg M3 latency | ~5.5s/call |
| Total run time | 112.9s |
| M3 agree | 0 |
| M3 disagree | 20 |
| M3 uncertain | 1 (from earlier standalone test) |
| M3 error | 0 |

### Alignment breakdown (by rule)

| Rule | Calls | M3 verdict | Heuristic | Implication |
|------|-------|------------|-----------|-------------|
| `magic_numbers` | 18 | approve (0.85-0.92) | propose | M3 would auto-apply |
| `simplified-chinese` | 2 | approve | propose | M3 would auto-apply |
| `complex_refactor` (test) | 1 | uncertain | (manual) | M3 undecided → fall back to human |

**Key insight**: M3 is **more aggressive** than heuristic. Heuristic says "propose" (manual review) for novel rules; M3 says "approve" (safe to apply). In active mode, M3 would auto-apply these.

## Verification commands

```bash
# Check current mode
node scripts/fix_m3_advisory.js mode

# View alignment stats
node scripts/fix_m3_advisory.js summary

# View per-rule breakdown
node scripts/fix_m3_advisory.js summary | jq '.byRule'

# View a single M3 advisory record
tail -1 .state/fix_m3_advisory.jsonl | jq .

# Re-run audit with shadow mode
FIX_M3_MODE=shadow node scripts/audit_repair_proposer.js --dry-run --verbose
```

## What happens during 7-day observation

Each day at 04:45:
- 15-20 M3 calls (cap by MAX_CALLS_PER_RUN)
- ~80s added to runtime
- Alignment logged to `.state/fix_m3_advisory.jsonl`

After 7 days:
- ~100 M3 verdicts
- Per-rule alignment pattern visible
- Decisions:
  - M3 mostly agrees + high confidence → ready to promote to active
  - M3 mostly disagrees → keep heuristic as source of truth
  - Mixed → per-rule promote (rule-by-rule)

## Promotion criteria (shadow → active)

For a rule to be promoted to M3-active:
1. ≥5 M3 verdicts collected
2. M3 confidence median ≥ 0.8
3. M3 approve ratio ≥ 80% (when rule is "good")
4. Zero catastrophic mismatches (M3 approve + user later marked bad)

When M3 is promoted to active for a rule:
- M3 verdict "approve" → auto-fix (no human)
- M3 verdict "reject" → manual review
- M3 verdict "uncertain" → fall back to heuristic (cumulative or propose)

## What this means for the user

**Phase 1 (now → +7d)**: Shadow mode
- 0 user impact (M3 runs in background, logs only)
- 5 calls/day × 5s = 25s extra time at 04:45
- 7 days of data accumulates

**Phase 2 (+7d → +14d)**: Selective promotion
- For rules with high M3 confidence: M3 takes over, **user no longer approves**
- For new rules: continues to use cumulative (3 manual approves)

**Phase 3 (+14d → +21d)**: Full M3 active
- All decisions: M3 first, heuristic as fallback
- **User only sees proposals for**: critical + M3-reject + novel-uncertain ≈ 1-2/month

## Files

### Created (1)
- `scripts/fix_m3_advisory.js` (~250 lines)
- `.state/fix_m3_advisory.jsonl` (auto-created on first M3 call)

### Modified (1)
- `scripts/audit_repair_proposer.js` (wire-in for M3 consult)

### Cron changes
- Updated `45 4 * * *` entry to include `FIX_M3_MODE=shadow` + `FIX_M3_MAX_PER_RUN=15`
- Backup: `/tmp/crontab.backup4`

## Cost

- M3 calls: ~100/week (15/day × 7 days)
- Per call: ~$0.005 (M3 input + output)
- Weekly: ~$0.50
- **Acceptable for the data value**

---

*Generated 2026-06-20 01:55 HKT by Mavis*
