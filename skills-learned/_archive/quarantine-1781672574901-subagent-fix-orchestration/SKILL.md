---
name: subagent-fix-orchestration
description: Delegate fix tasks to M3 sub-agent after upstream analysis, tracking via yield/poll cycles and sending Discord notifications only when fixes are applied.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T05:01:01.241Z
---

## Workflow

1. **Receive fix list** from upstream analysis (CQM scan, code review, or debug triage).
   Verify the list contains concrete file:line:issue tuples — reject vague or high-level guidance.

2. **Spawn M3 fixer sub-agent** via `sessions_spawn` with the fix list as compressed input.
   Include: target file paths, issue severity (P0/P1/P2), and any relevant context (language, framework).
   Use `--fix-mode` flag if the agent supports structured fix mode.

3. **Yield and wait** for sub-agent completion. Poll every 30–60s if no response.
   Track spawn time; if no progress after 3 polls, trigger fallback chain.

4. **Re-verify after fix** — do not assume fix succeeded. Run `code-quality-proactive-scan`
   on the same file(s) to confirm issues are resolved and no new errors were introduced.

5. **Send Discord notification only when action was taken.** If re-verify shows `verify_ok`
   (clean), do not send — silent is correct. If fixes were applied (`verify_fail` → fix → pass),
   send to `#⚙️系統` channel with format:
