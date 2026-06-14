/**
 * Feedback Collector — Phase 1
 *
 * 記錄 routing decision correction 以便後續改善。
 * Phase 1: 加 batch summary + auto-fix suggestion。
 *
 * CLI Usage:
 *   # Log single correction
 *   node scripts/router/feedback_collector.js \
 *     --wrong FDQ \
 *     --correct SPAWN \
 *     --message-id "msg-123" \
 *     --reason "應該 spawn 分析，唔係問清楚"
 *
 *   # Batch summary (last 7 days)
 *   node scripts/router/feedback_collector.js --summary
 *   node scripts/router/feedback_collector.js --summary --days 30
 *
 *   # Auto-fix: generate regex patterns from corrections
 *   node scripts/router/feedback_collector.js --auto-fix
 */

const fs = require('fs');
const { feedbackLogPath } = require('./config');

/**
 * Collect and log a routing feedback entry.
 * @param {Object} opts
 * @param {string} opts.wrongRoute    - The incorrect route that was chosen
 * @param {string} opts.correctRoute  - The correct route that should have been chosen
 * @param {string} opts.messageId     - Message identifier this feedback relates to
 * @param {string} opts.reason        - Human-readable reason for the correction
 * @returns {Object} The logged feedback entry
 */
function collectFeedback({ wrongRoute, correctRoute, messageId, reason }) {
  const entry = {
    ts: new Date().toISOString(),
    wrongRoute,
    correctRoute,
    messageId,
    reason
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    fs.appendFileSync(feedbackLogPath, line, 'utf8');
    console.log(`[FeedbackCollector] ✓ Logged correction: ${wrongRoute} → ${correctRoute} (${messageId})`);
  } catch (err) {
    console.error(`[FeedbackCollector] ✗ Failed to write feedback: ${err.message}`);
    throw err;
  }

  return entry;
}

/**
 * Read all feedback entries from the log file.
 * @param {number} [days] - Filter to last N days (optional)
 * @returns {Object[]}
 */
function readFeedbackEntries(days) {
  if (!fs.existsSync(feedbackLogPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(feedbackLogPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const entries = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (!days) return entries;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return entries.filter(entry => {
      const ts = new Date(entry.ts).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
  } catch (error) {
    console.warn(`[FeedbackCollector] Failed to read feedback log: ${error.message}`);
    return [];
  }
}

/**
 * Summarize feedback corrections — group by (wrongRoute, correctRoute) pair.
 *
 * @param {Object} options
 * @param {number} [options.days=7] - Look back period
 * @param {boolean} [options.autoFix=false] - Generate regex suggestions
 * @returns {Object} Summary with correction counts and optional auto-fix suggestions
 */
function summarizeFeedback(options = {}) {
  const days = options.days || 7;
  const autoFix = options.autoFix || false;

  const entries = readFeedbackEntries(days);

  if (entries.length === 0) {
    console.log(`[FeedbackCollector] No feedback entries in last ${days} days.`);
    return { entries: [], corrections: {}, autoFixSuggestions: [] };
  }

  // Group by (wrongRoute → correctRoute)
  const corrections = {};
  for (const entry of entries) {
    const key = `${entry.wrongRoute} → ${entry.correctRoute}`;
    if (!corrections[key]) {
      corrections[key] = { count: 0, reason: entry.reason, examples: [] };
    }
    corrections[key].count++;
    if (entry.reason && corrections[key].reason !== entry.reason) {
      corrections[key].reason = entry.reason;
    }
    if (entry.messageId && corrections[key].examples.length < 3) {
      corrections[key].examples.push(entry.messageId);
    }
  }

  // Sort by count descending
  const sorted = Object.entries(corrections).sort((a, b) => b[1].count - a[1].count);

  console.log(`\n📋 Feedback Summary (last ${days} days)`);
  console.log('━'.repeat(50));
  console.log(`Total corrections: ${entries.length}`);
  console.log('');
  console.log('Corrections by type:');

  for (const [pair, data] of sorted) {
    console.log(`  ${pair}: ${data.count}x`);
    if (data.reason) {
      console.log(`    Reason: ${data.reason}`);
    }
  }

  // Auto-fix suggestions
  const autoFixSuggestions = [];
  if (autoFix) {
    console.log('');
    console.log('🔧 Auto-fix Suggestions:');
    console.log('');
    console.log('// Add these patterns to classifier.js RULES array:');
    console.log('');

    for (const [pair, data] of sorted) {
      const [wrongRoute] = pair.split(' → ');
      console.log(`  // Pattern for: ${pair} (${data.count}x)`);
      console.log(`  // TODO: Add regex pattern that matches "${wrongRoute}" cases`);
      console.log(`  // Suggested route: ${wrongRoute}`);
      console.log('');
      autoFixSuggestions.push({ pair, count: data.count, suggestedRoute: wrongRoute });
    }

    console.log('// ─────────────────────────────────────────');
    console.log('// NOTE: These are suggestions only. Review before adding to rules.');
    console.log('// Pattern format: { route: "XXX", pattern: /regex/, ruleId: "feedback: 1" }');
  }

  return {
    entries,
    corrections,
    sortedCorrections: sorted,
    autoFixSuggestions,
    totalCorrections: entries.length,
  };
}

/**
 * Parse simple key=value / --key value CLI arguments (no external deps).
 * @param {string[]} args - process.argv.slice(2)
 * @returns {Object}
 */
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        if (key === 'days') {
          result.days = parseInt(next, 10);
          if (isNaN(result.days) || result.days < 1) {
            result.days = 7;
          }
        } else {
          result[key] = next;
        }
        i++;
      } else {
        result[key] = true;
      }
    } else if (arg.includes('=')) {
      const [k, v] = arg.split('=');
      result[k.replace(/^--/, '')] = v;
    }
  }
  return result;
}

// CLI mode
if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  // --summary mode: show batch summary
  if (args.summary) {
    const days = parseInt(args.days, 10) || 7;
    const autoFix = !!args['auto-fix'];
    summarizeFeedback({ days, autoFix });
    return;
  }

  // --auto-fix without --summary
  if (args['auto-fix'] && !args.summary) {
    const days = parseInt(args.days, 10) || 7;
    summarizeFeedback({ days, autoFix: true });
    return;
  }

  // Default: log single correction
  if (!args.wrong || !args.correct) {
    console.error('Usage:');
    console.error('  # Log single correction');
    console.error('  node scripts/router/feedback_collector.js --wrong <route> --correct <route> [--message-id <id>] [--reason <text>]');
    console.error('');
    console.error('  # Batch summary');
    console.error('  node scripts/router/feedback_collector.js --summary [--days 30]');
    console.error('');
    console.error('  # Auto-fix suggestions');
    console.error('  node scripts/router/feedback_collector.js --auto-fix [--days 30]');
    process.exit(1);
  }

  try {
    collectFeedback({
      wrongRoute: args.wrong,
      correctRoute: args.correct,
      messageId: args['message-id'] || '',
      reason: args.reason || ''
    });
  } catch (err) {
    process.exit(1);
  }
}

module.exports = {
  collectFeedback,
  summarizeFeedback,
  readFeedbackEntries,
  parseArgs,
};
