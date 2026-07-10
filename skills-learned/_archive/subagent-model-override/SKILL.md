```skills-learned/subagent-model-override/SKILL.md
---
name: subagent-model-override
description: 如何在 spawn_config default 之外顯式指定 sub-agent 模型，包括 M3 override 模式
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T11:03:04.930Z
---

## Context

OpenClaw's `spawn_config` in `~/.openclaw/openclaw.config.json` sets a default model for all sub-agents (e.g., `"default": "MiniMax-M2.7"`). However, some tasks require a more powerful model (e.g., `MiniMax-M3`) for deep research.

The default spawn_config model applies unless explicitly overridden.

## Workflow

1. **Identify the default** — Check `spawn_config.default` in `openclaw.config.json`
2. **Determine needed model** — Task complexity drives model choice:
   - M2.7 (default): Routine tasks, simple tool calls, quick analysis
   - M3: Deep cross-file research, multi-dimensional analysis, source code archaeology
3. **Override in spawn call** — Pass the model name explicitly in `sessions_spawn`:
   ```js
   // ❌ WRONG — uses spawn_config default (M2.7)
   await sessions_spawn({
     model: "default",  // or omit model entirely
     ...
   });

   // ✅ CORRECT — explicitly overrides to M3
   await sessions_spawn({
     model: "MiniMax-M3",
     ...
   });
