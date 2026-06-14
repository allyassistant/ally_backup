---
name: m3-root-cause-analysis
description: Workflow for using MiniMax M3 sub-agent to perform deep root-cause investigation and apply foundational fixes instead of surface patches
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T17:00:00.000Z
---

## Workflow

1. **Invoke M3 sub-agent explicitly** — Use the exact phrase pattern: "用MiniMax M3 sub agent 分析下呢個情況。有冇更加治本嘅方法" or similar Cantonese command that signals deep root-cause analysis (not quick fix)

2. **Define investigation scope** — Before spawning sub-agent, identify:
   - What symptom is being observed (e.g., "心跳正常 ✅" appearing unexpectedly, `this.color = ''` override, `window.onerror` hook)
   - What system components might be involved (scripts, runtime code, config files, session context)
   - What "治本" (root-cause fix) would look like vs. "治標" (symptom patch)

3. **Spawn sub-agent with focused task** — Delegate investigation to M3 sub-agent with clear brief:
