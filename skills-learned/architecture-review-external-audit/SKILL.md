---
name: architecture-review-external-audit
description: "Spawn sub-agent to challenge plans and find blind spots. Use when: review needed, plans need challenge, blind spots exist. Key capabilities: external spawn, plan challenge, blind spot detection."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T03:31:04.556Z
---

## Workflow

1. **Identify internal plan to audit** — Main session or ally produced a recommendation (e.g. D→C→B implementation roadmap). Confirm the plan's exact scope and stated confidence level.

2. **Spawn external sub-agent with audit mandate** — Use `sessions_spawn` with M3, framing the sub-agent as "外部架構審計員" (external architecture auditor). Explicitly instruct: challenge AND extend, do NOT confirm. Pass full context chain (prior rounds, conclusions, disagreements).

3. **Load prerequisite data independently** — Sub-agent should read source files directly (not rely on main session's summaries). For skill pipeline analysis: read pipeline scripts, reviewer entry points, token config, recent data samples (`.jsonl`).

4. **Define audit scope boundaries** — Sub-agent should NOT rehash prior round conclusions (e.g. self-reinforcing risk already surfaced = skip). Focus on NEW angles: timing race, failure modes, cost ceiling, A/B test design, cross-model validation.

5. **Collect sub-agent report** — Wait for push-based result. Key deliverables: (a) explicit disagreement with internal recommendation, (b) arithmetic/assumption verification (e.g. token coordination math), (c) 3-5 new blind spots, (d) alternative recommendation with confidence score.

6. **Verify critical findings independently** — Main session should spot-check sub-agent's key numbers before accepting. Example: timezone math on pause timestamps, token coverage arithmetic.

7. **Synthesize and present to user** — Present sub-agent findings as "external audit" with clear contrast vs internal recommendation. User decides which path to follow.

## Pitfalls

- ⚠️ **Sub-agent echo-chambering** — If sub-agent only confirms internal plan, it failed its mandate. Pre-instruct explicitly: "challenge AND extend, do NOT confirm"
- ⚠️ **Timezone arithmetic errors** — `pausedAt` stored in UTC, presentation in HKT. Verify sub-agent's timestamp math. A negative duration (future) vs positive (past) flips the entire pause status conclusion
- ⚠️ **Same-family model bias** — M2.7→M3 appears cross-model but is same family. True cross-model requires M3 + deepseek consensus or equivalent
- ⚠️ **Token coordination arithmetic** — Pipeline runs/day vs judge safe window minutes/day must be verified with actual numbers (48 runs/day vs 25min/day = 10.4% coverage). Silent degradation if math doesn't work
- ⚠️ **Missing shadow mode before production** — Direct production LLM judge call without shadow mode calibration = first failure silently quarantines good skills or放过junk
- ⚠️ **Counterfactual analysis overconfidence** — Changing one assumption and concluding the result is equally valid requires explicit uncertainty quantification (e.g. confidence 0.82→0.78)
- ⚠️ **Failure mode not explicit** — When sub-agent recommends a path, the failure mode (what breaks first) must be stated. If not, sub-agent is surfacing options without commitment
