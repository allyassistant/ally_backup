# Memory 系統連結格式分析報告

> 分析日期：2026-04-05  
> 分析範圍：Memory 系統連結格式選項（日期制 vs 主題制）

---

## 1. 建議：混合制（Hybrid）

### 明確建議：**混合制** —— 根據內容類型選擇最適合的連結格式

| 內容類型 | 建議格式 | 例子 |
|---------|---------|------|
| **每日對話記錄** (memory/2026-04-05-0001.md) | 日期制 | `[[2026-04-05]]` |
| **主題知識頁** (memory/projects/*.md) | 主題制 | `[[Stock Processing]]` |
| **Issue 頁面** (.issues/active/*.md) | 主題制 | `[[Auto Dreaming]]` |
| **L0/L1 摘要** (memory/l0-abstract/, l1-overview/) | 日期制 | `[[2026-04-05-L1]]` |
| **錯誤記錄** (memory/errors.json) | 主題制 | `[[Error: API Aborted]]` |

### 原因

**為何唔係純日期制 (Option A)：**
- ❌ 主題知識頁（如 projects/smart-pricing-system.md）用日期連結毫無意義
- ❌ 難以建立跨日期的主題關聯（例如追蹤「Stock Processing」相關的所有討論）
- ❌ Issue 系統本來就係主題導向，強行轉日期會破壞語義

**為何唔係純主題制 (Option B)：**
- ❌ 每日數十個對話記錄檔案難以逐個賦予有意義的主題名稱
- ❌ 時間順序是對話記錄的核心屬性，主題制會隱藏時間線
- ❌ 自動化腳本（如 L0/L1 Generator）依賴日期定位，主題制會增加複雜度

**為何混合制最適合：**
- ✅ **語義匹配**：日期內容用日期連結，主題內容用主題連結
- ✅ **漸進採用**：唔需要一次過改動所有現有檔案
- ✅ **雙向導航**：可以從時間線跳去主題，也可以從主題跳返時間線
- ✅ **兼容現有架構**：與現有 memory/ 子目錄結構（knowledge/, patterns/, projects/）一致

---

## 2. 與現有系統整合

### 2.1 與 .issues/ 整合

**現狀：**
- `.issues/active/`：活躍 Issue（如 079--auto-dreaming-.md）
- `.issues/archive/`：已歸檔 Issue
- Issue 使用編號 + 標題命名（如 `079--auto-dreaming-.md`）

**整合方案：**

```markdown
<!-- 在 Memory 日誌中引用 Issue -->
今日開始處理 [[Auto Dreaming]] 項目 (#079)。

<!-- 在 Issue 中引用 Memory -->
相關討論見 [[2026-04-03]] 同 [[2026-04-04]] 的對話記錄。
```

**Issue 連結規則：**
| 場景 | 連結格式 | 說明 |
|------|---------|------|
| 引用 Issue 主題 | `[[Issue Title]]` | 如 `[[Auto Dreaming]]` |
| 引用 Issue 編號 | `[[#079]]` | 保留編號作為別名 |
| Issue 內引用日期 | `[[YYYY-MM-DD]]` | 指向當日 Memory 檔案 |

### 2.2 與 errors.json 整合

**現狀：**
- `memory/errors.json`：結構化錯誤記錄（schema: openclaw.errors.v1）
- 每條錯誤有 id、type、title、tags 等欄位

**整合方案：**

```markdown
<!-- 在 Memory 中引用錯誤 -->
又遇到 [[Error: API Aborted]] 問題（見 #mnkl5b1zy31xm）。

<!-- 在錯誤記錄中引用相關討論（建議新增 metadata.links 欄位） -->
{
  "id": "mnkl5b1zy31xm",
  "title": "API Aborted",
  "links": ["[[2026-04-05]]", "[[Auto Dreaming]]"]
}
```

**建議：為 errors.json 新增 `links` 欄位**
```json
{
  "schema": "openclaw.errors.v2",
  "errors": [{
    "id": "xxx",
    "title": "API Aborted",
    "memoryLinks": ["2026-04-05", "2026-04-04"],
    "issueLinks": ["079"],
    "topicLinks": ["Auto Dreaming"]
  }]
}
```

---

## 3. 具體實現方案

### 3.1 檔案結構建議

```
memory/
├── 2026-04-05-0001.md          # 日期制：對話記錄（保持不變）
├── 2026-04-05-0002.md
├── projects/
│   └── smart-pricing-system.md # 主題制：項目文件
├── knowledge/
│   └── AUTO_DREAMING_KB_...    # 主題制：知識庫
├── patterns/
│   ├── topic-graph.json        # 主題關聯圖
│   └── errors.json             # 錯誤模式
├── l0-abstract/
│   └── 2026-04-05.md           # 日期制：每日摘要
├── l1-overview/
│   └── 2026-04-05.md           # 日期制：每日摘要
└── weekly-reviews/
    └── 2026-W14.md             # 建議：新增周回顧（主題制標題 + 日期範圍）

.issues/
├── active/
│   └── 079--auto-dreaming-.md  # 主題制：Issue 文件
└── archive/
    └── ...
```

### 3.2 連結格式定義

#### 完整語法規範

```markdown
<!-- 1. 日期連結 -->
[[2026-04-05]]              → 指向 memory/2026-04-05-*.md
[[2026-04-05-L1]]           → 指向 memory/l1-overview/2026-04-05.md
[[2026-W14]]                → 指向 memory/weekly-reviews/2026-W14.md

<!-- 2. 主題連結 -->
[[Stock Processing]]        → 指向 memory/projects/smart-pricing-system.md（透過索引）
[[Auto Dreaming]]           → 指向 .issues/active/079--auto-dreaming-.md

<!-- 3. Issue 連結 -->
[[#079]]                    → 指向 .issues/active/079--*.md

<!-- 4. 錯誤連結 -->
[[Error: API Aborted]]      → 指向 memory/errors.json 中對應條目

<!-- 5. 別名語法（進階） -->
[[顯示文字|實際連結]]        → 如 [[今日討論|2026-04-05]]
```

#### 解析優先順序

```
1. 檢查是否為日期格式 (YYYY-MM-DD) → 查找 memory/YYYY-MM-DD-*.md
2. 檢查是否為 Week 格式 (YYYY-WNN) → 查找 memory/weekly-reviews/
3. 檢查是否為 Issue 編號 (#NNN) → 查找 .issues/active/NNN--*.md
4. 檢查是否為 Error: 前綴 → 查找 memory/errors.json
5. 否則視為主題連結 → 查找 topic-graph.json 索引
```

### 3.3 實作步驟

**Phase 1：基礎建設（1-2 日）**
1. 創建 `memory/topic-graph.json` 索引檔案
   ```json
   {
     "topics": {
       "Stock Processing": {
         "primaryFile": "memory/projects/smart-pricing-system.md",
         "aliases": ["stock", "pricing"],
         "related": ["Auto Dreaming", "Diamond Stock"]
       },
       "Auto Dreaming": {
         "primaryFile": ".issues/active/079--auto-dreaming-.md",
         "aliases": ["dreaming", "knowledge base"],
         "related": ["Knowledge Base"]
       }
     }
   }
   ```

2. 創建連結解析工具 `scripts/memory_link_resolver.js`
   ```javascript
   function resolveLink(linkText) {
     // 日期格式
     if (/^\d{4}-\d{2}-\d{2}$/.test(linkText)) {
       return findMemoryByDate(linkText);
     }
     // Issue 編號
     if (/^#\d+$/.test(linkText)) {
       return findIssueByNumber(linkText);
     }
     // 主題連結
     return findTopic(linkText);
   }
   ```

**Phase 2：內容標記（持續進行）**
1. 在新 Memory 檔案中加入連結
2. 為重要 Issue 添加 `memoryLinks` 欄位
3. 為 errors.json 添加連結欄位

**Phase 3：自動化整合（1 週）**
1. 修改 L0/L1 Generator，在摘要中自動插入相關主題連結
2. 修改 Issue Manager，支援連結跳轉
3. 創建「反向連結」功能（顯示哪些文件連結到當前頁面）

---

## 4. 風險評估

### 4.1 技術風險

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| 連結解析歧義（同名主題） | 中 | 中 | 使用 topic-graph.json 強制指定優先級 |
| 檔案重命名後連結失效 | 高 | 中 | 使用 topic-graph.json 索引，唔直接硬編碼路徑 |
| 大量連結影響效能 | 低 | 低 | 解析結果快取，增量更新 |
| 日期格式衝突（非連結的日期文字） | 中 | 低 | 嚴格匹配 `[[YYYY-MM-DD]]` 語法 |

### 4.2 維護風險

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| topic-graph.json 變成孤兒索引 | 中 | 高 | 定期驗證腳本檢查連結有效性 |
| 連結標準不一致 | 高 | 中 | 制定明確規範，提供快捷模板 |
| 新加入的檔案冇被索引 | 高 | 低 | 自動掃描腳本定期更新索引 |

### 4.3 過渡期風險

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| 現有檔案冇連結導致「斷層」 | 高 | 低 | 漸進採用，新檔案先開始用連結 |
| 雙重標準造成混淆 | 中 | 中 | 清晰文檔 + 工具提示 |
| 自動化腳本需適配 | 中 | 中 | Phase 3 逐步修改，保留向後兼容 |

---

## 5. 總結

### 核心建議

1. **採用混合制**：日期內容用 `[[YYYY-MM-DD]]`，主題內容用 `[[Topic Name]]`
2. **建立 topic-graph.json 索引**：統一管理主題與檔案的對應關係
3. **分三階段實施**：基礎建設 → 內容標記 → 自動化整合
4. **保持向後兼容**：現有檔案唔強制修改，新檔案開始使用連結

### 立即行動項

- [ ] 創建 `memory/topic-graph.json` 索引檔案
- [ ] 創建 `scripts/memory_link_resolver.js` 解析工具
- [ ] 更新 `memory/errors.json` schema 加入 `links` 欄位
- [ ] 為下一個新 Issue 試用主題連結格式

---

*報告生成時間：2026-04-05 10:04 HKT*
