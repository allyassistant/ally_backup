/**
 * scripts/lib/helpers/skip-list.js
 *
 * Skip List (False Positive 標記) 功能
 *
 * 從 auto_fix.js 原 Lines 300-440 拆分出來
 *
 * 用於標記特定問題為 false positive，避免重複報告
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// SKIP_PATTERNS - Style Preference Magic Numbers
// ============================================================
// 用於過濾 style preference 的 magic_numbers，這些是已知的合法硬編碼值
// 在 magic-string-in-function 規則中使用

const SKIP_PATTERNS = {
  // Discord 頻道 ID (例如: '1234567890123456789')
  discordChannelId: /['"]\d{17,20}['"]/g,

  // 電話號碼格式 (例如: '+852XXXXXX' 或 '123-456-7890')
  // 匹配帶有國際區號或分隔符的電話號碼
  phoneNumber: /['"](?:\+\d{1,4}[\s\-]?\d{6,15}|\d{3}[\s\-]\d{3}[\s\-]\d{4}|\(\d{3}\)[\s\-]?\d{3}[\s\-]\d{4})['"]/g,

  // 緩衝區大小 (例如: bufferSize: 1024, 4096, 8192)
  bufferSize: /\b(bufferSize|chunkSize|blockSize)\s*[:=]\s*\d{3,5}\b/gi,

  // 時間毫秒值 (例如: timeout: 5000, delay: 1000)
  timeMs: /\b(timeout|delay|interval|duration|period|wait)\s*[:=]\s*\d+\s*\*?\s*\d*\s*(ms|milliseconds?)?\b/gi,

  // 埠號 (例如: port: 3000, 8080)
  portNumber: /\bport\s*[:=]\s*\d{2,5}\b/gi,

  // 測試數據 (例如: testId, mockData)
  testData: /\b(test|mock|fixture|stub|dummy)\w*\s*[:=]\s*['"][^'"]{3,}['"]/gi,
};

// 組合所有 patterns 用於快速檢查
const ALL_SKIP_PATTERNS = Object.values(SKIP_PATTERNS);

/**
 * 檢查字符串是否匹配任何 style preference pattern
 *
 * @param {string} str - 要檢查的字符串
 * @param {string} line - 完整的程式碼行（用於上下文檢查）
 * @returns {boolean} - true 表示匹配到 skip pattern
 */
function isStylePreference(str, line = '') {
  // 直接檢查字符串
  for (const pattern of ALL_SKIP_PATTERNS) {
    if (pattern.test(str)) {
      pattern.lastIndex = 0; // 重置 regex
      return true;
    }
    pattern.lastIndex = 0; // 重置 regex
  }

  // 檢查整行上下文（用於識別變數賦值）
  if (line) {
    for (const pattern of ALL_SKIP_PATTERNS) {
      if (pattern.test(line)) {
        pattern.lastIndex = 0; // 重置 regex
        return true;
      }
      pattern.lastIndex = 0; // 重置 regex
    }
  }

  return false;
}

// 動態引入 config
let config;
try {
  config = require('../config');
} catch {
  config = { STATE_DIR: path.join(process.env.HOME, '.openclaw', 'workspace', '.state') };
}

const { STATE_DIR } = config;
const SKIP_LIST_FILE = path.join(STATE_DIR, 'auto_fix_skip_list.json');

// CLI args (需要在 main 中傳入，這裡用簡易方式)
let _isDryRun = false;
function setDryRun(val) { _isDryRun = val; }

/**
 * 讀取 Skip List
 *
 * 原 Lines 310-320
 *
 * @returns {Object} - { skips: [], version: 1 }
 */
function loadSkipList() {
  try {
    if (fs.existsSync(SKIP_LIST_FILE)) {
      return JSON.parse(fs.readFileSync(SKIP_LIST_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn(`⚠️ 無法讀取 Skip List: ${e.message}`);
  }
  return { skips: [], version: 1 };
}

/**
 * 保存 Skip List (使用 atomic write)
 *
 * 原 Lines 325-340
 *
 * @param {Object} skipList - Skip list 對像
 */
function saveSkipList(skipList) {
  if (_isDryRun) return;
  ensureDir(STATE_DIR);
  try {
    const tmpFile = SKIP_LIST_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(skipList, null, 2));
    fs.renameSync(tmpFile, SKIP_LIST_FILE);
  } catch (e) {
    console.error(`❌ 無法保存 Skip List: ${e.message}`);
  }
}

/**
 * 確保目錄存在
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 標記問題為 false positive
 *
 * 原 Lines 345-375
 *
 * @param {string} ruleId - 規則 ID
 * @param {string} file - 檔案路徑（相對路徑）
 * @param {number[]} lines - 行號陣列
 * @param {string} reason - 原因
 */
function markFalsePositive(ruleId, file, lines, reason = 'confirmed-false-positive') {
  const skipList = loadSkipList();

  const existingIndex = skipList.skips.findIndex(
    s => s.ruleId === ruleId && s.file === file
  );

  if (existingIndex >= 0) {
    const existing = skipList.skips[existingIndex];
    const mergedLines = [...new Set([...existing.lines, ...lines])].sort((a, b) => a - b);
    existing.lines = mergedLines;
    existing.markedAt = new Date().toISOString();
    existing.reason = reason;
  } else {
    skipList.skips.push({
      ruleId,
      file,
      lines,
      markedAt: new Date().toISOString(),
      reason,
    });
  }

  saveSkipList(skipList);
}

/**
 * 檢查問題是否已被標記為跳過
 *
 * 原 Lines 380-395
 *
 * @param {Object} issue - 問題對像 { rule: ruleId, lines: [] }
 * @param {string} file - 檔案路徑（相對路徑）
 * @returns {boolean} - true 表示已跳過
 */
function isSkipped(issue, file) {
  const skipList = loadSkipList();
  const skip = skipList.skips.find(
    s => s.ruleId === issue.rule && s.file === file
  );

  if (!skip) return false;

  const issueLines = issue.lines || [];
  return issueLines.some(line => skip.lines.includes(line));
}

/**
 * 顯示 Skip List 內容
 *
 * 原 Lines 400-425
 */
function showSkipList() {
  const skipList = loadSkipList();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║              🚫 Skip List (False Positives)          ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  if (skipList.skips.length === 0) {
    console.log('📭 Skip List 為空（沒有標記的 false positive）');
    console.log('');
    console.log('💡 使用方法:');
    console.log('   node scripts/auto_fix.js skip --list');
    console.log('   node scripts/auto_fix.js skip --rule=HR-001 --file=scripts/test.js --lines=45,46,47');
    console.log('');
    return;
  }

  console.log(`📋 共有 ${skipList.skips.length} 個標記項目:`);
  console.log('');

  for (const skip of skipList.skips) {
    console.log(`   🚫 ${skip.ruleId} — ${skip.file}`);
    console.log(`      行號: ${skip.lines.join(', ')}`);
    console.log(`      原因: ${skip.reason}`);
    console.log(`      標記時間: ${new Date(skip.markedAt).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false })}`);
    console.log('');
  }
}

// HKT time helper
function toHKT(isoString) {
  return new Date(isoString).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

/**
 * 處理 Skip 命令
 *
 * 原 Lines 428-475
 *
 * @param {string[]} args - CLI 參據陣列
 * @param {Object} options - 選項 { AUDIT_REPORT }
 */
function handleSkipCommand(args, options = {}) {
  const { AUDIT_REPORT } = options;

  const listArg = args.includes('--list');
  const ruleArg = args.find(a => a.startsWith('--rule='));
  const fileArg = args.find(a => a.startsWith('--file='));
  const linesArg = args.find(a => a.startsWith('--lines='));

  // 顯示列表模式
  if (listArg || (!ruleArg && !fileArg)) {
    showSkipList();
    return;
  }

  // 添加模式
  if (!ruleArg) {
    console.error('❌ 請提供 --rule=RULE_ID');
    return;
  }

  if (!fileArg) {
    console.error('❌ 請提供 --file=FILE_PATH');
    return;
  }

  let ruleId = ruleArg.split('=')[1];
  const file = fileArg.split('=')[1];
  let lines = [];

  if (linesArg) {
    lines = linesArg.split('=')[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  }

  // 將 HR-XXX 轉換為實際的 rule ID
  try {
    if (AUDIT_REPORT && fs.existsSync(AUDIT_REPORT)) {
      const report = JSON.parse(fs.readFileSync(AUDIT_REPORT, 'utf-8'));
      const hrItem = (report.highRisk || []).find(h => h.id === ruleId.toUpperCase());
      if (hrItem) {
        ruleId = hrItem.rule;
        if (lines.length === 0 && hrItem.lines) {
          lines = hrItem.lines;
        }
      }
    }
  } catch { /* ignore */ }

  if (lines.length === 0) {
    console.error('❌ 請提供 --lines=LINE_NUMBERS（例如: --lines=45,46,47）');
    return;
  }

  markFalsePositive(ruleId, file, lines);

  console.log(`✅ 已標記為 false positive:`);
  console.log(`   規則: ${ruleId}`);
  console.log(`   檔案: ${file}`);
  console.log(`   行號: ${lines.join(', ')}`);
  console.log('');
}

module.exports = {
  loadSkipList,
  saveSkipList,
  markFalsePositive,
  isSkipped,
  showSkipList,
  handleSkipCommand,
  setDryRun,
  SKIP_PATTERNS,
  isStylePreference,
};
