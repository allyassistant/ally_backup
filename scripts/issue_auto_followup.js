#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Issue Auto Follow-up - 智能自動跟進系統
 * Run: node scripts/issue_auto_followup.js [remind|check|auto|all]
 *
 * 功能：
 * 1. 到期提醒（到期前1日）
 * 2. 進度檢查（每週掃描長期任務）
 * 3. 自動完成（簡單任務自動執行）
 *
 * Schedule: Heartbeat 每 30 分鐘運行
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const { ISSUES_DIR, MEMORY_DIR, WS, SCRIPTS_DIR } = require('./lib/config');
const ACTIVE_DIR = path.join(ISSUES_DIR, 'active');
const BACKLOG_DIR = path.join(ISSUES_DIR, 'backlog');
const FOLLOWUP_STATE = path.join(MEMORY_DIR, 'issue-followup-state.json');
const { getHKTDate, getHKTDateTime } = require('./lib/time');
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = createStateManager(FOLLOWUP_STATE);

// ==================== HKT TIME ====================
function daysUntil(targetDate) {
  if (!targetDate || !targetDate.trim()) return null;
  const today = new Date(getHKTDate());
  const target = new Date(targetDate.trim());
  if (isNaN(target.getTime())) return null; // Invalid date
  return Math.floor((target - today) / (1000 * 60 * 60 * 24));
}

// ==================== LOAD ISSUES ====================

function loadIssues(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
  } catch (e) {
    console.error('Error checking file: ' + e.message);
    return [];
  }

  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch (err) {
    console.error(`⚠️ Failed to read directory ${dir}: ${err.message}`);
    return [];
  }

  const issues = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(dir, file), 'utf-8');
    } catch (err) {
      console.error(`⚠️ Failed to read file ${file}: ${err.message}`);
      continue;
    }

    const lines = content.split('\n');

    const frontMatter = {};
    let inFrontMatter = false;

    for (const line of lines) {
      if (line === '---') {
        inFrontMatter = !inFrontMatter;
        continue;
      }
      if (inFrontMatter) {
        // BUG FIX: Use [\w-]+ to support hyphenated keys (consistent with issue_manager.js)
        // BUG FIX: Strip surrounding quotes from YAML values
        const match = line.match(/^([\w-]+):\s*(.+)$/);
        if (match) {
          frontMatter[match[1]] = match[2].replace(/^["'](.*)["']$/, '$1');
        }
      }
    }

    if (frontMatter.id && frontMatter.title) {
      issues.push({
        id: frontMatter.id,
        title: frontMatter.title,
        status: frontMatter.status || 'active',
        priority: frontMatter.priority || 'P2',
        due: frontMatter.due || '',
        progress: frontMatter.progress || '0/0',
        updated: frontMatter.updated || frontMatter.created,
        content: content
      });
    }
  }

  return issues;
}

// ==================== STATE MANAGEMENT ====================
// ==================== 1. REMINDER TYPE ====================

function checkDueReminders(quiet = false) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  log('🔔 檢查到期提醒...\n');

  const issues = loadIssues(ACTIVE_DIR);
  const state = loadState();
  const reminders = [];

  for (const issue of issues) {
    if (!issue.due) continue;

    const daysLeft = daysUntil(issue.due);
    if (daysLeft === null) continue; // Skip invalid dates

    const dueSoonKey = `${issue.id}_due_soon`;
    const overdueKey = `${issue.id}_overdue`;

    // 到期前 1 日提醒
    if (daysLeft === 1 && state.lastReminders[dueSoonKey] !== issue.due) {
      reminders.push({
        type: 'due_soon',
        issue,
        message: `⏰ Issue #${issue.id} 明日到期: ${issue.title}`
      });
      state.lastReminders[dueSoonKey] = issue.due;
    }

    // BUG FIX: 到期當日提醒 (daysLeft === 0) — previously completely missed
    const dueTodayKey = `${issue.id}_due_today`;
    if (daysLeft === 0 && state.lastReminders[dueTodayKey] !== issue.due) {
      reminders.push({
        type: 'due_today',
        issue,
        message: `🔔 Issue #${issue.id} 今日到期！: ${issue.title}`
      });
      state.lastReminders[dueTodayKey] = issue.due;
    }

    // 緊急任務（P0/P1）每日提醒
    if ((issue.priority === 'P0' || issue.priority === 'P1') && daysLeft <= 3 && daysLeft >= 0) {
      const lastRemind = state.lastReminders[`${issue.id}_urgent`];
      const today = getHKTDate();

      if (lastRemind !== today) {
        reminders.push({
          type: 'urgent',
          issue,
          message: `🔴 [${issue.priority}] Issue #${issue.id} 緊急任務（${daysLeft}日後到期）: ${issue.title}`
        });
        state.lastReminders[`${issue.id}_urgent`] = today;
      }
    }

    // 已逾期提醒
    // BUG FIX: P0/P1 overdue issues should be reminded daily (not just once)
    if (daysLeft < 0) {
      const isUrgentPriority = (issue.priority === 'P0' || issue.priority === 'P1');
      const today = getHKTDate();

      if (isUrgentPriority) {
        // P0/P1: remind every day while overdue (use date-based tracking)
        const lastOverdueRemind = state.lastReminders[`${issue.id}_overdue_daily`];
        if (lastOverdueRemind !== today) {
          reminders.push({
            type: 'overdue',
            issue,
            message: `🔴 [${issue.priority}] Issue #${issue.id} 已逾期 ${Math.abs(daysLeft)} 日（緊急！）: ${issue.title}`
          });
          state.lastReminders[`${issue.id}_overdue_daily`] = today;
        }
      } else {
        // P2/P3: remind once only
        if (state.lastReminders[overdueKey] !== issue.due) {
          reminders.push({
            type: 'overdue',
            issue,
            message: `⚠️ Issue #${issue.id} 已逾期 ${Math.abs(daysLeft)} 日: ${issue.title}`
          });
          state.lastReminders[overdueKey] = issue.due;
        }
      }
    }
  }

  saveState(state);

  if (reminders.length === 0) {
    log('✅ 無需提醒');
    return [];
  }

  log(`📊 發現 ${reminders.length} 個提醒:\n`);
  for (const r of reminders) {
    log(r.message);
  }

  return reminders;
}

// ==================== 2. PROGRESS CHECK TYPE ====================

function checkProgressUpdates(quiet = false) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  log('\n📊 檢查進度更新...\n');

  const issues = loadIssues(ACTIVE_DIR);
  const state = loadState();
  const lastCheck = state.lastProgressCheck ? new Date(state.lastProgressCheck) : null;
  const now = new Date();

  // 每 7 日檢查一次
  if (lastCheck && (now - lastCheck) < 7 * 24 * 60 * 60 * 1000) {
    log('⏭️ 上次檢查未夠 7 日，跳過');
    return [];
  }

  const checkIssues = [];

  for (const issue of issues) {
    // 檢查長期未完成（超過 7 日無更新）
    const lastUpdated = new Date(issue.updated);
    if (isNaN(lastUpdated.getTime())) continue; // Skip invalid dates
    const daysSinceUpdate = Math.floor((now - lastUpdated) / (1000 * 60 * 60 * 24));

    if (daysSinceUpdate >= 7 && issue.progress !== 'complete') {
      checkIssues.push({
        issue,
        daysSinceUpdate,
        message: `#${issue.id} 「${issue.title}」已 ${daysSinceUpdate} 日無更新（進度: ${issue.progress}）`
      });
    }
  }

  state.lastProgressCheck = now.toISOString();
  saveState(state);

  if (checkIssues.length === 0) {
    log('✅ 所有任務進度正常');
    return [];
  }

  log(`📋 ${checkIssues.length} 個任務需要進度更新:\n`);
  for (const item of checkIssues) {
    log(`  - ${item.message}`);
  }
  log('\n💡 建議: 使用 `node scripts/issue_manager.js progress <id> --step X/Y` 更新');

  return checkIssues;
}

// ==================== 3. AUTO-COMPLETE TYPE ====================

function tryAutoComplete(quiet = false) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  log('\n🤖 嘗試自動完成...\n');

  const issues = loadIssues(ACTIVE_DIR);
  const state = loadState();
  const autoCompleted = [];

  for (const issue of issues) {
    let shouldAutoComplete = false;
    let reason = '';

    // 檢查係咪可以自動完成嘅任務類型
    // P1-10: Expanded from 2 patterns to 6
    const autoCompletablePatterns = [
      {
        pattern: /檢查.*狀態|檢查.*更新|scan.*status/i,
        action: () => {
          try {
            if (issue.title.includes('Stock')) {
              execFileSync('node', ['scripts/stock_updater.js'], { timeout: 30000, cwd: WS });
              return { success: true, result: 'Stock check completed' };
            }
            if (issue.title.includes('Backup')) {
              execFileSync('node', ['scripts/verify_backup.js'], { timeout: 30000, cwd: WS });
              return { success: true, result: 'Backup verified' };
            }
            return { success: false };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }
      },
      {
        pattern: /error.*scan|掃描.*錯誤|scan.*error/i,
        action: () => {
          try {
            execFileSync('node', [path.join(SCRIPTS_DIR, 'error_tracker.js'), 'scan'], { timeout: 60000 });
            return { success: true, result: 'Error scan completed' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }
      },
      {
        pattern: /memory.*clean|清理.*記憶|cleanup.*memory/i,
        action: () => {
          try {
            const cleanupScript = path.join(SCRIPTS_DIR, 'memory_cleanup.js');
            if (fs.existsSync(cleanupScript)) {
              execFileSync('node', [cleanupScript], { timeout: 60000 });
              return { success: true, result: 'Memory cleanup completed' };
            }
            return { success: false, error: 'memory_cleanup.js not found' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }
      },
      {
        pattern: /heartbeat.*check|HA.*check|檢查.*heartbeat/i,
        action: () => {
          try {
            const hbScript = path.join(SCRIPTS_DIR, 'heartbeat.sh');
            if (fs.existsSync(hbScript)) {
              execFileSync('bash', [hbScript], { timeout: 15000 });
              return { success: true, result: 'Heartbeat check completed' };
            }
            return { success: false, error: 'heartbeat.sh not found' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }
      },
      {
        pattern: /清理.*bak|delete.*bak|remove.*backup.*file/i,
        action: () => {
          try {
            const activeDir = path.join(ISSUES_DIR, 'active');
            const baks = fs.readdirSync(activeDir).filter(f => f.endsWith('.bak'));
            baks.forEach(f => fs.unlinkSync(path.join(activeDir, f)));
            return { success: true, result: `Deleted ${baks.length} .bak files` };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }
      },
      {
        pattern: /auto.*resolve|自動.*resolve|resolve.*old.*error/i,
        action: () => {
          try {
            execFileSync('node', [path.join(SCRIPTS_DIR, 'error_tracker.js'), 'scan'], { timeout: 60000 });
            return { success: true, result: 'Auto-resolve scan completed' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }
      }
    ];

    for (const { pattern, action } of autoCompletablePatterns) {
      if (pattern.test(issue.title) || pattern.test(issue.content)) {
        log(`  🔍 嘗試自動完成: #${issue.id} ${issue.title}`);
        const result = action();

        if (result.success) {
          shouldAutoComplete = true;
          reason = result.result || 'Auto-completed';

          // 標記完成
          try {
            execFileSync('node', [path.join(SCRIPTS_DIR, 'issue_manager.js'), 'complete', issue.id],
              { encoding: 'utf-8' });
            autoCompleted.push({
              id: issue.id,
              title: issue.title,
              reason
            });
            state.autoCompleted.push({
              id: issue.id,
              title: issue.title,
              completedAt: getHKTDateTime(),
              reason
            });
          } catch (e) {
            log(`    ❌ 自動完成失敗: ${e.message}`);
          }
        } else {
          log(`    ⚠️ 無法自動完成: ${result.error || 'Unknown reason'}`);
        }
        break;
      }
    }
  }

  saveState(state);

  if (autoCompleted.length === 0) {
    log('ℹ️ 無任務可自動完成');
    return [];
  }

  log(`\n✅ 自動完成 ${autoCompleted.length} 個任務:`);
  for (const item of autoCompleted) {
    log(`  - #${item.id}: ${item.title}`);
    log(`    原因: ${item.reason}`);
  }

  return autoCompleted;
}

// ==================== MAIN ====================

function main() {
  const log = (...args) => { if (!_quiet) console.log(...args); };
  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  log('🎯 Issue Auto Follow-up System\n');
  log(`執行時間: ${getHKTDateTime()}\n`);
  log('='.repeat(50));

  const results = {
    reminders: [],
    progressChecks: [],
    autoCompleted: []
  };

  switch (command) {
    case 'remind':
      results.reminders = checkDueReminders(_quiet);
      break;

    case 'check':
      results.progressChecks = checkProgressUpdates(_quiet);
      break;

    case 'auto':
      results.autoCompleted = tryAutoComplete(_quiet);
      break;

    case 'all':
    default:
      results.reminders = checkDueReminders(_quiet);
      results.progressChecks = checkProgressUpdates(_quiet);
      results.autoCompleted = tryAutoComplete(_quiet);
      break;
  }

  log('\n' + '='.repeat(50));
  log('📊 總結:');
  log(`   提醒: ${results.reminders.length}`);
  log(`   進度檢查: ${results.progressChecks.length}`);
  log(`   自動完成: ${results.autoCompleted.length}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  checkDueReminders,
  checkProgressUpdates,
  tryAutoComplete
};
