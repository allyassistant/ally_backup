#!/bin/bash
# Sync Discord History - 讀取最近既 Discord 訊息俾雙方 bot 知道對方講過啲乜

CHANNEL_ID="1473384999003619500"  # 🧑🏻‍💻編程
LIMIT=10

echo "=== Discord Recent History ==="
echo "Channel: #🧑🏻‍💻編程"
echo ""

#呢個script會output最近既訊息
#實際使用會透過 OpenClaw 既 message tool read

# For Ally (Mac A): 呢個會set喺佢既 session start
# For Bliss (Mac B): 都一樣會讀取

echo "To read Discord history, use:"
echo "message action=read channelId=$CHANNEL_ID limit=$LIMIT"
