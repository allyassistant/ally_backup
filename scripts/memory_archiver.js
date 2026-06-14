#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * L2 Memory Archiver
 * Moves L2 daily files older than N days into memory/_archive/YYYY-MM/
 *
 * Usage:
 *   node memory_archiver.js                # Archive files >30 days old
 *   node memory_archiver.js --days 60      # Archive files >60 days old
 *   node memory_archiver.js --dry-run      # Preview only, no changes
 *   node memory_archiver.js --dry-run --days 30
 */

const fs = require('fs');
const path = require('path');

const { MEMORY_DIR } = require('./lib/config');
const ARCHIVE_BASE = path.join(MEMORY_DIR, '_archive');

// ==================== CONFIG ====================
const DEFAULT_ARCHIVE_DAYS = 30; // Default: archive files older than 30 days

// ==================== CLI ====================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: DEFAULT_ARCHIVE_DAYS, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days') {
      const v = parseInt(args[++i]);
      opts.days = Number.isNaN(v) ? DEFAULT_ARCHIVE_DAYS : v;
    }
    if (args[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

// ==================== MAIN ====================

function main() {
  const opts = parseArgs();

  // Use HKT consistently for date calculations
  const now = new Date();
  const todayHKT = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  const cutoffDate = new Date(todayHKT + 'T00:00:00+08:00');
  cutoffDate.setDate(cutoffDate.getDate() - opts.days);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  log(`📦 L2 Memory Archiver`);
  log(`   Cutoff: ${cutoff} (files older than ${opts.days} days)`);
  log(`   Mode: ${opts.dryRun ? '🔍 DRY RUN' : '🚀 LIVE'}\n`);

  // Check if MEMORY_DIR exists
  let memoryDirExists = false;
  try {
    memoryDirExists = fs.existsSync(MEMORY_DIR);
  } catch (e) {
    console.error(`❌ Failed to check memory directory: ${e.message}`);
    process.exit(1);
  }
  if (!memoryDirExists) {
    console.error(`記憶目錄不存在: ${MEMORY_DIR}`);
    process.exit(1);
  }

  // L2 file pattern: YYYY-MM-DD.md or YYYY-MM-DD-HHMM.md (in memory/ root)
  const l2Pattern = /^(\d{4}-\d{2}-\d{2})(?:\.md|-.*\.md)$/;

  let files = [];
  try {
    files = fs.readdirSync(MEMORY_DIR).filter(f => {
      const m = f.match(l2Pattern);
      if (!m) return false;
      // Exclude non-L2 files
      if (f.includes('l0-') || f.includes('l1-')) return false;
      // Check if older than cutoff
      return m[1] < cutoff;
    });
  } catch (err) {
    console.error(`❌ Failed to read memory directory: ${err.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    log('✅ No files to archive.');
    return;
  }

  log(`Found ${files.length} L2 files to archive:\n`);

  // Group by YYYY-MM
  const groups = {};
  for (const f of files) {
    const dateStr = f.match(/^(\d{4}-\d{2})/)[1];
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(f);
  }

  let totalMoved = 0;
  for (const [month, monthFiles] of Object.entries(groups).sort()) {
    const archiveDir = path.join(ARCHIVE_BASE, month);
    log(`  📁 ${month}/ → ${monthFiles.length} files`);

    if (!opts.dryRun) {
      try {
        fs.mkdirSync(archiveDir, { recursive: true });
      } catch (e) {
        if (e.code !== 'EEXIST') {
          log(`    ❌ Failed to create archive dir: ${e.message}`);
          continue;
        }
      }
      for (const f of monthFiles) {
        const src = path.join(MEMORY_DIR, f);
        const dst = path.join(archiveDir, f);
        // Don't overwrite if already exists in archive
        let dstExists = false;
        try {
          dstExists = fs.existsSync(dst);
        } catch (e) {
          log(`    ❌ Failed to check destination: ${e.message}`);
          continue;
        }
        if (dstExists) {
          log(`    ⏭️  ${f} (already in archive, removing source)`);
          try {
            fs.unlinkSync(src);
          } catch (e) {
            log(`    ❌ Failed to remove source: ${e.message}`);
          }
        } else {
          try {
            fs.renameSync(src, dst);
          } catch (e) {
            log(`    ❌ Failed to move file: ${e.message}`);
            continue;
          }
        }
        totalMoved++;
      }
    } else {
      totalMoved += monthFiles.length;
    }
  }

  log(`\n${opts.dryRun ? '🔍 Would archive' : '✅ Archived'}: ${totalMoved} files`);

  // Summary of remaining files
  try {
    const remaining = fs.readdirSync(MEMORY_DIR).filter(f => l2Pattern.test(f) && !f.includes('l0-') && !f.includes('l1-'));
    log(`📊 Remaining L2 files in memory/: ${remaining.length}`);
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }
}

main();
