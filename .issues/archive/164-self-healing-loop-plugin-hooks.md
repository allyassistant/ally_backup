# Issue #164: self-healing-loop plugin hooks 唔 fire（已修復）

## F - Facts

**問題描述：**
Self-healing-loop plugin（`extensions/self-healing-loop/index.mjs`）嘅 4 個 hooks (`after_tool_call`, `agent_end`, `session_start`, `session_end`) 全部唔 fire。`.self_healing_loop.jsonl` telemetry 0 bytes。

**Root Cause（2 層問題）：**

### 🔴 P0 #1: ESM module 用 `require("node:fs")`
**File:** `index.mjs`
`readFixerPrompt()` 內用咗 `const { readFileSync } = require("node:fs")`，但 ESM module 冇 `require`。每次 handler 行到呢度就 throw `ReferenceError`，handler outer try-catch 食咗 error → 令 `after_tool_call` handler 完全唔做嘢（連 `hook_error` telemetry 都冇寫到）。後來 M3 review 發現仲有其他問題：

### 🔴 P0 #2: Missing `hooks.allowConversationAccess: true`
OpenClaw SDK conversation gate（`registry-CQTOYCVL.js:4573-4589`）block 咗 `agent_end` hook（conversation hook）。Non-bundled plugin 必須通過 `plugins.entries.X.hooks.allowConversationAccess: true` 先可以用 conversation hooks。Source: `isConversationHookName()` 包含 `agent_end`。

### 🔴 P0 #3: spawnFixer SDK contract 錯誤
**File:** `index.mjs`
`api.runtime.subagent.run()` 傳咗 `{task: ..., model: "minimax-portal/MiniMax-M3", mode: "run"}`，但 SDK 真 contract 係：
```typescript
type SubagentRunParams = {
  sessionKey: string;   // required
  message: string;      // required — 我用 task
  provider?: string;    // 同 model split
  model?: string;
};
type SubagentRunResult = { runId, childSessionKey };
```
升 `fix-syntax` mode 後每次 verify fail 都會 throw error。

### 🔴 P0 #4: apply_patch path extraction 壞咗
**File:** `index.mjs:67-74`
OpenClaw `applyPatchSchema` 淨係有 `input: string` field，file path 喺 `*** Update File: <path>` marker 入面。原來 `extractFilePath()` 睇 `params.path` / `params.file_path` — 永遠 null。

### 🟡 P1 #5: fix-syntax regex 漏咗 4 個 patterns
verify_edit.js flag 9 個 unsafe sync API，但 regex 只 check 5 個：`execSync` / `readFileSync` / `writeFileSync`。漏咗 `readdirSync` / `unlinkSync` / `renameSync` / `mkdirSync`。

### 🟡 P1 #6: fixer-prompt.md 唔存在
Plugin dir 冇 `fixer-prompt.md`，inline fallback 得一行 prompt，fixer sub-agent 冇任何 context 做修復。

### 🟡 P1 #7: verify_edit.js spawn 用 `--quiet` flag 導致空 output
**File:** `index.mjs`
`runVerify` 傳 `--quiet` 俾 verify_edit.js，而 `--quiet` 令到所有 console output 被 suppress（line 37-40 嘅 ok/fail/warn/info 全部唔 output），但 exit code 仍然反映結果。所以 `parseVerifyErrors` 收到空字串，永遠 `errors: 0`。

### 🟡 P1 #8: parseVerifyErrors 唔處理 ANSI escape codes
verify_edit.js output 有 ANSI color codes（`[31m`, `[0m` 等），regex 直接 match raw output 失敗。

### 🟡 P1 #9: log mode 照樣跑 verify
Mode `log` 應該只觀察唔 verify，但 code 照行 `runVerify()` spawn child process，嘥 CPU。

### 🟡 P1 #10: state.sessionKey 永遠 null
`session_start` 唔會對 in-progress session 補發。每個 hook 有 `ctx.sessionKey` 但 handler ignore 咗。

---

## D - Decisions

| Decision | Date | Status |
|----------|------|--------|
| Add `hooks.allowConversationAccess: true` to config | 2026-06-17 | ✅ Done |
| Fix `require("node:fs")` → `import { readFileSync } from "node:fs"` | 2026-06-17 | ✅ Done |
| Fix spawnFixer SDK contract: `message` + split `provider/model` + fallback M3→Pro | 2026-06-17 | ✅ Done |
| Fix apply_patch path extraction: regex `*** (Update\|Add\|Delete\|Move) File: (\S+)` | 2026-06-17 | ✅ Done |
| Expand fix-syntax regex cover all 9 patterns | 2026-06-17 | ✅ Done |
| Create `fixer-prompt.md` (70 lines, 3.4KB 6-step SOP) | 2026-06-17 | ✅ Done |
| Remove `--quiet` flag from `runVerify` spawn | 2026-06-17 | ✅ Done |
| Add `stripAnsi()` to `parseVerifyErrors` | 2026-06-17 | ✅ Done |
| Log mode: skip verify, log `verify_log_skip` event | 2026-06-17 | ✅ Done |
| All 4 hooks: `async (event, ctx)` → `state.sessionKey = ctx?.sessionKey` | 2026-06-17 | ✅ Done |
| Mode 升 `fix-syntax`（auto-fix SyntaxError/P0） | 2026-06-17 | ✅ Done |
| Fixer model chain: MiniMax-M3 → DeepSeek V4 Pro | 2026-06-17 | ✅ Done |

---

## Q - Questions

| Question | Answer |
|----------|--------|
| 所有 hooks 正常運作？ | ✅ End-to-end 測試通過（`write` → `verify_fail` → `enqueue` → `spawn_ok` → `verify_ok`） |
| 可以直接升 mode？ | ✅ 已升 `fix-syntax`，13 秒完整 flow 成功 |
| 7 日後升 `fix-all`？ | 觀察 telemetry，確認 false positive rate < 20% |

---

## Progress

- [x] 建立 plugin (2026-06-16 23:50)
- [x] unit tests pass (2026-06-17 00:01)
- [x] Root cause identified (2026-06-17 09:41-10:15)
- [x] Fix 1: `allowConversationAccess` config (10:22)
- [x] Fix 2: `require()` fix (10:34)
- [x] M3 code review → 發現 2 P0 + 4 P1 (10:50-10:50)
- [x] M3 fixes all 6 bugs (10:50-10:54)
- [x] Discover + fix `--quiet` bug + ANSI parser bug (11:22-11:25)
- [x] End-to-end verification: write → fail → enqueue → M3 spawn → fix → verify_ok (11:27-11:27)
- [x] All 4 issues (164/165/166/167) closed and archived (11:28)

---

## 驗證

```
$ tail -5 .self_healing_loop.jsonl
→ session_init          ✅ session_start hook
→ verify_fail, err:2    ✅ openclaw SDK detection
→ enqueue, err:2        ✅ fix-syntax gate match
→ spawn_ok              ✅ M3 sub-agent spawned
→ verify_ok             ✅ fixer 修復成功
```

---

## Notes

- **Plugin code:** `extensions/self-healing-loop/index.mjs` (468 lines)
- **Fixer prompt:** `extensions/self-healing-loop/fixer-prompt.md` (70 lines, 3.4KB)
- **Telemetry:** `~/.openclaw/workspace/.self_healing_loop.jsonl`
- **Config:** mode=`fix-syntax`, hooks={ allowConversationAccess: true }, perFileBudget=1, sessionFixerCap=1
- **Fixer model chain:** minimax-portal/MiniMax-M3（primary）→ deepseek/deepseek-v4-pro（fallback）
- **Close date:** 2026-06-17
