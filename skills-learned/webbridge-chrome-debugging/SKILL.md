---
name: webbridge-chrome-debugging
description: Fix WebBridge Chrome extension 'No current window' errors.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-23T05:02:00.000Z
---

## Workflow

1. **Identify the disable layer** — Determine whether the failure originates at the tool layer (OpenClaw browser tool blocking) or the plugin layer (WebBridge extension state). The error message `"browser control disabled"` at the tool layer indicates the gateway itself is blocking browser access, not an extension-level issue.

2. **Check browser tool status** — Run `browser action=status` to confirm the tool layer state. If it reports disabled, note the timestamp and proceed to the fix. This is a gateway-level block, not a script error.

3. **Check plugin-level extension_connected flag** — Inspect the OpenClaw plugin telemetry or gateway logs for `extension_connected` status. A `true` flag means the extension is loaded; `false` means the extension failed to connect to the CDP daemon.

4. **Diagnose the root cause** — Two independent disable points exist:
   - **Tool layer**: The OpenClaw gateway explicitly disables the browser tool via config or runtime flag. Error: `"browser control disabled. Do NOT retry the browser tool."`
   - **Plugin layer**: The WebBridge extension is not connected to the CDP daemon. Error: `"No current window"` or navigate commands silently fail.

5. **Fix tool layer disable** — When the tool layer is disabled (confirmed by `"browser control disabled"` in responses), the fix is to **restart the OpenClaw gateway**. On macOS: use the OpenClaw menubar app → Quit and relaunch. On CLI: `openclaw gateway restart` or find and kill the gateway process, then restart.

6. **Fix plugin layer disconnect** — When the extension is not connected:
   - Verify Chrome remote debugging port is open (default 9222)
   - Check the WebBridge extension ID is loaded in Chrome
   - Reload the extension via `chrome://extensions/`
   - Verify `extension_connected` becomes `true` before retrying navigate commands

7. **Verify recovery** — After gateway restart or extension reload, re-run the original browser command. Confirm `browser action=status` returns a valid session. Then retry the original task (navigate to URL, extract content, etc.).

## Pitfalls

- ⚠️ Retrying browser commands after tool layer reports disabled — the error `"browser control disabled"` is explicit: "Do NOT retry the browser tool — it will keep failing." Restart the gateway first.
- ⚠️ Confusing tool layer disable with plugin layer disconnect — they have different causes and different fixes. Tool layer requires gateway restart; plugin layer requires extension/CDP debugging.
- ⚠️ Assuming extension_connected=true means the browser is usable — the flag confirms the extension is loaded, but the tool layer may still be blocking access independently.
- ⚠️ Forgetting to check both layers sequentially — a plugin layer fix (extension reload) will not resolve a tool layer block; always check the tool layer first.
- ⚠️ Not verifying browser status before attempting navigation — a silent `"No current window"` failure means the extension has no active tab; open a new tab first with `browser action=new` before navigating.
