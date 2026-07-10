---
name: obsidian-vault-maintenance
description: Reorganize an Obsidian vault by removing duplicates, adding MOCs and cross-links, and consolidating orphaned folders safely.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T19:01:01.241Z
---

## Workflow

1. **Detect duplicates** — Run `exec` to scan for content duplication across the vault. Use mtime + content hash comparison. Archive duplicates to `_archive/duplicates-YYYY-MM-DD/` with `mv` — do not delete permanently.

2. **Audit script dependencies before folder moves** — Before moving or deleting any vault folder (e.g. `03-Output/`, `Knowledge/root`), grep across `scripts/` and config files for references to the target path. Run `grep -r "03-Output/" scripts/ --include="*.js" -l` to find dependents. Hardcoded wikilinks like `[[03-Output/connections-${today}]]` are common traps.

3. **Create or update MOC files** — Check current MOC count and content. For vaults with 200+ notes, aim for 4-6 topical MOCs (e.g., AI Agent, Loop Engineering, Business, Tech & Tooling). New MOCs must use proper wikilinks (`[[note-title]]`) not auto-generated import dumps. Archive auto-generated MOCs that contain broken links like `[[-----------------------]]` or `[[1 First prompt model...]]`.

4. **Add cross-links between related notes** — Identify topic clusters (e.g., same author, same concept). Add `## 相關概念` sections with `[[wikilink]]` entries to each note in the cluster. Batch process 20+ files to avoid one-by-one edits.

5. **Consolidate orphaned folders** — Move stray category folders (e.g., `Diamond/`, `Investment/`) into the main hierarchy (e.g., `Business/`). Remove empty top-level folders after confirming no scripts reference them.

6. **Assess 03-Output dual-write pattern** — `write_to_obsidian.js` creates two copies per note: one in `Knowledge/<Category>/` (full content) and one in `03-Output/YYYY-MM/` (lightweight metadata). Before disabling the output copy, check if scripts like `usage_tracker.js`, `synthesis_closed_loop.js`, or `connection_surface.js` depend on the folder. If they do, either refactor them or keep the folder active.

7. **Archive non-essential directories** — Move unused output directories (e.g., `03-Output/` archive, stale MOCs) to `_archive/YYYY-MM-DD-desc/`. Always preserve unique files that don't exist elsewhere in the vault. Verify 3 files minimum before considering archives complete.

## Pitfalls

- ⚠️ Moving a vault folder without grepping script dependencies first — `03-Output/` is hardcoded in at least 3 scripts (`usage_tracker.js`, `synthesis_closed_loop.js`, `connection_surface.js`) plus wikilinks in existing notes — moving it breaks cron jobs silently.
- ⚠️ Archiving `03-Output/` without checking for unique files — the directory often contains reports like `connections-YYYY-MM-DD.md` and `usage-report-YYYY-MM-DD.md` that have no copy in `Knowledge/`. Loss of these breaks historical reference.
- ⚠️ Deleting MOCs that still have incoming wikilinks — auto-generated MOCs may be ugly but removing them without updating references leaves broken `[[wiki-notes]]` across the vault. Always check bidirectional links before deletion.
- ⚠️ Adding cross-links as a manual one-by-one process — 20+ notes × 6 topic groups is 120 edits. Batch with `exec` scripts that append `## 相關概念` sections programmatically.
- ⚠️ Confusing `03-Output/` cleanup with `write_to_obsidian.js` disabling — commenting out the output copy block in `write_to_obsidian.js` is permanent; restoring requires reverting the edit. Prefer keeping the folder and accepting the duplicate if scripts depend on it.
- ⚠️ Archiving large directories without mtime verification — `03-Output/` may contain 68 files (380KB). Moving to archive takes seconds; restoring takes hours if the archive path was nested under another archive. Keep archives flat (`_archive/yyyy-mm-dd-desc/`) not nested (`_archive/old-archive/`).
