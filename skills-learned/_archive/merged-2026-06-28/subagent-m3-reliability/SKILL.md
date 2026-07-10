---
name: subagent-m3-reliability
description: Recover from M3 sub-agent Token Plan quota failures by detecting the limit signal, reading partial output, scheduling a retry, and synthesizing cross-session results when quota resets.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-18T16:31:04.320Z
---

## Workflow

1. **Detect Token Plan limit hit** — when sub-agent returns with `ToolCallsLimitExceeded`, `planUsageLimit`, or provider returns a 429/overload before completing its task. The sub-agent's final message may be truncated mid-sentence or contain quota error.

2. **Read sub-agent partial output before yield completion** — use `exec` to cat the sub-agent's scratch file or memory log. Even incomplete results contain actionable findings (e.g. "3 of 4 P0 bugs found"). Do not discard partial output.

3. **Classify the failure point**:
   - If sub-agent completed >60% of its task → note remaining work, no re-spawn needed
   - If sub-agent completed 30–60% but task can be split → spawn a narrower follow-up sub-agent with only the unfinished portion
   - If sub-agent completed <30% → treat as full failure; wait for quota reset before re-spawn

4. **Write partial results to memory** — preserve what was learned so far with an explicit `TODO: <remaining work>` marker. This prevents the partial audit from being forgotten when the session yields.

5. **Wait for quota reset** — MiniMax quota resets at midnight. Track by `exec('date +%s')` and calculate remaining time. Do NOT attempt re-spawn within the same quota window unless the failure was due to a different plan bucket.

6. **Re-spawn follow-up sub-agent after quota reset** — pass the partial results + remaining work as context. Use `thinking: high` for the follow-up since `adaptive` may also count toward quota.

7. **Synthesize results** — combine the pre-limit partial findings with the follow-up completion. Check for contradictions where the partial analysis made incorrect assumptions that the full analysis corrected.

## Pitfalls

- ⚠️ Token Plan limit vs provider 429 are different — Token Plan hits silently mid-call while 429 rejects at spawn time. `subagent-fallback-chain` handles 429 retry with provider isolation; Token Plan requires quota wait.
- ⚠️ Assuming partial output is complete — sub-agents truncated mid-sentence may have unfinished JSON or file edits. Always verify syntax of any partial file writes before depending on them.
- ⚠️ Re-spawning before quota reset causes double-failure — two consecutive Token Plan failures in <60s suggests you are still in the same quota window. Use `date +%s` to confirm >23h since last reset.
- ⚠️ `adaptive` thinking mode counts differently than `high` — switching to `high` does not avoid the Token Plan limit if the plan is shared across both modes.
- ⚠️ Parallel sub-agents compound quota exhaustion — 3 simultaneous M3 sub-agents each consume from the same Token Plan; if one hits the limit, the other two may also fail mid-call. Use `subagent-m3-task-chunking` to serialise or reduce concurrency.
- ⚠️ Memory markers may be lost after yield — if the main session crashes or restarts, the `TODO` markers in memory files are the only record. Write them to a persistent location like `memory/` not session-scoped transient context.
- ⚠️ Partial results can contain confident-but-wrong conclusions — sub-agents that fail at 60% may have already jumped to a wrong root cause. Cross-check against the follow-up results before acting on their recommendations.


## Absorbed from `subagent-quality-gating` (2026-06-20)

> **Provenance:** score=?, verdict=MERGE, merged via `scripts/merge_skills.js`
> **Original location:** `subagent-quality-gating/SKILL.md` (now in `_archive/merged-2026-06-20/subagent-quality-gating/`)

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
