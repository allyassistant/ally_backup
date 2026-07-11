---
name: pipeline-llm-call-timeout-debugging
description: "Diagnose LLM call timeouts with empty queue guard pattern. Use when: pipeline times out, queue blocks, guard needed. Key capabilities: timeout tracing, queue pre-check, guard enforcement."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T00:37:35.077Z
---

## Workflow

1. **Identify the stuck phase**
   - 檢查 cron job timeout error message 中嘅 `last phase` 欄位
   - 例如：`last phase: tool-execution-started` 表示 pipeline 停喺某個 tool/script 執行階段

2. **Read the pipeline script**
   - 用 `exec` 讀取 pipeline 主脚本（例如 `skill_reviewer_pipeline.js`）
   - 搵出 `execSync` / `execFileSync` / `spawn` 等 blocking call
   - 注意 `execSync` 係阻塞式，會卡住直到 LLM 回覆或超時

3. **Check queue state before assuming LLM is the bottleneck**
   - 讀取 queue 檔案（例如 `.skill_review_queue.jsonl`）
   - 確認 queue 係咪 empty — 如果係，但 pipeline 仍然觸發 LLM call，呢個係空 queue guard 缺失
   - Archive count（例如 1913 entries）可以幫助判斷係咪 cleanup phase 已完成

4. **Identify if the LLM call is conditional or unconditional**
   - 如果 LLM call 係無條件觸發（例如 `openclaw infer model run` 寫死喺 script 裏面），就算 queue 係 empty 都會執行
   - 呢種情况係 timeout 嘅根本原因 — 浪费 300s 等 LLM response，但實際上冇野需要分析

5. **Add empty-queue pre-check guard（如果係你自己的 script）**
   - 在觸發 LLM call 之前加 check：
   ```javascript
   const queueStat = fs.statSync(QUEUE_FILE);
   if (queueStat.size === 0) {
     console.log('[pipeline] Queue empty — skipping LLM phase');
     return; // 或跳到下一個 phase
   }
   ```
   - 呢個 guard 可以省卻 300s blocking timeout，讓 pipeline 快速完成

6. **Handle timeout if LLM call is still running**
   - 如果你唔可以修改 script，但 pipeline 正在 timeout，檢查 `openclaw infer model run` 嘅 timeout 設定
   - Node.js `execSync` 可以加 `timeout: <ms>` 參數；`300000` = 5 分鐘
   - 如果係 cron 觸發，可以考慮縮短 timeout 或加 `--quiet` flag 減少 output

7. **Verify pipeline completion**
   - Run pipeline 手動一次，確認唔會再卡喺 LLM call 階段
   - 檢查 output files（例如 `skills-learned/` 目錄嘅變化）確認 pipeline 正常產出

## Pitfalls

- ⚠️ **Queue empty 但仍然觸發 LLM call** — 浪费 300s timeout waiting for LLM when there's nothing to process. 解决：加空 queue pre-check guard
- ⚠️ **混淆 pipeline phase 和 cron phase** — cron timeout error 顯示 `tool-execution-started`，但問題可能喺 script 內部 LLM call，唔係 cron 本身
- ⚠️ **Archive entries 多唔代表 queue 有野** — cleanup phase 執行完（archive 1913 entries）但 queue 仍然 empty，呢個係正常状态，唔需要再跑 LLM
- ⚠️ **`execSync` 阻塞特性** — 同時觸發多個 `execSync` 會造成死鎖；使用 `execFileSync` + args array 係更安全嘅替代方案
- ⚠️ **忽略 `--quiet` flag** — pipeline script 可能預設 output verbose，加上 `--quiet` 可以减少 I/O wait，特別喺 cron 環境

## Related Skills

- `cron-troubleshooting` — 診斷 cron job failure，建 timeline、區分 provider/script/session 問題
- `skills-audit-workflow` — skill-reviewer agent 完整操作循環，包括 queue 讀取和 cleanup
- `llm-call-execfile-migration` — 將 `execSync` shell-string 遷移到 `execFileSync` + args array
