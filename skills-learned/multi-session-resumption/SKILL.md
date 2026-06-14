---
name: multi-session-resumption
description: Resume multi-session work when user asks "記唔記得我地做到邊到" — rebuild context from issues + memory + history, output compact status.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-07T13:00:00+08:00
---

# Multi-Session Resumption

## Workflow

1. **Recognize the trigger phrase** — The user typically says "記唔記得我地做到邊到" (or "記得我地做到邊到", "我地做到邊到"). This means they expect you to resume a complex project that was interrupted by session expiry, context timeout, or a break. Do NOT start from scratch.

2. **Search memory for the project** — Use `memory_search` with the project name or keywords (e.g., "issue 133", "refactor", "audit", the specific component name). Memory entries often contain the last known progress checkpoint. Set `corpus=memory` for more focused results.

3. **Read the canonical project file** — The canonical source of truth for multi-session projects is the `issues/<id>.md` file. Read the full issue file to get the complete picture:
   - Project status and progress (steps completed, current step)
   - Architecture decisions and trade-offs already made
   - Known issues and open questions
   - Recovery actions or pending user decisions
   
   Do NOT rely solely on memory_search or session_history — the issue file is the authoritative source.

4. **Check session history for recent progress** — If the user last worked on this within the last few hours, use `sessions_history` (via `memory_search` with `corpus=sessions` or direct session history tool) to find what happened in the most recent session. This is useful for:
   - Confirming whether the issue file is up to date
   - Finding code changes that happened since the last issue update
   - Understanding subtle context the issue file doesn't capture

5. **Produce a compact status report** — Format the status as one short sentence or line:
   ```
   Xステップ済 + Yステップ未 → Z待ち
   ```
   Or for a multi-step project:
   ```
   Step 7/9 done ✅, remaining: Step 8 (trim skills), Step 9 (validation). Waiting on user sign-off for Step 7 refactor.
   ```
   Key rules:
   - Be compact — the user expects a quick "where we are" not a full re-read
   - Always mention what is DONE versus what is REMAINING
   - If waiting on the user, explicitly state what you're waiting for
   - Include any blocking state (e.g., "waiting on user decision about X")

6. **Continue the work** — After providing the status, immediately continue from where you left off. Do NOT:
   - Re-read files you already know about (waste of time)
   - Re-explain the architecture from scratch
   - Ask "where should I start?" — the issue file tells you
   
   Instead, proceed with the next actionable step as documented in the issue.

## Pitfalls

- **Issues/ is canonical, not memory** — memory_search and session_history are supplementary. The issue file (`issues/<id>.md`) is the single source of truth. If memory and the issue disagree, trust the issue. If the issue is missing or incomplete, update it.
- **Don't re-read everything** — the user says "記唔記得我地做到邊到" because they want QUICK resumption. Reading 10+ files from scratch defeats the purpose. Read the issue file (canonical), skim the most recent session history (supplementary), then start working.
- **Status must be actionable** — "Step 5/9 done" is not enough. Say what's blocking (e.g., "waiting for your decision on fallback approach" or "sub-agent A still running"). The user needs to know what they need to do next, not just a progress bar.
- **Check for at-session-boundary changes** — if the last session ended with a `git commit`, `write`, or `edit` that isn't reflected in the issue file, the issue is stale. Read the most recent session transcript to catch any unrecorded changes. Update the issue file before continuing.
- **Parallel sub-agent work complicates resumption** — if sub-agents were spawned in the previous session, their results may be partially complete. Check `subagents list` or session history to see if they finished. If they orphaned output files, read them before writing new code.
- **Context from 3+ sessions ago may be stale** — architecture decisions made early in a project may have been reversed in later sessions. Always read the MOST RECENT issue file before earlier ones.
- **For cron/automation projects, verify live system state, not just the issue file** — when resuming work on pipelines, gateways, or background jobs, the issue file's snapshot of "system state" (cron errors, model used, queue depth) is stale by minutes/hours because the system keeps running. After reading the issue, do a quick `exec` spot-check (e.g. cron list, gateway status, queue state) to confirm the issue's claims are still accurate. If live state has diverged (e.g., new errors, model switched, queue cleared), update the issue file BEFORE continuing the workflow.
- **Multi-channel status broadcasting after resumption** — for projects with a public status channel (e.g. `#⚙️系統`), update BOTH the canonical issue file AND notify the channel. Order: (1) update issue with new findings, (2) check live state, (3) send compact status message to channel. Don't just post to channel — the issue file is the durable record.
