#!/usr/bin/env node
/**
 * 錯誤恢復自動化系統
 * Error Recovery Automation
 * 
 * 功能：
 * 1. 檢測系統錯誤（腳本失敗、服務中斷）
 * 2. 自動診斷常見問題
 * 3. 嘗試自動修復
 * 4. 記錄錯誤歷史和修復結果
 * 
 * 用法:
 *   node scripts/error_recovery.js diagnose        # 診斷系統狀態
 *   node scripts/error_recovery.js fix <issue>      # 修復指定問題
 *   node scripts/error_recovery.js history          # 查看錯誤歷史
 * 
 * Created: 2026-02-15 (Qwen3 Training - Module 1)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATE_FILE = path.join(__dirname, '..', 'memory', 'error-recovery-state.json');
const MAX_HISTORY = 50;
const { createStateManager } = require('../lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE);

// ===== 狀態管理 =====
function logError(state, category, description, resolution) {
  state.history.push({
    time: new Date().toISOString(),
    category,
    description,
    resolution,
    autoFixed: resolution !== 'manual_required'
  });
}

// ===== 診斷檢查 =====

const CHECKS = [
  {
    name: 'gateway_running',
    category: 'service',
    check: () => {
      try {
        const result = execSync('pgrep -f "openclaw" 2>/dev/null || echo ""', { encoding: 'utf8', timeout: 5000 });
        return result.trim() !== '';
      } catch { return false; }
    },
    fix: () => {
      try {
        execSync('openclaw gateway start 2>/dev/null', { encoding: 'utf8', timeout: 15000 });
        return true;
      } catch { return false; }
    },
    description: 'OpenClaw Gateway 是否運行'
  },
  {
    name: 'disk_space',
    category: 'resource',
    check: () => {
      try {
        const result = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: 'utf8', timeout: 5000 });
        const usage = parseInt(result.replace('%', ''));
        return usage < 90;
      } catch { return true; } // 默認通過
    },
    fix: () => {
      // 清理常見大文件
      try {
        execSync('find /tmp -name "*.tmp" -mtime +7 -delete 2>/dev/null || true', { encoding: 'utf8', timeout: 10000 });
        return true;
      } catch { return false; }
    },
    description: '磁碟空間是否足夠 (<90%)'
  },
  {
    name: 'memory_dir',
    category: 'filesystem',
    check: () => {
      const memDir = path.join(__dirname, '..', 'memory');
      return fs.existsSync(memDir);
    },
    fix: () => {
      try {
        const memDir = path.join(__dirname, '..', 'memory');
        fs.mkdirSync(memDir, { recursive: true });
        return true;
      } catch { return false; }
    },
    description: 'memory/ 目錄是否存在'
  },
  {
    name: 'heartbeat_state',
    category: 'state_file',
    check: () => {
      const stateFile = path.join(__dirname, '..', 'memory', 'heartbeat-state.json');
      if (!fs.existsSync(stateFile)) return false;
      try {
        JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return true;
      } catch { return false; }
    },
    fix: () => {
      const stateFile = path.join(__dirname, '..', 'memory', 'heartbeat-state.json');
      try {
        if (!fs.existsSync(stateFile)) {
          fs.writeFileSync(stateFile, JSON.stringify({
            lastCheck: { timestamp: new Date().toISOString(), percentage: 0 },
            history: [],
            alerts: { lastAlert: null }
          }, null, 2));
        } else {
          // 嘗試修復損壞的 JSON
          const content = fs.readFileSync(stateFile, 'utf8');
          // 如果無法解析，重置
          try { JSON.parse(content); } catch {
            fs.writeFileSync(stateFile, JSON.stringify({
              lastCheck: { timestamp: new Date().toISOString(), percentage: 0 },
              history: [],
              alerts: { lastAlert: null },
              note: 'Reset by error_recovery.js'
            }, null, 2));
          }
        }
        return true;
      } catch { return false; }
    },
    description: 'heartbeat-state.json 是否正常'
  },
  {
    name: 'scripts_executable',
    category: 'permission',
    check: () => {
      const scriptsDir = path.join(__dirname);
      const criticalScripts = ['check_token.js', 'archive_smart.js', 'daily_summary.js'];
      return criticalScripts.every(s => fs.existsSync(path.join(scriptsDir, s)));
    },
    fix: () => {
      // 只能報告缺少的腳本
      const scriptsDir = path.join(__dirname);
      const criticalScripts = ['check_token.js', 'archive_smart.js', 'daily_summary.js'];
      const missing = criticalScripts.filter(s => !fs.existsSync(path.join(scriptsDir, s)));
      if (missing.length > 0) {
        console.log(`   缺少腳本：${missing.join(', ')}`);
        return false;
      }
      return true;
    },
    description: '關鍵腳本是否存在'
  },
  {
    name: 'json_state_files',
    category: 'state_file',
    check: () => {
      const memDir = path.join(__dirname, '..', 'memory');
      const stateFiles = fs.readdirSync(memDir).filter(f => f.endsWith('.json'));
      let allValid = true;
      for (const file of stateFiles) {
        try {
          JSON.parse(fs.readFileSync(path.join(memDir, file), 'utf8'));
        } catch {
          console.log(`   ⚠️ 損壞的 JSON：${file}`);
          allValid = false;
        }
      }
      return allValid;
    },
    fix: () => {
      // 備份並重置損壞的 JSON
      const memDir = path.join(__dirname, '..', 'memory');
      const stateFiles = fs.readdirSync(memDir).filter(f => f.endsWith('.json'));
      let fixed = 0;
      for (const file of stateFiles) {
        const filePath = path.join(memDir, file);
        try {
          JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
          // 備份損壞文件
          const backupPath = filePath + '.corrupted.' + Date.now();
          fs.copyFileSync(filePath, backupPath);
          fs.writeFileSync(filePath, '{}');
          console.log(`   🔧 已重置：${file} (備份: ${path.basename(backupPath)})`);
          fixed++;
        }
      }
      return fixed > 0;
    },
    description: 'JSON 狀態文件是否有效'
  }
];

// ===== 診斷主函數 =====

function diagnose() {
  console.log('\n🔍 系統診斷');
  console.log('─'.repeat(40));

  const state = loadState();
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const check of CHECKS) {
    process.stdout.write(`检查 ${check.description}... `);
    const ok = check.check();
    results.push({ ...check, passed: ok });

    if (ok) {
      console.log('✅');
      passed++;
    } else {
      console.log('❌');
      failed++;
      logError(state, check.category, `Check failed: ${check.name}`, 'diagnosed');
    }
  }

  console.log('\n─'.repeat(40));
  console.log(`結果：✅ ${passed} 通過 / ❌ ${failed} 失敗`);

  state.lastDiagnosis = {
    time: new Date().toISOString(),
    passed,
    failed,
    total: CHECKS.length,
    score: Math.round((passed / CHECKS.length) * 100)
  };
  saveState(state);

  if (failed > 0) {
    console.log('\n💡 運行 `node scripts/error_recovery.js fix all` 嘗試自動修復');
  }

  return results;
}

function fixIssues(target) {
  console.log('\n🔧 自動修復');
  console.log('─'.repeat(40));

  const state = loadState();
  let fixed = 0;
  let failed = 0;

  const checksToFix = target === 'all' 
    ? CHECKS 
    : CHECKS.filter(c => c.name === target);

  if (checksToFix.length === 0) {
    console.log(`❌ 未知的修復目標：${target}`);
    console.log(`可用目標：${CHECKS.map(c => c.name).join(', ')}`);
    return;
  }

  for (const check of checksToFix) {
    const ok = check.check();
    if (ok) {
      console.log(`✅ ${check.description} - 正常，跳過`);
      continue;
    }

    process.stdout.write(`🔧 修復 ${check.description}... `);
    const fixResult = check.fix();

    if (fixResult) {
      console.log('✅ 已修復');
      fixed++;
      logError(state, check.category, `Fixed: ${check.name}`, 'auto_fixed');
    } else {
      console.log('❌ 需要手動處理');
      failed++;
      logError(state, check.category, `Fix failed: ${check.name}`, 'manual_required');
    }
  }

  state.autoFixes += fixed;
  saveState(state);

  console.log(`\n結果：✅ ${fixed} 已修復 / ❌ ${failed} 需手動處理`);
}

function showHistory() {
  const state = loadState();

  console.log('\n📜 錯誤歷史');
  console.log('─'.repeat(40));

  if (state.history.length === 0) {
    console.log('（無記錄）');
    return;
  }

  const recent = state.history.slice(-10);
  for (const entry of recent) {
    const time = new Date(entry.time).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    const emoji = entry.autoFixed ? '🔧' : '⚠️';
    console.log(`${emoji} [${time}] ${entry.category}: ${entry.description}`);
    console.log(`   → ${entry.resolution}`);
  }

  console.log(`\n總計：${state.history.length} 條記錄`);
  console.log(`自動修復：${state.autoFixes} 次`);

  if (state.lastDiagnosis) {
    console.log(`\n最後診斷：${new Date(state.lastDiagnosis.time).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
    console.log(`   健康評分：${state.lastDiagnosis.score}/100`);
  }
}

// ===== 主程序 =====

const command = process.argv[2] || 'diagnose';

switch (command) {
  case 'diagnose':
    diagnose();
    break;
  case 'fix':
    fixIssues(process.argv[3] || 'all');
    break;
  case 'history':
    showHistory();
    break;
  default:
    console.log('用法：');
    console.log('  node error_recovery.js diagnose       - 診斷系統');
    console.log('  node error_recovery.js fix [target]    - 自動修復');
    console.log('  node error_recovery.js history         - 查看歷史');
}
