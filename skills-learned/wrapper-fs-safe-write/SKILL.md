---
name: wrapper-fs-safe-write
description: Wrap fs.writeFileSync and fs.appendFileSync in a try-catch helper so disk errors do not crash the script. Drop the wrapper into cron entry points and any code path that touches disk.
status: active
source: skill-reviewer
provenance: manual-promotion-from-quarantine
generatedAt: 2026-07-08T21:00:00.000Z
---

## Problem

`fs.writeFileSync` 和 `fs.appendFileSync` 在磁盤錯誤（EACCES / ENOSPC / EBUSY / EROFS）下會 throw 一個 Node.js exception。如果寫入發生在 cron entry point 或任何沒有 try-catch 嘅 disk-touching code path，一個 I/O failure 會 crash 成個 script、留下半寫狀態嘅 file、而且下個 cron run 嘅 retry 可能讀到 corrupt data。

呢個 skill 嘅目標係提供一個 unified wrapper（`safeWriteFile` / `safeAppendFile`）並示範佢應該點樣放落 script 入面。

## Workflow

1. **引入 wrapper module** — 將 `safeWriteFile` 和 `safeAppendFile` 寫喺一個 shared helper（例如 `scripts/lib/fs_safe_write.js`），然後 require 落需要嘅 cron / archive script：

   ```javascript
   // scripts/lib/fs_safe_write.js
   const fs = require('fs');
   const path = require('path');

   function safeWriteFile(filePath, content) {
     try {
       fs.writeFileSync(filePath, content, 'utf8');
       return true;
     } catch (err) {
       console.error(`[fs-safe-write] writeFileSync failed: ${filePath} (${err.code || 'unknown'}): ${err.message}`);
       return false;
     }
   }

   function safeAppendFile(filePath, content) {
     try {
       fs.appendFileSync(filePath, content, 'utf8');
       return true;
     } catch (err) {
       console.error(`[fs-safe-write] appendFileSync failed: ${filePath} (${err.code || 'unknown'}): ${err.message}`);
       return false;
     }
   }

   module.exports = { safeWriteFile, safeAppendFile };
   ```

2. **Replace bare fs.writeFileSync / appendFileSync calls** — 將每個冇 try-catch 嘅 `fs.writeFileSync(...)` 改做 `safeWriteFile(...)`；同理 `appendFileSync`：

   ```javascript
   // before
   fs.writeFileSync('/path/to/state.json', JSON.stringify(state));
   // after
   const { safeWriteFile } = require('./lib/fs_safe_write');
   safeWriteFile('/path/to/state.json', JSON.stringify(state));
   ```

3. **Apply to cron entry points first** — `scripts/cron-*.js` 嘅 first 20 lines 通常係最 critical（失敗會令整個 schedule skip）。Audit 嗰度嘅 `fsSync_missing_trycatch` rule 主要 hit `scripts/cron-*` 同 `scripts/archive/*`，所以呢兩個 directory 應該先 sweep。

4. **Propagate return value when needed** — wrapper 返 boolean，所以 caller 可以決定下一步：
   - cron logger：return false 就 `return early` / skip 下游 step
   - health check：return false 就 emit drift alert
   - UI feedback：return false 就 throw 一個 user-facing error

   ```javascript
   if (!safeWriteFile(stateFile, JSON.stringify(state))) {
     // cron 唔會 crash，但下個 step 應該 bail
     return;
   }
   ```

5. **Test with a read-only path** — 驗證 wrapper 唔會 crash，只係 silently return false。寫到 `/dev/null/forbidden` 或一個 chmod 000 嘅 directory，confirm process 仲 alive：

   ```bash
   node -e "
     const { safeWriteFile } = require('./scripts/lib/fs_safe_write');
     const ok = safeWriteFile('/private/root/forbidden.json', 'x');
     console.log('returned:', ok); // 預期 false
     console.log('process alive');
   "
   ```

## Pitfalls

- ⚠️ 唔好用 `fs.promises.writeFile` 等 async 版本 — 為咗保持 cron script 嘅 synchronous / 簡單 flow，wrapper 必須係 sync。如果行 async 就會 silently 改變 caller 嘅 control flow，造成 micro-task race。
- ⚠️ 唔好 swallow error 唔 log — `catch (err) { return false; }` 會靜靜抹走磁盤 full / permission denied 嘅 signal，令 cron 失敗但冇 trace。必須 `console.error` 包括 `err.code` 同 `filePath`。
- ⚠️ Partial-write 風險 — `fs.writeFileSync` 喺 EROFS / ENOSPC 下寫 0 byte 是 common behavior。Wrapper 唔保證 atomicity；對於 critical state file（例如 audit log），應該先寫 `.tmp` 再 rename，避免 partial write 破壞 existing data。
- ⚠️ Atomic rename 要跟 `safeWriteFile` 一齊 — 對於 `scripts/state/*.json` 嗰啲 「read-modify-write」嘅 state，配合 `fs.renameSync(tmp, target)` 嘅 pattern 先確保 atomic。Wrapper 本身只 catch exception，唔做 atomic guarantee。
- ⚠️ 唔好為咗 bypass error handling 而用 `try { ... } catch {}` — empty catch 抹走所有 context。一定要 log path + error code，再 return boolean。
- ⚠️ 同 `node-fs-enoent-debugging` 唔同 — 呢個 skill 專注 fs.writeFileSync 嘅 try-catch wrap；`node-fs-enoent-debugging` 講 path resolution / execSync ENOENT / binary path fallback chain。兩者 domain 唔同，唔好混淆使用。

## Reference

- 同類 skill：`node-fs-enoent-debugging`（path resolution / `execSync` binary ENOENT）— domain 唔同但 verbs 重疊（fs error handling），audit gate 容易 false-positive skip。當 dedup similarity 0.85–0.92 出現時要人手 spot-check。
- Rule trigger：`fsSync_missing_trycatch` — CQM 自動 emit wrapped skill proposal，wrapper-fs-safe-write 係呢條 rule 嘅 canonical sink。
