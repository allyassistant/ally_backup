---
name: main-session-execution-loop-recovery
description: Detect and recover from HEARTBEAT_OK loops where the session ignores user tasks. Break the loop, identify the pending request, execute it manually, restore normal flow.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-15T08:01:01.230Z
---

## Workflow

1. **Detect loop signal** — Monitor for ≥2 of these indicators within 5 turns:
   - Assistant outputs `HEARTBEAT_OK` without preceding exec call from user request
   - Same user question appears in consecutive turns (exact string match on transcript USER: line)
   - Tool calls list shows only `exec` with no `edit`, `write`, `read`, `browser` after user instruction
   - Successive responses are identical within 80% edit distance

2. **Identify the pending user request** — Scan the last 3 user messages. Find the one that contains an actionable instruction (spawn, analyze, summarize, fix, migrate) rather than a status inquiry. Extract the core verb + object.

3. **Break the loop** — Output a deliberate diversion:
