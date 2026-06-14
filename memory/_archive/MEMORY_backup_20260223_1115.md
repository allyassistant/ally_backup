# 精簡長期記憶 (Lean Long-Term Memory)

---

## 記憶系統架構 (2026-02-21 重要更新)

### 三層記憶架構

| Layer | 名稱 | 用途 | 時間 |
|-------|------|------|------|
| **L0** | Abstract | 200字精華摘要 | 每日 **00:05** |
| **L1** | Overview | 600字詳細summary | 每日 **00:35** |
| **L2** | Daily | 每日 raw logs | 每 heartbeat |

### 運作流程

```
Heartbeat (每30分鐘)
    ↓
log_to_daily_memory.js --auto
    ↓
讀取 ALL sessions (Main + Discord + WhatsApp)
    ↓
寫入 memory/YYYY-MM-DD.md (L2)
    ↓
00:05 L0 generate_abstract.js (讀尋日 - 完整24小時)
    ↓
00:35 L1 generate_l1.js (讀尋日 - 完整24小時)
```

### 重要特性 (必須記住)

1. **L0/L1 讀取「尋日」的完整 memory file**
   - 00:05 / 00:35 生成，確保尋日完全結束
   - 摘要尋日 00:00-23:59 全部內容，唔會遺漏
   - 生成後寫入對應日期既 l0-abstract/YYYY-MM-DD.md / l1-overview/YYYY-MM-DD.md

2. **讀取 actual message content**
   - log_to_daily_memory.js 會讀取 actual 對話內容
   - 唔係淨係 channel name

3. **Deduplication**
   - 避免重複寫入相同既 content
   - 用 content-based check (first 80 chars)

4. **No Emoji**
   - 所有 markers 改為 text: [MAIN], [SYSTEM], [YOUTUBE] 等
   - 避免 encoding 問題

5. **Only Main Session can write**
   - Sub-agents (Qwen3) 係隔離既，寫唔到 shared files
   - 所以 L0/L1 要用 Main Session model 生成

---

## 時間感知記憶系統 (2026-02-23) [NEW]

### 新增功能

| 功能 | 用途 | 指令 |
|------|------|------|
| **時間衰減** | 舊記憶自動降權 | `--decay` |
| **雙時態** | 記錄「事件日期」vs「記錄日期」| 自動偵測 |
| **時序搜尋** | 按時間緊急性排序 | `--event-date` |

### 時間衰減 (Temporal Decay)

搜尋時舊記憶自動降低優先級：

| 時間範圍 | 權重 | 說明 |
|----------|------|------|
| ≤1 日 | 100% | 最新記憶，完全保留 |
| ≤1 週 | 80% | 近期記憶，輕微衰減 |
| ≤1 個月 | 50% | 普通記憶，中度衰減 |
| ≤3 個月 | 30% | 較舊記憶，大幅衰減 |
| ≤6 個月 | 20% | 陳舊記憶，極低權重 |
| ≤1 年 | 10% | 歷史記憶，幾乎忽略 |
| >1 年 | 5% | 非常舊，僅作參考 |

**使用場景：**
- 用戶問「上次講過咩」→ 優先顯示最近講過嘅內容
- 避免陳年舊事遮蓋最新資訊

### 雙時態 (Dual-Temporal)

每條記憶記錄兩個時間點：
- **事件日期**：呢條記憶講緊「幾時發生」嘅事
- **記錄日期**：呢條記憶「幾時寫入」

**格式：**
```
[14:30] [事件: 2026-03-01 | 記錄: 2026-02-20] 我3月1號要去日本
[16:45] [事件: 2026-02-25 | 記錄: 2026-02-22] 更正，改為2月25號
```

**自動偵測：**
- `[事件: YYYY-MM-DD]` 標記
- 相對時間詞：「明天」、「後天」、「下星期」
- ISO 日期格式：`2026-03-01`

**搜尋優化：**
- 按「事件日期」排序：即將發生嘅事優先顯示
- 區分「計劃」vs「記錄」：避免混淆改期前後的資訊

### 指令

```bash
# 基礎搜尋
node scripts/memory_temporal_search.js "Japan"

# 加時間衰減
node scripts/memory_temporal_search.js "meeting" --decay

# 雙時態模式（按事件日期排序）
node scripts/memory_temporal_search.js "travel" --event-date

# 詳細輸出
node scripts/memory_temporal_search.js "project" --decay --verbose

# 限制時間範圍
node scripts/memory_temporal_search.js "diamond" --days 7 --decay
```

### 整合流程

```
記憶寫入 (log_to_daily_memory.js)
    ↓
自動偵測事件日期 (雙時態)
    ↓
記錄格式: [HH:MM] [事件: X | 記錄: Y] 內容
    ↓
搜尋時 (memory_temporal_search.js)
    ↓
計算分數 = 相關度 × 時間衰減 × 事件緊急性
    ↓
排序輸出 (高到低)
```

---
   - 所以 L0/L1 要用 Main Session model 生成

### Cron Jobs 時間

| Job | Time | 功能 |
|-----|------|------|
| L0 | 03:00 | MiniMax 生成 200字 |
| L1 | 03:30 | MiniMax 生成 600字 |
| Daily Summary | 23:59 | Post 去 #📕日記 |

---

## Rapaport 價格計算 (2026-02-07 更新)
1. **形狀**: Round=RBC 表,其他=Pear 表
2. **重量**: 1.00-1.49 | 1.50-1.99 | 2.00-2.99 | 3.00-3.99 | 4.00-4.99 | 5.00+
3. **重要規則 (2026-02-03 更新)**: **凡係大過 5 卡嘅鑽石都用 5.00-5.99 個表去計，包括 10 卡！**
4. **計算**: (表格值×100 × Carat) × (1-Discount%)
5. **FL**: 使用 IF 價格（同價，唔使加）
6. **輸出格式**:
   ```
   <Shape> <Carat> <Color> <Clarity>
   Discount: <Discount>%
   Total: USD <Amount>
   ```

### Rapaport 估值參考 (NEW - 2026-02-07)
當用戶查詢鑽石或計算價錢時，額外提供相對於 Rapaport 的折扣/溢價估值：

**估值等級:**
| 等級 | Rapaport 折扣 | 說明 |
|------|---------------|------|
| 🔴 偏低 | -35% ~ -45% | 急於套現 / 市場弱勢 |
| 🟡 合理 | -20% ~ -35% | 正常市場價格 |
| 🟢 偏高 | -10% ~ -20% | 優質貨 / 市場強勢 |
| 💎 極高 | 0% ~ +10% | 頂級貨 / 稀有規格 |

**輸出格式:**
```
*<Parcel Name>*
• Shape: <Shape>
• Carat: <Carat>
• Color: <Color>
• Clarity: <Clarity>
• Cut/Pol/Sym: <Cut/Pol/Sym>
• Fluor: <Fluorescence>
• GIA: <Cert No.>

💰 價格參考:
• Rapaport 基準: USD <base_price>
• 保守估值 (-35%): USD <price_low>
• 市場估值 (-25%): USD <price_mid>
• 樂觀估值 (-15%): USD <price_high>

💡 **備註**: 估值純粹基於 Rapaport 基準，唔參考 Stock list memo 價
```

---

## V9 Stock List 要求
**列**: Parcel Name | Shape | Crt | Color | Clarity | Cut | Pol | Symm | Measur | Depth | Table | Fluor | Lab | Cert No | Memo Price

**排序**: Shape (RBC 先) → Carat (大→小) → Color (D→Z)

**格式**: 全部置中 | Crt 2 位小數 | Memo Price 逗號+2 位 | 標題粗體 | 形狀間空白行 | 總行粗體

**過濾**: 只保留有 GIA NO 的行,排除 Total/Subtotal

**形狀**: RD→RAD 自動轉換

## Stock List Shape 簡寫 (重要！)
**2026-02-03 更新 - 唔好再搞混！**
| 簡寫 | 形狀 | 英文 |
|------|------|------|
| **PR** | **Princess** | 公主方 |
| **PS** | **Pear** | 梨形 |
| RBC | Round Brilliant | 圓鑽 |
| CU | Cushion | 枕形 |
| OV | Oval | 橢圓形 |
| EM | Emerald | 祖母綠形 |
| RAD | Radiant | 雷地恩形 |
| HS | Heart | 心形 |
| MQ | Marquise | 馬眼形 |
| SEM | Square Emerald (Asscher) | 方形祖母綠 |

## Rapaport PDF 更新
**強制使用**: `scripts/update_rapaport_universal.js <pdf_path>`
- 自動檢測類型
- 坐標提取 + 驗證
- 粗體值檢測
- 變動報告

## 提取驗證

---

## 重要聯絡
- Josh: +852XXXXXX, +852XXXXXX
- Desanna: +852XXXXXX

### 2026-02-06 - Qwen3 Session 1
**Module:** Excel - Advanced Formulas
**Topic:** XLOOKUP
**Source:** Qwen3 Training System

**Key Learnings:**
- XLOOKUP syntax: =XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])
- Replaces VLOOKUP/HLOOKUP with more flexibility
- Can search left-to-right or right-to-left
- Default exact match (unlike VLOOKUP's approximate default)

**Practice Completed:**
1. Basic product price lookup
2. Fuzzy matching for grades
3. Reverse search (last match)

**Advantages over VLOOKUP:**
- No column index counting needed
- Can search in any direction
- Default exact match
- Can search from end

**Next:** INDEX + MATCH combination

---

### 2026-02-07 - Qwen3 Session 2 (補)
**Module:** Excel - Advanced Formulas
**Topic:** INDEX + MATCH
**Source:** Qwen3 Training System

**Key Learnings:**
- INDEX syntax: =INDEX(array, row_num, [column_num])
  - Returns value or reference from table/region
  - Can extract single value, entire row or column
- MATCH syntax: =MATCH(lookup_value, lookup_array, [match_type])
  - match_type: 1 (less than), 0 (exact match), -1 (greater than)
  - Returns relative position of lookup value
- INDEX + MATCH Combination:
  - Syntax: =INDEX(return_array, MATCH(lookup_value, lookup_array, 0))
  - Can lookup to the left (VLOOKUP cannot)
  - Insert/delete columns won't break formula
  - Faster lookup speed for large datasets
  - More flexible dynamic ranges
- Advanced Techniques:
  - Two-way lookup: INDEX(range, MATCH(row), MATCH(column))
  - Multi-criteria: MATCH(1, (criteria1)*(criteria2), 0)
  - Approximate match with MATCH 1 or -1

**Practice Completed:**
1. Basic INDEX + MATCH lookup exercises
2. Left lookup practice (VLOOKUP replacement)
3. Two-way lookup (row + column intersection)
4. Multi-criteria lookup
5. Dynamic range practice
6. Error handling with IFERROR

**Advantages over VLOOKUP:**
- Bidirectional lookup (left or right)
- Column insert/delete safe
- Better performance on large data
- More flexible and powerful

**Next:** Dynamic Arrays (FILTER, SORT, UNIQUE, SEQUENCE)

**Progress:** 2/8 modules (25%)

---

## 待實施改進項目 (2026-02-10 確認)

### Apple Notes 備份強化 ✅
**來源**: Reminder 討論 - 檢查 Apple Notes 備份完整性
**決定**: 實施 1、2
1. **自動驗證備份完整性** - 每次備份後檢查 Apple Notes 真係有內容
2. **備份狀態追蹤** - 記錄邊日有備份、邊日冇

### MEMORY.md 內容管理改進 ✅
**來源**: Reminder 討論 - 檢討 MEMORY.md 內容
**決定**: 實施 1、2、3
1. **建立「關鍵記憶標記」機制** - 防止重要資訊被誤刪
2. **重要更新加日期標籤** - 方便追蹤變更歷史
3. **每月人工審閱一次** - 確保內容質素

### Qwen3 本地模型善用 ✅
**來源**: Reminder 討論 - 善用 Qwen3 本地模型
**決定**: 實施 1、2、3
1. **本地優先模式** - 簡單 Excel 問題先問 Qwen3，複雜嘅先升級 Kimi
2. **雙模型協作** - 見下方「If」邏輯
3. **專門訓練** - 用鑽石數據微調 Qwen3 做專家系統

---

**Key Learnings:**
- XLOOKUP syntax: =XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])
- Replaces VLOOKUP/HLOOKUP with more flexibility
- Can search left-to-right or right-to-left
- Default exact match (unlike VLOOKUP's approximate default)

**Practice Completed:**
1. Basic product price lookup
2. Fuzzy matching for grades
3. Reverse search (last match)

**Advantages over VLOOKUP:**
- No column index counting needed
- Can search in any direction
- Default exact match
- Can search from end

**Next:** INDEX + MATCH combination

---

*Last Updated: 2026-02-06*
*Synced to Ally: No*

**Key Learnings:**
- XLOOKUP syntax: =XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])
- Replaces VLOOKUP/HLOOKUP with more flexibility
- Can search left-to-right or right-to-left
- Default exact match (unlike VLOOKUP's approximate default)

**Practice Completed:**
1. Basic product price lookup
2. Fuzzy matching for grades
3. Reverse search (last match)

**Advantages over VLOOKUP:**
- No column index counting needed
- Can search in any direction
- Default exact match
- Can search from end

**Next:** INDEX + MATCH combination

---

## 詳細內容
- Excel 技巧 → `memory/_skills/excel.md`
- 鑽石市場 → `memory/_skills/diamond.md`
- Rapaport 提取 → `memory/_skills/rapaport.md`
- 歷史記憶 → `memory/_archive/`

## Token Management & Auto-Archive (2026-02-01) ⭐⭐ FULL IMPLEMENTATION

### 三層警告系統 (Short-term ✅) - Updated 2026-02-22
| Token | 動作 | Discord 通知 |
|-------|------|---------------|
| 🟢 < 70% | 正常運作 | - |
| 🟡 70% | **Discord #⚙️系統 警告** | 「建議準備開新 session」 |
| 🔴 80% | **自動存檔 + Discord** | 「已存檔,請 /reset」 |

### 自動存檔機制 (Mid-term ✅)
- **70%**: 第一次警告,提示準備開新 session
- **80%**: 
  - 自動將**完整對話內容**存去 Apple Notes (Ally's Chat History folder)
  - **自動 Send Discord** 至 #⚙️系統 提醒 reset
- **存檔後**: 標記已存檔,提示用戶 `/reset`

### 存檔內容
- Note 標題: `AI Session Archive - YYYY-MM-DD HH:MM`
- **包含完整對話**: [Josh] 同 [Ally] 嘅全部對話記錄
- 格式:HTML `<br>` 換行,清晰分隔線
- 包含: Token 用量、時間、對話內容(最多5000字,超長會截斷)
- 位置: Apple Notes → Ally's Chat History

### Streaming Archive (Long-term ✅)
- **自動增量存檔**: 每 20 條訊息或每小時自動 append 去 Apple Notes
- **持續備份**: 對話進行中已自動分段存檔,減少遺失風險
- **Script**: `scripts/streaming_archive.js`

### Discord 通知內容
| 階段 | 訊息 |
|------|------|
| 70% | ⚠️ Token Alert (70%) - 建議準備開新 session |
| 80% | 🔴 Token Alert (80%+) - 已存檔,請 /reset |

### Scripts
- `scripts/token_archive.js` - 完整對話存檔、Apple Notes、Discord
- `scripts/check_token.js` - 警告、觸發存檔、streaming 呼叫
- `scripts/streaming_archive.js` - 持續增量備份

### 狀態基準
| 顏色 | Token 用量 | 動作 |
|------|-----------|------|
| 🟢 | < 70% | 正常運作 |
| 🟡 | 70% | Discord 警告 |
| 🔴 | 80%+ | 自動存檔 + Discord 通知 |

### 安全建議
**而家建議**: 如果 token 接近 70%,請考慮 `/reset` 開新 session,確保最佳效能.

---
*Optimized version - 詳見 _archive/MEMORY_FULL_2026-02-01.md*

## GitHub Rapaport Calculator 更新流程 (2026-02-04)

**Repository**: https://github.com/allyassistant/rapaport-calculator
**Live URL**: https://allyassistant.github.io/rapaport-calculator/

### 更新時（當有新 Rapaport PDF）
1. Josh 提供新 Rapaport PDF
2. Ally extract 數據並更新 `index.html` 入面嘅 `RAPAPORT_DB`
3. **同時更新本地 database** (`memory/rapaport_db.json`)
4. 使用 Fine-grained GitHub Token 上載新版
5. 用戶需要 **Refresh** 瀏覽器先會見到新數據

### GitHub Token 設置（2026-02-04 更新）
- **類型**: Fine-grained Personal Access Token
- **有效期**: 永久
- **權限**: 只限 `rapaport-calculator` repo，Contents (read/write)
- **專用**: 此 Token 只適用於 Rapaport Calculator，其他專案使用獨立的 Repository 同 Token
- **安全度**: ✅ 高（限制範圍）

### 注意
- 數據係 hardcoded 喺 HTML 入面
- 唔係自動更新，每次要重新上載
- Rapaport 通常每週五更新

## Rapaport Calculator 最終版本規格 (2026-02-04) ⭐ FINAL

**Repository**: https://github.com/allyassistant/rapaport-calculator
**Live URL**: https://allyassistant.github.io/rapaport-calculator/

### UI 設置
| 元素 | 設置 |
|------|------|
| **Icon** | 白色 R 字，Rapaport 紅底 #C8102E |
| **字體** | -apple-system, Helvetica Neue, font-weight: 900 |
| **主題色** | Rapaport 紅 #C8102E |
| **背景** | 純白 |

### 欄位設置
| 欄位 | 設置 |
|------|------|
| **Shape** | ROUND (RBC) / PEAR (All Others)，冇注釋 |
| **Carat** | 數字輸入 |
| **Color** | D-M 選單 |
| **Clarity** | FL, IF, VVS1, VVS2, VS1, VS2, SI1, SI2 |
| **Discount** | type="number"，預設值 -30 |

### 已刪除元素
- ❌ 副標題 "PWA - Auto Updates + Offline Ready"
- ❌ "Add to Home Screen" 提示區
- ❌ Shape 注釋文字
- ❌ 💎 emoji（改用 R 字）

### 保留功能

---

## 📋 Show Stock Check App（珠寶展盤點工具）- 進行中

**目的**: 珠寶展現場離線盤點鑽石庫存

**原型網址**: https://allyassistant.github.io/rapaport-calculator/show-stock-check.html

### 核心功能
1. **匯入 Excel 清單** - 每日朝早匯入 Show Stock List
2. **Shape 主頁** - ROUND/EMERALD/PRINCESS/ALL SHAPES
3. **盤點模式** - 單撳標記已點，實時同步
4. **自動對比** - Submit 後比對原始 vs 實際
5. **WhatsApp 通知** - 發送缺失/多咗報告
6. **Excel 報告輸出** - 生成盤點結果

### 設計風格（藍色主題）
| 狀態 | 設置 |
|------|------|
| **未選** | 白底 + 黑字 + 灰框 |
| **已選** | 白底 + 藍字 (#2563EB) + 藍框 |
| **主按鈕** | 藍色實心 |
| **統計欄** | 藍底白字 |

### 用戶流程
```
匯入 Excel → Shape 分類 → 逐粒點選 → Submit 
→ 自動對比 → WhatsApp 通知 → Excel 報告
```

### 技術架構
- **前端**: PWA (HTML/CSS/JS)
- **離線儲存**: IndexedDB
- **實時同步**: WebSocket / Service Worker
- **數據匯入**: SheetJS (Excel → JSON)
- **通知**: WhatsApp Gateway

### 待決定事項
- [ ] Excel 匯入方式（自動化 vs 手動）
- [ ] 多同事實時同步方案
- [ ] 提交後更正流程

## 術語備註 (Terminology Notes)

### Carat 縮寫
- **"cts" = carats = 卡** (例如: 10cts = 10卡 = 10.00ct)
- 唔係 "份",唔係 "分",唔係 0.10ct
- Josh 用 "cts" 時指整數卡數

## Stock List 整合標準流程 (2026-02-03) ⭐ NEW STANDARD

**以後所有 Stock List 整合都必須跟隨以下流程:**

### 0. 觸發條件 ⭐⭐⭐ NEW
**必須在 WhatsApp 提到「跟template整理」先會執行腳本**
- ❌ 用戶淨係 send 檔案 → 只儲存，唔自動執行腳本

### 0a. 完成通知
- **更新 database**: 自動執行，唔使問
- **完成通知**: WhatsApp 通知 +852XXXXXX (Desanna)

### 1. 數據來源
- 來源 Excel 必須包含 **"Memo Out T.List"** column

### 2. Column Mapping(關鍵修正)
| Template Column | Source Column | 備註 |
|-----------------|---------------|------|
| **Shape** | **Rapnet** | Rapnet 列實際是 Shape |
| **Crt** | **Shape** | Shape 列實際是 Carat 重量 |
| Memo In Price | Memo Out T.List | 價格映射 |
| 其他欄位 | 同名對應 | Color, Clarity, Cut, Polish, Symm, Measurement, Depth, Table, Fluor, Lab, Cert No |

### 3. 過濾規則
- ❌ 刪除:無 Cert No 或 Carat < 1.00 或 Carat = 0.00

### 4. 排序規則
**第一層:顏色分類**
- Regular Color (D-Z) 在前
- Fancy Color (FY, FVY, FIY, FBY, FP 等) 在後

**第二層:Regular Color 內排序**
1. Shape: **RBC 優先**,其他按字母
2. Carat: **大→小** (descending)
3. Color: **D→Z** (ascending)

**第三層:Fancy Color 內排序**
1. Shape: RBC 優先,其他按字母
2. Carat: **大→小**

### 5. 間隔與分隔
- 不同 **Shape** 之間:插入 **1 行空白**
- Regular 同 Fancy 之間:插入 **3 行**(空白 + `=== FANCY COLOR ===` + 空白)

### 6. 格式要求
| 項目 | 規格 |
|------|------|
| 對齊 | **全部置中** (center) |
| 標題 | **加粗** (bold) |
| 總計行 | **加粗** |
| Crt | 2 位小數 |
| Memo In Price | 2 位小數 |
| 欄寬 | Parcel Name (22), Shape (10), Crt (12), Color (10), Clarity (12), Cut/Pol/Symm (10), Measurement (22), Depth/Table (10), Fluor (14), Lab (8), Cert No (18), Memo In Price (18) |

### 7. 總計行
最底部必須包含:
- **Carat 總計** (所有項目加總)
- **Memo Price 總計** (所有項目加總)
- **項目數量** (xxx items)

### 8. 輸出檔案
**位置**:`/Users/ally/Desktop/Stock list/Stock list (YYYY-MM-DD).xlsx`

### 9. 腳本位置
**整合腳本**: `scripts/integrate_stock.js`
```bash
node scripts/integrate_stock.js "/path/to/source.xlsx"
```

---

## Stock List Template 標準格式 (2026-02-03)

**檔案位置:** Desktop/Stock list Template/

**排列次序:**
| # | 欄位 | 備註 |
|---|------|------|
| 1 | Parcel Name | 左對齊 |
| 2 | Shape | 置中 |
| 3 | Crt | 置中 |
| 4 | Color | 置中 |
| 5 | Clarity | 置中 |
| 6 | Cut | 置中 |
| 7 | Polish | 置中 |
| 8 | Symm | 置中 |
| 9 | Measurement | 置中 |
| 10 | Depth | 置中 |
| 11 | Table | 置中 |
| 12 | Fluor | 置中 |
| 13 | Lab | 置中 |
| 14 | Cert No | 置中 |
| 15 | Memo In Price | 置中 |

**格式要求:**
- 所有資料欄 **置中** (center alignment)
- 字型大小: 12pt
- 以後整合/合併 stock list 都要跟呢個格式

## User Preferences (2026-02-01)

### 圖片生成偏好
當 Josh 講「生成圖片」或「畫幅畫」嗰陣:
- 自動上網搵免費 AI 圖片生成工具(如 Bing Image Creator、Leonardo.ai、Playground AI 等)
- 幫佢生成圖片
- 透過 WhatsApp send 返俾佢

---

## Show Stock Check App V4（2026-02-05 保存版本）⭐

**GitHub**: https://allyassistant.github.io/rapaport-calculator/show-stock-check-prototype.html
**本地備份**: `public/show-stock-check-v4-backup.html`

### 版本規格
**4 個 Tab 結構：**

| Tab | 圖示 | 名稱 | 操作 |
|-----|------|------|------|
| 1 | ✅ | 點貨 | Shape 選擇 → 單點 🟢 綠框綠字選取，再點取消 |
| 2 | 📋 | Memo Out | Shape 選擇 → 單點 🟡 黃框黃字選取，再點取消 |
| 3 | 💰 | Sold | Shape 選擇 → 單點 🔵 藍框藍字選取，再點取消 |
| 4 | 📊 | 總覽 | 統計數字 + ❌ 缺失欄紅字 + Excel 按鈕 |

### 功能特點
- 每個盤點頁都有 Shape 選擇（ALL / RBC / EM / PR）
- **選取模式**：點選標記 → Submit 確認 → 資料寫入總覽
- 已確認貨品不再顯示喺盤點頁
- 總覽頁實時更新，無需跳轉
- Excel 報告下載（CSV 格式）

---

## Mission Control Dashboard 項目 (2026-02-10) ⭐

**位置**: `/Users/ally/.openclaw/workspace/mission-control-html/index.html`

| Tab | 內容 |
|-----|------|
| **Dashboard** | Bot 狀態卡片 (Ally/Qwen3/Kimi)、統計數據 |
| **Kanban** | 四欄看板 (Todo/In Progress/Review/Done)、任務卡片 |
| **Activity** | 活動記錄列表、篩選標籤 |
| **Calendar** | 日程事件、按日期分組 |
| **Search** | 全局搜索界面 |

### 設計特點
- 純 HTML/CSS/JS (無需服務器)
- iPhone/iPad 優化 (PWA 支持)
- 暗色主題、底部導航 (單手操作)
- 全部 tabs 純文字 (冇 icon)

### 待決定事項 (重要！)
1. **後端方案** - 是否需要 API (跨設備同步)
2. **iPhone 改 Calendar 後通知 Mac mini** - 三個方案待選：
   - WebSocket (即時，複雜)
   - 輪詢 (30秒延遲，中等)
   - WhatsApp 指令 (簡單，手動)

### 用戶需求
- 跨設備同步 (iPhone/iPad/Mac)
- 可從 Dashboard 直接修改任務時間
- 變更後通知 OpenClaw 更新 cron job

---

## 2026-02-15 系統大整理

### 今日完成事項
1. **Model Config 整理**
   - 移除舊版 kimi-for-coding
   - 設定 fallback chain: Kimi K2.5 → MiniMax M2.5 → Qwen3
   - Token monitor 語法錯誤修復

2. **Scripts 語法錯誤修復**
   - `contract_checker.js` - 模板字符串引號錯誤
   - `gia_certificate_ocr.js` - 正則表達式斷開
   - `qwen3_advanced_training.js` - 轉義字符錯誤
   - `check_token.js` - 加 process.exit
   - `daily_summary.js` - 加 process.exit
   - `watch_stock.js` - 加 process.exit

3. **AutoOps Cron Jobs 修正**
   - `health_monitor.js` - 改為靜默模式（正常時冇輸出）
   - `token_monitor.js` - 改為靜默模式
   - `daily_stock_monitor.js` - 改為靜默模式
   - 將 delivery.mode 從 "announce" 改為 "none"

4. **Skills 系統檢查**
   - 發現 `diamond_valuation.js` 係 stub（冇實際功能）
   - 發現 `stock_management.js` 係 stub
   - `excel_ai_formula.js` 同 `productivity_automation.js` 功能完整

### 已知問題
- `[openclaw] ⚠️ 🛠️ Exec:` 訊息係 OpenClaw 系統層面嘅 exec 錯誤 reporting
- 呢啲訊息從 2月12號開始出現（可能同嗰陣開嘅 cron jobs 有關）
- 已將 cron jobs 改為 `delivery.mode: "none"`，但係系統層面嘅錯誤 reporting 仲係會 send 去 WhatsApp

### Reset 記錄
- **Reset 日期**: 2026-02-15
- **原因**: 清除 2月12號遺留嘅 exec 錯誤問題
- **Token 狀態**: 10% (reset 前)
- **Sessions 數量**: 500+ (reset 前)

*Last Updated: 2026-02-15 22:20*
*重要備份: Mission Control 項目已記錄，用戶準備 reset 對話*

---

## Model Expertise Profile (2026-02-16)
> 基於 10 題 Benchmark 測試結果，作為 Kimi (Main Agent) 分配工作嘅客觀參考

### Kimi K2.5
| 專長領域 | 複雜度 | 表現評估 |
|---------|--------|---------|
| 程式編寫 | 高 | ⭐⭐⭐⭐⭐ 非常詳細，用 dataclass、type hint，功能完整 |
| 數學邏輯 | 高 | ⭐⭐⭐⭐⭐ 計算準確，解釋深入，有驗證 |
| 商業分析 | 高 | ⭐⭐⭐⭐⭐ 分析深入，建議具體，有結構化輸出 |
| 創意寫作 | 中 | ⭐⭐⭐⭐ 感性、說故事，但 slogan 略遜 MiniMax |
| 專業知識 | 高 | ⭐⭐⭐⭐⭐ 用表格、結構化，解釋詳細 |
| 邏輯推理 | 高 | ⭐⭐⭐⭐⭐ 決策合理，分析詳盡，有比較表 |
| 數據分析 | 高 | ⭐⭐⭐⭐⭐ 多維度分析，建議具體 |
| 語言理解 | 高 | ⭐⭐⭐⭐⭐ 逐詞拆解，潛台詞分析深入 |
| 複雜問題分解 | 高 | ⭐⭐⭐⭐⭐ 詳細規劃，量化指標 |
| 倫理判斷 | 高 | ⭐⭐⭐⭐⭐ 多角度考量，有具體對話示例 |

**Main Agent 職責**: 動態分工分配、複雜分析決策、最終審核

---

### MiniMax M2.5
| 專長領域 | 複雜度 | 表現評估 |
|---------|--------|---------|
| 程式編寫 | 中 | ⭐⭐⭐⭐ 簡潔實用，但功能覆蓋較淺 |
| 數學邏輯 | 中 | ⭐⭐⭐⭐⭐ 計算準確，簡潔清晰 |
| 商業分析 | 中 | ⭐⭐⭐⭐ 有優缺點分析，但較簡短 |
| 創意寫作 | 高 | ⭐⭐⭐⭐⭐ 幽默、街坊風，slogan 有記憶點 |
| 專業知識 | 中 | ⭐⭐⭐⭐ 簡潔易記，比喻生動 |
| 邏輯推理 | 中 | ⭐⭐⭐⭐ 混合策略，但決策較籠統 |
| 數據分析 | 中 | ⭐⭐⭐⭐ 趨勢分析啱，建議實用 |
| 語言理解 | 中 | ⭐⭐⭐⭐ 逐句解讀，回應建議實用 |
| 複雜問題分解 | 中 | ⭐⭐⭐⭐ 結構清晰，預算較慳 |
| 倫理判斷 | 中 | ⭐⭐⭐⭐ 取向唔同，但合理解釋 |

**Sub Agent 職責**: 創意寫作、快速執行、接地氣表達

---

### Qwen3 (本地模型)
| 專長領域 | 複雜度 | 表現評估 |
|---------|--------|---------|
| Excel/數據處理 | 中 | ⭐⭐⭐⭐⭐ 公式、報表、自動化操作 |
| 本地數據分析 | 中 | ⭐⭐⭐⭐ 離線處理敏感數據 |
| 簡單程式腳本 | 低-中 | ⭐⭐⭐⭐ Python 基礎腳本 |
| 日常對話 | 低 | ⭐⭐⭐ 基本問答，成本低 |
| 成本敏感任務 | 低 | ⭐⭐⭐⭐⭐ 本地運行，零 API 費用 |

**Sub Agent 職責**: Excel 專家、本地數據處理、低成本任務

**使用條件**: 
- 優先用於 Excel/試算表相關任務
- 敏感數據（唔想上雲）
- 簡單重複性任務（慳成本）

---

### 分工原則 (Bias 防止機制)
1. **技術/分析為主** → Kimi 主導，MiniMax/Qwen3 協助
2. **創意/溝通為主** → MiniMax 主導，Kimi 檢查
3. **Excel/數據處理** → Qwen3 主導（本地、低成本）
4. **複雜混合項目** → Kimi 分析框架 → MiniMax/Qwen3 執行 → Kimi 檢查
5. **簡單任務** → 邊個得閒邊個做（優先 Qwen3 慳成本）

**透明度要求**: 每個回覆開頭註明 `[🤖 Model Name]`

**Fallback 條件**: Token > 70% / 回應 > 30s / 錯誤 / 無回應

---

## Fact Check 機制 (NEW - 2026-02-16)

### 目的
確保 Qwen3（本地模型）輸出嘅資訊準確性，特別係時間敏感同外部數據相關內容。

### 可信度標籤

| 標籤 | 意思 | 使用場景 |
|------|------|---------|
| 🟢 **已驗證** | 確認正確 | 純數學運算、本地數據處理 |
| 🟡 **待查證** | 建議用戶再確認 | 時間敏感數據、外部統計 |
| 🔴 **存疑** | 可能有誤 | 與已知資料不符、邏輯矛盾 |

### Qwen3 輸出必須經 Kimi 審核的情況

### Qwen3 可直接輸出的情況

---

## 協作框架 (Collaboration Framework) (2026-02-16)

*(需手動開啟)*

*狀態：**已啟用** | 用戶確認成本可接受*

### 運作方式
每次用戶輸入 → 根據「If」邏輯分配 sub-agent：
- **技術/分析/決策** → Kimi 直接處理
- **創意/溝通/風格** → MiniMax 協助
- **Excel/數據/本地** → Qwen3 協助
- **複雜/有爭議** → Roundtable 協作

### 模型分配邏輯

| 主模型 (Main Agent) | Sub-agent(s) | 備註 |
|---------------------|--------------|------|
| **Kimi K2.5** | MiniMax M2.5 | 預設組合 |
| **MiniMax M2.5** | Kimi K2.5 | 反轉組合 |
| **Qwen3** | Kimi K2.5 + MiniMax M2.5 | 雙副組合 |

```
IF 主模型 == "Kimi K2.5"
   THEN sub-agent = "MiniMax M2.5"
   
IF 主模型 == "MiniMax M2.5"  
   THEN sub-agent = "Kimi K2.5"
   
IF 主模型 == "Qwen3"
   THEN sub-agents = ["Kimi K2.5", "MiniMax M2.5"]
```

- **Kimi 做主**：擅長複雜分析，讓 MiniMax 做創意補充
- **MiniMax 做主**：擅長創意溝通，讓 Kimi 做技術把關
- **Qwen3 做主**：本地執行，Kimi + MiniMax 做智囊

如果用戶明確指定模型（如 `/model kimi`），則跟隨用戶意願。

### 實現方式
當需要 spawn sub-agent 時：
1. 檢查當前主模型係邊個
2. 根據上面邏輯分配 sub-agent
3. 使用正確既 `model` 參數

### 格式要求
每個回覆開頭註明：
```
[🤖 Kimi K2.5]
分析：[問題類型] → [分配決定]
---
正式回覆
```

### 成本
- 每次分析額外消耗 ~50-150 tokens（內部推理）
- 實際協作時額外 ~200 tokens
- 換取更準確分工同避免錯誤

### Reset 後指引
- 此模式為 **默認啟用**（無需用戶手動開啟）
- 如要停用，用戶需明確指示「關閉協作框架」
- **每次開新 session 自動讀取 MEMORY.md** 相關部分

---

## MiniMax Sub-agent Spawn 指南 (CRITICAL - Reset 後必讀)
*Added: 2026-02-16*

### 例子
```javascript
sessions_spawn({
  model: "minimax-portal/MiniMax-M2.5",  // ✅ 正確
  label: "MiniMax-Task-Name",
  task: "..."
})
```

### 記住
- `spawn` = 一定係開 **sub-agent**（協助分析）
- 冇「spawn main agent」呢回事
- main agent 係而家呢個 Kimi session

---

## Qwen3 自動化腳本分擔 (2026-02-16)
*狀態：**已正式啟用***

### 分配俾 Qwen3 執行嘅腳本
以下腳本由 Qwen3（本地模型）負責執行，慳成本：

| 腳本 | 功能 | 執行頻率 |
|------|------|---------|
| `watch_stock.js` | 監控 Stock List 變化 | Heartbeat |
| `verify_backup.js` | 驗證備份完整性 | Heartbeat |
| `daily_summary.js` | 生成每日總結 | Heartbeat |
| `memory_maintenance.js` | MEMORY.md 清理 | Heartbeat |
| `merge_stock.js` | 合併 Stock Excel | 按需 |
| `excel_report_generator.js` | Excel 報表生成 | 按需 |
| `archive_smart.js` | 智能歸檔 | Heartbeat |
| `backup_status_tracker.js` | 備份狀態追蹤 | Heartbeat |
| `date_tag_automation.js` | 日期標籤自動化 | Heartbeat |
| `key_memory_marker.js` | 關鍵記憶標記 | Heartbeat |

### 成本效益
- **慳成本**：每次 heartbeat 慳 ~500-1000 tokens
- **本地執行**：敏感數據唔上雲
- **Qwen3 專長**：Excel、數據處理、本地檔案操作

---

*Created: 2026-02-16 | 經 Kimi、MiniMax、Qwen3 確認*
<!-- Auto-added: 23/2/2026 上午10:23:40 -->
### 2026-02-23 - 自動記錄
記住我鍾意用繁體中文同深色模式


<!-- Auto-added: 23/2/2026 上午10:31:51 -->
### 2026-02-23 - 自動記錄
記住檢查時間要用HKT


<!-- Auto-added: 23/2/2026 上午10:53:00 -->
### 2026-02-23 - 自動記錄
記住測試自動分類功能

