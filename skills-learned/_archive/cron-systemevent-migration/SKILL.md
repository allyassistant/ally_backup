---
name: cron-systemevent-migration
description: 將 cron jobs 從 systemEvent+main session 遷移至 agentTurn+isolated+thin executor，包含多 session 協調與 batch progress 追蹤
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T02:35:00.000Z
---

## Workflow

1. **Audit all cron jobs** — 掃描 OpenClaw config 同 HEARTBEAT.md，列出所有 systemEvent+main session cron jobs
   - 分辨「純 exec script」（可 thin executor）與「有 LLM dependency」（需 agentTurn）
   - 標記每個 job 嘅 schedule、type、Dependencies

2. **Categorize migration priority** — 按影響分三級：
   - P0: 產生 💓/👍 殘留嘅高頻 job（每 2h / 每 30min）
   - P1: 每日執行但會污染 main session 嘅 job
   - P2: 低頻 job 或已 stable 嘅 job

3. **Batch execution (3 jobs per session)** — 每次 session 遷移 3 個 cron jobs，避免 single session 過長：
   - 逐個改 config（systemEvent→agentTurn, main→isolated）
   - 每個 job 改完後立即驗證 queue 狀態
   - 更新 HEARTBEAT.md 嘅對應記錄

4. **Track batch progress in issue** — 建立 tracking issue（格式 F/D/Q）：
   - **Findings**：記錄 audit 結果、每個 job 嘅 before/after state
   - **Done**：記錄已遷移 job 同驗證結果
   - **Queue**：記錄剩餘 job 同排程建議
   - 每次 session 結束前更新 issue，確保下個 session 可 resumption

5. **Session handoff** — 用明確嘅 resumption question 結尾（例如「仲有 2 個未搞：System Check 同 Daily Summary，要繼續定下次先？」）
   - 記錄當前 batch 嘅 session ID 同完成進度
   - 在 issue 加「Next step」section

6. **Multi-session coordination** — 當回歸同一 task 時：
   - 檢查 issue 嘅 Done/Queue 狀態
   - 從 queue 取出下一批（通常 3 個）
   - 繼續 step 3，保持 batch size 一致

7. **Final verification** — 所有 job 遷移完成後：
   - 監控 24-48h 確認零 💓/👍 殘留
   - 更新 issue 做 success metric 驗證
   - 清理舊 systemEvent config backup（可選）

8. **Document remaining jobs** — 記錄無法遷移嘅 jobs（如有 LLM dependency 且必須 main session）同原因

## Decision Points

- **當 user 問「要繼續定下次先？」** → 永遠建議「下次先」，保留 session 長度可控
- **batch size 調整** — 如果 job 好複雜（有 sub-agent dependency），減至 2 per session
- **如果 user 中斷** — 立即更新 issue，確保下次可 resumption

## Pitfalls

- 🚫 **不要一次遷移超過 3 個 jobs** — session 會太長，增加 context overflow 風險
- 🚫 **不要依賴記憶** — 每次 migration session 都要更新 issue，唔可以靠「我記得上一次做咗」
- 🚫 **唔好漏 HEARTBEAT.md** — 改 config 後一定要同步更新 HEARTBEAT.md 嘅 job list，否則下次 auditor 會 mismatch
- 🚫 **跳過純 script job** — 如果 job 係純 exec script（冇 LLM），確認 thin executor 模式後先 migration，唔好 default 用 agentTurn
- 🚫 **唔好單獨留低一個 job** — 每次 batch 要完整完成 3 個，唔好做一半就停
- 🚫 **忽略 queue 檢查** — 改 config 後要用 `openclaw cron list` 或 queue API 確認 job 已正確註冊
- 🚫 **唔好自動建立 issue** — 如果已有 tracking issue (如 #144)，先讀取現有進度再決定 batch，避免 duplicate

## References

- `systemevent-main-session-isolation` — 診斷 💓/👍 殘留問題嘅詳細 workflow
- `cron-thin-executor-migration` — 將 agentTurn job 轉 thin executor 嘅 workflow（Type B → Type A）
- `.issues/active/` — 存放 tracking issue 嘅目錄
