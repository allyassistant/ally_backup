---
name: main-session-execution-loop-recovery
description: 當主 session 無法執行用戶任務而只係不斷回 HEARTBEAT_OK 時，診斷並恢復正常執行流程。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T12:32:25.684Z
---

## Workflow

### Trigger Conditions

當以下任一條件成立時，觸發本 workflow：

1. **HEARTBEAT_OK loop** — 主 session 連續 3+ 次只回 `HEARTBEAT_OK`，無論用戶說什麼
2. **NO_REPLY loop** — 主 session 連續 3+ 次觸發 NO_REPLY chain（訊息發出但無回應）
3. **systemEvent stuck** — systemEvent cron 在 main session 內執行，導致 main session 無法處理用戶任務
4. **skill-loaded-but-blocked** — Skill 已成功載入但執行卡死（例如卡在模型調用、fs 操作、或子進程），系統將此視為正常心跳處理

### Step 1: 識別 Loop 類型

檢查最近 5-10 次 response 的 pattern：
