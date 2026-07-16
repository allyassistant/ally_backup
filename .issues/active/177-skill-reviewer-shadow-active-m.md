---
id: 177
title: Skill Reviewer: Shadow → Active Mode Readiness + Dedup Quality System
status: active
priority: P2
created: 2026-06-22
due: 2026-07-25
updated: 2026-07-16
progress: 2/6
merged_from: [#187]
---

## F - Facts（事實）

### Shadow Mode 機制（2026-06-22 audit）

**`scripts/skill_reviewer_pipeline.js` 內部 3 個 gate：**
```javascript
// Line 86-91 — Main health check
if (process.env.SHADOW_MODE === 'true') return false;        // gate 1: review 唔改 state
if (process.env.PIPELINE_FORCE_EXIT_OK === 'true') return false;
if (!reviewerOk) return true;
if (!shouldSkipJunkPause() && !junkOk) return true;            // gate 2: junk pause
if (!shouldSkipPitfallsFallback() && !pitfallsOk) return true;
return false;

// Line 127 — LLM Judge gate
if (process.env.SHADOW_MODE === 'true' || process.env.SKILL_LLM_JUDGE_ACTIVE === 'true') {
  // M3 對 quarantined skills 評審
}
```

**`SHADOW_MODE=true` 觸發兩件事：**
1. `return false` 喺 main health check，pipeline 永遠 exit 0
2. Line 127: **啟用 LLM Judge** (SHADOW_MODE / SKILL_LLM_JUDGE_ACTIVE 任一 = true 就行)
3. Line 287: pass `shadowMode: true` 落 sub-agent，log only 唔好做實 action

### Cron Job Config (2026-07-16 update)

| Cron | ID | Schedule | Session | Model | Status |
|------|-----|---------|---------|-------|--------|
| Skill Reviewer (30min) | `56e09616-50a3-45c2-89eb-d8c427c56191` | `*/30 * * * *` @ Asia/Hong_Kong | isolated | none | ✅ ok |
| Skill Junk Rate Tracker (daily 23:55) | `91208a00-49c3-45e7-9fad-173a20582632` | `55 23 * * *` | isolated | none | ✅ ok |
| Skill Reviewer Daily Report (daily 9:00) | `5ed354ef-54ec-4dd0-aa1d-6dd57bed4528` | `0 9 * * *` | isolated | **none (cleared)** | ✅ ok (fixed 7/16) |

**7/16 fix:** Daily Report cron previously timed out because `model: deepseek-v4-flash` was set but `skill_reviewer_daily_report.js` exits before model call completes → 120s timeout. Fix: `--clear-model` so it uses default fallback chain.

**Migration history：** 6/10 由 `systemEvent+main` 轉 `agentTurn+isolated`（command kind），根治 main session 💓/👍 殘留。

### 兩層 Dedup Threshold 架構（from #187, merged 2026-07-16）

| Layer | Variable | File:Line | Default | Current |
|------|----------|-----------|---------|---------|
| Bot-side | `BOT_DEDUP_THRESHOLD` | `skill_reviewer_bot.js:54` | 0.85 | **0.80** (changed 7/16) |
| Gate-side | `DEFAULT_THRESHOLD` | `skill_dedup_gate.js:35` | 0.85 | 0.85 |

**Effective = 0.80**：bot passes `BOT_DEDUP_THRESHOLD` to gate on every call, overriding gate default.

**兩套 Dedup 系統：**
| System | Trigger | Telemetry |
|--------|---------|-----------|
| Post-LLM dedup | After LLM writes | `.skill_reviewer_post_llm_dedup.jsonl` ✅ |
| Cross-source dedup | Before LLM writes | **NONE ❌** — Phase 1.1 to fix |

**Phase 1 Goal**：Add `.skill_reviewer_cross_source_dedup.jsonl` telemetry + LLM feedback on strict skip.

**Stale claim correction (2026-07-16)**：Issue #187 originally claimed `DEFAULT_THRESHOLD` was raised to 0.92 in `skill_dedup_gate.js` — this never happened. The value remains 0.85. The actual change today was `BOT_DEDUP_THRESHOLD` bot-side 0.85 → 0.80.

### Pipeline 內部兩道 LLM Gate

| Gate | Env | 行為 | Live state |
|------|-----|------|------------|
| **LLM Judge (M3 advisory)** | `SHADOW_MODE=true` OR `SKILL_LLM_JUDGE_ACTIVE=true` | M3 對 quarantined skills 評審 + override | ✅ M3 24/7 run緊 (cursor line 265/265 done) |
| **Junk pause (LLM Override)** | `llmOverrideActive=true` (json 寫死) | Junk rate 過 15% 自動 pause | ✅ 生效（junk rate 9.1% < 15% target） |

### Live Data — 過去 7 日 Junk Rate 趨勢（截至 2026-07-16）

| Date | Junk% | Prod% | Notes |
|------|-------|-------|-------|
| 6/21 | 9.1% ✅ | 2.6% ✅ | First day under target |
| 7/12 | 47.54% ❌ | 25% ❌ | Tracker bug / threshold issue |
| **7/16** | **47.54%** | **26.67%** | **Current (7d window)** |
| **7/16** | **0%** | **50%** | **Current (1d window)** |

**7/16 重大修復：**
- Dedup threshold: `0.85 → 0.80` (`skill_reviewer_bot.js` line 54)
- 預期效果：`simplified-chinese-detector` (sim~0.84), `webbridge-youtube-analysis` 等 borderline skills 將不再被誤 quarantine
- Junk-in-Production 仍然偏高（26.67%），需要持續觀察 threshold 0.80 效果

### Live State 關鍵指標（截至 2026-07-16）

| Signal | Current | Source |
|--------|---------|--------|
| Active `_learned_*` skills (symlinks) | 41 | ls skills/_learned_* |
| Dedup threshold | **0.80** (was 0.85) | skill_reviewer_bot.js:54 |
| Junk rate 7d (7/16) | 47.54% ❌ | `.skill_junk_rate.jsonl` |
| Junk rate 1d (7/16) | 0% ✅ | `.skill_junk_rate.jsonl` |
| Junk-in-Production 7d | 26.67% ❌ | `.skill_junk_rate.jsonl` |
| Junk-in-Production 1d | 50% ❌ | `.skill_junk_rate.jsonl` |
| Frozen state | None ✅ | `.skill_reviewer_pause.frozen` deleted |
| Cron errors (30min) | 0 ✅ | cron list |
| Cron errors (Daily Report) | ✅ Fixed (4x timeout resolved 7/16) | cron list |

### 2026-07-16 重啟觀察期 — 新發現

#### ✅ 已修復
1. **Dedup threshold 0.80** — `BOT_DEDUP_THRESHOLD` default 從 0.85 降至 0.80
   - 原因：`smart-router-classifier-debugging`, `webbridge-youtube-analysis`, `simplified-chinese-detector` 呢 3 個 borderline skills (sim 0.84-0.85) 被反覆誤 quarantine
   - 預期：threshold 0.80 之後呢 3 個 skill 會正常通過
2. **Daily Report cron timeout** — cron payload 移除 `model: deepseek-v4-flash`，不再 timeout
3. **Active symlinks 41** — 乾淨狀態

#### ⚠️ 仍需觀察
1. **Junk-in-Production 7d = 26.67%** — 仍然超標（target <10%），需要 7 日觀察新 threshold 效果
2. **Junk rate 7d = 47.54%** — 數值異常高，可能受 tracker 計算方式影響
3. **Junk rate 1d = 0%** — 今日數據係乾淨，新 threshold 可能已生效

#### 📊 重啟觀察期 checklist（至 7/25）
- [ ] Day 1 check (7/17): junk rate 1d 是否維持 <10%？
- [ ] Day 3 check (7/19): junk rate 7d 是否有改善？
- [ ] Day 5 check (7/21): 確認 threshold 0.80 是否穩定，Prod% 是否下降
- [ ] Day 7 check (7/23): Full closing criteria 評估

### Closing Criteria（維持不變，至 2026-07-25 評估）

```
✅ PASS: 7d junk rate ≤ 10% 連續 7d AND Prod% ≤ 10% AND 0 false negative
🟡 PARTIAL: 7d junk rate ≤ 10% but Prod% > 10% → 繼續觀察
🟠 NEEDS MORE: 7d junk rate 10-15% → 繼續觀察 7 more days
🔴 REGRESSION: 7d junk rate > 15% OR >1 false negative → 即時 rollback dedup threshold
```

### Update 2026-07-16 — 重啟觀察期

**原因：** Threshold 0.80 patch (7/16) 需要時間見效，cron timeout 已修，junk-in-production 仍超標。重啟 7 日觀察期至 7/25。

**現況：**
- Frozen: ✅ 已解除 | LLM Judge: ✅ active | Dedup: ✅ 0.80 (今日改) | Cron errors: ✅ 已修
- Junk rate 7d: ❌ 47.54% | Junk-in-Production 7d: ❌ 26.67%

**預期：** 新 threshold 0.80 運行 7 日後，Junk-in-Production 應降至 <10%

---

### Previous Updates（2026-07-12 → 2026-06-22）

| Date | Total | Pass | Fail | **Junk%** | **Prod%** | Quar | LLM Override |
|------|-------|------|------|-----------|-----------|------|---------------|
| 6/15 | 164 | 119 | 45 | 27.4% 🔴 | 11.5% | 6 | ❌ |
| 6/16 | 167 | 122 | 45 | 26.9% 🔴 | 11.5% | 6 | ❌ |
| 6/18 | 166 | 144 | 22 | 13.2% 🟡 | 19.2% | 10 | ❌ |
| 6/19 | 157 | 140 | 17 | 10.8% 🟡 | 17.0% | 8 | ❌ |
| 6/19 | 157 | 140 | 17 | 10.8% 🟡 | **2.1%** ✅ | 1 | ✅ **active** |
| 6/20 | 132 | 118 | 14 | 10.6% 🟡 | **5.1%** ✅ | 2 | ✅ |
| **6/21** | 121 | 110 | 11 | **9.1% ✅** | **2.6%** ✅ | 1 | ✅ |

**Target = 10%。** 6/21 第一日低過 target。

### Live State 關鍵指標

| Signal | Current | Source |
|--------|---------|--------|
| Active `_learned_*` skills (symlinks) | 31 | HEARTBEAT.md #162 |
| Quarantine archive (`skills/_archive/quarantine-2026-06-10/`) | 10 files | 6/10 cleanup |
| Failed-validation quarantined | 0 | HEARTBEAT.md |
| M3 advisory log | 18+ entries, 24h activity: 30 entries | `.skill_m3_advisory.jsonl` |
| M3 cursor (last line idx) | 265/265 done | `.skill_m3_advisory_cursor.json` |
| LLM override agreement rate | 5.9% (61 approvals) | `.skill_m3_advisory_warn_state.json` |
| Junk rate 7d (6/21) | 9.1% | `.skill_junk_rate.jsonl` |
| Junk in production 7d (6/21) | 2.6% | `.skill_junk_rate.jsonl` |
| Frozen state | `.skill_reviewer_pause.frozen` active since 6/13 | ls |
| Quarantined (1d window 6/21) | 1 file: `context-overflow-workflow-loop-recovery` | `.skill_junk_rate.jsonl` |
| Cron consecutive errors | 0 for all 3 skill reviewer crons | openclaw cron list |

### 啟用 Active Mode 嘅實際行動

**Step A — 開 `SKILL_LLM_JUDGE_ACTIVE=true`：**
1. 由 cron spec 改 env：`.llm_judge_active.json` 已經存在 (6/18 12:41)
2. Pipeline line 116-119 自動 read file，唔使改 code
3. **但要手動 verify file contents**（避免 stale config）

**Step B — 開 `SHADOW_MODE=false`：**
1. 改 cron spec 入面 `SHADOW_MODE=true` → `false`
2. Pipeline line 86 `if (process.env.SHADOW_MODE === 'true') return false;` 會失效
3. Reviewer 可以實際 quarantine / archive skills
4. **Risk：** heuristic 可能 over-aggressive quarantine（見下面 LLM override agreement 偏低）

**Step C — 移除 `.skill_reviewer_pause.frozen`：**
1. 永久刪除（唔係 `node skill_reviewer_resume.js`，呢個係 pause gate）
2. Frozen state 確保 active mode 唔會立即 trigger 大量 quarantine

## D - Decisions（決定）

### ✅ 已做決定

- **2026-06-22 決定**：開呢個 issue (#177) 追蹤 active mode readiness（之前冇 explicit tracking，靠每次 audit 即時討論）
- **2026-06-22 決定**：Target = `junk rate 7d ≤ 10%` 連續 7 日 = 第一個 gate
- **2026-06-22 決定**：唔好 1-day pass 就 flip，wait 7-day consecutive

### ⏳ 待做決定

- **2026-06-28 之後**：7-day consecutive 7d ≤ 10% 是否達成？
  - 達 → 開 Step A (啟用 LLM judge active) pilot 7 日
  - 唔達 → 繼續觀察，記低 why failed
- **2026-07-05 之後**：LLM judge pilot 結果
  - M3 override rate 有冇改善？ (現在 5.9% 偏低)
  - False negative 出現過未？ (即係漏 quarantine 嘅 junk)
- **2026-07-12 之後**：full active mode decision
  - 全部 criterion pass → flip `SHADOW_MODE=false`
  - 有任一 fail → 繼續 pilot / rollback

## Q - Questions（未解決）

### ❓ 核心問題

1. **LLM override agreement 5.9% 太低** — 係 heuristic 過 aggressive，定 M3 過 conservative？
   - **M3 advisory 30 entries/day 但 override 只有 5.9%** — 即係 94% 嘅 quarantine M3 唔 rescue
   - 解釋 A：heuristic 抓真垃圾（好事）
   - 解釋 B：M3 過 cautious 唔敢 override（壞事，會 over-quarantine）
   - 解釋 C：M3 prompt 唔夠 clear 點為「override」
2. **1d window 8.9% 但 7d 9.1% — 點解唔同？** 7d tainted 問題 (#171 跟進) 影響呢個 issue 點 measure？
3. **Frozen state 維持 9 日 (6/13→6/22) — active mode 一開會唔會立即觸發大量 quarantine？**
4. **`.llm_judge_active.json` 已經存在 4 日 (6/18)，但無實際 side effect** — 點解？pipeline 仲係等 `SHADOW_MODE=true` 行 step 0?
5. **Active mode 後，cron LLM request fail 嘅 pattern (每 2-3 次 ok 夾 1 次 fail) 會唔會擴大？** 因為 active mode 會觸發更多 action
6. **3 個 skill reviewer cron (30min / daily 23:55 / daily 23:56) 嘅 active mode 設定要唔要分開？** 定全部跟同一個 flag？

### 🔍 觀察 checklist (closing criteria 之前要答)

- [ ] 連續 7 日 junk rate 7d ≤ 10%？
- [ ] Junk in production 7d ≤ 10%？ (現在 2.6% ✅)
- [ ] M3 override rate 上升？ 由 5.9% 改善
- [ ] Frozen state 期間冇新 issue？
- [ ] `.llm_judge_active.json` 內容 review 過 (stale config check)？
- [ ] 3 個 cron 連續 0 error 過 7 日？

## Progress

### Phase 1: Foundation — Dedup Quality System (from #187)
- [ ] **Phase 1.1**: Add cross-source telemetry — create `.skill_reviewer_cross_source_dedup.jsonl` writer in `skill_reviewer_bot.js`
  - Schema: `{ts, proposed_name, proposed_desc_hash, matched_skill, similarity, mode, outcome}`
  - Mirror post-LLM dedup format for consistency
  - Status: NOT done — blocked by Phase 1.2
- [ ] **Phase 1.2**: Add LLM feedback injection on strict skip — modify `skill_reviewer_bot.js:1603-1606` to push tool-call result
  - Mirror post-LLM dedup behavior (L1462+ area)
  - Reference: bot already has pattern for tool-call result injection
  - Status: NOT done — prerequisite for Phase 3 observation

### Phase 2: Stuck Loop Fix ✅ DONE
- [x] **Phase 2.1**: Identified `wrapper-fs-safe-write` stuck loop (53 matches vs `node-fs-enoent-debugging`)
- [x] **Phase 2.2**: Confirmed genuinely distinct skill (false positive at 0.85)
- [x] **Phase 2.3**: Resolved by promoting to active + archiving stale proposals
  - ✅ `wrapper-fs-safe-write/SKILL.md` written (95 lines, active)
  - ✅ Quarantine archive removed
  - ✅ Backlog 39 stale proposals archived (36 fsSync + 3 magic_numbers)

### Phase 3: Observation — Junk Rate + Dedup Quality (merged)
- [ ] **Phase 3.1**: 7 日 daily monitoring (2026-07-16 → 7/23) — junk rate trend with threshold 0.80
- [ ] **Phase 3.2**: 14 日 cross-source telemetry observation (after Phase 1 ships)
- [ ] **Phase 3.3**: M3 override rate analysis — check if > 30% (baseline 5.9%)
- [ ] **Phase 3.4**: Calculate cross-source FP rate from new telemetry

### Phase 4: Full Active Mode Decision
- [ ] **Phase 4.1**: If FP rate < 5% → re-evaluate strict enablement
- [ ] **Phase 4.2**: If FP rate 5-15% → tune threshold first
- [ ] **Phase 4.3**: If FP rate > 15% → keep warn mode, deeper algorithm review
- [ ] **Phase 4.4**: Decision — flip `SHADOW_MODE=false` if all criteria met

### Phase 5: Cleanup / Rollback
- [ ] **Phase 5.1**: If all criteria pass → flip `SHADOW_MODE=false` (full active mode)
- [ ] **Phase 5.2**: If regression → rollback plan (flip `SHADOW_MODE=true` + re-freeze)

### Closing Criteria

```
✅ PASS: 7d junk rate ≤ 10% 連續 7d
              AND Junk-in-Production ≤ 10%
              AND cross-source telemetry shipped + LLM feedback working
              AND M3 override rate > 30% OR ≥ 2 false negatives resolved
🟡 PARTIAL: ≥2 Phase items done + no regression
🟠 NEEDS MORE: telemetry shipped but observation < 7d
🔴 REGRESSION: telemetry write impacts bot perf > 10% OR junk rate > 15%
```

### Rollback Plan
- Telemetry write: `SKILL_REVIEWER_CROSS_SOURCE_TELEMETRY_DISABLED=1` (kill switch)
- LLM feedback injection: git revert single commit
- Threshold tuning: `SKILL_REVIEWER_BOT_THRESHOLD=0.85` (revert to pre-0.80)

## Notes

### Cross-References

- **Parent:** #162 Skill Pipeline Master Issue (archived 2026-06-22)
- **Sibling:** #170 M3 Advisory W2 Warning Mode (cron wiring pending)
- **Sibling:** #171 Junk Rate 7d Methodology Recalibration
- **Sibling:** #176 Anomaly Monitor cron (archived 2026-06-22)
- **Sibling:** #147 Skill Reviewer Cron Frequency (archived 2026-06-22, rolled into #162)

### Code Locations

- `scripts/skill_reviewer_pipeline.js` (line 86-91 health check, line 116-127 LLM judge gate, line 287 shadow mode pass-through)
- `scripts/skill_reviewer_bot.js`
- `scripts/skill_junk_tracker.js` (writes `.skill_junk_rate.jsonl`)
- `scripts/skill_junk_pause.js` (auto-pause if junk rate > 15%)
- `scripts/skill_reviewer_resume.js` (clears pause)

### State Files

- `.skill_junk_rate.jsonl` (daily measurement)
- `.skill_m3_advisory.jsonl` (M3 advisory log)
- `.skill_m3_advisory_cursor.json` (lastLineIdx=265)
- `.skill_m3_advisory_warn_state.json` (lastWarnedAt + agreement rate)
- `.skill_reviewer_pause.frozen` (auto-pause flag, 6/13 still active)
- `.llm_judge_active.json` (LLM judge enable, 6/18 12:41 created)
- `skills/_archive/quarantine-2026-06-10/` (10 quarantined files)

### Daily Check Commands

```bash
# Junk rate (1d / 7d / 14d / 30d)
tail -4 .skill_junk_rate.jsonl | python3 -c "
import json, sys
for l in sys.stdin:
    d = json.loads(l)
    print(f\"{d['ts'][:10]} w={d['windowDays']}d junk={d['junkRatePercent']}% prod={d['junkInProductionRate']}% llmOv={d.get('llmOverrideActive',False)}\")
"

# M3 advisory 24h count
grep "$(date -u -v-1d +%Y-%m-%dT%H:%M)" .skill_m3_advisory.jsonl | wc -l

# Cron consecutive errors
openclaw cron list | grep -i "skill reviewer"

# Frozen state check
ls -la .skill_reviewer_pause.frozen 2>/dev/null && echo "FROZEN ACTIVE" || echo "no freeze"

# LLM judge active file
cat .llm_judge_active.json
```

### Active Mode Rollback Plan

**If active mode 觸發問題：**
1. 即時 flip `SHADOW_MODE=true` 喺 cron spec (3 個 cron 全部)
2. 檢查 `.skill_reviewer_pause.frozen` — 應該 24h 內 auto-create
3. 檢查 `.skill_*` state files 有冇 corruption
4. 記低 issue 入 #177 Notes

**Time to rollback：** ~5 min (3 cron spec changes + restart)

### Closing Criteria

```
✅ PASS: 7d junk rate ≤ 10% 連續 7d AND M3 override rate > 30% AND 0 false negative
🟡 PARTIAL: 7d junk rate ≤ 10% but M3 override rate < 10% → Step 5 repeat
🟠 NEEDS MORE: 7d junk rate 10-15% → continue observation 7 more days
🔴 REGRESSION: 7d junk rate > 15% OR >1 false negative → 即時 rollback
```

### Future Maintenance

Active mode 開咗之後：
- Daily check junk rate ≤ 10% (cron auto-pause if > 15%)
- Weekly check M3 override rate trend
- Monthly re-evaluate `.llm_judge_active.json` config
- Quarterly skill pipeline health audit (per #162 嘅 master issue 指引)

#### 2026-07-12 調查結果

#### Frozen State 已解除
- `.skill_reviewer_pause.frozen` 已刪除（自 6/13 存在 29 日）

#### Stale Symlinks 已清理
移除 7 個 quarantined-but-active symlinks：
- `_learned_loop-engineering-implementation`
- `_learned_smart-router-classifier-debugging`
- `_learned_daily-synthesis`
- `_learned_cron-health-triage`
- `_learned_anomaly-proactive-push`
- `_learned_rapaport-email-summary`
- `_learned_webbridge-youtube-analysis`

#### Validator 分析結果

**Dedup 系統正常運作 ✅**
- Cosine similarity threshold = 0.85
- 大多數重複 skills 被 skip（sim=0.88-0.97）

**問題：Threshold 太接近邊界**
- `smart-router-classifier-debugging` sim=0.848-0.851 浮動
- 有時 above 0.85 (skip)，有時 below 0.85 (patch)
- 導致漏網之魚

**7 日 Metrics（截至今日）：**
| 指標 | 數值 | Target |
|------|------|--------|
| Validator Catch Rate | 94.93% ✅ | ≥25% |
| Junk-in-Production | 25% ❌ | <10% |
| Total events | 355 | — |
| Passed | 18 | — |
| Quarantined | 3 | — |

**結論：** Validator 本身冇問題，但 threshold 0.85 係 borderline decision point

#### Decision: 繼續觀察
- 決定：唔改 threshold，先觀察多幾日
- 原因：樣本太少（只有 18 passed skills），需要更多數據
- 下次 check：2026-07-15 或 2026-07-19

#### 跟進命令
```bash
# 7-day metrics
node scripts/skill_junk_tracker.js --days 7

# 1-day metrics
node scripts/skill_junk_tracker.js --days 1

# Active symlinks count
ls skills/_learned_* | wc -l
```

### Update 2026-07-12 晚 — 繼續觀察決定

#### 7 日 Metrics（2026-07-12）
| 指標 | 數值 | 目標 |
|------|------|------|
| Validator Catch Rate | 95.00% ✅ | ≥25% |
| Junk-in-Production | 25% ❌ | <10% |
| Total events | 360 | — |
| Passed | 18 | — |
| Quarantined | 3 | — |

#### Passed-but-Quarantined（3 個）
- `smart-router-classifier-debugging` — sim=0.848，低於 0.85
- `webbridge-youtube-analysis` — sim=0.848，低於 0.85
- `simplified-chinese-detector` — 未知原因

#### Decision: 繼續觀察
- 決定：暫時唔調整 dedup threshold（0.85）
- 原因：樣本少（18 passed），需要更多數據確認趨勢
- 建議：可考慮降低 threshold 到 0.80，但等樣本增加再決定

#### 下次 Check
- 2026-07-15 或 2026-07-19
