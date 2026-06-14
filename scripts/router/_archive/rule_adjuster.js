/**
 * Rule Adjuster — Phase 3 (Dynamic Rule Adjustment)
 *
 * Analyzes feedback patterns from feedback_log.jsonl and generates
 * actionable classifier rule update suggestions.
 *
 * Usage:
 *   node scripts/router/rule_adjuster.js              # show suggestions
 *   node scripts/router/rule_adjuster.js --days 30    # last 30 days
 *   node scripts/router/rule_adjuster.js --apply     # output code diff (review first)
 *   node scripts/router/rule_adjuster.js --cron      # cron mode: log to file
 *
 * Output format:
 *   📋 Rule Adjustment Suggestions (last 7 days)
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   Pair "FDQ → SPAWN" appeared 8 times
 *     Common keywords: ["分析", "research"]
 *     → Consider adding to SPAWN rule
 */

const fs = require('fs');
const path = require('path');

// ── Load sibling modules ───────────────────────────────────────────────────────
const { RULES } = require('./classifier');

// ── Config ────────────────────────────────────────────────────────────────────
const ROUTER_DIR = path.join(__dirname);
const FEEDBACK_LOG = path.join(ROUTER_DIR, 'feedback_log.jsonl');

// ── CLI argument parser (no external deps) ───────────────────────────────────

/**
 * @param {string[]} args
 * @returns {Object}
 */
function parseArgs(args) {
  const result = { days: 7, apply: false, cron: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        if (key === 'days') {
          result.days = parseInt(next, 10) || 7;
          i++;
        } else {
          result[key] = next;
        }
      } else {
        if (key === 'apply') result.apply = true;
        if (key === 'cron') result.cron = true;
        if (key === 'days') result.days = 7;
      }
    }
  }
  return result;
}

// ── Feedback reading ──────────────────────────────────────────────────────────

/**
 * Read feedback entries from feedback_log.jsonl within the time window.
 * @param {number} days
 * @returns {Object[]}
 */
function readFeedback(days) {
  if (!fs.existsSync(FEEDBACK_LOG)) {
    return [];
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const content = fs.readFileSync(FEEDBACK_LOG, 'utf8');
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
      });
  } catch (err) {
    console.error(`[RuleAdjuster] Failed to read feedback log: ${err.message}`);
    return [];
  }
}

// ── Keyword extraction ────────────────────────────────────────────────────────

/**
 * Extract common keywords from a set of message IDs or reason strings.
 * Deduplicates by messageId first.
 *
 * @param {Object[]} entries - feedback entries to analyze
 * @returns {string[]} common keyword tokens
 */
function extractKeywords(entries) {
  // Deduplicate by messageId
  /** @type {Map<string, Object>} */
  const unique = new Map();
  for (const e of entries) {
    if (e.messageId) unique.set(e.messageId, e);
  }
  const deduped = Array.from(unique.values());

  // Extract word tokens from reason strings
  /** @type {Map<string, number>} */
  const tokenCount = new Map();

  for (const entry of deduped) {
    const reason = entry.reason || '';
    // Split on Chinese chars, English words, punctuation
    const tokens = reason.split(/[\s,，。、!?！？]+/).filter(t => t.length > 1);
    for (const token of tokens) {
      tokenCount.set(token, (tokenCount.get(token) || 0) + 1);
    }
  }

  // Return tokens that appear >= 2 times
  return Array.from(tokenCount.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, 10);
}

// ── Suggestion generator ──────────────────────────────────────────────────────

/**
 * Analyze feedback and generate rule update suggestions.
 *
 * @param {Object} options
 * @param {number} [options.days=7]
 * @param {boolean} [options.apply=false] - if true, output code diff
 * @returns {Object[]} suggestions
 */
function analyze(options = {}) {
  const days = options.days || 7;
  const apply = options.apply || false;

  const entries = readFeedback(days);

  if (entries.length === 0) {
    console.log(`[RuleAdjuster] No feedback entries in last ${days} days.`);
    return { suggestions: [] };
  }

  // ── Group by (wrongRoute → correctRoute) ──────────────────────────────────
  /** @type {Map<string, Object[]>} */
  const pairMap = new Map();

  for (const entry of entries) {
    const key = `${entry.wrongRoute} → ${entry.correctRoute}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key).push(entry);
  }

  // ── Generate suggestions for pairs with count >= 2 ────────────────────────
  const suggestions = [];

  for (const [pair, pairEntries] of pairMap) {
    const [wrongRoute, correctRoute] = pair.split(' → ');
    const count = pairEntries.length;

    if (count < 2) continue;

    // Check what rules currently exist for correctRoute
    const existingRule = RULES.find(r => r.route === correctRoute);
    const existingPatterns = existingRule
      ? existingRule.pattern.source
      : '(none)';

    // Extract common keywords from this pair
    const keywords = extractKeywords(pairEntries);

    /** @type {Object} */
    const suggestion = {
      pair,
      wrongRoute,
      correctRoute,
      count,
      keywords,
      existingRuleId: existingRule?.ruleId || 'none',
      existingPatterns,
      action: null,
      priority: count >= 5 ? 'high' : 'medium',
    };

    // ── Determine action ─────────────────────────────────────────────────────

    if (keywords.length === 0) {
      // No new keywords found → rules are probably correct, just execution issue
      suggestion.action = 'no_change';
      suggestion.note =
        'No new keywords found (' + count + 'x). Rules likely correct — investigate execution.';
    } else {
      // Check if any keyword is already in existing pattern
      const alreadyCovered = keywords.some(k => {
        try {
          return new RegExp(k, 'i').test(existingPatterns);
        } catch {
          return false;
        }
      });

      if (alreadyCovered) {
        suggestion.action = 'investigate';
        suggestion.note =
          'Keywords already covered by existing pattern but still misrouting. Check if rule threshold is right or regex is too strict.';
      } else {
        suggestion.action = 'add_pattern';
        suggestion.note =
          `Keywords not in existing pattern — consider adding: ${keywords.join(', ')}`;
      }
    }

    suggestions.push(suggestion);
  }

  // Sort by count descending
  suggestions.sort((a, b) => b.count - a.count);

  return suggestions;
}

// ── Output formatters ─────────────────────────────────────────────────────────

/**
 * Print human-readable suggestions to console.
 * @param {Object[]} suggestions
 * @param {number} days
 */
function printSuggestions(suggestions, days) {
  console.log('');
  console.log('📋 Rule Adjustment Suggestions');
  console.log(`   (last ${days} days)`);
  console.log('━'.repeat(56));
  console.log('');

  if (suggestions.length === 0) {
    console.log('  ✅ No adjustment suggestions — classifier rules look good!');
    return { suggestions: [], raw: [] };
  }

  for (const s of suggestions) {
    const badge = s.priority === 'high' ? '🔴' : '🟡';
    console.log(`${badge} Pair "${s.pair}" appeared ${s.count} times`);

    if (s.keywords.length > 0) {
      console.log(`   Common keywords: [${s.keywords.join(', ')}]`);
    }

    if (s.action === 'no_change') {
      console.log(`   ✅ No rule change needed — ${s.note}`);
    } else if (s.action === 'investigate') {
      console.log(`   🔍 Investigate — ${s.note}`);
    } else if (s.action === 'add_pattern') {
      console.log(`   ➕ Suggestion: add keyword(s) to ${s.correctRoute} rule`);
      console.log(`      Existing pattern: ${s.existingPatterns}`);
      console.log(`      Suggested addition: ${s.keywords.join(' | ')}`);
    }

    console.log(`   Rule: ${s.existingRuleId}`);
    console.log('');
  }

  // Summary
  const highCount = suggestions.filter(s => s.priority === 'high').length;
  const addPatternCount = suggestions.filter(s => s.action === 'add_pattern').length;
  console.log('━'.repeat(56));
  console.log(`Summary: ${suggestions.length} pairs analyzed`);
  console.log(`  🔴 High priority: ${highCount}`);
  console.log(`  ➕ Pattern changes suggested: ${addPatternCount}`);
}

/**
 * Print code-diff output for --apply mode.
 * Shows the suggested changes to classifier.js.
 * @param {Object[]} suggestions
 */
function printCodeDiff(suggestions) {
  const addPatternSugs = suggestions.filter(s => s.action === 'add_pattern');

  console.log('');
  console.log('📝 Suggested Code Changes to classifier.js');
  console.log('━'.repeat(56));

  if (addPatternSugs.length === 0) {
    console.log('  No code changes needed — only investigate/investigate suggestions.');
    return;
  }

  for (const s of addPatternSugs) {
    console.log('');
    console.log(`// ── ${s.pair} (${s.count}x) ──────────────────────────`);
    console.log('// In RULES array, update the pattern for:');
    console.log(`//   route: "${s.correctRoute}", ruleId: "${s.existingRuleId}"`);
    console.log('// Current pattern might need these keywords added:');
    console.log(`//   New pattern part: ${s.keywords.join(' | ')}`);
    console.log('');
    console.log('// Example edit (add to existing pattern):');
    console.log(`//   pattern: /(?:existing words)|(?:${s.keywords.join('|')})/i,`);
    console.log('');
  }

  console.log('// ───────────────────────────────────────────────────');
  console.log('// NOTE: Review all changes above before applying.');
  console.log('// Manual review is required — this only shows suggestions.');
  console.log('');
}

// ── Cron mode ────────────────────────────────────────────────────────────────

/**
 * Run in cron mode — log suggestions to a file.
 * @param {number} days
 */
function runCron(days) {
  const suggestions = analyze({ days, apply: false });
  const outPath = path.join(ROUTER_DIR, 'rule_adjuster_suggestions.json');

  const report = {
    ts: new Date().toISOString(),
    days,
    totalSuggestions: suggestions.length,
    highPriority: suggestions.filter(s => s.priority === 'high').length,
    suggestions,
  };

  try {
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[RuleAdjuster] Logged to ${outPath}`);
  } catch (err) {
    console.error(`[RuleAdjuster] Failed to write: ${err.message}`);
  }

  // Also print to stdout so cron output goes to log
  printSuggestions(suggestions, days);
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const days = args.days || 7;

  if (args.cron) {
    runCron(days);
    process.exit(0);
  }

  const suggestions = analyze({ days, apply: args.apply });

  if (args.apply) {
    printCodeDiff(suggestions);
  } else {
    printSuggestions(suggestions, days);
  }

  process.exit(0);
}

module.exports = {
  analyze,
  extractKeywords,
  readFeedback,
  printSuggestions,
  printCodeDiff,
};
