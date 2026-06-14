---
id: 150
title: 7-day observation: skill junk rate post-#146 fix (target <10%)
status: active
priority: P1
created: 2026-06-10
due: 2026-06-24
updated: 2026-06-11
progress: 1/3
---

## Description

**目的：** Validate #146 + H-1~H-4 + P2 bug fixes 真正有效。

**System state (2026-06-11 00:00 HKT after cleanup)：**
- Active skills: **41**（all absolute symlinks ✅）
- Quarantined: 10 junk (`_archive/quarantine-2026-06-10/`) + 2 failed (`failed-validations/`)
- Stale symlinks: **0**

**Baseline (2026-06-10 before cleanup)：** 49 個 skills 之中 10 個 junk = **20.4%** (per M3 audit)
**Target (2026-06-17)：** 7-day post-fix junk rate **< 10%**（即新寫嘅 skills 之中 < 10% 係 junk）

**What was fixed (7 bugs, all verified by M3 final audit ✅)：**
- #146 (BUG-01~06): Core pipeline bugs — `listExistingSkills()` empty, close-regex truncation, validator threshold, pre-write size gate, backtick counting fix, atomic writes
- #148: 3 historical relative symlinks → absolute
- #149: Quarantined 10 existing junk skills
- H-1 P0: Stale symlink removal on validation fail → `skill_reviewer_bot.js:435-438`
- H-2 P1: Auto-quarantine failed SKILL.md to `failed-validations/`
- H-3 P1: Validator regex supports `### 1.` H3 headers → `validate_skill_file.js:95,117`
- H-4 P2: Unclosed code fence pre-write detection
- P2 #1: `extractFileBlocks` multi-block loop fix → `skill_reviewer_bot.js:238`
- P2 #2: `numSteps` regex updated for H3 headers
- P2 #3: `pitfallsCount` telemetry uses H-3 compatible regex
- P2 #4: `workflowSteps` telemetry uses H-3 compatible regex → `skill_reviewer_bot.js:502`

**Metric：** `.skill_created.jsonl` 嘅 `validationPassed=false` events / total events

## Progress
- [x] Step 1: Set up 7-day observation cron (daily 23:55 HKT) 計算 junk rate
- [ ] Step 2: Run observation (2026-06-10 → 2026-06-17)
- [ ] Step 3: Report results — pass if <10%, else iterate on validator/curator

## Notes

- **Parent issue:** #146
- **Source data:** `.skill_created.jsonl` in workspace root
- **Target rate:** 10% (was 33%, 3x improvement)
- **Tracker script:** `scripts/skill_junk_tracker.js --days 1 --quiet`
- **Output log:** `.skill_junk_rate.jsonl` (append)
- **First run:** 2026-06-10 23:55 HKT ✅ (18 events, 9 failed, 50% junk rate — expected high due to pre-fix data in window)
