---
id: 170
title: M3 Advisory W2 Warning Mode — implementation + cron wiring
status: archive
priority: P2
created: 2026-06-18
due: 2026-06-25
updated: 2026-07-04
progress: 1/5 complete (code done, cron wiring pending)
---

## F - Facts（事實）

### Implementation Status (✅ Complete)
- **File:** `scripts/skill_m3_advisory.js` (376 → 541 lines, +165)
- **New function:** `maybePushWarning(stats, lastEvent)` at line 363
- **Wire-up:** line 524 (`if (rolling && !isDryRun() && !fs.existsSync(PAUSE_FILE))`)
- **State file:** `.skill_m3_advisory_warn_state.json` (atomic `tmp` + `renameSync`)
- **Env vars:** `SKILL_M3_WARN_THRESHOLD_PCT=70`, `SKILL_M3_WARN_COOLDOWN_HOURS=4`, `DISCORD_WEBHOOK_SYSTEM`
- **Bug fix (same session):** `computeRollingAlignment()` percentage formula corrected at line 290-292 (`* 100` instead of `* ALIGNMENT_WARN_THRESHOLD_PCT`)

### Verification (✅ Passed)
- `node --check scripts/skill_m3_advisory.js` ✅
- `node scripts/verify_edit.js` P0=0 (only pre-existing magic number warnings)
- Dry-run test: stderr fallback works, no crash

### Current Cron Config (❌ Missing)
- Cron id: `56e09616-50a3-45c2-89eb-d8c427c56191`
- Has: `SHADOW_MODE=true`, `SKILL_M3_ADVISORY=true`, `SKILL_M3_ADVISORY_MAX_PER_RUN=3`
- **Missing:** `DISCORD_WEBHOOK_SYSTEM=<url>`

### Design Decision (M3 sub-agent chose this)
- **Approach:** Direct HTTP POST via curl (execFileSync, no shell injection)
- **Why not message tool:** Isolated cron has `toolsAllow:["exec"]` only — no message tool access
- **Why webhook URL via env var:** Avoids hardcoding secrets in code/git

## D - Decisions（決定）

### ✅ Done
- 2026-06-18: Implement W2 (Josh requested after seeing 6-option analysis)
- 2026-06-18: Fix `computeRollingAlignment()` percentage formula bug
- 2026-06-18: Use stderr fallback when webhook URL missing (fail-soft, no crash)

### ⏳ Pending (Josh to decide)
- Add `DISCORD_WEBHOOK_SYSTEM` to cron payload?
  - **Option A:** Yes — full Discord notification when alignment < 70%
  - **Option B:** No — rely on stderr log + warn state file (current state)
  - **Recommendation:** Defer until pause expires (2026-06-19 04:02 HKT) and we see real alignment data

## Q - Questions（問題）

### ❓ Josh needs to decide
- 1. Create Discord webhook for #⚙️系統 (channel: 1473376125584670872)?
- 2. Or defer W2 activation until calibration set expansion (#4 from analysis) provides higher-confidence baseline?

### 🔍 Follow-ups
- After pause expires: observe first 24h of alignment data
- Calibration set expansion (Issue #171 — to create) determines W2 reliability

## Progress

- [x] Step 1: Implement `maybePushWarning()` function
- [x] Step 2: Wire-up in main() with triple-gate (rolling && !isDryRun() && !pause)
- [x] Step 3: Atomic state file write (tmp + renameSync)
- [x] Step 4: Syntax + verify_edit + dry-run verification
- [ ] Step 5: Decide cron wiring approach (defer vs activate)

## Closing Criteria (Day 7)

| Status | Condition |
|--------|-----------|
| ✅ PASS | 7d W2 warnings correct (false positive rate < 20%, cooldown works) |
| 🟡 PARTIAL | Webhook missing but stderr logs clear, no crash |
| 🔴 REGRESSION | W2 spam (cooldown broken) or pipeline blocking |

## Rollback Plan

If W2 causes issues:
1. Remove `maybePushWarning()` wire-up at line 524 (revert to W1)
2. Keep `computeRollingAlignment()` bug fix (independent improvement)
3. Delete `.skill_m3_advisory_warn_state.json` (clears cooldown state)

## Notes

- **Parent issue:** #162 (Skill Pipeline Master Issue, M3.6 milestone)
- **Related:** Calibration set expansion (planned #171, top of 6-option analysis)
- **Pre-compaction context:** Jun 18 21:34 HKT — W2 code done, cron wiring decision pending
- **First incident (Jun 18 19:44):** Sent spurious `docs.openclaw.ai` link via `message` tool — context contamination near compaction, not a W2 issue but worth flagging in session hygiene
