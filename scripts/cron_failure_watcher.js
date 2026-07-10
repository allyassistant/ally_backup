#!/usr/bin/env node
/**
 * cron_failure_watcher.js — Cron failure detection loop (Phase 1 SHADOW)
 *
 * Phase 1 SHADOW-only behaviour:
 *   - Polls detection logic at intervalMs (default 30s).
 *   - Logs observations to `.state/cron_failure_diagnostics.jsonl`.
 *   - Updates `.state/cron_failure_watcher.json` (atomic write) with
 *     `consecutiveErrors`, `cooldownUntil`, etc.
 *   - NO Discord post, NO issue creation, NO sub-agent spawn (those are
 *     Phase 2/3 and only reachable when mode==='LIVE').
 *
 * Exit codes:
 *   0 = clean exit (enabled=false, single tick, or graceful stop)
 *   1 = unexpected error
 *   2 = config error
 *
 * Usage:
 *   node cron_failure_watcher.js                 # loop forever (default mode)
 *   node cron_failure_watcher.js --once          # exactly one detection tick
 *   node cron_failure_watcher.js --help
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { STATE_DIR, WS } = require('./lib/config');
const { getHKTDate } = require('./lib/time');
const { loadCronWatchYaml } = require('./cron_failure_yaml');
const { runDetection } = require('./cron_failure_detect');

const CONFIG_PATH = path.join(process.env.HOME || '', '.openclaw', 'cron-watch.yaml');
const STATE_FILE = path.join(STATE_DIR, 'cron_failure_watcher.json');
const DIAG_FILE = path.join(STATE_DIR, 'cron_failure_diagnostics.jsonl');

// ───────────────────────────────────────────────────────────────────────────
// Tunables
// ───────────────────────────────────────────────────────────────────────────
const DEFAULT_INTERVAL_MS = parseInt('30000', 10);
const DEFAULT_CONSECUTIVE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MINUTES = 60;
const DEFAULT_DAILY_TOKEN_BUDGET = parseInt('100000', 10);
const DEFAULT_BATCH_WINDOW_MINUTES = 15;
const DEFAULT_MAX_LOG_BYTES = parseInt('52428800', 10);  // 50MB
const MAX_LOG_LINES = parseInt('10000', 10);

const VALID_MODES = new Set(['SHADOW', 'LIVE']);

// ───────────────────────────────────────────────────────────────────────────
// State I/O (atomic)
// ───────────────────────────────────────────────────────────────────────────

function emptyState() {
  return {
    crons: {},
    dailyTokenSpend: 0,
    lastResetDate: getHKTDate(),
    systemLogOffsets: {},
    meta: {
      createdAt: new Date().toISOString(),
      version: 1,
    },
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    if (typeof parsed.dailyTokenSpend !== 'number') parsed.dailyTokenSpend = 0;
    if (!parsed.crons || typeof parsed.crons !== 'object') parsed.crons = {};
    if (!parsed.systemLogOffsets || typeof parsed.systemLogOffsets !== 'object') {
      parsed.systemLogOffsets = {};
    }
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = { version: 1 };
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyState();
    // JSON corruption should never block startup — back up + start fresh
    try {
      fs.renameSync(STATE_FILE, STATE_FILE + '.corrupt.' + Date.now());
    } catch (_) { /* best effort */ }
    return emptyState();
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (_) { /* already exists */ }
  const tmpFile = STATE_FILE + '.tmp.' + process.pid + '.' + Date.now();
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    // best-effort cleanup
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    throw err;
  }
}

function appendDiagnostic(entry) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (_) { /* already exists */ }
  const line = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(DIAG_FILE, line, 'utf8');
  } catch (err) {
    console.error(`[warn] failed to append to ${DIAG_FILE}: ${err.message}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Config loader
// ───────────────────────────────────────────────────────────────────────────

function resolveConfig() {
  const fromYaml = (() => {
    try { return loadCronWatchYaml(CONFIG_PATH); } catch (_) { return {}; }
  })();

  const envInterval = process.env.CRON_WATCH_INTERVAL_MS;
  const intervalMs = envInterval
    ? parseInt(envInterval, 10)
    : (typeof fromYaml.intervalMs === 'number' ? fromYaml.intervalMs : DEFAULT_INTERVAL_MS);

  return {
    enabled: fromYaml.enabled === true,           // default false (true opt-in)
    mode: VALID_MODES.has(fromYaml.mode) ? fromYaml.mode : 'SHADOW',
    intervalMs,
    consecutiveErrorsThreshold: typeof fromYaml.consecutiveErrorsThreshold === 'number'
      ? fromYaml.consecutiveErrorsThreshold : DEFAULT_CONSECUTIVE_THRESHOLD,
    cooldownMinutes: typeof fromYaml.cooldownMinutes === 'number'
      ? fromYaml.cooldownMinutes : DEFAULT_COOLDOWN_MINUTES,
    dailyTokenBudgetCap: typeof fromYaml.dailyTokenBudgetCap === 'number'
      ? fromYaml.dailyTokenBudgetCap : DEFAULT_DAILY_TOKEN_BUDGET,
    batchWindowMinutes: typeof fromYaml.batchWindowMinutes === 'number'
      ? fromYaml.batchWindowMinutes : DEFAULT_BATCH_WINDOW_MINUTES,
    cronAllowList: Array.isArray(fromYaml.cronAllowList) ? fromYaml.cronAllowList : [],
    cronDenyList: Array.isArray(fromYaml.cronDenyList) ? fromYaml.cronDenyList : [],
    configPath: CONFIG_PATH,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Tick logic — SHADOW only: log + state update, NO actions
// ───────────────────────────────────────────────────────────────────────────

function runOnce(config, state) {
  const tickAt = new Date().toISOString();

  // Reset daily budget if it's a new HKT day
  const today = getHKTDate();
  if (state.lastResetDate !== today) {
    state.dailyTokenSpend = 0;
    state.lastResetDate = today;
  }

  const detection = runDetection({
    allowList: config.cronAllowList,
    denyList: config.cronDenyList,
    state,
  });

  // Persist updated log offsets so next tick sees only new lines.
  state.systemLogOffsets = detection.system.offsets;

  // Update per-cron consecutive error counters
  const seenIds = new Set();
  for (const obs of detection.openclaw.observations.concat(detection.system.observations)) {
    seenIds.add(obs.cronId);
    const prev = state.crons[obs.cronId] || {
      consecutiveErrors: 0,
      lastErrorAt: null,
      lastCheckedAt: null,
      cooldownUntil: null,
      spawnedThisCycle: false,
    };
    if (obs.status === 'ok' || obs.consecutiveErrors === 0) {
      // recovery — reset counter
      prev.consecutiveErrors = obs.consecutiveErrors > 0 ? obs.consecutiveErrors : 0;
    } else {
      prev.consecutiveErrors = obs.consecutiveErrors > 0 ? obs.consecutiveErrors : prev.consecutiveErrors + 1;
    }
    prev.lastErrorAt = obs.lastErrorAt || prev.lastErrorAt;
    prev.lastCheckedAt = tickAt;
    if (prev.consecutiveErrors >= config.consecutiveErrorsThreshold && !prev.cooldownUntil) {
      prev.cooldownUntil = new Date(Date.now() + config.cooldownMinutes * 60 * 1000).toISOString();
    }
    state.crons[obs.cronId] = prev;

    appendDiagnostic({
      ts: tickAt,
      mode: config.mode,
      cronId: obs.cronId,
      source: obs.source,
      name: obs.name,
      status: obs.status,
      consecutiveErrors: prev.consecutiveErrors,
      errorCount: obs.errorCount,
      lastErrorAt: obs.lastErrorAt,
      lastErrorMessage: obs.lastErrorMessage,
      cooldownUntil: prev.cooldownUntil,
    });
  }

  // Reset counters for recovered (now healthy) crons that were previously failing
  for (const id of Object.keys(state.crons)) {
    if (!seenIds.has(id)) {
      const entry = state.crons[id];
      if (entry.consecutiveErrors > 0) {
        entry.consecutiveErrors = 0;
        entry.cooldownUntil = null;
        entry.spawnedThisCycle = false;
      }
      entry.lastCheckedAt = tickAt;
      state.crons[id] = entry;
    }
  }

  saveState(state);

  return {
    tickAt,
    openclawOk: detection.openclaw.ok,
    openclawError: detection.openclaw.error,
    openclawHits: detection.openclaw.observations.length,
    systemHits: detection.system.observations.length,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CLI / loop
// ───────────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`cron_failure_watcher.js — Phase 1 SHADOW cron failure detector

Usage:
  node cron_failure_watcher.js            # loop indefinitely
  node cron_failure_watcher.js --once     # one tick, then exit
  node cron_failure_watcher.js --help

Config: ~/.openclaw/cron-watch.yaml
State:  .state/cron_failure_watcher.json
Log:    .state/cron_failure_diagnostics.jsonl

If config.enabled !== true the process exits 0 immediately.
If config.mode !== 'SHADOW' (e.g. 'LIVE') Phase 2/3 actions will fire when
those features ship — for now only state + diagnostics are written.
`);
}

async function loop(config) {
  // Periodic loop with graceful shutdown on SIGINT/SIGTERM
  let stopping = false;
  const handle = (sig) => {
    stopping = true;
    process.stderr.write(`[watcher] received ${sig}, stopping after current tick\n`);
  };
  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);

  // Sequential tick loop (single watcher per machine per workspace).
  // eslint-disable-next-line no-constant-condition
  while (!stopping) {
    try {
      const state = loadState();
      const summary = runOnce(config, state);
      process.stdout.write(JSON.stringify(summary) + '\n');
    } catch (err) {
      process.stderr.write(`[watcher] tick error: ${err.message}\n`);
    }
    if (stopping) break;
    await new Promise((resolve) => {
      setTimeout(resolve, config.intervalMs);
    });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  const once = args.includes('--once');

  const config = resolveConfig();

  // enabled=false (default) → clean no-op exit. Hard rule from issue #140
  // Item 3: never resurrect error_auto_issue.js behaviour. SHADOW must be
  // opt-in even at the watcher level.
  if (!config.enabled) {
    process.stdout.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        action: 'noop',
        reason: 'enabled=false',
        configPath: config.configPath,
        mode: config.mode,
      }) + '\n'
    );
    process.exit(0);
  }

  if (once) {
    const state = loadState();
    const summary = runOnce(config, state);
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    process.exit(0);
  }

  loop(config).catch((err) => {
    process.stderr.write(`[watcher] fatal: ${err.message}\n`);
    process.exit(1);
  });
}

main();

module.exports = {
  resolveConfig,
  loadState,
  saveState,
  runOnce,
  emptyState,
  appendDiagnostic,
  DEFAULT_INTERVAL_MS,
  STATE_FILE,
  DIAG_FILE,
  CONFIG_PATH,
};
