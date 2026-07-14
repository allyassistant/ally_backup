#!/usr/bin/env node
/**
 * skill_junk_pause.js — Thin executor (no LLM)
 *
 * Week 1 Safety Net (Issue #154): auto-pause skill_reviewer_bot.js's
 * auto-symlink when 24h validator catch rate drops below target.
 *
 * Reads `.skill_junk_rate.jsonl` last 24h entries → averages both
 * `validatorCatchRate` (primary) and `junkInProductionRate` (secondary/backup)
 * → writes/clears `.skill_reviewer_pause.json` accordingly.
 *
 * Why validatorCatchRate is primary:
 *   - junkInProductionRate is too noisy when internal automation skills
 *     are excluded from the denominator (a single failure among a small
 *     sample pushes the rate above the 30% threshold).
 *   - validatorCatchRate reflects "is the validation pipeline actually
 *     catching junk?" — a healthier top-of-funnel signal.
 *
 * Behaviour (primary: validatorCatchRate):
 *   validatorCatchRate < threshold AND no active pause → PAUSE
 *   validatorCatchRate ≥ threshold AND pause expired   → RESUME
 *   pause active and not expired                       → keep-paused
 *
 * Backup signal (junkInProductionRate):
 *   Only consulted when validatorCatchRate data is entirely missing
 *   from the window (e.g., tracker pre-v2 rows). With v2 data present,
 *   junkInProductionRate is purely informational — reported alongside
 *   validatorCatchRate for observability.
 *
 * Usage:
 *   node scripts/skill_junk_pause.js [--quiet] [--dry-run] [--threshold 0.25] [--hours 24]
 *
 * Flags:
 *   --quiet                Suppress non-essential log output
 *   --dry-run              Print what would happen, do not write pause file
 *   --threshold <float>    Override validatorCatchRate threshold (default 0.25 = VALIDATOR_CATCH_TARGET)
 *   --hours <int>          Window in hours (default 24)
 *
 * Exit codes:
 *   0  always (this is a thin executor — failures inside do not block cron)
 *
 * Why thin executor:
 *   - No LLM call. Pure file IO + arithmetic.
 *   - Output is JSON to stdout for cron to consume (or `--quiet` to suppress).
 *   - Does NOT push to Discord directly — the daily report cron handles
 *     user-facing notifications.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { WS } = require('./lib/config');

const JUNK_RATE_FILE = path.join(WS, '.skill_junk_rate.jsonl');
const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');
// Primary pause trigger: validator catch rate target. Mirrors
// VALIDATOR_CATCH_TARGET in daily_report.js / skill_reviewer_daily_report.js.
const DEFAULT_THRESHOLD = 0.25;
// Backup signal only: consulted when validatorCatchRate data is missing.
const DEFAULT_JUNK_THRESHOLD = 0.30;
const DEFAULT_HOURS = 24;
const PAUSE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

// ── Helpers ──

function log() {
  if (!process.argv.includes('--quiet')) console.log.apply(console, arguments);
}

function err() {
  console.error.apply(console, arguments);
}

function readJunkRateEntries(windowMs) {
  if (!fs.existsSync(JUNK_RATE_FILE)) return [];
  const cutoff = Date.now() - windowMs;
  const out = [];
  let raw;
  try {
    raw = fs.readFileSync(JUNK_RATE_FILE, 'utf8');
  } catch (e) {
    err('Failed to read ' + JUNK_RATE_FILE + ': ' + e.message);
    return [];
  }
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      continue; // skip malformed
    }
    // Skip if timestamp is outside the window
    if (entry.ts) {
      const t = Date.parse(entry.ts);
      if (!isNaN(t) && t < cutoff) continue;
    }
    out.push(entry);
  }
  return out;
}

// Returns { validatorCatchRate, junkInProductionRate } as fractions (0-1),
// or null for each if no usable data in the window. Both v2 fields
// (`validatorCatchRate`, `junkInProductionRate`) and the v1 legacy
// `junkRatePercent` are stored as PERCENT values (0-100) in the jsonl,
// so we divide by 100 here to get a fraction comparable to thresholds.
function computeMetrics(entries) {
  const validatorRates = [];
  const junkRates = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e.validatorCatchRate === 'number') {
      validatorRates.push(e.validatorCatchRate / 100);
    }
    if (typeof e.junkInProductionRate === 'number') {
      junkRates.push(e.junkInProductionRate / 100);
    } else if (typeof e.junkRatePercent === 'number' && typeof e.validatorCatchRate !== 'number') {
      // v1 fallback: junkRatePercent is the only metric we have, surface it
      // under junkInProductionRate slot so the backup branch still works.
      junkRates.push(e.junkRatePercent / 100);
    }
  }
  return {
    validatorCatchRate: validatorRates.length
      ? validatorRates.reduce((a, b) => a + b, 0) / validatorRates.length
      : null,
    junkInProductionRate: junkRates.length
      ? junkRates.reduce((a, b) => a + b, 0) / junkRates.length
      : null,
  };
}

function readPauseState() {
  if (!fs.existsSync(PAUSE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
  } catch (e) {
    err('Pause file exists but failed to parse: ' + e.message);
    return null;
  }
}

function parseArgs() {
  const opts = {
    quiet: false,
    dryRun: false,
    threshold: DEFAULT_THRESHOLD,
    hours: DEFAULT_HOURS,
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--quiet') opts.quiet = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--threshold') {
      const v = parseFloat(args[++i]);
      if (isNaN(v)) { err('--threshold requires a number'); process.exit(0); }
      opts.threshold = v;
    }
    else if (a === '--hours') {
      const v = parseInt(args[++i], 10);
      if (isNaN(v)) { err('--hours requires an integer'); process.exit(0); }
      opts.hours = v;
    }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node skill_junk_pause.js [--quiet] [--dry-run] [--threshold 0.25] [--hours 24]');
      process.exit(0);
    }
    else {
      err('Unknown flag: ' + a);
      process.exit(0);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const windowMs = opts.hours * 60 * 60 * 1000;
  const entries = readJunkRateEntries(windowMs);
  const { validatorCatchRate, junkInProductionRate } = computeMetrics(entries);
  const pauseState = readPauseState();
  const now = Date.now();
  const pauseActive = pauseState && now < pauseState.until;

  log('Read ' + entries.length + ' junk-rate entries (last ' + opts.hours + 'h)');
  if (validatorCatchRate !== null) {
    log('Avg validator catch rate: ' + (validatorCatchRate * 100).toFixed(2) + '% (threshold ' + (opts.threshold * 100).toFixed(2) + '%)');
  } else {
    log('No validatorCatchRate data in window');
  }
  if (junkInProductionRate !== null) {
    log('Avg junk-in-production rate: ' + (junkInProductionRate * 100).toFixed(2) + '% (backup threshold ' + (DEFAULT_JUNK_THRESHOLD * 100).toFixed(2) + '%)');
  } else {
    log('No junkInProductionRate data in window');
  }

  // Decide whether to pause. Primary trigger: validatorCatchRate below
  // threshold. Backup trigger: if validatorCatchRate data is missing
  // AND junkInProductionRate exceeds its backup threshold.
  let triggerMetric = null;   // 'validatorCatchRate' or 'junkInProductionRate' or null
  let triggerValue = null;
  if (validatorCatchRate !== null && validatorCatchRate < opts.threshold) {
    triggerMetric = 'validatorCatchRate';
    triggerValue = validatorCatchRate;
  } else if (validatorCatchRate === null
             && junkInProductionRate !== null
             && junkInProductionRate > DEFAULT_JUNK_THRESHOLD) {
    triggerMetric = 'junkInProductionRate';
    triggerValue = junkInProductionRate;
  }
  const shouldPause = triggerMetric !== null;
  const shouldResume = !shouldPause;

  // Case 1: no usable data at all → no action
  if (validatorCatchRate === null && junkInProductionRate === null) {
    console.log(JSON.stringify({ action: 'no-action', reason: 'no-data', entries: entries.length }));
    return;
  }

  // Case 2: trigger above threshold and no active pause → PAUSE
  if (shouldPause && !pauseActive) {
    const until = now + PAUSE_DURATION_MS;
    const pctStr = (triggerValue * 100).toFixed(2);
    let reason, metricLabel;
    if (triggerMetric === 'validatorCatchRate') {
      metricLabel = 'validator catch rate';
      reason = 'auto-pause: 24h ' + metricLabel + ' ' + pctStr + '% < ' + (opts.threshold * 100).toFixed(2) + '%';
    } else {
      metricLabel = 'junk-in-production rate';
      reason = 'auto-pause (backup): no validatorCatchRate data, 24h ' + metricLabel + ' ' + pctStr + '% > ' + (DEFAULT_JUNK_THRESHOLD * 100).toFixed(2) + '%';
    }
    const newState = {
      pausedAt: new Date(now).toISOString(),
      until: until,
      reason: reason,
      triggerMetric: triggerMetric,
      threshold: triggerMetric === 'validatorCatchRate' ? opts.threshold : DEFAULT_JUNK_THRESHOLD,
      triggerValue: triggerValue,
      validatorCatchRate: validatorCatchRate,
      junkInProductionRate: junkInProductionRate,
    };
    if (!opts.dryRun) {
      try {
        fs.writeFileSync(PAUSE_FILE, JSON.stringify(newState, null, 2) + '\n', 'utf8');
        log('PAUSE written: ' + PAUSE_FILE);
      } catch (e) {
        err('Failed to write pause file: ' + e.message);
        console.log(JSON.stringify({ action: 'pause-failed', error: e.message }));
        return;
      }
    } else {
      log('[DRY-RUN] would write pause file: ' + JSON.stringify(newState));
    }
    console.log(JSON.stringify({
      action: 'pause',
      until: new Date(until).toISOString(),
      triggerMetric: triggerMetric,
      triggerValue: triggerValue,
      validatorCatchRate: validatorCatchRate,
      junkInProductionRate: junkInProductionRate,
      threshold: newState.threshold,
      dryRun: opts.dryRun,
    }));
    return;
  }

  // Case 3: trigger cleared and pause expired → RESUME
  if (shouldResume && pauseState && now >= pauseState.until) {
    const wasPausedForHours = ((now - Date.parse(pauseState.pausedAt)) / (60 * 60 * 1000)).toFixed(2);
    if (!opts.dryRun) {
      try {
        fs.unlinkSync(PAUSE_FILE);
        log('Pause cleared: ' + PAUSE_FILE);
      } catch (e) {
        err('Failed to clear pause file: ' + e.message);
      }
    } else {
      log('[DRY-RUN] would clear pause file');
    }
    console.log(JSON.stringify({
      action: 'resume',
      wasPausedForHours: parseFloat(wasPausedForHours),
      validatorCatchRate: validatorCatchRate,
      junkInProductionRate: junkInProductionRate,
      dryRun: opts.dryRun,
    }));
    return;
  }

  // Case 4: no trigger and no pause file → no action
  if (shouldResume && !pauseState) {
    console.log(JSON.stringify({
      action: 'no-action',
      reason: 'metrics-healthy',
      validatorCatchRate: validatorCatchRate,
      junkInProductionRate: junkInProductionRate,
      threshold: opts.threshold,
    }));
    return;
  }

  // Case 5: pause still active and not expired → keep paused
  if (pauseActive) {
    const hoursLeft = Math.max(0, (pauseState.until - now) / (60 * 60 * 1000));
    console.log(JSON.stringify({
      action: 'keep-paused',
      hoursLeft: parseFloat(hoursLeft.toFixed(2)),
      triggerMetric: pauseState.triggerMetric,
      triggerValueAtPause: pauseState.triggerValue,
      validatorCatchRate: validatorCatchRate,
      junkInProductionRate: junkInProductionRate,
      until: new Date(pauseState.until).toISOString(),
    }));
    return;
  }

  // Should not reach here, but be defensive
  console.log(JSON.stringify({ action: 'no-action', reason: 'unhandled-state' }));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    err('Fatal: ' + e.message);
    // Exit 0 even on error — thin executor must not block cron
    console.log(JSON.stringify({ action: 'error', error: e.message }));
  }
}

module.exports = { computeMetrics, readJunkRateEntries, readPauseState };
