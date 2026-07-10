---
name: webbridge-chrome-debugging
description: Debug WebBridge Chrome extension failures by starting a fresh Chrome on a debug port, loading the extension via CDP, and verifying daemon connectivity.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T18:31:01.238Z
---

## Workflow

### Step 0 — Start fresh Chrome on debug port (prerequisite)

Before anything else, launch a separate Chrome instance with remote debugging enabled:

```bash
# Set Chrome remote debugging flag (takes effect without killing existing Chrome)
defaults write com.google.Chrome RemoteDebuggingPort -int 9222

# Launch fresh Chrome with a clean user data directory
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="$HOME/chrome-debug-profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-extensions \
  --remote-debugging-port=9222 \
  > /dev/null 2>&1 &
```

Verify the port is listening:
```bash
sleep 2 && lsof -i :9222 | grep LISTEN
```

> This creates a completely separate Chrome profile isolated from the user's logged-in sessions. No existing browser state is affected.

### Step 1 — Load WebBridge extension via CDP

Once the fresh Chrome is running on port 9222, load the WebBridge extension using Chrome DevTools Protocol:

```bash
# Verify Chrome is reachable via CDP
curl -s http://localhost:9222/json/version | jq .webSocketDebuggerUrl
```

Use `POST /command load_extension` with the WebBridge extension path. The daemon will auto-detect the new Chrome tab and connect.

### Step 2 — Verify daemon connectivity

After loading the extension, check `extension_connected` status:

```bash
curl -s http://localhost:10086/status | jq '.extension_connected, .daemon_version'
```

Expected: `"extension_connected": true`

### Step 3 — Test navigation command

Verify the full pipeline works with a simple navigation:

```bash
POST /command navigate https://example.com
```

Expected response:
```json
{"ok": true, "tabId": "<number>", "frameId": "<hex>"}
```

If you get `{"ok": false, "error": "No current window"}` instead, the extension is not connected — return to Step 1.

### Step 4 — Inspect tab list if navigation fails

If commands fail after Step 2 shows connected, list available tabs to confirm the target page is loaded:

```bash
POST /command find_tab "example.com"
```

This can surface tabs opened under the wrong Chrome instance or profile conflicts.

## Pitfalls

- ⚠️ **Chrome flag set but no new instance launched** — `defaults write` configures the default Chrome, but if Chrome is already running with a cached profile, the new instance won't pick up `--user-data-dir`. Always explicitly launch with `&` background flag to ensure a fresh process.

- ⚠️ **`--user-data-dir` path not absolute** — Relative paths in `--user-data-dir` cause Chrome to create a profile inside the CWD, making the debug port target ambiguous. Always use `$HOME/chrome-debug-profile` or an explicit absolute path.

- ⚠️ **"No current window" despite extension_connected: true** — The extension may be loaded but the WebBridge daemon hasn't registered the target tab yet. Wait 1-2 seconds after loading before issuing navigate commands, or explicitly call `find_tab` to force tab enumeration.

- ⚠️ **WebBridge daemon not listening on port 10086** — The daemon must be started separately (`webbridge-daemon --port 10086`) before Chrome can connect. If `curl localhost:10086/status` returns connection refused, start the daemon first.

- ⚠️ **CDP WebSocket pointing to wrong Chrome instance** — If multiple Chrome instances are running (managed + debug), the WebSocket URL from `curl localhost:9222/json/version` may attach to the wrong process. Kill all Chrome instances except the debug one before connecting.
