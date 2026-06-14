---
id: 034
title: Ollama API 持續卡住 (qwen3.5:9b)
status: archive
priority: P2
created: 2026-03-13
due: 2026-03-20
updated: 2026-03-20
progress: 0/0
---

## Description

Ollama service API calls hang/stuck - all requests to `/api/generate` and `/v1/chat/completions` never return a response, even though:
- Ollama service is running
- Models are loaded
- curl to `/` returns "Ollama is running"

## Investigation Done

### Symptoms
- API calls hang indefinitely (30s+ timeout)
- Terminal `ollama run` works fine
- This is specific to API calls, not the model itself

### Tried Solutions
1. ✅ Restart Ollama service multiple times
2. ✅ Reboot Mac
3. ✅ Reinstall Ollama via Homebrew
4. ✅ Delete and re-download model (qwen3.5:9b, 6.6GB)
5. ✅ Fresh Ollama install (0.17.7)
6. ✅ Tested both native API (`/api/generate`) and OpenAI-compatible (`/v1/chat/completions`)

### Current Status
- **Ollama**: Running (PID via launchctl)
- **Models**: qwen3.5:9b loaded
- **API**: Still hanging on all requests
- **MiniMax**: Working fine (used as fallback)

## Next Steps

1. ~~Keep using MiniMax instead of Ollama~~ (Done - all cron jobs updated to MiniMax)
2. Investigate deeper:
   - Check if it's a macOS-specific issue
   - Try running Ollama with different environment variables
   - Check system logs for clues
3. Consider: macOS reinstall if no solution found

## Notes

All cron jobs using Ollama models have been updated to use MiniMax-M2.5 instead:
- Reminder Discussion Check
- Weekly Stock Monitor
- Weekly Correction Loop
- Token Monitor
- Health Monitor
- L0/L1 Fallback Check
- Daily Memory Logger
- Daily Media Auto-Cleanup
