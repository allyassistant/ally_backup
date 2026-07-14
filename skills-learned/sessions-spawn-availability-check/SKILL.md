---
name: sessions-spawn-availability-check
description: Detect sessions_spawn unavailability and gracefully fall back to direct exec or async yield when sub-agent spawns are blocked.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-14T06:00:00.000Z
---

## Workflow

1. **Identify the failure mode** — Check which phase the spawn timed out in:
   - `tool-execution-started`: The spawn call itself started but the exec tool (subprocess) didn't complete within timeout. Likely the target script hung or the gateway is saturated.
   - `model-call-started`: OpenClaw initialized an isolated LLM session but the model provider didn't respond. Classic cold-start or transient rate-limit on MiniMax.
   - `tool-call-finished` or `yielded`: The sub-agent ran but returned incomplete output or token overflow.
   - `sessions_spawn returned error code N`: Direct exec failure.

2. **Check `spawn_config.js`** for the configured provider's `type` field. Run:
   ```bash
   grep -n "type:" ~/.openclaw/workspace/configs/spawn_config.js | head -20
   ```
   If a provider has `type: "noop"`, it **always reports healthy** without making any HTTP probe. This means `failure_recovery` will never mark it unhealthy, even when it returns 429 rate-limit errors.

3. **Detect the noop-mask symptom** — When Kimi (or any `type: noop` provider) rate-limits:
   - `sessions_spawn` returns HTTP 429 at the spawn call site
   - But `failure_recovery` has no record of Kimi being unhealthy (it never probe-failed)
   - The fallback chain never triggers because the framework thinks the provider is fine
   - Result: silent spawn failure with no automatic recovery

4. **Apply the fix (Option B — 429 fallback injection)** — Add 429 detection directly into `spawn_config.js`'s failure path. This intercepts the error at the exact location it occurs, regardless of the provider's `type` or `failure_recovery` state:
   ```bash
   node -e "
   const cfg = require('$(find ~/.openclaw -name spawn_config.js | head -1)');
   // Verify kimi entry exists
   console.log('kimi type:', cfg.providers?.kimi?.type);
   console.log('kimi failure_recovery:', JSON.stringify(cfg.providers?.kimi?.failure_recovery));
   "
   ```
   Then modify the spawn route handler to catch `status === 429` in the response and manually trigger a `failure_recovery` mark + fallback advance, rather than relying on `probeProvider` to pre-detect unhealthiness.

5. **Verify fix** — After patching, trigger a test spawn and confirm:
   - The 429 response is intercepted before returning
   - `failure_recovery` records the provider as unhealthy
   - The fallback chain advances to the next provider
   - The sub-agent completes successfully via fallback

## Pitfalls

- ⚠️ **`type: noop` is a silent death trap** — The provider always returns `true` from `probeProvider()`, so `failure_recovery` never knows it failed. Add explicit 429 handling in the spawn call site; do not rely on the health-probe path for rate-limit detection.
- ⚠️ **Cold-start timeout masquerading as model unavailability** — When `model-call-started` times out but the model is working fine in the main session, the issue is MiniMax isolated session cold-start latency (120s hard timeout exceeded). Diagnose with `cron-model-call-timeout-diagnosis`; do not confuse with provider outage.
- ⚠️ **`sessions_spawn` returning exit code 0 with truncated output** — The spawn succeeded but the sub-agent hit a token limit. Check for `yielded` events or partial output files; do not assume the session completed.
- ⚠️ **Concurrent same-model rate-limit** — If the main session is also using the same model as the spawn target, both can hit rate limits simultaneously. Cross-check main session activity timestamps with cron timeout correlation; fall back to `concurrent-session-rate-limit-avoidance` if correlated.
- ⚠️ **Gateway saturated — tool-execution-started timeout** — When the gateway has too many concurrent tasks, even simple script execs can time out at `tool-execution-started`. Check `openclaw gateway status` for queue depth; do not assume the script itself hung.
