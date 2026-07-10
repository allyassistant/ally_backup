---
name: cron-thin-executor-migration
description: 將依賴 cron session agent LLM 嘅脆弱 agentTurn cron jobs 轉換為穩健嘅 thin executor（Type B → Type A）嘅系統性工作流程
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T19:33:00.000Z
---

## Workflow

1. **識別 Target Cron Jobs**
   - 找出 `consecutiveErrors ≥ 1` 嘅 cron job，尤其係用 `model: deepseek-v4-flash` + verbose Chinese message 嘅
   - 目標特徵：`message` 欄位係多行中文指令，冇明確 `node <script>` command
   - 典型失敗訊息：`LLM request failed` / `Provider unavailable`

2. **分析現有 Script 存在性**
   - 用 `cron get <id>` 拎 cron config
   - 檢查 `message` 中提及嘅 script 是否存在
   - **注意陷阱**：message 可能指向唔存在嘅 script（例如 `weekly_correction_loop_bot.js` 但實際 file 係 `weekly_correction_loop.js`）

3. **API Discovery（如果需要新建 Script）**
   - 先嘗試 JSON API endpoint：`curl -s "https://<domain>/api/..."`
   - 如果係 Next.js RSC redirect，搵 RSS feeds：檢查 `<head>` 中嘅 `link[type="application/rss+xml"]`
   - RSS feeds 通常係 `/feed.xml`、`/feed/daily.xml` 等穩定路徑

4. **Create Self-Contained Script**
   - 用 Node.js built-in modules（`https`、`fs`、`path`）— 唔好裝 external deps
   - Script 結構（標準 thin executor template）：

   ```javascript
   #!/usr/bin/env node
   /**
    * <name>.js - <一句話描述> (thin executor)
    *
    * 用法: node scripts/<name>.js [--flag VALUE]...
    * 失敗 exit 1 (stderr); stdout 純輸出。
    */

   'use strict';

   // 1. built-in modules only
   const https = require('https');
   const fs = require('fs');
   const path = require('path');

   // 2. help text + arg parse
   if (process.argv.includes('--help') || process.argv.includes('-h')) {
     console.log('Usage: node scripts/<name>.js [--flag VALUE]');
     process.exit(0);
   }

   function parseArgs() {
     const args = process.argv.slice(2);
     const out = { /* defaults */ };
     for (let i = 0; i < args.length; i++) {
       if (args[i] === '--flag' && args[i + 1]) {
         out.flag = args[i + 1];
         i++;
       }
     }
     return out;
   }

   // 3. main() — async if I/O, sync if pure compute
   async function main() {
     const opts = parseArgs();
     // ... do work ...
     // 用 console.error 記 fail, console.log 記 success output
   }

   main().catch(err => {
     console.error('FATAL:', err.message);
     process.exit(1);
   });
   ```

   - 參考實作：`scripts/ai_hot_push.js`（RSS + dedup）、`scripts/memory_generator.js`（parameterized）、`scripts/knowledge_ingester.js`（standalone ingest）
   - **State files** 用 `path.join(__dirname, '..', '.<name>_state.json')` 持久化（cron runs fresh 每次）

5. **Migration Deployment**
   - **Backup 原 cron config**：`openclaw cron get <id> > /tmp/cron-<id>-backup.json`（rollback 必備）
   - **改 cron payload**：
     ```json
     {
       "kind": "agentTurn",
       "message": "node scripts/<name>.js [--flag default]"
     }
     ```
     - 保留 `kind: "agentTurn"`（最快 migration path）但 `message` 變成 node command — cron 會 spawn 個 fresh sub-shell 跑 script，繞過 LLM 環節
   - **更新 schedule / model**：其他 fields（`schedule`、`failureAlert`）保持不變
   - **Test run**：`openclaw cron run <id>` — 唔好直接 `node scripts/<name>.js`（env 唔同：cron 環境冇 interactive shell）
   - **Monitor first run**：跑完即刻 `openclaw cron get <id>` 睇 `consecutiveErrors` 應該 = 0，`lastRun` timestamp 更新

6. **Rollback Plan**
   - 如果 thin executor 連續 2-3 次 fail：
     - **唔好即刻刪 script** — 可能係 script bug，唔係架構錯
     - 撈 logs 查 root cause（`journalctl --user` 或 cron output log）
     - 用 backup `/tmp/cron-<id>-backup.json` 還原
   - **還原步驟**：
     ```bash
     # Restore original Type B message
     openclaw cron update <id> --message "$(jq -r '.message' /tmp/cron-<id>-backup.json)"
     ```
   - **記低失敗原因** 入 issue（`scripts/issue_manager.js create`）— 之後 re-migration 唔好 repeat mistake
   - 保留 backup file 直到 migration 穩定 7 日後先刪

7. **Long-term Monitoring**
   - **Day 1, 3, 7 checkpoint**：用 `openclaw cron get <id>` 連續 check 7 日，確認 `consecutiveErrors = 0`、`lastRunStatus = ok`
   - **Fallback trigger 預期下降**：原本 Type B 偶發 `LLM request failed` / `Provider unavailable` 應該完全消失（thin executor 唔過 LLM）
   - **如缺 `failureAlert`**：建議加，例 `failureAlert: { consecutive: 3, channel: "discord", target: "#⚙️系統" }`
   - **歸檔 Type B 原始 message**：抄入 issue note 歷史，標明「已 migrate 到 thin executor，原 message 歸檔」
   - **觀察 metrics**：用 `node scripts/router/report.js --days 7` 比較前後 failure rate

## Pitfalls

- ⚠️ **Node.js built-in modules only** — thin executor 跑喺 cron 嘅 restricted context，**唔可以** `npm install` external deps。預設用 `https`、`fs`、`path`、`crypto`、`url` 就夠。例外：`dotenv` 已經係 workspace 全域 require，可以直接用。
- ⚠️ **Error logging 必須用 `console.error`** — cron capture stderr 嘅 failure log，但 stdout 留俾正常 output。`console.log` 用喺 error 會被當成功，alert 系統唔 trigger。
- ⚠️ **冇 long-lived state** — thin executor 每次 cron cycle 都 fresh process，**唔可以靠 in-memory state**（e.g. Map、Set）。要 persistence 就用 `path.join(__dirname, '..', '.<name>_state.json')`，參考 `.ai_hot_seen.json` FIFO pattern。
- ⚠️ **Test 必須用 `openclaw cron run <id>`** — **唔好**直接 `node scripts/<name>.js` 測。Cron 環境同 interactive shell 唔同：冇 TTY、env vars subset、working directory 唔同。直接跑可能 pass 但 cron run fail。
- ⚠️ **Fallback detection 預期消失** — 如果原 message 用 `model: deepseek-v4-flash`，偶發 `LLM request failed` / `Provider unavailable` 係 expected。Thin executor 唔過 LLM，呢類 error **應該完全消失**。如果 thin executor 仲見到呢類 error，check 吓 script 入面有冇 `sessions_spawn` 之類嘅 LLM call。
- ⚠️ **Migration 後保留 7 日 backup** — `/tmp/cron-<id>-backup.json` 唔好即刻刪。如果 thin executor 有 subtle bug（例如時區問題、state file race condition），rollback 速度越快越好。
- ⚠️ **避免 `process.exit(0)` 喺 async code 中途** — 提早 exit 會 skip `fs.writeFileSync` 等 cleanup，state file 可能 corrupt。統一喺 `main().catch()` handle exit code。
