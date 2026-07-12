---
name: sessions-spawn-availability-check
description: Detect sessions_spawn unavailability and gracefully fall back to direct exec or async yield when sub-agent spawns are blocked.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-12T02:01:01.243Z
---

## Workflow

1. Attempt the spawn call with sessions_spawn, wrapped in a try-catch.
2. On `Tool not available` or `doesn't have access to that tool` error, do NOT retry — the tool is absent from this session context, not temporarily throttled.
3. Fall back to one of:
   - **Direct exec**: run the script inline via `exec` or `execSync` with the full command string, capturing stdout/stderr directly.
   - **Async yield**: stop retrying, return a structured error to the user noting sessions_spawn is unavailable in this context, and suggest the fix (run the command manually or reschedule in a session with spawn access).
4. If fallback is direct exec, pipe the output into the next pipeline step as if sessions_spawn had returned it.
5. If the cron job or automation expects sessions_spawn output format (JSON fields like `sessionId`, `status`), simulate the relevant fields in the fallback response so downstream steps do not break.

## Pitfalls

- ⚠️ Retrying sessions_spawn in a loop after the first "tool not available" error — the tool is context-absent, not rate-limited; retries waste cycles and eventually timeout. Catch on the first call and branch immediately.
- ⚠️ Falling back to direct exec without capturing stderr — the original error message (e.g. "Cron Failure Watcher: permission denied on /tmp/alert.lock") is lost, making downstream debugging impossible. Always capture stderr alongside stdout.
- ⚠️ Scheduling cron jobs that require sessions_spawn in isolated shadow sessions — shadow sessions strip tool access by design. If a cron task uses sessions_spawn, it must run in a full-context session, not a shadow session.
- ⚠️ Assuming sessions_spawn unavailability is a one-time credential issue — it is a session-type boundary; the same cron job will fail identically every run unless the session type is changed.
- ⚠️ Ignoring sessions_spawn errors in batch/parallel sub-agent pipelines — a single unavailability error in a parallel dispatch can silently orphan that track. Wrap each parallel branch individually with the availability check.
