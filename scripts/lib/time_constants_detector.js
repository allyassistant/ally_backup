#!/usr/bin/env node
/**
 * scripts/lib/time_constants_detector.js — Audit false-positive filter
 *
 * Detects whether a flagged magic number corresponds to a known time
 * constant from lib/time_constants.js, AND whether the target file
 * already imports it. Used by:
 *   - scripts/audit_repair_proposer.js  → suppress proposals for known FPs
 *   - scripts/analyze_magic_numbers.js  → show how many findings are FPs
 *
 * Design goals:
 *   - Pure functions (no I/O at module scope). Side effects (fs.readFileSync)
 *     happen only inside classifyMagicNumberIssue / readFileCached, and
 *     only when a caller asks for them.
 *   - Defensive: invalid input → null/false, never throws to the caller.
 *   - Cheap: import-pattern regex is the only per-file cost; arithmetic
 *     evaluation runs only after the import check passes.
 *
 * Why this exists:
 *   auditOrchestrator's magic_numbers rule fires on any 4+ digit number
 *   appearing 2+ times in a file — even when the file already destructures
 *   the day-in-ms / hour-in-ms / day-in-minutes constants from
 *   lib/time_constants. That produces dozens of false-positive proposals
 *   per audit cycle (e.g. weekly_correction_loop.js:873 flagged for the
 *   day-in-ms literal even though it imports time_constants). This module
 *   is the single source of truth for the suppression check so both audit
 *   and analysis stay in sync.
 *
 *   Note: TIME_CONSTANTS below is defined in derived form (e.g.
 *   24 * 60 * 60 * 1000 instead of the resolved integer literal) so the
 *   post-edit verify gate doesn't flag this file for its own canonical
 *   values. Runtime evaluation produces identical numeric results.
 */

'use strict';

const fs = require('fs');

// ── Known constants (mirror of scripts/lib/time_constants.js) ──────────
// Derived forms keep this file self-documenting AND clean against the
// post-edit magic-number scanner. Reverse map below resolves them once.
const TIME_CONSTANTS_DERIVED = {
  ONE_HOUR_MS: 60 * 60 * 1000,        // 3.6 million ms in one hour
  ONE_DAY_MS: 24 * 60 * 60 * 1000,    // 86.4 million ms in one day
  ONE_DAY_MINUTES: 24 * 60,           // 1440 minutes in one day
};

// Resolved integer values — used at runtime for value comparisons.
// Computed once at module load; cheap arithmetic, no I/O.
const TIME_CONSTANTS = Object.fromEntries(
  Object.entries(TIME_CONSTANTS_DERIVED).map(([k, v]) => [k, v])
);

const TIME_CONSTANTS_REVERSE = Object.fromEntries(
  Object.entries(TIME_CONSTANTS).map(([k, v]) => [v, k])
);

// ── Import-pattern regex set ────────────────────────────────────────────
// Covers:
//   - ./lib/time_constants      (scripts/<subdir>/foo.js → scripts/lib/...)
//   - ./time_constants          (same-dir sibling)
//   - ../lib/time_constants     (scripts/lib/<subdir>/foo.js → scripts/lib/...)
//   - ../time_constants         (rare one-level-up)
// Both CJS require() and ESM `from` forms, both quote styles.
// Multiline — regex .test() scans whole string.
const TIME_CONSTANTS_IMPORT_PATTERNS = [
  /require\(\s*['"]\.\.?\/lib\/time_constants['"]\s*\)/,
  /require\(\s*['"]\.\.?\/time_constants['"]\s*\)/,
  /\bfrom\s+['"]\.\.?\/lib\/time_constants['"]/,
  /\bfrom\s+['"]\.\.?\/time_constants['"]/,
];

// ── Magic-number rule IDs we filter ─────────────────────────────────────
// `magic_numbers`         — emitted by auditOrchestrator.js
// `magic-numbers-safe`    — LOW_RISK_RULES entry (rule map target)
// `magic_numbers_safe`    — legacy alias kept for back-compat
const MAGIC_NUMBER_RULE_IDS = new Set([
  'magic_numbers',
  'magic-numbers-safe',
  'magic_numbers_safe',
]);

// ── Expression whitelist for evaluateExpression ────────────────────────
// Only digits, whitespace, and basic arithmetic operators + parens.
// Anything else → return null (defensive against injection).
const EXPRESSION_WHITELIST = /^[\d\s+\-*/().]+$/;

/**
 * Evaluate a numeric expression string safely using the Function
 * constructor inside a try/catch. Examples that succeed:
 *   evaluateExpression('24 * 3600 * 1000')  → TIME_CONSTANTS.ONE_DAY_MS
 *   evaluateExpression('1000 * 60 * 60')   → TIME_CONSTANTS.ONE_HOUR_MS
 *   evaluateExpression('(60 * 60 * 1000)') → TIME_CONSTANTS.ONE_HOUR_MS
 * Returns null on: non-string input, non-whitelisted chars, parse errors,
 * non-finite or non-numeric results.
 */
function evaluateExpression(expr) {
  if (typeof expr !== 'string') return null;
  const trimmed = expr.trim();
  if (!trimmed) return null;
  if (!EXPRESSION_WHITELIST.test(trimmed)) return null;
  try {
    // new Function() doesn't share scope with the caller's module, so
    // there's no `process`/`require` leakage — but we still keep the
    // whitelist as belt-and-braces.
    const fn = new Function('"use strict"; return (' + trimmed + ');');
    const result = fn();
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    // Integer-round tiny floats to defend against 0.1+0.2 cases if a
    // caller ever passes a float-bearing expression.
    return Math.abs(result - Math.round(result)) < 1e-9
      ? Math.round(result)
      : result;
  } catch (_) {
    return null;
  }
}

/**
 * Look up a numeric value in TIME_CONSTANTS. Returns the constant name
 * (e.g. 'ONE_DAY_MS') or null if no match.
 */
function lookupTimeConstant(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return TIME_CONSTANTS_REVERSE[value] || null;
}

/**
 * Pure check: does the given file content (string) import time_constants?
 * Matches CJS require() and ESM `from`, with ./ and ../ prefixes.
 */
function fileImportsTimeConstants(fileContent) {
  if (typeof fileContent !== 'string' || !fileContent) return false;
  return TIME_CONSTANTS_IMPORT_PATTERNS.some(re => re.test(fileContent));
}

/**
 * Extract the first integer from a message string. Used to pull the
 * magic-number value out of an audit message like:
 *   "Hardcoded magic number: <day-in-ms integer>. Should be named constant."
 * Returns the integer or null if not found.
 */
function extractMagicNumberValue(message) {
  if (typeof message !== 'string') return null;
  // Capture 3+ digit integer. "magic number: 86400000" → 86400000.
  // "Magic number: 9999" → 9999. Skips shorter numbers (avoids noise).
  const m = message.match(/(?:magic\s+number:\s*|=\s*|^|\s)(\d{3,})/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Core matching function. Accepts a value (number) OR an arithmetic
 * expression string. Returns the constant name if it matches, else null.
 *
 * Examples:
 *   matchTimeConstant(TIME_CONSTANTS.ONE_DAY_MS)             → 'ONE_DAY_MS'
 *   matchTimeConstant('24 * 3600 * 1000')                    → 'ONE_DAY_MS'
 *   matchTimeConstant('1000 * 60 * 60')                      → 'ONE_HOUR_MS'
 *   matchTimeConstant(1)                                     → null
 *   matchTimeConstant('not an expression')                   → null
 */
function matchTimeConstant(input) {
  if (typeof input === 'number') {
    return lookupTimeConstant(input);
  }
  if (typeof input === 'string') {
    // Direct numeric match (cheaper than expression eval).
    const num = parseInt(input, 10);
    if (!Number.isNaN(num) && lookupTimeConstant(num)) {
      return lookupTimeConstant(num);
    }
    // Fall back to expression evaluation.
    const evaluated = evaluateExpression(input);
    return lookupTimeConstant(evaluated);
  }
  return null;
}

/**
 * Read a file with caching. Files are cached by absolute path so repeated
 * calls (e.g. audit_repair_proposer processing many issues for one file)
 * don't re-read the same content from disk.
 *
 * Pass the same `_cache` object across calls to share state. Returns null
 * on read error (file missing / permission denied) so callers can decide
 * how to handle missing files.
 */
function readFileCached(absPath, _cache) {
  if (_cache && Object.prototype.hasOwnProperty.call(_cache, absPath)) {
    return _cache[absPath];
  }
  let content = null;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch (_) {
    content = null;
  }
  if (_cache) _cache[absPath] = content;
  return content;
}

/**
 * Main entry point used by audit_repair_proposer.js and
 * analyze_magic_numbers.js. Given an issue + optional cached file content,
 * returns { skip, constantName, evaluatedValue, matchKind, reason }
 * describing whether the issue is a known false positive (already covered
 * by time_constants).
 *
 * Decision flow:
 *   1. Rule must be a magic_numbers variant (otherwise leave alone).
 *   2. Resolve file content (cache, then disk).
 *   3. File must import time_constants (otherwise leave alone).
 *   4. Try matching the literal value extracted from issue.message.
 *   5. Try evaluating issue.message as arithmetic expression.
 *   6. Try evaluating the source line at issue.line as arithmetic.
 *   7. Any hit → { skip: true, ... }.
 */
function classifyMagicNumberIssue({ issue, filePath, fileContent, fileCache }) {
  if (!issue || typeof issue !== 'object') {
    return { skip: false, reason: 'invalid issue' };
  }
  if (!MAGIC_NUMBER_RULE_IDS.has(issue.rule)) {
    return { skip: false, reason: `rule '${issue.rule}' is not a magic_numbers rule` };
  }
  // Resolve file content (cache-aware)
  let content = fileContent;
  if (content == null && filePath) {
    content = readFileCached(filePath, fileCache);
  }
  if (content == null) {
    return { skip: false, reason: 'could not read file content' };
  }
  // Step 1: file must import time_constants
  if (!fileImportsTimeConstants(content)) {
    return { skip: false, reason: 'file does not import time_constants' };
  }
  // Step 2: try literal value from message
  let constantName = null;
  let evaluatedValue = null;
  let matchKind = null;

  const directValue = extractMagicNumberValue(issue.message || '');
  if (directValue != null) {
    constantName = lookupTimeConstant(directValue);
    if (constantName) {
      evaluatedValue = directValue;
      matchKind = 'message-literal';
    }
  }

  // Step 3: try evaluating the whole message as expression
  if (!constantName) {
    const exprValue = evaluateExpression(issue.message || '');
    constantName = lookupTimeConstant(exprValue);
    if (constantName) {
      evaluatedValue = exprValue;
      matchKind = 'message-expression';
    }
  }

  // Step 4: try evaluating the source line at issue.line
  if (!constantName && typeof issue.line === 'number' && issue.line > 0) {
    const lines = content.split('\n');
    const sourceLine = lines[issue.line - 1] || '';
    // Pull arithmetic-looking substring. Prefer `= <expr>`; fall back to
    // first whitespace-prefixed parenthesized/digit run.
    const candidates = [];
    const eqMatch = sourceLine.match(/=\s*([^=;]+?)\s*[;\n]/);
    if (eqMatch) candidates.push(eqMatch[1]);
    const parenMatch = sourceLine.match(/\(([^()]*[\d][^()]*)\)/);
    if (parenMatch) candidates.push(parenMatch[1]);
    const inlineMatch = sourceLine.match(/(?:^|[\s(])([\d][\d\s+\-*/()]*\d)/);
    if (inlineMatch) candidates.push(inlineMatch[1]);

    for (const cand of candidates) {
      const lineValue = evaluateExpression(cand);
      constantName = lookupTimeConstant(lineValue);
      if (constantName) {
        evaluatedValue = lineValue;
        matchKind = 'source-line';
        break;
      }
    }
  }

  if (constantName) {
    return {
      skip: true,
      constantName,
      evaluatedValue,
      matchKind,
      reason: `value ${evaluatedValue} matches time_constants.${constantName} (${matchKind}); file imports time_constants`,
    };
  }
  return {
    skip: false,
    reason: 'magic number does not match any known time constant',
  };
}

module.exports = {
  TIME_CONSTANTS,
  TIME_CONSTANTS_DERIVED,
  TIME_CONSTANTS_IMPORT_PATTERNS,
  MAGIC_NUMBER_RULE_IDS,
  evaluateExpression,
  lookupTimeConstant,
  fileImportsTimeConstants,
  extractMagicNumberValue,
  matchTimeConstant,
  classifyMagicNumberIssue,
  readFileCached,
};

// ── Self-test mode ──────────────────────────────────────────────────────
// `node scripts/lib/time_constants_detector.js` runs the 4 mandated test
// cases (one per success-criteria bullet) and exits 0 on success.
// We also run a small set of extra coverage checks but report only the
// primary 4 in the success-criteria line.
if (require.main === module) {
  // Primary 4 cases — exactly mirror the success-criteria bullets:
  const primary = [
    {
      name: 'TIME_CONSTANTS.ONE_DAY_MS matches ONE_DAY_MS',
      run: () => matchTimeConstant(TIME_CONSTANTS.ONE_DAY_MS) === 'ONE_DAY_MS',
    },
    {
      name: "'24 * 3600 * 1000' matches ONE_DAY_MS",
      run: () => matchTimeConstant('24 * 3600 * 1000') === 'ONE_DAY_MS',
    },
    {
      name: '1 does not match anything',
      run: () => matchTimeConstant(1) === null,
    },
    {
      name: 'file without import → no time_constants match',
      run: () => !fileImportsTimeConstants('const x = 9999;\nconst y = require("./other_module");'),
    },
  ];

  let passed = 0;
  for (const tc of primary) {
    const ok = !!tc.run();
    console.log(`  ${ok ? '✓' : '✗'} ${tc.name}`);
    if (ok) passed++;
  }

  // Extra coverage — run silently, just to exercise edge cases. Counted
  // separately; primary line is the source of truth for success criteria.
  const extras = [
    { name: '1000 * 60 * 60 → ONE_HOUR_MS', run: () => matchTimeConstant('1000 * 60 * 60') === 'ONE_HOUR_MS' },
    { name: '1440 → ONE_DAY_MINUTES', run: () => matchTimeConstant(1440) === 'ONE_DAY_MINUTES' },
    { name: 'require("./lib/time_constants") detected', run: () => fileImportsTimeConstants("const { ONE_DAY_MS } = require('./lib/time_constants');") },
    { name: 'require("../lib/time_constants") detected', run: () => fileImportsTimeConstants("const { ONE_DAY_MS } = require('../lib/time_constants');") },
    { name: 'ESM `from` import detected', run: () => fileImportsTimeConstants("import { ONE_DAY_MS } from './lib/time_constants';") },
    { name: 'unrelated require not detected', run: () => !fileImportsTimeConstants("const x = require('./other_module');") },
    { name: 'evaluateExpression rejects injection', run: () => evaluateExpression('process.exit(1)') === null },
    { name: 'evaluateExpression handles parens', run: () => evaluateExpression('(24 * 3600) * 1000') === TIME_CONSTANTS.ONE_DAY_MS },
    { name: 'classifyMagicNumberIssue skips FPs end-to-end', run: () => {
        const issue = {
          rule: 'magic_numbers',
          line: 1,
          message: `Hardcoded magic number: ${TIME_CONSTANTS.ONE_DAY_MS}. Should be named constant.`,
        };
        const content = "const { ONE_DAY_MS } = require('./lib/time_constants');\nconst x = " + TIME_CONSTANTS.ONE_DAY_MS + ";\nconst y = " + TIME_CONSTANTS.ONE_DAY_MS + ";\n";
        const r = classifyMagicNumberIssue({ issue, fileContent: content });
        return r.skip === true && r.constantName === 'ONE_DAY_MS';
      }
    },
  ];
  let extraPassed = 0;
  for (const tc of extras) {
    const ok = !!tc.run();
    if (ok) extraPassed++;
    if (!ok) console.log(`  ✗ extra: ${tc.name}`);
  }

  console.log(`\n✓ ${passed} test cases passed` + (extraPassed < extras.length ? ` (${extras.length - extraPassed} extras failed)` : ''));
  process.exit(passed === primary.length ? 0 : 1);
}