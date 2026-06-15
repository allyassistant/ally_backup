---
name: m3-adversarial-challenge-spawn
description: Spawn M3 sub-agent to challenge and stress-test recommendations by verifying claims against actual source code, then synthesize a balanced verdict. Includes token budget pre-check and adaptive thinking fallback.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T14:01:01.225Z
---

## Workflow

1. **Check token budget before spawning.** Read the active session's token usage or model plan from `AGENTS.md` or `openclaw gateway status`. If the plan is exhausted, skip M3 and use DeepSeek Pro directly.

2. **Construct the adversarial task prompt.** Include all context needed for the sub-agent to challenge the recommendation: the proposed content, evaluation criteria, and explicit instruction to find contradictions against prior analysis or source code.

3. **Spawn M3 via `sessions_spawn`** with the task prompt. Default to `thinking:high` if available in the spawn config.

4. **Handle `thinking:high` failure.** If the spawn returns an error indicating `thinking:high` is not supported, immediately respawn with `thinking:adaptive` instead. Do not abandon the task.

5. **Yield for completion** using `sessions_yield`. Do not poll; wait for the sub-agent to self-report.

6. **Collect results** via `sessions_history` or read the sub-agent's output file from `.spawn/reports/`.

7. **Synthesize and deliver.** Merge the sub-agent's findings into a concise verdict, noting which option won and why. Push a summary to Discord if the user is active.

## Pitfalls

- ⚠️ Spawning M3 without checking token budget — the spawn may succeed but the sub-agent immediately fails with quota exhaustion, wasting the dispatch. Always check token plan first.

- ⚠️ Not handling `thinking:high` rejection — MiniMax M3 does not support `thinking:high` in all contexts. Spawning with that parameter causes immediate failure. Always include adaptive thinking fallback in the respawn.

- ⚠️ Proceeding without fallback when M3 fails — if M3 is unavailable or fails, the workflow should fall back to DeepSeek Pro rather than stopping. The adversarial review is still valuable with a different model.

- ⚠️ Assuming sub-agent output is already in Discord — sub-agents store results in `.spawn/reports/` by default. Discord push may be pending. Always read the report file if Discord delivery is not confirmed.

- ⚠️ Ignoring prior analysis contradictions — when reviewing content proposals, check `.spawn/reports/` for prior M3 reviews. A new proposal that contradicts a prior verdict should be flagged explicitly.
