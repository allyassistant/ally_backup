---
id: 072
title: 實現 Kimi Auto-Audit Cron Job
status: archive
priority: P2
created: 2026-03-29
due: 2026-04-15
updated: 2026-03-29
progress: 0/1
---

## Description
定時 spawn Kimi 幫系統架構搵 bugs 同修復，實現 AI Auto-Fix

### 目標
- 每週定時掃描系統，發現問題主動修復
- 減少被動式 debug，增加主動式預防

### 核心功能
1. **Scan errors.json** - 最近新錯誤
2. **Read recent changed files** - 最近修改的 scripts
3. **Kimi 分析** → 列出問題 + fix 建議
4. **分級處理**:
   - 低風險 (doc/formatting/simple bugs) → 自動 apply
   - 高風險 (架構變更) → Report to Discord，等你 confirm
5. **所有變更 log 到 errors.json**

### Safeguards
- **Read-only mode** - 預設只 report，唔自動 apply
- **last-fixed tracking** - 重複問題 skip
- **指定範圍** - 只 scan `.issues/`, `scripts/`, `memory/`
- **Concurrency + timeout 控制** - 避免濫用

### 使用方式
1. Read-only mode: Kimi 每周 report 要修咩，你手動 confirm
2. Safe auto-fix: 只修 doc/格式/low-risk issues，自動 apply

## Progress
- [ ] 設計架構
- [ ] 實現 Kimi Auto-Audit Script
- [ ] 設定 Cron Schedule (每週?)
- [ ] 測試 + 調整

## Notes
- 建議 schedule: Weekly (Sunday 03:00?)
- Model: Kimi K2.5 (高質量代碼分析)
- Timeout: 180-300 秒
