---
id: 061
title: Template-Engine Separation - 其他 Systems
status: archive
priority: P2
created: 2026-03-23
due: 2026-04-15
updated: 2026-04-16
progress: 4/5
---

## Background
參考 ReportGenerator 既成功經驗，將其他 systems 既 output 標準化。

## 已完成 Phases

### ✅ Phase 1: error_tracker.js (2026-04-07)
- 創建 `error_templates.js` — Template 定義
- 創建 `error_generator.js` — Generator class
- 重構 `error_tracker.js` — 使用 Template-Engine
- 修復 Async/Sync 混用問題 → 使用 fs.promises
- 修復 memory_sanitizer.js → 使用 error_tracker API

### ✅ Phase 2: health_monitor.js (2026-04-07)
- 創建 `health_templates.js` — Template 定義
- 創建 `health_generator.js` — Generator class
- 重構 `health_monitor.js` — 使用 Template-Engine
- 修復 skills_manager.js 路徑問題

### ✅ Phase 4: weekly_correction_loop.js (2026-04-09)
- 創建 `weekly_correction_templates.js` (262 lines)
- 創建 `weekly_correction_generator.js` (391 lines)
- 重構 `weekly_correction_loop.js` (950+ lines)
- 新增多 format 輸出：JSON、Markdown、Discord、Simple
- Code Audit：✅ 全部 P0/P1/P2 通過
- Ready for production
- 創建 `code_quality_templates.js` — Template 定義
- 創建 `code_quality_generator.js` — Generator class
- 重構 `code_quality_manager.js` — 使用 Template-Engine
- 減少 ~143 行重複代碼
- 新增 toDiscordEmbed() 功能

## 待實現 Phase 4

| 優先 | Script | 行數 | 總分 | 原因 |
|------|--------|------|------|------|
| 1 | weekly_correction_loop.js | 1250 | 16 | 每週 Discord embed |
| 2 | system_check_bot.js | 846 | 16 | 每日系統報告 |
| 3 | memory_generator.js | 646 | 14 | L0/L1 生成 |
| 4 | daily_summary_bot.js | 434 | 13 | 每日總結 |
| 5 | rapnet_weekly.js | 370 | 13 | 每週報告 |
| 6 | issue_manager.js | 794 | 12 | 任務管理 |

### Phase 5 以後考慮
- auto_fix.js (2752行, 11分)
- auto_issue_creator.js (758行, 11分)

## Criteria
- 每個 system 要分成 template.js 同 generator.js
- 支援多 format output (markdown/json/discord embed)
- 保持 backward compatible

## 驗證結果
- ✅ Error Tracker: 正常運作
- ✅ Code Quality Manager: 正常運作
- ✅ System Check Bot: 正常推送 Discord

---
*Updated: 2026-04-08*
