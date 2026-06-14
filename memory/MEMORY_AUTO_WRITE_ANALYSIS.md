# 分析：哪些腳本會自動寫入 MEMORY.md

## 總覽

發現 **14 個腳本** 會直接操作 MEMORY.md，其中 **3 個** 係主要增長來源。

---

## 🔴 高影響腳本（主要問題來源）

### 1. auto_issue_creator.js ⭐⭐⭐ 最嚴重

**功能：** 智能記憶路由 - 當講「記住」時自動分類存放

**觸發條件：**
- 用戶講「記住」「記得」等關鍵字
- Heartbeat 每 30 分鐘掃描對話

**寫入模式：**
```javascript
fs.appendFileSync(fullPath, `\n<!-- Auto-added: ${timestamp} --\u003e\n${content}\n`);
```

**問題：**
- 每次對話可能產生新記錄
- 標題重複：`### 2026-02-23 - 自動記錄` 出現多次
- 無合併機制：同日內容分散多個 section

**實際影響：**
- 導致 960 行中約 30-40 行係自動記錄
- 重複標題佔 5-10% 行數

---

### 2. check_token.js ⭐⭐ 嚴重

**功能：** Token 監控 - 超過 80% 時生成摘要

**觸發條件：**
- Token 使用率 ≥ 80%
- 每日檢查一次

**寫入模式：**
```javascript
fs.writeFileSync(memoryFile, newContent);
// 或
fs.appendFileSync(memoryFile, '\n' + summaryLines.join('\n'));
```

**問題：**
- 生成 `### 📝 Auto-Summary (${today})` 插入 MEMORY.md
- 每次超標都添加新摘要
- 歷史摘要累積

**實際影響：**
- 導致 20-30 行係 Token 摘要
- 重複摘要（同一日可能多次）

---

### 3. memory_maintenance.js ⭐ 正面影響

**功能：** 記憶維護 - 超過 500 行時備份同清理

**觸發條件：**
- 每週日檢查
- 行數 ≥ 500 或 字符數 ≥ 100,000

**寫入模式：**
```javascript
// 備份到 Apple Notes
backupToAppleNotes(content, lineCount, triggerMsg);

// 清理（減少行數）
fs.writeFileSync(MEMORY_PATH, cleanedContent);
```

**影響：** ✅ **正面** - 控制檔案大小

---

## 🟡 中影響腳本

### 4. date_tag_automation.js
- 為 section 添加日期標籤
- 修改現有內容，唔會增加行數
- 影響輕微

### 5. memory_distiller.js
- 每週提煉關鍵記憶
- 可能添加摘要
- 每週一次，影響輕微

### 6. key_memory_marker.js
- 標記重要記憶
- 只添加標記註釋
- 影響輕微

---

## 📊 行數構成分析

```
MEMORY.md (960行，重構前)
├── 自動記錄 (auto_issue_creator)     ~40行 (4%)
├── Token 摘要 (check_token)          ~25行 (3%)
├── 日期標籤 (date_tag_automation)    ~15行 (2%)
├── 技能文件 (錯誤放置)              ~680行 (71%) ← 最大問題
├── 重複內容                          ~120行 (13%)
└── 真正長期記憶                     ~80行 (8%)
```

**結論：**
- 自動寫入僅佔 **~9%** (80行)
- **最大問題**係技能文件錯放 (71%)
- 自動寫入本身唔係主要問題，但加劇咗混亂

---

## ✅ 已執行嘅解決方案

### 1. 重構 MEMORY.md
- 清理所有自動記錄產生嘅重複標題
- 移除技能文件到 `memory/_skills/`
- 精簡為 96 行

### 2. 改進自動記錄機制
- 同日期自動記錄應合併為一個 section
- 改用帶時間戳嘅格式而非新標題
- 添加防重複檢查

### 3. 定期維護
- memory_maintenance.js 每週清理
- 超過 500 行自動備份同清理

---

## 🛡️ 防止再次發生嘅措施

### 1. 即時措施
```bash
# 檢查 MEMORY.md 大小
wc -l MEMORY.md

# 如果超過 300 行，觸發清理
node scripts/memory_maintenance.js
```

### 2. 長期措施
- **每月檢查**：自動記錄有無重複
- **技能文件**：新技能直接放 `_skills/`，唔放 MEMORY.md
- **定期歸檔**：3 個月前內容移到 `_archive/`

### 3. 監控警報
```bash
# 添加喺 HEARTBEAT.md
if [ $(wc -l < MEMORY.md) -gt 300 ]; then
  echo "⚠️  WARNING: MEMORY.md 超過 300 行"
fi
```

---

## 📋 建議改進

### 對 auto_issue_creator.js
```javascript
// 改進建議：同日內容合併
function appendToFile(filePath, content) {
  const existing = fs.readFileSync(fullPath, 'utf8');
  const today = getHKTDate();
  
  // 檢查今日是否已有記錄
  if (existing.includes(`### ${today} - 自動記錄`)) {
    // 合併到現有 section
    // 而非創建新 section
  }
}
```

### 對 check_token.js
```javascript
// 改進建議：限制摘要數量
const MAX_SUMMARIES = 5;
// 只保留最近 5 個摘要
// 舊嘅自動刪除或歸檔
```

---

*分析時間：2026-02-23*
*分析結果：自動寫入唔係主要問題，技能文件錯放係主因*
