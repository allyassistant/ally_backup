---
name: external-analysis-to-issue-extraction
description: Convert external article/tweet analysis into concrete system improvement issues with actionable steps and staged implementation phases
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T19:01:01.228Z
---

## Workflow

1. **Extract actionable improvements** — From the article/analysis, identify specific, concrete system improvements. Evaluate each by ROI (impact vs effort) and assign priority (P1/ P2/ P3). Discard vague advice ("be more thorough") and abstract principles ("use good architecture"). Keep only items that map to a specific file, config, or process change.

2. **Create issue first, implement later** — When user says "加入issue先，之後再跟進" (create issue first, follow up later), create the issue immediately before doing any implementation work. This captures the task while context is fresh and prevents the user from losing track. The issue should contain:
   - Clear scope boundary (what Phase 1 covers, what Phase 2+ defers)
   - Cross-reference to related issues (e.g., "depends on #158")
   - Execution status: not yet started

3. **Design multi-phase implementation plan** — Group improvements into logical phases:
   - Phase 1: Core infrastructure (scripts, validators, description rewrites) — highest ROI, self-contained
   - Phase 2: Feature enhancements (tool configurations, progressive disclosure) — builds on Phase 1
   - Phase 3: Verification and testing (tester scripts, coverage checks) — dependent on Phase 1+2
   
   Record deferred phases as Notes within the issue, not separate issues, to avoid noise.

4. **Decompose Phase 1 into tracked sub-tasks** — Each sub-task should be concrete and verifiable:
   - Script creation: `scripts/<name>.js` — scan N items, do X
   - Batch update: Update top N items (specify N and selection criteria)
   - Classification: Sort items into categories (manual vs automated)
   - Extension: Modify existing validators with new checks
   - Cross-reference: Update related issues with correct dependency links

5. **Re-prioritize when scope shifts** — If initial analysis returns more items than expected (e.g., 41 skills to audit instead of 10), split into batches. Do top N first, record remaining in Notes. Update issue priority and scope accordingly.

6. **Verify issue completeness before closing** — Ensure:
   - Issue title clearly names the implementation (not just the article source)
   - Phase breakdown is documented
   - Sub-tasks have clear completion criteria
   - Cross-references to dependent issues are correct
   - User can follow up without re-reading the original article

## Pitfalls

- ⚠️ Creating implementation issues before article analysis is complete — The analysis step may surface unexpected scope (e.g., 41 skills instead of 10). Always finish high-level analysis first, then create the issue with accurate scope. Otherwise you'll need to reopen and rewrite.
- ⚠️ Forgetting to cross-reference issues — When an implementation depends on another issue (e.g., description auditor depends on classification schema), include the reference in the issue body. Without it, the user must context-switch to find related work.
- ⚠️ Over-promising phase scope — Phase 1 should be achievable in a single focused session (Sunday deadline). If Phase 1 has 6 sub-tasks involving 4 different scripts, it's too big. Split into Phase 1a/1b or reduce scope.
- ⚠️ Creating separate issues for deferred phases — Each issue creates noise in the issue tracker. Use issue Notes or a checkmark list for deferred work; only promote to a new issue when Phase 1 is complete and user explicitly requests it.
- ⚠️ Failing to update description after scope change — If initial issue title says "implement X improvements" but analysis found 3x more items than expected, update the issue title and description to reflect actual scope. Stale descriptions mislead the user during follow-up.
