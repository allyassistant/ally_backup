---
name: openclaw-pattern-verification
description: Verify an OpenClaw integration pattern works by checking docs and source.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-23T06:30:00.000Z
---

## Workflow

1. **Clarify the verification scope** with the user. Ask: "Which OpenClaw patterns do you want to verify?" and "What is the target system (plugin, API, config, etc.)?" Collect a numbered list of patterns (e.g., 4 patterns from DeepAgents).

2. **Locate the OpenClaw documentation directory** by running:
   ```bash
   # Detect install path (npm global vs brew vs local)
   npm list -g openclaw 2>/dev/null | head -3
   find /opt/homebrew/lib/node_modules/openclaw -name "*.md" -maxdepth 3 2>/dev/null | head -20
   ```
   Common paths: `/opt/homebrew/lib/node_modules/openclaw/docs/` (brew), `~/.openclaw/` (config), `node_modules/openclaw/docs/` (npm).

3. **Spawn an M3 sub-agent** via `sessions_spawn` with the verification task. Include in the prompt:
   - The numbered list of patterns to verify
   - The OpenClaw docs directory path
   - Instruction to read each relevant doc, check source code if needed, and return a table with columns: Pattern | Verdict | Evidence (file:line or doc section)

4. **Receive sub-agent results** via `sessions_yield`. The sub-agent should produce a structured verdict table like:
   | # | Pattern | Verdict | Evidence |
   |---|---------|---------|----------|
   | 1 | AsyncSubAgent | ✅ YES | docs/tools/subagents.md — "sessions_spawn is non-blocking" |

5. **Synthesize findings** in the main session. Flag P0 blockers (NOT SUPPORTED patterns that break the plan), confirm supported patterns, and note any edge cases requiring workaround.

6. **Report to the user** in the target language (Cantonese/English per user preference). Present the verdict table, then a summary section grouping patterns by action: ✅ Already supported, ⚠️ Workaround needed, 🔴 Not supported.

## Pitfalls

- ⚠️ OpenClaw docs not at expected path — brew installs to `/opt/homebrew/` while npm may use `/usr/local/lib/`. If `cat` returns empty, re-run the path detection in step 2 before concluding docs are missing.

- ⚠️ Verdict based on docs alone — some features are implemented but undocumented (e.g., `gateway.reload.mode`). Always cross-check with source code (`find . -name "*.js" | xargs grep -l "feature_name"`) when docs are ambiguous.

- ⚠️ Mismatched OpenClaw version — docs reflect a newer version than what is running. Check `cat /opt/homebrew/lib/node_modules/openclaw/package.json | grep '"version"'` or `openclaw --version` before reading docs, and note version drift in the verdict.

- ⚠️ Ally's own config as evidence — if Ally has already implemented a pattern (e.g., in `spawn_config.js`), that proves the feature works but does not prove it is documented or officially supported. Distinguish "works in practice" from "documented behavior".

- ⚠️ Treating "not documented" as "not supported" — when a pattern is not in docs, always search the source code (`grep -r "pattern" node_modules/openclaw/src/`) before concluding NO. Many internal APIs are functional but undocumented.

- ⚠️ Sub-agent token overflow during large doc scan — if the sub-agent yields with a token limit error, fall back to targeted doc reads per pattern rather than full-directory scans. Use `subagent-context-overflow-recovery` to handle partial results.

## References

- OpenClaw docs structure: `docs/concepts/` (session, delegate-architecture, multi-agent, agent-loop), `docs/tools/` (subagents, memory), `docs/config/` (model config, plugin hooks)
- Source code root: `node_modules/openclaw/src/` — useful for grep verification when docs are incomplete
- Key concepts: `sessions_spawn` (non-blocking, returns runId), `sessions_yield` (completion event), `gateway.reload` (config hot-reload)
