---
id: 154
title: Loop Engineering Phase 1 (Narrow): Termination Manifest + Token Budget
status: archive
priority: P1
created: 2026-06-11
due: 2026-06-25
updated: 2026-07-04
progress: 0/7
---

# Loop Engineering Phase 1 (Narrow) — Termination Manifest + Token Budget

## 背景

Loop Engineering 嘅 3 個 prerequisite (Karpathy): **file mod + metric + cost cap**。我哋有 file mod（commit history）+ metric（junk rate, anomaly），但**完全冇 cost cap**。今日 M3 deep analysis 證實：呢個係唯一 P0 gap。

Phase 1 narrow 範圍：3-4.5hr 投資，搞掂最 critical 嘅 2 個 work item（1.1 + 1.2），其餘 defer。

## F - Facts（事實）

### 現況
今日（2026-06-11）完成 3 個 deep analysis：
- **M3 deep analysis** (`loop-engineering-analysis-2026-06-11.md`, 7,000 字)
- **M2.7 value assessment** (follow-up, narrow scope)
- **M3 detailed implementation plan** (`loop-engineering-phase1-plan-2026-06-11.md`, 5,500 字)
- **M3 manifest quality deep dive** (`loop-engineering-manifest-quality-2026-06-11.md`, 8 parts, 61KB)

M2.7 value assessment verdict：narrow scope 3-4.5hr，**KEEP 1.2 + 1.1**，**DEFER 1.3/1.4/1.5**。

### 數據/證據
| 項目 | 值 |
|------|-----|
| LLM crons 總數 | 5 個 (Skill Reviewer, KB Ingest, L0 Gen, L1 Gen, Daily Summary) |
| Skill Reviewer 頻率 | 48 次/日 (highest) |
| Skill Reviewer LLM cost | ~$1.44/日, $43/月 (M2.7 @ $0.03/call) |
| Total LLM cost (5 crons) | ~$50/月 estimate |
| Stuck loop worst case | 30-min interval × 5 min timeout = $0.10/loop event, 可 silent 累積 |
| Phase 1 總 effort | 4.5hr (matches M2.7 budget) |
| Phase 1 改動 file 數 | 7 new + 5 edits, ~100 lines additive, 0 lines removed |
| #152 observation 截止 | 2026-06-18 |
| #153 observation 截止 | 2026-06-18 |
| Phase 1 observation 窗口 | 2026-06-18 → 2026-06-25 |

### 5 LLM Crons 確認
| Cron | Schedule | Model | Calls/day | Risk |
|------|----------|-------|-----------|------|
| **Skill Reviewer** | */30 * * * * | M2.7 | 48 | 🔴 HIGH |
| **KB Ingest** | 0 5 * * * | M2.7 hybrid | 5-20 | 🟡 MED |
| **L1 Generator** | 35 0 * * * | deepseek-flash | 1 | 🟢 LOW (large output) |
| **L0 Generator** | 5 0 * * * | deepseek-flash | 1 | 🟢 LOW (short) |
| **Daily Summary** | 59 23 * * * | M2.7 | 1 | 🟢 LOW (main session) |

21 non-LLM crons 排除 (有 reasoning in plan Part 1)。

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-11] **Scope 限縮到 1.1 + 1.2**（M2.7 value assessment）
- [2026-06-11] **1.3/1.4/1.5 全部 defer**（premature / paranoid / overkill）
- [2026-06-11] **Manifest format: YAML + JSON Schema 雙轨**
- [2026-06-11] **Quality system: 4-tier (Hard Fail/Soft Fail/Degraded/Pass+Note)**
- [2026-06-11] **Recovery system: 4-tier (A/B/C/D with circuit breaker at 5 fails/7d)**
- [2026-06-11] **LLM-as-Judge 標記為 optional**（cost vs value ratio 唔抵；QW-1~5 已提供 validator gate）
- [2026-06-11] **所有改動都係 additive，git revert-able，log-only mode 起動**
- [2026-06-11] **Phase 1 commit 後等 #152/#153 7-day observation 結果先正式 launch**

### ⏳ 待做決定（5 個 Josh approval gates）
- [ ] **D1: Token cap 數值** — M3 提議 (50K/100K/30K/20K/35K per cron)，最終要 Josh 過目
- [ ] **D2: Global daily $50 cap** — M3 提議 30 起步，寫 50 係 conservative；Josh 確認數值
- [ ] **D3: File structure** — `cron_config/llm_budget.yaml` + `lib/llm_budget.js` + `docs/loop_termination_manifest.md`？定整合入 HEARTBEAT.md？
- [ ] **D4: Launch timing** — 今日 (Jun 11) commit + log-only？定等 #152 close (Jun 18) 先正式 launch？
- [ ] **D5: 觀察期獨立 vs 合併** — 新 issue #154 (本 issue) 獨立 7 日，定加去 #152 observation？

## Q - Questions（未解決）

### ❓ 核心問題
1. **Josh 5 個 decision points 點答？**（影響 Phase 1 嘅具體 implementation）
2. **Log-only mode 真係夠？** 定要先做 soft pause（超 budget 就 skip cron）？
3. **Circuit breaker 5 fails/7d 嘅 threshold 點定？** 5 係 M3 estimate，要 Josh 過目
4. **Phase 2 upgrade path (log_only → pause) 何時觸發？** #154 Day 7 後？定要 #152 結果？

### 🔍 追問（蘇格拉底反詰）
- **點解唔直接做 soft pause？** 因為會影響 #152 observation baseline（多咗一個 confounder）。先 log-only 收集數據，第二 phase 先加 enforcement。
- **如果 4-tier quality system 全部 false positive 點？** Threshold 全部 tuneable，由 anomaly 7d baseline 自動生成。Day 1/3 checkpoint 會 verify 冇 false positive。
- **如果 Skill Reviewer 5 fails 內係 legit fail**（e.g. provider outage）？ circuit breaker 會 auto-trigger 暫停。呢個係 acceptable trade-off（寧可暫停都唔好 silent burn cost）。
- **點解唔包 LLM-as-Judge？** 因為 5 個 LLM crons 加多一個 judge call = cost 翻倍。QW-1~5 validator gate 已處理 content quality，唔需要再 judge。
- **21 non-LLM crons 唔做 quality check？** 唔係，佢哋有 light spec（process check + idempotency + error count），但唔使 LLM-as-Judge。
- **點解唔等 #152 result 先寫 code？** 因為 code 係 additive，git revert-able，log-only mode 唔影響現有 observation。等齊先做只係 preference，唔係 necessity。

## Progress

### Phase 1 Implementation (4.5hr)
- [ ] **Step 1: Setup infra files** (~30min)
  - Create `cron_config/` directory
  - Create `cron_config/manifest_schema.json` (JSON Schema for validation)
  - Create `cron_config/llm_budget.yaml` (5 LLM crons entries)
  - Create `lib/quality_checks.js` (shared module)

- [ ] **Step 2: Termination manifest (1.1)** (~1.5hr)
  - Write `docs/loop_termination_manifest.md` (5 LLM full + 21 non-LLM light)
  - Implement `scripts/validate_manifest.js` (consistency checker)
  - Test: `node scripts/validate_manifest.js` should pass

- [ ] **Step 3: Token budget (1.2)** (~2hr)
  - Implement `lib/llm_budget.js` (3-layer enforcement: pre/post/timeout)
  - Edit `scripts/skill_reviewer_bot.js` (add budget check, line ~586-630)
  - Edit `scripts/memory_generator.js` (add budget check, line ~294-330)
  - Edit `scripts/daily_summary_bot.js` (add budget check, line ~180-220)
  - Edit `scripts/knowledge_ingester.js` (add budget check)
  - Edit `scripts/daily_synthesis.js` (add budget check)

- [ ] **Step 4: Recovery monitor (1.3 限縮版)** (~30min)
  - Implement `scripts/cron_recovery_monitor.js` (Tier A/B/C logic)
  - Add cron schedule (e.g. every 15 min) to invoke monitor
  - Test with simulated failures

- [ ] **Step 5: Git commit + tag** (~10min)
  - Commit all changes (one commit, multi-file)
  - Tag: `loop-engineering-phase-1-narrow-2026-06-XX`
  - Push to remote

- [ ] **Step 6: 7-day observation (Jun 18-25)** (~1hr setup + monitoring)
  - Create observation issue or use this one
  - Day 1/3/5/7 checkpoints
  - Closing criteria

- [ ] **Step 7: Rollback plan ready** (~15min)
  - Document revert commands
  - Test revert on local branch

## Closing Criteria (Day N 評分表)

```
✅ PASS: 0 false positives + all 4 quality tiers trigger correctly + 0 critical cost events + #152 baseline not regressed
🟡 PARTIAL: 1-2 false positives (fixable threshold tune) + cost stable
🟠 NEEDS MORE: 3+ false positives → adjust thresholds, 延 7 日
🔴 REGRESSION: Critical cost event (e.g. >$20/day anomaly) OR #152 baseline regression → 即時 rollback
```

## Rollback Plan

**Full revert (1 分鐘):**
```bash
git revert <loop-engineering-phase-1-narrow-commit-sha> --no-edit
git push
# All 7 new files + 5 edits reverted, crons return to pre-Phase-1 state
```

**Selective disable (5 分鐘):**
```bash
# Disable recovery monitor cron only
node scripts/cron disable cron_recovery_monitor

# Disable token budget check (revert lib/llm_budget.js)
git checkout HEAD~1 -- lib/llm_budget.js
# cron scripts 自動 fallback to no-budget mode (graceful degrade)
```

**Trigger conditions for rollback:**
- 連續 3 日無改善 (false positive 持續)
- 出現 critical cost event (>$20/day anomaly)
- #152 baseline regression (junk rate 上升 > 10%)
- New P0 bug discovered

## Notes

### Cross-references
- **#152** QW-1~5 觀察期（Jun 11-18）— Phase 1 唔影響 #152 baseline
- **#153** Ollama 觀察期（Jun 11-18）— Phase 1 唔影響 #153 baseline
- **QW-1~5** validator gate 互補 manifest quality checks
- **M3 deep analysis** `loop-engineering-analysis-2026-06-11.md`
- **M3 phase plan** `loop-engineering-phase1-plan-2026-06-11.md`
- **M3 manifest quality** `loop-engineering-manifest-quality-2026-06-11.md`
- **M2.7 SKILL** `skills-learned/loop-engineering-implementation/SKILL.md`

### Key insights
- **Defense in depth**: QW-1~5 = content quality (input); Manifest = execution quality (process); Token budget = cost cap (resource)
- **Karpathy 3 prereq**: File mod ✅ + Metric ✅ + Cost cap ❌ → Phase 1.2 fill the gap
- **3-dimension framework**: D1 execution (binary) + D2 quality (spectrum) + D3 failure (tiered)
- **All additive**: 0 lines removed, ~100 lines added, git revert-able in 1 min
- **Log-only first, enforce later**: Phase 1 collect data; Phase 2 add pause behavior

### Metrics to watch
- `.token_budget.jsonl` (new file, append-only)
- `.cron_failure.jsonl` (new file, for recovery monitor)
- `.skill_junk_rate.jsonl` (existing, #152 tracker — must NOT regress)
- Daily `cron_recovery_monitor.js` report (new)

### Related issues
- #152 (P1, due 2026-06-18) — QW-1~5 observation
- #153 (P1, due 2026-06-18) — Ollama migration observation
- Loop Engineering Phase 2 (deferred, post-Phase 1)

---

**Status:** Analysis complete, plan ready, awaiting Josh decisions (D1-D5) on 5 approval gates before implementation.
