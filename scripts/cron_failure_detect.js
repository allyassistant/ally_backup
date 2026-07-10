#!/usr/bin/env node
/**
 * cron_failure_detect.js — Detection logic for cron failures
 *
 * Phase 1 SHADOW only — diagnostic logging. No side effects.
 *
 * Inputs:
 *   - OpenClaw cron job list: `openclaw cron list --json` (per-cron run status,
 *     consecutiveErrors, last diagnostics with exit codes).
 *   - System crontab log files (tail-scanned for ERROR/failed/exception/exit-code-1).
 *
 * Output: a list of observation records:
 *   { cronId, source, name, status, consecutiveErrors, lastErrorAt,
 *     lastErrorMessage, errorCount (delta), badLines: [...] }
 *
 * `state` is read from `.state/cron_failure_watcher.json` to compute
 * "since-last-check" deltas for system log files (offsets in bytes).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { STATE_DIR, WS } = require('./lib/config');

// ───────────────────────────────────────────────────────────────────────────
// Tunables (all referenced via CONFIG below)
// ───────────────────────────────────────────────────────────────────────────
const SYSTEM_LOG_TAIL_LINES = 50;
const SYSTEM_LOG_MAX_BYTES = parseInt('65536', 10);  // 64KB
const OPENCLAW_CRON_BIN = 'openclaw';
const OPENCLAW_CRON_LIST_ARGS = ['cron', 'list', '--json'];

const ERROR_PATTERNS = [
  /\bERROR\b/,
  /\bFATAL\b/,
  /\bfailed\b/i,
  /exit code:\s*[1-9]\d*/i,
  /exception\b/i,
  /\bunhandled\b/i,
  /\bcrash(?:ed)?\b/i,
  /\btimeout\b/i,
];

const SYSTEM_LOG_FILES = [
  // Per HEARTBEAT.md "系統 Crontab" section (active + recently-active)
  '/tmp/failover.log',
  '/tmp/mail_monitor.log',
  '/tmp/backup_to_bliss.log',
  '/tmp/metrics_collector.log',
  path.join(STATE_DIR, 'drift_detector.log'),
  path.join(STATE_DIR, 'audit_cron.log'),
  path.join(STATE_DIR, 'repair_proposer_cron.log'),
  path.join(STATE_DIR, 'audit_to_skill_emitter_cron.log'),
  path.join(STATE_DIR, 'propose_fix_notifier_cron.log'),
  path.join(STATE_DIR, 'skill_proposal_alert.log'),
  path.join(STATE_DIR, 'skill_pattern_emitter_cron.log'),
  path.join(STATE_DIR, 'auto_corrector.log'),
  path.join(STATE_DIR, 'daily_telemetry_digest_cron.log'),
];

// ───────────────────────────────────────────────────────────────────────────
// Public detection routines
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run `openclaw cron list --json` and return the parsed jobs array.
 * Returns { ok: true, jobs } or { ok: false, error }.
 */
function detectOpenclawCrons() {
  try {
    const out = execFileSync(OPENCLAW_CRON_BIN, OPENCLAW_CRON_LIST_ARGS, {
      encoding: 'utf8',
      maxBuffer: 16 * parseInt('1024', 10) * parseInt('1024', 10),  // 16MB
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(out);
    return { ok: true, jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * Filter OpenClaw jobs that show signs of failure.
 * A cron is "failing" if: status==='error', consecutiveErrors>0,
 * lastRunStatus !== 'ok', OR any lastDiagnostics entry has severity=='error'
 * or non-zero exitCode.
 */
function collectOpenclawFailures(jobs, allowList, denyList) {
  const observations = [];
  for (const job of jobs) {
    if (!job) continue;
    const id = job.id || '';
    if (!id) continue;
    if (allowList && allowList.length > 0 && !allowList.includes(id)) continue;
    if (denyList && denyList.length > 0 && denyList.includes(id)) continue;
    if (job.enabled === false) continue;

    const state = job.state || {};
    const status = job.status || 'unknown';
    const consecutiveErrors = typeof state.consecutiveErrors === 'number' ? state.consecutiveErrors : 0;
    const lastRunStatus = state.lastRunStatus || '';
    const lastRunAtMs = typeof state.lastRunAtMs === 'number' ? state.lastRunAtMs : null;
    const lastDiagnostics = state.lastDiagnostics || { entries: [] };
    const entries = Array.isArray(lastDiagnostics.entries) ? lastDiagnostics.entries : [];

    let errorEntryCount = 0;
    let lastBadEntry = null;
    for (const e of entries) {
      if (!e) continue;
      const sev = (e.severity || '').toLowerCase();
      const exitCode = typeof e.exitCode === 'number' ? e.exitCode : 0;
      if (sev === 'error' || (exitCode !== 0 && exitCode !== undefined)) {
        errorEntryCount++;
        if (!lastBadEntry || (e.ts && (!lastBadEntry.ts || e.ts > lastBadEntry.ts))) {
          lastBadEntry = e;
        }
      }
    }

    const isFailed =
      status === 'error' ||
      consecutiveErrors > 0 ||
      (lastRunStatus && lastRunStatus !== 'ok') ||
      errorEntryCount > 0;

    if (!isFailed) continue;

    observations.push({
      cronId: `openclaw:${id}`,
      source: 'openclaw',
      name: job.name || id,
      status,
      consecutiveErrors,
      lastErrorAt: lastBadEntry && lastBadEntry.ts ? new Date(lastBadEntry.ts).toISOString()
                  : (lastRunAtMs ? new Date(lastRunAtMs).toISOString() : null),
      lastErrorMessage: lastBadEntry ? (lastBadEntry.message || state.lastDiagnosticSummary || '')
                           : (state.lastDiagnosticSummary || ''),
      lastDiagnosticSummary: state.lastDiagnosticSummary || '',
      errorCount: errorEntryCount || (consecutiveErrors > 0 ? 1 : 0),
    });
  }
  return observations;
}

/**
 * Tail a system log file; return its lines + size + offset for delta tracking.
 * If `fromOffset` is provided, only bytes past that offset are returned.
 */
function readLogDelta(logPath, fromOffset) {
  let size = 0;
  try {
    const stat = fs.statSync(logPath);
    size = stat.size;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { lines: [], size: 0, offset: 0, missing: true };
    }
    throw err;
  }
  if (fromOffset && fromOffset >= size) {
    return { lines: [], size, offset: fromOffset, missing: false };
  }
  const start = fromOffset || Math.max(0, size - SYSTEM_LOG_MAX_BYTES);
  let raw;
  try {
    const fd = fs.openSync(logPath, 'r');
    try {
      const len = Math.min(SYSTEM_LOG_MAX_BYTES, size - start);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      raw = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return { lines: [], size, offset: start, missing: false, error: err.message };
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-SYSTEM_LOG_TAIL_LINES);
  return { lines: tail, size, offset: start + Buffer.byteLength(raw, 'utf8'), missing: false };
}

/**
 * Scan log lines for error patterns; return matching line indices.
 */
function findErrorLines(lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matched = null;
    for (const p of ERROR_PATTERNS) {
      if (p.test(line)) { matched = p.source; break; }
    }
    if (matched) hits.push({ idx: i, pattern: matched, line: line.slice(0, 240) });
  }
  return hits;
}

/**
 * For each known system log file, detect new error lines since last check.
 * `prevOffsets` shape: { [logPath]: number } — last seen byte offset.
 */
function detectSystemCronFailures(prevOffsets) {
  const observations = [];
  const newOffsets = {};
  for (const logPath of SYSTEM_LOG_FILES) {
    const fromOffset = (prevOffsets && typeof prevOffsets[logPath] === 'number')
      ? prevOffsets[logPath] : 0;
    let delta;
    try {
      delta = readLogDelta(logPath, fromOffset);
    } catch (err) {
      observations.push({
        cronId: `system-log:${path.basename(logPath)}`,
        source: 'system-log',
        name: path.basename(logPath),
        status: 'read-error',
        consecutiveErrors: 0,
        lastErrorAt: new Date().toISOString(),
        lastErrorMessage: err.message || String(err),
        errorCount: 0,
        warn: true,
      });
      continue;
    }
    newOffsets[logPath] = delta.offset;
    if (delta.missing) continue;

    const errors = findErrorLines(delta.lines);
    if (errors.length === 0) continue;

    const last = errors[errors.length - 1];
    observations.push({
      cronId: `system-log:${path.basename(logPath)}`,
      source: 'system-log',
      name: path.basename(logPath),
      status: 'log-error',
      consecutiveErrors: 0,
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: last ? last.line : '',
      errorCount: errors.length,
      badLines: errors.slice(0, 5).map(e => e.line),
      logSize: delta.size,
      scannedLines: delta.lines.length,
    });
  }
  return { observations, newOffsets };
}

// ───────────────────────────────────────────────────────────────────────────
// Coordinated entry point
// ───────────────────────────────────────────────────────────────────────────

/**
 * Run full detection. Returns { openclaw, system, systemOffsets }.
 *
 * @param {object} params
 * @param {string[]} [params.allowList] — cron IDs to watch (empty = all)
 * @param {string[]} [params.denyList]  — cron IDs to skip
 * @param {object}   [params.state]     — current watcher state (for offsets)
 */
function runDetection(params) {
  const allowList = params && params.allowList ? params.allowList : [];
  const denyList = params && params.denyList ? params.denyList : [];
  const state = params && params.state ? params.state : {};

  const openclawRes = detectOpenclawCrons();
  let openclawFailures = [];
  if (openclawRes.ok) {
    openclawFailures = collectOpenclawFailures(openclawRes.jobs, allowList, denyList);
  }

  const prevOffsets = (state && state.systemLogOffsets) || {};
  const sys = detectSystemCronFailures(prevOffsets);

  return {
    openclaw: {
      ok: openclawRes.ok,
      error: openclawRes.error || null,
      observations: openclawFailures,
    },
    system: {
      observations: sys.observations,
      offsets: sys.newOffsets,
    },
  };
}

module.exports = {
  runDetection,
  // exported for unit-style use
  detectOpenclawCrons,
  collectOpenclawFailures,
  readLogDelta,
  findErrorLines,
  detectSystemCronFailures,
  SYSTEM_LOG_FILES,
  ERROR_PATTERNS,
};

if (require.main === module) {
  // CLI mode for smoke-testing: prints detection summary as JSON.
  const result = runDetection({});
  console.log(JSON.stringify(result, null, 2));
}
