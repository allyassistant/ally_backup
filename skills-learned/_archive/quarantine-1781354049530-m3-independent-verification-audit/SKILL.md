---
name: m3-independent-verification-audit
description: Spawn MiniMax M3 sub-agent 執行獨立驗證審計，系統性交叉檢查初始分析 claims，發現被低估或隱藏嘅問題。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T12:32:25.684Z
---

## Workflow

### Trigger Condition
當用戶提出以下情况之一時，主動建議或執行獨立驗證審計：
- 自己嘅分析涉及多個組件狀態分類（哪些 work、哪些 fail）
- 用戶對分析結果表示懷疑或要求確認
- 發現 systematic drift 或 hidden failure 跡象（例如 flaky-ok、交替 timeout/ok、silent no-op）
- 涉及 migration 或 migration 後健康檢查

### Step 1: 確認審計範圍

與用戶確認審計目標，例如：
- 「你想我 spawn M3 獨立審計 sessionKey cleanup crons？」
- 「會用 `cron runs` 攞每個 cron 嘅 last 5-10 runs 實際 history，唔係靠 claim 直接答」

清晰表達 sub-agent 會做什麼、不會做什麼（例如唔會 busy-poll、等 sub-agent auto-announce）。

### Step 2: Spawn M3 Sub-agent

使用 `sessions_spawn` 工具 spawn MiniMax M3 sub-agent，傳遞完整 context：
