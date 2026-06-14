#!/usr/bin/env node

/**
 * Cron Job 健康檢查腳本
 * 自動檢查 OpenClaw cron jobs 既運行狀態
 * 
 * 使用方法: node scripts/cron_health_check.js
 */

const CRON_STATE_FILE = '/Users/ally/.openclaw/workspace/memory/cron-job-state.json';

// 預設既 daily summary cron jobs 要檢查
const CRITICAL_JOBS = [
  'daily_summary',
  'heartbeat',
  'token_monitor',
  'backup_status'
];

function loadCronState() {
  try {
    const fs = require('fs');
    if (fs.existsSync(CRON_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(CRON_STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading cron state:', e.message);
  }
  return { jobs: {} };
}

function saveCronState(state) {
  const fs = require('fs');
  fs.writeFileSync(CRON_STATE_FILE, JSON.stringify(state, null, 2));
}

function saveCronState(state) {
  const fs = require('fs');
  fs.writeFileSync(CRON_STATE_FILE, JSON.stringify(state, null, 2));
}

function updateCronJobState(jobId, status, details = {}) {
  const state = loadCronState();
  if (!state.jobs) state.jobs = {};
  
  state.jobs[jobId] = {
    lastRun: Date.now(),
    lastStatus: status,
    ...details,
    updatedAt: new Date().toISOString()
  };
  
  saveCronState(state);
  console.log(`📝 Updated cron state: ${jobId} = ${status}`);
}

function checkJobHealth(jobId) {
  const state = loadCronState();
  const job = state.jobs[jobId];
  
  if (!job) {
    return { status: 'unknown', lastRun: null, error: 'No record found' };
  }
  
  const now = Date.now();
  const lastRun = job.lastRun || 0;
  const timeSinceLastRun = now - lastRun;
  
  // 檢查是否係 recent run (24 小時內)
  const isRecent = timeSinceLastRun < 24 * 60 * 60 * 1000;
  
  // 檢查 last status
  const isSuccess = job.lastStatus === 'success';
  
  return {
    status: isRecent ? (isSuccess ? 'healthy' : 'failed') : 'stale',
    lastRun: job.lastRun,
    lastStatus: job.lastStatus,
    timeSinceLastRun: Math.round(timeSinceLastRun / (1000 * 60)) + ' mins ago'
  };
}

function generateReport() {
  console.log('=== Cron Job 健康檢查 ===\n');
  
  const criticalJobs = CRITICAL_JOBS;
  let allHealthy = true;
  
  criticalJobs.forEach(jobId => {
    const health = checkJobHealth(jobId);
    const statusIcon = health.status === 'healthy' ? '✅' : 
                       health.status === 'failed' ? '❌' : 
                       health.status === 'stale' ? '⚠️' : '❓';
    
    console.log(`${statusIcon} ${jobId}`);
    console.log(`   Status: ${health.status}`);
    if (health.lastRun) {
      console.log(`   Last Run: ${health.timeSinceLastRun}`);
      console.log(`   Last Status: ${health.lastStatus}`);
    } else {
      console.log(`   Error: ${health.error}`);
    }
    console.log('');
    
    if (health.status !== 'healthy') {
      allHealthy = false;
    }
  });
  
  // Overall status
  console.log('=== 總結 ===');
  if (allHealthy) {
    console.log('✅ 所有 Critical Jobs 運行正常');
    return 0;
  } else {
    console.log('⚠️ 有 Jobs 需要關注');
    return 1;
  }
}

// Export for use in other scripts
module.exports = { checkJobHealth, generateReport, updateCronJobState };

// Run if called directly
if (require.main === module) {
  process.exit(generateReport());
}
