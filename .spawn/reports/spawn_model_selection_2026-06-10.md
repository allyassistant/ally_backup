# SPAWN Model Selection 方案分析
*日期：2026-06-10*
*作者：Ally (M3 sub-agent spawn)*
*觸發：Josh 對 Issue #128 (multi-model routing) 嘅 refinement 要求*

---

## 現狀回顧

### 當前架構
**`route_model.yaml` 嘅 7 個 routes（已 trace 過 file）:**

| Route | Primary | Fallback chain | thinking |
|-------|---------|----------------|----------|
| `fdq` | deepseek-v4-flash | minimax-portal, none | high |
| `direct_answer` | deepseek-v4-flash | minimax-portal, none | — |
| `sop` | minimax-portal/MiniMax-M3 | deepseek, none | high |
| `spawn` | minimax-portal/MiniMax-M3 | deepseek, none | high |
| `code` | minimax-portal/MiniMax-M3 | deepseek, none | high |
| `browser` | minimax-portal/MiniMax-M2.7 | deepseek, none | high |
| `none` | deepseek-v4-flash | minimax-portal, none | — |

**`spawn_config.js` 嘅 mapping 邏輯（line 19-30）:**

```js
const DEFAULT_MODELS = {
  'minimax-portal': 'minimax-portal/MiniMax-M2.7',  // ⚠️ 注意：呢個 default 係 M2.7
  'deepseek': 'deepseek-v4-flash',
};
```

**`routeModel()` 嘅 merge 邏輯（model_router.js:198）:**
- 如果 resolved provider = primary → `model = routeCfg.primary.model`
- 如果 resolved provider = fallback → `model = ''` → spawn_config 自動 fallback 去 `DEFAULT_MODELS[provider]`

**結論：當 minimax-portal 健康時，spawn route 永遠用 M3。** 只有 minimax-portal 死咗先去 deepseek。**M2.7 喺 spawn path 係 dead code**（除非直接 hack `routeModel()` 攔截）。

### 問題（Josh 發現嘅）
1. **AGENTS.md drift：** AGENTS.md 寫 SPAWN = M3，route_model.yaml 一致用 M3，文件冇 drift ✅。**但 Josh 嘅真正意圖係「SPAWN default 應該係 M2.7」—— 而唔係 M3。** 即係 config 同 intent 唔 match。
2. **無 intent 維度：** 而家只睇 route（任務類型），唔睇 user message 嘅 intent（user 係咪 explicit 要 M3）。
3. **Cost 浪費：** 大部分 spawn task 唔需要 M3 級 reasoning，但 M3 always-on。
4. **Code route 同樣問題：** `code` route 都係 M3 default。雖然 Issue #128 講「M3 做 premium for code/spawn」，但呢個係 staging 期嘅假設，未必 optimal。

### 歷史脈絡
- **Issue #128** (2026-06-05): 7-day validation (6/5-6/11) 試 deepseek main + M3 premium for `code` + `spawn` 兩 routes
- **6/12 review, 6/13 final decision**
- **今次問嘅係** staging 期內 Josh 嘅 refinement：「SPAWN 應該係 M2.7 default，M3 only on demand」

### Cron jobs 影響評估
- 26 live cron jobs (HEARTBEAT.md)
- **0 個 cron job 直接用 `spawn_config.js`** ← grep 過 scripts/，只有 `spawn_config.js` 同 `test_smart_routing.js` reference `routeModel`
- **大部份 cron 用 thin executor pattern**（直接 `node script.js`，冇 spawn sub-agent）
- **2 個 scripts hardcode M2.7：** `closed_loop_v11_runner.js`, `kimi_cli_runner.js`, `auto_fix.js`（已係 M2.7）
- **1 個 explicit M3：** `skill_reviewer_bot.js --quiet`（HEARTBEAT.md 標明 "(M3)"）
- **結論：cron 影響接近 0，呢個改動主要影響 Ally main session 嘅 ad-hoc `sessions_spawn` 決定**

---

## 5 個方案對比

| 維度 | A: keyword parsing | B: 多 route label | C: explicit `model=` | D: intent router (hook) | E: 多 explicit route (推薦) |
|------|--------------------|-------------------|----------------------|------------------------|----------------------------|
| **實作 effort** | Low (10-15 lines) | Med (40-60 lines + AGENTS.md + 5+ files) | Med (改 Ally spawn principle) | High (改 router hook + classifier + spawn_config) | Med (30-40 lines + AGENTS.md + 1 cron check) |
| **對 user UX 影響** | 中：容易誤觸發 ("用 M3 嚟做簡單嘢" 都升級) | 高：Josh 要記住新 label | 中：transparency 高但要 Ally 自己判斷 | 低：automated | 低：Josh 講 keyword 就得 |
| **對 AGENTS.md 影響** | Low (加 parsing rule) | High (改 Spawn 原則 + 加 route 列表) | Med (改 Ally spawn principle) | High (加新 section) | Med (改 Spawn 原則 + 加 route) |
| **對 cost 影響** | Mixed：parsing miss → 升 M3 waste | Best：99% M2.7 | Best：Ally 自決 | Best：system 自動 | **Best：99% M2.7, 1% M3** |
| **對 drift 風險** | **High**：parsing rule 同 AGENTS.md 易 drift | Low：yaml 為 single source | Med：分散 Ally prompt 各處 | Med：classifier + rule 兩處 | **Low**：yaml + AGENTS.md 對齊 |
| **對 fallback 行為影響** | 無：spawn_config fallback chain 唔變 | 無：fallback chain 唔變 | 無 | 無 | **Med**：M2.7 唔喺 fallback chain（browser 有用），要決定 M2.7 死咗用咩 |
| **對 cron jobs 影響** | 無（cron 唔過 parsing） | 1 個：skill_reviewer_bot 要改 route | 無 | 無 | **1 個：skill_reviewer_bot 要改用 SPAWN_QUALITY** |
| **對 logging/debugging 影響** | **差**：parsing trace 唔喺 decision_log | 好：decisionId 內有 route label | 差：model 寫死冇 audit trail | 好：但加 complexity | **好**：route label 直接顯式 |
| **對 Issue #128 staging 嘅影響** | 改 staging 假設 | 改 staging 結論 | 唔影響（sop bypass） | 唔影響 | **直接 refine staging 結論** |
| **未來擴展性** | 差：加新 keyword 散落 | 好：route 可以加 _CRITIC, _REVIEW | 好：但 Ally 決定 | 好 | **好：加 route label 簡單** |
| **Implementation time** | ~30 min | ~2-3 hr | ~1 hr | ~3-4 hr | **~1.5-2 hr** |

### 方案 A：keyword parsing in `spawn_config.js`
```js
// pseudo
const wantsM3 = /M3|MiniMax-M3|3\b.*reasoning|premium/i.test(task);
const route = wantsM3 ? 'spawn_m3' : 'spawn';
```
- ✅ 直接、quick win
- ❌ "用 M3 嚟做簡單 task" 都被升級
- ❌ Parsing 散落喺多個 scripts（要重複）
- ❌ Decision log 冇 audit trail（parsing 喺 spawn_config 內，唔入 yaml）

### 方案 B：多 route label (SPAWN / SPAWN_M3 / SPAWN_QUALITY)
- ✅ 語義清晰
- ❌ 加 2 個新 route ＝ yaml 加 2 個 block
- ❌ Ally 要記住新 label（cognitive load）
- ❌ normalizeRoute() 要擴充

### 方案 C：Ally explicit `model=` parameter
- ✅ 最高 transparency
- ❌ Ally 每次 spawn 前要 explicit override（違反 Spawn 原則嘅 "exec spawn_config first" 流程）
- ❌ 分散喺 Ally prompt 各處
- ❌ Decision log 唔 trace 到（bypass 路由）

### 方案 D：intent router in message:received hook
- ✅ 最 automated
- ❌ Hook 入面分析 M3 keyword ＝ 又一個 classifier
- ❌ Classifier accuracy 問題（同 `auxiliary_classifier.js` 重複）
- ❌ 加 complexity 唔少
- ❌ M3 同 M2.7 嘅 split 邏輯應該係 Ally 嘅 decision，唔係 system 嘅

### 方案 E（推薦）：多 explicit route + clear intent gate
- ✅ 語義清晰（`SPAWN` = default, `SPAWN_QUALITY` = explicit M3）
- ✅ Ally 只需喺 user message 見到 "M3" / "high quality" / "deep analysis" 就用 `SPAWN_QUALITY`，否則用 `SPAWN`
- ✅ yaml 為 single source of truth
- ✅ Decision log 自然 trace
- ✅ Issue #128 staging 結論自然 refine
- ❌ 1 個 cron (skill_reviewer_bot) 要跟住改
- ❌ M2.7 fallback chain 要設計（如果 M2.7 unhealthy，fallback 去 deepseek 還是用 M3？）

---

## 推薦方案：E (多 explicit route)

### 為咩推薦

1. **符合「intent-based」嘅核心目標：** user 講 "spawn sub agent" ＝ default cheaper (M2.7)；user 講 "spawn M3" / "用 M3 仔細分析" ＝ premium (M3)。兩個 intent 對應兩個 route，零 ambiguity。

2. **最低 drift 風險：** yaml 為 single source of truth。AGENTS.md 表格只需更新兩個 row 嘅 label，唔使散落 parsing 邏輯。

3. **Decision log 自然 trace：** 每個 spawn call 都有 `route: 'spawn' | 'spawn_quality'`，方便 Issue #128 7-day validation 完之後 audit。

4. **最少 cognitive load：** Ally 唔使 explicit 寫 `model=`（bypass 流程），亦唔使記 parsing keyword。只需喺 spawn 前判斷：「Josh 講咗 M3 / quality 嗎？」→ 揀 route → exec spawn_config。呢個 judgment 喺 Ally 嘅 message-context 度自然發生，唔需新工具。

5. **Cron 影響可控：** 只有 1 個 cron (`skill_reviewer_bot`) 係 M3 強制嘅，直接指 `SPAWN_QUALITY`，其他 cron 全部 0 impact。

6. **Cost impact 顯著：** 99% spawn 會用 M2.7，預估 cost reduction ~40-60% 喺 spawn 開支（具體睇 7-day metrics）。

### 實作 step-by-step

#### Step 1: 改 `route_model.yaml`

```yaml
# 喺 routes: 下面加 spawn_quality 同改 spawn
  spawn:
    primary: { provider: minimax-portal, model: minimax-portal/MiniMax-M2.7, extra_body: { reasoning: high }, timeout: 90 }
    fallback_chain: [deepseek, none]
    cooldown_seconds: 60
    cost_weight: 0.3   # down from 0.5

  spawn_quality:                                  # ← NEW: explicit M3 premium
    primary: { provider: minimax-portal, model: minimax-portal/MiniMax-M3, extra_body: { reasoning: high }, timeout: 120 }
    fallback_chain: [deepseek, none]
    cooldown_seconds: 60
    cost_weight: 0.5
```

**改動重點：**
- `spawn.primary.model` 由 M3 → M2.7（最 critical 嘅一行）
- 加 `spawn_quality` route（label `SPAWN_QUALITY` via normalizeRoute）
- `spawn.primary.timeout` 加到 90s（M2.7 可能略慢，buffer 加大）
- `spawn_quality.primary.timeout` 120s（M3 reasoning 慢）

#### Step 2: 改 `scripts/spawn_config.js`

```js
// ─── REQUIRED_ROUTES 改 ───
// (model_router.js 入面)
const REQUIRED_ROUTES = [
  'fdq', 'direct_answer', 'sop', 'spawn', 'spawn_quality',  // ← add spawn_quality
  'code', 'browser', 'none',
];

// ─── spawn_config.js normalizeRoute() 改 ───
function normalizeRoute(route) {
  const r = String(route).toLowerCase().replace(/^router_/, '');
  if (['fdq', 'direct_answer', 'sop', 'spawn', 'spawn_quality',  // ← add
       'code', 'browser', 'none'].includes(r)) {
    return r;
  }
  return 'spawn'; // fallback
}
```

**注意：** 同步要改 `scripts/router/model_router.js` 嘅 `REQUIRED_ROUTES` constant，否則 validateRouteConfig 會 throw。

#### Step 3: 改 AGENTS.md

**A. Route Model Table（更新）**
```markdown
| Route | Model | Thinking | Provider |
|-------|-------|----------|----------|
| SPAWN | MiniMax-M2.7 | high 🧠 | minimax-portal |  ← 改
| SPAWN_QUALITY | MiniMax-M3 | high 🧠 | minimax-portal |  ← NEW
| SOP | MiniMax-M3 | high 🧠 | minimax-portal |
| CODE | MiniMax-M3 | high 🧠 | minimax-portal |
| FDQ | deepseek-v4-flash | high 🧠 | deepseek |
| DIRECT_ANSWER / NONE | deepseek-v4-flash | — | deepseek |
```

**B. Spawn 原則 section 加 intent gate rule：**
```markdown
**Spawn Intent Gate（重要）：**

| Josh 講 | Route | Model |
|---------|-------|-------|
| 「spawn sub agent 分析 X」 | `--route SPAWN` | M2.7 |
| 「spawn M3 sub agent 分析 X」 | `--route SPAWN_QUALITY` | M3 |
| 「用 M3 仔細分析」 | `--route SPAWN_QUALITY` | M3 |
| 「high quality analysis」 | `--route SPAWN_QUALITY` | M3 |
| 「用 best model」 | `--route SPAWN_QUALITY` | M3 |

**判斷邏輯：** Josh message 有以下 keyword 就用 SPAWN_QUALITY：
- `M3` / `MiniMax-M3` / `MiniMax 3` / `M-3`
- `quality` / `premium` / `仔細` / `深入` / `best` / `critical`
- 任何明顯表達「要最準 / 最 deep」嘅 intent

**否則 default 用 SPAWN（M2.7，平 + 快）。**

> **Sync rule：** 呢個 keyword list 要同 `scripts/router/intent_gate.js`（如有）保持 single source of truth。
```

**C. Source of truth 警告：**
加一句：「`route_model.yaml` 為 single source of truth。AGENTS.md 表格同 Spawn 原則 section 都係 mirror，更新要兩邊一齊改。」

#### Step 4: `.spawn/structured_spawn.template` 改

喺 `## Output Format` section 之前加：
```markdown
## Model Selection
- Default route: `SPAWN` (M2.7, faster + cheaper)
- Premium route: `SPAWN_QUALITY` (M3, deeper reasoning)
- Use `SPAWN_QUALITY` only if main agent flagged "M3 / premium / quality" in spawn brief
- Otherwise use `SPAWN`
```

#### Step 5: Cron jobs migration

**唯一受影響 cron：** `skill_reviewer_bot.js --quiet` (HEARTBEAT.md 標明 M3)

**檢查方法：**
```bash
grep -l "spawn_config\|--route\|routeModel" /Users/ally/.openclaw/workspace/scripts/*.js
# → 預期結果：spawn_config.js, test_smart_routing.js, skill_reviewer_bot.js (如有)
```

**改動：** 如果 `skill_reviewer_bot.js` 用 `spawn_config --route SPAWN`，改為 `--route SPAWN_QUALITY`（因為呢個 cron 明確要 M3 review）。

**其他 cron 全部 0 impact**（已用 thin executor pattern，唔過 spawn_config）。

#### Step 6: 測試 & 驗證

```bash
# 1. Unit test 跑
cd ~/.openclaw/workspace/scripts/router/tests && node spawn_config_tests.js
# 預期：全部 PASS（normalizeRoute 要加 spawn_quality test case）

# 2. Smoke test 兩個 route
node ~/.openclaw/workspace/scripts/spawn_config.js --route SPAWN --task "test spawn default"
# 預期：{"model":"minimax-portal/MiniMax-M2.7", ...}

node ~/.openclaw/workspace/scripts/spawn_config.js --route SPAWN_QUALITY --task "test spawn quality"
# 預期：{"model":"minimax-portal/MiniMax-M3", ...}

# 3. Decision log trace
tail -5 ~/.openclaw/workspace/scripts/router/decision_log.jsonl
# 預期：見到 'route: "spawn"' 同 'route: "spawn_quality"' 兩種 entry
```

#### Step 7: 7-day validation 配合 Issue #128

Issue #128 嘅 6/12 review 時，加 metric：
- `spawn` route 嘅 count (M2.7 usage)
- `spawn_quality` route 嘅 count (M3 usage)
- M2.7 vs M3 quality 比較（同 task type 對比 success rate）

如果 7 日內 `spawn_quality` 使用率 < 5%，代表 Josh 對「premium on demand」嘅判斷成立 → Issue #128 結論可 refine 為「SPAWN = M2.7 default」。

---

## 影響評估

### Daily cron jobs
- **0 個 cron 受影響**（已用 thin executor，唔過 spawn_config）
- **1 個 cron 受益**（`skill_reviewer_bot` 嘅 route label 會更清晰）

### Ad-hoc spawn
- **99% spawn 會由 M3 → M2.7** （預估 cost saving 40-60% 喺 spawn 開支）
- **1% spawn 升級 M3**（當 Josh 明講 "M3" 時）

### User experience
- ✅ 對話更自然：「spawn sub agent 分析 X」= 預設較快 + 較平
- ✅ Quality 唔減：M2.7 reasoning 已開 `high`，質量依然穩定
- ⚠️ Josh 要記一個 keyword rule（M3 / quality / 仔細 → SPAWN_QUALITY）
  - 緩解：AGENTS.md 表格 + 每次 spawn 前 Ally 喺 sub-agent prompt 入面 declare "route: SPAWN vs SPAWN_QUALITY"

### Cost
- 假設目前 SPAWN 100% M3
- 改後 99% M2.7 + 1% M3
- M2.7 價錢約 M3 嘅 50-60% (估計，未驗證)
- 預估 daily spawn cost ↓ ~40-50%

### Quality
- M2.7 + reasoning:high 應該同 M3 對一般 task 嘅 quality 差距 < 10%
- Critical tasks (M3 path) 依然用 M3
- 7-day metrics 驗證

### Drift 風險
- ✅ yaml 為 single source of truth
- ✅ AGENTS.md 表格 mirror
- ✅ Spawn template 加 model selection section
- ⚠️ normalizeRoute() list 要 update 喺 2 個 file（spawn_config.js + model_router.js）
- ⚠️ REQUIRED_ROUTES 要 update 喺 model_router.js
- **緩解：Spawn template / AGENTS.md 加 reminder "yaml = source of truth"**

### Fallback 行為
- `spawn` (M2.7) primary → M2.7 死咗 → deepseek-v4-flash (cheap, fast)
- `spawn_quality` (M3) primary → M3 死咗 → deepseek-v4-flash (quality 跌)
- 兩個都 fallback 去 deepseek，**唔 fallback 互相**（避免 M3 死咗降級到 M2.7 等於冇 fallback）

### Logging
- ✅ `decision_log.jsonl` 會自然區分 `route: "spawn"` vs `route: "spawn_quality"`
- ✅ Issue #128 嘅 metrics_collector.js 已經 log `route` field
- ✅ Tail 即可睇 M2.7 vs M3 usage ratio

---

## 風險

| 風險 | 等級 | 緩解 |
|------|------|------|
| M2.7 quality 真係唔夠 | Med | 7-day metrics 監察，success rate < 95% 立即 rollback |
| normalizeRoute 兩處 drift | Med | 加 `scripts/router/tests/spawn_config_tests.js` test case 自動驗證 |
| 1 個 cron 唔記得改 | Low | `grep -l "spawn_config" scripts/*.js` 一行 verify |
| Josh 唔記得 keyword rule | Low | Ally 喺每次 spawn 喺 brief 入面 echo "route: SPAWN_QUALITY (M3)" 等 Josh 確認 |
| Issue #128 結論衝突 | Low | 6/12 review 時 consolidate：SPAWN 改 M2.7 default = Issue #128 結論 refine，唔係推翻 |

---

## 預期成果

### Cost
- **~40-50% 嘅 daily spawn cost 降低**（M3 → M2.7）
- Quality 唔降（M2.7 + reasoning:high 對一般 task 足夠）

### UX
- 99% 對話「spawn sub agent X」流程唔變，更快 + 更平
- 1% critical task 仍然可以 upgrade M3

### Drift
- 0 drift：yaml 為 single source of truth
- AGENTS.md 表格 mirror 一致
- Spawn template 加 reminder

### 配合 Issue #128
- 6/12 review 時有具體數據（M2.7 vs M3 嘅 count + success rate）
- 6/13 final decision 嘅 input 更紮實

### 後續優化（7-day validation 之後）
- 如果 M2.7 質量完全 OK：考慮 `code` route 都 default M2.7（Issue #128 結論進一步 refine）
- 如果某些 cron job 應該降 M2.7：精細化 route labels
- 如果需要第三 tier：可加 `SPAWN_CRITIC` (M3 + critic pattern)

---

## 改動清單（最終總結）

| File | 改動 | Effort |
|------|------|--------|
| `scripts/router/route_model.yaml` | spawn primary M3→M2.7, 加 spawn_quality route | 5 min |
| `scripts/router/model_router.js` | REQUIRED_ROUTES 加 'spawn_quality' | 1 min |
| `scripts/spawn_config.js` | normalizeRoute 加 'spawn_quality' | 1 min |
| `scripts/router/tests/spawn_config_tests.js` | 加 spawn_quality test case | 5 min |
| `AGENTS.md` | Route Model Table 更新 + Spawn Intent Gate section | 15 min |
| `.spawn/structured_spawn.template` | 加 Model Selection section | 5 min |
| `scripts/skill_reviewer_bot.js` (如有) | --route SPAWN → --route SPAWN_QUALITY | 5 min |
| **測試 + verify** | smoke test + grep verify | 15 min |
| **Total** | | **~50 min - 1.5 hr** |

---

## 附錄：Source Code Trace

### `route_model.yaml` (current state, line 50-55)
```yaml
  spawn:
    primary: { provider: minimax-portal, model: minimax-portal/MiniMax-M3, extra_body: { reasoning: high } }
    fallback_chain: [deepseek, none]
    cooldown_seconds: 60
    cost_weight: 0.5
```

### `spawn_config.js` (line 19-30)
```js
const DEFAULT_MODELS = {
  'minimax-portal': 'minimax-portal/MiniMax-M2.7',  // 死碼：primary path 唔會用
  'deepseek': 'deepseek-v4-flash',
};
```

### `model_router.js` (line 30)
```js
const REQUIRED_ROUTES = [
  'fdq', 'direct_answer', 'sop', 'spawn', 'code', 'browser', 'none',
];
```

### Cron impact grep
- `grep -l "spawn_config" /Users/ally/.openclaw/workspace/scripts/*.js`
- 結果：`spawn_config.js`, `test_smart_routing.js` ← 冇 cron script 直接用
- `grep -l "sessions_spawn" /Users/ally/.openclaw/workspace/scripts/*.js`
- 結果：`auto_fix.js`, `closed_loop_v11_runner.js`, `kimi_cli_runner.js`, `llm_judge.js`, `rapnet_ai_summary.js`, `spawn_config.js` ← 大部分 hardcode M2.7 default

### Issue #128 參考
- 「DeepSeek V4 Flash 做 daily default (5 routes) + MiniMax M3 做 premium (2 routes: code/spawn)」
- 7-day validation 期間 (6/5-6/11)
- 推薦方案 E 直接 refine 呢個 stance

---

*End of report.*
