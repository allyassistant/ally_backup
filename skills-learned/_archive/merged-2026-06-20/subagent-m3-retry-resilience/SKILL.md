---
name: subagent-m3-retry-resilience
description: Detect M3 spawn API failures and retry with circuit-breaker, while layering session filters over path filters for defense-in-depth when adversarial review challenges Option A.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T06:31:01.230Z
---

## Workflow

1. **Detect spawn failure** — Watch for API 500/502/503 responses from `sessions_spawn`. Distinct from LLM token-limit errors; these are HTTP transport failures from the spawn endpoint itself.

2. **Retry with exponential back-off** — Re-call `sessions_spawn` up to 2 times with `sleep 3` between attempts. Log each retry. M3 subagent idempotency is high; a second call with identical parameters produces the same result.

3. **Cross-check spawn config** — Before retrying, run `openclaw spawn-config get` to confirm M3 model tier is still valid. A 500 on a misconfigured route persists across retries.

4. **Layer session filter over path filter** — When adversarial M3 returns "Option A insufficient", patch the defense with two layers: (a) session-based skip — detect isolated cron sessions and bypass entirely; (b) fix-type whitelist — restrict allowed fix modes to `syntax-error` and `undefined-symbol`, blocking style-related changes.

5. **Report retry outcome** — After retry success or final failure, post a concise summary to Discord with: original error, retry count, final status, and recommended next action.

## Pitfalls

- ⚠️ Retrying M3 spawn without checking spawn config — if the 500 is caused by an invalid model or tier, retries hit the same endpoint indefinitely until token budget is exhausted.

- ⚠️ Relying on path-based filtering alone — path strings can be spoofed or mis-ordered in the write block; session-based filtering (isolated cron vs. main session) is context-aware and more robust.

- ⚠️ Forgetting to update the fix-type whitelist after adversarial review — D3 (whitelist) is a separate config layer from D1 (session filter); both must be updated atomically or the weaker layer creates a gap.

- ⚠️ Treating M3 API 500 the same as LLM timeout — HTTP transport errors are retry-safe; LLM token limits require different handling (adaptive thinking fallback, not just retry).

- ⚠️ Not logging retry count — if retry succeeds on attempt 2, there is no trace without explicit logging; future debugging cannot distinguish first-attempt success from delayed success.
