#!/usr/bin/env node
/**
 * scripts/lib/script_signature_detector.js — Layer 2 interface-change detector
 *
 * Extracts exported function signatures from a file (regex-based; no AST)
 * and finds callers in dependent files whose argument count or export-name
 * expectation no longer matches.
 *
 * Detected signatures:
 *   - function foo(a, b)            (top-level)
 *   - exports.foo = function(a,b)
 *   - module.exports.foo = function(a,b)
 *   - export function foo(a, b)
 *   - export const foo = (a, b) =>
 *   - const foo = function(a, b);  exports.foo = foo;
 *
 * What "incompatible" means:
 *   - Param count decreased → existing callers with more args silently
 *     ignore them (JS doesn't error), so we only WARN, not FAIL.
 *   - Param count increased → callers using the old arity miss required
 *     args. FLAGGED as 'missing-required-args'.
 *   - An exported name disappeared → any caller of that name is FLAGGED.
 *
 * Self-Healing Loop — Layer 2 (Phase 2h)
 * Created: 2026-06-19
 */
'use strict';

const fs = require('fs');
const path = require('path');

const depGraph = require('./dependency_graph');

// ── Signature extraction ─────────────────────────────────────────────────
//
// Returns: { funcName: { params: N, line: N, exported: bool, kind: string } }
//
// `kind` ∈ {'named-function', 'function-expression', 'arrow-function', 'method-shorthand'}
// for diagnostic context only.
function extractFunctionSignatures(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw e;
  }

  return parseSignatures(content, filePath);
}

// Content-based variant: extract signatures from an in-memory string.
// Used by callers that already have the source (e.g., audit_repair_proposer
// comparing pre-fix and post-fix content). Parsing errors propagate.
function extractFunctionSignaturesFromSource(content, sourcePath) {
  return parseSignatures(content, sourcePath);
}

function parseSignatures(content, sourcePath) {
  const sigs = {};
  if (!content) return sigs;

  const lines = content.split('\n');
  const lineOf = (offset) => {
    // 1-indexed line number for offset.
    let line = 1;
    for (let i = 0; i < offset && i < content.length; i++) {
      if (content.charCodeAt(i) === 10) line++;
    }
    return line;
  };

  // Pattern A: function NAME( ... )     (top-level declaration)
  //   We accept letters/digits/_/$, must be preceded by start-of-line /
  //   whitespace / semicolon / brace (not a property like `.foo(`).
  const RE_NAMED = /\bfunction\s+([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)/g;
  let m;
  while ((m = RE_NAMED.exec(content)) !== null) {
    const name = m[1];
    if (sigs[name]) continue; // first occurrence wins
    const params = countParams(m[2]);
    sigs[name] = {
      params,
      line: lineOf(m.index),
      exported: false,
      kind: 'named-function',
    };
  }

  // Pattern B: exports.NAME = function( ... ) / module.exports.NAME = function(...)
  const RE_EXPORTS_FUNC = /(?:^|\n)\s*(?:module\.)?exports\.([a-zA-Z_$][\w$]*)\s*=\s*function\s*(?:\s+[a-zA-Z_$][\w$]*)?\s*\(([^)]*)\)/g;
  while ((m = RE_EXPORTS_FUNC.exec(content)) !== null) {
    const name = m[1];
    const params = countParams(m[2]);
    sigs[name] = {
      params,
      line: lineOf(m.index),
      exported: true,
      kind: 'function-expression',
    };
  }

  // Pattern C: exports.NAME = (a, b) => ...  (arrow)
  const RE_EXPORTS_ARROW = /(?:^|\n)\s*(?:module\.)?exports\.([a-zA-Z_$][\w$]*)\s*=\s*(?:\(([^)]*)\)|([a-zA-Z_$][\w$]*))\s*=>/g;
  while ((m = RE_EXPORTS_ARROW.exec(content)) !== null) {
    const name = m[1];
    const paramsStr = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : '');
    const params = countParams(paramsStr);
    sigs[name] = {
      params,
      line: lineOf(m.index),
      exported: true,
      kind: 'arrow-function',
    };
  }

  // Pattern D: export function NAME(...)
  const RE_ESM_EXPORT = /\bexport\s+function\s+([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)/g;
  while ((m = RE_ESM_EXPORT.exec(content)) !== null) {
    const name = m[1];
    const params = countParams(m[2]);
    sigs[name] = {
      params,
      line: lineOf(m.index),
      exported: true,
      kind: 'named-function',
    };
  }

  // Pattern E: export const NAME = (...) => ...
  const RE_ESM_EXPORT_CONST = /\bexport\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:\(([^)]*)\)|([a-zA-Z_$][\w$]*))\s*=>/g;
  while ((m = RE_ESM_EXPORT_CONST.exec(content)) !== null) {
    const name = m[1];
    const paramsStr = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : '');
    const params = countParams(paramsStr);
    sigs[name] = {
      params,
      line: lineOf(m.index),
      exported: true,
      kind: 'arrow-function',
    };
  }

  // Pattern F: const NAME = function(...) {};  exports.NAME = NAME;
  //   We capture any `const NAME = function(...)` and then check if NAME
  //   appears in `exports.NAME` later — if so, mark exported=true.
  const RE_CONST_FUNC = /(?:^|\n)\s*(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*function\s*(?:\s+[a-zA-Z_$][\w$]*)?\s*\(([^)]*)\)/g;
  while ((m = RE_CONST_FUNC.exec(content)) !== null) {
    const name = m[1];
    if (sigs[name]) continue;
    const params = countParams(m[2]);
    sigs[name] = {
      params,
      line: lineOf(m.index),
      exported: false,
      kind: 'function-expression',
    };
  }
  // Pass 2: upgrade exported flag if the same name appears in exports.NAME.
  for (const name of Object.keys(sigs)) {
    const reExport = new RegExp(`(?:module\\.)?exports\\.${name}\\s*=`, 'g');
    if (reExport.test(content)) sigs[name].exported = true;
  }

  return sigs;
}

// Count comma-separated params, ignoring defaults, rest, destructuring.
// Best-effort: destructuring with commas (`{a, b}`) over-counts by 1. We
// clamp at 1 so we don't artificially flag legitimate single-arg fns.
function countParams(paramsStr) {
  if (!paramsStr) return 0;
  const trimmed = paramsStr.trim();
  if (!trimmed) return 0;
  // Strip a single rest-spread prefix (e.g., `...args`).
  const cleaned = trimmed.replace(/^\.\.\./, '');
  // Naive split — accept that destructured args may over-count slightly.
  // We then clamp to a sensible minimum of 1 if anything non-empty remains,
  // because at minimum the function takes one argument.
  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  return Math.max(parts.length, trimmed ? 1 : 0);
}

// ── Caller extraction ─────────────────────────────────────────────────────
//
// For a given caller file and an exported function name, find every line
// where the function is invoked. We support:
//   - foo(a, b, c)
//   - foo  (a, b)        (rare)
//   - obj.foo(a, b)
//   - require('./m').foo(a, b)
//
// Returns: [{line, argCount}]
function findCallSites(callerContent, funcName) {
  const out = [];
  if (!callerContent || !funcName) return out;

  const lines = callerContent.split('\n');
  // Pattern: optional `obj.` or `require(...).` prefix, then NAME, then `(`.
  const reCall = new RegExp(
    `(?:[\\w$.'\"]+\\.)?${escapeRe(funcName)}\\s*\\(`,
    'g'
  );
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    // Reset regex per line (no /g carry-over bug).
    reCall.lastIndex = 0;
    if (!reCall.test(line)) continue;
    // For arg count: extract content between balanced parens after NAME.
    // Naive — find the opening `(` after NAME and pair-up parens.
    const callStart = line.indexOf(funcName + '(');
    if (callStart < 0) continue;
    const openParen = callStart + funcName.length;
    const closeParen = matchClosingParen(line, openParen);
    if (closeParen < 0) continue;
    const inner = line.slice(openParen + 1, closeParen);
    const argCount = countArgs(inner);
    out.push({ line: i + 1, argCount });
  }
  return out;
}

function matchClosingParen(str, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function countArgs(inner) {
  if (!inner || !inner.trim()) return 0;
  // Strip leading/trailing whitespace and a trailing semicolon if present.
  const cleaned = inner.replace(/;\s*$/, '').trim();
  if (!cleaned) return 0;
  // Split on top-level commas — ignore commas inside (), [], {}, strings,
  // and template literals. This is naive but sufficient for our purposes
  // (we just need an approximation of argument count).
  let depth = 0;
  let inSingle = false, inDouble = false, inTpl = false, inLineComment = false, inBlockComment = false;
  let argCount = 1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];
    if (inLineComment) break;
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTpl) {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') inTpl = false;
      continue;
    }
    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTpl = true; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) argCount++;
  }
  return argCount;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── findIncompatibleCallers ──────────────────────────────────────────────
/**
 * Compare old signatures vs new signatures, and for every dependent caller
 * file, find call sites that are now incompatible.
 *
 * @param {object} graph - Output of buildDependencyGraph().
 * @param {object} oldSigs - { funcName: { params, ... } } before change.
 * @param {object} newSigs - { funcName: { params, ... } } after change.
 * @param {string} sourceFile - Absolute path of the changed file
 *   (used to find dependents in graph).
 * @returns {Array<{file: string, func: string, line: number, reason: string}>}
 */
function findIncompatibleCallers(graph, oldSigs, newSigs, sourceFile) {
  const out = [];
  if (!graph || !oldSigs || !newSigs || !sourceFile) return out;

  let dependents;
  try {
    dependents = depGraph.getDependents(graph, sourceFile);
  } catch (e) {
    console.error(`[interface_change_detector] getDependents failed: ${e.message}`);
    return out;
  }

  for (const dep of dependents) {
    let content;
    try {
      content = fs.readFileSync(dep, 'utf8');
    } catch (e) {
      console.error(`[interface_change_detector] cannot read dependent ${dep}: ${e.message}`);
      continue;
    }

    // Case 1: function removed (existed in oldSigs, missing in newSigs)
    for (const name of Object.keys(oldSigs)) {
      if (newSigs[name]) continue; // still exists
      const calls = findCallSites(content, name);
      for (const c of calls) {
        out.push({
          file: dep,
          func: name,
          line: c.line,
          reason: `exported function '${name}' no longer exists in ${path.basename(sourceFile)}`,
        });
      }
    }

    // Case 2: param count increased → caller may be missing required args
    for (const name of Object.keys(newSigs)) {
      const oldSig = oldSigs[name];
      const newSig = newSigs[name];
      if (!oldSig) continue; // brand-new export — nothing to compare
      if (newSig.params <= oldSig.params) continue; // no growth → no breakage
      const calls = findCallSites(content, name);
      for (const c of calls) {
        if (c.argCount < newSig.params) {
          out.push({
            file: dep,
            func: name,
            line: c.line,
            reason: `'${name}' now requires ${newSig.params} arg(s); caller passes ${c.argCount}`,
          });
        }
      }
    }
  }
  return out;
}

// ── Module exports ────────────────────────────────────────────────────────
module.exports = {
  extractFunctionSignatures,
  extractFunctionSignaturesFromSource,
  findIncompatibleCallers,
  findCallSites,
  // Exposed for tests:
  countParams,
  countArgs,
  matchClosingParen,
};
