---
name: skills-audit-workflow
description: 執行技能審計工作流，覆蓋隊列讀取、訊號判讀、M3子代理派發與狀態驗證
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-14T13:20:00+08:00
---

## Workflow

1. **Read the skill-reviewer queue** — locate `.skill_review_queue.jsonl` in the workspace root. Each line is a JSON object; parse sequentially. Identify entries by `type` field or heuristics (Discord channel metadata, conversation info blocks, X links, plain text).

2. **Classify each entry against decision tree** — apply the 5-question triage:
   - Does it describe a non-trivial technique, fix, or workflow? → skill candidate
   - Did a loaded skill prove wrong or missing a step? → patch candidate
   - Did the user correct a non-obvious system behaviour? → encode as pitfall
   - Is it a one-time incident with no reuse? → skip
   - Is it a skill pipeline / reviewer meta topic? → hard block, skip

3. **Identify non-signal queue entries** — two entry types must be excluded:
   - **JSON metadata blocks** (`conversation_info`, sender metadata): these are routing context, not actual user prompts. Entries that contain only JSON and no real prompt text belong to the platform layer, not skill-reviewer.
   - **X links** (`https://x.com/...`): these are handled by the X link SOP independently. They enter the queue during pipeline execution but belong to a separate processing pipeline.

4. **Batch sub-agent dispatch** — for skill candidates, spawn M3 sub-agents in parallel (max 3 concurrent). Pass each agent a compressed context block: skill name, relevant source files, and the specific gap to validate.

5. **State verification** — after sub-agents return, verify each skill output against the self-audit checklist (frontmatter, ≥3 steps, ≥3 pitfalls, ≥1500 bytes, action-verb description). Discard any that fail.

6. **Memory cleanup** — archive processed entries from the queue file. Do not leave entries that were classified as non-signals; they will recur on every pipeline run if not purged.

## Pitfalls

- ⚠️ **JSON metadata entries as signals** — queue entries that are pure JSON blobs (conversation info, sender metadata) have no skill-relevance. Treating them as signals causes false-positive suggestions. Always check for non-empty `prompt` or `content` fields before classifying.
- ⚠️ **X links in queue after pipeline run** — X link entries often append to the queue after the pipeline has already processed the conversation. These are not new signals; they belong to the X link SOP. Do not re-trigger a full skill audit for them.
- ⚠️ **Pipeline-context entries vs user intent** — entries that represent the conversation boundary (e.g., the last message in a conversation) may look like signals but are platform artifacts. Distinguish between "what the user said" and "what the system appended."
- ⚠️ **Parallel dispatch token budget** — spawning 3+ M3 sub-agents simultaneously may exhaust token budget. Pre-check available budget; if <50k tokens remain, dispatch serially or reduce to 2 agents.
- ⚠️ **Queue not purged after partial failure** — if a sub-agent fails mid-run, ensure processed entries are still archived. Partial state can cause duplicate processing on the next run.
- ⚠️ **Skill-quality heuristic false positives** — thin skills (<500 bytes) may pass the frontmatter check but lack substantive workflow. Reject any skill where `## Workflow` has <3 concrete steps or `## Pitfalls` has <3 specific failure modes.
