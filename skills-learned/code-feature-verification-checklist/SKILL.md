---
name: code-feature-verification-checklist
description: Verify new feature code systematically with a structured checklist before declaring it safe, identifying test false-positives and rollout recommendations.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-13T04:43:52.634Z
---

## Workflow

1. **Syntax check** — Run `node --check <file>` or `node -e "require('<file>')"` to confirm no parse errors. Catch this first before any logic review.

2. **Identify the new code's intent** — Read the feature diff and confirm what it actually does. State the intended behavior in one sentence. This anchors all subsequent checks.

3. **Map each new construct to its purpose** — For every non-obvious line (`.then()`, `try-catch`, `await`, conditional), write down why it was used. If you cannot explain a line's purpose, flag it.

4. **Check async/await pattern correctness** — Distinguish fire-and-forget (`promise.then()`) from awaited results (`await promise`). Using `.then()` is intentional when you do NOT want to block. Only flag `await` inside non-async functions or deadlocks.

5. **Verify scope isolation** — Confirm the new code does not mutate shared state or global variables outside its module boundary.

6. **Check error handling coverage** — Every `fs.readFileSync` / `fs.writeFileSync` / `execSync` call must be wrapped in `try-catch`. Missing try-catch on disk/network calls causes silent crashes.

7. **Confirm backup and rollback paths** — If the code writes files, verify atomic backup → write → verify → rollback-on-failure exists. Without rollback, corruption is possible on partial writes.

8. **Validate flag/env-var fallbacks** — If a new mode is gated by an env var (`SHL_CONSERVATIVE`, `FEATURE_X`), confirm the default is safe and the off-path is preserved.

9. **Run a targeted test, not the full suite** — Find the specific test that covers the new code. If it fails, determine whether the failure is a genuine bug or a test false-positive (test checks for old pattern, new code intentionally changes it).

10. **Identify test false-positives** — If a test flags a pattern as a bug but the code is intentional, document why. Examples: test expects `await` but `.then()` is fire-and-forget; test checks for magic number but new code uses named constant.

11. **Summarize findings in a check table** — List each verification category and its result (✅/❌). This makes the verdict transparent and reviewable.

12. **Make a rollout recommendation** — Based on findings, state whether to: (a) enable immediately and observe, (b) add more tests first, or (c) hold for further review.

## Pitfalls

- ⚠️ Confusing `await` with `.then()` — `await` in an async function is legal and correct; only flag `await` in non-async contexts or when it causes deadlock.
- ⚠️ Treating test failures as definitive bugs — test suites may check for old patterns (e.g., "file must contain `await runVerify`") while new code intentionally uses `.then()`. Investigate the intent before declaring a bug.
- ⚠️ Missing try-catch on `fs.writeFileSync` — the wrapper helper may exist elsewhere but if the write call is not wrapped at the call site, disk errors will crash silently.
- ⚠️ Assuming default flag behavior is safe — new env vars default to `ON` may enable behavior the user has not consented to. Always verify the default is conservative.
- ⚠️ Running full test suite instead of targeted test — full suite is slow and may surface unrelated failures, distracting from the new feature verification.
- ⚠️ Skipping rollback verification — atomic write without rollback means partial writes leave the file in a corrupt state. Both must exist together.

## When to Use

Use when:
- A new feature has been implemented and you want to verify it before declaring it safe
- A test is failing but the code looks intentional
- A code review requires structured verification beyond "looks OK"
- Rolling out a new mode or flag and wanting to confirm the safety net exists

Do not use when:
- The code is trivial (1-2 lines, obvious intent)
- The feature is already in production and monitored — this is for pre-rollout verification
- A dedicated linter/formatter already covers the checks (e.g., ESLint for try-catch, Prettier for formatting)
