#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Reminder Discussion - Optimized
 * 檢查到期的 reminders，輸出簡單列表
 *
 * 優化 (2026-03-16):
 * - 加 try-catch 錯誤處理
 * - 加 process error handling
 * - 簡化 output
 */

const { execSync } = require('child_process');

function getTodayReminders() {
  try {
    const result = execSync('remindctl today', {
      encoding: 'utf8',
      timeout: 10000
    });

    if (result.includes('No reminders')) {
      return [];
    }

    return result.trim().split('\n').filter(l => l.trim());
  } catch (err) {
    // 如果 remindctl 失敗，返回空數組
    if (err.status === 1 && err.stdout?.includes('No reminders')) {
      return [];
    }
    console.error(`⚠️ remindctl error: ${err.message}`);
    return [];
  }
}

function main() {
  try {
    const reminders = getTodayReminders();

    if (reminders.length === 0) {
      log('✅ NO_REPLY');
      return;
    }

    log(`⏰ 今日有 ${reminders.length} 個 reminders:`);
    reminders.forEach(r => log(`• ${r}`));

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

// 加全局錯誤處理
process.on('uncaughtException', (err) => {
  console.error(`❌ Uncaught: ${err.message}`);
  process.exit(1);
});

main();
