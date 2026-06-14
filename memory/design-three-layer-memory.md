# 三層記憶架構 - 優化建議

## 現有 MEMORY.md 分析

### 現有結構問題

#### 1. 內容重複（嚴重）
- Qwen3 learning notes 重複咗 **20+ 次**！
- 每段幾乎一樣，浪費 tokens
- 原因：每次 training session 都 append 一次

#### 2. 缺乏分層
- 所有內容扁平存放
- 重要警告同普通資訊混雜
- 難以區分「必須記住」同「一般參考」

#### 3. 結構混亂
- 沒有明確分類標準
- 時間線唔清楚（邊舊邊新）
- 政策/規則/知識/待辦混在一起

#### 4. 更新無標準
- 冇日期標籤慣例
- 唔知幾時更新
- 難追踪變更歷史

---

## 三層記憶架構設計

### 三層定義

| 層級 | 目的 | 存放內容 | 特性 |
|------|------|---------|------|
| **強制規則** | 最高優先級 | 警告、禁止、重要規則 | 每次對話必定顯示 |
| **語義記憶** | 核心知識 | 業務原則、技能知識 | 需要時檢索 |
| **情景記憶** | 歷史背景 | 事件、對話、決定 | 歸檔保存 |

---

### 第一層：強制規則（Top Priority）

**位置**：`memory/_core/`
**文件名**：`rules.md`

存放：
- 系統級警告
- 重要決定
- 禁止事項
- 必須遵守既規則

**示例**：
```markdown
# 強制規則 (2026-02-16)

## 🚨 重要警告
- **Shape 簡寫**：PR=Princess, PS=Pear，唔好再搞混！
- **Model 名**：MiniMax sub-agent 必須用 `minimax-portal/MiniMax-M2.5`

## 📋 強制政策
- 強制分析模式：**默認啟用**
- Token > 70%：**自動存檔 + 通知**
- Stock List 整合：**必須跟 template**

## ⚡ 快速參考
- 電話：Josh +852XXXXXX, Desanna +852XXXXXX
- Rapaport 計算：大過5卡用5.00-5.99表
```

**特點**：
- 每次開新 session 必定載入
- 放喺 MEMORY.md 最頂部
- 用粗體、emoji 標記重要度

---

### 第二層：語義記憶（Core Knowledge）

**位置**：`memory/_knowledge/`
**文件夾結構**：
```
memory/_knowledge/
├── diamond.md          # 鑽石知識
├── excel.md            # Excel 技巧
├── rapaport.md         # Rapaport 相關
├── business.md         # 業務原則
├── tools.md            # 工具使用
└── contacts.md         # 聯絡人偏好（從 contact-db 同步）
```

存放：
- 業務知識
- 技能技巧
- 產品資訊
- 工作流程

**示例** (`diamond.md`)：
```markdown
# 鑽石知識

## Shape 簡寫
| 簡寫 | 形狀 |
|------|------|
| PR | Princess |
| PS | Pear |

## 估值原則
- Rapaport × Carat × (1-Discount%)
- >5ct 用 5.00-5.99 表
```

---

### 第三層：情景記憶（Episodic）

**位置**：`memory/_daily/` + `_archive/`

**結構**：
```
memory/
├── _daily/              # 近期（30日內）
│   ├── 2026-02-14.md
│   ├── 2026-02-15.md
│   └── 2026-02-16.md
│
├── _archive/            # 歷史歸檔
│   ├── 2026-02/
│   │   ├── week-01.md   # 每週合併
│   │   └── distilled-report.json
│   └── ...
│
└── _index.md            # 索引
```

存放：
- 每日對話記錄
- 具體事件
- 決定過程
- 臨時待辦

**歸檔規則**：
- 30日後自動移到 `_archive/`
- 每週可選合併成 `week-XX.md`
- 提煉報告存 `_archive/`

---

## 文件夾結構建議

### 完整結構
```
memory/
├── MEMORY.md                    # 入口文件（精簡版）
│
├── _core/                       # 🔴 強制規則層
│   ├── rules.md                 # 核心規則
│   ├── decisions.md             # 重要決定
│   └── warnings.md               # 警告事項
│
├── _knowledge/                  # 🟡 語義記憶層
│   ├── diamond.md               # 鑽石知識
│   ├── excel.md                  # Excel 技巧
│   ├── rapaport.md               # Rapaport
│   ├── business.md               # 業務原則
│   ├── models.md                 # Model 分工
│   └── workflow.md              # 工作流程
│
├── _daily/                      # 🟢 情景記憶層（臨時）
│   ├── 2026-02-14.md
│   ├── 2026-02-15.md
│   └── 2026-02-16.md
│
├── _archive/                     # 情景記憶（歷史）
│   ├── 2026-01/
│   │   ├── week-01.md
│   │   └── week-02.md
│   ├── 2025-12/
│   │   └── ...
│   └── index.json                # 歸檔索引
│
├── contact-database.json         # 人際資源庫
│
└── design-*.md                   # 設計文檔
```

---

## 入口文件：MEMORY.md 精簡版

### 目標
MEMORY.md 只保留**必須**既資訊，確保：
- 開新 session 快速載入
- tokens 消耗合理
- 仍然包含所有重要資訊

### 建議結構
```markdown
# AI Roland 長期記憶

## 🚨 強制規則（每次必讀）
[來自 _core/rules.md 既精華]

## 📋 Model 分工
[來自 _knowledge/models.md]

## 📞 快速參考
- Josh: +852XXXXXX
- Desanna: +852XXXXXX

## 📚 知識索引
- 鑽石知識 → `_knowledge/diamond.md`
- Excel 技巧 → `_knowledge/excel.md`
- Rapaport → `_knowledge/rapaport.md`

## 📅 最近更新
- 2026-02-16: 強制分析模式啟用
- 2026-02-10: Qwen3 自動化啟用
- ...

---
*詳細內容見各知識模組*
```

---

## 實施步驟

### Phase 1: 結構重組
1. **創建文件夾**：
   ```bash
   mkdir -p memory/_core memory/_knowledge memory/_archive
   ```

2. **遷移現有 MEMORY.md**：
   - 強制規則 → `_core/rules.md`
   - 知識章節 → `_knowledge/*.md`
   - 每日記錄 → `_daily/`
   - 重複內容 → 刪除

### Phase 2: 更新加載邏輯
1. **主 session 載入**：
   ```
   AGENTS.md 指引 →
   讀取 MEMORY.md (精簡版) →
   _core/rules.md (強制) →
   其他按需
   ```

2. **確保 _core 必定載入**
   - 每次開新 session 都讀取 `_core/rules.md`

### Phase 3: 自動化
1. **每日記錄**：自動創建 `_daily/YYYY-MM-DD.md`
2. **每週提煉**：從 `_daily/` 提煉去 `_knowledge/`
3. **每月歸檔**：30日後移到 `_archive/`

---

## 同現有系統整合

### 強制分析模式
- 強制規則層每次必定載入
- 確保分析模式狀態喺 `_core/rules.md` 明確標記

### Qwen3 自動化
- `memory_maintenance.js` 負責：
  - 創建每日檔案
  - 執行每週提煉
  - 移動歸檔文件

### Token 管理
- 精簡版 MEMORY.md 減少 tokens
- 完整知識按需載入

---

## 質量標準

### 命名規範
- 文件名： kebab-case (e.g., `time-intent.md`)
- 變量名： camelCase
- 常量： UPPER_SNAKE_CASE

### 更新慣例
```markdown
## 章節標題 (2026-02-16 更新)

### 新增內容 (2026-02-16)
- ...

### 過時內容 (移動至 _archive)
- ...
```

### 去重策略
- 相同主題只保留一份
- 有更新就加日期標籤
- 舊版本移到 archive

---

## 遷移示例

### 現有重複問題
```
## Qwen3 Session 1
[重複 20 次！]
```

### 遷移後
```
_knowledge/excel.md:

# Excel 技巧累積

## XLOOKUP (2026-02-06)
...

## INDEX+MATCH (2026-02-07)
...

---
*Last Updated: 2026-02-16*
```

---

## Kimi 實施注意點

1. **一次過整理**：建議用一次較大既 reset/整理完成遷移
2. **保留精華**：現有 MEMORY.md 既 Qwen3 notes 合併去 `_knowledge/excel.md`
3. **測試路徑**：確保 AGENTS.md 指引既讀取路徑正確
4. **保持精簡**：入口 MEMORY.md 維持 < 2000 tokens

---

## 預期效果

| 指標 | 之前 | 之後 |
|------|------|------|
| MEMORY.md tokens | ~50,000 | ~2,000 |
| 知識文件數 | 1 | 6+ |
| 重複內容 | 20+ 處 | 0 |
| 強制規則顯示 | 可能漏 | 必定顯示 |
| 查找速度 | 慢 | 快（分類清晰） |

---

*設計完成：2026-02-16*
*負責人：MiniMax*
