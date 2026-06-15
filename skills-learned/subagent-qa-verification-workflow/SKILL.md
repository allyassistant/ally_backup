---
name: subagent-qa-verification-workflow
description: Spawn M3 sub-agent for structured QA verification, yield for completion, read results, and post a concise summary to Discord. Use when QA pass is needed, deliverables must be confirmed, or discovery results require pass/fail judgment.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T07:10:00.000Z
---

## Workflow

1. **Define the verification scope** — Write a sub-agent task prompt that specifies exactly what to verify (e.g., M1.1–M1.9 deliverables, smoke tests, sampling criteria). Include pass/fail thresholds and expected output format.

2. **Spawn M3 sub-agent via `sessions_spawn`** — Dispatch the sub-agent with the full scope. Use a descriptive `task_label` (e.g., `M1-completion-audit`) so results are identifiable. Announce to the user that the agent is running.

3. **Yield and wait** — Call `sessions_yield` to wait for the sub-agent to complete. Do not busy-poll. The sub-agent auto-announces results to the requester.

4. **Read the results** — After yield returns, read the sub-agent's output file (typically `.spawn/reports/<task_label>-<date>.md`). Verify the report contains all expected sections and a clear overall verdict.

5. **Post summary to Discord** — Construct a concise pass/fail summary (≤150 chars per line, key metrics only). Use `exec` to call `openclaw message send` to the target channel. If the sub-agent reports it has no `message` tool, forward the message text via the main agent's exec channel.

6. **Present to user** — Deliver the full verdict table (task-by-task status) with the Discord confirmation. Ask whether any findings need follow-up issues.

## Pitfalls

- ⚠️ Sub-agent output file not found after yield — the sub-agent may still be running or the filename may differ. Always read the directory listing first (`ls .spawn/reports/`) before assuming the path.
- ⚠️ Sub-agent lacks `message` tool — M3 sub-agents typically do not have the `message` tool. If the sub-agent says "I don't have a message tool", extract the message text from its output and forward it via the main agent's `exec` → `openclaw message send` channel.
- ⚠️ Discord push skipped when sub-agent finishes late — if the sub-agent completes while the main session is idle, the Discord notification may be forgotten. Always include the Discord step explicitly in the workflow, not as an optional add-on.
- ⚠️ Verification scope too vague — "QA needed" without specific deliverables, thresholds, or sampling criteria produces unactionable reports. The task prompt must enumerate each check item explicitly.
- ⚠️ Yield called before sub-agent finishes — calling `sessions_yield` prematurely returns an empty result. Confirm the sub-agent has actually completed (check `.spawn/reports/` or the yield response payload).
- ⚠️ Summary omitted from Discord — posting only "QA complete" with no metrics is not actionable for absent reviewers. Always include at minimum: total items checked, pass count, fail count, and any blocking issues.
