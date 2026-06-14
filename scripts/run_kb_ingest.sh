#!/usr/bin/env bash
# ============================================================================
# run_kb_ingest.sh — Knowledge Base Ingest wrapper with retry logic
# ============================================================================
# Purpose:
#   將 knowledge_ingester.js 包入 retry + logging wrapper
#   即使 cron 嘅 isolated agent session LLM call 被 abort
#   呢個 wrapper 仍然可以自己 retry 同 logging
#
# 觸發：每日 06:00 HKT（由 OpenClaw cron job 9ebd92c9 觸發）
#
# 用法：
#   bash scripts/run_kb_ingest.sh                 # 預設 retry 3 次
#   bash scripts/run_kb_ingest.sh --max-retries 5 # 自訂 retry 數
#   bash scripts/run_kb_ingest.sh --dry-run       # 測試模式
#
# 輸出：
#   - 全部 output → /tmp/kb_ingest.log (atomic append)
#   - 成功 → exit 0
#   - 最終失敗 → exit 1（但已有部分 ingest 結果保留）
#
# v1.0 (2026-06-05): Initial — 解決 06:06 KB Ingest 失敗問題
# ============================================================================

set -euo pipefail

# 設定
WORKSPACE="${HOME}/.openclaw/workspace"
SCRIPT="${WORKSPACE}/scripts/knowledge_ingester.js"
LOG_FILE="/tmp/kb_ingest.log"
STATE_FILE="${WORKSPACE}/.knowledge_ingester_state.json"
MAX_RETRIES=3
RETRY_DELAY=10  # seconds
QUIET="--quiet"  # 減少 output 避免 LLM 大量處理
DRY_RUN=""  # default: 唔係 dry run

# 解析參數
while [[ $# -gt 0 ]]; do
  case $1 in
    --max-retries)
      MAX_RETRIES="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="--dry-run"
      shift
      ;;
    --verbose)
      QUIET=""
      shift
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

# 原子 log 寫入
log() {
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S %Z')
  echo "[$ts] $*" | tee -a "$LOG_FILE" >&2
}

# 開始
log "=========================================="
log "📚 KB Ingest wrapper started (max_retries=$MAX_RETRIES)"
log "=========================================="

# Sanity check
if [ ! -f "$SCRIPT" ]; then
  log "❌ Script not found: $SCRIPT"
  exit 1
fi

# Backup state file before run
if [ -f "$STATE_FILE" ]; then
  cp "$STATE_FILE" "${STATE_FILE}.bak.$(date +%s)" 2>/dev/null || true
fi

# Retry loop
attempt=0
last_error=""

while [ $attempt -lt $MAX_RETRIES ]; do
  attempt=$((attempt + 1))
  log "🔄 Attempt $attempt/$MAX_RETRIES"

  # 捕獲 exit code 唔被 set -e 中斷
  set +e
  node "$SCRIPT" $QUIET $DRY_RUN 2>&1 | tee -a "$LOG_FILE"
  exit_code=${PIPESTATUS[0]}
  set -e

  if [ $exit_code -eq 0 ]; then
    log "✅ Attempt $attempt succeeded"
    log "=========================================="
    log "🎉 KB Ingest completed (attempts: $attempt)"
    log "=========================================="
    exit 0
  fi

  last_error="exit_code=$exit_code"
  log "⚠️ Attempt $attempt failed ($last_error)"

  # 如果唔係最後一次，sleep 然後 retry
  if [ $attempt -lt $MAX_RETRIES ]; then
    log "⏳ Sleeping ${RETRY_DELAY}s before retry..."
    sleep $RETRY_DELAY
    # Exponential backoff
    RETRY_DELAY=$((RETRY_DELAY * 2))
  fi
done

# 全部 retry 都失敗
log "❌ All $MAX_RETRIES attempts failed"
log "=========================================="
log "💀 KB Ingest FAILED after $MAX_RETRIES attempts"
log "Last error: $last_error"
log "=========================================="

# Restore state file if all attempts failed
# Find latest backup safely (avoid glob + test race)
latest_bak=$(ls -t "${STATE_FILE}.bak."* 2>/dev/null | head -1 || true)
if [ -n "$latest_bak" ] && [ -f "$latest_bak" ]; then
  log "🔙 Restoring state from backup: $latest_bak"
  cp "$latest_bak" "$STATE_FILE"
fi

exit 1
