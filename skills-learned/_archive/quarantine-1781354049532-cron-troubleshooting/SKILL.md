---
name: cron-troubleshooting
description: 診斷 cron job failure — 建 timeline、區分 provider/script/session 問題、手動 rerun 驗證、LLM failure mitigation。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T12:32:25.684Z
---

## Workflow

### Trigger Condition
當 cron job 失敗、超時、或表現異常（時好時壞、silent no-op）時，觸發本 workflow。

### Step 1: 建立 Timeline
