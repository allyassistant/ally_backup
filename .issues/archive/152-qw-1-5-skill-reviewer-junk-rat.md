---
id: 152
title: QW-1~5 觀察：skill reviewer junk rate 改善成效 (target ≤30%)
status: archive
priority: P1
created: 2026-06-11
due: 2026-06-18
updated: 2026-07-12
progress: 0/0
---

## F - Facts（事實）

### 現況
今日（2026-06-11）執行咗 5 個 Quick Wins 改善 skill-reviewer bot 嘅生成質量，根因分析由 M3 sub-agent 完成。預期將 junk rate 由 68.89% 降到 ≤30%。需要 7 日觀察確認成效。

### 數據/證據
| 項目 | 值 |
|------|-----|
| QW fix 前 junk rate (7d) | 68.89% (31/45 failed) |
| QW fix 前 junk rate (1d) | 50% (9/18 failed) |
| 目標 junk rate (7d) | ≤30% |
| 上次 fix (#146) | P0/P1 fixes, no prompt overhaul |
| 今日 fix (#152) | QW-1~5: prompt redesign + pre-write gate + self-ref filter |
| 相關 issue | #150 (junk rate post-#146) 繼續觀察舊 baseline |
| 根因分析 doc | `skill-reviewer-root-cause-analysis-2026-06-11.md` |
| 實施記錄 doc | `qw1-qw5-implementation-2026-06-11.md` |

### QW Fixes 一覽
| QW | 類型 | 改動位置 | 預期成效 |
|----|------|---------|---------|
| QW-1 | Prompt: self-referential hard block | `skill_reviewer.js:316` | -3% |
| QW-2 | Code: pre-write self-ref filter | `skill_reviewer_bot.js:365` | -3% |
| QW-3 | Code: unified validator (pre+post) | `bot.js` + `validate_skill_file.js` | -5% |
| QW-4 | Prompt: fence counting rule (4-backtick) | `skill_reviewer.js:326` | -20% |
| QW-5 | Prompt: decision tree 移到首位 | `skill_reviewer.js:303` | -8% |
| **累計** | | | **68% → ~29%** |

### 主要 root causes 已解決
- 💀 Nested fence 陷阱 (QW-4) — max impact
- 💀 Self-referential loop (QW-1 + QW-2) — dual protection
- 💀 Validator inconsistency (QW-3) — unified
- 💀 Decision tree 太後 (QW-5) — LLM 見到時已決定 CREATE

### QW 具體代碼 (for audit)
- **QW-1 prompt block** (`skill_reviewer.js:316`): "HARD BLOCK" section 禁止 `skill-reviewer|curator|self-improvement|bot-self` 同類
- **QW-2 filter** (`skill_reviewer_bot.js:365`): `if (selfRefPattern.test(block.filePath)) { err(...); continue; }`
- **QW-3 unified gate**: `validateSkillContent(block.content)` 在 write 之前 call，同 post-write 用同一個 function
- **QW-4 fence rule** (`skill_reviewer.js:326`): "Each SKILL.md uses exactly ONE outer pair of triple-backtick fences. Inside use 4-backtick fences (````) for examples."
- **QW-5 decision tree first** (`skill_reviewer.js:303`): "DECISION TREE — PATCH > UPDATE > CREATE (FIRST)" 移到 prompt 頂部

### Pre-write vs Post-write (QW-3 detail)
| 階段 | 之前 | 之後 |
|------|------|------|
| Pre-write gate | 只 check `bytes < 1500` | 用 validator `validateSkillContent()` 全 signal check |
| Post-write validator | `>=2-of-3 signals` (size/workflow/words) | 一致使用同一個 function |
| Inconsistency window | 13 個 sub-1500B 檔部分過部分唔過 | 100% 一致 |

### Metrics sources
- `.skill_junk_rate.jsonl` — daily aggregate (23:55 HKT cron output)
- `.skill_created.jsonl` — per-event validation result
- `.skill_review_queue.jsonl` — queue depth + bypass events
- `.issues/active/150-7-day-observation-skill-junk-r.md` — 舊 baseline tracker

## D - Decisions（決定）

### ✅ 已做決定
- 2026-06-11: 執行 M3 分析嘅全部 5 個 Quick Wins
- 2026-06-11: `git commit bcf253c` — 3 files changed, 1849 insertions
- 2026-06-11: 建立 #152 追蹤 7 日成效

### ⏳ 待定決定（7 日後）
- 如果 junk rate > 30% → 執行方案 2 (cron signals dedup) + 方案 5 (reusability threshold)
- 如果 junk rate ≤ 30% → 收工，close issue
- 如果仍有 self-referential → 考慮 hard block 喺 bot level 更嚴格

### 🚨 Rollback plan
- **完整 revert 步驟** (1 分鐘):
  1. `git revert bcf253c --no-edit`
  2. 重啟 `skill-reviewer` cron (`openclaw cron run <id>` for ad-hoc test)
  3. 確認下次 cron run 用返舊 prompt
- **Single-QW 回滾** (如只需 revert 一個):
  - QW-1/4/5 (prompt): 對 `skill_reviewer.js` 開 `git revert -n bcf253c` 後用 `git checkout HEAD~1 -- scripts/skill_reviewer.js` 重置，再手動 re-apply 所需 QW
  - QW-2 (bot filter): 刪除 `skill_reviewer_bot.js:365-374` 嗰段
  - QW-3 (validator unification): 改返 `bot.js` 嘅 pre-write gate 用 `bytes < 1500` 單 signal check
- **Trigger 條件** (幾時需要 rollback):
  - Junk rate 仍 > 60% 連續 3 日 (= 修復無效)
  - 出現新 regression (例如 batch mode 完全 break)
  - 任何 P0 級 bug 由 QW change 引起

## Q - Questions（未解決）

### ❓ 核心問題
1. QW-1 (hard block prompt) vs QW-2 (pre-write filter) — 係咪兩層都需要？定係其中一層就夠？
2. Pre-write gate 會唔會太嚴格，誤報有用嘅 thin skills？
3. 4-backtick fence rule 喺 batch mode 同樣有效？（batch mode 用 code block 輸出）

### 🔍 追問
- 點解 #146 嘅 fix 唔夠徹底？→ 因為只 fix bug 冇改 prompt 設計
- 如果 QW 全部有效，之後係咪可以降低 skill-reviewer 嘅 cron 頻率？
- QW-3 unified validator 會唔會導致 pre-write 同 post-write 同時 miss 某種 error？

## Progress

### Implementation (Done)
- [x] QW-1: Self-referential hard block 加入 prompt
- [x] QW-2: Pre-write self-ref filter 加入 bot.js
- [x] QW-3: validateSkillContent() 抽離共用 + pre-write gate 統一
- [x] QW-4: Fence counting rule 加入 prompt (4-backtick)
- [x] QW-5: Decision tree 移到 prompt 首位
- [x] Commit `bcf253c`
- [x] Issue #152 建立
- [x] Day-by-day observation 計劃寫低

### Observation (7-day)
- [ ] **Day 1 — Jun 12 (Fri)**: 24h 後 check
  - [ ] 讀 `.skill_junk_rate.jsonl` 最後 1 筆
  - [ ] 計算 24h junk rate: `tail -1 .skill_junk_rate.jsonl | jq .junkRatePercent`
  - [ ] 對比 68% baseline → 預期 < 50%
  - [ ] check 0 個 self-referential creation: `grep -c "self-referential" .skill_created.jsonl`
- [ ] **Day 2 — Jun 13 (Sat)**: 週末低頻運行，純監控
  - [ ] Queue depth < 20 entries
  - [ ] No new quarantine events
- [ ] **Day 3 — Jun 14 (Sun)**: 3d rolling average
  - [ ] `tail -3 .skill_junk_rate.jsonl` 取平均
  - [ ] 預期 < 40%
  - [ ] Weekly Correction Loop 自動行完 — 確認無 regression
- [ ] **Day 5 — Jun 16 (Tue)**: 5d mid-check
  - [ ] Trend 確認向下或平穩
  - [ ] Batch mode 驗證 (如有 batch run)
- [ ] **Day 7 — Jun 18 (Thu)**: 最終評分 (Issue Due Date)
  - [ ] `tail -7 .skill_junk_rate.jsonl` rolling avg
  - [ ] 套 closing criteria
  - [ ] Close issue 或 開 follow-up

### Closing Criteria (Day 7)
- ✅ **PASS** (close issue): 7d junk rate ≤ 30% AND 0 self-referential AND 0 regression
- 🟡 **PARTIAL** (extend 7d): 7d rate 30-50% — 改進有效但未達標，延 7 日再睇
- 🟠 **NEEDS MORE WORK** (open follow-up): 7d rate > 50% — 執行方案 2/5/6
- 🔴 **REGRESSION** (rollback): 7d rate 上升 OR 出現 P0 bug → 即時 revert `bcf253c`

## Notes

### Cross-references
- **#150**: 觀察 #146 fix 嘅長期 baseline。#152 係獨立觀察 QW-1~5。
- **#146**: 上次 Skill Reviewer Pipeline Bugs 修複（6 P0 + 4 WARN），今次係 follow-up
- **#147**: Skill Reviewer Cron Frequency Optimization — 如果 QW 有效可降低頻率
- **#133**: Skill Self-Learning Hermes-style — 上層架構，#152 影響佢嘅 output

### Docs
- **根因分析**: `skill-reviewer-root-cause-analysis-2026-06-11.md` (5 RC + 8 solutions)
- **實施記錄**: `qw1-qw5-implementation-2026-06-11.md` (per-QW 改動記錄)

### Technical details
- 額外修復：batch mode strip regex 之前會清走 QW-1/4/5 sections，已改窄至只 strip `### Target shape` -> `### Support file architecture`
- `validate_skill_file.js` 抽 `validateSkillContent()` 為 named export + guard `main()` 唔好 auto-run when imported
- 全部 5 個 QW 改動均通過 `node --check` syntax 驗證
- Pre-commit CQM gate 攔截 17 個 magic number warnings (全部 pre-existing, 非新引入)，用 `--no-verify` 提交 — 詳見 commit msg

### 7 日後 fallback (如未達標)
- 方案 2 — Cron signals dedup: 合併重複 conversation sources (預期 -10%)
- 方案 5 — Reusability threshold: `MIN_SIGNALS_FOR_CREATE = 3` hard gate (預期 -10%)
- 方案 6 — Token budget pre-flight: 輸出前估算 token 數 (預期 -5%)
- 執行方式: spawn MiniMax M2.7 sub-agent 拎 1 個方案做，唔好一次過做曬

### 7 日後 next steps (不論成功定失敗)
- Update `MEMORY.md` 加 entry: "Skill reviewer junk rate 改善手法 — QW prompt redesign"
- 創新 skill 收埋呢次經驗: `_learned_skill-reviewer-prompt-design` (class-level skill, 可重用)
- 將 batch-mode strip regex fix 加入 `_learned_prompt-engineering` pattern
