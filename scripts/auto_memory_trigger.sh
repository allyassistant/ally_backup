#!/bin/bash
# Auto Memory Retrieval Trigger
# 當檢測到時間相關關鍵字時，自動檢索記憶

# 關鍵字列表
temporal_keywords=(
    "尋日"
    "前幾日"
    "上個禮拜"
    "之前講過"
    "記得"
    "上次"
    "之前"
)

# 檢測訊息內容
message="$1"

for keyword in "${temporal_keywords[@]}"; do
    if echo "$message" | grep -q "$keyword"; then
        echo "[AUTO_TRIGGER] Detected temporal keyword: $keyword"
        echo "[AUTO_TRIGGER] Suggest running: memory_search or checking L0/L1/L2"
        exit 0
    fi
done
