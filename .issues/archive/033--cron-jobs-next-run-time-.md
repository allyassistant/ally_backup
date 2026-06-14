---
id: 033
title: 調查 Cron Jobs Next Run Time 顯示錯誤既問題
status: completed
priority: P2
created: 2026-03-13
due: 2026-03-15
updated: 2026-03-13
progress: 1/3
---

## Description
Cron jobs 既 nextRunAtMs 顯示錯誤既時間 (例如顯示 Sat Mar 14 但應該係 Fri Mar 13)。

## 問題表現
- L0/L1 jobs 應該每日 00:05/00:35 運行
- 但 next run time 顯示係第二日而非當日
- Mar 12 既 errors 导致 scheduler 出問題

## 嘗試既 Solution
- [x] Restart gateway - 未能解決
- [x] 手動 trigger jobs - 成功

## 待辨事項
- [ ] 調查更深層既 root cause
- [ ] 考慮 disable + recreate jobs
- [ ] 或者 accept 手動 trigger

## 相關 Logs
- /tmp/openclaw/openclaw-2026-03-12.log (有 Mar 12 既 timeout errors)

---
*Added: 2026-03-13 09:48 HKT*

## 完成備註

- 2026-03-16: 問題已自動解決，cron jobs 運作正常
- L0/L1 生成時間正確 (00:05/00:35)
- nextRunAtMs 顯示正確
