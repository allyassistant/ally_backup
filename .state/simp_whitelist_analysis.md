# Simplified-Chinese 規則白名單分析報告

**文件：** `scripts/lib/rules/low-risk.js`
**分析日期：** 2026-04-07
**規則 ID：** `simplified-chinese`

---

## 📊 測試結果摘要

### ✅ detect() 白名單邏輯
```javascript
if (!line.trim()) return;                                    // 1. 空行
if (/^https?:\/\//i.test(line.trim())) return;               // 2. URL
if (/^\/[^\s]/.test(line.trim())) return;                    // 3. 純路徑
if (/^[\d\s\.,;:\-+=\*\/\\#@!$%^&()[\]{}|'"`<>]+$/.test(line.trim())) return;  // 4. 純數字/符號
```

### ⚠️ fix() 白名單邏輯（不完整）
```javascript
if (!line.trim()) return line;                               // 1. 空行
if (/^https?:\/\//i.test(line.trim())) return line;          // 2. URL
if (/^\/[^\s]/.test(line.trim())) return line;                // 3. 純路徑
// ❌ 缺少：純數字/符號的白名單檢查
```

---

## 🔴 發現的問題

### 問題 1：fix() 缺少純數字/符號的白名單檢查（嚴重）

**位置：** `fix()` 函數

**描述：** `detect()` 有 4 個白名單檢查，但 `fix()` 只有 3 個。

**影響：**
- 如果一行只有數字和符號，會被 `detect()` 跳過
- 但 `fix()` 沒有這個檢查（只是剛好那類行沒有簡體字所以沒觸發）
- 未來如果有任何簡體字摻入數字行，會被 `detect()` 發現但 `fix()` 修復不了

**修復建議：**
```javascript
fix(content) {
  const simplifiedMap = getSimplifiedMap();
  const lines = content.split('\n');
  const fixed = lines.map(line => {
    if (!line.trim()) return line;
    if (/^https?:\/\//i.test(line.trim())) return line;
    if (/^\/[^\s]/.test(line.trim())) return line;
    // ✅ 新增：純數字/符號行也跳過
    if (/^[\d\s\.,;:\-+=\*\/\\#@!$%^&()[\]{}|'"`<>]+$/.test(line.trim())) return line;
    // ... rest of fix logic
  });
  return fixed.join('\n');
}
```

---

### 問題 2：`~` 路徑不會被路徑白名單跳過（需評估）

**位置：** 路徑正則表達式 `/^\/[^\s]/`

**測試結果：**
| 測試案例 | 正則匹配 | 會被跳過？ |
|---------|---------|-----------|
| `/download/test` | ✅ | 是 |
| `/download/下载/file` | ✅ | 是 |
| `~/文檔/下载` | ❌ | 否 |
| `const path = "/下载/"` | ❌ | 否 |

**描述：**
- 路徑正則 `/^\/[^\s]/` 只匹配以 `/` 開頭的行
- `~` 開頭的路徑（如 `~/文檔/下载`）**不會**被跳過
- 路徑內的字串（如 `const path = "/下载/"`）**不會**被跳過

**評估：**
這可能是**正確行為**而非 bug：
- `~/文檔/下载` 中的 `檔` 是繁體，`下载` 是簡體
- 如果要轉換，確實應該轉換
- 路徑內的簡體字確實應該轉換為繁體

**建議：** 保持現有行為（不需要修改）

---

### 問題 3：Simplified Map 內容完全錯誤（🚨 嚴重 Bug）

**位置：** `getSimplifiedMap()` 函數

**問題：** Map 中的所有條目都是傳統字→傳統字，例如：
```javascript
['邊', '邊'], ['為', '為'], ['與', '與'], ['開', '開'],
['無', '無'], ['專', '專'], ['業', '業'], ['東', '東'],
// ... 全部都是相同字符
```

**正確應該是：**
```javascript
['边', '邊'], ['为', '為'], ['与', '與'], ['开', '開'],
['无', '無'], ['专', '專'], ['业', '業'], ['东', '東'],
```

**實際測試：**
```
測試字元: "下" NOT in map
測試字元: "载" NOT in map  
測試字元: "文" NOT in map
測試字元: "檔" found in map: [檔, 檔]  ← 這是繁體，不是簡體！
```

**影響：**
- 規則會把包含繁體字的行標記為"有簡體中文"
- 根本無法檢測真正的簡體字（如 `下载`、`文档`）
- 實際上這個規則目前是**完全無法運作的**

---

## 📋 修復建議優先級

| 優先級 | 問題 | 修復方式 |
|--------|------|----------|
| **P0** | Simplified Map 內容錯誤 | 重建 map，正確的簡體→繁體對照 |
| **P1** | fix() 缺少數字/符號白名單 | 添加第 4 個檢查，與 detect() 同步 |
| **P2** | `~` 路徑行為 | 評估後決定是否需要修改 |

---

## 測試命令重現

```bash
# 讀取規則
grep -A 50 "id: 'simplified-chinese'" ~/.openclaw/workspace/scripts/lib/rules/low-risk.js

# 運行測試
node /Users/ally/.openclaw/workspace/.state/test_direct.js
```

---

## 結論

1. **核心問題**：`getSimplifiedMap()` 返回的 map 全部是傳統字→傳統字，導致規則完全無法正確運作

2. **白名單不一致**：`fix()` 缺少 `detect()` 的第 4 個白名單檢查（純數字/符號行）

3. **`~` 路徑**：目前行為可能是正確的（允許轉換路徑中的簡體字）
