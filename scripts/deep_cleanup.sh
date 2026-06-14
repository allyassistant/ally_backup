#!/bin/bash
#
# Deep Cleanup Script (Enhanced Version)
# 綜合清理：Media + Browser + Logs + Sessions + Old Backups
#
# 改動 (2026-03-20):
# - 加入 Browser 緩存清理
# - 加入 Agents 會話清理
# - 加入 Logs 截斷
# - 加入舊備份檢查
# - 保留安全檢查機制

set -euo pipefail

# 記錄開始時間
START_TIME=$(date +%s)
START_DATE=$(date '+%Y-%m-%d %H:%M:%S')

# 計數器
TOTAL_DELETED=0
TOTAL_SAVED=0

echo "🧹 Deep Cleanup Script - Enhanced"
echo "=================================="
echo "⏱️  開始時間: $START_DATE"
echo ""

# 函數：安全刪除文件
cleanup_files() {
    local dir="$1"
    local days="$2"
    local desc="$3"

    if [ -d "$dir" ]; then
        count=$(find "$dir" -type f -mtime "$days" 2>/dev/null | wc -l)
        if [ "$count" -gt 0 ]; then
            size=$(find "$dir" -type f -mtime "$days" -exec du -sk {} + 2>/dev/null | awk '{sum+=$1} END {print sum}')
            find "$dir" -type f -mtime "$days" -delete 2>/dev/null
            echo "   ✓ $desc: $count 個檔案 (~$((size/1024)) MB)"
            TOTAL_DELETED=$((TOTAL_DELETED + count))
            TOTAL_SAVED=$((TOTAL_SAVED + size))
        else
            echo "   ○ $desc: 無需清理"
        fi
    fi
}

echo "1️⃣  清理 Browser 緩存..."
if [ -d "$HOME/.openclaw/browser" ]; then
    BROWSER_BEFORE=$(du -sk "$HOME/.openclaw/browser" 2>/dev/null | cut -f1 || echo "0")
    find "$HOME/.openclaw/browser" -name "Cache" -type d -exec rm -rf {} + 2>/dev/null || true
    find "$HOME/.openclaw/browser" -name "Code Cache" -type d -exec rm -rf {} + 2>/dev/null || true
    find "$HOME/.openclaw/browser" -name "*.cache" -delete 2>/dev/null || true
    find "$HOME/.openclaw/browser" -name "GPUCache" -type d -exec rm -rf {} + 2>/dev/null || true
    BROWSER_AFTER=$(du -sk "$HOME/.openclaw/browser" 2>/dev/null | cut -f1 || echo "0")
    BROWSER_SAVED=$((BROWSER_BEFORE - BROWSER_AFTER))
else
    BROWSER_SAVED=0
fi
TOTAL_SAVED=$((TOTAL_SAVED + BROWSER_SAVED))
echo "   ✓ Browser 緩存已清理 (~$((BROWSER_SAVED/1024)) MB)"
echo ""

echo "2️⃣  清理 Media 文件..."
cleanup_files "$HOME/.openclaw/media/outbound" "+7" "Media Outbound (>7天)"
cleanup_files "$HOME/.openclaw/media/inbound" "+14" "Media Inbound (>14天)"
echo ""

echo "3️⃣  清理 Agents 會話文件..."
cleanup_files "$HOME/.openclaw/agents" "+14" "Agents Sessions (>14天)"
echo ""

echo "4️⃣  清理日誌文件..."
# 截斷 gateway.log
if [ -f "$HOME/.openclaw/logs/gateway.log" ]; then
    LOG_SIZE=$(du -sk "$HOME/.openclaw/logs/gateway.log" 2>/dev/null | cut -f1)
    tail -n 1000 "$HOME/.openclaw/logs/gateway.log" > "$HOME/.openclaw/logs/gateway.log.tmp"
    mv "$HOME/.openclaw/logs/gateway.log.tmp" "$HOME/.openclaw/logs/gateway.log"
    NEW_SIZE=$(du -sk "$HOME/.openclaw/logs/gateway.log" 2>/dev/null | cut -f1)
    SAVED=$((LOG_SIZE - NEW_SIZE))
    echo "   ✓ gateway.log 已截斷至 1000 行 (~$((SAVED/1024)) MB)"
    TOTAL_SAVED=$((TOTAL_SAVED + SAVED))
fi
# 刪除舊日誌
cleanup_files "$HOME/.openclaw/logs" "+7" "舊日誌文件 (>7天)"
echo ""

echo "5️⃣  檢查舊備份..."
BACKUP_COUNT=$(find $HOME/.openclaw -maxdepth 1 -name "workspace-backup-*" -type d -mtime +7 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 0 ]; then
    echo "   ⚠️  發現 $BACKUP_COUNT 個超過 7 天既備份:"
    find $HOME/.openclaw -maxdepth 1 -name "workspace-backup-*" -type d -mtime +7 -exec du -sh {} \; 2>/dev/null | while read line; do
        echo "      $line"
    done
    echo "   💡 如需刪除，請手動執行: rm -rf ~/.openclaw/workspace-backup-YYYYMMDD"
else
    echo "   ○ 無需清理既舊備份"
fi
echo ""

echo "6️⃣  清理 Artifacts..."
if [ -d "$HOME/.openclaw/artifacts/temp" ]; then
    cleanup_files "$HOME/.openclaw/artifacts/temp" "+7" "Artifacts (>7天)"
else
    echo "   ○ Artifacts temp 目錄不存在"
fi
echo ""

# 7️⃣  清理 resolved issues (30天前)
echo "7️⃣  清理 resolved Issues (>30天)..."
cd "$HOME/.openclaw/workspace"
ISSUES_CLEANED=$(node scripts/issue_manager.js cleanup 7 2>/dev/null | grep -o '[0-9]*' | head -1 || echo "0")
echo "   已清理 $ISSUES_CLEANED 個舊 issues"
echo ""


# 計算執行時間
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# 輸出總結
echo "=================================="
echo "✅ 深度清理完成！"
echo "=================================="
echo ""
echo "📊 清理總結:"
echo "   執行時間: ${DURATION} 秒"
echo "   刪除檔案: $TOTAL_DELETED 個"
echo "   節省空間: ~$((TOTAL_SAVED / 1024)) MB (~$((TOTAL_SAVED / 1024 / 1024)) GB)"
echo ""
echo "💡 提示:"
echo "   • 重要檔案已保留 (L0/L1/L2, MEMORY.md, AGENTS.md)"
echo "   • 舊備份如需刪除，請手動確認"
echo "   • 建議每月執行一次深度清理"
echo ""
echo "⏱️  完成時間: $(date '+%Y-%m-%d %H:%M:%S')"

exit 0
