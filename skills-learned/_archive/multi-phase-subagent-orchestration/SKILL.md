---
name: multi-phase-subagent-orchestration
description: Spawn sequential multi-phase sub-agents — analysis sub-agent, then fix sub-agent — with result coordination and status reporting
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T15:32:56.557Z
---

## Workflow

1. **定義任務類型**
   - 如果任務需要「研究 → 執行」，使用 sequential multi-phase
   - Phase 1：深度分析/research（不修改任何檔案）
   - Phase 2：基於 Phase 1 結果執行修復/實現

2. **Spawn Phase 1 Sub-agent**
   ```javascript
   await ss.sessions_spawn({
     prompt: '<detailed research task>',
     model: 'MiniMax-M3',
     spawnConfig: {
       default: { model: 'MiniMax/MiniMax-Text-01' }
     }
   });
