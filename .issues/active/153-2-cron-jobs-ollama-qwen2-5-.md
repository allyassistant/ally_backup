
### 🔴 Day 0: Ollama Experiment Rollback (2026-06-11 23:45 HKT)
- **All 19 crons rolled back** from ollama/qwen2.5:3b → deepseek/deepseek-v4-flash
- **Root cause:** qwen2.5:3b 得 32K context window，OpenClaw cron agentTurn 注入嘅系統 context 超過呢個 limit
- **Additional:** `lightContext: true` 都解決唔到（32K still too small）
- **Lesson:** ollama/qwen2.5:3b (1.9GB, 32K) is too small for OpenClaw cron agentTurn context. Would need qwen2.5:7b (4.7GB, 128K) or qwen3:14b (8GB, 128K) for local model to work
- **Discord Channel Logger** 已轉返 deepseek（原本因為 sessionKey binding 導致 context overflow，同 ollama 無關）
- **Daily Synthesis** 都轉返 deepseek（之前 ollama OK 只係未到下個 schedule，聽朝都會 fail）
- **#153 → closed** (ollama migration not viable with current model size/RAM constraints)
