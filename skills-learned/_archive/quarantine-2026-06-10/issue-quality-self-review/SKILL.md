```skills-learned/issue-quality-self-review/SKILL.md
---
name: issue-quality-self-review
description: 創建 issue 後進行自我質量審查，修補缺失內容，並用對比表驗證的系統化工作流程
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T11:03:04.930Z
---

## Workflow

1. **Create the issue** — Run `node /path/to/create_issue.js <title> <description> [priority] [due]`
2. **Apply F/D/Q framework** — Read the newly created issue and evaluate:
   - **Facts (F)** — Version, configuration, IDs, file paths present?
   - **Deltas (D)** — What has changed vs before? Distinguish "已做" vs "待做"?
   - **Questions (Q)** — Does it have 蘇格拉底反詰追問? Can someone dismiss it without engaging?
3. **Check 5 quality gates** — Each newly created issue should have:
   - ✅ **Success criteria** — Specific measurable pass/fail thresholds (not "works well")
   - ✅ **Rollback plan** — Concrete commands/scenarios for reverting if things go wrong
   - ✅ **Metrics targets** — What to measure during observation phase; minimum sample size
   - ✅ **Progress steps** — Date-based milestones, not vague phase names
   - ✅ **Notes/Warnings** — Known gotchas, related incidents, systemEvent lessons
4. **Identify gaps** — Compare against the 5 gates; if any missing, proceed to step 5
5. **Populate missing sections** — Edit the issue file directly:
