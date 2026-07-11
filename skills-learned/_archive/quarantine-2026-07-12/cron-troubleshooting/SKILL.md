---
name: cron-troubleshooting
description: "Diagnose cron failures via timeline and issue isolation. Use when: cron fails, timeline needed, root cause unclear. Key capabilities: timeline construction, issue isolation, rerun verification."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T11:34:04.932Z
---

## Workflow

1. **Read cron job definition** — `crontab -l` 或 `~/.openclaw/workspace/.cron_config.json` 確認 job 係邊個 script、model、timeout setting

2. **Read recent cron history** — `~/.openclaw/workspace/.cron_history.jsonl` 拎最近 20 條記錄，找同一 job 嘅重複 failure pattern

3. **建 Timeline** — 按時間序排列 failure，標注：
   - 同一 job 係 consistently failing 定 intermittent
   - Failure phase（parsing/config/llm-call/complete）
   - Error message 關鍵字（timeout/rate-limit/auth/parse）

4. **區分問題層次**：
   - **Provider 問題**：rate limit、overload、auth token expired → 等 60s 重試
   - **Script 問題**：parse error、missing dependency、syntax → 直接修 script
   - **Session 問題**：同 model 其他 session 撞 resource → 查 concurrent session 數
   - **Timeout 問題**：model call 太慢，timeout threshold 太低 → 睇 `maxDuration` 設定

5. **手動 rerun 驗證** — 對住同一 job 跑一次：
   ```bash
   node /path/to/cron_script.js --dry-run
   ```
   睇係一次性 定 consistent failure

6. **LLM failure mitigation**：
   - 如果係 timeout → 降低 `maxTokens` 或加 `timeoutMs`
   - 如果係 rate limit → 加 `retryDelayMs` 或换 model
   - 如果係 overload → 等 5 分鐘再試

7. **驗證修復** — 跑 2-3 次確認穩定，update cron job config

## Pitfalls

- **Morning cron model-call-started timeout**：Daily Synthesis 等 heavy cron 成日喺早上撞 provider 開工高峰期，出現 "last phase: model-call-started" timeout，但重試 2-3 次就成功。這係 **resource contention** 模式，唔係 script bug。加長 timeout threshold（`timeoutMs: 180000`）或設定 jitter delay 避開高峰期。

- **同 model concurrent session 撞車**：main session + cron 同時用同一 model 會觸發 rate limit collision。檢查 `concurrent-session-rate-limit-avoidance` skill 確認有無 isolation 設定。

- **Session history truncated**：M3 sub-agent 的 session history 可能被 truncation，完整 output 喺 inter-session message 入面。用 `sessions_history` 拎 output，再用 `exec` 讀取 `.spawn/reports/` 入面嘅 saved report。

- **Auto-retry 誤判為 success**：cron framework 自動重試可能令你以為 "eventually succeeded"，但其實每次都在浪費 quota。檢查 cron history 入面所有 attempt timestamp，確認係重試定單次成功。

- **只看 error message 唔追 timeline**：錯誤訊息往往係 second-order effect（timeout 係因為 queue 太長，唔係 model 慢）。一定要從 timeline 入手，唔係從 error message。

- **忽略 provider health dashboard**：Minimax portal 有 `/status` 頁面顯示當前負載，早上高峰期可能顯示 degraded，但 cron script 唔會自動睇到。加呢步到 triage workflow。

- **模型 swap 後唔更新 cron config**：model migration 後 cron job 內部 model config 可能 drift。用 `cron-config-audit` skill 驗證一致性。

- **Thin executor cron 無 LLM fallback**：Type B thin executor cron 唔支持 LLM fallback，如果 primary model fail 會直接 timeout。確認 cron 係 Type A 定 Type B，Type B 需要手動 fallback logic。

- **搞混 session 問題同 provider 問題**：如果同一 model 其他 session 正常，只有 cron fail，咁係 session-level 問題（queue position、context length），唔係 provider 問題。

- **唔驗證修復就宣佈完成**：跑 2-3 次確認穩定，唔係一次成功就當修好。
