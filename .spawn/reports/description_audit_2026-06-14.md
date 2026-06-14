# Skill Description Audit — 2026-06-14

**Total skills audited:** 48  
**Passed (≥70):** 9  
**Failed (<70):** 39  
**Needs human review:** 23  
**Average score:** 49.7/100

## Score distribution

| Range | Count |
|-------|-------|
| 90–ideal | 0 |
| 70–89    | 9 |
| 50–69    | 22 |
| 30–49    | 13 |
| 0–29     | 4 |

## Top 10 worst (priority for M1.3)

| # | Skill | Score | Length | Issue |
|---|-------|-------|--------|-------|
| 1 | `concurrent-session-rate-limit-avoidance` | 0 | 0 | no trigger |
| 2 | `skills-audit-workflow` | 0 | 0 | no trigger |
| 3 | `aliveness-noise-reduction` | 25 | 48 | no trigger |
| 4 | `issue-duplicate-prevention-workflow` | 25 | 37 | no trigger |
| 5 | `context-gather-subagent-orchestrate` | 30 | 66 | no trigger |
| 6 | `heartbeat-maintenance` | 30 | 76 | no trigger |
| 7 | `main-session-execution-loop-recovery` | 30 | 53 | no trigger |
| 8 | `subagent-code-tuning-workflow` | 30 | 66 | no trigger |
| 9 | `error-auto-issue` | 35 | 107 | no trigger |
| 10 | `intent-based-spawn-model-selection` | 35 | 97 | no trigger |

## Top 5 best (reference patterns for M1.3)

| # | Skill | Score | Length | Description (first 100c) |
|---|-------|-------|--------|------------------------------|
| 1 | `x-article-login-wall-fallback` | 70 | 129 | Workflow for bypassing X.com article login walls with 6-layer fallback chain, then saving to Obsidia |
| 2 | `skill-quality-verification` | 70 | 120 | Workflow for building and tuning composite skill-quality heuristics that catch stubs without killing |
| 3 | `skill-curation-pattern` | 70 | 127 | Pattern for curating skill files — upstream source filtering, filesystem mtime and content analysis, |
| 4 | `skill-automation-analysis` | 70 | 85 | 分析 skill library，判斷邊個 skill 值得自動化（cron job / script integration / manual SOP），並計算 ROI |
| 5 | `openclaw-config-schema-debugging` | 70 | 184 | Workflow for diagnosing and working around OpenClaw's strict JSON schema config validation — includi |

## Suggested actions

- **10 skills** need full rewrite (target M1.3 top-10)
- **22 skills** need partial rewrite (target M1.4)
- **9 skills** already pass — leave for now

## M1.3 / M1.4 selection criteria

Priority = lowest score + highest frequency in `<categorized_skills>` block.
See `.spawn/reports/description_audit_2026-06-14.jsonl` for full per-skill data.
