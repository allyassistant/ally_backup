---
name: subagent-output-reconstruction
description: Reconstruct truncated M3 sub-agent outputs by fetching session history, sending gap-fill prompts, and synthesizing partial results into a complete deliverable.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-19T02:31:03.546Z
---

## Workflow

1. **Spawn M3 sub-agent** with `sessions_spawn`, then immediately `sessions_yield` and wait for completion signal (push-based — do not poll).

2. **Read initial output** — the sub-agent auto-announces results to the requester. If the output is complete and ends with a proper section (TL;DR, recommendation, etc.), synthesize directly.

3. **Detect truncation** — truncation is identifiable by any of these signals:
   - Output ends mid-sentence or mid-section without a closing marker
   - Key sections are missing (e.g., TL;DR, recommendation, open questions absent)
   - `sessions_yield` returns with truncated content
   - `stopReason: "stop"` received but output is incomplete

4. **Fetch session history** — call `sessions_history` to retrieve the sub-agent's full transcript:
   ```bash
   sessions_history <session_id>
   ```
   History often reveals more content than the truncated announcement, but may still be partial.

5. **Identify missing sections** — scan the history output for gaps. Common truncation patterns:
   - Sections 3–9 of an 9-section document missing (Sections 1–2 visible)
   - TL;DR and recommendation absent
   - Middle sections (e.g., 1.5–1.8, 2, 3, 4) missing from history

6. **Send gap-fill prompts** — use `sessions_send` to request the missing content. Send one targeted prompt per gap:
