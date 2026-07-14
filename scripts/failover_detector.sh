#!/bin/bash
# Failover Detector - Checks if peer Gateway is running via heartbeat file
# SSH to peer → check if heartbeat file was updated in last 3 minutes
# Only sends notification if MY OWN heartbeat is recent (< 3 minutes)
# Updated 2026-03-16: Added state tracking to prevent false "peer online" notifications
# HR-062: Magic numbers moved to CONFIG section
# 2026-06-11 Bug fixes:
#   - Bug #1+#2: Self-recovery grace period (2 min) - prevent false peer-offline right after reboot
#   - Bug #3: last_status_* reset on self-recovery (resolve cross-crash state inconsistency)
#   - Bug #4: Debounce peer offline (2 consecutive checks) - prevent uni-directional blip spam

# CONFIG: Magic numbers extracted as constants
CHANNEL_ID="1473376125584670872"  # #⚙️系統
OFFLINE_THRESHOLD=3  # 3 minutes - threshold for peer being considered offline
SSH_TIMEOUT=5  # SSH connection timeout in seconds
SELF_RECOVERY_GRACE_SECONDS=120  # 2 min - skip peer checks right after self-recovery (Bug #1+#2)
PEER_OFFLINE_DEBOUNCE_COUNT=2  # 2 consecutive checks required to confirm peer offline (Bug #4)
SELF_RECOVERY_HEARTBEAT_BASELINE=60  # self heartbeat must be ≤ 60s old to qualify as "fresh" recovery
SELF_HISTORY_FILE="$HOME/.openclaw/workspace/ha-state/self_heartbeat_diff_${NODE_ID}"
PEER_CHECK_COUNT_FILE="$HOME/.openclaw/workspace/ha-state/peer_check_count_${PEER_ID}"

# Detect NODE_ID based on explicit hostname match (safer than grep)
MY_HOSTNAME=$(hostname -s)
case "$MY_HOSTNAME" in
  "Mac-mini")
    NODE_ID="ally"
    ;;
  "MacBook-Neo")
    NODE_ID="bliss"
    ;;
  *)
    echo "⚠️ Unknown hostname: $MY_HOSTNAME, defaulting to 'ally'"
    NODE_ID="ally"
    ;;
esac

# Set peer info based on who I am
# PEER_IP / PEER_SSH_USER can be overridden via environment variables
if [ "$NODE_ID" = "bliss" ]; then
    PEER_IP="${PEER_IP:-[TAILSCALE_ALLY_IP]}"
    PEER_SSH_USER="${PEER_SSH_USER:-ally}"
    MY_NAME="Bliss"
    PEER_NAME="Ally"
    PEER_ID="ally"
else
    PEER_IP="${PEER_IP:-[TAILSCALE_BLISS_IP]}"
    PEER_SSH_USER="${PEER_SSH_USER:-bliss}"
    MY_NAME="Ally"
    PEER_NAME="Bliss"
    PEER_ID="bliss"
fi

CURRENT_UTC=$(date -u +%s)

# ======== NEW: State tracking file ========
LAST_STATUS_FILE="$HOME/.openclaw/workspace/ha-state/last_status_${PEER_ID}"
OFFLINE_SINCE_FILE="$HOME/.openclaw/workspace/ha-state/offline_since_${PEER_ID}"
SELF_HISTORY_FILE="$HOME/.openclaw/workspace/ha-state/self_heartbeat_diff_${NODE_ID}"
PEER_CHECK_COUNT_FILE="$HOME/.openclaw/workspace/ha-state/peer_check_count_${PEER_ID}"

# First run - initialize with "online" and exit silently (no notification)
if [ ! -f "$LAST_STATUS_FILE" ]; then
    echo "online" > "$LAST_STATUS_FILE"
    echo "$(TZ=Asia/Hong_Kong date): First run - initialized ${PEER_NAME} status as online, no notification"
    exit 0
fi

# ======== Check my own heartbeat first ========
MY_HEARTBEAT_FILE="$HOME/.openclaw/workspace/ha-state/${NODE_ID}/heartbeat.json"

if [ -f "$MY_HEARTBEAT_FILE" ]; then
    MY_TS=$(grep -o '"timestamp": "[^"]*"' "$MY_HEARTBEAT_FILE" | cut -d'"' -f4)
    if [ -n "$MY_TS" ]; then
        MY_EPOCH=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$MY_TS" +%s 2>/dev/null)
        if [ -n "$MY_EPOCH" ]; then
            MY_DIFF=$((CURRENT_UTC - MY_EPOCH))
            MY_DIFF_MINUTES=$((MY_DIFF / 60))

            if [ $MY_DIFF -gt $((OFFLINE_THRESHOLD * 60)) ]; then
                echo "$(TZ=Asia/Hong_Kong date): My own heartbeat is stale ($MY_DIFF_MINUTES min) - skipping notification"
                exit 0
            fi
        fi
    fi
else
    echo "$(TZ=Asia/Hong_Kong date): My own heartbeat file not found - assuming I was offline, skipping"
    exit 0
fi

# ======== NEW: Self-recovery grace period check (Bug #1+#2) ========
# Track previous self-heartbeat diff. If last run was stale (>3 min) and this run is fresh,
# we're in self-recovery mode — skip peer checks for SELF_RECOVERY_GRACE_SECONDS
PREV_SELF_DIFF=""
if [ -f "$SELF_HISTORY_FILE" ]; then
    PREV_SELF_DIFF=$(cat "$SELF_HISTORY_FILE" 2>/dev/null)
fi

# Self-recovery condition: previous diff > threshold, current diff ≤ threshold
if [ -n "$PREV_SELF_DIFF" ] && [ "$PREV_SELF_DIFF" -gt $((OFFLINE_THRESHOLD * 60)) ] && [ $MY_DIFF -le $((SELF_RECOVERY_HEARTBEAT_BASELINE)) ]; then
    # Reset last_status_* on recovery (Bug #3 fix) — we can't trust stale state from before crash
    echo "online" > "$LAST_STATUS_FILE"
    rm -f "$OFFLINE_SINCE_FILE"
    echo "$(TZ=Asia/Hong_Kong date): Self-recovery detected (prev_diff=${PREV_SELF_DIFF}s, current=${MY_DIFF}s) — entering ${SELF_RECOVERY_GRACE_SECONDS}s grace period, peer checks paused, state files reset"
    echo "$MY_DIFF" > "$SELF_HISTORY_FILE"
    # Reset peer check count on self-recovery
    echo "0" > "$PEER_CHECK_COUNT_FILE"
    exit 0
fi

# Update self heartbeat history for next run
echo "$MY_DIFF" > "$SELF_HISTORY_FILE"

# ======== Proceed with peer check ========
PEER_HEARTBEAT=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=yes -i ~/.ssh/id_ed25519 ${PEER_SSH_USER}@$PEER_IP "cat ~/.openclaw/workspace/ha-state/${PEER_ID}/heartbeat.json 2>/dev/null" 2>/dev/null)

if [ -z "$PEER_HEARTBEAT" ]; then
    CURRENT_STATUS="offline"
else
    # 同步本地 peer heartbeat 副本
    mkdir -p "$HOME/.openclaw/workspace/ha-state/${PEER_ID}"
    echo "$PEER_HEARTBEAT" > "$HOME/.openclaw/workspace/ha-state/${PEER_ID}/heartbeat.json"

    PEER_TS=$(echo "$PEER_HEARTBEAT" | grep -o '"timestamp": "[^"]*"' | cut -d'"' -f4 | head -1)
    if [ -n "$PEER_TS" ]; then
        # Try different date parsing methods for macOS compatibility
        # Use env var to avoid shell injection in Python string interpolation
        PEER_EPOCH=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$PEER_TS" +%s 2>/dev/null) || \
        PEER_EPOCH=$(PEER_TS="$PEER_TS" python3 -c "import os; from datetime import datetime; ts=os.environ['PEER_TS']; print(int(datetime.strptime(ts, '%Y-%m-%dT%H:%M:%SZ').timestamp()))" 2>/dev/null) || \
        PEER_EPOCH=""

        if [ -n "$PEER_EPOCH" ]; then
            DIFF=$((CURRENT_UTC - PEER_EPOCH))
            if [ $DIFF -le $((OFFLINE_THRESHOLD * 60)) ]; then
                CURRENT_STATUS="online"
            else
                CURRENT_STATUS="offline"
            fi
        else
            CURRENT_STATUS="offline"
        fi
    else
        CURRENT_STATUS="offline"
    fi
fi

# ======== NEW: Debounce for peer offline (Bug #4) ========
# Track consecutive offline checks; only count as truly offline after PEER_OFFLINE_DEBOUNCE_COUNT
PREV_PEER_COUNT=0
if [ -f "$PEER_CHECK_COUNT_FILE" ]; then
    PREV_PEER_COUNT=$(cat "$PEER_CHECK_COUNT_FILE" 2>/dev/null || echo "0")
fi

if [ "$CURRENT_STATUS" = "offline" ]; then
    NEW_PEER_COUNT=$((PREV_PEER_COUNT + 1))
else
    NEW_PEER_COUNT=0
fi
echo "$NEW_PEER_COUNT" > "$PEER_CHECK_COUNT_FILE"

# Override CURRENT_STATUS for notification purposes if debounce not met
# (We still record the actual status in last_status_*, but won't send notifications)
NOTIFY_STATUS="$CURRENT_STATUS"
if [ "$CURRENT_STATUS" = "offline" ] && [ $NEW_PEER_COUNT -lt $PEER_OFFLINE_DEBOUNCE_COUNT ]; then
    # Don't notify yet — wait for one more consecutive offline check
    NOTIFY_STATUS="online"
    echo "$(TZ=Asia/Hong_Kong date): Peer offline detected but debounce not met (${NEW_PEER_COUNT}/${PEER_OFFLINE_DEBOUNCE_COUNT}) - skipping notification"
fi

# ======== NEW: State change detection ========
LAST_STATUS=$(cat "$LAST_STATUS_FILE")

# Only notify on state change
if [ "$LAST_STATUS" = "online" ] && [ "$NOTIFY_STATUS" = "offline" ]; then
    # Peer went offline - try to format the timestamp, fallback to reading from local file
    if [ -n "$PEER_EPOCH" ]; then
        PEER_TS_HKT=$(TZ=Asia/Hong_Kong date -r $PEER_EPOCH "+%Y-%m-%d %H:%M" 2>/dev/null || echo "unknown")
    else
        # Fallback: try to read from local cached heartbeat file
        LOCAL_PEER_HEARTBEAT="$HOME/.openclaw/workspace/ha-state/${PEER_ID}/heartbeat.json"
        if [ -f "$LOCAL_PEER_HEARTBEAT" ]; then
            LOCAL_TS=$(grep -o '"timestamp": "[^"]*"' "$LOCAL_PEER_HEARTBEAT" | cut -d'"' -f4 | head -1)
            if [ -n "$LOCAL_TS" ]; then
                PEER_TS_HKT=$(TZ=Asia/Hong_Kong date -j -f "%Y-%m-%dT%H:%M:%SZ" "$LOCAL_TS" "+%Y-%m-%d %H:%M" 2>/dev/null || echo "unknown")
            else
                PEER_TS_HKT="unknown"
            fi
        else
            PEER_TS_HKT="unknown"
        fi
    fi
    MESSAGE="⚠️ **Failover 通知**\n\n$PEER_NAME 已離線超過${OFFLINE_THRESHOLD}分鐘。\n\n最後 Heartbeat：$PEER_TS_HKT\n\n我已經準備好接手，有需要既話喺任何 channel @我就得！"
    /opt/homebrew/bin/openclaw message send --channel discord --target channel:$CHANNEL_ID --message "$MESSAGE" 2>&1 || echo "Failed to send"
    # 記錄離線開始時間
    echo "$CURRENT_UTC" > "$OFFLINE_SINCE_FILE"
    echo "$(TZ=Asia/Hong_Kong date): Notified - $PEER_NAME is offline (debounce met: ${NEW_PEER_COUNT}/${PEER_OFFLINE_DEBOUNCE_COUNT})"

elif [ "$LAST_STATUS" = "offline" ] && [ "$NOTIFY_STATUS" = "online" ]; then
    # Peer came back online - 用 offline_since 計算真正離線時長
    # 只喺我哋記錄到佢離線時先通知（避免重複通知）
    if [ -f "$OFFLINE_SINCE_FILE" ]; then
        OFFLINE_SINCE=$(cat "$OFFLINE_SINCE_FILE")
        OFFLINE_DURATION=$((CURRENT_UTC - OFFLINE_SINCE))
        # 只顯示 >= 1 分鐘的時長，避免 "0 分鐘" 誤導
        if [ $OFFLINE_DURATION -ge 60 ]; then
            DURATION_MSG="離線時間：約 $((OFFLINE_DURATION / 60)) 分鐘"
        else
            DURATION_MSG=""
        fi
        rm -f "$OFFLINE_SINCE_FILE"
        # 只有真正記錄到離線的先發通知
        MESSAGE="✅ **恢復通知**\n\n$PEER_NAME 已番咗上線！\n\n$DURATION_MSG\n\n一切回復正常。"
        /opt/homebrew/bin/openclaw message send --channel discord --target channel:$CHANNEL_ID --message "$MESSAGE" 2>&1 || echo "Failed to send"
        echo "$(TZ=Asia/Hong_Kong date): Notified - $PEER_NAME is back online"
    else
        # 我哋冇記錄到佢離線（可能係之前其他原因），唔發通知
        echo "$(TZ=Asia/Hong_Kong date): $PEER_NAME is online but no offline record - skipping notification"
    fi
else
    # No state change - just log
    echo "$(TZ=Asia/Hong_Kong date): $PEER_NAME status unchanged ($CURRENT_STATUS, notify=${NOTIFY_STATUS}, debounce=${NEW_PEER_COUNT})"
fi

# Update last status (always reflect actual current state, not the debounced one)
echo "$NOTIFY_STATUS" > "$LAST_STATUS_FILE"
