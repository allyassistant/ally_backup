/**
 * scripts/lib/rules/optional-chaining.ast.js
 *
 * AST-aware version of the `optional-chaining` rule.
 *
 * Bug class fixed by AST migration:
 *   1. String literals containing `.x.y.z` were rewritten (e.g. '.cache.json.tmp')
 *      because the old quote-counting heuristic misidentified the position.
 *   2. LHS assignment targets with array indexing (arr[0].field = v) were
 *      partially rewritten, breaking the chain.
 *   3. Slash-divide expressions (a.b.c / total.count) were skipped because
 *      the old heuristic misread `/` as a regex delimiter.
 *
 * AST approach:
 *   - Walk `MemberExpression` and `ChainExpression` nodes.
 *   - For each chain, count the depth. If ≥ 3 levels AND not already optional
 *     AND root is not in SAFE_ROOTS AND the chain is on the RHS of an
 *     assignment (not LHS) AND not inside a string literal/comment → flag it.
 *   - fix() inserts `?.` between the `.` separators in the actual source text
 *     using `replaceNodeText`.
 */

'use strict';

const path = require('path');
const helpers = require('./ast-helpers');

// =====================================================================
// Safe roots — same set as legacy rule, kept in sync
// =====================================================================
const SAFE_ROOTS = new Set([
  'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'Date', 'Promise', 'Buffer', 'console', 'Symbol', 'Error',
  'Reflect', 'globalThis', 'Intl', 'BigInt', 'Atomics',
  'SharedArrayBuffer', 'ArrayBuffer', 'DataView',
  'window', 'document', 'navigator', 'location', 'history',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'process', 'require', 'module', 'exports', '__dirname', '__filename',
  'import',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp',
]);

// Minimum chain depth to flag (3+ = a.b.c or longer)
const MIN_CHAIN_DEPTH = 3;

// =====================================================================
// detect(astResult, content, filePath) — returns { found, details, lines }
// astResult is the output of parseAst(): { ast, lineOffset } or null
// =====================================================================
function detect(astResult, content, filePath) {
  if (!astResult || !astResult.ast) {
    return { found: false, details: 'AST parse failed; rule skipped', lines: [], parseFailed: true };
  }

  const { ast, lineOffset } = astResult;
  const foundLines = new Set();

  // Pre-extract comment ranges once (cheap)
  const commentRanges = helpers.extractComments(content);

  helpers.walkAst(ast, (node, parent) => {
    // Look at the OUTERMOST member of each chain. Inner ones will be visited
    // too, but we'll skip them by checking `parent` is not a MemberExpression.
    if (node.type !== 'MemberExpression') return;

    // If our parent is also a MemberExpression (and we're its `.object`),
    // we're not the chain root — let the root handle it. This avoids
    // double-counting a 3-deep chain as 3 separate 2-deep chains.
    if (parent && parent.type === 'MemberExpression' && parent.object === node) return;

    // Walk down to innermost expression, skipping computed access (which
    // resets the static chain).
    let cur = node;
    while (cur) {
      if (cur.type === 'MemberExpression') {
        if (cur.computed) {
          // arr[0].x.y — the [0] breaks the static chain. Stop here.
          return;
        }
        cur = cur.property;
      } else if (cur.type === 'ChainExpression') {
        cur = cur.expression;
      } else {
        break;
      }
    }

    // Collect property names in chain order: [outermost, ..., innermost]
    const chain = helpers.getMemberChain(node);
    if (chain.length < MIN_CHAIN_DEPTH) return;

    // Check root
    const root = chain[0];
    if (SAFE_ROOTS.has(root)) return;

    // Check the outermost MemberExpression's loc
    if (!node.loc) return;
    const line = node.loc.start.line + lineOffset;
    const col = node.loc.start.column;

    // Skip if inside a string literal: check enclosing node
    const enclosing = helpers.findEnclosingNode(ast, line, col);
    if (enclosing && helpers.isInsideStringLiteral(enclosing)) return;

    // Skip if the enclosing chain ancestor is a string literal context
    // (e.g. inside template literal substitution is OK; inside backtick string is not)
    if (_isInsideStringContext(ast, node)) return;

    // Skip if inside a comment
    if (_isInsideCommentAt(commentRanges, content, line, col)) return;

    // Skip LHS targets (assignment / update / for-of/in)
    if (_isLhsTarget(ast, node)) return;

    // Skip if already optional (ChainExpression ancestor)
    if (_isAlreadyOptionalChain(ast, node)) return;

    foundLines.add(line);
  });

  const lines = [...foundLines].sort((a, b) => a - b);
  if (lines.length === 0) {
    return { found: false, details: '', lines: [] };
  }
  return {
    found: true,
    details: `${lines.length} 行有 3+ 層 member chain 可加 optional chaining (AST)`,
    lines,
    severity: 'low',
    suggestion: '深層 member chain 加 ?. 可防止 undefined access 引發 TypeError',
  };
}

// =====================================================================
// fix(content, filePath) — returns modified content
// Uses AST positions to safely rewrite a?.b?.c in source text.
// =====================================================================
function fix(content, filePath) {
  const parsed = helpers.parseAst(content, filePath);
  if (!parsed || !parsed.ast) return content; // parse failed → no-op (caller validates)

  const { ast, lineOffset } = parsed;
  const commentRanges = helpers.extractComments(content);

  // Collect (node, chain) pairs to rewrite, then process from BOTTOM of file
  // to TOP so earlier positions don't shift as we rewrite later ones.
  const toRewrite = [];

  helpers.walkAst(ast, (node, parent) => {
    if (node.type !== 'MemberExpression') return;
    if (parent && parent.type === 'MemberExpression' && parent.object === node) return;

    // Check depth (handle computed by bailing)
    let cur = node;
    while (cur) {
      if (cur.type === 'MemberExpression') {
        if (cur.computed) return;
        cur = cur.property;
      } else if (cur.type === 'ChainExpression') {
        cur = cur.expression;
      } else {
        break;
      }
    }

    const chain = helpers.getMemberChain(node);
    if (chain.length < MIN_CHAIN_DEPTH) return;

    const root = chain[0];
    if (SAFE_ROOTS.has(root)) return;

    if (!node.loc) return;
    const line = node.loc.start.line + lineOffset;
    const col = node.loc.start.column;

    const enclosing = helpers.findEnclosingNode(ast, line, col);
    if (enclosing && helpers.isInsideStringLiteral(enclosing)) return;
    if (_isInsideStringContext(ast, node)) return;
    if (_isInsideCommentAt(commentRanges, content, line, col)) return;
    if (_isLhsTarget(ast, node)) return;
    if (_isAlreadyOptionalChain(ast, node)) return;

    toRewrite.push({ node, line });
  });

  if (toRewrite.length === 0) return content;

  // Sort by line DESC so we rewrite bottom-up (preserves offsets)
  toRewrite.sort((a, b) => b.line - a.line);

  let newContent = content;
  for (const { node } of toRewrite) {
    newContent = _rewriteChainInSource(newContent, node);
  }
  return newContent;
}

// =====================================================================
// Internal helpers
// =====================================================================

/**
 * Rewrite `a.b.c` → `a?.b?.c` in the source text by manipulating the string
 * directly at the node's loc. Replaces each `.` (between properties) with
 * `?.`. The node's loc gives us start.line/start.column to end.line/end.column.
 */
function _rewriteChainInSource(content, memberExprNode) {
  if (!memberExprNode.loc) return content;
  const lines = content.split('\n');
  const start = memberExprNode.loc.start;
  const end = memberExprNode.loc.end;

  // For single-line chains, simple in-place rewrite
  if (start.line === end.line) {
    const originalLine = lines[start.line - 1];
    const before = originalLine.slice(0, start.column);
    const chainText = originalLine.slice(start.column, end.column);
    const after = originalLine.slice(end.column);
    const rewritten = chainText.replace(/\./g, '?.');
    lines[start.line - 1] = before + rewritten + after;
    return lines.join('\n');
  }

  // Multi-line chain: assemble chainText across lines, replace `.` with `?.`,
  // then reassemble. This is rare (long chains rarely span lines) but handled
  // for completeness.
  const startLine = lines[start.line - 1];
  const endLine = lines[end.line - 1];
  const startFragment = startLine.slice(start.column);
  const endFragment = endLine.slice(0, end.column);
  const middleLines = lines.slice(start.line, end.line - 1);
  const chainText = [startFragment, ...middleLines, endFragment].join('\n');
  const rewritten = chainText.replace(/\./g, '?.');

  // Replace the multi-line span
  lines.splice(
    start.line - 1,
    end.line - start.line + 1,
    startLine.slice(0, start.column) + rewritten
  );
  return lines.join('\n');
}

/**
 * Walk up from `node` to determine if we're on the LHS of an assignment,
 * update expression, or for-of/in binding.
 *
 * Strategy: walk parent chain. If we hit an AssignmentExpression where this
 * node is `.left`, or UpdateExpression where this node is `.argument`, or
 * ForOfStatement/ForInStatement where this node is `.left` → LHS.
 */
function _isLhsTarget(ast, node) {
  // Build parent map for the AST (small cost; amortized over multiple checks)
  const parentMap = _buildParentMap(ast);
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;

    if (parent.type === 'AssignmentExpression' && parent.left === cur) return true;
    if (parent.type === 'UpdateExpression' && parent.argument === cur) return true;
    if ((parent.type === 'ForOfStatement' || parent.type === 'ForInStatement') && parent.left === cur) return true;

    // ExpressionStatement → keep walking (could wrap an assignment)
    if (parent.type === 'ExpressionStatement') {
      cur = parent;
      continue;
    }
    // MemberExpression → keep walking (could be `.object` of another member)
    if (parent.type === 'MemberExpression') {
      cur = parent;
      continue;
    }
    // Stop at any other node type (BinaryExpression, CallExpression, etc.)
    return false;
  }
  return false;
}

const _parentCache = new WeakMap();
function _buildParentMap(ast) {
  if (_parentCache.has(ast)) return _parentCache.get(ast);
  const map = new WeakMap();
  helpers.walkAst(ast, (node, parent) => {
    if (parent) map.set(node, parent);
  });
  _parentCache.set(ast, map);
  return map;
}

/**
 * Check if the node is inside a string-context ancestor (TemplateLiteral
 * without ${expr} nesting, or property key of an Object where the key is a
 * string Literal).
 */
function _isInsideStringContext(ast, node) {
  const parentMap = _buildParentMap(ast);
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;

    // TemplateLiteral: only string-context if we're NOT inside an ${expr}
    // substitution. The parent of an Expression inside TemplateLiteral is
    // a TemplateLiteral with `expressions` array. If we came via expressions,
    // we're in code context, not string context.
    if (parent.type === 'TemplateLiteral') {
      // Check if cur is in expressions (vs quasis)
      if (parent.expressions && parent.expressions.includes(cur)) {
        // We're in an expression substitution — NOT a string context. Stop walking.
        return false;
      }
      // We're in a quasi — that IS a string context.
      return true;
    }

    // Direct child of a Literal node that's a string → string context.
    // E.g. a CallExpression where the callee is a string literal: "foo".bar
    // — but that's still a code context because we want to flag "foo".length
    // for instance. So only return true if parent is itself a string literal
    // and cur is its child property access (rare).
    if (parent.type === 'Literal' && typeof parent.value === 'string') {
      // We're inside a string literal. Definitely skip.
      return true;
    }

    // Property keys are not string-context per se, but property KEYS in
    // { "foo.bar.baz": 1 } are strings — we don't want to rewrite those.
    // The Property check catches `key` being a Literal. cur here is the
    // MemberExpression's outer node; parent here might be the Literal itself
    // if the chain's root is a string literal (rare: "foo".a.b.c — yes, valid).

    cur = parent;
  }
  return false;
}

/**
 * Check if the position is inside any comment range.
 */
function _isInsideCommentAt(commentRanges, content, line, col) {
  if (!commentRanges || commentRanges.length === 0) return false;
  for (const c of commentRanges) {
    const startLine = _lineForOffset(content, c.start);
    const startCol = _colForOffset(content, c.start);
    const endLine = _lineForOffset(content, c.end);
    const endCol = _colForOffset(content, c.end);
    if (
      (line > startLine || (line === startLine && col >= startCol)) &&
      (line < endLine || (line === endLine && col <= endCol))
    ) {
      return true;
    }
  }
  return false;
}

function _lineForOffset(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function _colForOffset(content, offset) {
  let col = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') col = 0;
    else col++;
  }
  return col;
}

/**
 * Check if the chain is already wrapped in optional chaining (ChainExpression
 * with `?.` between any link).
 */
function _isAlreadyOptionalChain(ast, node) {
  const parentMap = _buildParentMap(ast);
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'ChainExpression' && parent.expression === cur) return true;
    if (parent.type === 'MemberExpression') {
      cur = parent;
      continue;
    }
    return false;
  }
  return false;
}

// =====================================================================
// Exports — detect/fix match the legacy rule signature so low-risk.js can
// dispatch to either implementation behind the USE_AST_RULES flag.
// =====================================================================

module.exports = {
  id: 'optional-chaining',
  name: '深層 member chain 加 optional chaining (AST)',
  category: 'reliability',

  /**
   * AST-aware detect. Signature matches legacy:
   *   detect(content, filePath) → { found, details, lines, ... }
   *
   * Internally parses content into AST then delegates to astDetect.
   */
  detect(content, filePath) {
    helpers.clearAstCache(); // per-call: don't share ASTs across files
    const parsed = helpers.parseAst(content, filePath);
    return detect(parsed, content, filePath);
  },

  /**
   * AST-aware fix.
   */
  fix(content, filePath) {
    helpers.clearAstCache();
    return fix(content, filePath);
  },

  // Expose internals for testing
  _detectFromAst: detect,
  _rewriteChainInSource,
  _isLhsTarget,
  _isInsideStringContext,
  _isInsideCommentAt,
};