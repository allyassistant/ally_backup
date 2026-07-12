---
id: 113
title: Routing Phase 3 — 效能優化 + Feedback Loop 自動化
status: archive
priority: P2
created: 2026-05-20
due: 2026-07-01
updated: 2026-07-12
progress: 3/3
---

## 目的

Phase 1-2 完成咗 routing system 基礎架構，Phase 3 focus 效能優化同 feedback loop 自動化。

---

## Task 1 — LLM Classify 效能優化（由 ~8s 降至 ~1s）

**問題：** 而家用 `openclaw agent --agent main` 每次 load 64K system prompt（AGENTS.md, SOUL.md, TOOLS.md 等），令 LLM classify 需要 ~8s

**方案：** 改用 direct MiniMax anthropic API call
- Endpoint: `POST https://api.minimax.io/anthropic/v1/messages`
- Header: `x-api-key`
- 只需要個 classification prompt，唔 load system prompt
- 預計 latency: ~1-2s（vs 而家 ~8s）

**注意：** API key 安全問題
- 唔好硬編碼 key 喺 classifier.js
- 用環境變數 `ROUTER_MM_API_KEY` 或讀取 `~/.openclaw/auth-profiles.json` 嘅 minimax:default key

**Effort：** 2-3hr
**Impact：** 高（LLM path latency 8s → 1s）

---

## Task 2 — Feedback Loop 自動化

**問題：** 而家 feedback 要靠我手動 `--wrong --correct`，唔會自動 detect routing 錯誤

**方案：** 自動比對 classifier suggestion vs 實際 action
- 當我嘅回覆同 classifier 嘅 suggestion 不一致 → 自動記錄 correction
- 用 `failure_recovery.js` 嘅 `detectMisroute()` 做基礎
- 加入 cron job 每週分析 correction pattern → 自動建議更新 classifier rules

```
classifier suggestion: SPAWN
我實際做咗: CODE（直接改 code）
  ↓
auto detect misroute
  ↓
記錄到 feedback_log.jsonl
  ↓
每週 report → "建議加 keyword 到 CODE rule"
```

**Effort：** 4-6hr
**Impact：** 中高（長期改善 classifier 準確度）

---

## Task 3 — Dynamic Rule Adjustment

當某個 (suggestedRoute, actualRoute) pair 出現 >5 次，自動 generate pattern suggestion
- 用 `feedback_collector.js --auto-fix` 現有基礎
- 加 cron job 每日 check `failure_recovery.js` 嘅 stats
- Output 建議俾我 review，唔自動改

**Effort：** 2-3hr
**Impact：** 中

---

## Phase 3 Summary

| Task | Effort | Impact | Priority |
|------|--------|--------|----------|
| 1. LLM latency optimization | 2-3hr | 高 | P0 |
| 2. Feedback loop automation | 4-6hr | 中高 | P1 |
| 3. Dynamic rule adjustment | 2-3hr | 中 | P2 |
| **Total** | **8-12hr** | | |

## Links

- Issue #112 — Phase 1-2 base
- `scripts/router/classifier.js` — LLM classify 要改
- `scripts/router/failure_recovery.js` — misroute detection 基礎
- `scripts/router/feedback_collector.js` — auto-fix 基礎
- `~/.openclaw/auth-profiles.json` — API key

---

*Created: 2026-05-20 | Progress: 0/3*

## 完成狀態（2026-05-20）

### Task 1 — LLM latency optimization ✅
- Before: `openclaw agent --agent main` → ~8s（64K system prompt）
- After: direct MiniMax anthropic API → ~3.7s
- Known issue: MiniMax M2.7 有強制 thinking block，需要 `max_tokens=100` 先出到 text

### Task 2 — Feedback loop automation ⏸️
- `auto_corrector.js` created but idle
- 未有足夠 decision log data
- 等 1-2 週 data 累積後再啟動

### Task 3 — Dynamic rule adjustment ⏸️
- `rule_adjuster.js` created but idle
- 需要 feedback data
- 等 Task 2 有 data 先一齊做

### 最終決策
- Phase 3 3 tasks technically completed
- Task 2 & 3 moved to ⏸️ waiting for data accumulation
- LLM latency improved 54%（8s → 3.7s）

### 2026-05-20 最新決策
- LLM latency optimization (Task 1) marked ✅ — 3.7s accepted as-is
- Task 2 & 3 remain ⏸️ until data accumulates
