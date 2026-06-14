# Kimi Code CLI 任務：消除 Code Quality Scanner False Positives

## 任務目標
Implement 4 個改進建議，消除 Code Quality Scanner 既 false positives。

## 需要修改既檔案

### 1. `/Users/ally/.openclaw/workspace/scripts/lib/helpers/try-catch-helpers.js`
- 函數：`hasDefensiveCheck()`

#### 改進 1：Early Return Pattern
喺 `hasDefensiveCheck()` 增加：
```javascript
// Pattern 3: Early Return / Early Throw
if (/fs\.existsSync\(/.test(line)) {
  for (let j = lineIdx + 1; j < Math.min(lines.length, lineIdx + 5); j++) {
    const l = lines[j].trim();
    if (l.startsWith('//') || l.startsWith('*')) continue;
    if (/\breturn\s+(false|null|undefined)/.test(l) || /\bthrow\b/.test(l)) {
      return true;
    }
  }
}
```

#### 改進 2：Inline try-catch (same-line)
增加同一行 try-catch 檢測：
```javascript
// Pattern 4: Inline try-catch on same line
if (/^\s*try\s*\{/.test(line)) {
  const fullBlock = lines.slice(lineIdx, Math.min(lines.length, lineIdx + 3)).join(' ');
  if (/\btry\s*\{.*\b(fs\.|exec)/.test(fullBlock) || /\b(fs\.|exec).*\}\s*catch/.test(fullBlock)) {
    return true;
  }
}
```

### 2. `/Users/ally/.openclaw/workspace/scripts/lib/helpers/try-catch-helpers.js` (繼續)
- 函數：`isProtectedByTryFullScan()`

#### 改進 3：Block Comment 處理
喺 `isProtectedByTryFullScan()` 既 for loop 開頭增加：
```javascript
let inBlockComment = false;
for (let j = 0; j < lines.length; j++) {
  const raw = lines[j];
  const trimmed = raw.trim();
  // Handle block comments
  if (trimmed.includes('/*')) inBlockComment = true;
  if (trimmed.includes('*/')) { inBlockComment = false; continue; }
  if (inBlockComment) continue;
  // ... rest of the loop
}
```

### 3. `/Users/ally/.openclaw/workspace/scripts/lib/rules/high-risk.js`
- 規則：Rule 5 - `deprecated-patterns`

#### 改進 4：Regex literal skip
喺 deprecated-patterns 既 forEach 內增加 skip：
```javascript
// Before checking each pattern, add:
for (const dp of deprecatedPatterns) {
  // Skip regex literals - if the match is preceded by .match( or .test(, it's a regex, not the deprecated API
  const beforeMatch = line.substring(0, line.indexOf(dp.regex));
  if (/\/\.?|\.(match|test)\(/.test(beforeMatch)) continue;
  
  if (dp.regex.test(line)) {
    found.push({ line: i + 1, desc: dp.desc });
  }
}
```

## 執行步驟
1. 讀取 both files 既現有內容
2. Implement 所有 4 個改進
3. 儲存 modified files
4. 測試：`node scripts/code_quality_manager.js scan`

## 預期結果
High 問題數：8 → 1-2 (消除 75-87% FP)

## 輸出語言
繁體中文