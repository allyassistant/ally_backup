```skills-learned/cron-agent-llm-failure-mitigation/SKILL.md
---
name: cron-agent-llm-failure-mitigation
description: Diagnose and fix LLM request failures in cron agentTurn jobs — distinguishing provider failure from same-model rate limit collision, model swap, and verification
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T08:15:00.000Z
---

## Workflow

1. **Identify failure type** — Open `openclaw gateway history` or check cron agent logs. Distinguish:
   - Provider outage: consecutive errors across all models from same provider (timeout/5xx)
   - Rate limit collision: 429 / 503 only when multiple sessions use same model simultaneously
   - Max tokens / config error: error message mentions token limit or invalid config
   - Retry race: retry started before newer config applies

2. **Check retry status** — If a retry is already running (`cron job status`), check its `runningAtMs` vs `updatedAtMs`. A retry that started BEFORE a config update will still use OLD config. Wait for the next cron trigger for new config to take effect.

3. **Decide mitigation path**:
   - Provider outage → swap primary model to different provider (e.g., DeepSeek → MiniMax)
   - Rate limit collision → stagger schedules or use different model pools (see `concurrent-session-rate-limit-avoidance`)
   - Max tokens / config → fix token limits or fallback in router config
   - Premature config change → let current cron cycle finish, new config applies to next trigger

4. **Update cron config** — Modify the cron job's router config:
   - Set `primary` model (e.g., `minimax-portal/MiniMax-M2.7`)
   - Set `fallback` model (e.g., `deepseek/deepseek-v4-flash`)
   - Set `timeout` (e.g., `360s`) — increase from default if previous timeouts
   - **IMPORTANT**: Do NOT modify the cron job's prompt content — only change model/timeout config

5. **Verify new config timing** — After config update, check `updatedAtMs` vs all running retries.
   - Running retries with `runningAtMs < updatedAtMs` → still using old config (complete or abort)
   - New retries or next cron trigger (`~interval minutes later`) → uses new config
   - Run `openclaw cron status <cron-id>` to confirm

6. **Confirm resolution** — Wait for next cron trigger or manually trigger. Check:
   - Exit code 0
   - No consecutive errors
   - Normal output/Discord delivery
   - `consecutiveErrors` counter reset to 0

## Pitfalls

- **Config update ≠ immediate effect** — Do not check retry immediately after update. The running retry uses the old config. New config only applies to the next cron trigger.
- **Same-model fallback dead loop** — If primary and fallback are from the same provider (e.g., `deepseek/deepseek-v4-flash` primary, `deepseek/deepseek-v3` fallback), a provider outage will fail both. Always choose fallback from a different provider.
- **Timeout vs model issue** — A timeout does not always mean the model is dead. It could mean the default 300s is too short for a complex prompt. Increase timeout before changing the model.
- **Prompt confusion** — When fixing a cron job LLM failure, it's tempting to rewrite the prompt. Resist unless the prompt is provably broken. Workflow preference: change model/timeout, not prompt content.
- **Provider auth mismatch** — `minimax-portal/MiniMax-M2.7` and `minimax:default` may have different auth keys. Check `plugins/openclaw-provider-minimax/` for the exact model ID pattern.
- **consecutiveErrors reset timing** — After a successful run, `consecutiveErrors` resets. A single success does not guarantee the failure is gone — the failure mode may be intermittent.
