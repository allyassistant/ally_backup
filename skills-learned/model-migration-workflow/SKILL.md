---
name: model-migration-workflow
description: 系統性遷移模型引用——包括 router configs、cron jobs、scripts、spawn config、env vars、test files——並包含 rate limit recovery 和 fallback 配置
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T15:33:40.785Z
---

## Workflow

1. **Identify all model references** — Scan `~/.openclaw/workspace/scripts/`, cron configs, `gateway.yaml`, `.env`, spawn config, and test files for the current model string. Use `grep -r "model-name"` across workspace.

2. **Classify by risk** — Categorize refs into:
   - **Pure-logic** (no LLM dependency): scripts with simple exec, no model calls → safe to migrate
   - **LLM-dependent** (analysis/synthesis): crons that call the model for content → requires quality verification after
   - **Critical-path** (system health, alerting): crons whose failure cascades → require rollback plan before migration

3. **Validate target model availability** — Run `openclaw models list` or `curl` the provider endpoint to confirm the target model is reachable and responsive. For ollama: `curl http://localhost:11434/api/tags`.

4. **Execute batch migration in parallel** — For pure-logic crons, update model config in batches of 6 using parallel cron calls:
   ```bash
   cron <id> set model=<new-model>
   ```
   Avoid updating all 19+ crons sequentially; parallel batch reduces total conversation turns.

5. **Verify all updates** — After batch update, run a single verification pass:
   ```bash
   cron list | grep <new-model>
   ```
   Compare count against expected migrations.

6. **Address concurrent execution concern** — Map all crons using the same model by schedule. Identify collision windows (e.g., 06:30 Anomaly + Bootstrap, or 00:40-01:20 wiki chain). For ollama: check RAM availability since multiple instances compete. Consider spacing high-frequency crons or adding a run guard.

7. **Define rollback plan** — Before migrating, document the previous model for each cron. Store rollback commands:
   ```bash
   cron <id> set model=<original-model>
   ```
   Rollback can be done individually or in batch depending on failure scope.

8. **Quality gate for LLM-dependent crons** — After migration, observe at least one full run cycle of each LLM-dependent cron. Check output quality manually or via a QA subagent. If degraded, rollback the LLM crons first while keeping pure-logic crons migrated.

## Worked Example — 19 Cron Migration to ollama/qwen2.5:3b

| # | Cron | Schedule | 之前 model | 類別 |
|---|------|----------|-----------|------|
| 1 | Skill Junk Tracker | 23:55 | deepseek-flash | 純 logic |
| 2 | Discord Channel Logger | 23:50 | deepseek-flash | 純 logic |
| 3 | Daily Memory Logger | 每 2h | deepseek-flash | 純 logic |
| 4 | SYMBOLS.md | 00:41 | deepseek-flash | 純 logic |
| 5 | Pattern Analysis | 04:00 | deepseek-flash | 純 logic |
| 6 | Daily Maint | ... | ... | ... |

**Parallel batch execution:**
- Batch 1: crons 1-6
- Batch 2: crons 7-12
- Batch 3: crons 13-19 (remaining wiki + weekly)

**Wiki chain timing (00:40-01:20):**
Bridge → Compile → Lint → Ingest → Vectorizer
First 4 migrated to ollama; Vectorizer remained deepseek (LLM cron).

**Concurrent collision at 06:30:** Anomaly + Bootstrap both scheduled at same time. Monitor RAM if both use ollama simultaneously.

## Pitfalls

- **Same-model concurrent execution**: When migrating multiple crons to the same ollama model, ensure they don't all fire simultaneously and exhaust RAM. Map schedules before migration.
- **gateway.yaml access**: Model config files outside workspace may be unreadable by the agent. In that case, the agent must output the migration commands for the user to approve and apply manually.
- **Incomplete rollback plan**: Document original model per cron BEFORE migrating. If a migration fails mid-batch, you need the rollback commands ready — don't rely on memory.
- **LLM cron quality regression**: Pure-logic crons are safe to batch migrate. LLM crons (analysis, synthesis, pattern detection) need a post-migration quality check — do not assume they'll perform identically on a different model.
- **Partial migration state**: If only some crons migrate and others fail, the system enters a split state (mixed models). Decide in advance: rollback all on any failure, or accept partial migration with a documented list of what's migrated vs. not.

## References

- `cron-config-audit` — Verify model/fallback consistency after migration
- `cron-troubleshooting` — Diagnose failures in migrated crons
- `llm-call-execfile-migration` — Safe migration of Node.js execSync LLM calls to execFileSync args array
