---
name: openclaw-ssrf-policy-browser-fix
description: Fix SSRF policy blocks on browser hostname navigation by toggling dangerouslyAllowPrivateNetwork in gateway config, then verifying after restart.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-23T06:31:01.255Z
---

## Workflow

1. **Identify the SSRF block symptom** — When `browser open https://example.com` or any hostname navigation returns a SSRF error or silently fails, the gateway SSRF policy is too restrictive. The policy condition is `dangerouslyAllowPrivateNetwork === false`.

2. **Locate the gateway config file** — Run `find ~/.openclaw -name "*.json" | xargs grep -l "dangerouslyAllowPrivateNetwork"` to find the active config. Typically in `~/.openclaw/gateway/config.json` or `~/.openclaw/config/gateway.json`.

3. **Patch the property to `true`** — Edit the config file and set `"dangerouslyAllowPrivateNetwork": true`. This bypasses the private-network block and allows hostname resolution for browser navigation.

    ```bash
    # Example: set via jq if the property exists, or add it
    openclaw gateway status   # confirm current PID before restart
    ```

4. **Restart the gateway** — Apply the config change:
    ```bash
    openclaw gateway restart
    ```
    Confirm the new PID differs from the old one to verify restart occurred.

5. **Verify browser functionality** — Test the previously blocked navigation:
    ```bash
    browser action=status
    browser open https://example.com
    ```
    Both should respond normally with no SSRF errors.

6. **Confirm tab operations work** — Verify `browser close` and other tab operations also function correctly after the fix.

## Pitfalls

- ⚠️ **Restart required for config apply** — Editing `dangerouslyAllowPrivateNetwork` has no effect until the gateway process restarts. The config change is inert without `openclaw gateway restart`.

- ⚠️ **Security trade-off is real** — Setting `dangerouslyAllowPrivateNetwork: true` allows the browser tool to potentially reach private/internal network hosts. This is a deliberate risk/functionality tradeoff. Document the change and assess whether it suits the deployment environment.

- ⚠️ **Config location may vary across versions** — In older OpenClaw versions the property lives in `~/.openclaw/gateway/config.json`; newer versions may use `~/.openclaw/config/gateway.json` or environment variables. Always confirm the actual config path by searching for the property, not assuming a hardcoded path.

- ⚠️ **Silent failure looks like browser tool broken** — The SSRF block manifests as a silent navigation failure or a cryptic SSRF error, not as an obvious config error. This misleads diagnosis toward `openclaw-browser-tool-recovery` when the root cause is the SSRF policy. Always check for `dangerouslyAllowPrivateNetwork` when browser navigation fails silently.

- ⚠️ **Gateway restart may fail if PID is wrong** — If `openclaw gateway restart` reports success but PID does not change, the gateway did not actually restart and config changes are not applied. Always verify PID change explicitly.
