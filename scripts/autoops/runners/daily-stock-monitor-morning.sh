#!/bin/bash
# Auto-generated runner for 每日庫存監控 (早晨)
# Generated: 2026-02-10T04:31:05.941Z

cd "$HOME/.openclaw/workspace"

# 記錄開始時間
echo "[$(date)] Starting 每日庫存監控 (早晨)" >> "$HOME/.openclaw/workspace/logs/autoops.log"

# 執行腳本
node "$HOME/.openclaw/workspace/scripts/autoops/daily_stock_monitor.js" 2>> "$HOME/.openclaw/workspace/logs/autoops.log"

# 記錄完成
echo "[$(date)] Finished 每日庫存監控 (早晨)" >> "$HOME/.openclaw/workspace/logs/autoops.log"
