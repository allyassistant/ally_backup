---
name: openclaw-managed-upgrade
description: 透過 managed service API 升級 OpenClaw 並驗證 gateway 重啟成功的流程
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T02:07:36.138Z
---

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
