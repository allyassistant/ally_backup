---
name: openclaw-plugin-telemetry-diagnosis
description: Diagnose why a plugin's telemetry events are not firing, by tracing the async IIFE race condition and applying a sync top-level fix.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T11:01:01.242Z
---

## Workflow

1. **Identify missing telemetry event** — Run `cat ~/.openclaw/.self_healing_loop.jsonl | jq 'select(.type == "<event-name>")'` and compare count against expected events. If count is 0 or unexpectedly low, proceed.

2. **Check plugin file modification timeline** — Run `stat <plugin-path>` to get mtime, then `git log --oneline -10 -- <plugin-path>` to determine when the feature was added. Compare plugin mtime against telemetry event timestamps to verify if the feature existed when the event should have fired.

3. **Locate the event source in plugin code** — Search for the event name in the plugin file: `grep -n "<event-name>" <plugin-path>`. Identify whether the event is emitted from inside an async IIFE within `register()` or from a module-level synchronous block.

4. **Diagnose async IIFE race condition** — If the event is inside an async IIFE in `register()`:
   - The IIFE uses `await import()` or `await fs.stat()` calls
   - The event logging uses `void logTelemetry(...)` (not awaited)
   - The `_telemetryQueue` may not flush before gateway restart/crash
   - This is the root cause of silent failure

5. **Apply sync top-level fix** — Move the diagnostic event emission from inside `register()` to module top-level:
   - Replace async IIFE with synchronous `fs.statSync()` + `fs.appendFileSync()`
   - Use `import.meta.url` or `fileURLToPath` for path resolution
   - Remove the `_telemetryQueue` dependency entirely
   - Verify with `node --check <plugin-path>`

6. **Restart gateway to apply changes** — Run `openclaw gateway restart` and confirm new PID. The plugin module is re-loaded on gateway start.

7. **Verify event fires** — After restart, trigger the event (e.g., send a test message) and check telemetry: `cat ~/.openclaw/.self_healing_loop.jsonl | jq 'select(.type == "<event-name>")' | tail -3`. Confirm count increases and timestamp is recent.

8. **Clean test artifacts** — Remove any `_test.js` or `_diag.js` files created during diagnosis to prevent cleanup noise in telemetry.

## Pitfalls

- ⚠️ Investigating why a feature "doesn't work" without checking if it existed at the event timestamp — the 2 spawn_ok events at 11:27 and 12:48 HKT occurred BEFORE the notification feature was implemented at 12:30-13:15 HKT, making the investigation moot.

- ⚠️ Async IIFE inside `register()` with un-awaited `logTelemetry()` — the IIFE competes with the plugin host lifecycle; `_telemetryQueue` microtasks may not drain before gateway crashes or restarts. Always use synchronous top-level execution for critical diagnostic events.

- ⚠️ Dynamic `import()` inside async IIFE — if the plugin uses `await import('openclaw')` or similar, the import may fail silently in the plugin context (empty catch block swallows errors). Prefer static imports or sync file operations.

- ⚠️ File mtime vs code content mismatch — `stat` shows the file was modified at 18:44, but the content at 11:27 was different. Always cross-reference git history to determine what code actually existed at a given timestamp.

- ⚠️ Forgetting to restart gateway after plugin code changes — the Node.js module is cached; changes don't take effect until `openclaw gateway restart` triggers a fresh load.

- ⚠️ Plugin host lifecycle timing — `register()` runs during plugin loading; any async work inside it races against the host's readiness check. Sync operations at module top-level are guaranteed to complete before `register()` is called.

## References

- OpenClaw plugin architecture: plugins are loaded via `import()` and must export a `register(api)` function
- Telemetry file location: `~/.openclaw/.self_healing_loop.jsonl`
- Gateway PID tracking: `openclaw gateway status` shows current PID
- JSONL log format: `{"type":"<event>","ts":"<ISO>","data":{...}}`
