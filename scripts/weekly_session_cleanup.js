#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Weekly Session Cleanup Script
 * Prunes old cron session files to save space
 * Run: node scripts/weekly_session_cleanup.js
 *
 * Criteria:
 * - Delete files for sessions with ':cron:' in key
 * - Run weekly via cron
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw/agents/main/sessions');

log('=== Weekly Session Cleanup ===\n');

// Get current sessions from OpenClaw
let sessions = [];
try {
  const output = execSync('openclaw sessions', { encoding: 'utf8' });
  // Parse the text output since --json flag is not supported
  const lines = output.split('\n').filter(line => line.trim() && !line.startsWith('Session store:') && !line.startsWith('Sessions listed:') && !line.startsWith('Kind'));

  sessions = lines.map(line => {
    const parts = line.trim().split(/\s+/);
    // Format: Kind Key Age Model Tokens Flags
    // Key is the second column, might contain "..."
    return { key: parts[1] || '' };
  });
} catch (e) {
  console.error('Error: ' + e.message);
  return;
}

// Find cron session UUIDs
const cronUUIDs = new Set();
sessions.forEach(s => {
  if (s.key && s.key.includes(':cron:')) {
    const parts = s.key.split(':');
    cronUUIDs.add(parts[parts.length - 1]);
  }
});

log(`Found ${cronUUIDs.size} cron sessions in OpenClaw`);

// Find and delete files
let deleted = 0;
let notFound = 0;

let files = [];
try {
  files = fs.readdirSync(SESSIONS_DIR);
} catch (e) {
  console.error('Error: ' + e.message);
  return;
}
files.forEach(f => {
  if (!f.endsWith('.jsonl')) return;

  // Extract UUID from filename
  const uuid = f.replace('.jsonl', '');

  if (cronUUIDs.has(uuid)) {
    const filePath = path.join(SESSIONS_DIR, f);
    try {
      execFileSync('trash', [filePath], { stdio: 'ignore' });
      log(`Deleted: ${f}`);
      deleted++;
    } catch (e) {
      console.error('Error: ' + e.message);
      notFound++;
      return;
    }
  }
});

log(`\n=== Summary ===`);
log(`Deleted: ${deleted} files`);
log(`Not found: ${notFound} files`);

// Count remaining files
let remaining = 0;
try {
  remaining = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl')).length;
} catch (e) {
  console.error('Error: ' + e.message);
  return;
}
log(`Remaining session files: ${remaining}`);
