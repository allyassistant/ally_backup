---
name: openclaw-external-hook-discovery
description: Diagnose why external OpenClaw hooks are listed but not loaded by the gateway, then fix by running openclaw hooks install with --link to register the hook.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-11T13:31:01.258Z
---

## Workflow

1. **Check hook visibility** — Run `openclaw hooks list` and confirm the external hook appears in the output.

2. **Verify gateway loading** — Look for evidence that the hook is NOT being loaded (no effect on behavior, no log entries, no telemetry events). The hook is present but inert.

3. **Identify root cause** — The gateway does NOT auto-discover external hooks in `~/.openclaw/hooks/`. Listing the hook does not mean the gateway has registered it.

4. **Apply fix** — Run `openclaw hooks install --link ~/.openclaw/hooks/<hook-name>` to explicitly register the hook with the gateway:
   ```bash
   openclaw hooks install --link ~/.openclaw/hooks/message-classifier
   ```
   Replace `<hook-name>` with the actual directory name under `~/.openclaw/hooks/`.

5. **Verify fix** — Restart the gateway with `openclaw gateway restart` and confirm the hook is now active and affecting behavior.

6. **Alternative approach (advanced)** — Convert the external hook into an internal plugin bundled in `~/.openclaw/plugins/`. This is more complex and rarely necessary — prefer the `--link` method.

## Pitfalls

- ⚠️ Assuming `openclaw hooks list` means the hook is loaded — the list command only verifies the hook file exists, not that the gateway has registered it. Listing ≠ loading.
- ⚠️ Running `openclaw hooks install` without `--link` flag — plain `openclaw hooks install <path>` may copy the hook instead of linking it, causing the source to become stale after updates.
- ⚠️ Gateway restart omitted — after `openclaw hooks install --link`, the gateway must be restarted or the hook remains unloaded in the current process.
- ⚠️ Hook directory vs hook name confusion — `~/.openclaw/hooks/message-classifier/` is the directory; the install command needs the full path to that directory, not just the name.
- ⚠️ Mixing internal and external hook directories — `~/.openclaw/hooks/` is for external user hooks; `~/.openclaw/plugins/` is for internal plugins. Installing to the wrong location silently fails.
