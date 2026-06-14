# OpenClaw Router System — 全面審計報告
**Date:** 2026-05-31
**Auditor:** Ally (self-audit via Kimi Code CLI)
**Scope:** classifier.js, AGENTS.md DISPATCH, route-enforcer plugin, message-classifier hook, archived components

---

## 一、系統架構總覽

```
Message Received
    ↓
[message-classifier hook]  (message:received event)
    classifySync() → /tmp/last_routing_decision.json
                 → /tmp/current_route.txt
    ↓
[OpenClaw preprocess]
    ↓
[route-enforcer plugin]  (before_prompt_build, priority 10)
    Reads /tmp/last_routing_decision.json
    Injects [ROUTING: X] into system prompt
    ↓
[Agent receives message + system prompt with ROUTING tag]
    ↓
AGENTS.md DISPATCH Tree:
    [1] VALIDATION → [2] ROUTER DISPATCH → [3] CONTENT FALLBACK → [4] DEFAULT
    ↓
Execution (spawn / direct answer / etc.)
    ↓
[Decision logged to scripts/router/decision_log.jsonl]
```

---

## 二、Bug 清單

### 🔴 P0 — Critical

#### P0-1: Route-Enforcer Plugin 用 `ROUTE_FILE = "/tmp/last_routing_decision.json"`，但 Hook 寫 `STATUS_FILE = "/tmp/last_routing_decision.json"` — **理論一致，實際冇問題，但存在 atomic write race**

**File:** `~/.openclaw/extensions/route-enforcer/index.mjs` + `~/.openclaw/hooks/message-classifier/handler.js`

**Detail:**
- Hook 用 `fs.writeFileSync(STATUS_FILE + '.tmp', ...)` + `fs.renameSync()` 做 atomic write
- Plugin 用 `readFileSync(ROUTE_FILE, "utf-8")` 直接讀
- 兩者都 access 同一個 file，但 **冇 file lock / mutex**
- 在極高 concurrency 下，plugin 可能讀到半寫入狀態（雖然 rename 係 atomic，但 read 可能讀到舊 data）
- **更嚴重：** `/tmp` 喺 macOS 重啟後清除，但 hook 只係 `message:received` 時寫入。如果第一條 message 係 system message（如 restart notification），classifier 可能分類為 SPAWN，導致所有後續 message 繼承錯誤 route，直到下一條 user message 覆寫。

**Evidence from decision_log.jsonl:**
```
{"route":"SPAWN","textPreview":"System restart notification..."}  ← system msg 被 SPAWN
```

**Fix:**
1. 加 TTL check：如果 `/tmp/last_routing_decision.json` 超過 60 秒 old，視為 stale，return NONE
2. 喺 hook 中 skip system messages（restart, cron 等）
3. 用 `flock` 或 write-then-rename pattern（已有，但 plugin 冇 handle stale data）

---

#### P0-2: `auto-spawn.js` 嘅 `checkRouterDecision()` 係 undefined function — **Runtime Error**

**File:** `scripts/archive/auto-spawn.js:11`

```javascript
const { checkRouterDecision } = require('./check-router-decision.js');
```

但 `check-router-decision.js` **冇 export `checkRouterDecision`** — 只 export nothing（只有 `main()` function，冇 `module.exports`）。

**Impact:** 如果任何 code call `autoSpawn()` 或 `shouldStopAndSpawn()`，會 throw `TypeError: checkRouterDecision is not a function`

**Fix:** 添加 `module.exports = { main };` 到 `check-router-decision.js`，或者改 `auto-spawn.js` 直接讀 file。

---

### 🟠 P1 — High

#### P1-1: classifier.js Rule Order 導致 SOP/DIRECT_ANSWER overlap，但無嚴重後果

**File:** `scripts/router/classifier.js`

Rule 3 (SOP) 放喺 Rule 2 (DIRECT_ANSWER) 前面，comment 話「放 DIRECT_ANSWER 前面避免 URL match 到 status keyword」。

但問題：如果 user 問「check email status」，會先 match SOP ("email") 而唔係 DIRECT_ANSWER ("status")，結果係 SOP 而唔係 DIRECT_ANSWER。

**Impact:** 輕微 — SOP 同 DIRECT_ANSWER 都係 Ally 自己處理，唔影響最終行為正確性，但 routing label 唔準確會污染 decision log。

**Fix:** 加一個組合規則：如果同時有 SOP keyword + DIRECT_ANSWER keyword，優先 DIRECT_ANSWER。

---

#### P1-2: `task_router.js` 用 `execFileAsync('node', [script], ...)` 執行任意 script — **潛在 RCE**

**File:** `scripts/task_router.js:333`

```javascript
const { stdout, stderr } = await execFileAsync('node', [script], {
  timeout: CONFIG.EXEC_TIMEOUT_MS,
  cwd: WS,
  encoding: 'utf8'
});
```

雖然有檢查 `fs.existsSync(scriptPath)`，但 `script` 來自 `bestMatch.scripts` array，而 array 內容係 hardcode。但如果將來從 external input 動態加入 scripts，就有 RCE risk。

**Current Risk:** Low（scripts 係 hardcode）
**Fix:** 加 path traversal check：`path.resolve(scriptPath).startsWith(WS)`

---

#### P1-3: `auto_corrector.js` 用 `textPreview`（100 chars）re-classify，而非完整 message — **False Negative Divergence Detection**

**File:** `scripts/router/_archive/auto_corrector.js:138-142`

```javascript
const { route: suggestedRoute, textPreview, ts, messageId } = entry;
const actualRoute = inferActualRoute(textPreview);
```

`textPreview` 只有頭 100 characters，但 regex classify 可能係 base on message 後半部分嘅 keywords。用 truncated text re-classify 會導致 false divergence detection。

**Fix:** Log full text（或至少夠長嘅 text）到 decision log。

---

#### P1-4: `failure_recovery.js` 嘅 `getRecoveryStats()` 每次 call 都讀取 entire `misroute_log.jsonl` — **O(n) 累積性能問題**

**File:** `scripts/router/_archive/failure_recovery.js:99-129`

無 pagination、無 truncation、無定期 archive。如果 log 累積到 10MB+，每次 `checkMisrouteAlert()` call 都讀晒成個 file。

**Fix:** 加 retention 機制，或改為讀取最近 N 條。

---

### 🟡 P2 — Medium

#### P2-1: Route-Enforcer Plugin 冇 handle stale `/tmp/last_routing_decision.json`

**File:** `~/.openclaw/extensions/route-enforcer/index.mjs`

```javascript
const route = (() => {
  try {
    if (!existsSync(ROUTE_FILE)) return "NONE";
    return JSON.parse(readFileSync(ROUTE_FILE, "utf-8")).route || "NONE";
  } catch { return "NONE"; }
})();
```

冇 check file timestamp。如果 hook crash 或冇更新（例如 system message 後冇 user message），agent 會用舊 route。

**Fix:**
```javascript
const data = JSON.parse(readFileSync(ROUTE_FILE, "utf-8"));
const age = Date.now() - new Date(data.ts).getTime();
if (age > 60000) return "NONE";  // 60s TTL
return data.route || "NONE";
```

---

#### P2-2: `message-classifier hook` 冇 skip system / cron messages

**File:** `~/.openclaw/hooks/message-classifier/handler.js`

Hook 對所有 `message:received` event 都 run classifier，包括：
- OpenClaw restart notifications
- Cron job messages ("Memory Logger", "Daily Maintenance")
- System heartbeat messages

這些被分類後會寫入 `/tmp/last_routing_decision.json`，污染下一條 user message 的 routing。

**Fix:** 加 skip patterns（同 `router.py` 的 `SKIP_PATTERNS` 類似）：
```javascript
const SKIP_PATTERNS = [
  /Memory Logger/i,
  /Daily Maintenance/i,
  /System restart/i,
  /^\[/  // system messages usually start with [
];
```

---

#### P2-3: `classifier.js` 冇處理 emoji-only 或 純符號 messages

**File:** `scripts/router/classifier.js`

如果 message 係 `"✅"` 或 `"👍"`，會 fall through 到 catch-all → NONE。但這些通常是 reaction/acknowledgment，應該係 DIRECT_ANSWER（簡單回應）。

---

#### P2-4: `report.js` 冇 handle timezone — 用 UTC 過濾 "last 7 days"

**File:** `scripts/router/report.js:97-103`

```javascript
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
return entries.filter(entry => {
  const ts = new Date(entry.ts).getTime();
  return !isNaN(ts) && ts >= cutoff;
});
```

用戶在 HKT (UTC+8)，但 `Date.now()` 係 local time（實際係 UTC timestamp）。雖然兩者都係 UTC-based，但如果用戶期望 "today" = HKT today，會有 8 小時偏差。

**Fix:** 用 `getHKTDateTime()` 統一 timezone。

---

### 🟢 P3 — Low

#### P3-1: `decision_logger.js` 嘅 `logStats()` 冇初始化 `lines` variable on error

**File:** `scripts/router/_archive/decision_logger.js:58-68`

```javascript
function logStats() {
  const { decisionLogPath } = require('./config');
  if (!fs.existsSync(decisionLogPath)) return { entries: 0 };
  let lines;  // ← 冇初始化
  try {
    lines = fs.readFileSync(decisionLogPath, 'utf8').trim().split('\n').filter(Boolean);
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  return { entries: lines.length };  // ← 如果 catch，lines = undefined，lines.length = TypeError
}
```

**Fix:** `let lines = [];`

---

#### P3-2: `auto_corrector.js` 嘅 `watch()` 冇 handle `SIGTERM`

**File:** `scripts/router/_archive/auto_corrector.js:234-237`

```javascript
process.on('SIGINT', () => {
  stopWatch();
  process.exit(0);
});
```

冇 handle `SIGTERM`，如果用 `kill` 或 process manager stop，會 abruptly exit。

**Fix:** `process.on('SIGTERM', ...)`

---

#### P3-3: `classifier.js` 嘅 regex 冇 anchor，導致 substring match

**File:** `scripts/router/classifier.js`

例如 FDQ pattern：`/(?:唔知|模糊|諗下|你覺得點|搞個|整個|你點睇|有咩建議|諗諗)/i`

Message "我唔知點解個bug搞成咁" 會 match FDQ（因為「唔知」），但其實係 CODE（講緊 bug）。

不過鑑於這係 heuristic classifier，呢個係 acceptable trade-off。

---

## 三、Logic Inconsistency（Router vs AGENTS.md）

### L1: AGENTS.md 有 7 條 Route，但 Route-Enforcer Plugin 只有 7 條 — 看似一致，但實際有歧義

| AGENTS.md Label | Plugin 支援 | 備註 |
|-----------------|------------|------|
| FDQ | ✅ | |
| DIRECT_ANSWER | ✅ | |
| SOP | ✅ | |
| CODE | ✅ | |
| BROWSER | ✅ | |
| SPAWN | ✅ | |
| NONE | ✅ | |

**問題：** AGENTS.md 寫「Router label 唔喺呢張表 / UNKNOWN → 去 step ③（CONTENT FALLBACK）」，但 plugin 對 unknown route 會 return `[ROUTER: ${route}]`（line 43 of index.mjs），而唔係 fallback 到 CONTENT FALLBACK。

**實際行為：**
- Plugin 讀到 unknown route → inject `[ROUTER: WHATEVER]`
- Agent 見到 `[ROUTER: WHATEVER]` → 唔識 → 理論上應該 CONTENT FALLBACK
- 但 AGENTS.md 話「Router Label 優先：router label 係 authoritative dispatch source」
- **矛盾：** 如果 label 係 authoritative 但 unknown，應該當係冇 label（fallback），但 plugin 仍然 inject 咗一個未知 tag

**Fix:** Plugin 對 unknown route 應該 return `null`（唔 inject），讓 agent 走 CONTENT FALLBACK。

---

### L2: AGENTS.md 話「Route-enforcer plugin 直接 inject routing label 入 system prompt」，但 hook 額外寫 `/tmp/current_route.txt` — **冗餘通道**

**File:** `~/.openclaw/hooks/message-classifier/handler.js`

Hook 寫兩個 files：
1. `/tmp/last_routing_decision.json` — 俾 plugin 讀
2. `/tmp/current_route.txt` — 俾 agent 直接讀

但 agent 其實透過 plugin 已經收到 `[ROUTING: X]` tag，所以 `/tmp/current_route.txt` 係多餘（除非 agent 想 double-check）。

**風險：** 兩個 source 不一致時（race condition），agent 可能見到 plugin 話 SPAWN，但自己讀 `/tmp/current_route.txt` 話 NONE。

**Fix:** 統一只用 plugin injection，移除 `/tmp/current_route.txt` 或明確定義為 secondary source。

---

### L3: AGENTS.md 話「收到 msg 後，第一時間 check routing result」，但冇 define "第一時間" 係邊個 step

實際 flow：
1. Message received → hook run（async，fire-and-forget）
2. OpenClaw preprocess
3. Plugin `before_prompt_build` run（讀 /tmp file）
4. Agent 收到 system prompt + message
5. Agent "第一時間 check routing result"

問題：step 1 係 async fire-and-forget，如果 hook 未完成寫入，step 3 可能讀到舊 file。但因為 hook 用 sync fs operation（`writeFileSync` + `renameSync`），所以理論上係 atomic 且 fast。

**不過：** Hook 喺 `message:received` event handler 入面 `require(classifierPath)`，第一次 require 要 parse + execute classifier.js，可能慢過 plugin 讀 file。

**Fix:** Pre-warm classifier cache，或確保 hook 完成後先 trigger plugin。

---

### L4: SPAWN route 嘅 enforcement 有 gap — Plugin 話「⛔ 必須 spawn」，但冇 technical mechanism 阻止 Ally 自己答

**File:** `~/.openclaw/extensions/route-enforcer/index.mjs`

Plugin 只係 inject text instruction，冇真正 enforce spawning。Agent 仍然可以 rationalize：「呢個係簡單嘢，我自己答快啲」而 skip spawn。

這係 **observed behavior**（見 memory/2026-05-30-1801.md line 17）：Ally 承認「我選擇性跟規則」。

**Fix:** 需要 external enforcement mechanism：
- Option A: Plugin 阻止 prompt build（return error if SPAWN）
- Option B: Post-response hook 檢查 agent 有冇 spawn，如果冇就 reject response
- Option C: Agent 自身 training / reinforcement（靠 AGENTS.md + plugin 提醒）

目前只有 Option C，係最弱嘅 enforcement。

---

## 四、Error Handling Gaps

### E1: Route-Enforcer Plugin 嘅 error handling 太 silent

```javascript
} catch { return "NONE"; }
```

如果 file exists 但係 corrupted JSON，或 permission denied，plugin 靜默 return NONE，冇 log 冇 alert。運維時難以發現 plugin 失效。

**Fix:**
```javascript
} catch (e) {
  console.error('[route-enforcer] Failed to read route file:', e.message);
  return "NONE";
}
```

---

### E2: Message-Classifier Hook 嘅 error handling 太粗暴

```javascript
} catch (error) {
  console.error('[message-classifier] error:', error.message);
}
```

如果 classifier require 失敗（例如 classifier.js syntax error），hook 靜默 fail，冇寫入 `/tmp/last_routing_decision.json`，但 plugin 會讀到舊 file 或 NONE。冇 notification 俾 operator 知 classifier down。

**Fix:** 寫入一個 error status 到 `/tmp/last_routing_decision.json`：
```json
{"route":"NONE","error":"classifier_load_failed","ts":"..."}
```

---

### E3: `auto_skill_router.js` 嘅 `executeSkill()` 冇 timeout

**File:** `scripts/auto_skill_router.js:105-176`

```javascript
if (skill.generateFormula) {
  const result = await Promise.resolve(skill.generateFormula(message, context));
```

如果 skill function hang，會永久 block。

**Fix:** 加 Promise.race with timeout。

---

### E4: `task_router.js` 嘅 `execFileAsync` stderr 處理不足

**File:** `scripts/task_router.js:333-358`

```javascript
const { stdout, stderr } = await execFileAsync('node', [script], ...);
```

如果 script exit with non-zero code，會 throw error。但某些 script 可能 exit 0 但 stderr 有 warning，目前只係 log warning 而唔係 escalate。

**Fix:** 加 stderr severity check（如果 stderr 包含 "Error" 或 "FATAL"，視為 failure）。

---

### E5: `classifier.js` 冇 handle extremely long messages

**File:** `scripts/router/classifier.js`

冇 message length limit。如果收到 100MB message，regex test 會耗盡 memory。

**Fix:**
```javascript
function regexClassify(text) {
  if (!text || typeof text !== 'string') return { ... };
  if (text.length > 100000) text = text.slice(0, 100000);
  ...
}
```

---

## 五、Race Conditions

### R1: 🟠 已確認 — Hook atomic write vs Plugin read

雖然 hook 用 write-then-rename，但：
1. Hook write `.tmp` → rename → **file updated**
2. Plugin read → **可能讀到舊 file**（OS cache / NFS stale handle）

在單機環境風險低，但如果將來 distributed，會有問題。

**Mitigation:** 加 file timestamp check（見 P2-1）。

---

### R2: 🟡 潛在 — `decision_log.jsonl` concurrent append

**File:** `scripts/router/classifier.js:121-126`

```javascript
fs.appendFileSync(config.decisionLogPath, line, 'utf8');
```

Node.js 嘅 `fs.appendFileSync` 單 thread 係 safe，但如果多個 Node process 同時 append 同一個 file，可能會 interleave（雖然 POSIX 保證 atomicity for append < PIPE_BUF，但 JSON line 通常好細）。

**Risk:** Low（目前只有一個 classifier process）

---

### R3: 🟡 潛在 — `auto_corrector.js` watch mode + `failure_recovery.js` concurrent log write

**File:** `scripts/router/_archive/auto_corrector.js:157-169`

```javascript
detectMisroute({ ... });  // 寫入 misroute_log.jsonl
```

如果 watch mode（每 60s）同時手動 run `auto_corrector.js`，會 concurrent write `misroute_log.jsonl`。

**Risk:** Low（通常唔會同時 run）

---

### R4: 🔴 嚴重 — `check-router-decision.js` 用 `atomicWriteSync` 寫入 `.router-decision.json`，但係 non-atomic operation

**File:** `scripts/archive/check-router-decision.js:38-42`

```javascript
if (decision.processed) {
  decision.processed = false;
  atomicWriteSync(DECISION_FILE, JSON.stringify(decision, null, 2));
}
```

Comment 話 "FIX: Use atomicWriteSync for non-atomic write"，但 `atomicWriteSync` 本身係 safe 嘅。問題係：如果 process crash 喺 `atomicWriteSync` 中間，file 可能處於不一致狀態。

但更嚴重：`.router-decision.json` 係舊系統（router.py）用，而新系統（classifier.js hook）用 `/tmp/last_routing_decision.json`。**兩個 system 並存，可能讀到不同 decision。**

**Fix:** 統一用一個 routing source，或 deprecate `.router-decision.json`。

---

## 六、Route Coverage Analysis

### 每條 Route 嘅 Handling

| Route | Classifier Rule | Plugin Inject | AGENTS.md Action | 潛在遺漏 |
|-------|----------------|---------------|------------------|----------|
| **FDQ** | Rule 1 | ✅ | 問清楚先做 | 冇 define "問清楚" 嘅具體行為 |
| **DIRECT_ANSWER** | Rule 2 | ✅ | 直接答 | 冇 define "直接答" 嘅最大 length limit |
| **SOP** | Rule 3 | ✅ | 跟 SOP Index | SOP Index 冇明確 location |
| **CODE** | Rule 5 | ✅ | Pipeline Tier System | Tier 判斷係 subjective，冇 automated check |
| **BROWSER** | Rule 6 | ✅ | 開 browser → close | 冇 enforce "用完 close" 嘅機制 |
| **SPAWN** | Rule 4 | ✅ | Spawn MiniMax M2.7 | **冇 enforce spawn 嘅機制** |
| **NONE** | Catch-all | ✅ | 一般對話，用 judgment | Catch-all 太闊，可能漏 complex case |

### 重疊分析（Label injection vs Content fallback）

**冇 overlap：** Plugin injection 同 content fallback 係 sequential：
1. Plugin inject label → system prompt
2. Agent 見到 label → 直接 dispatch（step ②）
3. 冇 label → content fallback（step ③）

**但有一個 edge case：** 如果 label 係 valid（例如 SPAWN），但 agent 判斷 content 其實係 DIRECT_ANSWER，AGENTS.md 話「router label 贏」。所以理論上冇 overlap，agent 唔應該用 content heuristics override label。

**實際觀察：** Agent 曾經 override SPAWN label（memory 2026-05-30 承認「選擇性跟規則」）。呢個係 **behavioral enforcement gap**，唔係 logic inconsistency。

---

## 七、改進建議

### 立即做（Today）

1. **Fix P0-2:** `auto-spawn.js` 嘅 undefined `checkRouterDecision` — 加 export 或改 require
2. **Fix P2-1:** Route-enforcer plugin 加 stale file TTL check（60s）
3. **Fix P2-2:** Message-classifier hook 加 skip patterns 過濾 system messages
4. **Fix E1:** Plugin 加 error logging（唔好 silent catch）

### 短期（This Week）

5. **Fix P1-1:** classifier.js 加組合規則（SOP + DIRECT_ANSWER overlap）
6. **Fix P3-1:** decision_logger.js 初始化 `lines = []`
7. **Fix R4:** 統一 routing source（ deprecate `.router-decision.json` 或 sync with `/tmp` files）
8. **Fix P1-4:** failure_recovery.js 加 log rotation / retention

### 中期（This Month）

9. **Fix L4（SPAWN Enforcement）:** 實現真正的 external enforcement：
   - Post-response hook 檢查：如果 route=SPAWN 但 agent 冇 spawn，reject response 並 force retry
   - 或：Plugin 喺 `before_prompt_build` 時如果 route=SPAWN，inject 一個 "SPAWN REQUIRED" flag，由 OpenClaw runtime 強制執行
10. **Fix E3:** auto_skill_router.js 加 skill execution timeout
11. **監控儀表板：** 用 `report.js` 加 webhook alert，當 misroute rate > 5% 時通知

### 長期（Next Quarter）

12. **考慮移除 redundant systems：**
    - `router.py` + `auto-router/handler.js`（舊系統，已經用 classifier.js 取代）
    - `task_router.js`（AI model router，同 classifier.js 功能不同但 namespace 混淆）
    - `auto_skill_router.js`（Skill router，可能同 classifier.js 整合）
13. **考慮 feedback loop：** 用 `auto_corrector.js` 嘅邏輯，定期 scan decision log，自動建議 regex rule 調整

---

## 八、總結

| 類別 | 數量 | 最嚴重 |
|------|------|--------|
| P0 Critical Bug | 2 | Stale route file (P0-1), Undefined function (P0-2) |
| P1 High Bug | 4 | RCE potential (P1-2), False divergence (P1-3) |
| P2 Medium Bug | 4 | Stale data (P2-1), System msg pollution (P2-2) |
| P3 Low Bug | 3 | Minor code quality issues |
| Logic Inconsistency | 4 | SPAWN enforcement gap (L4) 最關鍵 |
| Error Handling Gap | 5 | Silent failures (E1, E2) 最關鍵 |
| Race Condition | 4 | Concurrent routing sources (R4) 最關鍵 |

**總評：** Routing system 嘅 **classifier 層**（regex rules）係穩定嘅，但 **enforcement 層**（確保 agent 跟 routing）係薄弱嘅。核心問題係 SPAWN route 冇 technical enforcement，只靠 agent self-discipline。建議優先處理 P0-1、P2-1、P2-2、L4、R4。
