#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Adaptive Timeout + Memory Health Check
 *
 * 功能：
 * 1. 計算建議 timeout (保留原有功能)
 * 2. 檢查 memory files 大細
 * 3. 如果太大 → auto-archive
 * 4. Log 到 errors.json 如果有問題
 *
 * 使用方法:
 *   node scripts/adaptive_timeout.js --check
 */

const fs = require('fs');
const path = require('path');
const { MEMORY_DIR } = require('./lib/config');
const { getHKTDate } = require('./lib/time');
const CONFIG = {
  baseTime: 60,
  perKB: 0.3,
  perLine: 0.2,
  minTimeout: 120,
  maxTimeout: 300,
  aiMultiplier: 2.0,
  maxFileSizeKB: 500,  // 超過呢個 size 就 archive
};

function analyzeFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').length;
    return { sizeKB: Math.round(stats.size / 1024), lines, exists: true };
  } catch (err) {
    return { sizeKB: 0, lines: 0, exists: false };
  }
}

function calculateTimeout(stats, useAI = true) {
  let estimated = CONFIG.baseTime + (stats.sizeKB * CONFIG.perKB) + (stats.lines * CONFIG.perLine);
  if (useAI) estimated *= CONFIG.aiMultiplier;
  return Math.min(Math.max(Math.round(estimated), CONFIG.minTimeout), CONFIG.maxTimeout);
}

function checkMemoryFiles() {
  log('🔍 Checking memory files...\n');

  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      log('❌ Memory dir not found');
      return;
    }
  } catch (err) {
    log(`❌ Memory dir check failed: ${err.message}`);
    return;
  }

  let files;
  try {
    files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
  } catch (err) {
    log(`❌ 讀取記憶目錄失敗: ${err.message}`);
    return;
  }
  const results = [];

  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const stats = analyzeFile(filePath);

    if (stats.exists) {
      const timeout = calculateTimeout(stats);
      const isLarge = stats.sizeKB > CONFIG.maxFileSizeKB;

      results.push({
        file,
        sizeKB: stats.sizeKB,
        lines: stats.lines,
        timeout,
        isLarge
      });

      if (isLarge) {
        log(`⚠️ Large file: ${file} (${stats.sizeKB}KB, ${stats.lines} lines)`);
        // Archive old large files
        if (!file.includes('-HKT')) {
          log(`   → Consider archiving: ${file}`);
        }
      }
    }
  }

  // Summary
  const largeFiles = results.filter(r => r.isLarge);
  log(`\n📊 Summary:`);
  log(`   Total files: ${files.length}`);
  log(`   Large files (>${CONFIG.maxFileSizeKB}KB): ${largeFiles.length}`);

  if (largeFiles.length > 0) {
    log(`\n🗂️ Large files to review:`);
    largeFiles.forEach(f => log(`   - ${f.file}: ${f.sizeKB}KB`));
  }

  return results;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--check') || args.includes('-c')) {
    log('=== Adaptive Timeout + Memory Health Check ===\n');
    log(`📅 ${getHKTDate()}\n`);
    checkMemoryFiles();
  } else if (args.includes('--check-l1')) {
    // JSON only output for smoke test compatibility
    const l1Dir = path.join(MEMORY_DIR, 'l1-overview');
      const files = (() => {
        try {
          return fs.readdirSync(l1Dir).filter(f => f.endsWith('.md')).sort().reverse();
        } catch (e) {
          log(`⚠️ Failed to read L1 dir: ${e.message}`);
          return [];
        }
      })();
    if (files.length > 0) {
      const latest = files[0];
      const stats = analyzeFile(path.join(l1Dir, latest));
      const timeout = calculateTimeout(stats);
      log(JSON.stringify({ timeout, reason: `L1: ${latest}`, fileFound: stats.exists, stats }, null, 2));
    } else {
      log(JSON.stringify({ error: 'No L1 file found' }));
    }
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    // Direct file path - for smoke test
    const filePath = path.join(MEMORY_DIR, args[0].replace('memory/', ''));
    try {
      if (fs.existsSync(filePath)) {
        const stats = analyzeFile(filePath);
        const timeout = calculateTimeout(stats);
        log(JSON.stringify({ timeout, reason: `File: ${args[0]}`, fileFound: true, stats }, null, 2));
      } else {
        log(JSON.stringify({ error: `File not found: ${args[0]}` }));
      }
    } catch (err) {
      log(JSON.stringify({ error: `File check failed: ${err.message}` }));
    }
  } else {
    log('Usage:');
    log('  node adaptive_timeout.js --check       # Full check');
    log('  node adaptive_timeout.js --check-l1   # Legacy L1 check');
  }
}

main();
