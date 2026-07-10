#!/usr/bin/env node
/**
 * cron_failure_maintenance.js — diagnostics log rotation
 *
 * Phase 1 SHADOW helper — when the JSONL log exceeds MAX_LOG_BYTES it is
 * rotated to the last MAX_LOG_LINES entries (atomic write — never delete
 * blindly; the tail is always preserved).
 *
 * Used by daily HKT 23:55 crontab entry. Safe to invoke repeatedly.
 *
 * Usage:
 *   node cron_failure_maintenance.js            # rotate if needed
 *   node cron_failure_maintenance.js --force    # rotate even if under cap
 *   node cron_failure_maintenance.js --status   # print file size + line count
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { STATE_DIR } = require('./lib/config');

const DIAG_FILE = path.join(STATE_DIR, 'cron_failure_diagnostics.jsonl');
const MAX_LOG_BYTES = parseInt('52428800', 10);   // 50MB
const MAX_LOG_LINES = parseInt('10000', 10);

function getStatus() {
  let size = 0;
  let lineCount = 0;
  try {
    const stat = fs.statSync(DIAG_FILE);
    size = stat.size;
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
    return { exists: false, size, lineCount, maxBytes: MAX_LOG_BYTES, maxLines: MAX_LOG_LINES };
  }
  try {
    const raw = fs.readFileSync(DIAG_FILE, 'utf8');
    lineCount = raw.length === 0 ? 0 : raw.split(/\r?\n/).filter(Boolean).length;
  } catch (err) {
    // size reported, line count best-effort
  }
  return { exists: true, size, lineCount, maxBytes: MAX_LOG_BYTES, maxLines: MAX_LOG_LINES };
}

function rotateIfNeeded(force) {
  const status = getStatus();
  if (!status.exists) {
    return { rotated: false, reason: 'no-log-file' };
  }
  const overSize = status.size > MAX_LOG_BYTES;
  // Line cap: only meaningful if we can read line count. Just count bytes + check line count.
  const overLines = typeof status.lineCount === 'number' && status.lineCount > MAX_LOG_LINES;
  if (!force && !overSize && !overLines) {
    return { rotated: false, reason: 'under-cap', size: status.size, lineCount: status.lineCount };
  }

  let raw;
  try {
    raw = fs.readFileSync(DIAG_FILE, 'utf8');
  } catch (err) {
    return { rotated: false, reason: 'read-failed', error: err.message };
  }
  const lines = raw.length === 0 ? [] : raw.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-MAX_LOG_LINES);
  const rotated = JSON.stringify({
    rotatedAt: new Date().toISOString(),
    previousLineCount: lines.length,
    previousSizeBytes: status.size,
    keptLines: tail.length,
  }) + '\n';
  const newContent = rotated + tail.join('\n') + '\n';

  // Atomic replace
  const tmpFile = DIAG_FILE + '.tmp.' + process.pid + '.' + Date.now();
  try {
    fs.writeFileSync(tmpFile, newContent, 'utf8');
    fs.renameSync(tmpFile, DIAG_FILE);
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    return { rotated: false, reason: 'write-failed', error: err.message };
  }
  return {
    rotated: true,
    previousSize: status.size,
    previousLineCount: lines.length,
    keptLines: tail.length,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`cron_failure_maintenance.js — diagnostics log rotation

Usage:
  node cron_failure_maintenance.js             # rotate only when over cap
  node cron_failure_maintenance.js --force     # rotate unconditionally
  node cron_failure_maintenance.js --status    # show file size + line count

Log: ${DIAG_FILE}
Cap: ${MAX_LOG_BYTES} bytes (~50MB) or ${MAX_LOG_LINES} lines
`);
    process.exit(0);
  }
  const force = args.includes('--force');

  if (args.includes('--status')) {
    const s = getStatus();
    console.log(JSON.stringify(s, null, 2));
    process.exit(0);
  }

  const result = rotateIfNeeded(force);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.rotated || (!force && result.reason === 'under-cap') ? 0 : 1);
}

main();

module.exports = {
  rotateIfNeeded,
  getStatus,
  MAX_LOG_BYTES,
  MAX_LOG_LINES,
  DIAG_FILE,
};
