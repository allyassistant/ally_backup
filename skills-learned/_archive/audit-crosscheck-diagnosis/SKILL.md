---
name: audit-crosscheck-diagnosis
description: Diagnose audit false positives by cross-checking heuristic audit results against AST-based analysis and verifying code behavior directly.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-22T10:31:01.246Z
---

## Workflow

1. **Identify the flag.** When `audit_just_written.js` (heuristic-based) or any non-AST scanner reports an issue, note the rule name and line number but do NOT patch immediately.
2. **Cross-check with AST.** Run `verify_edit.js --check <filepath>` — the AST-based verifier may report 0 issues even when the heuristic flags a problem. This indicates a false positive.
3. **Read the actual code.** For any discrepancy, `read` the file at the flagged line and surrounding context. Check whether the code already has the required safety (e.g., try-catch wrapping `readdirSync`, non-empty catch body).
4. **Distinguish real vs. false.** If the code is genuinely unsafe (e.g., empty `catch (e) {}`), fix it by adding opt-in debug logging: `if (process.env.DEBUG) console.warn(...)`. Preserve the catch body to allow graceful continuation.
5. **Audit the audit rule.** If the false positive is a pattern (same rule, different files), the heuristic rule needs updating — file an issue describing the specific code pattern the heuristic cannot detect.
6. **Verify fix end-to-end.** Run both `verify_edit.js --check <filepath>` and `audit just <filepath>` to confirm 0 issues from both scanners.

## Pitfalls

- ⚠️ Heuristic vs. AST disagreement — `audit_just_written.js` cannot parse all AST patterns and flags safe code as critical (e.g., `fsSync_missing_trycatch` on `readdirSync` already wrapped in try-catch). Always cross-check with `verify_edit.js` before patching.
- ⚠️ Empty catch blocks silently swallow errors — `findReverseLinks()` in `write_to_obsidian.js` had two empty `catch (e) {}` at L140/L184 that silently skip vault files on read failure, causing incomplete reverse-link discovery. Real bug, not false positive. Fix by adding `if (process.env.OBSIDIAN_DEBUG) console.warn(...)` inside the catch.
- ⚠️ AST tools can have their own blind spots — `verify_edit.js` uses AST parsing and may miss issues that a simple grep would catch. If both tools disagree with the heuristic, read the code manually before concluding the heuristic is always wrong.
- ⚠️ New rules added to `audit_just_written.js` (e.g., `no-empty-catch`) may initially flag all existing empty catches as violations, including ones that are intentional fallthroughs. Verify each flag is a genuine bug before auto-fixing.
