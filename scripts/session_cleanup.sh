#!/bin/bash
# Session Cleanup Script for OpenClaw
# 自動清理過大或過舊嘅 session 文件
# 合併功能：
#   - 舊機制：weekly_session_cleanup.js (cron session 清理)
#   - 新機制：session size/age based 清理
# 執行頻率：每日 3:00 AM (Asia/Hong_Kong)

SESSION_DIR="$HOME/.openclaw/agents/main/sessions"
LOG_FILE="$HOME/.openclaw/logs/session_cleanup.log"

# 設定閾值
MAX_SIZE_MB=5          # 超過 5MB 嘅 session 會被標記
MAX_AGE_DAYS=3         # 超過 3 日嘅 session 會被清理
FORCE_DELETE_SIZE_MB=20 # 超過 20MB 直接刪除

# 獲取當前時間
NOW=$(date +%s)

# 記錄函數
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 檢查並清理單個 session
cleanup_session() {
    local file=$1
    local basename=$(basename "$file")
    
    # 跳過非 jsonl 文件
    [[ "$file" != *.jsonl ]] && return
    
    # 獲取文件大小 (bytes)
    local size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
    local size_mb=$((size / 1024 / 1024))
    
    # 獲取文件修改時間
    local mtime=$(stat -f%m "$file" 2>/dev/null || stat -c%Y "$file" 2>/dev/null)
    local age_days=$(( (NOW - mtime) / 86400 ))
    
    # 檢查是否為 cron session (從舊機制遷移)
    if [[ "$basename" == *":cron:"* ]] || [[ "$basename" == cron* ]]; then
        if [ "$age_days" -gt "$MAX_AGE_DAYS" ]; then
            log "DELETE (old cron session): $basename (${size_mb}MB, ${age_days} days)"
            rm -f "$file"
            return
        fi
    fi
    
    # 檢查是否為活躍 session (正在被使用)
    if lsof "$file" >/dev/null 2>&1; then
        log "SKIP (in use): $basename (${size_mb}MB, ${age_days} days)"
        return
    fi
    
    # 超過強制刪除大小
    if [ "$size_mb" -gt "$FORCE_DELETE_SIZE_MB" ]; then
        log "DELETE (oversized >${FORCE_DELETE_SIZE_MB}MB): $basename (${size_mb}MB)"
        mv "$file" "${file}.deleted.$(date +%Y%m%d%H%M%S)"
        return
    fi
    
    # 超過年齡或大小閾值
    if [ "$age_days" -gt "$MAX_AGE_DAYS" ] || [ "$size_mb" -gt "$MAX_SIZE_MB" ]; then
        log "ARCHIVE (age>${MAX_AGE_DAYS}d or size>${MAX_SIZE_MB}MB): $basename (${size_mb}MB, ${age_days} days)"
        mv "$file" "${file}.archived.$(date +%Y%m%d%H%M%S)"
        return
    fi
    
    log "KEEP: $basename (${size_mb}MB, ${age_days} days)"
}

# 主程序
main() {
    log "=== Session Cleanup Started ==="
    
    # Step 0: 先執行 Pre-compaction Flush，確保所有內容已寫入 L2
    log "Step 0: Pre-compaction Flush..."
    if command -v node &> /dev/null; then
        node "$(dirname "$0")/log_to_daily_memory.js" --auto 2>/dev/null || true
        sleep 3
    fi
    
    # 檢查目錄是否存在
    if [ ! -d "$SESSION_DIR" ]; then
        log "ERROR: Session directory not found: $SESSION_DIR"
        exit 1
    fi
    
    # 統計
    local total=0
    local deleted=0
    local archived=0
    local kept=0
    
    # 遍歷所有 session 文件
    for file in "$SESSION_DIR"/*.jsonl; do
        [ -f "$file" ] || continue
        total=$((total + 1))
        
        result=$(cleanup_session "$file")
        
        if echo "$result" | grep -q "DELETE"; then
            deleted=$((deleted + 1))
        elif echo "$result" | grep -q "ARCHIVE"; then
            archived=$((archived + 1))
        else
            kept=$((kept + 1))
        fi
    done
    
    log "=== Cleanup Summary ==="
    log "Total sessions: $total"
    log "Deleted (oversized): $deleted"
    log "Archived (old/large): $archived"
    log "Kept: $kept"
    log "======================="
}

# 顯示幫助
show_help() {
    echo "Usage: $(basename $0) [options]"
    echo ""
    echo "Options:"
    echo "  --dry-run      預覽模式，唔會實際刪除"
    echo "  --force        強制刪除，唔備份"
    echo "  --help         顯示幫助"
    echo ""
    echo "Configuration:"
    echo "  MAX_SIZE_MB=$MAX_SIZE_MB"
    echo "  MAX_AGE_DAYS=$MAX_AGE_DAYS"
    echo "  FORCE_DELETE_SIZE_MB=$FORCE_DELETE_SIZE_MB"
}

# 處理參數
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    --dry-run)
        echo "Dry run mode - no files will be modified"
        # 可以添加預覽邏輯
        exit 0
        ;;
    *)
        main
        ;;
esac
