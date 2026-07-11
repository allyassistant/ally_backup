---
name: context-gather-subagent-orchestrate
description: "Pre-gather context for complex analysis tasks, spawn an M3 sub-agent, wait for completion, read results, and present structured output to the user. Use when: multi-file analysis is needed, context must be compressed before spawning, sub-agent output needs structured delivery. Key capabilities: gather files and context with exec, spawn sub-agent via sessions_spawn with compressed input, synthesize final answer from results."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T03:15:00.000Z
---

## Workflow

1. **Gather context files before spawning**
   Read all relevant source files (issues, reports, memory notes) into the main session context BEFORE spawning the sub-agent. This reduces the sub-agent's own context-gathering overhead and improves reliability.
   ```bash
   # Example: read all skill-reviewer related issues
   cat ~/.openclaw/workspace/issues/skill-reviewer/*.md | head -500
   ```

2. **Write task brief to `.spawn/reports/` input file**
   Create a structured input file the sub-agent will read, so the spawn prompt itself stays lean:
   ```bash
   mkdir -p ~/.openclaw/workspace/.spawn/reports
   cat > ~/.openclaw/workspace/.spawn/reports/task-brief.md << 'EOF'
   ## Task
   [describe the goal]
   ## Context Files
   - issues/skill-reviewer/*.md (pre-read)
   ## Expected Output
   - Single consolidated issue or execution plan
   - Write full report to .spawn/reports/output-YYYY-MM-DD.md
   - Send summary to Discord #channel
   EOF
   ```

3. **Spawn M3 sub-agent with brief prompt**
   Keep the spawn prompt minimal — reference the input file rather than inlining all context:
   ```javascript
   await sessions_spawn({
     model: "M3",
     prompt: "Read ~/.openclaw/workspace/.spawn/reports/task-brief.md and execute the task. " +
       "Write full output to .spawn/reports/output-YYYY-MM-DD.md and send Discord summary."
   });
   ```

4. **Yield and wait for completion**
   Use `sessions_yield` to wait for sub-agent completion — do NOT poll with busy loops:
   ```javascript
   await sessions_yield();
   ```

5. **Read sub-agent output**
   ```bash
   cat ~/.openclaw/workspace/.spawn/reports/output-YYYY-MM-DD.md
   ```

6. **Send summary to Discord**
   Extract the executive summary (first ~300 words) and send to the relevant Discord channel:
   ```bash
   curl -X POST "$DISCORD_WEBHOOK" \
     -H "Content-Type: application/json" \
     -d '{"content": "📋 **Sub-agent Report**\n\n<summary here>"}'
   ```

7. **Present to user**
   Synthesize the findings into a concise summary with key decisions and next steps. Include the Discord message link if applicable.

## Pitfalls

- ⚠️ **Main session context overflow before spawn — `Context overflow: prompt too large (precheck)`** — When the main session accumulates too much history (e.g., after multiple heavy conversations), spawning M3 fails at the precheck stage before the sub-agent even starts. Symptom: `Context overflow: prompt too large for the model (precheck)` from `sessions_spawn`. Recovery: spawn with a minimal prompt referencing external files (step 2–3), or use a fresh isolated session for the spawn. Do NOT attempt to inline all context into the spawn prompt — write to disk and reference instead.

- ⚠️ **Sub-agent output too large for main session to read** — If the sub-agent writes a very large report (e.g., 890 lines), reading it back with `cat` into the main session can itself cause token pressure. Mitigation: always `head -200` or `tail -50` when reading large reports, or have the sub-agent write a separate `summary.md` under 200 lines.

- ⚠️ **Sub-agent partial completion without error** — M3 sub-agents may complete without throwing but produce truncated or incomplete reports. Check that the output file exists and has expected content (e.g., line count > 50) before presenting to user. If the report is incomplete, re-spawn with more explicit scope boundaries.

- ⚠️ **Discord delivery in sub-agent scope** — Sub-agents typically do NOT have `message` or `exec` webhook tools. Always have the MAIN session handle the Discord delivery step (step 6) after reading the sub-agent's output. Sub-agents should write to `.spawn/reports/` and signal completion; main session reads and delivers.

- ⚠️ **Stale task-brief.md from previous run** — If the input file already exists from a prior run, the sub-agent may read old context. Always write a fresh timestamped brief (step 2) and clear or overwrite old output files.

- ⚠️ **Spawn with `model: "M3"` when M3 is already rate-limited** — If M3 is overloaded (API overload error), the spawn call fails silently or returns NO_REPLY. Check for M3-specific rate-limit handling; consider falling back to M2.7 for non-critical analysis tasks.
