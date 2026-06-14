#!/bin/bash
# Log Rotation Script - 保留最近1000行
# 每日凌晨5點由 crontab 執行

for log in /tmp/failover.log /tmp/heartbeat.log; do
  if [ -f "$log" ]; then
    /usr/bin/tail -n 1000 "$log" > "${log}.tmp" && /bin/mv "${log}.tmp" "$log"
  fi
done
