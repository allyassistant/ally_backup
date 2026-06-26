/**
 * scripts/lib/rules/validation.js
 *
 * Pre/post validation helpers for low-risk.js auto-fix rules.
 *
 * Goal: prevent auto-fix rules from silently corrupting working code.
 * The current pipeline only runs `node --check` AFTER all rules have run,
 * so a single bad rule poisons the entire file's output. This module
 * provides per-rule validation so bad rules can be skipped before the
 * damage accumulates.
 *
 * Phase 1 (2026-06-26): syntax check + node --check
 * Phase 3 (planned): semantic equivalence via AST
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { parseAst, clearAstCache, collectIdentifiers, countNodes } = require('./ast-helpers');

const VALIDATION_LOG = path.join(
  process.env.HOME || '/Users/ally',
  '.openclaw/workspace/.state/auto_fix_validation.log'
);

/**
 * Append a validation event to the log file.
 * Format: timestamp | rule_id | file | status | details
 */
function logValidation(event) {
  const line = [
    new Date().toISOString(),
    event.ruleId || 'unknown',
    event.filePath || 'unknown',
    event.status,
    event.details || '',
  ].join(' | ') + '\n';

  try {
    fs.mkdirSync(path.dirname(VALIDATION_LOG), { recursive: true, mode: 0o700 });
    fs.appendFileSync(VALIDATION_LOG, line, 'utf8');
  } catch {
    // Logging failures must never block the fix pipeline
  }
}

/**
 * Validate that `newContent` is still syntactically valid JavaScript.
 *
 * Uses `node --check` against a tmp file. Returns true if the content parses
 * cleanly, false if it has a syntax error. Never throws — syntax errors are
 * captured as a validation failure.
 *
 * @param {string} newContent - The proposed post-fix file content
 * @param {string} filePath - Original file path (used for extension detection)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSyntax(newContent, filePath) {
  const ext = path.extname(filePath);
  // Only validate JS-family extensions
  if (!['.js', '.mjs', '.cjs'].includes(ext)) {
    return { valid: true }; // skip non-JS files
  }

  // Node v26 quirk: `node --check <tmpfile>` hits an ESM loader bug when the
  // file isn't recognized by package.json type detection. Workaround: use
  // `-e` with the actual content piped via stdin (Node parses stdin as JS).
  // For .mjs files, we set --input-type=module. For .js / .cjs, default works.
  // We always force a CommonJS-like wrapper by checking with `-` (stdin).
  const isModule = ext === '.mjs';
  const args = ['--check', '-', '--input-type=' + (isModule ? 'module' : 'commonjs')];
  try {
    execFileSync('node', args, {
      input: newContent,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return { valid: true };
  } catch (e) {
    // Capture stderr for diagnostics, truncate to first line
    const stderr = (e.stderr || e.message || '').toString().split('\n')[0].slice(0, 200);
    return { valid: false, error: stderr };
  }
}

/**
 * Validate that `newContent` preserves identifier names from `oldContent`.
 *
 * This catches the `simplified-chinese` bug class where the rule renames
 * variables, function names, and object keys that happen to use simplified
 * Chinese characters.
 *
 * Heuristic: extract all identifier-like tokens from both contents and check
 * that no token from old is missing in new (excluding well-known globals).
 *
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ valid: boolean, lostIdentifiers?: string[] }}
 */
function validateIdentifiers(oldContent, newContent) {
  // Strip comments and strings before tokenization to avoid false positives
  // from identifier-shaped substrings inside prose.
  const stripNoise = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/\/\/[^\n]*/g, ' ')          // line comments
    .replace(/#.*$/gm, ' ')               // shell-style comments
    .replace(/'(?:\\.|[^'\\])*'/g, "''")  // single-quoted strings
    .replace(/"(?:\\.|[^"\\])*"/g, '""')  // double-quoted strings
    .replace(/`(?:\\.|[^`\\])*`/g, '``'); // template literals (non-interpolated portions)

  // After stripping noise, replace `.identifier` with `identifier` ONLY when it's
  // a member-access suffix (i.e., not at the start of a line / identifier).
  // This way, `obj.PI` → `obj PI` (PI becomes a free identifier), which is wrong,
  // so we take a different approach: strip `.identifier` suffixes entirely,
  // since property names are NOT free identifiers (they're not declared).
  // To do that, we replace `.identifier` with a marker that won't match IDENT_RE.
  const stripMemberAccess = (src) => src.replace(/\.[\p{L}_$][\p{L}\p{N}_$]*/gu, '');

  // Identifier regex: Unicode-aware so simplified Chinese chars in identifiers are captured
  // \p{L} matches any letter (Chinese, Latin, etc.); \p{N} is digits; \p{M} is combining marks.
  const IDENT_RE = /[\p{L}_$][\p{L}\p{N}_$]*/gu;

  const oldTokens = new Set(stripMemberAccess(stripNoise(oldContent)).match(IDENT_RE) || []);
  const newTokens = new Set(stripMemberAccess(stripNoise(newContent)).match(IDENT_RE) || []);

  // Well-known globals that can disappear from new content without it being a bug
  // (e.g. a code path no longer references them after refactoring).
  const SAFE_GLOBALS = new Set([
    'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
    'Date', 'Promise', 'Buffer', 'console', 'Symbol', 'Error',
    'Reflect', 'globalThis', 'Intl', 'BigInt', 'Atomics',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'process', 'require', 'module', 'exports', '__dirname', '__filename',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp',
    'undefined', 'null', 'true', 'false', 'NaN', 'Infinity',
  ]);

  const lost = [];
  for (const tok of oldTokens) {
    if (SAFE_GLOBALS.has(tok)) continue;
    // Skip very short tokens (1 char) — too prone to false positives
    if (tok.length < 2) continue;
    // Skip purely numeric tokens
    if (/^\d+$/.test(tok)) continue;
    if (!newTokens.has(tok)) {
      lost.push(tok);
    }
  }

  return {
    valid: lost.length === 0,
    lostIdentifiers: lost,
  };
}

/**
 * Main per-rule validator. Runs all checks and returns a single pass/fail.
 *
 * @param {object} params
 * @param {string} params.oldContent - Content before the rule ran
 * @param {string} params.newContent - Content after the rule ran
 * @param {string} params.filePath - File being fixed
 * @param {object} params.rule - The rule object {id, name, ...}
 * @returns {{ valid: boolean, checks: Array<{name, valid, details?}> }}
 */
/**
 * Check whether semantic validation is enabled.
 * Evaluated at call time (not module load time) so tests can toggle the env var.
 *
 * Env var SEMANTIC_VALIDATION:
 *   - Unset or 'true' → enabled (default)
 *   - 'false' → disabled
 *   - Comma-separated file paths → per-file override parser (future)
 */
function isSemanticEnabled() {
  const raw = process.env.SEMANTIC_VALIDATION;
  if (raw === undefined || raw === 'true' || raw === '') return true;
  if (raw === 'false') return false;
  // raw might be a comma-separated list of files to enable
  return true;
}

/**
 * Phase 3 (2026-06-26): AST-based semantic equivalence check.
 *
 * Compares identifier sets and node counts between old and new content.
 * This catches the `simplified-chinese` and `hardcoded-home-path` bug classes
 * that Phase 1 regex-based validation cannot detect.
 *
 * Returns null when the file can't be parsed (non-JS or syntax error).
 *
 * @param {string} oldContent
 * @param {string} newContent
 * @param {string} filePath
 * @returns {{ valid: boolean, details?: string } | null}
 */
function semanticEquivalenceCheck(oldContent, newContent, filePath) {
  const ext = path.extname(filePath);
  if (!['.js', '.mjs', '.cjs'].includes(ext)) {
    return null; // skip non-JS files
  }

  if (!isSemanticEnabled()) {
    return null; // skip when feature flag is off
  }

  // Clear cache between parses to avoid stale results
  clearAstCache();
  const oldResult = parseAst(oldContent, filePath);
  clearAstCache();
  const newResult = parseAst(newContent, filePath);
  if (!oldResult || !newResult || !oldResult.ast || !newResult.ast) {
    // If one side doesn't parse, the syntax check will catch it.
    // We can't do semantic comparison on unparseable code, so skip.
    return null;
  }

  const oldAst = oldResult.ast;
  const newAst = newResult.ast;

  // ---- Check 1: Identifier preservation ----
  const SAFE = new Set(['Math', 'JSON', 'Number', 'String', 'Boolean',
    'Array', 'Object', 'Date', 'Promise', 'Buffer', 'console',
    'Symbol', 'Error', 'Reflect', 'globalThis', 'Intl', 'BigInt',
    'Atomics', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'process', 'require', 'module', 'exports', '__dirname',
    '__filename', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp',
    'undefined', 'null', 'true', 'false', 'NaN', 'Infinity']);

  const oldIds = new Set(
    collectIdentifiers(oldAst)
      .map(id => id.name)  // extract name string from {name, node, line}
      .filter(name => !SAFE.has(name) && name.length >= 2)
  );

  const newIds = new Set(
    collectIdentifiers(newAst)
      .map(id => id.name)
      .filter(name => !SAFE.has(name) && name.length >= 2)
  );

  const lostIds = [];
  for (const id of oldIds) {
    if (!newIds.has(id)) {
      lostIds.push(id);
    }
  }

  // ---- Check 2: Node count structural integrity ----
  const oldCount = countNodes(oldAst);
  const newCount = countNodes(newAst);
  const threshold = Math.floor(oldCount * 0.9); // 90% minimum
  const nodeCountOk = newCount >= threshold;

  const isSemanticValid = lostIds.length === 0 && nodeCountOk;
  const details = [];
  if (lostIds.length > 0) {
    details.push(`lost ${lostIds.length} identifier(s): ${lostIds.slice(0, 5).join(', ')}${lostIds.length > 5 ? '...' : ''}`);
  }
  if (!nodeCountOk) {
    details.push(`node count dropped from ${oldCount} to ${newCount} (threshold ${threshold})`);
  }

  return {
    valid: isSemanticValid,
    details: details.length > 0 ? details.join('; ') : undefined,
  };
}

/**
 * Main per-rule validator. Runs all checks and returns a single pass/fail.
 */
function validateFix({ oldContent, newContent, filePath, rule }) {
  const checks = [];

  // Check 1: syntax (catches most rule bugs)
  const syntax = validateSyntax(newContent, filePath);
  checks.push({ name: 'syntax', valid: syntax.valid, details: syntax.error });
  if (!syntax.valid) {
    return { valid: false, checks };
  }

  // Check 2: identifier preservation (regex heuristic, Phase 1)
  const idents = validateIdentifiers(oldContent, newContent);
  checks.push({
    name: 'identifiers',
    valid: idents.valid,
    details: idents.lostIdentifiers?.length
      ? `lost ${idents.lostIdentifiers.length} identifier(s): ${idents.lostIdentifiers.slice(0, 5).join(', ')}${idents.lostIdentifiers.length > 5 ? '...' : ''}`
      : undefined,
  });

  // Check 3: semantic equivalence (AST-based, Phase 3)
  const semantic = semanticEquivalenceCheck(oldContent, newContent, filePath);
  if (semantic !== null) {
    checks.push({
      name: 'semantic',
      valid: semantic.valid,
      details: semantic.details,
    });
  }

  return {
    valid: checks.every(c => c.valid),
    checks,
  };
}

module.exports = {
  validateFix,
  validateSyntax,
  validateIdentifiers,
  logValidation,
  semanticEquivalenceCheck,
};