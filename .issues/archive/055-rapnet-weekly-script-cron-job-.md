---
id: 055
title: RapNet Weekly script 冇對應 cron job - 需要確認運行方式
status: archive
priority: P2
created: 2026-03-19
due: 2026-03-22
updated: 2026-03-23
progress: 0/1
---

## Description
發現 `rapnet_weekly.js` script 存在，但冇對應既 cron job。

## 檢查結果

| Script | Cron Job | 狀態 |
|--------|----------|------|
| idex_fetcher.js | ✅ IDEX 數據每日更新 (07:00) | 正常 |
| **rapnet_weekly.js** | ❌ **冇** | **需要確認** |
| weekly_correction_loop.js | ✅ Weekly Correction Loop Review (星期日 18:00) | 正常 |
| reminder_discussion.js | ✅ Reminder Discussion Check (15:00) | 正常 |

## 需要確認

### 選項 A: 手動運行
- 係咪你打算手動執行？
- 如果需要手動，要記錄喺 TOOLS.md

### 選項 B: 創建 cron job
- 頻率：每週？每月？
- 發送方式：WhatsApp / Discord？
- Channel：邊個？

### 選項 C: 刪除 script
- 如果唔再用，可以刪除

## 目前狀態
- Script 存在：`~/.openclaw/workspace/scripts/rapnet_weekly.js`
- 冇 cron job 自動觸發
- 上次運行時間：唔清楚

## 行動
- [ ] 確認運行方式 (手動/cron/刪除)
- [ ] 根據選擇執行相應操作
- [ ] 更新文件 (如果需要)

## 相關檔案
- `~/.openclaw/workspace/scripts/rapnet_weekly.js`
- Issue #054 (Agent Skill Design Patterns)
