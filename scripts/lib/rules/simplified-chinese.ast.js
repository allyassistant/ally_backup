/**
 * scripts/lib/rules/simplified-chinese.ast.js
 *
 * AST-aware version of the `simplified-chinese` rule.
 *
 * Bug class fixed by AST migration:
 *   1. Renamed identifiers containing simplified chars. E.g. `function 為() {}`
 *      → `function 為() {}`. This:
 *      - Breaks references to the function elsewhere in the file
 *      - Causes SyntaxError in non-UTF-8 environments (非 UTF-8 環境)
 *      - Violates the developer's intentional naming
 *   2. Renamed property keys. E.g. `obj.數據.length` → `obj.數據.length` (but
 *      also renamed `{ 數據: 1 }.數據` → `{ 數據: 1 }.數據`, breaking
 *      lookups against the original key).
 *   3. Renamed non-computed object keys (`{ 數據: 1 }` → `{ 數據: 1 }`).
 *
 * AST approach:
 *   - Convert ONLY Literal string values (text content of strings).
 *   - Skip Identifier nodes (variable/function names).
 *   - Skip Property keys (object key names).
 *   - Convert comment content (Block + Line) — yes, comments SHOULD be
 *     cleaned up since they don't affect semantics.
 *   - Convert Literal regex patterns? Probably not — those are usually
 *     intentional technical strings. Skip for safety.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const helpers = require('./ast-helpers');

let _simpMap = null;
let _simpMapSet = null;
function _getSimplifiedMap() {
  if (_simpMap) return _simpMap;
  try {
    _simpMap = require('../simp_trad_map.json');
  } catch (e) {
    _simpMap = [];
  }
  // Build a fast Set of simplified chars for quick "does this string have
  // any simplified chars?" checks
  _simpMapSet = new Set(_simpMap.map(([simp]) => simp));
  return _simpMap;
}

function _hasSimplified(text) {
  const map = _getSimplifiedMap();
  if (!map || map.length === 0) return false;
  for (const [simp] of map) {
    if (text.includes(simp)) return true;
  }
  return false;
}

function _convert(text) {
  const map = _getSimplifiedMap();
  let result = text;
  for (const [simp, trad] of map) {
    if (result.includes(simp)) {
      result = result.split(simp).join(trad);
    }
  }
  return result;
}

/**
 * Decide if this AST node should be CONVERTED. Returns false for nodes that
 * should be preserved as-is (identifiers, property keys, regex patterns).
 */
function _shouldConvertNode(node) {
  if (!node) return false;
  if (node.type === 'Literal') {
    // Convert string literals only — NOT regex, numbers, booleans, null
    return typeof node.value === 'string';
  }
  if (node.type === 'TemplateLiteral') {
    // Convert the quasi portions (literal text) — but NOT expressions.
    // Caller walks `quasis` array.
    return true;
  }
  return false;
}

// =====================================================================
// detect(content, filePath)
// =====================================================================
function detect(content, filePath) {
  helpers.clearAstCache();
  const parsed = helpers.parseAst(content, filePath);

  const foundLines = new Set();
  const parentMap = parsed && parsed.ast ? _buildParentMap(parsed.ast) : new WeakMap();

  if (parsed && parsed.ast) {
    const { ast, lineOffset } = parsed;
    helpers.walkAst(ast, (node) => {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        if (!_hasSimplified(node.value)) return;
        if (!node.loc) return;
        // Skip if this Literal is a property key (computed=false or computed=true)
        const parent = parentMap.get(node);
        if (parent && parent.type === 'Property' && parent.key === node) return;
        foundLines.add(node.loc.start.line + lineOffset);
      } else if (node.type === 'TemplateLiteral') {
        for (const quasi of node.quasis) {
          if (_hasSimplified(quasi.value.cooked) && quasi.loc) {
            foundLines.add(quasi.loc.start.line + lineOffset);
            break; // one hit per template literal
          }
        }
      }
      // SKIP: Identifier, Property keys, regex Literals
    });
  }

  // Also check comments (block + line)
  const comments = helpers.extractComments(content);
  const lines = content.split('\n');
  for (const c of comments) {
    const startLine = _lineForOffset(content, c.start);
    if (_hasSimplified(c.value)) {
      foundLines.add(startLine);
    }
  }

  const sortedLines = [...foundLines].sort((a, b) => a - b);
  if (sortedLines.length === 0) return { found: false, details: '', lines: [] };
  return {
    found: true,
    details: `${sortedLines.length} 行有簡體中文 (AST)`,
    lines: sortedLines,
  };
}

// =====================================================================
// fix(content, filePath)
// =====================================================================
function fix(content, filePath) {
  helpers.clearAstCache();
  const parsed = helpers.parseAst(content, filePath);

  // Collect (line, col, length, newText) tuples for in-place replacement
  const replacements = [];
  const parentMap = parsed && parsed.ast ? _buildParentMap(parsed.ast) : new WeakMap();

  if (parsed && parsed.ast) {
    const { ast, lineOffset } = parsed;
    helpers.walkAst(ast, (node) => {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        if (!_hasSimplified(node.value)) return;
        if (!node.loc) return;
        // Skip property keys
        const parent = parentMap.get(node);
        if (parent && parent.type === 'Property' && parent.key === node) return;

        const newValue = _convert(node.value);
        // Build new raw text preserving quote style
        const start = node.loc.start;
        const end = node.loc.end;
        const originalRaw = content.slice(
          _offsetFor(content, start.line, start.column),
          _offsetFor(content, end.line, end.column)
        );
        const quoteChar = originalRaw[0];
        let newRaw;
        if (quoteChar === '`') {
          newRaw = '`' + newValue + '`';
        } else {
          newRaw = quoteChar + newValue + quoteChar;
        }

        replacements.push({
          startLine: start.line + lineOffset,
          startCol: start.column,
          endLine: end.line + lineOffset,
          endCol: end.column,
          newText: newRaw,
        });
      } else if (node.type === 'TemplateLiteral') {
        for (const quasi of node.quasis) {
          if (!_hasSimplified(quasi.value.cooked)) continue;
          if (!quasi.loc) continue;
          // For template literal, the quasi is the literal text between
          // backticks / ${} expressions. We replace just the quasi text.
          // The new quasi value should preserve leading/trailing structure.
          const start = quasi.loc.start;
          const end = quasi.loc.end;
          // Quasi text starts AFTER the opening backtick/${  and ends BEFORE
          // the closing ${/backtick. But acorn gives us the full loc, which
          // includes the backticks/curlies. We need to find the inner text.
          // Strategy: look at the original source to find the inner content.
          // For now, simpler: if quasi starts at same loc as TemplateLiteral,
          // it's the first/last quasi (whole template is one string with no
          // interpolation). Otherwise it's sandwiched between ${ }.
          const newText = _convert(quasi.value.cooked);
          // Replace just the inner cooked portion
          // The quasi's loc covers the WHOLE quasi including delimiters.
          // We compute offset adjustments:
          const startOff = _offsetFor(content, start.line, start.column);
          const endOff = _offsetFor(content, end.line, end.column);
          const fullRaw = content.slice(startOff, endOff);
          // Detect if this quasi has delimiters (like ${...}) around the text
          // Simple case: fullRaw IS just the text (no surrounding backticks
          // because those are on the outer TemplateLiteral). For inner quasis,
          // fullRaw is `${ ... }`. For first/last, it's just text.
          let innerText;
          if (fullRaw.startsWith('${') && fullRaw.endsWith('}')) {
            // Inner quasi: text between `${` and `}` is the cooked value
            innerText = fullRaw.slice(2, -1);
          } else {
            // Outer quasi (first or last): text between backticks
            innerText = fullRaw;
          }
          const innerStartOff = startOff + (fullRaw.length - innerText.length);
          const innerEndOff = innerStartOff + innerText.length;
          replacements.push({
            absolute: true, // use absolute offsets, not line/col
            startOff: innerStartOff,
            endOff: innerEndOff,
            newText,
          });
        }
      }
    });
  }

  // Comments: convert simplified chars in comment text
  const comments = helpers.extractComments(content);
  for (const c of comments) {
    if (!_hasSimplified(c.value)) continue;
    // For Block comments: c.value is between /* and */
    // For Line comments: c.value is between // and newline
    const newText = _convert(c.value);
    // For Line comments: // + newText
    // For Block comments: /* + newText + */
    const wrappedNew = c.type === 'Block' ? '/*' + newText + '*/' : '//' + newText;
    replacements.push({
      absolute: true,
      startOff: c.start,
      endOff: c.end,
      newText: wrappedNew,
    });
  }

  if (replacements.length === 0) return content;

  // Apply replacements from end to start so offsets don't shift
  const lineBased = replacements.filter(r => !r.absolute);
  const offsetBased = replacements.filter(r => r.absolute);

  // Process offset-based first (comments and template quasis) since they
  // use byte offsets in the original content.
  // Process line-based after, using AST positions on the modified content.

  // Sort offset-based by startOff DESC
  offsetBased.sort((a, b) => b.startOff - a.startOff);

  let workingContent = content;
  for (const r of offsetBased) {
    workingContent = workingContent.slice(0, r.startOff) + r.newText + workingContent.slice(r.endOff);
  }

  // Now apply line-based replacements on the modified content
  if (lineBased.length > 0) {
    const lines = workingContent.split('\n');
    lineBased.sort((a, b) => (b.startLine - a.startLine) || (b.startCol - a.startCol));
    for (const r of lineBased) {
      if (r.startLine === r.endLine) {
        const ln = lines[r.startLine - 1];
        lines[r.startLine - 1] = ln.slice(0, r.startCol) + r.newText + ln.slice(r.endCol);
      } else {
        const startPart = lines[r.startLine - 1].slice(0, r.startCol);
        const endPart = lines[r.endLine - 1].slice(r.endCol);
        lines.splice(
          r.startLine - 1,
          r.endLine - r.startLine + 1,
          startPart + r.newText + endPart
        );
      }
    }
    workingContent = lines.join('\n');
  }

  return workingContent;
}

// =====================================================================
// Internal helpers
// =====================================================================

function _offsetFor(content, line, col) {
  let offset = 0;
  let curLine = 1;
  while (curLine < line) {
    const nl = content.indexOf('\n', offset);
    if (nl === -1) return content.length;
    offset = nl + 1;
    curLine++;
  }
  return offset + col;
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

function _lineForOffset(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

module.exports = {
  id: 'simplified-chinese',
  name: '簡體→繁體常見字修正 (AST)',
  category: 'doc',

  detect(content, filePath) {
    return detect(content, filePath);
  },

  fix(content, filePath) {
    return fix(content, filePath);
  },

  // Exposed for testing
  _hasSimplified,
  _convert,
  _shouldConvertNode,
};