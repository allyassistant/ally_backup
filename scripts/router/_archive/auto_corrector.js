/**
 * Auto Corrector — Phase 2 (Feedback Loop Automation)
 *
 * Automatically detects when classifier suggestion differs from actual agent behavior.
 * Reads decision_log.jsonl, re-classifies to determine "actual" route,
 * compares with suggested route, logs divergences to misroute_log.
 *
 * How it determines "actual" route:
 *   - Re-run regexClassify on the message text (lightweight heuristic)
 *   - Compare suggested_route vs re-classified route
 *   - If different → log as misroute
 *
 * Usage:
 *   node scripts/router/auto_corrector.js              # last hour
 *   node scripts/router/auto_corrector.js --since 24  # last 24 hours
 *   node scripts/router/auto_corrector.js --watch      # continuous mode (60s interval)
 *   node scripts/router/auto_corrector.js --dry-run   # show divergences without logging
 */

const fs = require('fs');
const path = require('path');

// ── Load sibling modules ───────────────────────────────────────────────────────
const { regexClassify, RULES } = require('./classifier');
const { detectMisroute } = require('./failure_recovery');

// ── Config ────────────────────────────────────────────────────────────────────
const ROUTER_DIR = path.join(__dirname);
const DECISION_LOG = path.join(ROUTER_DIR, 'decision_log.jsonl');

/**
 * Parse CLI args (no external deps).
 * @param {string[]} args
 * @returns {Object}
 */
function parseArgs(args) {
  const result = { sinceHours: 1, watch: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        if (key === 'since') {
          result.sinceHours = parseInt(next, 10) || 1;
          i++;
        } else {
          result[key] = next;
        }
      } else {
        if (key === 'watch') result.watch = true;
        if (key === 'dry-run') result.dryRun = true;
      }
    }
  }
  return result;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Determine the "actual" route from a text snippet.
 * Uses regexClassify as a lightweight heuristic — if the same text
 * would be classified differently now, that's a divergence signal.
 *
 * @param {string} text
 * @returns {string|null}
 */
function inferActualRoute(text) {
  if (!text || typeof text !== 'string') return null;
  const result = regexClassify(text);
  return result.route;
}

/**
 * Read decision_log.jsonl entries within the time window.
 *
 * @param {number} sinceHours - look back in hours
 * @returns {Object[]}
 */
function readRecentDecisions(sinceHours) {
  if (!fs.existsSync(DECISION_LOG)) {
    console.warn(`[AutoCorrector] Decision log not found: ${DECISION_LOG}`);
    return [];
  }

  const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;

  try {
    const content = fs.readFileSync(DECISION_LOG, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    return lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(entry => {
        if (!entry || !entry.ts) return false;
        const ts = new Date(entry.ts).getTime();
        return !isNaN(ts) && ts >= cutoff;
      })
      .filter(entry => entry.rule !== 'llm_fallback') // only suggested routes
      .reverse(); // newest first
  } catch (err) {
    console.error(`[AutoCorrector] Failed to read decision log: ${err.message}`);
    return [];
  }
}

/**
 * Detect misroutes from recent decisions.
 *
 * @param {Object} options
 * @param {number} [options.sinceHours=1]
 * @param {boolean} [options.dryRun=false] - if true, don't log to misroute_log
 * @returns {Object} summary
 */
function detectMisroutes(options = {}) {
  const sinceHours = options.sinceHours || 1;
  const dryRun = options.dryRun || false;

  const entries = readRecentDecisions(sinceHours);

  if (entries.length === 0) {
    console.log(`[AutoCorrector] No decision entries in last ${sinceHours}h.`);
    return { total: 0, divergences: [], summary: 'No entries found' };
  }

  console.log(`[AutoCorrector] Analyzing ${entries.length} decisions from last ${sinceHours}h...`);

  /** @type {Object[]} */
  const divergences = [];

  for (const entry of entries) {
    const { route: suggestedRoute, textPreview, ts, messageId } = entry;

    // Re-classify the text preview to see what we'd say now
    const actualRoute = inferActualRoute(textPreview);

    if (!actualRoute) continue;

    if (actualRoute !== suggestedRoute) {
      const div = {
        ts,
        messageId: messageId || '',
        suggestedRoute,
        actualRoute,
        textPreview: textPreview.substring(0, 80),
        rule: entry.rule,
      };
      divergences.push(div);

      if (!dryRun) {
        // Log to failure_recovery misroute log
        try {
          detectMisroute({
            suggestedRoute,
            actualRoute,
            messageId: messageId || ts,
            reason: `auto_corrector: text="${textPreview.substring(0, 60)}"`,
          });
        } catch (err) {
          console.error(`[AutoCorrector] detectMisroute error: ${err.message}`);
        }
      }
    }
  }

  // Print summary
  console.log('\n');
  console.log('🔍 Auto-Corrector Results');
  console.log('━'.repeat(56));
  console.log(`Analyzed: ${entries.length} decisions`);
  console.log(`Divergences found: ${divergences.length}`);
  console.log('');

  if (divergences.length > 0) {
    console.log('Divergences (suggested → actual):');
    for (const div of divergences) {
      console.log(`  [${div.ts}] ${div.suggestedRoute} → ${div.actualRoute}`);
      console.log(`    Text: "${div.textPreview}"`);
      if (div.messageId) console.log(`    ID: ${div.messageId}`);
    }
  } else {
    console.log('✅ All decisions are consistent — no divergences detected.');
  }

  return {
    total: entries.length,
    divergences,
    divergenceRate: entries.length > 0 ? (divergences.length / entries.length).toFixed(2) : 0,
  };
}

// ── Watch mode ────────────────────────────────────────────────────────────────

let watchIntervalId = null;

/**
 * Run in watch mode — check every N seconds.
 * @param {number} sinceHours
 * @param {number} intervalSec
 */
function watch(sinceHours = 1, intervalSec = 60) {
  console.log(`[AutoCorrector] Watch mode — checking every ${intervalSec}s (last ${sinceHours}h)`);
  console.log('Press Ctrl+C to stop.\n');

  // Run immediately
  detectMisroutes({ sinceHours });

  watchIntervalId = setInterval(() => {
    detectMisroutes({ sinceHours });
  }, intervalSec * 1000);
}

function stopWatch() {
  if (watchIntervalId) {
    clearInterval(watchIntervalId);
    watchIntervalId = null;
    console.log('[AutoCorrector] Watch stopped.');
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    stopWatch();
    process.exit(0);
  });

  if (args.watch) {
    watch(args.sinceHours);
  } else {
    const result = detectMisroutes({
      sinceHours: args.sinceHours,
      dryRun: args.dryRun,
    });
    process.exit(0);
  }
}

module.exports = {
  detectMisroutes,
  inferActualRoute,
  readRecentDecisions,
  watch,
};
