---
name: skill-curation-pattern
description: Pattern for curating skill files — upstream source filtering, filesystem mtime and content analysis, prompt-level quality gates
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-07T03:30:00.000Z
---

## Upstream Source Filtering

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

## Workflow

7. **Prefer filesystem timestamps over frontmatter counts** — `mtime` is always accurate and can't drift or go stale. Frontmatter fields like `patternRepeats` or `effectiveUse` are self-reported and rely on every writer updating them correctly.

8. **Check body length to detect junk/placeholder skills** — skills with body content under ~200 characters (after stripping frontmatter) are likely auto-generated placeholders with no useful content. These were common in the old hash-based skill generator.

9. **Apply the junk decision tree**:
   - `bodyLength < 200` AND `daysSinceMtime < 30` → **draft** (recent junk, give time to improve; no symlink)
   - `bodyLength < 200` AND `daysSinceMtime >= 30` → **archive** (stale junk, remove)
   - `bodyLength >= 200` AND `status == 'active'` → **active with symlink** (promote to skills/)
   - `bodyLength >= 200` AND `status == 'draft'` → **draft** (worth keeping, wait for more evidence; no symlink)

10. **Use idempotent symlink logic** — before creating a symlink in `skills/`, check if one already exists pointing to the same target. Avoid creating duplicates or broken symlinks.

11. **Clean up dead state files** — before deleting any file suspected of being dead state, search all code paths (scripts/, extensions/, cron jobs, config files) to confirm nothing reads or writes it. Files with zero references across the entire workspace are safe to remove.

12. **Skills must be registered in `skills.entries` config to load** — symlinks in `skills/` directory do NOT automatically inject skills into `<available_skills>`. OpenClaw loads skills from `skills.entries` in the gateway config (`config.yaml` or equivalent). A symlink without a corresponding entry is decorative — it does not make the skill available to the agent.

13. **Promote skills via config registration, not symlinks** — to make a skill available, add it to `skills.entries` in the gateway config. The Phase 1b curator in `scripts/weekly_correction_loop.js` now creates directory symlinks (`skills/_learned_<name>/` → `../skills-learned/<name>/`) as metadata markers, but the actual load mechanism is config registration. Without a `skills.entries` entry, no skill appears in `<available_skills>`.

14. **Subdirectory format is required** — all skills must live in `skills-learned/<name>/SKILL.md` (lowercase-kebab-case directory name). The flat `.md` files at `skills-learned/<name>.md` are deprecated. Use `scripts/migrate_skills_to_subdir.js` for one-time bulk migration from flat to subdirectory format. The migration creates the directory, moves the content into `SKILL.md`, and removes the old flat file.

15. **Auto-migration in weekly curation** — `scripts/weekly_correction_loop.js` Phase 1b automatically detects flat `.md` files in `skills-learned/` and converts them to subdirectory format. The migration is idempotent: if a flat file has already been migrated, it skips it. Orphan directories (empty skill dirs with no matching flat file) are cleaned up.

16. **Post-edit integrity verification** — after creating or updating a SKILL.md in `skills-learned/`, run a multi-point check to catch content errors before the next cron cycle distributes the skill:
    - **Line count check**: run `wc -l skills-learned/<name>/SKILL.md` and compare against expectations. A file reported as ~400 lines should not be 500+. Discrepancies indicate dangling content or truncated output from the write operation.
    - **Frontmatter validation**: verify all required frontmatter fields are present (`name`, `description`, `status`, `source`, `generatedAt`) and contain accurate data — not placeholder values.
    - **Content accuracy scan**: grep for stale/fake content — e.g., "5 pipelines" when only 4 exist, hardcoded dates that are already in the past, or copy-paste artifacts from other skills.
    - **Cross-file reference check**: verify every path and filename referenced in the skill (e.g., `~/.openclaw/`, `extensions/`, `scripts/`, `skills-learned/<other-skill>/`) actually exists on disk. A skill referencing a non-existent file path will confuse future readers.
    - **Tool output verification**: after running validation tools (`wc -l`, `grep -c`, `find . -name`), confirm the numeric output matches the expected count — don't assume the tool returned the right value at a glance.
    - **Duplication scan**: check whether the new or updated content overlaps significantly with existing skills. If the same gotcha appears in multiple skill files, consolidate into one and reference it from the other.

## Pitfalls

- **Post-edit verification is not a substitute for testing.** A skill that passes all integrity checks (correct line count, valid frontmatter, real paths) may still have logical errors in its workflow. The audit catches content bugs (wrong numbers, stale references, copy-paste artifacts) but not design bugs (missing steps, wrong tool calls, bad advice).
- Frontmatter metadata is self-reported and unreliable — a skill file can claim `status: active` with `patternRepeats: 3` but have an empty body. Always verify with actual content checks.
- Files with large frontmatter (1000+ chars) and tiny bodies (3 chars of newlines) are a signature of the old auto-generation system — these are junk.
- Don't delete files based on `mtime` alone — always verify zero references across the entire codebase first.
- **Plugin-level channel filter changes require `openclaw gateway restart`** to take effect. Just editing the extension file is not enough.
- **When excluding channels, incrementally expand** — start with obvious noise channels, test, then add more based on observed queue content quality. Not all channels in a category are equally noisy.
- **Symlinks in `skills/` do NOT auto-load skills.** No filesystem scanning injects into `<available_skills>`. Registration in `skills.entries` config is the only mechanism that works.
- **Flat `.md` files in `skills-learned/` are deprecated** — the reviewer and curator expect subdirectory format. If a conversation produces a flat file, the next weekly curation loop auto-migrates it, but the race condition means the skill may not load until the migration runs.
