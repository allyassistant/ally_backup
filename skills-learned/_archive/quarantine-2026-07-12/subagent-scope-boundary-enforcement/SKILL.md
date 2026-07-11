---
name: subagent-scope-boundary-enforcement
description: Audit sub-agent output for changes beyond the requested scope, then fence the spawn prompt or rollback out-of-scope edits before declaring done.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-16T10:40:32.263Z
---

## Workflow

1. **Inspect M3 output against the original request** — After M3 yields, diff the applied changes against the explicit scope described in the spawn prompt. Flag any additions that were not explicitly requested.

2. **Classify each change** — Label changes as:
   - ✅ **In-scope** — directly addresses the requested task
   - ⚠️ **Out-of-scope** — added by M3 without prompt authorization
   - ❓ **Ambiguous** — may or may not be intended; requires human judgment

3. **Report boundary violations clearly** — Reply to the user with a two-column breakdown: in-scope changes vs out-of-scope additions. Use ✅ and ⚠️ emoji labels. Do not bury the finding in prose.

4. **Decide on remediation path**:
   - If out-of-scope changes are safe and potentially useful → flag them and ask for confirmation before proceeding
   - If out-of-scope changes risk state corruption or unwanted side effects → spawn a follow-up M3 audit for redundancy or rollback specific patches
   - If M3 consistently exceeds scope → adjust the spawn prompt template to include explicit scope fences (e.g., "ONLY apply the following 3 patches: ...")

5. **Update spawn prompt template** — When scope creep repeats, append a scope fence to future spawn prompts: `## CONSTRAINTS: Apply ONLY the patches listed below. Do not add features, refactors, or new functions not explicitly requested.`

6. **Verify final state** — After remediation, confirm the working tree matches the intended scope before marking the task complete.

## Pitfalls

- ⚠️ Treating M3's extra additions as "helpful" without flagging them — future sessions lose track of what was actually requested vs what M3 invented; scope bleeds become normalized
- ⚠️ Not reporting scope violations to the user — if the agent silently accepts out-of-scope patches, the user loses oversight and trust in the sub-agent chain
- ⚠️ Spawning M3 without explicit scope fences on multi-patch tasks — M3 defaults to thoroughness and will apply all plausible-looking changes unless constrained; always enumerate exact patch targets
- ⚠️ Rolling back only the visible patches but missing indirect dependencies — new helper functions (e.g., `shouldSymlinkSkill()`) may be referenced by other code; rollback must be transitive
- ⚠️ Forgetting to update the spawn prompt template after scope creep — if the same task type recurs, the next M3 call will hit the same over-application pattern; fix the template, not just the current output
