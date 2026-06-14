#!/bin/bash
# Auto-generated runner for Token 監控 (每30分鐘)
# Generated: 2026-02-10T04:31:05.948Z

cd "$HOME/.openclaw/workspace"

# 記錄開始時間
echo "[$(date)] Starting Token 監控 (每30分鐘)" >> "$HOME/.openclaw/workspace/logs/autoops.log"

# 執行腳本
node "$HOME/.openclaw/workspace/scripts/autoops/token_monitor.js" 2>> "$HOME/.openclaw/workspace/logs/autoops.log"

# 記錄完成
echo "[$(date)] Finished Token 監控 (每30分鐘)" >> "$HOME/.openclaw/workspace/logs/autoops.log"
