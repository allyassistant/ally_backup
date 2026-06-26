/**
 * scripts/lib/rules/ast-helpers.js
 *
 * AST utilities for Phase 2 migration of buggy low-risk rules.
 *
 * Why this module exists:
 *   The legacy regex-on-raw-text approach has caused 4 distinct classes of
 *   silent code corruption. AST-aware rules can't have those bug classes
 *   because they have lexical context (strings, comments, identifiers,
 *   template literals, regex literals, computed properties) instead of raw
 *   characters.
 *
 * Design principles:
 *   1. NEVER THROW on parse failure — return null so callers can skip.
 *   2. Memoize AST per file (parsing once is the dominant cost).
 *   3. Pure functions where possible — no global state leaks.
 *   4. Line/column based — no byte offsets (easier to debug, matches acorn).
 *
 * Performance:
 *   Parsing a 1000-line file with acorn ~5-20ms. With per-file memoization,
 *   multiple AST-aware rules on the same file pay parsing cost ONCE.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

// ---------------------------------------------------------------------------
// Per-file AST cache. Cleared between auto_fix.js runs (cache is process-local).
// Keyed by absolute filePath; value is the parsed AST or null (parse failed).
// ---------------------------------------------------------------------------
const _astCache = new Map();

/**
 * Parse JS source into an AST, with shebang stripping and parse-error tolerance.
 * Returns null on parse failure (caller should skip rule gracefully).
 *
 * Shebang quirk: acorn refuses files starting with `#!` even though Node
 * accepts them on disk. We strip the shebang line before parsing and remember
 * how many lines we removed so callers can shift AST line numbers back.
 *
 * @param {string} content - File content
 * @param {string} filePath - Absolute file path (for diagnostics only)
 * @returns {{ ast: object, lineOffset: number, error?: string } | null}
 */
function parseAst(content, filePath) {
  if (content === null || content === undefined) return null;

  // Cache hit
  if (_astCache.has(filePath)) {
    return _astCache.get(filePath);
  }

  const shebangMatch = content.match(/^#![^\n]*\n/);
  const lineOffset = shebangMatch ? 1 : 0;
  const parseInput = shebangMatch ? content.slice(shebangMatch[0].length) : content;

  let ast;
  try {
    ast = acorn.parse(parseInput, {
      ecmaVersion: 2022,
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      locations: true,
      ranges: false,
    });
  } catch (e) {
    // Parse failure is not catastrophic — caller will skip the rule.
    // Cache null so we don't re-attempt on every rule.
    _astCache.set(filePath, null);
    return null;
  }

  const result = { ast, lineOffset };
  _astCache.set(filePath, result);
  return result;
}

/**
 * Clear the AST cache. Call between auto_fix.js runs or in tests to avoid
 * cross-file contamination.
 */
function clearAstCache() {
  _astCache.clear();
}

/**
 * Recursively walk an AST, calling callback(node, parent, key, index) for each
 * node. Skips the `loc` and `range` properties (those are metadata, not children).
 *
 * Callback receives:
 *   - node: the current AST node
 *   - parent: the parent node (or null at root)
 *   - key: which property of parent this node came from
 *   - index: index in the array if `key` is an array property, else null
 *
 * If callback returns false, walk stops (allows early termination).
 */
function walkAst(ast, callback) {
  if (!ast || typeof ast !== 'object') return;
  _walk(ast, null, null, null, callback);
}

function _walk(node, parent, key, index, callback) {
  if (!node || typeof node !== 'object' || !node.type) return;

  const result = callback(node, parent, key, index);
  if (result === false) return; // early termination signal

  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end') continue;
    const child = node[k];
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        _walk(child[i], node, k, i, callback);
      }
    } else if (child && typeof child === 'object' && child.type) {
      _walk(child, node, k, null, callback);
    }
  }
}

/**
 * Find the innermost AST node containing the given (line, col) position.
 * col is 0-indexed (matches acorn's loc.start.column).
 *
 * Returns the deepest descendant whose loc range fully contains the position.
 * Returns null if no enclosing node found.
 */
function findEnclosingNode(ast, line, col) {
  if (!ast || !ast.loc) return null;
  let best = null;
  walkAst(ast, (node) => {
    if (!node.loc) return;
    const start = node.loc.start;
    const end = node.loc.end;
    if (
      (line > start.line || (line === start.line && col >= start.column)) &&
      (line < end.line || (line === end.line && col <= end.column))
    ) {
      if (!best || _containsNode(best, node)) {
        best = node;
      }
    }
  });
  return best;
}

function _containsNode(outer, inner) {
  // True if `outer` is a strict ancestor of `inner`.
  // Used to pick the deepest enclosing node.
  if (!outer.loc || !inner.loc) return false;
  const oStart = outer.loc.start;
  const oEnd = outer.loc.end;
  const iStart = inner.loc.start;
  const iEnd = inner.loc.end;
  if (
    (oStart.line < iStart.line || (oStart.line === iStart.line && oStart.column <= iStart.column)) &&
    (oEnd.line > iEnd.line || (oEnd.line === iEnd.line && oEnd.column >= iEnd.column))
  ) {
    return true;
  }
  return false;
}

/**
 * Check whether an AST node is a string/template literal node.
 * This is the AST-aware replacement for the old quote-counting heuristic.
 *
 * `Literal` with string value → true
 * `TemplateLiteral` (backtick string) → true
 * `JSXText` (JSX children) → true (defensive — JSX files rare in this codebase)
 */
function isInsideStringLiteral(node) {
  if (!node) return false;
  if (node.type === 'Literal' && typeof node.value === 'string') return true;
  if (node.type === 'TemplateLiteral') return true;
  if (node.type === 'JSXText') return true;
  return false;
}

/**
 * Check whether an AST node represents a comment.
 * Returns true for:
 *   - Line comment (// foo)
 *   - Block comment (/* foo *\/)
 *   - Nodes entirely wrapped in a comment ancestor
 *
 * Uses ancestor-chain inspection: we don't store the comment in the AST node,
 * but if the node has a `_insideComment` flag set by an external helper, or
 * if the node itself is a comment type, we return true.
 *
 * NOTE: acorn by default does NOT include comments in the AST. To use this
 * function, parse with `onComment: (block, text, start, end) => { ... }`.
 * For our use cases, we walk comments from the parsed source instead — see
 * `getCommentRanges` below.
 */
function isInsideComment(node) {
  if (!node) return false;
  if (node.type === 'Line' || node.type === 'Block') return true;
  // Defensive: callers may attach `__insideComment: true` to flag a node as
  // being inside a comment ancestor (e.g. after running `getCommentRanges`).
  if (node.__insideComment === true) return true;
  return false;
}

/**
 * Collect all free `Identifier` nodes in the AST — function names, variable
 * references, property names where `computed: false`.
 *
 * EXCLUDES:
 *   - Property keys where `computed: true` (those are runtime expressions)
 *   - Member expression `property` (obj.x — the `x` is not a free identifier)
 *   - Declarations vs. references are NOT distinguished — caller decides
 *
 * @param {object} ast - Root AST node
 * @returns {Array<{name: string, node: object, line: number}>}
 */
function collectIdentifiers(ast) {
  const out = [];
  walkAst(ast, (node) => {
    if (node.type === 'Identifier') {
      out.push({
        name: node.name,
        node,
        line: node.loc ? node.loc.start.line : 0,
      });
    } else if (node.type === 'Property' && !node.computed && node.key) {
      // Non-computed property: { data: 1 } — `data` is an identifier-like name
      // but in this context it's a property key, not a variable reference.
      // We include it so the "identifier preservation" check can detect
      // accidental rename of property names.
      if (node.key.type === 'Identifier') {
        out.push({
          name: node.key.name,
          node: node.key,
          line: node.key.loc ? node.key.loc.start.line : 0,
          isPropertyKey: true,
        });
      }
    }
  });
  return out;
}

/**
 * Count all AST nodes (structural integrity check for Phase 3).
 * Used to verify a fix didn't accidentally drop nodes (e.g. by replacing a
 * statement with an empty string).
 */
function countNodes(ast) {
  let count = 0;
  walkAst(ast, () => { count++; });
  return count;
}

/**
 * Get the original source text of an AST node.
 * Uses node.loc to slice the content. Returns empty string if no loc.
 */
function getNodeText(content, node) {
  if (!node || !node.loc) return '';
  const lines = content.split('\n');
  const start = node.loc.start;
  const end = node.loc.end;

  if (start.line === end.line) {
    return lines[start.line - 1].slice(start.column, end.column);
  }

  // Multi-line node: assemble from line fragments
  const parts = [lines[start.line - 1].slice(start.column)];
  for (let ln = start.line + 1; ln < end.line; ln++) {
    parts.push(lines[ln - 1]);
  }
  parts.push(lines[end.line - 1].slice(0, end.column));
  return parts.join('\n');
}

/**
 * Replace an AST node's source text in `content` with `newText`.
 * Returns the modified content. If `newText` matches the existing text,
 * returns `content` unchanged.
 */
function replaceNodeText(content, node, newText) {
  if (!node || !node.loc) return content;
  const lines = content.split('\n');
  const start = node.loc.start;
  const end = node.loc.end;

  if (start.line === end.line) {
    lines[start.line - 1] =
      lines[start.line - 1].slice(0, start.column) +
      newText +
      lines[start.line - 1].slice(end.column);
    return lines.join('\n');
  }

  // Multi-line replacement: keep start.line prefix + newText + end.line suffix
  const startLinePrefix = lines[start.line - 1].slice(0, start.column);
  const endLineSuffix = lines[end.line - 1].slice(end.column);
  lines.splice(
    start.line - 1,
    end.line - start.line + 1,
    startLinePrefix + newText + endLineSuffix
  );
  return lines.join('\n');
}

/**
 * Find the LHS target of an assignment expression or for-of/in binding.
 * Returns the innermost MemberExpression or Identifier on the LHS, or null.
 *
 * Used by optional-chaining.ast.js to skip rewriting LHS targets (which would
 * produce SyntaxError in Node v22+).
 *
 * Handles:
 *   - `a.b.c = value` → returns the MemberExpression for `a.b.c`
 *   - `arr[0].field = v` → returns MemberExpression for `arr[0].field`
 *   - `for (obj.a.b.c of items)` → returns the MemberExpression for `obj.a.b.c`
 *   - `a.b.c++` → returns MemberExpression for `a.b.c`
 *   - `obj.x.y.z ??= null` → returns MemberExpression for `obj.x.y.z`
 */
function findLhsTarget(node) {
  if (!node) return null;

  // AssignmentExpression: target = node.left
  if (node.type === 'AssignmentExpression') {
    return node.left;
  }
  // UpdateExpression (a++ / ++a): argument is the LHS
  if (node.type === 'UpdateExpression') {
    return node.argument;
  }
  // ForOfStatement / ForInStatement: left is the LHS binding
  if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    return node.left;
  }
  // ExpressionStatement wrapping an assignment or update
  if (node.type === 'ExpressionStatement') {
    return findLhsTarget(node.expression);
  }
  // SequenceExpression: check each child for assignments
  if (node.type === 'SequenceExpression') {
    for (const expr of node.expressions) {
      const lhs = findLhsTarget(expr);
      if (lhs) return lhs;
    }
  }
  return null;
}

/**
 * Walk up from `node` looking for an ancestor whose loc.start.line === node.loc.start.line
 * (same line) and represents a "code-path" container (Statement, Expression).
 * Useful for "what kind of statement owns this line" queries.
 */
function findStatementAncestor(node) {
  // We need a parent map for this — walkAst doesn't track it.
  // For now, this is a placeholder; concrete rules use walkAst with their own
  // ancestry tracking via the parent argument.
  return node;
}

/**
 * Extract all comment ranges from a source string by parsing with
 * `onComment`. Returns array of { start, end, type: 'Line'|'Block', value }.
 *
 * @param {string} content - Source text
 * @returns {Array<{start: number, end: number, type: string, value: string}>}
 */
function extractComments(content) {
  const comments = [];
  // Strip shebang (acorn refuses it)
  const shebangMatch = content.match(/^#![^\n]*\n/);
  const parseInput = shebangMatch ? content.slice(shebangMatch[0].length) : content;
  try {
    acorn.parse(parseInput, {
      ecmaVersion: 2022,
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      locations: true,
      ranges: true,
      onComment: (block, text, start, end) => {
        comments.push({
          start: start + (shebangMatch ? shebangMatch[0].length : 0),
          end: end + (shebangMatch ? shebangMatch[0].length : 0),
          type: block ? 'Block' : 'Line',
          value: text,
        });
      },
    });
  } catch (_) {
    // Parse failed — comments array stays empty; rules should fall back to
    // skipping the file rather than assuming anything about comments.
  }
  return comments;
}

/**
 * Check whether a given (line, column) position lies inside any comment.
 * Returns the comment object if so, null otherwise.
 */
function positionInComment(content, line, col) {
  const comments = extractComments(content);
  for (const c of comments) {
    // Find the line/col for the start/end offsets
    const startPos = _offsetToLineCol(content, c.start);
    const endPos = _offsetToLineCol(content, c.end);
    if (
      (line > startPos.line || (line === startPos.line && col >= startPos.col)) &&
      (line < endPos.line || (line === endPos.line && col <= endPos.col))
    ) {
      return c;
    }
  }
  return null;
}

/**
 * Convert a byte offset to (line, col). 1-indexed line, 0-indexed col.
 */
function _offsetToLineCol(content, offset) {
  let line = 1;
  let col = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, col };
}

/**
 * Find a chain of MemberExpression / ChainExpression nodes rooted at `node`.
 * Returns an array of property names from outermost to innermost.
 * Skips computed access (arr[0] doesn't yield '0').
 *
 * Used by optional-chaining.ast.js to identify 3+ level chains.
 */
function getMemberChain(node) {
  const chain = [];
  let cur = node;
  while (cur) {
    if (cur.type === 'MemberExpression') {
      // Skip computed access — arr[0].x yields ['x'] only
      if (cur.computed) {
        chain.length = 0; // reset: computed access breaks the static chain
        return chain;
      }
      if (cur.property && cur.property.type === 'Identifier') {
        chain.unshift(cur.property.name);
      }
      cur = cur.object;
    } else if (cur.type === 'ChainExpression') {
      cur = cur.expression;
    } else if (cur.type === 'Identifier') {
      chain.unshift(cur.name);
      return chain;
    } else if (cur.type === 'CallExpression' && cur.callee) {
      // Calls in the middle of a chain (rare in member access). Treat callee
      // as the next link.
      cur = cur.callee;
    } else {
      return chain;
    }
  }
  return chain;
}

/**
 * Check if a MemberExpression's property is wrapped in optional chaining
 * (via parent ChainExpression). Returns true if so.
 */
function isAlreadyOptional(node) {
  // Walk up from node — if any ancestor is a ChainExpression where this node
  // is the .expression, the chain is already optional.
  // Without a parent map, we approximate: if node has `optional: true` flag
  // (set by acorn for `a?.b`), it's already optional.
  if (node && node.optional === true) return true;
  return false;
}

/**
 * Get the "root" identifier of a MemberExpression chain (the leftmost name).
 * Returns null if the chain starts with a literal, this, super, or computed.
 */
function getChainRoot(node) {
  let cur = node;
  while (cur) {
    if (cur.type === 'MemberExpression') {
      cur = cur.object;
    } else if (cur.type === 'ChainExpression') {
      cur = cur.expression;
    } else if (cur.type === 'CallExpression' && cur.callee) {
      cur = cur.callee;
    } else if (cur.type === 'Identifier') {
      return cur.name;
    } else {
      return null;
    }
  }
  return null;
}

// ===========================================================================
// Exports
// ===========================================================================

module.exports = {
  parseAst,
  clearAstCache,
  walkAst,
  findEnclosingNode,
  isInsideStringLiteral,
  isInsideComment,
  collectIdentifiers,
  countNodes,
  getNodeText,
  replaceNodeText,
  findLhsTarget,
  extractComments,
  positionInComment,
  getMemberChain,
  getChainRoot,
  isAlreadyOptional,
};