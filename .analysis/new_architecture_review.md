# 代碼質量管理系統審計報告

**審計日期**: 2026-04-05  
**審計對象**: scripts/lib/fileDiscovery.js, issueAggregator.js, auditOrchestrator.js, code_quality_manager.js  
**審計人**: AI Code Auditor

---

## 1. 執行摘要

整體評級: **B+ (良好，需修復部分問題)**

| 範疇 | 評級 | 狀態 |
|------|------|------|
| 運作正常性 | A- | ✅ 基本可用 |
| 代碼質量 | B+ | ⚠️ 需改進 |
| 安全性 | B | ⚠️ 需關注 |
| 效能 | A | ✅ 良好 |
| 相容性 | B+ | ⚠️ 部分問題 |

---

## 2. 詳細分析

### 2.1 運作正常性 ✅

#### 測試結果
| 測試項目 | 結果 | 備註 |
|---------|------|------|
| fileDiscovery.js require | ✅ 通過 | 所有導出正常 |
| issueAggregator.js require | ✅ 通過 | 所有導出正常 |
| auditOrchestrator.js require | ✅ 通過 | 所有導出正常 |
| code_quality_manager.js require | ✅ 通過 | 所有導出正常 |
| help 命令 | ✅ 通過 | 顯示正確 |
| discover 命令 | ✅ 通過 | JSON 輸出正常 |
| cache 命令 | ✅ 通過 | stats/clear 正常 |
| scan 命令 | ✅ 通過 | 完整流程運行 |
| audit 命令 | ✅ 通過 | 可執行 |
| report 命令 | ⚠️ 需輸入文件 | 功能正常 |

#### 性能測試
- 文件掃描: 10,500+ files/second
- Issue 處理: 10,000 issues / 7ms
- 記憶體使用: 正常

### 2.2 BUG 檢查 ⚠️

#### 🔴 高優先級問題

| 問題 | 位置 | 嚴重性 | 描述 |
|------|------|--------|------|
| ** basename 信息丟失** | auditOrchestrator.js:97,120 | 🔴 High | LocalScanner 使用 `path.basename(file)` 導致不同目錄相同檔名無法區分 |
| **Issue 合併邏輯缺陷** | auditOrchestrator.js:350-386 | 🔴 High | 合併 key 使用 `${file}:${line}:${rule}`，但 file 已是 basename，導致誤判 |

**影響示例**:
```javascript
// lib/utils.js 和 src/utils.js 都被記錄為 "utils.js"
// 結果: 兩個不同文件的問題被誤認為同一個
```

#### 🟡 中優先級問題

| 問題 | 位置 | 嚴重性 | 描述 |
|------|------|--------|------|
| **Null path 處理** | fileDiscovery.js | 🟡 Medium | `scanDirectory(null)` 拋出錯誤而非優雅處理 |
| **缺少輸入驗證** | multiple | 🟡 Medium | 多個函數缺少參數類型檢查 |
| **Error message 吞掉** | issueAggregator.js:265 | 🟡 Medium | `runAudit` 中無效 issue 被靜默忽略 |

#### 🟢 低優先級問題

| 問題 | 位置 | 嚴重性 | 描述 |
|------|------|--------|------|
| **Magic number 規則過於嚴格** | auditOrchestrator.js:111 | 🟢 Low | 將年份 (2026) 誤判為 magic number |
| **缺少文件編碼處理** | multiple | 🟢 Low | 假設所有文件皆為 UTF-8 |

### 2.3 運作邏輯 ✅

#### 流程正確性
```
fileDiscovery → issueAggregator → auditOrchestrator
     ✅              ✅                 ✅
```

**各階段評估**:

| 階段 | 狀態 | 評價 |
|------|------|------|
| FileDiscovery | ✅ | 快取機制完善，增量掃描正確 |
| IssueAggregator | ✅ | Builder pattern 實現良好，去重邏輯正確 |
| AuditOrchestrator | ⚠️ | Scanner 邏輯正確，但輸出格式需改進 |

#### Issue 格式統一性

**CQM 標準格式**:
```javascript
{
  id: string,           // SHA256 hash
  source: 'local'|'ai'|'error_json',
  severity: 'critical'|'high'|'medium'|'low',
  category: 'security'|'performance'|'reliability'|'style',
  file: string,         // 文件名 (⚠️ 不是完整路徑)
  line: number,
  rule: string,
  title: string,
  description?: string,
  suggestion?: string,
  autoFixable: boolean,
  status: 'open'|'in_progress'|'resolved',
  createdAt: ISOString,
  metadata?: object
}
```

**問題**: `file` 欄位在 AuditOrchestrator 中是 basename，但應該是相對路徑或絕對路徑。

### 2.4 與現有系統相容性 ⚠️

#### 與 auto_fix.js 比較

| 欄位 | CQM | auto_fix.js | 相容性 |
|------|-----|-------------|--------|
| file | ✅ basename | ✅ basename | ✅ 相容 |
| line | ✅ number | ✅ number | ✅ 相容 |
| severity | ✅ string | ✅ string | ✅ 相容 |
| rule | ✅ string | ✅ string | ✅ 相容 |
| message/title | ⚠️ title | message | ⚠️ 欄位名不同 |
| source | ✅ 有 | ❌ 無 | ⚠️ CQM 擴展 |
| category | ✅ 有 | ❌ 無 | ⚠️ CQM 擴展 |

#### 與 pure_ai_audit.js 比較

| 項目 | CQM | pure_ai_audit.js | 狀態 |
|------|-----|------------------|------|
| Issue 格式 | 標準化 | 自定義 | ⚠️ 需適配器 |
| 輸出位置 | .state/ | .state/ | ✅ 相同 |
| Cache 機制 | 獨立 | 獨立 | ⚠️ 可能重複 |

#### 與 weekly_correction_loop.js 相容性

- ✅ 都可讀取 errors.json
- ⚠️ 輸出格式不同，需轉換
- ✅ 都使用 lib/config.js

### 2.5 潛在問題

#### 🔒 安全性問題

| 問題 | 風險等級 | 描述 | 建議 |
|------|----------|------|------|
| 原子寫入競態條件 | 🟡 Medium | `atomicWriteSync` 在異常時可能殘留 tmp 文件 | 添加清理機制 |
| 文件路徑驗證 | 🟡 Medium | 無驗證路徑遍歷攻擊 (../) | 添加路徑规范化 |
| 敏感信息洩露 | 🟢 Low | 錯誤信息可能包含文件內容 | 限制錯誤輸出 |

#### ⚡ 效能問題

| 問題 | 風險等級 | 描述 | 建議 |
|------|----------|------|------|
| 大文件讀取 | 🟡 Medium | 無文件大小限制 | 添加 MAX_FILE_SIZE |
| 記憶體使用 | 🟢 Low | IssueAggregator 存儲所有 issues | 考慮分頁 |
| 遞歸深度 | 🟢 Low | 無目錄遞歸深度限制 | 添加深度限制 |

#### 📝 代碼重複

| 重複內容 | 位置 | 建議 |
|----------|------|------|
| severityOrder 定義 | auditOrchestrator.js:370,382 | 提取為常量 |
| SARIF 生成 | issueAggregator.js:464, code_quality_manager.js:152 | 統一為一個模組 |
| 文件掃描邏輯 | fileDiscovery.js, auditOrchestrator.js:471 | 統一使用 FileDiscovery |

---

## 3. 問題列表 (JSON 格式)

```json
{
  "audit_summary": {
    "total_issues": 12,
    "critical": 2,
    "high": 2,
    "medium": 5,
    "low": 3
  },
  "issues": [
    {
      "id": "CQM-001",
      "severity": "critical",
      "category": "reliability",
      "file": "lib/auditOrchestrator.js",
      "line": 97,
      "rule": "path_basename_data_loss",
      "title": "LocalScanner 使用 basename 導致路徑信息丟失",
      "description": "LocalScanner 在創建 Issue 時使用 path.basename(file)，導致不同目錄下同名的文件無法區分，issue 合併時會出現誤判。",
      "impact": "不同目錄的同名文件問題會被錯誤合併",
      "fix_suggestion": "改用 relativePath 或完整路徑",
      "autoFixable": false
    },
    {
      "id": "CQM-002",
      "severity": "critical",
      "category": "reliability", 
      "file": "lib/auditOrchestrator.js",
      "line": 362,
      "rule": "merge_key_collision",
      "title": "Issue 合併 key 使用 basename 導致碰撞",
      "description": "merge() 函數使用 \`${file}:\${line}:\${rule}\` 作為去重 key，但 file 已是 basename。",
      "impact": "同名文件的不同問題會被錯誤去重",
      "fix_suggestion": "使用完整路徑或相對路徑作為 key 的一部分",
      "autoFixable": false
    },
    {
      "id": "CQM-003",
      "severity": "high",
      "category": "reliability",
      "file": "lib/fileDiscovery.js",
      "line": 134,
      "rule": "null_input_handling",
      "title": "scanDirectory 未處理 null 輸入",
      "description": "當傳入 null 或 undefined 時，函數會拋出異常而非優雅處理。",
      "impact": "API 使用不當時會崩潰",
      "fix_suggestion": "添加參數驗證",
      "autoFixable": true
    },
    {
      "id": "CQM-004",
      "severity": "high",
      "category": "reliability",
      "file": "code_quality_manager.js",
      "line": 265,
      "rule": "silent_error_swallowing",
      "title": "runAudit 中無效 issue 被靜默忽略",
      "description": "try-catch 塊為空，無效 issue 的錯誤信息丟失。",
      "impact": "調試困難，無法追蹤問題",
      "fix_suggestion": "添加日誌或錯誤收集",
      "autoFixable": true
    },
    {
      "id": "CQM-005",
      "severity": "medium",
      "category": "performance",
      "file": "lib/fileDiscovery.js",
      "line": 106,
      "rule": "unbounded_file_read",
      "title": "無文件大小限制讀取",
      "description": "computeHash 和 scanDirectory 無限制地讀取文件內容。",
      "impact": "大文件可能導致記憶體問題",
      "fix_suggestion": "添加文件大小檢查",
      "autoFixable": true
    },
    {
      "id": "CQM-006",
      "severity": "medium",
      "category": "security",
      "file": "lib/config.js",
      "line": 53,
      "rule": "tmp_file_cleanup",
      "title": "atomicWriteSync tmp 文件清理不完整",
      "description": "雖有 try-catch 清理，但在某些極端情況下可能殘留。",
      "impact": "可能累積 tmp 文件",
      "fix_suggestion": "使用同步清理或 process.on('exit')",
      "autoFixable": true
    },
    {
      "id": "CQM-007",
      "severity": "medium",
      "category": "style",
      "file": "lib/auditOrchestrator.js",
      "line": 111,
      "rule": "overzealous_magic_number",
      "title": "Magic number 規則過於嚴格",
      "description": "將年份 (如 2026) 誤判為 magic number。",
      "impact": "產生大量無意義的 low severity issues",
      "fix_suggestion": "添加白名單 (年份、常見端口等)",
      "autoFixable": true
    },
    {
      "id": "CQM-008",
      "severity": "medium",
      "category": "maintainability",
      "file": "lib/auditOrchestrator.js",
      "line": 370,
      "rule": "duplicate_severity_order",
      "title": "severityOrder 定義重複",
      "description": "第 370 行和 382 行有相同的 severityOrder 定義。",
      "impact": "維護困難，可能不一致",
      "fix_suggestion": "提取為常量或共享函數",
      "autoFixable": true
    },
    {
      "id": "CQM-009",
      "severity": "medium",
      "category": "maintainability",
      "file": "multiple",
      "line": null,
      "rule": "duplicate_sarif_generation",
      "title": "SARIF 生成邏輯重複",
      "description": "issueAggregator.js 和 code_quality_manager.js 都有 SARIF 生成。",
      "impact": "代碼重複，維護困難",
      "fix_suggestion": "統一到單一模組",
      "autoFixable": false
    },
    {
      "id": "CQM-010",
      "severity": "low",
      "category": "security",
      "file": "lib/fileDiscovery.js",
      "line": 134,
      "rule": "path_traversal_check",
      "title": "缺少路徑遍歷檢查",
      "description": "未驗證掃描路徑是否包含 ../ 等跳轉。",
      "impact": "理論上可能訪問預期外目錄",
      "fix_suggestion": "使用 path.resolve 和驗證",
      "autoFixable": true
    },
    {
      "id": "CQM-011",
      "severity": "low",
      "category": "reliability",
      "file": "lib/auditOrchestrator.js",
      "line": 471,
      "rule": "duplicate_scan_logic",
      "title": "CLI main 函數重複實現文件掃描",
      "description": "main() 函數中的 scanDir 與 FileDiscovery 功能重複。",
      "impact": "代碼重複",
      "fix_suggestion": "使用 FileDiscovery 類別",
      "autoFixable": true
    },
    {
      "id": "CQM-012",
      "severity": "low",
      "category": "style",
      "file": "lib/fileDiscovery.js",
      "line": 153,
      "rule": "encoding_assumption",
      "title": "假設所有文件為 UTF-8",
      "description": "讀取文件時未處理編碼問題。",
      "impact": "二進制文件可能導致問題",
      "fix_suggestion": "添加編碼檢測或錯誤處理",
      "autoFixable": true
    }
  ]
}
```

---

## 4. 修復建議

### 4.1 立即修復 (Critical/High)

#### 修復 1: 使用相對路徑替代 basename
**文件**: `lib/auditOrchestrator.js`
```javascript
// 修改前 (line 97, 120)
file: path.basename(file)

// 修改後
file: path.relative(process.cwd(), file)
```

#### 修復 2: 更新 merge key 生成邏輯
**文件**: `lib/auditOrchestrator.js`
```javascript
// 修改前 (line 362)
const key = `${issue.file}:${issue.line}:${issue.rule}`;

// 修改後 - 使用完整路徑或 id
const key = issue.id || `${issue.file}:${issue.line}:${issue.rule}`;
```

#### 修復 3: 添加 null 輸入驗證
**文件**: `lib/fileDiscovery.js`
```javascript
// 在 scanDirectory 開頭添加
if (!dirPath || typeof dirPath !== 'string') {
  return { files: [], changed: [], unchanged: [], errors: [{ path: dirPath, error: 'Invalid directory path' }], stats: { total: 0, changed: 0, unchanged: 0, errors: 1, cacheHitRate: 0 } };
}
```

### 4.2 短期修復 (Medium)

#### 修復 4: 添加文件大小限制
```javascript
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// 在 scanDirectory 中
if (stat.size > MAX_FILE_SIZE) {
  errors.push({ path: fullPath, error: 'File too large' });
  continue;
}
```

#### 修復 5: 添加錯誤日誌
```javascript
// 在 code_quality_manager.js line 265
catch (err) {
  console.warn(`⚠️ Failed to add issue: ${err.message}`);
  // 或收集到錯誤數組
}
```

#### 修復 6: 改進 magic number 規則
```javascript
const MAGIC_NUMBER_WHITELIST = [
  /^20\d{2}$/,  // 年份
  /^(80|443|3000|8080)$/,  // 常見端口
  /^(1024|2048|4096)$/  // 常見 buffer 大小
];
```

### 4.3 長期改進 (Low)

1. **統一 SARIF 生成**: 創建獨立的 `lib/reporters/sarif.js`
2. **提取常量**: 將 severityOrder、VALID_SEVERITIES 等統一到 `lib/constants.js`
3. **路徑驗證**: 添加路徑遍歷防護
4. **編碼處理**: 使用 `chardet` 或類似庫檢測文件編碼

---

## 5. 相容性適配建議

### 5.1 與 auto_fix.js 整合

創建適配器:
```javascript
// lib/adapters/autoFixAdapter.js
function convertToAutoFixFormat(cqmIssue) {
  return {
    id: cqmIssue.id,
    file: cqmIssue.file,
    line: cqmIssue.line,
    severity: cqmIssue.severity,
    rule: cqmIssue.rule,
    message: cqmIssue.title,  // 欄位映射
    // ...
  };
}
```

### 5.2 與 pure_ai_audit.js 整合

創建統一接口:
```javascript
// lib/unifiedAudit.js
class UnifiedAudit {
  async run() {
    const cqmResults = await this.runCQM();
    const pureAIResults = await this.loadPureAIResults();
    return this.mergeResults(cqmResults, pureAIResults);
  }
}
```

---

## 6. 測試建議

添加以下測試用例:

1. **路徑處理測試**: 驗證同名文件不同目錄的處理
2. **邊界測試**: 空目錄、大文件、無權限文件
3. **並發測試**: 多個掃描同時運行
4. **相容性測試**: 與現有系統的輸入輸出匹配

---

## 7. 結論

代碼質量管理系統整體設計良好，架構清晰，功能完整。主要問題集中在:

1. **路徑處理**: basename 使用導致的數據丟失 (Critical)
2. **錯誤處理**: 部分邊界情況處理不完善
3. **代碼重複**: 部分邏輯重複，需要重構

建議優先修復 Critical 和 High 級別問題，然後逐步改進 Medium 和 Low 級別問題。

---

**報告生成時間**: 2026-04-05T13:45:00+08:00  
**報告版本**: 1.0
