---
id: 139
title: Route-Enforcer Plugin: sessions_spawn model= override Bug
status: archive
priority: P1
created: 2026-06-08
due: 2026-06-10
updated: 2026-07-12
progress: 3/3
---

## F - Facts（事實）

### 現況
`route-enforcer` plugin 嘅 `before_model_resolve` hook 會將所有 model resolution（包括 subagent spawn）根據 prompt keyword 分類 override model，完全無視 `sessions_spawn model=...` 參數。例如 `sessions_spawn model=deepseek/deepseek-v4-pro task="code review..."` 會因為 classifyAuxiliaryTask() match "code review" keywords → 強制轉用 `minimax-portal/MiniMax-M2.7`。

### 根因
- Plugin: `~/.openclaw/extensions/route-enforcer/index.mjs`
- Hook: `before_model_resolve` (priority: 10)
- `classifyAuxiliaryTask()` keyword matching → `auxiliary_routing.json` code_review category
- 冇檢查當前 model 是否被 explicitly set

### 影響範圍
所有 spawn sub-agent 用 explicit model parameter 嘅情況都會被 hijack。特別係想用 DeepSeek V4 Pro 做 coding review/task 時會強制轉返 MiniMax-M2.7。

### 修復
- 喺 `before_model_resolve` 加咗 guard：如果 `ctx.modelId` 唔係 agent default (`deepseek-v4-flash`)，route-enforcer 就 skip override
- 邏輯：default model = route-enforcer 可 override；explicit set = respect choice
- 通過 `node --check` syntax validation
- Gateway restart 成功 (PID 39436, port 18789)
- 驗證：`sessions_spawn model=deepseek/deepseek-v4-pro task="say hi"` → ✅ resolvedModel: deepseek/deepseek-v4-pro

### 邊緣案例
- ✅ Spawn without model param → default → route-enforcer overrides normally
- ✅ `model=deepseek/deepseek-v4-pro` → skip override, keep v4-pro
- ✅ `model=minimax-portal/MiniMax-M3` → skip override, keep M3
- ✅ Fallback scenario (deepseek down → MiniMax) → skip override (respect fallback)
- ✅ Only main session/agent default gets overridden

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-08] Fix: 加 `AGENT_DEFAULT_MODEL` check guard 喺 `before_model_resolve`
- [2026-06-08] Gateway restart apply
- [2026-06-08] Live test pass

### ⏳ 待做決定
- (none — fix completed)

## Q - Questions（未解決）

### 🔍 觀察
- route-enforcer 嘅 aux routing 對於 prompt 關鍵字匹配太 aggressive，特別係 "code review"、"research" 呢類 generic 嘅字
- 可能改 route-enforcer 邏輯更快，而非等 upstream OpenClaw 支援 `explicitModel` flag
- 另一個approach：喺 `auxiliary_classifier.js` 加 `skipOnExplicitModel` flag 但 plugin level 做更直接

## Progress
- [x] Bug diagnosis & root cause identified
- [x] Fix applied & tested
- [x] Issue created
