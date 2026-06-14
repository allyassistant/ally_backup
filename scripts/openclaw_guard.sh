#!/bin/bash
# OpenClaw Backup & Rollback Script
# 用法: ./openclaw_guard.sh [backup|restore|status]

set -e

REPO_DIR="$HOME/.openclaw/workspace"
BACKUP_DIR="$REPO_DIR/.backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="openclaw_backup_$TIMESTAMP"

color_green() { echo -e "\033[0;32m$1\033[0m"; }
color_red() { echo -e "\033[0;31m$1\033[0m"; }
color_yellow() { echo -e "\033[0;33m$1\033[0m"; }

# 顯示狀態
show_status() {
    echo "=== OpenClaw Guard 狀態 ==="
    
    # 檢查 OpenClaw 進程
    if pgrep -f "openclaw" > /dev/null; then
        color_green "✅ OpenClaw 進程運行中"
    else
        color_red "❌ OpenClaw 進程未運行"
    fi
    
    # 檢查備份
    if [ -d "$BACKUP_DIR" ]; then
        local backup_count=$(ls -1 "$BACKUP_DIR" 2>/dev/null | wc -l)
        echo "📦 備份數量: $backup_count"
        
        # 顯示最近5個備份
        if [ $backup_count -gt 0 ]; then
            echo ""
            echo "最近備份:"
            ls -lt "$BACKUP_DIR" | head -6 | tail -5 | awk '{print "  " $6, $7, $8, $9}'
        fi
    else
        color_yellow "⚠️  未有備份"
    fi
}

# 創建備份
create_backup() {
    echo "📸 創建備份..."
    
    mkdir -p "$BACKUP_DIR"
    
    local backup_path="$BACKUP_DIR/$BACKUP_NAME"
    mkdir -p "$backup_path"
    
    # 備份關鍵文件
    echo "  備份中..."
    
    # 1. 備份 Git repo
    if [ -d "$REPO_DIR/.git" ]; then
        cp -r "$REPO_DIR/.git" "$backup_path/"
    fi
    
    # 2. 備份重要配置文件
    for file in MEMORY.md AGENTS.md USER.md TOOLS.md HEARTBEAT.md; do
        if [ -f "$REPO_DIR/$file" ]; then
            cp "$REPO_DIR/$file" "$backup_path/"
        fi
    done
    
    # 3. 備份 scripts 目錄
    if [ -d "$REPO_DIR/scripts" ]; then
        cp -r "$REPO_DIR/scripts" "$backup_path/"
    fi
    
    # 4. 備份 memory 目錄
    if [ -d "$REPO_DIR/memory" ]; then
        cp -r "$REPO_DIR/memory" "$backup_path/"
    fi
    
    # 5. 備份 public 目錄（如果有網站文件）
    if [ -d "$REPO_DIR/public" ]; then
        cp -r "$REPO_DIR/public" "$backup_path/"
    fi
    
    # 6. 記錄版本信息
    cat > "$backup_path/backup_info.txt" << EOF
Backup created: $(date)
OpenClaw version: $(openclaw --version 2>/dev/null || echo "unknown")
Git commit: $(cd $REPO_DIR && git rev-parse --short HEAD 2>/dev/null || echo "N/A")
Node version: $(node --version 2>/dev/null || echo "unknown")
EOF
    
    # 壓縮備份
    cd "$BACKUP_DIR"
    tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"
    rm -rf "$BACKUP_NAME"
    
    color_green "✅ 備份完成: ${BACKUP_NAME}.tar.gz"
    
    # 清理舊備份（保留最近10個）
    cleanup_old_backups
}

# 清理舊備份
cleanup_old_backups() {
    local count=$(ls -1 "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l)
    if [ $count -gt 10 ]; then
        echo "🧹 清理舊備份（保留最近10個）..."
        ls -t "$BACKUP_DIR"/*.tar.gz | tail -n +11 | xargs rm -f
    fi
}

# 還原備份
restore_backup() {
    echo "📂 可用備份:"
    
    if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
        color_red "❌ 沒有可用備份"
        exit 1
    fi
    
    # 列出備份
    local i=1
    declare -a backups
    for backup in $(ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null); do
        local name=$(basename "$backup" .tar.gz)
        local size=$(du -h "$backup" | cut -f1)
        local date=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$backup" 2>/dev/null || stat -c "%y" "$backup" 2>/dev/null | cut -d' ' -f1,2 | cut -d'.' -f1)
        echo "  $i) $name ($size) - $date"
        backups[$i]="$backup"
        ((i++))
    done
    
    echo ""
    read -p "選擇要還原嘅備份編號 (1-$((i-1))): " choice
    
    if [ -z "${backups[$choice]}" ]; then
        color_red "❌ 無效選擇"
        exit 1
    fi
    
    local selected_backup="${backups[$choice]}"
    local backup_name=$(basename "$selected_backup" .tar.gz)
    
    color_yellow "⚠️  警告: 呢個操作會覆蓋當前 OpenClaw 文件！"
    read -p "確定要還原到 $backup_name? (yes/no): " confirm
    
    if [ "$confirm" != "yes" ]; then
        echo "取消還原"
        exit 0
    fi
    
    # 先創建緊急備份
    echo "🛡️  先創建緊急備份..."
    local emergency_backup="emergency_before_restore_$TIMESTAMP"
    tar -czf "$BACKUP_DIR/${emergency_backup}.tar.gz" -C "$REPO_DIR" . 2>/dev/null || true
    
    # 解壓備份
    echo "📥 還原中..."
    cd "$REPO_DIR"
    
    # 刪除現有文件（保留 .backups）
    find . -maxdepth 1 -not -path "./.backups" -not -path "." -exec rm -rf {} + 2>/dev/null || true
    
    # 解壓
    tar -xzf "$selected_backup" -C /tmp/
    local extracted_name=$(basename "$backup_name")
    cp -r "/tmp/$extracted_name/"* "$REPO_DIR/" 2>/dev/null || cp -r "/tmp/$extracted_name"/* "$REPO_DIR/" 2>/dev/null
    rm -rf "/tmp/$extracted_name"
    
    color_green "✅ 還原完成！"
    echo ""
    echo "請重新啟動 OpenClaw:"
    echo "  openclaw gateway restart"
}

# 健康檢查
health_check() {
    echo "🏥 健康檢查..."
    local issues=0
    
    # 檢查 1: OpenClaw 進程
    if ! pgrep -f "openclaw" > /dev/null; then
        color_red "❌ OpenClaw 進程未運行"
        ((issues++))
    else
        color_green "✅ OpenClaw 進程運行中"
    fi
    
    # 檢查 2: Git repo 完整
    if [ ! -d "$REPO_DIR/.git" ]; then
        color_red "❌ Git repo 損壞"
        ((issues++))
    else
        color_green "✅ Git repo 正常"
    fi
    
    # 檢查 3: 關鍵文件存在
    for file in MEMORY.md AGENTS.md; do
        if [ ! -f "$REPO_DIR/$file" ]; then
            color_red "❌ 缺少文件: $file"
            ((issues++))
        fi
    done
    
    # 檢查 4: Node 版本（OpenClaw 需要）
    if ! command -v node &> /dev/null; then
        color_red "❌ Node.js 未安裝"
        ((issues++))
    else
        local node_version=$(node --version)
        color_green "✅ Node.js: $node_version"
    fi
    
    if [ $issues -eq 0 ]; then
        color_green "\n✅ 所有檢查通過！"
        return 0
    else
        color_red "\n❌ 發現 $issues 個問題"
        return 1
    fi
}

# 自動修復
auto_fix() {
    echo "🔧 嘗試自動修復..."
    
    # 如果 OpenClaw 冇運行，嘗試重啟
    if ! pgrep -f "openclaw" > /dev/null; then
        echo "  嘗試重啟 OpenClaw..."
        openclaw gateway restart 2>/dev/null || color_red "  重啟失敗，請手動檢查"
    fi
}

# 主程式
case "${1:-status}" in
    backup|b)
        create_backup
        ;;
    restore|r)
        restore_backup
        ;;
    status|s)
        show_status
        ;;
    health|h)
        health_check
        ;;
    fix|f)
        auto_fix
        ;;
    auto|a)
        # 自動模式：備份 + 健康檢查
        create_backup
        if ! health_check; then
            color_red "健康檢查失敗，請檢查系統"
            exit 1
        fi
        ;;
    *)
        echo "用法: $0 [backup|restore|status|health|fix|auto]"
        echo ""
        echo "命令:"
        echo "  backup  - 創建完整備份"
        echo "  restore - 從備份還原"
        echo "  status  - 顯示狀態（默認）"
        echo "  health  - 運行健康檢查"
        echo "  fix     - 嘗試自動修復"
        echo "  auto    - 自動備份+健康檢查（適合 cron）"
        exit 1
        ;;
esac