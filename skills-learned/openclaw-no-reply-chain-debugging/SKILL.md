---
name: openclaw-no-reply-chain-debugging
description: 系統性追蹤 OpenClaw NO_REPLY silent delivery 機制的源代碼 chain，診斷訊息傳遞異常
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T16:10:00.000Z
---

## Workflow

1. **確認問題現象**
   - 預期：Bot 回覆 NO_REPLY 後不發送任何訊息
   - 實際：Bot 發送了一個 standalone message（如純「👍」或其他非預期內容）
   - 檢查 Discord message API 回應，確認訊息類型（type: 0 = default, flags: 4 = bot message）

2. **定位 Token 定義**
   - 讀取 `tokens-*.js` 文件查找 `SILENT_REPLY_TOKEN` 定義
   - 確認標準值為 `"NO_REPLY"`（非 `***` 或其他變體）
   - 記錄找到的精確值

3. **追蹤 Strip 邏輯**
   - 在 `pending-final-delivery` 相關源文件中查找字串替換邏輯
   - 確認 strip 目標為找到的 `SILENT_REPLY_TOKEN` 值
   - 驗證 strip 結果應為空字串 `""`

4. **檢查 Admission 層**
   - 在 `reply-turn-admission` 相關代碼中確認 `{ skip: true }` 行為
   - 當 payload 為 empty string 時應 skip delivery

5. **驗證 Delivery 層**
   - 在 `reply-delivery` 或 `pending-final-delivery` 中確認：
   - `payloads.length === 0` 時直接 return，不發送
   - 若有 standalone message，payload 非空 → delivery 執行

6. **診斷 Root Cause**
   - 若模型輸出不包含 NO_REPLY token → 模型問題（如 memory flush turn 中模型行為異常）
   - 若 strip 邏輯未匹配 → token 定義不一致
   - 若 delivery 層未阻擋 → payload 判定邏輯 bug

7. **排查 Sub-agent 特殊情況**
   - Sub-agent session 可能使用不同模型配置
   - 檢查 sub-agent 的 spawn_config 中的 model 設定
   - 確認 sub-agent 模型是否與 main session 一致

8. **檢查 Teams Reaction Mapping**
   - 在 `src-*.js` 中可能存在 `like: "👍"` 的 Teams reaction 映射
   - 此為 MS Teams 特有，不應影響 Discord 行為
   - 確認使用的是正確的 platform mapping

## Pitfalls

- **Sub-agent Token 值錯誤**：Sub-agent 源代碼中可能定義了錯誤的 `SILENT_REPLY_TOKEN` 值（如 `"***"` 而非 `"NO_REPLY"`），導致 strip 邏輯失效
- **Memory Flush Turn 模型行為**：在 memory flush 過程中，模型可能輸出「👍」而非 NO_REPLY，特別是 sub-agent session 或 isolated session 場景
- **Platform Mapping 混淆**：`like: "👍"` 是 Microsoft Teams 的 reaction mapping，不應被誤認為 Discord 行為
- **Token Strip 不一致**：不同源文件可能定義不同的 token 值，導致 strip 目標與實際輸出不匹配
- **Delivery 層 payload 判定**：若 payload 非严格 empty（如包含空白字元），可能繞過長度檢查
- **Isolated Session 模型不穩定**：依賴 cron isolated session LLM 的場景更容易出現模型輸出異常

## Reference: Known NO_REPLY Chain Files

| 層 | 檔案模式 | 關鍵內容 |
|---|---------|---------|
| Token 定義 | `tokens-*.js` | `SILENT_REPLY_TOKEN = "NO_REPLY"` |
| Strip 邏輯 | `pending-final-delivery` | strip token → empty string |
| Admission | `reply-turn-admission` | `{ skip: true }` when empty |
| Delivery | `reply-delivery` | `payloads.length === 0 → return` |
| Teams Mapping | `src-gw7eSq0a.js:2926` | `like: "👍"` (Teams only) |

## When to Use This Skill

- Bot 發送非預期的 standalone message（如純 emoji）
- NO_REPLY token 未生效，訊息仍被發送
- Memory flush 後出現異常訊息
- Sub-agent session 出現訊息傳遞異常
- 需要理解 OpenClaw silent delivery 機制的內部運作
