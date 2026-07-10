---
name: multi-phase-m3-plugin-orchestration
description: Build OpenClaw plugins through a 3-phase sub-agent pipeline (feasibility → design → implementation).
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-16T16:01:00.000Z
---

## Workflow

1. **Identify the plugin need** — Confirm the target is an OpenClaw plugin (hook/plugin SDK required) and not solvable by a script or cron alone. If the pattern fits Claude Code's loop (hooks + subagents), OpenClaw plugin is the right delivery vehicle.

2. **Phase 1 — Feasibility (spawn M3)** — Spawn a single M3 sub-agent (`taskName: <plugin-name>-feasibility`) with:
   - The article/link context as source material
   - Instruction to read actual OpenClaw SDK source files (`src/plugin-sdk/`) and verify hook names, tool names, manifest format
   - Output: a feasibility matrix comparing the source pattern to OpenClaw's actual primitives
   - `yield` for completion, then read results

3. **Phase 2 — Design (spawn M3)** — Spawn a second M3 sub-agent (`taskName: design-<plugin-name>`) with:
   - The feasibility results as prerequisite context
   - Explicit instruction: **do NOT create files on disk** — output complete design inline in the response
   - Include SDK corrections from Phase 1 (manifest format, actual hook names, fire-and-forget constraints)
   - Output: complete file contents inline, organized by file, ready to write

4. **Phase 3a — Parallel Implementation (spawn M3 agents)** — If the design has ≥2 independent deliverable groups (e.g., core files + docs/tests), spawn M3 agents in parallel:
   - Each agent gets a **partitioned deliverable set** (not the full design)
   - Each agent writes its assigned files to the correct extension directory
   - Example partitions: Agent 1 = `index.mjs` + `openclaw.plugin.json` + `package.json`; Agent 2 = `fixer-prompt.md` + `README.md` + tests

5. **Phase 3b — Single Implementation (no parallelism)** — If the design has ≤2 files, spawn one M3 sub-agent to write all files directly. Skip parallelization overhead.

6. **Validate written files** — After each sub-agent completes, run `node --check <file>` on `.mjs`/`.js` files and JSON parse check on manifest files. Report pass/fail per file.

7. **Commit** — If the user says "commit 埋" (commit it), run git operations in the workspace. Include a meaningful commit message referencing the plugin name and phase.

## Pitfalls

- ⚠️ M3 design agent creates files on disk when told not to — explicitly say "do NOT create or modify any files on disk" in the task prompt; sub-agents sometimes ignore this instruction when they have write tools available
- ⚠️ Truncated M3 output — large design reports (20k+ tokens) get truncated in session history; use `sessions_history` tool to fetch complete messages, not just the final summary
- ⚠️ `agent_end` hook fire-and-forget — OpenClaw's `agent_end` hook has a 30s timeout and is fire-and-forget; you CANNOT wait for a spawned sub-agent to complete inside an `agent_end` hook; use `api.runtime.subagent.run({ deliver: false })` instead
- ⚠️ JSON manifest required, not YAML — OpenClaw's plugin loader uses Zod validation and does NOT accept YAML manifests; always use `openclaw.plugin.json`, not `manifest.yaml`
- ⚠️ Tool names differ from Claude Code — OpenClaw's edit tools are `edit`, `write`, `apply_patch`, NOT `edit_file`/`write_file`; M3 feasibility agent must verify actual names against `src/tool-registry.ts` or similar source
- ⚠️ OpenClaw SDK import path — the plugin entry import path is `openclaw/plugin-sdk/plugin-entry` (not `openclaw/plugin-sdk` or custom paths); verify this matches the actual package exports before spawning implementation agents
- ⚠️ Parallel agent file collisions — when spawning 2+ agents writing to the same extension directory, partition deliverables to avoid concurrent writes to the same file
