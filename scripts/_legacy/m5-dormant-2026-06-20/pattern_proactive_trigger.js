/**
 * pattern_proactive_trigger.js
 * 主動提醒 Trigger - 根據 Pattern 分析結果生成主動提醒
 *
 * 用法: node pattern_proactive_trigger.js [--quiet]
 *
 * 讀取: memory/patterns/errors.json
 * 讀取: memory/patterns/projects.json
 * 讀取: memory/patterns/periodic.json
 *
 * 輸出: ~/.openclaw/workspace/.proactive_alerts.json
 */

const fs = require('fs');
const path = require('path');

// === CONFIG ===
const HOME_DIR = process.env.HOME;
const WORKSPACE_DIR = path.join(HOME_DIR, '.openclaw/workspace');
const MEMORY_PATTERNS_DIR = path.join(WORKSPACE_DIR, 'memory', 'patterns');
const OUTPUT_FILE = path.join(WORKSPACE_DIR, '.proactive_alerts.json');

const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');

// Trigger thresholds
const CONFIG = {
  ERROR_FREQUENCY_THRESHOLD: 100,    // Error 出現 > 100 次
  PROJECT_OVERDUE_DAYS: 3,            // Project 逾期 > 3 日
  NEW_ERROR_MIN_OCCURRENCES: 2,       // 新 Error Pattern 最少出現次據
  NEW_ERROR_LOOKBACK_DAYS: 7,          // 7 日內算新
};

// === HELPERS ===
function log(...args) {
  if (!QUIET) console.log('[pattern_proactive_trigger]', ...args);
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      log(`⚠️ File not found: ${filePath}`);
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    log(`⚠️ Failed to read ${filePath}: ${e.message}`);
    return null;
  }
}

function writeJSON(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (e) {
    log(`⚠️ Failed to write ${filePath}: ${e.message}`);
    return false;
  }
}

function daysAgo(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return null;
  }
  const now = new Date();
  const diffTime = now - date;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function getDayOfWeek(date = new Date()) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

function nowHKT() {
  const now = new Date();
  const hktOffset = 8 * 60; // HKT is UTC+8
  const localOffset = now.getTimezoneOffset();
  const hktTime = new Date(now.getTime() + (hktOffset + localOffset) * 60000);
  return hktTime.toISOString().replace('Z', '+08:00');
}

// === REOPEN DETECTION ===
/**
 * 檢測 resolved error 是否重新出現
 * 當 error 重新出現時，自動 reopen 併記錄
 */
function detectReopenedErrors(errors) {
  if (!errors || !errors.errors) return [];

  const now = nowHKT();
  const today = now.split('T')[0];
  let reopened = [];

  for (const error of errors.errors) {
    // 跳過未 resolved 的 error
    if (!error.resolved) continue;

    // 檢查 last_seen 是否在 resolved 之後
    if (error.last_seen) {
      const lastSeenDate = new Date(error.last_seen);
      const resolvedAtDate = error.resolved_at ? new Date(error.resolved_at) : null;

      // 如果 last_seen 在 resolved_at 之後，表示重新出現
      if (resolvedAtDate && !isNaN(lastSeenDate.getTime()) && !isNaN(resolvedAtDate.getTime()) && lastSeenDate > resolvedAtDate) {
        // 自動 reopen
        error.resolved = false;
        error.resolved_at = null;
        error.count = error.count || 1;
        error.reopened = true;
        error.reopened_count = (error.reopened_count || 0) + 1;

        // 保存到 history
        if (!error.history) error.history = [];
        error.history.push({
          period: `${error.first_seen || 'unknown'} ~ ${resolvedAtDate.toISOString().split('T')[0]}`,
          count: error.count,
          resolved: true,
          resolved_at: resolvedAtDate.toISOString(),
          resolution: error.resolution || 'unknown',
        });

        reopened.push(error.error_type);
        log(`🔄 Reopened error: ${error.error_type} (count: ${error.reopened_count})`);
      }
    }
  }

  // 如果有 reopened 的 error，更新檔案
  if (reopened.length > 0) {
    const success = writeJSON(path.join(MEMORY_PATTERNS_DIR, 'errors.json'), errors);
    if (success) {
      log(`✅ 已保存 ${reopened.length} 個 reopened errors`);
    }
  }

  return reopened;
}

// === TRIGGER CONDITIONS ===
function checkErrorFrequency(errors) {
  const alerts = [];

  if (!errors || !errors.errors) return alerts;

  for (const error of errors.errors) {
    if (error.count > CONFIG.ERROR_FREQUENCY_THRESHOLD) {
      alerts.push({
        type: 'error_frequency',
        severity: error.count > 300 ? 'critical' : 'warning',
        message: `${error.error_type} 已出現 ${error.count} 次`,
        suggestion: '建議永久修復',
        data: {
          error_type: error.error_type,
          count: error.count,
          last_seen: error.last_seen,
        },
      });
    }
  }

  return alerts;
}

function checkNewErrorPatterns(errors) {
  const alerts = [];

  if (!errors || !errors.errors) return alerts;

  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.NEW_ERROR_LOOKBACK_DAYS);

  for (const error of errors.errors) {
    const firstSeen = new Date(error.first_seen);

    // Is this a new error (first seen within lookback period)?
    if (firstSeen >= cutoffDate && error.count >= CONFIG.NEW_ERROR_MIN_OCCURRENCES) {
      alerts.push({
        type: 'new_error_pattern',
        severity: 'info',
        message: `發現新 error type：${error.error_type}`,
        suggestion: `出現 ${error.count} 次，建議分析根本原因`,
        data: {
          error_type: error.error_type,
          count: error.count,
          first_seen: error.first_seen,
        },
      });
    }
  }

  return alerts;
}

function checkProjectOverdue(projects) {
  const alerts = [];

  if (!projects || !projects.projects) return alerts;

  const today = new Date();

  for (const project of projects.projects) {
    // Only check active projects
    if (project.status !== 'active') continue;

    // Skip if no issue_id (can't determine due date)
    if (!project.issue_id) continue;

    // Check if there's a due date in the issue file
    const issueFile = path.join(WORKSPACE_DIR, '.issues', 'active', `${project.issue_id}.md`);

    try {
      if (fs.existsSync(issueFile)) {
        const issueContent = fs.readFileSync(issueFile, 'utf8');
        const dueMatch = issueContent.match(/due:\s*(\d{4}-\d{2}-\d{2})/);

        if (dueMatch) {
          const dueDate = new Date(dueMatch[1]);
          if (isNaN(dueDate.getTime())) {
            continue;
          }
          const overdueDays = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

          if (overdueDays > CONFIG.PROJECT_OVERDUE_DAYS) {
            alerts.push({
              type: 'project_overdue',
              severity: overdueDays > 7 ? 'critical' : 'warning',
              message: `${project.name} (#${project.issue_id}) 已逾期 ${overdueDays} 日未更新`,
              suggestion: '建議更新進度或標記完成',
              data: {
                project_name: project.name,
                issue_id: project.issue_id,
                due_date: dueMatch[1],
                overdue_days: overdueDays,
              },
            });
          }
        }
      }
    } catch (e) {
      // Silently skip issue files we can't read
    }
  }

  return alerts;
}

function checkPeriodicPatterns(periodic) {
  const alerts = [];

  if (!periodic || !periodic.patterns) return alerts;

  const today = getDayOfWeek();
  const todayHKT = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });

  // Check if today matches any periodic patterns
  for (const pattern of periodic.patterns) {
    if (pattern.pattern === 'every_friday' && today === 'Friday') {
      // Check if system is one of the topics
      if (pattern.topic === 'system' || (pattern.topics && pattern.topics.includes('system'))) {
        alerts.push({
          type: 'periodic_pattern',
          severity: 'info',
          message: `今日係週五，你往常今日問 system`,
          suggestion: '主動提供 system 相關更新？',
          data: {
            day_of_week: today,
            topic: pattern.topic || pattern.topics,
            occurrences: pattern.occurrences,
          },
        });
      }
    }

    if (pattern.pattern === 'every_wednesday' && today === 'Wednesday') {
      if (pattern.topic === 'system' || (pattern.topics && pattern.topics.includes('system'))) {
        alerts.push({
          type: 'periodic_pattern',
          severity: 'info',
          message: `今日係週三，你往常今日問 system`,
          suggestion: '主動提供 system 相關更新？',
          data: {
            day_of_week: today,
            topic: pattern.topic || pattern.topics,
            occurrences: pattern.occurrences,
          },
        });
      }
    }
  }

  return alerts;
}

// === MAIN ===
function main() {
  log('🔍 Scanning patterns for proactive triggers...');

  // Read pattern files
  const errors = readJSON(path.join(MEMORY_PATTERNS_DIR, 'errors.json'));
  const projects = readJSON(path.join(MEMORY_PATTERNS_DIR, 'projects.json'));
  const periodic = readJSON(path.join(MEMORY_PATTERNS_DIR, 'periodic.json'));

  // Collect all alerts
  const alerts = [];

  // Step 0: 檢測 resolved error 是否重新出現
  log('Checking for reopened errors...');
  const reopened = detectReopenedErrors(errors);
  if (reopened.length > 0) {
    alerts.push(...reopened.map(errorType => ({
      type: 'error_reopened',
      severity: 'warning',
      message: `Error "${errorType}" 重新出現！`,
      suggestion: '請確認問題是否已完全修復',
      data: { error_type: errorType },
    })));
  }

  log('Checking error frequency...');
  alerts.push(...checkErrorFrequency(errors));

  log('Checking new error patterns...');
  alerts.push(...checkNewErrorPatterns(errors));

  log('Checking project overdue...');
  alerts.push(...checkProjectOverdue(projects));

  log('Checking periodic patterns...');
  alerts.push(...checkPeriodicPatterns(periodic));

  // Deduplicate alerts by type + identifier
  const seen = new Set();
  const uniqueAlerts = alerts.filter(alert => {
    const key = `${alert.type}:${alert.data?.error_type || alert.data?.issue_id || alert.data?.day_of_week || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Build output
  const output = {
    alerts: uniqueAlerts,
    generated_at: new Date().toISOString(),
    summary: {
      total: uniqueAlerts.length,
      by_type: uniqueAlerts.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {}),
      by_severity: uniqueAlerts.reduce((acc, a) => {
        acc[a.severity] = (acc[a.severity] || 0) + 1;
        return acc;
      }, {}),
    },
  };

  // Write output
  const success = writeJSON(OUTPUT_FILE, output);

  if (success) {
    log(`✅ Generated ${uniqueAlerts.length} proactive alerts`);
    log(`   Output: ${OUTPUT_FILE}`);
  } else {
    log('❌ Failed to write output file');
    process.exit(1);
  }

  // Show summary in non-quiet mode
  if (!QUIET && uniqueAlerts.length > 0) {
    console.log('\n📋 Alerts Summary:');
    console.log('─'.repeat(40));

    for (const alert of uniqueAlerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🔵';
      console.log(`${icon} [${alert.type}] ${alert.message}`);
      console.log(`   💡 ${alert.suggestion}\n`);
    }
  }
}

// Run
try {
  main();
} catch (e) {
  console.error('[pattern_proactive_trigger] Fatal error:', e.message);
  process.exit(1);
}
