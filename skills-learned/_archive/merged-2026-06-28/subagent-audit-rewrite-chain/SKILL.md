---
name: subagent-audit-rewrite-chain
description: Run a two-phase M3 sub-agent chain to audit and then rewrite code when a task requires investigation before safe edits, verifying after each phase.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-16T11:05:02.561Z
---

## Workflow

1. **Spawn Phase 1 — Investigation M3**
   Spawn an M3 sub-agent with the investigation prompt. Ask it to:
   - Identify the root cause by reading source files and memory artifacts
   - Trace the failure path with specific file:line evidence
   - Propose a fix design before touching any code

2. **Verify Phase 1 output**
   - Check that the M3 report cites concrete file paths and line numbers
   - Reject vague conclusions without source evidence
   - If evidence is weak, yield back to Phase 1 for deeper tracing

3. **Spawn Phase 2 — Fix M3**
   Spawn a second M3 sub-agent with the approved fix design.
   Give it:
   - The exact file paths to modify
   - The specific change to apply (dedup logic, config value, etc.)
   - A clear scope boundary — do not refactor adjacent code

4. **Verify Phase 2 output**
   Run these checks in order:
   ```bash
   # Syntax check
   node --check <target-file>
   
   # Git diff to confirm scope
   git diff <target-file>
   
   # QA pass — spawn a third M3 for pass/fail judgment
   ```
   If any check fails, return to Phase 2 with the specific error.

5. **Final state confirmation**
   Confirm all verifications green before reporting completion.
   Report: fix applied, scope clean, syntax pass, QA pass.

## Pitfalls

- ⚠️ Skipping Phase 1 verification — M3 jumps straight to fixes without root-cause evidence → same bug recurs in adjacent code paths because the underlying cause was never identified.

- ⚠️ M3 applies multiple unrelated fixes in one pass — scope creep makes it impossible to isolate which change caused a regression → keep Phase 2 scoped to one fix per spawn.

- ⚠️ No syntax check after fix — M3 introduces a parse error → syntax check with `node --check` is mandatory before git diff.

- ⚠️ Skipping git diff review — changes appear correct but affect unintended lines (e.g., extra whitespace, reformatted indentation) → always review diff before QA pass.

- ⚠️ Case sensitivity in string comparisons — `Status: Draft` vs `status: draft` silently fails dedup logic → normalize with `.toLowerCase()` before comparison; this bug caused 21-22x skill chatter repeats over 4 days.

- ⚠️ Trusting M3's self-reported fix without independent verification — M3 may claim "verified" without running checks → always run `node --check` and `git diff` yourself, not just accept M3's summary.

- ⚠️ Yielding to Phase 2 without confirming Phase 1 evidence — if the root cause trace is incomplete, the fix addresses a symptom not the cause → require file:line citations before proceeding.

- ⚠️ Running QA pass without reading fix output first — spawning QA before the fix has actually been applied (yield timing issue) → check that the file on disk contains the fix before spawning QA sub-agent.
