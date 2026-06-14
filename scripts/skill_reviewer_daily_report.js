#!/usr/bin/env node
/**
 * skill_reviewer_daily_report.js — Thin executor (no LLM) + minimal Discord push
 *
 * Week 1 Safety Net (Issue #154): daily 23:55 HKT push to Discord #⚙️系統
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
 *   - Discord #⚙️系統 (1473376125584670872) via `openclaw message send`
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
const { execFileSync } = require('child_process');

const { WS } = require('./lib/config');

const SKILL_CREATED_LOG = path.join(WS, '.skill_created.jsonl');
const JUNK_RATE_FILE = path.join(WS, '.skill_junk_rate.jsonl');
const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');
const DISCORD_CHANNEL = '1473376125584670872';
const DEFAULT_HOURS = 24;
const AUTO_PAUSE_THRESHOLD = 0.15;  // mirror skill_reviewer_bot.js CONFIG
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

function readPauseState() {
  if (!fs.existsSync(PAUSE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function topClusters(events, n) {
  const counts = {};
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const name = e.name || (e.file ? e.file.split('/').slice(-2, -1)[0] : 'unknown');
    // cluster = first segment of skill name (kebab-case or whatever)
    const cluster = (name.split(/[-_]/)[0] || name).toLowerCase();
    counts[cluster] = (counts[cluster] || 0) + 1;
  }
  const arr = Object.keys(counts).map(function (k) { return { name: k, count: counts[k] }; });
  arr.sort(function (a, b) { return b.count - a.count; });
  return arr.slice(0, n);
}

function buildReport(events, junkEntry, pauseState, hours) {
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
      junkRate24h = junkEntry.junkInProductionRate / 100;
    } else if (typeof junkEntry.junkRatePercent === 'number') {
      junkRate24h = junkEntry.junkRatePercent / 100;
    }
    junkRateTarget = junkEntry.target;
  }

  // Validator catch rate (from junkEntry)
  let catchRate = null;
  if (junkEntry && typeof junkEntry.validatorCatchRate === 'number') {
    catchRate = junkEntry.validatorCatchRate / 100;
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
      pauseStr = 'ACTIVE until ' + untilHkt + ' (junk rate ' + (pauseState.junkRateAtPause * 100).toFixed(2) + '%)';
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
    const pct = (junkRate24h * 100).toFixed(2);
    const targetPct = junkRateTarget !== null ? (junkRateTarget + '%') : '10%';
    const flag = junkRate24h > AUTO_PAUSE_THRESHOLD ? ' ⚠️' : '';
    junkLine = 'Junk-in-Production (' + hours + 'h): ' + pct + '% (target <' + targetPct + ')' + flag;
  } else {
    junkLine = 'Junk-in-Production (' + hours + 'h): no data';
  }

  // Validator catch rate line
  let catchLine;
  if (catchRate !== null) {
    const pct = (catchRate * 100).toFixed(2);
    const flag = catchRate < VALIDATOR_CATCH_TARGET ? ' ⚠️' : ' ✅';
    catchLine = 'Validator Catch Rate: ' + pct + '% (target ≥' + (VALIDATOR_CATCH_TARGET * 100) + '%)' + flag;
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

  return '📊 Skill Reviewer Daily Report (' + today + ')\n' +
    '─────────────────────────────\n' +
    'Total: ' + total + ' | Passed: ' + passed + ' | Rejected: ' + rejected +
    ' | Symlinked: ' + symlinked + safetyNetLines + '\n' +
    junkLine + '\n' +
    catchLine + '\n' +
    'Top clusters: ' + clusterStr + '\n' +
    'Pause status: ' + pauseStr +
    newSkillsLines +
    recommendLine + '\n' +
    '─────────────────────────────';
}

function sendDiscordMessage(content, dryRun) {
  if (dryRun) {
    log('[DRY-RUN] Would send to Discord channel ' + DISCORD_CHANNEL + ':');
    log('---');
    log(content);
    log('---');
    return { status: 'dry-run' };
  }
  try {
    const result = execFileSync('openclaw', [
      'message', 'send',
      '--channel', 'discord',
      '--target', 'channel:' + DISCORD_CHANNEL,
      '--message', content,
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    log('✅ Discord message sent');
    return { status: 'ok', output: result.toString().substring(0, 200) };
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().substring(0, 500) : '';
    const msg = e.killed || e.signal === 'SIGTERM' ? 'timeout' : (stderr || e.message);
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
      if (isNaN(v)) { err('--hours requires an integer'); process.exit(0); }
      opts.hours = v;
    }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node skill_reviewer_daily_report.js [--dry-run] [--hours 24] [--no-discord]');
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
  const events = readEventsSince(opts.hours);
  const junkEntry = readLatestJunkRate();
  const pauseState = readPauseState();
  const report = buildReport(events, junkEntry, pauseState, opts.hours);

  log('Events (24h): ' + events.length);
  log('Junk rate entry: ' + (junkEntry ? 'yes' : 'no'));
  log('Pause state: ' + (pauseState ? 'present' : 'none'));

  // Print to stdout (cron logs capture this for inspection)
  console.log(report);

  // Send to Discord unless --no-discord or --dry-run
  if (opts.noDiscord) {
    log('Discord push skipped (--no-discord)');
  } else {
    const result = sendDiscordMessage(report, opts.dryRun);
    if (result.status === 'error') {
      // Thin executor: don't fail the cron run
      log('Discord push failed but cron will continue');
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    err('Fatal: ' + e.message);
    console.log(JSON.stringify({ action: 'error', error: e.message }));
  }
}

module.exports = { buildReport, topClusters };
