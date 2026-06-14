#!/bin/bash
# Qwen3 AutoOps - Quick Start
# 快速啟動所有自動化服務

echo "🚀 Qwen3 AutoOps 快速啟動"
echo "=========================="

# 檢查目錄
cd "$HOME/.openclaw/workspace"

# 創建必要的目錄
mkdir -p reports logs memory/auto-archives

# 執行各個監控腳本
echo ""
echo "📊 執行每日庫存監控..."
node scripts/autoops/daily_stock_monitor.js

echo ""
echo "💾 執行 Token 監控..."
node scripts/autoops/token_monitor.js

echo ""
echo "✅ 快速啟動完成!"
echo ""
echo "查看報告:"
echo "  - 庫存報告: ./reports/"
echo "  - 執行日誌: ./logs/autoops.log"
echo "  - 狀態: ./memory/heartbeat-state.json"
