---
name: write-to-obsidian-generic-link-safety
description: Scan Obsidian notes for broken `[[link]]` references before write and auto-skeleton orphan targets, with a strict-links flag for high-quality pipelines.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-22T10:31:01.246Z
---

## Workflow

1. **Inspect content before write.** Before calling `write_to_obsidian.js`, scan the content string for orphaned generic links — `[[title]]` patterns where no corresponding `.md` file exists in `Knowledge/Concepts/`.
2. **Choose enforcement mode.**
   - `--strict-links`: block the write entirely (`process.exit(1)`) if any orphan link is detected. Suitable for cron pipelines where orphan links indicate draft/incomplete content.
   - Auto-skeleton (default): proceed with write but spawn skeleton pages for each orphan target, creating `Knowledge/Concepts/{title}.md` with a stub template.
3. **Execute write.** Pass `--strict-links` flag to `write_to_obsidian.js` when strict enforcement is required. Without the flag, the script auto-generates skeletons silently.
4. **Verify skeleton pages.** After write completes, confirm each skeleton was created with correct frontmatter (`tags: [draft, concept]`, `status: draft`) and placeholder content.
5. **Check for false positives in audit tools.** If `audit_just_written.js` flags `fsSync_missing_trycatch` on code that already has try-catch, do NOT patch blindly — run `verify_edit.js` (AST-based) to confirm. The heuristic scanner does not understand all AST patterns and produces false positives on safe code.

## Pitfalls

- ⚠️ Auto-skeleton creates pages the user never asked for — if `[[會議]]` was a temporary label, it still spawns `Knowledge/Concepts/會議.md`, polluting the vault with stub pages. Use `--strict-links` for high-quality pipelines instead.
- ⚠️ Skeleton auto-creation only handles `Knowledge/Concepts/` — links to `Knowledge/Projects/` or other subdirectories are silently skipped, creating partial coverage that may confuse users about which links are "covered."
- ⚠️ `audit_just_written.js` heuristic false positives — the scanner flags `fsSync_missing_trycatch` on L128 of `audit_just_written.js` even though `readdirSync` already has try-catch (L130). Running `verify_edit.js` (AST-based) always confirms 0 issues. Do not patch the wrong file.
- ⚠️ Empty catch blocks in `findReverseLinks()` (L140, L184) silently swallow `readFileSync` errors. Set `OBSIDIAN_DEBUG=1` to surface these during development, but leave the catches in place for production resilience.
