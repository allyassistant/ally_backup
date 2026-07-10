# 169 — Loop Engineering WP1-WP5 Architecture (Orange Book Audit Action Items)

> **Source:** Loop Engineering 橙皮書 Audit Report 2026-06-17 — 5 Weak Points identified by mapping Ally architecture vs §09 Checklist + §07 Costs + §08 Engineer/Button-pusher
> **Audit file:** `Knowledge/AI/Ally 架構 vs Loop Engineering 橙皮書 Audit Report.md`
> **Orange Book:** `Knowledge/AI/Loop Engineering 橙皮書 - 完整版.md` (花叔 v260615)

---
status: active
priority: P2
created: 2026-06-17 22:32
due: 2026-07-01
progress: 0/5
---

## F — Facts

### Context
Loop Engineering Orange Book §09 defines 6 checklist items for Loop layer: discovery, state, evaluator, isolation, token limits, human checkpoints. Ally scored 44/60 (73%). Five Weak Points identified, ranging from 5-min fixes to 6-8 hr architectural changes.

### 5 Weak Points

| WP | Name | §09 Link | Score | Effort | Risk 
|----|------|----------|-------|--------|------|
| **WP1** | No worktree isolation | §04/#4 | 🟡 5/10 | 2-3 hr | Sub-agent file conflicts |
| **WP2** | Evaluator layer broken | §05/#3 | 🟡 6/10 | 4-6 hr | Loop self-assesses |
| **WP3** | Cron no closing criteria | §09#6 | 🟢 8/10 | 6-8 hr | Silent failures |
| ↳ supersedes #154 narrow-scope token budget | | | | | |
| **WP4** | Auto-suggest noise 37% | §08 | 🟡 7/10 | 5-30 min | Context pollution |
| **WP5** | Skill feedback loop broken | §07 (驗證債) | 🟡 6/10 | 20 min | No ground truth |

### Key Documents
- **Orange Book:** `Knowledge/AI/Loop Engineering 橙皮書 - 完整版.md`
- **Audit Report:** `Knowledge/AI/Ally 架構 vs Loop Engineering 橙皮書 Audit Report.md`
- **WP2 M3 Analysis:** Memory `## WP2 — M3 Implementation Analysis (2026-06-17 21:25-22:30 HKT)`
- **Skill Suggestion Analysis:** `#162` M8.4 section, Memory skill tuning section
- **#158 Adaptive Gate:** `.issues/active/158-skill-reviewer-vs-anthropic-sk.md`

---

## D — Decisions

### ✅ Decided

| Decision | Date | Notes |
|----------|------|-------|
| WP4 part of #162 M8.4 (noise reduction) | 2026-06-17 | M3 recommended Tier 1.5 (disable 3 skills) |
| WP2 M3 analysis completed, recommended worth doing | 2026-06-17 | 6 hr build, ~$5/month M3 cost, fail-open |

### ⏳ Awaiting Decision

| Decision | Trigger | Notes |
|----------|---------|-------|
| WP4 — Execute M8.4.1? | Josh go/no-go | 5 min, 0 code change, cut 29% noise |
| WP2 — Implement evaluator layer? | Josh go/no-go | 4-6 hr build, M3 design ready |
| WP1 — Priority? | Josh | 2-3 hr, sub-agent conflict risk |
| WP3 — Priority? | Josh | 6-8 hr, 28 cron jobs |
| WP5 — Priority? | Josh | 20 min, skill-feedback-auto-log |

---

## Q — Questions

### ❓ WP1 (Worktree)
- `sessions_spawn` 嘅 sandbox 支援到咩程度？而家 `context="isolated"` + `cwd` 已經有 basic 隔離，但書講嘅 git worktree 係另一層次
- Should sub-agents write to a temp git worktree then merge? Or just prevent write conflict via lock file?

### ❓ WP2 (Evaluator)
- M3 design says ~$5/month — realistic given current cost? Need real M3 call pricing check
- Should WP2 replace `anomaly_monitor.js` or complement? Boundary analysis needed

### ❓ WP3 (Cron Criteria)
- Prioritize which 28 crons first? High-value crons (L0/L1, Wiki, skill pipeline) vs low-risk (system health, mail monitor)
- `failureAlert` parameter already exists in cron schema — is the fix just adding the config field?

### ❓ WP5 (Feedback)
- Simplest approach: session-end auto-log (20 lines) or plugin (250 lines)?
- Can we reuse existing `node scripts/skill_feedback.js` or is a new script needed?

---

## Progress

### WP1 — Worktree Isolation
- [ ] Research: `sessions_spawn` sandbox depth + git worktree API
- [ ] Design: lock file vs temp worktree vs OpenClaw native isolation
- [ ] Implement: modify `AGENTS.md` + spawn config / 2-3 hr
- [ ] Verify: sub-agent file conflict scenario test

### WP2 — Evaluator Layer
- [x] M3 deep analysis completed (2026-06-17 21:25-22:30)
- [ ] Design finalized: 3 scripts + 1 manifest + 3 state files
- [ ] Implement: sampler → evaluator → action pipeline / 4-6 hr
- [ ] Deploy: 7-day rollout (Shadow → Alert → Conditional Pause → Full)
- [ ] Kill criteria wired Day 1 (8 criteria)

### WP3 — Cron Closing Criteria
- [ ] Audit all 28 cron jobs for existing criteria
- [ ] Prioritize high-value crons (L0/L1, Wiki, skill pipeline)
- [ ] Add `failureAlert` to each cron + define closing criteria
- [ ] Verify: cron failure produces Discord alert / 6-8 hr total

### WP4 — Auto-Suggest Noise Reduction (tracked in #162 M8.4)
- [ ] M8.4.1: Disable 3 worst offenders (5 min, 0 code change)
- [ ] M8.4.2: Short-Task Gate tune (15 min, core.mjs edit)
- [ ] M8.4.3: Negative Triggers field (30 min, matcher.mjs + 8 SKILL.md)
- [ ] M8.4.4: Document in HEARTBEAT.md + AGENTS.md (30 min)

### WP5 — Skill Feedback Loop
- [ ] Design: session-end auto-log approach
- [ ] Implement: log skill usage in cross_session_context or .jsonl / 20 min
- [ ] Verify: 1 feedback event logged within 24h

---

## Closing Criteria

```
✅ ALL PASS: 5/5 WPs complete or deferred with explicit Josh decision
🟡 PARTIAL: 3/5 WPs complete, remaining have Josh go/no-go decision
🔴 REGRESSION: Any WP causes P0 regression in existing system
```

### Each WP Success Criteria

| WP | Success |
|----|---------|
| WP1 | Sub-agent file conflict scenario tested → no collision |
| WP2 | Evaluator score 7+ on test cron output, agreement with human >80% |
| WP3 | All 28 crons have failureAlert, at least 1 cron alert verified in 7d |
| WP4 | 7d rolling noise rate <25% (from current 37%) |
| WP5 | At least 5 feedback events logged within 7 days |

---

## Rollback Plan

| WP | Rollback | Time |
|----|----------|------|
| WP1 | Revert AGENTS.md changes, keep sub-agent isolation defaults | 5 min |
| WP2 | Set `mode: shadow` on evaluator = cron still runs, no action | 1 min |
| WP3 | Revert `failureAlert` config for affected crons | 10 min |
| WP4 | Remove `disable-model-invocation: true` from 3 skills | 2 min |
| WP5 | Disable feedback logging script | 1 min |

---

## Cross-References
- **Parent:** #162 (Skill Pipeline Master Issue — M8.4 for WP4)
- **Depends:** #152 (QW 1.5 observation — don't modify during obs window)
- **Depends:** #168 (SHL 7-day observation — no interference, parallel track)
- **Related:** #158 (Phase 3 Adaptive Gate ABORT — lessons for WP2)

---

*Created: 2026-06-17 22:32 HKT | by Ally*
*Based on Loop Engineering Orange Book Audit + M3 WP2 Analysis*
*Progress: 0/5 — awaiting Josh decisions on priority order*
