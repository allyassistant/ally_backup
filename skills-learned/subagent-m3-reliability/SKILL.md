---
name: subagent-m3-reliability
description: Diagnose and fix M3 sub-agent failures from limits and overload. Includes parameter validation, token recovery, and fallback strategies.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T15:01:47.884Z
---

## Workflow

1. **Detect the failure mode** — M3 sub-agent returns without output, truncates mid-stream, or hits a quota error. Check `sessions_yield` result for empty `output` field or `"error"` signal.

2. **Validate parameters before respawn** — Common incompatibility: `thinking: high` is not supported on MiniMax M3. If the spawn used `thinking: high`, respawn with `thinking: adaptive` or omit the parameter entirely. Do not retry the same params.

3. **Apply token budget pre-check** — Before spawning, estimate expected token usage. If the task requires deep reasoning on a large codebase, set `thinking: adaptive` and a generous `maxTokens` buffer. Respawning after an overflow wastes quota.

4. **Recover partial output on overflow** — If the sub-agent yielded with token limit errors, read the partial output from the sessions store. Reconstruct the meaning from what was written before truncation. Communicate results to user rather than failing silently.

5. **Fall back to M2.7 on persistent M3 failures** — If M3 fails 3 times (quota, overload, param incompatibility), fall back to the primary model via `sessions_spawn` without model specification. Document the fallback in the session summary.

6. **Post-failure cleanup** — After recovery, verify the sessions store does not retain stale partial output that could contaminate the next spawn. Run a `sessions_yield` check to confirm clean state.

## Pitfalls

- ⚠️ Retrying with identical params after M3 failure — if the failure was caused by an unsupported parameter (e.g. `thinking: high`), repeating the same spawn call will fail again. Always modify params before retrying.
- ⚠️ Missing token budget check before spawning M3 for large-codebase analysis — M3 sub-agent yields with `"finish_reason": "length"` without warning, leaving the session in a zombie state. Pre-check file sizes and set adaptive thinking.
- ⚠️ Not reading partial output after token overflow — the sub-agent may have produced 80% of the analysis before truncating. Silently discarding it wastes the quota entirely. Always `read` the sessions store after overflow.
- ⚠️ Spawning M3 during a main-session HEARTBEAT_OK loop — if the main session is already in a heartbeat-ping loop, spawning a sub-agent will not resolve it. Break the main loop first using `main-session-execution-loop-recovery`.
