#!/usr/bin/env node
/**
 * Heartbeat-triggered Archive
 * 用於 OpenClaw Cron 每日歸檔
 */

const { archiveOldFiles } = require('./archive_smart.js');

// 執行歸檔
const result = archiveOldFiles();

// 輸出結果 (給 cron log)
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  action: 'daily_archive',
  ...result
}));
