---
name: node-fs-enoent-debugging
description: 診斷 Node.js 腳本中 fs 操作隱性失敗（ENOENT → exit code 1 無拋錯）的工作流，包括路徑驗證、smoke test 驗收。
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T11:02:59.488Z
---

## Workflow

1. **確認是 ENOENT 而非其他錯誤** — `execSync` / `execFileSync` 的 shell-level ENOENT 會將 stderr 寫入 parent process 的 stdout/stderr，不會拋出 Node.js exception。檢查 `process.stderr` 或 parent script 的 output 是否包含 `No such file or directory`。

2. **驗證目標路徑存在** — 用 `fs.accessSync(path, fs.constants.R_OK)` 測試讀取權限。若 throw ENOENT，目標路徑本身不存在。若 throw EACCES，權限不足。

3. **Binary ENOENT 的 special case — path resolution fallback chain** — 當 execFileSync 接收 raw binary name（如 `'openclaw'`）而非完整路徑時，shell 環境變量可能未正確加載，導致 silent ENOENT。套用以下 fallback chain：
   ```javascript
   // Step A: 檢查已知路徑列表
   const knownPaths = [
     '/usr/local/bin/openclaw',
     '/opt/homebrew/bin/openclaw',
     process.env.HOME + '/.openclaw/openclaw',
   ];
   for (const p of knownPaths) {
     try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
   }
   // Step B: 嘗試 which 解析
   try {
     const whichPath = execFileSync('which', ['openclaw'], {encoding: 'utf8'}).trim();
     if (whichPath) return whichPath;
   } catch {}
   // Step C: 最後 fallback 到 raw name（讓 OS $PATH 最終嘗試）
   return 'openclaw';
   ```

4. **驗證 smoke test** — 在修復後，手動執行一次 target command 確認無 ENOENT：
   ```bash
   node -e "const {execFileSync}=require('child_process');console.log(execFileSync('openclaw',['gateway','status'],{encoding:'utf8'}))"
   ```
   若見 `No such file or directory`，回到步驟 3 確認路徑列表完整。

5. **檢查 exit code** — ENOENT 底層 shell error 會令 child_process exit code = 127（command not found）或 1（general error）。在 parent script 加入 `console.error('child exit:', code)` 以區分 ENOENT vs 其他錯誤。

## Pitfalls

- ⚠️ `execSync('node "' + scriptPath + '"')` shell-string pattern — 當 scriptPath 含空白或特殊字符時，shell 解析可能剝離引號導致 silent ENOENT。改用 `execFileSync('node', [scriptPath])` 完全避免 shell 解析。
- ⚠️ Raw binary name in execFileSync — 如 `execFileSync('openclaw', [...])` 在 cron isolated session 中 $PATH 未正確初始化，導致 silent ENOENT。必須先做 path resolution fallback chain（見 Workflow Step 3）。
- ⚠️ `>> .jsonl 2>&1` shell redirect in execFileSync args — execFileSync 的 args 陣列不支援 shell operators。將 redirect 加入 args 會被當作 command argument 傳遞，silent fail。改用 `--quiet` flag 或在 cron script 內部處理 output。
- ⚠️ ENOENT 不拋 exception — `fs.accessSync` 對應的路徑不存在時 throw ENOENT，但 `execFileSync` 的 binary ENOENT 只會令 child process exit with code 127，parent process 繼續執行。這是「隱性失敗」最常見形態。必須主動檢查 child exit code 或捕獲 stderr。
- ⚠️ Timeout 過短隱藏 ENOENT — 當 timeoutSeconds < agent LLM overhead + binary startup time 時，timeout error 會覆蓋底層 ENOENT。懷疑 ENOENT 時先將 timeout 升至 120s 再觀察。
- ⚠️ `node-fs-enoent-debugging` 的 smoking test 只驗證 fs 操作 — 若懷疑問題在 binary path 而非 fs 操作，直接用 `which <binary>` 和 `fs.accessSync` 隔離驗證，不要繞道 fs 層。
