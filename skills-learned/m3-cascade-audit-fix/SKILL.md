---
name: m3-cascade-audit-fix
description: Fix a bug class across every structurally related file, not just the first one found.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-22T05:31:01.249Z
---

## Workflow

1. **Identify the bug class** — When M3 finds Bug X in File A, extract the root cause signature (e.g. "regex `[^}]*` fails on nested braces", "cache has no mtime invalidation"). Do not fix File A and stop.

2. **Trace related files** — Use `exec` to find all files that share the same code pattern, library call, or logic class:
   ```bash
   grep -rn "<pattern>" scripts/ --include="*.js"
   ```
   For example: after finding `inlineTry` regex bug in `audit_just_written.js`, grep for the same regex in `auto_fix.js`, `lib/rules/`, and `lib/helpers/`.

3. **Audit each related file** — Spawn an M3 sub-agent (or use the same agent) to audit each file for the same bug class. Do not apply fixes yet. Collect all findings in a single list.

4. **Apply fixes in dependency order** — Fix the most foundational file first (e.g. `file-cache.js` mtime fix before `audit_just_written.js` which calls it). Then cascade upward.

5. **Verify each fix** — Run `exec` to run the relevant test file or smoke test after each fix. Do not proceed to the next file until the current fix passes.

6. **Run a cross-file regression pass** — After all files are fixed, run the full test suite or audit scan across all affected files to confirm no regressions.

7. **Report the cascade** — Summarize: how many files had the same bug class, what was fixed in each, and what the systemic root cause was.

## Pitfalls

- ⚠️ Fixing File A without auditing File B — the same `[^}]*` regex bug existed in both `audit_just_written.js` and `auto_fix.js`'s `fs-sync-trycatch.detect()`, causing auto-fix to silently fail on 3/3 issues in the test file.
- ⚠️ Fixing downstream files before the root library — `file-cache.js` had no mtime invalidation, so even after `audit_just_written.js` was patched, the next LLM edit made the cache stale again, resurrecting false positives.
- ⚠️ Assuming a one-shot audit-fix is complete — cascade bug propagation requires at least 2 passes (initial fix + cross-file trace) to be safe.
- ⚠️ Using `sessions_yield` without checking `sessions_history` first — a 27-min M3 may still be `status: running` but actively working; yield too early and lose progress.
- ⚠️ Not preserving API signatures when fixing foundational files — changing `getFileContent()` return shape breaks all callers; always verify exit 0 on test files after library changes.
