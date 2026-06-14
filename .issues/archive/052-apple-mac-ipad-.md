---
id: 052
title: Apple 翻新機監察器 (Mac + iPad) - 自動檢查新產品上架
status: archive
priority: P2
created: 2026-03-19
due: 2026-03-26
updated: 2026-04-02
progress: 2/3
---

## Description
創建 OpenClaw Cron Job，自動監察 Apple 香港官網翻新機頁面，當有新產品上架或下架時發送 Discord 通知。

**監察範圍：**
- Mac 翻新機: https://www.apple.com/hk-zh/shop/refurbished/mac
- iPad 翻新機: https://www.apple.com/hk-zh/shop/refurbished/ipad

**技術方案：**
- Job Type: OpenClaw Cron (isolated session)
- Model: ~~MiniMax-M2.5~~ **Ollama qwen2.5:3b** (已更新 - 避免 API 繁忙)
- Frequency: 每30分鐘 (*/30 * * * *)
- Timeout: ~~180秒~~ ~~300秒~~ **180秒** (Ollama 可能更快)
- Notification: Discord #🌐網站監察 (1483875735377805434)
- State Files: 
  - `memory/apple_refurbished_state.json` (Mac)
  - `memory/apple_ipad_refurbished_state.json` (iPad)

## Progress
- [x] 創建整合 Cron Job (Mac + iPad 合併)
- [x] 修復 Gateway reload 問題
- [x] 實際運行測試 (02:51 - 09:32)
- [x] 修復 timeout 問題
- [x] 分析卡住原因 (MiniMax API 繁忙)
- [x] 改用 Ollama (09:46)
- [ ] 🔄 **觀察 Ollama 穩定性**

## 重要教訓: Gateway Restart
⚠️ **每次改 cron/jobs.json 後需要 reload**，但應該一次過做晒所有改動先 restart：

**❌ 錯誤做法 (我之前):**
- 改一個設定 → restart → 改另一個 → restart → 再改 → restart
- 頻密 restart 可能打斷正在運行既 jobs

**✅ 正確做法:**
- 計劃好所有改動
- 一次過改晒所有設定
- 最後先 restart 一次

## 運行結果分析
| 時間 | 狀態 | 耗時 | 備註 |
|------|------|------|------|
| 03:07 | ✅ 成功 | 176秒 | MiniMax |
| 03:32 | ✅ 成功 | 160秒 | MiniMax |
| 04:03 | ✅ 成功 | 133秒 | MiniMax |
| 04:31 | ✅ 成功 | 75秒 | MiniMax (最快) |
| 06:01 | ✅ 成功 | 114秒 | MiniMax |
| 08:04 | ✅ 成功 | 143秒 | MiniMax |
| 09:32 | ✅ 成功 | 170秒 | MiniMax |
| 其他 7次 | ❌ Timeout | 180-300s | **MiniMax API 繁忙/卡住** |

**成功率**: 7/15 = 47%

## 問題分析
### 卡住原因
- 失敗時: error=None, summary=無摘要 → **Agent 根本冇開始處理**
- 可能原因:
  1. **MiniMax API 繁忙** (某些時段無響應)
  2. Browser 開啟卡住
  3. OpenClaw 內部資源爭用

### 解決方案 (09:46 實施)
✅ **改用 Ollama qwen2.5:3b** (本地免費，不受 API 影響)
- 減少對 MiniMax API 既依賴
- 本地運行更穩定 (理論上)

## 重要記錄
- 2026-03-19 02:45: 發現新 job 創建後需要 `openclaw gateway restart` 先識別
- 2026-03-19 08:35: 發現 timeout 180秒不足，成功運行需 75-176秒
- 2026-03-19 08:36: 更新 timeout 至 300秒
- 2026-03-19 09:32: 600秒 timeout 成功運行 (170秒)
- 2026-03-19 09:46: 分析卡住原因，改用 Ollama
- 2026-03-19 09:49: **記錄教訓 - 應該一次過改晒先 restart**

## 觀察項目 (新)
- [ ] Ollama 成功率
- [ ] Ollama 處理 browser 工具效果
- [ ] 實際運行時間
- [ ] 有無新產品檢測成功案例

## 問題修復
1. ✅ Gateway reload 問題
2. ✅ Timeout 調整
3. ✅ 分析卡住原因 (MiniMax API 繁忙)
4. ✅ 改用 Ollama

## 備用方案: Discord Bot API (09:56 更新)

### 背景
如果 Ollama 仍然唔穩定，可以考慮改用 **Discord Bot API** 直接發送，唔經 OpenClaw message tool。

### 兩種方式比較

| 方案 | 方式 | 優點 | 缺點 |
|------|------|------|------|
| **A (當前)** | OpenClaw `delivery.mode: announce` | 已整合、自動 retry、自動認證 | 依賴 OpenClaw gateway、之前遇過 sessionKey 混亂 |
| **B (備用)** | Discord Bot API / Webhook | 更直接、更快、易 debug | 要自己管理 Bot Token、要另外寫發送 code、自己處理 rate limit |

### 實施方案 B 所需工作
1. 創建 Discord Bot 或 Webhook
2. 攞取 Bot Token / Webhook URL
3. 改寫各個 script，用 `curl` 或 Node.js 直接發送
4. 處理 rate limit 同錯誤重試

### 決策
- **優先**: 維持方案 A (OpenClaw)，因為已修復 sessionKey 問題
- **如果仍然失敗**: 評估轉用方案 B (Discord Bot API)
- **評估時間**: 3月26日（同 Ollama 測試一齊評估）
