#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Issue to Reminders Sync - Issue 同步到 Apple Reminders
 * Run: node scripts/issue_reminders_sync.js [sync|cleanup]
 *
 * 將 .issues/active/ 入面嘅任務同步到 Apple Reminders
 * 實現跨平台任務管理 + 通知功能
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// Secure temp file name generator
function getSecureTempFile(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(8).toString('hex')}.scpt`);
}

const { ISSUES_DIR, MEMORY_DIR } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const ACTIVE_DIR = path.join(ISSUES_DIR, 'active');
const BACKLOG_DIR = path.join(ISSUES_DIR, 'backlog');
const SYNC_STATE_FILE = path.join(MEMORY_DIR, 'issue-reminder-sync.json');

// ==================== LOAD ISSUES ====================

function loadIssues(dir) {
  let files;
  try {
    if (!fs.existsSync(dir)) return [];
    files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch (e) {
    console.error('Error: ' + e.message);
    return [];
  }

  const issues = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(dir, file), 'utf-8');
    } catch (e) {
      console.error('Error: ' + e.message);
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
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          frontMatter[match[1]] = match[2];
        }
      }
    }

    if (frontMatter.id && frontMatter.title) {
      issues.push({
        id: frontMatter.id,
        title: frontMatter.title,
        priority: frontMatter.priority || 'P2',
        due: frontMatter.due || '',
        status: frontMatter.status || 'active'
      });
    }
  }

  return issues;
}

// ==================== SYNC STATE ====================

function loadSyncState() {
  try {
    if (!fs.existsSync(SYNC_STATE_FILE)) {
      return { synced: {}, lastSync: null };
    }
    return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error: ' + e.message);
    return { synced: {}, lastSync: null };
  }
}

function saveSyncState(state) {
  try {
    const tmpPath = SYNC_STATE_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, SYNC_STATE_FILE);
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }
}

// ==================== APPLE REMINDERS ====================

function createReminder(title, dueDate, priority, listName = "Ally's Tasks") {
  try {
    const safeTitle = title.replace(/"/g, '\\"');
    const safeList = listName.replace(/"/g, '\\"');

    // Write script to temp file to avoid quote escaping issues
    const scriptFile = getSecureTempFile('reminder');

    let scriptContent = `tell application "Reminders"
  tell list "${safeList}"
    set newReminder to make new reminder with properties {name:"${safeTitle}"`;

    if (dueDate) {
      scriptContent += `, due date:date "${dueDate} 09:00:00"`;
    }

    scriptContent += `, body:"Priority: ${priority} | Issue"}
  end tell
end tell`;

    try {
      fs.writeFileSync(scriptFile, scriptContent);
    } catch (e) {
      console.error('Error writing script file:', e.message);
      return false;
    }

    try {
      execFileSync('osascript', [scriptFile], { timeout: 10000 });
      fs.unlinkSync(scriptFile);
      return true;
    } catch (e) {
      try { fs.unlinkSync(scriptFile); } catch (_) { /* ignore */ }
      throw e;
    }
  } catch (e) {
    console.error('Failed to create reminder:', e.message);
    return false;
  }
}

function deleteReminder(title, listName = "Ally's Tasks") {
  try {
    const safeTitle = title.substring(0, 30).replace(/"/g, '\\"');
    const safeList = listName.replace(/"/g, '\\"');

    const scriptFile = getSecureTempFile('reminder-del');
    const scriptContent = `tell application "Reminders"
  tell list "${safeList}"
    delete (every reminder whose name contains "${safeTitle}")
  end tell
end tell`;

    try {
      fs.writeFileSync(scriptFile, scriptContent);
    } catch (e) {
      console.error('Error writing script file:', e.message);
      return false;
    }

    try {
      execFileSync('osascript', [scriptFile], { timeout: 10000 });
      fs.unlinkSync(scriptFile);
      return true;
    } catch (e) {
      try { fs.unlinkSync(scriptFile); } catch (_) { /* ignore */ }
      return false;
    }
  } catch (e) {
    return false;
  }
}

function getReminders(listName = "Ally's Tasks") {
  try {
    const safeList = listName.replace(/"/g, '\\"');

    const scriptFile = getSecureTempFile('reminder-get');
    const scriptContent = `tell application "Reminders"
  tell list "${safeList}"
    get name of every reminder
  end tell
end tell`;

    try {
      fs.writeFileSync(scriptFile, scriptContent);
    } catch (e) {
      console.error('Error writing script file:', e.message);
      return [];
    }

    try {
      const result = execFileSync('osascript', [scriptFile], { encoding: 'utf-8', timeout: 10000 });
      fs.unlinkSync(scriptFile);
      return result.split(',').map(s => s.trim()).filter(s => s);
    } catch (e) {
      try { fs.unlinkSync(scriptFile); } catch (_) { /* ignore */ }
      return [];
    }
  } catch (e) {
    return [];
  }
}

// ==================== SYNC LOGIC ====================

function syncIssuesToReminders() {
  log('🔄 Syncing issues to Apple Reminders...\n');

  const issues = loadIssues(ACTIVE_DIR);
  const backlog = loadIssues(BACKLOG_DIR);
  const allIssues = [...issues, ...backlog];

  const state = loadSyncState();
  let created = 0;
  let removed = 0;
  let skipped = 0;

  // Get existing reminders
  const existingReminders = getReminders();

  // Sync each issue
  for (const issue of allIssues) {
    const reminderTitle = `[#${issue.id}] ${issue.title}`;
    const alreadySynced = state.synced[issue.id];
    const existsInReminders = existingReminders.some(r => r.includes(`[#${issue.id}]`));

    if (alreadySynced || existsInReminders) {
      skipped++;
      continue;
    }

    // Create reminder
    const success = createReminder(reminderTitle, issue.due, issue.priority);
    if (success) {
      state.synced[issue.id] = {
        title: issue.title,
        syncedAt: getHKTDateTime(),
        reminderTitle: reminderTitle
      };
      created++;
      log(`✅ Created: ${reminderTitle}`);
    }
  }

  // Check for completed/archived issues and remove from reminders
  const activeIds = new Set(allIssues.map(i => i.id));
  for (const [id, data] of Object.entries(state.synced)) {
    if (!activeIds.has(id)) {
      deleteReminder(data.reminderTitle);
      delete state.synced[id];
      removed++;
      log(`🗑️ Removed: ${data.reminderTitle}`);
    }
  }

  state.lastSync = getHKTDateTime();
  saveSyncState(state);

  log(`\n📊 Sync Summary:`);
  log(`   Created: ${created}`);
  log(`   Removed: ${removed}`);
  log(`   Skipped: ${skipped}`);
  log(`   Total synced: ${Object.keys(state.synced).length}`);
}

function cleanupCompletedReminders() {
  log('🧹 Cleaning up completed reminders...\n');

  const state = loadSyncState();
  let removed = 0;

  for (const [id, data] of Object.entries(state.synced)) {
    let activeExists = false;
    let backlogExists = false;
    try {
      activeExists = fs.existsSync(ACTIVE_DIR) &&
        fs.readdirSync(ACTIVE_DIR).some(f => f.startsWith(`${id}-`));
    } catch (e) {
      console.error('Error: ' + e.message);
    }
    try {
      backlogExists = fs.existsSync(BACKLOG_DIR) &&
        fs.readdirSync(BACKLOG_DIR).some(f => f.startsWith(`${id}-`));
    } catch (e) {
      console.error('Error: ' + e.message);
    }

    if (!activeExists && !backlogExists) {
      deleteReminder(data.reminderTitle);
      delete state.synced[id];
      removed++;
      log(`🗑️ Removed: ${data.reminderTitle}`);
    }
  }

  saveSyncState(state);
  log(`\n✅ Cleaned up ${removed} reminders`);
}

// ==================== MAIN ====================

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'sync';

  if (process.platform !== 'darwin') {
    log('⚠️ Apple Reminders sync is only available on macOS');
    return;
  }

  switch (command) {
    case 'sync':
      syncIssuesToReminders();
      break;

    case 'cleanup':
      cleanupCompletedReminders();
      break;

    case 'status':
      const state = loadSyncState();
      log('📊 Sync Status:\n');
      log(`Last sync: ${state.lastSync || 'Never'}`);
      log(`Synced items: ${Object.keys(state.synced).length}`);
      for (const [id, data] of Object.entries(state.synced)) {
        log(`  - [#${id}] ${data.title}`);
      }
      break;

    default:
      log(`
Issue to Reminders Sync

Usage:
  node scripts/issue_reminders_sync.js sync     # Sync issues to Reminders
  node scripts/issue_reminders_sync.js cleanup  # Remove completed reminders
  node scripts/issue_reminders_sync.js status   # Show sync status
`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { syncIssuesToReminders, cleanupCompletedReminders };
