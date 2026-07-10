```skills-learned/cron-failure-investigation/SKILL.md
---
name: cron-failure-investigation
description: 調查 cron job failure alert 嘅系統性 workflow — 建 timeline、診斷 model/fallback、認清 root cause、向用戶報告
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T04:45:08.552Z
---

## Workflow

1. **接收 Cron Failure Alert** — 讀取 alert 內容，確認 cron job 名稱、失敗時間、錯誤訊息關鍵字
2. **建立 Timeline** — 併發讀取 cron job 原始 code + 最近一次 execution log，確認 failure 發生喺邊個 step
3. **檢查 Model/Fallback 配置** — 如果涉及 LLM call，確認 `model` 參數係咪 expected provider，並檢查 fallback chain 是否完整
4. **手動 Re-run 驗證** — 用 `openclaw gateway status` 確認 provider health，然後以 `--dry-run` 或直接執行 script 驗證問題是否仍存在
5. **認清 Root Cause** — 區分：
   - **Provider-side failure**：API outage、rate limit、auth issue → 匯報並等待 provider 恢復
   - **Script bug**：code logic error、missing dependency → 派 sub-agent fix
   - **Cron session limitation**：cron session 冇 LLM access → 見 ## Pitfalls Case B
6. **向用戶報告** — 清晰說明 root cause + 修復方案 + 預防措施（如有）
7. **後續跟進** — 如果涉及 migration（如 agentTurn → systemEvent），驗證 consecutiveErrors 已 reset、相關 cron 已更新

## Pitfalls

- **Case A: Provider-side vs Script Bug 混淆** — LLM API timeout 或 429 唔等於 script 有 bug。先確認 provider health 再懷疑 script。
- **Case B: Cron Session 冇 LLM Access** — agentTurn cron jobs 喺 cron session 內部行，但 cron session 本身唔支援 LLM call（`model` 參數被忽略）。如果 script 依賴 cron session LLM，會 silent fail 或行唔到。用 `systemEvent` + `main session` + `script self-notify` 模式替代。
- **Case C: LLM Fallback 返回 null 但 script 繼續跑** — 某些 scripts（如 `umbrella_consolidation.js`）喺 LLM call 失敗時會返回 `null`，然後走 heuristic fallback。呢個係預期行為，唔係 bug。如果想加雙 LLM fallback（如 M2.7 → DeepSeek V4 Flash），要改 `callLLMViaGateway` 嘅 catch block，但建議保持一行 fallback 就夠。

## LLM Fallback Chain 範例（weekly_correction_loop.js）
