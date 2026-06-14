#!/usr/bin/env node
/**
 * verify_fix.js — 驗證檢查系統
 *
 * 檢查 24 小時前的未驗證修復，確認 errors.json 有無同類問題再出現
 * 計算修復成功率，標記成功率 < 50% 的策略為 deprecated
 *
 * 使用方法:
 *   node scripts/verify_fix.js              # 驗證所有待驗證修復
 *   node scripts/verify_fix.js --dry-run    # 預覽模式
 *   node scripts/verify_fix.js --fix-id FIX-001  # 只驗證特定修復
 *   node scripts/verify_fix.js --report     # 只生成報告
 *
 * Cron: 每日 04:00 運行
 */

const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const { HOME, WS } = require('./lib/config');
const HISTORY_FILE = path.join(WS, '.state', 'auto_fix_history.json');
const ERRORS_FILE = path.join(WS, '.state', 'errors.json');
const VERIFY_LOG = path.join(WS, '.state', 'verify_fix_log.json');

const CONFIG = {
  VERIFY_AGE_HOURS: 24,       // 修復後多久開始驗證
  DEPRIORITY_THRESHOLD: 50,   // 成功率低於此值 → deprecated
  HOURS_MS: 24 * 60 * 60 * 1000,
};

// ==================== FIX CATEGORIES ====================
// 修復類別分組配置 - Phase 2: 分層驗證系統
const FIX_CATEGORIES = {
  // 格式化修復：自動驗證，無需人工確認，不計入成功率統計
  FORMATTING: {
    keywords: ['行尾空白', 'trailing_whitespace', '換行符', 'newline', '檔案末尾', 'trailing_newline', '簡體中文', '簡體→繁體', 'simplified'],
    label: '格式化修復',
    autoVerify: true,
    description: '自動修復，無需驗證'
  },
  // 代碼質量修復：需要實際驗證成功率
  QUALITY: {
    keywords: ['execSync', 'magic_numbers', 'try-catch', 'hardcoded', 'missing_try'],
    label: '代碼質量修復',
    autoVerify: false,
    description: '需驗證成功率'
  }
};

/**
 * 判斷修復類型
 * @param {Object} fix - fix record
 * @returns {string} 'FORMATTING' | 'QUALITY'
 */
function getFixCategory(fix) {
  const issue = fix.issue || '';
  const fixApplied = fix.fix_applied || '';
  const text = (issue + ' ' + fixApplied).toLowerCase();

  // 檢查是否為格式化修復
  for (const keyword of FIX_CATEGORIES.FORMATTING.keywords) {
    if (text.includes(keyword.toLowerCase())) {
      return 'FORMATTING';
    }
  }

  // 檢查是否為代碼質量修復
  for (const keyword of FIX_CATEGORIES.QUALITY.keywords) {
    if (text.includes(keyword.toLowerCase())) {
      return 'QUALITY';
    }
  }

  // 默認為代碼質量修復
  return 'QUALITY';
}

// ==================== COLORS ====================
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(color, msg) {
  console.log(`${C[color] || ''}${msg}${C.reset}`);
}

// ==================== HELPERS ====================

function readHistory() {
  try {
    let exists = false;
    try {
      exists = fs.existsSync(HISTORY_FILE);
    } catch (e) {
      exists = false;
    }
    if (exists) {
      let content;
      try {
        content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      } catch (e) {
        log('red', `⚠️  無法讀取 history: ${e.message}`);
        return { version: 1, fixes: [] };
      }
      const data = JSON.parse(content);
      // 舊格式：array of {timestamp, summary} from auto_fix
      // 新格式：{ version: 1, fixes: [...] }
      if (Array.isArray(data)) {
        log('yellow', '⚠️  發現舊格式 history，正在遷移...');
        return { version: 1, fixes: [], _migratedFrom: 'array' };
      }
      return data;
    }
  } catch (e) {
    log('red', `⚠️  無法讀取 history: ${e.message}`);
  }
  return { version: 1, fixes: [] };
}

function writeHistory(data) {
  const tmpFile = HISTORY_FILE + '.tmp';
  try {
    const dir = path.dirname(HISTORY_FILE);
    let dirExists = false;
    try {
      dirExists = fs.existsSync(dir);
    } catch (e) {
      dirExists = false;
    }
    if (!dirExists) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (mkdirErr) {
        if (mkdirErr.code !== 'EEXIST') {
          throw mkdirErr;
        }
      }
    }
    // Atomic write: write to temp file then rename
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (writeErr) {
      throw writeErr;
    }
    try {
      fs.renameSync(tmpFile, HISTORY_FILE);
    } catch (renameErr) {
      // Clean up temp file if rename fails
      try {
        fs.unlinkSync(tmpFile);
      } catch { /* ignore cleanup errors */ }
      throw renameErr;
    }
    return true;
  } catch (e) {
    log('red', `⚠️  無法寫入 history: ${e.message}`);
    // Clean up temp file on any error
    try {
      let tmpExists = false;
      try {
        tmpExists = fs.existsSync(tmpFile);
      } catch (e) {
        tmpExists = false;
      }
      if (tmpExists) fs.unlinkSync(tmpFile);
    } catch { /* ignore */ }
    return false;
  }
}

function readErrors() {
  try {
    let exists = false;
    try {
      exists = fs.existsSync(ERRORS_FILE);
    } catch (e) {
      exists = false;
    }
    if (exists) {
      let content;
      try {
        content = fs.readFileSync(ERRORS_FILE, 'utf-8');
      } catch (e) {
        log('dim', `   (errors.json 無法讀取: ${e.message})`);
        return { errors: [] };
      }
      return JSON.parse(content);
    }
  } catch (e) {
    log('dim', `   (errors.json 不存在或無法讀取: ${e.message})`);
  }
  return { errors: [] };
}

function writeVerifyLog(logData) {
  const tmpFile = VERIFY_LOG + '.tmp';
  try {
    const dir = path.dirname(VERIFY_LOG);
    let dirExists = false;
    try {
      dirExists = fs.existsSync(dir);
    } catch (e) {
      dirExists = false;
    }
    if (!dirExists) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (mkdirErr) {
        if (mkdirErr.code !== 'EEXIST') {
          throw mkdirErr;
        }
      }
    }
    // ✅ Atomic write: 先寫 .tmp 再 rename，防止 crash 時數據損壞
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(logData, null, 2), 'utf-8');
    } catch (writeErr) {
      throw writeErr;
    }
    try {
      fs.renameSync(tmpFile, VERIFY_LOG);
    } catch (renameErr) {
      // Clean up temp file if rename fails
      try {
        fs.unlinkSync(tmpFile);
      } catch { /* ignore cleanup errors */ }
      throw renameErr;
    }
  } catch (e) {
    log('dim', `   (無法寫入 verify log: ${e.message})`);
    // Clean up temp file on any error
    try {
      let tmpExists = false;
      try {
        tmpExists = fs.existsSync(tmpFile);
      } catch (e) {
        tmpExists = false;
      }
      if (tmpExists) fs.unlinkSync(tmpFile);
    } catch { /* ignore */ }
  }
}

function toHKT(isoString) {
  return new Date(isoString).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

// ==================== ERROR PATTERN MATCHING ====================

/**
 * 從 error record 提取關鍵 pattern
 */
function extractErrorPatterns(error) {
  const patterns = [];
  const text = `${error.problem || ''} ${error.type || ''} ${error.details || ''}`.toLowerCase();

  // File name patterns
  if (error.file) {
    patterns.push(error.file.toLowerCase());
    patterns.push(path.basename(error.file).toLowerCase());
  }

  // Error type keywords
  if (error.type) {
    patterns.push(error.type.toLowerCase());
  }

  // Common keywords
  const keywords = [
    'execsync', 'execsync missing', 'try-catch', 'trycatch',
    'exec', 'spawn', 'execfile',
    'fs.writefilesync', 'fs.readfilesync', 'fs.sync',
    'syntax', 'syntax error',
    'timeout', 'rate limit', 'rate_limit',
    'not found', 'enoent', 'file not found',
    'permission', 'eacces',
    'memory', 'oom', 'out of memory',
    'discord', 'discord error',
    'ollama', 'model',
  ];

  for (const kw of keywords) {
    if (text.includes(kw)) {
      patterns.push(kw);
    }
  }

  // Extract quoted strings (error messages often in quotes)
  const quotedMatches = error.problem?.match(/'([^']+)'|"([^"]+)"/g) || [];
  for (const m of quotedMatches) {
    patterns.push(m.slice(1, -1).toLowerCase());
  }

  return [...new Set(patterns)];
}

/**
 * 檢查 fix 的 issue 是否在 errors 中再出現
 * 返回 { matched: bool, matchedErrors: [], score: number }
 */
function checkErrorRecurrence(fix, errors) {
  if (!errors.errors || errors.errors.length === 0) {
    return { matched: false, matchedErrors: [], score: 0 };
  }

  const fixPatterns = extractErrorPatterns({
    problem: fix.issue,
    type: null,
    file: fix.file,
  });

  // Also create patterns from fix_applied
  const fixAppliedPatterns = extractErrorPatterns({
    problem: fix.fix_applied,
    type: null,
    file: fix.file,
  });

  const allPatterns = [...fixPatterns, ...fixAppliedPatterns];
  const matchedErrors = [];
  let score = 0;

  for (const err of errors.errors) {
    if (err.resolved) continue; // Skip resolved errors

    const errPatterns = extractErrorPatterns(err);
    let matchCount = 0;

    // Check if fix file is related
    if (fix.file && err.file) {
      const fixBasename = path.basename(fix.file).replace(/\.(js|sh|mjs|cjs)$/, '');
      const errBasename = path.basename(err.file).replace(/\.(js|sh|mjs|cjs)$/, '');
      if (fixBasename === errBasename) {
        matchCount += 3; // High weight for same file
      }
    }

    // Check pattern overlap
    for (const fp of allPatterns) {
      for (const ep of errPatterns) {
        if (fp.length > 3 && ep.length > 3) {
          // Fuzzy match: check if one contains the other
          if (fp.includes(ep) || ep.includes(fp)) {
            matchCount++;
          }
        }
      }
    }

    if (matchCount > 0) {
      matchedErrors.push({
        id: err.id,
        type: err.type,
        problem: err.problem,
        file: err.file,
        timestamp: err.timestamp,
        matchCount,
      });
      score += matchCount;
    }
  }

  return {
    matched: matchedErrors.length > 0,
    matchedErrors,
    score,
  };
}

// ==================== VERIFICATION LOGIC ====================

/**
 * Verify a single fix record
 */
function verifyFix(fix, errors, isDryRun) {
  const age = Date.now() - new Date(fix.timestamp).getTime();
  const ageHours = Math.round(age / (60 * 60 * 1000));

  // Check recurrence
  const check = checkErrorRecurrence(fix, errors);

  const result = {
    fix_id: fix.id,
    file: fix.file,
    issue: fix.issue,
    age_hours: ageHours,
    verified_at: new Date().toISOString(),
    is_dry_run: isDryRun,
  };

  if (check.matched) {
    // Error 再出現了 = 修復失敗
    result.verdict = 'fail';
    result.success_rate = 0;
    result.matched_errors = check.matchedErrors;
    result.message = `❌ 修復失敗 — 在 errors.json 中發現 ${check.matchedErrors.length} 個相關錯誤`;

    if (!isDryRun) {
      fix.verification_count++;
      fix.failures++;
      fix.success_rate = Math.round((fix.verification_count - fix.failures) / fix.verification_count * 100);
      fix.verified = fix.success_rate >= CONFIG.DEPriorITY_THRESHOLD;
      fix.last_verification = result.verified_at;
      fix.last_matched_errors = check.matchedErrors.map(e => e.id);

      if (fix.success_rate < CONFIG.DEPriorITY_THRESHOLD) {
        fix.status = 'deprecated';
        result.message += ` — 成功率 ${fix.success_rate}% < ${CONFIG.DEPriorITY_THRESHOLD}%，已降級`;
      }
    }
  } else {
    // 冇再出現 = 修復成功
    result.verdict = 'success';
    result.success_rate = fix.success_rate !== null
      ? Math.round(((fix.verification_count + 1) - fix.failures) / (fix.verification_count + 1) * 100)
      : 100;
    result.message = `✅ 修復成功 — 24h 內無同類錯誤再出現`;

    if (!isDryRun) {
      fix.verification_count++;
      fix.success_rate = Math.round((fix.verification_count - fix.failures) / fix.verification_count * 100);
      fix.verified = fix.success_rate >= CONFIG.DEPriorITY_THRESHOLD;
      fix.last_verification = result.verified_at;
      if (fix.verified) fix.status = 'verified';
    }
  }

  return result;
}

// ==================== MAIN VERIFICATION ====================

function runVerification(options = {}) {
  const { isDryRun = false, fixId = null, quiet = false } = options;

  if (!quiet) {
    log('cyan', '🔍 verify_fix.js — 驗證修復系統');
    if (isDryRun) log('yellow', '⚠️  DRY-RUN 模式 — 不會修改任何記錄');
    console.log('');
  }

  // Read data
  const history = readHistory();
  const errors = readErrors();

  if (!quiet) {
    log('dim', `   History: ${history.fixes.length} 條記錄`);
    log('dim', `   Errors: ${errors.errors?.length || 0} 條錯誤`);
    console.log('');
  }

  // Find fixes to verify
  const now = Date.now();
  let fixesToVerify = [];

  if (fixId) {
    // Verify specific fix
    const fix = history.fixes.find(f => f.id === fixId.toUpperCase());
    if (fix) {
      fixesToVerify = [fix];
    } else {
      log('red', `❌ 找不到: ${fixId}`);
      process.exit(1);
    }
  } else {
    // Auto-find: unverified, active, older than 24h
    fixesToVerify = history.fixes.filter(f => {
      if (f.verified || f.status === 'deprecated') return false;
      const age = now - new Date(f.timestamp).getTime();
      return age >= CONFIG.HOURS_MS;
    });
  }

  if (fixesToVerify.length === 0) {
    if (!quiet) {
      log('green', '✅ 冇需要驗證的修復');
      log('dim', '   (所有修復已驗證，或距離修復不到 24 小時)');
    }
    return { results: [], summary: { total: 0, success: 0, fail: 0 } };
  }

  if (!quiet) {
    log('cyan', `📋 開始驗證 ${fixesToVerify.length} 條修復記錄...`);
    console.log('');
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const fix of fixesToVerify) {
    if (!quiet) {
      log('dim', `🔍 驗證 ${fix.id}: ${fix.file}`);
      log('dim', `   Issue: ${fix.issue}`);
    }

    const result = verifyFix(fix, errors, isDryRun);
    results.push(result);

    if (!quiet) {
      if (result.verdict === 'success') {
        log('green', `   ${result.message}`);
        successCount++;
      } else {
        log('red', `   ${result.message}`);
        failCount++;
        if (result.matched_errors && result.matched_errors.length > 0) {
          for (const me of result.matched_errors.slice(0, 3)) {
            log('dim', `      → [${me.type}] ${me.problem?.substring(0, 60)}`);
          }
        }
      }
      console.log('');
    } else {
      if (result.verdict === 'success') successCount++;
      else failCount++;
    }
  }

  // Write updated history
  if (!isDryRun) {
    writeHistory(history);
  }

  // Write verify log
  const logEntry = {
    timestamp: new Date().toISOString(),
    timestampHKT: toHKT(new Date().toISOString()),
    dry_run: isDryRun,
    results,
    summary: {
      total: fixesToVerify.length,
      success: successCount,
      fail: failCount,
    },
  };
  writeVerifyLog(logEntry);

  // Update verified field in auto_fix_history.json based on verification results
  if (!isDryRun) {
    try {
      let updated = false;
      for (const result of results) {
        const fixEntry = history.fixes.find(f => f.id === result.fix_id);
        if (fixEntry) {
          // Update verified based on verdict: success -> true, fail -> false
          fixEntry.verified = result.verdict === 'success';
          updated = true;
        }
      }
      if (updated) {
        writeHistory(history);
      }
    } catch (e) {
      log('dim', `   (更新 history verified 欄位失敗: ${e.message})`);
    }
  }

  // Summary
  if (!quiet) {
    console.log('');
    log('cyan', '═══════════════════════════════════════');
    log('bold', '📊 驗證結果摘要');
    log('cyan', '═══════════════════════════════════════');
    console.log('');
    console.log(`   總計驗證:   ${fixesToVerify.length}`);
    console.log(`   ✅ 成功:    ${successCount}`);
    console.log(`   ❌ 失敗:    ${failCount}`);
    console.log('');

    // Show deprecated
    const deprecated = results.filter(r => {
      const fix = history.fixes.find(f => f.id === r.fix_id);
      return fix && fix.status === 'deprecated';
    });

    if (deprecated.length > 0) {
      log('yellow', `⚠️  已降級策略 (成功率 < ${CONFIG.DEPriorITY_THRESHOLD}%):`);
      for (const d of deprecated) {
        const fix = history.fixes.find(f => f.id === d.fix_id);
        console.log(`   ${d.fix_id} | ${fix?.file} | SR: ${fix?.success_rate}%`);
      }
      console.log('');
    }

    // Show newly verified
    const verified = results.filter(r => {
      const fix = history.fixes.find(f => f.id === r.fix_id);
      return fix && fix.verified;
    });

    if (verified.length > 0) {
      log('green', `✅ 已驗證成功:`);
      for (const v of verified) {
        console.log(`   ${v.fix_id} | ${v.file} | SR: ${v.success_rate}%`);
      }
      console.log('');
    }

    log('dim', `📁 驗證日誌: .state/verify_fix_log.json`);
  }

  return {
    results,
    summary: { total: fixesToVerify.length, success: successCount, fail: failCount },
  };
}

// ==================== REPORT MODE ====================

function showReport() {
  log('cyan', '📊 修復成功率報告 (分層統計)');
  console.log('');

  const history = readHistory();

  if (history.fixes.length === 0) {
    log('yellow', '⚠️  冇記錄');
    return;
  }

  // 過濾掉 audit records
  const fixes = history.fixes.filter(f => !f.isAuditRecord);

  // 分類統計
  const formattingFixes = fixes.filter(f => getFixCategory(f) === 'FORMATTING');
  const qualityFixes = fixes.filter(f => getFixCategory(f) === 'QUALITY');

  // 計算各類統計
  const formattingVerified = formattingFixes.filter(f => f.verified).length;
  const formattingTotal = formattingFixes.length;

  const qualityVerified = qualityFixes.filter(f => f.verified).length;
  const qualityTotal = qualityFixes.length;
  const qualityPending = qualityFixes.filter(f => !f.verified && f.status !== 'deprecated').length;
  const qualityDeprecated = qualityFixes.filter(f => f.status === 'deprecated').length;

  // 計算有意義的成功率（只算 quality）
  const qualityWithRate = qualityFixes.filter(f => f.success_rate !== null && f.verified);
  const qualitySuccessRate = qualityWithRate.length > 0
    ? Math.round(qualityWithRate.reduce((sum, f) => sum + f.success_rate, 0) / qualityWithRate.length)
    : (qualityVerified > 0 ? 100 : 0);

  // ========== 分層顯示 ==========
  console.log('┌─────────────────────────────────────────┐');
  console.log('│  📐 格式化修復 (自動驗證)                │');
  console.log(`│  ✅ ${formattingTotal.toString().padStart(2)} 個已自動驗證                    │`);
  console.log('│                                         │');
  console.log('│  包括：行尾空白、換行符等自動格式化       │');
  console.log('├─────────────────────────────────────────┤');
  console.log('│  🔧 代碼質量修復 (需驗證)                │');
  console.log(`│  ✅ ${qualityVerified.toString().padStart(2)} 個已驗證成功                      │`);
  console.log(`│  ⏳ ${qualityPending.toString().padStart(2)} 個待驗證 (未夠 24h)              │`);
  if (qualityDeprecated > 0) {
    console.log(`│  ⚠️  ${qualityDeprecated} 個已降級                          │`);
  }
  console.log(`│  📈 成功率: ${qualitySuccessRate}% (${qualityVerified}/${qualityTotal})              │`);
  console.log('└─────────────────────────────────────────┘');
  console.log('');

  // 詳細表格（只顯示 quality fixes）
  if (qualityFixes.length > 0) {
    log('cyan', '📋 代碼質量修復記錄:');
    console.log('');
    console.log(`   ID        | File                        | SR%   | Status     | Verified`);
    console.log(`   ${'─'.repeat(80)}`);

    const sorted = qualityFixes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    for (const f of sorted.slice(0, 15)) { // 只顯示前 15 個
      const status = f.status === 'deprecated' ? `${C.red}deprecated${C.reset}` :
                     f.verified ? `${C.green}verified${C.reset}` :
                     `${C.yellow}active${C.reset}`;
      const sr = f.success_rate !== null ? `${f.success_rate}%`.padStart(4) : '  N/A';
      const fileShort = f.file.replace('scripts/', '').substring(0, 28).padEnd(28);

      console.log(`   ${f.id} | ${fileShort} | ${sr}   | ${status} | ${f.verified ? '✅' : f.verification_count > 0 ? `${f.verification_count}x` : '—'}`);
    }

    if (qualityFixes.length > 15) {
      console.log(`   ... 還有 ${qualityFixes.length - 15} 個記錄 (使用 --fix-id 查看詳情)`);
    }
    console.log('');
  }

  // 已降級詳情
  const deprecatedFixes = qualityFixes.filter(f => f.status === 'deprecated');
  if (deprecatedFixes.length > 0) {
    log('yellow', '⚠️  已降級策略 (需要人工介入):');
    for (const f of deprecatedFixes) {
      console.log(`   ${f.id}: ${f.issue}`);
      console.log(`        Fix: ${f.fix_applied}`);
      console.log(`        SR: ${f.success_rate}% (${f.failures}/${f.verification_count} failures)`);
    }
    console.log('');
  }
}

// ==================== CLI ====================

if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const quiet = args.includes('--quiet');
  const fixIdArg = args.find(a => a.startsWith('--fix-id='))?.replace('--fix-id=', '');
  const showReportFlag = args.includes('--report');

  if (showReportFlag) {
    showReport();
  } else {
    const result = runVerification({
      isDryRun,
      fixId: fixIdArg,
      quiet,
    });
    process.exit(0);
  }
}

module.exports = {
  runVerification,
  verifyFix,
  checkErrorRecurrence,
  getFixCategory,
  FIX_CATEGORIES
};
