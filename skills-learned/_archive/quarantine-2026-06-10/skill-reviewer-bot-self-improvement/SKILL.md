---
name: skill-reviewer-bot-self-improvement
description: 系統性改進 skill_reviewer_bot 嘅工作流程——診斷失效模式、交叉驗證建議、避免傷害現有 thin skills。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T03:33:57.310Z
---

## Context

skill_reviewer_bot 喺 2026-06-10 生成咗 49 個 skills，其中 16 個係 Junk（33%）：
- 4 個 truncated（LLM output 截斷）
- 6 個重複/已覆蓋（Catalog 重複未被偵測）
- 6 個 Niche / 一次性（觸發頻率不足）

呢個 skill 係用嚟**日後避免再出現呢類問題**嘅工作流程。

---

## Workflow

### Phase A — 源代碼分析

1. **讀取 reviewer source code**
   ```bash
   ls ~/.openclaw/workspace/scripts/skill_reviewer*.js
   cat ~/.openclaw/workspace/scripts/skill_reviewer.js
   cat ~/.openclaw/workspace/scripts/skill_reviewer_bot.js
