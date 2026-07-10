---
name: conversation-to-issue-distillation
description: Distill key facts, decisions, progress, and open questions from verbose conversations into a structured, high-quality issue, mitigating context overflow and heartbeat loops.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-18T17:55:00.000Z
---

## Workflow

1.  **Identify Distillation Target and Existing Artifact** — When asked to write detailed info (architecture, progress, issues) into an issue, first `exec find . -name "#164.md"` or similar to check if the issue file already exists. Avoid starting from scratch if an L1 draft was already created.
2.  **Scan Conversation for Structured Data** — Traverse the current and recent conversation history. Extract explicit snippets about: (F) Facts/Architecture, (D) Decisions made/pending, (Q) Open Questions, (Progress) Done/Todo checklist items, and (Notes) Related files/commands. Use `exec cat memory/yyyy-mm-dd.md` for any logged details.
3.  **Execute a `write` or `edit` to Create or Amend the Issue File** — Write the extracted data into `issues/#<issuenumber>.md`. Structure it with clear `##` sections (e.g., `## F - Facts`, `## D - Decisions`, `## Progress`). For an L2-quality issue, ensure Closing Criteria, Day-by-Day observations, and Rollback Plan sections are included to meet the quality SOP.
4.  **Mitigate Context Overflow by Using Sub-agents** — If the conversation is extremely long (e.g., >100 tool calls) and you encounter `Context overflow` errors, offload the scanning and structuring task to an M3 sub-agent. Spawn it with the full conversation history or a pointer to the relevant issue file, and instruct it to produce a structured summary.
5.  **Handle `HEARTBEAT_OK` Loops** — If the session enters a HEARTBEAT_OK loop (meaning the model stopped productive work), `read` the last written issue file to confirm it was saved, then acknowledge the recovery in your response. Restructure instructions to be more direct and actionable to break the loop (e.g., "Do step 1, then step 2" rather than open-ended analysis).
6.  **Validate Against Issue Quality SOP** — After writing, `read` the `AGENTS.md` or the relevant quality document and compare the issue against the required L1/L2 checklist. If missing sections (e.g., Closing Criteria, Rollback Plan), `edit` the file to add them. Run a final `exec` command to verify the file content is complete.

## Pitfalls

-   ⚠️ **Assetless Context Overflow** — Re-reading the entire multi-turn conversation to extract facts can itself trigger a `Context overflow` error. Use `exec` to save intermediate notes to a file, or spawn a sub-agent with a compressed version of the history, rather than keeping all raw data in memory.
-   ⚠️ **HEARTBEAT_OK Loop Lock** — After a long `write/edit` operation, the session may respond with `HEARTBEAT_OK` and appear to ignore further requests. Immediately `read` the file you just wrote to confirm the data is there, then give a very short, direct command (like "✅ File written. Continue.") to re-engage the model.
-   ⚠️ **Relative vs. Absolute Path Restrictions** — The model may reject a `write` to a relative path like `issues/164.md` but accept an absolute path like `/Users/ally/.openclaw/workspace/issues/164.md`. If a write fails on a relative path, retry using the full absolute path.
-   ⚠️ **One-Time Task Narrative** — Avoid writing the story of the debugging session into the issue. Distill only the architecture, the current status, the open decisions, and the problems. Keep the issue an actionable artifact, not a log of attempts.
