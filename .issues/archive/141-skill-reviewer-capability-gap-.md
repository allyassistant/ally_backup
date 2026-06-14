---
id: 141
title: Skill Reviewer Capability Gap Analysis
status: archive
priority: P1
created: 2026-06-09
due: 2026-06-16
updated: 2026-06-09
progress: Added Removed reason — pending merge into System Check Bot
---

# 141: Skill Reviewer Capability Gap Analysis

**Priority:** P1
**Due:** 2026-06-16
**Created:** 2026-06-09

---

## F (Facts) — 現狀

### Background
- OpenClaw 有 28 個 generated skills（2026-06-09 加到 31，已移除 3 個 P0 cron jobs）
- M3 做咗 2 個 parallel audit：1 個分析 skills 功能，1 個分析 OpenClaw 現有功能
- Audit 結果已合成 unified report 並報去 #🧑🏻‍💻編程

### Current Skills Coverage (28 skills)

| Cluster | Skills | 數量 |
|---------|--------|------|
| **Cron reliability** | cron-failure-investigation, cron-feature-deprecation, cron-job-testing, cron-model-selection-verification, cron-thin-executor-migration, pipeline-flag-audit-workflow | 6 |
| **Skill self-curation** | skill-automation-analysis, skill-curation-pattern, skill-quality-verification, skills-audit-workflow, subagent-truncation-repair, code-review-checklist | 6 |
| **Subagent orchestration** | deep-research-subagent-spawning, multi-phase-subagent-orchestration, parallel-subagent-implementation, subagent-code-tuning-workflow, subagent-sideeffect-containment | 5 |
| **Code / config** | llm-call-execfile-migration, openclaw-config-schema-debugging, route-enforcer-plugin-debugging, system-code-debug-triage | 4 |
| **Memory / synthesis** | daily-synthesis, multi-session-resumption, issue-conclusion-overturn-cleanup | 3 |
| **Model / migration** | model-migration-workflow | 1 |
| **Domain-specific** | ai-hot-push-workflow, rapaport-email-summary, script-integration-analysis | 3 |

### OpenClaw Operational Surface
- **29 cron jobs** registered (26 live + 3 disabled/idle, per HEARTBEAT.md)
- 11 heartbeat/HA scripts, 9 memory tools, 6 Obsidian scripts, 5 Discord utilities, 4 router scripts, 3 code quality tools
- **4 cron jobs** currently in error/stale state:
  - `knowledge_ingester` (cron `9ebd92c9`) — 19h stale, LLM request failed
  - `anomaly_monitor` (cron `02cb43e1`) — 7d stale, lastStatus=warning
  - `daily_maintenance` — tracked in [[#132]]
  - `wiki_ingest` — needs investigation
- 2.2σ anomaly alert sitting unread in `.last_anomaly_alerts.json`
- 92 error entries accumulated in `memory/errors.json`
- 3 duplicate skills:
  - `browser-automation` — plugin skill in `~/.openclaw/plugin-skills/` (official system skill, not managed)
  - `system-code-debug-triage` — learned skill in `skills-learned/` (potential overlap with code-review-checklist)
  - `daily-synthesis` — learned skill in `skills-learned/` (potential overlap with daily synthesis cron pattern)
- ~26% of skills missing `category:` field in frontmatter

### Built (cron removed — pending merge into System Check Bot)
3 P0 skills built as thin executors but cron jobs removed (2026-06-09).
**Reason:** Josh wants to evaluate integrating these into the existing System Check Bot (`scripts/code_quality_manager.js` — CQM) rather than running as 3 separate cron jobs. Possible merge scope includes:
- cron health + anomaly push → CQM scan phase
- error auto-issue → CQM post-scan notification phase

| Skill | Script | SKILL.md | Symlink | Status |
|-------|--------|----------|---------|--------|
| `cron-health-triage` | `scripts/cron_health_triage.js` (12KB) | `skills-learned/cron-health-triage/SKILL.md` (6.7KB) | `skills/_learned_cron-health-triage` | ✅ built, ❌ cron removed |
| `anomaly-proactive-push` | `scripts/anomaly_proactive_push.js` (11KB) | `skills-learned/anomaly-proactive-push/SKILL.md` (7.7KB) | `skills/_learned_anomaly-proactive-push` | ✅ built, ❌ cron removed |
| `error-auto-issue` | `scripts/error_auto_issue.js` (13KB) | `skills-learned/error-auto-issue/SKILL.md` (8.1KB) | `skills/_learned_error-auto-issue` | ✅ built, ❌ cron removed |

All 3: syntax OK ✅, e2e tested with Discord pushes ✅, idempotent ✅

## D (Decisions) — 建議項目

### P0 — 已實作但無 cron（可隨時啟用）
1. **cron-health-triage** — 每小時 scan 所有 cron jobs，分類健康狀態，推 #⚙️系統
   - Script: `scripts/cron_health_triage.js` ✅ syntax OK
   - Effort: 🔄 加返 cron 就得
   - Impact: 🟢 High — 即刻 detect 3 個 stale/error jobs
2. **anomaly-proactive-push** — 30 分鐘 check `.proactive_alerts.json`，推 2σ+ 異常
   - Script: `scripts/anomaly_proactive_push.js` ✅ syntax OK
   - Effort: 🔄 加返 cron 就得
   - Impact: 🟢 High — anomaly 而家冇人睇
3. **error-auto-issue** — 每日掃 errors.json，≥3 次自動開 P1 issue
   - Script: `scripts/error_auto_issue.js` ✅ syntax OK
   - Effort: 🔄 加返 cron 就得
   - Impact: 🟢 High — 92 errors 累積緊

### P1 — Proactive Monitoring
4. **skill-auto-promote** — draft skill 達 quality standard 自動 promote
   - Effort: 🟡 Medium — 要開 quality gate
   - Impact: 🟢 High
5. **wiki-to-obsidian-bridge** — high quality wiki page auto-sync to Obsidian
   - Effort: 🟡 Medium
   - Impact: 🟡 Medium
6. **duplicate-skill-detector** — content hash 比對 detect + quarantine
   - Effort: 🟢 Simple
   - Impact: 🟡 Medium
7. **description-auto-shorten** — skill description > 170 char 自動 truncate
   - Effort: 🟢 Simple
   - Impact: 🟡 Medium

### P2 — Knowledge Graph Enhancement
8. **auto-wikilink-suggester** — scan Obsidian notes for orphan topics, suggest `[[wikilinks]]` to connect them
   - Effort: 🟡 Medium — need Obsidian vault scan pattern
   - Impact: 🟡 Medium — knowledge graph quality
9. **daily-knowledge-graph-rebuild** — rebuild cross-note graph daily, highlight new connections
   - Effort: 🟡 Medium
   - Impact: 🟡 Medium
10. **cross-session-pattern-spotter** — spot recurring patterns across multiple sessions, auto-promote to skill
    - Effort: 🔴 High — need cross-session ML
    - Impact: 🟢 High — auto-skill generation
11. **skill-cluster-optimizer** — detect overlap/merge opportunities in skills-learned/
    - Effort: 🟡 Medium — content similarity compare
    - Impact: 🟡 Medium — reduce redundancy

### Infrastructure — 4 New Signal Sources
Skill Reviewer 而家只睇 `.skill_review_queue.jsonl`（1 source）
建議加到 4 sources：
- Cron 連續 fail → enqueue cron-health-triage 候選
- Anomaly 2σ+ → enqueue anomaly-proactive-push 候選
- Error 重複 ≥3x → enqueue error-auto-issue 候選
- Heartbeat stale → enqueue heartbeat-dashboard 候選

## Q (Questions) — 未解決問題

Q1: 要唔要等 Skill Reviewer 加 signal hooks 先開返 P0 cron？
Q2: 定係 P0 三個獨立 run，signal hooks 後續再做？
Q3: 3 個 duplicate skills 要點處理 — merge / archive / keep both？
Q4: 26% missing category field — 要 batch fix 定等下次 next skill review cycle？
Q5: 加咗 signal hooks 後，Skill Reviewer 嘅 learning rate 要點 tune 先唔會 spam？

## References
- **Synthesis report**: Discord #🧑🏻‍💻編程 message `1513596444265807922` (2026-06-09)
- **M3-1 audit**: session `6eb9a2f1` (capabilities audit)
- **M3-2 audit**: session `c56a532a` (OpenClaw features audit)
- **M3 build**: session `bf825e2e` (3 P0 scripts)
- **Related issues**: [[132]] (daily_maintenance tracking)
- **Related skills**: `cron-failure-investigation`, `cron-job-testing`, `skill-automation-analysis`

## Next Action
**Owner:** Ally (Josh review)
**Immediate:** Decide whether to enable P0 cron jobs or add signal hooks first.
**Follow-up:** If P0 cron approved, `openclaw cron add` 3 jobs. If Q5 (learning rate tuning) needs discussion, spawn follow-up analysis.

## Progress Checklist

- [x] 2 M3 parallel audits 完成
- [x] Synthesis report 報去 #🧑🏻‍💻編程 (msg `1513596444265807922`)
- [x] 3 P0 skills script 完成 + test pass (session `bf825e2e`)
- [ ] P0 cron job 啟用（pending decision）
- [ ] Skill reviewer signal hooks (4 new sources)
- [ ] P1 skills 進度
- [ ] P2 skills 進度
