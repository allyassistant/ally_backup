---
name: subagent-context-overflow-recovery
description: Recover from M3 sub-agent token overflow by detecting the failure, reading partial output, reconstructing meaning, and communicating results to the user. Use when sub-agent yields with token limit errors.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T09:31:01.000Z
---

## Workflow

1. Detect token overflow: when `sessions_yield` returns with a truncated result or the M3 fails to send its final message, suspect token limit hit. The M3 may have written part of its report before crashing.
2. Check for partially written files: use `exec` with `ls` or `cat` on the expected output path (e.g., `.spawn/reports/` or the file the M3 was writing). The M3 may have written a report up to the point where it hit the limit.
3. Read the partial file: use `read` to view what was successfully written. If the file is large, read the last 50-100 lines to see where it stopped.
4. Reconstruct the missing content: based on the partial report's structure (headings, incomplete sentences, missing sections), infer what the M3 intended to output. Key questions: Did it finish the analysis? Did it propose next steps? Did it include the structured output it was asked for?
5. Manually communicate the results: send the recovered content to the user or Discord channel with a note that the M3 hit its token limit mid-output. Summarize what was recovered and what might be missing.
6. If the recovered content is sufficient to complete the task, paraphrase the key findings and any action items the M3 was delivering. The user doesn't need to know every detail — just the decision-relevant output.
7. Close the sub-agent session properly: the overflowed M3 session is still active. Mark it as done via `sessions_done` or clean up if the system handles it automatically.

## Pitfalls

- ⚠️ Assuming token overflow means total data loss — M3 often writes partial reports before crashing. The partial output is frequently salvageable and contains the core analysis.
- ⚠️ Re-spawning the full M3 task from scratch — token overflow will likely recur with the same input. Instead, work with the partial output and finish manually or with a narrower sub-task.
- ⚠️ Ignoring the partial file path — the M3 was writing to a specific file (e.g., `.spawn/reports/*.md`). If you don't know the path, check `ls .spawn/reports/` or look at the spawn instruction for file output targets.
- ⚠️ Not communicating the overflow to the user — the user sees the yield return with no visible output. A quick "M3 hit token limit, salvaging partial report" prevents confusion and preserves trust.
- ⚠️ Sending raw partial content to Discord without summarizing — the partial file may contain broken markdown or mid-sentence text. Summarize the key points and note the truncation.
