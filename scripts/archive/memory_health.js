#!/usr/bin/env node
/**
 * Memory Health - Combined Memory Sanitizer + Error AutoFix
 * 合併原因：減少 cron jobs 數量
 * 自動檢測路徑
 */

const os = require('os');
const { execSync } = require('child_process');

// Auto-detect machine
const HOME = process.env.HOME || os.homedir();
const isBliss = HOME.includes('bliss');
const WS_PATH = HOME + '/.openclaw/workspace';
const NODE = process.execPath;

console.log(`=== Memory Health Check (${isBliss ? 'Bliss' : 'Ally'}) ===\n`);

// 1. Memory Sanitizer
console.log('[1/2] Running Memory Sanitizer...');
try {
  execSync(`${NODE} ${WS_PATH}/scripts/memory_sanitizer.js --auto`, {
    cwd: WS_PATH,
    stdio: 'inherit'
  });
} catch (e) {
  console.log('⚠️ Sanitizer completed with warnings');
}

// 2. Error AutoFix
console.log('\n[2/2] Running Error AutoFix...');
try {
  execSync(`${NODE} ${WS_PATH}/scripts/error_autofix_v2.js`, {
    cwd: WS_PATH,
    stdio: 'inherit'
  });
} catch (e) {
  console.log('⚠️ AutoFix completed with warnings');
}

console.log('\n✅ Memory Health Check Complete');
