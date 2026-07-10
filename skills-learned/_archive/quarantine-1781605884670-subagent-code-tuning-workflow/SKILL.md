---
name: subagent-code-tuning-workflow
description: Delegate surgical script edits to M3 sub-agents one fix at a time, verifying each fix with runtime tests before moving to the next.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-16T10:31:01.226Z
---

## Workflow

1. **Define the exact patch scope before spawning.**
   Write the task prompt with three clearly separated sections:
   - `## Task` — state EXACTLY what to change (file path, line range, oldText, newText)
   - `## Scope boundary` — explicitly list what is IN scope and what is OUT of scope
   - `## Verification required` — specify the exact verification commands to run

   Example scope boundary block:
