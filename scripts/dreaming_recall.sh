#!/bin/bash
# Dreaming Recall Automation Script
# Runs openclaw memory search to accumulate recall signals for Dreaming memory promotion
# Scheduled: Every 2 hours

# Topics to search (rotated based on hour)
HOUR=$(date +%H)

case $HOUR in
  00|12) TOPICS="FDQ System L0 L1 Code Quality" ;;
  02|14) TOPICS="Stock List Heartbeat Memory" ;;
  04|16) TOPICS="Auto Remember Dreaming Issues" ;;
  06|18) TOPICS="Scripts Cron Jobs System" ;;
  08|20) TOPICS="OpenClaw Discord Slack" ;;
  10|22) TOPICS="Error Tracking Quality Manager" ;;
  *) TOPICS="FDQ System L0 L1" ;;
esac

# Run the search (suppress output)
/opt/homebrew/bin/openclaw memory search "$TOPICS" > /dev/null 2>&1

# Log to file for debugging
echo "$(date '+%Y-%m-%d %H:%M:%S') - Searched: $TOPICS" >> ~/.openclaw/logs/dreaming_recall.log
