---
name: openclaw-gateway-plugin-cache-debugging
description: Fix plugin hooks that silently break after code changes (stale cache).
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T07:31:01.248Z
---

## Workflow

1. **Reproduce the hook failure** — Run the trigger condition and confirm the expected telemetry event (e.g., `skip_skill_path`) does not appear, while the hook silently falls through to the next layer.

2. **Verify code correctness in isolation** — Run the plugin's unit tests independently (e.g., `node test/layer2.test.js`) and confirm they pass. If tests fail, fix the code first — this workflow assumes the logic is correct.

3. **Inspect gateway status** — Run `openclaw gateway status` and record:
   - Gateway PID
   - Whether `coalesced: true` appears in the output
   - Whether the restart was via SIGUSR1 (soft) vs `stop; start` (hard)

4. **Check PID stability across restarts** — If the PID is unchanged after a restart, the gateway did not re-fork and is likely using the cached plugin module. SIGUSR1 restarts do not reload the plugin bundle in Node.js.

5. **Force a hard restart** — Run:
   ```bash
   openclaw gateway stop
   openclaw gateway start
   ```
   This ensures a fresh PID and forces the gateway to re-resolve `require()` calls, loading the updated plugin bundle.

6. **Verify plugin reload** — Re-run `openclaw gateway status` and confirm:
   - PID has changed (proves a new process started)
   - `coalesced: true` no longer appears (or appears with fresh values)
   - The expected telemetry event now fires

7. **Spawn M3 for deeper investigation if hard restart doesn't resolve it** — Use `sessions_spawn` to delegate root cause analysis to an M3 sub-agent with the gathered evidence (gateway status output, PID before/after, telemetry gap).

## Pitfalls

- ⚠️ Using SIGUSR1 (soft restart) expecting the plugin to reload — Node.js `require()` caches modules in memory; SIGUSR1 only triggers the existing hook's reload logic, not the gateway's plugin bundle reparse. PID stays the same, `coalesced: true` persists.

- ⚠️ Misreading `coalesced: true` as a normal state — this flag indicates the gateway reused a cached plugin session across restarts. It is a diagnostic signal that the plugin bundle was not re-fetched.

- ⚠️ Assuming code correctness means runtime correctness — tests verify isolated logic, not how the gateway's plugin loader resolves and binds the hook at startup. If the gateway cached the old bundle, the new code never runs even with correct tests.

- ⚠️ Confusing the hook not firing with the hook failing silently — no `skip_skill_path` event means the hook never ran, not that it ran and errored. Check telemetry before assuming the hook's internal logic is the problem.

- ⚠️ Forgetting to re-verify after hard restart — sometimes a second restart is needed if the gateway's process manager holds a reference. Always confirm PID change before declaring the issue resolved.

## When to Escalate to M3

If all diagnostic steps above pass (PID changed, `coalesced` gone, tests pass) and the hook still doesn't fire, the issue is likely deeper — either the hook registration timing, the plugin loader's symbol resolution, or an interaction between multiple plugin layers. Spawn an M3 sub-agent with the full context (gateway status output, PID history, test results, and the plugin's source path).
