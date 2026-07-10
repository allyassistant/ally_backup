#!/usr/bin/env node
/**
 * hidden_drift_detector.js
 *
 * Heuristic-only hidden regression pattern detector for OpenClaw.
 *
 * Zero-LLM, zero-API, zero-exec — pure Node.js built-ins (fs, path).
 *
 * Replaces a "telescope cluster system" with simple per-detector heuristics.
 * Designed for OpenClaw's small daily event volume (30-100/day) where
 * embedding-based clustering would never converge.
 *
 * Five independent detectors:
 *   1. dedupSkipRepeater         — same skill name repeats in dedupSkippedNames
 *   2. shadowDriftProposalBacklog — repair_proposals backlog or stalled apply
 *   3. fixOutcomeGap             — gap between two cron log mtimes
 *   4. errorArchiveGap           — old resolved errors not yet archived
 *   5. emissionSaturation        — too many emission events being filtered out
 *
 * Each detector has its own try/catch so one failure cannot block the others.
 * All source files are read-only. Output (if any) goes to
 * `.state/drift_alerts.jsonl` with same-identity dedup against the last
 * `DEDUP_WINDOW_DAYS` of prior runs.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  CONSECUTIVE_DAYS: 3,
  MAX_UNSHIPPED_PROPOSALS: 50,
  SKIP_RATE_THRESHOLD: 0.70,
  STALE_PROPOSAL_DAYS: 7,
  ERROR_ARCHIVE_DAYS: 30,
  MAX_RESOLVED_BEFORE_ALERT: 100,
  GAP_MINUTES_THRESHOLD: 60,
  DEDUP_WINDOW_DAYS: 7,
  EMISSION_WINDOW: 20,
  ALERT_FILE: path.join(WORKSPACE_ROOT, '.state', 'drift_alerts.jsonl'),
  VERBOSE: false,
};

// ───────────────────────────────────────────────────────────────────────────
// Utility helpers
// ───────────────────────────────────────────────────────────────────────────

/** Parse a YYYY-MM-DD date string into a UTC ms timestamp. Returns NaN on bad input. */
function dateToMs(dateStr) {
  if (typeof dateStr !== 'string') return NaN;
  const ms = Date.parse(dateStr + 'T00:00:00Z');
  return Number.isFinite(ms) ? ms : NaN;
}

/** Floor a timestamp (ms) to UTC midnight ms. */
function startOfUtcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Compute day-difference between two YYYY-MM-DD strings (b - a). */
function dayDiff(a, b) {
  const msA = startOfUtcDay(dateToMs(a));
  const msB = startOfUtcDay(dateToMs(b));
  return Math.round((msB - msA) / 86400000);
}

/** Severity from a number (3+ → low, 5+ → medium, 7+ → high). */
function severityFromCount(count, low = 3, high = 7) {
  if (count >= high) return 'high';
  if (count >= low) return 'medium';
  return 'low';
}

/** Parse a JSONL file → array of objects. Bad lines are silently skipped. */
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch (_e) {
      // skip bad line
    }
  }
  return out;
}

/** Logger — warnings always go to stderr, verbose to stdout. */
function warn(scope, msg) {
  console.warn(`[hidden-drift][${scope}] ${msg}`);
}
function info(scope, msg) {
  if (CONFIG.VERBOSE) console.log(`[hidden-drift][${scope}] ${msg}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Detector 1: dedupSkipRepeater
// Watches .skill_junk_rate.jsonl for the same name appearing in
// `dedupSkippedNames` for CONSECUTIVE_DAYS+ days in a row.
// ───────────────────────────────────────────────────────────────────────────

/**
 * @returns {Array<Object>} array of alert objects
 */
function detectDedupSkipRepeater() {
  const scope = 'dedupSkipRepeater';
  const filePath = path.join(WORKSPACE_ROOT, '.skill_junk_rate.jsonl');
  const alerts = [];

  if (!fs.existsSync(filePath)) {
    warn(scope, `${filePath} not found, skipping`);
    return alerts;
  }

  const entries = readJsonl(filePath);
  // name → sorted ascending array of YYYY-MM-DD dates
  const nameDates = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    // Date can live in either `date` or `ts` field; normalise to YYYY-MM-DD.
    let dateKey = null;
    if (typeof entry.date === 'string') dateKey = entry.date.slice(0, 10);
    else if (typeof entry.ts === 'string') dateKey = entry.ts.slice(0, 10);
    if (!dateKey || !Array.isArray(entry.dedupSkippedNames)) continue;

    for (const rawName of entry.dedupSkippedNames) {
      if (typeof rawName !== 'string') continue;
      const name = rawName;
      if (!nameDates.has(name)) nameDates.set(name, []);
      const arr = nameDates.get(name);
      if (arr[arr.length - 1] !== dateKey) arr.push(dateKey);
    }
  }

  for (const [name, datesRaw] of nameDates) {
    const dates = datesRaw.slice().sort();
    if (dates.length < CONFIG.CONSECUTIVE_DAYS) continue;

    // Find longest run of consecutive days (each pair separated by exactly 1 day).
    let bestRun = 1;
    let bestRunDates = [dates[0]];
    let curRun = 1;
    let curRunDates = [dates[0]];

    for (let i = 1; i < dates.length; i++) {
      if (dayDiff(dates[i - 1], dates[i]) === 1) {
        curRun++;
        curRunDates.push(dates[i]);
      } else {
        if (curRun > bestRun) {
          bestRun = curRun;
          bestRunDates = curRunDates.slice();
        }
        curRun = 1;
        curRunDates = [dates[i]];
      }
    }
    if (curRun > bestRun) {
      bestRun = curRun;
      bestRunDates = curRunDates.slice();
    }

    if (bestRun >= CONFIG.CONSECUTIVE_DAYS) {
      alerts.push({
        detector: scope,
        severity: severityFromCount(bestRun, CONFIG.CONSECUTIVE_DAYS + 2, CONFIG.CONSECUTIVE_DAYS + 4),
        summary: `${name} appeared in dedupSkippedNames for ${bestRun} consecutive days`,
        details: {
          name,
          consecutiveDays: bestRun,
          lastSeen: bestRunDates[bestRunDates.length - 1],
          entries: bestRunDates,
        },
        suggestedAction: `Investigate dedup hash for ${name}; this skill keeps failing the same fingerprint check`,
        _dedupKey: `${scope}:${name}`,
      });
    }
  }

  info(scope, `${alerts.length} alert(s) across ${nameDates.size} unique names`);
  return alerts;
}

// ───────────────────────────────────────────────────────────────────────────
// Detector 2: shadowDriftProposalBacklog
// Watches .state/repair_proposals.json for either too many unapplied proposals,
// or no apply activity in STALE_PROPOSAL_DAYS+ days.
// ───────────────────────────────────────────────────────────────────────────

/**
 * @returns {Array<Object>}
 */
function detectShadowDriftProposalBacklog() {
  const scope = 'shadowDriftProposalBacklog';
  const filePath = path.join(WORKSPACE_ROOT, '.state', 'repair_proposals.json');
  const alerts = [];

  if (!fs.existsSync(filePath)) {
    warn(scope, `${filePath} not found, skipping`);
    return alerts;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    warn(scope, `JSON parse error: ${e.message}`);
    return alerts;
  }

  const proposals = Array.isArray(data)
    ? data
    : Array.isArray(data && data.proposals)
      ? data.proposals
      : [];

  if (proposals.length === 0) {
    info(scope, 'no proposals in file');
    return alerts;
  }

  const unshipped = proposals.filter((p) => !p || !p.appliedAt);
  const applied = proposals.filter((p) => p && p.appliedAt);

  // Signal A: too many unshipped proposals.
  if (unshipped.length > CONFIG.MAX_UNSHIPPED_PROPOSALS) {
    const overshoot = unshipped.length / CONFIG.MAX_UNSHIPPED_PROPOSALS;
    alerts.push({
      detector: scope,
      severity: overshoot > 2 ? 'high' : overshoot > 1.25 ? 'medium' : 'low',
      summary: `${unshipped.length} unshipped repair proposals (threshold ${CONFIG.MAX_UNSHIPPED_PROPOSALS})`,
      details: {
        unshippedCount: unshipped.length,
        total: proposals.length,
        appliedCount: applied.length,
      },
      suggestedAction: 'Run batch review; audit_workflow or audit_repair_proposer may be stalled',
      _dedupKey: `${scope}:count`,
    });
  }

  // Signal B: nothing applied in STALE_PROPOSAL_DAYS+ days.
  const now = Date.now();
  const staleCutoffMs = now - CONFIG.STALE_PROPOSAL_DAYS * 86400000;
  let stalled = false;
  let mostRecentAppliedAt = null;

  if (applied.length > 0) {
    const appliedTimes = applied
      .map((p) => Date.parse(p.appliedAt))
      .filter((t) => Number.isFinite(t));
    if (appliedTimes.length > 0) {
      mostRecentAppliedAt = new Date(Math.max(...appliedTimes)).toISOString();
      // ≥ STALE_PROPOSAL_DAYS since last apply → stalled.
      stalled = Math.max(...appliedTimes) <= staleCutoffMs;
    } else {
      stalled = true;
    }
  } else {
    // No proposals ever applied but backlog exists → also stalled.
    stalled = unshipped.length > 0;
  }

  if (stalled) {
    const daysSince = mostRecentAppliedAt
      ? Math.round((now - Date.parse(mostRecentAppliedAt)) / 86400000)
      : null;
    alerts.push({
      detector: scope,
      severity: daysSince && daysSince > CONFIG.STALE_PROPOSAL_DAYS * 2 ? 'high' : 'medium',
      summary:
        daysSince !== null
          ? `No proposals applied for ${daysSince} days (threshold ${CONFIG.STALE_PROPOSAL_DAYS})`
          : 'No proposal ever applied (backlog exists)',
      details: {
        lastAppliedAt: mostRecentAppliedAt,
        daysSinceLastApplied: daysSince,
        unshippedCount: unshipped.length,
      },
      suggestedAction: 'Verify audit_repair_proposer cron is alive; pipeline may have stalled',
      _dedupKey: `${scope}:stale`,
    });
  }

  info(scope, `${unshipped.length}/${proposals.length} unshipped, stalled=${stalled}`);
  return alerts;
}

// ───────────────────────────────────────────────────────────────────────────
// Detector 3: fixOutcomeGap
// Compares mtime of two cron logs; if they drift apart by more than
// GAP_MINUTES_THRESHOLD, one may be dead while the other still runs.
// ───────────────────────────────────────────────────────────────────────────

/**
 * @returns {Array<Object>}
 */
function detectFixOutcomeGap() {
  const scope = 'fixOutcomeGap';
  const repairLog = path.join(WORKSPACE_ROOT, '.state', 'repair_proposer_cron.log');
  const notifierLog = path.join(WORKSPACE_ROOT, '.state', 'propose_fix_notifier_cron.log');
  const alerts = [];

  const repairExists = fs.existsSync(repairLog);
  const notifierExists = fs.existsSync(notifierLog);

  if (!repairExists && !notifierExists) {
    warn(scope, 'neither log file exists, skipping');
    return alerts;
  }

  // If only one exists, the gap is effectively infinite from its perspective.
  let gapMinutes = 0;
  let stalePath = null;
  let freshPath = null;

  if (repairExists && notifierExists) {
    const aMs = fs.statSync(repairLog).mtimeMs;
    const bMs = fs.statSync(notifierLog).mtimeMs;
    gapMinutes = Math.abs(aMs - bMs) / 60000;
    if (gapMinutes > CONFIG.GAP_MINUTES_THRESHOLD) {
      stalePath = aMs < bMs ? repairLog : notifierLog;
      freshPath = aMs < bMs ? notifierLog : repairLog;
    }
  } else {
    gapMinutes = Number.POSITIVE_INFINITY;
    stalePath = repairExists ? repairLog : notifierLog;
    freshPath = null;
  }

  if (gapMinutes > CONFIG.GAP_MINUTES_THRESHOLD && stalePath) {
    const overshoot = Number.isFinite(gapMinutes)
      ? gapMinutes / CONFIG.GAP_MINUTES_THRESHOLD
      : 99;
    alerts.push({
      detector: scope,
      severity: overshoot > 4 ? 'high' : overshoot > 2 ? 'medium' : 'low',
      summary: Number.isFinite(gapMinutes)
        ? `Cron log mtime gap is ${Math.round(gapMinutes)} min (threshold ${CONFIG.GAP_MINUTES_THRESHOLD})`
        : `Only one of the two cron logs exists`,
      details: {
        repairMtime: repairExists ? new Date(fs.statSync(repairLog).mtimeMs).toISOString() : null,
        notifierMtime: notifierExists ? new Date(fs.statSync(notifierLog).mtimeMs).toISOString() : null,
        staleLog: path.basename(stalePath),
        freshLog: freshPath ? path.basename(freshPath) : null,
      },
      suggestedAction: `Check ${path.basename(stalePath)} cron status — may be dead while the other still runs`,
      _dedupKey: `${scope}:${path.basename(stalePath)}`,
    });
  }

  info(scope, `gap=${Number.isFinite(gapMinutes) ? Math.round(gapMinutes) : 'inf'}min`);
  return alerts;
}

// ───────────────────────────────────────────────────────────────────────────
// Detector 4: errorArchiveGap
// Reads memory/errors.json. If the resolved-error count exceeds the threshold
// AND the oldest resolved entry is older than ERROR_ARCHIVE_DAYS days, the
// archive script is not running.
// ───────────────────────────────────────────────────────────────────────────

/**
 * @returns {Array<Object>}
 */
function detectErrorArchiveGap() {
  const scope = 'errorArchiveGap';
  const filePath = path.join(WORKSPACE_ROOT, 'memory', 'errors.json');
  const alerts = [];

  if (!fs.existsSync(filePath)) {
    warn(scope, `${filePath} not found, skipping`);
    return alerts;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    warn(scope, `JSON parse error: ${e.message}`);
    return alerts;
  }

  const errs = Array.isArray(data)
    ? data
    : Array.isArray(data && data.errors)
      ? data.errors
      : [];

  if (errs.length === 0) {
    info(scope, 'no errors in file');
    return alerts;
  }

  const resolved = errs.filter((e) => e && e.resolved === true);
  if (resolved.length === 0) return alerts;

  const now = Date.now();
  const dateFields = ['resolvedAt', 'updatedAt', 'timestamp', 'date', 'createdAt'];
  let oldestMs = Infinity;

  for (const e of resolved) {
    let candidate = NaN;
    for (const f of dateFields) {
      if (typeof e[f] === 'string') {
        // Accept either YYYY-MM-DD or full ISO timestamp.
        const v = e[f];
        const ms = v.length === 10 ? Date.parse(v + 'T00:00:00Z') : Date.parse(v);
        if (Number.isFinite(ms)) {
          candidate = ms;
          break;
        }
      }
    }
    if (Number.isFinite(candidate) && candidate < oldestMs) oldestMs = candidate;
  }

  if (!Number.isFinite(oldestMs)) {
    info(scope, `${resolved.length} resolved but no parseable dates`);
    return alerts;
  }

  const oldestAgeDays = Math.round((now - oldestMs) / 86400000);
  const overCount = resolved.length > CONFIG.MAX_RESOLVED_BEFORE_ALERT;
  const overAge = oldestAgeDays > CONFIG.ERROR_ARCHIVE_DAYS;

  if (overCount && overAge) {
    const ageOvershoot = oldestAgeDays / CONFIG.ERROR_ARCHIVE_DAYS;
    alerts.push({
      detector: scope,
      severity: ageOvershoot > 2 ? 'high' : ageOvershoot > 1.5 ? 'medium' : 'low',
      summary: `${resolved.length} resolved errors, oldest ${oldestAgeDays} days ago`,
      details: {
        resolvedCount: resolved.length,
        total: errs.length,
        oldestResolvedDate: new Date(oldestMs).toISOString().slice(0, 10),
        oldestResolvedAgeDays: oldestAgeDays,
      },
      suggestedAction:
        'Run memory_cleanup.js --archive (or equivalent) to flush resolved entries beyond the archive cutoff',
      _dedupKey: `${scope}:size-${Math.min(99, Math.floor(resolved.length / 50))}`,
    });
  }

  info(scope, `resolved=${resolved.length} oldestAgeDays=${oldestAgeDays}`);
  return alerts;
}

// ───────────────────────────────────────────────────────────────────────────
// Detector 5: emissionSaturation
// Reads last EMISSION_WINDOW entries of audit_to_skill_emissions.jsonl.
// Alerts when the share of `status === 'skipped_pre_emit'` exceeds the
// configured threshold — indicates the emission filter rejects most events.
// ───────────────────────────────────────────────────────────────────────────

/**
 * @returns {Array<Object>}
 */
function detectEmissionSaturation() {
  const scope = 'emissionSaturation';
  const filePath = path.join(WORKSPACE_ROOT, '.state', 'audit_to_skill_emissions.jsonl');
  const alerts = [];

  if (!fs.existsSync(filePath)) {
    warn(scope, `${filePath} not found, skipping`);
    return alerts;
  }

  let lines;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    lines = text.split('\n').filter((l) => l.trim());
  } catch (e) {
    warn(scope, `read error: ${e.message}`);
    return alerts;
  }

  if (lines.length === 0) return alerts;

  const recent = lines.slice(-CONFIG.EMISSION_WINDOW);
  let parsed = 0;
  let skipped = 0;

  for (const line of recent) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_e) {
      continue;
    }
    parsed++;
    if (entry && entry.status === 'skipped_pre_emit') skipped++;
  }

  if (parsed === 0) return alerts;

  const skipRate = skipped / parsed;
  if (skipRate > CONFIG.SKIP_RATE_THRESHOLD) {
    const overshoot = skipRate / CONFIG.SKIP_RATE_THRESHOLD;
    alerts.push({
      detector: scope,
      severity: overshoot > 1.2 ? 'high' : overshoot > 1.05 ? 'medium' : 'low',
      summary: `${Math.round(skipRate * 100)}% skip rate in last ${parsed} emissions (${skipped} skipped)`,
      details: {
        recentCount: parsed,
        skippedCount: skipped,
        skipRate: Math.round(skipRate * 1000) / 1000,
        threshold: CONFIG.SKIP_RATE_THRESHOLD,
      },
      suggestedAction:
        'Inspect audit_to_skill_emitter filter — most events are being dropped before emission',
      _dedupKey: `${scope}:rate`,
    });
  }

  info(scope, `parsed=${parsed} skipped=${skipped} rate=${skipRate.toFixed(2)}`);
  return alerts;
}

// ───────────────────────────────────────────────────────────────────────────
// Aggregation: dedup + output handling
// ───────────────────────────────────────────────────────────────────────────

const DETECTORS = {
  dedupSkipRepeater: detectDedupSkipRepeater,
  shadowDriftProposalBacklog: detectShadowDriftProposalBacklog,
  fixOutcomeGap: detectFixOutcomeGap,
  errorArchiveGap: detectErrorArchiveGap,
  emissionSaturation: detectEmissionSaturation,
};

/**
 * Re-derive the dedup key for an alert, regardless of whether the alert came
 * from a fresh detector run (carrying `_dedupKey`) or from a previously
 * stored JSONL line (no `_dedupKey` because the field is internal-only).
 *
 * Centralising the rule here keeps detector functions short and ensures
 * persisted alerts can be re-keyed on the next run.
 */
function deriveDedupKey(alert) {
  if (!alert || typeof alert !== 'object' || !alert.detector) return null;
  const d = alert.details || {};
  switch (alert.detector) {
    case 'dedupSkipRepeater':
      return d.name ? `${alert.detector}:${d.name}` : null;
    case 'shadowDriftProposalBacklog':
      // Two distinct identities: backlog-size count vs stalled (no apply).
      if (typeof d.unshippedCount === 'number') return `${alert.detector}:count`;
      return `${alert.detector}:stale`;
    case 'fixOutcomeGap':
      return d.staleLog ? `${alert.detector}:${d.staleLog}` : alert.detector;
    case 'errorArchiveGap': {
      // Bucket by resolved-count quanta so small drift doesn't bounce alerts.
      if (typeof d.resolvedCount === 'number') {
        return `${alert.detector}:size-${Math.min(99, Math.floor(d.resolvedCount / 50))}`;
      }
      return alert.detector;
    }
    case 'emissionSaturation':
      return `${alert.detector}:rate`;
    default:
      return alert.detector;
  }
}

/**
 * Read the recent (DEDUP_WINDOW_DAYS) window of the alert file and collect
 * every dedup key we've already emitted.
 */
function getRecentDedupKeys() {
  const keys = new Set();
  if (!fs.existsSync(CONFIG.ALERT_FILE)) return keys;

  const cutoffMs = Date.now() - CONFIG.DEDUP_WINDOW_DAYS * 86400000;
  let text;
  try {
    text = fs.readFileSync(CONFIG.ALERT_FILE, 'utf8');
  } catch (_e) {
    return keys;
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (_e) {
      continue;
    }
    const t = Date.parse(entry && entry.ts);
    if (!Number.isFinite(t) || t < cutoffMs) continue;
    for (const alert of entry.alerts || []) {
      const k = deriveDedupKey(alert);
      if (k) keys.add(k);
    }
  }
  return keys;
}

function listFilesChecked() {
  return [
    '.skill_junk_rate.jsonl',
    '.state/repair_proposals.json',
    '.state/repair_proposer_cron.log',
    '.state/propose_fix_notifier_cron.log',
    '.state/audit_to_skill_emissions.jsonl',
    'memory/errors.json',
    '.state/drift_alerts.jsonl',
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    verbose: false,
    dryRun: false,
    detector: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--detector') {
      const v = argv[++i];
      if (!v) {
        console.error('--detector requires a value');
        process.exit(1);
      }
      opts.detector = v;
    } else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--list') {
      console.log(Object.keys(DETECTORS).join('\n'));
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/hidden_drift_detector.js [options]

Lightweight heuristic drift detector for OpenClaw.

Options:
  --verbose              Log per-detector details to stdout
  --dry-run              Do not write to .state/drift_alerts.jsonl
  --detector <name>      Run only the named detector
  --list                 List available detector names and exit
  -h, --help             Show this help

Available detectors:
${Object.keys(DETECTORS).map((k) => '  - ' + k).join('\n')}

Exit codes:
  0  Normal completion (alerts or clean)
  1  Catastrophic failure (e.g. cannot write output file)

Source files are READ-ONLY. Output, if any, goes to:
  ${CONFIG.ALERT_FILE}
`);
}

function buildRunId() {
  // hdd-YYYY-MM-DD-HHMM format → unique per minute within a day, sorts
  // chronologically. Run-uniqueness within the same minute is not needed
  // because output is deduped by alert identity.
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    'hdd-' +
    d.getUTCFullYear() +
    '-' +
    pad(d.getUTCMonth() + 1) +
    '-' +
    pad(d.getUTCDate()) +
    '-' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  CONFIG.VERBOSE = opts.verbose;

  if (opts.detector && !DETECTORS[opts.detector]) {
    console.error(`Unknown detector: ${opts.detector}`);
    console.error(`Available: ${Object.keys(DETECTORS).join(', ')}`);
    process.exit(1);
  }

  const startMs = Date.now();
  const runId = buildRunId();
  const scope = opts.detector ? { [opts.detector]: DETECTORS[opts.detector] } : DETECTORS;

  const rawAlerts = [];
  for (const [name, fn] of Object.entries(scope)) {
    if (typeof fn !== 'function') continue;
    try {
      const result = fn() || [];
      if (CONFIG.VERBOSE) console.log(`[${name}] produced ${result.length} alert(s)`);
      for (const a of result) rawAlerts.push(a);
    } catch (e) {
      warn(name, `detector crashed: ${e && e.message}`);
      if (CONFIG.VERBOSE && e && e.stack) console.error(e.stack);
    }
  }

  const existingKeys = getRecentDedupKeys();
  const freshAlerts = rawAlerts.filter((a) => {
    if (!a) return false;
    const k = deriveDedupKey(a) || a._dedupKey;
    return !(k && existingKeys.has(k));
  });
  const suppressedDuplicates = rawAlerts.length - freshAlerts.length;

  const duration = Date.now() - startMs;
  const ts = new Date().toISOString();

  // Drop the internal `_dedupKey` before persistence so the JSONL stays
  // clean per the documented output schema.
  const cleanAlerts = freshAlerts.map(({ _dedupKey, ...rest }) => {
    void _dedupKey;
    return rest;
  });

  const record = {
    ts,
    runId,
    alerts: cleanAlerts,
    runDurationMs: duration,
    filesChecked: listFilesChecked(),
  };

  if (opts.detector) record.detectorRun = opts.detector;
  if (suppressedDuplicates > 0) {
    record.suppressedDuplicateCount = suppressedDuplicates;
  }
  if (freshAlerts.length === 0) {
    record.status = 'clean';
  }

  const outputJson = JSON.stringify(record, null, 2);

  if (opts.dryRun) {
    console.log(outputJson);
    return 0;
  }

  // Ensure .state exists.
  try {
    fs.mkdirSync(path.dirname(CONFIG.ALERT_FILE), { recursive: true });
  } catch (_e) {
    /* already exists */
  }

  try {
    fs.appendFileSync(CONFIG.ALERT_FILE, JSON.stringify(record) + '\n');
  } catch (e) {
    console.error(`[hidden-drift] cannot write to ${CONFIG.ALERT_FILE}: ${e.message}`);
    process.exit(1);
  }

  if (CONFIG.VERBOSE || opts.dryRun) console.log(outputJson);
  else console.log(JSON.stringify(record));
  return 0;
}

if (require.main === module) {
  const code = main();
  if (typeof code === 'number') process.exit(code);
}

module.exports = {
  CONFIG,
  DETECTORS,
  detectDedupSkipRepeater,
  detectShadowDriftProposalBacklog,
  detectFixOutcomeGap,
  detectErrorArchiveGap,
  detectEmissionSaturation,
  main,
  parseArgs,
};
