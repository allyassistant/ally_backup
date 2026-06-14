---
id: 115
title: Enterprise Scalability — 多人對話 Routing 架構
status: active
priority: P3
created: 2026-05-20
due: 2026-08-01
updated: 2026-05-20
progress: 0/0
---

## 目的

Document 由「單人對話 → 大公司多人對話」嘅架構升級方案。
唔係而家要做，係 forward-looking 嘅 roadmap。

## 而家 vs 大公司對比

| Component | 而家（1 Josh） | 大公司（100+ employees） |
|-----------|---------------|------------------------|
| Message volume | ~100/日 | ~1000+/日 |
| Routing log | 手動 `decision_logger.js` ✅ | 必須 Plugin 自動化 |
| Priority | 全部一樣 | P0-CEO / P1-Manager / P2-General / P3-Batch |
| Session | 1 個 user | Per-employee session |
| Router Agent | 研究咗唔做 | 變必要（多人 multi-department） |
| Knowledge | MEMORY.md + AGENTS.md | 正式 RAG system（Issue #110） |
| Agent pool | 得我（Ally）1 個 | Multi-agent pool |

## 升級路線（如果要做）

### Phase 1 — Automation（必須）
- 方法 1（OpenClaw Plugin）代替手動 `decision_logger.js`
- 每條 message 自動 classify + route
- 唔可以靠人手 log

### Phase 2 — Priority Queue
```
P0: CEO / urgent (interrupt immediately)
P1: Manager (current task → handle)
P2: General employee (queue)
P3: Automated / batch notifications
```
- Multi-dimension routing：唔只 classify type，仲要 classify urgency
- 要加 queue system（Redis / Bull / 之類）

### Phase 3 — Multi-agent Pool
- 我（Ally）變成 one of many agents
- Router Agent（文章 concept）分配 task 俾最適合嘅 agent
- Auto-escalation：agent 搞唔掂 → 轉真人 CS / Engineer

### Phase 4 — Enterprise Infrastructure
- 方法 2（SSH Proxy）變合理
- Load balancer + Classifier proxy + Agent pool
- 正式 enterprise architecture

```
Discord → Load Balancer → SSH Proxy → Classifier → Priority Queue → Agent Pool
         (round-robin)    (routing)    (classify)    (queue)       (multi-agent)
```

## 觸發條件

呢個 issue 只係 doc，唔 active 做。當以下條件出現先考慮：
1. 每日 message volume > 500
2. 多個 departments 同事用
3. 需要 per-employee session context

## Links

- Issue #112 — Current routing system
- Issue #110 — Enterprise RAG plan
- Article: Aomyying Agentic Design Patterns Ch2 (Routing)

---

*Created: 2026-05-20 | Forward-looking, not actionable now*
