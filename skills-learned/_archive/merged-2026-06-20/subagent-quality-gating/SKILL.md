---
name: subagent-quality-gating
description: Detect sub-agents that stall on trivial tasks by monitoring tool call density and output quality, triggering early abort before resource exhaustion.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-18T03:31:01.233Z
---

## Workflow

1. **Check task complexity before spawning.** If the task is a simple extract/summarize (≤3 sentences, no multi-file analysis, no architecture review), do NOT spawn an M3 sub-agent — handle inline instead.
2. **Monitor `toolCalls` count per output round.** If `toolCalls >= 10` within a single assistant turn, the sub-agent is likely looping. Flag immediately.
3. **Track HEARTBEAT_OK ratio.** If the sub-agent returns `HEARTBEAT_OK` in ≥3 consecutive turns without producing a user-visible response, trigger abort sequence.
4. **Detect trivial-loop pattern.** When a sub-agent has ≥30 total tool calls with zero structured output (no JSON, no file writes, no meaningful text), abort and fall back to inline processing.
5. **Fallback to inline.** When abort triggers, cancel the sub-agent session and re-execute the original task directly in the main session with a tight scope.

## Pitfalls

- ⚠️ Spawning M3 sub-agents for trivial summarization tasks — a 2-sentence Rapaport email summary should never trigger a 48-call/190-turn sub-agent run; the spawn overhead exceeds the task cost.
- ⚠️ Confusing HEARTBEAT_OK stalling with genuine long-running analysis — some tasks legitimately need many tool calls; the discriminator is **output quality**, not call count alone.
- ⚠️ Failing to abort when sub-agent returns only `HEARTBEAT_OK` — the loop continues consuming tokens; context must be recovered before continuing.
- ⚠️ Spawning sub-agents without checking if the task can be answered inline — `subagent-context-overflow-recovery` handles token limits, but simple tasks should never reach sub-agent phase.
