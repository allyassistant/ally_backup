'use strict';

/**
 * disk_guard.js — Shared ENOSPC/disk-full safety wrapper
 *
 * Wraps write/rename operations with graceful ENOSPC handling.
 * On disk-full, logs a warning and returns gracefully instead of crashing.
 * Other errors are re-thrown.
 *
 * Usage:
 *   const { withDiskGuard } = require('./lib/disk_guard');
 *   withDiskGuard(() => fs.writeFileSync(path, data), path);
 */

const { writeFileSync, appendFileSync, renameSync, existsSync, mkdirSync } = require('fs');
const path = require('path');

/**
 * Wrap a synchronous write/rename operation with ENOSPC protection.
 *
 * @param {Function} fn - Synchronous function to execute (writeFileSync, appendFileSync, renameSync, etc.)
 * @param {string} description - Human-readable description of the operation (e.g., file path or label)
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.silent=false] - Suppress the warning log (for high-frequency writes)
 * @param {boolean} [options.returnError=false] - Return the error object instead of undefined on ENOSPC
 * @returns {*} Return value of fn, or undefined/error on ENOSPC
 * @throws {Error} Non-ENOSPC errors are re-thrown
 */
function withDiskGuard(fn, description, options = {}) {
  try {
    return fn();
  } catch (err) {
    if (err && err.code === 'ENOSPC') {
      const msg = `⚠️ Disk full: ${description} — skipping write`;
      if (!options.silent) {
        console.warn(msg);
      }
      // Return gracefully — either void or the error object
      return options.returnError ? err : undefined;
    }
    // Re-throw all other errors
    throw err;
  }
}

/**
 * Safe writeFileSync with ENOSPC guard.
 *
 * @param {string} filepath - Path to write
 * @param {string|Buffer} data - Data to write
 * @param {Object|string} [options] - Encoding options (same as fs.writeFileSync)
 * @returns {boolean} true on success, false on ENOSPC
 */
function safeWriteFileSync(filepath, data, options = 'utf8') {
  const result = withDiskGuard(
    () => writeFileSync(filepath, data, options),
    filepath,
    { returnError: true }
  );
  return !(result && result.code === 'ENOSPC');
}

/**
 * Append to a file with ENOSPC guard. Creates parent dirs if needed.
 *
 * @param {string} filepath - Path to append to
 * @param {string} data - Data to append
 * @param {Object|string} [options] - Encoding options
 * @returns {boolean} true on success, false on ENOSPC
 */
function safeAppendFileSync(filepath, data, options = 'utf8') {
  // Ensure parent directory exists
  const dir = path.dirname(filepath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch (_) {}
  }
  const result = withDiskGuard(
    () => appendFileSync(filepath, data, options),
    filepath,
    { returnError: true }
  );
  return !(result && result.code === 'ENOSPC');
}

/**
 * Safe renameSync with ENOSPC guard.
 *
 * @param {string} oldPath - Current path
 * @param {string} newPath - New path
 * @returns {boolean} true on success, false on ENOSPC
 */
function safeRenameSync(oldPath, newPath) {
  const result = withDiskGuard(
    () => renameSync(oldPath, newPath),
    `${oldPath} → ${newPath}`,
    { returnError: true }
  );
  return !(result && result.code === 'ENOSPC');
}

/**
 * Atomic JSON write: write to .tmp first, then rename, with ENOSPC guard.
 *
 * @param {string} filepath - Final file path
 * @param {*} data - Data to serialize as JSON
 * @returns {boolean} true on success, false on ENOSPC (skipped gracefully)
 */
function atomicWriteJsonSafe(filepath, data) {
  // Include process pid + random suffix to avoid race between concurrent
  // atomic writes to the same filepath in the same millisecond
  const tmp = filepath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
  // First write to temp (catches ENOSPC)
  const writeOk = safeWriteFileSync(tmp, JSON.stringify(data, null, 2));
  if (!writeOk) return false;
  // Then rename (catches ENOSPC on full filesystem too)
  const renameOk = safeRenameSync(tmp, filepath);
  if (!renameOk) {
    // Clean up temp file on rename failure
    try { if (existsSync(tmp)) renameSync(tmp, tmp + '.orphaned'); } catch (_) {}
    return false;
  }
  return true;
}

module.exports = {
  withDiskGuard,
  safeWriteFileSync,
  safeAppendFileSync,
  safeRenameSync,
  atomicWriteJsonSafe
};
