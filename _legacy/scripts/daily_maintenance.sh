#!/bin/bash
# Daily maintenance cron job
# Runs at 00:00 every day

cd /Users/ally/.openclaw/workspace

# Archive old daily files
node scripts/archive_daily.js >> /tmp/openclaw-archive.log 2>&1

# Log completion
echo "[$(date)] Daily maintenance completed" >> /tmp/openclaw-cron.log
