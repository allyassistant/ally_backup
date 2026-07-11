---
name: wrapper-exec-safe-run
description: Wrap child_process.execSync and spawnSync calls with try-catch error handling to prevent silent crashes when disk/network errors occur.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T21:01:01.269Z
---

## Workflow

1. **Detect the trigger** — When the `execSync_missing_trycatch` audit rule fires, it means a `child_process.execSync()` or `spawnSync()` call lacks surrounding try-catch protection. The rule fires on the call site; it does not fire if the call is already wrapped.

2. **Read the target file** — Identify the exact call site flagged by the rule. Common files: `scripts/reapply_fallback_patch.js`, cron entry points, memory flush scripts, any code path that touches disk or spawns external processes.

3. **Inspect for existing try-catch** — Before wrapping, confirm no try-catch already protects the call. If one exists but the rule still fires, the rule may be matching a nested call inside the try block — treat that nested call as a candidate.

4. **Wrap with safe-exec helper** — Replace the bare exec call with a try-catch block:
   ```javascript
   // BEFORE
   const result = execSync(`some-command ${arg}`, { encoding: 'utf8' });

   // AFTER
   try {
     const result = execSync(`some-command ${arg}`, { encoding: 'utf8', encoding: 'utf8' });
   } catch (err) {
     console.error(`execSync failed for command: ${arg}`, err.message);
     // decide: re-throw, return fallback, or exit gracefully
   }
   ```

5. **Decide error handling strategy** — The caught error should either crash deliberately or return a fallback value. Do not swallow the error silently. For cron entry points, prefer `process.exit(1)` or a sentinel return so the cron runner can detect failure. For background tasks, return `null` or an empty object and let the caller handle null-checks.

6. **Add the safe-write wrapper for fs.writeFileSync** — If the same file also calls `fs.writeFileSync` or `fs.appendFileSync` without try-catch, use the `wrapper-fs-safe-write` pattern:
   ```javascript
   const safeWrite = (path, data) => {
     try {
       fs.writeFileSync(path, data);
     } catch (err) {
       console.error(`writeFileSync failed for ${path}:`, err.message);
       process.exit(1);
     }
   };
   ```

7. **Test the wrapped code** — Run the script outside cron with `node scripts/reapply_fallback_patch.js` to confirm the try-catch fires correctly and the script exits or returns gracefully rather than crashing with an unhandled exception.

## Pitfalls

- ⚠️ **Nested execSync inside a try block that already exists** — The audit rule matches the inner call, not the outer one. Wrapping the inner call creates a double-try situation that is redundant. Only wrap calls that are not already inside a protective try-catch.

- ⚠️ **Swallowing the error without re-throw or sentinel** — A bare `catch (err) {}` makes failures invisible. The cron watcher will report success even though the operation silently failed. Always log the error or exit with a non-zero code.

- ⚠️ **Missing `encoding: 'utf8'` in the execSync options after wrapping** — Without it, the result is a Buffer instead of a string, causing downstream `.trim()` or string-comparison failures. Always preserve or add the encoding option in the wrapped call.

- ⚠️ **Not checking return value for null after wrapping** — When the wrapper returns a fallback (e.g., `null`), callers that expect a string will crash on `.toString()` or `.trim()` calls. Audit all call sites after wrapping and add null-checks.

- ⚠️ **Using execSync with shell interpolation** — When wrapping a call that concatenates user input into the command string, the try-catch hides injection failures. Prefer `execFileSync` with an args array instead of shell string interpolation, even inside a try block.

- ⚠️ **Not applying wrapper-fs-safe-write in the same file** — Files that use `execSync` often also use `fs.writeFileSync` in the same code path. Running the audit rule multiple times flags each uncovered call separately. Apply both wrappers together to avoid repeated rule firings.
