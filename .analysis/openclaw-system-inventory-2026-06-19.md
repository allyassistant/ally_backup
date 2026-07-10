# OpenClaw System Inventory (Phase 1)

**日期：** 2026-06-19
**作者：** Mavis (Ally's assistant)
**對應目標：** Goal 1 (全局 scripts 搵 bug + 修復) + Goal 2 (自我學習生成 skill)
**狀態：** Phase 1 / 3 — Inventory complete, 唔郁 code

---

## 1. Extension Layer — 7 個

| ID | Hook | Priority | Output | Consumer |
|----|------|----------|--------|----------|
| **debug-event** | before_prompt_build | 1 | log to `/tmp/debug_event.log` | diagnostic only |
| **skill-learner** | before_prompt_build + agent_end | 5 | `<categorized_skills>` + queue write | LLM context + skill reviewer |
| **route-enforcer** | before_model_resolve + before_prompt_build | 10 | provider/model override + route instruction | LLM model selection + prompt |
| **channel-context** | before_prompt_build | 20 | `[CHANNEL: <emoji> <name>]` persona | LLM persona |
| **skill-auto-suggest** | before_prompt_build | default | `<suggested_skills>` top-3 ranked | LLM focused suggestion |
| **self-healing-loop** | after_tool_call + agent_end + session_start + session_end | 50 | verify + LOW_RISK_RULES auto-fix | host (Layer 1 only) |
| **skill-tools** | (tool definition, not hook) | n/a | `skill_manage` action | LLM explicit call |

### Critical 觀察

- **4 個 before_prompt_build hooks 並行 fire** (debug-event → skill-learner → route-enforcer → channel-context → skill-auto-suggest)，全部寫 `prependSystemContext`
- **2 個 skill injection system 並行**：skill-learner 嘅 categorized list 同 skill-auto-suggest 嘅 top-3 ranked 會同時 inject。**用戶已確認：兩個都留**
- **route-enforcer cron bypass**：cron jobs 唔經 route-enforcer enforcement（`if (ctx?.trigger === "cron") return`）
- **debug-event 純 diagnostic**：可考慮 disable / archive
- **self-healing-loop 唔覆蓋 Layer 2/3/4**：只 fires on `after_tool_call`（即係被動 reactive）

---

## 2. Skill Injection Contract（兩系統並行，OQ-1 答案）

```
skill-learner（priority 5, broad）
├─ Output:    <categorized_skills> 列出全部 skill by category
├─ Use case:  LLM 需要 complete landscape context 時用
├─ Strength:  zero missed skill
├─ Weakness:  冇 ranking，LLM 自己 decide 用邊個
└─ Source:    listCategorizedSkills() in scripts/lib/skill_discovery.js

skill-auto-suggest（priority default, ranked）
├─ Output:    <suggested_skills> top-3 with score (keyword + vector blend)
├─ Use case:  LLM 需要 focused suggestion 時用
├─ Strength:  有 keyword + vector cosine score
├─ Weakness:  nomic-embed-text English-centric，CJK > 50% → 自動 fallback 落 keyword-only
└─ Source:    computeTopMatches() in extensions/skill-auto-suggest/core.mjs

skill-tools（orthogonal, 唔同 layer）
├─ Output:    skill_manage tool definition (action: create/patch/edit/delete/write_file/remove_file/list)
├─ Use case:  LLM explicit call (主動 manage skill)
├─ Strength:  完整 CRUD + path safety
└─ Source:    extensions/skill-tools/index.mjs

Coexistence rules:
  1. 三個都 fire / available，唔互斥
  2. skill-learner output 排前面（priority 5 = earlier）
  3. skill-auto-suggest top-3 通常係 skill-learner list 嘅 subset
  4. Conflict resolution：if skill-auto-suggest top-1 唔喺 skill-learner list → anomaly，flag
  5. skill-tools 永遠 LLM explicit call，唔自動 fire
```

---

## 3. Skill Library — 36 active

### 4 個 built-in (bundled)

```
skills/
├─ agents-best-practices/         (OpenClaw 原生, agent architecture reference)
├─ kimi-deep-research/            (SOP + pre-flight + pricing)
├─ tools-reference/               (但 50%+ overlap with TOOLS.md, 部分 outdated)
└─ x-link-analysis/               (X link 分析 workflow, 常用)
```

### 32 個 _learned_ (auto-generated symlinks → skills-learned/)

```
Domain pattern     | Count | Examples
-------------------|-------|----------------------------------
Cron / ops          |   2   | cron-health-triage, cron-troubleshooting
Error / anomaly     |   4   | error-auto-issue, anomaly-proactive-push, node-fs-enoent-debugging, pipeline-llm-call-timeout-debugging
Skill management    |   3   | skill-curation-pattern, skill-validation-failure-cleanup, skill-automation-analysis
Subagent workflow   |   4   | parallel-subagent-implementation, subagent-sideeffect-containment, subagent-qa-verification-workflow, subagent-code-tuning-workflow
M3 multi-angle      |   3   | m3-multi-angle-system-audit, m3-adversarial-challenge-spawn, m3-subagent-article-analysis
OpenClaw debug      |   3   | openclaw-compaction-investigation, openclaw-config-schema-debugging, openclaw-no-reply-chain-debugging
Plugin debug        |   1   | route-enforcer-plugin-debugging
Code quality        |   2   | code-review-checklist, system-code-debug-triage
Loop / architecture |   2   | loop-engineering-implementation, architecture-review-external-audit
Daily / synthesis   |   3   | daily-synthesis, heartbeat-maintenance, aliveness-noise-reduction
Misc workflow       |   5   | multi-session-resumption, external-analysis-to-issue-extraction, issue-duplicate-prevention-workflow, llm-call-execfile-migration, x-article-login-wall-fallback
```

### Quarantined

- 25 個 quarantine-* dir in `skills-learned/_archive/`
- Retention: 6+ 個月（已超，應該清理 — Phase 3a）

### Skill metadata 狀態

| Field | Coverage | Note |
|-------|----------|------|
| `name` | 100% | required |
| `description` | 100% | required |
| `status` | 100% (全部 "active") | but 5 個 stub 級 file size |
| `category` | **0%** | 全部 missing, **阻住 skill-learner categorized injection** |
| `provenance` | partial | 有啲有有啲冇 |
| `disable-model-invocation` | 0% | 冇用過呢個 flag |

---

## 4. Cron Schedule — 24 enabled

### OpenClaw jobs (`~/.openclaw/cron/jobs-state.json.migrated`)

```
Total:     29 jobs (24 enabled / 5 disabled)
Last ok:   23/24
Last err:  1 (50 23 * * *)

Enabled schedule clusters:
  Hourly windows:    0 */2, 0 1, 0 4, 0 5, 0 6, 0 8, 0 12
  Half-daily:        0 6,18
  Multi-daily:       10,15,22 / 0,4
  Weekly:            0 3 * * 0, 0 4 * * 0, 0 7 * * 1, 0 9 * * 0
  Daily specific:    5 0, 35 0, 40 0, 41 0, 45 0, 50 0, 50 23, 59 23
```

### System crontab (`crontab -l`)

```
* * * * *     heartbeat.sh                                 (every minute)
*/1 * * * *   failover_detector.sh                         (every minute)
0 6 * * *     backup_to_bliss.sh                           (daily 06:00)
* * * * *     mail_monitor.js                              (every minute)
55 23 * * *   metrics_collector.js                         (daily 23:55)
*/5 * * * *   deepseek_health_monitor.sh                   (every 5 min)
0 3 * * 0     openclaw_guard.sh                            (weekly Sun 03:00)
```

### Load profile

```
00:00-00:59  ←  HEAVY (backup, multi-cron, heartbeat)
01:00-03:59  ←  light
04:00-04:59  ←  EMPTY (best for new audit cron) ← ← ←
05:00-05:59  ←  light
06:00-06:59  ←  HEAVY (backup again)
...
23:00-23:59  ←  HEAVY (daily synthesis, metrics, 23:50 cron err)
```

**Recommended new audit slot:** 04:30 (in the empty window)

---

## 5. Scripts Layer — 187 .js files

### Lib (`scripts/lib/`)

| File | Purpose | Used by |
|------|---------|---------|
| **frontmatter.js** | YAML frontmatter parse/serialize | 9+ sites（skill_reviewer, weekly_correction_loop, skill-learner, skill-tools, skill-auto-suggest, etc.） |
| **qualitative_signals.js** | 5 signal types detection (correction, frustration, praise, technique, etc.) | skill-learner |
| **skill_discovery.js** | skill dir scanner + frontmatter extraction | skill_reviewer, skill-auto-suggest |
| **aggregate_signals.js** | queue entries → structured signals (shared) | skill_reviewer + skill-learner |
| **rules/low-risk.js** | LOW_RISK_RULES (deterministic fix) | self-healing-loop (Alt A path) |
| **rules/high-risk.js** | HIGH_RISK_RULES (review-required) | code_quality_manager |
| **rules/system-audit.js** | 12 audit rules (syntax, paths, cron refs, dangling, etc.) | auditOrchestrator |
| **auto_repair.js** | confidence-based repair (HIGH/MEDIUM/LOW strategy) | code_quality_manager |
| **skillIntegrityScanner.js** | B.4-B.8 checks (frontmatter, commands, formulas, wikilinks, cross-ref) | CQM |
| **pattern_learner.js** | FP/TP auto-learning from batch verification | code_quality_manager |
| **semantic_matcher.js** | semantic matching engine | ??? (need to map caller) |
| **umbrella_consolidation.js** | skill consolidation tool | curator (not seen running) |
| **auditOrchestrator.js** | 3-scanner (Local / AI / Error) coordination | **NOT cron-connected** |
| **batch_verifier.js** | batch verification orchestration | code_quality_manager |
| **baseline_store.js** | baseline metric tracking | ??? |
| **state.js** | shared state mgmt (atomic write helper) | multiple |
| **config.js** | centralized paths | multiple (Issue #133 DRY) |
| **disk_guard.js** | atomic write safety | skill_reviewer |
| **path_safety.js** | safe path resolution | skill-tools |
| **fileDiscovery.js** | file enumeration | auditOrchestrator |
| **minimax_scrubber_core.js** | minimax provider scrubber | ??? |
| **pin_semantics.js** | pin semantic checking | ??? |
| **proposal_hash.js** | proposal dedup hash | ??? |
| **system_check_generator.js** | system check generation | ??? |
| **system_check_templates.js** | system check templates | ??? |
| **time.js** | time utilities | multiple |
| **issueAggregator.js** | issue aggregation | ??? |

### Helpers (`scripts/lib/helpers/`)

```
context_helpers.js       — context line extraction
file-cache.js            — file content cache
rule-helpers.js          — rule framework helpers
skip-list.js             — skip patterns
try-catch-helpers.js     — P0 try-catch detection (regex)
try-catch-helpers-ast.js — AST-based try-catch detection
whitelist_patterns.js    — false positive whitelist
```

### Analyzers (`scripts/lib/analyzers/`)

```
file-analyzer.js  — file content analyzer
index.js          — barrel export
```

### Top-level scripts (`scripts/*.js`)

```
Skill management (15):
  skill_reviewer.js                 (921 lines, primary reviewer pipeline)
  skill_reviewer_bot.js             (legacy? need to verify overlap)
  skill_reviewer_cleanup.js         (queue cleanup)
  skill_reviewer_pipeline.js        (?)
  skill_reviewer_daily_report.js    (?)
  skill_reviewer_resume.js          (?)
  validate_skill_file.js            (post-write validator, 195 lines)
  skill_description_auditor.js     (description audit)
  skill_m3_advisory.js              (M3 advisory)
  skill_junk_pause.js               (junk rate pause logic)
  skill_junk_tracker.js             (junk rate metric)
  skill_activation_tester.js        (?)
  skill_feedback.js                 (skill feedback event handler)
  skill_pitfalls_fallback.js        (?)
  draft_skill_audit.js              (?)
  draft_skill_lifecycle.js          (?)
  migrate_skills_to_subdir.js       (migration)
  analyze_skill_usage.js            (usage analysis)

Cron / health (5):
  cron_health_triage.js             (789 lines, primary cron health)
  cron_preflight_runner.js          (?)
  failover_detector.sh              (?)
  deepseek_health_monitor.sh        (?)
  heartbeat.sh                      (?)
  openclaw_guard.sh                 (?)

Audit / quality (5):
  auditOrchestrator (in lib)
  code_quality_manager.js           (?)
  code_quality_generator.js         (?)
  code_quality_templates.js         (?)
  metrics_collector.js              (?)

Domain-specific (~150):
  gia_*.js (4)
  diamond_*.js (3)
  rapaport_*.js (2)
  daily_*.js (3)
  apple_*.js (2)
  customer_*.js (3)
  auto_*.js (3)
  ... rest are project-specific
```

---

## 6. Skill Pipeline Architecture（實際 4 layers）

```
                  ┌─────────────────────────────────────┐
   Layer 0        │  Conversation happens (Discord / API)│
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
   Layer 1        │  skill-learner.agent_end hook        │
   (queue write)  │  - channel filter (10 excluded)      │
                  │  - tool-call filter (≥2)             │
                  │  - compress (last 6 turns)           │
                  │  - qualitative_signals detection      │
                  │  → .skill_review_queue.jsonl         │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
   Layer 2        │  skill_reviewer.js (cron, ~30min)    │
   (aggregation)  │  - read queue (last N entries)      │
                  │  - aggregateSignals() shared lib     │
                  │  - buildSkillCatalog table          │
                  │  - cache prompt (skillHash + sigHash)│
                  │  → prompt to LLM                    │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
   Layer 3        │  LLM judge                           │
   (decision)     │  - PATCH > UPDATE > CREATE > SKIP    │
                  │  - dedup is advisory (in prompt)     │
                  │  - writes fenced SKILL.md block      │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
   Layer 4        │  3-tier validation                   │
   (validation)   │  ├─ pre-write gate (<1500B reject)  │
                  │  ├─ validate_skill_file.js          │
                  │  │  (2-of-3 stub signals)           │
                  │  └─ quarantine (junk rate metric)   │
                  │                                     │
                  │  Success → symlink to skills/_learned│
                  └─────────────────────────────────────┘

   INJECTION (orthogonal):
                  ┌─────────────────────────────────────┐
   Inject A       │  skill-learner.before_prompt_build    │
                  │  → <categorized_skills> full list     │
                  └─────────────────────────────────────┘
                  ┌─────────────────────────────────────┐
   Inject B       │  skill-auto-suggest.before_prompt_build│
                  │  → <suggested_skills> top-3 ranked   │
                  └─────────────────────────────────────┘
                  ┌─────────────────────────────────────┐
   Inject C       │  skill-tools (tool definition)        │
                  │  → LLM explicit skill_manage call     │
                  └─────────────────────────────────────┘
```

---

## 7. Validation 三套（Phase 2g unify target）

| Validator | Trigger | Rules | Outcome |
|-----------|---------|-------|---------|
| **Pre-write gate** (in bot) | Before write | `bytes < 1500` reject | Reject stub |
| **validate_skill_file.js** | After write | 2-of-3 stub signals (size / workflow / word count) | Errors array |
| **Curator quarantine** | Periodic | junk rate > threshold | Auto-archive |

**問題：3 套 standard 唔一致 → 6 個 "passed-and-quarantined" skills**

---

## 8. Identified Gaps（未存在，要 build）

1. **Server-side dedup gate**（OQ-2 答案：soft gate — cosine > 0.85 warn + LLM decide）
2. **Auto-suggest feedback loop**（after_prompt_build + agent_end hooks missing）
3. **Tool-call sequence miner → skill queue**（connect pattern_learner.js output）
4. **Cron-scheduled auditOrchestrator runner**（infra exists, scheduler missing）
5. **Tier-aware unified verifier**（取代 3 套）
6. **Audit → auto_repair snapshot/rollback integration**（auditOrchestrator 完成 detection，auto_repair 執行 fix，但之間冇 wire）
7. **Skill category field population**（32/32 active skills missing `category:` frontmatter）
8. **Skill use tracking**（`.skill_usage_log.jsonl` 已有，但 use rate calculation 缺）

---

## 9. Identified Dead Code / Quarantine

### Scripts
- `skill_reviewer.js.backup.20260608_0158` (old backup, can delete)
- `rules/low-risk.js.bak.20260407122439`
- `rules/high-risk.js.bak.20260405_130335`

### Quarantined skills (25 in _archive)
- > 6 個月 retention 已過，**Phase 3a DELETE target**

### skills-learned/ root (77 dirs)
- 32 active (symlinked)
- 25 quarantined (in _archive)
- ~20 orphan / untracked / draft

### Junk rate trend (per `.skill_junk_rate.jsonl`)
```
2026-06-10  7d  total:45   passed:14  failed:31  junkRate:68.89%
2026-06-15  7d  total:164  passed:119 failed:45  junkRate:27.44%  (improving)
2026-06-18  7d  total:166  passed:144 failed:22  junkRate:13.25%  (continues improving)
```

---

## 10. Phase 2/3 Dependencies

```
Phase 2 (Wire the Loop) dependencies:
├─ 2a telemetry fix:        standalone
├─ 2b feedback loop:        needs skill-auto-suggest index.mjs modification
├─ 2c connect pattern:      needs queue format compat check
├─ 2d cron audit:           needs crontab edit (system)
├─ 2e audit→repair:         needs auditOrchestrator + auto_repair integration
├─ 2f soft dedup:           needs embedding similarity infra (already in skill-auto-suggest core.mjs)
└─ 2g unified verifier:     needs skill_reviewer.js + validate_skill_file.js + quarantine replacement

Phase 3 (Stabilize + Measure):
├─ 3a prune:                DELETE-only, zero risk
├─ 3b baseline:             needs 7-day cron run
├─ 3c LLM judgment pass:    needs LLM call
├─ 3d end-to-end test:      needs all Phase 2 components
├─ 3e daily digest:         needs metric infra
└─ 3f Phase 4 scope:        data-driven decision
```

---

## 11. Open Decisions (post-inventory)

1. **Route-enforcer cron bypass**: 要唔要 audit cron jobs 都 enforce route？
2. **debug-event**: 純 diagnostic，disable / archive？
3. **3 injection coexistence contract**: 已答「兩個都留」，但 anomaly detection rule（conflict rule 4）需要寫
4. **Soft dedup threshold**: 0.85 起步，追蹤 warning ignored rate，>50% 改 threshold
5. **Skill category auto-fill**: Phase 2a 之後做，LLM-judgment pass 一次幫 36 active skills 加 category
6. **Quarantine retention**: 6 個月 retention policy 已過，需要明確新 policy

---

## 12. Next Concrete Step

Phase 2 開始。第一步：**2a — 確認 telemetry 嘅 "foo" extraction bug 嘅 root cause**（之前 grep 嘅 awk script bug vs 真係 file schema bug）。

如果確認係 telemetry schema 正常，2a 完成，立刻做 2b (feedback loop)。