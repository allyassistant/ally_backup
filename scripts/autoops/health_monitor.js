#!/usr/bin/env node
/**
 * Qwen3 AutoOps Health Monitor - Fixed Version
 *
 * 只喺有問題先輸出，正常時保持靜默
 *
 * Created: 2026-02-15
 * Fixed: 2026-02-15
 */

const fs = require('fs');
const { execSync } = require('child_process');

const STATE_FILE = process.env.HOME + '/.openclaw/workspace/memory/health-monitor-state.json';

function runCommand(cmd) {
  try {
    const output = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function checkSystem() {
  const results = {
    timestamp: new Date().toISOString(),
    overall: 'up',
    checks: {}
  };

  // 1. 檢查 Ollama
  const ollama = runCommand('pgrep -f "ollama serve"');
  results.checks.ollama = {
    status: ollama.success ? 'up' : 'down',
    note: ollama.success ? 'Ollama running' : 'Ollama not found'
  };

  // 2. 檢查 OpenClaw Gateway
  const gateway = runCommand('openclaw gateway status 2>&1');
  results.checks.openclaw = {
    status: gateway.success && gateway.output.includes('running') ? 'up' : 'unknown',
    note: gateway.success ? 'Gateway active' : 'Gateway check failed'
  };

  // 3. 檢查 Qwen3
  const qwen3Check = runCommand('curl -s http://localhost:11434/api/tags 2>/dev/null | head -c 100');
  results.checks.qwen3 = {
    status: qwen3Check.success ? 'up' : 'down',
    note: qwen3Check.success ? 'Qwen3 available' : 'Qwen3 not responding'
  };

  // 4. 檢查磁碟空間
  const disk = runCommand(`df -h ${process.env.HOME}/.openclaw/workspace 2>&1 | tail -1`);
  if (disk.success) {
    const parts = disk.output.split(/\s+/);
    const used = parseInt(parts[4].replace('%', ''));
    results.checks.disk = {
      status: used > 90 ? 'warning' : 'up',
      note: `Disk ${used}% used`
    };
  }

  // 計算 overall status
  const downChecks = Object.values(results.checks).filter(c => c.status === 'down').length;
  const warningChecks = Object.values(results.checks).filter(c => c.status === 'warning').length;

  if (downChecks > 0) {
    results.overall = 'down';
  } else if (warningChecks > 0) {
    results.overall = 'warning';
  } else {
    results.overall = 'up';
  }

  return results;
}

function main() {
  const results = checkSystem();

  // 保存狀態（靜默）
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      lastCheck: results.timestamp,
      overall: results.overall,
      checks: results.checks
    }, null, 2));
  } catch (e) {
    // Ignore
  }

  // 只喺有問題先輸出
  if (results.overall === 'up') {
    // 全部正常 - 靜默結束
    process.exit(0);
  }

  // 有問題 - 輸出警告
  const emoji = results.overall === 'down' ? '🔴' : '🟡';
  console.log(`${emoji} **Health Monitor Alert**`);
  console.log(`Status: ${results.overall.toUpperCase()}`);
  console.log(`Time: ${results.timestamp}\n`);

  for (const [name, check] of Object.entries(results.checks)) {
    if (check.status !== 'up') {
      const statusEmoji = check.status === 'warning' ? '⚠️' : '❌';
      console.log(`${statusEmoji} ${name}: ${check.note}`);
    }
  }

  process.exit(1);
}

main();
