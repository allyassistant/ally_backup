#!/usr/bin/env node
/**
 * 系統健康綜合檢查腳本
 * System Health Comprehensive Checker
 * 
 * 檢查項目：
 * 1. Daily Summary Cron Job 健康狀況
 * 2. Token 使用量監控
 * 3. 備份驗證狀態
 * 4. 磁碟空間檢查
 * 5. 記憶體使用情況
 * 
 * 用法: node scripts/system_health_check.js [--report]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATE_FILE = path.join(__dirname, '..', 'memory', 'system-health-state.json');
const LOG_FILE = path.join(__dirname, '..', 'memory', 'system-health.log');

// 顏色輸出
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(msg, level = 'info') {
  const timestamp = new Date().toISOString();
  const color = level === 'error' ? colors.red : level === 'warn' ? colors.yellow : colors.green;
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
  console.log(`${color}${msg}${colors.reset}`);
}

/**
 * 1. 檢查 Daily Summary 是否存在
 */
function checkDailySummary() {
  const scriptPath = path.join(__dirname, 'check_daily_summary.applescript');
  
  // 寫入 AppleScript 檔案
  const appleScript = `
tell application "Notes"
  set theFolder to folder "Ally's Daily"
  set noteCount to 0
  repeat with eachNote in notes of theFolder
    if name of eachNote contains "2026年2月14日" or name of eachNote contains "2026-02-14" then
      set noteCount to noteCount + 1
    end if
  end repeat
  return noteCount
end tell
`;
  fs.writeFileSync(scriptPath, appleScript);
  
  try {
    const result = execSync(`osascript "${scriptPath}"`, { encoding: 'utf8', timeout: 10000 });
    const count = parseInt(result.trim()) || 0;
    // Use trash instead of unlink for safety
    execSync(`trash "${scriptPath}"`, { stdio: 'ignore' });
    return {
      status: count > 0 ? 'healthy' : 'warning',
      message: count > 0 ? `Found ${count} summary(ies) for today` : 'Daily summary missing',
      count
    };
  } catch (e) {
    if (fs.existsSync(scriptPath)) {
      try { execSync(`trash "${scriptPath}"`, { stdio: 'ignore' }); } catch {}
    }
    return { status: 'error', message: 'Failed to check Apple Notes', error: e.message };
  }
}

/**
 * 2. 檢查 Token 使用量
 */
function checkTokenUsage() {
  try {
    const stateFile = path.join(__dirname, '..', 'memory', 'heartbeat-state.json');
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      
      // 優先讀取 main session 的 percentage
      let mainPercentage = 0;
      if (state.lastCheck?.breakdown) {
        // 找 agent:main:main
        const mainSession = state.lastCheck.breakdown.find(b => b.key === 'agent:main:main');
        if (mainSession) {
          mainPercentage = parseFloat(mainSession.percentage);
        }
      }
      
      let status = 'healthy';
      if (mainPercentage > 70) status = 'critical';
      else if (mainPercentage > 50) status = 'warning';
      
      return {
        status,
        percentage: mainPercentage.toFixed(2) + '%',
        message: `Token usage: ${mainPercentage.toFixed(2)}%`,
        lastCheck: state.lastCheck?.timestamp
      };
    }
    return { status: 'unknown', message: 'No token data found' };
  } catch (e) {
    return { status: 'error', message: 'Failed to check token', error: e.message };
  }
}

/**
 * 3. 檢查備份驗證狀態
 */
function checkBackupVerification() {
  try {
    const stateFile = path.join(__dirname, '..', 'memory', 'backup-verification-state.json');
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const lastVerify = state.lastVerification;
      const failedCount = state.stats?.totalFailed || 0;
      
      let status = 'healthy';
      if (failedCount > 5) status = 'critical';
      else if (failedCount > 0) status = 'warning';
      
      // lastVerification 可能是一個對象或時間戳
      let lastVerifyStr = 'never';
      if (lastVerify) {
        if (typeof lastVerify === 'string') {
          lastVerifyStr = lastVerify;
        } else if (lastVerify.timestamp) {
          lastVerifyStr = lastVerify.timestamp;
        } else if (lastVerify.checks && lastVerify.checks.length > 0) {
          lastVerifyStr = lastVerify.checks[lastVerify.checks.length - 1].verifiedAt || 'recent';
        }
      }
      
      return {
        status,
        message: `Last verification: ${lastVerifyStr} | Failed: ${failedCount}`,
        lastVerification: lastVerifyStr,
        failedCount
      };
    }
    return { status: 'unknown', message: 'No verification data' };
  } catch (e) {
    return { status: 'error', message: 'Failed to check backup state', error: e.message };
  }
}

/**
 * 4. 檢查磁碟空間
 */
function checkDiskSpace() {
  try {
    const result = execSync('df -h / | tail -1', { encoding: 'utf8' });
    const parts = result.trim().split(/\s+/);
    const used = parseInt(parts[4]);
    
    let status = 'healthy';
    if (used > 90) status = 'critical';
    else if (used > 80) status = 'warning';
    
    return {
      status,
      used: parts[4],
      available: parts[3],
      message: `Disk usage: ${parts[4]} used, ${parts[3]} available`
    };
  } catch (e) {
    return { status: 'error', message: 'Failed to check disk space' };
  }
}

/**
 * 5. 檢查記憶體使用
 */
function checkMemory() {
  try {
    const result = execSync('vm_stat | head -10', { encoding: 'utf8' });
    const lines = result.split('\n');
    
    // 解析記憶體統計
    const getValue = (line) => {
      const match = line.match(/(\d+)/);
      return match ? parseInt(match[1]) * 4096 / (1024 * 1024 * 1024) : 0;
    };
    
    const free = getValue(lines[0] || '');
    const active = getValue(lines[1] || '');
    const total = free + active;
    const usedPercent = Math.round((active / total) * 100);
    
    let status = 'healthy';
    if (usedPercent > 90) status = 'critical';
    else if (usedPercent > 80) status = 'warning';
    
    return {
      status,
      used: usedPercent + '%',
      message: `Memory: ${usedPercent}% used`
    };
  } catch (e) {
    return { status: 'error', message: 'Failed to check memory' };
  }
}

/**
 * 生成健康評分
 */
function calculateHealthScore(checks) {
  const weights = {
    dailySummary: 25,
    token: 25,
    backup: 20,
    disk: 15,
    memory: 15
  };
  
  let score = 0;
  let maxScore = 0;
  
  for (const [key, weight] of Object.entries(weights)) {
    const check = checks[key];
    maxScore += weight;
    if (check?.status === 'healthy') score += weight;
    else if (check?.status === 'warning') score += weight * 0.5;
    // critical 或 error 不加分
  }
  
  return Math.round((score / maxScore) * 100);
}

/**
 * 主函數
 */
function main() {
  const args = process.argv.slice(2);
  const reportMode = args.includes('--report');
  
  log('=== 系統健康檢查開始 ===');
  
  const checks = {
    dailySummary: checkDailySummary(),
    token: checkTokenUsage(),
    backup: checkBackupVerification(),
    disk: checkDiskSpace(),
    memory: checkMemory()
  };
  
  const healthScore = calculateHealthScore(checks);
  
  // 輸出結果
  console.log('\n' + colors.blue + '═══════════════════════════════════════' + colors.reset);
  console.log(colors.blue + '       系統健康檢查報告' + colors.reset);
  console.log(colors.blue + '═══════════════════════════════════════' + colors.reset + '\n');
  
  const statusEmoji = {
    healthy: '✅',
    warning: '⚠️',
    critical: '❌',
    error: '❌',
    unknown: '❓'
  };
  
  for (const [name, check] of Object.entries(checks)) {
    const emoji = statusEmoji[check.status] || '❓';
    const color = check.status === 'healthy' ? colors.green : 
                   check.status === 'warning' ? colors.yellow : colors.red;
    console.log(`${emoji} ${name}: ${color}${check.message}${colors.reset}`);
  }
  
  console.log('\n' + colors.blue + '───────────────────────────────────────' + colors.reset);
  const scoreColor = healthScore >= 80 ? colors.green : healthScore >= 60 ? colors.yellow : colors.red;
  console.log(`📊 健康評分: ${scoreColor}${healthScore}%${colors.reset}`);
  console.log(colors.blue + '───────────────────────────────────────' + colors.reset + '\n');
  
  // 保存狀態
  const state = {
    lastCheck: new Date().toISOString(),
    healthScore,
    checks,
    alerts: []
  };
  
  // 添加警告
  for (const [name, check] of Object.entries(checks)) {
    if (check.status === 'warning' || check.status === 'critical') {
      state.alerts.push({
        timestamp: new Date().toISOString(),
        check: name,
        status: check.status,
        message: check.message
      });
    }
  }
  
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  
  log(`健康檢查完成。評分: ${healthScore}%`);
  
  // Report mode: 輸出 JSON
  if (reportMode) {
    console.log('\n---JSON_OUTPUT---');
    console.log(JSON.stringify(state, null, 2));
  }
  
  // 如果有 critical 警告，返回錯誤碼
  const hasCritical = Object.values(checks).some(c => c.status === 'critical');
  process.exit(hasCritical ? 1 : 0);
}

main();
