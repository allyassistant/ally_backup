---
id: 006
title: Discord Session Compaction Timeout 導致 Gateway 重啟 (已解決)
status: archive
priority: P2
created: 2026-02-23
due: 2026-03-10
updated: 2026-03-10
progress: 5/5
---

## 問題
Discord Session Compaction Timeout (600秒) 導致 Gateway 頻繁重啟，影響 L0/L1 生成

## 相關 Issues
- **#027** (已 merge): 600秒 timeout 重啟問題 - 同根因

## 調查結果 (2026-03-07)

### 🔍 根本原因
**Discord Session Compaction Timeout - 600秒上限**

| 指標 | 數值 |
|------|------|
| 總重啟次數 (Mar 3-6) | 186 次 |
| WhatsApp 重啟 | 121 次 |
| Discord 重啟 | 65 次 |
| 主要原因 | `stale-socket` + `stuck` |

### 🚨 問題 Session
- **Session ID**: `ead3cbd5-8c71-4942-8817-e72fcb238c31`
- **文件大小**: 10.5 MB (3,956 行)
- **持續時間**: 2026-02-26 至 2026-03-06 (8 日)
- **導致**: 每次 compaction 超時 600 秒

### 📊 時間線

| 日期 | 重啟次數 | L0/L1 狀態 | 事件 |
|------|---------|-----------|------|
| 2月17日 | **55 次** | ❌ 完全失敗 | 🔴 問題首次出現 |
| 2月18-20日 | 25-6 次 | ❌ 延遲/失敗 | 🔴 持續惡化 |
| 3月4-6日 | 186 次 | 🟠 嚴重延遲 | 發現根因 |
| **3月6日** | 55→0 次 | ✅ 開始恢復 | **清理 + 修復** |
| **3月7日** | **7 次** | ✅ 正常 | ✅ **改善 90%** |
| 3月8日 | 0 次 | ✅ 準時 | ✅ **穩定** |

## 解決方案 (已實施)

### 1. ✅ 清理問題 Sessions (3月6日)
- 清理 844 個舊 sessions
- 刪除 10.5MB 問題 session (ead3cbd5...)

### 2. ✅ 設置自動清理機制
- 每日凌晨 3:00 AM 自動執行
- 防止大檔案再次累積

### 3. ✅ 加強 Pre-compaction Flush
- 確保數據先寫入 L2
- 減少 compaction 負擔

### 4. ✅ 修復 Fallback 機制
- 更新 Ollama API Key
- 加入 MiniMax 作 Kimi fallback

## 驗證結果

| 指標 | 修復前 | 修復後 | 改善 |
|------|--------|--------|------|
| 每日重啟次數 | 55-186 次 | **< 10 次** | **90%+** |
| L0 生成時間 | ❌ 失敗/延遲 | ✅ 00:05 準時 | ✅ |
| L1 生成時間 | ❌ 失敗/延遲 | ✅ 00:35 準時 | ✅ |
| Gateway Uptime | 不穩定 | **7+ 小時** | ✅ |

## 現狀 (2026-03-08)
- ✅ Gateway 運作正常 (7+ 小時 uptime)
- ✅ 冇 600秒 timeout restart
- ✅ L0/L1 準時生成
- ✅ 所有 cron jobs 正常

## 觀察期
持續觀察至 **3月10日**，確認穩定後可 close。

## Progress
- [x] 發現問題根源 (Session Compaction)
- [x] 清理問題 sessions (844個)
- [x] 設置自動清理機制
- [x] 修復 fallback 機制
- [x] 驗證效果 (改善 90%)

## Notes
- **關鍵**: 問題係 600秒 compaction timeout，非 WhatsApp 配對問題
- **時間**: 2月17日開始 → 3月6-7日解決
- **影響**: L0/L1 失敗、Gateway 重啟、Cron jobs 干擾
- **解決**: 清理 + 自動化 + 降級 (v2026.2.15)
