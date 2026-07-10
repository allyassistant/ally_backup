---
name: issue-triage-via-subagent
description: Sort a backlog of issues by spawning a sub-agent to surface quick wins.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-18T14:02:00.000Z
---

## Workflow

1. **Spawn M3 sub-agent** via `sessions_spawn` with a prompt that reads all issue files under `~/.openclaw/workspace/issues/` and classifies each by status: `active`, `blocked`, `observation`, `expired`, or `done`.

2. **Filter phase** — sub-agent should drop:
   - Issues past due date with no recent progress
   - Items marked `observation` where the observation period has clearly elapsed (check cron history, not just the checklist)
   - Duplicates that are covered by a parent issue

3. **Rank phase** — sub-agent calculates a priority score: `(progress_ratio / effort_remaining) * priority_weight`, where P1=3, P2=2, P3=1. Surface the top 5 candidates.

4. **Verification checkpoint** — before closing any issue, verify the underlying data:
   - Check the actual system state (cron runs, memory logs, pipeline outputs) matching the issue's closing criteria
   - If checklist is stale but system state confirms success → mark checklist verified in the issue file
   - If checklist is stale and system state cannot confirm → do NOT close; upgrade to a data-verification sub-task

5. **Partial pass handling** — if an issue passes some criteria but not all:
   - Record a `PARTIAL PASS` verdict in the issue with specific conditions not met
   - Create a follow-up issue (incrementing number) with the unmet conditions as its initial checklist
   - Set the follow-up's due date based on the remaining observation window

6. **Return structured output** — sub-agent yields a JSON summary:
   ```json
   {
     "candidates": [{ "id": 170, "title": "...", "score": 0.85, "verdict": "PARTIAL PASS", "reason": "..." }],
     "closeable": [139, 145],
     "followups_to_create": [{ "parent": 150, "title": "Re-measure 7d window", "due": "2026-07-01" }]
   }
   ```

7. **Main session applies** — read sub-agent output, execute closes and follow-up creations, update the issue count in memory.

## Pitfalls

- ⚠️ Closing issues based on stale checklists without verifying system state — the issue file says `1/7` but cron ran 7 times successfully; without verification the issue stays open indefinitely.
- ⚠️ Treating "observation" items as automatically done — some items need explicit re-measurement windows (e.g. 7-day junk rate); closing without the full window passes a partially-validated fix.
- ⚠️ Creating follow-up issues without setting a specific due date — orphan follow-ups drift and never get re-evaluated; always set `due` based on remaining observation days.
- ⚠️ Spawning sub-agent without compressing context first — issue triage on 30+ items can overflow the spawn budget; pre-gather only the issue IDs and summaries.
- ⚠️ Partial pass verdicts buried in comments — the verdict must be explicit and searchable (`verdict: PARTIAL PASS`) so future sessions can find and close the follow-up without re-analysis.


## Absorbed from `issue-consolidation-via-subagent` (2026-06-20)

> **Provenance:** score=?, verdict=MERGE, merged via `scripts/merge_skills.js`
> **Original location:** `issue-consolidation-via-subagent/SKILL.md` (now in `_archive/merged-2026-06-20/issue-consolidation-via-subagent/`)

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
