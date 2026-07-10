#!/usr/bin/env node
/**
 * audit_daily_cron.js — Cron-driven runner for auditOrchestrator
 *
 * Phase 2d: Wire auditOrchestrator into the 04:30 daily cron window.
 *
 * Behaviour:
 *  - Acquires .state/audit_cron.lock (PID + mtime). Stale lock (>60 min) is auto-removed.
 *  - Invokes AuditOrchestrator end-to-end on scripts/ dir.
 *  - Writes date-stamped snapshot .state/audit_results_YYYY-MM-DD.json
 *  - Refreshes canonical .state/audit_orchestrator_results.json (the file auditOrchestrator writes)
 *  - On success: silent (exit 0).
 *  - On failure: logs to stderr, pushes Discord digest, exit 1.
 *  - 30-minute wall-clock timeout (kills child if exceeded).
 *  - Always releases lock in finally.
 *
 * Usage:
 *   node scripts/audit_daily_cron.js                # normal cron run
 *   node scripts/audit_daily_cron.js --dry-run      # skip Discord, skip lock
 *   node scripts/audit_daily_cron.js --json         # also print machine-readable summary
 *   node scripts/audit_daily_cron.js --no-discord   # skip Discord even on success
 *   node scripts/audit_daily_cron.js --help
 *
 * Exit codes:
 *   0 = success
 *   1 = failure (logged + Discord pushed unless --no-discord)
 *   2 = lock held by another live run
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const discord = require('./lib/discord_push');

const { STATE_DIR, SCRIPTS_DIR, atomicWriteSync } = require('./lib/config');
const { AuditOrchestrator } = require('./lib/auditOrchestrator');
const trend = require('./lib/audit_history');
const scriptRegistry = require('./lib/script_registry');
const realtimeDedup = require('./lib/audit_realtime_dedup');

const LOCK_FILE = path.join(STATE_DIR, 'audit_cron.lock');
const CANONICAL_OUTPUT = path.join(STATE_DIR, 'audit_orchestrator_results.json');
const SYSTEM_CHANNEL = process.env.AUDIT_CRON_CHANNEL || '1473376125584670872';

const STALE_LOCK_MINUTES = 60;
const RUN_TIMEOUT_MS = 30 * 60 * 1000;   // 30 min

const args = new Set(process.argv.slice(2));
const HELP = args.has('--help') || args.has('-h');
const DRY_RUN = args.has('--dry-run');
const JSON_OUT = args.has('--json');
const NO_DISCORD = args.has('--no-discord');
const NO_DEDUP = args.has('--no-dedup');     // Phase A+ (2026-06-20): bypass smart dedup
const DEDUP_STATS_ONLY = args.has('--dedup-stats'); // show what would skip, then audit all
const QUIET = true; // cron scripts are always quiet on success

function log(...a) { if (!QUIET) console.log(...a); }
function err(...a) { console.error(...a); }

if (HELP) {
  console.log(`audit_daily_cron.js — Cron runner for auditOrchestrator (Phase 2d)

Usage:
  node scripts/audit_daily_cron.js              # normal cron run (uses smart dedup)
  node scripts/audit_daily_cron.js --dry-run    # preview only (no Discord, no lock)
  node scripts/audit_daily_cron.js --json       # also print machine-readable summary
  node scripts/audit_daily_cron.js --no-discord # skip Discord push
  node scripts/audit_daily_cron.js --no-dedup   # force re-audit all files (bypass smart dedup)
  node scripts/audit_daily_cron.js --dedup-stats  # show dedup stats then audit all
  node scripts/audit_daily_cron.js --help

Smart Dedup (Phase A+, 2026-06-20):
  When LLM writes a file, scripts/audit_just_written.js records an override
  entry in .state/audit_realtime_overrides.jsonl. This cron uses those
  overrides to skip files that:
    1. Have been audited by real-time (override entry exists)
    2. Have NOT been modified since the override
    3. Override severity is benign (none / low)
  Files with medium/high/critical overrides are NEVER skipped — they need
  the full audit rules to feed the repair pipeline.

Exit codes:
  0 = success
  1 = failure (logged + Discord push attempted)
  2 = lock held by another live run
`);
  process.exit(0);
}

// ----------------- Lock -----------------
function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function acquireLock() {
  // Check for existing lock
  if (fs.existsSync(LOCK_FILE)) {
    let info = null;
    try { info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch (_) {}
    const ageMs = info?.acquiredAt ? Date.now() - Date.parse(info.acquiredAt) : Infinity;
    const stale = ageMs > STALE_LOCK_MINUTES * 60 * 1000;
    const live = info?.pid && isPidAlive(info.pid);

    if (live && !stale) {
      err(`❌ Lock held by live PID ${info.pid} (acquired ${info.acquiredAt})`);
      return false;
    }
    if (stale) {
      err(`⚠️  Removing stale lock (age ${(ageMs / 60000).toFixed(0)}m, pid ${info?.pid || '?'} ${live ? 'live' : 'dead'})`);
    } else {
      err(`⚠️  Removing dead-pid lock (pid ${info?.pid})`);
    }
    try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  }

  const lockData = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    script: 'audit_daily_cron.js',
  };
  try {
    atomicWriteSync(LOCK_FILE, lockData);
    return true;
  } catch (e) {
    err(`❌ Failed to write lock: ${e.message}`);
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (info.pid === process.pid) fs.unlinkSync(LOCK_FILE);
    }
  } catch (_) { /* best effort */ }
}

// ----------------- Date helpers -----------------
function dateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nowHktString() {
  const d = new Date();
  const hkt = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = hkt.getUTCFullYear();
  const mo = String(hkt.getUTCMonth() + 1).padStart(2, '0');
  const da = String(hkt.getUTCDate()).padStart(2, '0');
  const h = String(hkt.getUTCHours()).padStart(2, '0');
  const mi = String(hkt.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi} HKT`;
}

// ----------------- File discovery (lightweight) -----------------
function discoverJsFiles(rootDir) {
  const results = [];
  const exclude = new Set(['node_modules', '.git', '__pycache__', '.venv', '.cache', 'dist', '_legacy']);
  const maxDepth = 10;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      if (e?.name?.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!exclude.has(e.name)) walk(full, depth + 1);
      } else if (e.isFile() && e?.name?.endsWith('.js')) {
        results.push(full);
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

// ----------------- Audit runner with timeout -----------------
function runAuditWithTimeout(files) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Audit timed out after ${RUN_TIMEOUT_MS / 60000} minutes`));
    }, RUN_TIMEOUT_MS);

    (async () => {
      try {
        const orch = new AuditOrchestrator({ _quiet: true });
        const results = await orch.run(files, { _quiet: true });
        // saveResults writes to canonical path; pass null to use default
        orch.saveResults();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ results, canonicalPath: CANONICAL_OUTPUT });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    })();
  });
}

// ----------------- Date-stamped snapshot -----------------
function writeDatedSnapshot(canonicalPath) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read canonical audit output ${canonicalPath}: ${e.message}`);
  }

  // Rotate: keep last 30 days of dated snapshots
  const datedPath = path.join(STATE_DIR, `audit_results_${dateStamp()}.json`);
  try {
    atomicWriteSync(datedPath, payload);
  } catch (e) {
    throw new Error(`Failed to write dated snapshot: ${e.message}`);
  }

  // Retention: delete snapshots older than 30 days
  try {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const files = fs.readdirSync(STATE_DIR).filter(f => /^audit_results_\d{4}-\d{2}-\d{2}\.json$/.test(f));
    for (const f of files) {
      const m = f.match(/^audit_results_(\d{4}-\d{2}-\d{2})\.json$/);
      if (!m) continue;
      const t = Date.parse(m[1] + 'T00:00:00Z');
      if (!isNaN(t) && t < cutoff) {
        try { fs.unlinkSync(path.join(STATE_DIR, f)); } catch (_) {}
      }
    }
  } catch (_) { /* retention is best-effort */ }

  return datedPath;
}

// ----------------- Discord digest -----------------
/**
 * Build a Layer 3 trend-aware digest. Falls back to single-line digest when
 * history is unavailable.
 */
function formatDigest(summary, fileCount, trendContext = null) {
  const s = summary || {};
  const sev = s.severityCounts || { critical: 0, high: 0, medium: 0, low: 0 };
  const total = s.totalIssues || 0;

  // If we have trend context, render the multi-line trend digest
  if (trendContext && trendContext.history && trendContext?.history?.length >= 1) {
    const currentSummary = {
      totalIssues: total,
      scriptCount: fileCount,
      bySeverity: {
        critical: sev.critical || 0,
        high: sev.high || 0,
        medium: sev.medium || 0,
        low: sev.low || 0,
      },
    };
    // The trend.formatDigest() now includes the header + timestamp + script count.
    return trend.formatDigest(
      trendContext.history,
      trendContext.comparison,
      currentSummary
    );
  }

  // Fallback: single-line digest (no history yet)
  return `🛠️ 每日 audit 完成\n⏰ ${nowHktString()} · ${fileCount} scripts 掃描\n📊 **Issues: ${total} 個** (Critical: ${sev.critical} · High: ${sev.high} · Medium: ${sev.medium} · Low: ${sev.low})`;
}

/**
 * Load trend context for the digest. Best-effort: never throws, returns null
 * on any failure so the digest falls back to the simple format.
 */
function loadTrendContext() {
  try {
    const history = trend.loadAuditHistory(STATE_DIR, 7);
    if (history.length === 0) return null;

    const lastRec = history[history.length - 1];
    const lastSummary = trend.summarizeAuditPayload({
      results: { merged: reconstructMergedFromHistory(lastRec) },
    });

    const prevRec = history.length >= 2 ? history[history.length - 2] : null;
    const prevSummary = prevRec
      ? trend.summarizeAuditPayload({
          results: { merged: reconstructMergedFromHistory(prevRec) },
        })
      : null;

    const comparison = trend.compareWithPrevious(lastSummary, prevSummary);
    return { history, comparison };
  } catch (e) {
    if (!QUIET) err(`⚠️ trend context failed: ${e.message}`);
    return null;
  }
}

/**
 * Reconstruct a minimal merged[] from a history record (best-effort).
 * History records only store counts, not full issues, so we use a stub.
 * This is enough for compareWithPrevious when previous and current records
 * are both stub-reconstructed with matching severity per file.
 */
function reconstructMergedFromHistory(rec) {
  if (!rec) return [];
  // If the record already has fileSeverity, use it directly
  if (rec.fileSeverity) {
    return Object.entries(rec.fileSeverity).map(([f, sev]) => ({
      file: f,
      severity: sev,
      rule: 'stub',
      message: 'reconstructed from history',
    }));
  }
  // Fallback: synthesize from topFiles (severity may be 'low' default)
  return (rec.topFiles || []).map(tf => ({
    file: tf.file,
    severity: tf.severity || 'low',
    rule: 'stub',
    message: 'reconstructed from history',
  }));
}

function sendDiscord(text) {
  // Fire-and-forget via Discord push lib
  const result = discord.push({ message: text, target: `channel:${SYSTEM_CHANNEL}` });
  return result.ok;
}

// ----------------- Main -----------------
async function main() {
  const startedAt = Date.now();

  // Syntax preflight — catch file corruption early (incident 2026-07-09).
  // If any script/*.js has broken syntax, abort the audit BEFORE we touch
  // anything else — audit logic may depend on parsing those files.
  if (!DRY_RUN) {
    try {
      require('child_process').execFileSync(
        'node',
        ['scripts/syntax_preflight.js'],
        {
          stdio: 'inherit',
          cwd: '/Users/ally/.openclaw/workspace',
        }
      );
    } catch (e) {
      console.error('❌ Syntax preflight FAILED — aborting audit. Run: node scripts/syntax_preflight.js');
      process.exit(1);
    }
  }

  const lockAcquired = DRY_RUN ? true : acquireLock();
  if (!lockAcquired) {
    process.exit(2);
  }

  let exitCode = 0;
  let summary = null;
  let fileCount = 0;
  let datedPath = null;
  let errorMsg = null;

  try {
    // 1. Discover files
    let files = discoverJsFiles(SCRIPTS_DIR);
    fileCount = files.length;
    if (!QUIET) log(`🔍 Discovered ${fileCount} .js files under ${SCRIPTS_DIR}`);

    // 1b. Smart dedup (Phase A+, 2026-06-20) — skip files already audited
    //     by real-time audit (LLM tool calls). See --help for criteria.
    let dedupStats = null;
    let dedupSkippedFiles = [];
    const totalDiscovered = fileCount;
    if (!NO_DEDUP) {
      const dedupResult = realtimeDedup.filterFiles(files);
      if (DEDUP_STATS_ONLY) {
        // Just show what would be skipped, then audit all anyway.
        console.log(`[dedup] would skip ${dedupResult?.skipped?.length}/${files.length} files (use --no-dedup to bypass)`);
        console.log(`[dedup] stats: ${JSON.stringify(dedupResult.stats)}`);
      } else {
        files = dedupResult.kept;
        dedupStats = dedupResult.stats;
        dedupSkippedFiles = dedupResult.skipped;
        fileCount = files.length; // CRITICAL: update fileCount to reflect dedup'd list
        if (!QUIET && dedupResult?.skipped?.length > 0) {
          log(`⏭️  Smart dedup: skipped ${dedupResult?.skipped?.length}/${totalDiscovered} files (real-time audited, no changes)`);
        }
      }
    } else if (!QUIET) {
      log(`⚠️  --no-dedup: forcing re-audit of all ${fileCount} files`);
    }

    // 2. Run orchestrator (with 30-min timeout)
    const { results, canonicalPath } = await runAuditWithTimeout(files);
    summary = results.summary;

    // 3. Write date-stamped snapshot
    datedPath = writeDatedSnapshot(canonicalPath);

    // 3b. Layer 3: Persist history snapshot (after canonical write so we read the
    //     exact payload that auditOrchestrator.saveResults() wrote).
    let historySnapshotPath = null;
    try {
      const canonicalPayload = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
      historySnapshotPath = trend.persistHistorySnapshot(STATE_DIR, canonicalPayload);
      if (!QUIET) log(`📚 History snapshot: ${historySnapshotPath}`);
    } catch (e) {
      if (!QUIET) err(`⚠️ failed to persist history snapshot: ${e.message}`);
    }

    // 4. JSON output (optional, for cron monitoring/debug)
    if (JSON_OUT) {
      const out = {
        timestamp: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        filesDiscovered: totalDiscovered,        // raw count before dedup
        filesScanned: fileCount,                  // count actually audited (post-dedup)
        dedupApplied: dedupStats !== null,        // was dedup used?
        dedupStats,                              // { total, freshOverride, fileChanged, ... }
        dedupSkippedFiles: dedupSkippedFiles.map(s => ({ file: s.file, reason: s.reason, severity: s.severity })),
        summary,
        canonicalPath,
        datedPath,
        historySnapshotPath,
        dryRun: DRY_RUN,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    }

    // 5. Optional success digest (Layer 3: trend-aware)
    if (!DRY_RUN && !NO_DISCORD) {
      const trendContext = loadTrendContext();
      const text = formatDigest(summary, fileCount, trendContext);
      sendDiscord(text);
    }

    if (!QUIET) log(`✅ Audit complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${summary.totalIssues} issues`);
  } catch (e) {
    exitCode = 1;
    errorMsg = e.message;
    err(`❌ audit_daily_cron failed: ${e.message}`);
    if (e.stack) err(e.stack);

    // Failure digest
    if (!DRY_RUN && !NO_DISCORD) {
      const text = `❌ 每日 audit 失敗: ${e?.message?.slice(0, 200)} — ${nowHktString()}`;
      sendDiscord(text);
    }
  } finally {
    if (!DRY_RUN) releaseLock();
  }

  process.exit(exitCode);
}

main().catch(e => {
  err(`❌ Fatal: ${e.message}`);
  if (e.stack) err(e.stack);
  process.exit(1);
});
