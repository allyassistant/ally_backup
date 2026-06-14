---
name: llm-call-execfile-migration
description: 如何將 Node.js 脚本中的 execSync shell-string LLM 調用安全地遷移到 execFileSync + args array，並驗證 thin executor cron 没有殘留漏洞
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T17:55:00.000Z
---

# LLM Call Migration: execSync Shell-String → execFileSync + Args Array

## Why This Matters

When a Node.js script calls an LLM API (e.g., MiniMax, OpenAI) using `execSync` with a shell string, it creates a **shell injection vulnerability**. If any part of the prompt or arguments contains shell metacharacters (`"`, `'`, `$`, `;`, `|`, etc.), the shell will interpret them — potentially allowing arbitrary command execution.

The safe alternative is `execFileSync` with a args array, which passes arguments directly to the executable without shell interpretation.

This skill documents the migration pattern and the validation required to ensure thin executor cron jobs don't have residual vulnerabilities.

## Workflow

### Phase 1: Identify Vulnerable Call Sites

1. **Scan for execSync LLM calls** — Search all scripts for the pattern:
   ```bash
   grep -rn "execSync" ~/.openclaw/workspace/scripts/ | grep -iE "minimax|openai|llm|api|model|audio|transcribe"
   ```
   
   Also search for direct `execSync` calls that invoke the OpenClaw CLI with model parameters:
   ```bash
   grep -rn "execSync\|exec.*spawn\|child_process" ~/.openclaw/workspace/scripts/ | grep -v "node_modules"
   ```

2. **Classify each call site** — For each `execSync` call that invokes an LLM:
   - Does it use string interpolation with user input or external data (stock prices, email content, API responses)?
   - Does it build a shell command string with `+` or template literals?
   - Is the result fed into another process or written to disk?
   
   **High risk**: Any call where prompt/data comes from external sources (web, email, files, user messages)
   **Medium risk**: Hardcoded prompts with no user input
   **Low risk**: Administrative scripts with no external input

3. **Find the thin executor cron jobs** — These are the cron jobs that use agent-internal LLM calls (Type B pattern):
   ```bash
   grep -rn "cron\|sessions_spawn\|thin.*executor" ~/.openclaw/workspace/scripts/ | grep -iE "execSync|execFileSync"
   ```
   
   Specifically check:
   - `scripts/weekly_correction_loop.js` — Mini-Curator
   - `scripts/daily_maintenance.js` — Daily Maintenance
   - Any script referenced in cron job payloads that calls LLM internally

### Phase 2: Understand the Migration Pattern

The **before** (vulnerable) pattern:
```javascript
const { execSync } = require('child_process');

// ❌ VULNERABLE: shell-string with string interpolation
const prompt = `Summarize this stock data: ${stockData}`;
const cmd = `openclaw infer --model minimax-portal/MiniMax-M3 --prompt "${prompt}"`;

try {
  const result = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
} catch (err) {
  // handle error
}
```

The **after** (safe) pattern:
```javascript
const { execFileSync } = require('child_process');

// ✅ SAFE: execFileSync with args array — no shell interpretation
const prompt = `Summarize this stock data: ${stockData}`;

// Args are passed directly to the executable, no shell involvement
const args = [
  'infer',
  '--model', 'minimax-portal/MiniMax-M3',
  '--prompt', prompt  // prompt is passed as a single arg, not interpolated into shell string
];

try {
  const result = execFileSync('openclaw', args, { encoding: 'utf8', timeout: 30000 });
} catch (err) {
  // handle error
}
```

### Phase 3: Execute the Migration

4. **Replace execSync with execFileSync** — For each vulnerable call site:
   - Change `const { execSync } = require('child_process')` → `const { execFileSync } = require('child_process')`
   - Convert the shell command string into an args array
   - Each space-separated token becomes one array element
   - Arguments that contain spaces or special characters become single array elements (no need to quote — execFileSync doesn't use a shell)
   - Preserve the `encoding`, `timeout`, and `cwd` options

5. **Handle complex shell constructs** — If the original command used shell features (pipes, redirects, `&&`, `||`):
   ```javascript
   // Before: cmd = "openclaw infer ... | jq '.result' > output.json"
   // After: This requires TWO execFileSync calls (one for infer, one for jq)
   // Or: use execSync with proper escaping ONLY for the shell construct portion
   
   // Better: do the filtering in Node.js rather than shell pipes
   const result = execFileSync('openclaw', ['infer', ...], { encoding: 'utf8' });
   const parsed = JSON.parse(result); // No need for jq
   ```

6. **Test the migrated code** — Run the script with the same inputs and verify:
   - Output is identical to the original (or functionally equivalent)
   - Error handling still works (catch blocks execute correctly)
   - Timeout behavior is preserved
   - No new errors from the `execFileSync` call

### Phase 4: Validate Thin Executor Cron Jobs

7. **Audit all thin executor cron jobs for residual vulnerabilities** — A thin executor cron job uses `execFileSync` or `execSync` internally (Type A pattern). After migration, verify:
   
   a. **No shell-string interpolation**: Check that no `execSync` calls remain that build command strings with user data:
      ```bash
      grep -rn "execSync" ~/.openclaw/workspace/scripts/ | grep -v "node_modules" | grep -E '`|\$\(|" \+ |"\s*\+'
      ```
   
   b. **Args arrays are properly structured**: Each args array should have:
      - Executable as first element (no `sh -c`, no `bash -c`)
      - Subcommands and flags as separate elements
      - No shell metacharacters in arguments (quotes, `$`, backticks)
   
   c. **All paths are validated**: If the args include file paths, verify:
      ```javascript
      // Safe: path is validated before use
      const safePath = path.resolve(userInput).startsWith(baseDir)
        ? userInput
        : fallbackPath;
      const args = ['--output', safePath];
      ```
   
   d. **Timeout is set**: All `execFileSync` calls should have a timeout to prevent hanging:
      ```javascript
      execFileSync('openclaw', args, { encoding: 'utf8', timeout: 45000 }); // 45s timeout
      ```

8. **Verify the cron job still works end-to-end** — After migration:
   ```bash
   # Manual trigger to test
   openclaw cron run <job-id>
   
   # Check the output matches expectations
   # Check session jsonl for model used and any errors
   ```

### Phase 5: Add Defense-in-Depth

9. **Add input sanitization** — Even with `execFileSync`, sanitize inputs that might cause unexpected behavior:
   ```javascript
   function sanitizePrompt(prompt) {
     // Remove null bytes (would cause execFileSync issues)
     // Truncate to reasonable length
     // Remove control characters
     return prompt.replace(/\x00/g, '').replace(/[\x00-\x1F\x7F]/g, '').slice(0, 8000);
   }
   ```

10. **Add logging for debugging** — When migrating execSync to execFileSync, add temporary logging to catch any behavioral changes:
    ```javascript
    console.error(`[llm-migration] Calling openclaw with args: ${JSON.stringify(args.slice(0,3))}...`);
    const result = execFileSync('openclaw', args, { encoding: 'utf8', timeout: 45000 });
    console.error(`[llm-migration] Result length: ${result.length}`);
    ```
    Remove the logging after validation is complete.

11. **Document the migration** — For each migrated file, record:
    - The original call (what it did)
    - Why it was vulnerable
    - What was changed
    - Validation results
    This helps future debugging and serves as a pattern for similar migrations.

## Migration Checklist

For each file migrated:

- [ ] Replaced `execSync` with `execFileSync`
- [ ] Converted shell command string to args array
- [ ] No shell metacharacters remain in args
- [ ] No `sh -c` or `bash -c` wrappers
- [ ] Timeout is set (≥ 30s for LLM calls)
- [ ] Error handling preserves original behavior
- [ ] Output is functionally identical to original
- [ ] Input sanitization added (defense-in-depth)
- [ ] Logging added temporarily for validation
- [ ] Logging removed after validation
- [ ] Cron job tested end-to-end
- [ ] Session jsonl shows correct model used
- [ ] No new errors in gateway logs

## Pitfalls

- **execFileSync does NOT interpret shell metacharacters** — This is the key difference. `execFileSync` passes args directly to the OS execve syscall, bypassing the shell. This means `$HOME`, backticks, pipes, and quotes have NO special meaning in the arguments. This is the security improvement — but it also means your arguments can't use shell expansion (e.g., `~` won't expand to the home directory).
- **Paths with spaces need extra care** — If a path contains spaces, you don't need to quote it in the args array (that's the point). But verify the receiving script/application handles unquoted paths with spaces correctly.
- **The working directory option** — `execFileSync` accepts a `cwd` option. If the script references relative paths, ensure `cwd` is set correctly or use absolute paths.
- **Timeout is critical for LLM calls** — LLM API calls can hang indefinitely if the provider doesn't respond. Always set a timeout (30-60s for most LLM calls). The timeout should account for provider latency (MiniMax can be slow during overload periods).
- **Don't migrate in-place without testing** — Always test the migrated code in isolation before deploying. Run the old and new code with identical inputs and compare outputs.
- **Thin executor cron jobs may have hidden execSync calls** — Check not just the main script but any dependencies it calls. A helper utility that calls `execSync` inside a cron job is still a vulnerability.
- **Migrating one call in a file doesn't fix the whole file** — A file may have multiple `execSync` calls. Verify you've found and migrated ALL of them, not just the obvious one.
- **stdout and stderr handling** — `execFileSync` captures both. If the original used `2>&1` to merge stderr into stdout, you need `({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })` and then separately handle stderr.
- **Node.js version matters** — `execFileSync` is available in Node.js 4.x+. If the target environment uses an older Node.js version, use `child_process.spawnSync` with `{ shell: false }` instead.