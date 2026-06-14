#!/bin/bash
# Discord Channel Logger trigger
# Sets marker and wakes main session for Discord log

MARKER="/tmp/discord_channel_logger_trigger.txt"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
echo "PID: $$" >> "$MARKER"
exit 0
