---
name: subagent-qa-verification-workflow
description: Spawn M3 subagent for comprehensive multi-bug QA verification, collect annotated results, and coordinate related bug discovery and fixes in a single coordinated pass.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T16:07:49.216Z
---

## Workflow

1. **Prepare verification brief** — Compile the full bug list (bugs + affected files + specific things to verify). For each bug include: location, expected behavior, edge cases to test. Format as a structured list the subagent can tick off.

2. **Spawn M3 subagent** — Use `sessions_spawn` with M3 model. Include in the task prompt: the full bug list, file paths, verification criteria per bug, and instruction to report per-bug PASS/FAIL verdict with evidence. Tell the subagent not to busy-poll — results auto-announce.

3. **Collect annotated results** — The subagent will return a table with columns: Bug #, Location, Verdict (✅ PASS / ❌ FAIL / ⚠️ PARTIAL), Notes. Review the verdict table. If any PASS with "⚠️ PARTIAL", those are additional bugs to fix.

4. **Identify related bugs from verification** — M3 QA often discovers **additional bugs** from the same root cause not in the original list (e.g., regex updated in one place but not synchronized in related telemetry counters). Extract these as P2/P3 items.

5. **Coordinate fix for discovered related bugs** — If ≥1 related bugs found, spawn a second subagent or fix inline. Key root cause patterns in the skill validation pipeline:
   - H-3 regex (`/(?:^|\n)(#{1,3}\s+)- .+` for pitfalls) not propagated to `pitfallsCount`, `numSteps`, or `workflowSteps` telemetry
   - `extractFileBlocks` outer loop using wrong index advancement (`indexOf('\n', open)` vs `match.index + match[0].length`)

6. **Run integrated smoke test** — After all fixes, run a test that exercises the full pipeline path. Verify no new P0/P1 introduced at changed lines. Run `eslint` or equivalent lint check on modified lines only.

7. **Update tracking artifacts** — Update HEARTBEAT.md Skills Health section with: new bug count, affected files and line numbers, fix status. If the fixes relate to a tracked issue (e.g., #148), update the issue progress.

## Pitfalls

- **Spawning M3 without edge case criteria** — If the brief only says "verify Bug #1", M3 won't test edge cases (symlink already gone, permission errors, empty input). Always list edge cases explicitly per bug.
- **Missing regex synchronization in telemetry** — When updating H-3 regex for `pitfallsCount`, remember that `numSteps` and `workflowSteps` telemetry also use similar patterns and must be updated together. A verification that only checks the primary fix will miss the telemetry variants.
- **Running lint on whole file instead of changed lines** — Full-file lint may surface 20 pre-existing warnings unrelated to the fix. Run lint only on the specific lines changed (e.g., `eslint --quiet file.js:224-238`) to avoid noise.
- **Not updating HEARTBEAT after pipeline fixes** — When 7 bugs are fixed across 2 files, future sessions won't know which bugs were fixed. Always add a "Recent Fixes" row to the Skills Health section with file:line references.
- **Accepting PARTIAL PASS as done** — A PARTIAL PASS means the primary fix works but edge cases fail. Always track the remaining edge cases and address them before closing.
