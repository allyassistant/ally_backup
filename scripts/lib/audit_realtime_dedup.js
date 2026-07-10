/**
 * scripts/lib/audit_realtime_dedup.js — Smart dedup for daily cron audit
 *
 * Phase A+ (2026-06-20): When LLM writes/edits a file, the real-time
 * audit (scripts/audit_just_written.js) appends an "override" entry to
 * .state/audit_realtime_overrides.jsonl capturing:
 *   - ts: when the audit ran
 *   - file: file path (absolute)
 *   - mtime: file mtime at audit time (ms epoch)
 *   - severity: 'none' | 'low' | 'medium' | 'high' | 'critical'
 *   - issueCount: number of issues found
 *
 * The daily 04:30 cron uses these overrides to skip files that:
 *   1. Have been audited by real-time (override entry exists)
 *   2. Have NOT been modified since the override (file mtime ≤ override.mtime)
 *   3. Override severity is benign ('none' or 'low') — i.e., file is clean
 *      enough that re-running the full audit would only repeat work.
 *
 * Files with 'medium'/'high'/'critical' overrides are NEVER skipped:
 *   - They need full audit rules (Layer 2/3/custom) that real-time doesn't run
 *   - They feed the repair pipeline (audit_repair_proposer reads audit
 *     results to auto-fix; skipping these would break the auto-fix loop)
 *
 * Stale overrides (>24h) are auto-discarded: file may have been modified
 * outside any LLM tool call (git pull, manual edit, cron script).
 *
 * Usage:
 *   const dedup = require('./lib/audit_realtime_dedup');
 *   const result = dedup.filterFiles(['/abs/path/a.js', '/abs/path/b.js']);
 *   console.log(result.kept, result.skipped);
 */

'use strict';

const fs = require('fs');
const { ONE_HOUR_MS } = require('./time_constants');
const path = require('path');

const { STATE_DIR } = require('./config');

const OVERRIDE_LOG = path.join(STATE_DIR, 'audit_realtime_overrides.jsonl');
const STALE_HOURS = 24;
// Severity levels below which we trust real-time audit and skip re-audit.
// Anything at or above this threshold MUST be re-audited by the daily cron
// so the repair pipeline sees the full rule set's verdict.
const SAFE_TO_SKIP = new Set(['none', 'low']);

/**
 * Load override entries from the last `sinceHours` hours.
 * Returns Map<file (absolute path), { mtime, severity, ts, issueCount }>.
 *
 * Best-effort: missing file → empty Map. Corrupt JSONL lines → skipped.
 */
function loadOverrides(sinceHours = STALE_HOURS) {
  const out = new Map();
  if (!fs.existsSync(OVERRIDE_LOG)) return out;

  const cutoffMs = Date.now() - sinceHours * ONE_HOUR_MS;
  let raw;
  try {
    raw = fs.readFileSync(OVERRIDE_LOG, 'utf8');
  } catch (_) {
    return out;
  }

  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.file || !entry.mtime || !entry.severity || !entry.ts) continue;
      // Drop stale entries (older than sinceHours)
      if (new Date(entry.ts).getTime() < cutoffMs) continue;
      // Keep the FRESHEST entry per file (multiple audits on same file)
      const existing = out.get(entry.file);
      if (!existing || entry.mtime > existing.mtime) {
        out.set(entry.file, {
          mtime: entry.mtime,
          severity: entry.severity,
          ts: entry.ts,
          issueCount: entry.issueCount || 0,
        });
      }
    } catch (_) {
      // Skip corrupt JSONL lines — fail-open.
    }
  }

  return out;
}

/**
 * Append one override entry. Called by scripts/audit_just_written.js after
 * each scan. Best-effort: any write error → silently dropped (audit result
 * is more important than the override log).
 */
function appendOverride(file, mtime, severity, issueCount) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      file,
      mtime,
      severity,
      issueCount,
    };
    fs.mkdirSync(path.dirname(OVERRIDE_LOG), { recursive: true });
    fs.appendFileSync(OVERRIDE_LOG, JSON.stringify(entry) + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Decide which files to skip vs. keep.
 *
 * @param {string[]} files — array of absolute file paths (from discoverJsFiles)
 * @param {object} [opts]
 * @param {number} [opts.sinceHours=24] — drop overrides older than this
 * @param {Set<string>} [opts.safeToSkip] — severities eligible for skipping
 * @returns {{ kept: string[], skipped: Array<{file, reason, severity}>, stats: object }}
 */
function filterFiles(files, opts = {}) {
  const sinceHours = opts.sinceHours || STALE_HOURS;
  const safeToSkip = opts.safeToSkip || SAFE_TO_SKIP;
  const overrides = loadOverrides(sinceHours);

  const kept = [];
  const skipped = [];
  const stats = {
    total: files.length,
    freshOverride: 0,    // override exists + file unchanged + safe severity
    fileChanged: 0,      // override exists but file mtime > override.mtime
    highSeverity: 0,     // override exists but severity needs full audit
    staleOverride: 0,    // override > sinceHours old (counted in `fileChanged`)
    noOverride: 0,       // no override → first-time audit
  };

  for (const file of files) {
    const override = overrides.get(file);

    // Pre-check file existence if no override (avoid passing missing files).
    if (!override) {
      try {
        fs.statSync(file);
      } catch (_) {
        skipped.push({ file, reason: 'file_missing', severity: 'none' });
        stats.noOverride++;
        continue;
      }
      kept.push(file);
      stats.noOverride++;
      continue;
    }

    // Override exists — check current file mtime
    let currentMtime = 0;
    try {
      const stat = fs.statSync(file);
      currentMtime = stat.mtimeMs;
    } catch (_) {
      // File deleted or unreadable — skip it (don't pass to audit)
      skipped.push({ file, reason: 'file_missing', severity: override.severity });
      continue;
    }

    // File modified after the override → must re-audit
    if (currentMtime > override.mtime) {
      kept.push(file);
      stats.fileChanged++;
      continue;
    }

    // Override is fresh + file unchanged. Check severity.
    if (!safeToSkip.has(override.severity)) {
      kept.push(file);
      stats.highSeverity++;
      continue;
    }

    // Safe to skip
    skipped.push({
      file,
      reason: 'realtime_clean',
      severity: override.severity,
      issueCount: override.issueCount,
      overrideTs: override.ts,
    });
    stats.freshOverride++;
  }

  return { kept, skipped, stats };
}

/**
 * Compact the override log: drop entries older than `sinceHours`.
 * Best-effort, fail-open. Returns number of entries removed.
 *
 * Run occasionally by the daily cron to keep the log file small.
 */
function compactOverrides(sinceHours = STALE_HOURS) {
  if (!fs.existsSync(OVERRIDE_LOG)) return 0;
  let raw;
  try {
    raw = fs.readFileSync(OVERRIDE_LOG, 'utf8');
  } catch (_) {
    return 0;
  }

  const cutoffMs = Date.now() - sinceHours * ONE_HOUR_MS;
  const kept = [];
  let removed = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (new Date(entry.ts).getTime() >= cutoffMs) {
        kept.push(line);
      } else {
        removed++;
      }
    } catch (_) {
      // Drop corrupt lines
      removed++;
    }
  }

  try {
    fs.writeFileSync(OVERRIDE_LOG, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  } catch (_) {
    return 0;
  }
  return removed;
}

module.exports = {
  OVERRIDE_LOG,
  STALE_HOURS,
  SAFE_TO_SKIP,
  loadOverrides,
  appendOverride,
  filterFiles,
  compactOverrides,
};
