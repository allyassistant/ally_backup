---
name: subagent-context-overflow-recovery
description: 當 M3 sub-agent 因 token 限制崩潰時，手動直接執行而不依賴 sub-agent 的 fallback 工作流
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T05:32:25.236Z
---

## Workflow

1. **Detect the overflow**: M3 sub-agent session returns truncated output, ends mid-thought, or session history shows cut-off message. Common indicator: output ends mid-sentence or mid-table with no closing fence.

2. **Check if results were saved**: Before doing anything else, check for an intermediate results file:
   ```bash
   ls -t ~/.*.json ~/.*.txt ~/.*.md 2>/dev/null | head -5
   ```
   If a recent file matches the sub-agent's task, read it directly.

3. **Read the truncated message**: Pull the inter-session message that sub-agent auto-announced:
   ```bash
   sessions history <session-id> --last 2
   ```
   Identify where the truncation occurred (mid-Q1, mid-analysis, etc.).

4. **Assess recovery strategy**:
   - **Results file exists** → read it, integrate findings, done.
   - **Results file missing + partial visible** → use truncated content + your own domain knowledge to fill gaps. Do NOT re-spawn unless you genuinely lack the domain context.
   - **Both missing** → re-spawn with tighter scope (split the task).

5. **For deep-analysis sub-agents** (multi-section reports, multi-question analysis):  
   ⚠️ **This step must be in the sub-agent prompt** — add it explicitly when spawning:
   > "After each major section (Q1, Q2, etc.), write your partial findings to `~/.phase3_partial_<section>.json` before continuing. The main agent will read this if you hit output limits."
   
   This prevents total loss when truncation hits mid-output.

6. **Fallback execution**: If the sub-agent failed entirely, execute the task directly in the main session:
   - Read the source files yourself
   - Perform the analysis
   - Report conclusions directly to the user

7. **Post-recovery**: Update the relevant issue or status file with findings. If the sub-agent failed to save a status update, do it manually.

## Pitfalls

- ⚠️ **Deep-analysis sub-agents hit output limits before saving** — M3 output token limit (~8K chars) is easily exceeded by multi-section reports. Sub-agents doing Q1/Q2/Q3 analysis MUST write partial results to disk after each section, or the main agent has no recovery path when truncation hits mid-output. Always include the save-step instruction in the spawn prompt for analysis tasks.

- ⚠️ **Inter-session message truncation** — `sessions_history` shows only the truncated final message, not the full analysis. If the sub-agent didn't save results to disk, you cannot reconstruct the full output from session history alone. Always check for results files first.

- ⚠️ **Main agent domain knowledge can fill gaps** — after truncation, the main agent often knows enough to complete Q2/Q3/Q4 from context (e.g., Phase 3 decision analysis). Do NOT reflexively re-spawn; first assess whether you can fill the gap with existing knowledge. Re-spawning burns another M3 quota and risks the same truncation.

- ⚠️ **Same task re-spawned without tighter scope** — if a sub-agent fails because the task is too broad, re-spawning with the identical prompt will fail the same way. Split the task: spawn one sub-agent per question/angle, keep each scope narrow enough to complete within output limits.

- ⚠️ **Sub-agent output parsing assumes complete JSON** — if the sub-agent was outputting a JSON summary block and got truncated mid-block, the partial JSON is unparseable. Always write structured results to a separate file (not stdout) for analysis tasks.
