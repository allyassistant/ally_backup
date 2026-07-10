#!/usr/bin/env node
/**
 * anomaly_monitor.js — 系統異常監控器
 *
 * 用途：監控 cron job output、error frequency、script runtime 等指標，
 *       同歷史 baseline 比對，發現異常即推送到 Discord #⚙️系統。
 *
 * 用法：
 *   node anomaly_monitor.js              # 正常執行
 *   node anomaly_monitor.js --quiet      # 安靜模式（for cron）
 *   node anomaly_monitor.js --dry-run    # 只顯示，唔寫入 baseline
 *   node anomaly_monitor.js status       # 顯示當前 baseline stats
 *
 * 整合：應放喺 cron job pipeline 嘅最後一步
 * 建議 cron: 每日 06:00 同 18:00
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { BaselineStore } = require('./lib/baseline_store');

// ============================================================
// 配置
// ============================================================

const CONFIG = {
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace'),
  ERROR_FILE: 'memory/errors.json',
  MEMORY_L0_DIR: 'memory/l0-abstract',
  MEMORY_L1_DIR: 'memory/l1-overview',
  ISSUES_DIR: '.issues/active',
  DISCORD_ALERT_CHANNEL: '1473376125584670872',  // #⚙️系統
  CQM_FILE: 'code_quality_report.json',
  quiet: false,
  dryRun: false,
};

// ============================================================
// Metric 收集
// ============================================================

function getErrorCount() {
  try {
    const content = fs.readFileSync(path.join(CONFIG.WORKSPACE_DIR, CONFIG.ERROR_FILE), 'utf8');
    const data = JSON.parse(content);
    const errors = Array.isArray(data) ? data : (data.errors || []);
    return errors.filter(e => e.resolved !== true).length;
  } catch {
    return 0;
  }
}

function getOutputFileSizes() {
  const results = {};

  // L0 目錄
  try {
    const l0Files = fs.readdirSync(path.join(CONFIG.WORKSPACE_DIR, CONFIG.MEMORY_L0_DIR))
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f, size: fs.statSync(path.join(CONFIG.WORKSPACE_DIR, CONFIG.MEMORY_L0_DIR, f)).size }));
    if (l0Files.length > 0) {
      results.l0_total_files = l0Files.length;
      results.l0_latest_size = l0Files.sort((a, b) => b.name.localeCompare(a.name))[0].size;
    }
  } catch { /* skip */ }

  // L1 目錄
  try {
    const l1Files = fs.readdirSync(path.join(CONFIG.WORKSPACE_DIR, CONFIG.MEMORY_L1_DIR))
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f, size: fs.statSync(path.join(CONFIG.WORKSPACE_DIR, CONFIG.MEMORY_L1_DIR, f)).size }));
    if (l1Files.length > 0) {
      results.l1_total_files = l1Files.length;
      results.l1_latest_size = l1Files.sort((a, b) => b.name.localeCompare(a.name))[0].size;
    }
  } catch { /* skip */ }

  return results;
}

function getCqmIssueCount() {
  try {
    const content = fs.readFileSync(path.join(CONFIG.WORKSPACE_DIR, CONFIG.CQM_FILE), 'utf8');
    const data = JSON.parse(content);
    const issues = data.issues || data.summary || [];
    return typeof issues === 'number' ? issues : (Array.isArray(issues) ? issues.length : 0);
  } catch {
    return 0;
  }
}

function getDiskUsage() {
  try {
    const stdout = execSync('df -h / | tail -1', { encoding: 'utf8', timeout: 5000 });
    const parts = stdout.trim().split(/\s+/);
    const usedPercent = parseInt(parts[4]?.replace('%', '') || '0');
    const available = parts[3] || '0';
    return { usedPercent, available };
  } catch {
    return { usedPercent: 0, available: '0' };
  }
}

function getMemoryUsage() {
  try {
    const stdout = execSync('vm_stat | head -10', { encoding: 'utf8', timeout: 5000 });
    // Quick parse: get page size and free pages
    const pageSize = parseInt(stdout.match(/page size of (\d+)/)?.[1] || '16384');
    const freePages = parseInt(stdout.match(/Pages free:\s+(\d+)/)?.[1] || '0');
    const activePages = parseInt(stdout.match(/Pages active:\s+(\d+)/)?.[1] || '0');
    const totalPages = freePages + activePages;
    return {
      freeGB: Math.round((freePages * pageSize) / (1024 * 1024 * 1024) * 100) / 100,
      activeGB: Math.round((activePages * pageSize) / (1024 * 1024 * 1024) * 100) / 100,
    };
  } catch {
    return { freeGB: 0, activeGB: 0 };
  }
}

// ============================================================
// 監控 + 記錄
// ============================================================

async function monitor(dryRun = false) {
  const store = new BaselineStore();
  const alerts = [];

  if (!CONFIG.quiet) console.log('🔍 Running anomaly monitor...\n');

  // 1. Error count
  const errorCount = getErrorCount();
  store.record('error_tracker.active_count', errorCount);
  const errorBaseline = store.getBaseline('error_tracker.active_count');
  if (errorBaseline.isAnomaly) {
    alerts.push({
      icon: '📊',
      title: 'Error Count Anomaly',
      message: `Active errors: ${errorCount} (baseline ${errorBaseline.avg} ±${errorBaseline.stddev})`,
      detail: `${((errorCount - errorBaseline.avg) / errorBaseline.stddev).toFixed(1)}σ above normal`,
    });
  }
  if (!CONFIG.quiet) console.log(`   Error count: ${errorCount} ${errorBaseline.isAnomaly ? '🚨' : '✅'}`);

  // 2. Output file sizes
  const sizes = getOutputFileSizes();
  for (const [key, value] of Object.entries(sizes)) {
    store.record(key, value);
    const bl = store.getBaseline(key);
    if (bl.isAnomaly) {
      const direction = value > bl.avg ? '↑ larger' : '↓ smaller';
      alerts.push({
        icon: '📦',
        title: `Output Size Anomaly — ${key}`,
        message: `Current: ${value} (baseline ${bl.avg} ±${bl.stddev})`,
        detail: `${direction} than normal by ${Math.abs(value - bl.avg).toFixed(0)}`,
      });
    }
  }

  // 3. CQM issues
  const cqmCount = getCqmIssueCount();
  store.record('cqm.active_issues', cqmCount);
  const cqmBaseline = store.getBaseline('cqm.active_issues');
  if (cqmBaseline.isAnomaly) {
    alerts.push({
      icon: '🔍',
      title: 'Code Quality Issues Anomaly',
      message: `Active issues: ${cqmCount} (baseline ${cqmBaseline.avg} ±${cqmBaseline.stddev})`,
      detail: `${((cqmCount - cqmBaseline.avg) / cqmBaseline.stddev).toFixed(1)}σ from normal`,
    });
  }
  if (!CONFIG.quiet) console.log(`   CQM issues: ${cqmCount} ${cqmBaseline.isAnomaly ? '🚨' : '✅'}`);

  // 4. Disk usage
  const disk = getDiskUsage();
  store.record('system.disk_used_percent', disk.usedPercent);
  const diskBaseline = store.getBaseline('system.disk_used_percent');
  if (disk.usedPercent > 85) {
    alerts.push({
      icon: '💾',
      title: 'Disk Usage Warning',
      message: `${disk.usedPercent}% used (${disk.available} free)`,
      detail: 'Above 85% threshold — consider cleanup',
    });
  }
  if (!CONFIG.quiet) console.log(`   Disk: ${disk.usedPercent}% used ✅`);

  // 5. Save baseline (unless dry run)
  if (!dryRun) {
    store._save();
  }

  // Output
  if (!CONFIG.quiet) console.log(`\n   Alerts: ${alerts.length}`);

  return {
    alerts,
    summary: {
      errorCount,
      ...sizes,
      cqmCount,
      diskUsed: disk.usedPercent,
      diskAvailable: disk.available,
    },
    timestamp: new Date().toISOString(),
  };
}

// ============================================================
// Discord 推送
// ============================================================

async function pushAlert(result) {
  if (result.alerts.length === 0) {
    if (!CONFIG.quiet) console.log('   ✅ No anomalies detected — skipping alert');
    return;
  }

  const { REST } = require('@discordjs/rest');
  const { Routes } = require('discord-api-types/v10');

  // Try to get Discord token
  let token;
  try {
    token = process.env.DISCORD_TOKEN;
    if (!token) {
      // Try gateway config
      const configPath = path.join(process.env.HOME || '/Users/ally', '.openclaw', '.runtime.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        token = config.discord?.token || config.token;
      }
    }
  } catch { /* can't get token */ }

  if (!token) {
    // Fallback: just log
    const alertFile = path.join(CONFIG.WORKSPACE_DIR, '.last_anomaly_alerts.json');
    try {
      fs.writeFileSync(alertFile, JSON.stringify(result.alerts, null, 2), 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
    if (!CONFIG.quiet) console.log(`   ⚠️ No Discord token — alerts saved to .last_anomaly_alerts.json`);
    return;
  }

  try {
    const rest = new REST({ version: '10' }).setToken(token);

    const embed = {
      title: '🚨 Anomaly Monitor Alert',
      color: 0xFF6600,
      fields: result.alerts.map(a => ({
        name: `${a.icon} ${a.title}`,
        value: `${a.message}\n${a.detail}`,
        inline: false,
      })),
      timestamp: result.timestamp,
    };

    await rest.post(Routes.channelMessages(CONFIG.DISCORD_ALERT_CHANNEL), {
      body: { embeds: [embed] },
    });
    if (!CONFIG.quiet) console.log(`   📨 Alert sent to #⚙️系統`);
  } catch (e) {
    console.error(`   ❌ Discord push failed: ${e.message}`);
  }
}

// ============================================================
// Status
// ============================================================

function showStatus() {
  const store = new BaselineStore();
  const keys = store.getKeys();

  console.log('📊 Anomaly Monitor — Baseline Status\n');

  if (keys.length === 0) {
    console.log('   No baseline data yet. Run monitor first to collect data.');
    return;
  }

  for (const key of keys.sort()) {
    const bl = store.getBaseline(key);
    const latest = store.getSamples(key, 1)[0];
    const marker = bl.isAnomaly ? '🚨' : '✅';
    console.log(`   ${marker} ${key}`);
    console.log(`      avg: ${bl.avg ?? '-'}  ±${bl.stddev ?? '-'}  (${bl.count} samples)`);
    console.log(`      last: ${latest?.value ?? '-'}`);
    console.log('');
  }

  const anomalies = store.getAnomalies();
  if (anomalies.length > 0) {
    console.log(`   🚨 ${anomalies.length} active anomalies`);
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  CONFIG.quiet = args.includes('--quiet');
  CONFIG.dryRun = args.includes('--dry-run');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Anomaly Monitor v1.0
Usage:
  node anomaly_monitor.js              # Run + send alerts
  node anomaly_monitor.js --dry-run    # Preview only
  node anomaly_monitor.js --quiet      # Silent (for cron)
  node anomaly_monitor.js status       # Show baseline stats
`);
    return;
  }

  if (args.includes('status')) {
    showStatus();
    return;
  }

  const result = await monitor(CONFIG.dryRun);

  if (!CONFIG.dryRun) {
    await pushAlert(result);
  }

  if (!CONFIG.quiet) {
    console.log(`\n✅ Done. (${result.alerts.length} alerts)`);
    if (CONFIG.dryRun) {
      console.log('   (Dry run — baseline NOT updated)');
    }
  }

  // Exit with code 1 if there are alerts (for cron monitoring)
  if (result.alerts.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(e => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}

module.exports = { monitor, BaselineStore };
