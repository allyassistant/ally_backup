# Pure AI Audit False Positive 優化實施指南

## 概述

本指南說明如何實施優化以減少 Pure AI Audit 的 False Positives。

## 優化效果預估

| 問題類型 | 當前數量 | 預計減少 | 優化後 |
|---------|---------|---------|--------|
| readdirSync | 67 | ~80% | ~13 |
| readFileSync | 60 | ~70% | ~18 |
| mkdirSync | 36 | ~90% | ~4 |
| **總計** | **163** | **~78%** | **~35** |

## 實施步驟

### Step 1: 複製優化檔案 (2 分鐘)

```bash
# 複製白名單 patterns 到 lib/helpers
cp .analysis/whitelist_patterns.js lib/helpers/

# 複製 context helpers 到 lib/helpers
cp .analysis/context_helpers.js lib/helpers/
```

### Step 2: 更新 lib/helpers/index.js (2 分鐘)

```javascript
// 在 lib/helpers/index.js 中添加導出

module.exports = {
  // ... existing exports ...
  
  // 新增：上下文感知 helpers
  ...require('./context-helpers'),
  
  // 新增：白名單 patterns
  whitelist: require('./whitelist_patterns'),
};
```

### Step 3: 修改 lib/rules/high-risk.js (5 分鐘)

```javascript
// 1. 在文件頂部添加引入 (約 line 50)
let contextHelpers = null;
function getContextHelpers() {
  if (!contextHelpers) {
    try {
      contextHelpers = require('../helpers/context-helpers');
    } catch { contextHelpers = {}; }
  }
  return contextHelpers;
}

// 2. 在 missing-error-handling rule 中添加 (約 line 230)
const ch = getContextHelpers();

// 3. 更新 safeCallPatterns 列表 (約 line 226)
const safeCallPatterns = [
  /safeReadFile\s*\(/,
  /safeWriteFile\s*\(/,
  /safeJsonParse\s*\(/,
  /atomicWriteSync\s*\(/,
  // 新增：
  /loadConfig/,
  /parseConfig/,
  /loadState/,
  /saveState/,
  /ensureDir/,
  /init\w*Dir/,
];

// 4. 在檢測邏輯中添加上下文檢查 (約 line 280)
// 在 fs.readFileSync 檢測部分：
if (/fs\.(readFileSync|readdirSync|statSync|accessSync)\s*\(/.test(line)) {
  // 使用新的上下文分析
  if (ch.shouldRequireTryCatchForReadFile) {
    const result = ch.shouldRequireTryCatchForReadFile(lines, i);
    if (!result.required) {
      if (result.severity === 'info') {
        found.push({ line: i + 1, severity: 'info' });
      }
      return;
    }
  }
  // ... rest of existing logic
}

// 5. 添加 mkdirSync 特殊處理
if (/fs\.mkdirSync\s*\(/.test(line)) {
  if (ch.shouldRequireTryCatchForMkdir) {
    const result = ch.shouldRequireTryCatchForMkdir(lines, i);
    if (!result.required) {
      return; // 完全跳過
    }
  }
}
```

### Step 4: 應用補丁 (可選)

```bash
# 如果 high-risk.js 沒有顯著變化，可以直接應用補丁
cd /Users/ally/.openclaw/workspace/scripts
git apply .analysis/high-risk-optimization.patch
```

### Step 5: 測試 (5 分鐘)

```bash
# 運行 auto_fix.js 檢查結果
node scripts/auto_fix.js scan

# 檢查 false positive 數量是否減少
node scripts/auto_fix.js report
```

## 驗證檢查清單

- [ ] `lib/helpers/whitelist_patterns.js` 已複製
- [ ] `lib/helpers/context_helpers.js` 已複製
- [ ] `lib/helpers/index.js` 已更新
- [ ] `lib/rules/high-risk.js` 已更新
- [ ] 運行 `auto_fix.js scan` 無錯誤
- [ ] readdirSync 問題數量顯著減少
- [ ] readFileSync 問題數量顯著減少
- [ ] mkdirSync 問題數量顯著減少

## 故障排除

### 問題：檔案引入錯誤

```
Error: Cannot find module '../helpers/context-helpers'
```

**解決方案**: 確認檔案路徑正確，並檢查檔案是否存在。

### 問題：現有功能受影響

**解決方案**: 檢查是否過度過濾，調整 `DANGER_SIGNALS` 中的模式。

### 問題：仍然有很多 false positives

**解決方案**: 
1. 檢查 `SAFE_CONTEXTS` 定義是否完整
2. 添加更多專案特定的模式
3. 調整 `contextWindow` 大小

## 持續改進

### 收集 False Positive 反饋

1. 定期檢查審計結果
2. 標記仍然存在的 false positives
3. 更新 whitelist_patterns.js

### 添加新的安全模式

```javascript
// 在 whitelist_patterns.js 中添加
const SAFE_CONTEXTS = {
  // 添加新的安全上下文
  myNewContext: {
    indicators: { ... },
    operations: [ ... ],
    action: { type: 'skip', reason: '...' },
  },
};
```

## 相關文件

- `whitelist_patterns.js` - 白名單配置
- `context_helpers.js` - 上下文分析 helpers
- `high-risk-optimization.patch` - high-risk.js 補丁
- `audit_false_positive_analysis.md` - 詳細分析報告
