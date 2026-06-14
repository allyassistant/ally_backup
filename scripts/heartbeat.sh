#!/bin/bash
# Heartbeat - writes current status to local file
# Includes gateway health check to detect gateway-down scenarios
# Run this minute via cron

# ==================== CONFIG ====================
: "${OFFLINE_THRESHOLD:=3}"    # Minutes before declaring peer offline
: "${SSH_TIMEOUT:=5}"           # SSH timeout in seconds
: "${GATEWAY_PORT:=18789}"      # OpenClaw gateway port

# NODE_ID 必須從環境變量讀取
if [ -z "${NODE_ID:-}" ]; then
  echo "❌ ERROR: NODE_ID 環境變量未設定！" >&2
  exit 1
fi

# ==================== GATEWAY HEALTH CHECK ====================
# Check if OpenClaw gateway is actually alive before writing heartbeat
# If gateway is down, skip heartbeat update → timestamp ages → failover triggers
GATEWAY_ALIVE=false

# Method 1: Try HTTP health endpoint
if command -v curl >/dev/null 2>&1; then
  HTTP_CHECK=$(curl -sf --connect-timeout 3 "http://127.0.0.1:${GATEWAY_PORT}/health" 2>&1)
  if [ -n "$HTTP_CHECK" ]; then
    GATEWAY_ALIVE=true
  fi
fi

# Method 2: Check process as fallback
if [ "$GATEWAY_ALIVE" != "true" ]; then
  if pgrep -f "openclaw.*gateway.*--port ${GATEWAY_PORT}" > /dev/null 2>&1; then
    GATEWAY_ALIVE=true
  fi
fi

# Method 3: Check any openclaw gateway process
if [ "$GATEWAY_ALIVE" != "true" ]; then
  if pgrep -f "openclaw.*gateway" > /dev/null 2>&1; then
    # Process exists but not responding — possible crash loop
    echo "⚠️  Gateway process found but not responding on port ${GATEWAY_PORT}" >&2
  fi
fi

if [ "$GATEWAY_ALIVE" != "true" ]; then
  echo "❌ OpenClaw gateway not alive — skipping heartbeat (failover will trigger)" >&2
  exit 0
fi

# Get current timestamp (UTC for machine-readable, display uses TZ=Asia/Hong_Kong)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Read current task from current_task.json (default to "待機中" if not found)
CURRENT_TASK_FILE="$HOME/.openclaw/workspace/ha-state/${NODE_ID}/current_task.json"
CURRENT_TASK="待機中"
if [ -f "$CURRENT_TASK_FILE" ]; then
    if command -v jq >/dev/null 2>&1; then
        PARSED_TASK=$(jq -r '.current_task // "待機中"' "$CURRENT_TASK_FILE" 2>/dev/null)
        if [ -n "$PARSED_TASK" ] && [ "$PARSED_TASK" != "null" ]; then
            CURRENT_TASK="$PARSED_TASK"
        fi
    else
        PARSED_TASK=$(cat "$CURRENT_TASK_FILE" 2>/dev/null | grep -o '"current_task" *: *"[^"]*"' | sed 's/.*: *"\([^"]*\)"/\1/' | head -1)
        if [ -n "$PARSED_TASK" ]; then
            CURRENT_TASK="$PARSED_TASK"
        fi
    fi
fi

# Ensure directory exists before writing
mkdir -p "$HOME/.openclaw/workspace/ha-state/${NODE_ID}"

# Write heartbeat (portable JSON escaping using python3)
HEARTBEAT_FILE="$HOME/.openclaw/workspace/ha-state/${NODE_ID}/heartbeat.json"
python3 -c '
import json, sys
_, node_id, timestamp, heartbeat_file, current_task = (
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else ""
)
payload = {
    "node_id": node_id,
    "timestamp": timestamp,
    "status": "alive",
    "current_task": current_task
}
with open(heartbeat_file, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)
    f.write("\n")
' "$0" "$NODE_ID" "$TIMESTAMP" "$HEARTBEAT_FILE" "$CURRENT_TASK"

echo "Heartbeat written: $NODE_ID at $TIMESTAMP (task: $CURRENT_TASK)"
