---
name: cron-model-call-timeout-diagnosis
description: Diagnose cron jobs that time out at model-call-started phase by tracing the LLM invocation, checking model availability, and fixing timeout-model mismatches.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-13T14:10:00.000Z
---

## Workflow

1. **Identify the failed cron job.** Run `openclaw cron runs <job-id>` and scan for runs where `lastError` contains `model-call-started` and `timeout` — this phase means the LLM invocation itself is stalling, not the surrounding script logic.

2. **Trace the LLM invocation path.** Examine the script's `model` constant (e.g., `const MODEL = 'minimax:default'`) and compare it against the cron payload's `payload.model` field. A mismatch — or a model that the environment cannot reach — causes the call to hang indefinitely until the hard timeout fires.

3. **Check model availability.** Run the model selection outside cron: spawn a minimal prompt with the same model and observe whether it responds within the configured `timeoutSeconds`. If it hangs, the model is unreachable or rate-limited in the cron environment.

4. **Validate timeout-model pairing.** A 120-second timeout is insufficient for slower models (e.g., DeepSeek, M3) under load. Cross-reference typical response times:
   - MiniMax-default: ~20–60s
   - DeepSeek: ~30–120s under rate limiting
   - M3: ~60–180s for complex analysis
   Adjust `timeoutSeconds` upward or switch to a faster model in the script's `MODEL` constant.

5. **Verify the isolated session.** Cron jobs run in an isolated session environment. Confirm `openclaw` binary is on the PATH for that session, environment variables are loaded, and the cron entry's session ID is not stale.

6. **Re-test in cron context.** After adjusting model or timeout, re-run via `openclaw cron run <job-id>` (bypass queue, run immediately) and verify the job completes without a `model-call-started` timeout.

## Pitfalls

- ⚠️ **Swapping cron model without adjusting `timeoutSeconds`** — a 120s timeout remains after moving to a slower model, causing repeated `model-call-started` timeouts even though the model itself is reachable.

- ⚠️ **Running outside cron succeeds but inside fails** — the main session may have a warm connection or cached auth token, while the isolated cron session lacks it. Always test with `openclaw cron run <job-id>` to replicate the cron environment.

- ⚠️ **Misreading the error phase** — `model-call-started` is distinct from `exec` or `parse` phases. A timeout at `model-call-started` points to the LLM provider, not the script. Debugging script logic first wastes time.

- ⚠️ **Stale cron session** — if the cron job's session ID points to an expired or corrupted session, all model calls fail silently with `model-call-started` timeouts. Run `openclaw sessions list` and confirm the session is active.

- ⚠️ **Assuming the model is overloaded** — sometimes the model is fine but the cron job's script passes a prompt that is too large (e.g., embedding full memory files). Check token count before blaming the provider.
