---
name: smart-router-multi-model-verification
description: Verify smart router behavior across multiple models by spawning sub-agents, running identical prompts, and comparing actual responses.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T18:31:01.265Z
---

## Workflow

1. **Read route config** — load `~/.openclaw/route_model.yaml` and `~/.openclaw/spawn_config.js` to confirm all routes and model mappings are defined correctly.

2. **List target models to test** — identify the models the router should route to (e.g. `kimi/kimi-for-coding`, `minimax-portal/MiniMax-M2.7`, `minimax-portal/MiniMax-M3`). Include at least 3 distinct models for meaningful comparison.

3. **Spawn sub-agents for each model** — use `sessions_spawn` with each model's route, running an identical simple prompt (e.g. `"1, 2, 3, 4, 5"`). Spawn all in parallel for speed.

4. **Wait and collect responses** — use `sessions_yield` to wait for each sub-agent, then `sessions_history` to read the actual response text from each.

5. **Verify real API calls** — check that responses are not identical hardcoded mocks and that runtime is consistent with an actual LLM call (typically 3–10 seconds for simple prompts). If all models return the same string, the test is likely bypassed by model override or hook.

6. **Compare decision logs** — read `~/.openclaw/.router_decision_log.jsonl` and verify that `actualProvider` matches the expected model for each call. Flag any entries where the resolved model doesn't match the intended route.

7. **Report results** — present a table with Model | Route | Response | Runtime. Flag any anomalies where routing was bypassed or models returned no-response (`null`).

## Pitfalls

- ⚠️ All models return identical response string — indicates the test is hitting a mock or bypass path, not a real LLM call. The session may be cached or the route-enforcer plugin may be overriding to a single model.

- ⚠️ Decision log accumulates thousands of stale entries from `deepseek` calls after provider removal — the log file grows without cleanup, making real entries hard to locate. Rotate or truncate the log before running fresh verification tests.

- ⚠️ Model override from route-enforcer plugin silently bypasses routing — `routeModel()` returns an override that redirects all spawns to a single model regardless of route config. Check `~/.openclaw/plugins/route-enforcer/dist/index.js` for hardcoded `modelOverride` values that persist after config changes.

- ⚠️ Spawned sub-agent yields with empty response — the sub-agent may timeout or get blocked by allowlist before returning. Verify the model's provider is on the allowlist and the API key is present in `models.providers.<name>.apiKey`.

- ⚠️ Confusing "config test" with "actual LLM call" — the `openclaw model test` command tests config validity, not actual API reachability. Only `sessions_spawn` with a real prompt produces verifiable routing evidence.
