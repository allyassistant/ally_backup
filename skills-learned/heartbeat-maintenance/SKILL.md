---
name: heartbeat-maintenance
description: 定期清理 HEARTBEAT.md 同心跳狀態檔案，檢測 stale artifact、修剪冗餘 detail、保留核心 overview tables
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T17:02:06.078Z
---

## Workflow

1. **Locate heartbeat files** — Primary: `HEARTBEAT.md` in workspace root. Secondary: cron state files in `~/.openclaw/` or project-specific state directories.

2. **Scan for stale artifacts** — Check for files/directories with mtime > 7 days that are no longer referenced. Common patterns:
   - `ingest_tmp/` directories accumulating stale import artifacts
   - `.tmp` files from interrupted operations
   - Orphaned `NO_REPLY` state files

3. **Assess artifact age** — Distinguish between:
   - **< 24h**: Recent, likely in-use — preserve
   - **24h–7d**: Suspicious — verify before cleanup
   - **> 7d**: Stale — safe to remove

4. **Clean stale ingest tmp files** — When `ingest_tmp/` directories accumulate > 500 stale files:
   ```bash
   find ingest_tmp/ -type f -mtime +1 -delete  # remove > 24h
   ```
   Record count before/after: e.g., `1204→291 files removed`.

5. **Update HEARTBEAT.md** — Prune detail sections while preserving:
   - Core overview tables (cron status, last run times)
   - Active issue counts
   - System health indicators
   Remove: verbose logs, completed task histories, resolved error traces.

6. **Verify preserved links** — Ensure any wikilinks pointing to cleaned artifacts are either removed or updated to valid targets.

## Pitfalls

- ⚠️ **Deleting files still referenced by active crons** — Before cleanup, check `cron_config.json` or equivalent for any jobs that might read the artifact. Stale artifact ≠ unreferenced artifact.
- ⚠️ **HEARTBEAT.md wikilink false positives** — Lint tools may report broken links to files that exist but are in different subdirectories (e.g., `docs/` vs `sources/`). Verify file existence before assuming broken.
- ⚠️ **Ingest tmp threshold drift** — The "500 stale files" threshold is a heuristic. If storage is abundant, raise threshold. If storage is constrained, lower it. Adjust based on observed accumulation rate.
- ⚠️ **Over-pruning overview tables** — The value of HEARTBEAT.md is its at-a-glance status. Removing too many rows defeats the purpose. Keep at least 10 rows of recent activity.
- ⚠️ **Forgetting to record cleanup metrics** — Always note before/after counts in the session output. This helps track accumulation rate and adjust thresholds.
