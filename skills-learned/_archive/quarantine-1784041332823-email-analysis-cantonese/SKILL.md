---
name: email-analysis-cantonese
description: 驗證 email 工具輸出，提取內容後以廣東話撮要，並過濾空主體與系統噪音。當 email 抵達但主體為空時，先檢查附件再判斷是否需要通知用户。
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-14T14:47:19Z
---

## Workflow

1. **捕獲 email 工具輸出。**
   email 工具回傳 JSON：提取 `subject`、`sender`、`body`（可能為空字串）。如果 `body` 長度為 0 且無附件，視為空郵。

2. **空主體判斷流程。**
   - 若 `body.trim() === ""`：
     - 檢查 `attachments` 欄位是否有檔案
     - 有附件 → 讀取附件內容或告知用户「有空附件」
     - 無附件 → 直接以廣東話回覆一句，例如：「📭 呢封郵件冇正文，寄件人：XXX，主題：XXX，暫時冇野要跟進。」**唔好發 HEARTBEAT_OK**。
   - 若 `body` 有內容 → 繼續步驟 3。

3. **提取重點（Rapaport/Stock List/其他）。**
   根據 `subject` 判斷郵件類型：
   - 含「Rapaport」或「Price List」→ 提取價格指數趨勢
   - 含「Stock List」→ 提取貨品數量或關鍵狀態
   - 其他 → 提取頭 3 個最重要嘅資訊點

4. **生成廣東話撮要。**
   輸出 2–3 句，唔超過 100 字。用口語化廣東話，避免官腔。格式：
