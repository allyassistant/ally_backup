```skills-learned/cron-job-testing/SKILL.md
---
name: cron-job-testing
description: 系統性測試同調試 OpenClaw cron jobs — 包括 fallback 配置、queue 檢查、staggerMs timing 行為、delivery 配置、以及 error recovery
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T10:30:00.000Z
---

## Workflow

1. **收集原始狀態**
   先讀取 cron job 的完整 config，確認 `model`、`fallbacks`、`sessionTarget`、`payload.kind` 等關鍵欄位：
   ```bash
   openclaw cron list --json | jq '.[] | select(.id=="<cronId>")'
