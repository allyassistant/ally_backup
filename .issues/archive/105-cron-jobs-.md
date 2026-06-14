---
id: 105
title: Cron Jobs 整合與優化
status: archive
priority: P1
created: 2026-05-03
due: 2026-05-10
updated: 2026-05-23
progress: 0/0
---

# Issue #105: Cron Jobs 整合與優化

## 目的
評估並優化 Ally 現有的 17 個 cron jobs，減少重疊、提高效率

## 背景資料

### 完整 Cron Jobs 清單 (2026-05-03)

| # | Job | 時間 | 功能 | 評估 |
|---|-----|------|------|------|
| 1 | L0 AI Generator | 00:05 | 每日摘要 (L0) | ✅ 保留 |
| 2 | L1 AI Generator | 00:35 | 每日摘要 (L1) | ✅ 保留 |
| 3 | Wiki Bridge Import | 00:40 | Bridge → Wiki | 🟡 可整合 |
| 4 | Symbols Index Generator | 00:41 | 生成 SYMBOLS.md | 🟡 可整合 |
| 5 | Wiki Compile | 00:45 | 編譯 Wiki | 🟡 可整合 |
| 6 | Wiki Lint | 00:50 | 檢查 Wiki 結構 | 🟡 可整合 |
| 7 | Wiki Daily Ingest | 01:00 | 攝入記憶到 Wiki | ✅ 保留 |
| 8 | Memory Dreaming Promotion | 03:00 | 內部短→長記憶提升 | 🔴 待定 |
| 9 | Pattern Analysis Daily | 04:00 | 運行 4 個 pattern scripts | 🟡 降頻/停用 |
| 10 | Daily Maintenance (Combined) | 05:00 | 清理 memory/sessions/issues | 🟡 可擴展 |
| 11 | Knowledge Base Daily Ingest | 06:00 | 攝入外部知識 | 🔴 待定 |
| 12 | Monday Parallel | Mon 07:00 | IDE/Stock/RapNet 檢查 | ✅ 保留 |
| 13 | Weekly Correction Loop | Sun 03:00 | 從錯誤學習，更新 AGENTS.md | ✅ 保留 |
| 14 | Deep System Cleanup | Sun 04:00 | 清理 Browser/Media/Logs | 🟡 可重構 |
| 15 | Daily Memory Logger | 每2小時 | 歸檔對話到 memory | ✅ 保留 |
| 16 | System Check CQM | 10/15/22時 | 程式碼質量檢查 | ✅ 保留 |
| 17 | Discord Channel Logger | 23:55 | 歸檔 Discord 記錄 | 🔴 待定 |
| 18 | Daily Summary | 23:59 | 生成日總結 | ✅ 保留 |

## 技術分析

### 發現問題 #1：Session Cleanup 重複衝突

| Job | 時間 | 清理內容 |
|-----|------|----------|
| `session_cleanup.js` (daily_maintenance) | 05:00 daily | 清理 agents sessions >3 日 |
| `deep_cleanup.sh` | Sun 04:00 | 清理 agents sessions >14 日 |

兩者都係清理 agents sessions，但規則唔同 (3日 vs 14日)，同一份資料俾兩個 job 處理。

### 發現問題 #2：Deep Cleanup 範圍太廣

`deep_cleanup.sh` 做咗以下事情：
1. Browser 緩存清理
2. Media Outbound (>7天)
3. Media Inbound (>14天)
4. Agents Sessions (>14天) ← 重複！
5. gateway.log 截斷 (1000行)
6. 舊備份檢查
7. Artifacts temp (>7天)
8. Resolved Issues (>30天)

每週執行太浪費，佔 04:00-04:02 這個敏感時間段。

## 實作步驟

### Phase 1: Wiki Jobs 整合 (低風險)
```
目標：5 個 Wiki jobs → 3 個

步驟：
1. 創建 combined_wiki_sync.js (bridge + symbols)
2. 創建 combined_wiki_build.js (compile + lint)
3. 更新 cron jobs 使用 combined scripts
```

### Phase 2: Deep Cleanup 重構
```
目標：整合入 daily_maintenance，統一 session cleanup 規則

步驟：
1. 將 deep_cleanup.sh 邏輯改為 Node.js
2. 統一 session cleanup 規則 (只用 3日規則)
3. gateway.log truncation 改為每月一次
4. 停用 Sun 04:00 deep_cleanup cron job
```

### Phase 3: Pattern Analysis 降頻/停用
```
目標：減少無意義的每日分析

選項 A：停用 pattern_analysis_daily
- weekly_correction_loop 本身就會讀 errors.json
- 每日跑 4 個 scripts，分析結果用戶零感知

選項 B：降頻為每週日跑一次
- 保留功能但降低資源消耗
```

### Phase 4: 待定 Jobs 決策
```
需要 Josh 決定：
1. Memory Dreaming Promotion (03:00) - 用戶零感知，是否停用？
2. Knowledge Base Daily Ingest (06:00) - Wiki 有在使用嗎？
3. Discord Channel Logger (23:55) - 有幾多人用？
```

## 結論

### 可立即執行（風險低）
- ✅ Wiki Bridge + Symbols 合併
- ✅ Wiki Compile + Lint 合併
- ✅ Pattern Analysis 降頻/停用

### 需要重構（風險中）
- ⚠️ Deep Cleanup → Daily Maintenance 整合

### 需要用戶決策
- ❓ Memory Dreaming, Knowledge Base, Discord Logger

## Links
- HEARTBEAT.md (cron jobs 列表)
- scripts/daily_maintenance.js
- scripts/deep_cleanup.sh
- scripts/weekly_correction_loop.js
- scripts/pattern_analysis_daily.js
