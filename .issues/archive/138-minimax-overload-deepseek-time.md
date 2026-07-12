---
id: 138
title: MiniMax overload + deepseek timeout — cron provider reliability (final v3)
status: archive
priority: P1
created: 2026-06-07
due: 2026-06-14
updated: 2026-07-12
progress: 22/25
---

## TL;DR

**兩個 provider 都有 reliability 問題：**

| Provider | Failure mode | Rate |
|----------|-------------|------|
| **MiniMax-M3** | `overloaded_error`（server overload） | 104 次 (**83%**) |
| **deepseek-v4-flash** | `LLM request failed`（timeout @ 366-394s） | ~50% failure rate in evenings |

**冇 OpenClaw / scheduler / config bug。** 兩個 provider 嘅問題都係 provider-side。

**最終 config（全部 26 jobs）：** `deepseek-v4-flash` primary → `minimax-portal/MiniMax-M3` fallback

---

## 🏆 今晚重點發現

### Deepseek timeout pattern（Skill Reviewer, 6/7 晚間）

```
19:01 ❌ (394s) → 19:31 ❌ (366s) → 20:01 ❌ (366s) → 20:31 ✅ (36.5s)
21:01 ❌ (372s) → 21:31 ❌ (372s) → 22:01 ❌ (374s) → 22:31 ✅ (31.9s) → 23:01 ✅ (60.5s) → 23:31 ✅ (43.6s)
```

- **每次 3 連 fail 後就自然恢復**
- timeout 穩定 @366-394s（set 600s timeout 冇用 — 係 deepseek API call abort 咗，唔係 timeout）
- 加大 timeout 600→900s **冇幫助**（19:31 externalAbort: true, timedOut: false）
- 冇 clear time-of-day pattern—好似係 deepseek provider congest 咗

### Route-Enforcer × Cron: 🟢 NO IMPACT（5/5 confidence）

**Sub-agent source code deep dive 確認：**

```js
// route-enforcer/index.mjs L1
api.on("before_model_resolve", async (event, ctx) => {
  if (ctx?.trigger === "cron") return;   // ← 第一行 skip
});

api.on("before_prompt_build", async (event, ctx) => {
  if (ctx?.trigger === "cron") return;   // ← 第一行 skip
});
```

**三層 crash protection：**
1. Cron early return → plugin 完全 no-op
2. Harness try/catch → hook throw 都只 log
3. fail-open policy → `before_model_resolve` + `before_prompt_build` 預設 fail-open

**20:31 (enabled→✅) + 23:01 (re-enabled→✅) 都正常，confirm 唔關事。**

### replyToMode: off

- 之前 Discord 每條 reply 自動 quote 係 OpenClaw harness core `buildAssistantOutputDirectivesSection()` 嘅 directive
- Discord plugin 有 `channels.discord.replyToMode` config 可以熄
- 已改 `"off"` + restart

---

## 📊 Skill Reviewer 6/7 全日 timeline

| 時間 | Duration | Model | 結果 | 備註 |
|------|---------|-------|------|------|
| 10:00 | 200s | deepseek | ✅ Created cron-failure-investigation skill |
| 10:30 | 109s | deepseek | ✅ Queue empty | |
| 11:00 | 178s | deepseek | ✅ Rapaport skill created | |
| 11:30 | 166s | deepseek | ✅ | |
| 12:00 | 115s | deepseek | ✅ Updated rapaport-email-summary | |
| 12:30 | 174s | deepseek | ✅ | |
| 13:00 | 216s | deepseek | ✅ Created daily-synthesis | |
| 13:30 | 163s | deepseek | ✅ | |
| 14:00 | 201s | deepseek | ✅ | |
| 14:30 | 251s | deepseek | ✅ Created knowledge-curation-from-browser | |
| 15:01 | 103s | **MiniMax-M3** | ✅ (manual) Patched multi-session-resumption | |
| 15:31 | 182s | deepseek | ✅ Created cron-model-selection-verification | |
| 16:01 | 84s | deepseek | ✅ Patched 2 skills, pushed |
| 16:31 | 156s | **MiniMax→deepseek** | ✅ Created issue-conclusion-overturn-cleanup | MiniMax overload fallback |
| 17:01 | 46s | deepseek | ✅ Queue empty | |
| 17:31 | 84s | deepseek | ✅ | |
| 18:01 | 46s | deepseek | ✅ | |
| 18:31 | 46s | deepseek | ✅ | |
| **19:01** | **394s** | deepseek | **❌ LLM failed** | deepseek timeout |
| **19:31** | **366s** | deepseek | **❌ externalAbort** | |
| **20:01** | **366s** | deepseek | **❌ LLM failed** | |
| 20:31 | 36.5s | deepseek | ✅ Queue empty | Fast! |
| **21:01** | **372s** | deepseek | **❌ LLM failed** | |
| **21:31** | **372s** | deepseek | **❌ LLM failed** | |
| **22:01** | **374s** | deepseek | **❌ LLM failed** | |
| 22:31 | 31.9s | deepseek | ✅ | |
| 23:01 | 60.5s | deepseek | ✅ | |
| 23:31 | 43.6s | deepseek | ✅ | |

---

## ✅ 已做修復（2026-06-07）

### 1. Cron jobs 全部 deepseek primary（25/26 jobs）
`deepseek-v4-flash` primary + `minimax-portal/MiniMax-M3` fallback
- Skill Reviewer timeout 600s（900→600 rollback，加大冇用）

### 2. Mini-Curator 確認 exec-only（model field cosmetic）
- handleMiniCurator() 純 filesystem ops，零 LLM call
- Model 改 deepseek（純粹為 session resolve）

### 3. Route-enforcer re-enabled（confimed: NO cron impact）
- 14:15 test + 20:31 run + 23:01 run + source code → 5/5 confidence

### 4. replyToMode: off — Discord 自動 quoting 熄咗

### 5. Agent defaults model set to deepseek-v4-flash primary

## ✅ 已做修復（2026-06-08）

### 6. Skill Reviewer 重寫做 self-contained bot — Type A pattern

**問題：** Skill Reviewer 係 Type B pattern — cron agent (deepseek) exec skill_reviewer.js，然後 agent 自己 call LLM 分析 queue。Deepseek timeout 時成個 job fail，script 行完都冇用。

**解決：** 跟 daily_summary_bot.js 模式，重寫做 `skill_reviewer_bot.js`：
```
cron → agent → exec skill_reviewer_bot.js
                    └─ script 直接 openclaw infer model run --model M2.7
                    └─ parse LLM response → write files
                    └─ HTTPS POST → Discord #⚙️系統
```
- Agent 只係 thin executor：toolsAllow [exec]、thinking null
- LLM call 經 `openclaw infer` CLI，獨立 connection，唔經 agent internal routing
- Cron config 已更新：message→exec、thinking→null、toolsAllow→[exec]

**副作用：** 舊 agent 最終 run（02:02）臨死前成功創建 `model-migration-workflow` skill 記錄點解被取代。

### 7. Mini-Curator 改成 thin executor

- 確認 `handleMiniCurator()` 係純 filesystem ops（零 LLM call）
- Fail 嘅係 agent 要分析 output 決定用 message tool — Type B timeout
- 改做直接 exec + delivery announce → #⚙️系統自動收到 script output

### 8. Mini-Curator 併入 Daily Maintenance（05:00）

- 加落 `daily_maintenance.js` parallel phase 做第 3 個 job
- Mini-Curator standalone cron（02:00）已刪除
- 因為兩邊都係 pure executor，不再擔心 deepseek timeout

### 9. Daily Maintenance 都轉做 thin executor

- `daily_maintenance.js` 本身係 self-contained script（4 tasks），agent 只係 echo output
- 多餘 LLM call → 改 toolsAllow [exec]

### 10. Skill Reviewer prompt 加強 — 基於真實 audit

分析咗 skills-learned/ 全部 15 條 skill，發現：
- 13/15 係 draft，從未被 promote
- 多條係一次性 bug fix / 太窄 niche / 同 system skills 重疊
- 部分違反自己嘅「10 steps 上限」rule

加咗 4 條新 negative examples 入 REVIEW_INSTRUCTIONS：
- ❌ One-time incident skills（bug 已 fix = dead weight）
- ❌ Niche workflow no one will consult（太窄）
- ❌ Skills overlapping system skills（check skills/ 先）
- ❌ Thin cron-wrapper skills（48 lines 唔夠 workflow）

Self-audit checklist 亦加咗 3 項檢查：
- Not overlapping system skills
- Not a one-time incident
- Broad enough to be searched

---

## 📋 觀察期（6/8-6/14）

### 觀察中
- [ ] Skill Reviewer timeout pattern — 睇下 3連 fail 後恢復係 random 定每日特定時段
- [ ] CQM (10:00) — 之前 deepseek 3連 fail，觀察是否穩定
- [ ] AI HOT (12:00) — 之前 deepseek fail，觀察

### 待決定
- [ ] Evaluate local ollama/qwen3:14b 做 3rd fallback
- [ ] Skill Reviewer 頻率 30min→60min 減少 provider contention
- [ ] 是否要聯絡 MiniMax / deepseek support

---

## 🎓 教訓

1. **Logs lie by omission** — cron_run_logs.model = final model after fallback
2. **Investigation order** — 永遠先睇 session trajectory file (raw) → OpenClaw source code (ground truth)
3. **Provider failure 唔同** — MiniMax = overload（等恢復），deepseek = timeout（split context / add retry）
4. **加大 timeout 唔等於 fix** — 19:31 externalAbort: true, timedOut: false 證明
5. **Cron 同 route-enforcer 完全獨立** — source code confirm：「if trigger=cron return」
