## F - Facts（事實）

### Context (from #150 closing report)
- **7-day window 26.95%** junk rate — but window dominated by pre-fix events (4 of 7 days)
- **1-day window avg 8.9%** — close to 10% target, 3/4 daily runs PASS
- **Baseline 20.4%** (pre-#146) → 8.9% post-fix = -56% improvement
- Pre-fix window math: events written before #146 fix count toward 7d, even though fix is live

### Why 7-day window fails
- Pre-fix event window 6/10-6/13 = ~4 days
- These events inflated by old broken state (listExistingSkills empty, no size gate, etc.)
- After 7 days post-fix, the 7-day window would naturally only contain fixed-era events
- But the tracker was set up immediately after fixes, so window always includes pre-fix data

### Current State
- `scripts/skill_junk_tracker.js --days 1` → daily runs ✅ (passes target 3/4 times)
- `scripts/skill_junk_tracker.js --days 7` → always FAIL (tainted window)
- 30-day cron at HEARTBEAT.md #19 (23:55 daily) uses `--days 1` already
- No active changes needed — just clarify methodology

## D - Decisions（決定）

### ✅ Done
- 2026-06-18: Mark #150 complete with PARTIAL PASS verdict
- 2026-06-18: Open #171 follow-up to address 7d methodology

### ⏳ Pending
- Decide: keep 7d window as context-only, or remove entirely?
- Decide: re-run 7d measurement after 2026-06-23 (7 full days post-fix)

## Q - Questions（未解決）

### ❓ Core question
- Should 7-day rolling junk rate metric be deprecated (since it will always be tainted by pre-fix events during the first 7 days), or kept as long-term trend indicator?

### 🔍 Follow-ups
- After 2026-06-23, re-measure 7d window. If 7d < 10% naturally, metric works for future observations. If still >10%, deprecate.
- Should we update HEARTBEAT.md to document the metric distinction (1d primary, 7d context-only)?

## Progress

- [ ] Step 1: After 2026-06-23, re-run `skill_junk_tracker.js --days 7` to check if 7d naturally drops to <10%
- [ ] Step 2: Update HEARTBEAT.md doc to clarify metric tier (1d primary, 7d context-only)
- [ ] Step 3: Decide keep or deprecate 7d window based on Step 1 result
- [ ] Step 4: Close this issue

## Closing Criteria (Day 7)

| Status | Condition |
|--------|-----------|
| ✅ PASS | 7d window naturally < 10% after 7 full post-fix days |
| 🟡 PARTIAL | 7d still > 10% but trending down (>50% drop from baseline) |
| 🔴 REGRESSION | 7d window > 30% or rate climbing |

## Rollback Plan

If new methodology causes issues:
- Revert HEARTBEAT.md to single 7d metric (less informative but simpler)
- Re-run daily tracker with `--days 1` flag (already default)

## Notes

- **Parent:** #150 (closed 2026-06-18)
- **Related:** #146 (original fixes), #149 (quarantine cleanup), #162 (skill pipeline master), #193 (output truncation fix)
- **Data source:** `.skill_junk_rate.jsonl` (228+ entries)
- **Decision owner:** Josh (methodology change affects how future junk rate reports are interpreted)
