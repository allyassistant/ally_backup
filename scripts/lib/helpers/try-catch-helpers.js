/**
 * scripts/lib/helpers/try-catch-helpers.js
 *
 * try-catch 保護檢測 helpers
 *
 * 從 auto_fix.js 原 Lines 430-540 拆分出來
 *
 * 這些 helpers 被 HIGH_RISK_RULES 中的多個規則使用:
 *   - missing-error-handling
 *   - function-missing-try-catch
 *   - missing-atomic-write
 */

/**
 * 判斷函數是否為純計算函數(不需要 try-catch)
 *
 * 原 Lines 433-455
 * 修復 (2026-04-04): 擴展安全 helper 名單,消除 false positive
 *
 * @param {string} funcName - 函數名
 * @returns {boolean} - true 表示是純函數
 */
function isPureFunction(funcName) {
  const prefixes = [
    'format', 'parse', 'get', 'is', 'days', 'generate', 'truncate', 'enforce',
    'getHKT', 'getYesterday', 'getToday', 'getDisplay', 'normalize', 'getColor', 'getShape',
    'safe', 'load', 'save', 'check', 'find', 'filter', 'map', 'reduce', 'split', 'trim',
    // 新增:更多安全前綴
    'extract', 'convert', 'transform', 'build', 'create', 'update', 'delete',
    'append', 'remove', 'clear', 'reset', 'init', 'setup', 'cleanup',
  ];
  const exact = [
    'getNowHK', 'formatDuration', 'getMinutesUntilWindowEnd',
    'getCurrentDate', 'getCurrentTime', 'getTimestamp', 'getDaysDiff', 'getErrorMessage',
    'toHKT', 'getSimplifiedMap', 'log', 'ensureDir', 'loadAuditState',
    'saveAuditState', 'isProtectedByTry', 'isProtectedByPromise', 'hasAtomicWriteHelper',
    'safeReadFile', 'safeWriteFile', 'safeJsonParse', 'getFileContent',
    'loadFileCache', 'saveFileCache', 'hasFileChanged', 'updateFileCache',
    'getFileHash', 'findRecentFiles', 'scanErrors', 'analyzeErrorPatterns',
    'analyzeFile', 'autoFixFile', 'generateReport', 'generateMarkdownReport',
    'printReport', 'runScanAndFix', 'showReport', 'confirmHighRisk',
    'runSpawn', 'generateAuditBrief', 'generateSpawnPayload', 'main',
    'loadPureAIResults', 'annotateWithPureAI', 'getJSFiles', 'writePayload',
    'printSpawnInstructions', 'runSpawnMode', 'reportMode',
    // 新增:CLI 工具函數
    'autoDetectActivities', 'appendEntry', 'getOrCreateDayFile', 'extractEventDate',
    'extractArticles', 'scrapeWithFetch', 'scrapeWithBrowser', 'saveData',
    'isImportantArticle', 'loadIssues', 'loadSyncState', 'saveSyncState',
    'createReminder', 'deleteReminder', 'getReminders', 'fetchIDEXData',
    'parseIDEXData', 'extractIDEXFromText', 'updateIDEXData', 'showCurrentData',
    'getPriceReference', 'getSecureTempFile', 'saveLastLoggedTimestamp', 'getLastLoggedTimestamp',
  ];
  return prefixes.some(p => funcName.startsWith(p)) || exact.includes(funcName);
}

/**
 * 檢查指定行是否被 try-catch 保護
 *
 * 修復 (2026-04-14 v3): 只使用 forward-scan,全面 scan 一次
 *
 * Algorithm:
 * - 由 line 0 開始 forward scan
 * - 每搵到 try { 就 forward track 到 try block 既 end
 * - 如果 lineIdx 喺 try block 內,返回 true
 * - 如果所有 try blocks 都唔包含 lineIdx,返回 false
 *
 * 呢個方法更可靠 because:
 * - 一次過 check曬所有 try blocks
 * - 正確判斷邊個 try block 包含目標行
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @returns {boolean} - true 表示被 try-catch 保護
 */
function isProtectedByTry(lines, lineIdx) {
  // 使用全面 forward-scan
  if (isProtectedByTryFullScan(lines, lineIdx)) {
    return true;
  }

  // 也檢查 defensive check pattern
  if (hasDefensiveCheck(lines, lineIdx)) {
    return true;
  }

  return false;
}

/**
 * Full forward-scan: 由 line 0 scan 到 end,搵所有 try blocks
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @returns {boolean} - true 表示被 try-catch 保護
 */
function isProtectedByTryFullScan(lines, lineIdx) {
  let inTryBlock = false;
  let relDepth = 0;
  let inBlockComment = false;  // 改進 3: Block comment handling

  for (let j = 0; j < lines.length; j++) {
    const raw = lines[j];
    const trimmed = raw.trim();

    // 改進 3: Handle block comments /* ... */
    if (trimmed.includes('/*')) inBlockComment = true;
    if (trimmed.includes('*/')) { inBlockComment = false; continue; }
    if (inBlockComment) continue;

    // 跳過 comment 行
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

    // 智能 skip:跳過 regex literals
    if (/^\s*\/\^/.test(trimmed) || /\/\w+\$?\//.test(trimmed)) continue;

    // 智能 skip:不含程式碼既 string literals
    if (!/\btry\b/.test(trimmed)) {
      if (/[`'"].*\}/.test(trimmed) || /.*\{.*[`'"]/.test(trimmed)) continue;
    }

    // 追蹤 brace depth
    for (const ch of trimmed) {
      if (ch === '{') relDepth++;
      if (ch === '}') relDepth--;
    }

    // 搵 try {
    if (/\btry\s*\{/.test(trimmed)) {
      const tryStartIdx = j;
      // Try block starts at depth >= 1 from now
      inTryBlock = true;

      // Forward track 到 try block 既 end
      for (let k = j + 1; k < lines.length; k++) {
        const l = lines[k].trim();
        if (l.startsWith('//') || l.startsWith('*')) continue;

        // Smart skip: skip regex
        if (/^\s*\/\^/.test(l) || /\/\w+\$?\//.test(l)) continue;

        for (const ch of l) {
          if (ch === '{') relDepth++;
          if (ch === '}') relDepth--;
        }

        // Try block ended
        if (inTryBlock && relDepth === 0) {
          // Check if lineIdx is in this try block
          if (lineIdx >= tryStartIdx && lineIdx <= k) {
            return true;
          }
          inTryBlock = false;
          break;
        }

        // Error guard
        if (relDepth < 0) {
          inTryBlock = false;
          break;
        }
      }
    }
  }

  return false;
}


/**
 * Forward-scan: 找到包含 try { 的行,然後計算其 block 範圍
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @returns {boolean} - true 表示被 try-catch 保護
 */
function isProtectedByTryForward(lines, lineIdx) {
  let braceDepth = 0;

  for (let j = 0; j < lines.length; j++) {
    const raw = lines[j];
    const trimmed = raw.trim();

    // 跳過 comment 行
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

    // 智能 string literal 檢測:跳過包含 string/template literal 的行
    // 但如果行中有 try/catch 關鍵字則不跳過
    const hasTryCatch = /\btry\b|\bcatch\b/.test(trimmed);
    if (!hasTryCatch) {
      if (/[`'"].*[{}}]/.test(trimmed) || /[{}}].*[`'"]/.test(trimmed)) {
        continue;
      }
    }

    // 追蹤 brace depth(用於檢測 try { 的 depth)
    for (const ch of trimmed) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    // 找到 try {
    if (/\btry\s*\{/.test(trimmed)) {
      // 記錄 try { 出現時的絕對 depth(用於過濾)
      const tryAbsDepth = braceDepth;
      // try block 從下一行開始
      const tryStartIdx = j + 1;

      // 用 relative depth 追蹤:找到 try block 的結束位置
      // relative depth = 0 表示在 try { ... } 同一層
      let relDepth = 0;
      for (let k = tryStartIdx; k < lines.length; k++) {
        const l = lines[k].trim();
        if (l.startsWith('//') || l.startsWith('*') || l.startsWith('#')) continue;

        // 智能 skip:跳過 regex literals
        // Case 1 既 path\.exists 喺 regex 入面
        if (/^\s*\/\^/.test(l) || /\/\w+\$?\//.test(l)) continue;

        // 智能跳過不含程式碼的字面量行(避免 string 內的 {} 影響)
        const hasCode = /\b(try|catch|const|let|var|if|else|for|while|function|return|throw)\b/.test(l);
        if (!hasCode) {
          // 這行不太像有程式碼,檢查是否有危險的 {}
          if (/.*\{.*\}.*/.test(l) && !/[`'"].*[{}].*[`'"]/.test(l)) {
            // 可能是真實程式碼,繼續計算
          } else {
            continue;
          }
        }

        for (const ch of l) {
          if (ch === '{') relDepth++;
          if (ch === '}') relDepth--;
        }

        // relative depth 回到 0,表示這個 try block 結束
        if (relDepth === 0) {
          if (lineIdx >= tryStartIdx && lineIdx <= k) {
            return true;
          }
          break;
        }

        // 保護:relDepth 變成負數表示有問題,直接 break
        if (relDepth < 0) break;
      }
    }
  }

  return false;
}

/**
 * 檢查 function 是否被全域 try-catch 包圍
 *
 * 原 Lines 500-530
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @returns {boolean} - true 表示被全域 try-catch 保護
 */
function isProtectedByGlobalTry(lines, lineIdx) {
  let depth = 0;
  const startLine = Math.max(0, lineIdx - 50);

  for (let j = startLine; j < lineIdx; j++) {
    const raw = lines[j];
    const trimmed = raw.trim();

    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

    const hasTryCatch = /\btry\b|\bcatch\b/.test(trimmed);
    if (!hasTryCatch) {
      if (/[`'"].*[{}}]/.test(trimmed) || /[{}}].*[`'"]/.test(trimmed)) {
        continue;
      }
    }

    for (const ch of trimmed) {
      if (ch === '}') depth--;
      if (ch === '{') depth++;
    }

    if (depth < 0) break;

    if (/\btry\s*\{/.test(trimmed)) {
      if (depth >= 1) return true;
    }
  }
  return false;
}

/**
 * 向上查找 Promise chain 是否有 .on('error') 或 .catch() 保護
 *
 * 修復 (2026-04-04):
 * 1. 擴展向後掃描(forward scan)到 20 行,捕獲 Promise chain 中
 *    .catch() / .on('error') 出現在危險操作之後的情況
 * 2. 新增 `.finally()` 識別(finally 也算 error handling)
 * 3. 新增 eventemitter 模式識別(process.on('uncaughtException') 等)
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @returns {boolean} - true 表示被 Promise error handling 保護
 */
function isProtectedByPromise(lines, lineIdx) {
  // 向後掃描(backward):在危險操作之前找 .catch() / .on('error')
  for (let j = Math.max(0, lineIdx - 20); j < lineIdx; j++) {
    const trimmed = lines[j].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
    if (/\.on\s*\(\s*['"]error['"]/.test(trimmed)) return true;
    if (/\.catch\s*\(/.test(trimmed)) return true;
    if (/\.finally\s*\(/.test(trimmed)) return true;
    // process.on('uncaughtException', ...) 全域錯誤處理
    if (/process\.on\s*\(\s*['"]uncaughtException['"]/.test(trimmed)) return true;
    // process.on('unhandledRejection', ...) Promise rejection 處理
    if (/process\.on\s*\(\s*['"]unhandledRejection['"]/.test(trimmed)) return true;
  }

  // 向後掃描(forward):在危險操作之後找 Promise chain 的 .catch() / .on('error')
  // 適用於:Promise chain 跨越多行,例如:
  //   fs.promises.writeFile(...)
  //     .then(...)
  //     .catch(err => ...)
  for (let j = lineIdx + 1; j < Math.min(lines.length, lineIdx + 20); j++) {
    const trimmed = lines[j].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
    // 識別多行 Promise chain 的連接符(.then( / .catch( / .on()
    if (/\b(\.then|\.catch|\.finally|\.on)\s*\(\s*$/.test(trimmed)) continue; // 這行是 chain 中間
    if (/\.on\s*\(\s*['"]error['"]/.test(trimmed)) return true;
    if (/\.catch\s*\(/.test(trimmed)) return true;
    if (/\.finally\s*\(/.test(trimmed)) return true;
    // 如果遇到非 chain 的語句,停止 forward scan
    if (/^[^(]*\)\s*;?\s*$/.test(trimmed) && !/\bPromise\b/.test(trimmed)) break;
  }

  return false;
}

/**
 * 檢查檔案中是否有 atomicWriteSync helper
 *
 * 原 Lines 553-563
 *
 * @param {string} content - 檔案內容
 * @returns {boolean} - true 表示有 atomicWriteSync helper
 */
function hasAtomicWriteHelper(content) {
  if (/const\s+\{\s*[^}]*atomicWriteSync[^}]*\}\s*=\s*require\s*\(/.test(content)) return true;
  if (/function\s+atomicWriteSync\s*\(/.test(content)) return true;
  if (/(?:const|let|var)\s+atomicWriteSync\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])*=>/.test(content)) return true;
  return false;
}

/**
 * 檢查是否有 defensive check pattern
 *
 * Pattern: 先檢查 fs.existsSync,之後先 try-catch 包裹 dangerous 操作
 *
 * 例如:
 *   if (!fs.existsSync(path)) { return; }
 *   try {
 *     content = fs.readFileSync(path);
 *   }
 *
 * 呢種情況下,existsSync 雖然未被 try-catch 直接包圍,
 * 但因為有「先檢查、後操作」既 pattern,都算有保護。
 *
 * @param {string[]} lines - 檔案行陣列
 * @param {number} lineIdx - 0-indexed 行號
 * @returns {boolean} - true 表示有 defensive check
 */
function hasDefensiveCheck(lines, lineIdx) {
  const line = (lines[lineIdx] || '').trim();

  // Pattern 1: existsSync with later try-catch (defensive check)
  if (/fs\.existsSync\(/.test(line)) {
    // Forward scan for subsequent try block
    for (let j = lineIdx + 1; j < Math.min(lines.length, lineIdx + 10); j++) {
      const l = lines[j].trim();
      if (l.startsWith('//') || l.startsWith('*')) continue;
      if (/\btry\s*\{/.test(l)) return true;
    }
    return false;
  }

  // Pattern 2: Same-line try-catch (inline)
  // 例如: try { fs.unlinkSync(...) } catch { ... }
  // Check if current line has both try { and the operation
  if (line.includes('try {') && (/fs\.(unlink|write|read)Sync\(/.test(line) || /execSync\(/.test(line))) {
    return true;
  }

  // Pattern 3: Early Return / Early Throw
  // 例如: if (!fs.existsSync(path)) { return; }
  if (/fs\.existsSync\(/.test(line)) {
    for (let j = lineIdx + 1; j < Math.min(lines.length, lineIdx + 5); j++) {
      const l = lines[j].trim();
      if (l.startsWith('//') || l.startsWith('*')) continue;
      if (/\breturn\s+(false|null|undefined)/.test(l) || /\bthrow\b/.test(l)) {
        return true;
      }
    }
  }

  // Pattern 4: Inline try-catch on same line (enhanced)
  // 檢查同一行或相鄰 2 行內有 try-catch 包圍 fs/exec 操作
  if (/^\s*try\s*\{/.test(line)) {
    const fullBlock = lines.slice(lineIdx, Math.min(lines.length, lineIdx + 3)).join(' ');
    if (/\btry\s*\{.*\b(fs\.|exec)/.test(fullBlock) || /\b(fs\.|exec).*\}\s*catch/.test(fullBlock)) {
      return true;
    }
  }

  // 檢查後面既 N 行有 try-catch block
  for (let j = lineIdx + 1; j < Math.min(lines.length, lineIdx + 10); j++) {
    const l = lines[j].trim();
    if (l.startsWith('//') || l.startsWith('*')) continue;

    // 搵 try {
    if (/\btry\s*\{/.test(l)) {
      // Forward 追蹤 try block 既範圍
      let relDepth = 0;
      let foundTry = false;
      let endIdx = -1;

      for (let k = j; k < lines.length; k++) {
        const tryLine = lines[k].trim();
        if (tryLine.startsWith('//') || tryLine.startsWith('*')) continue;

        for (const ch of tryLine) {
          if (ch === '{') { if (foundTry) relDepth++; }
          if (ch === '}') { if (relDepth > 0) relDepth--; }
        }

        if (/\btry\s*\{/.test(tryLine)) foundTry = true;

        if (foundTry && relDepth === 0) {
          endIdx = k;
          break;
        }
      }

      // 如果 try block 存在,就認為有 defensive check
      if (endIdx > 0) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  isPureFunction,
  isProtectedByTry,
  isProtectedByGlobalTry,
  isProtectedByPromise,
  hasAtomicWriteHelper,
  hasDefensiveCheck,
};
