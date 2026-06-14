# Qwen3 AutoOps - 自動化運營系統

## 項目簡介

Qwen3 AutoOps 是專為鑽石業務設計的智能自動化系統，由 Qwen3 (本地 AI) 驅動，旨在減少重複性工作，讓 Ally (Kimi) 專注於更高價值的策略性任務。

## 開發狀態

- **啟動日期**: 2026-02-10
- **當前階段**: Module 1 - 自動化日常運營 (開發中)
- **完成度**: 3/6 腳本已完成

## 已開發腳本

### ✅ 已完成

| 腳本 | 功能 | 執行頻率 | 狀態 |
|------|------|----------|------|
| `daily_stock_monitor.js` | 庫存健康監控、周轉分析、滯銷識別 | 每日 06:00, 09:00 | ✅ 完成 |
| `token_monitor.js` | Token 用量監控、自動警報、自動存檔 | 每 30 分鐘 | ✅ 完成 |
| `scheduler.js` | Cron job 設置、排程管理 | 一次性設置 | ✅ 完成 |

### ⏳ 待開發

| 腳本 | 功能 | 預計時間 |
|------|------|----------|
| `weekly_report.js` | 每週銷售報告生成 | 第 2 週 |
| `streaming_archive.js` | 對話增量存檔 | 第 2 週 |
| `query_preprocessor.js` | 客戶查詢預處理 | 第 3-4 週 |

## 快速開始

### 1. 手動測試

```bash
# 進入工作目錄
cd /Users/ally/.openclaw/workspace

# 執行庫存監控
node scripts/autoops/daily_stock_monitor.js

# 執行 Token 監控
node scripts/autoops/token_monitor.js

# 快速啟動所有服務
./scripts/autoops/quick-start.sh
```

### 2. 設置自動排程

```bash
# 設置 cron jobs
node scripts/autoops/scheduler.js

# 或使用 openclaw cron 直接添加
openclaw cron add \
  --name "Daily Stock Monitor" \
  --schedule "0 6,9 * * *" \
  --command "node scripts/autoops/daily_stock_monitor.js"
```

## 輸出文件

### 報告位置
```
reports/
├── inventory_report_2026-02-10.txt  # 每日庫存報告
├── token_report_2026-02-10.txt      # Token 狀態報告
└── weekly_report_2026-W06.txt       # 每週報告 (待開發)
```

### 狀態文件
```
memory/
├── heartbeat-state.json      # Token 監控狀態
├── stock-history.json        # 庫存歷史記錄
├── cron-jobs.json            # Cron job 配置
└── auto-archives/            # 自動存檔
    ├── session_archive_xxx.json
    └── alerts.json
```

## 配置說明

### 閾值設置 (Token Monitor)

```javascript
thresholds: {
    warning: 50,    // 50% - 發送警告
    urgent: 60,     // 60% - 緊急通知
    critical: 70    // 70% - 自動存檔
}
```

### 滯銷標準 (Stock Monitor)

```javascript
threshold: {
    slowMoving: 180,  // >180天 = 滯銷
    warning: 120,     // 120-180天 = 警告
    healthyTurnover: 90 // <120天 = 健康
}
```

## 故障排除

### 問題 1: 腳本無法執行

```bash
# 檢查權限
ls -la scripts/autoops/

# 設置執行權限
chmod +x scripts/autoops/*.js
chmod +x scripts/autoops/runners/*.sh
```

### 問題 2: 數據庫不存在

```bash
# 確保庫存數據庫存在
cat memory/diamond_stock.json | head

# 如不存在，先執行合併腳本
node scripts/merge_stock.js
```

### 問題 3: WhatsApp 通知失敗

- 檢查 WhatsApp gateway 狀態
- 確認號碼格式正確 (+852...)
- 查看 logs/autoops.log 錯誤信息

## 開發路線圖

### Phase 1: 基礎自動化 (第 1-2 週)
- [x] 每日庫存監控
- [x] Token 監控
- [x] Cron 排程設置
- [ ] 每週報告生成
- [ ] 對話自動存檔

### Phase 2: 智能化 (第 3-6 週)
- [ ] 客戶查詢預處理
- [ ] 智能庫存建議
- [ ] 數據驅動決策支持

### Phase 3: 進階功能 (第 7-12 週)
- [ ] 記憶自動化整理
- [ ] 多語言支援
- [ ] 預測分析

## 技術架構

```
┌─────────────────────────────────────┐
│         Qwen3 (本地 AI)              │
│  ┌──────────┐      ┌──────────┐    │
│  │ 腳本執行 │ ───→ │ 數據分析 │    │
│  └──────────┘      └──────────┘    │
│         │                │          │
│         ↓                ↓          │
│  ┌──────────────────────────────┐   │
│  │     輸出 (報告/通知/存檔)     │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

## 維護

- **定期檢查**: 每週查看 logs/autoops.log
- **數據備份**: 每日自動備份到 Apple Notes
- **版本更新**: 跟隨 OpenClaw 更新調整

## 聯繫

如有問題或建議，請通過 WhatsApp 聯繫 Ally。

---

**最後更新**: 2026-02-10  
**版本**: v0.1.0-alpha
