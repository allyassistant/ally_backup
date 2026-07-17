/**
 * Failure Route Recovery — Phase 2
 *
 * 偵測 routing 錯誤同自動 recovery。
 * Lightweight implementation，唔係複雜 ML 系統。
 *
 * 主要功能：
 * 1. detectMisroute — 記錄 classifier suggestion vs actual action
 * 2. autoFallback  — model timeout/fail 時自動降級到 fallback model
 * 3. getRecoveryStats — 查看累積嘅 misroute 統計
 *
 * Usage:
 *   const { detectMisroute, autoFallback, getRecoveryStats } = require('./failure_recovery');
 */

const fs = require('fs');
const path = require('path');

// ─── Config (inline, no circular require) ────────────────────────────────────

const ROUTER_DIR = path.join(__dirname);
const MISROUTE_LOG = path.join(ROUTER_DIR, 'misroute_log.jsonl');
const LOG_FILE = path.join('/tmp', 'router_recovery.log');

function log(m) {
  const t = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
  fs.appendFileSync(LOG_FILE, `[${t}] ${m}\n`);
}

// ─── Model Fallback Map ──────────────────────────────────────────────────────

/**
 * Fallback chain when a model fails/times out.
 * Key: primary model, Value: fallback model
 * @type {Record<string, string>}
 */
const MODEL_FALLBACK_MAP = {
  'minimax-portal/MiniMax-M2.7': 'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-flash': null,           // no further fallback
  'kimi-coding/k2p5': 'minimax-portal/MiniMax-M2.7',
};

/**
 * Get the fallback model for a given model.
 * @param {string} model
 * @returns {string|null} fallback model, or null if none
 */
function getFallbackModel(model) {
  return MODEL_FALLBACK_MAP[model] || null;
}

// ─── Misroute Detection ──────────────────────────────────────────────────────

const MISROUTE_THRESHOLD = 5;  // alert after N repeats

/**
 * @typedef {Object} MisrouteEntry
 * @property {string} ts
 * @property {string} suggestedRoute
 * @property {string} actualRoute
 * @property {string} [messageId]
 * @property {string} [reason]
 */

/**
 * Log a misroute event (classifier suggestion vs actual action taken).
 *
 * @param {Object} opts
 * @param {string} opts.suggestedRoute  - What the classifier suggested
 * @param {string} opts.actualRoute     - What actually happened
 * @param {string} [opts.messageId]     - Optional message ID
 * @param {string} [opts.reason]        - Optional reason
 * @returns {MisrouteEntry}
 */
function detectMisroute({ suggestedRoute, actualRoute, messageId = '', reason = '' }) {
  const entry = {
    ts: new Date().toISOString(),
    suggestedRoute,
    actualRoute,
    messageId,
    reason,
  };

  try {
    fs.appendFileSync(MISROUTE_LOG, JSON.stringify(entry) + '\n', 'utf8');
    log(`[Misroute] ${suggestedRoute} → ${actualRoute} (${messageId})`);
  } catch (err) {
    log(`[Misroute] ✗ Failed to write: ${err.message}`);
  }

  return entry;
}

/**
 * Parse the misroute log and return statistics.
 *
 * @returns {Object} Stats: { total, byPair, alerts }
 */
function getRecoveryStats() {
  if (!fs.existsSync(MISROUTE_LOG)) {
    return { total: 0, byPair: [], alerts: [] };
  }

  let lines;
  try {
    lines = fs.readFileSync(MISROUTE_LOG, 'utf8').trim().split('\n').filter(Boolean);
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  /** @type {MisrouteEntry[]} */
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const byPair = {};
  for (const entry of entries) {
    const key = `${entry.suggestedRoute}→${entry.actualRoute}`;
    if (!byPair[key]) byPair[key] = { count: 0, entries: [] };
    byPair[key].count++;
    byPair[key].entries.push(entry);
  }

  const alerts = Object.entries(byPair)
    .filter(([, v]) => v.count >= MISROUTE_THRESHOLD)
    .map(([pair, v]) => ({
      pair,
      count: v.count,
      suggestion: `Consider updating classifier rules — "${pair}" appeared ${v.count} times`,
    }));

  return {
    total: entries.length,
    byPair: Object.entries(byPair).map(([pair, v]) => ({ pair, count: v.count })),
    alerts,
  };
}

/**
 * Check if a suggested route pair has been flagged multiple times,
 * and return an alert if threshold is reached.
 *
 * @param {string} suggested
 * @param {string} actual
 * @returns {string|null} Alert message or null
 */
function checkMisrouteAlert(suggested, actual) {
  const stats = getRecoveryStats();
  const pair = `${suggested}→${actual}`;
  const found = stats.byPair.find(p => p.pair === pair);
  if (found && found.count >= MISROUTE_THRESHOLD) {
    return `[Recovery Alert] Route pair "${pair}" has appeared ${found.count} times — consider updating classifier rules`;
  }
  return null;
}

// ─── Auto Fallback ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} ModelError
 * @property {string} model
 * @property {string} error    - 'timeout' | 'rate_limit' | 'api_error' | etc.
 * @property {string} message
 */

/**
 * Auto-fallback: when a model call fails, return the fallback model.
 * Logs the event for later analysis.
 *
 * @param {ModelError} modelError
 * @returns {{ fallbackModel: string|null, modelError: ModelError, logged: boolean }}
 */
function autoFallback(modelError) {
  const fallback = getFallbackModel(modelError.model);
  const entry = {
    ts: new Date().toISOString(),
    originalModel: modelError.model,
    fallbackModel: fallback,
    error: modelError.error,
    message: modelError.message,
  };

  try {
    const fallbackLog = path.join(ROUTER_DIR, 'fallback_log.jsonl');
    fs.appendFileSync(fallbackLog, JSON.stringify(entry) + '\n', 'utf8');
    log(`[Fallback] ${modelError.model} → ${fallback || 'NONE'} (${modelError.error})`);
  } catch (err) {
    log(`[Fallback] ✗ Write failed: ${err.message}`);
  }

  return {
    fallbackModel: fallback,
    modelError,
    logged: true,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Router Failure Recovery CLI

Usage:
  node failure_recovery.js --misroute \
    --suggested FDQ \
    --actual DIRECT_ANSWER \
    [--message-id "msg-123"] \
    [--reason "text"

  node failure_recovery.js --stats
  node failure_recovery.js --fallback \
    --model "minimax-portal/MiniMax-M2.7" \
    --error "timeout"

  node failure_recovery.js --check \
    --suggested SPAWN \
    --actual CODE
`);
    process.exit(0);
  }

  if (args.stats) {
    const stats = getRecoveryStats();
    console.log(`Total misroutes logged: ${stats.total}`);
    if (stats.byPair.length > 0) {
      console.log('\nBy route pair:');
      for (const { pair, count } of stats.byPair) {
        const flag = count >= MISROUTE_THRESHOLD ? ' ⚠️' : '';
        console.log(`  ${pair}: ${count}${flag}`);
      }
    }
    if (stats.alerts.length > 0) {
      console.log('\n⚠️ Alerts:');
      for (const alert of stats.alerts) {
        console.log(`  ${alert.suggestion}`);
      }
    } else {
      console.log('\n✅ No alerts (no repeated misroute patterns)');
    }
    process.exit(0);
  }

  if (args.misroute) {
    if (!args.suggested || !args.actual) {
      console.error('--misroute requires --suggested and --actual');
      process.exit(1);
    }
    detectMisroute({
      suggestedRoute: args.suggested,
      actualRoute: args.actual,
      messageId: args['message-id'] || '',
      reason: args.reason || '',
    });
    console.log('Misroute logged.');
    process.exit(0);
  }

  if (args.check) {
    if (!args.suggested || !args.actual) {
      console.error('--check requires --suggested and --actual');
      process.exit(1);
    }
    const alert = checkMisrouteAlert(args.suggested, args.actual);
    if (alert) {
      console.log(alert);
    } else {
      console.log('✅ No repeated misroute pattern detected for this pair.');
    }
    process.exit(0);
  }

  if (args.fallback) {
    if (!args.model || !args.error) {
      console.error('--fallback requires --model and --error');
      process.exit(1);
    }
    const result = autoFallback({ model: args.model, error: args.error, message: args.message || '' });
    console.log(`Fallback: ${result.modelError.model} → ${result.fallbackModel || 'NONE (no further fallback)'}`);
    process.exit(0);
  }

  // Default: show stats
  const stats = getRecoveryStats();
  console.log(`Total misroutes logged: ${stats.total}`);
  console.log('Run --help for usage.');
}

module.exports = {
  detectMisroute,
  autoFallback,
  getRecoveryStats,
  checkMisrouteAlert,
  getFallbackModel,
  MODEL_FALLBACK_MAP,
  MISROUTE_THRESHOLD,
};
