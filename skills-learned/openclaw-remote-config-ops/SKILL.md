---
name: openclaw-remote-config-ops
description: Inspect or change OpenClaw model configs on a remote machine over SSH.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-16T06:10:00.000Z
---

## Workflow

1. **SSH into the remote machine.**
   Use `ssh user@host` with the known hostname or IP. If interactive host-key verification blocks the connection, use `-o StrictHostKeyChecking=no` or pre-populate `~/.ssh/known_hosts`. Example for Bliss:
   ```bash
   ssh <user>@bliss -o StrictHostKeyChecking=no
   ```

2. **Locate the OpenClaw config file.**
   Run `openclaw config show` to get the config path, or directly inspect the workspace config:
   ```bash
   cat ~/.openclaw/workspace/config.json
   cat ~/.openclaw/config.json
   ```
   Bliss config is typically at `~/.openclaw/workspace/config.json`.

3. **Extract the model configuration.**
   Parse the `defaults.model` field from the config JSON. Use `jq` if available:
   ```bash
   cat ~/.openclaw/workspace/config.json | jq '.defaults.model'
   ```
   Or fall back to `grep`:
   ```bash
   grep -A5 '"defaults"' ~/.openclaw/workspace/config.json
   ```
   Note the primary model and the full fallback chain.

4. **Present findings to the user.**
   Report the current primary model, fallback order, and any aliases present. Compare against the local Ally config if relevant to highlight differences.

5. **Offer to modify the config (if requested).**
   If the user wants to change the model, use `openclaw config set` or edit the JSON directly:
   ```bash
   openclaw config set defaults.model "<primary-model>"
   openclaw config set defaults.fallback '<["model1","model2"]>'
   ```
   Alternatively, use a safe JSON edit via temporary file:
   ```bash
   cp ~/.openclaw/workspace/config.json ~/.openclaw/workspace/config.json.bak
   cat ~/.openclaw/workspace/config.json | jq '.defaults.model = "minimax-portal/MiniMax-M2.7"' > /tmp/config_new.json
   mv /tmp/config_new.json ~/.openclaw/workspace/config.json
   ```

6. **Restart the OpenClaw gateway if config was modified.**
   After any config change, the gateway must be restarted for changes to take effect:
   ```bash
   openclaw gateway restart
   ```
   Or use the LaunchAgent directly:
   ```bash
   openclaw gateway status  # verify current state
   launchctl kickstart -k gui/501/ai.openclaw.gateway
   ```

7. **Verify the restart and new model are active.**
   Confirm the gateway is running and, if possible, verify the active model:
   ```bash
   openclaw gateway status
   openclaw models list
   ```

## Pitfalls

- ⚠️ **Config change takes effect only after gateway restart** — modifying `defaults.model` in the JSON file has no effect until the OpenClaw gateway process is restarted. Forgetting this step causes the user to report "the model didn't change."

- ⚠️ **SSH host-key verification blocking first connection** — on a fresh machine or after host key rotation, the first SSH attempt hangs waiting for host-key confirmation. Always use `-o StrictHostKeyChecking=no` for unattended SSH, or pre-seed `known_hosts`.

- ⚠️ **Different machines use different model aliases** — Bliss uses `kimi/kimi-for-coding` as primary while Ally uses `deepseek/deepseek-v4-flash`. Copying the local config directly to a remote machine may reference models not available there. Always read the remote config first before suggesting changes.

- ⚠️ **Backup before editing** — always `cp config.json config.json.bak` before modifying. A malformed JSON edit can corrupt the config and prevent the gateway from starting. The backup enables one-command rollback: `mv config.json.bak config.json`.

- ⚠️ **Config path varies by deployment method** — `openclaw config show` is the reliable way to find the active config path. Hardcoding `~/.openclaw/workspace/config.json` works for Bliss but may miss configs at `~/.openclaw/config.json` or environment-specific overrides on other machines.

- ⚠️ **Stale session after restart** — after `launchctl kickstart`, the old gateway process may linger for a few seconds. Running `openclaw gateway status` immediately after restart may still report the old state. Wait 3–5 seconds before re-checking.


## Absorbed from `openclaw-managed-upgrade` (2026-06-20)

> **Provenance:** score=?, verdict=MERGE, merged via `scripts/merge_skills.js`
> **Original location:** `openclaw-managed-upgrade/SKILL.md` (now in `_archive/merged-2026-06-20/openclaw-managed-upgrade/`)

## Workflow

1. **Check current version**
   Run `openclaw gateway status` or equivalent to capture the pre-upgrade version (e.g. `2026.6.1`).

2. **Trigger managed service upgrade**
   Use the `gateway` tool to invoke the managed service update endpoint. The system queues the upgrade and initiates a gateway restart.

3. **Wait for gateway restart**
   After the managed service commits the update, the gateway process restarts automatically. This may take a few seconds. The assistant's first response after the restart confirms the new version.

4. **Verify post-upgrade version**
   Re-run `openclaw gateway status` or check the version output to confirm the upgrade landed (e.g. `2026.6.5`). Cross-reference with the pre-upgrade version captured in Step 1.

5. **Confirm health**
   Respond with `HEARTBEAT_OK` to confirm the system is stable post-restart. If any anomaly appears, fall back to `system-code-debug-triage` workflow.

## Pitfalls

- **Duplicate upgrade requests**: The user may send the same upgrade request multiple times (e.g. Conversation 2 and 3 both requested "幫我升級OpenClaw"). Each subsequent request after the first will respond "有，升咗啦 ✅" — the second call is redundant and should not re-trigger the managed service API. Track upgrade state to avoid re-execution.

- **Managed service API lag**: The managed service update and gateway restart are not instantaneous. Do not immediately query the version after triggering — wait for the system to self-report via the restart confirmation. The `session_status` tool can be used to verify gateway health without re-triggering.

- **Version verification timing**: The version number reported in the restart confirmation (e.g. "2026.6.1 → 2026.6.5") comes from the managed service's own output, not from a live `gateway status` call. Treat it as authoritative but cross-check if the gateway does not respond within expected time.

- **Partial restart state**: If the gateway restarts but the version does not change, the managed service may have hit a snag. Do not assume success — explicitly re-check with `openclaw gateway status` before declaring the upgrade complete.

- **No rollback path in managed upgrade**: Unlike self-hosted upgrades, managed service upgrades do not expose a rollback knob from the agent side. If the upgrade causes regressions, the recovery path is to contact the managed service support channel, not to attempt a manual downgrade.

## References

- `skills/system/openclaw/SKILL.md` — OpenClaw core system documentation (system skill, auto-injected)
- `skills/cron-health-triage` — Gateway health monitoring if post-upgrade checks are needed
- `skills/system-code-debug-triage` — Fallback workflow if upgrade causes unexpected behavior
