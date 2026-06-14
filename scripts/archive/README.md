# scripts/archive/ - 歸檔腳本

此目錄包含已被取代或不再使用的舊腳本。

## 為什麼被歸檔

這些腳本因以下原因被移入 archive：
- 功能已被更新、更完善的腳本替代
- 設計已過時，不符合當前架構需求
- 曾用於一次性任務，已完成使命

## 歸檔時間

| 腳本 | 歸檔日期 | 原因 | 替代方案 |
|------|----------|------|----------|
| compare_stock.js | 2026-03 | 功能整合 | stock_merge_pro.js |
| merge_stock.js | 2026-03 | 功能整合 | stock_merge_pro.js |
| import_stock.js | 2026-03 | 功能整合 | stock_updater.js |
| integrate_stock.js | 2026-03 | 功能整合 | stock_updater.js |
| update_stock_list.js | 2026-03 | 功能整合 | stock_updater.js |
| watch_stock.js | 2026-03 | 不再需要 | Discord 頻道直接處理 |
| discord_stock_watcher.js | 2026-03 | 不再需要 | Discord 頻道直接處理 |
| whatsapp_stock_handler.js | 2026-03 | 不再需要 | 直接處理 |
| stock_valuation.js | 2026-03 | 功能整合 | stock_valuation_bot.js（亦已歸檔） |
| stock_valuation_bot.js | 2026-03 | 不再使用 | — |
| cron_health_check.js | 2026-03 | 功能替代 | error_tracker.js |
| cron_health_monitor.js | 2026-03 | 功能替代 | error_tracker.js |
| system_health_check.js | 2026-03 | 功能替代 | error_tracker.js |
| health_api.js | 2026-03 | 不再需要 | — |
| error_autofix.js | 2026-03 | 功能替代 | error_tracker.js (auto-resolve) |
| error_autofix_v2.js | 2026-03 | 功能替代 | error_tracker.js (auto-resolve) |
| error_recovery.js | 2026-03 | 功能替代 | error_tracker.js (auto-resolve) |
| memory_health.js | 2026-03 | 功能替代 | memory_archiver.js / memory_section_cleanup.js |

## 是否可以安全刪除？

**一般而言可以安全刪除**，但建議：
1. 確認替代腳本已正常運作至少 1 週
2. 如有疑問，先備份再刪除
3. P0/P1 相關腳本保留多 1 個月作為 fallback

## 注意事項

- 歸檔腳本**不會**被 cron 執行
- 如需參考舊邏輯，可直接查閱此目錄
- 新腳本如有 bug，可參考歸檔版本作為回滾依據

---
*Last Updated: 2026-03-28*
