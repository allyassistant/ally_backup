---
name: issue-conclusion-overturn-cleanup
description: 當新分析結果推翻早期結論時，重新整理 issue 為單一事實來源，並處理 sub-agent verdict 衝突
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T17:02:07.911Z
---

## Workflow

1. **Detect the conflict** — When a sub-agent's summary verdict contradicts its own analysis, flag it immediately. Look for language like "BUT" or "Actually" in the reconciliation pass that reveals the mismatch.

2. **Read the full sub-agent output** — Do not trust the summary alone. For M3 sub-agents, always read the complete output before acting on any verdict. The summary may have been generated before the full analysis was complete.

3. **Identify the correct verdict** — Compare the summary vs. the actual analysis. In the #131 case, the summary said "A. Do nothing" but M3's own analysis concluded "B. Pilot (approach B, not C)" with a full decision matrix.

4. **Rewrite the issue** — Update the issue as a single-source-of-truth reflecting the correct analysis:
   - New title if scope changed
   - Updated priority/due if urgency changed
   - Full decision matrix with all options and verdicts
   - Correct recommendation marked
   - Rejected options with reasoning

5. **Flag the Discord summary if sent prematurely** — If a Discord summary was already sent with the wrong verdict, acknowledge the correction in the next message to the relevant channel (e.g., #🧑🏻‍💻編程).

6. **Enrich for future follow-up** — Before closing the update session, add:
   - Acceptance criteria (Pass/Blocked/Fail thresholds)
   - Specific check lists (deterministic checks, no LLM dependency)
   - Implementation skeleton (SKILL.md structure stub)
   - Decision checklist for the next review date

7. **Set observation window** — Push due date to allow for observation. E.g., if original due was 6/12, push to 6/14 with explicit "observe → decision" steps.

## Pitfalls

- **Premature summary before full analysis** — Sub-agents may generate a summary verdict before completing their full analysis. Always wait for the complete output, especially for M3 agents running 9+ minutes with 2M+ tokens.
- **Summary/actual verdict mismatch** — M3 sub-agents can produce a summary that says one thing while the actual analysis concludes another. The mismatch is the signal, not an error to ignore.
- **Sending Discord summary before reconciliation** — If a Discord summary was sent with the wrong verdict, do not ignore it. The user may act on it. Send a correction message.
- **Rejecting the sub-agent's own recommendation** — If M3 says "B. Pilot" but you prefer "C. Full rewrite", that is a user override, not a correction. Document it as such in the issue.
- **Enriching without follow-up date** — Adding acceptance criteria and check lists is pointless if there is no future review date. Always set a concrete observation window (e.g., 6/14 go/no-go).

## Sub-agent Verdict Reconciliation (M3 Specific)

When an M3 sub-agent is spawned for issue analysis, a specific failure mode can occur:

**The pattern:**
1. M3 sub-agent runs (9m45s, 2.9M tokens in observed case)
2. Sub-agent produces summary verdict (e.g., "A. Do nothing / Close #131")
3. Sub-agent's actual analysis concludes something different (e.g., "B. Pilot")
4. Main session sends summary to Discord prematurely
5. Reconciliation pass in a later turn catches the contradiction

**How to avoid:**
- For M3 sub-agents analyzing issues, do NOT send a Discord summary until after reading the full output
- If the sub-agent outputs a summary section, cross-check it against the body of the analysis
- Look for "BUT" or "Actually" language in the reconciliation pass — these are conflict signals
- When conflict is found, use the actual analysis (not the summary) for the issue update

**Verdict conflict detection checklist:**
- [ ] Did the summary say something like "A. Do nothing" or "Close" ?
- [ ] Does the actual analysis have a full decision matrix (A/B/C/D) with a marked recommendation?
- [ ] Does the recommendation in the matrix match the summary?
- [ ] If no match → use the matrix verdict, not the summary
- [ ] Send correction to Discord if wrong summary was already delivered

## Related Skills

- `subagent-qa-verification-workflow` — spawn M3 for QA verification (different intent, same sub-agent)
- `cron-model-selection-verification` — verify which model was actually used vs. configured
- `multi-session-resumption` — rebuild context from issues + memory + history
