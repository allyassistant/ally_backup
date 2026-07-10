---
name: subagent-m3-task-chunking
description: Decompose large M3 sub-agent tasks into parallel smaller units when long runtimes or high tool-call counts risk provider overload, spawning 3–5 focused sub-tasks that complete reliably with main-session verification.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-18T11:31:04.081Z
---

## Workflow

1. **Assess task complexity** — count distinct files, decision points, and estimated tool calls. If the task exceeds ~200 tool calls or 10 minutes of estimated runtime, trigger chunking.

2. **Decompose into 3–5 focused units** — split by file boundary, concern area, or phase. Each sub-task must be independently verifiable without cross-subtask state. Avoid interdependent sub-tasks that require sequential execution.

3. **Spawn sub-agents in parallel** via `sessions_spawn` — use the same model tier (M3) for all chunks unless a chunk is trivially scoped (then M2.7 is acceptable). Pass each sub-agent a compressed, self-contained context block.

4. **Wait for completion** — monitor each sub-agent's yield/poll cycle independently. Track which chunks complete vs. stall or timeout.

5. **Verify output independently** (critical step) — do NOT trust sub-agent completion reports at face value. Before presenting results to the user, the main session must spot-check the actual system state:
   - For file edits: `read` the modified files directly
   - For cron changes: run `cron get` or `cron list` to confirm payload updates
   - For config changes: verify the targeted config files contain the expected values
   Report only what you have independently confirmed.

6. **Merge and synthesize** — collect verified outputs from all sub-agents into a unified result. Flag any sub-agent that failed or produced unverifiable output.

## Pitfalls

- ⚠️ Spawning sub-agents with interdependent chunks — Chunk A must read Chunk B's output before proceeding, creating a sequential bottleneck that defeats parallelization. Always design chunks to be independently executable.

- ⚠️ M3 sub-agents report success optimistically — A sub-agent may report completion while actual system state remains unchanged (e.g., file write silently failed, cron payload not updated). Always run independent spot-checks before claiming success to the user.

- ⚠️ Sending too much context to each sub-agent — Over-compressed or over-bloated context causes token overflow or degraded output quality. Pre-gather only the minimum files each chunk needs before spawning.

- ⚠️ No timeout per chunk — If individual sub-agents lack a timeout, a stalled chunk can block the entire pipeline. Set a reasonable per-chunk timeout and fail fast if exceeded.

- ⚠️ Assuming all chunks succeeded because most did — A 4-of-5 success rate still means one chunk silently failed. Always enumerate each chunk's status individually before synthesizing.

## Edge Cases

- **All chunks fail**: Fall back to running the task in the main session, or chunk more aggressively (2–3 sub-tasks of smaller scope).

- **Sub-agent yields with partial output**: Read the partial output, reconstruct meaning, and report what was verified. Do not fabricate completion.

- **Token overflow during spawn**: Apply adaptive thinking fallback (reduce context scope) before respawning. Never blindly retry with the same context budget.

- **User explicitly wants single-sub-agent**: Respect the explicit instruction. Chunking is a reliability optimization, not a hard requirement.

## References

- `context-gather-subagent-orchestrate` — Pre-gather context before spawning
- `subagent-m3-reliability` — Diagnose and fix M3 sub-agent failures
- `subagent-fallback-chain` — Execute fallback chains on sub-agent failure
- `subagent-context-overflow-recovery` — Recover from token overflow at sub-agent spawn
