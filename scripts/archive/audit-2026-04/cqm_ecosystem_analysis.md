# Code Quality System (CQM) 生態系統分析報告

**生成時間**: 2026-04-05  
**分析範圍**: Code Quality Manager 及相關 scripts

---

## 1. 檔案引用關係圖

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Code Quality System 架構圖                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│ code_quality_manager.js │ ◄── CLI 主要入口
│   ├── scan command   │
│   ├── fix command    │
│   └── discover command│
└──────────┬──────────┘
           │
    ┌──────┴──────┬────────────────┬─────────────────┐
    ▼             ▼                ▼                 ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────────┐
│ lib/*    │ │ system_  │ │ auto_fix.js  │ │ verify_fix.js   │
│ modules  │ │ check_   │ │              │ │                 │
│          │ │ bot.js   │ │              │ │                 │
└────┬─────┘ └────┬─────┘ └──────┬───────┘ └────────┬────────┘
     │            │              │                  │
     ▼            ▼              ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      核心 Lib 模組                            │
├─────────────────────────────────────────────────────────────┤
│  fileDiscovery.js  ──► 檔案發現、快取管理                      │
│  issueAggregator.js ──► Issue 聚合、去重、格式化               │
│  auditOrchestrator.js ──► 審計調度器 (Local/AI/Error Scanner) │
│  config.js ──► 共用路徑常量                                    │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                      數據檔案 (.state/)                        │
├─────────────────────────────────────────────────────────────┤
│  pure_ai_audit_results.json  ◄── AI 審計結果                  │
│  pure_ai_audit_payload.json  ◄── AI 審計輸入                  │
│  auto_fix_report.json        ◄── 自動修復報告                 │
│  auto_fix_history.json       ◄── 修復歷史記錄                 │
│  verify_fix_log.json         ◄── 驗證日誌                     │
│  errors.json                 ◄── 錯誤記錄 (memory/)           │
│  code_quality_report.json    ◄── CQM 報告                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────┐     ┌─────────────────────────────┐
│  weekly_correction_ │────►│  AGENTS.md                  │
│  loop.js            │     │  (Prevention Rules)         │
└─────────────────────┘     └─────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  pure_ai_audit.js ──► 生成 AI payload、緩存管理               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 詳細引用關係

### 2.1 code_quality_manager.js

| 引用類型 | 引用對象 | 用途 | 風險等級 |
|---------|---------|------|---------|
| `require` | `./lib/fileDiscovery` | 檔案發現功能 | 低 |
| `require` | `./lib/issueAggregator` | Issue 聚合 | 低 |
| `require` | `./lib/auditOrchestrator` | 審計調度 | 低 |
| `execFileSync` | `./system_check_bot.js` | 掃描後系統檢查 | 中 |
| `execFileSync` | `./auto_fix.js` | fix 命令執行 | 中 |
| `execFileSync` | `./verify_fix.js` | 驗證修復結果 | 中 |
| 寫入 | `.state/code_quality_report.json` | 報告輸出 | 低 |
| 寫入 | `.state/pure_ai_audit_results.json` | compat 格式 | 低 |

**CLI 參數**:
- `scan --dir <path> --ext <exts> --output <dir> --format <fmt> --no-cache --quiet --no-system-check`
- `fix --dir <path> --ext <exts> --dry-run --quiet`
- `discover --dir <path> --json`
- `audit --files <paths> --output <dir>`
- `cache --clear --stats`
- `report --input <file> --format <fmt> --output <file>`

### 2.2 system_check_bot.js

| 引用類型 | 引用對象 | 用途 | 風險等級 |
|---------|---------|------|---------|
| 讀取 | `~/.openclaw/workspace/.state/pure_ai_audit_results.json` | 健康分數計算 | 高* |
| 讀取 | `~/.openclaw/workspace/.state/auto_fix_report.json` | 自動修復狀態 | 中 |
| 讀取 | `~/.openclaw/workspace/.state/verify_fix_log.json` | 驗證狀態 | 中 |
| 讀取 | `~/.openclaw/workspace/.state/auto_fix_history.json` | 修復歷史 | 中 |
| 讀取 | `~/.openclaw/workspace/memory/errors.json` | 活躍錯誤 | 中 |
| 執行 | `./issue_auto_followup.js` | 獲取跟進摘要 | 中 |
| Discord | `discord.com/api/v10` | 發送通知 | 低 |

*高風險：檔案路徑硬編碼為絕對路徑

### 2.3 auto_fix.js

| 引用類型 | 引用對象 | 用途 | 風險等級 |
|---------|---------|------|---------|
| `require` | `./lib/config` | 路徑常量 | 低 |
| `require` | `./lib/rules/low-risk` | 低風險修復規則 | 低 |
| `require` | `./lib/rules/high-risk` | 高風險檢測規則 | 低 |
| `require` | `./lib/rules/system-audit` | 系統審計 | 低 |
| `require` | `./lib/helpers` | 輔助函數 | 低 |
| `require` | `./auto_fix_history` | 修復歷史記錄 | 低 |
| 讀取 | `.state/pure_ai_audit_results.json` | 標註 Pure AI 結果 | 高* |
| 寫入 | `.state/auto_fix_report.json` | 報告輸出 | 低 |
| 寫入 | `.state/auto_fix_history.json` | 歷史記錄 | 低 |

*高風險：JSON 格式兼容性問題（見 4.2 節）

### 2.4 verify_fix.js

| 引用類型 | 引用對象 | 用途 | 風險等級 |
|---------|---------|------|---------|
| `require` | `./lib/config` | 路徑常量 | 低 |
| 讀取/寫入 | `.state/auto_fix_history.json` | 修復歷史 | 中 |
| 讀取 | `.state/errors.json` | 錯誤比對 | 中 |
| 寫入 | `.state/verify_fix_log.json` | 驗證日誌 | 低 |

### 2.5 pure_ai_audit.js

| 引用類型 | 引用對象 | 用途 | 風險等級 |
|---------|---------|------|---------|
| `require` | `./lib/config` | 路徑常量、atomicWrite | 低 |
| 寫入 | `.state/pure_ai_audit_payload.json` | AI 輸入 payload | 低 |
| 寫入 | `.state/pure_ai_audit_results.json` | AI 輸出結果 | 低 |
| 寫入 | `.state/pure_ai_audit_cache.json` | 檔案快取 | 低 |
| 讀取 | `.state/pure_ai_audit_results.json` | report 模式 | 低 |

### 2.6 weekly_correction_loop.js

| 引用類型 | 引用對象 | 用途 | 風險等級 |
|---------|---------|------|---------|
| `require` | `./lib/config` | 路徑常量 | 低 |
| `require` | `./lib/time` | HKT 時間工具 | 低 |
| 讀取 | `~/.openclaw/workspace/memory/errors.json` | 錯誤分析 | 中 |
| 讀取 | `.state/pure_ai_audit_results.json` | Audit findings | 高* |
| 讀取/寫入 | `AGENTS.md` | Prevention Rules | 中 |
| 讀取/寫入 | `memory/correction-loop-state.json` | 狀態保存 | 低 |

*高風險：JSON 欄位名稱不一致（`issues` vs `findings`）

---

## 3. 運行流程驗證

### 3.1 ✅ 正常流程

```
code_quality_manager.js scan
├──► lib/fileDiscovery.scanDirectories()
├──► lib/auditOrchestrator.run()
│    ├──► LocalScanner.run() ──► 檢查 execSync, magic numbers
│    ├──► AIScanner.run() ──► (目前僅輸出提示)
│    └──► ErrorScanner.run() ──► 讀取 errors.json
├──► issueAggregator.add() ──► 統一格式
├──► saveReport() ──► 寫入 .state/code_quality_report.json
└──► runSystemCheckBot() ──► 顯示系統狀態
```

### 3.2 ✅ Fix 流程

```
code_quality_manager.js fix
├──► execFileSync(auto_fix.js, ['fix'])
│    ├──► scanErrors() ──► 讀取 errors.json
│    ├──► findRecentFiles() ──► 找最近修改檔案
│    ├──► analyzeFile() ──► 本地規則掃描
│    ├──► autoFixFile() ──► 自動修復 low-risk
│    └──► generateReport() ──► 寫入 auto_fix_report.json
├──► runVerifyFix() ──► 驗證修復結果
└──► runSystemCheckBot() ──► 顯示剩餘問題
```

### 3.3 ✅ Weekly Correction Loop 流程

```
weekly_correction_loop.js
├──► 讀取 errors.json
├──► 讀取 pure_ai_audit_results.json
├──► analyzeErrorPatterns() ──► AI 輔助分類
├──► generateRuleFromPattern() ──► 生成規則
├──► applyAutoRules() ──► 寫入 AGENTS.md
└──► sendWeeklyReport() ──► Discord 通知
```

---

## 4. 潛在問題分析

### 4.1 🔴 檔案路徑問題

#### 問題 1: 混合使用相對與絕對路徑

**影響檔案**: `system_check_bot.js`, `weekly_correction_loop.js`

**問題描述**:
```javascript
// system_check_bot.js 第 671 行
const resultFile = path.join(process.env.HOME, '.openclaw', 'workspace', '.state', 'pure_ai_audit_results.json');

// 但其他檔案使用:
const { WS, STATE_DIR } = require('./lib/config');
const resultFile = path.join(STATE_DIR, 'pure_ai_audit_results.json');
```

**風險**:
- 如果 HOME 環境變數未設定，會導致路徑錯誤
- 維護困難：修改路徑需要在多個地方同步

**建議修復**:
```javascript
// 統一使用 lib/config.js
const { STATE_DIR } = require('./lib/config');
const resultFile = path.join(STATE_DIR, 'pure_ai_audit_results.json');
```

#### 問題 2: 路徑不一致導致檔案找不到

**影響檔案**: `verify_fix.js`

```javascript
// verify_fix.js 使用 lib/config
const { HOME, WS } = require('./lib/config');
const HISTORY_FILE = path.join(WS, '.state', 'auto_fix_history.json');
const ERRORS_FILE = path.join(WS, '.state', 'errors.json');

// 但 system_check_bot.js 使用硬編碼路徑
const resultFile = path.join(process.env.HOME, '.openclaw', 'workspace', '.state', ...);
```

### 4.2 🔴 JSON 格式兼容性問題

#### 問題 1: `pure_ai_audit_results.json` 欄位名稱不一致

**影響檔案**: `system_check_bot.js`, `weekly_correction_loop.js`, `auto_fix.js`

**問題描述**:

```javascript
// system_check_bot.js 第 683-691 行 - 處理多種格式
const summary = results.summary || results;  // 兼容新舊格式
const critical = summary.critical || results.critical || 0;
const issues = results.findings || results.issues || [];  // findings vs issues
```

**格式差異**:
| 欄位 | 舊格式 | 新格式 |
|-----|-------|-------|
| 問題列表 | `issues` | `findings` |
| 摘要 | 扁平結構 | `summary` 物件 |
| Severity | 數字 (1-4) | 字串 ('critical', 'high', 'medium', 'low') |

**風險**:
- 數據解析錯誤導致統計不準確
- 如果沒有兼容性處理，會導致 NaN 或 undefined

**建議**:
統一使用 `findings` 和 `summary` 格式，並在 `code_quality_manager.js` 中提供 compat 輸出。

### 4.3 🟡 命令行參數解析問題

#### 問題 1: 不一致的參數解析方式

**比較**:

```javascript
// code_quality_manager.js - 自定義解析
parseArgs(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    }
  }
}

// verify_fix.js - 簡單檢查
const isDryRun = args.includes('--dry-run');
const fixIdArg = args.find(a => a.startsWith('--fix-id='))?.replace('--fix-id=', '');

// auto_fix.js - 混合解析
const sinceArg = args.find(a => a.startsWith('--since'));
if (sinceArg) {
  if (sinceArg.includes('=')) {
    sinceDays = parseInt(sinceArg.split('=')[1]) || DEFAULT_SINCE_DAYS;
  } else {
    sinceDays = parseInt(args[args.indexOf(sinceArg) + 1]) || DEFAULT_SINCE_DAYS;
  }
}
```

**風險**:
- 用戶體驗不一致
- 某些參數格式在某些 script 中不被支援

**建議**:
統一使用 `lib/cli-parser.js` 或類似的共用模組。

### 4.4 🟡 Error Handling 問題

#### 問題 1: 部分檔案讀取沒有 try-catch

**影響檔案**: `system_check_bot.js` 部分函數

```javascript
// system_check_bot.js 第 365-388 行 - 有 try-catch
function getActiveErrors() {
  try {
    // ... 安全讀取
  } catch (e) { 
    console.warn('[getActiveErrors] Error:', e.message); 
  }
}

// 但某些地方沒有保護:
const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));  // 第 676 行
```

#### 問題 2: JSON.parse 沒有驗證

**影響檔案**: `pure_ai_audit.js`, `system_check_bot.js`

```javascript
// 不安全的寫法:
const results = JSON.parse(content);

// 安全的寫法:
let results;
try {
  results = JSON.parse(content);
} catch (e) {
  console.error('Invalid JSON:', e.message);
  return defaultValue;
}
if (!results || typeof results !== 'object') {
  return defaultValue;
}
```

### 4.5 🟢 低風險問題

#### 問題 1: 重複的時間格式化函數

**多個檔案都有**:
```javascript
// code_quality_manager.js
const timestamp = new Date().toISOString();

// verify_fix.js
function toHKT(isoString) {
  return new Date(isoString).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

// system_check_bot.js
function getHKTDateString(date) {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
}
```

**建議**: 統一使用 `lib/time.js`

---

## 5. 具體問題位置

### 5.1 Critical 問題 (需立即修復)

| 檔案 | 行號 | 問題 | 影響 |
|-----|-----|------|-----|
| `weekly_correction_loop.js` | 792-805 | `targetCategories` 包含 `'execSync_missing_trycatch'` 但實際 issue category 可能是 `'fs_operation_missing_trycatch'` | 規則無法匹配，Prevention Rules 不會生成 |
| `system_check_bot.js` | 671-676 | 硬編碼絕對路徑 | 環境變數問題時會失敗 |
| `verify_fix.js` | 362 | 常數名稱錯誤: `CONFIG.DEPriorITY_THRESHOLD` (應為 `DEPRIORITY`) | 語法錯誤風險 |

### 5.2 High 問題 (建議盡快修復)

| 檔案 | 行號 | 問題 | 影響 |
|-----|-----|------|-----|
| `pure_ai_audit.js` | 824 | 檢查 `byCategory['fs_operation_missing_trycatch']` 但實際 category 可能是 `'execSync_missing_trycatch'` | Prevention Rules 邏輯錯誤 |
| `auto_fix.js` | 596-612 | `annotateWithPureAI()` 使用舊格式 `p.rule` 但新格式可能是 `p.category` | 標註錯誤 |
| `code_quality_manager.js` | 329-347 | compat 格式輸出與其他檔案期望格式不一致 | 下游處理錯誤 |

### 5.3 Medium 問題 (建議修復)

| 檔案 | 行號 | 問題 | 影響 |
|-----|-----|------|-----|
| `auto_fix.js` | 159-169 | `loadPureAIResults()` 沒有處理 `findings` 欄位 | 數據遺失 |
| `system_check_bot.js` | 610-628 | `getAutoFixStatus()` 處理多種格式但沒有文件說明 | 維護困難 |

---

## 6. 修復建議優先級

### P0 - 立即修復 (影響功能正確性)

1. **統一 `pure_ai_audit_results.json` 欄位名稱**
   - 決定使用 `issues` 還是 `findings`
   - 更新所有引用檔案的解析邏輯

2. **修復 `weekly_correction_loop.js` 的 category 匹配問題**
   ```javascript
   // 第 798 行
   const targetCategories = ['execSync_missing_trycatch', 'magic_numbers'];
   // 應改為:
   const targetCategories = ['fs_operation_missing_trycatch', 'magic_numbers'];
   ```

### P1 - 盡快修復 (影響可維護性)

1. **統一檔案路徑引用**
   - 所有檔案統一使用 `lib/config.js` 定義的路徑

2. **提取共用 CLI 參數解析器**
   - 建立 `lib/cli-parser.js`

3. **完善 JSON 解析錯誤處理**
   - 所有 `JSON.parse` 包裝在 try-catch 中

### P2 - 建議修復 (改善品質)

1. 統一時間格式化函數
2. 添加輸入驗證
3. 補充 JSDoc 註釋

---

## 7. 測試建議

為確保 Code Quality System 正確運作，建議添加以下測試：

1. **整合測試**:
   ```bash
   # 測試完整流程
   node code_quality_manager.js scan --dir ./test-files
   node code_quality_manager.js fix --dry-run
   node system_check_bot.js --quiet
   ```

2. **JSON 格式兼容性測試**:
   - 測試舊格式 `issues` 陣列
   - 測試新格式 `findings` 陣列
   - 測試扁平 summary vs 嵌套 summary

3. **錯誤處理測試**:
   - 檔案不存在時的行為
   - JSON 損壞時的行為
   - 權限不足時的行為

---

## 8. 總結

Code Quality System 整體架構設計良好，核心功能正常運作。主要問題集中在：

1. **JSON 格式兼容性** - 新舊格式並存導致的解析問題
2. **檔案路徑管理** - 混合使用相對和絕對路徑
3. **錯誤處理** - 部分檔案讀取沒有完善的錯誤處理

建議按優先級逐步修復，並添加整合測試確保系統穩定性。

---

*報告結束*
