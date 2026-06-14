#!/bin/bash
# Session 啟動腳本 - 整合 Memory-Wiki
# 位置: ~/.openclaw/workspace/scripts/session_startup.sh
# 用法: 每次 Session 啟動時運行

set -e

WORKSPACE="${HOME}/.openclaw/workspace"
LOGS_DIR="${WORKSPACE}/logs"
WIKI_VAULT="${WORKSPACE}/.openclaw-wiki"
DIGEST_FILE="${WIKI_VAULT}/cache/agent-digest.json"

# 顏色定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 確保日誌目錄存在
mkdir -p "${LOGS_DIR}"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo ""
echo "🚀 OpenClaw Session Startup (Ally)"
echo "=================================="
echo ""

# 1. 基礎檔案檢查
echo "📋 Step 1: 檢查基礎檔案..."
REQUIRED_FILES=("SOUL.md" "USER.md" "MEMORY.md" "AGENTS.md")
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "${WORKSPACE}/${file}" ]; then
        log_success "${file}"
    else
        log_warn "${file} not found"
    fi
done
echo ""

# 2. 檢查 Wiki Vault 狀態
echo "📋 Step 2: 檢查 Wiki Vault..."
if [ -d "${WIKI_VAULT}" ]; then
    log_success "Wiki Vault 已初始化"

    # 檢查 Digest
    if [ -f "${DIGEST_FILE}" ]; then
        # 計算 Digest 年齡
        if [[ "$OSTYPE" == "darwin"* ]]; then
            DIGEST_AGE=$(stat -f %m "${DIGEST_FILE}")
        else
            DIGEST_AGE=$(stat -c %Y "${DIGEST_FILE}")
        fi
        NOW=$(date +%s)
        AGE_HOURS=$(( (NOW - DIGEST_AGE) / 3600 ))

        log_info "Digest 年齡: ${AGE_HOURS} 小時"

        if [ $AGE_HOURS -gt 24 ]; then
            log_warn "Digest 過期，建議運行: openclaw wiki compile"
        fi

        # 顯示統計
        if command -v jq &> /dev/null; then
            CLAIM_COUNT=$(jq -r '.claimCount // 0' "${DIGEST_FILE}")
            FRESH_COUNT=$(jq -r '.statistics.freshClaims // 0' "${DIGEST_FILE}")
            log_info "Claims: ${CLAIM_COUNT} total, ${FRESH_COUNT} fresh"
        fi
    else
        log_warn "Digest 不存在，需要編譯"
        log_info "運行: openclaw wiki compile"
    fi
else
    log_warn "Wiki Vault 未初始化"
    log_info "運行: openclaw wiki init"
fi
echo ""

# 3. 檢查 Bliss 狀態 (HA)
echo "📋 Step 3: 檢查 HA 狀態..."
if [ -f "${WORKSPACE}/scripts/failover_detector.sh" ]; then
    bash "${WORKSPACE}/scripts/failover_detector.sh" 2>/dev/null || log_warn "Failover check failed"
else
    log_warn "Failover detector not found"
fi
echo ""

# 4. 載入 Cross-Session Context
echo "📋 Step 4: 載入 Cross-Session Context..."
if [ -f "${WORKSPACE}/scripts/cross_session_bootstrap.js" ]; then
    if node "${WORKSPACE}/scripts/cross_session_bootstrap.js" 2>/dev/null; then
        log_success "Cross-Session Context 載入完成"
    else
        log_warn "Bootstrap script failed"
    fi
else
    log_warn "Bootstrap script not found"
fi
echo ""

# 5. 載入 Wiki Digest
echo "📋 Step 5: Wiki Digest 摘要..."
if [ -f "${DIGEST_FILE}" ] && command -v jq &> /dev/null; then
    echo ""
    echo "📊 Digest 統計:"
    echo "   Total Claims: $(jq -r '.claimCount // 0' "${DIGEST_FILE}")"
    echo "   Fresh Claims: $(jq -r '.statistics.freshClaims // 0' "${DIGEST_FILE}")"
    echo "   Aging Claims: $(jq -r '.statistics.agingClaims // 0' "${DIGEST_FILE}")"
    echo "   Stale Claims: $(jq -r '.statistics.staleClaims // 0' "${DIGEST_FILE}")"
    echo "   Contested: $(jq -r '.statistics.contestedClaims // 0' "${DIGEST_FILE}")"
    echo ""

    # 顯示 Top Pages
    echo "🔑 重要頁面:"
    jq -r '.pages[0:3] | .[] | "\n📄 \(.title) (\(.claimCount) claims)"' "${DIGEST_FILE}" 2>/dev/null || true
    echo ""
fi
echo ""

# 6. 檢查 Active Issues
echo "📋 Step 6: 檢查 Active Issues..."
ISSUES_DIR="${WORKSPACE}/.issues/active"
if [ -d "${ISSUES_DIR}" ]; then
    ISSUE_COUNT=$(find "${ISSUES_DIR}" -name "*.md" | wc -l)
    log_info "${ISSUE_COUNT} active issues"

    # 顯示高優先級 Issues
    if [ $ISSUE_COUNT -gt 0 ]; then
        echo ""
        echo "🚨 高優先級 Issues:"
        for issue in $(find "${ISSUES_DIR}" -name "*.md" | head -3); do
            TITLE=$(grep -m 1 "^#" "$issue" | sed 's/^# *//' | cut -c1-50)
            echo "   • ${TITLE}..."
        done
        echo ""
    fi
else
    log_warn "Issues directory not found"
fi
echo ""

# 7. 檢查 Recent Errors
echo "📋 Step 7: 檢查 Recent Errors..."
ERRORS_FILE="${WORKSPACE}/memory/errors.json"
if [ -f "${ERRORS_FILE}" ] && command -v jq &> /dev/null; then
    UNRESOLVED=$(jq '[.errors[] | select(.resolved == false)] | length' "${ERRORS_FILE}")
    log_info "${UNRESOLVED} unresolved errors"

    if [ "$UNRESOLVED" -gt 10 ]; then
        log_warn "High error count detected"
    fi
else
    log_warn "Errors file not found"
fi
echo ""

echo "=================================="
log_success "Session Startup 完成"
echo ""
echo "💡 快速命令:"
echo "   openclaw wiki status      - 查看 Wiki 狀態"
echo "   openclaw wiki search      - 搜索 Wiki"
echo "   openclaw memory rem-harness - 預覽 REM"
echo "   openclaw wiki lint        - 品質檢查"
echo ""
