# 跨 Session 分析引擎 (Cross-Session Analysis Engine)

*完整的使用說明 + 指令參考*
*Last Updated: 2026-04-03*

> ⚠️ **注意**：本檔案從 TOOLS.md 拆分出來，因為原檔案太大（30,958 bytes），導致 OpenClaw bootstrap 被截斷 47%。

---

## 概述

跨 Session 分析引擎係一套分析工具，幫我追蹤對話入面的 patterns，令我喺 Session Reset 之後都記得之前討論過咩。

## 目錄結構

```
memory/
├── patterns/                    ← 分析結果存放位置
│   ├── errors.json             # Error 規律追蹤
│   ├── projects.json            # Project 追蹤
│   ├── periodic.json            # 週期性 Pattern
│   ├── topic-graph.json         # Topic 關聯圖
│   └── archive/                 # 已解決項目的 Archive
└── .proactive_alerts.json       # 主動提醒

scripts/
├── pattern_error_tracker.js     # Error Pattern 分析
├── pattern_project_tracker.js    # Project 追蹤
├── pattern_periodic_tagger.js    # 週期性 Pattern
├── pattern_topic_graph.js        # Topic 關聯圖
├── cross_session_context.js      # 讀取並顯示分析結果
├── cross_session_bootstrap.js     # Session Reset 恢復
├── pattern_analysis_daily.js      # 每日自動分析
├── pattern_proactive_trigger.js  # 主動提醒觸發
├── pattern_resolver.js           # 標記已解決
└── pattern_archive.js             # Archive 清理
```

---

## 🚀 快速開始

### 1. 查看分析摘要（最常用）
```bash
node scripts/cross_session_context.js
```

### 2. 查看主動提醒
```bash
node scripts/pattern_proactive_trigger.js
```

---

## 📊 分析腳本

### pattern_error_tracker.js - Error 規律追蹤

分析 L2 記憶入面的 error 關鍵字。

```bash
# 標準運行
node scripts/pattern_error_tracker.js

# 預覽模式（唔寫入）
node scripts/pattern_error_tracker.js --dry-run
```

**輸出：** `memory/patterns/errors.json`

**JSON 格式：**
```json
{
  "last_updated": "2026-04-03T04:00:00+08:00",
  "errors": [
    {
      "error_type": "L0 timeout",
      "count": 333,
      "first_seen": "2026-03-07",
      "last_seen": "2026-04-03",
      "resolved": false,
      "reopened": false
    }
  ]
}
```

---

### pattern_project_tracker.js - 項目追蹤

追蹤你提到過的項目（Issue #數字、項目名等）。

```bash
# 標準運行
node scripts/pattern_project_tracker.js

# 預覽模式
node scripts/pattern_project_tracker.js --dry-run
```

**輸出：** `memory/patterns/projects.json`

---

### pattern_periodic_tagger.js - 週期性 Pattern

分析時間模式（每週幾出現什麼 topic）。

```bash
# 標準運行
node scripts/pattern_periodic_tagger.js

# 預覽模式
node scripts/pattern_periodic_tagger.js --dry-run
```

**輸出：** `memory/patterns/periodic.json`

---

### pattern_topic_graph.js - Topic 關聯圖

建立 topic 之間的關係圖。

```bash
# 標準運行
node scripts/pattern_topic_graph.js

# 預覽模式
node scripts/pattern_topic_graph.js --dry-run
```

**輸出：** `memory/patterns/topic-graph.json`

---

## 🔧 維護腳本

### pattern_analysis_daily.js - 每日自動分析

順序運行所有 4 個分析腳本，每日 04:00 由 cron job 自動運行。

```bash
# 自動運行（由 cron 觸發）
node scripts/pattern_analysis_daily.js

# 安靜模式（減少輸出）
node scripts/pattern_analysis_daily.js --quiet
```

**⚠️ 唔使手動運行，已係 cron job**

---

### pattern_proactive_trigger.js - 主動提醒觸發

根據分析結果生成主動提醒。

```bash
# 生成提醒
node scripts/pattern_proactive_trigger.js

# 安靜模式
node scripts/pattern_proactive_trigger.js --quiet
```

**輸出：** `~/.openclaw/workspace/.proactive_alerts.json`

**提醒格式：**
```json
{
  "alerts": [
    {
      "type": "error_frequency",
      "severity": "critical",
      "message": "L0 timeout 已出現 333 次",
      "suggestion": "建議永久修復"
    }
  ],
  "generated_at": "2026-04-03T04:00:00+08:00"
}
```

**觸發條件：**
| 條件 | 提醒 |
|------|------|
| Error count > 100 | 🔴 high frequency |
| Error count > 50 | 🟠 medium frequency |
| Project 逾期 3 日 | 📌 reminder |
| 新 Error Pattern | 🆕 new detection |
| 週期性時段 | 📅 periodic |

---

## ✅ Resolver 系統

### pattern_resolver.js - 標記已解決

當你話我知某個問題搞惦咗，用呢個標記。

```bash
# 標記 Error 為已解決
node scripts/pattern_resolver.js --error "L0 timeout" --resolve "已升級 systemEvent 模式"

# 標記 Project 為已完成
node scripts/pattern_resolver.js --project "Auto Dreaming" --resolve "已完成"

# 列出所有已解決的項目
node scripts/pattern_resolver.js --list

# 重新打開已解決的項目
node scripts/pattern_resolver.js --reopen "L0 timeout"
```

**常見用法：**
```bash
# 當你話我知搞惦咗
node scripts/pattern_resolver.js --error "L0 timeout" --resolve "已修復"

# 列出所有 resolved
node scripts/pattern_resolver.js --list

# 如果又出現，重新打開
node scripts/pattern_resolver.js --reopen "L0 timeout"
```

**⚠️ 需要手動運行** - 當你話我知某個問題搞惦咗，我先會幫你標記

---

## 📦 Archive 系統

### pattern_archive.js - 清理已解決項目

將 resolved 超過 30 日的 error 移去 archive，保持 json 精簡。

```bash
# 預覽（顯示會 archive 咩）
node scripts/pattern_archive.js --dry-run

# 執行 archive
node scripts/pattern_archive.js --execute
```

**Archive 目錄：** `memory/patterns/archive/`

**⚠️ 唔使手動運行，已係每週 cron job**

---

## 🔄 Session Reset 恢復

### cross_session_context.js - 顯示分析摘要

讀取所有分析結果，生成人類可讀的摘要。

```bash
# 顯示摘要
node scripts/cross_session_context.js

# 安靜模式
node scripts/cross_session_context.js --quiet
```

**輸出範例：**
```
╔════════════════════════════════════════════════════════╗
║           跨 Session 分析摘要                          ║
║           Generated: 2026-04-03 12:00:00 HKT          ║
╚════════════════════════════════════════════════════════╝

📊 問題規律追蹤
────────────────────────────────────────────────────────
  - L0 timeout：出現 333 次 | 上次：2026-04-03
  - Operation failed：出現 96 次 | 上次：2026-04-02

📁 項目追蹤
────────────────────────────────────────────────────────
  📌 Auto Dreaming (#079) | P2 | 2026-04-03
```

---

### cross_session_bootstrap.js - Session Reset 恢復

當 Session Reset 之後，呢個 script 幫我恢復 context。

```bash
# 運行 bootstrap
node scripts/cross_session_bootstrap.js

# 安靜模式
node scripts/cross_session_bootstrap.js --quiet
```

**輸出：** `~/.openclaw/workspace/.cross_session_context.md`

**⚠️ 自動化** - Session 開始時自動運行（由 HEARTBEAT.md 觸發）

---

## 📅 Cron Jobs

| Job | 時間 | Script |
|-----|------|--------|
| Pattern Analysis | 每日 04:00 | `pattern_analysis_daily.js` |
| Pattern Archive | 每週日 | `pattern_archive.js` |
| Cross-Session Context | 每 heartbeat | `cross_session_bootstrap.js` |

---

## 🔄 完整工作流程

```
┌─────────────────────────────────────────────────────────────┐
│  Background (Cron Jobs)                                   │
│  ┌─────────────────┐  ┌─────────────────┐              │
│  │ pattern_analysis │  │ pattern_archive  │              │
│  │ _daily.js       │  │ .js             │              │
│  │ 04:00 daily     │  │ Weekly          │              │
│  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                         │
│           ▼                    ▼                         │
│  ┌─────────────────────────────────────────┐          │
│  │  memory/patterns/*.json                  │          │
│  │  (分析結果持久化)                          │          │
│  └─────────────────────────────────────────┘          │
│                          ▲                               │
└──────────────────────────│───────────────────────────────┘
                           │
┌──────────────────────────│───────────────────────────────┐
│  Session Reset 時        │                               │
│                          ▼                               │
│  cross_session_bootstrap.js                              │
│  → 生成 .cross_session_context.md                        │
│                          ▲                               │
│                          │                               │
│  ┌─────────────────────────────────────────┐          │
│  │  我記得之前討論過咩                       │          │
│  │  「上次你問緊 Auto Dreaming (#079)...」   │          │
│  └─────────────────────────────────────────┘          │
└───────────────────────────────────────────────────────────┘
```

---

## 💡 實際使用例子

### 當你話我知搞惦咗
```
你：L0 timeout 搞惦咗，已升級 systemEvent
我：✅ 已標記 L0 timeout 為已解決
    以後唔會再提醒呢個
```

### 當 session reset 之後
```
我：早！你上次討論緊 Auto Dreaming (#079)
    追蹤緊 Template-Engine Separation (#061)
    ⚠️ L0 timeout 已出現 333 次，建議永久修復
```

### 當有新規律發現
```
我：🆕 發現新 error pattern：Not found error (3次)
    要我幫你檢查嗎？
```

---

## 📝 總結指令卡

| 你想... | 指令 |
|---------|------|
| 查看分析摘要 | `node scripts/cross_session_context.js` |
| 查看主動提醒 | `node scripts/pattern_proactive_trigger.js` |
| 標記搞惦 | `node scripts/pattern_resolver.js --error "XXX" --resolve "原因"` |
| 重新打開 | `node scripts/pattern_resolver.js --reopen "XXX"` |
| 列出已解決 | `node scripts/pattern_resolver.js --list` |
| 預覽 Archive | `node scripts/pattern_archive.js --dry-run` |
| 手動運行分析 | `node scripts/pattern_analysis_daily.js` |

---

*檔案来源：从 TOOLS.md 拆分出來 | 2026-04-23*
*用途：保持 TOOLS.md < 12,000 bytes，讓 OpenClaw bootstrap 能完整載入*