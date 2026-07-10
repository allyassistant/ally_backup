---
name: magic-number-constant-extractor
description: Replace scattered magic numbers in scripts with named constants that explain what they mean.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-24T11:31:01.285Z
---

## Workflow

1. **Detect with audit scanner**
   Run the audit scanner targeting the `magic_numbers` rule against the target file or directory. Collect the full hit list — each hit includes the line number, the literal value, and the surrounding context.

   ```bash
   # Note: audit_scanner.js archived 2026-06-20. Replacement: unified code_quality_manager
   # (rules integrated into lib/rules/low-risk.js; 'magic_numbers' rule still active).
   # --dir requires a directory (single-file mode no longer supported):
   node scripts/code_quality_manager.js scan --dir scripts --no-system-check --quiet
   ```

2. **Rank by frequency and ambiguity**
   Prioritize literals that appear in 3+ locations (high ROI refactor) or that have no obvious unit/type from context. Skip literals that are self-documenting (e.g., `i < 10` in a 10-item loop) or are part of a known format string.

3. **Choose a descriptive constant name**
   Follow the convention already used in the file. Common patterns:
   - Timeouts/delays: `MS_PER_SECOND`, `DEFAULT_TIMEOUT_MS`, `HOURS_PER_DAY`
   - Retry counts: `MAX_RETRIES`, `RETRY_COUNT`, `MAX_ATTEMPTS`
   - Sizes/limits: `MAX_QUEUE_SIZE`, `DEFAULT_BATCH_SIZE`, `PAGE_SIZE`
   - Thresholds: `JUNK_RATE_THRESHOLD_PCT`, `MIN_CONFIDENCE`
   - Never use bare names like `TIMEOUT` — always qualify with units or scope.

4. **Add the constant declaration near the top of the file**
   Place it after the `const`/`let`/`var` declarations or in a dedicated `lib/constants.js` if the file already imports from one. Ensure the declaration is not inside any function or block scope — it must be module-level.

5. **Replace all occurrences**
   Use `sed` or an editor to replace every literal occurrence with the constant name. Do not selectively replace — consistency prevents future confusion.

   ```bash
   # Dry-run first
   sed -n 's/const MAX_RETRIES = 3/const MAX_RETRIES = MAX_RETRY_COUNT/p' script.js
   # Then apply
   sed -i '' 's/const MAX_RETRIES = 3/const MAX_RETRIES = MAX_RETRY_COUNT/' script.js
   ```

6. **Verify no regressions**
   Run the script's test suite or execute it against a known-good input. Check that behavior is unchanged — the value should be identical, only the name changed.

   ```bash
   node scripts/test_junk_pause.js
   ```

7. **Scan for related literals in other files**
   The audit scanner hit 5 files in the past 7 days. After fixing one file, re-scan the others for the same constant to ensure consistency across the codebase.

## Pitfalls

- ⚠️ **Same numeric literal, different meanings in different contexts** — A `60` may mean 60 seconds in one place and 60 milliseconds in another. Extracting both to `const X = 60` silently changes behavior in one location. Always verify each occurrence's unit or type before lumping them together.

- ⚠️ **Identifiers that look like magic numbers** — Variable names containing digits (e.g., `row0`, `col1`, `v2`) are not magic numbers. Regex-based scanners may flag these incorrectly. Review each hit manually before applying any replacement.

- ⚠️ **Test files with hardcoded expected values** — Replacing a literal in source code without updating the corresponding test expectation causes silent failures. Always run the test suite after any substitution; look for assertion mismatches that suggest the test was written against the old literal value.

- ⚠️ **Renaming variables vs extracting constants** — Changing `const count = 0` to `const count = MAX_RETRIES` is not the same as extracting a magic number. The rule targets literal values (literals in expressions), not variable initializers that happen to use descriptive names already.

- ⚠️ **Conflicting constant names across modules** — If two modules both define `const MAX_RETRIES` with different values, importing both creates a silent conflict. Use prefixed names (`JUNK_MAX_RETRIES`, `PUSH_MAX_RETRIES`) or consolidate into a single shared constants module.

- ⚠️ **Loose regex matches in comments or string literals** — Patterns like `timeout.*=.*\d+` may match comments or string values that should not be refactored. Always verify the match is in executable code, not in a string that describes a default value for documentation purposes.
