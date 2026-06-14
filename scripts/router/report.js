/**
 * Routing Decision Dashboard — Phase 1
 *
 * Generate analytics report from decision log + feedback log.
 *
 * CLI Usage:
 *   node scripts/router/report.js              # last 7 days (default)
 *   node scripts/router/report.js --days 30    # last 30 days
 *
 * Output:
 *   📊 Routing Decision Report (last 7 days)
 *   Total decisions: 847
 *   Route distribution:
 *     DIRECT_ANSWER: 312 (36.8%)
 *     SPAWN:         198 (23.4%)
 *     ...
 *
 *   Feedback corrections: 23 (2.7%)
 *   Top corrections:
 *     FDQ → SPAWN: 8 times
 *     ...
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// ─────────────────────────────────────────────
// Arg parsing (no external deps)
// ─────────────────────────────────────────────

/**
 * @param {string[]} args
 * @returns {Object}
 */
function parseArgs(args) {
  const result = { days: 7 };
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
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// Core parsing
// ─────────────────────────────────────────────

/**
 * Parse JSON Lines file into array of objects.
 * @param {string} filePath
 * @returns {Object[]}
 */
function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    console.warn(`[Report] Failed to read ${filePath}: ${error.message}`);
    return [];
  }
}

/**
 * Filter entries to last N days.
 * @param {Object[]} entries
 * @param {number} days
 * @returns {Object[]}
 */
function filterByDays(entries, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return entries.filter(entry => {
    const ts = new Date(entry.ts).getTime();
    return !isNaN(ts) && ts >= cutoff;
  });
}

/**
 * Count route distribution.
 * @param {Object[]} entries
 * @returns {Map<string, number>}
 */
function countRoutes(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const route = entry.route || 'UNKNOWN';
    counts.set(route, (counts.get(route) || 0) + 1);
  }
  return counts;
}

/**
 * Group feedback corrections by (wrongRoute, correctRoute) pair.
 * @param {Object[]} feedbackEntries
 * @returns {Map<string, number>}
 */
function countCorrections(feedbackEntries) {
  const counts = new Map();
  for (const entry of feedbackEntries) {
    const key = `${entry.wrongRoute} → ${entry.correctRoute}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// ─────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────

/**
 * Format a route distribution map for display.
 * @param {Map<string, number>} routeCounts
 * @param {number} total
 * @returns {string[]}
 */
function formatRouteDistribution(routeCounts, total) {
  const lines = [];
  if (routeCounts.size === 0) {
    lines.push('  (no data)');
    return lines;
  }

  // Sort by count descending
  const sorted = [...routeCounts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [route, count] of sorted) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    const bar = '█'.repeat(Math.round(parseFloat(pct) / 5)).padEnd(20);
    lines.push(`  ${route.padEnd(16)} ${count.toString().padStart(5)} (${pct}%) ${bar}`);
  }

  return lines;
}

/**
 * Format feedback corrections summary.
 * @param {Map<string, number>} correctionCounts
 * @param {number} totalCorrections
 * @param {number} totalDecisions
 * @returns {string[]}
 */
function formatCorrections(correctionCounts, totalCorrections, totalDecisions) {
  const lines = [];

  if (correctionCounts.size === 0) {
    lines.push('  (no corrections)');
    return lines;
  }

  const pct = totalDecisions > 0 ? ((totalCorrections / totalDecisions) * 100).toFixed(1) : '0.0';
  lines.push(`  Total corrections: ${totalCorrections} (${pct}% of decisions)`);
  lines.push('');
  lines.push('  Top corrections:');

  // Sort by count descending
  const sorted = [...correctionCounts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 10); // Top 10

  for (const [pair, count] of top) {
    lines.push(`    ${pair}: ${count} times`);
  }

  return lines;
}

// ─────────────────────────────────────────────
// Main report generation
// ─────────────────────────────────────────────

/**
 * Generate and print the dashboard report.
 * @param {{ days: number }} options
 */
function generateReport(options = { days: 7 }) {
  const days = options.days || 7;

  // Read logs
  const allDecisions = readJsonLines(config.decisionLogPath);
  const allFeedback = readJsonLines(config.feedbackLogPath);

  // Filter to time window
  const decisions = filterByDays(allDecisions, days);
  const feedback = filterByDays(allFeedback, days);

  // Counts
  const totalDecisions = decisions.length;
  const totalFeedback = feedback.length;
  const routeCounts = countRoutes(decisions);
  const correctionCounts = countCorrections(feedback);

  // Build output
  const lines = [];

  // Header
  lines.push(`📊 Routing Decision Report (last ${days} days)`);
  lines.push('━'.repeat(50));
  lines.push(`Total decisions: ${totalDecisions}`);
  lines.push('');

  // Route distribution
  lines.push('Route distribution:');
  lines.push(...formatRouteDistribution(routeCounts, totalDecisions));
  lines.push('');

  // Feedback summary
  lines.push('Feedback corrections:');
  lines.push(...formatCorrections(correctionCounts, totalFeedback, totalDecisions));
  lines.push('');
  lines.push('━'.repeat(50));
  lines.push(`Generated at: ${new Date().toISOString()}`);

  // Print
  console.log(lines.join('\n'));

  return {
    totalDecisions,
    totalFeedback,
    routeCounts: Object.fromEntries(routeCounts),
    correctionCounts: Object.fromEntries(correctionCounts),
  };
}

// ─────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  generateReport(args);
}

module.exports = {
  generateReport,
  readJsonLines,
  filterByDays,
  countRoutes,
  countCorrections,
  parseArgs,
};
