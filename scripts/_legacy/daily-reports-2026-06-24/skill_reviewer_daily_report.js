#!/usr/bin/env node
/**
 * skill_reviewer_daily_report.js — Thin executor (no LLM) + minimal Discord push
 *
 * Week 1 Safety Net (Issue <see tracker>): daily 23:55 HKT push to Discord #⚙️系統
 * summarising the past 24h of skill_reviewer_bot activity.
 *
 * Reads:
 *   - .skill_created.jsonl (events from past 24h)
 *   - .skill_junk_rate.jsonl (current junk rate, latest entry)
 *   - .skill_reviewer_pause.json (optional — pause state)
 *
 * Computes:
 *   - Total events / passed / rejected counts (24h)
 *   - Junk rate (24h, from latest junk-rate entry)
 *   - Top 3 clusters by count (cluster = first word of skill name)
 *   - Pause state summary
 *
 * Push:
 *   - Discord #⚙️系統 (see CONFIG.DISCORD_CHANNEL_ID) via `openclaw message send`
 *   - Skipped if --dry-run
 *
 * Usage:
 *   node scripts/skill_reviewer_daily_report.js [--dry-run] [--hours 24] [--no-discord]
 *
 * Exit codes:
 *   0  always (thin executor)
 *
 * Why thin executor:
 *   - No LLM call. Pure file IO + arithmetic.
 *   - Cron reads the report from cron log on failure for inspection.
 *   - Failures (e.g. Discord push fail) print to stderr but do not block cron.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { WS } = require('./lib/config');

const SKILL_CREATED_LOG = path.join(WS, '.skill_created.jsonl');
const JUNK_RATE_FILE = path.join(WS, '.skill_junk_rate.jsonl');
const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');
// NB-5 (Round 4 audit): cooldown/stability gate telemetry — surface in daily report.
const GATES_LOG = path.join(WS, '.skill_reviewer_gates.jsonl');
const CONFIG = {
  DISCORD_CHANNEL_ID: '1473376125584670872',
  DISCORD_SEND_TIMEOUT_MS: 15000,
  SHORT_SLICE_LEN: 100,
  REPORT_SLICE_LEN: 200,
  ERR_SLICE_LEN: 500,
  PERCENT_MULTIPLIER: 100
};
const DISCORD_CHANNEL = CONFIG.DISCORD_CHANNEL_ID;
const DEFAULT_HOURS = 24;
const AUTO_PAUSE_THRESHOLD = 0.30;  // mirror skill_junk_pause.js (raised from 0.15 on 2026-06-20 LLM-judgment pass)
const VALIDATOR_CATCH_TARGET = 0.25;  // mirror skill_junk_tracker target

// ── Helpers ──

function log() {
  if (!process.argv.includes('--quiet')) console.log.apply(console, arguments);
}

function err() {
  console.error.apply(console, arguments);
}

function readEventsSince(hours) {
  if (!fs.existsSync(SKILL_CREATED_LOG)) return [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const out = [];
  let raw;
  try {
    raw = fs.readFileSync(SKILL_CREATED_LOG, 'utf8');
  } catch (e) {
    err('Failed to read ' + SKILL_CREATED_LOG + ': ' + e.message);
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
    if (entry.ts) {
      const t = Date.parse(entry.ts);
      if (!isNaN(t) && t < cutoff) continue;
    }
    out.push(entry);
  }
  return out;
}

function readLatestJunkRate() {
  if (!fs.existsSync(JUNK_RATE_FILE)) return null;
  let raw;
  try {
    raw = fs.readFileSync(JUNK_RATE_FILE, 'utf8');
  } catch (e) {
    return null;
  }
  // Get the last non-empty line
  const lines = raw.split('\n').filter(function (l) { return l.trim(); });
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch (e) {
    return null;
  }
}

// NB-6 (Round 4 audit): stale-grace + retry + fallback for junk rate.
// Daily report runs at 23:56 — 1 minute after junk tracker (23:55). If the
// tracker is still writing or failed, the file may be missing/empty/partial.
// This wrapper: (1) waits 5s for tracker to finish, (2) retries 3 times with
// 2s/4s/8s backoff, (3) falls back to the last successful entry on total failure.
// Telemetry: junkRateStale (bool) + junkRateRetryCount (int).
const JUNK_RATE_STARTUP_GRACE_MS = 5000;     // wait for tracker to finish writing
const JUNK_RATE_RETRY_DELAYS_MS = [2000, 4000, 8000];  // 14s total backoff budget
function readLatestJunkRateWithRetry(startupGraceMs) {
  const grace = (typeof startupGraceMs === 'number' && startupGraceMs >= 0)
    ? startupGraceMs
    : JUNK_RATE_STARTUP_GRACE_MS;
  // Phase 1: startup grace (cheap synchronous sleep — daily report runs once a day)
  if (grace > 0) {
    const end = Date.now() + grace;
    while (Date.now() < end) { /* busy-wait */ }
  }
  let attempt = 0;
  for (attempt = 0; attempt < JUNK_RATE_RETRY_DELAYS_MS.length + 1; attempt++) {
    const entry = readLatestJunkRate();
    if (entry) {
      return { entry: entry, retryCount: attempt, stale: false };
    }
    // No entry yet — backoff before next try (skip backoff after final attempt)
    if (attempt < JUNK_RATE_RETRY_DELAYS_MS.length) {
      const waitMs = JUNK_RATE_RETRY_DELAYS_MS[attempt];
      const end = Date.now() + waitMs;
      while (Date.now() < end) { /* busy-wait */ }
    }
  }
  // All retries exhausted — fall back to second-to-last successful entry.
  // Reads the JSONL tail (last 5 non-empty lines) and returns the newest parseable
  // one, which may be hours/days old. Caller marks junkRateStale=true so the report
  // can surface this to #⚙️系統.
  if (fs.existsSync(JUNK_RATE_FILE)) {
    try {
      const lines = fs.readFileSync(JUNK_RATE_FILE, 'utf8')
        .split('\n').filter(function (l) { return l.trim(); });
      // Walk back from the tail looking for a parseable entry (skip corrupted tail)
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        try {
          const entry = JSON.parse(lines[i]);
          return { entry: entry, retryCount: attempt, stale: true };
        } catch (e) { /* skip corrupted line, try older */ }
      }
    } catch (e) { /* fall through to null */ }
  }
  return { entry: null, retryCount: attempt, stale: true };
}

function readPauseState() {
  if (!fs.existsSync(PAUSE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

// NB-5: count gate-skipped events from .skill_reviewer_gates.jsonl over the
// last `hours` window. Returns { stable: N, cooldown: N, total: N }.
// Fails open on missing/corrupt file (returns zeros).
function readGateSkipStats(hours) {
  const stats = { stable: 0, cooldown: 0, total: 0 };
  if (!fs.existsSync(GATES_LOG)) return stats;
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  let raw;
  try {
    raw = fs.readFileSync(GATES_LOG, 'utf8');
  } catch (e) {
    return stats;
  }
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) { continue; }
    if (entry.event !== 'skill_skipped') continue;
    if (entry.ts) {
      const t = Date.parse(entry.ts);
      if (!isNaN(t) && t < cutoff) continue;
    }
    stats.total++;
    if (entry.reason === 'stable') stats.stable++;
    else if (entry.reason === 'cooldown') stats.cooldown++;
  }
  return stats;
}

function topClusters(events, n) {
  const counts = {};
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const name = e.name || (e.file ? e?.file?.split('/').slice(-2, -1)[0] : 'unknown');
    // cluster = first segment of skill name (kebab-case or whatever)
    const cluster = (name.split(/[-_]/)[0] || name).toLowerCase();
    counts[cluster] = (counts[cluster] || 0) + 1;
  }
  const arr = Object.keys(counts).map(function (k) { return { name: k, count: counts[k] }; });
  arr.sort(function (a, b) { return b.count - a.count; });
  return arr.slice(0, n);
}

function buildReport(events, junkEntry, pauseState, hours, gateStats) {
  // Counts
  let passed = 0, rejected = 0, symlinked = 0, paused = 0, draft = 0, writeFailed = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.validationPassed) passed++;
    else rejected++;
    if (e.symlinked) symlinked++;
    if (e.reason && /auto-paused/i.test(e.reason)) paused++;
    if (e.reason && /AUTO_APPLY=false/.test(e.reason)) draft++;
    if (e.reason && /write failed/i.test(e.reason)) writeFailed++;
  }
  const total = events.length;

  // Junk rate (24h) — convert percent to fraction for display
  let junkRate24h = null;
  let junkRateTarget = null;
  if (junkEntry) {
    if (typeof junkEntry.junkInProductionRate === 'number') {
      junkRate24h = junkEntry.junkInProductionRate / CONFIG.PERCENT_MULTIPLIER;
    } else if (typeof junkEntry.junkRatePercent === 'number') {
      junkRate24h = junkEntry.junkRatePercent / CONFIG.PERCENT_MULTIPLIER;
    }
    junkRateTarget = junkEntry.target;
  }

  // Validator catch rate (from junkEntry)
  let catchRate = null;
  if (junkEntry && typeof junkEntry.validatorCatchRate === 'number') {
    catchRate = junkEntry.validatorCatchRate / CONFIG.PERCENT_MULTIPLIER;
  }

  // Top clusters
  const clusters = topClusters(events, 3);
  const clusterStr = clusters.length
    ? clusters.map(function (c) { return c.name + '(' + c.count + ')'; }).join(', ')
    : '—';

  // Pause state
  let pauseStr = '—';
  const now = Date.now();
  if (pauseState) {
    if (now < pauseState.until) {
      const untilHkt = new Date(pauseState.until).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      pauseStr = 'ACTIVE until ' + untilHkt + ' (junk rate ' + (pauseState.junkRateAtPause * CONFIG.PERCENT_MULTIPLIER).toFixed(2) + '%)';
    } else {
      pauseStr = 'expired (rate now below threshold)';
    }
  } else {
    pauseStr = 'inactive';
  }

  // Today's date for the header
  const today = new Date().toISOString().slice(0, 10);

  // Junk-in-production line
  let junkLine;
  if (junkRate24h !== null) {
    const pct = (junkRate24h * CONFIG.PERCENT_MULTIPLIER).toFixed(2);
    const targetPct = junkRateTarget !== null ? (junkRateTarget + '%') : '10%';
    const flag = junkRate24h > AUTO_PAUSE_THRESHOLD ? ' ⚠️' : '';
    junkLine = 'Junk-in-Production (' + hours + 'h): ' + pct + '% (target <' + targetPct + ')' + flag;
  } else {
    junkLine = 'Junk-in-Production (' + hours + 'h): no data';
  }

  // Validator catch rate line
  let catchLine;
  if (catchRate !== null) {
    const pct = (catchRate * CONFIG.PERCENT_MULTIPLIER).toFixed(2);
    const flag = catchRate < VALIDATOR_CATCH_TARGET ? ' ⚠️' : ' ✅';
    catchLine = 'Validator Catch Rate: ' + pct + '% (target ≥' + (VALIDATOR_CATCH_TARGET * CONFIG.PERCENT_MULTIPLIER) + '%)' + flag;
  } else {
    catchLine = 'Validator Catch Rate: no data';
  }

  // Safety net counts (only show if any)
  let safetyNetLines = '';
  if (paused > 0 || draft > 0) {
    const parts = [];
    if (paused > 0) parts.push('paused:' + paused);
    if (draft > 0) parts.push('drafted:' + draft);
    safetyNetLines = '\nSafety nets triggered: ' + parts.join(', ');
  }

  // New skills list (top 5)
  let newSkillsLines = '';
  const passedEvents = events.filter(function (e) { return e.validationPassed; });
  if (passedEvents.length > 0) {
    const top5 = passedEvents.slice(0, 5);
    const names = top5.map(function (e) {
      return '• ' + (e.name || 'unknown');
    }).join('\n');
    newSkillsLines = '\n─── New/Updated Skills (top 5) ───\n' + names;
  }

  // Recommendation line
  let recommendLine = '';
  if (junkRate24h !== null && junkRate24h > AUTO_PAUSE_THRESHOLD) {
    recommendLine = '\n⚠️ Junk rate above auto-pause threshold — manual review recommended';
  } else if (junkRate24h !== null && catchRate !== null && catchRate < VALIDATOR_CATCH_TARGET) {
    recommendLine = '\n⚠️ Validator catch rate below target — review validator thresholds';
  }

  // NB-6: stale-grace telemetry — surface if junk rate came from fallback (older than 24h).
  let staleLine = '';
  if (junkEntry && typeof junkEntry.stale === 'boolean' && junkEntry.stale) {
    staleLine = '\n⚠️ Junk rate is stale (23:55 tracker was late/missing)';
  }

  // NB-5: gate skip counts (stable + cooldown over the window).
  let gateLine = '';
  if (gateStats && gateStats.total > 0) {
    gateLine = '\n🛡️ Gate skips (' + hours + 'h): ' + gateStats.total +
      ' (stable:' + gateStats.stable + ', cooldown:' + gateStats.cooldown + ')';
  }

  return '📊 Skill Reviewer Daily Report (' + today + ')\n' +
    '─────────────────────────────\n' +
    'Total: ' + total + ' | Passed: ' + passed + ' | Rejected: ' + rejected +
    ' | Symlinked: ' + symlinked + safetyNetLines + '\n' +
    junkLine + '\n' +
    catchLine + '\n' +
    'Top clusters: ' + clusterStr + '\n' +
    'Pause status: ' + pauseStr +
    newSkillsLines +
    recommendLine +
    staleLine +
    gateLine + '\n' +
    '─────────────────────────────';
}

// P3-2: Hard timeout wrapper for Discord send — prevents cron hangs on hung webhook.
// execFileSync's `timeout` fires SIGTERM, but the child may still hang waiting for
// the Discord HTTP connection. We force-kill via SIGKILL and bound total wait to 5s.
const DISCORD_SEND_TIMEOUT_MS = CONFIG.DISCORD_SEND_TIMEOUT_MS;
function sendWithTimeout(cmd, args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let settled = false;
    const child = require('child_process').spawn(cmd, args, {
      env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child?.stdout?.on('data', function (d) { stdout += d.toString(); });
    child?.stderr?.on('data', function (d) { stderr += d.toString(); });
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error('send timeout (' + timeoutMs + 'ms)'));
    }, timeoutMs);
    child.on('error', function (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', function (code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        const e = new Error('exit ' + code + (signal ? ' signal ' + signal : ''));
        e.stderr = stderr;
        e.stdout = stdout;
        reject(e);
      }
    });
  });
}

async function sendDiscordMessage(content, dryRun) {
  if (dryRun) {
    log('[DRY-RUN] Would send to Discord channel ' + DISCORD_CHANNEL + ':');
    log('---');
    log(content);
    log('---');
    return { status: 'dry-run' };
  }
  try {
    const result = await sendWithTimeout('openclaw', [
      'message', 'send',
      '--channel', 'discord',
      '--target', 'channel:' + DISCORD_CHANNEL,
      '--message', content,
    ], DISCORD_SEND_TIMEOUT_MS);
    log('✅ Discord message sent');
    return { status: 'ok', output: result.toString().substring(0, CONFIG.REPORT_SLICE_LEN) };
  } catch (e) {
    const stderr = e.stderr ? e?.stderr?.toString().substring(0, CONFIG.ERR_SLICE_LEN) : '';
    const msg = /timeout/.test(e.message) ? 'timeout' : (stderr || e.message);
    err('Discord send failed: ' + msg);
    return { status: 'error', error: msg };
  }
}

function parseArgs() {
  const opts = {
    dryRun: false,
    hours: DEFAULT_HOURS,
    noDiscord: false,
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-discord') opts.noDiscord = true;
    else if (a === '--hours') {
      const v = parseInt(args[++i], 10);
      if (isNaN(v)) { err('--hours requires an integer'); process.exit(2); }
      opts.hours = v;
    }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node skill_reviewer_daily_report.js [--dry-run] [--hours 24] [--no-discord]');
      process.exit(0);
    }
    else {
      err('Unknown flag: ' + a);
      process.exit(2);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const events = readEventsSince(opts.hours);
  // NB-6: read junk rate with startup grace + retry + fallback.
  // Returns { entry, retryCount, stale } instead of raw entry.
  const junkResult = readLatestJunkRateWithRetry();
  const junkEntry = junkResult.entry;
  const pauseState = readPauseState();
  // NB-5: count gate-skip events (stable + cooldown) over the same window.
  const gateStats = readGateSkipStats(opts.hours);
  const report = buildReport(events, junkEntry, pauseState, opts.hours, gateStats);

  log('Events (24h): ' + events.length);
  log('Junk rate entry: ' + (junkEntry ? 'yes' : 'no') +
      ' (retryCount=' + junkResult.retryCount +
      ', stale=' + junkResult.stale + ')');
  log('Gate skips (' + opts.hours + 'h): stable=' + gateStats.stable +
      ' cooldown=' + gateStats.cooldown + ' total=' + gateStats.total);
  log('Pause state: ' + (pauseState ? 'present' : 'none'));

  // Print to stdout (cron logs capture this for inspection)
  console.log(report);

  // Send to Discord unless --no-discord or --dry-run
  if (opts.noDiscord) {
    log('Discord push skipped (--no-discord)');
  } else {
    const result = await sendDiscordMessage(report, opts.dryRun);
    if (result.status === 'error') {
      // Thin executor: don't fail the cron run
      log('Discord push failed but cron will continue');
    }
  }
}

if (require.main === module) {
  try {
    main().catch(function (e) {
      err('Fatal: ' + e.message);
      console.log(JSON.stringify({ action: 'error', error: e.message }));
    });
  } catch (e) {
    err('Fatal: ' + e.message);
    console.log(JSON.stringify({ action: 'error', error: e.message }));
  }
}

module.exports = { buildReport, topClusters };
