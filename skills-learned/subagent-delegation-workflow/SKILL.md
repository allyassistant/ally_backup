---
name: subagent-delegation-workflow
description: Delegate analysis or execution tasks to M3 sub-agents with auto-announce results, then retrieve and synthesize without polling.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-12T16:01:01.234Z
---

## Workflow

1. **Prepare task context.** Gather all files, issue content, and requirements the sub-agent needs. Compress long context with `head -c` or `tail` on relevant files to stay within token budgets.

2. **Check token budget before spawning.** Run `sessions_spawn` with a token budget check. If the prompt exceeds available tokens, compress context further or split into smaller sub-tasks.

3. **Spawn M3 with auto-announce context.** Use `sessions_spawn` with this exact context header:
   - Set `depth` to `1/1` (single-level delegation)
   - Include `"Results auto-announce to your requester; do not busy-poll for status."`
   - Pass the full task description, background, specific check items, and desired output format

4. **Wait for auto-announce.** The sub-agent will yield results automatically when complete. Do not poll or re-query — the results arrive via the normal response channel.

5. **Retrieve and synthesize.** Read the sub-agent's results from the response. Synthesize into a final answer for the user, noting what was delegated and what the sub-agent produced.

## Pitfalls

- ⚠️ Sub-agent crashes without auto-announcing — results silently lost. Before spawning, verify M3 sub-agent reliability. If spawning fails, fall back to direct exec in the main session.
- ⚠️ Prompt overflow causes token limit errors — sub-agent yields with partial output. Pre-check token budget before spawning. Use `sessions_spawn` availability check to confirm M3 is reachable.
- ⚠️ Main session and sub-agent operate in different working directories — relative file paths break. Use absolute paths (`~/.openclaw/workspace/...`) in sub-agent prompts, or include a `cd` step in the task description.
- ⚠️ Task too broad causes sub-agent to take a wrong approach. Break the task into explicit numbered check items (e.g., "Step 1: check X, Step 2: check Y") rather than a vague goal description.
- ⚠️ Spawning a sub-agent for a task the main session could handle faster. Only delegate to M3 when the task requires deep analysis, multi-file scanning, or cross-cutting investigation that benefits from M3's quality.
