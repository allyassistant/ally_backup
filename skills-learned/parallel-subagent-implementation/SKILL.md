---
name: parallel-subagent-implementation
description: Spawn multiple parallel M3 sub-agents to implement multi-track changes simultaneously, coordinate their outputs, and merge into a unified result.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T06:01:05.335Z
---

## Workflow

1. **Define non-overlapping scopes** before spawning. Split the full task into 2-4 parallel tracks with zero scope overlap. Example: "short-term actions (tonight→7d)" vs "medium-term roadmap (1-4 weeks)". Non-overlapping scopes prevent M3 from duplicating analysis and exhausting output tokens.

2. **Spawn each sub-agent with a tightly scoped prompt**. Include:
   - Explicit scope boundary (what this agent MUST NOT cover)
   - Files to read first (relative paths from `~/.openclaw/workspace/`)
   - Output format expected (bullet list, table, JSON)
   - Explicit instruction: "do not busy-poll for status — results auto-announce"

3. **Omit `thinking: "high"` flag** unless explicitly required. M3 sub-agents do not reliably handle this flag — it causes failures. Use default thinking level and keep prompts concise instead.

4. **Call `sessions_spawn` for each track** in parallel (batch the spawn calls). Track all returned session IDs.

5. **Call `sessions_yield`** to wait for all sub-agents to complete. Do NOT poll manually — yield handles the wait.

6. **Call `sessions_history`** for each completed session ID to retrieve results. Read outputs in order of expected priority.

7. **Merge outputs** into a unified report in the main session. Structure as:
   - Summary table (priority | action | time estimate | owner)
   - Per-track detail sections
   - Outstanding items requiring human decision

8. **Update master issue** with merged findings using `edit`. Add new progress rows, decision records, and any new questions raised.

## Pitfalls

- ⚠️ **Scope overlap** — if two sub-agents both analyze "cron wiring", they duplicate effort and one may timeout. Always define scope boundaries explicitly in each prompt.

- ⚠️ **`thinking: "high"` flag causes M3 sub-agent failure** — observed 2026-06-13: sub-agent with `thinking: "high"` spawned but failed silently. Retry without the flag succeeded. Do not use this flag with M3 sub-agents.

- ⚠️ **Output token exhaustion** — M3 sub-agents have ~8K output token limits. If a single agent is asked to cover too much territory (e.g., "analyze all next steps"), it will truncate mid-output. Split into scope-limited agents instead.

- ⚠️ **Not reading files before analyzing** — sub-agents that skip the "read files first" step produce generic advice. Include explicit file list in prompt with instruction to read before analyzing.

- ⚠️ **Yield before all spawns complete** — `sessions_yield` must be called AFTER all `sessions_spawn` calls. Calling yield prematurely causes the main session to wait indefinitely.

- ⚠️ **Merging without source attribution** — when merging parallel outputs, keep track of which session ID produced which section. This enables follow-up questions to target the right sub-agent.
