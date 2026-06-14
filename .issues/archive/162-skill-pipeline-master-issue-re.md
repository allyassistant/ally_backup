---
id: 162
title: Skill Pipeline Master Issue — recall + quality + integration (consolidates #133/#146/#150/#152/#158/#161 + #147 cron freq + #141 cron reactivation)
status: archive
priority: P1
created: 2026-06-14
due: 2026-07-15
updated: 2026-06-14
progress: 0/9
---

## Description

**Consolidation scope：** 8 個 active + 1 個 archive 議題整合作 single master issue。**Josh 真正 goal：** agent 識 recall fresh skills + skill pipeline 生出嚟嘅嘢真係有用。任何唔服務呢個 goal 嘅 task 都要淘汰。

**Today (2026-06-14) reality check：**
- 51 個 skills in `skills-learned/` · 48 active symlinks · 10 quarantined (#149) · 2 failed validation
- 24h junk rate: **12.9%** (target <10% — close but not passing yet)
- 7d junk in production: **9.38%** (target <10% — passing ✅)
- `.skill_matcher_metrics.jsonl` 唔存在 (#143 silent death — confirmed)
- 3 個 0-progress issues (#147, #152, #161) — execution gap

---

## F - Facts（事實）

### 現有 Pipeline 狀態 (2026-06-14)

| Layer | State | Source |
|-------|-------|--------|
| **Signal capture** | agent_end → queue (`.skill_review_queue.jsonl`) | skill-learner plugin (priority 5) |
| **LLM generation** | skill_reviewer_pipeline.js (30-min cron, isolated) | HEARTBEAT.md row 20 |
| **Validator** | validateSkillContent() unified pre+post write (QW-3) | scripts/validate_skill_file.js |
| **Pre-write gate** | 1500B min + 3 pitfalls min + backtick stateful | #146 BUG-03/05 + #152 QW-3 |
| **Atomic write** | safeWriteFileSync (tmp + rename) | #146 BUG-06 |
| **Auto-symlink** | `_learned_*` symlink on pass (configurable via env) | skill_reviewer_bot.js CONFIG.AUTO_APPLY |
| **Junk auto-pause** | 24h rate > 15% → `.skill_reviewer_pause.json` → skip symlink | skill_junk_pause.js + MEMORY.md Week 1 |
| **Shadow LLM judge** | Phase 2 + Phase 3 24h Adaptive Gate, daily 13:00 HKT eval | #158 / scripts/llm_judge_* |
| **Catalog auto-inject** | `<categorized_skills>` block in every prompt (skill-learner priority 5) | skill-learner/index.mjs:228 |

### 每個 source issue 嘅 critical finding

| Issue | Status | True value for Josh's goal | Verdict |
|-------|--------|----------------------------|---------|
| **#133** | 8/9 done | High — provides the architecture | KEEP active, finish Step 9 |
| **#136** | 4/5 done, indefinite | Medium — recurring maintenance, low manual cost | KEEP active, no master integration needed (orthogonal) |
| **#139** | 3/3 done, OVERDUE | Bug fixed — no remaining work | **CLOSE** (mark complete) |
| **#146** | 11/13 done | Bug fix done, 2 deferred (WARN-05 no-op, WARN-06 false positive) | **CLOSE** (master inherits scope) |
| **#147** | 0/3 | Low — needs QW obs data first | **MERGE → M3** |
| **#150** | 1/3 (Day 3/7) | Medium — overlap with #152 | **MERGE → M2** (single tracker) |
| **#152** | 0/0 (Day 3/7) | High — QW fixes shipped, just observing | **MERGE → M2** (single tracker) |
| **#158** | 14/14 (Phase 3 live) | High — Phase 3 Adaptive Gate running | KEEP active until Phase 3 Day 7, **CLOSE after** |
| **#161** | 0/6 (NOT STARTED) | **Highest value** — directly serves recall goal via `disable-model-invocation` + 3-段 description | **KEEP active, this week's #1 priority** |
| **#141** (archive) | 3 P0 scripts built, cron disabled | Reactivation decision pending | **MERGE → M5** (Josh decides activate or stay disabled) |

### Critical alignment with Josh's true goal

> "agent 識 recall fresh skills + skill pipeline 生出嚟嘅嘢真係有用"

| Need | Current | Gap | Master Milestone |
|------|---------|-----|------------------|
| **Fresh skills recallable** | Catalog auto-injected, 51 skills | LLM struggles to pick right one from 51 | **M1: #161 — disable-model-invocation + 3-段 description** |
| **Useful output (low junk)** | 7d junk-in-prod 9.38% ✅ | Above 24h target 10% | **M2: Continue obs to Day 7** |
| **Cost-effective LLM use** | Cron 30 min, M2.7 primary | Untested at lower freq | **M3: Cron frequency optimization post-QW** |
| **Confidence boost via 2nd opinion** | Phase 3 Adaptive Gate live | Need Day 7 calibration | **M4: Phase 3 Day 7 verdict** |
| **Lean skill library** | Step 9 trim, 5 patterns 1 skill | 2 oversized skills remain | **M1b: Finish #133 Step 9** |
| **Maintenance mode** | 3 dormant P0 scripts (#141) | Activation decision pending | **M5: Decide activate or archive** |

### 過時 / 不再 relevant 嘅 assumptions

| Assumption | 仍然 valid? | Why |
|------------|-------------|-----|
| threshold 0.15 for skill-matcher | ❌ Already silently dead (#143), directory 刪咗 | 不要 revive #143 |
| 30-min cron frequency | ❌ Needs data, not assumption | M3 會 quantify |
| 3-min pitfalls minimum (PITFALLS_MIN) | ✅ | BUG-03 fix verified |
| 1500B minimum file size | ✅ | BUG-03 fix verified |
| LLM judge shadow mode effectiveness | ⏳ Pending Phase 3 Day 7 | M4 |
| Anthropic `disable-model-invocation: true` supported by OpenClaw | ❓ Need to verify | M1 prerequisite |

### Duplicate / overlap cleanup

| Pair | Overlap | Decision |
|------|---------|----------|
| #150 vs #152 | Both track junk rate post-fixes (different fix generations) | **MERGE → M2** single tracker |
| #146 WARN-05 vs #148 archive | WARN-05 = relative symlinks, #148 already cleaned them | **CLOSE both** (HEARTBEAT shows 0 stale symlinks) |
| #146 WARN-06 | False positive — regex works for bold pitfalls | **No-op** (don't merge) |
| #158 Phase 3 monitoring | Has 7-day window — same window as #150/#152 | **KEEP** (different goal: LLM judge calibration, not junk rate) |

---

## D - Decisions（決定）

### ✅ 已做決定 (consolidation, 2026-06-14)

| Decision | Date | Rationale |
|----------|------|-----------|
| **整合 8 active + 1 archive issues 入 #162 master** | 2026-06-14 | Single source of truth for skill pipeline work |
| **#161 = highest priority (M1)** | 2026-06-14 | Direct alignment with Josh's "agent 識 recall" goal |
| **M2 = single junk-rate tracker (merges #150 + #152)** | 2026-06-14 | 兩個 tracker 做同一件事 = duplicate effort |
| **#139 = close (bug fixed)** | 2026-06-14 | 3/3 done, no remaining scope |
| **#146 = close after master exists** | 2026-06-14 | 11/13 done; remaining 2 are no-ops or merged |
| **#147 = merge into M3** | 2026-06-14 | 0/3, can't decide without QW obs data |
| **#158 = keep for Phase 3 Day 7, then close** | 2026-06-14 | Adaptive Gate needs 7-day window to verify |
| **Path F + Anthropic frontmatter > plugin auto-inject** | 2026-06-14 | Per `plugin-skill-matcher-analysis-2026-06-14.md` recommendation |
| **❌ No revival of #143 skill-matcher plugin** | 2026-06-14 | Silent death proves commitment issue, not technical issue |
| **❌ Knowledge Architecture Audit file (referenced but missing)** | 2026-06-14 | File does not exist in `.spawn/reports/` — likely never created or lost. Master takes its place. |

### ⏳ 待做決定 (this week)

| Decision | Trigger | Owner | Deadline |
|----------|---------|-------|----------|
| OpenClaw frontmatter `disable-model-invocation` schema support? | Before M1 step 1 | Ally (research via OpenClaw source) | Jun 15 |
| 6 manual skill candidates (per #161) auto-classify OR Josh review? | Before M1 step 3 | Josh | Jun 17 |
| 3 P0 scripts from #141 activate OR archive permanently? | Before M5 | Josh | Jul 01 |
| After M2 Day 7 — close OR keep monitoring junk rate? | Day 7 of obs | Josh | Jun 18 |

---

## Q - Questions（未解決）

### ❓ Core questions

1. **M1: `disable-model-invocation: true` 喺 OpenClaw frontmatter 真係 work？** — Need to grep OpenClaw source for frontmatter schema support. If not, fall back to AGENTS.md trigger + skill-activation comment marker.
2. **M1: 41 active skills 全 audit 太花時間 — Josh 想 top-10 先 OR 全做？** — Per #161 "先 top 10 最高頻 skills，再擴展全部" 計劃，但 "最高頻" 點度量？
3. **M3: 30 min cron → 2 hr 有冇 missed signals 風險？** — 需要睇 queue depth pattern 7 日先知。如果日間 9-18 hit 多 → 動態頻率更複雜。
4. **M4: 24h Adaptive Gate 6 指標會唔會永遠 gray zone？** — A2 sub-agent 設 n=4 zero-tolerance，real 3.7/day 可能長期 gray。
5. **M5: 3 個 P0 scripts 啟用 vs 併入 CQM 嘅 tradeoff？** — 獨立 cron 靈活但 noise；併入 CQM 集中但難以 debug。

### 🔍 追問

- #161 嘅 Step 4 「XML 尖括號檢測」具體係咩 bug 場景？
- 12.9% 24h junk rate（target 10%）有冇 1-2 個 outlier skills 影響大？
- Phase 3 Adaptive Gate 嘅 costUsd/day 數據點樣 gather？
- `disable-model-invocation: true` 嘅 OpenClaw plugin implementation 喺邊度？

---

## Master Task List（重新排好嘅先後次序）

### 🎯 M1: 提升 Recall 質量（直接對齊 Josh 真正 goal）

> Source: #161 (0/6). **最高 priority。**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M1.1 | Research OpenClaw frontmatter `disable-model-invocation` support | P0 | 30min | Know if schema accepts field | Grep result + test file | — | Risk mitigation for M1.3 |
| M1.2 | Write `skill_description_auditor.js` (3-段 formula check) | P0 | 2hr | Audit report for 41 skills | Script + report json | M1.1 | Foundation for batch update |
| M1.3 | Batch update top-10 skills' descriptions (3-段 formula) | P0 | 3hr | 10 skills have [做咩]+[幾時用]+[關鍵能力] | Frontmatter diff | M1.2 | Highest impact for LLM recall |
| M1.4 | Extend to remaining 31 skills' descriptions | P1 | 5hr | All 41 skills audited | Frontmatter diff | M1.3 | Complete coverage |
| M1.5 | Add `activation: auto|manual` frontmatter (6 manual skills) | P0 | 2hr | 6 critical skills marked manual | Frontmatter diff | M1.1 | Anthropic pattern: control auto-trigger |
| M1.6 | `validate_skill_file.js` Appendix C (XML check + trigger phrase) | P1 | 1hr | Validator extended | Test pass | M1.1 | Catch bad descriptions pre-write |
| M1.7 | Write `skill_activation_tester.js` (verify manual 唔 auto-trigger) | P1 | 2hr | Test that manual skills ignored by LLM | Test pass | M1.5 | Verify Anthropic pattern actually works |
| M1.8 | AGENTS.md 加 "Skill Recall Trigger" section (Path F) | P1 | 30min | LLM 識得自己 scan + decide | Text edit | — | Backup if `disable-model-invocation` not supported |
| M1.9 | Update #158 cross-reference + close #161 | P0 | 15min | Master remains single tracker | Issue status | M1.1-M1.8 | Hygiene |

**Total effort:** ~16 hr over 1 week. **Estimated impact:** LLM recall hit rate +30-50% (Anthropic style).

---

### 📊 M2: 持續監察 junk rate（合併 #150 + #152）

> Source: #150 (1/3) + #152 (0/0). **Currently 12.9% 24h, target <10%.**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M2.1 | Single tracker script: `skill_junk_tracker.js` 已經喺度，confirm runs at 23:55 HKT | P1 | 0hr | Daily junk rate logged | Cron check | — | Existing |
| M2.2 | Day 5 check (Jun 16): `tail -5 .skill_junk_rate.jsonl` rolling avg | P1 | 5min | Trend visible | Value | M2.1 | Mid-week check |
| M2.3 | Day 7 check (Jun 18): closing criteria apply | P1 | 15min | PASS/PARTIAL/NEEDS MORE verdict | Documented | M2.1 | Final decision point |
| M2.4 | If PASS (<10% sustained): write `_learned_skill-reviewer-prompt-design` skill | P2 | 2hr | Reusable pattern captured | Symlink created | M2.3 PASS | Capture learnings |
| M2.5 | If NEEDS MORE: execute方案 2/5/6 from #152 (cron dedup / reusability threshold / token budget) | P2 | 4hr | Junk rate <30% | New junk rate <30% | M2.3 NEEDS | Fallback |
| M2.6 | Update MEMORY.md with QW prompt design lesson | P1 | 30min | Knowledge preserved | MEMORY.md entry | M2.3 | Long-term value |

**Closing criteria (Day 7, Jun 18):**
- ✅ PASS: 7d junk rate ≤10% AND 0 self-referential AND 0 regression → M2.4 + M2.6, close M2
- 🟡 PARTIAL: 7d 10-30% → extend 7d, observe
- 🟠 NEEDS MORE: 7d >30% → M2.5, open follow-up
- 🔴 REGRESSION: rate rising OR P0 bug → rollback QW commit `bcf253c`, revert M2.5

---

### ⏱️ M3: Cron Frequency Optimization（合併 #147）

> Source: #147 (0/3). **Depends on M2 first — need data.**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M3.1 | Measure current cache hit rate + avg queue size (3-7d post-M2) | P2 | 30min | Quantified | `tail .skill_metrics` data | M2.3 | Data-driven decision |
| M3.2 | Decide: 2hr vs min-queue-size=3 vs hybrid | P2 | 1hr | Decision made | Documented | M3.1 | Trade-off analysis |
| M3.3 | Apply change + verify no missed signals (7d post-change) | P2 | 1hr | Cron updated | HEARTBEAT.md updated + 0 missed | M3.2 | Implement |
| M3.4 | Cost saving: ~$X/month based on lower call count | P3 | 30min | Quantified saving | Spreadsheet | M3.3 | ROI proof |

**Decision rule:** If cache hit ≥60% AND avg queue <5 → extend to 2hr. If queue bursty → min-queue-size=3 gate.

---

### 🧪 M4: Phase 3 Adaptive Gate 觀察（保留 #158 部分）

> Source: #158 (14/14 analysis done, Phase 3 implementation live). **7-day window started Jun 13.**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M4.1 | Monitor 24h Adaptive Gate verdict at 13:00 HKT daily (already cron-wired) | P1 | 0hr/day | Daily PASS/EXTEND/ABORT log | .llm_judge_gate.jsonl | — | Existing |
| M4.2 | Wait Day 7 (Jun 20): full calibration report | P1 | — | Calibration data | Report | M4.1 | Final eval |
| M4.3 | Fix Bug #4 (cron `79c3b194` 30min check 120s still timeout) | P1 | 1hr | 30min check works | Cron success | — | #158 known issue |
| M4.4 | Decide: ACTIVATE judge layer OR stay shadow | P1 | 1hr | Documented verdict | Master entry | M4.2 | Day 7 decision |
| M4.5 | Close #158 (analysis + Phase 3 complete) | P1 | 15min | Issue archived | Status | M4.4 | Hygiene |

**Hard veto (per A2 zero-tolerance):** If any of 1 catastrophic mismatch OR 2+ both-junk OR >50% split rate → ABORT.

---

### 🔄 M5: Reactivation Decision for #141 3 P0 scripts

> Source: #141 archive. **Scripts built, cron disabled, decision pending.**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M5.1 | Evaluate: activate vs merge into CQM (3 scripts: cron-health-triage, anomaly-proactive-push, error-auto-issue) | P3 | 1hr | Josh decision | Documented | — | #141 unresolved |
| M5.2 | If activate: `openclaw cron add` 3 jobs + verify | P3 | 2hr | 3 crons live | HEARTBEAT.md updated | M5.1 | Standalone path |
| M5.3 | If merge into CQM: modify `code_quality_manager.js` to include phases | P3 | 4hr | CQM extended | Tests pass | M5.1 | Consolidated path |
| M5.4 | If archive permanently: move scripts to `_legacy/` with doc note | P3 | 30min | Scripts 0 cost | Folder created | M5.1 | Clean exit |

**Josh decision criteria:** 3 scripts 都 detect real issues (stale jobs, anomalies, error patterns) — activate if effort worth it (low cost: ~2hr for 3 cron). Skip if today's anomaly/error pattern already covered by other crons.

---

### 🛠️ M6: Pipeline Maintenance & #133 Step 9 Finish

> Source: #133 (8/9 done). **Low priority, just housekeeping.**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M6.1 | Trim `cron-job-testing` (17→8 steps): extract wakeMode/silent-push to `references/` | P3 | 2hr | Core SKILL.md < 6KB | File size check | — | #133 Step 9 |
| M6.2 | Trim `skill-curation-pattern` (16→8 steps): split front-reference + back-workflow | P3 | 2hr | Core SKILL.md < 6KB | File size check | — | #133 Step 9 |
| M6.3 | Monitor pipeline until Jun 27 (due date) | P3 | 0hr/day | Healthy | No regressions | M6.1-M6.2 | Observational |
| M6.4 | Close #133 when Step 9 done | P3 | 15min | Issue archived | Status | M6.1-M6.3 | Hygiene |

---

### 🔁 M7: Recurring Maintenance（#136 永久）

> Source: #136 (4/5 done, indefinite). **By design recurring.**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M7.1 | Watch for "↪️ Model Fallback" notice re-emerge (signals npm update wiped patch) | P1 | 0hr/day | Patch in place | Discord reply surface | — | #136 trigger |
| M7.2 | Re-apply JS patch if wiped (location now `agent-runner.runtime-Duta-cpW.js` L149, L157) | P1 | 5min | Patch back | node --check | M7.1 | Re-apply |
| M7.3 | Re-apply env var if wiped (`OPENCLAW_SILENT_FALLBACK=true` in service-env) | P1 | 1min | Env var set | `tail -5 env` | M7.1 | Re-apply |
| M7.4 | Consider post-update hook to auto-apply patch | P3 | 4hr | Automation | Hook registered | — | Future improvement |

---

### 📚 M8: Knowledge Integration (deferred from earlier research)

> Source: Knowledge Architecture Audit (referenced but file missing). **Josh's goal includes "knowledge integration".**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M8.1 | Cross-session bootstrap: add `## Available Skills` section (Step 2) | P2 | 2hr | LLM context includes recent skills | Bootstrap run | M1 done | Knowledge integration |
| M8.2 | Connection Surface: add skill cross-link detection (Step 1 already fixed) | P2 | 1hr | New skills auto-linked to related ones | Test | — | #133 related |
| M8.3 | Wiki/L0/L1/Obsidian auto-wikilink from new skills | P3 | 4hr | Skills cross-reference existing notes | Wikilinks added | M8.1 | Knowledge graph |

---

### 🛡️ M9: Master Hygiene & Cross-References

> Source: master consolidation. **Keep master clean.**

| # | Task | Priority | Effort | Expected outcome | Success criteria | Deps | Rationale |
|---|------|----------|--------|------------------|------------------|------|-----------|
| M9.1 | Update MEMORY.md: add "Skill Pipeline Master #162" entry, link to here | P1 | 15min | Memory updated | MEMORY.md | — | Discoverability |
| M9.2 | Update AGENTS.md: replace per-issue references with "see #162" | P2 | 30min | Single reference | AGENTS.md | — | Routing |
| M9.3 | Cross-reference: HEARTBEAT.md Skills Health section → #162 | P3 | 15min | Single source | HEARTBEAT.md | — | Discoverability |
| M9.4 | Obsidian note: "Skill Pipeline Architecture" (consolidate all reports) | P3 | 2hr | Single Obsidian doc | Note created | M1-M7 done | Long-term archive |

---

## Closing Criteria (Master Issue)

```
✅ MASTER PASS (close #162):
   - M1 done: 41 skills audited + activation control + 6 manual classified + validator extended
   - M2 done: junk rate Day 7 verdict recorded (PASS or fallback executed)
   - M3 done: cron frequency decision applied + verified
   - M4 done: Phase 3 Day 7 verdict (ACTIVATE or ABORT) + #158 closed
   - M5 done: Josh decision on #141 scripts (activate/merge/archive)
   - M6 done: #133 Step 9 complete + #133 closed
   - M7: acknowledged as recurring (no closure)
   - M8 at least M8.1+M8.2 done
   - M9 done: cross-references in MEMORY/AGENTS/HEARTBEAT

🟡 PARTIAL (extend 14d):
   - M1 done, M2 PARTIAL, M3-M6 partial, M8-M9 missing
   - Re-prioritize remaining

🔴 REGRESSION:
   - Junk rate spike to >30% OR
   - P0 corruption incident OR
   - Master tasks not addressing Josh's real goal
```

---

## Rollback Plan

| Scenario | Action | Effort |
|----------|--------|--------|
| **M1.5 `disable-model-invocation` breaks LLM trigger** | Revert frontmatter field per skill | 5min/skill |
| **M1.3-M1.4 bad descriptions** | `git revert <sha>` for skill frontmatter | 1min |
| **M2 PASS turned NEEDS MORE after Week 2** | Rollback QW commit `bcf253c` | 1min |
| **M3 cron change missed signals** | Revert to 30min in HEARTBEAT.md | 1min |
| **M4 ACTIVATE judge layer caused incident** | Disable judge, keep heuristic path only | 5min |
| **Master scope explosion (>50% growth)** | Sub-issue to decompose | TBD |

---

## Cross-References

### Active (待處理)
- **#133** Skill Self-Learning Hermes-style — M6
- **#136** Smart Router Model Fallback — M7
- **#146** Skill Reviewer Pipeline Bugs — close after M1-M4 exist
- **#147** Skill Reviewer Cron Frequency — M3 (merge)
- **#150** 7-day obs junk rate — M2 (merge)
- **#152** QW-1~5 observation — M2 (merge)
- **#158** Anthropic comparison — M4 (close after Day 7)
- **#161** FakeMaidenMaker Phase 1 — M1

### Archive (closed by previous work, but referenced)
- **#141** Capability Gap Analysis — M5 (reactivation decision)
- **#143** skill-matcher plugin rollout — STAY ARCHIVED (Path F rejected plugin approach)
- **#148** Historical symlink audit — STAY ARCHIVED (0 stale symlinks per HEARTBEAT)
- **#149** Quarantine 10 junk — STAY ARCHIVED (done)
- **#054** Google Cloud Skill Design Patterns — STAY ARCHIVED (5/5 done)
- **#018** Router 20-char threshold — STAY ARCHIVED (observation done)

### Key Reports
- `~/.openclaw/workspace/.spawn/reports/skill_reviewer_audit_2026-06-10.md` — 6 P0 + 4 WARN bugs found (fixed in #146)
- `~/.openclaw/workspace/.spawn/reports/plugin-skill-matcher-analysis-2026-06-14.md` — Path F + Anthropic frontmatter > plugin auto-inject
- `~/.openclaw/workspace/.spawn/reports/task_a_model_fallback_analysis.md` — #136 root cause
- `~/.openclaw/workspace/.spawn/reports/full-auto-skill-pipeline-feasibility-2026-06-12.md` — Feasibility analysis
- `~/.openclaw/workspace/.spawn/reports/skill_library_gap_analysis_2026-06-12.md` — Library gaps
- ⚠️ `knowledge-architecture-audit-2026-06-14.md` referenced but does NOT exist — likely never created; M8 partially takes its place

### Data sources
- `~/.openclaw/workspace/.skill_created.jsonl` — 121 events (junk rate trend source)
- `~/.openclaw/workspace/.skill_junk_rate.jsonl` — 17 days, last reading 12.9% (24h)
- `~/.openclaw/workspace/.llm_judge_shadow.jsonl` — 17 entries (Phase 2 shadow data)
- `~/.openclaw/workspace/skills-learned/_archive/` — quarantined + failed-validations

---

## Notes

### Strategic context (for rehydration)

- **Josh 真正 goal:** agent recall fresh skills + pipeline output 真係有用。唔係 recall mechanism，係 quality 改善。
- **M1 (recall quality) > M2 (junk rate) > M3 (cost) > M4 (calibration) > M5 (legacy) > M6 (housekeeping) > M7 (recurring) > M8 (knowledge graph) > M9 (hygiene)**
- **Path F (AGENTS.md + Anthropic frontmatter) > Path B (skill-matcher plugin revival) — decisively rejected**
- **M2 single tracker > dual tracker (closes duplicate #150/#152)**
- **#146 WARN-05 (symlink relative) = no-op, #148 archive = implicit fix**
- **#139 = bug fixed, just needs status update**
- **3 個 dormant P0 scripts from #141: keep as decision item (M5), don't auto-activate**

### 觀察期 checklists (per M2)

| Day | Date (HKT) | Check | Threshold |
|-----|-----------|-------|-----------|
| Day 5 | Jun 16 (Tue) | Mid-week trend | <20% junk rate |
| Day 7 | Jun 18 (Thu) | Final verdict | <10% junk rate (PASS) or >10% (PARTIAL) |
| Day 7 + 7d | Jun 25 (Thu) | M2.5 fallback if NEEDS MORE | <30% |

### 觀察期 checklists (per M4)

| Day | Date (HKT) | Check | Threshold |
|-----|-----------|-------|-----------|
| Daily | 13:00 HKT | Adaptive Gate verdict | PASS / EXTEND / ABORT |
| Day 7 | Jun 20 (Sat) | Calibration report | ACTIVATE or ABORT |

### Open TODOs (carried from predecessor issues)

- [ ] M1.1: Verify OpenClaw frontmatter `disable-model-invocation` support
- [ ] M1.5: 6 manual skill candidates (Josh review auto-classify)
- [ ] M2.3: Day 7 verdict (Jun 18)
- [ ] M3.1: Cache hit rate measurement (post-M2)
- [ ] M4.2: Phase 3 Day 7 verdict (Jun 20)
- [ ] M4.3: Fix cron `79c3b194` 30min check 120s timeout (#158 known issue)
- [ ] M5.1: Josh decision on #141 scripts activation
- [ ] M9.1-M9.3: Cross-reference updates in MEMORY/AGENTS/HEARTBEAT

### Why this master exists (rationale for rehydration)

Before #162: 8 active issues tracking overlapping concerns, 3 with 0 progress, 1 with stale 1-week obs data. After #162: 1 master + 3 keep-active (#133, #136, #158) + 1 indefinite (#136). All non-recurring work tracked in 1 place. 2x reduction in issue tracking overhead.

*Created: 2026-06-14 05:40 HKT by M3 sub-agent for comprehensive consolidation*
*Sub-agent session: agent:main:subagent:c4889a60-2b7a-47f8-a5aa-8554b0fce2f7*
