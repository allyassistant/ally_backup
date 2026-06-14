---
name: cron-script-model-config-audit
description: 審計 cron job 與其內部調用的 script 或 sub-agent 之間的 model configuration 是否一致，避免 fallback chain 衝突和死循環
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T13:02:32.285Z
---

## Workflow

1. **列出 cron config 的 model 配置**
   - 打開 `/Users/ally/.openclaw/workspace/config/cron.ts` 或 cron config 文件
   - 記錄該 cron job 的 primary model 和 fallback chain

2. **識別 cron job 調用的內部 script**
   - 檢查 cron config 的 `command` 或 `run` 字段
   - 常見：`node /Users/ally/.openclaw/workspace/scripts/xxx.js`
   - 記錄所有 script 路徑

3. **審計每個 script 的 model configuration**
   - 對每個 script，搜尋以下 model 相關配置：
     - `const MODEL` 或 `const MODEL_FALLBACKS` 變量
     - `openclaw infer model run` 或 `openclaw inference run` 調用
     - `spawn_config` 中的 model 設置
     - `sessions_spawn` 調用中的 model 參數
   - 使用 `grep -n 'MODEL\|fallback\|model:'` 快速定位

4. **比對 cron config vs script config**
   - 建立對比表，列出每個層級的 primary model 和 fallback chain
   - 標記所有不一致之處：
     - ❌ Primary model 不同
     - ❌ Fallback chain 不同步（script 的 fallback 到達 cron 沒有的 model）
     - ❌ Token limit 不兼容的 model 在 chain 中（如 M2.5 有 max_tokens=196608 限制）

5. **檢查 fallback chain 中的 rate limit 衝突**
   - 如果 cron 和 script 使用相同 provider 的不同 model，檢查是否會同時使用導致 rate limit 碰撞
   - 特別注意 Minimax-portal 的 rate limit：同 provider 不同 model 共享配額
   - 使用 `cron-agent-llm-failure-mitigation` 技能進一步診斷

6. **修復不一致**
   - 修改 script 內的 model fallback chain 使之與 cron config 一致
   - 移除 fallback chain 中 token 不兼容的 model（如 M2.5）
   - 確保所有 fallback 路徑最終到達可用的 model
   - 使用 `model-migration-workflow` 技能進行安全的 model 遷移

7. **驗證修復**
   - 執行 `node check_script.js` 確保 syntax 正確
   - 如需，手動觸發 cron job 測試：`openclaw cron run <cron-id>`
   - 監控下一個排程週期是否成功執行

## Pitfalls

- **script 的 model config 與 cron config 完全獨立** — cron 配置的 fallback 不會自動應用到 script 內部。每個 script 有自己的 const MODEL_FALLBACKS 變量，必須單獨審計。
- **MiniMax M2.5 的 max_tokens 限制** — M2.5 不支持超過 196,608 tokens。如果 script 發送較大 context（如 sub-agent 調用），會導致 non-retryable error 中斷整個執行鏈，即使後續有 fallback model 也無法到達。
- **fallback chain 中的非 retryable error 會終止執行** — 某些 error（如 max_tokens 超限、auth 錯誤）被視為 non-retryable，腳本會 return 而不繼續 fallback，導致後續 model 永遠 reach 不到。
- **相同 provider 不同 model 的 rate limit 共享** — Minimax-portal 的 M2.7 和 M2.5 共享 provider-level rate limit。如果 M2.7 已觸發 rate limit，M2.5 也可能不可用，即使 M2.5 本身配額未耗盡。
- **sub-agent 的 model 配置與主 session 獨立** — 通過 `sessions_spawn` 生成的 sub-agent 有自己獨立的 model 配置。需要在 spawn config 或 script 中的 spawn 參數中檢查。
- **cron config 的 model 只控制 agentTurn session** — cron config 中的 model 設置只影響 cron job 的主 LLM session（agentTurn）。script 內部調用 `openclaw infer model run` 時使用自己的 model config 覆蓋。
