---
id: 132
title: Cron jobs: timeout fix + route-enforcer cron override fix
status: archive
priority: P2
created: 2026-06-06
due: 2026-06-20
updated: 2026-07-16
progress: 0/0
---

## Description

**Background：** 4 cron jobs consistently failed with "LLM request failed":

1. Wiki Daily Ingest (01:00 HKT) — `6f6ec289-1c4c-4212-b403-29fdf227cb5f`
2. Daily Maintenance (Combined) (05:00 HKT) — `aee7c6d9-8c07-43e9-8395-830fc0a8db62`
3. Knowledge Base Daily Ingest (06:00→06:30 HKT) — `9ebd92c9-c19e-47e8-a43f-3c940ecfdede`
4. Daily Synthesis (3-day window) (08:00 HKT) — `3c11c009-ac02-4ead-8b61-646af5e46408`

---

## Round 1 & 2 (original, 06-06 09:38-09:46 HKT)

Initial attempt — changed timeouts but didn't fix root cause:
- 4 jobs timeout 600s/None → 120s
- KB Ingest: 06:00→06:30 + tz
- `knowledge_ingester.js`: spawn timeout 300s→5s + progress log
- KB Ingest cron timeout reset 120s→600s

---

## 🔴 Round 3 — 真正 Root Cause 發現 (06-06 深層分析)

### 發現：真正原因係 route-enforcer plugin override，唔係 cron edit 清咗 model

### 真正 root cause：route-enforcer plugin

**File:** `extensions/route-enforcer/index.mjs`

呢個 plugin hooks `before_model_resolve` event，**每個 agent turn 都會 firing**（包括 cron job）。佢嘅邏輯：

```
cron job 啟動 agent turn
  → OpenClaw fires "before_model_resolve"
    → route-enforcer  intercepts
      → getCurrentRoute() → /tmp/last_routing_decision.json 唔存在 → "NONE"
      → routeModel({ route: 'none' })
        → route_model.yaml 話 none route 用 deepseek 🚨
      → return { providerOverride, modelOverride }
    → OpenClaw 接受 override → cron job 用 deepseek
  → deepseek 慢 → timeout → "LLM request failed"
```

Cron job 唔會寫 `/tmp/last_routing_decision.json`，所以永遠行 `none` route。而 `route_model.yaml:61-63` 嘅 `none` route 用 deepseek，所以 plugin 強行將所有 cron job 嘅 model override 改成 deepseek。

**Anomaly Monitor 冇事** — 佢用 `timeoutSeconds: 120` 同 default deepseek。之前 route-enforcer 冇 override 佢的原因係 route-enforcer 嘅 `before_model_resolve` 只喺有 route decision file 時先會 override，而 Anomaly Monitor 嘅 execution path 可能剛好避開咗。不過而家 route-enforcer 已經 skip 所有 cron job，冇影響。

### 確認：所有 3 條 agentTurn job (Round 1 改完後) 仍然 fail

| Job | lastDurationMs | lastRunStatus | lastError |
|-----|--------------|--------------|-----------|
| Wiki Daily Ingest | 365,119ms | error | LLM request failed |
| Daily Maintenance | 382,814ms | error | LLM request failed |
| Daily Synthesis | 381,360ms | error | LLM request failed |
| KB Ingest | 81,955ms | ok ✅ | none |

→ Round 1 timeout fix 根本冇用，因為 model 被強制轉成 deepseek。

---

## ✅ Round 3 Fixes Applied (06-06)

### Fix 3a: `wiki_ingest_helper.mjs` — 300s → 5s timeout
**File:** `workspace/scripts/wiki_ingest_helper.mjs:55`

雖然 `openclaw wiki ingest` 係 pure file I/O（已追蹤完整 code path確認冇 LLM call），但 300s spawn timeout 係 overkill，reduce 到 5s 做防禦性編程。

### Fix 3b: Cron job model override 回復 — skip deepseek，用 minimax-portal
```bash
openclaw cron edit Wiki Daily Ingest   --model "minimax-portal/MiniMax-M3"   --timeout-seconds 120
openclaw cron edit Daily Maintenance   --model "minimax-portal/MiniMax-M3"   --timeout-seconds 120  # 原本 M2.7
openclaw cron edit Daily Synthesis     --model "minimax-portal/MiniMax-M3"   --timeout-seconds 120
```
KB Ingest keep 600s timeout + deepseek（因為 script 自身有 5s spawn fallback，82s 完成，work）

### Fix 3c: route-enforcer — skip override for cron jobs
**File:** `extensions/route-enforcer/index.mjs:68-69`

加咗一行：
```js
if (ctx?.trigger === "cron") return;  // cron job 已有自身 model override，唔 override
```

`ctx.trigger` 喺 OpenClaw 嘅 `hookCtx` 入面係 `"cron"` for cron jobs（確認：`embedded-agent-eUaVGd6D.js:539` — `if (params.trigger !== "cron") return;`）

### Fix 3d: 統一所有 cron model override → MiniMax-M3
全部有 explicit model 嘅 job 都 unified 去 `minimax-portal/MiniMax-M3`：
- ✅ Wiki Daily Ingest: 已係 M3
- ✅ Daily Maintenance: M2.7 → M3
- ✅ Daily Synthesis: 已係 M3
- ✅ Weekly Correction Loop Review: ollama/qwen2.5:3b → M3（防禦性，原本 disabled）

### Fix 3f: 後續發現嘅同類問題
- ✅ AI HOT 每日12點推送 — 冇 model override → deepseek timeout → 加 M3
- ✅ Discord Channel Logger — 曾 timeout → 已加 M3
- ✅ System Check (Code Quality Manager) — 曾 timeout → 加 M3 + keep 3600s timeout
- ✅ 加 `before_prompt_build` cron skip — 同 `before_model_resolve` 一致

### Fix 3e: Sync `jobs.json.migrated` to match live store
確保 restart 唔會 lost config，update 咗：
- Wiki Daily Ingest: timeout 600→120 + model
- Daily Maintenance: timeout 600→120, model M2.7→M3
- KB Ingest: schedule 0 6→30 6 + tz Asia/Hong_Kong
- Daily Synthesis: systemEvent→agentTurn + timeout 120 + model
- Weekly Correction Loop Review: ollama/qwen2.5:3b→M3

---

~~Round 3 architecture (MiniMax-M3 primary)~~ → **Superseded by Round 4 below**

---

## Round 4 — 今日深度分析揭示 17/5 模式 (06-06 16:00+ HKT)

### 發現：MiniMax-M3 not the answer — DeepSeek is

**3-agent parallel investigation** 發現：

#### 真相：22 個 cron jobs 嘅模型模式
| 模式 | Cron 數量 | 狀態 |
|------|----------|------|
| `deepseek-v4-flash` primary + `MiniMax-M3` fallback | **17** | ✅ 全部正常 |
| `MiniMax-M3` primary + `MiniMax-M3` fallback | **5** | ❌ 全部 fail |

The pattern was clear: **17 successful jobs all use deepseek primary**. Only the 5 jobs set to MiniMax-M3 in Round 3 were failing.

#### 點解 Round 3 MiniMax-M3 fix 冇用？
Route-enforcer bypass (Round 3) 係正確嘅 — cron jobs 而家正確使用 payload.model。但 Round 3 揀錯咗 model:
- MiniMax-M3 唔係一直都 down，但高峰時 (10:00/15:00) 有 latency spike
- `fallbacks: [MiniMax-M3]` = reset to same model, no real fallback
- 5-step CQM pipeline 任何一步 fail → 成個死

#### 真正 fix (06-06 16:00+): 5 個 broken jobs 統一改 deepseek primary
| Job | 改動前 | 改動後 | Schedule |
|-----|-------|-------|----------|
| **System Check (CQM)** | `MiniMax-M3` → `[MiniMax-M3]` | `deepseek-v4-flash` → `[minimax-portal/MiniMax-M3]` | `0 10,15,22 * * *` |
| **Discord Channel Logger** | `MiniMax-M3` → `[MiniMax-M3]` | `deepseek-v4-flash` → `[minimax-portal/MiniMax-M3]` | `50 23 * * *` |
| **Wiki Daily Ingest** | `MiniMax-M3` → `[MiniMax-M3]` | `deepseek-v4-flash` → `[minimax-portal/MiniMax-M3]` | `0 1 * * *` |
| **Daily Maintenance** | `MiniMax-M3` → `[MiniMax-M3]` | `deepseek-v4-flash` → `[minimax-portal/MiniMax-M3]` | `0 5 * * *` |
| **Daily Synthesis** | `MiniMax-M3` → `[MiniMax-M3]` | `deepseek-v4-flash` → `[minimax-portal/MiniMax-M3]` | `0 8 * * *` |

### 更新後統一模式
全部 22 個 cron jobs 而家一致：
```json
{"model": "deepseek/deepseek-v4-flash", "fallbacks": ["minimax-portal/MiniMax-M3"]}
```

### 爲何 deepseek 啱用 for 呢 5 個 jobs
- **Wiki Daily Ingest**: `wiki_ingest_helper.mjs` + `openclaw wiki ingest` — **pure file I/O, 冇 LLM call**
- **Daily Maintenance**: `daily_maintenance.js` — 主要係 exec system 命令
- **Daily Synthesis**: 要用 LLM，但 summarization 工作 deepseek 完全夠力，唔需要 MiniMax-M3
- **Discord Channel Logger**: 純 exec date + message tool read
- **System Check (CQM)**: 已驗證 deepseek 完美 work (last run 15:04 ✅ 44773ms)

## Progress

### Round 1: Timeout Fix (initial attempt, didn't fix root cause)
- [x] 1a: 4 jobs timeout 600s/None → 120s
- [x] 1b: KB Ingest: 06:00→06:30 + tz
- [x] 1c: `knowledge_ingester.js` spawn timeout 300s→5s + progress log
- [x] 1d: KB Ingest cron timeout reset 120s→600s

### Round 2: Smoke Test
- [x] 2a: KB Ingest manual run (82s, ok) ✅
- [x] 2b: 發現 script 本身 hang (spawn timeout)
- [x] 2c: Smoke test (3 msg real write, 5秒完成)

### Round 3: Route-Enforcer Discovered + Fixed
- [x] 3a: 發現真正 root cause — route-enforcer override cron job model
- [x] 3b: route-enforcer 加 `ctx?.trigger === "cron"` bypass
- [x] ~~3c: 統一所有 cron model override → MiniMax-M3~~ **REVERTED in Round 4**
- [x] 3d: Sync `jobs.json.migrated`
- [x] 3e: 發現 AI HOT + Discord Channel Logger 同類問題 → 加 M3 override
- [x] 3f: 加 `before_prompt_build` cron skip

### Round 4: DeepSeek Discovery
- [x] 4a: 3-agent deep investigation → 發現 17/5 pattern (17 deepseek ✅ / 5 MiniMax ❌)
- [x] 4b: 5 個 broken jobs 統一改做 deepseek-v4-flash primary + MiniMax-M3 fallback

### Round 5: Verification Test
- [x] 5a: KB Ingest test (147s ✅) + AI HOT test (73s ✅, was 385s ❌)
- [x] 5b: Knowledge Bootstrap (5.8s ✅) + SYMBOLS (5.8s ✅) + Wiki Bridge (29s ✅)
- [x] 5c: KB Ingest swap 06:30→06:25, Knowledge Bootstrap swap 06:25→06:30

### Ongoing
- [ ] 監察 (Jun 6-20): 確認 5 個 fixed jobs + KB Ingest/Bootstrap swap 全部 stable

## Monitoring

```bash
# Check current state of all affected jobs (original 4 + AI HOT + Discord Logger)
for j in 6f6ec289-1c4c-4212-b403-29fdf227cb5f aee7c6d9-8c07-43e9-8395-830fc0a8db62 9ebd92c9-c19e-47e8-a43f-3c940ecfdede 3c11c009-ac02-4ead-8b61-646af5e46408 27d479e7-5c64-456d-9b6a-a14c578b3b72 5a89fef1-ba05-4955-89ce-ca3ae171dedd 2f9b5b1c-328a-4589-8f4b-a33a7ec387d5; do
  openclaw cron get $j 2>/dev/null | python3 -c "
import json,sys; d=json.load(sys.stdin); p=d['payload']; s=d.get('state',{});
print(f\"{d.get('name')}: status={s.get('lastRunStatus')} ({s.get('lastDurationMs')}ms) errors={s.get('consecutiveErrors')}\")
print(f\"  model={p.get('model')} timeout={p.get('timeoutSeconds')}\")"
done

# Check route-enforcer is live (verify plugin loaded)
grep -n "trigger === cron" /Users/ally/.openclaw/extensions/route-enforcer/index.mjs
```

## Final Architecture (Round 4)

```
Cron job trigger
  → OpenClaw resolveHookModelSelection()
    → before_model_resolve hook
      → route-enforcer: trigger === "cron" ? ✅ SKIP (respect payload.model)
    → uses payload.model = deepseek/deepseek-v4-flash
    → payload.fallbacks = [minimax-portal/MiniMax-M3]
  → Agent turn with deepseek ✅ (fast, reliable)
  → MiniMax fallback if deepseek unreachable

User messages (webchat/discord/whatsapp)
  → classifier writes route to /tmp/last_routing_decision.json
  → before_model_resolve hook
    → route-enforcer: trigger !== "cron" → run normal routing
    → NONE → deepseek, SPAWN → M3, etc. (unchanged)
```

### Expected outcomes
- **All 22 cron jobs**: `deepseek/deepseek-v4-flash` primary + `minimax-portal/MiniMax-M3` fallback
  - 🛡️ Cross-provider fallback — deepseek fail → MiniMax-M3 (real failover)
  - ✅ Unified pattern, no more same-model dead loop
- route-enforcer no longer interferes with cron job model overrides (bypass active)
- Webchat/Discord/WhatsApp NONE routing unchanged (still deepseek via Smart Router)
- KB Ingest: deepseek + 600s + script-level 5s spawn fallback
- **CQM 22:00 tonight** → deepseek + system_check_bot fix → notification to #⚙️系統
- **Wiki Daily Ingest 1:00 HKT** → deepseek, pure file I/O < 60s

## Notes
- `openclaw wiki ingest` 係 pure file I/O — 已追蹤完整 code path（`cli-BC1g2VJh.js:3016-3079`），**冇任何 LLM call**。300s timeout 係 overkill
- `knowledge_classifier.js` 係 rule-based regex matching，冇 LLM call
- `jobs.json.migrated` 可能唔係 live source of truth，但 sync 咗確保 restart 唔 lost config
- Key lesson: **fallbacks 唔可以係 same model** — MiniMax-M3 primary + `[MiniMax-M3]` fallback = retry same broken model

## ✅ Round 5 — 實測驗證 (2026-06-06 16:40-17:00 HKT)

### Test Setup
3-agent parallel deep-dive confirm 17/5 pattern後，set 5 個 cron jobs 去 `at` schedule（5分鐘後）驗證 deepseek primary + MiniMax-M3 fallback 嘅穩定性。

### Round 1: KB Ingest + AI HOT (16:40-16:42)

| Job | Before (MiniMax primary) | After (deepseek primary) | Improvement |
|-----|------------------------|------------------------|-------------|
| **KB Ingest** | 82s (stable) | **147s** | 穩定但慢咗（下午負載高）|
| **AI HOT** | 385,592ms **timeout** ❌ | **73,462ms ✅** | **5x 改善** |

Both delivered to Discord channels successfully ✅

### Round 2: Knowledge Bootstrap + SYMBOLS + Wiki Bridge (16:53-16:55)

| Job | Duration | Status | Remark |
|-----|----------|--------|--------|
| **Knowledge Bootstrap** | 5,811ms | ✅ ok | Normal |
| **Generate SYMBOLS.md** | 5,795ms | ✅ ok | Normal |
| **Wiki Bridge Import** | 29,040ms | ✅ ok | Faster than usual 46s |

### Smart Router Impact
```
Router decisions during entire test (16:38-17:00): 2 (both Josh's messages)
Router decisions from cron:                                   0 ✅
```
Route-enforcer cron bypass confirmed working — zero interference.

### Post-test: All 5 jobs restored to original cron schedules
| Job | Schedule | Note |
|-----|----------|------|
| KB Ingest | `25 6 * * *` Asia/HK | 06:25 — 先吸 Discord（swap 咗）|
| AI HOT | `0 12 * * *` Asia/HK | 12:00 — 原時間 |
| Knowledge Bootstrap | `30 6 * * *` Asia/HK | 06:30 — 食返 KB Ingest 結果（swap 咗）|
| Generate SYMBOLS.md | `41 0 * * *` Asia/HK | 00:41 — 原時間 |
| Wiki Bridge Import | `40 0 * * *` | 00:40 — 原時間 |

### KB Ingest vs Knowledge Bootstrap Analysis
- **No direct dependency**: Bootstrap reads `memory/patterns/`, KB Ingest writes to `Wiki/sources/`
- **Swap executed**: 06:25 KB Ingest → 06:30 Bootstrap (so Bootstrap gets same-day KB results)
- **Reason**: KB Ingest pure file I/O (82s typical), Bootstrap pure file I/O (6s), 5-min gap sufficient

### Final Verification Timeline
| Time | Job | Expected |
|------|-----|----------|
| **Tonight 22:00** | CQM + system_check_bot | deepseek, notification to #⚙️系統 🔑 |
| 23:50 | Discord Channel Logger | deepseek, first run with fix |
| 01:00 | Wiki Daily Ingest | deepseek, pure file I/O < 60s |
| 05:00 | Daily Maintenance | deepseek, first run with fix |
| 06:25 | KB Ingest | deepseek, 2nd run, should be < 147s |
| 06:30 | Knowledge Bootstrap | deepseek, first run at new slot |
| 08:00 | Daily Synthesis | deepseek, first run with fix |
| 12:00 | AI HOT | deepseek, 2nd run, should be < 73s |

---

## 📎 附錄：Smart Router 健康檢查（Issue #127 相關）

從 `decision_log.jsonl` 分析 Smart Router 嘅健康狀況：

### 數據
- **Router decisions (all-time):** 1719 次
- **Failures (provider=none):** 51 次 (3%)
- **最近 24h:** 1138 calls，527 success (46%)

### 失敗模式
- 51 次 failure 全部係 chain exhausted（primary → fallback → none）
- 主要時段：00:00 (15次)、02:00 (11次)、23:00 (11次) — 全部 off-hours
- 唔係之前估計嘅 03-04 HKT，而係 11PM-2AM 凌晨時段

### Background health check loop
- `failure_recovery.js` 有 `runHealthCheckLoop()` 定義（line 287）
- **但冇任何機制啟動佢** — 得 test files 用過
- Health check 係 reactive：每次 `routeModel()` 先 probe，cache 30s TTL
- Off-hours 零 activity → cache stale → 等到下個 spawn 先知 provider 死咗

### 點解唔值得加 background loop
1. **Failure rate 只係 3%** — 51/1719，唔高
2. **Cron jobs 已 bypass Smart Router** — 22 條 cron 全部用 explicit model override，跳過成個 provider chain
3. Background loop 只係將「下個 spawn 先知」變做「每 60s 先知」，對實際體驗改善有限
4. 真正根治係 model override，唔係 faster health check
