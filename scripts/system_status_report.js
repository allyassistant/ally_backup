#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

const safeFs = require('./lib/safe_fs');
const { getHKTDateTime } = require('./lib/time');

function getSystemStatus() {
  const status = {
    timestamp: getHKTDateTime(),
    checks: {}
  };

  // check_token.js 已移除，跳過 token 檢查
  status.checks.token = 'n/a';

  // backup_status_tracker.js 已移除，跳過備份檢查
  status.checks.backups = 'n/a';

  return status;
}

function formatReport(status) {
  const date = new Date().toLocaleDateString('zh-HK');
  const time = new Date().toLocaleTimeString('zh-HK');

  let report = `📊 系統狀態報告\n${date} ${time}\n\n`;
  report += `Token 用量: ${status.checks.token}%\n`;
  report += `備份狀態: ${status.checks.backups === 'healthy' ? '✅ 正常' : '⚠️ 警告'}\n`;

  return report;
}

function main() {
  log('Generating system status report...');
  const status = getSystemStatus();
  const report = formatReport(status);

  log(report);

  // Send WhatsApp if issues detected
  if (status.checks.backups !== 'healthy' || status.checks.token > 50) {
    log('Issues detected - would send WhatsApp alert');
  }
}

main();
