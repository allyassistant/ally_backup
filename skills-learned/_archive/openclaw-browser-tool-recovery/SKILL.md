---
name: openclaw-browser-tool-recovery
description: Recover OpenClaw browser tool from null responses by fixing plugins.allow config drift and forcing cached-state invalidation.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-23T05:31:02.000Z
---

## Workflow

1. **Test browser availability** — Call the browser tool with a simple command (e.g., navigate to a local page or check status). Observe whether it returns `null`, an empty response, or an explicit error.

2. **Diagnose null-return pattern** — When browser returns null despite `enabled: true` in the config, the root cause is typically `browser` missing from `plugins.allow`. This causes `isDefaultBrowserPluginEnabled()` to return `false` and `startBrowserControlServiceFromConfig()` to return `null`.

3. **Verify plugins.allow config** — Read the OpenClaw config file (e.g., `~/.openclaw/config.json` or the active config endpoint) and check whether `"browser"` is listed in `plugins.allow`. If absent, this is the drift.

4. **Add browser to plugins.allow** — Update the config to include `"browser"` in the `plugins.allow` array. Write the updated config back.

5. **Force hard restart via launchctl** — Run `launchctl kickstart -k gui/<uid>/com.minimax.openclaw` (or the equivalent plist label). This clears SIGUSR1-hot-reload-invisible cached state. A plain SIGUSR1 signal or soft restart is insufficient — the plugin registry state persists.

6. **Re-verify browser tool** — Call the browser tool again and confirm it returns a valid response with `enabled: true`, `running: true`, `cdpReady: true`.

## Pitfalls

- ⚠️ `launchctl kickstart -k` vs SIGUSR1 confusion — SIGUSR1 hot-reload clears message-queue state but leaves the plugin registry cached. The allowlist entry change never propagates unless you kill and restart the service. Always use `launchctl kickstart -k` for plugin-config changes.

- ⚠️ Browser tool returns null silently when not in plugins.allow — `enabled: true` in the config is misleading. The tool returns `null` from `startBrowserControlServiceFromConfig()` with no explicit error message. The session appears healthy but all browser calls silently fail.

- ⚠️ Config write without service restart when OpenClaw is running — If the service is not restarted after config update, the in-memory plugin registry never reflects the allowlist change. The config file on disk is correct but the running process still uses the old state.

- ⚠️ SSRF blocks are expected behavior — Private-network access is blocked by `dangerouslyAllowPrivateNetwork: false` by design. This is NOT a browser tool failure; it is a security policy. Test with public URLs to confirm tool recovery.

- ⚠️ Chrome process persists after failed attempts — Zombie Chrome processes (e.g., pid 68042) may linger after previous failed browser calls. The tool detects them and reuses them, but stale CDP connections can cause `cdpReady` to be true while commands silently fail. `launchctl kickstart -k` also cleans these up.
