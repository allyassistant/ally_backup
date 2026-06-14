---
id: 156
title: Daily Synthesis Timeout Fix — 觀察 timeoutSeconds 300s 效果
status: active
priority: P2
created: 2026-06-12
due: 2026-06-15
updated: 2026-06-12
progress: 0/3
---

## F - Facts（事實）

### 現況
Daily Synthesis cron（08:00 HKT, isolated agentTurn）原本 timeoutSeconds: 30，導致連續 4 日出現 "last phase: model-call-started" timeout（詳細見 M3 root cause analysis）。同類 cron（CQM@10:00、Daily Summary@23:59）用 300s 從未 timeout。

2026-06-12 10:26 已執行 Fix 1：`timeoutSeconds: 30 → 300`，同其他 working crons 睇齊。

### 數據/證據
| 項目 | 值 |
|------|-----|
| cron ID | `3c11c009-ac02-4ead-8b61-646af5e46408` |
| 原 timeout | 30s 🔴 |
| 新 timeout | 300s ✅ |
| 成功 runs 平均時長 | 6-13s |
| 失敗 runs 時長 | 30s（全部係 model call 階段 timeout） |
| consecutiveErrors at fix | 4 |
| 與 CQM/Daily Summary 比較 | 完全相同 config，唯一差異係 timeout |

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-12] Fix 1 applied: 加大 timeoutSeconds 由 30 → 300（同 CQM/Daily Summary 睇齊）
- Fix 2 (轉 systemEvent) 同 Fix 3 (改 09:00/10:00) 保留備用 — 只係 timeout issue 未必要架構改動

### ⏳ 待做決定
- 觀察 3 日後（due: 2026-06-15）決定 close / 延長觀察 / 執行 Fix 2/3

## Q - Questions（未解決）

### ❓ 核心問題
1. timeout 增加到 300s 後，Daily Synthesis 08:00 run 係咪每次都成功？
2. 成功 run 嘅 duration 係 6-13s 定會因為 cold start 而拉長？
3. 需唔需要考慮 Fix 2（轉 systemEvent）去徹底繞過 LLM call 呢步？

### 🔍 追問（蘇格拉底反詰）
- 點解原本 nightly cron migration 時 set 咗 30s 而唔係 300s？可能係 oversight / copy-paste error
- AgentTurn 做 pure exec script 其實係 overhead — 每次都要等 LLM 解釋「run 呢個 command」，但 script 自己明明係 thin executor
- SKILL.md 話「Do NOT schedule at 08:00 HKT」— 係因為 L0/L1 timing 定因為 API peak hour？

## Progress

### Day 1 — 2026-06-13 (Sat)
- [ ] Check cron runs: `openclaw cron runs --id 3c11c009 --limit 5`
- [ ] Verify consecutiveErrors reset to 0
- [ ] Record duration + success/fail

### Day 2 — 2026-06-14 (Sun)
- [ ] Check 08:00 run result
- [ ] Record 2-day trend

### Day 3 — 2026-06-15 (Mon) — Closing Day
- [ ] Final check: 3/3 success rate?
- [ ] Apply closing criteria below
- [ ] Close or escalate

## Closing Criteria

```
✅ PASS: 3/3 日全部成功 → Close issue
🟡 PARTIAL: 2/3 成功，1 次 timeout → 延長觀察 3 日
🟠 NEEDS MORE: 1/3 成功，2 次 timeout → 執行 Fix 2 (systemEvent)
🔴 REGRESSION: 0/3 成功 → 即行 Fix 2 (systemEvent) + 通知 Josh
```

## Notes

**M3 Root Cause Summary:**
- 根本原因：`timeoutSeconds: 30` 太短，agentTurn 冷啟動（bootstrap + first LLM call）需時 26-47s
- 同類 cron（CQM、Daily Summary）用 300s 從未出事
- Script 本身係 thin executor（789 lines, no LLM），<5s 就 run 完
- Jun 12 惡化原因：某人/某工具將 timeout 由 120s 改咗做 30s

**Cross-references:**
- cron ID: `3c11c009-ac02-4ead-8b61-646af5e46408`
- Script: `scripts/daily_synthesis.js`
- Skill: `skills/_learned_daily-synthesis/SKILL.md`
- HEARTBEAT.md (#14 @ 08:00)
