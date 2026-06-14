---
id: 029
title: Token Alert 重複發送問題 - check_token.js 邏輯錯誤
status: resolved
priority: P2
created: 2026-03-08
due: 2026-03-15
---

## 問題
尋晚凌晨系統 channel 出現 10 次 Token Alert (80%+)，但實際 token 使用率得 9%

## 原因分析

### 1. HEARTBEAT 入面 check_token.js 執行兩次
- Line 13: `node scripts/check_token.js`
- Line 386: `node scripts/check_token.js` (重複)

### 2. 觸發條件錯誤
```javascript
// check_token.js Line 402-404
const anySessionHigh = breakdown.some(s => parseFloat(s.percentage) >= 80);
if (totalPercentage >= 80 || anySessionHigh) {
```
**問題**: 只要有任何一個 session 達到 80%，就會觸發 alert，即使 total 只有 9%！

### 3. Alert State 問題
- `finalWarningSent` 從未設定為 true
- `firstWarningSent` 自 2月16號後就冇郁過
- 導致每次 heartbeat 都會重複發送

## 解決方案 (已實施)

### 1. ✅ 移除重複既 check_token call (2026-03-08)
- ~~刪除 HEARTBEAT.md Line 386 既 duplicate call~~ **已完成**
- 而家只剩 Line 13 一個 call

### 2. 加入 Cooldown 機制 (待做)
- 80% alert 每日最多發一次
- 記錄上次發送時間

### 3. 修正觸發邏輯 (待做)
- 分離「單一 session high」同「total high」既處理
- 建議：只有 total >= 80% 先發 critical alert

## 跟進項目
- [x] 修復 HEARTBEAT.md 重複 call
- [ ] 觀察幾日確認無重複 alert
- [ ] 如有需要，再做 cooldown 機制
- [ ] 如有需要，修正觸發邏輯
