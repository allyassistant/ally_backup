---
id: 045
title: Timeout Fixes Observation - 轉 Ollama 後觀察
status: archive
priority: P2
created: 2026-03-16
due: 2026-03-19
updated: 2026-03-20
progress: 0/4
---

## Description
將 4 個經常 timeout 既 cron jobs 轉用 Ollama (qwen2.5:3b)，觀察係咪解決 timeout 問題。

## 已轉 Ollama 既 Jobs

| Job | 時間 | 舊 Model | 新 Model | 原 Timeout |
|-----|------|----------|----------|------------|
| L0/L1 Fallback | 01:00 | MiniMax-M2.5 | ollama/qwen2.5:3b | 300s |
| Daily Media Cleanup | 04:00 | MiniMax-M2.5 | ollama/qwen2.5:3b | 120s |
| Reminder Discussion | 10:00, 22:00 | MiniMax-M2.5 | ollama/qwen2.5:3b | 60s |
| Stock Valuation | 08:00 | MiniMax-M2.5 | ollama/qwen2.5:3b | 180s |

## 同時優化既 Scripts

| Script | 優化內容 |
|--------|----------|
| stock_valuation.js | 加 try-catch, batched output, directory check |
| auto_cleanup_media.sh | 加 file counting, timeout, strict mode |
| reminder_discussion.js | 簡化 output, 加 error handling |
| l0_l1_fallback.js | (之前已轉 Ollama) |

## 觀察項目

- [ ] **3月16日 10:00** - Reminder Discussion 係咪成功？
- [ ] **3月16日 22:00** - Reminder Discussion 係咪成功？
- [ ] **3月17日 01:00** - L0/L1 Fallback 係咪成功？
- [ ] **3月17日 04:00** - Daily Media Cleanup 係咪成功？
- [ ] **3月17日 08:00** - Stock Valuation 係咪成功？

## 成功標準

- 連續 3 次執行成功 (無 timeout)
- 執行時間 < 50% timeout limit
- 無 consecutive errors

## 如果失敗

1. 檢查 Ollama 服務狀態
2. 考慮增加 timeout
3. 檢查 script 是否有其他問題

## 備註

- Ollama 本地運行，應該比 MiniMax API 快 5-10 倍
- 如果 Ollama 都 timeout，可能係 script 本身有問題 (無限 loop / 大量檔案)
