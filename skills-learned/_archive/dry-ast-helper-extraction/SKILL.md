---
name: dry-ast-helper-extraction
description: Extract duplicate AST helper functions into shared scripts/lib/audit/ modules and replace inline implementations with imports, reducing divergence across audit rules.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-22T08:31:01.253Z
---

## Workflow

1. **Identify duplicate implementations** — run `exec` with `grep -n 'function\|const.*=.*=>' scripts/audit_just_written.js scripts/lib/rules/*.js | grep -i 'build\|parse\|walk\|ast'` to find AST helper functions that appear in more than one file.

2. **Verify the source version is correct** — read the implementation in `scripts/audit_just_written.js` (the primary audit engine) and confirm it produces correct results via test file before extracting. Never extract a buggy implementation.

3. **Create the shared module** — write `scripts/lib/audit/<helper-name>.js` exporting only the helper function with its full logic. Keep the module focused (one export per file).

4. **Update all consumers** — in each file that had the duplicate, replace the inline function definition with `const { <fn> } = require('../lib/audit/<helper-name>.js')` (adjust relative path per file depth).

5. **Add the new module to NO_LINT in verify_edit.js** — add `'lib/audit/<helper-name>.js'` to the `NO_LINT` array so `verify_edit.js` skips the shared module itself during lint checks.

6. **Run syntax check on all modified files** — execute `node --check` on every touched file to catch import resolution errors before running audits.

7. **Verify with audit_just_written.js** — run `node scripts/audit_just_written.js` on each consumer file to confirm the shared helper still flags the same issues as the original inline version.

8. **Run any existing test scripts** — execute `node scripts/test_auto_fix_audit_rule_map.js` or similar test suites to confirm no regression in detection behavior.

## Pitfalls

- ⚠️ Extracting a helper that is used during its own file's linting — the module can't import from a path relative to a rule file's depth if the helper is itself inside the rule directory. Always use `path.join(__dirname, '../../..')` or similar absolute-relative resolution, or place shared helpers in `scripts/lib/audit/` (two levels up from any rule file) to keep the import path consistent.

- ⚠️ Importing from `../lib/audit/` when the consumer file is at varying depth — `audit_just_written.js` is at `scripts/` (depth 1) but `lib/rules/low-risk.js` is at `scripts/lib/rules/` (depth 3). Use a consistent relative path from `scripts/` root like `require('../lib/audit/<helper>.js')` and verify each consumer resolves it correctly.

- ⚠️ Extracting a helper with a different bug than the source — always verify the source implementation is correct first. If the original in `audit_just_written.js` is known-good (confirmed via passing tests), extract from there, not from a rule file that may have its own variant bug.

- ⚠️ Forgetting to add the new shared module to NO_LINT in verify_edit.js — the module itself may trigger false positives from other rules (e.g., `fsSync_missing_trycatch` on its own `fs` requires). Add it proactively.
