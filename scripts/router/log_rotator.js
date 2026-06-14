/**
 * Log Rotator — Simple size-based rotation for JSON Lines logs.
 *
 * When a log file exceeds maxSizeMB, it is rotated:
 *   decision_log.jsonl → decision_log.jsonl.1
 *   decision_log.jsonl.1 → decision_log.jsonl.2
 *   ... up to maxFiles backups.
 */

'use strict';

const fs = require('fs');

const DEFAULT_MAX_SIZE_MB = 10;
const DEFAULT_MAX_FILES = 5;

/** In-memory lock to prevent concurrent rotation races */
const rotationLocks = new Set();

/** Throttle map: filePath → last check timestamp (ms) */
const lastCheckTime = new Map();
const ROTATION_CHECK_INTERVAL_MS = 5_000; // Check size at most every 5 seconds per file

/**
 * Rotate log file backups. Synchronous, atomic-ish (rename is atomic on POSIX).
 */
function rotateFile(filePath, maxFiles) {
  // Delete oldest backup if it exists
  const oldest = `${filePath}.${maxFiles}`;
  try { fs.unlinkSync(oldest); } catch (err) { /* ignore if not exists */ }

  // Shift backups: .(n-1) → .n
  for (let i = maxFiles - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    try { fs.renameSync(src, dst); } catch (err) { /* ignore if src not exists */ }
  }

  // Move current file to .1
  try { fs.renameSync(filePath, `${filePath}.1`); } catch (err) { /* ignore */ }
}

/**
 * Check if rotation is needed and perform it. Synchronous.
 * Uses an in-memory lock to prevent concurrent races.
 */
function maybeRotate(filePath, maxSizeMB = DEFAULT_MAX_SIZE_MB, maxFiles = DEFAULT_MAX_FILES) {
  // Skip if another rotation for this file is in progress
  if (rotationLocks.has(filePath)) return;

  // Throttle: check at most every ROTATION_CHECK_INTERVAL_MS per file
  const now = Date.now();
  const lastChecked = lastCheckTime.get(filePath) || 0;
  if (now - lastChecked < ROTATION_CHECK_INTERVAL_MS) return;
  lastCheckTime.set(filePath, now);

  // Acquire lock BEFORE stat to prevent TOCTOU race
  rotationLocks.add(filePath);
  try {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    try {
      const stats = fs.statSync(filePath);
      if (stats.size >= maxSizeBytes) {
        rotateFile(filePath, maxFiles);
      }
    } catch (err) {
      // File doesn't exist yet — no rotation needed
      if (err.code !== 'ENOENT') {
        console.warn(`[log_rotator] stat failed for ${filePath}: ${err.message}`);
      }
    }
  } finally {
    rotationLocks.delete(filePath);
  }
}

module.exports = {
  maybeRotate,
  rotateFile,
  DEFAULT_MAX_SIZE_MB,
  DEFAULT_MAX_FILES,
};
