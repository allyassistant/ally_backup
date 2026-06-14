```skills-learned/concurrent-session-rate-limit-avoidance/SKILL.md
---
name: concurrent-session-rate-limit-avoidance
description: Diagnosing and avoiding same-model rate limit collisions when main session and cron isolated/turn sessions run simultaneously with the same LLM provider
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T07:52:38.794Z
---

## Workflow

1. **Detect the pattern** — When a cron job using `agentTurn`/`isolated` consistently times out (~300s) with `model-call-started` status but no completion, while the main session is simultaneously active:

   - Check cron runs history: `openclaw cron runs <cron-id>`
   - Look for runs that timeout exactly at the configured `timeoutSeconds` limit
   - Correlate timestamps with main session activity (same minute window)

2. **Identify the colliding model** — Determine which LLM provider+model both contexts are using:

   - Main session model: Check current conversation (usually visible in UI or from provider config)
   - Cron model: `openclaw cron get <cron-id>` → check `payload.model`
   - Inner script model: Read the cron's target script — many have hardcoded `MODEL = 'provider/model'` at line ~30
   - If cron agentTurn model matches the main session's active model → collision confirmed

3. **Choose a non-conflicting model** — Select a substitute with these priorities:

   - **P1: Different provider** — Use a model from a different API provider entirely (e.g., if main is DeepSeek, cron uses MiniMax)
   - **P2: Different model family** — Same provider but different tier/model (e.g., if main is deepseek-v4-flash, cron uses deepseek-v4-pro or deepseek-r1)
   - **P3: Delay execution** — Schedule cron to run when main session is typically idle (e.g., 02:00-06:00)
   - Never use the exact same model string as the active main session

4. **Match cron model to inner script default** — Prefer setting the cron's agentTurn model to the same model the cron's target script uses internally:

   - Read the target script's `MODEL` constant
   - Set cron `payload.model` to match (avoids double LLM calls from different models)
   - Example: If `skill_reviewer_bot.js` uses `minimax-portal/MiniMax-M2.7`, set cron model to same

5. **Update cron config**:

   ```bash
   # Set new model (MiniMax M2.7 avoids DeepSeek collision)
   openclaw cron update <cron-id> --model "minimax-portal/MiniMax-M2.7"
   
   # Optionally increase timeout for slower models
   openclaw cron update <cron-id> --timeout 360
## Pitfalls
- (none yet — add pitfalls as discovered)
