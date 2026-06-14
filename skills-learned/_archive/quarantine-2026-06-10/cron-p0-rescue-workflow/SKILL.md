```skills-learned/cron-p0-rescue-workflow/SKILL.md
---
name: cron-p0-rescue-workflow
description: Cron failed alert 觸發 P0 jobs 搶救流程——識別、派 sub-agent 迁移 agentTurn→systemEvent、驗證 consecutiveErrors reset
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T04:32:47.714Z
---

## Workflow

### Trigger：Cron failed alert 出現

1. **建立 Issue** — 讀取或創建對應 Issue（如 KB Ingest cron 的 Issue 142），填入 F/D/Q/P 四層結構
2. **識別 P0 jobs** — 跑 `openclaw cron list` 找 `consecutiveErrors ≥ 3` 的 jobs，這些係 LLM cold-start fail 的明顯候選人；配合 conv 11 教的方法：睇 `lastError` 含 "LLM request failed" 即死因明確
3. **派 Sub-agent 做 Migration** — `sessions_spawn` depth 1/1 的 M3 sub-agent，task 包含完整 migration plan；唔好喺 main session 做，sub-agent 結果 auto-announce
4. **Sub-agent 執行 Migration**（每個 job 逐一做）：
   - `exec` → `cat` 或 `ls` 確認 cron 指令的 script 存在（防止 phantom job）
   - `exec` → 跑 `openclaw cron list --json` 或 `openclaw cron get <id> --json` 拎 cron ID
   - `exec` → `openclaw cron edit <id> --session main --system-event "<event>" --description "cron: <job name> (systemEvent)"` 將 `sessionTarget: isolated` + `payload.kind: agentTurn` 改為 `sessionTarget: main` + `payload.kind: systemEvent`
   - `exec` → `openclaw cron run <id> --wait` 手动 trigger test，確認 `status: ok` 且 `consecutiveErrors` 重置為 0
5. **清理 systemEvent text** — 如果 migration 後 systemEvent text 包含舊有的 script output（例如 CQM 輸出咗 help text），用 `openclaw cron edit <id> --system-event "..."` 寫番乾淨嘅 description（格式：`cron: <job name> (systemEvent)`）
6. **Yield + 報告** — `sessions_yield` 等 sub-agent 完成，主 session 彙總 migration report

## Pitfalls

### ⚠️ Layer 2 LLM Call 陷阱
Scripts 內部可能用 `execSync('openclaw agent --local --model ...')` 跑 LLM（conv 11 發現 `umbrella_consolidation.js` 咁做）。呢個係 **script 內部 LLM**，唔喺 cron config 中可見。單靠 systemEvent migration 只能移走 Layer 1（cron agent LLM），Layer 2 仍受 provider 影響。Migration 前必須 `cat` script source code 確認冇 internal LLM call。如果有，script 本身需要 refactor。

### ⚠️ Phantom Job 陷阱
Cron job 跑成功但 script 不存在的話，`cron run --wait` 會 show `status: ok`，但其實冇任何產出。Migration 前必check script 存在：`ls ~/.openclaw/workspace/scripts/<name>.js`。如果 script 唔存在，優先修復 script 再迁移。

### ⚠️ Consecutive Errors 未 Reset
即使 migration 完成，`consecutiveErrors` 計數唔會自動清零。必須手動 `cron run --wait` 一次，確保 `lastRunStatus: ok` 才算完成救亡。

### ⚠️ toolsAllow 未同步
原本 agentTurn job 的 `toolsAllow: ["exec"]` 遷移到 systemEvent 後仍適用，但建議 migration 後確認冇殘留 `toolsAllow: ["*"]` 或其他奇怪配置。

### ⚠️ systemEvent Text 污染
Migration 後 `lastRun.text` 可能包含 script 的 stdout（例如 `node script.js --help` 的輸出），呢啲唔應該留喺 systemEvent description。Migration 後 review 并清理。

## 參考 KB Ingest Migration（Conv 2, 10）
