# Code Quality Manager 架構分析報告

> **分析日期:** 2026-04-05
> **分析者:** Kimi Code CLI (Sub-agent)
> **版本:** v1.0.0

---

## 1. 執行摘要

本報告分析 Code Quality Manager (CQM) 新架構的運作流程邏輯，包括：
- `code_quality_manager.js` - 統一CLI入口
- `auditOrchestrator.js` - 三種Scanner協調
- `fileDiscovery.js` - 增量掃描與緩存
- `issueAggregator.js` - Issue統一管理

**整體評估:** 架構設計合理，模組化良好，但存在若干需要改進的問題。

---

## 2. 架構總覽

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Code Quality Manager                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │ CLI Handler │    │CodeQuality   │    │ Report      │         │
│  │             │───▶│ Manager     │───▶│ Generator  │         │
│  └──────────────┘    └──────┬───────┘    └──────────────┘         │
│                             │                                       │
│         ┌───────────────────┼───────────────────┐                 │
│         ▼                   ▼                   ▼                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │FileDiscovery│    │AuditOrches- │    │Issue       │         │
│  │             │───▶│ trator     │───▶│ Aggregator │         │
│  └──────────────┘    └─────────────┘    └──────────────┘         │
│                             │                                       │
│         ┌───────────────────┼───────────────────┐                 │
│         ▼                   ▼                   ▼                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │LocalScanner  │    │  AIScanner   │    │ErrorScanner │         │
│  └──────────────┘    └──────────────┘    └──────────────┘         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Cron Job 流程

```
┌───────────────────────────────────────────��────────────────────────┐
│              System Check Cron Job (10:00/15:00/22:00)           │
├────────────────────────────────────────────────────────────────────┤
│                                                             │
│  Cron Trigger                                                │
│       │                                                      │
│       ▼                                                      │
│  code_quality_manager.js scan                                │
│       │                                                      │
│       ├── 1. File Discovery (增量掃描)                       │
│       │     • 使用 mtime + hash 檢測變更                     │
│       │     • 緩存機制避免重複掃描                           │
│       ▼                                                      │
│  auditOrchestrator.run()                                     │
│       │                                                      │
│       ├── 2. Local Scanner (規則基礎)                         │
│       │     • execSync_missing_trycatch (P0)                │
│       │     • magic_numbers (P1)                            │
│       │     • file_too_large                                 │
│       ▼                                                      │
│  shouldRunAI(localIssues)                                    │
│       │                                                      │
│       ├── 3. AI Scanner (if threshold met)                    │
│       │     • pure_ai_audit.js                               │
│       │     • LLM-based analysis                            │
│       ▼                                                      │
│  Error Scanner (always)                                      │
│       • 讀取 errors.json                                     │
│       • 匹配相關檔案的runtime errors                          │
│       ▼                                                      │
│  合併去重 (merge)                                            │
│       • 基於 file:line:rule:message key                      │
│       • 保留最高severity                                    │
│       ▼                                                      │
│  code_quality_manager.js fix (自動修復)                       │
│       • 修復 low-risk 問題                                   │
│       • 使用 IssueAggregator autoFixable 標記                  │
│       ▼                                                      │
│  system_check_bot.js (顯示剩餘問題)                           │
│       • 僅顯示無法自動修復的問題                             │
│       • 按 severity 分組顯示                                 │
│                                                             │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. 組件分析

### 3.1 code_quality_manager.js

**位置:** `scripts/code_quality_manager.js`

#### CLI 命令

| 命令 | 功能 |
|------|------|
| `scan` | 完整掃描 (發現 + 審計 + 報告) |
| `discover` | 僅發現檔案 (不審計) |
| `audit` | 僅審計指定檔案 |
| `fix` | 自動修復 (需手動實現) |
| `cache` | 緩存管理 |
| `report` | 從現有結果生成報告 |

#### Scan 命令邏輯

```javascript
// code_quality_manager.js - cmdScan()
async function cmdScan(parsed) {
  // 1. 解析參數
  const targetDirs = parsed.options.dir ? [parsed.options.dir] : ['.'];
  const ext = parsed.options.ext ? [...];

  // 2. 初始化 CQM
  const cqm = new CodeQualityManager({
    extensions: ext,
    enableCache: !parsed.options['no-cache'],
    _quiet: parsed.options.quiet
  });

  // 3. 執行完整流程
  await cqm.run(targetDirs, {
    outputDir: parsed.options.output,
    report: reportOptions
  });
}
```

#### 流程分析

1. **發現檔案** (`discoverFiles`)
   - 調用 `FileDiscovery.scanDirectories()`
   - 返回 `{ files, stats }`
   - Stats 包含: total, changed, unchanged, cacheHitRate

2. **執行審計** (`runAudit`)
   - 調用 `AuditOrchestrator.run(filePaths)`
   - 遍歷審計結果，轉換為標準 Issue 格式
   - 添加到 IssueAggregator

3. **生成報告** (`saveReport`)
   - 支持格式: JSON, Markdown, SARIF
   - 保存到 `.state/` 目錄

#### 問題發現

| ID | 問題 | 嚴重程度 | 說明 |
|----|------|----------|------|
| CQM-001 | scan命令缺少 `--fix` 選項 | Medium | 沒有實現fix命令，需求說明有fix流程 |
| CQM-002 | 沒有調用system_check_bot | Medium | 需求說明中提到但在實現中未看到 |
| CQM-003 | scan返回的results未被使用 | Low | results物件被填充但未被利用 |
| CQM-004 | JSON.parse直接readFileSync無try-catch | Medium | 當input file損壞時會崩潰 |

### 3.2 auditOrchestrator.js

**位置:** `scripts/lib/auditOrchestrator.js`

#### AI 觸發邏輯 (shouldRunAI)

```javascript
shouldRunAI(localIssues) {
  const highCount = localIssues.filter(i => i.severity === 'high').length;
  const criticalCount = localIssues.filter(i => i.severity === 'critical').length;
  const mediumCount = localIssues.filter(i => i.severity === 'medium').length;
  
  const threshold = {
    highSeverityCount: 5,      // >5 high → 觸發
    criticalExists: 1,          // ≥1 critical → 觸發
    mediumSeverityCount: 10       // >10 medium → 觸發
  };
  
  return criticalCount >= threshold.criticalExists ||
         highCount >= threshold.highSeverityCount ||
         mediumCount >= threshold.mediumSeverityCount;
}
```

**評估:** ✅ 邏輯正確，閾值合理

#### Scanner 協調流程

```
Step 1: Local Scanner (always)
        ↓
Step 2: shouldRunAI() → AI Scanner (conditional)
        ↓
Step 3: Error Scanner (always)
        ↓
Step 4: merge() → 去重 + 排序
```

**評估:** ✅ 協調邏輯正確

#### 合併去重邏輯

```javascript
merge() {
  const allIssues = [...local, ...ai, ...error];
  
  // 去重key: file:line:rule:message(前50字)
  const seen = new Map();
  for (const issue of allIssues) {
    const key = `${issue.file}:${issue.line}:${issue.rule}:${msgHash}`;
    if (!seen.has(key)) {
      uniqueIssues.push(issue);
    } else {
      // 保留較高severity
      if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[existing.severity]) {
        existing.severity = issue.severity;
      }
      // 合併source
      existing.source = [...new Set([...existing.source, issue.source])];
    }
  }
  
  // 按severity排序
  uniqueIssues.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
}
```

**評估:** ⚠️ 存在問題 - message前50字符的hash可能碰撞

#### AI Scanner 問題

```javascript
class AIScanner {
  async run(files) {
    // 問題: 實際上只是模擬，不會真正調用 pure_ai_audit
    console.log(`🤖 AI Scanner: Would run pure_ai_audit.js on ${files.length} files`);
    return [];  // 返回空陣列
  }
}
```

**評估:** ❌ 有嚴重問題 - AI Scanner 沒有實際實現！

| ID | 問題 | 嚴重程度 |
|----|------|----------|
| AO-001 | AIScanner.run() 返回空陣列 | Critical |
| AO-002 | 沒有調用 pure_ai_audit.js | Critical |
| AO-003 | AI分析結果為空，無法觸發有意義的審計 | High |

### 3.3 fileDiscovery.js

**位置:** `scripts/lib/fileDiscovery.js`

#### 增量掃描邏輯

```javascript
scanDirectory(dirPath) {
  // 檢查緩存有效性
  if (this.cache.isValid(fullPath, mtime, size)) {
    fileInfo.fromCache = true;
    unchanged.push(fileInfo);
  } else {
    // 計算hash (SHA256, 只取前16字符)
    fileInfo.hash = this.computeHash(fullPath);
    fileInfo.fromCache = false;
    changed.push(fileInfo);
  }
}
```

**評估:** ✅ 邏輯正確

#### 緩存機制

| 方法 | 功能 |
|------|------|
| `isValid(filePath, mtime, size)` | 基於mtime+size驗證 |
| `computeHash(filePath)` | SHA256 hash (截斷16字符) |
| `clear()` | 清除緩存 |
| `getStats()` | 獲取緩存統計 |

**評估:** ✅ 緩存機制設計良好

#### 問題發現

| ID | 問題 | 嚴重程度 |
|----|------|----------|
| FD-001 | 沒有實現增量審計，只實現增量發現 | Medium |
| FD-002 | hash截斷可能導致hash碰撞 | Low |

### 3.4 issueAggregator.js

**位置:** `scripts/lib/issueAggregator.js`

#### 去重策略

```javascript
getDedupKey(issue) {
  switch (this.options.dedupStrategy) {
    case 'hash':
      return issue.id;                    // SHA256 of source:file:line:rule:title
    case 'location':
      return `${issue.file}:${issue.line}:${issue.rule}`;
    case 'title':
      return `${issue.file}:${issue.title}`;
  }
}
```

**評估:** ✅ 去重策略靈活多樣

#### Issue 格式驗證

```javascript
validate(issue) {
  // 必填欄位: id, source, severity, category, file, title
  // 枚舉驗證: severity, category, source, status
}
```

**評估:** ✅ 驗證嚴格

---

## 4. 整體流程分析

### 4.1 理想 vs 實際流程

```
需求流程:
────────────────────────────────────────────────────────────────────────────
Cron Trigger (10:00/15:00/22:00)
    │
    ▼
code_quality_manager.js scan
    │
    ├── 1. FileDiscovery (增量) ✓
    │   └── 結果: files[]
    │
    ├── 2. LocalScanner ✓
    │   └── 結果: localIssues[]
    │
    ├── 3. AI Scanner (智能判斷) ⚠️
    │   └── 問題: 未實際實現
    │
    └── 4. ErrorScanner ✓
        └── 結果: errorIssues[]
    
    ▼
智能判斷是否需要 AI 審計 ✓
    └── 閾值邏輯正確
    
    ▼
code_quality_manager.js fix (自動修復) ❌
    └── 問題: 沒有實現fix命令
    
    ▼
system_check_bot.js (顯示剩餘問題) ❌
    └── 問題: 沒有調用
```

### 4.2 流程銜接分析

| 步驟 | 組件 | 銜接正確? | 說明 |
|------|------|----------|------|
| Cron → scan | ✅ | CQM正確解析cron參數 |
| scan → discoverFiles | ✅ | FileDiscovery被正確調用 |
| discoverFiles → runAudit | ✅ | files傳遞正確 |
| runAudit → shouldRunAI | ✅ | 閾值判斷正確 |
| shouldRunAI → AI Scanner | ❌ | AI Scanner未實現 |
| scan → fix | ❌ | 缺少fix實現 |
| fix → system_check_bot | ❌ | 缺少調用 |

---

## 5. 潛在問題

### 5.1 嚴重問題 (Critical)

| # | 問題 | 位置 | 影響 |
|---|------|------|------|
| P0-1 | AIScanner返回空陣列 | auditOrchestrator.js | AI審計完全失效 |
| P0-2 | 沒有fix命令實現 | code_quality_manager.js | 自動修復流程無法運行 |
| P0-3 | 沒有調用system_check_bot | CQM整體 | 剩餘問題無法顯示 |

### 5.2 高風險問題 (High)

| # | 問題 | 位置 | 影響 |
|---|------|------|------|
| P1-1 | JSON.parse無try-catch | CLIHandler.cmdReport | 損壞的input會崩潰 |
| P1-2 | 缺少增量審計邏輯 | fileDiscovery.js | 每次都執行完整審計 |
| P1-3 | hash碰撞風險 | fileDiscovery.js | hash截斷可能碰撞 |

### 5.3 中等問題 (Medium)

| # | 問題 | 位置 | 影響 |
|---|------|------|------|
| P2-1 | message hash可能碰撞 | auditOrchestrator.js | 去重不完全 |
| P2-2 | 缺少--fix CLI選項 | CLIHandler | 用戶無法觸發修復 |
| P2-3 | scan結果未利用 | CodeQualityManager | results物件被忽視 |

### 5.4 Edge Cases

| 場景 | 處理 | 評估 |
|------|------|------|
| 空目錄 | 返回空files | ✅ 正確 |
| 無法讀取檔案 | 記錄errors陣列 | ✅ 正確 |
| 超大檔案 | 跳过/警告 | ✅ 正確 |
| 編碼錯誤 | 記錄read-error | ✅ 正確 |
| 路徑遍歷 | isPathSafe檢查 | ✅ 正確 |
| 緩存損壞 | 重新計算 | ⚠️ 需驗證 |

---

## 6. 改進建議

### 6.1 立即需要修復 (Critical)

1. **實現 AIScanner**
   ```javascript
   async run(files) {
     // 實際調用 pure_ai_audit.js
     return await this.runPureAIAudit(files);
   }
   ```

2. **實現 fix 命令**
   ```javascript
   this.commands.set('fix', {
     action: this.cmdFix.bind(this)
   });
   
   async cmdFix(parsed) {
     // 調用 autoFixFile
   }
   ```

3. **調用 system_check_bot**
   ```javascript
   async function showRemainingIssues(cqm) {
     const remaining = cqm.getIssues({ autoFixable: false });
     // 調用 system_check_bot
   }
   ```

### 6.2 建議改進 (Medium)

1. **添加 try-catch**
   ```javascript
   try {
     const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
   } catch (e) {
     console.error(`Invalid input: ${e.message}`);
     process.exit(1);
   }
   ```

2. **實現增量審計**
   - 僅審計changed的檔案
   - 使用cached結果

3. **改進message hash**
   - 使用完整message
   - 或使用message長度+前100字符

### 6.3 代碼質量改進 (Low)

1. **Magic numbers → CONFIG**
   ```javascript
   const CONFIG = {
     HASH_LENGTH: 16,
     MESSAGE_PREVIEW_LENGTH: 50,
     MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024
   };
   ```

2. **統一日誌輸出**
   - 所有console.log應該支持quiet模式

---

## 7. 結論

### 7.1 整體評估

| 維度 | 評分 | 說明 |
|------|------|------|
| 設計 | 8/10 | 架構清晰，模組化良好 |
| 實現 | 5/10 | 多處關鍵功能缺失 |
| 穩定性 | 6/10 | 基礎功能穩定，但有風險 |
| 可維護性 | 8/10 | コード結構良好，易於擴展 |

### 7.2 關鍵發現

✅ **優點:**
1. 架構設計合理，三層Scanner協調正確
2. 增量掃描+mtime+hash機制設計良好
3. IssueAggregator去重邏輯正確
4. AI觸發閾值邏輯合理

❌ **問題:**
1. AI Scanner未實際實現
2. 缺少fix命令實現
3. 沒有調用system_check_bot
4. 錯誤處理不完善

### 7.3 下一步行動

**立即行動:**
1. 實現 AIScanner.run() 實際調用 pure_ai_audit.js
2. 添加 fix 命令實現
3. 添加 system_check_bot 調用

**後續行動:**
1. 添加增量審計邏輯
2. 完善錯誤處理
3. 添加單元測試

---

*報告結束*