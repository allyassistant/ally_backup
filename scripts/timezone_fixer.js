#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Timezone Fixer - 系統時間修復工具
 * 檢查並修復所有使用 UTC 時間嘅腳本
 */

const fs = require('fs');
const path = require('path');

const { SCRIPTS_DIR } = require('./lib/config');

// 已經修復嘅腳本（有 getHKTDate 函數）
const alreadyFixed = [
  'issue_manager.js',
  'issue_daily_report.js',
  'memory_cleanup.js',
  'auto_remember.js',
  'issue_reminders_sync.js'
];

// 需要修復嘅常用模式
const patterns = [
  {
    name: 'Date string for filenames/logs',
    pattern: /new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/g,
    replacement: "new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })"
  },
  {
    name: 'Date string comparison',
    pattern: /new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/g,
    replacement: "getHKTDate()"
  }
];

function checkScript(filename) {
  try {
    const filePath = path.join(SCRIPTS_DIR, filename);
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf-8');

  // 檢查是否已有 HKT 修復
  if (content.includes('getHKTDate') || content.includes('Asia/Hong_Kong')) {
    return { filename, status: 'already_fixed' };
  }

  // 檢查是否有 UTC 時間使用
  const utcPatterns = [
    /new Date\(\)\.toISOString\(\)/,
    /\.toISOString\(\)\.split\('T'\)\[0\]/,
    /new Date\(\)\.toISOString\(\)\.split\('T'\)/
  ];

  let hasUTC = false;
  let matches = [];

  for (const pattern of utcPatterns) {
    const match = content.match(pattern);
    if (match) {
      hasUTC = true;
      matches.push(match[0]);
    }
  }

  if (hasUTC) {
    return { filename, status: 'needs_fix', matches: [...new Set(matches)] };
  }

    return { filename, status: 'no_time' };
  } catch (err) {
    console.error(`⚠️ checkScript error for ${filename}: ${err.message}`);
    return null;
  }
}

function main() {
  try {
    log('🔍 檢查系統時間設定...\n');

    const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js'));

  const results = {
    already_fixed: [],
    needs_fix: [],
    no_time: []
  };

  for (const file of files) {
    const result = checkScript(file);
    if (result) {
      results[result.status].push(result);
    }
  }

  log(`✅ 已修復 (${results.already_fixed.length}):`);
  for (const item of results.already_fixed) {
    log(`   - ${path.basename(item.filename)}`);
  }

  log(`\n⚠️  需要修復 (${results.needs_fix.length}):`);
  for (const item of results.needs_fix) {
    log(`   - ${path.basename(item.filename)}`);
    if (item.matches) {
      log(`     模式: ${item.matches.join(', ').substring(0, 60)}...`);
    }
  }

  log(`\n📋 無時間相關 (${results.no_time.length}):`);
  log(`   (略)`);

    log(`\n總計: ${files.length} 個腳本`);
    log(`建議: 優先修復 ${Math.min(results.needs_fix.length, 10)} 個核心腳本`);
  } catch (err) {
    console.error(`❌ main error: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkScript };
