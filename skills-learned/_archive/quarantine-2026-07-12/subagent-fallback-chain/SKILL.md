---
name: subagent-fallback-chain
description: "Detect sub-agent failures and execute fallback chains. Use when: quota exhausted, params unsupported, API overload. Key capabilities: failure detection, fallback, param adjust."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T03:31:01.249Z
---

## Overview

When a sub-agent (M3) fails due to provider-level issues (token quota exhaustion, unsupported parameters, API overload), the correct response is NOT to retry the same provider — it's to execute a fallback chain to an alternate provider while adjusting parameters to match that provider's capabilities.

Primary cause: MiniMax token quota exhaustion with fallback to DeepSeek V4 Pro, then DeepSeek not supporting `thinking:adaptive` requiring `thinking:high` retry.

## Workflow

1. **Detect failure mode** — Read the sub-agent error. Distinguish between:
   - Token plan quota limit reached (e.g. `Token Plan usage limit reached. Upgrade your Token Plan or purchase Credits for more usage. (2056)`) → provider-level, not script-level
   - Unsupported parameter (e.g. `'adaptive' thinking unsupported`) → parameter-level, not provider-level
   - Context overflow (token limit) → input-level, not provider-level
   - API overload / rate limit → transient, may retry with backoff

2. **Route to fallback provider** — If primary provider (MiniMax) has quota exhaustion, route to alternate:
   - Fallback: DeepSeek V4 Pro (set via `SPAWN_QUALITY` fallback chain in `spawn_config.js`)
   - Record the fallback explicitly so the main session and future steps know which provider is being used

3. **Adjust thinking parameter** — DeepSeek V4 Pro does NOT support `thinking:adaptive`. If the spawn config specifies `adaptive`, retry with `thinking:high`:
   - Parse the original spawn parameters
   - Replace `adaptive` with `high` in the thinking field
   - Do NOT remove thinking entirely (that degrades quality)
   - Log the parameter adjustment for traceability

4. **Respawn with corrected parameters** — Create a new sub-agent spawn with:
   - Provider: DeepSeek V4 Pro (or confirmed fallback)
   - Thinking mode: `high` (not `adaptive`)
   - Same task context and instructions as original
   - No `yield` from previous spawn — the failed sub-agent is abandoned

5. **Verify fallback stability** — After the sub-agent returns, check for additional provider-specific failures:
   - DeepSeek has different rate limits than MiniMax — if quota also exhausted, escalate to the operator
   - If the sub-agent returns partial results, validate completeness before continuing

6. **Log the fallback chain** — Record in memory or the session plan:
   - Original provider: MiniMax M3
   - Failure reason: token quota exhausted
   - Fallback provider: DeepSeek V4 Pro
   - Parameter adjustment: `thinking:adaptive` → `thinking:high`
   - Result: success / failure (with failure detail)

## Pitfalls

- ⚠️ Retrying the same provider after quota exhaustion — The error is not transient; retrying same provider/parameters will hit the same quota limit. Always route to alternate provider.
- ⚠️ Removing thinking parameter entirely on fallback — On DeepSeek, dropping `thinking` completely degrades output quality. Convert `adaptive` to `high`, don't omit it.
- ⚠️ Assuming all fallback providers support the same parameters — DeepSeek V4 Pro does not support several MiniMax-specific parameters (`thinking:adaptive`, `max_tokens` values beyond 8192). Always validate the parameter contract.
- ⚠️ Assuming the fallback succeeds just because the spawn command ran — Provider returns can mask failures. Always check (1) exit code, (2) error text, (3) output completeness.
- ⚠️ Nested fallback loops — If both providers fail, do NOT auto-retry the first provider again. The fallback chain is linear (primary → fallback → escalate). Escalate to operator after 2 consecutive failures.
- ⚠️ Not logging fallback reason — Without logging which provider failed and why, future steps can't optimize routing or detect systemic issues. Always store the failure chain.
