```skills-learned/cron-context-overflow-recovery/SKILL.md
---
name: cron-context-overflow-recovery
description: 診斷並修復 OpenClaw cron agentTurn 會話因累積對話歷史溢出而完全失效的問題
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T10:18:14.436Z
---

## 背景

OpenClaw cron jobs 在 `agentTurn` / `isolated` 模式下運行時，會話狀態（conversation history）會在每次執行後累積。經過多輪對話後，prompt 總 token 數可能超過模型的上下文窗口限制，導致 precheck 階段直接失敗：
