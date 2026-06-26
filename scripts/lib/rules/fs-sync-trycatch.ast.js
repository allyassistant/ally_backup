/**
 * scripts/lib/rules/fs-sync-trycatch.ast.js
 *
 * AST-aware version of the `fs-sync-trycatch` rule.
 *
 * Bug class fixed by AST migration:
 *   1. detect() used AST via buildTryBlockMap BUT fix() re-checked with regex
 *      (defect b: detect/fix divergence). Multi-line calls broke the skip regex.
 *   2. `try { fs.mkdirSync(p, { recursive: true }); } catch {}` — the nested
 *      `{ recursive: true }` confused the regex skip pattern, causing the rule
 *      to wrap already-wrapped code in another try-catch.
 *
 * AST approach:
 *   - Walk `CallExpression` nodes for fs.*Sync / execSync / execFileSync.
 *   - Use `buildTryBlockMap` (already AST-aware) for "is this call already
 *     inside a try?" check. Apply that check to BOTH detect and fix.
 *   - fix() uses AST node ranges to safely wrap multi-line calls.
 *   - Skip destructuring imports: `const { execSync } = require(...)`.
 */

'use strict';

const helpers = require('./ast-helpers');
const { buildTryBlockMap } = require('../audit/try-block-map');

// =====================================================================
// Config: which fs/exec sync calls to flag
// =====================================================================
const FS_SYNC_METHODS = new Set([
  'readFileSync', 'writeFileSync', 'unlinkSync', 'rmSync',
  'mkdirSync', 'copyFileSync', 'accessSync', 'statSync',
  'readdirSync', 'lstatSync',
]);
const EXEC_METHODS = new Set(['execSync', 'execFileSync']);

function _isTargetCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression') return false;
  if (callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  if (!obj || obj.type !== 'Identifier' || !prop || prop.type !== 'Identifier') return false;
  if (obj.name === 'fs' && FS_SYNC_METHODS.has(prop.name)) return true;
  if (EXEC_METHODS.has(prop.name) && obj.name !== 'child_process') return true;
  return false;
}

function _isFreeVarSyncCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee || callee.type !== 'Identifier') return false;
  if (EXEC_METHODS.has(callee.name)) return true;
  return false;
}

function _getCallName(callNode) {
  if (!callNode) return null;
  if (callNode.callee && callNode.callee.type === 'Identifier') return callNode.callee.name;
  if (callNode.callee && callNode.callee.type === 'MemberExpression' &&
      callNode.callee.property && callNode.callee.property.type === 'Identifier') {
    return callNode.callee.property.name;
  }
  return null;
}

function _errorMsgForMethod(name) {
  if (name && /exec/i.test(name)) return 'Command execution failed';
  if (name === 'readFileSync') return 'File read failed';
  if (name === 'writeFileSync') return 'File write failed';
  if (name === 'mkdirSync') return 'Directory creation failed';
  if (name === 'unlinkSync' || name === 'rmSync') return 'File deletion failed';
  return 'Operation failed';
}

// =====================================================================
// Parent map (cached per AST) — needed for ancestry queries
// =====================================================================
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

function _isInsideStringContext(ast, node) {
  const parentMap = _buildParentMap(ast);
  let cur = node;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'Literal' && typeof parent.value === 'string') return true;
    if (parent.type === 'TemplateLiteral') {
      if (parent.expressions && parent.expressions.includes(cur)) return false;
      return true;
    }
    cur = parent;
  }
  return false;
}

function _isDestructuringContext(ast, callNode) {
  const parentMap = _buildParentMap(ast);
  let cur = callNode;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'ObjectPattern') {
      const props = parent.id.properties || [];
      for (const p of props) {
        if (p.type === 'Property' && p.key && p.key.type === 'Identifier' &&
            p.value && p.value.type === 'Identifier' &&
            p.value.name === _getCallName(callNode)) {
          return true;
        }
      }
      return false;
    }
    if (parent.type === 'ExpressionStatement' || parent.type === 'Program') return false;
    cur = parent;
  }
  return false;
}

// =====================================================================
// Collect flagged CallExpression nodes (shared by detect/fix)
// Returns array of { node, line, startLine, endLine }
// =====================================================================
function _collectFlagged(content, parsed) {
  if (!parsed || !parsed.ast) return [];
  const { ast, lineOffset } = parsed;
  const tryBlockLines = buildTryBlockMap(content);
  if (tryBlockLines === null) return null; // signal: AST can't be trusted

  const flagged = [];
  helpers.walkAst(ast, (node, parent) => {
    // Skip if this is the .object of a MemberExpression (not a call site)
    if (parent && parent.type === 'MemberExpression' && parent.object === node) return;

    if (!_isTargetCall(node) && !_isFreeVarSyncCall(node)) return;
    if (_isDestructuringContext(ast, node)) return;
    if (_isInsideStringContext(ast, node)) return;
    if (!node.loc) return;

    const startLine = node.loc.start.line + lineOffset;
    if (tryBlockLines.has(startLine)) return;
    if (helpers.positionInComment(content, startLine, node.loc.start.column)) return;

    flagged.push({
      node,
      line: startLine,
      startLine,
      endLine: node.loc.end.line + lineOffset,
    });
  });

  return flagged;
}

// =====================================================================
// detect(content, filePath)
// =====================================================================
function detect(content, filePath) {
  helpers.clearAstCache();
  const parsed = helpers.parseAst(content, filePath);
  const flagged = _collectFlagged(content, parsed);
  if (flagged === null) {
    return { found: false, details: 'AST parse failed; rule skipped', lines: [], parseFailed: true };
  }
  if (flagged.length === 0) return { found: false, details: '', lines: [] };

  const lines = [...new Set(flagged.map(f => f.line))].sort((a, b) => a - b);
  return {
    found: true,
    details: `${lines.length} 個 fsSync/execSync 缺少 try-catch (AST)`,
    lines,
    severity: 'high',
    suggestion: '這些 fs/exec 同步調用應包在 try-catch 中防止程序崩潰',
  };
}

// =====================================================================
// fix(content, filePath) — wraps each flagged call in try-catch using AST
// node ranges so multi-line calls are handled correctly.
// =====================================================================
function fix(content, filePath) {
  helpers.clearAstCache();
  const parsed = helpers.parseAst(content, filePath);
  if (!parsed || !parsed.ast) return content;

  const flagged = _collectFlagged(content, parsed);
  if (!flagged || flagged.length === 0) return content;

  // Sort bottom-up to preserve offsets
  flagged.sort((a, b) => b.startLine - a.startLine);

  const lines = content.split('\n');

  for (const { node, startLine, endLine } of flagged) {
    const indent = lines[startLine - 1].match(/^\s*/)[0];
    const methodName = _getCallName(node);
    const errorMsg = _errorMsgForMethod(methodName);

    // Detect "const x = call(...)" / "let x = call(...)" / "var x = call(...)"
    // pattern: only when assignment starts at column 0 of startLine AND the
    // call's start column is after the `=`.
    const lineText = lines[startLine - 1];
    const assignMatch = lineText.match(/^(\s*)(const|let|var)\s+(\w+)\s*=\s*/);
    const hasAssignOnStartLine = !!assignMatch &&
      node.loc.start.column >= assignMatch[0].length;

    // Build the call text spanning startLine..endLine
    let callText;
    if (startLine === endLine) {
      // Single line — slice from start column to end column
      callText = lines[startLine - 1].slice(node.loc.start.column, node.loc.end.column);
    } else {
      // Multi-line — assemble fragments
      const startFragment = lines[startLine - 1].slice(node.loc.start.column);
      const middleLines = lines.slice(startLine, endLine - 1);
      const endFragment = lines[endLine - 1].slice(0, node.loc.end.column);
      callText = [startFragment, ...middleLines, endFragment].join('\n');
    }
    const cleanCall = callText.replace(/;\s*$/, '');

    let replacement;
    if (hasAssignOnStartLine && startLine === endLine) {
      // Single-line assignment: const x = call(...);
      const declKeyword = (assignMatch[2] === 'let' || assignMatch[2] === 'var') ? assignMatch[2] : 'let';
      const varName = assignMatch[3];
      replacement = [
        indent + declKeyword + ' ' + varName + ';',
        indent + 'try {',
        indent + '  ' + varName + ' = ' + cleanCall + ';',
        indent + '} catch (e) {',
        indent + '  console.error(`' + errorMsg + ': ${e.message}`);',
        indent + '}',
      ].join('\n');
    } else if (hasAssignOnStartLine && startLine !== endLine) {
      // Multi-line assignment: const x = call(\n  arg1,\n  arg2\n);
      const declKeyword = (assignMatch[2] === 'let' || assignMatch[2] === 'var') ? assignMatch[2] : 'let';
      const varName = assignMatch[3];
      // The original span lines[startLine..endLine] must be ENTIRELY replaced.
      // Keep the indent prefix + 'let varName;' as new declaration line.
      // The call content (already assembled as cleanCall) goes inside try.
      replacement = [
        indent + declKeyword + ' ' + varName + ';',
        indent + 'try {',
        indent + '  ' + cleanCall + ';',
        indent + '} catch (e) {',
        indent + '  console.error(`' + errorMsg + ': ${e.message}`);',
        indent + '}',
      ].join('\n');
    } else {
      // No assignment: bare call — wrap with try-catch
      replacement = [
        indent + 'try {',
        indent + '  ' + cleanCall + ';',
        indent + '} catch (e) {',
        indent + '  console.error(`' + errorMsg + ': ${e.message}`);',
        indent + '}',
      ].join('\n');
    }

    lines.splice(startLine - 1, endLine - startLine + 1, replacement);
  }

  return lines.join('\n');
}

module.exports = {
  id: 'fs-sync-trycatch',
  name: 'fs.*Sync / execSync 自動加 try-catch (AST)',
  category: 'reliability',

  detect(content, filePath) {
    return detect(content, filePath);
  },

  fix(content, filePath) {
    return fix(content, filePath);
  },

  // Exposed for testing
  _isTargetCall,
  _isFreeVarSyncCall,
  _isDestructuringContext,
  _collectFlagged,
};