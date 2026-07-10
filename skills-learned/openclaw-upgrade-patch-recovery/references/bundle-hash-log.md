# OpenClaw Bundle Hash Log

Record bundle hash changes here after each `openclaw update run`.

| Date | Bundle Hash | OpenClaw Version | Patched By |
|---|---|---|---|
| 2026-07-08 | CCReftdY | prior | A方案 JS patch |
| 2026-07-08 | Duta-cpW | upgrade | A方案 JS patch |
| 2026-07-09 | BriI2__w | upgrade | reapply_fallback_patch.js |
| | | | |

## Finding the Current Bundle Hash

```bash
ls /opt/homebrew/lib/node_modules/openclaw/dist/agent-runner.runtime-*.js
```

Extract the hash:
```bash
ls /opt/homebrew/lib/node_modules/openclaw/dist/agent-runner.runtime-*.js | grep -o 'runtime-[^.]*'
```

## Verifying Guards Are Present

```bash
grep -n 'OPENCLAW_SILENT_FALLBACK' /opt/homebrew/lib/node_modules/openclaw/dist/agent-runner.runtime-*.js
```

Expected: ≥2 matches (one inside `buildFallbackNotice`, one inside
`buildFallbackClearedNotice`).
