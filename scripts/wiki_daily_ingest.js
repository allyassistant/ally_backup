#!/usr/bin/env node
/**
 * wiki_daily_ingest.js — 直接寫入 Wiki Sources（唔經 CLI subprocess）
 *
 * 每日 01:00 將 MEMORY.md、L0 Abstract、L1 Overview
 * 直接寫入 wiki/main/sources/ 目錄。
 * 取代舊 wiki_ingest_helper.mjs 嘅 CLI subprocess + fallback 流程。
 *
 * 用法：
 *   node scripts/wiki_daily_ingest.js [--dry-run] [--quiet]
 *
 * Created: 2026-06-19 (替代 wiki_ingest_helper.mjs CLI-first 流程)
 */

const fs = require('fs');
const path = require('path');

// ── 路徑 ──

const HOME = process.env.HOME || process.env.USERPROFILE || '/Users/ally';
const WS = path.join(HOME, '.openclaw', 'workspace');
const WIKI_SOURCES_DIR = path.join(WS, 'wiki', 'main', 'sources');
const MEMORY_DIR = path.join(WS, 'memory');
const MEMORY_FILE = path.join(WS, 'MEMORY.md');

// ── 日期計算 ──
// L0/L1 files are written by memory_generator.js using HKT-date filenames
// (see HEARTBEAT.md "每日 00:05 L0 Generator"). Using UTC dates here would
// pick up files 1 day stale when cron runs at 01:00 HKT (= 17:00 UTC prev day).
// FIX (2026-06-21): align with HKT to match generator's filename convention.
function hktDateString(d) {
  const hkt = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = hkt.getUTCFullYear();
  const m = String(hkt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(hkt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
const dateStr = hktDateString(now);            // YYYY-MM-DD in HKT
const yesterdayStr = hktDateString(yesterday); // YYYY-MM-DD-1 in HKT

// ── CLI flags ──
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isQuiet = args.includes('--quiet');

function log(msg) { if (!isQuiet) console.log(msg); }
function warn(msg) { console.warn(`⚠️ ${msg}`); }

// ── Sources to ingest ──
// MEMORY.md: static file
// L0 Abstract: memory/l0-abstract/YYYY-MM-DD.md (今日)
//   If today's doesn't exist yet, fall back to yesterday's
// L1 Overview: memory/l1-overview/YYYY-MM-DD.md (今日)
//   If today's doesn't exist yet, fall back to yesterday's

function resolveSourceFiles() {
  const sources = [];

  // 1. MEMORY.md
  if (fs.existsSync(MEMORY_FILE)) {
    sources.push({
      filePath: MEMORY_FILE,
      title: 'MEMORY.md — 長期記憶 (L0: Abstract)',
      slug: 'memory-lean-long-term-memory',
    });
  } else {
    warn('MEMORY.md not found');
  }

  // 2. L0 Abstract (today → yesterday fallback)
  const l0Today = path.join(MEMORY_DIR, 'l0-abstract', `${dateStr}.md`);
  const l0Yesterday = path.join(MEMORY_DIR, 'l0-abstract', `${yesterdayStr}.md`);
  let l0Path = null;
  if (fs.existsSync(l0Today)) {
    l0Path = l0Today;
  } else if (fs.existsSync(l0Yesterday)) {
    l0Path = l0Yesterday;
    log('L0 today not ready, using yesterday: ' + l0Yesterday);
  }
  if (l0Path) {
    sources.push({
      filePath: l0Path,
      title: `L0 Abstract — ${path.basename(l0Path, '.md')}`,
      slug: `l0-abstract-${path.basename(l0Path, '.md')}`,
    });
  } else {
    warn('L0 Abstract not found (today or yesterday)');
  }

  // 3. L1 Overview (today → yesterday fallback)
  const l1Today = path.join(MEMORY_DIR, 'l1-overview', `${dateStr}.md`);
  const l1Yesterday = path.join(MEMORY_DIR, 'l1-overview', `${yesterdayStr}.md`);
  let l1Path = null;
  if (fs.existsSync(l1Today)) {
    l1Path = l1Today;
  } else if (fs.existsSync(l1Yesterday)) {
    l1Path = l1Yesterday;
    log('L1 today not ready, using yesterday: ' + l1Yesterday);
  }
  if (l1Path) {
    sources.push({
      filePath: l1Path,
      title: `L1 Overview — ${path.basename(l1Path, '.md')}`,
      slug: `l1-overview-${path.basename(l1Path, '.md')}`,
    });
  } else {
    warn('L1 Overview not found (today or yesterday)');
  }

  return sources;
}

// ── Safe slug ──

function toSlug(text) {
  return text
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

// ── Direct write to wiki sources ──

function writeSource(inputPath, title) {
  const slug = title ? toSlug(title) : toSlug(path.basename(inputPath, path.extname(inputPath)));
  const filename = `auto-${slug || 'ingest'}-${Date.now()}.md`;
  const destPath = path.join(WIKI_SOURCES_DIR, filename);

  let content;
  try {
    content = fs.readFileSync(inputPath, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
    return null;  // early return — don't write undefined
  }
  if (content === undefined || content === null) return null;

  // Atomic write
  const tmpPath = destPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, destPath);
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    return null;
  }

  return destPath;
}

// ── Main ──

function main() {
  // Ensure wiki sources dir exists
  if (!fs.existsSync(WIKI_SOURCES_DIR)) {
    if (isDryRun) {
      log(`[dry-run] Would create: ${WIKI_SOURCES_DIR}`);
    } else {
      try {
        fs.mkdirSync(WIKI_SOURCES_DIR, { recursive: true });
      } catch (e) {
        console.error(`Directory creation failed: ${e.message}`);
      }
    }
  }

  const sources = resolveSourceFiles();
  log(`Found ${sources.length} source files to ingest`);

  let ingested = 0;
  let errors = 0;

  for (const src of sources) {
    if (isDryRun) {
      log(`[dry-run] ${src.title} → ${WIKI_SOURCES_DIR}/auto-${src.slug}-*.md`);
      ingested++;
      continue;
    }

    try {
      const destPath = writeSource(src.filePath, src.title);
      log(`✅ ${src.title} → ${path.relative(WS, destPath)}`);
      ingested++;
    } catch (e) {
      warn(`Write failed for ${src.title}: ${e.message}`);
      errors++;
    }
  }

  log(`\nDone: ${ingested} ingested, ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
