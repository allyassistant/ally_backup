# audit_to_skill_emitter context for fsSync_missing_trycatch

## Rule definition
Fires when a `fs.writeFileSync` or `fs.appendFileSync` call is not inside a try-catch block.

## Why it matters
`writeFileSync` can throw on:
- ENOENT (parent directory missing)
- EACCES (permission denied)
- ENOSPC (disk full)
- EBUSY (file locked)
- EINVAL (invalid path characters)

A naked `writeFileSync` in a cron or long-running script crashes the entire process. The error is uncaught and the rest of the pipeline stops silently.

## Files that fired (from signal)
- scripts/test_phase2_ast_migration.js
- scripts/e2e_layer3_demo.js
- scripts/test_audit_history.js
- scripts/skill_reviewer_bot_test_tmp.js
- scripts/test_auto_fix_audit_rule_map.js

All are in `scripts/`, suggesting a pattern of ad-hoc test/demo scripts written without defensive error handling.

## Fix priority
1. `skill_reviewer_bot_test_tmp.js` — high value (active test script)
2. `test_auto_fix_audit_rule_map.js` — medium (test helper used in CI)
3. The rest are one-off test files — apply when editing, not urgently
