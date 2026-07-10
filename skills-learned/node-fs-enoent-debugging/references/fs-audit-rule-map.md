# fsSync_missing_trycatch Rule — Affected File Patterns

Rule fired 64× in past 7 days across these files:

| File | Pattern | Fix |
|------|---------|-----|
| `scripts/test_phase2_ast_migration.js` | bare `fs.writeFileSync` in test fixture | wrap in `safeWrite()` |
| `scripts/e2e_layer3_demo.js` | `fs.appendFileSync` without try-catch | wrap in `safeAppend()` |
| `scripts/test_audit_history.js` | multiple fsSync calls in loop | hoist try-catch to loop level |
| `scripts/test_auto_fix_audit_rule_map.js` | conditional writes | add `safeWrite` guard before write |

**Rule detection criteria:**
- `fs.writeFileSync` without surrounding `try/catch`
- `fs.appendFileSync` without surrounding `try/catch`
- `fs.writeFileSync` inside a `for`/`forEach` loop without loop-level try-catch
- Cron entry points (first 20 lines of any `scripts/cron-*.js`) touching disk without wrapper
