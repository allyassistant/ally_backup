#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const _log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Session Cleanup - Integrated Version
 * 整合 session_cleanup.js + session_cleanup_prune.js
 *
 * 清理邏輯：
 * 1. 時間 >3 日既 sessions - 全部清理
 * 2. Cron-related sessions (:cron:, :run:) - 全部清理
 * 3. 大細 >1MB 的 sessions - 全部清理 (新增)
 * 4. --include-subagents: 所有 sub-agent sessions (除非係 recent)
 *
 * 使用方式:
 *   node scripts/session_cleanup.js
 *   node scripts/session_cleanup.js --cron          # 實際利除 (cron mode)
 *   node scripts/session_cleanup.js --include-subagents  # 包含所有 sub-sessions
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || require('os').homedir();
const SESSIONS_FILE = path.join(HOME, '.openclaw/agents/main/sessions/sessions.json');

// ==================== CONFIG (Magic Numbers) ====================
const CONFIG = {
  SESSION_CLEANUP_MAX_AGE_MS: 3 * 24 * 60 * 60 * 1000, // 3 days in ms — sessions older than this are candidates for cleanup
  LARGE_SESSION_SIZE_MB: 1,                             // Sessions larger than this (MB) are flagged for cleanup
  CRON_RECENT_WINDOW_MS: 10 * 60 * 1000,                // 10 min — cron sessions updated within this window are protected
};

// Alias for backward compat
const THREE_DAYS_MS = CONFIG.SESSION_CLEANUP_MAX_AGE_MS;

const { atomicWriteSync } = require('./lib/state');

// Colors
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function log(msg, color = RESET) {
  _log(`${color}${msg}${RESET}`);
}

async function cleanupSessions() {
  log('');
  log('=== Session Cleanup (Integrated) ===', GREEN);
  log('');

  // Check if sessions file exists
  let data;
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      log('⚠️  Sessions file not found, skipping', YELLOW);
      return;
    }
    try {
      data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch (err) {
      log(`❌ Failed to parse sessions file: ${err.message}`, RED);
      return;
    }
  } catch (err) {
    log(`❌ Failed to read sessions file: ${err.message}`, RED);
    return;
  }

  const now = Date.now();
  const cutoff = now - THREE_DAYS_MS;

  log(`📅 Current time: ${new Date(now).toISOString()}`);
  log(`📅 Cutoff time: ${new Date(cutoff).toISOString()}`);
  log(`📊 Total sessions: ${Object.keys(data).length}`);
  log('');

  // Check for --include-subagents flag
  const includeSubagents = process.argv.includes('--include-subagents');
  if (includeSubagents) {
    log('🔧 Mode: INCLUDE SUBAGENTS (will clean old sub-agent sessions)');
    log('');
  }

  const toDelete = [];
  const toKeep = [];

  // Categorize sessions
  const categories = {
    cronParent: [],
    cronRun: [],
    discord: [],
    main: [],
    subagents: [],
    other: []
  };

  for (const [key, session] of Object.entries(data)) {
    const updatedAt = session.updatedAt || 0;
    const age = now - updatedAt;
    // P2 Fix: Handle edge cases (negative age, extremely large age)
    let ageDays = 0;
    if (age < 0) {
      ageDays = 0; // Future date, treat as today
    } else if (age > 365 * 24 * 60 * 60 * 1000) {
      ageDays = 365; // More than a year, cap at 365
    } else {
      ageDays = (age / (24 * 60 * 60 * 1000)).toFixed(1);
    }

    // Categorize by key pattern (order matters! check more specific patterns first)
    if (key.includes(':cron:') && key.includes(':run:')) {
      categories.cronRun.push({ key, updatedAt, ageDays, session });
    } else if (key.includes(':cron:')) {
      categories.cronParent.push({ key, updatedAt, ageDays, session });
    } else if (key.includes('subagent')) {
      categories.subagents.push({ key, updatedAt, ageDays, session });
    } else if (key.includes('discord')) {
      categories.discord.push({ key, updatedAt, ageDays, session });
    } else if (key.includes(':main:')) {
      categories.main.push({ key, updatedAt, ageDays, session });
    } else {
      categories.other.push({ key, updatedAt, ageDays, session });
    }

    // Decide to delete or keep
    const isOld = updatedAt < cutoff;
    const isCron = key.includes(':cron:') || key.includes(':run:');
    const isSubagent = key.includes('subagent');
    const isRecentlyActiveCron = isCron && (now - updatedAt) < CONFIG.CRON_RECENT_WINDOW_MS;

    // Delete conditions
    let shouldDelete = false;
    let reason = '';

    if (isOld || isCron) {
      // P3 Fix: Don't delete cron sessions that were recently updated
      // (they might still be executing, causing session lock conflict)
      if (isRecentlyActiveCron && !isOld) {
        shouldDelete = false;
        reason = 'cron_recently_active';
      } else {
        shouldDelete = true;
        reason = isCron ? 'cron_pattern' : 'age';
      }
    } else if (includeSubagents && isSubagent) {
      // With --include-subagents flag, delete ALL subagent sessions
      shouldDelete = true;
      reason = 'subagent_cleanup';
    }

    if (shouldDelete) {
      toDelete.push({ key, updatedAt, ageDays, session, reason });
    } else {
      toKeep.push({ key, updatedAt, ageDays });
    }
  }

  // Report by category
  log('📋 Session Categories:');
  log(`   Discord Channels: ${categories.discord.length}`);
  log(`   Cron (parent):   ${categories.cronParent.length}`);
  log(`   Cron (run):      ${categories.cronRun.length}`);
  log(`   Main:            ${categories.main.length}`);
  log(`   Subagents:       ${categories.subagents.length}`);
  log(`   Other:           ${categories.other.length}`);
  log('');

  log(`🔍 Cleanup Criteria:`);
  log(`   • Age > 3 days:  ${toDelete.filter(d => d.reason === 'age').length}`);
  log(`   • Cron pattern:  ${toDelete.filter(d => d.reason === 'cron_pattern').length}`);
  log(`   • Subagent cleanup: ${toDelete.filter(d => d.reason === 'subagent_cleanup').length}`);
  // Show how many cron sessions were protected (recently active)
  const recentCronCount = Object.keys(data).filter(k => (k.includes(':cron:') || k.includes(':run:')) && (Date.now() - (data[k]?.updatedAt || 0)) < CONFIG.CRON_RECENT_WINDOW_MS).length;
  if (recentCronCount > 0) {
    log(`   🛡️  Cron recently active (protected): ${recentCronCount}`);
  }
  log('');

  // Always run file-level cleanups, even when no sessions to delete
  cleanupLargeSessionFiles();
  cleanupTrajectoryFiles();

  // Show what will be deleted
  if (toDelete.length === 0) {
    log('✅ No sessions to clean up', GREEN);
    return;
  }

  log(`⚠️  Will delete ${toDelete.length} sessions:`);
  toDelete.slice(0, 10).forEach(({ key, ageDays, reason }) => {
    const shortKey = key.length > 50 ? key.substring(0, 50) + '...' : key;
    log(`   - ${shortKey} (${ageDays}d, ${reason})`);
  });
  if (toDelete.length > 10) {
    log(`   ... and ${toDelete.length - 10} more`);
  }
  log('');

  // Confirm before delete (skip in cron mode)
  const isCron = process.argv.includes('--cron');
  if (!isCron) {
    log('✅ Dry run complete. Run with --cron to delete.');
    return;
  }

  // Delete sessions
  let deletedCount = 0;
  for (const { key, session } of toDelete) {
    try {
      // Delete from memory
      delete data[key];

      // Delete session file if exists
      if (session.sessionFile && fs.existsSync(session.sessionFile)) {
        fs.unlinkSync(session.sessionFile);
      }

      deletedCount++;
    } catch (e) {
      log(`⚠️  Failed to delete ${key}: ${e.message}`);
    }
  }

  // Write back (atomic)
  try {
    atomicWriteSync(SESSIONS_FILE, data);
  } catch (err) {
    log(`❌ Failed to write sessions file: ${err.message}`, RED);
  }

  log('');
  log(`✅ Session Cleanup Complete`, GREEN);
  log(`   Deleted: ${deletedCount} sessions`);
  log(`   Kept: ${toKeep.length} sessions`);
}

function cleanupTrajectoryFiles() {
  log('');
  log('=== Trajectory Files Cleanup (>7d) ===', YELLOW);
  log('');

  const TRAJECTORY_RETENTION_DAYS = 7;
  const TRAJECTORY_CUTOFF = Date.now() - TRAJECTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const SESSIONS_DIR = path.join(HOME, '.openclaw/agents/main/sessions');
  let trajFiles;
  try {
    const allFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.trajectory.jsonl'));
    trajFiles = [];
    for (const f of allFiles) {
      try {
        const filePath = path.join(SESSIONS_DIR, f);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < TRAJECTORY_CUTOFF) {
          trajFiles.push({ name: f, path: filePath, size: stats.size });
        }
      } catch { continue; }
    }
  } catch (e) {
    log(`⚠️  Cannot read sessions dir: ${e.message}`);
    return;
  }

  if (trajFiles.length === 0) {
    log('✅ No old trajectory files found', GREEN);
  } else {
    let totalSize = 0;
    trajFiles.forEach(f => {
      const sizeMB = (f.size / 1024 / 1024).toFixed(2);
      totalSize += f.size;
      log(`   🗑️  ${f.name} (${sizeMB}MB)`);
    });
    log(`   Total: ${(totalSize / 1024 / 1024).toFixed(2)}MB — older than ${TRAJECTORY_RETENTION_DAYS} days`);
    log('');
  }

  const isCron = process.argv.includes('--cron');
  if (!isCron) {
    log('✅ Dry run complete. Run with --cron to delete.', YELLOW);
    return;
  }

  let deletedCount = 0;
  for (const f of trajFiles) {
    try {
      fs.unlinkSync(f.path);
      deletedCount++;
    } catch (e) {
      log(`⚠️  Failed to delete ${f.name}: ${e.message}`);
    }
  }

  if (deletedCount > 0) {
    log('');
    log(`✅ Trajectory Files Cleanup Complete`, GREEN);
    log(`   Deleted: ${deletedCount} files`);
  }
}

function cleanupLargeSessionFiles() {
  log('');
  log('=== Large Session Files Cleanup (>1MB) ===', YELLOW);
  log('');

  const SESSIONS_DIR = path.join(HOME, '.openclaw/agents/main/sessions');
  const MAX_SIZE_MB = 1;
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

  let files;
  try {
    const allFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    files = [];
    for (const f of allFiles) {
      try {
        const filePath = path.join(SESSIONS_DIR, f);
        const stats = fs.statSync(filePath);
        if (stats.size > MAX_SIZE_BYTES) {
          files.push({ name: f, path: filePath, size: stats.size });
        }
      } catch (err) {
        // File may have been deleted between readdir and stat, skip
        continue;
      }
    }
  } catch (e) {
    log(`⚠️  Cannot read sessions dir: ${e.message}`);
    return;
  }

  if (files.length === 0) {
    log('✅ No large session files found', GREEN);
    return;
  }

  log(`⚠️  Found ${files.length} large session files:`);
  let totalSizeMB = 0;
  files.forEach(f => {
    const sizeMB = (f.size / 1024 / 1024).toFixed(2);
    totalSizeMB += f.size;
    log(`   🗑️  ${f.name} (${sizeMB}MB)`);
  });
  log(`   Total: ${(totalSizeMB / 1024 / 1024).toFixed(2)}MB`);
  log('');

  const isCron = process.argv.includes('--cron');
  if (!isCron) {
    log('✅ Dry run complete. Run with --cron to delete.', YELLOW);
    return;
  }

  // Delete large files
  let deletedCount = 0;
  for (const f of files) {
    try {
      fs.unlinkSync(f.path);
      deletedCount++;
    } catch (e) {
      log(`⚠️  Failed to delete ${f.name}: ${e.message}`);
    }
  }

  log('');
  log(`✅ Large Session Files Cleanup Complete`, GREEN);
  log(`   Deleted: ${deletedCount} files`);
}

cleanupSessions().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
