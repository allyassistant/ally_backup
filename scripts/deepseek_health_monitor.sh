#!/bin/bash
# deepseek_health_monitor.sh - 每隔 5 min ping DeepSeek API，記錄 latency
# 用於對照 cron failure windows
# 用法：cron 每 5 min 行一次，或 background 行 24h

LOG_DIR="$HOME/.openclaw/workspace/.diagnostics"
LOG_FILE="$LOG_DIR/deepseek_health_$(date +%Y-%m-%d).log"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S%z)
HKT_HOUR=$(date +%H)

# curl DeepSeek /v1/models with timing (timeout 30s)
RESULT=$(curl -s -o /dev/null -w "%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}" https://api.deepseek.com/v1/models -m 30 2>&1)

# Parse
HTTP_CODE=$(echo "$RESULT" | cut -d'|' -f1)
DNS=$(echo "$RESULT" | cut -d'|' -f2)
TCP=$(echo "$RESULT" | cut -d'|' -f3)
TLS=$(echo "$RESULT" | cut -d'|' -f4)
TTFB=$(echo "$RESULT" | cut -d'|' -f5)
TOTAL=$(echo "$RESULT" | cut -d'|' -f6)

# Determine status
if [ -z "$TOTAL" ] || [ "$TOTAL" = "0" ] || [ "$HTTP_CODE" = "000" ]; then
  STATUS="TIMEOUT"
  TOTAL=30.0
elif [ "$HTTP_CODE" = "401" ]; then
  # 401 is expected (no auth for public endpoint)
  STATUS="OK"
else
  STATUS="HTTP_$HTTP_CODE"
fi

echo "$TIMESTAMP|$STATUS|${TOTAL}s|DNS=${DNS}s|TCP=${TCP}s|TLS=${TLS}s|TTFB=${TTFB}s" >> "$LOG_FILE"

# If timeout or slow >10s, also write a warning file for quick detection
if [ "$STATUS" = "TIMEOUT" ]; then
  echo "$TIMESTAMP|TIMEOUT|30s" >> "$LOG_DIR/deepseek_alerts.log"
fi

# Output for cron log
echo "$TIMESTAMP|$STATUS|${TOTAL}s"
