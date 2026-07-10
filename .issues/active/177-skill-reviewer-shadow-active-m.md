---
id: 177
title: Skill Reviewer: Shadow → Active Mode Readiness
status: active
priority: P2
created: 2026-06-22
due: 2026-07-13
updated: 2026-06-22
progress: 0/7
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

### Cron Job Config (2026-06-22)

| Cron | ID | Schedule | Session | Model | Status |
|------|-----|---------|---------|-------|--------|
| Skill Reviewer (30min) | `56e09616-50a3-45c2-89eb-d8c427c56191` | `*/30 * * * *` @ Asia/Hong_Kong | isolated | deepseek-v4-flash | ✅ running |
| Skill Junk Rate Tracker (daily 23:55) | `91208a00-49c3-45e7-9fad-173a20582632` | `55 23 * * *` | isolated | deepseek-v4-flash | ✅ running |
| Skill Reviewer Daily Report (daily 23:56) | `63093fb7-237a-4a5f-9a2e-e3187e443bd1` | `56 23 * * *` | isolated | deepseek-v4-flash | ✅ running |

**Migration history：** 6/10 由 `systemEvent+main` 轉 `agentTurn+isolated`（command kind），根治 main session 💓/👍 殘留。

### Pipeline 內部兩道 LLM Gate

| Gate | Env | 行為 | Live state |
|------|-----|------|------------|
| **LLM Judge (M3 advisory)** | `SHADOW_MODE=true` OR `SKILL_LLM_JUDGE_ACTIVE=true` | M3 對 quarantined skills 評審 + override | ✅ M3 24/7 run緊 (cursor line 265/265 done) |
| **Junk pause (LLM Override)** | `llmOverrideActive=true` (json 寫死) | Junk rate 過 15% 自動 pause | ✅ 生效（junk rate 9.1% < 15% target） |

### Live Data — 過去 7 日 Junk Rate 趨勢（截至 2026-06-21）

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

- [x] **Step 1: Audit shadow mode internals** (2026-06-22) — pipeline code review + 7d data analysis
- [x] **Step 2: Open tracking issue** (#177) (2026-06-22) — establish baseline
- [ ] **Step 3: Daily monitoring** (2026-06-22 → 2026-06-29) — 觀察 junk rate trend 7 日 consecutive
- [ ] **Step 4: M3 override analysis** (2026-06-29) — 5.9% → check root cause (heuristic vs M3)
- [ ] **Step 5: LLM Judge pilot** (2026-07-05) — flip `.llm_judge_active.json` for 7 days
- [ ] **Step 6: Full active mode decision** (2026-07-12) — based on Step 3-5 results
- [ ] **Step 7: Cleanup / rollback** (2026-07-13) — flip `SHADOW_MODE=false` or rollback

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
