#!/usr/bin/env node
/**
 * cqm_quarantine_reviewer.js — Review and approve/reject quarantined CQM fixes
 *
 * Part of the Safe Auto-Fix Architecture (#189 Phase 4):
 * - List all quarantined fixes
 * - Show diff for a specific fix
 * - Approve and apply a fix
 * - Reject a fix
 *
 * Usage:
 *   node scripts/cqm_quarantine_reviewer.js list
 *   node scripts/cqm_quarantine_reviewer.js show <id>
 *   node scripts/cqm_quarantine_reviewer.js approve <id>
 *   node scripts/cqm_quarantine_reviewer.js reject <id>
 */

const fs = require('fs');
const path = require('path');

const QUARANTINE_DIR = path.join(__dirname, 'quarantine');
const WORKSPACE_DIR = path.join(__dirname, '..');

/**
 * Load a quarantine entry by ID
 */
function loadEntry(id) {
  const entryPath = path.join(QUARANTINE_DIR, `${id}.meta.json`);
  if (!fs.existsSync(entryPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(entryPath, 'utf8'));
}

/**
 * Save a quarantine entry
 */
function saveEntry(entry) {
  const entryPath = path.join(QUARANTINE_DIR, `${entry.id}.meta.json`);
  fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2), 'utf8');
}

/**
 * List all quarantine entries
 */
function listEntries(filter = 'all') {
  if (!fs.existsSync(QUARANTINE_DIR)) {
    console.log('Quarantine directory is empty or does not exist.');
    return [];
  }

  const files = fs.readdirSync(QUARANTINE_DIR);
  const entries = files
    .filter(f => f.endsWith('.meta.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(QUARANTINE_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Filter
  const filtered = entries.filter(e => {
    if (filter === 'pending') return e.status === 'pending';
    if (filter === 'approved') return e.status === 'approved';
    if (filter === 'rejected') return e.status === 'rejected';
    return true;
  });

  // Sort by createdAt descending
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return filtered;
}

/**
 * Print a formatted list of entries
 */
function printEntries(entries, filter = 'all') {
  if (entries.length === 0) {
    console.log(`No ${filter === 'all' ? '' : filter + ' '}entries found.`);
    return;
  }

  const statusIcon = { pending: '⏳', approved: '✅', rejected: '❌' };
  const confColor = (conf) => {
    if (conf >= 0.90) return '🔴';
    if (conf >= 0.70) return '🟡';
    return '🟢';
  };

  console.log('');
  console.log(`Quarantine Entries (${entries.length}):`);
  console.log('━'.repeat(60));

  for (const entry of entries) {
    const icon = statusIcon[entry.status] || '❓';
    const conf = ((entry.confidence || 0) * 100).toFixed(0);
    const color = confColor(entry.confidence);
    const file = path.basename(entry.originalFile);
    const age = getAge(entry.createdAt);

    console.log(`\n${icon} **${entry.id}**`);
    console.log(`   File: \`${file}:${entry.line || '?'}\``);
    console.log(`   Confidence: ${color} ${conf}%`);
    console.log(`   Rule: ${entry.rule || 'unspecified'}`);
    console.log(`   Reason: ${entry.reason || 'unspecified'}`);
    console.log(`   Created: ${entry.createdAt.slice(0, 16)} (${age})`);
    console.log(`   Status: ${entry.status}`);
  }
}

/**
 * Get human-readable age string
 */
function getAge(isoDate) {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return 'just now';
}

/**
 * Show detailed diff for a specific entry
 */
function showEntry(id) {
  const entry = loadEntry(id);
  if (!entry) {
    console.error(`Entry not found: ${id}`);
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log(`Fix ID: ${entry.id}`);
  console.log('━'.repeat(60));
  console.log(`File: ${entry.originalFile}:${entry.line}`);
  console.log(`Confidence: ${(entry.confidence * 100).toFixed(0)}%`);
  console.log(`Rule: ${entry.rule || 'unspecified'}`);
  console.log(`Reason: ${entry.reason || 'unspecified'}`);
  console.log(`Status: ${entry.status}`);
  console.log(`Created: ${entry.createdAt}`);

  if (entry.status !== 'pending') {
    console.log(`${entry.status === 'approved' ? 'Approved' : 'Rejected'}: ${entry.reviewedAt || 'unknown'}`);
    if (entry.reviewedBy) console.log(`By: ${entry.reviewedBy}`);
  }

  console.log('');
  console.log('--- Original Code ---');
  console.log((entry.originalCode || '// (no original code)').slice(0, 500));
  console.log('');
  console.log('--- Fixed Code ---');
  console.log((entry.fixedCode || '// (no fixed code)').slice(0, 500));

  // Show diff if available
  const diffPath = path.join(QUARANTINE_DIR, `${id}.diff`);
  if (fs.existsSync(diffPath)) {
    console.log('');
    console.log('--- Diff ---');
    console.log(fs.readFileSync(diffPath, 'utf8').slice(0, 800));
  }
}

/**
 * Approve and apply a quarantined fix
 */
async function approveEntry(id) {
  const entry = loadEntry(id);
  if (!entry) {
    console.error(`Entry not found: ${id}`);
    process.exit(1);
  }

  if (entry.status !== 'pending') {
    console.error(`Entry ${id} is already ${entry.status}. Cannot approve.`);
    process.exit(1);
  }

  console.log(`Approving fix: ${id}`);
  console.log(`File: ${entry.originalFile}:${entry.line}`);
  console.log(`Confidence: ${(entry.confidence * 100).toFixed(0)}%`);

  // Read current file content
  let currentCode;
  try {
    currentCode = fs.readFileSync(entry.originalFile, 'utf8');
  } catch (err) {
    console.error(`Cannot read file: ${entry.originalFile}`);
    process.exit(1);
  }

  // Apply fix using safe_writer
  const safeWriter = require('./cqm_safe_writer');

  console.log('\nApplying fix with safe writer...');
  const result = safeWriter.safeFix(
    entry.originalFile,
    currentCode,
    entry.fixedCode,
    { confidence: entry.confidence, reason: entry.reason, rule: entry.rule }
  );

  if (result.status === 'success') {
    console.log('✅ Fix applied successfully');

    // Update entry
    entry.status = 'approved';
    entry.reviewedAt = new Date().toISOString();
    entry.reviewedBy = 'human';
    saveEntry(entry);

    console.log('📝 Entry marked as approved');
  } else {
    console.error(`❌ Fix failed: ${result.reason}`);
    if (result.backupPath) {
      console.error(`   Backup preserved at: ${result.backupPath}`);
    }
    process.exit(1);
  }
}

/**
 * Reject a quarantined fix
 */
function rejectEntry(id, reason = '') {
  const entry = loadEntry(id);
  if (!entry) {
    console.error(`Entry not found: ${id}`);
    process.exit(1);
  }

  if (entry.status !== 'pending') {
    console.error(`Entry ${id} is already ${entry.status}. Cannot reject.`);
    process.exit(1);
  }

  console.log(`Rejecting fix: ${id}`);
  console.log(`File: ${entry.originalFile}:${entry.line}`);
  if (reason) console.log(`Reason: ${reason}`);

  entry.status = 'rejected';
  entry.reviewedAt = new Date().toISOString();
  entry.reviewedBy = 'human';
  if (reason) entry.rejectReason = reason;
  saveEntry(entry);

  console.log('✅ Entry marked as rejected');
}

/**
 * Auto-reject entries older than N days
 */
function autoRejectExpired(days = 14) {
  const entries = listEntries('pending');
  const now = Date.now();
  const maxAge = days * 24 * 60 * 60 * 1000;

  let count = 0;
  for (const entry of entries) {
    const age = now - new Date(entry.createdAt).getTime();
    if (age > maxAge) {
      entry.status = 'rejected';
      entry.reviewedAt = new Date().toISOString();
      entry.reviewedBy = 'auto-expired';
      entry.rejectReason = `Auto-rejected after ${days} days without review`;
      saveEntry(entry);
      count++;
    }
  }

  console.log(`Auto-rejected ${count} entries older than ${days} days`);
  return count;
}

/**
 * CLI entry point
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || args.includes('--help') || args.includes('-h')) {
    console.log(`
cqm_quarantine_reviewer.js — Review quarantined CQM fixes

Usage:
  node scripts/cqm_quarantine_reviewer.js list [filter]
  node scripts/cqm_quarantine_reviewer.js show <id>
  node scripts/cqm_quarantine_reviewer.js approve <id>
  node scripts/cqm_quarantine_reviewer.js reject <id> [--reason <text>]
  node scripts/cqm_quarantine_reviewer.js auto-reject [--days <n>]

Filters: all | pending | approved | rejected
Default filter: all (or 'pending' for list)

Examples:
  node scripts/cqm_quarantine_reviewer.js list pending
  node scripts/cqm_quarantine_reviewer.js show fix-discord_push-52-1234567890-abcd
  node scripts/cqm_quarantine_reviewer.js approve fix-discord_push-52-1234567890-abcd
  node scripts/cqm_quarantine_reviewer.js reject fix-some_file-10-1234567890-abcd --reason "breaks API"
  node scripts/cqm_quarantine_reviewer.js auto-reject --days 14
`);
    process.exit(0);
  }

  if (command === 'list') {
    const filter = args[1] || 'pending';
    const entries = listEntries(filter);
    printEntries(entries, filter);
  } else if (command === 'show') {
    const id = args[1];
    if (!id) {
      console.error('Usage: show <id>');
      process.exit(1);
    }
    showEntry(id);
  } else if (command === 'approve') {
    const id = args[1];
    if (!id) {
      console.error('Usage: approve <id>');
      process.exit(1);
    }
    approveEntry(id);
  } else if (command === 'reject') {
    const id = args[1];
    if (!id) {
      console.error('Usage: reject <id>');
      process.exit(1);
    }
    const reasonIdx = args.indexOf('--reason');
    const reason = reasonIdx !== -1 ? args[reasonIdx + 1] : '';
    rejectEntry(id, reason);
  } else if (command === 'auto-reject') {
    const daysIdx = args.indexOf('--days');
    const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 14;
    autoRejectExpired(days);
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Run with --help for usage');
    process.exit(1);
  }
}

module.exports = {
  listEntries,
  loadEntry,
  saveEntry,
  showEntry,
  approveEntry,
  rejectEntry,
  autoRejectExpired
};

if (require.main === module) {
  main();
}
