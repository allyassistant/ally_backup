---
id: 175
title: CQM-SHL Shared LocalScanner (Option B) — De-duplicate 4 audit rules
status: backlog
priority: P3
created: 2026-06-20
due: 2026-06-30
updated: 2026-06-20
progress: 0/4
---

## Description

**兩個 code quality system (CQM + SHL) 各自維護 4 個 audit rules 嘅 implementation**。CQM (`code_quality_manager.js` via `AuditOrchestrator/LocalScanner`) 同 SHL (`audit_just_written.js`) 各有自己版本嘅 `fsSync_missing_trycatch` / `magic_numbers` / `simplified_chinese` / `todo_fixme`。

**Root cause**: 兩個 system 嘅 audit scanner 由唔同時間、唔同人寫，從未 unify。導致:
- `magic_numbers` false positive 率唔一致 (CQM 15-pattern `WHITELIST_CONTEXTS` vs SHL 冇 whitelist)
- `fsSync_missing_trycatch` detection logic 唔同
- `simplified_chinese` char map 唔同 (CQM 喺 `low-risk.js` vs SHL 44-char inline list)
- Path normalization 一致性問題 (CQM 報 `_archive/skill_matcher_metrics.js` 但實 path 係 `.openclaw/workspace/_archive/...`)

**Goal**: Extract `LocalScanner` 為 standalone module (`scripts/lib/localScanner.js`)，CQM + SHL 共用。Pure de-duplication, 唔改 trigger / runtime behavior。

## Current state (2026-06-20)

### CQM (`scripts/code_quality_manager.js`)
- Schedule: cron `0 10 * * *` HKT (1x/日 10:00)
- Mechanism: direct script call, 16.2s
- Today's output: 49 issues (0C/19H/0M/30L)
- Audit phase: `runAudit` → `AuditOrchestrator.run()` → `LocalScanner` (in `lib/auditOrchestrator.js`)
- Fix phase: `cmdFix` → `execFileSync(auto_fix.js)` (child process, 5min cap)
- Output: `.state/code_quality_report.{json,md}` (overwrite, 0 historical trend)

### SHL (`extensions/self-healing-loop/index.mjs`)
- Schedule: real-time (every edit/write/apply_patch)
- Mechanism: after_tool_call hook, 5s post-edit
- 5-day activity: 175 skip_session_cap, 171 verify_fail, 4 fixes_applied
- Audit phase: `audit_just_written.js` (4 rules inlined, <2s)
- Fix phase: `spawnFixer` Alt A → in-process `LOW_RISK_RULES.forEach()` (0.5-1s)
- Safety: 3-Layer Defense + per-file budget + session cap + atomic write + pre-fix snapshot
- Output: `.self_healing_loop.jsonl` (append-only, full audit trail)

### 4 rules duplicated
| Rule | CQM (LocalScanner) | SHL (audit_just_written) | Note |
|------|--------------------|-----------------------------|------|
| `fsSync_missing_trycatch` | ✅ (in auditOrchestrator) | ✅ (24 lines inlined) | 不同 detection logic |
| `magic_numbers` | ✅ + 15-pattern WHITELIST | ✅ + 冇 whitelist | CQM 少啲 false positive |
| `simplified_chinese` | ✅ (in low-risk.js char map) | ✅ (44-char inline) | 兩套 char sets |
| `todo_fixme` | ✅ (in low-risk.js) | ✅ (inlined) | 兩套 regex |

### Already shared
- `scripts/lib/rules/low-risk.js` `LOW_RISK_RULES` — CQM (via auto_fix.js exec) + SHL (via createRequire) 已經共用同一個 rule registry
- `atomicWriteSync` — 兩者都 implementation 喺 `scripts/lib/config.js`，SHL 嘅 inline 版本 (line 341-350) 係 workaround

## Plan (Option B — Shared LocalScanner)

### Step 1: Extract LocalScanner
- [ ] Create `scripts/lib/localScanner.js` (new standalone module)
- [ ] Move 4 rule implementations from `auditOrchestrator.js` LocalScanner + `audit_just_written.js` to single source
- [ ] Include `WHITELIST_CONTEXTS` (15 patterns) in shared module
- [ ] Standardize output format: `{ rule, line, severity, msg, file }`
- [ ] Standardize path normalization (use absolute paths, no `scripts/lib/` vs `scripts/` mismatch)

### Step 2: Refactor CQM
- [ ] `AuditOrchestrator` imports from `localScanner.js`
- [ ] `auditOrchestrator.js` keeps 3-scanner orchestration logic (Local/AI/Error) but delegates Local to shared module
- [ ] Test: `node scripts/code_quality_manager.js scan --files test.js` produces same output as before

### Step 3: Refactor SHL
- [ ] `audit_just_written.js` imports from `localScanner.js`
- [ ] Remove 4 inlined scanner functions (lines 85-240)
- [ ] Replace with single `auditFile(filePath)` call to shared module
- [ ] Test: `node scripts/audit_just_written.js /tmp/test.js` produces same output as before

### Step 4: Verify + cleanup
- [ ] Both triggers still work: CQM cron 1x/日 + SHL real-time hook
- [ ] No false positive regression: today's 30 magic_numbers issues should be ≤30 (ideally 0 with WHITELIST extension)
- [ ] No P0 detection regression: 19 fsSync issues still detected
- [ ] Path normalization: `.tmp_*`, `tmp_*`, `_archive/*` properly excluded or normalized
- [ ] Update #162 M-status when done

## Success criteria

- [ ] `scripts/lib/localScanner.js` exists as single source of truth
- [ ] Both CQM and SHL use shared module
- [ ] CQM cron output: same shape, same or fewer false positives
- [ ] SHL audit_just_written: same shape, same or fewer false positives
- [ ] No behavior regression in either trigger path
- [ ] Code reduction: net -150 lines (currently 4 rules × 2 implementations = 8, target 4)

## Effort estimate

- 4-6 hours (depending on test coverage)
- Risk: Medium (both systems have different integration points, need careful refactor)
- Reward: -150 lines, consistent rule output, single maintenance point

## Why P3 / backlog (not active)

- SHL 5-day observation period 進行中 (2026-06-20 → 2026-06-25)
- CQM 7-day noise observation 進行中 (2026-06-20 → 2026-06-27)
- 改 scanner 可能 impact 兩個 system 嘅 daily output
- 等 obs period 完先郁，pure refactor, 唔 urgent

## Why Option B (not other merge options)

- **Option A (Light integration)**: 1-2h, value too low (冇真正 unify rule logic)
- **Option C (Unified queue)**: 8-12h, race condition risk (CQM background + SHL foreground 同時改 file)
- **Option D (CQM→SHL handoff)**: 3-5h, 會 trigger SHL session cap (1/session) → 大量 file 漏 fix
- **Option E (Full merge)**: 20+h, very high risk during obs period
- **Option B (Shared LocalScanner)**: 4-6h, pure de-dup, no behavior change ← **selected**

## Notes

- 3 dangling risks (per analysis 2026-06-20) 都係 CQM 問題:
  - magic_numbers 30 false positives/日 (will reduce after Option B)
  - fsSync 19/日 stuck accumulation (唔受 Option B 影響, 需要 escalation path separately)
  - SHL coverage gap (唔受 Option B 影響, 唔係 rule logic 問題)
- 7 gaps 確認 (per analysis 2026-06-20):
  - Gap 1 (path normalization): Option B partial fix
  - Gap 2 (test file filter): 唔屬於 Option B 範圍, 分開 issue
  - Gap 3 (magic_numbers whitelist): Option B partial fix (extend WHITELIST)
  - Gap 4-7: 唔屬於 Option B 範圍

## Source-of-truth references

- CQM: `scripts/code_quality_manager.js` (1367 lines), `scripts/lib/auditOrchestrator.js` (977 lines)
- SHL: `extensions/self-healing-loop/index.mjs` (1110 lines), `scripts/audit_just_written.js` (328 lines)
- Already shared: `scripts/lib/rules/low-risk.js` (536 lines, `LOW_RISK_RULES` registry)
- Today's CQM report: `.state/code_quality_report.json` (49 issues, 30 magic_numbers noise)
- 5-day SHL telemetry: `.self_healing_loop.jsonl`

## Status

- **2026-06-20**: Created (P3, backlog), due 2026-06-30 (post-obs)
- **TBD**: Activate after obs period 完 (2026-06-25 / 2026-06-27)
- **Blocked on**: CQM 7-day noise obs + SHL 5-day obs complete
