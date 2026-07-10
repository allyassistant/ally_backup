---
name: agent-memory-bus-pattern
description: 標準化 Agent 記憶總線的工作流程——用 infrastructure 層面嘅行為模式取代逐個 prompt，提升 Agent 嘅自主性同協作能力
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T18:01:09.367Z
---

## Workflow

1. **識別記憶痛點**
   - 評估目前每個 agent 係咪獨立運行、互相唔知對方做過咩
   - 確認 persistent state management 係咪現有瓶頸
   - 檢查 agent 之間有冇重複勞動或狀態丢失

2. **選擇記憶總線方案**
   - MemOS CLI：一行命令嘅記憶總線，適合標準化場景
   - 自建 shared memory store：適合定制化需求（如特定格式、access control）
   - 評估標準：init scripts 注入、事前檢索、事後記錄、跨 agent 共享

3. **設計 Init Script（事前自動檢索）**
   - 定義每個 agent 啟動時自動執行嘅檢索 query
   - 確保 agent 獲得相關上下文（如相關 issue 狀態、最近操作）
   - 避免向每個 agent 逐個注入 prompt

4. **設計 Memory Write（事後自動記錄）**
   - 定義每個 agent 完成操作後自動寫入嘅關鍵事件
   - 確保其他 agent 可以檢索到呢啲資訊
   - 格式標準化：timestamp、agent_id、action_type、result_summary

5. **驗證記憶流**
   - 測試：新 agent 啟動時能否正確檢索歷史
   - 測試：現有 agent 完成操作後能否正確寫入
   - 確認無單點故障——記憶總線本身嘅可用性

## Pitfalls

- **Infrastructure 唔係萬能**：記憶總線解決狀態共享問題，但唔解決 decision-making 問題。Agent 仍然需要明確嘅 stop condition
- **Init script 爆炸**：如果每個 agent 有太多 init queries，會拖慢啟動時間。需要優先級排序
- **記憶污染**：錯誤資訊一旦寫入記憶總線，會擴散到所有 agent。需要 validation layer
- **唔係 loop engineering 嘅替代品**：兩者係互補——記憶總線提供 shared context，loop engineering 提供 control structure
- **過度依賴**：如果記憶總線 downtime，所有 agent 都受影響。需要 fallback（如 local cache）
