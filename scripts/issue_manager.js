#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Issue Manager - 任務管理系統
 * Run: node scripts/issue_manager.js [command]
 *
 * Commands:
 *   create <title> --priority P0/P1/P2/P3 --due YYYY-MM-DD
 *   list [active|backlog|archive]
 *   show <id>
 *   progress <id> --step <number>
 *   complete <id>
 *   archive <id>
 *   scan - 掃描所有 issue 併報告狀態
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync, spawn } = require('child_process');

const { ISSUES_DIR: _cfgIssues } = require('./lib/config');
const ISSUES_DIR = process.env.ISSUES_DIR || _cfgIssues;
const ACTIVE_DIR = path.join(ISSUES_DIR, 'active');
const BACKLOG_DIR = path.join(ISSUES_DIR, 'backlog');
const ARCHIVE_DIR = path.join(ISSUES_DIR, 'archive');
const { getHKTDate, getHKTDateTime } = require('./lib/time');

// 確保目錄存在
[ACTIVE_DIR, BACKLOG_DIR, ARCHIVE_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        if (e.code !== 'EEXIST') {
          console.error('⚠️ mkdir failed: ' + e.message);
          return;
        }
      }
    }
  } catch (e) {
    console.error('Error checking file: ' + e.message);
    return;
  }
});
function generateId() {
  let files = [];
  try {
    files = fs.readdirSync(ACTIVE_DIR)
      .concat(fs.readdirSync(BACKLOG_DIR))
      .concat(fs.readdirSync(ARCHIVE_DIR));
  } catch (e) {
    console.error('⚠️ readdir failed: ' + e.message);
    return [];
  }

  const ids = files
    .filter(f => f.match(/^\d{3}/))
    .map(f => parseInt(f.slice(0, 3)));

  const maxId = ids.length > 0 ? Math.max(...ids) : 0;
  return String(maxId + 1).padStart(3, '0');
}

function parseArgs(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      result[key] = args[i + 1] || true;
      if (result[key] !== true) i++;
    } else {
      result._.push(args[i]);
    }
  }
  return result;
}

function getIssuePath(id) {
  for (const dir of [ACTIVE_DIR, BACKLOG_DIR, ARCHIVE_DIR]) {
    try {
      let files;
      try {
        files = fs.readdirSync(dir);
      } catch (e) {
        console.error('⚠️ readdir failed: ' + e.message);
        continue;
      }
      const file = files.find(f => f.startsWith(id + '-'));
      if (file) return path.join(dir, file);
    } catch (e) {
      console.error('⚠️ Error in getIssuePath: ' + e.message);
      continue;
    }
  }
  return null;
}

function getIssueDir(status) {
  switch (status) {
    case 'active': return ACTIVE_DIR;
    case 'backlog': return BACKLOG_DIR;
    case 'archive': return ARCHIVE_DIR;
    default: return ACTIVE_DIR;
  }
}

function loadIssue(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
  } catch (e) {
    console.error('Error checking file: ' + e.message);
    return null;
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.error('⚠️ File read failed: ' + e.message);
    return null;
  }
  const lines = content.split('\n');

  // Parse front matter
  const frontMatter = {};
  let inFrontMatter = false;
  let contentStart = 0;
  let foundClosing = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') {
      if (!inFrontMatter) {
        inFrontMatter = true;
      } else {
        contentStart = i + 1;
        foundClosing = true;
        break;
      }
    } else if (inFrontMatter) {
      const match = line.match(/^([\w-]+):\s*(.+)$/);
      if (match) {
        // Strip surrounding quotes from YAML values
        frontMatter[match[1]] = match[2].replace(/^["'](.*)["']$/, '$1');
      }
    }
  }

  // BUG FIX: If front matter never closed with '---', find content start
  // after the last matched YAML key to avoid including front matter in content
  if (!foundClosing && inFrontMatter) {
    // Find the last YAML-like line, content starts after it
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] === '---') { contentStart = i + 1; break; }
      if (/^[\w-]+:\s*.+$/.test(lines[i])) { contentStart = i + 1; break; }
    }
  }

  // Guard: skip files without a valid numeric/slug id (prevents undefined issues in list output)
  if (!frontMatter.id || frontMatter.id === '' || frontMatter.id === 'undefined' || String(frontMatter.id).trim() === '') {
    console.error('⚠️ Skipping ' + filePath + ': missing or empty id in frontmatter');
    return null;
  }

  return {
    ...frontMatter,
    content: lines.slice(contentStart).join('\n').trim(),
    filePath
  };
}

function saveIssue(issue) {
  const dir = getIssueDir(issue.status);
  const filename = `${issue.id}-${issue.title.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 30)}.md`;
  const filePath = path.join(dir, filename);

  const content = `---
id: ${issue.id}
title: ${issue.title}
status: ${issue.status}
priority: ${issue.priority || 'P2'}
created: ${issue.created || getHKTDate()}
due: ${issue.due || ''}
updated: ${getHKTDate()}
progress: ${issue.progress || '0/0'}
---

${issue.content || issue.description || ''}
`;

  // Atomic write pattern: write to temp file, then rename
  const tempPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tempPath, content);
  } catch (e) {
    console.error('⚠️ File write failed (temp): ' + e.message);
    return false;
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    console.error('⚠️ File rename failed: ' + e.message);
    // Attempt cleanup of temp file
    try {
      fs.unlinkSync(tempPath);
    } catch (_) { /* ignore cleanup errors */ }
    return false;
  }
  return filePath;
}

function moveIssue(id, newStatus) {
  const oldPath = getIssuePath(id);
  if (!oldPath) {
    log(`❌ Issue ${id} not found`);
    return false;
  }

  const issue = loadIssue(oldPath);
  if (!issue) {
    log(`❌ Failed to load issue ${id}`);
    return false;
  }
  issue.status = newStatus;

  // P1 Fix: Use atomic rename instead of write+unlink
  const dir = getIssueDir(newStatus);
  const filename = `${issue.id}-${issue.title.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 30)}.md`;
  const newPath = path.join(dir, filename);

  // Write to temp file first, then rename (atomic operation)
  const tempPath = newPath + '.tmp';
  const content = `---
id: ${issue.id}
title: ${issue.title}
status: ${issue.status}
priority: ${issue.priority || 'P2'}
created: ${issue.created || getHKTDate()}
due: ${issue.due || ''}
updated: ${getHKTDate()}
progress: ${issue.progress || '0/0'}
---

${issue.content || issue.description || ''}
`;

  // Atomic write pattern: write to temp, then rename
  try {
    fs.writeFileSync(tempPath, content);
  } catch (e) {
    console.error('⚠️ File write failed (temp): ' + e.message);
    return false;
  }
  try {
    fs.renameSync(tempPath, newPath); // Atomic rename
  } catch (e) {
    console.error('⚠️ File rename failed: ' + e.message);
    // Attempt cleanup of temp file
    try {
      fs.unlinkSync(tempPath);
    } catch (_) { /* ignore cleanup errors */ }
    return false;
  }

  // Only delete old file if it's different from the new file
  if (newPath !== oldPath) {
    try {
      fs.unlinkSync(oldPath);
    } catch (err) {
      log(`⚠️ Failed to remove old file ${oldPath}: ${err.message}`);
      // Non-fatal: the move was successful
    }
  }

  log(`✅ Issue ${id} moved to ${newStatus}: ${newPath}`);
  return true;
}

// ==================== COMMANDS ====================

/**
 * Medium Fix: Acquire lock before create to prevent concurrent duplicate IDs
 * Uses mkdir as atomic operation (POSIX guarantees atomicity for mkdir on same path)
 */
async function withCreateLock(fn) {
  const LOCK_DIR = path.join(ISSUES_DIR, '.create_lock');
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 100;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // mkdir is atomic on POSIX - if it succeeds, we own the lock
      fs.mkdirSync(LOCK_DIR, { recursive: false });
      try {
        return fn();
      } finally {
        // Always release lock
        try {
          fs.rmdirSync(LOCK_DIR);
        } catch (_) { /* ignore lock release errors */ }
      }
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists, wait and retry
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Could not acquire create lock after multiple retries');
}

async function cmdCreate(args) {
  const parsed = parseArgs(args);
  const title = parsed._.slice(1).join(' ');
  const useFdq = parsed.fdq === true;

  if (!title) {
    log('Usage: issue_manager.js create "Title" --priority P1 --due 2026-02-25 [--fdq]');
    return;
  }

  withCreateLock(() => {
    const issue = {
      id: generateId(),
      title,
      status: 'active',
      priority: parsed.priority || 'P2',
      due: parsed.due || '',
      created: getHKTDate(),
      description: '## Description\n\n## Progress\n- [ ] Step 1\n- [ ] Step 2\n\n## Notes\n'
    };

    // F/D/Q template mode
    if (useFdq) {
      const templatePath = path.join(ISSUES_DIR, 'templates', 'fdq-template.md');
      try {
        const fs = require('fs');
        let templateContent = fs.readFileSync(templatePath, 'utf-8');

        // Strip front matter from template (saveIssue adds its own)
        templateContent = templateContent.replace(/^---[\s\S]*?---\n/, '');

        // Replace placeholders
        templateContent = templateContent
          .replace(/\{\{id\}\}/g, issue.id)
          .replace(/\{\{title\}\}/g, issue.title)
          .replace(/\{\{priority\}\}/g, issue.priority)
          .replace(/\{\{date\}\}/g, issue.created)
          .replace(/\{\{due\}\}/g, issue.due || '未設定');

        issue.description = templateContent;
        log(`📋 Using F/D/Q template`);
      } catch (e) {
        log(`⚠️ Failed to load F/D/Q template: ${e.message}`);
        log(`   Falling back to default template`);
      }
    }

    const filePath = saveIssue(issue);
    log(`✅ Issue created: ${issue.id} - ${title}`);
    log(`📁 Location: ${filePath}`);
    log(`📊 Priority: ${issue.priority}`);
    if (issue.due) log(`⏰ Due: ${issue.due}`);
    if (useFdq) log(`📋 Type: F/D/Q (Facts/Decisions/Questions)`);
  });
}

function cmdList(filter = 'all') {
  const issues = [];

  for (const dir of [ACTIVE_DIR, BACKLOG_DIR, ARCHIVE_DIR]) {
    let files;
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    } catch (e) {
      console.error('⚠️ readdir failed: ' + e.message);
      continue;
    }
    for (const file of files) {
      try {
        const issue = loadIssue(path.join(dir, file));
        if (issue) {
          issue.fileStatus = path.basename(dir);
          issues.push(issue);
        }
      } catch (e) {
        console.error('⚠️ Failed to load issue: ' + e.message);
      }
    }
  }


  // Sort by priority then due date
  const priorityOrder = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };
  issues.sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    if (pDiff !== 0) return pDiff;
    return (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31');
  });

  // Filter
  let filtered = issues;
  if (filter !== 'all') {
    filtered = issues.filter(i => i.fileStatus === filter || i.status === filter);
  }

  log(`\n📋 Issues (${filtered.length} total):\n`);

  for (const issue of filtered) {
    const status = issue.status === 'active' ? '🟢' : issue.status === 'backlog' ? '🟡' : '✅';
    const priority = issue.priority || 'P2';
    const due = issue.due ? `| Due: ${issue.due}` : '';
    const progress = issue.progress ? `| ${issue.progress}` : '';

    log(`${status} [${priority}] #${issue.id}: ${issue.title}`);
    log(`   Status: ${issue.status} ${due} ${progress}`);
    log('');
  }
}

function cmdShow(id) {
  const filePath = getIssuePath(id);
  if (!filePath) {
    log(`❌ Issue ${id} not found`);
    return;
  }

  const issue = loadIssue(filePath);
  log(`\n📄 Issue #${issue.id}: ${issue.title}\n`);
  log(`Priority: ${issue.priority || 'P2'}`);
  log(`Status: ${issue.status}`);
  log(`Created: ${issue.created}`);
  if (issue.due) log(`Due: ${issue.due}`);
  if (issue.progress) log(`Progress: ${issue.progress}`);
  log('\n---\n');
  log(issue.content);
}

function cmdProgress(args) {
  const parsed = parseArgs(args);
  const id = parsed._[1];
  const step = parsed.step;

  if (!id) {
    log('Usage: issue_manager.js progress <id> --step 2');
    return;
  }

  const filePath = getIssuePath(id);
  if (!filePath) {
    log(`❌ Issue ${id} not found`);
    return;
  }

  const issue = loadIssue(filePath);
  if (!issue) {
    log(`❌ Failed to load issue ${id}`);
    return;
  }

  // Update progress
  if (step) {
    issue.progress = step;
  }

  issue.updated = getHKTDate();
  const newPath = saveIssue(issue);

  // 如果新路徑 ≠ 原路徑，刪除原文件（避免重複文件）
  if (newPath !== filePath) {
    try {
      let exists;
      try {
        exists = fs.existsSync(filePath);
      } catch (e) {
        exists = false;
      }
      if (exists) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          log(`⚠️ Failed to remove old file ${filePath}: ${err.message}`);
        }
      }
    } catch (err) {
      log(`⚠️ Error checking old file ${filePath}: ${err.message}`);
    }
  }

  log(`✅ Issue ${id} progress updated: ${issue.progress}`);
}

function cmdComplete(id, convertToError = false) {
  if (!id) {
    log('Usage: issue_manager.js complete <id> [--error]');
    return;
  }

  const filePath = getIssuePath(id);
  if (!filePath) {
    log(`❌ Issue ${id} not found`);
    return;
  }

  const issue = loadIssue(filePath);
  if (!issue) {
    log(`❌ Failed to load issue ${id}`);
    return;
  }

  // If converting to error, add to errors.json
  if (convertToError) {
    try {
      const scriptPath = path.join(__dirname, 'error_tracker.js');
      const problem = issue.content?.slice(0, 200) || issue.title;
      execFileSync(process.execPath, [scriptPath, 'add', '--title', issue.title, '--problem', problem], { encoding: 'utf-8' });
      log(`✅ Issue ${id} converted to Error and logged`);
    } catch (e) {
      console.error(`⚠️ Failed to add error: ${e.message}`);
    }
  }

  moveIssue(id, 'archive');
  log(`🎉 Issue ${id} marked as complete!${convertToError ? ' (also logged as error)' : ''}`);
}

function cmdConvertToError(id) {
  if (!id) {
    log('Usage: issue_manager.js convert-to-error <id>');
    log('       Converts an issue to error entry before archiving');
    return;
  }

  const filePath = getIssuePath(id);
  if (!filePath) {
    log(`❌ Issue ${id} not found`);
    return;
  }

  const issue = loadIssue(filePath);
  if (!issue) {
    log(`❌ Failed to load issue ${id}`);
    return;
  }

  log(`🔄 Converting Issue #${id} to Error...\n`);
  log(`Title: ${issue.title}`);
  log(`Content preview: ${issue.content?.slice(0, 100) || 'N/A'}...\n`);

  // Add to errors using error_tracker
  try {
    // Build error data
    const errorData = {
      title: issue.title,
      problem: issue.content?.slice(0, 300) || issue.title,
      cause: 'From issue investigation',
      solution: issue.content?.match(/Solution:\s*(.+)/i)?.[1] || '',
      lesson: issue.id ? `Resolved as issue #${issue.id}` : 'Resolved via issue conversion',
      tags: ['from-issue', issue.priority?.toLowerCase() || 'p2']
    };

    // Call error_tracker (safe: no shell interpolation)
    const scriptPath = path.join(__dirname, 'error_tracker.js');
    // P0 Fix: Sanitize inputs before passing to execFileSync
    const sanitizedTitle = String(errorData.title || '').replace(/[\r\n]/g, ' ').trim();
    const sanitizedProblem = String(errorData.problem || '').replace(/[\r\n]/g, ' ').slice(0, 150).trim();

    // P0 Fix: Add try-catch for execFileSync
    let result;
    try {
      result = execFileSync(process.execPath, [scriptPath, 'add', '--title', sanitizedTitle, '--problem', sanitizedProblem], { encoding: 'utf-8' });
    } catch (e) {
      console.error(`❌ Failed to call error_tracker: ${e.message}`);
      throw e; // Re-throw since this is a critical operation
    }
    log(result);

    // Archive the issue
    moveIssue(id, 'archive');
    log(`✅ Issue #${id} converted to Error and archived`);

  } catch (e) {
    console.error(`❌ Failed to convert: ${e.message}`);
  }
}

function cmdArchive(id) {
  if (!id) {
    log('Usage: issue_manager.js archive <id>');
    return;
  }

  moveIssue(id, 'archive');
}

function cmdScan() {
  const issues = [];
  const today = getHKTDate();

  for (const dir of [ACTIVE_DIR, BACKLOG_DIR]) {
    let files;
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    } catch (e) {
      console.error('⚠️ readdir failed for ' + dir + ': ' + e.message);
      continue;
    }
    for (const file of files) {
      try {
        const issue = loadIssue(path.join(dir, file));
        if (issue) {
          issues.push(issue);
        }
      } catch (e) {
        console.error('⚠️ Failed to load issue: ' + e.message);
      }
    }
  }

  if (issues.length === 0) {
    log('✅ No active issues');
    return { count: 0, urgent: [], overdue: [] };
  }

  // Check for urgent (P0/P1) and overdue
  const urgent = issues.filter(i => i.priority === 'P0' || i.priority === 'P1');
  const overdue = issues.filter(i => i.due && i.due.trim() !== '' && i.due < today);
  const dueSoon = issues.filter(i => {
    if (!i.due) return false;
    const due = new Date(i.due);
    const now = new Date();
    const diff = (due - now) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 3;
  });

  log(`\n📊 Issue Scan Report\n`);
  log(`Total active/backlog: ${issues.length}`);
  log(`Urgent (P0/P1): ${urgent.length}`);
  log(`Overdue: ${overdue.length}`);
  log(`Due within 3 days: ${dueSoon.length}`);

  if (urgent.length > 0) {
    log(`\n🔴 Urgent Issues:`);
    for (const issue of urgent) {
      log(`  - #${issue.id}: ${issue.title} [${issue.priority}]`);
    }
  }

  if (overdue.length > 0) {
    log(`\n⚠️ Overdue Issues:`);
    for (const issue of overdue) {
      log(`  - #${issue.id}: ${issue.title} (Due: ${issue.due})`);
    }
  }

  if (dueSoon.length > 0) {
    log(`\n⏰ Due Soon (≤3 days):`);
    for (const issue of dueSoon) {
      log(`  - #${issue.id}: ${issue.title} (Due: ${issue.due})`);
    }
  }

  return { count: issues.length, urgent, overdue, dueSoon };
}

// ==================== MAIN ====================

const args = process.argv.slice(2);
const command = args[0] || 'list';

switch (command) {
  case 'create':
    cmdCreate(args);
    break;

  case 'list':
    cmdList(args[1] || 'all');
    break;

  case 'show':
    cmdShow(args[1]);
    break;

  case 'progress':
    cmdProgress(args);
    break;

  case 'complete':
    cmdComplete(args[1], args.includes('--error'));
    break;

  case 'convert-to-error':
    cmdConvertToError(args[1]);
    break;

  case 'cleanup': {
    // P2 Fix: Added braces to prevent block-scoping issues with const
    const cleanupDays = parseInt(args[1]) || 30;
    autoCleanupResolved(cleanupDays);
    break;
  }

  case 'archive':
    cmdArchive(args[1]);
    break;

  case 'scan':
    cmdScan();
    break;

  default:
    log(`
Issue Manager - 任務管理系統

Usage:
  node scripts/issue_manager.js create "Title" --priority P1 --due 2026-02-25
  node scripts/issue_manager.js list [active|backlog|archive]
  node scripts/issue_manager.js show <id>
  node scripts/issue_manager.js progress <id> --step 2/5
  node scripts/issue_manager.js complete <id> [--error]
  node scripts/issue_manager.js convert-to-error <id>
  node scripts/issue_manager.js scan
`);
}

module.exports = { cmdScan };

/**
 * Auto-cleanup: Archive resolved issues older than specified days
 */
function autoCleanupResolved(days = 30) {
  const now = Date.now();
  const cutoff = now - (days * 24 * 60 * 60 * 1000);
  let archived = 0;

  let files;
  try {
    files = fs.readdirSync(ACTIVE_DIR);
  } catch (e) {
    console.error('⚠️ readdir failed: ' + e.message);
    return 0;
  }

  try {
    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(ACTIVE_DIR, file);
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        console.error('⚠️ File read failed: ' + e.message);
        continue;
      }

      // Only cleanup issues that are explicitly marked as completed/resolved
      const statusMatch = content.match(/^status:\s*(.+)/m);
      const status = statusMatch ? statusMatch[1].trim() : '';
      if (status !== 'completed' && status !== 'resolved' && status !== 'done') continue;

      // Never auto-archive P0/P1 priority issues (require manual review)
      const priorityMatch = content.match(/^priority:\s*(P\d)/m);
      const priority = priorityMatch ? priorityMatch[1] : 'P2';
      if (priority === 'P0' || priority === 'P1') continue;

      // Check for updated date
      const updatedMatch = content.match(/updated:\s*(\d{4}-\d{2}-\d{2})/i);
      if (!updatedMatch) continue;

      const updatedDate = new Date(updatedMatch[1]).getTime();
      if (updatedDate < cutoff) {
        // Extract ID and move to archive
        const idMatch = content.match(/^id:\s*(\d+)/m);
        if (idMatch) {
          const id = idMatch[1];
          try {
            moveIssue(id, 'archive');
            archived++;
          } catch (e) {
            console.error('⚠️ Failed to move issue: ' + e.message);
          }
        }
      }
    }

    log(`🧹 Auto-cleanup: Archived ${archived} resolved issues older than ${days} days`);
    return archived;
  } catch (err) {
    log(`⚠️ Auto-cleanup error: ${err.message}`);
    return 0;
  }
}
