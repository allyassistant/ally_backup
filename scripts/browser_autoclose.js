#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Browser Auto Close Script
 * 每小時自動關閉 OpenClaw Browser
 * 防止 browser tabs 累積
 */

const { execFileSync } = require('child_process');

log('[Browser Auto-Close] Starting...');

try {
  // 檢查 browser 狀態
  log('[Browser Auto-Close] Checking browser status...');
  
  // 嘗試關閉所有 browser profiles
  const profiles = ['chrome', 'openclaw'];
  
  for (const profile of profiles) {
    try {
      log(`[Browser Auto-Close] Stopping ${profile}...`);
      execFileSync('openclaw', ['browser', 'stop', '--browser-profile', profile], { 
        stdio: 'pipe',
        timeout: 10000 
      });
      log(`[Browser Auto-Close] ${profile} stopped successfully`);
    } catch (e) {
      // 如果 browser 未運行，會報錯，我哋可以忽略
      log(`[Browser Auto-Close] ${profile} may not be running: ${e.message}`);
    }
  }
  
  log('[Browser Auto-Close] Done!');
  process.exit(0);
  
} catch (error) {
  console.error('[Browser Auto-Close] Error:', error.message);
  process.exit(1);
}
