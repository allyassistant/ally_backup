/**
 * Context-Aware Audit Helpers
 *
 * 提供上下文感知的安全檢測功能
 * 用於減少 Pure AI Audit 的 False Positives
 */

const {
  SAFE_CONTEXTS,
  DANGER_SIGNALS,
  SAFE_HELPERS,
  hasDangerSignal,
  isSafeHelper,
} = require('./whitelist_patterns');

// ============================================================
// 1. 上下文分析函數
// ============================================================

/**
 * 分析檔案操作的上下文
 *
 * @param {string[]} lines - 檔案所有行
 * @param {number} lineIdx - 當前行索引 (0-based)
 * @param {string} operation - 操作類型 (e.g., 'readFileSync')
 * @returns {Object} - 上下文分析結果
 */
function analyzeContext(lines, lineIdx, operation) {
  const currentLine = lines[lineIdx];
  const result = {
    isSafe: false,
    reason: null,
    severity: null,
    action: null,
  };

  // 檢查是否有危險信號
  if (hasDangerSignal(currentLine)) {
    return {
      ...result,
      isSafe: false,
      reason: '包含用戶輸入或動態路徑，需要錯誤處理',
      severity: 'high',
    };
  }

  // 檢查是否為安全 helper 調用
  if (isSafeHelper(currentLine)) {
    return {
      ...result,
      isSafe: true,
      reason: '使用已知安全的 wrapper 函數',
      action: 'skip',
    };
  }

  // 檢查是否匹配安全上下文
  const safeContext = findSafeContext(lines, lineIdx, operation);
  if (safeContext) {
    return {
      ...result,
      isSafe: true,
      reason: safeContext.action.reason,
      action: safeContext.action.type,
      severity: safeContext.action.to || null,
    };
  }

  // 檢查是否為簡單的資源讀取
  if (isSimpleResourceRead(lines, lineIdx)) {
    return {
      ...result,
      isSafe: true,
      reason: '簡單的內部資源讀取',
      action: 'reduce_severity',
      severity: 'info',
    };
  }

  return result;
}

/**
 * 查找安全上下文
 */
function findSafeContext(lines, lineIdx, operation) {
  for (const [name, context] of Object.entries(SAFE_CONTEXTS)) {
    // 檢查操作是否匹配
    const operationMatches = context.operations.some(p => p.test(operation));
    if (!operationMatches) continue;

    // 檢查前後文指示器
    const contextWindow = 5; // 前後各 5 行
    const startIdx = Math.max(0, lineIdx - contextWindow);
    const endIdx = Math.min(lines.length, lineIdx + contextWindow + 1);
    const contextLines = lines.slice(startIdx, endIdx);

    // 檢查 before 指示器
    const beforeLines = lines.slice(startIdx, lineIdx);
    const hasBeforeIndicator = context.indicators.before?.some(
      p => beforeLines.some(l => p.test(l))
    );

    // 檢查 sameLine 指示器
    const hasSameLineIndicator = context.indicators.sameLine?.some(
      p => p.test(lines[lineIdx])
    );

    // 檢查 after 指示器
    const afterLines = lines.slice(lineIdx + 1, endIdx);
    const hasAfterIndicator = context.indicators.after?.some(
      p => afterLines.some(l => p.test(l))
    );

    if (hasBeforeIndicator || hasSameLineIndicator || hasAfterIndicator) {
      return { name, action: context.action };
    }
  }

  return null;
}

/**
 * 檢查是否為簡單的資源讀取
 */
function isSimpleResourceRead(lines, lineIdx) {
  const line = lines[lineIdx];

  // 檢查是否為常量路徑讀取
  const constantPathPatterns = [
    /readFileSync\s*\(\s*['"][^'"{]+['"]\s*\)/,  // 無變量的字符串路徑
    /readFileSync\s*\(\s*path\.join\s*\([^)]+\)\s*\)/,  // path.join
    /readFileSync\s*\(\s*__dirname[^)]*\)/,  // __dirname
  ];

  if (!constantPathPatterns.some(p => p.test(line))) {
    return false;
  }

  // 檢查是否為模板/資源檔案
  const resourceIndicators = [
    /template/i,
    /\.md['"\s]/i,
    /\.txt['"\s]/i,
    /\.html['"\s]/i,
    /resource/i,
    /asset/i,
  ];

  if (resourceIndicators.some(p => p.test(line))) {
    return true;
  }

  // 檢查是否在 getter/parser 函數中
  const funcContext = getFunctionContext(lines, lineIdx);
  if (funcContext) {
    const safeFuncPatterns = [
      /get[A-Z]\w+/,
      /load[A-Z]\w+/,
      /parse[A-Z]\w+/,
      /read[A-Z]\w+/,
      /fetch[A-Z]\w+/,
    ];
    if (safeFuncPatterns.some(p => p.test(funcContext.name))) {
      return true;
    }
  }

  return false;
}

/**
 * 獲取函數上下文
 */
function getFunctionContext(lines, lineIdx) {
  // 向前搜索函數定義
  for (let i = lineIdx; i >= 0; i--) {
    const line = lines[i];

    // 匹配函數定義
    const funcMatch = line.match(
      /(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/
    );

    if (funcMatch) {
      return {
        name: funcMatch[1] || funcMatch[2],
        line: i + 1,
      };
    }
  }

  return null;
}

// ============================================================
// 2. 特定操作檢測函數
// ============================================================

/**
 * 檢查 readFileSync 操作是否需要錯誤處理
 */
function shouldRequireTryCatchForReadFile(lines, lineIdx) {
  const line = lines[lineIdx];
  const context = analyzeContext(lines, lineIdx, 'readFileSync');

  // 如果有危險信號，需要 try-catch
  if (hasDangerSignal(line)) {
    return { required: true, severity: 'high' };
  }

  // 如果在安全上下文中，降低嚴重性
  if (context.isSafe) {
    if (context.action === 'skip') {
      return { required: false };
    }
    return {
      required: false,
      severity: context.severity || 'info',
      reason: context.reason,
    };
  }

  // 預設：讀取檔案風險較低
  return { required: false, severity: 'low' };
}

/**
 * 檢查 mkdirSync 操作是否需要錯誤處理
 */
function shouldRequireTryCatchForMkdir(lines, lineIdx) {
  const line = lines[lineIdx];

  // 檢查是否為 ensure directory 模式
  const prevLines = lines.slice(Math.max(0, lineIdx - 3), lineIdx);
  const hasExistsCheck = prevLines.some(l =>
    /existsSync\s*\(/.test(l) || /!\s*\w+Exists/.test(l)
  );
  const hasRecursive = /recursive\s*:\s*true/.test(line);

  if (hasExistsCheck && hasRecursive) {
    return {
      required: false,
      reason: '標準的 ensure directory 模式',
    };
  }

  // 檢查是否在 ensure/init 函數中
  const funcContext = getFunctionContext(lines, lineIdx);
  if (funcContext && /^(ensure|init)\w*Dir/.test(funcContext.name)) {
    return {
      required: false,
      reason: '在 ensure directory 函數中',
    };
  }

  // 如果有 recursive: true，風險較低
  if (hasRecursive) {
    return {
      required: false,
      severity: 'info',
      reason: '使用 recursive 選項，風險較低',
    };
  }

  return { required: true, severity: 'medium' };
}

/**
 * 檢查 readdirSync 操作是否需要錯誤處理
 */
function shouldRequireTryCatchForReaddir(lines, lineIdx) {
  const line = lines[lineIdx];

  // 檢查是否有危險信號
  if (hasDangerSignal(line)) {
    return { required: true, severity: 'high' };
  }

  // 檢查是否掃描內部目錄
  const internalDirPatterns = [
    /SCRIPTS_DIR/,
    /STATE_DIR/,
    /WS\s*[),]/,
    /__dirname/,
    /CONFIG\./,
    /['"]\.\/\w+['"]/,  // './xxx'
    /['"]\.\.\/\w+['"]/,  // '../xxx'
  ];

  if (internalDirPatterns.some(p => p.test(line))) {
    return {
      required: false,
      severity: 'info',
      reason: '掃描專案內部目錄',
    };
  }

  // 檢查是否在檔案掃描函數中
  const funcContext = getFunctionContext(lines, lineIdx);
  if (funcContext) {
    const scanPatterns = [/scan/, /walk/, /collect/, /list/, /getFiles/];
    if (scanPatterns.some(p => p.test(funcContext.name))) {
      return {
        required: false,
        severity: 'info',
        reason: '在檔案掃描函數中',
      };
    }
  }

  return { required: false, severity: 'low' };
}

// ============================================================
// 3. 嚴重性調整函數
// ============================================================

/**
 * 根據上下文調整問題嚴重性
 */
function adjustSeverity(issue, lines, filePath) {
  const { operation, line: lineIdx } = issue;

  let result;
  switch (operation) {
    case 'readFileSync':
      result = shouldRequireTryCatchForReadFile(lines, lineIdx - 1);
      break;
    case 'mkdirSync':
      result = shouldRequireTryCatchForMkdir(lines, lineIdx - 1);
      break;
    case 'readdirSync':
      result = shouldRequireTryCatchForReaddir(lines, lineIdx - 1);
      break;
    default:
      return issue;
  }

  // 如果需要跳過，返回 null
  if (result.required === false && !result.severity) {
    return null;
  }

  // 更新嚴重性
  return {
    ...issue,
    severity: result.severity || issue.severity,
    details: result.reason
      ? `${issue.details} (${result.reason})`
      : issue.details,
  };
}

// ============================================================
// 4. 導出
// ============================================================

module.exports = {
  // 主要函數
  analyzeContext,
  adjustSeverity,

  // 特定操作檢測
  shouldRequireTryCatchForReadFile,
  shouldRequireTryCatchForMkdir,
  shouldRequireTryCatchForReaddir,

  // 輔助函數
  findSafeContext,
  isSimpleResourceRead,
  getFunctionContext,

  // 常量
  SAFE_CONTEXTS,
  DANGER_SIGNALS,
};
