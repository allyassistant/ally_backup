---
name: subagent-spawn-context-overflow-prevention
description: Prevent context overflow at sub-agent spawn time by checking token budget, detecting repeated workflow executions, compressing history, and applying adaptive thinking fallback. Also avoid parallel sub-agent Token Plan budget exhaustion by distributing quota across concurrent sessions.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-18T14:31:04.724Z
---

## Workflow

1. **Check main-session token budget before spawning** — Run `exec` to estimate current token usage. If total is within 60% of the model's context window, proceed; otherwise defer spawning to avoid overflow.
2. **Detect repeated workflow executions** — Scan conversation history for 3+ consecutive identical tool-call sequences (`exec → sessions_spawn → sessions_yield`). If found, assume the agent is in a loop and break it by responding directly instead of spawning a sub-agent.
3. **Distribute budget for parallel sub-agents** — When spawning multiple sub-agents simultaneously, calculate per-agent budget as `(total_token_plan / number_of_concurrent_sessions) * 0.8` to leave headroom. Never spawn more than 2 parallel sub-agents without verifying each has ≥15% of total budget.
4. **Compress spawn context** — Before passing context to `sessions_spawn`, trim redundant tool call logs older than 5 turns and replace repeated `exec` listings with a summary like `[N exec calls for fileX]`.
5. **Apply adaptive thinking fallback** — Set `"thinking_tokens"` to 0 or `"budget": "low"` in spawn config when total Token Plan is below 30% capacity. This prevents the sub-agent from burning budget on thinking when tokens are scarce.
6. **Yield with progress check** — After `sessions_yield`, verify the sub-agent returned substantive output, not just `HEARTBEAT_OK` or empty response. If yield returns empty or token-limit error, read partial files output by the sub-agent to salvage findings.
7. **Monitor Token Plan usage limit errors** — If sub-agent returns with Token Plan usage limit error (`Token Plan usage limit reached`), check for partial files written by the sub-agent before it died. These files may contain partial findings worth surfacing to the user.

## Pitfalls

- ⚠️ Spawning 3+ parallel M3 sub-agents without budget distribution — each gets ~33% of total, but if any has high tool-call count (30+ calls), all 3 hit Token Plan limit simultaneously and produce zero output.
- ⚠️ Token Plan is a **shared pool across all concurrent sessions** — spawning 3 sub-agents means they compete for the same budget. A single sub-agent using 50% of budget can kill the other 2 before they produce any output.
- ⚠️ Sub-agent that dies from Token Plan limit may have written useful partial findings to files before death — always check `tmp/` and partial output files before declaring the sub-agent a total loss.
- ⚠️ Adaptive thinking fallback must be set **before** spawn, not after — you cannot retroactively reduce a sub-agent's token usage mid-execution.
- ⚠️ Token budget pre-check on main session is not enough — the sub-agent inherits the main session's Token Plan **consumption so far**, meaning heavy main-session activity reduces budget available to sub-agents even if context window is small.
- ⚠️ A sub-agent that yields `Token Plan usage limit reached` may appear to have failed completely, but its `tool_calls` count (e.g. 35-49 calls) shows it was actively working — the budget exhaustion is not about prompt size but about tool call execution costs.
- ⚠️ When multiple sub-agents from different spawn events all hit Token Plan limit in the same conversation, this strongly indicates the main session's Token Plan is too near capacity to support any sub-agent work — stop spawning, not work around.
