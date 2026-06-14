#!/usr/bin/env node
/**
 * Cron Job 健康監控器
 * Cron Job Health Monitor
 * 
 * 功能：
 * 1. 檢查所有 cron job 執行狀態
 * 2. 檢測失敗/跳過的 job
 * 3. 自動重啟失敗的 job
 * 4. 生成健康報告
 * 
 * 用法: 
 *   node scripts/cron_health_monitor.js           # 檢查所有 jobs
 *   node scripts/cron_health_monitor.js --report   # 生成報告
 *   node scripts/cron_health_monitor.js --fix      # 自動修復失敗 jobs
 * 
 * Created: 2026-02-15 (Qwen3 Training - Module 1)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATE_FILE = path.join(__dirname, '..', 'memory', 'cron-health-state.json');
const { createStateManager } = require('../lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE);

// ===== 狀態管理 =====
// ===== Cron Job 檢查 =====

function getCronJobs() {
  try {
    const result = execSync('openclaw cron list --json 2>/dev/null', {
      encoding: 'utf8',
      timeout: 10000
    });
    return JSON.parse(result);
  } catch (e) {
    // Fallback: try reading from gateway config
    console.log('⚠️ 無法通過 CLI 獲取 cron jobs，嘗試讀取配置...');
    return null;
  }
}

function getCronRuns(jobId) {
  try {
    const result = execSync(`openclaw cron runs ${jobId} --json 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 10000
    });
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// ===== 健康評估 =====

function evaluateJobHealth(job, runs) {
  const health = {
    jobId: job.id || job.jobId,
    name: job.name || 'unnamed',
    enabled: job.enabled !== false,
    score: 100,
    issues: [],
    lastRun: null,
    consecutiveFailures: 0
  };

  if (!health.enabled) {
    health.score = 0;
    health.issues.push('Job 已停用');
    return health;
  }

  if (!runs || runs.length === 0) {
    health.score = 50;
    health.issues.push('從未運行過');
    return health;
  }

  // 檢查最後一次運行
  const lastRun = runs[0];
  health.lastRun = lastRun;

  // 檢查最後運行時間
  const lastRunTime = new Date(lastRun.startedAt || lastRun.time);
  const hoursSinceLastRun = (Date.now() - lastRunTime.getTime()) / (1000 * 60 * 60);

  // 判斷 schedule 類型來決定是否延遲
  if (job.schedule) {
    if (job.schedule.kind === 'every') {
      const intervalHours = (job.schedule.everyMs || 0) / (1000 * 60 * 60);
      if (hoursSinceLastRun > intervalHours * 2) {
        health.score -= 30;
        health.issues.push(`延遲運行：距離上次 ${Math.round(hoursSinceLastRun)}h (預期 ${intervalHours}h)`);
      }
    } else if (job.schedule.kind === 'cron') {
      // 對於 cron 表達式，超過 48 小時才報警
      if (hoursSinceLastRun > 48) {
        health.score -= 20;
        health.issues.push(`超過 48 小時未運行`);
      }
    }
  }

  // 檢查連續失敗
  let consecutiveFails = 0;
  for (const run of runs) {
    if (run.status === 'failed' || run.error) {
      consecutiveFails++;
    } else {
      break;
    }
  }
  health.consecutiveFailures = consecutiveFails;

  if (consecutiveFails >= 3) {
    health.score -= 40;
    health.issues.push(`連續 ${consecutiveFails} 次失敗`);
  } else if (consecutiveFails >= 1) {
    health.score -= 15;
    health.issues.push(`最近 ${consecutiveFails} 次失敗`);
  }

  // 計算成功率（最近 10 次）
  const recent = runs.slice(0, 10);
  const successCount = recent.filter(r => r.status === 'completed' || r.status === 'success' || (!r.error)).length;
  const successRate = Math.round((successCount / recent.length) * 100);

  if (successRate < 50) {
    health.score -= 25;
    health.issues.push(`成功率低：${successRate}%`);
  } else if (successRate < 80) {
    health.score -= 10;
    health.issues.push(`成功率：${successRate}%`);
  }

  health.score = Math.max(0, health.score);
  return health;
}

// ===== 報告生成 =====

function generateReport(healthResults) {
  const now = new Date();
  const lines = [];

  lines.push('📊 Cron Job 健康報告');
  lines.push(`時間：${now.toISOString()}`);
  lines.push('─'.repeat(40));

  let totalScore = 0;
  let jobCount = 0;

  for (const health of healthResults) {
    jobCount++;
    totalScore += health.score;

    const emoji = health.score >= 80 ? '🟢' : health.score >= 50 ? '🟡' : '🔴';
    lines.push(`\n${emoji} ${health.name} (${health.score}/100)`);

    if (health.issues.length > 0) {
      health.issues.forEach(issue => lines.push(`   ⚠️ ${issue}`));
    }

    if (health.lastRun) {
      const lastTime = new Date(health.lastRun.startedAt || health.lastRun.time);
      lines.push(`   📅 上次運行：${lastTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
    }
  }

  const avgScore = jobCount > 0 ? Math.round(totalScore / jobCount) : 0;
  lines.push('\n' + '─'.repeat(40));
  lines.push(`📈 整體健康：${avgScore}/100`);
  lines.push(`   總計 ${jobCount} 個 jobs`);

  const criticalJobs = healthResults.filter(h => h.score < 50);
  if (criticalJobs.length > 0) {
    lines.push(`   🔴 ${criticalJobs.length} 個需要注意`);
  }

  return lines.join('\n');
}

// ===== 自動修復 =====

function attemptFix(healthResults) {
  const fixed = [];
  const failed = [];

  for (const health of healthResults) {
    if (health.score < 50 && health.consecutiveFailures >= 3) {
      console.log(`🔧 嘗試修復：${health.name}...`);

      try {
        // 嘗試重新觸發 job
        execSync(`openclaw cron run ${health.jobId} 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 30000
        });
        fixed.push(health.name);
        console.log(`   ✅ 已重新觸發`);
      } catch (e) {
        failed.push({ name: health.name, error: e.message });
        console.log(`   ❌ 修復失敗：${e.message}`);
      }
    }
  }

  return { fixed, failed };
}

// ===== 主程序 =====

async function main() {
  const args = process.argv.slice(2);
  const isReport = args.includes('--report');
  const isFix = args.includes('--fix');

  console.log('\n🔍 Cron Job 健康監控');
  console.log('─'.repeat(40));

  const state = loadState();
  const jobs = getCronJobs();

  if (!jobs) {
    console.log('❌ 無法獲取 cron jobs 列表');
    console.log('💡 請確認 OpenClaw gateway 正在運行');
    process.exit(1);
  }

  const jobList = Array.isArray(jobs) ? jobs : (jobs.jobs || []);
  console.log(`📋 找到 ${jobList.length} 個 cron jobs\n`);

  const healthResults = [];

  for (const job of jobList) {
    const jobId = job.id || job.jobId;
    const runs = getCronRuns(jobId);
    const health = evaluateJobHealth(job, runs ? (Array.isArray(runs) ? runs : runs.runs || []) : []);
    healthResults.push(health);
  }

  // 更新狀態
  state.lastCheck = new Date().toISOString();
  state.jobs = {};
  healthResults.forEach(h => {
    state.jobs[h.jobId] = {
      name: h.name,
      score: h.score,
      issues: h.issues,
      lastChecked: state.lastCheck
    };
  });
  saveState(state);

  if (isReport) {
    const report = generateReport(healthResults);
    console.log(report);

    // 寫入報告文件
    const reportFile = path.join(__dirname, '..', 'memory', 'cron-health-report.txt');
    fs.writeFileSync(reportFile, report);
    console.log(`\n📄 報告已寫入：${reportFile}`);
  } else {
    // 簡要輸出
    for (const h of healthResults) {
      const emoji = h.score >= 80 ? '🟢' : h.score >= 50 ? '🟡' : '🔴';
      console.log(`${emoji} ${h.name}: ${h.score}/100${h.issues.length > 0 ? ' - ' + h.issues[0] : ''}`);
    }
  }

  if (isFix) {
    console.log('\n🔧 自動修復模式...');
    const { fixed, failed } = attemptFix(healthResults);
    if (fixed.length > 0) console.log(`✅ 已修復：${fixed.join(', ')}`);
    if (failed.length > 0) console.log(`❌ 修復失敗：${failed.map(f => f.name).join(', ')}`);
  }

  // 檢查是否需要發送警報
  const criticalJobs = healthResults.filter(h => h.score < 30);
  if (criticalJobs.length > 0) {
    const alertMsg = `🔴 Cron 健康警報\n${criticalJobs.map(j => `• ${j.name}: ${j.score}/100`).join('\n')}`;
    const alertFile = path.join(__dirname, '..', 'memory', 'cron-health-alert.json');
    fs.writeFileSync(alertFile, JSON.stringify({
      pending: true,
      message: alertMsg,
      critical: criticalJobs.map(j => j.name),
      createdAt: new Date().toISOString()
    }, null, 2));
    console.log('\n⚠️ 已生成警報文件');
  }

  console.log('\n✅ 健康檢查完成');
}

main().catch(err => {
  console.error('❌ 錯誤:', err.message);
  process.exit(1);
});
