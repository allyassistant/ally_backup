# Upstream Source Filtering (extracted from skill-curation-pattern)

> **Provenance:** Section 1 of `skill-curation-pattern/SKILL.md` (pre-trim 2026-06-20).
> **Use when:** Understanding which conversations enter the skill curation queue and what the reviewer considers worth capturing.

Skill curation starts before the reviewer runs — at the plugin and prompt level. These upstream gates determine which conversations even enter the queue and what the reviewer considers worth capturing.

1. **Plugin-level channel exclusion** — The `agent_end` event plugin that writes to `.skill_review_queue.jsonl` should filter by channel ID. Maintain an `EXCLUDED_CHANNELS` Set in the plugin code with channel IDs that produce only noise (閒聊, cron notifications, daily reflections, translation tasks, search automation, weather queries, site monitoring, info broadcast, user questions about AI tools). As of 2026-06-06, 9 channels are excluded.

2. **Only 5 channel types produce useful skill material**:
   - `#🧑🏻💻編程` — coding workflows and debugging patterns
   - `#💼工作` — work processes and tool usage
   - `#🎓學習` — knowledge base ingestion
   - `#📺youtube` — analysis patterns
   - Sub-agent spawn sessions — user-observed agent behavior

3. **Reviewer prompt redundancy guard** — The M3 reviewer prompt must include explicit negative guards to prevent creating skills for:
   - ❌ Language/style preferences (already in SOUL.md / AGENTS.md)
   - ❌ User tone/format corrections
   - ❌ One-off vocabulary fixes (go to MEMORY.md)
   - ❌ General advice (be thorough, check your work)

4. **Reviewer prompt FOCUS ON** — Instruct M3 to specifically look for:
   - ✅ Specific file paths, tool commands, and system architecture patterns
   - ✅ Non-obvious gotchas (cross-provider fallback dead loop, auth differences)
   - ✅ Workflow sequences combining multiple system components with decision points
   - ✅ Debugging procedures for specific component types (cron, plugin, queue)
   - ✅ Configuration traps (same-model fallback, timeout vs model issues, plugin vs cron registration differences)

5. **Pipeline awareness** — The full curation pipeline is: `plugin agent_end → .skill_review_queue.jsonl (JSONL) → cron (every 30min) → M3 reviewer → skill-learned/<name>/SKILL.md → curator → skills.entries config registration`

6. **Detect redundant skills post-creation** — After M3 creates a skill, verify it contains unique information not already in SOUL.md, AGENTS.md, or MEMORY.md. If the skill is purely a paraphrase of existing system files, remove it (see redundancy guard above).
