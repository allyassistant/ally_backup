---
id: 136
title: Smart Router Model Fallback 訊息抑制 — Task A 分析（持續維護，無限期）
status: active
priority: P1
created: 2026-06-07
due:
updated: 2026-06-12
progress: 4/5
---

## Description

### Context

每次 Smart Router 揀咗 `deepseek/deepseek-v4-flash` 但失敗要 fallback 去 `minimax-portal/MiniMax-M3` 嗰陣，OpenClaw 會輸出一個 user-visible notice：

```
↪️ Model Fallback: minimax-portal/MiniMax-M3 (selected deepseek/deepseek-v4-flash; selected model unavailable)
```

問題：
- 每次 fallback 都重複彈
- 對 user 嚟講係 noise
- 之前 phase 5 已知：route-enforcer plugin 已做 `clean model override`（`extensions/route-enforcer/index.mjs`），用 prompt-only enforcement
- 之前嘅 comment 提到：「OpenClaw has NO config flag to suppress "Model Fallback" notices and NO hook to control spawn directly」

### Analysis Report

完整 sub-agent report 喺：
- `/Users/ally/.openclaw/workspace/.spawn/reports/task_a_model_fallback_analysis.md`

### Root Cause

**By design** — 唔係 bug。`route-enforcer` 改 requested model，但 OpenClaw 內部 fallback chain 仲會 trigger deepseek health check，emit 個 notice。

#### OpenClaw Core Source Locations

| 檔案 | 行數 | 角色 |
|------|------|------|
| `dist/agent-runner.runtime-CCReftdY.js` | L142-194 | Per-step model resolution 邏輯 |
| 同上 | L3662-3701 | Fallback notice emit point |
| `dist/route-model-Bannercl.js` | L94-106 | Route model override |
| `dist/utility-routing-d3rk2rBR.js` | L9-36 | Smart router disabled-state 邏輯 |
| `dist/reply-delivery-DweXpcnn.js` | L57-79 | Internal trace line filter |
| `dist/discord-DM99aAy3.js` | L228-244 | Discord message processing |

### Solution 提案（original）

| 方案 | 描述 | 副作用 | 實作難度 |
|------|------|--------|----------|
| **A** | Plugin 預 warm-up session state | 只影響 Ally workspace | 🟢 Express |
| **B** | 喺 route-enforcer 加 `silentFallback: true` config option | 只影響 Ally workspace | 🟡 Standard |
| **C** | Upstream PR 加 `agents.defaults.fallbackNoticeMode: "silent"` config flag | 影響所有 OpenClaw 用戶 | 🔶 Pipeline |
| D | 完全 disable deepseek route entry | 失去 deepseek cost saving | 🟢 Express |

### Final Solution: Hybrid C→B (JS Patch + Env Var)

**Why not pure C?** OpenClaw config schema 嚴格（`"additionalProperties": false"`），唔俾加 custom field。

**Why not pure B?** Route-enforcer config 同樣 strict schema，亦唔俾加。

**Implemented:** JS patch (改 core code) + env var (代替 config flag, 唔經 schema)

| Layer | Method | Key diff from pure C/B |
|-------|--------|----------------------|
| JS | `process.env.OPENCLAW_SILENT_FALLBACK === "true"` | 唔用 config field 係因為 schema reject |
| Config | 唔經 openclaw.json | bypass schema |
| Env | `ai.openclaw.gateway.env` | managed file, regeneration 時可能被清走 |

## Progress

- [x] 1. Sub-agent Task A 完成（14m16s, 142.8k tokens）
- [x] 2. 詳細分析寫入 `.spawn/reports/task_a_model_fallback_analysis.md`
- [x] 3. Issue 136 開咗，記低 root cause + 4 個方案
- [x] 4. **揀咗方案 C** — modify OpenClaw core code 加 config flag
- [x] 5. **Solution C failed → hybrid C→B approach** — JS patch + env var
  - [x] 5a. Solution C apply（JS patch + openclaw.json config flag）
  - [x] 5b. Schema validation failure（`agents.defaults` `"additionalProperties": false"`）
  - [x] 5c. Bliss's `openclaw doctor` 清走咗 unknown field
  - [x] 5d. 改 Hybrid：JS patch check `process.env.OPENCLAW_SILENT_FALLBACK`
  - [x] 5e. Env var 放落 `/Users/ally/.openclaw/service-env/ai.openclaw.gateway.env`
  - [x] 5f. Gateway full restart via launchctl（PID 24052 → 25380）
  - [x] 5g. Issue #136 updated with full details (2026-06-08 01:10)
- [ ] 6. 觀察 24h 確認效果（等下次 cron run fallback 發生時 verify）

## 2026-06-08 01:10 — Pivot: Solution C→B Hybrid

### 背景

Solution C（openclaw.json 加 `agents.defaults.fallbackNoticeMode: "silent"`）apply 後，Bliss 嘅 `openclaw doctor` 自動修復時清走咗 unknown field。原來 `agents.defaults` schema 有 `"additionalProperties": false"`，任何 unknown field 都會 rejected。

嘗試方案 B（route-enforcer config），發現 `plugins.entries.route-enforcer.config` 同樣有 `"additionalProperties": false"`。OpenClaw 成個 config schema 都係嚴格嘅 — **冇辦法加 custom field**。

### 決定：Hybrid Approach — JS Patch + Env Var

JS patch 保留（改 core code），但 config flag 改用 **environment variable** 代替 schema field：

| Layer | 做法 | 原因 |
|-------|------|------|
| **JS patch** | 改 `buildFallbackNotice` + `buildFallbackClearedNotice`：check `process.env?.OPENCLAW_SILENT_FALLBACK === "true"` | 需要改 core 嘅 fallback notice emit logic，JS patch 係唯一方法 |
| **Config** | 唔用 openclaw.json（schema reject） | `agents.defaults` + `plugins.*.config` 都係 strict |
| **Env var** | `OPENCLAW_SILENT_FALLBACK=true` 放入 gateway env file | 唔經 schema，process global，JS patch 直接 read |
| **Restart** | `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway` → full restart | 新 PID (25380)，env var loaded |

### 最終改動清單

**`/opt/homebrew/lib/node_modules/openclaw/dist/agent-runner.runtime-CCReftdY.js`**

```js
// L146 — buildFallbackNotice
// Ally hybrid patch: suppress notice via env var (schema can't accept new field)
if (process.env?.OPENCLAW_SILENT_FALLBACK === "true") return null;

// L153 — buildFallbackClearedNotice (same structure)
// Ally hybrid patch: suppress cleared notice via env var
if (process.env?.OPENCLAW_SILENT_FALLBACK === "true") return null;
```

**`/Users/ally/.openclaw/service-env/ai.openclaw.gateway.env`**（由 wrapper script 讀取）
```
# Appended 2026-06-08
export OPENCLAW_SILENT_FALLBACK='true'
```

### Verify

- ✅ `node --check` — JS syntax OK
- ✅ Env file — var 存在 `tail -5`
- ✅ Gateway full restart — PID 25380，uptime counter 正常
- ✅ `session_status` — deepseek active, no error
- ⏳ 等下次 fallback 驗證效果

### ⚠️ Known Risks

| Risk | 影響 | Mitigation |
|------|------|------------|
| `npm update` 覆寫 JS patch | 失效，notice 重現 | 記錄 patch 位 (`scripts/memory/patch-backup.md`)，update 後 re-apply |
| env file 被 OpenClaw regenerate 清走 | env var 消失，notice 重現 | 將來見到 fallback notice → 先 check env file 仲有冇 |
| 冇 schema validation — typo silent fail | `OPENCLAW_SILET_FALLBACK=false` 唔 work | 命名已注意，如有問題 check exact key |

### 其他探索過嘅方案（已測試，rejected）

| 嘗試 | 結果 |
|------|------|
| `agents.defaults.fallbackNoticeMode` 喺 openclaw.json | ❌ Schema reject：`additionalProperties: false` |
| `plugins.entries.route-enforcer.config.silentFallback` | ❌ Same：`additionalProperties: false` |
| `experimental.*` 新 field | ❌ Same schema restriction |
| 直接改 gateway schema JS 去除 `additionalProperties` | 🟡 Workable 但要改 OpenClaw core，一樣會被 npm update 覆蓋 |

## 2026-06-07 22:00 — 方案 C Initial Apply（schema failed 記錄）

**Tried:**
1. `/opt/homebrew/lib/node_modules/openclaw/dist/agent-runner.runtime-CCReftdY.js`
   - `buildFallbackNotice` (L142) — 加 `if (params.cfg?.agents?.defaults?.fallbackNoticeMode === "silent") return null;`
   - `buildFallbackClearedNotice` (L150) — same pattern
2. `/Users/ally/.openclaw/openclaw.json`
   - 加 `agents.defaults.fallbackNoticeMode: "silent"`

**Result:** OpenClaw startup failure — `agents.defaults` schema validator rejected unknown field `fallbackNoticeMode`. Bliss's `openclaw doctor` fixed by removing the field.

**Lesson:** OpenClaw's config schema uses `"additionalProperties": false"` throughout. Cannot add custom fields via config.

## 2026-06-07 討論記錄

- Task A sub-agent 完成，report 寫入 `.spawn/reports/task_a_model_fallback_analysis.md`
- 4 個方案列出：Plugin warm-up (A) / silentFallback config (B) / upstream PR (C) / disable deepseek route (D)
- Josh 揀咗方案 C → pivot 去 C→B hybrid（JS patch + env var）

## Notes

- 如果 upstream 正式 support `fallbackNoticeMode: "silent"`，應該移除 patch 改用官方實作
- `npm update` 同 env file regenerate 係兩個主要失效風險，留意
- **Patch location**（for future re-apply）：`/opt/homebrew/lib/node_modules/openclaw/dist/agent-runner.runtime-Duta-cpW.js` lines 149, 157 (after 2026-06-12 npm update, was `agent-runner.runtime-CCReftdY.js` L146, L153)
- 觀察重點：所有 Discord reply 唔應該再見到「↪️ Model Fallback」notice

## Related

- **#135** — CQM scan 預設 silent（已 fix，觀察中）
- **#137** — Reasoning 內容洩漏去 Discord（同期研究，同一 model fallback chain 嘅另一面）
- Spawn session: `agent:main:subagent:63e33ea8-937b-4ec4-880a-db791af6dd5f` (Task A)
- 之前相關：Phase 5 `route-enforcer` clean model override implementation

## 2026-06-12 — Reopened (無限期待維護)

**Reason:** OpenClaw npm update 喺今朝覆蓋咗 JS patch（bundle hash 由 `CCReftdY` → `Duta-cpW`），同時 env file 被 regenerate 清走咗 `OPENCLAW_SILENT_FALLBACK`。已即時重新應用。

**Re-applied changes:**
- JS patch: `agent-runner.runtime-Duta-cpW.js` L149 + L157 — env var guard
- Env var: `OPENCLAW_SILENT_FALLBACK='true'` re-added to `ai.openclaw.gateway.env`
- Gateway restarted: PID 30556, state running

**Why reopened (not closed-after-fix):** Issue 預期每次 npm update 都會 wipe patch，所以呢個係 recurring 維護工作，唔係 one-off fix。改為無限期（due date 移除），由 30-min Skill Reviewer 或 manual check 監察。

**Trigger conditions for this issue:**
- OpenClaw npm update (`openclaw update run`)
- Env file regeneration by OpenClaw
- Dist bundle hash 改變（會改 patch location）
- 任何時間 Discord reply 出現「↪️ Model Fallback」/「↪️ Model Fallback cleared」notice

**Future mitigation ideas:**
- Pre-update hook: backup current patch line numbers before npm update
- Post-update hook: 自動 re-apply patch after `openclaw update run` 成功
- Watch script: 自動 detect 兩個 notice 重新出現時 raise alert

**Status:** Active, indefinite. 觀察 30-min Skill Reviewer 報告同 Discord reply 表面有冇 re-emit notice。
