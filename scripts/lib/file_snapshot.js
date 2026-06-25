#!/usr/bin/env node
/**
 * scripts/lib/snapshot.js — Snapshot/rollback helper for auto-repair wiring.
 *
 * Mimics the existing .fix_snapshots/<file>.<ts>.<pid>.pre pattern.
 *
 * Public API:
 *   const snap = require('./lib/snapshot');
 *
 *   snap.snapshotFile(absPath)         → string (snapshot path) or throws
 *   snap.rollback(snapshotPath, dst)   → boolean (true on success)
 *   snap.cleanOldSnapshots(maxAgeDays) → number of files removed
 *
 * Errors propagate to the caller (audit_repair_wire.js) which decides whether
 * to abort the fix. We never swallow errors silently — that would risk
 * corrupting source files with literal "undefined" content.
 *
 * Created: 2026-06-19 (Phase 2e)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { WS } = require('./config');

const SNAPSHOT_DIR = path.join(WS, '.fix_snapshots');

// 1 hour = 60 * 60 seconds (for time-to-ms conversion)
const SECONDS_PER_HOUR = 3600;
const MS_PER_DAY = SECONDS_PER_HOUR * 1000 * 24;

/**
 * Ensure the snapshot directory exists. Idempotent.
 */
function ensureSnapshotDir() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    try {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    } catch (e) {
      throw e;
    }
  }
}

/**
 * Snapshot a single file. Returns the absolute path of the snapshot.
 * Format: <basename>.<epoch_ms>.<pid>.pre
 *
 * @param {string} absPath - Absolute path of the file to snapshot.
 * @returns {string} Absolute path of the snapshot file.
 * @throws {Error} if the source file is unreadable or snapshot dir unwritable.
 */
function snapshotFile(absPath) {
  if (!absPath || typeof absPath !== 'string') {
    throw new Error('snapshotFile: absPath required');
  }
  if (!fs.existsSync(absPath)) {
    throw new Error(`snapshotFile: source not found: ${absPath}`);
  }

  ensureSnapshotDir();

  const ts = Date.now();
  const pid = process.pid;
  const basename = path.basename(absPath);
  const snapPath = path.join(SNAPSHOT_DIR, `${basename}.${ts}.${pid}.pre`);

  let content;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    throw e;
  }
  // atomic-ish: write tmp, rename. .pre suffix matches prior convention.
  const tmpPath = snapPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
  } catch (e) {
    throw e;
  }
  fs.renameSync(tmpPath, snapPath);

  return snapPath;
}

/**
 * Rollback a file from a snapshot.
 *
 * @param {string} snapshotPath - Absolute path of the snapshot file.
 * @param {string} [dstPath] - Destination (defaults to original = strip .<ts>.<pid>.pre).
 * @returns {boolean} true on success.
 * @throws {Error} if the snapshot is missing or destination is not writable.
 */
function rollback(snapshotPath, dstPath) {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    throw new Error(`rollback: snapshot not found: ${snapshotPath}`);
  }

  let target = dstPath;
  if (!target) {
    const base = path.basename(snapshotPath);
    // strip trailing .<digits>.<digits>.pre
    const m = base.match(/^(.+?)\.\d+\.\d+\.pre$/);
    if (!m) {
      throw new Error(`rollback: cannot derive original path from ${snapshotPath}`);
    }
    target = path.join(WS, m[1]);
  }

  let content;
  try {
    content = fs.readFileSync(snapshotPath, 'utf8');
  } catch (e) {
    throw e;
  }
  const tmpPath = target + '.rollback.tmp';
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
  } catch (e) {
    throw e;
  }
  fs.renameSync(tmpPath, target);
  return true;
}

/**
 * Delete snapshots older than maxAgeDays.
 *
 * @param {number} [maxAgeDays=14] - Retention window.
 * @returns {number} Count of files removed.
 */
function cleanOldSnapshots(maxAgeDays = 14) {
  if (!fs.existsSync(SNAPSHOT_DIR)) return 0;
  const cutoff = Date.now() - maxAgeDays * MS_PER_DAY;
  let files;
  try {
    files = fs.readdirSync(SNAPSHOT_DIR);
  } catch (e) {
    throw e;
  }
  let removed = 0;
  for (const f of files) {
    const m = f.match(/\.(\d+)\.\d+\.pre$/);
    if (!m) continue;
    const ts = parseInt(m[1], 10);
    if (!isNaN(ts) && ts < cutoff) {
      try {
        fs.unlinkSync(path.join(SNAPSHOT_DIR, f));
        removed++;
      } catch (_) { /* best effort */ }
    }
  }
  return removed;
}

module.exports = {
  SNAPSHOT_DIR,
  snapshotFile,
  rollback,
  cleanOldSnapshots,
  ensureSnapshotDir,
};
