---
name: system-code-debug-triage
description: "Verify bugs via systematic fix workflow with defenses. Use when: bug reports arrive, fix workflow needed, defenses required. Key capabilities: bug verification, fix application, defense addition."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-07T19:25:34.692Z
---

## Workflow

1. **Read the file to verify each bug is real**
   - Open the reported file and inspect each claimed bug at its source line
   - Distinguish real bugs from false positives (empty lines, comments, intentional behavior)
   - Accept/reject each bug individually with explicit reasoning

2. **Prioritize and fix confirmed bugs**
   - Fix in order: safety bugs (shell injection, path traversal) → logic bugs (timing, dropped files) → code quality (unused imports, naming)
   - For each fix: isolate change, test reasoning, commit edit
   - Add appropriate escape chains (`$`, backtick, quotes) for shell safety

3. **Add defensive layers (not just fixes)**
   - After fixing all confirmed bugs, check if the surrounding code has other vulnerabilities:
     - Lock mechanism leaks on early return/crash?
     - Path traversal guards missing?
     - JSON/command output parsing fragile?
     - Fallback/retry loops complete?
   - Document each defensive addition in the response

4. **Sanity-check the whole file after changes**
   - Reread the entire file to verify:
     - All fixes intact and correct
     - No introduced typos or syntax errors
     - No broken imports or variable references
     - Error handling consistent with coding conventions

5. **Cross-file review (expand scope when applicable)**
   - If the fixed file interacts with other modules (imports, calls, shared utilities), review those files too
   - Check for similar patterns of the same bug class across files
   - Fix or flag any discovered issues in related files
   - Run multi-file verification (e.g., spawned sub-agent)

6. **Clean up code quality surfaces**
   - Remove unused imports
   - Align naming that causes confusion (e.g., `LOCK_FILE` pointing to a directory → rename to `LOCK_DIR`)
   - Remove dead code sections

7. **Report summary**
   - Format: ✅ Bug #N — 描述 → Fix applied → Verify status
   - Separate "Fixes" section and "Defensive additions" section
   - Include cross-file findings in a separate block

## Pitfalls
- **User may repeat the same request** in successive conversations, each time with the assistant expanding scope. Track what has already been fixed to avoid rework.
- **Expanding scope without confirmation** can lead to wasted work. If cross-file review introduces unrelated changes, mention them but ask before acting.
- **Defensive additions can introduce new bugs** if the assistant "improves" working code. Only add defenses that prevent identified vulnerability classes, not speculative rewrites.
- **Multiple sessions on the same file may conflict** — if user opens a new conversation, the file state may already be fixed from a prior session. Start by reading current state, not assuming what's broken.
- **Naming refactors (e.g., LOCK_FILE → LOCK_DIR)** must update all references across the file and any importing files, or the code breaks.
