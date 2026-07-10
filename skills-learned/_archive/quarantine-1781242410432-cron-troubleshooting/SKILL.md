---
name: cron-troubleshooting
description: 診斷 cron job failure — 建 timeline、區分 provider/script/session 問題、手動 rerun 驗證、LLM failure mitigation
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T05:31:09.350Z
---

## Workflow

### Phase 1: Gather run history

1. **Read recent runs** — `openclaw cron runs --id <cron-id> --limit 10`
   - Extract model used, result status, timestamps
   - Identify consecutive failures vs isolated failures

2. **Check failure phase** — look for `model-call-started` timeout pattern
   - This often means model resolution succeeded but LLM call hung or timed out
   - Distinguish from config errors (model not found, auth failure)

3. **Cross-reference model drift** — see "Model Drift Detection" section below for dedicated procedure

### Phase 2: Categorize failure type

| Failure type | Evidence | Resolution |
|---|---|---|
| Provider | "model unavailable", network timeout | Check API keys, switch fallback |
| Script | syntax error, file not found, module missing | Inspect script directly |
| Session | state corruption, lock contention | Retry with `--fresh` |
| Model drift | configured model ≠ actual model, context overflow | See drift section |

### Phase 3: Manual verification

4. **Trigger a fresh run** — `openclaw cron run --id <cron-id> --fresh`
   - If it succeeds: intermittent issue (session state, timing)
   - If it fails same way: consistent bug, inspect logs deeper

5. **Inspect script content** — verify script path, model references, file existence
   ```bash
   cat /Users/ally/.openclaw/workspace/scripts/<script-name>.js
   ```

### Phase 4: Recovery actions

6. **Fix config or script** based on root cause
   - Update model: `openclaw cron update --id <cron-id> --model <provider/model>`
   - Update timeout: `openclaw cron update --id <cron-id> --timeout-seconds 300`
   - Rollback: if experiment caused drift, restore previous config

7. **Schedule next check** — verify next scheduled run succeeds
   - `openclaw cron runs --id <cron-id> --limit 1` after next run window

### Phase 5: LLM failure mitigation

8. **If model-call consistently hangs:**
   - Reduce `timeoutSeconds` (e.g. 30 → 300 for complex tasks)
   - Add verbose logging to script to see where it hangs
   - Consider switching from `agentTurn` to `systemEvent` for thin-executor crons
   - Check if other crons using same model are succeeding — isolate provider vs script issue

---

## Model Drift Detection

This is a distinct sub-pattern within cron troubleshooting. When a cron fails with `model-call-started` timeout, always check if the model that actually ran matches the configured model.

### Detection Procedure

1. **Extract model from recent runs:**
