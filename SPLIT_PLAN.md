# 📁 檔案拆分方案 (Split Plan)

*分析日期：2026-04-23*
*目標：將三個大型檔案拆分為符合 bootstrapMaxChars (12,000) 限制的模組化結構*

---

## 📊 現況分析

| 檔案 | 位元組 | 超標 | 截斷率 |
|------|--------|------|--------|
| TOOLS.md | 30,958 | +18,958 | **47%** 被截 |
| AGENTS.md | 21,698 | +9,698 | **23%** 被截 |
| HEARTBEAT.md | 19,065 | +7,065 | 會被截 |

**現有 Bootstrap 負擔：**
- SOUL.md (11,097) + MEMORY.md (9,703) = 20,800 → 完整
- 三個大檔 = 71,721 → 幾乎全部被截
- **結論**：急需拆分，否則 Ally 每次 session 都只能獲得殘缺的上下文

---

## 🎯 拆分原則

1. **每個檔案 ≤ 12,000 位元組**（配合 bootstrapMaxChars）
2. **相關內容放同一檔案**（減少跨檔引用）
3. **重要核心檔案（SOUL/MEMORY/IDENTITY）保持完整**
4. **拆分時保留足夠的跳轉連結**，方便查找

---

# 🔱 AGENTS.md 拆分方案（21,698 → 6 個檔案）

## 建議結構

| 新檔案 | 內容大綱 | 預估大小 | 優先級 |
|--------|----------|----------|--------|
| **AGENTS.md** (精簡版) | 核心身份、語言規則、檔案使用規則、Session 流程、HA 協調入門 | ~7,000 | 最高 |
| **AGENTS_SPAWN.md** | Router 使用流程、Spawn 流程、Kim Code CLI 流程、Auto-spawn.js 說明 | ~5,000 | 高 |
| **AGENTS_STANDARDS.md** | Coding Standards (P0-P3)、Security、Performance、Testing、Documentation 全套 | ~8,000 | 高 |
| **AGENTS_HA.md** | HA 協調規則（完整版）、Failover 判斷、責任轉移、避免衝突 | ~4,000 | 中 |
| **AGENTS_ERRORS.md** | 常見錯誤預防（Prevention Rules）、重要決策記錄 | ~3,500 | 中 |
| **AGENTS_REVIEW.md** | 架構調整檢查規則、自動化規則、完整檢查清單 | ~4,000 | 低 |

### AGENTS.md（精簡版）—— 內容大綱

```markdown
# AGENTS.md - 行為準則同決策規則 (Ally - 主力對話)

## 核心身份
- 我係邊個（Ally - 對話專員）
- HA 協調責任（每 3 分鐘檢查 Bliss）

## 語言規則
- 繁體中文書寫規則
- 禁止簡體中文

## 檔案使用規則
- 邊個檔案放咩（AGENTS/MEMORY/TOOLS/errors/.issues/SOUL/IDENTITY）

## 每個 Session 必做
- 開始時：讀 SOUL→USER→MEMORY，檢查 Issues、Bliss 狀態、Cross-Session Context
- 結束時：更新記憶、創建 Issue、記錄 Error

## HA 協調（入門版）
- Heartbeat/Failover 基本指令
- 完整內容 → AGENTS_HA.md

## 重要跳轉
- Spawn 流程 → AGENTS_SPAWN.md
- Coding Standards → AGENTS_STANDARDS.md
- 錯誤預防 → AGENTS_ERRORS.md
```

---

# 🔧 TOOLS.md 拆分方案（30,958 → 7 個檔案）

## 建議結構

| 新檔案 | 內容大綱 | 預估大小 | 優先級 |
|--------|----------|----------|--------|
| **TOOLS.md** (精簡版) | 目錄、HA協調、Issue管理、Error追蹤、Apple Notes、Discord操作 | ~9,000 | 最高 |
| **TOOLS_MEMORY.md** | 記憶管理指令、時間搜尋、清理、歸檔、生成 | ~4,000 | 高 |
| **TOOLS_BROWSER.md** | 瀏覽器使用規則、X.com 連結處理（完整版） | ~3,500 | 高 |
| **TOOLS_MODEL.md** | 模型使用、MiniMax 規則、Ollama 限制、Kimi Code CLI 完整用法 | ~5,000 | 高 |
| **TOOLS_STOCK.md** | Stock List 工具（合併、更新、注意事項） | ~4,000 | 中 |
| **TOOLS_CROSSSESSION.md** | 跨 Session 分析引擎（完整版 - 9K，獨立成檔） | ~9,000 | 高 |
| **TOOLS_GENERAL.md** | 通用規則：Tool Retry、數據提取、時間計算、SSH 設定、Script 編寫 | ~8,000 | 中 |

### TOOLS.md（精簡版）—— 內容大綱

```markdown
# TOOLS.md - 工具使用指南 (精簡版)

## 目錄（附跳轉連結）

## HA 協調工具（基礎）
- 角色分工、檔案位置、指令

## Issue 管理
- create/list/progress/complete 指令

## Error 追蹤
- scan/list/search/stats/add 指令

## Weekly Correction Loop
- code_quality_manager.js 統一入口

## Apple Notes
- HTML 格式指南、創建範例

## Discord 操作
- 頻道列表、訊息限制、Streaming

## 跳轉至其他 TOOLS_*.md 檔案
```

---

# 💓 HEARTBEAT.md 拆分方案（19,065 → 4 個檔案）

## 建議結構

| 新檔案 | 內容大綱 | 預估大小 | 優先級 |
|--------|----------|----------|--------|
| **HEARTBEAT.md** (精簡版) | Heartbeat 執行清單、每日/每週 cron jobs、已停用項目 | ~6,000 | 高 |
| **HEARTBEAT_AUTO.md** | 自動維護規則（Token/Memory/Stock/Notes 監控） | ~7,000 | 高 |
| **HEARTBEAT_ISSUE.md** | Issue Manager 完整系統、Auto-Followup、Issue-Reminders Sync | ~6,000 | 中 |

### HEARTBEAT.md（精簡版）—— 內容大綱

```markdown
# HEARTBEAT.md - 每日自動維護系統（精簡版）

## Heartbeat 執行清單（11 項核心任務）

## 每週任務
- weekly_correction_loop.js
- memory_distiller.js
- pattern_archive.js

## 每日定時任務
- L0 Abstract (00:05)
- L1 Overview (00:35)
- Daily Maintenance (02:00)
- Discord Channel Logger (23:55)

## 已停用 / 移至其他位置

## 跳轉
- 自動維護詳細規則 → HEARTBEAT_AUTO.md
- Issue 管理系統 → HEARTBEAT_ISSUE.md
```

---

## 📋 建議的 BootstrapMaxChars 設定

```json
{
  "agents.defaults.bootstrapMaxChars": 15000,
  "agents.defaults.bootstrapTotalMaxChars": 100000
}
```

**理由：**
- 拆分後最大檔案（TOOLS_STANDARDS、TOOLS_CROSSSESSION）≈ 9,000-10,000
- 設定 15,000 提供安全緩衝
- 總上限 100K 確保所有關鍵檔案都能載入

---

## 🗂️ 拆分後預期檔案結構

```
~/.openclaw/workspace/
├── SOUL.md              (~11K) ✅ 完整
├── MEMORY.md            (~10K) ✅ 完整
├── IDENTITY.md          (~2K)  ✅ 完整
├── USER.md              (~0.4K) ✅ 完整
│
├── AGENTS.md            (~7K)  ✅ 精簡版 - 行為準則核心
├── AGENTS_SPAWN.md      (~5K)  ✅ Spawn/Spawn 流程
├── AGENTS_STANDARDS.md  (~8K)  ✅ Coding/Testing/Doc Standards
├── AGENTS_HA.md         (~4K)  ✅ HA 協調完整版
├── AGENTS_ERRORS.md     (~3.5K)✅ 錯誤預防規則
├── AGENTS_REVIEW.md     (~4K)  ✅ 架構調整/自動化規則
│
├── TOOLS.md             (~9K)  ✅ 精簡版 - 工具指南核心
├── TOOLS_MEMORY.md      (~4K)  ✅ 記憶管理指令
├── TOOLS_BROWSER.md     (~3.5K)✅ 瀏覽器使用規則
├── TOOLS_MODEL.md       (~5K)  ✅ 模型使用+Kimi CLI
├── TOOLS_STOCK.md       (~4K)  ✅ Stock List 工具
├── TOOLS_CROSSSESSION.md (~9K) ✅ 跨 Session 分析引擎
├── TOOLS_GENERAL.md     (~8K)  ✅ 通用規則（Retry/SSH/Script）
│
├── HEARTBEAT.md         (~6K)  ✅ 精簡版 - 心跳核心清單
├── HEARTBEAT_AUTO.md    (~7K)  ✅ 自動維護規則
└── HEARTBEAT_ISSUE.md   (~6K)  ✅ Issue 管理系統
```

---

## ⚡ 優先執行順序

### Phase 1：最關鍵（立即處理）
1. **TOOLS_CROSSSESSION.md** — 現存 TOOLS.md 中最大（約 9K），目前被截 47%
2. **TOOLS_GENERAL.md** — 包含關鍵的 SSH/Script 規則

### Phase 2：高優先
3. **AGENTS_STANDARDS.md** — Coding Standards 是核心參考
4. **AGENTS_SPAWN.md** — Router/Spawn 流程每天使用

### Phase 3：完成拆分
5. 其餘所有檔案

---

## 📝 範例檔案

以下範例已創建：
1. `TOOLS_CROSSSESSION.md` — 從 TOOLS.md 拆分出來的跨 Session 分析引擎
2. `AGENTS_STANDARDS.md` — 從 AGENTS.md 拆分出來的 Coding/Testing/Doc Standards

---

*方案制定：Kimi Code CLI 分析 | 2026-04-23*