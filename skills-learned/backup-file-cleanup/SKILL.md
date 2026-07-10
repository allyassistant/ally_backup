---
name: backup-file-cleanup
description: Remove stale .bak backup files while keeping intentional system backups in credentials and memory directories intact.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-20T03:31:03.751Z
---

## Workflow

1. **Scan** — Run `find /Users/ally/.openclaw/workspace -name "*.bak" -type f 2>/dev/null` to locate all `.bak` files and collect their paths and sizes.

2. **Categorize** — Group files by folder type to identify their source:
   - `credentials/` → WhatsApp/Baileys auto-generated pre-key/session backups
   - `memory/` → memory system backups (l0-abstract, l1-overview, backups, _corrupted_backup)
   - `_legacy/` → old scripts or auth session backups
   - `.issues/archive/` → issue archive backups
   - `skills/_archive/` → skill proposal backups
   - `docs/` or other workspace folders → miscellaneous backups

3. **Assess safety** — Determine which categories are safe to clean:
   - `credentials/` (especially WhatsApp `pre-key-*`/`session-*`) → **preserve** unless explicit user request
   - `memory/` backups → **preserve** — required for memory system integrity
   - `_legacy/` → inspect individually; old scripts may be reusable
   - `.issues/archive/` / `skills/_archive/` → generally **safe to clean** if archived

4. **Move to Trash** — Use `trash` command (not `rm`) for safe deletion:
   ```bash
   trash path/to/file.bak
   ```
   Never use `rm -rf` on backup files in credential or memory directories.

5. **Report** — Summarize deleted count + size, and list preserved categories with counts.

## Pitfalls
- ⚠️ Using `rm` instead of `trash` — `.bak` files in `credentials/` are not truly redundant; WhatsApp/Baileys may need them for session recovery — `rm` is irreversible, `trash` allows recovery.
- ⚠️ Cleaning all `.bak` files indiscriminately — the `memory/` folder `.bak` files are part of the memory system backup chain; deleting them can break `memory_generator.js` restore logic.
- ⚠️ Not categorizing first — a single `find` output with 800+ files is unmanageable; categorizing by folder reveals the real cleanup targets and prevents accidental system-backup deletion.
- ⚠️ Ignoring `.tmp`, `.swp`, `.orig` variants — same pattern applies; after cleaning `.bak` files, scan for these variants too for thorough workspace hygiene.
