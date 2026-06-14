#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// ==================== HKT TIME HELPER ====================
/**
 * Session Recovery - 啟動時自動恢復
 * 每次新 session 啟動時運行，檢查並恢復重要狀態
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const { MEMORY_DIR, WS: WORKSPACE_DIR } = require('./lib/config');
const STATE_FILE = path.join(MEMORY_DIR, 'session-state.json');
const { getHKTDate } = require('./lib/time');
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE);
function createDefaultState() {
  try {
    return {
      version: "1.0",
      lastUpdated: new Date().toISOString(),
      pendingTasks: [],
      inProgress: {
        stockListProcessing: false,
        rapaportUpdatePending: false,
        showStockCheckDev: false
      },
      streamingArchive: {
        enabled: true,
        lastArchive: "",
        messageCount: 0
      },
      cronStatus: {
        dailySummary: { lastRun: "", nextScheduled: "" },
        memoryArchive: { lastRun: "", nextScheduled: "" }
      },
      reminders: []
    };
  } catch (e) {
    console.error(`❌ createDefaultState error: ${e.message}`);
    return { version: "1.0", pendingTasks: [], inProgress: {}, streamingArchive: {}, cronStatus: {}, reminders: [] };
  }
}
/**
 * 檢查是否有進行中任務
 */
function checkInProgressTasks(state) {
  try {
    const tasks = [];

    if (state.inProgress.stockListProcessing) {
      tasks.push('📋 Stock List 處理中 - 需要完成整合');
    }
    if (state.inProgress.rapaportUpdatePending) {
      tasks.push('💎 Rapaport 價格更新 - 等待新 PDF');
    }
    if (state.inProgress.showStockCheckDev) {
      tasks.push('📱 Show Stock Check App - 開發進行中');
    }

    return tasks;
  } catch (e) {
    console.error(`❌ checkInProgressTasks error: ${e.message}`);
    return [];
  }
}

/**
 * 檢查 Cron 任務狀態
 */
function checkCronStatus() {
  try {
    let result;
    try {
      result = execSync('openclaw cron list --json', { encoding: 'utf8', timeout: 10000 });
    } catch (e) {
      console.error(`⚠️ 無法執行 cron list: ${e.message}`);
      return ['⚠️ 無法檢查 Cron 狀態'];
    }

    let data;
    try {
      data = JSON.parse(result);
    } catch (e) {
      console.error('⚠️ Failed to parse session data:', e.message);
      return null;
    }

    const issues = [];

    for (const job of data.jobs || []) {
      if (job.state?.lastStatus === 'error') {
        issues.push(`⚠️ ${job.name}: ${job.state?.lastError || 'Unknown error'}`);
      }
      if (job.state?.lastRunAtMs) {
        const lastRun = new Date(job.state.lastRunAtMs);
        const hoursAgo = (Date.now() - lastRun) / (1000 * 60 * 60);

        // 如果是每日任務但超過 25 小時未運行
        if (job.schedule?.kind === 'cron' && hoursAgo > 25) {
          issues.push(`⏰ ${job.name}: 已超過 ${Math.round(hoursAgo)} 小時未運行`);
        }
      }
    }

    return issues;
  } catch (err) {
    console.error(`❌ checkCronStatus error: ${err.message}`);
    return ['⚠️ 無法檢查 Cron 狀態'];
  }
}

/**
 * 檢查 Streaming Archive 狀態
 */
function checkStreamingArchive(state) {
  try {
    const issues = [];

    if (!state.streamingArchive.enabled) {
      issues.push('📝 Streaming Archive 已停用 - 建議重新啟動');
    } else if (state.streamingArchive.lastArchive) {
      const lastArchive = new Date(state.streamingArchive.lastArchive);
      const hoursAgo = (Date.now() - lastArchive) / (1000 * 60 * 60);

      if (hoursAgo > 5) {
        issues.push(`📝 Streaming Archive: 已 ${Math.round(hoursAgo)} 小時未備份`);
      }
    }

    return issues;
  } catch (e) {
    console.error(`❌ checkStreamingArchive error: ${e.message}`);
    return [];
  }
}

/**
 * 檢查今日待辦
 */
function checkTodayReminders(state) {
  try {
    const today = getHKTDate();
    const dueToday = state.reminders.filter(r => {
      if (!r.dueDate) return false;
      return r.dueDate <= today && !r.completed;
    });

    return dueToday.map(r => `📌 ${r.text}${r.priority === 'high' ? ' (重要)' : ''}`);
  } catch (e) {
    console.error(`❌ checkTodayReminders error: ${e.message}`);
    return [];
  }
}

/**
 * 檢查 Token 狀態
 */
function checkTokenStatus() {
  try {
    // check_token.js 已移除，直接返回空數組
    return [];
  } catch (e) {
    console.error(`❌ checkTokenStatus error: ${e.message}`);
    return [];
  }
}

/**
 * 生成恢復報告
 */
function generateRecoveryReport(state) {
  try {
    log('\n' + '='.repeat(50));
    log('🔄 SESSION RECOVERY REPORT');
    log('='.repeat(50));

    const sections = [];

    // 1. 進行中任務
    const inProgress = checkInProgressTasks(state);
    if (inProgress.length > 0) {
      sections.push({
        title: '📋 進行中任務',
        items: inProgress
      });
    }

    // 2. Cron 問題
    const cronIssues = checkCronStatus();
    if (cronIssues.length > 0) {
      sections.push({
        title: '⏰ Cron 任務狀態',
        items: cronIssues
      });
    }

    // 3. Streaming Archive
    const archiveIssues = checkStreamingArchive(state);
    if (archiveIssues.length > 0) {
      sections.push({
        title: '📝 備份狀態',
        items: archiveIssues
      });
    }

    // 4. 今日提醒
    const reminders = checkTodayReminders(state);
    if (reminders.length > 0) {
      sections.push({
        title: '📌 今日待辦',
        items: reminders
      });
    }

    // 5. Token 警告
    const tokenWarnings = checkTokenStatus();
    if (tokenWarnings.length > 0) {
      sections.push({
        title: '⚠️ Token 狀態',
        items: tokenWarnings
      });
    }

    // 顯示報告
    if (sections.length === 0) {
      log('\n✅ 所有系統運作正常，無需恢復');
    } else {
      for (const section of sections) {
        log(`\n${section.title}`);
        log('-'.repeat(30));
        for (const item of section.items) {
          log(`  ${item}`);
        }
      }
    }

    log('\n' + '='.repeat(50));
    log(`📅 Recovery check completed at ${new Date().toLocaleString('zh-HK')}`);
    log('='.repeat(50) + '\n');

    return sections;
  } catch (e) {
    console.error(`❌ generateRecoveryReport error: ${e.message}`);
    return [];
  }
}

/**
 * 自動修復動作
 */
function autoFix(state) {
  try {
    const fixes = [];

    // 重新啟動 streaming archive 如果需要
    if (!state.streamingArchive.enabled) {
      try {
        // Use spawn instead of execSync with & to properly handle background process
        const child = spawn('node', ['scripts/streaming_archive.js'], {
          cwd: WORKSPACE_DIR,
          detached: true,
          stdio: 'ignore'
        });
        child.unref(); // Allow parent to exit independently
        fixes.push('✅ 已重新啟動 Streaming Archive');
        state.streamingArchive.enabled = true;
      } catch (err) {
        fixes.push('❌ 無法啟動 Streaming Archive');
      }
    }

    return fixes;
  } catch (e) {
    console.error(`❌ autoFix error: ${e.message}`);
    return [];
  }
}

/**
 * 主函數
 */
function runRecovery() {
  try {
    log('\n🔄 Starting Session Recovery...\n');

    // 載入狀態
    const state = loadState();

    // 生成報告
    const report = generateRecoveryReport(state);

    // 自動修復
    const fixes = autoFix(state);
    if (fixes.length > 0) {
      log('🔧 自動修復:');
      for (const fix of fixes) {
        log(`  ${fix}`);
      }
      log('');
    }

    // 保存更新後的狀態
    saveState(state);

    // 返回摘要給與層調用
    return {
      hasIssues: report.length > 0,
      issues: report,
      fixes: fixes,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    console.error(`❌ runRecovery error: ${e.message}`);
    return { hasIssues: true, issues: [], fixes: [], timestamp: new Date().toISOString() };
  }
}

// 如果直接運行
if (require.main === module) {
  runRecovery();
}

module.exports = {
  runRecovery,
  loadState,
  saveState,
  checkInProgressTasks,
  checkCronStatus
};
