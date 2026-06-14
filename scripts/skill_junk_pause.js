#!/usr/bin/env node
/**
 * skill_junk_pause.js — Thin executor (no LLM)
 *
 * Week 1 Safety Net (Issue #154): auto-pause skill_reviewer_bot.js's
 * auto-symlink when 24h junk rate exceeds AUTO_PAUSE_THRESHOLD.
 *
 * Reads `.skill_junk_rate.jsonl` last 24h entries → computes avg junk rate
 * → writes/clears `.skill_reviewer_pause.json` accordingly.
 *
 * Behaviour:
 *   rate > threshold AND no active pause → write pause file, output {action: 'pause'}
 *   rate ≤ threshold AND pause expired → clear pause file, output {action: 'resume'}
 *   pause active and not expired        → output {action: 'keep-paused', hoursLeft: X}
 *   rate ≤ threshold AND no pause       → output {action: 'no-action'}
 *
 * Usage:
 *   node scripts/skill_junk_pause.js [--quiet] [--dry-run] [--threshold 0.15] [--hours 24]
 *
 * Flags:
 *   --quiet                Suppress non-essential log output
 *   --dry-run              Print what would happen, do not write pause file
 *   --threshold <float>    Override AUTO_PAUSE_THRESHOLD (default 0.15)
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
const DEFAULT_THRESHOLD = 0.15;
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

function computeJunkRate(entries) {
  if (!entries.length) return null;
  // Both junkInProductionRate (v2) and junkRatePercent (v1) are stored
  // as PERCENT values (0-100 scale), not fractions (0-1). Convert to
  // fraction here so we can compare against the threshold (also a fraction).
  // junkInProductionRate field name suggests rate, but the source data
  // shows 7.69 meaning 7.69%, so we treat it as percent.
  const rates = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e.junkInProductionRate === 'number') {
      rates.push(e.junkInProductionRate / 100);
    } else if (typeof e.junkRatePercent === 'number') {
      rates.push(e.junkRatePercent / 100);
    }
  }
  if (!rates.length) return null;
  // Simple mean (no weighted — each tracker run is a sample, treat equally)
  return rates.reduce((a, b) => a + b, 0) / rates.length;
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
      console.log('Usage: node skill_junk_pause.js [--quiet] [--dry-run] [--threshold 0.15] [--hours 24]');
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
  const junkRate = computeJunkRate(entries);
  const pauseState = readPauseState();
  const now = Date.now();
  const pauseActive = pauseState && now < pauseState.until;

  log('Read ' + entries.length + ' junk-rate entries (last ' + opts.hours + 'h)');
  if (junkRate !== null) {
    log('Avg junk rate: ' + (junkRate * 100).toFixed(2) + '% (threshold ' + (opts.threshold * 100).toFixed(2) + '%)');
  } else {
    log('No usable junk-rate data in window');
  }

  // Case 1: no usable data → no action
  if (junkRate === null) {
    console.log(JSON.stringify({ action: 'no-action', reason: 'no-data', entries: entries.length }));
    return;
  }

  // Case 2: rate above threshold and no active pause → PAUSE
  if (junkRate > opts.threshold && !pauseActive) {
    const until = now + PAUSE_DURATION_MS;
    const newState = {
      pausedAt: new Date(now).toISOString(),
      until: until,
      reason: 'auto-pause: 24h junk rate ' + (junkRate * 100).toFixed(2) + '% > ' + (opts.threshold * 100).toFixed(2) + '%',
      junkRateAtPause: junkRate,
      threshold: opts.threshold,
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
      junkRate: junkRate,
      threshold: opts.threshold,
      dryRun: opts.dryRun,
    }));
    return;
  }

  // Case 3: rate ≤ threshold and pause expired → RESUME
  if (junkRate <= opts.threshold && pauseState && now >= pauseState.until) {
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
      junkRate: junkRate,
      dryRun: opts.dryRun,
    }));
    return;
  }

  // Case 4: rate ≤ threshold and no pause file → no action
  if (junkRate <= opts.threshold && !pauseState) {
    console.log(JSON.stringify({ action: 'no-action', reason: 'rate-below-threshold', junkRate: junkRate, threshold: opts.threshold }));
    return;
  }

  // Case 5: pause still active and not expired → keep paused
  if (pauseActive) {
    const hoursLeft = Math.max(0, (pauseState.until - now) / (60 * 60 * 1000));
    console.log(JSON.stringify({
      action: 'keep-paused',
      hoursLeft: parseFloat(hoursLeft.toFixed(2)),
      junkRateAtPause: pauseState.junkRateAtPause,
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

module.exports = { computeJunkRate, readJunkRateEntries, readPauseState };
