---
name: openclaw-upgrade-patch-maintenance
description: Maintain OpenClaw dist/ patches and service env vars after npm upgrade by detecting wipe events and re-applying patches with gateway restart.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-20T22:31:06.751Z
---

## Workflow

1. **Detect upgrade event.** After `openclaw update --yes` or `npm update`, compare the new dist/ bundle filename hash against the known-good hash in the relevant issue. If the hash changed, patches were wiped.
2. **Check JS patch integrity.** Read the new dist/ bundle file and locate the patched function (e.g., L150 + L158 in `agent-runner.runtime-*.js`). Verify the patch condition is present — if missing or reverted, re-apply it.
3. **Check service env var.** Read `/Users/ally/.openclaw/service-env/ai.openclaw.gateway.env` and verify the required variable (e.g., `OPENCLAW_SILENT_FALLBACK='true'`) is present. If missing, re-add it.
4. **Restart gateway if patches were re-applied.** Run `openclaw gateway restart` to load the new bundle into memory. A gateway restart is required even if the JS file was edited, because the old bundle is cached in the running process.
5. **Verify state post-restart.** Confirm new PID and verify patch + env var are in place. Warn that `error_auto_issue` will not auto-create a new issue if the patch fails again, because the error scanner may be paused.

## Pitfalls

- ⚠️ **Assuming patch survives npm update** — `npm update` rewrites `node_modules/openclaw/dist/` entirely, replacing the patched bundle. Every upgrade requires manual re-verification. There is no auto-backup of patched files.
- ⚠️ **Restarting before re-applying patch** — restarting the gateway loads the new (unpatched) bundle. Always apply patch first, then restart. If you restart first, the unpatched bundle gets cached in memory and the patch won't take effect until the next restart.
- ⚠️ **Gateway env file survives upgrade but JS patch does not** — the `service-env/` directory is outside `node_modules/`, so env vars persist across upgrades. Only the dist/ JS patches are wiped. Always check both independently.
- ⚠️ **Monitoring gap after upgrade** — if `error_auto_issue` cron is paused, no automated detection will fire when the patch is wiped. Explicitly warn the user to monitor for 24h after upgrade.
- ⚠️ **Bundle hash naming is non-deterministic** — the hash suffix in `agent-runner.runtime-*.js` changes on every upgrade. Use pattern matching (`runtime-*.js`) rather than hardcoded hashes when locating the file for patching.
