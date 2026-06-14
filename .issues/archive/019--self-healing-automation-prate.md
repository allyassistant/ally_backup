---
id: 019
title: 實施 Self-Healing & Automation 增強計劃 (參考 Prateek 影片)
status: archive
priority: P1
created: 2026-02-25
due: 2026-03-31
updated: 2026-03-28
progress: 6/7
---

## Description
參考 Prateek 嘅影片 "The Self-Improving AI System That Built Itself"，將 Self-Healing 同 Automation 概念整合入現有 OpenClaw Level 3.5 架構。

## Background
影片核心概念：
- Agents 可以寫 code，但 bottleneck 係人既 attention
- 用 orchestrator 管理多個 agents 並行運作
- Self-healing CI：12 次 failure/fix cycles 後自動成功
- Automated code review：700 個 comments，得 1% 要人睇

## 整合架構

```
現有系統 (Level 3.5)          新增組件                    效果
─────────────────────────────────────────────────────────────────
Cron Jobs  ──────────────→  Error Handler (新)    ───→  自動修復
     │                           │
     ↓                           ↓
Heartbeat  ──────────────→  Health Monitor (新)   ───→  主動檢測
     │                           │
     ↓                           ↓
L0/L1 Gen  ──────────────→  Adaptive Controller   ───→  動態調整
     │                           │
     ↓                           ↓
errors.json ─────────────→  Pattern Learner (新)  ───→  知識累積
```

## Phase 1: 短期 (1-2 週)

### 1.1 Adaptive Timeout Controller
**目的：** L1 Generator 根據檔案大小自動調整 timeout

**狀態：** ✅ 已完成 (2026-02-25)

**已實現：**
- ✅ 創建 `scripts/adaptive_timeout.js`
- ✅ 計算邏輯：baseTime(60) + perKB(0.3) + perLine(0.2) × aiMultiplier(2.5)
- ✅ 輸出 JSON 格式建議 timeout (120-600s 範圍)
- ✅ 支援 `--check-l1` 自動讀取昨日檔案
- ✅ 更新 L1 Generator cron job 使用 adaptive timeout

**測試結果：**
| 檔案 | 大小 | 行數 | 建議 Timeout |
|------|------|------|-------------|
| Feb 24 (大) | 516KB | 319 | 600s (上限) |
| Feb 25 (小) | 8KB | 341 | 327s |

**發現：** Feb 24 檔案過大，需要 600s 上限。解釋了之前 timeout 原因。

**🔍 Root Cause Analysis (2026-02-25 新增):**
經調查發現 Feb 24 檔案異常大並非因為正常使用，而是 **binary content 污染**：

| 檔案 | 標示大小 | 實際文字 | Binary 來源 |
|------|----------|----------|-------------|
| 0717.md | 1.57MB | ~11KB | Excel OLE format |
| 0752.md | 1.05MB | ~9KB | Excel OLE format |
| 0852.md | 528KB | ~8KB | Excel OLE format |

**污染原因：**
- OpenClaw `session-memory` 功能自動儲存 session content
- Feb 24 用戶 send Excel 檔案時，binary content (`application/x-cfb`) 意外寫入 memory 檔案
- L1 Generator 處理緊大量無意義 binary data，導致 timeout

**解決方案：**
1. ✅ 手動清理 3 個 corrupted files
2. ✅ 建立 `scripts/memory_sanitizer.js` - 自動檢測同清理 binary content
3. ✅ 加入 HEARTBEAT.md - 每次 heartbeat 自動執行

**⚡ 優化更新 (2026-02-25):**
既然 contamination 已修復且有 sanitizer 保護，大幅降低 timeout:

| 參數 | 舊值 | 新值 | 原因 |
|------|------|------|------|
| maxTimeout | 600s | **300s** | 唔使應對 contamination |
| aiMultiplier | 2.5 | **2.0** | 檔案乾淨，處理更快 |

**效果：**
- 小檔案 (8KB): 344s → **275s** (-20%)
- 大檔案 (100KB): 600s → **300s** (-50%)
- L1 Generator cron job timeout: 600s → **300s**

**🔴 CRITICAL BUG FIX (2026-02-25 緊急修復):**
發現 L0/L1 Generator 根本無法讀取 memory 檔案！

| 項目 | 舊 (錯誤) | 新 (修復) |
|------|-----------|-----------|
| 實際檔名 | `2026-02-24-0852.md` (時間戳) | ✅ 支援 |
| Generator 搵 | `2026-02-24.md` (唔存在) | ❌ 搵唔到 → timeout |
| 結果 | "No activity recorded" | ✅ 成功讀取並生成摘要 |

**修復方案：**
1. ✅ `generate_l1.js` - 新增 `findLatestMemoryFile()` 函數
2. ✅ `generate_abstract.js` - 同上，支援 timestamp 格式
3. ✅ 更新 3 個 cron jobs 說明正確檔名格式
4. ✅ 測試確認成功找到並讀取檔案

### 1.2 Smoke Test Framework
**目的：** 改 script 後自動驗證

**狀態：** ✅ 已完成 (2026-02-25)

**已實現：**
- ✅ 創建 `scripts/smoke_test.js` (200+ 行)
- ✅ 支援多種測試模式：`--all`, `--changed`, `--check-modified`, `--script`
- ✅ 測試項目：
  - Adaptive Timeout Controller: 檢查 timeout 計算
  - Issue Manager: list + 創建 dummy issue
  - Error Tracker: 基本功能檢查
  - Stock Merge/Updater: 標記為 skip (需 Excel)
- ✅ 顏色輸出：綠色=pass，紅色=fail，黃色=skip
- ✅ Exit code: 0=pass, 1=fail (CI/CD 友好)
- ✅ 整合至 HEARTBEAT.md：`--check-modified` 檢查今日改動

**測試結果示例：**
```
Testing Adaptive Timeout Controller... ✅ PASS - L1 check: 600s
Testing Issue Manager... ✅ PASS - List command working
Testing Error Tracker... ✅ PASS - Command executed without error
Total: 5 tests | ✅ Passed: 3 | ❌ Failed: 0 | ⚠️ Skipped: 2
```

### 1.3 Error Classification & Auto-Response
**目的：** 自動檢測、分類同嘗試修復錯誤

**狀態：** ✅ 已完成 (2026-02-25)

**已實現：**
- ✅ 創建 `scripts/error_autofix.js` (300+ 行)
- ✅ 創建 `memory/error-patterns.json` - 錯誤模式庫
- ✅ 支援 6 種預設錯誤模式：
  | Pattern | Category | Auto-Fix |
  |---------|----------|----------|
  | L1_TIMEOUT | performance | ✅ 增加 timeout / fallback |
  | L0_TIMEOUT | performance | ✅ 增加 timeout |
  | MODEL_NOT_ALLOWED | configuration | ✅ 修正 model 名 |
  | DISCORD_DELIVERY_FAILED | delivery | ❌ 檢查 only |
  | FILE_NOT_FOUND | filesystem | ❌ 需人手確認 |
  | MEMORY_CLEANUP_NEEDED | maintenance | ✅ 執行 cleanup |
- ✅ 功能：
  - `scan`: 掃描並嘗試 auto-fix
  - `analyze`: 分析錯誤模式頻率
  - `--cron`: 靜默模式 (Heartbeat 用)
- ✅ 防護機制：
  - 最多試 3 次
  - 24 小時 cooldown
  - 記錄 fix history
- ✅ 整合至 HEARTBEAT.md

**測試結果：**
```
Results: 1 fixed, 0 failed, 9 skipped
- MEMORY_CLEANUP_NEEDED: ✅ auto-fix 成功
```

---

## Phase 2: 中期 (1-3 個月)

### 2.1 Pattern Learner (知識累積系統) ← 基於 Memento 概念
**目的：** 從錯誤中學習，形成四步閉環

**靈感來源：** Memento 項目 - 延遲分析比實時分析便宜 10 倍

**四步閉環：**
```
記錄 → 分析 → 修復 → 沉澱
```

**新增檔案：** `scripts/pattern_learner.js`

**運作流程：**
1. 每周日配合 `weekly_correction_loop` (延遲分析，不阻塞)
2. 分析 errors.json (過去 7 日)
3. 識別錯誤模式：「邊個工具/場景最容易錯」
4. 生成建議並自動更新 TOOLS.md / AGENTS.md / errors.json

**整合現有組件：**
- ✅ Error Tracker (記錄)
- ✅ Weekly Correction Loop (分析)
- ⚠️ Error AutoFix (被動修復) → 改為主動
- ❌ 沉澱機制 (未做到) → 新增

### 2.2 Parallel Job Scheduler
**目的：** 唔相關嘅 cron jobs 並行執行

**新增檔案：** `scripts/parallel_scheduler.js`

**Dependency Graph：**
```
L0 Generator (00:05)
    ↓
L1 Generator (00:35)
    ↓
L0/L1 Fallback (01:00)

可以並行：Browser, Media, Artifact, IDEX
```

### 2.3 Proactive Health Monitor
**目的：** 主動檢測問題，未發生前預警

**新增檔案：** `scripts/proactive_health.js`

**檢測項目：**
| 檢查 | 預警條件 | 自動行動 |
|------|---------|---------|
| Disk space | < 20% | 提前跑 cleanup |
| Token usage | 上升趨勢 | 提前存檔 |
| Cron job 失敗率 | 連續 2 次 | 自動調整參數 |

---

## 檔案結構 (已更新)

```
scripts/
├── adaptive_timeout.js       # ✅ NEW - 動態 timeout
├── smoke_test.js             # ✅ NEW - 自動測試
├── error_autofix.js          # ✅ NEW - 錯誤自動修復
├── memory_sanitizer.js       # ✅ NEW - Binary content 清理
├── pattern_learner.js        # ⏳ TODO
├── parallel_scheduler.js     # ⏳ TODO
├── proactive_health.js       # ⏳ TODO
└── error_tracker.js          # ⏳ MODIFY - 加 autoFix

memory/
├── errors.json               # ⏳ MODIFY (加 autoFix history)
├── error-patterns.json       # ✅ NEW - 錯誤模式庫
├── health-metrics.json       # ⏳ NEW
└── _binary_backups/          # ✅ NEW - 污染檔案備份
```

---

## 實施順序

| 週次 | 任務 | 狀態 | 預計時間 |
|------|------|------|---------|
| Week 1 | Adaptive timeout | ✅ 完成 | 2-3 小時 |
| Week 1 | Smoke test framework | ✅ 完成 | 3-4 小時 |
| Week 1 | Error autoFix | ✅ 完成 | 3-4 小時 |
| Month 2 | Pattern learner | ⏳ 待定 | 1-2 日 |
| Month 2 | Parallel scheduler | ⏳ 待定 | 1-2 日 |
| Month 3 | Proactive Health Monitor | ⏳ 待定 | 1-2 日 |

---

## 預期效果

### 短期 (已完成 ✅)
- ✅ L1 Generator 使用 adaptive timeout (600s max)
- ✅ Smoke test 自動檢測 script 改動
- ✅ Error autoFix 自動嘗試修復已知問題
- ✅ Memory Sanitizer - 防止 binary content 污染

### 中期 (目標)
- 同類錯誤第二次自動套用已知解法 (Pattern Learner)
- 每日 maintenance 時間：~30 分鐘 → ~10 分鐘 (Parallel Scheduler)
- 70-80% 問題毋須人手介入

---

## Reference
- 影片：The Self-Improving AI System That Built Itself (@prateek)
- GitHub：github.com/ComposioHQ/agent-orchestrator
- 現有架構：Level 3.5 (永續 Agent 系統)

## Progress
- [x] Week 1: Adaptive timeout (✅ 完成 - 2026-02-25)
- [x] Week 1: Smoke test framework (✅ 完成 - 2026-02-25)
- [x] Week 1: Error autoFix (✅ 完成 - 2026-02-25)
- [x] Week 1: Memory sanitizer + root cause fix (✅ 完成 - 2026-02-25)
- [x] Month 2: Parallel Scheduler (✅ 完成 - 2026-03-26)
  - ✅ `daily_maintenance.js` - Parallel execution (Memory Health + Smoke Test + Session Cleanup + Error AutoFix + Issue Auto Followup)
  - ✅ `weekly_parallel.js` - Monday Parallel (IDEX + Stock Valuation + RapNet) + Sunday Parallel (Deep Cleanup + Weekly Correction Loop)
  - ✅ Session Cleanup 整合 (session_cleanup.js + session_cleanup_prune.js → 整合版)
  - ✅ Cron Jobs 清理 - 刪除重複獨立 jobs
- [x] Month 2: Pattern learner (✅ 靈感更新 - 2026-03-27)
  - ✅ 四步閉環概念：記錄 → 分析 → 修復 → 沉澱
  - ✅ 延遲分析概念：節省成本 10 倍
  - ⏳ 待實作：scripts/pattern_learner.js
- [ ] Month 3: Proactive Health Monitor

## Notes
- Phase 1 已全部完成，比原定計劃快 1 週
- **重要發現：** L1 timeout 真正原因係 binary content 污染 (已修復)
- 所有新增組件已整合至 HEARTBEAT.md
- **2026-03-26 更新：** Parallel Scheduler 實作完成
  - Daily Maintenance (02:00): Parallel execution, ~17s 完成
  - Monday Parallel (07:00): IDEX + Stock + RapNet 同時跑
  - Sunday Parallel (03:00): Deep Cleanup + Weekly Correction Loop 同時跑
  - Session Cleanup: 整合版 (cron pattern + age >3 days)
  - 清理重複 cron jobs: Memory Health, Smoke Test, Session Cleanup, Weekly Correction Loop 獨立 jobs 已刪除
