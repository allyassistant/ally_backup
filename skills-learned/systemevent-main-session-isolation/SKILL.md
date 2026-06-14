---
name: systemevent-main-session-isolation
description: 將 systemEvent cron 從 main session 遷移至 isolated session，並清理殘留 sessionKey
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T01:35:00.000Z
---

## Workflow

1. **識別 cron sessionKey 殘留** — 用 `openclaw cron list` 列出所有 cron，標記仍有 `sessionKey` 且不應有的項目。重點檢查 `delivery.mode: "none"` 或已遷移至 `isolated` 模式的項目。

2. **分類出清除風險** — 依 delivery mode 分類：
   - `delivery.mode: "none"` — 無輸出交付；純 cron 任務，最適合清除 sessionKey
   - `announce` — 任務完成後將輸出推送至 Discord 頻道；可能需 sessionKey'
   - `agentTurn` + `isolated` — 已在獨立的唯讀工作階段中執行；清除 sessionKey 無須顧慮

3. **確認 cron 不依賴 sessionKey 進行輸出交付** — 若 cron 在完成後將輸出推送至特定頻道（例如 announce delivery mode），sessionKey 用於跨工作階段路由。在清除前先確認是否存在其餘依賴。

4. **嘗試 patch 清除** — 用 `openclaw cron update <jobId> --sessionKey ""` 或 `openclaw cron update <jobId> sessionKey=null`。驗證 patch 是否生效。

5. **如果不能清除，刪除並重建（可靠性高）：**
   - 讀取 cron 配置：`openclaw cron get <jobId>` → 記下 config JSON
   - 刪除：`openclaw cron delete <jobId>`
   - 重建不含 sessionKey 的 cron：`openclaw cron create ...`（使用原始 config 但省略 sessionKey）
   - 驗證：`openclaw cron list | grep <jobId>` 確認新 cron 存在且無 sessionKey

6. **驗證清理** — 確認 cron 執行無異常：
   - cron run 成功且 `consecutiveErrors == 0`
   - 無 sessionKey 殘留於 `agentTurn` / `isolated` cron
   - 所有輸出交付正常（若有）

7. **（若適用）清理其他 cron 的 sessionKey** — mass-cleanup：對所有同類 cron 重複步驟 4-6。對於無 announce 模式的類別，batch delete + recreate 以節省時間。

8. **紀錄快照** — 將變更寫入記憶：更新 cron sessionKey count、受影響的 cron 名稱、清理後驗證狀態。

## Pitfalls

- 🚩 **patch 對 sessionKey 無效** — `openclaw cron update` 不接受 `""` 或 `null`；實際效果是，value 不變。必須使用 delete + recreate
- 🚩 **announce cron 需要 sessionKey** — 若 cron 使用 announce delivery mode（輸出推送至 Discord，例如 Daily Synthesis），清除 sessionKey 會中斷推送。清除前先將 delivery mode 切換至 `none` 或改為 direct API call
- 🚩 **gateway restart catch-up 觸發衝突** — 若多個 cron 共用 sessionKey，gateway 重啟後同時 catch-up 可能導致速率限制衝突。使用 isolated session + 分開 sessionKey（甚至無 sessionKey）來降低此風險
- 🚩 **delete + recreate 可能遺失 cron ID 引用** — 若某處硬編碼了 cron ID（例如 gateway config、其他 script），delete 後重建會變更 ID。不過 cron 名稱不變，無此風險

## References

無需外部引用。所有命令均基於 OpenClaw CLI（`openclaw cron`）。
