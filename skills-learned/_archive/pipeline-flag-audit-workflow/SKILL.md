---
name: pipeline-flag-audit-workflow
description: 審計 cron pipeline 中已實現但未實際使用的 flags，區分「代碼實現」與「runtime 啟用」狀態
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T14:32:50.684Z
---

## Workflow

1. **收集 pipeline 基本資訊**
   從 cron ID 或 script path 取得：
   - Cron 啟用狀態、最後運行時間、consecutive errors
   - Script 檔案路徑、總行數
   - 目前使用的 model
   - 已實現的 flags (`process.argv.includes('--flag')` 模式)

2. **對比 code vs. cron invocation**
   - 讀取 script 原始碼，列出所有 `--flag` 定義位置（line number + flag name）
   - 查詢 cron job 的 actual invocation command（如 `openclaw cron run <id>` 或 cron config）
   - 對每個 flag：code 有 → cron 有冇傳？

3. **識別「已實現未啟用」的 flags**
   - 記錄每個 flag 的：code 行數、injection 位置（如 line 799-800）、用途描述
   - 分類：P0（安全網）、P1（功能增強）、P2（可選優化）
   - 評估：flag 冇傳入時，pipeline 是否已有其他安全層？

4. **評估 flag 的實際安全覆蓋**
   - 如果 `--verify-after-write` 冇傳，但 `skill_reviewer_bot.js` 的 P0 Integrity Gate 已做 post-write validate_skill_file.js → flag 是冗餘的 defense-in-depth
   - 如果 flag 是唯一的安全層 → 確認 cron invocation 需要補傳

5. **生成審計報告**
   包括：Pipeline Health Score、Flag Status Table（code/cron/status）、發現摘要、recommended actions

6. **向 user 報告結論**
   - Discord 簡報：發現了幾多個 flag，邊個真正在用，邊個係冗餘安全層
   - 建議：即時修、聽日修、還是保持現狀

## Pitfalls

- **唔好假設「已實現 = 已啟用」** — M3 sub-agent 審計發現 `--verify-after-write` 在 119 次 runs 中從未傳入，但代碼已完整實現。這是常見的 implementation drift。
- **唔好只睇 code 行數** — 要完整 trace cron invocation 才能確認 flag 是否真的傳入。直接問 cron config / 查 logs。
- **唔好因為 flag 冇用就刪除** — 如果有其他 safety layer 做同樣的事，flag 可能是 defense-in-depth，保留係穩健的。
- **唔好忽視 injection point** — 看 line 799-800 的 `VERIFY_AFTER_WRITE_SECTION` injection pattern，但 flag 冇傳入時 injection 根本唔會發生。
- **唔好假設所有 flags 都值得追蹤** — 只有影響 safety 或 correctness 的 flags（P0/P1）值得列入審計報告。P2 優化 flags 可以 skip。

## References

- 相關 skill: `cron-job-testing` — 測試 cron timing 和 fallback 行為
- 相關 skill: `deep-research-subagent-spawning` — 如何正確 spawn M3 sub-agent 做深度分析
- 相關 skill: `skills-audit-workflow` — 完整的 skill-reviewer 操作循環
