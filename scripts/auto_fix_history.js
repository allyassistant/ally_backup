#!/usr/bin/env node
/**
 * auto_fix_history.js - 修復記錄系統
 *
 * 記錄每次 auto_fix.js 修復的內容、預期效果和時間
 * 使用 atomic write (tmp + rename) 確保數據安全
 *
 * 使用方法:
 *   node scripts/auto_fix_history.js add --file <file> --issue <issue> --fix <fix> --effect <effect>
 *   node scripts/auto_fix_history.js list [--unverified]
 *   node scripts/auto_fix_history.js stats
 *   node scripts/auto_fix_history.js verify <fix-id> --success|--fail
 *
 * 格式:
 *   {
 *     "version": 1,
 *     "fixes": [
 *       {
 *         "id": "FIX-001",
 *         "timestamp": "2026-04-04T22:00:00",
 *         "file": "scripts/xxx.js",
 *         "issue": "execSync missing try-catch",
 *         "fix_applied": "Added try-catch wrapper",
 *         "expected_effect": "No more uncaught exceptions from this call",
 *         "verified": false,
 *         "success_rate": null,
 *         "verification_count": 0,
 *         "failures": 0,
 *         "status": "active" | "verified" | "deprecated"
 *       }
 *     ]
 *   }
 */

const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const { HOME, WS } = require('./lib/config');
const HISTORY_FILE = path.join(WS, '.state', 'auto_fix_history.json');

// ==================== COLORS ====================
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(color, msg) {
  console.log(`${C[color] || ''}${msg}${C.reset}`);
}

// ==================== HELPERS ====================

/**
 * Read history file (or return empty structure)
 */
function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      // 舊格式：array of {timestamp, summary} from auto_fix
      // 新格式：{ version: 1, fixes: [...] }
      if (Array.isArray(parsed)) {
        return { version: 1, fixes: [] };
      }
      return parsed;
    }
  } catch (e) {
    console.error(`⚠️  無法讀取 history: ${e.message}`);
  }
  return { version: 1, fixes: [] };
}

/**
 * Atomic write - write to tmp then rename
 */
function writeHistory(data) {
  const tmpFile = HISTORY_FILE + '.tmp';
  try {
    // Ensure directory exists
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, HISTORY_FILE);
    return true;
  } catch (e) {
    console.error(`⚠️  無法寫入 history: ${e.message}`);
    // Clean up tmp file if exists
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Generate next FIX-ID (FIX-001, FIX-002, ...)
 */
function generateId(fixes) {
  let maxNum = 0;
  for (const f of fixes) {
    const match = f.id && f.id.match(/^FIX-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `FIX-${String(maxNum + 1).padStart(3, '0')}`;
}

// ==================== COMMANDS ====================

/**
 * Add a new fix record
 */
function cmdAdd(args) {
  const file = args.find(a => a.startsWith('--file='))?.replace('--file=', '') || '';
  const issue = args.find(a => a.startsWith('--issue='))?.replace('--issue=', '') || '';
  const fix = args.find(a => a.startsWith('--fix='))?.replace('--fix=', '') || '';
  const effect = args.find(a => a.startsWith('--effect='))?.replace('--effect=', '') || '';

  if (!file || !issue || !fix) {
    log('red', '❌ 缺少必要參數: --file, --issue, --fix');
    console.log('用法: node auto_fix_history.js add --file=<file> --issue=<issue> --fix=<fix> --effect=<effect>');
    process.exit(1);
  }

  const history = readHistory();
  const newFix = {
    id: generateId(history.fixes),
    timestamp: new Date().toISOString(),
    file: file,
    issue: issue,
    fix_applied: fix,
    expected_effect: effect || null,
    verified: false,
    success_rate: null,
    verification_count: 0,
    failures: 0,
    status: 'active',
  };

  history.fixes.push(newFix);

  if (writeHistory(history)) {
    log('green', `✅ 記錄已添加: ${newFix.id}`);
    log('dim', `   File: ${file}`);
    log('dim', `   Issue: ${issue}`);
    log('dim', `   Fix: ${fix}`);
    if (effect) log('dim', `   Expected: ${effect}`);
  } else {
    log('red', '❌ 添加記錄失敗');
    process.exit(1);
  }
}

/**
 * List fix records
 */
function cmdList(args) {
  const unverifiedOnly = args.includes('--unverified');
  const history = readHistory();
  const fixes = unverifiedOnly
    ? history.fixes.filter(f => !f.verified && f.status === 'active')
    : history.fixes;

  if (fixes.length === 0) {
    log('yellow', '⚠️  冇記錄');
    return;
  }

  // Sort by timestamp desc
  const sorted = [...fixes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  log('cyan', `📋 修復記錄 (${sorted.length} 條)`);
  console.log('');

  for (const f of sorted) {
    const statusIcon = f.status === 'deprecated' ? `${C.red}⚠️ deprecated${C.reset}` :
                       f.verified ? `${C.green}✅ verified${C.reset}` :
                       `${C.yellow}⏳ pending${C.reset}`;
    const sr = f.success_rate !== null ? `${f.success_rate}%` : 'N/A';
    const date = new Date(f.timestamp).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });

    console.log(`${C.bold}${f.id}${C.reset} ${statusIcon}`);
    console.log(`   📄 ${f.file}`);
    console.log(`   📅 ${date}`);
    console.log(`   🔧 ${f.issue}`);
    console.log(`   ✅ ${f.fix_applied}`);
    if (f.expected_effect) console.log(`   🎯 ${f.expected_effect}`);
    console.log(`   📊 Success Rate: ${sr} (${f.verification_count} checks, ${f.failures} failures)`);
    console.log('');
  }
}

/**
 * Show statistics
 */
function cmdStats() {
  const history = readHistory();
  const total = history.fixes.length;
  const verified = history.fixes.filter(f => f.verified).length;
  const active = history.fixes.filter(f => !f.verified && f.status === 'active').length;
  const deprecated = history.fixes.filter(f => f.status === 'deprecated').length;

  const withRate = history.fixes.filter(f => f.success_rate !== null);
  const avgRate = withRate.length > 0
    ? Math.round(withRate.reduce((sum, f) => sum + f.success_rate, 0) / withRate.length)
    : null;

  const recent = history.fixes.filter(f => {
    const age = Date.now() - new Date(f.timestamp).getTime();
    return age < 24 * 60 * 60 * 1000; // 24h
  }).length;

  const pending24h = history.fixes.filter(f => {
    if (f.verified || f.status !== 'active') return false;
    const age = Date.now() - new Date(f.timestamp).getTime();
    return age >= 24 * 60 * 60 * 1000; // older than 24h
  }).length;

  console.log('');
  log('cyan', '📊 修復記錄統計');
  console.log('');
  console.log(`   總記錄:      ${total}`);
  console.log(`   ✅ 已驗證:    ${verified}`);
  console.log(`   ⏳ 待驗證:    ${active}`);
  console.log(`   ⚠️  已降級:   ${deprecated}`);
  console.log(`   📈 24h 新增:  ${recent}`);
  console.log(`   ⏰ 待驗證(>24h): ${pending24h}`);
  if (avgRate !== null) {
    console.log(`   🎯 平均成功率: ${avgRate}%`);
  }
  console.log('');

  // Show deprecated fixes
  const deprecatedFixes = history.fixes.filter(f => f.status === 'deprecated');
  if (deprecatedFixes.length > 0) {
    log('yellow', '⚠️  已降級策略:');
    for (const f of deprecatedFixes) {
      const date = new Date(f.timestamp).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
      console.log(`   ${f.id} | ${f.file} | ${f.issue} | SR: ${f.success_rate}% | ${date}`);
    }
    console.log('');
  }
}

/**
 * Manual verification of a fix
 */
function cmdVerify(args) {
  const idArg = args.find(a => !a.startsWith('-') && a !== 'verify');
  const isSuccess = args.includes('--success');
  const isFail = args.includes('--fail');

  if (!idArg) {
    log('red', '❌ 請提供 fix ID');
    console.log('用法: node auto_fix_history.js verify FIX-001 --success|--fail');
    process.exit(1);
  }

  const history = readHistory();
  const fix = history.fixes.find(f => f.id === idArg.toUpperCase());

  if (!fix) {
    log('red', `❌ 找不到: ${idArg}`);
    process.exit(1);
  }

  if (isSuccess) {
    fix.verification_count++;
    fix.success_rate = Math.round((fix.verification_count - fix.failures) / fix.verification_count * 100);
    fix.verified = fix.success_rate >= 50;
    if (fix.verified) fix.status = 'verified';
    log('green', `✅ 驗證成功: ${fix.id} — SR: ${fix.success_rate}%`);
  } else if (isFail) {
    fix.verification_count++;
    fix.failures++;
    fix.success_rate = Math.round((fix.verification_count - fix.failures) / fix.verification_count * 100);
    fix.verified = false;
    if (fix.success_rate < 50) {
      fix.status = 'deprecated';
      log('yellow', `⚠️  成功率低於 50%，已降級: ${fix.id} — SR: ${fix.success_rate}%`);
    } else {
      log('red', `❌ 驗證失敗: ${fix.id} — SR: ${fix.success_rate}%`);
    }
  } else {
    log('yellow', '⚠️  請指定 --success 或 --fail');
    process.exit(1);
  }

  writeHistory(history);
}

/**
 * Programmatically add a fix record (used by auto_fix.js)
 * Returns the fix ID
 */
function addFixRecord(file, issue, fixApplied, expectedEffect) {
  const history = readHistory();
  const newFix = {
    id: generateId(history.fixes),
    timestamp: new Date().toISOString(),
    file: file,
    issue: issue,
    fix_applied: fixApplied,
    expected_effect: expectedEffect || null,
    verified: false,
    success_rate: null,
    verification_count: 0,
    failures: 0,
    status: 'active',
  };

  history.fixes.push(newFix);

  if (writeHistory(history)) {
    return newFix.id;
  }
  return null;
}

// ==================== CLI ====================

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    log('cyan', 'auto_fix_history.js — 修復記錄系統');
    console.log('');
    console.log('用法:');
    console.log('  node scripts/auto_fix_history.js add --file=<f> --issue=<i> --fix=<x> [--effect=<e>]');
    console.log('  node scripts/auto_fix_history.js list [--unverified]');
    console.log('  node scripts/auto_fix_history.js stats');
    console.log('  node scripts/auto_fix_history.js verify <id> --success|--fail');
    console.log('');
    // Programmatic API
    console.log('Programmatic API:');
    console.log('  const { addFixRecord } = require("./auto_fix_history");');
    console.log('  addFixRecord(file, issue, fixApplied, expectedEffect);');
    process.exit(0);
  }

  try {
    switch (command) {
      case 'add':
        cmdAdd(args.slice(1));
        break;
      case 'list':
        cmdList(args.slice(1));
        break;
      case 'stats':
        cmdStats();
        break;
      case 'verify':
        cmdVerify(args.slice(1));
        break;
      default:
        log('red', `❌ 未知命令: ${command}`);
        process.exit(1);
    }
  } catch (e) {
    log('red', `❌ Error: ${e.message}`);
    process.exit(1);
  }
}

// ==================== EXPORTS (for programmatic use) ====================
module.exports = { addFixRecord, readHistory, writeHistory };
