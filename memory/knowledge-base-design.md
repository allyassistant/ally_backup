# 知識庫模式 (Knowledge Base Mode) - 詳細設計

*版本：2026-04-25 | Ally (Mac A)*

---

## 🎯 目標

將 Ally 變成 Josh 既**私人知識庫**：
- 自動吸收 🎓學習 channel、🔗 X links 等外部資訊
- 結構化儲存，長期記憶
- 將來可以回答「你之前提過咩關於 AI token？」

---

## 🏗️ 整體架構

```
┌─────────────────────────────────────────────────────────┐
│                    輸入來源 (Input Sources)               │
├─────────────────────────────────────────────────────────┤
│  🎓學習 Channel    🔗 X Links    💬 Discord 對話       │
│  📺YouTube        📄 文件         📝 用戶明確指示      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              分類路由 (Content Router)                   │
├─────────────────────────────────────────────────────────┤
│  🔧 技術操作 → 系統文檔                                   │
│  📊 行業趨勢 → 每日摘要                                  │
│  💡 重要洞察 → 長期記憶                                  │
│  🎯 决策事項 → Wiki + Issue                             │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
┌─────────────────┐ ┌─────────┐ ┌─────────────┐
│      Wiki       │ │  L0/L1  │ │   Memory    │
│  (結構化知識)    │ │ (摘要)   │ │ (長期記憶)   │
│                 │ │         │ │             │
│ • 系統架構       │ │ • 每日  │ │ • 重要洞察  │
│ • 操作指南       │ │   摘要  │ │ • 决策記錄  │
│ • Claims        │ │ • 事件  │ │ • 偏好      │
│ • 技術文檔       │ │   回顧  │ │             │
└─────────────────┘ └─────────┘ └─────────────┘
          │              │              │
          └──────────────┼──────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   搜尋介面          │
              │ memory_search       │
              │ corpus=all         │
              └─────────────────────┘
```

---

## 📥 輸入來源 (Input Sources)

### 1. 🎓學習 Channel
| 內容類型 | 識別方式 | 處理方式 |
|----------|----------|----------|
| 技術操作文檔 | 包含代碼、指令、setup | → Wiki (技術文檔) |
| 行業分析/趨勢 | 包含數據、預測、分析 | → L0/L1 (每日摘要) |
| Podcast 筆記 | 包含時間線、要點 | → L0 (精華摘要) |
| AI 相關資訊 | 主動標記 | → Wiki + Memory |

### 2. 🔗 X / Twitter Links
| 內容類型 | 處理方式 |
|----------|----------|
| 技術文章 | 分析後 → Wiki |
| 行業趨勢 | 分析後 → L1 + Memory |
| 新聞 | 提取關鍵點 → L1 |

### 3. 💬 Discord 對話
| 內容 | 處理方式 |
|------|----------|
| 用戶話「記住呢個」 | → Wiki 或 Memory |
| 重要决策 | → Memory (issue) |
| 系統變更 | → Wiki (update) |

### 4. 📺YouTube Channel
| 內容類型 | 處理方式 |
|----------|----------|
| 教學影片 | 總結 → L0/L1 |
| 產品評測 | 關鍵點 → L1 |
| 行業分析 | 洞察 → Memory |

---

## 🔀 分類路由規則 (Content Router)

### 自動分類演算法

```javascript
function classifyContent(content, source) {
  // 1. 技術操作檢測
  if (content.match(/\b(cli|command|script|install|setup|config)\b/i)) {
    return 'wiki-technical';
  }
  
  // 2. 數據/分析檢測
  if (content.match(/\b(%|token|cost|performance|speed)\b/i)) {
    return 'summary-l1';
  }
  
  // 3. 決策/判斷檢測
  if (content.match(/\b(recommend|suggest|conclusion|decision)\b/i)) {
    return 'memory-priority';
  }
  
  // 4. 預設：根據來源
  if (source === 'learning') return 'summary-l0';
  if (source === 'x-link') return 'memory';
  return 'memory';
}
```

### 分類優先級

| 等級 | 內容 | 目的地 | TTL |
|------|------|--------|-----|
| P0 | 系統架構、核心决策 | Wiki + Memory | 永恆 |
| P1 | 重要洞察、趋势分析 | Memory + L0 | 180日 |
| P2 | 一般資訊、每日摘要 | L1 + L2 | 90日 |
| P3 | 臨時資訊 | L2 only | 30日 |

---

## 📤 輸出流程 (Output Flow)

### Wiki 寫入流程

```
學習 Channel 新內容
        ↓
   分析內容類型
        ↓
   符合 Wiki 條件？
        │
   ┌────┴────┐
   │         │
  是        否
   ↓         ↓
提取關鍵點   歸類到其他
        ↓
   生成 Wiki Page
   (structured claims)
        ↓
   寫入 wiki/entities/
   或 wiki/concepts/
        ↓
   更新 AGENTS.md 索引
```

### Memory 寫入流程

```
外部資訊輸入
        ↓
   提取核心洞察
        ↓
   生成 L0/L1 格式
        ↓
   寫入 memory/
   (timestamped)
        ↓
   更新 MEMORY.md 索引
```

---

## 🔍 搜尋流程 (Search Flow)

### 單一搜尋介面

```bash
# 用戶問：「你之前提過咩關於 AI token？」
↓

memory_search corpus=all "AI token"
        ↓
┌─────────────────────────────────┐
│         搜尋結果 (多源)          │
├─────────────────────────────────┤
│ Wiki:    AI Token 分析 (2026-04-24)│
│ Memory:  Podcast 筆記 L0        │
│ Memory:  X link 分析 L1          │
│ Memory:  學習 Channel 摘要       │
└─────────────────────────────────┘
        ↓
   整合呈現
        ↓
   「你喺 04-24 學 channel 提過...
     Dylan Patel 話 AI token 需求...」
```

### 搜尋優先級

| 優先級 | 來源 | 用途 |
|--------|------|------|
| 1 | Wiki | 結構化知識、系統文檔 |
| 2 | Memory (L0/L1) | 每日摘要、洞察 |
| 3 | L2 Daily | 原始對話記錄 |

---

## ⏰ 自動執行時間表

| 時間 | 任務 | 頻率 |
|------|------|------|
| 06:00 | 吸收 🎓學習 Channel 新內容 | 每日 |
| 08:00 | 整理前日重要資訊 | 每日 |
| 10:00 | 搜尋 Layer 熱門資訊 | 每週 |
| 00:05 | L0 Abstract 生成 | 每日 |
| 00:35 | L1 Overview 生成 | 每日 |

### 每日流程

```
06:00 ─┬─ 讀取學習 Channel (last 24h)
       │    ↓
       │   分析新內容
       │    ↓
       │   分類 → Wiki/L0/Memory
       │    ↓
       └─→ 寫入對應位置

08:00 ─┬─ 整理前日重要資訊
       │    ↓
       │   提取決策、洞察
       │    ↓
       │   更新 MEMORY.md 索引
       │    ↓
       └─→ 通知用戶（如有重要更新）

00:05 ─┬─ L0 Abstract 生成
       │    ↓
       │   (系統自動執行)
       │    ↓
       └─→ 包含當日吸收的內容
```

---

## 📊 知識庫 Stats

| 指標 | 初始值 | 預期增長 |
|------|--------|----------|
| Wiki Pages | ~20 | +5-10/月 |
| L0 Abstracts | 365/年 | +365/年 |
| L1 Overviews | 365/年 | +365/年 |
| Memory (洞察) | ~50 | +10-20/月 |

### 存儲估計

| 類型 | 每項大小 | 每年總計 |
|------|----------|----------|
| Wiki | ~5KB | ~600KB |
| L0 | ~1KB | ~365KB |
| L1 | ~2KB | ~730KB |
| Memory | ~0.5KB | ~180KB |
| **總計** | | **~2MB/年** |

---

## ⚙️ 配置選項

### 用戶可控設定

```yaml
# 知識庫模式設定
knowledge_base:
  # 自動吸收開關
  auto_ingest:
    learning_channel: true    # 自動吸收學習頻道
    x_links: true             # 自動分析 X links
    youtube: false            # YouTube (可選)
  
  # 保留期限
  retention:
    wiki: permanent           # Wiki 永恆
    memory_l0: 180            # L0: 180日
    memory_l1: 90             # L1: 90日
    memory_l2: 30             # L2: 30日
  
  # 搜尋設定
  search:
    default_corpus: all       # 預設搜尋所有
    wiki_priority: true        # Wiki 優先顯示
```

---

## 🔧 實作狀態

| 功能 | 狀態 | 備註 |
|------|------|------|
| Wiki 系統 | ✅ 完整 | isolated mode, 39 pages, 6 reports |
| L0/L1/L2 記憶 | ✅ 完整 | l0-abstract/l1-overview 正常運作 |
| Symbol Map | ✅ 完整 | 2520 symbols, 205 files, 每晚 00:41 生成 |
| 學習 Channel 讀取 | ✅ 可用 | message tool (需 guildId) |
| X link 分析 | ✅ 可用 | browser tool |
| **分類規則** | ✅ 已制定 | `knowledge_classifier.js` 已創建 |
| 自動分類路由 | ✅ 已實現 | 完整關鍵詞匹配 + 來源映射 |
| 每日吸收 Cron | ✅ 完整 | Phase 2 完成 |

---

## 🎯 下一步行動

### Phase 1: 基本整合 (今日可做)
- [ ] 確認現有架構支援知識庫模式
- [ ] 設定 Wiki 結構（entities/concepts）
- [ ] 制定分類規則

### Phase 2: 自動化 (1-2週)
- [x] 實現 `knowledge_ingester.js`（自動吸收腳本）
- [x] 設定每日吸收 Cron (06:00) - Job ID: `9ebd92c9-c19e-47e8-a43f-3c940ecfdede`
- [x] 實現自動分類（使用 `knowledge_classifier.js`）

### Phase 3: 增強 (持續)
- [ ] 加入反饋學習
- [ ] 優化分類準確率
- [ ] 加入用戶確認機制

---

## 💡 核心原則

1. **唔好乜都抄** — 太多噪音反而無用
2. **分層儲存** — Wiki/L0/Memory 各有用途
3. **定期整理** — 每週清理無用內容
4. **可追蹤** — 任何資訊都能找到來源

---

## 📝 使用範例

### 範例 1: 學習 Channel 新內容

```
輸入：學習 Channel 有篇 M5 Max + Claude Code 装机文章
處理：
  1. 分析 → 技術操作文檔
  2. 提取關鍵步驟
  3. 寫入 wiki/concepts/m5-max-setup.md
結果：以後問「點樣喺 Mac 裝 AI 環境？」我可以回答
```

### 範例 2: X link 分析

```
輸入：你 send X link 關於 AI token 需求爆炸
處理：
  1. 分析文章內容
  2. 提取核心洞察
  3. 寫入 memory/L0 + wiki/concepts/ai-token-trend.md
結果：以後問「AI token 需求點？」我可以引用
```

### 範例 3: 搜尋

```
輸入：「你之前提過咩關於 M5 Max？」
處理：
  1. memory_search corpus=all "M5 Max"
  2. 找到 wiki/concepts/m5-max-setup.md
  3. 找到當日學習 Channel 摘要
輸出：「你喺 04-23 學習 Channel 提過 M5 Max 128GB 装机...
      詳見 wiki/concepts/m5-max-setup.md」
```

---

*Last Updated: 2026-04-25 | Ally (Mac A) | Status: 概念設計階段*