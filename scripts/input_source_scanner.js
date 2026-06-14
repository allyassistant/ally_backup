#!/usr/bin/env node
/**
 * Input Source Scanner
 * Scans memory directory to show L2 files, timestamps, and suggests improvements
 *
 * Usage:
 *   node scripts/input_source_scanner.js              # Show today's sources
 *   node scripts/input_source_scanner.js --date 2026-04-16   # Specific date
 *   node scripts/input_source_scanner.js --stats         # Show statistics
 *
 * v1.0 - 2026-04-16
 */

const fs = require('fs');
const path = require('path');
const { getHKTDate } = require('./lib/time');

const MEMORY_DIR = path.join(process.env.HOME || '/tmp', '.openclaw', 'workspace', 'memory');

function getDateStr(date) {
  // Use HKT timezone when formatting date
  if (!date) date = new Date();
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
}

function scanSources(targetDate) {
  const dateStr = targetDate || getDateStr(new Date());
  const datePattern = new RegExp(`^${dateStr}(?:\\.md|-.*\\.md)$`);

  console.log(`\n📂 Input Sources for ${dateStr}\n`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Scan memory directory
  let files = [];
  try {
    const allFiles = fs.readdirSync(MEMORY_DIR);
    files = allFiles
      .filter(f => datePattern.test(f) && !f.includes('l0-') && !f.includes('l1-') && !f.startsWith('.'))
      .map(f => ({
        name: f,
        path: path.join(MEMORY_DIR, f),
        size: 0,
        mtime: null
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error(`❌ Error scanning directory: ${e.message}`);
    return;
  }

  // Get file stats
  let totalSize = 0;
  for (const file of files) {
    try {
      const stats = fs.statSync(file.path);
      file.size = stats.size;
      file.mtime = stats.mtime;
      totalSize += stats.size;
    } catch (e) {
      // Skip inaccessible files
    }
  }

  // Display files
  console.log(`Total: ${files.length} files, ${(totalSize / 1024).toFixed(1)} KB\n`);
  console.log('───────────────────────────────────────────────────────────');

  // Group by hour
  const byHour = {};
  for (const file of files) {
    const hour = file.name.substring(11, 13);
    if (!byHour[hour]) byHour[hour] = [];
    byHour[hour].push(file);
  }

  // Display by hour
  const hours = Object.keys(byHour).sort();
  for (const hour of hours) {
    const hourFiles = byHour[hour];
    const hourSize = hourFiles.reduce((sum, f) => sum + f.size, 0);
    const timestamp = new Date(hourFiles[0].mtime).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });

    console.log(`\n🕐 ${hour}:00 - ${hourFiles.length} files (${(hourSize / 1024).toFixed(1)} KB)`);

    for (const file of hourFiles) {
      const sizeKB = (file.size / 1024).toFixed(1);
      console.log(`   ├── ${file.name} (${sizeKB} KB)`);
    }
  }

  // Analysis
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('\n📊 Analysis:');

  const avgSize = files.length > 0 ? totalSize / files.length / 1024 : 0;
  const minSize = Math.min(...files.map(f => f.size)) / 1024;
  const maxSize = Math.max(...files.map(f => f.size)) / 1024;

  console.log(`   Files: ${files.length}`);
  console.log(`   Avg size: ${avgSize.toFixed(1)} KB`);
  console.log(`   Size range: ${minSize.toFixed(1)} - ${maxSize.toFixed(1)} KB`);
  console.log(`   Active hours: ${hours.length}`);

  // Quality check
  const smallFiles = files.filter(f => f.size < 500).length;
  const largeFiles = files.filter(f => f.size > 5000).length;

  console.log(`\n⚠️ Quality Issues:`);
  console.log(`   Small files (<500B): ${smallFiles}`);
  console.log(`   Large files (>5KB): ${largeFiles}`);

  // Recommendations
  console.log(`\n💡 Recommendations:`);

  if (files.length < 10) {
    console.log(`   ⚠️ Low file count - consider increasing cron frequency`);
  } else if (files.length > 50) {
    console.log(`   ⚠️ High file count - may want to decrease frequency`);
  } else {
    console.log(`   ✅ File count looks good (10-50)`);
  }

  if (smallFiles > files.length * 0.5) {
    console.log(`   ⚠️ Many small files - cron may be running too frequently`);
  }

  if (avgSize < 0.5) {
    console.log(`   ⚠️ Average file size too small - check for empty entries`);
  }
}

function showStats() {
  console.log('\n📈 Memory Directory Statistics\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get all dates
  let dates = [];
  try {
    dates = fs.readdirSync(MEMORY_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}(?:-.*)?\.md$/.test(f) && !f.includes('l0-') && !f.includes('l1-'))
      .map(f => f.substring(0, 10))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()
      .reverse()
      .slice(0, 7); // Last 7 days
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
    return;
  }

  for (const date of dates) {
    const datePattern = new RegExp(`^${date}(?:\\.md|-.*\\.md)$`);
    let files = [];
    try {
      files = fs.readdirSync(MEMORY_DIR)
        .filter(f => datePattern.test(f) && !f.includes('l0-') && !f.includes('l1-'));
    } catch (e) {
      continue;
    }

    let totalSize = 0;
    for (const f of files) {
      try {
        totalSize += fs.statSync(path.join(MEMORY_DIR, f)).size;
      } catch (e) {
        // ignore
      }
    }

    const avgSize = files.length > 0 ? totalSize / files.length / 1024 : 0;
    console.log(`📅 ${date}: ${files.length} files, avg ${avgSize.toFixed(1)} KB`);
  }

  console.log('');
}

// Main
const args = process.argv.slice(2);
const targetDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || null;

if (args.includes('--stats')) {
  showStats();
} else {
  scanSources(targetDate);
}
