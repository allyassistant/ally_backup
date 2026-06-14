#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Health Monitor - 系統監控腳本 (優化版)
 * 監控: CPU、內存、磁盤、錯誤頻率、Cron狀態、Memory文件完整性
 *
 * 使用方法:
 *   node health_monitor.js           # 默認輸出
 *   node health_monitor.js --cron    # 靜默模式 (用於Heartbeat)
 *   node health_monitor.js --json    # JSON輸出
 *   node health_monitor.js --notify  # 發送Discord通知
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { MEMORY_DIR, ERRORS_JSON } = require('./lib/config');

const PAGE_SIZE_BYTES = 16384;
const ONE_HOUR_MS = 3600 * 1000;

// 配置
const CONFIG = {
  errorsFile: ERRORS_JSON,
  memoryDir: MEMORY_DIR,
  discordChannel: process.env.DISCORD_SYSTEM_CHANNEL_ID || '1473376125584670872',
  thresholds: {
    cpu: { warning: 4.0, critical: 8.0 },     // load average
    memory: { warning: 80, critical: 90 },     // percentage
    errors: { warning: 5, critical: 10 },      // per hour
    disk: { warning: 85, critical: 95 }        // percentage
  }
};

// 警報級別
const ALERTS = {
  OK: '🟢',
  WARNING: '🟡',
  CRITICAL: '🟠',
  EMERGENCY: '🔴'
};

// 解析命令行參數
const args = process.argv.slice(2);
const isCronMode = args.includes('--cron');
const isJsonMode = args.includes('--json');
const shouldNotify = args.includes('--notify');
const { getHKTDate } = require('./lib/time');

// 獲取香港時間
function getHKTTime() {
  const now = new Date();
  return now.toLocaleString('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// 獲取當前日期 (HKT)
// 將內存字符串轉換為 GB
function parseMemoryToGB(str) {
  const match = str.match(/([\d.]+)([GM])/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2];
  return unit === 'G' ? value : value / 1024;
}

// 系統檢測: 使用 vm_stat 獲取準確的 Memory，top 獲取 CPU
function checkSystem() {
  try {
    // 獲取 CPU 信息從 top
    const topOutput = execSync('top -l 1').toString();

    // 解析 CPU - 格式: CPU usage: X% user, Y% sys, Z% idle
    const cpuMatch = topOutput.match(/CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys,\s*([\d.]+)%\s*idle/);
    const loadMatch = topOutput.match(/Load Avg:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);

    // 獲取準確的 Memory 信息從 vm_stat
    const vmStatOutput = execSync('vm_stat').toString();

    // 解析 vm_stat - 獲取 page 數量
    const pagesFree = parseInt(vmStatOutput.match(/Pages free:\s+(\d+)/)?.[1] || '0');
    const pagesActive = parseInt(vmStatOutput.match(/Pages active:\s+(\d+)/)?.[1] || '0');
    const pagesInactive = parseInt(vmStatOutput.match(/Pages inactive:\s+(\d+)/)?.[1] || '0');
    const pagesWired = parseInt(vmStatOutput.match(/Pages wired down:\s+(\d+)/)?.[1] || '0');
    const pagesCompressed = parseInt(vmStatOutput.match(/Pages occupied by compressor:\s+(\d+)/)?.[1] || '0');

    // 獲取 page size (通常是 16384 bytes on Apple Silicon)
    let pageSize = PAGE_SIZE_BYTES;
    try {
      const pageSizeOutput = execSync('sysctl -n vm.pagesize 2>/dev/null || echo 16384').toString().trim();
      pageSize = parseInt(pageSizeOutput) || PAGE_SIZE_BYTES;
    } catch (e) {
      // 使用默認值 PAGE_SIZE_BYTES
    }

    // 獲取總內存 (GB)
    let totalGB = 16;
    try {
      const memSizeOutput = execSync('sysctl -n hw.memsize 2>/dev/null || echo 17179869184').toString().trim();
      totalGB = parseInt(memSizeOutput) / (1024 * 1024 * 1024);
    } catch (e) {
      // 使用默認值 16GB
    }

    if (!cpuMatch || !loadMatch) {
      return {
        status: 'error',
        alert: ALERTS.CRITICAL,
        message: '無法解析系統信息'
      };
    }

    const cpuIdle = parseFloat(cpuMatch[3]);
    const load1min = parseFloat(loadMatch[1]);

    // 獲取CPU核心數用於正規化負載
    let cores = 1;
    try {
      cores = parseInt(execSync('sysctl -n hw.ncpu 2>/dev/null || echo 1').toString().trim());
    } catch (e) {
      // 默認為1
    }

    const normalizedLoad = load1min / cores;

    // 正確的內存計算 - 使用 vm_stat
    // free = pagesFree * pageSize
    // used = total - free (這樣計算最準確)
    const freeBytes = pagesFree * pageSize;
    const freeGB = freeBytes / (1024 * 1024 * 1024);
    const usedGB = totalGB - freeGB;
    const memPercent = Math.round((usedGB / totalGB) * 100);

    // 判斷狀態
    let alertLevel = ALERTS.OK;
    let status = 'OK';

    if (normalizedLoad >= CONFIG.thresholds.cpu.critical || memPercent >= CONFIG.thresholds.memory.critical) {
      alertLevel = ALERTS.CRITICAL;
      status = 'CRITICAL';
    } else if (normalizedLoad >= CONFIG.thresholds.cpu.warning || memPercent >= CONFIG.thresholds.memory.warning) {
      alertLevel = ALERTS.WARNING;
      status = 'WARNING';
    }

    return {
      status: status,
      alert: alertLevel,
      cpuIdle: cpuIdle.toFixed(1),
      load: load1min.toFixed(2),
      cores: cores,
      memUsedGB: usedGB.toFixed(1),
      memTotalGB: totalGB.toFixed(0),
      memPercent: memPercent,
      memFreeGB: freeGB.toFixed(1),
      message: `CPU ${cpuIdle.toFixed(0)}% idle, Mem ${usedGB.toFixed(1)}G/${totalGB.toFixed(0)}G (${memPercent}%), ${freeGB.toFixed(0)}G free`
    };
  } catch (error) {
    return {
      status: 'error',
      alert: ALERTS.CRITICAL,
      message: error.message
    };
  }
}

// 系統檢測: 磁盤空間 (top 沒有 disk 信息，保留 df)
function checkDisk() {
  try {
    const output = execSync('df -h /').toString().trim();
    const lines = output.split('\n');
    const dataLine = lines[1];
    const parts = dataLine.split(/\s+/);

    const used = parseInt(parts[4].replace('%', ''));
    const available = parts[3];
    const size = parts[1];

    let alertLevel = ALERTS.OK;
    let status = 'OK';

    if (used >= CONFIG.thresholds.disk.critical) {
      alertLevel = ALERTS.CRITICAL;
      status = 'CRITICAL';
    } else if (used >= CONFIG.thresholds.disk.warning) {
      alertLevel = ALERTS.WARNING;
      status = 'WARNING';
    }

    return {
      status: status,
      alert: alertLevel,
      value: used,
      available: available,
      size: size,
      message: `${used}% used`
    };
  } catch (error) {
    return { status: 'error', alert: ALERTS.CRITICAL, value: 'N/A', message: error.message };
  }
}

// Error 頻率檢查
function checkErrors() {
  try {
    if (!fs.existsSync(CONFIG.errorsFile)) {
      return { status: 'OK', alert: ALERTS.OK, count: 0, message: '0 last hour' };
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(CONFIG.errorsFile, 'utf8'));
    } catch (e) {
      console.error('⚠️ Failed to parse errors file:', e.message);
      return [];
    }
    // 兼容兩種格式
    let errors = [];
    if (Array.isArray(data)) {
      errors = data;
    } else if (data.errors) {
      errors = data.errors;
    }

    const oneHourAgo = Date.now() - ONE_HOUR_MS;
    const recentErrors = errors.filter(e => {
      const timestamp = new Date(e.timestamp || e.date).getTime();
      return timestamp > oneHourAgo;
    });

    const count = recentErrors.length;
    let alertLevel = ALERTS.OK;
    let status = 'OK';

    if (count >= CONFIG.thresholds.errors.critical) {
      alertLevel = ALERTS.CRITICAL;
      status = 'CRITICAL';
    } else if (count >= CONFIG.thresholds.errors.warning) {
      alertLevel = ALERTS.WARNING;
      status = 'WARNING';
    }

    return {
      status: status,
      alert: alertLevel,
      count: count,
      recent: recentErrors.slice(0, 3).map(e => e.title || e.id),
      message: `${count} last hour`
    };
  } catch (error) {
    return { status: 'error', alert: ALERTS.WARNING, count: 0, message: error.message };
  }
}

// Cron Job 狀態檢查 (OpenClaw Gateway Cron Jobs)
function checkCron() {
  const requiredJobs = [
    { pattern: /l0|abstract/i, name: 'L0 Abstract' },
    { pattern: /l1|overview/i, name: 'L1 Overview' },
    { pattern: /memory.*(health|cleanup|session|deep)|deep.*cleanup/i, name: 'Memory Related' },
    { pattern: /error|weekly.*correction/i, name: 'Error/Maintenance' },
    { pattern: /daily.*summary/i, name: 'Daily Summary' }
  ];

  let jobs = [];
  let source = 'unknown';

  // 方法 1: 使用 openclaw cron list --json
  try {
    const output = execSync('openclaw cron list --json 2>/dev/null || echo "{}"').toString();
    let data;
    try {
      data = JSON.parse(output);
    } catch (e) {
      console.error('⚠️ Failed to parse output:', e.message);
      return { healthy: false, issues: ['Failed to parse check output'] };
    }
    jobs = data.jobs || [];
    source = 'gateway';
  } catch (error) {
    // Fallback 到檢查 cron-status.json
    const statusFile = path.join(__dirname, '..', 'memory', 'cron-status.json');
    try {
      if (fs.existsSync(statusFile)) {
        let data;
        try {
          data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        } catch (e) {
          console.error(`⚠️ Failed to parse status file:`, e.message);
          return {
            status: 'error',
            alert: ALERTS.CRITICAL,
            message: 'Failed to check cron jobs',
            error: e.message
          };
        }
        jobs = data.jobs || data.cronJobs || [];
        source = 'status-file';
      }
    } catch (fallbackError) {
      // 兩種方法都失敗
      return {
        status: 'error',
        alert: ALERTS.WARNING,
        message: 'Cannot fetch cron jobs',
        error: fallbackError.message
      };
    }
  }

  // 檢查每個 required job 是否存在
  const missingJobs = [];
  const foundJobs = [];

  requiredJobs.forEach(job => {
    const found = jobs.some(j => {
      const jobName = (j.name || j.command || j.schedule || '').toString();
      return job.pattern.test(jobName);
    });
    if (found) {
      foundJobs.push(job.name);
    } else {
      missingJobs.push(job.name);
    }
  });

  let alertLevel = ALERTS.OK;
  let status = 'OK';
  let message = `${foundJobs.length}/${requiredJobs.length} jobs active (${source})`;

  if (missingJobs.length > 2) {
    alertLevel = ALERTS.CRITICAL;
    status = 'CRITICAL';
    message = `${missingJobs.length} jobs missing`;
  } else if (missingJobs.length > 0) {
    alertLevel = ALERTS.WARNING;
    status = 'WARNING';
    message = `${missingJobs.length} jobs missing: ${missingJobs.join(', ')}`;
  }

  return {
    status: status,
    alert: alertLevel,
    totalJobs: jobs.length,
    requiredFound: foundJobs.length,
    requiredTotal: requiredJobs.length,
    missingJobs: missingJobs,
    source: source,
    message: message
  };
}

// Gateway 狀態檢測
function checkGateway() {
  try {
    const output = execSync('openclaw status 2>&1').toString();

    // 檢查 Gateway service 狀態
    const gatewayMatch = output.match(/Gateway service[\s│]+([^│\n]+)/);
    if (!gatewayMatch) {
      return { status: 'error', alert: ALERTS.CRITICAL, message: 'Gateway info not found' };
    }

    const gatewayInfo = gatewayMatch[1].trim();
    const isRunning = gatewayInfo.includes('running');
    const pidMatch = gatewayInfo.match(/pid\s+(\d+)/);
    const pid = pidMatch ? pidMatch[1] : 'unknown';

    if (isRunning) {
      return { status: 'OK', alert: ALERTS.OK, message: `Running (pid ${pid})`, pid: pid };
    } else {
      return { status: 'CRITICAL', alert: ALERTS.CRITICAL, message: 'Not running', pid: null };
    }
  } catch (error) {
    return { status: 'error', alert: ALERTS.CRITICAL, message: 'Failed to check gateway', error: error.message };
  }
}

// Session 數量檢測
function checkSessions() {
  try {
    const output = execSync('openclaw status 2>&1').toString();

    // 從 Sessions 行提取數量
    const sessionsMatch = output.match(/Sessions[\s│]+(\d+)\s+active/);
    if (sessionsMatch) {
      const count = parseInt(sessionsMatch[1]);
      return { status: 'OK', alert: ALERTS.OK, count: count, message: `${count} active` };
    }

    // 從 Agents 行提取 sessions 數量 (備用)
    const agentsMatch = output.match(/Agents[\s│]+[^│]+sessions\s+(\d+)/);
    if (agentsMatch) {
      const count = parseInt(agentsMatch[1]);
      return { status: 'OK', alert: ALERTS.OK, count: count, message: `${count} active` };
    }

    return { status: 'warning', alert: ALERTS.WARNING, count: 0, message: 'Unable to count' };
  } catch (error) {
    return { status: 'error', alert: ALERTS.WARNING, count: 0, message: 'Failed to check sessions' };
  }
}

// Channel 狀態檢測 (WhatsApp/Discord)
function checkChannels() {
  try {
    const output = execSync('openclaw status 2>&1').toString();

    // 提取 Channels 部分
    const channelsSection = output.match(/Channels\s+([\s\S]+?)(?=Sessions|FAQ|Security|$)/);
    if (!channelsSection) {
      return { status: 'error', alert: ALERTS.WARNING, message: 'Channels section not found' };
    }

    const section = channelsSection[1];

    // 檢查 WhatsApp
    const whatsappMatch = section.match(/WhatsApp[\s│]+(ON|OFF)[\s│]+(OK|Error|Offline)/i);
    const whatsappEnabled = whatsappMatch ? whatsappMatch[1].toUpperCase() === 'ON' : false;
    const whatsappState = whatsappMatch ? whatsappMatch[2] : 'Unknown';
    const whatsappOK = whatsappEnabled && whatsappState.toUpperCase() === 'OK';

    // 檢查 Discord
    const discordMatch = section.match(/Discord[\s│]+(ON|OFF)[\s│]+(OK|Error|Offline)/i);
    const discordEnabled = discordMatch ? discordMatch[1].toUpperCase() === 'ON' : false;
    const discordState = discordMatch ? discordMatch[2] : 'Unknown';
    const discordOK = discordEnabled && discordState.toUpperCase() === 'OK';

    const channels = [];
    if (whatsappOK) channels.push('WhatsApp OK');
    else if (whatsappEnabled) channels.push(`WhatsApp ${whatsappState}`);
    else channels.push('WhatsApp OFF');

    if (discordOK) channels.push('Discord OK');
    else if (discordEnabled) channels.push(`Discord ${discordState}`);
    else channels.push('Discord OFF');

    const allOK = whatsappOK && discordOK;
    const alertLevel = allOK ? ALERTS.OK : ALERTS.WARNING;
    const status = allOK ? 'OK' : 'WARNING';

    return {
      status: status,
      alert: alertLevel,
      whatsapp: { enabled: whatsappEnabled, state: whatsappState, ok: whatsappOK },
      discord: { enabled: discordEnabled, state: discordState, ok: discordOK },
      message: channels.join(', ')
    };
  } catch (error) {
    return { status: 'error', alert: ALERTS.WARNING, message: 'Failed to check channels' };
  }
}

// Token/Model 使用檢測
function checkModel() {
  try {
    const output = execSync('openclaw status 2>&1').toString();

    // 從 Sessions 行提取默認 model
    const modelMatch = output.match(/Sessions[\s│]+\d+\s+active[\s·]+default\s+([^\s(]+)/);
    if (modelMatch) {
      const model = modelMatch[1].trim();
      return { status: 'OK', alert: ALERTS.OK, model: model, message: model };
    }

    // 從 Agents 行提取 model (備用)
    const agentsModelMatch = output.match(/Agents[\s│]+[^│]+default\s+([^\s(]+)/i);
    if (agentsModelMatch) {
      const model = agentsModelMatch[1].trim();
      return { status: 'OK', alert: ALERTS.OK, model: model, message: model };
    }

    return { status: 'warning', alert: ALERTS.WARNING, model: 'Unknown', message: 'Unknown' };
  } catch (error) {
    return { status: 'error', alert: ALERTS.WARNING, model: 'Unknown', message: 'Failed to check model' };
  }
}

// Memory 文件完整性檢查
function checkMemoryFiles() {
  try {
    if (!fs.existsSync(CONFIG.memoryDir)) {
      return { status: 'error', alert: ALERTS.WARNING, message: 'Memory directory not found' };
    }

    const files = fs.readdirSync(CONFIG.memoryDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filepath = path.join(CONFIG.memoryDir, f);
        const stat = fs.statSync(filepath);
        return {
          name: f,
          size: stat.size,
          mtime: stat.mtime
        };
      });

    // 檢查今日文件
    const today = getHKTDate();
    const todayFiles = files.filter(f => f.name.includes(today));

    // 檢查異常文件 (大小為0或過大)
    const emptyFiles = files.filter(f => f.size === 0);
    const oversizedFiles = files.filter(f => f.size > 10 * 1024 * 1024); // >10MB

    let alertLevel = ALERTS.OK;
    let status = 'OK';
    let message = `${files.length} files OK`;

    if (emptyFiles.length > 0) {
      alertLevel = ALERTS.WARNING;
      status = 'WARNING';
      message = `${emptyFiles.length} empty files`;
    } else if (oversizedFiles.length > 0) {
      alertLevel = ALERTS.WARNING;
      status = 'WARNING';
      message = `${oversizedFiles.length} oversized files`;
    } else if (todayFiles.length === 0) {
      alertLevel = ALERTS.WARNING;
      status = 'WARNING';
      message = 'No files today';
    }

    return {
      status: status,
      alert: alertLevel,
      totalFiles: files.length,
      todayFiles: todayFiles.length,
      emptyFiles: emptyFiles.length,
      oversizedFiles: oversizedFiles.length,
      message: message
    };
  } catch (error) {
    return { status: 'error', alert: ALERTS.WARNING, message: error.message };
  }
}

// 簡化的Discord通知 (使用execFileSync避免命令注入)
function sendDiscordSimple(text) {
  try {
    // 使用 openclaw CLI 發送消息 - 使用數組參數避免 shell 注入
    const { execFileSync } = require('child_process');
    execFileSync('openclaw', ['message', 'send', '--channel', CONFIG.discordChannel, text], { stdio: 'ignore' });
    return true;
  } catch (error) {
    // 靜默失敗
    return false;
  }
}

// 主函數
async function main() {
  // 執行所有檢查
  const report = {
    time: getHKTTime(),
    timestamp: Date.now(),
    system: checkSystem(),
    disk: checkDisk(),
    errors: checkErrors(),
    cron: checkCron(),
    memoryFiles: checkMemoryFiles(),
    gateway: checkGateway(),
    sessions: checkSessions(),
    channels: checkChannels(),
    model: checkModel()
  };

  // JSON模式
  if (isJsonMode) {
    log(JSON.stringify(report, null, 2));
    return;
  }

  // Cron靜默模式 (只輸出問題和匯總)
  if (isCronMode) {
    const issues = [];

    if (report.system.status !== 'OK') issues.push(`System: ${report.system.message}`);
    if (report.disk.status !== 'OK') issues.push(`Disk: ${report.disk.message}`);
    if (report.errors.status !== 'OK') issues.push(`Errors: ${report.errors.message}`);
    if (report.cron.status !== 'OK') issues.push(`Cron: ${report.cron.message}`);
    if (report.memoryFiles.status !== 'OK') issues.push(`Memory: ${report.memoryFiles.message}`);
    if (report.gateway.status !== 'OK') issues.push(`Gateway: ${report.gateway.message}`);
    if (report.channels.status !== 'OK') issues.push(`Channels: ${report.channels.message}`);

    if (issues.length > 0) {
      log(`[${report.time}] ${ALERTS.WARNING} ${issues.length} issues detected`);
      issues.forEach(i => log(`  - ${i}`));
    } else {
      log(`[${report.time}] ${ALERTS.OK} All systems OK`);
    }
    return;
  }

  // 默認美觀輸出
  log('=== Health Monitor ===');
  log(`Time: ${report.time}`);
  log('');
  log(`${report.system.alert} System: ${report.system.message}`);
  log(`${report.disk.alert} Disk: ${report.disk.message}`);
  log(`${report.errors.alert} Errors: ${report.errors.message}`);
  log(`${report.cron.alert} Cron: ${report.cron.message}`);
  log(`${report.memoryFiles.alert} Memory Files: ${report.memoryFiles.message}`);
  log(`${report.gateway.alert} Gateway: ${report.gateway.message}`);
  log(`${report.sessions.alert} Sessions: ${report.sessions.message}`);
  log(`${report.channels.alert} Channels: ${report.channels.message}`);
  log(`${report.model.alert} Model: ${report.model.message}`);
  log('');

  // 發送Discord通知 (如果需要)
  if (shouldNotify) {
    const issues = [];
    if (report.system.status !== 'OK') issues.push(`${report.system.alert} System: ${report.system.message}`);
    if (report.disk.status !== 'OK') issues.push(`${report.disk.alert} Disk: ${report.disk.message}`);
    if (report.errors.status !== 'OK') issues.push(`${report.errors.alert} Errors: ${report.errors.message}`);
    if (report.cron.status !== 'OK') issues.push(`${report.cron.alert} Cron: ${report.cron.message}`);
    if (report.memoryFiles.status !== 'OK') issues.push(`${report.memoryFiles.alert} Memory: ${report.memoryFiles.message}`);
    if (report.gateway.status !== 'OK') issues.push(`${report.gateway.alert} Gateway: ${report.gateway.message}`);
    if (report.channels.status !== 'OK') issues.push(`${report.channels.alert} Channels: ${report.channels.message}`);

    if (issues.length > 0) {
      const text = `🩺 **Health Alert**\nTime: ${report.time}\n\n${issues.join('\n')}`;
      sendDiscordSimple(text);
    }
  }
}

// 運行
main().catch(error => {
  console.error('Health Monitor Error:', error.message);
  process.exit(1);
});
