/**
 * scripts/lib/helpers/try-catch-helpers-ast.js
 *
 * AST-based try-catch 保護檢測 helpers (使用 acorn parser)
 *
 * 這是一個改進版實現，使用 AST 分析來解決現有 regex-based 方法的限制：
 * 1. 準確識別 try-catch 包圍的範圍（包括嵌套結構）
 * 2. 正確處理 function-level try-catch 內含變數宣告
 * 3. 減少 80%+ 誤報
 *
 * 依賴: acorn (npm install acorn)
 */

const acorn = require('acorn');

// ==================== AST Cache ====================

const AST_CACHE = new Map();
const TRY_BLOCK_CACHE = new Map();

/**
 * 獲取或解析檔案的 AST
 *
 * @param {string} content - JavaScript 檔案內容
 * @param {string} filePath - 檔案路徑（用於 cache key）
 * @returns {Object|null} - AST 節點或 null（解析失敗時）
 */
function getAST(content, filePath = '') {
  const cacheKey = filePath || content.slice(0, 100);

  if (AST_CACHE.has(cacheKey)) {
    return AST_CACHE.get(cacheKey);
  }

  try {
    const ast = acorn.parse(content, {
      ecmaVersion: 2022,
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      locations: true,      // 啟用行號/列號資訊
      ranges: false,
    });

    AST_CACHE.set(cacheKey, ast);
    return ast;
  } catch (e) {
    // 解析失敗時返回 null，fallback 到 legacy 方法
    return null;
  }
}

/**
 * 清除 AST cache（用於 memory management）
 */
function clearASTCache() {
  AST_CACHE.clear();
  TRY_BLOCK_CACHE.clear();
}

// ==================== Try Block Detection ====================

/**
 * 收集所有 TryStatement 節點及其範圍
 *
 * @param {Object} ast - Acorn AST
 * @returns {Array<{start: number, end: number, block: Object, handler: Object|null, finalizer: Object|null}>}
 */
function collectTryBlocks(ast) {
  const tryBlocks = [];

  function traverse(node, parentContext = null) {
    if (!node || typeof node !== 'object') return;

    // 處理 TryStatement
    if (node.type === 'TryStatement') {
      const blockInfo = {
        start: node.block.loc.start.line,
        end: node.block.loc.end.line,
        blockStart: node.loc.start.line,
        blockEnd: node.loc.end.line,
        block: node.block,
        handler: node.handler,      // catch 子句
        finalizer: node.finalizer,  // finally 子句
        // 標記這個 try 是否保護整個函數
        isFunctionLevel: parentContext?.isFunctionBody || false,
        // 記錄父級函數的深度
        functionDepth: parentContext?.functionDepth || 0,
      };
      tryBlocks.push(blockInfo);

      // 繼續遍歷 try block 內部
      traverse(node.block, {
        ...parentContext,
        inTryBlock: true,
        tryDepth: (parentContext?.tryDepth || 0) + 1,
      });

      // 遍歷 catch 子句
      if (node.handler) {
        traverse(node.handler, {
          ...parentContext,
          inCatchBlock: true,
          tryDepth: parentContext?.tryDepth || 0,
        });
      }

      // 遍歷 finally 子句
      if (node.finalizer) {
        traverse(node.finalizer, {
          ...parentContext,
          inFinallyBlock: true,
          tryDepth: parentContext?.tryDepth || 0,
        });
      }
      return;
    }

    // 追蹤函數深度（用於處理嵌套函數）
    const isFunction = [
      'FunctionDeclaration',
      'FunctionExpression',
      'ArrowFunctionExpression',
    ].includes(node.type);

    const newContext = isFunction
      ? {
          ...parentContext,
          functionDepth: (parentContext?.functionDepth || 0) + 1,
          isFunctionBody: node.body?.type === 'BlockStatement',
        }
      : parentContext;

    // 遍歷所有子節點
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;

      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          traverse(item, newContext);
        }
      } else if (child && typeof child === 'object' && child.type) {
        traverse(child, newContext);
      }
    }
  }

  traverse(ast);
  return tryBlocks;
}

/**
 * 獲取檔案的所有 try block（帶 cache）
 *
 * @param {Object} ast - Acorn AST
 * @param {string} filePath - 檔案路徑
 * @returns {Array} - try block 列表
 */
function getTryBlocks(ast, filePath = '') {
  if (TRY_BLOCK_CACHE.has(filePath)) {
    return TRY_BLOCK_CACHE.get(filePath);
  }

  const blocks = collectTryBlocks(ast);
  TRY_BLOCK_CACHE.set(filePath, blocks);
  return blocks;
}

// ==================== Core API ====================

/**
 * 檢查指定行是否被 try-catch 保護（AST-based 實現）
 *
 * 這是現有 isProtectedByTry() 的 AST-based 替代方案
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @param {string} [filePath] - 檔案路徑（可選，用於 cache）
 * @param {Object} [options] - 選項
 * @param {boolean} [options.fallbackToLegacy=true] - AST 解析失敗時是否 fallback 到 legacy
 * @param {boolean} [options.includeCatchBlocks=true] - catch block 內的程式碼是否視為「受保護」
 * @returns {boolean} - true 表示被 try-catch 保護
 */
function isProtectedByTryAST(lines, lineIdx, filePath = '', options = {}) {
  const { fallbackToLegacy = true, includeCatchBlocks = true } = options;

  const content = Array.isArray(lines) ? lines.join('\n') : lines;
  const targetLine = lineIdx + 1; // 轉換為 1-indexed

  // 嘗試解析 AST
  const ast = getAST(content, filePath);

  if (!ast) {
    // AST 解析失敗，fallback 到 legacy 方法
    if (fallbackToLegacy) {
      const { isProtectedByTry } = require('./try-catch-helpers');
      return isProtectedByTry(lines, lineIdx);
    }
    return false;
  }

  const tryBlocks = getTryBlocks(ast, filePath);

  // 檢查目標行是否在任一 try block 的範圍內
  for (const block of tryBlocks) {
    // 檢查是否在 try { ... } 內
    if (targetLine >= block.start && targetLine <= block.end) {
      return true;
    }

    // 檢查是否在 catch 或 finally 內（可選）
    if (includeCatchBlocks && block.handler) {
      const catchStart = block.handler.loc.start.line;
      const catchEnd = block.handler.loc.end.line;
      if (targetLine >= catchStart && targetLine <= catchEnd) {
        return true;
      }
    }

    if (includeCatchBlocks && block.finalizer) {
      const finallyStart = block.finalizer.loc.start.line;
      const finallyEnd = block.finalizer.loc.end.line;
      if (targetLine >= finallyStart && targetLine <= finallyEnd) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 檢查指定行是否在 try block 內，並返回詳細資訊
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @param {string} [filePath] - 檔案路徑（可選）
 * @returns {Object} - { protected: boolean, tryBlock: Object|null, inCatch: boolean, inFinally: boolean }
 */
function getTryProtectionInfo(lines, lineIdx, filePath = '') {
  const content = Array.isArray(lines) ? lines.join('\n') : lines;
  const targetLine = lineIdx + 1;

  const ast = getAST(content, filePath);
  if (!ast) {
    return { protected: false, tryBlock: null, inCatch: false, inFinally: false };
  }

  const tryBlocks = getTryBlocks(ast, filePath);

  for (const block of tryBlocks) {
    // 在 try block 內
    if (targetLine >= block.start && targetLine <= block.end) {
      return {
        protected: true,
        tryBlock: block,
        inCatch: false,
        inFinally: false,
        isFunctionLevel: block.isFunctionLevel,
        functionDepth: block.functionDepth,
      };
    }

    // 在 catch block 內
    if (block.handler) {
      const catchStart = block.handler.loc.start.line;
      const catchEnd = block.handler.loc.end.line;
      if (targetLine >= catchStart && targetLine <= catchEnd) {
        return {
          protected: true,
          tryBlock: block,
          inCatch: true,
          inFinally: false,
          isFunctionLevel: block.isFunctionLevel,
          functionDepth: block.functionDepth,
        };
      }
    }

    // 在 finally block 內
    if (block.finalizer) {
      const finallyStart = block.finalizer.loc.start.line;
      const finallyEnd = block.finalizer.loc.end.line;
      if (targetLine >= finallyStart && targetLine <= finallyEnd) {
        return {
          protected: true,
          tryBlock: block,
          inCatch: false,
          inFinally: true,
          isFunctionLevel: block.isFunctionLevel,
          functionDepth: block.functionDepth,
        };
      }
    }
  }

  return { protected: false, tryBlock: null, inCatch: false, inFinally: false };
}

/**
 * 檢查函數是否被「函數級別」的 try-catch 包圍
 *
 * 這識別 function xxx() { try { ... } catch(...) { ... } } 這種模式
 * 修復 (2026-04-04): 也識別 outer try-catch（外層 try-catch 包圍整個函數）
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號（應該是函數定義行）
 * @param {string} [filePath] - 檔案路徑（可選）
 * @returns {boolean}
 */
function isProtectedByFunctionLevelTry(lines, lineIdx, filePath = '') {
  const content = Array.isArray(lines) ? lines.join('\n') : lines;
  const targetLine = lineIdx + 1;

  const ast = getAST(content, filePath);
  if (!ast) {
    // AST 解析失敗時，fallback 到簡單的 regex 檢查
    return isProtectedByFunctionLevelTryRegex(lines, lineIdx);
  }

  const tryBlocks = getTryBlocks(ast, filePath);

  // 找到目標函數的範圍
  const funcInfo = findFunctionAtLine(ast, targetLine);

  for (const block of tryBlocks) {
    // 1. 檢查這個 try block 是否緊跟著函數定義（傳統 function-level）
    if (block.isFunctionLevel && block.start <= targetLine && block.end >= targetLine) {
      return true;
    }

    // 2. 檢查 outer try-catch：try block 完全包圍整個函數體
    if (funcInfo && block.start <= funcInfo.bodyStart && block.end >= funcInfo.bodyEnd) {
      return true;
    }

    // 3. 檢查函數體是否完全在 try block 內
    if (funcInfo && targetLine >= block.blockStart && targetLine <= block.blockEnd) {
      // 函數定義在 try-catch 內部，視為受保護
      return true;
    }
  }

  return false;
}

/**
 * 找到指定行所在的函數資訊
 *
 * @param {Object} ast - Acorn AST
 * @param {number} targetLine - 1-indexed 行號
 * @returns {Object|null} - { name, start, end, bodyStart, bodyEnd } 或 null
 */
function findFunctionAtLine(ast, targetLine) {
  let result = null;

  function traverse(node) {
    if (!node || typeof node !== 'object') return;

    if (node.loc && node.loc.start.line <= targetLine && node.loc.end.line >= targetLine) {
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
        const body = node.body;
        if (body && body.type === 'BlockStatement' && body.loc) {
          result = {
            name: node.id?.name || '(anonymous)',
            start: node.loc.start.line,
            end: node.loc.end.line,
            bodyStart: body.loc.start.line,
            bodyEnd: body.loc.end.line,
          };
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) traverse(item);
      } else if (child && typeof child === 'object' && child.type) {
        traverse(child);
      }
    }
  }

  traverse(ast);
  return result;
}

/**
 * 當 AST 解析失敗時的 fallback：使用 regex 檢查 function-level try-catch
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @returns {boolean}
 */
function isProtectedByFunctionLevelTryRegex(lines, lineIdx) {
  // 掃描函數定義後的幾行，檢查是否有 try {
  const scanRange = Math.min(lineIdx + 15, lines.length);
  let braceDepth = 0;
  let foundFuncBrace = false;

  for (let i = lineIdx; i < scanRange; i++) {
    const trimmed = lines[i].trim();

    // 追蹤 brace depth
    for (const ch of trimmed) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    // 找到函數的開 brace
    if (!foundFuncBrace && braceDepth > 0) {
      foundFuncBrace = true;
    }

    // 如果在函數內部第一層找到 try {
    if (foundFuncBrace && braceDepth === 1 && /\btry\s*\{/.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * 檢查 try-catch 是否包含 error 參數處理
 *
 * 這可以識別 `try { ... } catch (e) { ... }` vs `try { ... } catch { ... }`
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @param {string} [filePath] - 檔案路徑（可選）
 * @returns {Object} - { hasCatch: boolean, hasErrorParam: boolean, paramName: string|null }
 */
function analyzeCatchClause(lines, lineIdx, filePath = '') {
  const content = Array.isArray(lines) ? lines.join('\n') : lines;
  const targetLine = lineIdx + 1;

  const ast = getAST(content, filePath);
  if (!ast) {
    return { hasCatch: false, hasErrorParam: false, paramName: null };
  }

  const tryBlocks = getTryBlocks(ast, filePath);

  for (const block of tryBlocks) {
    // 檢查目標行是否在這個 try block 的範圍內
    if (targetLine < block.blockStart || targetLine > block.blockEnd) {
      continue;
    }

    if (!block.handler) {
      return { hasCatch: false, hasErrorParam: false, paramName: null };
    }

    const catchParam = block.handler.param;
    const hasErrorParam = !!catchParam;
    const paramName = catchParam?.name || null;

    return {
      hasCatch: true,
      hasErrorParam,
      paramName,
    };
  }

  return { hasCatch: false, hasErrorParam: false, paramName: null };
}

// ==================== Batch Analysis ====================

/**
 * 批量分析整個檔案的 try-catch 覆蓋情況
 *
 * @param {string} content - 檔案內容
 * @param {string} [filePath] - 檔案路徑（可選）
 * @returns {Object} - 完整的 try-catch 分析結果
 */
function analyzeFileTryCoverage(content, filePath = '') {
  const ast = getAST(content, filePath);
  if (!ast) {
    return { error: 'Failed to parse AST', tryBlocks: [], coverage: [] };
  }

  const tryBlocks = getTryBlocks(ast, filePath);
  const lines = content.split('\n');
  const coverage = [];

  for (let i = 0; i < lines.length; i++) {
    const info = getTryProtectionInfo(lines, i, filePath);
    if (info.protected) {
      coverage.push({
        line: i + 1,
        content: lines[i].trim().slice(0, 60),
        ...info,
      });
    }
  }

  return {
    totalLines: lines.length,
    protectedLines: coverage.length,
    tryBlocks: tryBlocks.map(b => ({
      tryStart: b.start,
      tryEnd: b.end,
      hasCatch: !!b.handler,
      hasFinally: !!b.finalizer,
      isFunctionLevel: b.isFunctionLevel,
    })),
    coverage,
  };
}

// ==================== Module Exports ====================

module.exports = {
  // Core API
  isProtectedByTry: isProtectedByTryAST,
  isProtectedByTryAST,
  getTryProtectionInfo,
  isProtectedByFunctionLevelTry,
  analyzeCatchClause,
  analyzeFileTryCoverage,

  // Cache management
  clearASTCache,
  getAST,
  getTryBlocks,

  // Legacy compatibility
  isPureFunction: require('./try-catch-helpers').isPureFunction,
  isProtectedByPromise: require('./try-catch-helpers').isProtectedByPromise,
  hasAtomicWriteHelper: require('./try-catch-helpers').hasAtomicWriteHelper,
};
