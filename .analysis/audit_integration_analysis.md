# Auto-Fix 與 Pure AI Audit 整合分析報告

**生成日期:** 2026-04-05 HKT  
**分析工具:** Kimi Code CLI  
**任務:** 分析如何整合 `auto_fix.js` 同 `pure_ai_audit.js` 兩套系統

---

## 📊 現狀分析

### `auto_fix.js` - 本地靜態分析系統

| 功能 | 說明 |
|------|------|
| **本地規則引擎** | 使用 regex 規則 (`LOW_RISK_RULES`, `HIGH_RISK_RULES`) |
| **自動修復** | Low-risk 問題自動修復 (trailing whitespace, EOF newline 等) |
| **系統審計** | 語法檢查、硬編碼路徑、Cron 檢查、懸空引用 |
| **錯誤分析** | 分析 `errors.json` 錯誤模式 |
| **影響分析** | Script 依賴關係、cron 影響評估 |
| **Spawn 模式** | 生成 payload 供 AI sub-agent 分析 |

### `pure_ai_audit.js` - AI 驅動審計系統

| 功能 | 說明 |
|------|------|
| **文件掃描** | 列出 JS 檔案，支援緩存 (hash-based) |
| **AI Prompt 生成** | 生成詳細審計 prompt |
| **上下文感知評級** | 根據操作類型調整 severity (e.g., `execSync` 寫入 errors.json = High) |
| **Spawn 準備** | 生成 spawn payload，寫入 pending marker |
| **結果輸出** | 等待 AI sub-agent 寫入 `pure_ai_audit_results.json` |

---

## 🔗 現有整合點

`auto_fix.js` 已經嘗試整合 `pure_ai_audit`：

```javascript
// auto_fix.js:596-612
function annotateWithPureAI(report) {
  const pureIssues = loadPureAIResults();
  // 用 pure_ai_audit 結果標註 high-risk 問題
  report.highRisk = report.highRisk.map(item => {
    const isHandled = pureIssues.some(p =>
      p.rule === item.rule || (p.type === item.rule && p.file?.endsWith(item.file))
    );
    return {
      ...item,
      pureAIAuditHandled: isHandled,
      note: isHandled ? '（已由 pure_ai_audit 處理）' : null
    };
  });
}
```

---

## ❌ 現有問題

| 問題 | 影響 |
|------|------|
| **重複掃描** | 兩個系統都掃描 `scripts/` 目錄 |
| **分離的工作流** | `auto_fix.js spawn` 和 `pure_ai_audit.js --spawn` 獨立運行 |
| **數據格式不一致** | Issue 格式不同，難以合併 |
| **緩存機制不共享** | `pure_ai_audit.js` 有自己的緩存，`auto_fix.js` 沒有 |
| **High-risk 處理衝突** | `auto_fix.js` 報告的 high-risk 可能已被 `pure_ai_audit` 修復 |

---

## ✅ 整合方案

### 方案一：分層架構 (推薦)

```
┌───────────────────────────────────────────────────────────────┐
│                    Unified Audit System                       │
├───────────────────────────────────────────────────────────────┤
│  Layer 4: 修復執行層 (Fix Execution)                         │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  • Low-risk: 自動修復 (auto_fix rules)                │   │
│  │  • Medium-risk: AI 建議修復 (AI suggested)            │   │
│  │  • High-risk: 人工確認 (human confirmation)           │   │
│  └───────────────────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────┤
│  Layer 3: 問題聚合器 (Issue Aggregator)                       │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  統一格式: { id, severity, source, file, line,        │   │
│  │             type, description, fix, status }          │   │
│  └───────────────────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────┤
│  Layer 2: 掃描引擎 (Scanners)                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Local Scanner│  │ AI Scanner   │  │ Error Scan   │        │
│  │ (auto_fix)   │  │ (pure_ai)    │  │ (errors.json)│        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
├───────────────────────────────────────────────────────────────┤
│  Layer 1: 文件發現 (File Discovery)                           │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  • 統一緩存機制 (mtime + hash)                        │   │
│  │  • 增量掃描 (只掃描變更檔案)                           │   │
│  │  • 文件元數據 (size, type, lastAudit)                 │   │
│  └───────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### 方案二：合併為單一入口

建立新的 `code_quality_manager.js` 作為統一入口：

```javascript
#!/usr/bin/env node
/**
 * Code Quality Manager - 統一代碼質量管理系統
 * 
 * 整合:
 * - auto_fix.js: 本地靜態分析 + 自動修復
 * - pure_ai_audit.js: AI 深度分析
 * 
 * 工作流程:
 * 1. 文件發現 (統一緩存)
 * 2. 本地掃描 (快速識別明顯問題)
 * 3. AI 分析 (深度分析複雜問題)
 * 4. 問題聚合 (去重、分級)
 * 5. 修復執行 (自動/AI建議/人工)
 */

const COMMANDS = {
  'scan':     '執行完整掃描 (本地 + AI)',
  'fix':      '掃描並自動修復 low-risk 問題',
  'report':   '顯示上次報告',
  'spawn':    '準備 AI sub-agent payload',
  'status':   '顯示系統狀態',
  'impact':   '影響分析',
  'deploy':   '部署前檢查',
};
```

---

## 🔧 具體實施步驟

### 步驟 1: 提取共用庫

```javascript
// lib/fileDiscovery.js - 統一文件發現
class FileDiscovery {
  constructor(config) {
    this.cache = new Map();
    this.cacheFile = '.state/file_cache.json';
  }
  
  async scan(options = {}) {
    // 統一掃描邏輯，支援增量掃描
  }
  
  getChangedFiles(since) {
    // 返回自上次掃描後變更的檔案
  }
}

// lib/issueAggregator.js - 問題聚合
class IssueAggregator {
  addIssue(issue) {
    // 統一格式，去重
  }
  
  getIssuesBySeverity(severity) {
    // 按嚴重性分類
  }
  
  mergeIssues(localIssues, aiIssues) {
    // 合併本地和 AI 發現的問題
  }
}
```

### 步驟 2: 統一 Issue 格式

```javascript
// 統一 Issue 格式 (JSON Schema)
const UnifiedIssue = {
  id: "string (e.g., HR-001, AI-001)",
  source: "enum: 'local' | 'ai' | 'error_json'",
  severity: "enum: 'critical' | 'high' | 'medium' | 'low'",
  category: "enum: 'security' | 'performance' | 'reliability' | 'style'",
  file: "string (relative path)",
  line: "number",
  rule: "string (rule ID)",
  title: "string (short description)",
  description: "string (detailed description)",
  suggestion: "string (fix suggestion)",
  autoFixable: "boolean",
  fix: "object | null (auto-fix code)",
  status: "enum: 'open' | 'in_progress' | 'resolved' | 'confirmed'",
  createdAt: "ISO timestamp",
  resolvedAt: "ISO timestamp | null",
};
```

### 步驟 3: 智能調度器

```javascript
// lib/auditOrchestrator.js
class AuditOrchestrator {
  async runAudit(options) {
    const files = await this.fileDiscovery.scan(options);
    
    // 1. 本地快速掃描 (總是執行)
    const localResults = await this.localScanner.scan(files);
    
    // 2. 決定是否需要 AI 分析
    const needsAI = this.shouldRunAI(files, localResults, options);
    
    let aiResults = [];
    if (needsAI) {
      // 2a. 生成 AI payload
      const payload = this.aiScanner.generatePayload(files, localResults);
      
      if (options.spawn) {
        // 2b. 標記等待外部 AI sub-agent
        await this.markPendingSpawn(payload);
        return { status: 'pending_ai', payload };
      } else {
        // 2c. 內部調用 AI (如果有直接 API)
        aiResults = await this.aiScanner.analyze(payload);
      }
    }
    
    // 3. 合併結果
    const unifiedIssues = this.aggregator.merge(localResults, aiResults);
    
    // 4. 自動修復 low-risk
    if (options.fix) {
      await this.fixEngine.applyLowRiskFixes(unifiedIssues);
    }
    
    // 5. 生成報告
    return this.reportGenerator.generate(unifiedIssues);
  }
  
  shouldRunAI(files, localResults, options) {
    // 判斷條件:
    // - 有新檔案
    // - 有 high-risk 問題
    // - 超過 N 天未運行 AI 審計
    // - 用戶明確要求 (--with-ai)
    if (options.withAI) return true;
    if (files.some(f => f.isNew)) return true;
    if (localResults.highRisk.length > 0) return true;
    
    const lastAIRun = this.getLastAIRun();
    const daysSinceLastRun = (Date.now() - lastLastRun) / (1000 * 60 * 60 * 24);
    return daysSinceLastRun > 7; // 每週至少一次 AI 審計
  }
}
```

---

## 📁 建議的文件結構

```
scripts/
├── code_quality_manager.js      # 統一入口 (新的)
├── auto_fix.js                  # 保留向後兼容，調用新系統
├── pure_ai_audit.js             # 保留向後兼容，調用新系統
├── lib/
│   ├── fileDiscovery.js         # 文件發現 (新提取)
│   ├── issueAggregator.js       # 問題聚合 (新提取)
│   ├── auditOrchestrator.js     # 調度器 (新)
│   ├── fixEngine.js             # 修復引擎 (從 auto_fix 提取)
│   ├── reportGenerator.js       # 報告生成 (新)
│   └── rules/
│       ├── low-risk.js          # 現有
│       ├── high-risk.js         # 現有
│       └── system-audit.js      # 現有
└── .state/
    ├── audit_cache.json         # 統一緩存
    ├── audit_issues.json         # 統一問題列表
    └── audit_report.json        # 統一報告
```

---

## 🎯 執行計劃

| 階段 | 工作 | 時間 |
|------|------|------|
| **Phase 1** | 提取共用庫 (`fileDiscovery`, `issueAggregator`) | 1-2 天 |
| **Phase 2** | 建立 `auditOrchestrator` 調度器 | 2-3 天 |
| **Phase 3** | 建立 `code_quality_manager.js` 統一入口 | 2 天 |
| **Phase 4** | 更新 `auto_fix.js` 和 `pure_ai_audit.js` 調用新系統 | 1-2 天 |
| **Phase 5** | 測試、過渡、文檔更新 | 2-3 天 |

---

## 💡 關鍵改進

1. **消除重複掃描**：統一文件發現層，共享緩存
2. **智能調度**：根據文件變更和風險自動決定是否需要 AI 分析
3. **統一報告**：單一視圖查看所有問題 (本地 + AI)
4. **避免重複修復**：標記已由 AI 處理的問題
5. **可擴展架構**：未來新增掃描器只需實現統一接口

---

## 總結

這個整合方案讓兩個系統的優勢互補：
- **auto_fix**: 快速、確定性、自動修復
- **pure_ai_audit**: 深度、智能、上下文感知

最終實現統一的代碼質量管理入口，簡化工作流程，減少重複工作。

---

*報告生成: Kimi Code CLI | 2026-04-05*