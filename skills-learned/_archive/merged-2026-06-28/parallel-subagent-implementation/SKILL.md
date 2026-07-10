---
name: parallel-subagent-implementation
description: Spawn 2–3 focused M3 sub-agents in parallel to analyze different aspects of a complex task, yield for completion, and synthesize results into a unified answer.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-19T04:33:43.792Z
---

## Workflow

1. **Decompose task into independent slices** — Identify 2–3 non-overlapping aspects that can be analyzed in parallel. E.g., for code migration: one agent does surgery, another does real bug fixes. For feature design: one agent does feasibility, another does concrete design.

2. **Spawn each M3 sub-agent with tight scope** — Use `sessions_spawn` for each agent. Pass compressed context (key files only), explicit line bounds (e.g., `index.mjs:367-460`), and a concrete deliverable specification. Include the exact file path, line range, and what constitutes success.

   ```javascript
   // Pattern for each spawn
   await sessions_spawn({
     agent_id: `m3-${AGENT_NAME}`,
     task: `You are a Node.js engineer. Task: ${SCOPE}. File: ${FILE_PATH}. Lines: ${LINE_RANGE}. Criteria: ${SUCCESS_CRITERIA}.`
   });
   ```

3. **Yield for parallel completion** — After all spawns, enter a yield/poll loop. Use `sessions_yield()` to wait for sub-agent results. Do NOT busy-poll — yield once per agent round-trip. For 2 agents, expect ~2–3 yields total before both complete.

4. **Read results from each sub-agent** — When `sessions_yield` returns a result, read the output directly or via `sessions_result`. Each agent produces a structured report with per-file changes, test results, and status.

5. **Synthesize into unified response** — Combine results from all agents:
   - Per-file change summary from each agent
   - Any conflicts or overlaps between agents' changes
   - Overall pass/fail status and next steps
   - Determine if re-spawn is needed for partial completion

6. **Verify with smoke tests** — Run the project's test suite (`npm test` or equivalent) after both agents have completed. If any agent failed, re-spawn with adjusted scope before verification.

## Pitfalls

- ⚠️ Token Plan budget exhaustion from parallel agents — 3 parallel M3 agents can burn through 60%+ of a Token Plan quota in one burst, leaving none for subsequent conversation turns. Distribute quota across agents by reducing max_tokens per agent or spawning sequentially for large tasks.
- ⚠️ File contention when two agents target the SAME file — If agent A surgery and agent B bug fix both touch `index.mjs`, their changes can conflict. Always partition work by file or by clear line bounds to avoid merge conflicts.
- ⚠️ yield/poll deadlock if one agent stalls — A single long-running agent can block the entire yield loop. Set a reasonable timeout on each spawn and monitor progress. If one agent exceeds expected runtime, re-spawn it with a reduced scope rather than waiting indefinitely.
- ⚠️ Context overflow from concatenating 3 agent reports — Each M3 agent's final report can be 3–8KB. Combining 3 reports plus the main session context can exceed 32K tokens. Compress or summarize each report before inclusion in the final response.
- ⚠️ Results arriving out of order — Agents complete at different speeds; the faster agent's results are read first. Do not assume completion order — always check result status and completeness, not just arrival order.
