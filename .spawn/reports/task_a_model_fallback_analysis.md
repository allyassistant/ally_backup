# Task A: Smart Router Model Fallback 訊息抑制分析

**Author:** Ally (sub-agent)
**Date:** 2026-06-07
**Scope:** Read-only analysis · 冇 modify core SDK / cron / route_model.yaml / plugin logic

---

## 1. 源頭追蹤 (Source Tracing)

### 1.1 Emit 邏輯確實位置

| 項目 | 詳情 |
|------|------|
| **Emit 字串模板** | `agent-runner.runtime-CCReftdY.js:146` |
| **構建函數** | `buildFallbackNotice(params)` — 同一文件 line 142-149 |
| **決策函數** | `resolveFallbackTransition(params)` — 同一文件 line 154-194 |
| **實際 push 到 output** | `agent-runner.runtime-CCReftdY.js:3665-3678` (transitioned) + line 3687-3701 (cleared) |
| **Payload metadata flag** | `isFallbackNotice: true` (line 3677, 3700) — 重要：呢個 flag 已經存在 |
| **Schema references** | `runtime-schema-CoGt090u.js:1738, 1740, 1742, 1745, 1748, 1750, 1754` — 全部都係 `agents.defaults.*.fallbacks` config 名，**冇** fallback notice suppression flag |

### 1.2 Emit 流程

```
1. agent run 完成
2. resolveConfiguredFallbackModel()  [line 2746] → 拎 selectedProvider/Model
3. resolveFallbackTransition()       [line 3558] → 計 fallbackActive / fallbackTransitioned
4. 如果 fallbackTransitioned === true (line 3662)：
   a. emitAgentEvent()  → 寫 lifecycle event (內部, 唔直接見 user)
   b. buildFallbackNotice()  → 組 message string
   c. push 入 fallbackNoticePayloads，標記 isFallbackNotice: true
5. 最後將 fallbackNoticePayloads + 正常 payload 合併送出 (line 3710)
```

### 1.3 點解會 emit (Trigger 條件)

**`fallbackTransitioned` 嘅 boolean** (line 164)：
```js
const fallbackActive = !areRuntimeModelRefsEquivalent(selectedModelRef, activeModelRef, comparisonOptions);
const fallbackTransitioned = fallbackActive && (
  previousState.selectedModel !== selectedModelRef ||
  previousState.activeModel !== activeModelRef
);
```

**即係：**
- `fallbackActive` = selected model 同 active model **唔等價**（即 fallback chain 揀咗第二個）
- `fallbackTransitioned` = fallback active **AND** session state 記住嘅 pair 同當前 pair **唔同**

**所以：**
- 如果 session state 已經 persist 咗 `selectedModel=deepseek/deepseek-v4-flash, activeModel=minimax-portal/MiniMax-M3`，**呢個 turn 唔應該 re-emit**
- 如果 `previousState` 空 (新 session / state 冇 persist 落去) → **必然 re-emit 每 turn**

### 1.4 點解 deepseek 揀唔到 (真正原因)

**睇 `route_model.yaml`**：
```yaml
fdq:
  primary: { provider: deepseek, model: deepseek-v4-flash, ... }
  fallback_chain: [minimax-portal, none]   # ← 揀唔到 deepseek 就 fallback 去 MiniMax-M3
```

**呢個唔係 bug — 係 design。** 個 fallback chain 故意咁樣設：
- primary: deepseek (想慳錢，deepseek 平)
- fallback: minimax-portal (保證有回應)
- chain 尾: none (terminate)

**`deepseek` health check fail** 嘅常見原因（從 `route-enforcer/index.mjs` 行為推斷）：
- DeepSeek API 唔穩定 / rate limit
- `routeModel()` 喺 `before_model_resolve` hook 拎 decision 嘅瞬間，deepseek health 仍然 healthy
- 但實際 `modelUsed = runResult.meta?.agentMeta?.model` 出嚟係 minimax-portal → 即係 OpenClaw 內部 model selection 揀咗 fallback
- **Race condition** 喺 `route-enforcer` 同 OpenClaw internal selector 之間：plugin 改咗 override，但 OpenClaw 後續 step 仍然 trigger 一次 fallback

更精確：睇 `agent-runner.runtime-CCReftdY.js:3549-3556`：
```js
const configuredFallbackModel = resolveConfiguredFallbackModel({
  run: followupRun.run,
  fallbackStateEntry
});
const selectedProvider = configuredFallbackModel.provider;  // = 原本 requested 嘅 model
const selectedModel = configuredFallbackModel.model;        // = deepseek/deepseek-v4-flash
```
→ `selectedModel` 永遠係「原本想用」嘅 model（route-enforcer 揀嘅 deepseek）
→ `activeModel` (`modelUsed`) 係「最終用咗」嘅 model（OpenClaw 內部 fallback chain 揀嘅 minimax-portal）

**如果兩者唔等價 = fallback chain 真係 trigger 咗 = notice emit**

### 1.5 點解 re-emit (同一個 pair 重複出現)

**結論：** `route-enforcer` 嘅 `clean model override` 唔會 prevent 呢個 notice。原因：

1. **Plugin 改 `ctx.modelProviderId` / `ctx.modelId` 喺 `before_model_resolve`** — 但呢個只係「建議」
2. **OpenClaw 內部 model selector 仍然 run `agents.defaults.model.fallbacks` chain**
3. 如果 plugin 寫入 `ctx.modelProviderId = "deepseek"` 但 OpenClaw 內部 health check 覺得 deepseek unhealthy → 跳去 minimax-portal
4. → `selectedModel = deepseek/deepseek-v4-flash` (plugin's intent)
5. → `activeModel = minimax-portal/MiniMax-M3` (actual)
6. → `areRuntimeModelRefsEquivalent` 唔等 → notice emit

**Session state persistence 問題：** 就算兩次 turn pair 完全一樣，如果：
- 每次 spawn 開新 session（sessionKey 唔同）
- 或者 session store patch 失敗 (e.g. disk full, race with another writer)
- → `previousState` 空 → `fallbackTransitioned === true` → re-emit

---

## 2. 現有 Workaround 評估

### 2.1 Config flag
- ❌ **冇 `hide_model_fallback` / `silent_fallback` / 同類 config**
- ✅ **唯一接近**：`agents.defaults.compaction.notifyUser: false` — 但只 control compaction notice，唔影響 fallback
- ✅ Schema 入面只有 `agents.defaults.model.fallbacks` (ordered list) 同 `agents.defaults.model.primary`

### 2.2 `markReplyPayloadForSourceSuppressionDelivery` 機制

`reply-payload-DM17pxMC.js:66-68`：
```js
function markReplyPayloadForSourceSuppressionDelivery(payload) {
  return setReplyPayloadMetadata(payload, { deliverDespiteSourceReplySuppression: true });
}
```

呢個 function **係相反方向** — 佢令 payload 喺 `sourceReplySuppression` 環境下都會送出去。**唔可以**用嚟 suppress fallback notice。

### 2.3 `isReplyPayloadStatusNotice` 識別

`reply-payload-DM17pxMC.js:69-71`：
```js
function isReplyPayloadStatusNotice(payload) {
  return Boolean(payload.isCompactionNotice || payload.isFallbackNotice || payload.isStatusNotice);
}
```

呢個 function 已經**正確識別** fallback notice 為 "status notice"。但係：
- 喺 `dispatch-Bgs9vXV4.js:210` 同 `dispatch-acp-vZW9Bvce.js:469` 用嚟做**早 return**（避免 duplicate processing），**唔係用嚟 suppress 輸出**
- 喺 `block-reply-pipeline-CvF-ruBJ.js:64, 108-112, 175, 249` 用嚟 control **buffer 合併**（避免 status notice 同 normal text 合併）— 純粹視覺處理

→ **冇任何現有 path 會 drop 個 payload**。fallback notice 一旦 push 入 `fallbackNoticePayloads`，就會**必然**送出去。

### 2.4 Plugin-level interception

OpenClaw 嘅 plugin hook system 冇 `before_reply_deliver` 類嘅 hook 讓 plugin 過濾最終 output。Plugin hooks 只有：
- `before_model_resolve` (改 model selection)
- `before_prompt_build` (改 system prompt)
- `before_agent_run` / `after_agent_run` (lifecycle，但 output 已 send 出)

→ **冇中間層 hook 可以 filter 最終 user-visible reply**

---

## 3. 可行 Solution 提案

| 方案 | 描述 | 副作用 | 實作難度 |
|------|------|--------|----------|
| **A: OpenClaw upstream PR** | 喺 `agent-runner.runtime-CCReftdY.js` line 3662 加 config check：if `cfg.agents.defaults.fallbackNoticeMode === 'silent'` skip notice emit。提 PR 畀 OpenClaw upstream。 | 需要 maintain fork / 等 upstream merge。**但** task 規定唔好 modify core SDK，POC 都唔可以。 | 🟢 Easy (code 簡單)，但**部署阻塞** upstream merge 速度 |
| **B: Wrapper-script filter (out-of-band)** | Hook 喺 reply 出咗之後、user 見到之前嘅 layer 過濾。例如：搵個 Discord-side filter / OpenClaw 嘅 `output_filter` middleware 攔截 "↪️ Model Fallback" prefix。 | 過濾可能 miss (multi-line, 編碼差異)。會影響其他 prefix "↪️" 嘅 message。 | 🟡 Medium (要搵合適 middleware hook point) |
| **C: Session-state 預 warm-up (prevent re-emit)** | 喺 `route-enforcer` plugin 加 logic：每次 `before_model_resolve` 都主動 patch session store 嘅 `fallbackNoticeSelectedModel/ActiveModel`，令 `previousState` 永遠 = 當前 pair → `fallbackTransitioned === false`。 | 需要 access `sessionKey` / `storePath` 嘅寫權限 (plugin 而家只 read)。Race condition 仍然存在如果 patch 慢過 agent run 完成。 | 🔶 Hard (要深入 OpenClaw session store API) |
| **D: Wrapper plugin using `before_prompt_build` to detect+suppress at Discord layer** | 喺 `route-enforcer` 之外，加第二個 plugin 喺 reply path (e.g. Discord message create) 攔截 status notice。但 OpenClaw 冇呢類 hook。 | 需要 hack 替代方案：cron job 掃 log 過濾？ | 🔶 Hard — 冇合適 hook |
| **E: Accept noise, document** | 接受 notice，喺 AGENTS.md 註明呢個係 by-design fallback indicator。 | 持續 noise | 🟢 Trivial (1 line in AGENTS.md) |

### Trade-off 比較

| 方案 | 有效度 | Maintenance | Risk | 推薦？ |
|------|--------|-------------|------|--------|
| A | ⭐⭐⭐⭐⭐ | Upstream 維護 | 等 merge 慢 | ✅ 最 ideal，但要上游 |
| B | ⭐⭐⭐ | 自己 script | 過濾 miss | 🟡 可以試 |
| C | ⭐⭐⭐⭐ | Plugin 內 | Race condition | 🟡 中等推薦 |
| D | ⭐⭐ | 維持 cron | 假陽性 | ❌ 唔建議 |
| E | ⭐ | Doc-only | 持續 noise | ❌ 唔解決問題 |

---

## 4. POC 建議：方案 C (Plugin 預 warm-up session state)

**揀呢個嘅原因：**
- 🟢 **唔改 core SDK**（符合 Cannot Do）
- 🟢 **唔改 cron**（符合 Cannot Do）
- 🟢 **唔改 route_model.yaml**（符合 Cannot Do）
- 🟢 喺 `route-enforcer` plugin 既有架構上 extend（已有 `before_model_resolve` hook）
- 🟡 副作用可控（只影響 session state patch）
- 推薦原因：keep scope local, work within existing plugin

### POC Sketch (只係 sketch，**唔好 apply**)

```javascript
// ~/.openclaw/extensions/route-enforcer/index.mjs
// 喺 register(api) 入面加新 hook，唔好改現有邏輯

api.on("before_model_resolve", async (event, ctx) => {
  if (ctx?.trigger === "cron") return;
  
  // ... 現有 logic 唔變 (aux + route override)
  
  // ─── 新增：warm-up session state 避免 re-emit ───
  // 目標：預先 patch session store 嘅 fallbackNotice{Selected,Active}Model
  // 令佢同 route-enforcer 揀嘅 model pair 一致
  
  // 計算 route-enforcer 將會 emit 嘅 model pair
  let targetPair = null;
  const auxResult = classifyAuxiliaryTask(event?.prompt || '');
  if (auxResult) {
    targetPair = {
      selected: auxResult.provider,    // ← 但 buildFallbackNotice 嘅 selectedModel
      active: auxResult.model          //    來自 run.provider/model，唔一定 = auxResult
    };
  }
  // ⚠️ 注意：selectedModel (per OpenClaw logic) = run.provider/model (original request)
  //           activeModel = actual model used
  // 我哋唔知 actual model 喺呢個 hook 嘅時候，所以只可以做 best-effort:
  // 如果 plugin 已經 override 咗 → 推斷 activeModel = override
  
  // 偽代碼：
  // if (targetPair && ctx.sessionKey && ctx.storePath) {
  //   await applySessionStoreEntryPatch({
  //     storePath: ctx.storePath,
  //     sessionKey: ctx.sessionKey,
  //     patch: {
  //       fallbackNoticeSelectedModel: targetPair.selected,
  //       fallbackNoticeActiveModel: targetPair.active
  //     }
  //   });
  // }
}, { priority: 10 });
```

### 預期效果

- **Before fix:** 每次 turn 都 emit `↪️ Model Fallback: ...` 因為 `previousState` 空
- **After fix:** 第二次 turn 起，`previousState.selectedModel === selectedModelRef` → `fallbackTransitioned === false` → **冇 notice**

### 限制 / Caveat

1. **首次 turn 仍然 emit**（state 未 warm up）— 呢個係 by-design，user 至少知 1 次
2. **Race condition:** patch 慢過 agent run 完成的話，仍然 re-emit
3. **Plugin 唔可以直接 import `applySessionStoreEntryPatch`**（OpenClaw internal）— 需要喺 plugin 內 call `openclaw/plugin-sdk/...` 嘅公開 API，或者用 `fs` 直接 patch JSON store（risk）
4. **Cross-session state pollution:** 如果同一 sessionKey share 喺多個 agent，要小心唔好 override 錯 pair

### 更安全嘅退化方案 (Plan B): 喺用戶面接受 + 改善 message

- Accept 1 次 first-turn notice
- 改善 message format：將 "↪️ Model Fallback: ..." 改成 "ℹ️ using minimax-portal (deepseek v4 flash unavailable)" — 更 user-friendly
- 仍然要 core SDK edit → 不可行 within constraints

---

## 5. 最終推薦

**推薦方案 C (POC sketch above)**，原因：
- 喺 plugin layer 解決問題
- 唔撞 Cannot Do 限制
- 副作用最小（只 patch session state）

**Alternative:** 同步喺 OpenClaw upstream 開 issue/PR 推方案 A (config flag)，長遠根治。

**而家即刻可以落地嘅行動 (冇 modify 風險):**
- 文檔化呢個 notice 嘅 by-design 性質
- 喺 AGENTS.md / SOUL.md 加 1 句「model fallback notice 屬 informational, 唔影響功能」
- **唔做**任何 code change — 等 Josh review 完 POC sketch 先決定

---

## Appendix A: 重要 File:Line References

| File | Line | Function | 用途 |
|------|------|----------|------|
| `dist/agent-runner.runtime-CCReftdY.js` | 142 | `buildFallbackNotice` | 組 message string |
| 同上 | 146 | (return statement) | "↪️ Model Fallback: ..." 模板 |
| 同上 | 154 | `resolveFallbackTransition` | 計 fallbackActive/Transitioned |
| 同上 | 2746 | `resolveConfiguredFallbackModel` | 拎 selected model (requested) |
| 同上 | 3558 | `resolveFallbackTransition` call | 真正 emit 入口 |
| 同上 | 3662-3678 | emit notice code | 真正 push payload |
| 同上 | 3687-3701 | emit cleared notice | 恢復時 notice |
| `dist/reply-payload-DM17pxMC.js` | 66 | `markReplyPayloadForSourceSuppressionDelivery` | 相反方向（令 payload 強制送） |
| 同上 | 69 | `isReplyPayloadStatusNotice` | 識別 status notice（包括 fallback） |
| `dist/model-runtime-aliases-BZbkQtpt.js` | 53 | `areRuntimeModelRefsEquivalent` | 判斷兩 model refs 等價 |
| `dist/runtime-schema-CoGt090u.js` | 815-816 | `agents.defaults.model.{primary,fallbacks}` | 唯一可 config 嘅 fallback 行為 |
| 同上 | 862 | `agents.defaults.compaction.notifyUser` | 最接近嘅 precedent（但只管 compaction） |
| `~/.openclaw/extensions/route-enforcer/index.mjs` | 全文 | `definePluginEntry` | 現有 plugin，line 8-12 comment 解釋咗「冇 config flag, 冇 spawn hook」 |
| `~/.openclaw/workspace/scripts/router/route_model.yaml` | 14-15, 22-26, 36-40, 44-48 | route config | deepseek primary + minimax-portal fallback chain |
