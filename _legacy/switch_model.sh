#!/bin/bash
# OpenClaw Model Switcher
# Usage: ./switch_model.sh [kimi|qwen3]

MODEL=${1:-kimi}

if [ "$MODEL" = "qwen3" ] || [ "$MODEL" = "ollama" ]; then
    echo "Switching to Qwen3 (Ollama)..."
    export OPENCLAW_MODEL="ollama/qwen3:14b"
    echo "Model set to: ollama/qwen3:14b"
    echo ""
    echo "To use this model, start OpenClaw with:"
    echo "  openclaw --model ollama/qwen3:14b"
    
elif [ "$MODEL" = "kimi" ]; then
    echo "Switching to Kimi Code..."
    export OPENCLAW_MODEL="kimi-code/kimi-for-coding"
    echo "Model set to: kimi-code/kimi-for-coding"
    echo ""
    echo "To use this model, start OpenClaw with:"
    echo "  openclaw --model kimi-code/kimi-for-coding"
else
    echo "Usage: ./switch_model.sh [kimi|qwen3]"
    echo ""
    echo "Available models:"
    echo "  kimi   - Kimi Code (Cloud API)"
    echo "  qwen3  - Qwen3 14B (Local Ollama)"
fi
