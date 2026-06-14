# Token 最大優化策略 (Token Max Optimization)

## 優化層級總覽

### Layer 1: 文件結構重構 (立即生效)
- [x] 創建精簡版快速參考文件
- [x] 分離詳細教學內容到獨立文件
- [x] 建立索引系統

### Layer 2: 動態載入機制
- [x] 按需載入 (Load-on-Demand)
- [x] 上下文感知記憶選擇
- [x] Heavy content 外部化

### Layer 3: 對話模式優化
- [x] 簡潔回應格式
- [x] 避免重複上下文
- [x] 主動清理舊消息

### Layer 4: 自動化管理
- [x] 定期壓縮舊記憶
- [x] 智能歸檔系統
- [x] Token 監控預警

### Layer 5: 技術性優化
- [x] 外部數據存儲 (JSON)
- [x] 快速查找索引
- [x] Sub-agent 策略強化

---

## 具體實施方案

### 1. 記憶文件分層結構

```
memory/
├── _index.md              # 快速索引 (總是載入)
├── _quickref.md           # 精簡參考 (<100 行)
├── _daily/                # 每日記憶 (只保留最近 7 天)
│   ├── 2026-02-01.md
│   └── 2026-02-02.md
├── _archive/              # 歸檔記憶 (不自動載入)
│   ├── 2026-01-*.md
│   └── MEMORY_2026-01.md  # 月度壓縮版
├── rapaport_db.json       # 外部數據 (不佔 token)
├── diamond_stock.json     # 外部數據 (不佔 token)
└── _skills/               # 技能文件 (按需載入)
    ├── excel_advanced.md
    ├── diamond_market.md
    └── rapaport_extraction.md
```

### 2. 動態載入規則

**總是載入 (Core)**:
- SOUL.md (~30 行)
- USER.md (~20 行)
- memory/_index.md (~50 行)
- memory/_quickref.md (~100 行)
- 今日 + 昨日 daily log (~40 行)
**總計: ~240 行核心記憶**

**按需載入 (On-Demand)**:
- 鑽石業務詳情 → 讀取 `_skills/diamond_market.md`
- Excel 高級技巧 → 讀取 `_skills/excel_advanced.md`
- Rapaport 提取詳情 → 讀取 `_skills/rapaport_extraction.md`
- 歷史記憶查詢 → 讀取 `_archive/*.md`

### 3. Token 監控規則

**綠色 (<50%)**: 正常運作
**黃色 (50-70%)**: 
- 啟動簡潔模式
- 避免載入技能文件
- 主動總結對話

**紅色 (>70%)**:
- 強制開啟新 session
- 或 spawn sub-agent
- 只保留核心上下文

**危急 (>85%)**:
- 立即存檔當前對話
- 開啟全新 session
- 提供對話摘要

### 4. 對話優化協議

**簡潔模式 (Concise Mode)**:
- 回應限制在 3 句內
- 省略問候語和填充詞
- 使用要點列表而非段落

**標準模式 (Standard Mode)**:
- 正常詳細程度
- 完整解釋和例子

**詳細模式 (Verbose Mode)**:
- 僅在明确要求時使用
- 完整教學和背景

### 5. Sub-agent 使用規則

**必須使用 Sub-agent**:
- 處理 >50 條鑽石記錄
- 讀取 >2MB 文件
- 批量 Excel 處理 (>3 文件)
- 複雜多步驟計算 (>5 步)
- 長時間運算 (>30 秒)

**Sub-agent 參數**:
```json
{
  "context": "minimal",
  "memory": ["SOUL.md", "USER.md"],
  "output": "summary_only",
  "max_tokens": 2000
}
```

---

## 實施檢查清單

### Phase 1: 文件重構 (已完成)
- [x] 創建本優化策略文件
- [ ] 創建 `_index.md` 索引
- [ ] 創建 `_quickref.md` 精簡參考
- [ ] 將 MEMORY.md 內容分類到 `_skills/`
- [ ] 創建 `_archive/` 並移動舊文件

### Phase 2: 自動化設置 (待完成)
- [ ] 設置每日自動歸檔 cron job
- [ ] 創建 token 監控腳本
- [ ] 設置 session 健康檢查

### Phase 3: 測試與調整 (待完成)
- [ ] 測試新結構載入時間
- [ ] 測試按需載入功能
- [ ] 調整 token 閾值

---

## 預期效果

**優化前**:
- 每次 session 載入 ~600 行記憶
- Token 使用量: ~3000-4000 tokens
- 大約 15-20 條消息後開始緩慢

**優化後**:
- 每次 session 載入 ~240 行核心記憶
- Token 使用量: ~1200-1500 tokens (減少 60%)
- 可處理 40-50 條消息才需要清理
- 重型工作自動分流到 sub-agent

---

## 緊急情況處理

如果 token 即將耗盡:

1. **立即執行**:
   ```
   /new
   ```
   開啟全新 session

2. **保留上下文**:
   我會提供當前對話的 3 點摘要

3. **繼續工作**:
   從摘要恢復，無需重新載入歷史

---

*Created: 2026-02-01*
*Next Review: 2026-02-15*
