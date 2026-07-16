#!/usr/bin/env node
/**
 * cqm_daily_digest.js — Daily Discord digest of quarantined CQM fixes
 *
 * Part of the Safe Auto-Fix Architecture (#189 Phase 4):
 * - Scans quarantine/ for pending fixes
 * - Sends Discord digest to #⚙️系統
 * - Summarizes by confidence tier
 *
 * Usage:
 *   node scripts/cqm_daily_digest.js [--send] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

const QUARANTINE_DIR = path.join(__dirname, 'quarantine');
const SYSTEM_CHANNEL = 'channel:1473376125584670872'; // #⚙️系統

/**
 * Scan quarantine directory for pending fixes
 */
function scanQuarantine() {
  if (!fs.existsSync(QUARANTINE_DIR)) {
    return { pending: [], approved: [], rejected: [], total: 0 };
  }

  const files = fs.readdirSync(QUARANTINE_DIR);
  const entries = files.filter(f => f.endsWith('.meta.json'));

  const pending = [];
  const approved = [];
  const rejected = [];

  for (const entryFile of entries) {
    try {
      const content = fs.readFileSync(path.join(QUARANTINE_DIR, entryFile), 'utf8');
      const entry = JSON.parse(content);

      if (entry.status === 'pending') {
        pending.push(entry);
      } else if (entry.status === 'approved') {
        approved.push(entry);
      } else if (entry.status === 'rejected') {
        rejected.push(entry);
      }
    } catch (err) {
      // Skip invalid entries
    }
  }

  return {
    pending,
    approved,
    rejected,
    total: pending.length + approved.length + rejected.length
  };
}

/**
 * Format a fix entry for Discord display
 */
function formatFixEntry(entry, index) {
  const file = path.basename(entry.originalFile);
  const line = entry.line || '?';
  const conf = (entry.confidence * 100).toFixed(0);
  const reason = entry.reason || entry.rule || 'unspecified';

  // Truncate reason if too long
  const shortReason = reason.length > 60 ? reason.slice(0, 57) + '...' : reason;

  return `  ${index}. \`${file}:${line}\` — ${shortReason} (\`${conf}%\` confidence)`;
}

/**
 * Generate Discord digest message
 */
function generateDigest(quarantineData, options = {}) {
  const { pending, approved, rejected, total } = quarantineData;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Group pending by confidence
  const highPending = pending.filter(e => e.confidence >= 0.90);
  const mediumPending = pending.filter(e => e.confidence >= 0.70 && e.confidence < 0.90);
  const lowPending = pending.filter(e => e.confidence < 0.70);

  // Calculate age of oldest pending
  let oldestDays = 0;
  if (pending.length > 0) {
    const oldest = pending.reduce((min, e) => {
      const created = new Date(e.createdAt);
      return created < min ? created : min;
    }, new Date());
    oldestDays = Math.floor((Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24));
  }

  const lines = [];

  lines.push(`🔧 **CQM Fix Digest — ${today}**`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');

  // Summary
  lines.push('');
  lines.push(`**Summary:** ${pending.length} pending · ${approved.length} approved · ${rejected.length} rejected`);
  if (oldestDays > 0) {
    lines.push(`⏱️  Oldest pending: **${oldestDays} day${oldestDays > 1 ? 's' : ''}**`);
  }

  // Approved this period
  if (approved.length > 0) {
    lines.push('');
    lines.push(`✅ **Approved (since last digest):** ${approved.length}`);
    for (let i = 0; i < Math.min(approved.length, 3); i++) {
      const file = path.basename(approved[i].originalFile);
      lines.push(`  • \`${file}:${approved[i].line || '?'}\` — ${(approved[i].confidence * 100).toFixed(0)}%`);
    }
    if (approved.length > 3) {
      lines.push(`  _...and ${approved.length - 3} more_`);
    }
  }

  // Pending by tier
  if (pending.length > 0) {
    lines.push('');
    lines.push(`📋 **Pending Review:** ${pending.length}`);

    if (highPending.length > 0) {
      lines.push('');
      lines.push(`🔴 HIGH (≥90%): ${highPending.length}`);
      for (let i = 0; i < Math.min(highPending.length, 3); i++) {
        lines.push(formatFixEntry(highPending[i], i + 1));
      }
      if (highPending.length > 3) {
        lines.push(`  _...and ${highPending.length - 3} more_`);
      }
    }

    if (mediumPending.length > 0) {
      lines.push('');
      lines.push(`🟡 MEDIUM (70-89%): ${mediumPending.length}`);
      for (let i = 0; i < Math.min(mediumPending.length, 3); i++) {
        lines.push(formatFixEntry(mediumPending[i], i + 1));
      }
      if (mediumPending.length > 3) {
        lines.push(`  _...and ${mediumPending.length - 3} more_`);
      }
    }

    if (lowPending.length > 0) {
      lines.push('');
      lines.push(`🟢 LOW (<70%): ${lowPending.length}`);
      for (let i = 0; i < Math.min(lowPending.length, 3); i++) {
        lines.push(formatFixEntry(lowPending[i], i + 1));
      }
      if (lowPending.length > 3) {
        lines.push(`  _...and ${lowPending.length - 3} more_`);
      }
    }

    lines.push('');
    lines.push('**Review command:** `node scripts/cqm_quarantine_reviewer.js list`');
  } else {
    lines.push('');
    lines.push('✅ **No pending fixes — all clean!**');
  }

  lines.push('');
  lines.push('_(CQM Safe Auto-Fix · #189 Phase 4)_');

  return lines.join('\n');
}

/**
 * Send Discord digest
 */
async function sendDigest(digestMessage, dryRun = false) {
  const discord = require('./lib/discord_push');

  const result = discord.push({
    message: digestMessage,
    target: SYSTEM_CHANNEL,
    dryRun
  });

  if (result.ok) {
    console.log('✅ Digest sent to Discord');
    if (result.skipped) {
      console.log('   (dry-run mode)');
    }
  } else {
    console.error(`❌ Failed to send digest: ${result.error}`);
  }

  return result;
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const doSend = args.includes('--send');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
cqm_daily_digest.js — Daily CQM Fix digest to Discord

Usage:
  node scripts/cqm_daily_digest.js [--dry-run]    Preview digest
  node scripts/cqm_daily_digest.js --send          Scan and send to Discord
  node scripts/cqm_daily_digest.js --help         Show this help

Examples:
  # Preview without sending
  node scripts/cqm_daily_digest.js --dry-run

  # Scan quarantine and send digest
  node scripts/cqm_daily_digest.js --send
`);
    process.exit(0);
  }

  // Scan quarantine
  const quarantineData = scanQuarantine();

  // Generate digest
  const digest = generateDigest(quarantineData);

  console.log('=== CQM Fix Digest Preview ===');
  console.log('');
  console.log(digest);
  console.log('');

  if (doSend && !dryRun) {
    console.log('Sending to Discord...');
    await sendDigest(digest, false);
  } else if (doSend && dryRun) {
    console.log('[dry-run] Would send to Discord');
    await sendDigest(digest, true);
  } else {
    console.log('Run with --send to publish to Discord');
  }

  // Also print summary stats
  console.log('');
  console.log('Stats:');
  console.log(`  Total entries: ${quarantineData.total}`);
  console.log(`  Pending: ${quarantineData.pending.length}`);
  console.log(`  Approved: ${quarantineData.approved.length}`);
  console.log(`  Rejected: ${quarantineData.rejected.length}`);
}

module.exports = {
  scanQuarantine,
  generateDigest,
  sendDigest
};

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
