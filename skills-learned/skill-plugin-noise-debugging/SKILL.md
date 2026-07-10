---
name: skill-plugin-noise-debugging
description: Trace why skill suggestions are noisy, identify root causes with file:line evidence, and propose a tiered fix plan from quick wins to systemic changes.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T12:01:01.236Z
---

## Workflow

1. **Gather telemetry data** — Run `exec` queries on skill recall_trigger events: count suggestions per skill, calculate noise rate (irrelevant / total), identify top offenders by false-positive frequency.

2. **Cross-reference with transcript** — Sample the session transcript to determine why each noisy skill was irrelevant. Classify noise type: keyword collision, short-task amplification, missing negative markers, or description ambiguity.

3. **Trace root cause to source code** — Use `read` to examine the plugin's matcher/scoring logic. Cite specific file:line evidence for each root cause. Common culprits: denominator-based scoring that amplifies single-word tasks (matcher.mjs:131-135), vector similarity randomness for URLs, or description fields lacking 3-segment markers.

4. **Quantify noise contribution per cause** — Calculate what percentage of total noise each root cause explains. This determines which fix has highest leverage.

5. **Propose tiered fix plan** — Structure recommendations in escalating effort tiers:
   - **Tier 1 (quick win / 5 min)**: Disable 3 worst offenders via frontmatter `disable-model-invocation: true` — zero code change, fully reversible.
   - **Tier 2 (surgical / 20 min)**: Add short-task gate in core.mjs — stricter MIN_SCORE when taskWordCount < 3.
   - **Tier 3 (systemic / 2+ hours)**: Add negative trigger keywords to 8+ SKILL.md descriptions, requiring source edits.

6. **Execute lowest-tier option first** — Present the tiered plan to user, recommend starting with Tier 1. If user defers ("由佢先"), record the decision in memory and create a tracking issue for follow-up.

7. **Update master tracking issue** — After analysis, update the relevant master issue (e.g., #162 for skill ecosystem) with the M8.4.X sub-task status, top offenders table, and next recommended action.

## Pitfalls

- ⚠️ Treating short-task amplification as a skill-description problem — editing SKILL.md files when the real fix is in matcher.mjs scoring logic (file:line evidence required before recommending edits).
- ⚠️ Proposing Tier 3 systemic changes when Tier 1 quick wins are available — creates unnecessary work and delays noise reduction by hours/days.
- ⚠️ Spawning M3 sub-agents for analysis without providing the telemetry baseline — sub-agent produces generic recommendations instead of data-driven tiers.
- ⚠️ Forgetting to verify that disabled skills are actually noisy across multiple days — disabling a skill based on one day's noise may remove a legitimately useful suggestion that had a bad day.
- ⚠️ Not recording the tier recommendation decision in memory/issue — "由佢先" defers become lost actions if not tracked.
- ⚠️ Recommending code changes without confirming the exact line numbers — mismatched file:line citations undermine credibility and cause wasted investigation time.
