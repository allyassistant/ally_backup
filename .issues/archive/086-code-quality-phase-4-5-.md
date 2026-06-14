---
id: 086
title: Code Quality: Phase 4-5 - 整合舊系統到新架構
status: archive
priority: P3
created: 2026-04-05
due: 2026-05-01
updated: 2026-04-16
progress: 0/2
---

## Description

整合 auto_fix.js 和 pure_ai_audit.js 到新的 code_quality_manager.js 架構。

## Phase 4: 更新舊系統調用新系統

### 工作內容
- [ ] 更新 `auto_fix.js` - 底層調用 `code_quality_manager.js`
- [ ] 更新 `pure_ai_audit.js` - 底層調用 `code_quality_manager.js`
- [ ] 保持 CLI 介面不變（向後兼容）

### 目標
- 統一使用同一個核心引擎
- 減少重複代碼
- 統一的 issue 格式和緩存

## Phase 5: 測試、過渡、文檔

### 工作內容
- [ ] 完整整合測試
- [ ] 性能基準測試
- [ ] 文檔更新
- [ ] 過渡指南（如何從舊系統遷移）

### 測試清單
- [ ] `code_quality_manager.js scan` vs `auto_fix.js scan` 結果一致
- [ ] `code_quality_manager.js report` vs `auto_fix.js report` 結果一致
- [ ] 性能對比（應有提升）

## 向後兼容

- ✅ `code_quality_manager.js` 已是統一入口
- ✅ `auto_fix.js` 仍可獨立運行
- ✅ `pure_ai_audit.js` 仍可獨立運行

## Status Notes

- 2026-04-05: Issue created. Phase 4/5 可選，目前新系統已可使用。
