---
name: hermes-comparison-pattern
description: Architectural comparison between Hermes Agent and OpenClaw's skill self-learning system — differences, bottlenecks, and improvement opportunities
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-06T14:30:00.000Z
---

## Workflow

1. **Understand the three core architectural differences** when comparing Hermes vs OpenClaw:
   - **Review approach**: Hermes uses conversation-driven review (forked LLM agent analyzes full conversation for qualitative signals like user frustration, corrections, expressed desires). OpenClaw uses pattern-driven review (tool-call frequency hashing). Hermes detects signals like "user said stop doing X" that hash-based approaches miss.
   - **Curator trigger**: Hermes curator is inactivity-triggered — runs when agent idle > 2 hours AND last curator run > 7 days ago. OpenClaw uses fixed cron schedule (Sunday 03:00). Inactivity-triggered avoids competing with user for model attention.
   - **Skill structure**: Hermes uses a three-tier structure (active/manual/disabled) with `_active` directory containing symlinks. OpenClaw uses `skills.entries` config registration + `skills/` directory symlinks as metadata markers.

2. **Identify symlink bottleneck** — The OpenClaw pipeline creates skills in 30-minute cycles (M3 cron) but only makes them visible weekly (Sunday curator creates symlinks). A conversation that creates a skill at Saturday 21:00 won't be available until Sunday 03:00. For faster availability, consider decoupling symlink creation from the full curation pipeline.

3. **Compare skill file formats** — Hermes skills use a structured format with `name`, `description`, `usage_hints` (including `role`, `domain`, `tools_required`), `example_prompts`, `expected_outputs`, and `failure_modes`. OpenClaw skills use frontmatter + workflow steps. Consider whether `usage_hints`, `example_prompts`, or `failure_modes` sections would improve skill usability.

4. **Trace the capture pipeline end-to-end** to identify bottlenecks:
   - Plugin `agent_end` event → `.skill_review_queue.jsonl` (JSONL) — real-time capture
   - Cron every 30min → M3 reviewer → `skills-learned/<name>/SKILL.md` — ~30min latency
   - Weekly curator → promote/archive + symlink + config registration — up to 7 days latency
   - Each stage has different time sensitivity. Re-evaluate which stages should be decoupled.

5. **When analyzing a competitor's codebase** (like Hermes 60K lines Python):
   - Use a sub-agent spawn (Option C: parallel analysis) for the deep dive — don't try to read 60K lines yourself
   - Give the sub-agent explicit file-scoping instructions: "focus on skill-related files only"
   - Have the sub-agent write a structured report to a file (e.g., `~/Desktop/hermes-deep-analysis.md`)
   - After completion, read the report and extract specific architectural patterns our system could adopt

6. **For sub-agent codebase analysis tasks**, include in the instructions:
   - Exact file paths to read (don't make the sub-agent rediscover the repo layout)
   - The comparison target (what our system currently does)
   - Specific questions to answer (e.g., "how does Hermes detect review-worthy conversations?", "what format do skills have?")
   - Output format (structured report with specific sections)

## Pitfalls

- **Don't assume symmetry** — Hermes and OpenClaw handle skills at fundamentally different levels. Hermes has a dedicated sub-agent (Hermes Skill Manager) running as a persistent background process. OpenClaw's system is plugin-based and event-driven. Direct translations of single mechanisms often break because the surrounding system is different.
- **Sub-agent report size matters** — a 576-line / 28KB report is dense. After the sub-agent completes, read the report and extract 3-5 key action items rather than trying to implement everything at once.
- **Outdated comparison files** — files like `~/Desktop/hermes-vs-openclaw-comparison.md` or `~/Desktop/skill-self-learning-architecture.md` can be stale after any significant refactor (e.g., Phase 1b subdirectory migration). Always re-verify their claims against current codebase state.
- **Deep research spawns can leave dangling state** — sub-agents analyzing large codebases may create intermediate files or state. Check for and clean up any temp files after the analysis completes.

## Related Skills

- `skill-curation-pattern` — upstream filtering and quality gates for skill curation
- `cron-job-testing` — cron job debugging, including cross-provider fallback and queue inspection
