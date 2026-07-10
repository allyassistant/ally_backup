---
name: fsSync_missing_trycatch rule
description: ESLint-like audit rule that flags Node.js fs synchronous calls without enclosing try-catch
---

## Rule: fsSync_missing_trycatch

**What it detects:**
Any call to `fs.writeFileSync`, `fs.appendFileSync`, `fs.writeFile`, or `fs.copyFileSync` that is not nested inside a `try { } catch { }` block.

**Why it fires repeatedly:**
Scripts that process audit data, run tests, or log results often call `fs.writeFileSync` on new file paths without defensive wrapping. Disk full, permission errors, or missing parent directories cause the entire script to abort.

**Typical fix cadence:**
- File writes at cron entry points (where disk I/O is non-critical) → safe-write wrapper
- File writes that gate downstream steps (where failure must halt) → re-throw after logging
