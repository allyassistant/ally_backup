---
name: openclaw-upgrade-patch-resilience
description: Reapply custom JS patches and env vars after OpenClaw upgrades, track bundle hash drift, and verify gateway restart status.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-09T05:31:01.243Z
stability: experimental
---

## Activation condition
Promote to status: active when the skill has been recalled (via skill-auto-suggest
or direct invocation) ≥3 times in a rolling 7-day window with no quality regression
or user override.

## Context

OpenClaw `update run` regenerates two critical files that carry custom workarounds:
- `~/.openclaw/runtime/agent-runner.runtime-*.js` — JS patches (function-level edits)
- `~/.openclaw/gateway/.env` — env vars like `OPENCLAW_SILENT_FALLBACK`

After every upgrade, these files revert to their shipped defaults. Bundle hash
changes (`BriI2__w` was the 2026-07 upgrade hash) serve as a drift indicator.

## Workflow

1. **Confirm upgrade completion.** Run `openclaw gateway status` and note the new
   PID. Compare with the PID recorded before the upgrade. If PID changed, a
   restart is pending.

2. **Check JS patch survival.** Open `~/.openclaw/runtime/agent-runner.runtime-*.js`
   and grep for your custom guard string (e.g. `OPENCLAW_SILENT_FALLBACK`). If
   absent, the JS patch was wiped and must be reapplied.

   ```bash
   grep -n "OPENCLAW_SILENT_FALLBACK" ~/.openclaw/runtime/agent-runner.runtime-*.js
   ```

3. **Check env var survival.** Inspect `~/.openclaw/gateway/.env` for the expected
   key. The env file is regenerated on upgrade, so any custom keys outside
   `OPENCLAW_SERVICE_MANAGED_ENV_KEYS` list are dropped.

   ```bash
   grep "OPENCLAW_SILENT_FALLBACK" ~/.openclaw/gateway/.env
   ```

4. **Re-apply JS patch.** Open the current bundle file, locate the patched
   functions (lines shift on every upgrade — use the function body as anchor, not
   line numbers), and insert the guard. Current known targets:
   - `BriI2__w` bundle: L151 (fallback chain check) and L158 (no-reply handler)

5. **Re-apply env var.** Append to `~/.openclaw/gateway/.env`:
