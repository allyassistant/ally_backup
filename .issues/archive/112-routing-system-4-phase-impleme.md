---
id: 112
title: Routing System — 4-Phase Implementation
status: archive
priority: P1
created: 2026-05-20
due: 2026-06-01
updated: 2026-06-04
progress: 4/4
---

## 現狀（2026-05-20 完成後評估）

### Keep（日常有用）
- `classifier.js` — Tool Decision Tree code-ified，每次 message 做 regex classify 做 reference
- `decision_logger.js` — 手動記錄 routing decision，accumulate data
- `report.js` — 睇 routing distribution dashboard
- `email_router.js` — Cost-aware email routing，慳 token cost
- `config.js` — 基礎 config

### Prune（暫 idle，等 data 累積）
- `model_router.js` — Per-message model switch OpenClaw 做唔到，等日後
- `failure_recovery.js` — 未有足夠 data
- `auto_corrector.js` — 未有足夠 decision log
- `rule_adjuster.js` — 未有 feedback data
- `router_agent_study.md` — Study done，conclusion known

### 已知限制
- OpenClaw internal hook system 唔 support custom scripts → message_received hook 無法自動 fire
- Decision logging 要靠手動 call `decision_logger.js`（~5s per message）
- Data 唔會 100% complete，但有好過冇
- LLM classify 用 direct MiniMax API（~3.7s），只 fallback path 用

### 決策
- 繼續用，接受手動 logging 嘅 trade-off
- Prune 嘅 files keep 喺 repo 但唔 active
- Week 1 後睇 `report.js --days 7` 評估價值
---

## 目的

將 AGENTS.md 嘅 Tool Decision Tree 代碼化，建立 systemized routing layer，令 routing decision visible / auditable / improvable。

## 背景

參考 Aomyying 嘅 X 長文《Agentic Design Patterns》第二章 Routing：
- 真實世界唔係流水線，AI 需要「看情況辦事」嘅能力
- 四種路由方法（LLM/Embedding/規則/專用模型）
- 顯式（LangChain）vs 隱式（Google ADK）路由
- 靈魂拷問：AI 係工人定同事？

## 系統架構

```
Message ─────────────────────────────────────────────┐
   │                                                   │
   ├─ message_received.js hook ───────────────────┐   │
   │   ├─ auto_remember (unchanged)               │   │
   │   └─ router.classifier ──────────────────┐   │   │
   │       ├─ regex fast path (1ms) ── hit ─→ │   │   │
   │       └─ LLM slow path (~8s) ── miss ─→ SPAWN │   │
   │                                  └──────┘   │   │
   │               │                              │   │
   │               ▼                              │   │
   │        model_router.js                       │   │
   │        (route → model mapping)               │   │
   │               │                              │   │
   │               ▼                              │   │
   │        decision_log.jsonl (append-only)      │   │
   └──────────────────────────────────────────────┘   │
                                                       │
Feedback:                                              │
  feedback_collector.js ──→ feedback_log.jsonl         │
                                                       │
Dashboard:                                             │
  report.js --days 7 ──→ 📊 ANSI report                │
                                                       │
Email:                                                 │
  email_router.js ──→ cost-aware model selection       │
                                                       │
Recovery:                                              │
  failure_recovery.js ──→ misroute + auto fallback     │
                                                       │
Router Agent:                                          │
  router_agent_study.md ──→ ✋ Not recommended now      │
└──────────────────────────────────────────────────────┘
```

## 實作摘要

### Phase 0 — Core Infrastructure (✅ 完成)

| File | 用途 | 狀態 |
|------|------|------|
| `scripts/router/classifier.js` | regex 7 rules（AGENTS.md Tool Decision Tree code-ify） | ✅ |
| `scripts/router/config.js` | paths + feature flags | ✅ |
| `scripts/hooks/message_received.js` | 原有 auto_remember 保留，新加 routing log | ✅ |
| `AGENTS.md` | Router System reference added | ✅ |
| `scripts/router/feedback_collector.js` | CLI + Module 記錄 routing correction | ✅ |

### Phase 1 — LLM Intent Classifier + Model Router (✅ 完成)

| File | 用途 | 狀態 |
|------|------|------|
| `classifier.js` | Hybrid: regex fast path (~1ms) → LLM slow path (~8s) → SPAWN fallback | ✅ |
| `model_router.js` | Route → Model mapping（8 routes, cost-quality weighted） | ✅ |
| `report.js` | Decision dashboard（`node report.js --days 7`） | ✅ |
| `feedback_collector.js` | 加 `--summary` + `--auto-fix` batch 功能 | ✅ |

### Phase 2 — Email + Recovery + Study (✅ 完成)

| File | 用途 | 狀態 |
|------|------|------|
| `email_router.js` | Cost-aware email routing（6 email types, 3 cost tiers） | ✅ |
| `failure_recovery.js` | Misroute detection + auto fallback + stats | ✅ |
| `router_agent_study.md` | Router Agent 可行性研究（結論：暫時唔建議做） | ✅ |

### 用家操作指南

| 你想做咩 | Command |
|----------|---------|
| 記錄 routing correction | `node scripts/router/feedback_collector.js --wrong FDQ --correct SPAWN --reason "..."` |
| 睇 routing 報告 | `node scripts/router/report.js --days 7` |
| 測試 email routing | `node scripts/router/email_router.js --subject "Rapaport Report" --verbose` |
| 睇 failure recovery stat | `node scripts/router/failure_recovery.js --stats` |

### TODO（Phase 1.5 — 低優先度）

- **LLM classify latency** (~8s)：因為 `openclaw agent --agent main` 每次 load 64K system prompt
  - 改善方向：改用 direct MiniMax anthropic API call（需要處理 API key 安全問題）
  - 實際影響有限：LLM path 只行 regex miss (~20% messages)

## 測試結果

E2E: 8/8 All Pass ✅

| # | Test | Result |
|---|------|--------|
| 1 | Regex classifier | ✅ 10/10 |
| 2 | LLM async classifier | ✅ 3/3 |
| 3 | Model router | ✅ 8/8 |
| 4 | Decision logging | ✅ 4/4 |
| 5 | Feedback collector | ✅ 4/4 |
| 6 | Email router | ✅ 6/6 |
| 7 | Failure recovery | ✅ 3/3 |
| 8 | Report dashboard | ✅ 4 decisions, 3 routes |

## Links

- X 原文: https://x.com/aomyying/status/2056979844362375555
- `scripts/router/` — 所有 routing code
- `scripts/hooks/message_received.js` — 更新咗嘅 hook
- `AGENTS.md` — Router System reference

---

*Created: 2026-05-20 | Progress: 4/4 Phases Complete*

### 2026-05-20 最新決策
- LLM latency 3.7s deemed acceptable by Josh（only ~20% messages affected, async fire-and-forget）
- No further latency optimization needed
- Priority: collect data for 1-2 weeks, then evaluate
- System running as-is until week 1 review
