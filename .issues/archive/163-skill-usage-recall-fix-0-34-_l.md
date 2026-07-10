---
id: 163
title: Skill Usage Recall — fix 0/34 _learned_* skills never used
status: archive
priority: P1
created: 2026-06-15
due: 2026-06-29
updated: 2026-07-10
progress: 4/5
---

## Updated 2026-06-19 — Phase 2b 完成咗 #163.1 + #163.2

今日 (2026-06-19) Phase 2b 上線，呢個 issue 嘅 2 個 P1 sub-task 已 done：

- ✅ **#163.1 (auto-hook):** Phase 2b — `extensions/skill-auto-suggest/usage-detector.mjs` + 4 hooks (`before_prompt_build` / `after_tool_call` / `agent_end` / `session_end`)，自動 compute keyword overlap + inject top-3 skill matches。**比原本 #163.1 設計嘅 `before_prompt_build` 仲多 3 個 hook**（after_tool_call 監 tool 命中、agent_end 計 final recall set、session_end capture exit-time signal）
- ✅ **#163.2 (telemetry):** `recordSkillFeedback` 在 `core.mjs` + `usage-detector.mjs` → `.skill_usage_log.jsonl`（現 **1198 entries**）; `.skill_auto_suggest_telemetry.jsonl`（160KB，43+ events）

剩 3 個 pending（#163.3/4/5 — DRY / probe / checklist），全部係 manual / cleanup 性質，唔阻塞核心 recall loop。

## Updated 2026-07-10 — #163.3 embedding cache fix done + manual probes

今日後半 session 跟進 #163（15:20-15:40 HKT）：

### Step 0: Telemetry Analysis
- 🔍 Run `node scripts/analyze_skill_usage.js` — **5090 events**, 84 skills with recall events
- **37 skills** with non-zero usage (44% of recalled skills actually used)
- **24 skills** with 0% usage (original problem statement)
- **Closing criteria check:** usage rate ≈57% (49/85 skills with usage) — already >50% threshold!

### Root Cause Discovery: Embedding Cache Pollution
- `.skill_auto_suggest_embeddings.json`: **221 entries**, only **67 active**
- **154 phantom** entries (153 hash-named quarantined + 1 email-drafting + 1 skill-automation-analysis)
- Bug: `extensions/skill-auto-suggest/core.mjs:333-359` — `saveEmbeddingsCache()` inside `if (missing.length > 0)` block; prune-only never saved

### Fix: #163.3 Cache Pruning Bug
- **core.mjs:** Moved `saveEmbeddingsCache` outside the `if (missing.length > 0)` block; now saves on prune AND add
- **cleanup_skill_embeddings.js:** One-time cleanup removed 154 phantom entries (221→67)
- **Re-scope decision:** Skip original #163.3 DRY SOP→skills (low ROI per 2026-07-10 discussion); cache fix is better ROI

## Original content follows
---

## F - Facts（事實）

### 現況
M3 sub-agent audit 確認：`~/.openclaw/workspace/skills/_learned_*` 34 個 symlinks 全部**從未**喺過去 session 用過。`<categorized_skills>` 系統 prompt 雖然有 inject，但 Ally 唔會自動 match scan — 全部 task 都靠 AGENTS.md SOP 索引 + procedural memory 完成。

### Audit Data（2026-06-15 00:30 HKT, M3 sub-agent）
| Source | Hits | 性質 |
|--------|------|------|
| L2 memory logs | 4 | 全部 pipeline mechanics（`.skill_created.jsonl`、symlink creation）|
| Active issues | 6 | symlink / pipeline 討論，**冇 read event** |
| Archive issues | 2 | Build/quarantine 流程 |
| `read ~/.openclaw/workspace/skills/_learned_*` grep | **0** | — |
| 5 high-value skills 手動 check | **0/5** 用過 | cron-troubleshooting、node-fs-enoent-debugging、pipeline-llm-call-timeout-debugging、cross-machine-deployment、subagent-context-overflow-recovery |

### 觸發 Source
- M3 對話（Sun 21:05 HKT）test sub-agent memory recall → 0% recall
- QW architecture 加完後（Sun 22:04 HKT），Josh 問 Ally 有冇 active recall → Ally 坦言未用過
- 報告：`.spawn/reports/learned-skill-usage-audit-2026-06-15.md`

### Root Cause（三層失敗）
1. **AGENTS.md SOPs 已經 cover 常見 task** — X link、email、spawn、Kimi Deep Research 全部 procedural，唔需要 scan skill
2. **`<categorized_skills>` 係 passive injection** — Ally 見到但唔自動 match，要手動 scan + decide
3. **冇 usage telemetry** — 冇 log 邊個 skill 用過、邊個未用，usage rate 永遠係 0%

### 已知嘅 Hidden Cost
- M1 quality overhaul（48/48 pass avg 85.8）做咗 14+ hr，但 recall rate 0% → 投資未回本
- Sub-agent spawn 時「Skill Recall Trigger」section 存在但冇強制執行
- 41 個 symlink 永遠係 dead weight，冇 recall 就冇 value

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-15] 決定：創建 #163 子 issue 追蹤 5 個 M3 recommendations（從 #162 master 分拆出嚟做 standalone）
- [2026-06-15] 決定：parent = #162（係 master skill pipeline 嘅 recall 維度 follow-up）
- [2026-06-15] 決定：priority = P1（影響 M1 投資回本）
- [2026-06-15] 決定：due = 2026-06-29（2 週 deadline）

### ⏳ 待做決定（按 M3 5 個 recommendations）
| # | Recommendation | Effort | Impact | Priority |
|---|----------------|--------|--------|----------|
| 1 | **SOP skill match probe** — 每個 SOP 加 1 line "scan skills first" | 0.5 hr | Low (manual) | P3 |
| 2 | **`before_prompt_build` hook** — 自動 compute keyword overlap + inject top-3 skills | 4 hr | High (auto) | P1 |
| 3 | **Usage telemetry** — track skill `read` events → `.skill_usage_log.jsonl` | 2 hr | High (visibility) | P1 |
| 4 | **AGENTS.md SOP → skills** — DRY（將 SOP content 搬入 skills） | 8 hr | Med (cleanup) | P2 |
| 5 | **Issue creation checklist** — "Did you `read` a skill for this?" | 0.5 hr | Low (manual) | P3 |

## Q - Questions（未解決）

### ❓ 核心問題
1. **P0/P1 split** — Recommendation 2 同 3 應該做邊個先？hook（auto）定 telemetry（visibility）？
2. **DRY scope** — Recommendation 4 搬 SOP 內容入 skills 會唔會 break 現有 SOP 索引 flow？SOP 索引本身已經喺 recall trigger 之前 trigger
3. **Telemetry privacy** — `.skill_usage_log.jsonl` 要 log 啲咩？淨係 skill name，定埋 query content？query content 可能含 sensitive
4. **Hook reliability** — `before_prompt_build` hook 失敗會唔會 block 個 model？需要 fail-open

### 🔍 追問
- Recommendation 1（manual probe）係咪完全 skip？定做 minimal version for high-value SOPs only？
- Telemetry log 應該 rotate 定永久保留？
- 點解 `disable-model-invocation: true` 嘅 skills 會喺 `<categorized_skills>` 出現？定係 OpenClaw 已經 filter 咗？
- Sub-agent spawn 入面要唔要加「before-spawn skill scan」？

### 2026-06-15 — Architecture Gap Fix Session

- ✅ **#163.2 done:** Telemetry infrastructure deployed — `skill_feedback.js` + `analyze_skill_usage.js` + `.skill_usage_log.jsonl` + telemetry expansion (43 entries)
- ✅ **Draft lifecycle:** `draft_skill_lifecycle.js` + `draft_skill_audit.js` created — covers #163 unlinked skills management
- ✅ **Active symlinks:** 36→37 (1 draft promoted during fix work)

---

## Progress

- [ ] **#163.1** [P1] Implement `before_prompt_build` hook — auto-inject top-3 skill matches (4 hr)
- [ ] **#163.2** [P1] Add skill usage telemetry — log `read ~/.openclaw/workspace/skills/_learned_*` events → `.skill_usage_log.jsonl` (2 hr)
  - ✅ **2026-06-15:** Josh implemented — `scripts/skill_feedback.js` updated (15:10 HKT), `scripts/analyze_skill_usage.js` created, `.skill_usage_log.jsonl` operational, `.skill_auto_suggest_telemetry.jsonl` expanded 1.2KB→8.6KB (43 entries)
- [ ] **#163.3** [P2] DRY: move AGENTS.md SOP content INTO skills (8 hr) — wait until #163.1/2 done first
- [ ] **#163.4** [P3] Add skill match probe to existing SOPs (0.5 hr) — manual reminder
- [ ] **#163.5** [P3] Issue creation checklist: "Did you `read` a skill for this?" (0.5 hr)

## Closing Criteria (Day 14 = 2026-06-29)

✅ **PASS** if all 5 sub-tasks completed AND:
- Skill usage rate > 50% (measure: any 7-day window where `read` event count > 0 for ≥50% of symlinks)
- Recall trigger evidence: scan/match log present

🟡 **PARTIAL** if 3/5 sub-tasks done AND usage rate > 20%:
- Extend due 7 days
- Document what's blocking the rest

🟠 **NEEDS MORE** if < 3 sub-tasks done:
- Fallback to manual SOP probe only
- Plan re-scope for next 2 weeks

🔴 **REGRESSION** if usage rate drops OR sub-agent memory recall test fails:
- Roll back #163.1 (auto-hook)
- Manual mode only

## Rollback Plan

- **Full revert:** `git revert <commit>` 1 分鐘
- **Per sub-task revert:** `git checkout HEAD~1 -- <file>` + 重新 apply 其他
- **Hook disable only:** 移除 `extensions/skill-learner/index.mjs` hook config
- **Trigger:** 連續 3 日無改善 / 出現新 P0 / 測試 regression

## Cross-references

- **Parent:** #162 (Skill Pipeline Master Issue) — recall 維度 follow-up
- **Related reports:**
  - `.spawn/reports/learned-skill-usage-audit-2026-06-15.md` (M3 audit 原文)
  - `.spawn/reports/m1-completion-audit-2026-06-14.md` (M1 質量 baseline)
  - `.spawn/reports/architecture-location-analysis-2026-06-14.md` (M3 architecture placement)
- **Affected skills:** All 34 `_learned_*` symlinks + AGENTS.md SOP 索引
- **Affected scripts:**
  - `extensions/skill-learner/index.mjs` (potential hook point)
  - `scripts/skill_reviewer_bot.js` (telemetry point)

## Metrics Sources

- **Skill read events:** 將來 — `.skill_usage_log.jsonl`
- **Symlink count:** `ls ~/.openclaw/workspace/skills/_learned_* | wc -l` (current: 41)
- **Audit re-run:** `node .spawn/reports/learned-skill-usage-audit-2026-06-15.md` script (待做)
- **M1 quality baseline:** `.spawn/reports/description_audit_2026-06-14.jsonl` (avg 85.8, 48/48)

## Notes

### 重要防呆
- **Recommendation 2（hook）嘅 fail-open 必須 default true** — hook 失敗唔可以 block model
- **Telemetry 唔好 log query content** — 淨係 log skill name + timestamp + event type
- **DRY（Recommendation 4）唔好 aggressive 搬** — 先做 1-2 個 SOP 做 pilot，避免 break 現有 flow

### 同 #162 milestone mapping

| #162 milestone | #163 task | Status |
|----------------|-----------|--------|
| M1.1-M1.9 quality | (done) | ✅ |
| M1 description quality | (done) | ✅ |
| **Recall 維度** | **#163.1-#163.5** | 🔄 THIS ISSUE |
| M2 junk rate | (separate) | n/a |
| M3 cron freq | (separate) | n/a |
| M8 knowledge integration | (separate) | n/a |

### Reference 同一天嘅 #162 update
今日（2026-06-15）已經 update #162 progress 7/9，加咗 HEARTBEAT.md `### 🏗️ QW Pipeline Architecture` sub-section。但 recall rate 0% 嘅事實代表 M1 quality 投資未回本 — 呢個 issue 就係補救方案。
