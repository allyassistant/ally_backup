---
name: context-overflow-workflow-loop-recovery
description: Detect and recover from context overflow when exec workflows repeat 3+ times or cron-triggered pipelines stall, restoring useful work output.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-20T09:31:04.071Z
---

## Workflow

1. **Count HEARTBEAT_OK repetitions** — track consecutive `HEARTBEAT_OK` responses without a substantive reply. Threshold: 2 consecutive turns triggers recovery.

2. **Identify the stall type** — distinguish between:
   - **Loop overflow**: same exec command repeating verbatim 3+ times, model stuck in identical context
   - **Background detach**: cron-triggered pipeline launched with `SHADOW_MODE=true` or similar — work happens elsewhere, session has nothing to report
   - **Token exhaustion**: model unable to generate, returns only HEARTBEAT_OK

3. **For loop overflow** — inject a breaking prompt that forces reorientation:
   - Stop repeating the same exec command
   - Run `openclaw cron list` or `openclaw gateway status` to get fresh system state
   - Ask the user explicitly what to do next, breaking the auto-repeat cycle

4. **For background detach** — acknowledge the stall and check external state:
   - Run `openclaw cron runs <id>` to verify if the cron job actually executed
   - Check cron log output if accessible (`~/.openclaw/logs/`)
   - Report to user that the pipeline may be running in shadow mode with no visible output

5. **Restore context** — after breaking the loop, summarize what was attempted, what succeeded/failed, and ask for confirmation before retrying.

## Pitfalls

- ⚠️ Treating HEARTBEAT_OK as a failure signal — it is a suppression mechanism, not an error; the session is deliberately quiet, not broken
- ⚠️ Forcing a response when the pipeline genuinely has nothing to report — pushing output without new content degrades context; better to say "pipeline ran with no new output" than hallucinate progress
- ⚠️ Confusing background detach with loop overflow — detached pipelines are working correctly but silently; retrying them creates duplicate work rather than recovering a stuck loop
- ⚠️ Not checking cron execution logs when HEARTBEAT_OK follows a cron trigger — the work may have completed in the background without returning visible state to this session
