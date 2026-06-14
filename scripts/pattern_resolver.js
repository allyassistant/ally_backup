/**
 * pattern_resolver.js
 * 跨 Session 分析引擎 - Resolver 系統
 *
 * 功能：
 * - 標記 error 為 resolved，並保存 resolution 記錄
 * - 標記 project 為 completed
 * - 支援重新出現 detection
 * - 列出所有 resolved 項目
 * - 重新打開已解決的項目
 *
 * 用法：
 *   node scripts/pattern_resolver.js --error "L0 timeout" --resolve "已升級 systemEvent 模式"
 *   node scripts/pattern_resolver.js --project "Auto Dreaming" --resolve "已完成"
 *   node scripts/pattern_resolver.js --list
 *   node scripts/pattern_resolver.js --reopen "L0 timeout"
 *
 * 作者：Ally (2026-04-03)
 */

const fs = require('fs');
const path = require('path');

// === CONFIG ===
const HOME_DIR = process.env.HOME;
const WORKSPACE_DIR = path.join(HOME_DIR, '.openclaw/workspace');
const MEMORY_PATTERNS_DIR = path.join(WORKSPACE_DIR, 'memory', 'patterns');
const ERRORS_FILE = path.join(MEMORY_PATTERNS_DIR, 'errors.json');
const PROJECTS_FILE = path.join(MEMORY_PATTERNS_DIR, 'projects.json');

const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');

// === CONFIG CONSTANTS ===
const CONFIG = {
  ERROR_RESOLVE_DAYS: 30,        // Error resolved 超過 30 日可 archive
  PROJECT_COMPLETE_DAYS: 14,     // Project completed 超過 14 日可 archive
  TZ_OFFSET: '+08:00',           // HKT 時區
};

// === HELPERS ===
function log(...args) {
  if (!QUIET) console.log('[pattern_resolver]', ...args);
}

function error(...args) {
  console.error('[pattern_resolver]', ...args);
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    error(`❌ 讀取失敗 ${filePath}: ${e.message}`);
    return null;
  }
}

/**
 * Atomic write - 寫入 JSON 檔案
 */
function writeJSON(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (e) {
    error(`❌ 寫入失敗 ${filePath}: ${e.message}`);
    return false;
  }
}

/**
 * 獲取當前 HKT 時間 ISO 格式
 */
function nowHKT() {
  const now = new Date();
  const hktOffset = 8 * 60; // HKT is UTC+8
  const localOffset = now.getTimezoneOffset();
  const hktTime = new Date(now.getTime() + (hktOffset + localOffset) * 60000);
  return hktTime.toISOString().replace('Z', CONFIG.TZ_OFFSET);
}

/**
 * 獲取多久之前（天數）
 */
function daysAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = now - date;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// === CORE FUNCTIONS ===

/**
 * 標記 Error 為 Resolved
 */
function resolveError(errorType, resolution, resolvedBy = 'manual') {
  const data = readJSON(ERRORS_FILE);
  if (!data || !data.errors) {
    error('❌ errors.json 不存在或格式錯誤');
    return false;
  }

  const errorIndex = data.errors.findIndex(e => e.error_type === errorType);
  if (errorIndex === -1) {
    error(`❌ 找不到 error: ${errorType}`);
    return false;
  }

  const errorEntry = data.errors[errorIndex];

  // 構建 history 記錄（保存之前的 resolved 記錄）
  const historyEntry = {
    period: errorEntry.first_seen
      ? `${errorEntry.first_seen} ~ ${errorEntry.last_seen || nowHKT().split('T')[0]}`
      : `${nowHKT().split('T')[0]}`,
    count: errorEntry.count,
    resolved: true,
    resolved_at: nowHKT(),
    resolution: resolution,
  };

  // 如果已有 history，保存到 history險列
  if (!errorEntry.history) {
    errorEntry.history = [];
  }
  errorEntry.history.push(historyEntry);

  // 更新為 resolved 狀態
  errorEntry.resolved = true;
  errorEntry.resolved_at = nowHKT();
  errorEntry.resolved_by = resolvedBy;
  errorEntry.resolution = resolution;
  errorEntry.reopened = false;

  // 更新 last_updated
  data.last_updated = nowHKT();

  if (writeJSON(ERRORS_FILE, data)) {
    log(`✅ Error "${errorType}" 已標記為 resolved`);
    log(`   Resolution: ${resolution}`);
    log(`   Resolved at: ${errorEntry.resolved_at}`);
    log(`   History count: ${errorEntry.history.length}`);
    return true;
  }
  return false;
}

/**
 * 重新打開已 Resolved 的 Error
 */
function reopenError(errorType) {
  const data = readJSON(ERRORS_FILE);
  if (!data || !data.errors) {
    error('❌ errors.json 不存在或格式錯誤');
    return false;
  }

  const errorIndex = data.errors.findIndex(e => e.error_type === errorType);
  if (errorIndex === -1) {
    error(`❌ 找不到 error: ${errorType}`);
    return false;
  }

  const errorEntry = data.errors[errorIndex];

  // 保存當前 resolved 狀態到 history
  if (errorEntry.resolved && errorEntry.resolved_at) {
    errorEntry.history = errorEntry.history || [];
    errorEntry.history.push({
      period: `${errorEntry.first_seen || 'unknown'} ~ ${errorEntry.resolved_at.split('T')[0]}`,
      count: errorEntry.count,
      resolved: true,
      resolved_at: errorEntry.resolved_at,
      resolution: errorEntry.resolution || 'unknown',
    });
  }

  // 重新打開
  errorEntry.resolved = false;
  errorEntry.resolved_at = null;
  errorEntry.resolved_by = null;
  errorEntry.resolution = null;
  errorEntry.reopened = true;
  errorEntry.reopened_count = (errorEntry.reopened_count || 0) + 1;
  errorEntry.last_seen = nowHKT().split('T')[0];

  // 更新 last_updated
  data.last_updated = nowHKT();

  if (writeJSON(ERRORS_FILE, data)) {
    log(`✅ Error "${errorType}" 已重新打開`);
    log(`   Reopened count: ${errorEntry.reopened_count}`);
    return true;
  }
  return false;
}

/**
 * 標記 Project 為 Completed
 */
function completeProject(projectName, resolution = '已完成') {
  const data = readJSON(PROJECTS_FILE);
  if (!data || !data.projects) {
    error('❌ projects.json 不存在或格式錯誤');
    return false;
  }

  const projectIndex = data.projects.findIndex(p => p.name === projectName);
  if (projectIndex === -1) {
    error(`❌ 找不到 project: ${projectName}`);
    return false;
  }

  const project = data.projects[projectIndex];

  // 構建 history 記錄
  const historyEntry = {
    period: project.first_seen
      ? `${project.first_seen} ~ ${project.last_seen || nowHKT().split('T')[0]}`
      : `${nowHKT().split('T')[0]}`,
    discussion_count: project.discussion_count,
    completed: true,
    completed_at: nowHKT(),
    resolution: resolution,
  };

  if (!project.history) {
    project.history = [];
  }
  project.history.push(historyEntry);

  // 更新為 completed 狀態
  project.status = 'completed';
  project.completed_at = nowHKT();
  project.resolution = resolution;

  // 更新 last_updated
  data.last_updated = nowHKT();

  if (writeJSON(PROJECTS_FILE, data)) {
    log(`✅ Project "${projectName}" 已標記為 completed`);
    log(`   Resolution: ${resolution}`);
    log(`   Completed at: ${project.completed_at}`);
    return true;
  }
  return false;
}

/**
 * 列出所有 Resolved 項目
 */
function listResolved() {
  const errorsData = readJSON(ERRORS_FILE);
  const projectsData = readJSON(PROJECTS_FILE);

  console.log('\n📋 已解決項目列表\n');
  console.log('═'.repeat(60));

  // Errors
  console.log('\n🔴 Errors (已 resolved):\n');
  let hasResolvedErrors = false;

  if (errorsData && errorsData.errors) {
    for (const error of errorsData.errors) {
      if (error.resolved) {
        hasResolvedErrors = true;
        const daysSince = error.resolved_at ? daysAgo(error.resolved_at) : 0;
        console.log(`  ▸ ${error.error_type}`);
        console.log(`    Resolved: ${error.resolved_at || 'unknown'}`);
        console.log(`    Resolution: ${error.resolution || 'N/A'}`);
        console.log(`    By: ${error.resolved_by || 'unknown'}`);
        console.log(`    📅 ${daysSince} 日前`);
        console.log(`    History: ${error.history?.length || 0} 次 resolved`);
        if (error.reopened_count) {
          console.log(`    🔄 Reopened: ${error.reopened_count} 次`);
        }
        console.log('');
      }
    }
  }

  if (!hasResolvedErrors) {
    console.log('  (無)');
  }

  // Projects
  console.log('\n📁 Projects (已 completed):\n');
  let hasCompletedProjects = false;

  if (projectsData && projectsData.projects) {
    for (const project of projectsData.projects) {
      if (project.status === 'completed') {
        hasCompletedProjects = true;
        const daysSince = project.completed_at ? daysAgo(project.completed_at) : 0;
        console.log(`  ▸ ${project.name}`);
        console.log(`    Completed: ${project.completed_at || 'unknown'}`);
        console.log(`    Resolution: ${project.resolution || 'N/A'}`);
        console.log(`    📅 ${daysSince} 日前`);
        console.log(`    History: ${project.history?.length || 0} 次 completed`);
        console.log('');
      }
    }
  }

  if (!hasCompletedProjects) {
    console.log('  (無)');
  }

  console.log('═'.repeat(60));
  console.log('\n💡 可 archive 的項目：');

  let archivableCount = 0;

  if (errorsData && errorsData.errors) {
    for (const error of errorsData.errors) {
      if (error.resolved && error.resolved_at) {
        const days = daysAgo(error.resolved_at);
        if (days >= CONFIG.ERROR_RESOLVE_DAYS) {
          archivableCount++;
          console.log(`  🔴 [${days}日] Error: ${error.error_type}`);
        }
      }
    }
  }

  if (projectsData && projectsData.projects) {
    for (const project of projectsData.projects) {
      if (project.status === 'completed' && project.completed_at) {
        const days = daysAgo(project.completed_at);
        if (days >= CONFIG.PROJECT_COMPLETE_DAYS) {
          archivableCount++;
          console.log(`  📁 [${days}日] Project: ${project.name}`);
        }
      }
    }
  }

  if (archivableCount === 0) {
    console.log('  (無)');
  }

  console.log('');
}

// === ARGUMENT PARSING ===
function parseArgs() {
  const args = {
    action: null,
    target: null,
    targetType: null,
    resolution: null,
    resolvedBy: 'manual',
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--error' || arg === '-e') {
      args.targetType = 'error';
      args.target = process.argv[++i];
    } else if (arg === '--project' || arg === '-p') {
      args.targetType = 'project';
      args.target = process.argv[++i];
    } else if (arg === '--resolve' || arg === '-r') {
      args.action = 'resolve';
      args.resolution = process.argv[++i];
    } else if (arg === '--reopen') {
      args.action = 'reopen';
      args.target = process.argv[++i];
      args.targetType = 'error';
    } else if (arg === '--list' || arg === '-l') {
      args.action = 'list';
    } else if (arg === '--by') {
      args.resolvedBy = process.argv[++i];
    }
  }

  return args;
}

// === MAIN ===
function main() {
  const args = parseArgs();

  log('🔧 Pattern Resolver 系統啟動...');

  switch (args.action) {
    case 'resolve':
      if (!args.target) {
        error('❌ 請指定 --error 或 --project');
        process.exit(1);
      }
      if (!args.resolution) {
        error('❌ 請指定 --resolve');
        process.exit(1);
      }

      if (args.targetType === 'error') {
        resolveError(args.target, args.resolution, args.resolvedBy);
      } else if (args.targetType === 'project') {
        completeProject(args.target, args.resolution);
      }
      break;

    case 'reopen':
      if (!args.target) {
        error('❌ 請指定要重新打開的 error');
        process.exit(1);
      }
      reopenError(args.target);
      break;

    case 'list':
      listResolved();
      break;

    default:
      console.log(`
🔧 Pattern Resolver 用法：

  標記 Error 為 Resolved：
    node scripts/pattern_resolver.js --error "L0 timeout" --resolve "已升級 systemEvent 模式"
    node scripts/pattern_resolver.js -e "L0 timeout" -r "已修復" --by auto

  標記 Project 為 Completed：
    node scripts/pattern_resolver.js --project "Auto Dreaming" --resolve "已完成"
    node scripts/pattern_resolver.js -p "Auto Dreaming" -r "已完成"

  重新打開已解決的 Error：
    node scripts/pattern_resolver.js --reopen "L0 timeout"

  列出所有 Resolved 項目：
    node scripts/pattern_resolver.js --list
    node scripts/pattern_resolver.js -l

參數：
  --error, -e     指定 error type
  --project, -p   指定 project name
  --resolve, -r   指定 resolution 描述
  --reopen        重新打開已解決的 error
  --list, -l      列出所有 resolved 項目
  --by            標記者 (default: manual)
      `);
      process.exit(0);
  }
}

// Run
try {
  main();
} catch (e) {
  error('❌ Fatal error:', e.message);
  process.exit(1);
}
