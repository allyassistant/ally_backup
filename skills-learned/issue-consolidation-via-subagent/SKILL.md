---
name: issue-consolidation-via-subagent
description: Spawn M3 sub-agent to deduplicate, reassess utility, and consolidate issue lists into a single prioritized issue.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T06:31:01.231Z
---

## Workflow

1. **Gather issue list.** Use `exec` to read all relevant issue sources (e.g., `gh issue list --state all`, memory files, or queue JSONL). Collect issue titles, IDs, labels, body text, and timestamps into a single context payload.

2. **Define consolidation criteria.** Encode three explicit axes into the sub-agent prompt:
   - **Deduplication** — flag issues with overlapping subject matter, same root cause, or duplicate problem statements
   - **Recency / staleness** — flag issues whose underlying bugs or contexts have been resolved or superseded
   - **Utility score** — assess whether each issue is actionable, specific, and still relevant to current system state

3. **Spawn M3 sub-agent** via `sessions_spawn` with the full issue context and the three criteria above. Instruct the agent to produce:
   - A deduplication map (merged issue → source issues)
   - A staleness assessment per issue
   - A priority ordering (P0 → Pn)
   - A single consolidated issue body that merges all valid, non-stale issues into coherent sections

4. **Collect and verify.** Poll `sessions_spawn` for completion, read the sub-agent output, and verify it contains all three required artifacts (dedup map, staleness list, priority order).

5. **Present and dispatch.** Output the consolidated issue to the user. If the user confirms, write it to the appropriate location (GitHub issue via `gh issue create` or memory file).

## Pitfalls

- ⚠️ Spawning sub-agent without explicit deduplication criteria — the agent may produce a long merged list that still contains subtle duplicates (e.g., "cron timeout" vs "cron model timeout" as separate issues). Always include the dedup axis explicitly in the prompt.
- ⚠️ Treating all open issues as equally relevant — stale issues from previous system versions may be included by default. The recency axis must be actively applied, not assumed.
- ⚠️ Merging issues with conflicting priorities — if two issues claim P0 status for different root causes, the consolidated output must preserve separate P0 entries rather than forcing a false hierarchy.
- ⚠️ Sub-agent output truncation at token limits — for large issue lists (>50 items), the agent may silently drop mid-analysis. Split the list into batches of 20 and merge results before final consolidation.
- ⚠️ Writing consolidated issue without user confirmation — the merged output may inadvertently discard nuance. Present first, write second.
