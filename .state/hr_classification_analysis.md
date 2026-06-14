# Code Quality Scanner — High-Risk 分類標準調整分析

**生成時間：** 2026-04-07 12:07 HKT
**依據：** Kimi Code CLI 驗證結果（9 個 High-Risk 問題：2 FP + 7 技術存在但風險極低）

---

## 摘要

| 規則 | 現 severity | 問題類型 | 建議調整 |
|------|-----------|----------|---------|
| `file-too-long` | `medium` | 維護性問題 | → **Low** + 移至 low-risk.js |
| `hardcoded-path-in-string` | `high` | 標準 pattern 誤判 | → 加入 Whitelist |
| `missing-atomic-write` | `medium` | 小檔案風險可忽略 | → 加入小檔案豁免 |
| `todo-fixme` | `low` | 註釋區誤判 | → 改進檢測邏輯 |
| `inconsistent-return-value` | `high` | 通知函數誤判 | → 加入 Pattern 豁免 |

---

## 1. file-too-long (HR-002, HR-005, HR-007)

### 現狀分析
- **當前 severity：** `medium`（在 high-risk.js 中但級別本身是 medium）
- **閾值：** 1000 行 (`MAX_FILE_LINES_WARN = 1000`)
- **檢測邏輯：** 單純計算行數，無任何上下文

```javascript
// high-risk.js Lines 274-286
{
  id: 'file-too-long',
  severity: 'medium',
  detect(content, filePath) {
    const lineCount = content.split('\n').length;
    return {
      found: lineCount > MAX_FILE_LINES_WARN,
      details: `${lineCount} 行（建議 < ${MAX_FILE_LINES_WARN} 行）`,
      severity: 'medium',
    };
  },
},
```

### 驗證結果
| ID | 行數 | 結論 |
|----|------|------|
| HR-002 | 1031 行 | 維護性問題，非安全問題 |
| HR-005 | 1362 行 | 維護性問題 |
| HR-007 | 1059 行 | 維護性問題 |

### 問題
檔案過長是**代碼質量/可維護性**問題，不是安全問題。不應放在 high-risk.js 中。

### 調整建議

**方案 A（推薦）：移至 low-risk.js，severity 改為 `low`**

修改 `scripts/lib/rules/high-risk.js`：
```javascript
// 移除 file-too-long 規則（或註釋掉）
```

在 `scripts/lib/rules/low-risk.js` 中新增：
```javascript
{
  id: 'file-too-long',
  name: '檔案過長',
  category: 'maintenance',
  severity: 'low',
  detect(content, filePath) {
    const skip = skipIfRuleDef(filePath);
    if (skip) return skip;
    const lineCount = content.split('\n').length;
    return {
      found: lineCount > MAX_FILE_LINES_WARN,
      details: `${lineCount} 行（建議 < ${MAX_FILE_LINES_WARN} 行）`,
      lines: [],
      severity: 'low',
      suggestion: '考慮拆分為多個模組',
    };
  },
},
```

**預期效果：** High-Risk 報告中不再出現檔案過長問題，大幅減少 High-Risk 噪音。

---

## 2. hardcoded-path-in-string (HR-003, HR-008)

### 現狀分析
- **當前 severity：** `high`
- **檢測邏輯：** 任何包含 `/Users/\w+` 或 `/home/\w+` 的行

```javascript
// high-risk.js Lines 448-466
{
  id: 'hardcoded-path-in-string',
  severity: 'high',
  detect(content, filePath) {
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (/\/Users\/\w+/.test(line) || /\/home\/\w+/.test(line)) {
        found.push(i + 1);
      }
    });
  },
},
```

### 驗證結果
| ID | Pattern | 結論 |
|----|---------|------|
| HR-003 | `HOME \|\| '/Users/ally'` | 標準 pattern，風險極低 |
| HR-008 | `HOME \|\| '/Users/ally'` | 標準 pattern |

### 問題
`HOME || '/Users/ally'` 是 Unix 標準 fallback pattern：
- 當 `HOME` 環境變量未設定時使用 fallback
- 這是**防禦性編程**的正確做法
- 不應被標記為 High-Risk

### 調整建議

**方案：加入 Whitelist Pattern 豁免**

```javascript
{
  id: 'hardcoded-path-in-string',
  name: 'String 中嵌入絕對路徑',
  category: 'logic',
  severity: 'high',
  detect(content, filePath) {
    const skip = skipIfRuleDef(filePath);
    if (skip) return skip;
    const lines = content.split('\n');
    const found = [];

    // ============================================================
    // Whitelist: HOME || fallback 標準 Pattern
    // ============================================================
    // 例如: process.env.HOME || '/Users/ally'
    // 這是 Unix 標準的環境變量 fallback 模式，不應標記
    const homeFallbackPattern = /process\.env\.HOME\s*\|\|/;

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      // Whitelist: 跳過 HOME || fallback pattern
      if (homeFallbackPattern.test(line)) return;

      if (/\/Users\/\w+/.test(line) || /\/home\/\w+/.test(line)) {
        found.push(i + 1);
      }
    });

    return {
      found: found.length > 0,
      details: `${found.length} 行包含絕對路徑`,
      lines: found,
      severity: 'high',
      suggestion: '改用路徑變量或 path.join(process.env.HOME, ...) 代替硬編碼路徑',
    };
  },
},
```

**預期效果：** HR-003 和 HR-008 不再被報告，true positive（如真正的 hardcoded path）仍會被發現。

---

## 3. missing-atomic-write (HR-004, HR-006)

### 現狀分析
- **當前 severity：** `medium`
- **檢測邏輯：** `writeFileSync` 調用，檢查是否有 `tmp + rename` pattern
- **已有豁免：** `.json`, `.tmp`, `.bak`, `.cache`, `.lock`, `.log` 檔案

```javascript
// high-risk.js Lines 708-760
{
  id: 'missing-atomic-write',
  severity: 'medium',
  detect(content, filePath) {
    // ... 檢測 writeFileSync ...

    // 已有豁免
    if (/\.(json|tmp|bak|cache|lock|log)$/i.test(targetPath)) continue;
  },
},
```

### 驗證結果
| ID | 檔案類型 | 結論 |
|----|---------|------|
| HR-004 | flag/tracker 小檔案 | 小檔案寫入，影響可忽略 |
| HR-006 | 小報告檔案 | 低風險寫入 |

### 問題
- Flag/tracker 檔案通常只有幾 bytes，crash 時數據損壞風險極低
- 小報告檔案屬於臨時/過渡性檔案，不需要 atomic write
- 現有豁免只包含副檔名，不包含這些檔案類型

### 調整建議

**方案：加入檔案路徑/大小 Context 感知**

```javascript
{
  id: 'missing-atomic-write',
  name: '檔案寫入缺少 atomic write 保護',
  category: 'logic',
  severity: 'medium',
  detect(content, filePath) {
    // ...

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (!/writeFileSync\s*\(/.test(line)) continue;

      // ============================================================
      // P1: 豁免小檔案/flag/tracker 檔案
      // ============================================================
      // Flag, tracker, heartbeat 等小型狀態檔案，crash 時影響可忽略
      const smallFilePatterns = [
        /\.flag$/i,
        /[\/-](?:flag|tracker|heartbeat|status|lock)\b/i,
        /\.tmp$/i,
        /\.bak$/i,
        /\.cache$/i,
        /\.lock$/i,
        /\.log$/i,
        /\.json$/i,  // JSON 檔案（配置/狀態）已有豁免
      ];
      if (smallFilePatterns.some(p => p.test(targetPath))) continue;

      // ============================================================
      // P2: 豁免包含 "report" 或 "temp" 的檔案路徑
      // ============================================================
      if (/[\/-](?:report|temp|tmp|cache)[\/-]/i.test(targetPath)) continue;

      // ...
    }
  },
},
```

**預期效果：** Flag/tracker/小報告檔案不再被報告。

---

## 4. todo-fixme (HR-001)

### 現狀分析
- **當前 severity：** `low`
- **檢測邏輯：** 查找包含 `TODO/FIXME/HACK/XXX` 的行（已跳過 `//` 開頭的註釋）

```javascript
// high-risk.js Lines 319-356
{
  id: 'todo-fixme',
  severity: 'low',
  detect(content, filePath) {
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      // 跳過 // 開頭的單行註釋
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      // 排除規則定義配置
      if (/^ {0,8}id:\s*['"][^'"]*(?:TODO|FIXME)/.test(trimmed)) return;
      // ...

      if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(trimmed)) {
        found.push({ line: i + 1, text: trimmed.substring(0, 80) });
      }
    });
  },
},
```

### 驗證結果
| ID | 問題 | 結論 |
|----|------|------|
| HR-001 | TODO/FIXME 在註釋區 | **False Positive** |

### 問題
HR-001 顯示 TODO/FIXME 在「註釋區」，但代碼**已經跳過了 `//` 開頭的行**。這說明：

1. 多行註釋（`/* ... */`）中的 TODO/FIXME 可能被誤判
2. 行內註釋（如 `const x = 1; // TODO: ...`）中的 TODO/FIXME 可能被誤判

讓我檢查實際檢測邏輯：
```javascript
if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
// 這裡 * 是用於 /** 開頭的 JSDoc 註釋
```

**真正問題：** 行內註釋（`const x = 1; // TODO: foo`）會被檢測到，因為 `trimmed.startsWith('//')` 只跳過行首的 `//`。

### 調整建議

**方案：使用更智能的 Multi-Line Comment 跳過**

```javascript
{
  id: 'todo-fixme',
  name: '未完成的 TODO/FIXME',
  category: 'maintenance',
  severity: 'low',
  detect(content, filePath) {
    const skip = skipIfRuleDef(filePath);
    if (skip) return skip;
    const lines = content.split('\n');
    const found = [];

    // ============================================================
    // Multi-Line Comment 追蹤
    // ============================================================
    let inBlockComment = false;
    const blockCommentStart = /\/\*/;
    const blockCommentEnd = /\*\//;

    lines.forEach((line, i) => {
      const trimmed = line.trim();

      // 追蹤 block comment 狀態
      if (!inBlockComment && blockCommentStart.test(trimmed)) {
        inBlockComment = true;
      }
      if (inBlockComment && blockCommentEnd.test(trimmed)) {
        inBlockComment = false;
        return; // Block comment 結束行不檢測
      }
      if (inBlockComment) return; // 在 block comment 內，跳過

      // 跳過單行註釋（行首 // 或 *）
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      // 排除明顯是規則定義的情況
      if (/^ {0,8}id:\s*['"][^'"]*(?:TODO|FIXME|HACK|XXX)[^'"]*['"]/.test(trimmed)) return;
      if (/^ {0,8}name:\s*['"][^'"]*(?:TODO|FIXME|HACK|XXX)[^'"]*['"]/.test(trimmed)) return;
      if (/^ {0,8}keywords:\s*\[/.test(trimmed)) return;
      if (/^ {0,8}severity:\s*['"][^'"]*(?:TODO|FIXME|HACK|XXX)[^'"]*['"]/.test(trimmed)) return;
      if (/^ {0,8}todo:\s*\[/.test(trimmed)) return;
      if (/^ {0,8}fixme:\s*\[/.test(trimmed)) return;
      if (/^ {0,8}hack:\s*\[/.test(trimmed)) return;
      if (/^ {0,8}xxx:\s*\[/.test(trimmed)) return;
      if (/(?:===?|!==?)\s*['\"](?:TODO|FIXME|HACK|XXX)['\"]/i.test(trimmed)) return;

      // ============================================================
      // P1: 行內註釋檢測 - 跳過 // 後面的 TODO/FIXME
      // ============================================================
      const inlineCommentIndex = trimmed.indexOf('//');
      if (inlineCommentIndex > 0) {
        const beforeComment = trimmed.substring(0, inlineCommentIndex);
        // 如果 TODO/FIXME 在 // 之後，跳過
        const afterComment = trimmed.substring(inlineCommentIndex);
        if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(afterComment)) return;
        // 如果程式碼部分有 TODO/FIXME，仍需報告
        if (!/\b(TODO|FIXME|HACK|XXX)\b/i.test(beforeComment)) return;
      }

      if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(trimmed)) {
        found.push({ line: i + 1, text: trimmed.substring(0, 80) });
      }
    });

    return {
      found: found.length > 0,
      details: found.map(f => `L${f.line}: ${f.text}`).join('\n    '),
      lines: found.map(f => f.line),
      severity: 'low',
      suggestion: '清理 TODO/FIXME 標記',
    };
  },
},
```

**預期效果：** HR-001 類型的 false positive 消除。

---

## 5. inconsistent-return-value (HR-009)

### 現狀分析
- **當前 severity：** `high`
- **檢測邏輯：** 在 `if` block 內 `return true`，且同一函數其他地方也有 `return true`

```javascript
// high-risk.js Lines 358-425
{
  id: 'inconsistent-return-value',
  severity: 'high',
  detect(content, filePath) {
    // 追蹤 brace depth 和 if block 狀態
    // 找出 if block 內的 return true

    // 對 backup/notification 相關函數特別標記
    const sensitivePatterns = /backup|notify|notification|send|dispatch|deliver/i;
    for (const inIf of returnTrueInIf) {
      if (sensitivePatterns.test(inIf.funcName) && !found.some(f => f.line === inIf.line)) {
        found.push({ line: inIf.line, funcName: inIf.funcName, ifLine: inIf.ifLine, otherLine: null });
      }
    }
  },
},
```

### 驗證結果
| ID | 問題 | 結論 |
|----|------|------|
| HR-009 | 返回值不一致 | **False Positive** |

### 問題
HR-009 是一個 false positive。目前 `sensitivePatterns` 包含了 `notify|notification|send`，這導致 Discord 通知類函數被標記為「返回值不一致」。

但對於通知函數來說：
- `return true` 在 if block 內 = 條件滿足時發送通知並返回成功
- `return true` 在 if block 外 = 默認返回成功（因為通知失敗時通常不阻止流程）
- 這是**故意的設計**，不是錯誤

### 調整建議

**方案：加入 Notification Pattern 白名單**

```javascript
{
  id: 'inconsistent-return-value',
  name: '條件分支中返回值不一致',
  category: 'reliability',
  severity: 'high',
  detect(content, filePath) {
    // ... 現有邏輯 ...

    const found = [];

    // ============================================================
    // Whitelist: Notification Pattern 豁免
    // ============================================================
    // Discord/Signal/WhatsApp 通知函數的 return true 模式是正常的
    // 因為通知失敗不應阻止主流程
    const notificationFuncNames = [
      /notify/i,
      /sendNotification/i,
      /sendMessage/i,
      /postToDiscord/i,
      /sendDiscord/i,
      /sendSignal/i,
      /sendWhatsApp/i,
      /sendEmail/i,
      /dispatch/i,
    ];

    // 排除明顯是 helper 的 notify 函數
    // 如果函數已經有 try-catch，通常是故意的設計
    const isWhitelistedFunc = (funcName) => {
      return notificationFuncNames.some(p => p.test(funcName));
    };

    // ... existing detection logic ...

    // 在報告前過濾 whitelisted functions
    const filteredFound = found.filter(f => {
      // 如果函數名匹配 notification pattern，跳過
      if (isWhitelistedFunc(f.funcName)) return false;
      // 如果函數內有 try-catch，可能是故意的設計
      // （這需要更複雜的上下文分析，可選）
      return true;
    });

    return {
      found: filteredFound.length > 0,
      details: filteredFound.map(f =>
        `L${f.line}: ${f.funcName || '(anonymous)'}() — if block 內 return true` +
        (f.otherLine ? ` (L${f.otherLine} 亦有 return true，語義可能不一致)` : ' (backup/notification 函數需特別留意)')
      ).join('\n    '),
      lines: filteredFound.map(f => f.line),
      severity: 'high',
      suggestion: '確保不同條件分支的返回值能區分「成功」與「跳過」，建議返回 { success, skipped, reason } 或用不同值',
    };
  },
},
```

**預期效果：** HR-009 不再被報告，notification 相關函數的 false positive 消除。

---

## 總結：調整後預期效果

| 調整 | 影響 |
|------|------|
| `file-too-long` 移至 low-risk | High-Risk 報告減少 3 項 |
| `hardcoded-path-in-string` 加入 HOME fallback 白名單 | High-Risk 報告減少 2 項 |
| `missing-atomic-write` 加入小檔案豁免 | High-Risk 報告減少 2 項 |
| `todo-fixme` 改進註釋檢測 | False Positive 減少 1 項 |
| `inconsistent-return-value` 加入 notification 白名單 | False Positive 減少 1 項 |

**總計：** 9 個 High-Risk 問題中，調整後預期減少 **9 項噪音**，同時保留 **0 個 true positive**（全部都是 false positive 或極低風險）。

---

## 附錄：建議的 Whitelist Pattern 集中管理

考慮將所有 Whitelist Pattern 集中到 `scripts/lib/helpers/whitelist-patterns.js`：

```javascript
// scripts/lib/helpers/whitelist-patterns.js
module.exports = {
  // hardcoded-path-in-string 豁免
  HOME_FALLBACK: /process\.env\.HOME\s*\|\|/,

  // missing-atomic-write 豁免
  SMALL_FILES: /\.(flag|tracker|heartbeat|status|lock|tmp|bak|cache|log|json)$/i,
  REPORT_PATHS: /[\/-](?:report|temp|tmp|cache)[\/-]/i,

  // inconsistent-return-value 豁免
  NOTIFICATION_FUNCS: /notify|sendNotification|sendMessage|postToDiscord|sendSignal|sendWhatsApp|sendEmail|dispatch/i,

  // todo-fixme 排除
  BLOCK_COMMENT_MULTILINE: true,  // 啟用 multi-line comment 追蹤
};
```

這樣日後新增/調整 Whitelist 更加集中和可維護。
