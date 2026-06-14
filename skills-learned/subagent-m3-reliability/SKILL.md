---
name: subagent-m3-reliability
description: 診斷並修復 M3 sub-agent 失敗——output token limit、API overload、partial completion、thinking:high 不支援，以及 M3 failure → NO_REPLY chain
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T19:01:01.228Z
---

## Workflow

1. **Detect M3 failure mode** — When M3 sub-agent fails, check error message for one of three patterns:
   - `Output token limit exceeded` → M3's 4096-token output cap hit (streaming does not extend it)
   - `Rate limit` / `Usage limit` / `Token Plan` → API quota exhausted for this model
   - `timeout` / `gateway error` / 502 → Provider-level overload, not model-specific
   - `Unsupported parameter` / `thinking:high` → M3 does not support all OpenAI-compatible params

2. **Differentiate provider vs model failure** — Run `curl -X POST "$MINIMAX_ENDPOINT/v1/text/chatcompletion" -H "Authorization: Bearer $MINIMAX_KEY" -d '{"model":"minimax-m3","messages":[{"role":"user","content":"ping"}]}'` with minimal payload. If successful, provider is fine and error is parameter/context related.

3. **Handle output token limit** — Set `max_tokens: 2048` (half the 4096 limit) when spawning M3 for long-form analysis, or switch to direct execution without sub-agent for content that exceeds ~3,000 tokens.

4. **Handle `thinking:high` rejection** — M3 rejects `"thinking":"high"` with parameter error (only `auto` or `adaptive` supported for abab7.5+ models). Always use `"thinking":"adaptive"` when spawning M3, never `"thinking":"high"`. Document this in spawn configuration comments.

5. **Handle API usage limit** — When M3 Token Plan is exhausted mid-session:
   - If analysis is already partially received, use available content (truncated analysis is better than none)
   - If analysis hasn't started, fall back to direct execution (no sub-agent) for same task
   - Log in memory that M3 was unavailable so future attempts can beware degraded analysis quality

6. **Verify recovery** — After applying fix, re-spawn the sub-agent with corrected parameters. If same failure recurs twice, abort sub-agent attempt and switch to direct execution fallback.

7. **Detect NO_REPLY chain from M3 failure** — M3 failure with empty response triggers OpenClaw's NO_REPLY mechanism, causing the main session to produce `NO_REPLY` instead of normal output. If assistant output contains only `NO_REPLY`, check if a sub-agent was spawned in the previous turn — that's likely the root cause, not a main session issue.

## Pitfalls

- ⚠️ `thinking:high` silently rejected by M3 API — The error message may not include "thinking" explicitly; check for `Unsupported parameter` or `Invalid value for parameter` patterns. Always inspect raw API response when M3 spawns fail.
- ⚠️ API usage limits hit mid-session — If one conversation runs 5+ M3 spawns, the Token Plan (usually ~1M tokens/day) can exhaust. Switch to resource-conservation mode: reduce sub-agent spawns, merge analysis requests, or fall back to M2.7 for non-critical tasks.
- ⚠️ Partial M3 output is better than no output — When M3 crashes mid-response due to token limit, the partial JSON or text may still contain valuable data. Extract and use what's available rather than discarding and retrying.
- ⚠️ M3 failure → NO_REPLY crater — An M3 failure that returns empty response triggers OpenClaw's silent delivery mechanism, producing `NO_REPLY` output in the main session. This is easily misdiagnosed as a main session problem. Trace back: if assistant output is just `NO_REPLY` and the previous turn spawned a sub-agent, the sub-agent is the culprit.
- ⚠️ Rate limit recovery not immediate — After hitting M3 usage limits, waiting 30-60 seconds is insufficient. The daily quota reset time varies by provider plan; check `minimax-portal` vs `minimax:default` auth differences. Consider rotating to fallback model temporarily.
