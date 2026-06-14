/**
 * pattern_archive.js
 * 跨 Session 分析引擎 - Archive 系統
 *
 * 功能：
 * - 將 resolved 超過 30 日的 error 移去 archive
 * - 將 completed 超過 14 日的 project 移去 archive
 * - 保留 history
 *
 * 用法：
 *   node scripts/pattern_archive.js --dry-run
 *   node scripts/pattern_archive.js --execute
 *
 * 作者：Ally (2026-04-03)
 */

const fs = require('fs');
const path = require('path');

// === CONFIG ===
const HOME_DIR = process.env.HOME;
const WORKSPACE_DIR = path.join(HOME_DIR, '.openclaw/workspace');
const MEMORY_PATTERNS_DIR = path.join(WORKSPACE_DIR, 'memory', 'patterns');
const ARCHIVE_DIR = path.join(MEMORY_PATTERNS_DIR, 'archive');
const ERRORS_FILE = path.join(MEMORY_PATTERNS_DIR, 'errors.json');
const PROJECTS_FILE = path.join(MEMORY_PATTERNS_DIR, 'projects.json');

const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-n');
const EXECUTE = process.argv.includes('--execute') || process.argv.includes('-y');

// === CONFIG CONSTANTS ===
const CONFIG = {
  ERROR_ARCHIVE_DAYS: 30,        // Error resolved 超過 30 日可 archive
  PROJECT_ARCHIVE_DAYS: 14,     // Project completed 超過 14 日可 archive
  TZ_OFFSET: '+08:00',           // HKT 時區
};

// === HELPERS ===
function log(...args) {
  if (!QUIET) console.log('[pattern_archive]', ...args);
}

function error(...args) {
  console.error('[pattern_archive]', ...args);
}

/**
 * 確保目錄存在
 */
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.error('Error checking file: ' + e.message);
    return;
  }
}

/**
 * 讀取 JSON 檔案
 */
function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error('⚠️ File read failed: ' + e.message);
      return null;
    }
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
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
    } catch (e) {
      console.error('⚠️ File write failed: ' + e.message);
      return;
    }
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      console.error('⚠️ rename failed: ' + e.message);
      return;
    }
    return true;
  } catch (e) {
    error(`❌ 寫入失敗 ${filePath}: ${e.message}`);
    return false;
  }
}

/**
 * Atomic write - 寫入 archive 檔案
 */
function writeArchiveFile(archivePath, data) {
  try {
    ensureDir(path.dirname(archivePath));
    const content = JSON.stringify(data, null, 2);
    const tmpPath = archivePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
    } catch (e) {
      console.error('⚠️ File write failed: ' + e.message);
      return;
    }
    try {
      fs.renameSync(tmpPath, archivePath);
    } catch (e) {
      console.error('⚠️ rename failed: ' + e.message);
      return;
    }
    return true;
  } catch (e) {
    error(`❌ 寫入 archive 失敗 ${archivePath}: ${e.message}`);
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
  if (!dateStr) return Infinity;
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = now - date;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * 格式化日期為檔案名
 */
function dateToFilename(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const HH = String(date.getHours()).padStart(2, '0');
  const MM = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${HH}${MM}`;
}

// === ARCHIVE FUNCTIONS ===

/**
 * Archive resolved errors
 */
function archiveResolvedErrors() {
  const data = readJSON(ERRORS_FILE);
  if (!data || !data.errors) {
    log('⚠️ errors.json 不存在或格式錯誤');
    return { archived: 0, errors: [] };
  }

  const toArchive = [];
  const toKeep = [];

  for (const error of data.errors) {
    if (error.resolved && error.resolved_at) {
      const days = daysAgo(error.resolved_at);
      if (days >= CONFIG.ERROR_ARCHIVE_DAYS) {
        toArchive.push({
          ...error,
          archived_at: nowHKT(),
          archived_reason: `resolved 超過 ${days} 日`,
        });
      } else {
        toKeep.push(error);
      }
    } else if (!error.resolved) {
      // 未 resolved 的 error 保留
      toKeep.push(error);
    }
  }

  if (DRY_RUN) {
    log(`🔍 [DRY-RUN] 將 archive ${toArchive.length} 個 errors`);
    for (const error of toArchive) {
      const days = daysAgo(error.resolved_at);
      log(`   🔴 ${error.error_type} (resolved ${days} 日前)`);
    }
  } else if (EXECUTE) {
    // 寫入 archive 檔案
    if (toArchive.length > 0) {
      const timestamp = dateToFilename();
      const archiveFile = path.join(ARCHIVE_DIR, `errors_${timestamp}.json`);
      const archiveData = {
        archived_at: nowHKT(),
        archive_type: 'errors',
        count: toArchive.length,
        items: toArchive,
      };

      if (writeArchiveFile(archiveFile, archiveData)) {
        log(`✅ 已 archive ${toArchive.length} 個 errors → ${archiveFile}`);
      }
    }

    // 更新 errors.json（只保留未 archive 的）
    data.errors = toKeep;
    data.last_updated = nowHKT();

    if (writeJSON(ERRORS_FILE, data)) {
      log(`✅ 已更新 errors.json，保留 ${toKeep.length} 個 errors`);
    }
  }

  return { archived: toArchive.length, errors: toArchive };
}

/**
 * Archive completed projects
 */
function archiveCompletedProjects() {
  const data = readJSON(PROJECTS_FILE);
  if (!data || !data.projects) {
    log('⚠️ projects.json 不存在或格式錯誤');
    return { archived: 0, projects: [] };
  }

  const toArchive = [];
  const toKeep = [];

  for (const project of data.projects) {
    if (project.status === 'completed' && project.completed_at) {
      const days = daysAgo(project.completed_at);
      if (days >= CONFIG.PROJECT_ARCHIVE_DAYS) {
        toArchive.push({
          ...project,
          archived_at: nowHKT(),
          archived_reason: `completed 超過 ${days} 日`,
        });
      } else {
        toKeep.push(project);
      }
    } else if (project.status !== 'completed') {
      // 未 completed 的 project 保留
      toKeep.push(project);
    }
  }

  if (DRY_RUN) {
    log(`🔍 [DRY-RUN] 將 archive ${toArchive.length} 個 projects`);
    for (const project of toArchive) {
      const days = daysAgo(project.completed_at);
      log(`   📁 ${project.name} (completed ${days} 日前)`);
    }
  } else if (EXECUTE) {
    // 寫入 archive 檔案
    if (toArchive.length > 0) {
      const timestamp = dateToFilename();
      const archiveFile = path.join(ARCHIVE_DIR, `projects_${timestamp}.json`);
      const archiveData = {
        archived_at: nowHKT(),
        archive_type: 'projects',
        count: toArchive.length,
        items: toArchive,
      };

      if (writeArchiveFile(archiveFile, archiveData)) {
        log(`✅ 已 archive ${toArchive.length} 個 projects → ${archiveFile}`);
      }
    }

    // 更新 projects.json（只保留未 archive 的）
    data.projects = toKeep;
    data.last_updated = nowHKT();

    if (writeJSON(PROJECTS_FILE, data)) {
      log(`✅ 已更新 projects.json，保留 ${toKeep.length} 個 projects`);
    }
  }

  return { archived: toArchive.length, projects: toArchive };
}

/**
 * 列出 archive 歷史
 */
function listArchiveHistory() {
  try {
    ensureDir(ARCHIVE_DIR);

    let files;
    try {
      files = fs.readdirSync(ARCHIVE_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
    } catch (e) {
      error(`❌ 讀取 archive 目錄失敗: ${e.message}`);
      return;
    }

    if (files.length === 0) {
      log('📂 Archive 目錄是空的');
      return;
    }

    console.log('\n📂 Archive 歷史：\n');
    console.log('═'.repeat(60));

    for (const file of files) {
      const filePath = path.join(ARCHIVE_DIR, file);
      const data = readJSON(filePath);
      if (data) {
        const archivedAt = data.archived_at || 'unknown';
        const count = data.count || 0;
        const type = data.archive_type || 'unknown';
        console.log(`  📄 ${file}`);
        console.log(`     歸檔時間: ${archivedAt}`);
        console.log(`     項目數量: ${count} 個 ${type}`);
        console.log('');
      }
    }

    console.log('═'.repeat(60));
  } catch (e) {
    error(`❌ listArchiveHistory 失敗: ${e.message}`);
  }
}

// === MAIN ===
function main() {
  log('📦 Pattern Archive 系統啟動...');
  log(`   Mode: ${DRY_RUN ? 'DRY-RUN' : EXECUTE ? 'EXECUTE' : 'LIST'}`);
  log(`   Archive 目錄: ${ARCHIVE_DIR}`);
  log('');

  // 確保 archive 目錄存在
  ensureDir(ARCHIVE_DIR);

  if (DRY_RUN) {
    console.log('🔍 預覽模式 - 不會實際執行歸檔\n');
  } else if (!EXECUTE) {
    console.log('⚠️ 使用 --dry-run 預覽 或 --execute 執行歸檔\n');
  }

  // Archive errors
  console.log('\n🔴 Errors Archive：');
  console.log('─'.repeat(40));
  const errorResult = archiveResolvedErrors();

  // Archive projects
  console.log('\n📁 Projects Archive：');
  console.log('─'.repeat(40));
  const projectResult = archiveCompletedProjects();

  // Summary
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 歸檔摘要');
  console.log('═'.repeat(60));
  console.log(`  🔴 Errors archived: ${errorResult.archived}`);
  console.log(`  📁 Projects archived: ${projectResult.archived}`);
  console.log(`  📂 Archive 目錄: ${ARCHIVE_DIR}`);
  console.log('');

  // List archive history
  listArchiveHistory();

  if (DRY_RUN) {
    console.log('\n💡 使用 --execute 執行實際歸檔');
  }
}

// Run
try {
  main();
} catch (e) {
  error('❌ Fatal error:', e.message);
  process.exit(1);
}
