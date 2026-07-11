---
name: concurrent-session-rate-limit-avoidance
description: Diagnose and avoid same-model rate limit collisions between main session and cron agents when cron timeouts correlate with main session activity.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-11T02:30:00.000Z
---

## Workflow

1. **Identify the timeout signature.** Run `openclaw cron runs <id>` and check the last error message. A `model-call-started` timeout in the last phase means the model call initiated but never returned — classic rate limit gate-close, not a slow model.

2. **Cross-reference active sessions.** Run `openclaw session list` and note which provider/model each session uses. If the cron job's session uses the same provider+model as the main session, flag as suspected collision.

3. **Check queue depth before retry.** Before re-running the cron, run `openclaw queue list` to confirm the queue is not backed up. An empty queue guard prevents scheduling a model call into a blocked pipe. If the queue shows pending items, drain it first with `openclaw queue flush --dry-run`.

4. **Apply provider fallback or timeout adjustment.** Prefer adjusting `timeoutSeconds` upward (e.g., 120s → 180s) for the cron payload when the underlying issue is rate-limit latency rather than model speed. Alternatively, switch the cron session to a different model tier (e.g., DeepSeek instead of M2.7) to split the collision surface. Update via `openclaw cron update <id> --payload '{"model":"deepseek-chat"}'`.

5. **Isolate cron into its own session.** Create a dedicated session for the failing cron job with a different model assignment. This eliminates shared rate-limit buckets entirely. Use `openclaw session create --name "cron-isolated" --model <alt>` and update the cron entry to use that session ID.

6. **Re-run and verify.** Execute `openclaw cron run <id>` outside the schedule and confirm the model call completes. Monitor `openclaw cron runs <id>` for the next 3 executions to ensure the pattern breaks.

## Pitfalls

- ⚠️ model-call-started timeout without queue pre-check — the cron agent hangs waiting for a slot that will never open because the queue is blocked. Always run `openclaw queue list` before assuming it's a slow-model problem.

- ⚠️ Swapping cron model without adjusting timeoutSeconds — a 120s timeout stays in place after switching to a slower model (e.g., DeepSeek), causing the same timeout even though no rate limit collision remains. Recalibrate timeout to 1.5–2x the new model's expected p95 response time.

- ⚠️ Editing cron payload without refreshing openclaw cron list — stale job metadata hides the change; the update appears to have no effect because the CLI still shows the old payload. Always run `openclaw cron list` after an update to confirm the change persisted.

- ⚠️ Scheduling the same model in two cron jobs at overlapping times — two cron jobs using the same provider+model create a self-inflicted collision even when the main session is idle. Spread cron schedules by at least 10 minutes when sharing a model tier.

- ⚠️ Assuming model-call-started hang is always a rate limit — it can also be a network routing issue (gateway timeout), a bad API key silently rejected, or the sub-agent spawning into a session that is still processing a prior request. Check provider status dashboards and session health before attributing to rate limits.
