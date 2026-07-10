---
name: yaml-config-drift-detection
description: 檢測並修復 YAML 配置文件與 AGENTS.md 之間的模型配置漂移問題
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T03:37:39.926Z
---

## Workflow

1. **Identify canonical model source** — Read AGENTS.md to determine the canonical model for each route type (SPAWN/SOP/CODE etc.)

2. **Scan router YAML configs** — Use `grep` or `yq` to extract all model references from `scripts/router/route_model.yaml` and other router configs

3. **Compare against canonical** — For each route, check if the YAML model matches the AGENTS.md specification. Flag any drift.

4. **Update YAML to match canonical** — Edit the affected route entries in `route_model.yaml` to restore consistency with AGENTS.md

5. **Check spawn_config.js** — Verify `scripts/spawn_config.js` comment headers and default model references are also consistent

6. **Validate with exec** — Run a test spawn or check the config file directly to confirm changes took effect

7. **Document the drift pattern** — Note what triggered the drift (manual edit, merge conflict, or config regeneration) to prevent recurrence

---

## Pitfalls

- **Incomplete scan**: Only checking `route_model.yaml` but missing other router config files (e.g., separate environment configs)
- **AGENTS.md out of sync**: If AGENTS.md itself is wrong, fixing the YAML just propagates the error — verify AGENTS.md first
- **Comment drift**: Model comments in `spawn_config.js` may get updated but actual config stays wrong — check both content AND comments
- **Partial fixes**: Updating some routes but missing others — always do a full scan of all routes, not just the obvious ones
- **Spawn verification bypass**: Not running a test spawn after editing YAML — changes may not take effect until the router is reloaded

---

## Edge Cases

- **Multiple canonical sources**: If AGENTS.md and another doc both define model configs, determine which takes precedence before fixing drift
- **Environment-specific drift**: Production vs staging configs may intentionally differ — distinguish intentional drift from accidental drift
- **Cron job config drift**: Cron jobs may have their own model configs that can drift independently from router configs

---

## Related Skills

- `model-migration-workflow` — broader model migration that may trigger YAML drift fixes
- `cron-model-selection-verification` — cron-specific model config verification
- `openclaw-config-schema-debugging` — OpenClaw config validation and debugging
