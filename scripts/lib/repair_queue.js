/**
 * scripts/lib/repair_queue.js
 *
 * Append-only fix tracking queue.
 * Single source of truth for all repair events (auto_fix.js, sub-agents, manual edits).
 *
 * Format: JSONL — one JSON object per line.
 * Queue file: .state/repair_queue.jsonl
 *
 * Entry schema:
 * {
 *   "id": "<uuid>",
 *   "file": "scripts/xxx.js",
 *   "line": 26,
 *   "rule": "fsSync_missing_trycatch",
 *   "status": "fixed" | "skipped" | "quarantined",
 *   "actor": "auto_fix.js | sub-agent:<taskName> | manual",
 *   "timestamp": "<ISO-8601>",
 *   "details": "<optional string>"
 * }
 *
 * Consumer: cqm_daily_digest.js (reads queue → groups by status → reports)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const QUEUE_FILE = path.join(__dirname, '../../.state/repair_queue.jsonl');

/**
 * Append a single entry to the queue.
 * Silently ignores errors (never blocks caller).
 *
 * @param {Object} entry - Queue entry (id/timestamp added automatically)
 */
function append(entry) {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true, mode: 0o700 });
    const record = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(QUEUE_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // Never throw — queue write failure must not block the fix
  }
}

/**
 * Read all entries from the queue.
 * Returns empty array if file doesn't exist.
 *
 * @returns {Object[]}
 */
function readAll() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const content = fs.readFileSync(QUEUE_FILE, 'utf8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the count of entries by status.
 * Useful for digest summary.
 *
 * @returns {{ total: number, fixed: number, skipped: number, quarantined: number }}
 */
function getCounts() {
  const entries = readAll();
  const counts = { total: entries.length, fixed: 0, skipped: 0, quarantined: 0 };
  for (const e of entries) {
    if (e.status === 'fixed') counts.fixed++;
    else if (e.status === 'skipped') counts.skipped++;
    else if (e.status === 'quarantined') counts.quarantined++;
  }
  return counts;
}

/**
 * Check if a specific (file, line, rule) has already been fixed.
 * Returns the matching entry or null.
 *
 * @param {string} file
 * @param {number} line
 * @param {string} rule
 * @returns {Object|null}
 */
function findEntry(file, line, rule) {
  const entries = readAll();
  return (
    entries.find(
      (e) =>
        e.file === file &&
        e.line === line &&
        e.rule === rule &&
        e.status === 'fixed'
    ) || null
  );
}

/**
 * Clear the entire queue.
 * Use with caution — primarily for testing/reset.
 */
function clear() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      fs.unlinkSync(QUEUE_FILE);
    }
  } catch {
    // Ignore
  }
}

/**
 * Migrate legacy auto_repair_pending_approval.json entries to new queue format.
 * Only migrated if queue is empty (idempotent).
 *
 * @param {string} legacyFile - Path to legacy auto_repair_pending_approval.json
 * @returns {number} Number of entries migrated
 */
function migrateLegacy(legacyFile) {
  if (fs.existsSync(QUEUE_FILE)) {
    const existing = readAll();
    if (existing.length > 0) return 0; // Queue already has data, skip
  }

  try {
    if (!fs.existsSync(legacyFile)) return 0;
    const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    if (!Array.isArray(legacy)) return 0;

    let migrated = 0;
    for (const entry of legacy) {
      const issue = entry.issue || {};
      append({
        file: issue.file || 'unknown',
        line: issue.line || 0,
        rule: issue.rule || 'unknown',
        status: 'legacy_pending',
        actor: 'migration',
        details: `Legacy entry from ${legacyFile} — approved:${entry.approved}`,
      });
      migrated++;
    }
    return migrated;
  } catch {
    return 0;
  }
}

module.exports = {
  append,
  readAll,
  getCounts,
  findEntry,
  clear,
  migrateLegacy,
  QUEUE_FILE,
};
