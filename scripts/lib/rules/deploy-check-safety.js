/**
 * scripts/lib/rules/deploy-check-safety.js
 *
 * Safety detector for `auto_fix.js deploy-check`. Replaces the legacy inline
 * regex detector in auto_fix.js (which produced 16 false positives on every
 * run) with AST-aware detection.
 *
 * False-positive sources in the legacy detector (auto_fix.js lines 1630-1675):
 *   1. try-catch window too narrow — only checked 3 lines back from each call.
 *      The real try-block can be 10-30 lines back.
 *   2. Comment lines: a JS line comment containing a mention of a sync write
 *      inside a doc comment was flagged because raw regex doesn't strip
 *      comments.
 *   3. No existsSync guard awareness — calls like the early-return pattern
 *      around `fs.existsSync(p)` are clearly safe but were flagged.
 *   4. No string-context awareness — logging a string that mentions a sync
 *      write call was flagged.
 *
 * This detector fixes all four by walking the AST.
 *
 * Design contract:
 *   - export `detect(content, filePath)` returning:
 *       { found: boolean, lines: number[], details: string, parseFailed?: boolean }
 *   - `parseFailed: true` means acorn couldn't parse; caller should fall back
 *     to legacy detection (or skip) to avoid masking real issues.
 *
 * Implementation notes:
 *   - Reuses buildTryBlockMap (proven AST try-catch detection).
 *   - Reuses ast-helpers.positionInComment (proven comment detection).
 *   - Reuses fs-sync-trycatch.ast.js's _isTargetCall / _isFreeVarSyncCall.
 */

'use strict';

const helpers = require('./ast-helpers');
const { buildTryBlockMap } = require('../audit/try-block-map');
const fsSyncAst = require('./fs-sync-trycatch.ast');

// =====================================================================
// Target call detection (delegated to fs-sync-trycatch.ast.js — single source of truth)
// =====================================================================
const _isTargetCall = fsSyncAst._isTargetCall;
const _isFreeVarSyncCall = fsSyncAst._isFreeVarSyncCall;
const _isInsideStringContext = _buildIsInsideStringContext();

function _buildIsInsideStringContext() {
  // The fs-sync-trycatch.ast module has _isInsideStringContext internally but
  // does not export it. We re-implement a small version using the parent
  // chain — same algorithm, ~10 LOC.
  const cache = new WeakMap();
  function buildParentMap(ast) {
    if (cache.has(ast)) return cache.get(ast);
    const map = new WeakMap();
    helpers.walkAst(ast, (node, parent) => {
      if (parent) map.set(node, parent);
    });
    cache.set(ast, map);
    return map;
  }
  return function isInsideStringContext(ast, node) {
    const parentMap = buildParentMap(ast);
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
  };
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

// =====================================================================
// existsSync guard detection (NEW — fixes false positive #3)
//
// Pattern: the call is reachable only when fs.existsSync(p) returns a known
// value. Common forms:
//
//   if (!fs.existsSync(p)) return/continue/throw;
//   fs.readFileSync(p);                       // SAFE: p is guaranteed to exist
//
//   if (fs.existsSync(p)) {
//     const content = fs.readFileSync(p);     // SAFE: p is guaranteed to exist
//   }
//
// We walk the parent chain looking for an `IfStatement` whose test mentions
// `fs.existsSync(...)`. If we find one and the call sits inside the body
// (or sits after an early-return guard), we mark it as guarded.
//
// Returns true if the call is existsSync-guarded.
// =====================================================================
function _isGuardedByExistsSync(ast, callNode, fsShadowed) {
  // Build parent map
  const parentMap = new WeakMap();
  helpers.walkAst(ast, (node, parent) => {
    if (parent) parentMap.set(node, parent);
  });

  // Walk up to find the nearest enclosing IfStatement whose test mentions
  // fs.existsSync. We check THREE patterns:
  //
  //  Pattern A — call inside the then-branch (positive form):
  //    if (fs.existsSync(p)) { fs.readFileSync(p); }     ← guarded
  //
  //  Pattern B — call inside the else-branch (negative form):
  //    if (!fs.existsSync(p)) { ... } else { fs.readFileSync(p); }  ← guarded
  //
  //  Pattern C — call AFTER the if (early-return form):
  //    if (!fs.existsSync(p)) return;
  //    fs.readFileSync(p);                                  ← guarded

  let cur = callNode;
  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) return false;
    if (parent.type === 'IfStatement') {
      if (parent.test && _testCallsExistsSync(parent.test)) {
        // Pattern A: call inside then-branch
        if (parent.consequent && _isDescendantOf(cur, parent.consequent, parentMap)) {
          return true;
        }
        // Pattern B: call inside else-branch (only safe with negated test)
        if (parent.alternate && _isDescendantOf(cur, parent.alternate, parentMap)) {
          if (_testIsNegatedExistsSync(parent.test)) return true;
        }
      }
    }
    // Pattern C: when we hit a BlockStatement that contains the callNode,
    // check whether the BlockStatement also contains an early-exit IfStatement
    // that comes BEFORE the callNode's containing statement.
    if (parent.type === 'BlockStatement' || parent.type === 'Program') {
      const siblings = parent.body || [];
      const callSiblingIdx = _findContainingStatementIdx(siblings, callNode, parentMap);
      if (callSiblingIdx === -1) {
        cur = parent;
        continue;
      }
      for (let i = callSiblingIdx - 1; i >= 0; i--) {
        const prev = siblings[i];
        if (!prev) continue;
        // Check if this is an early-exit existsSync guard
        if (_isEarlyExitExistsSyncGuard(prev, fsShadowed)) {
          const guardPath = _extractExistsSyncPathArg(prev.test);
          if (guardPath && _callReferencesName(callNode, guardPath)) {
            if (_noInterveningUnguardedBranches(siblings, i + 1, callSiblingIdx, parentMap, fsShadowed)) {
              return true;
            }
          }
        }
        // Break on unconditional exits (return/throw/break/continue/function)
        if (prev.type === 'ReturnStatement' || prev.type === 'ThrowStatement' ||
            prev.type === 'BreakStatement' || prev.type === 'ContinueStatement' ||
            prev.type === 'FunctionDeclaration') {
          break;
        }
        // For if-without-else: only break if call is OUTSIDE the consequent
        // (guard can't protect it). Otherwise continue — the if might have nested guards.
        if (prev.type === 'IfStatement' && !prev.alternate) {
          const callInsideConsequent = _isDescendantOf(callNode, prev.consequent, parentMap);
          if (!callInsideConsequent) break; // call not protected by this if
          // else: call IS inside consequent, continue scanning for earlier guards
        }
        // Loops and switches always break (they can invalidate prior guards)
        if (prev.type === 'ForStatement' || prev.type === 'WhileStatement' ||
            prev.type === 'ForInStatement' || prev.type === 'ForOfStatement' ||
            prev.type === 'DoWhileStatement' || prev.type === 'SwitchStatement') {
          break;
        }
        // VariableDeclarations and other statements — continue
      }
    }
    cur = parent;
  }
  return false;
}

function _findContainingStatementIdx(statements, targetNode, parentMap) {
  // Find which statement in `statements` is an ancestor (or self) of targetNode.
  let cur = targetNode;
  while (cur) {
    const idx = statements.indexOf(cur);
    if (idx !== -1) return idx;
    const p = parentMap.get(cur);
    if (!p) return -1;
    cur = p;
  }
  return -1;
}

// Recursively scan a block body for an inner negated-existsSync guard.
// This handles: if(x){ if(!fs.existsSync(p))return; }
function _scanBlockForGuard(blockBody, fsShadowed) {
  if (!blockBody || !Array.isArray(blockBody)) return false;
  for (const stmt of blockBody) {
    if (stmt.type === 'IfStatement') {
      if (_testIsNegatedExistsSync(stmt.test, fsShadowed)) return true;
      // Recurse into consequent/alternate blocks
      if (stmt.consequent && stmt.consequent.type === 'BlockStatement') {
        if (_scanBlockForGuard(stmt.consequent.body, fsShadowed)) return true;
      }
      if (stmt.alternate && stmt.alternate.type === 'BlockStatement') {
        if (_scanBlockForGuard(stmt.alternate.body, fsShadowed)) return true;
      }
    }
    // Stop at unconditional exits — nothing after them can be a guard
    if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement' ||
        stmt.type === 'BreakStatement' || stmt.type === 'ContinueStatement') {
      break;
    }
  }
  return false;
}

function _isEarlyExitExistsSyncGuard(node, fsShadowed) {
  // Match: `if (!fs.existsSync(p)) return/throw/break/continue;`
  // or a block containing such a guard (nested if pattern).
  if (!node || node.type !== 'IfStatement') return false;
  if (_testIsNegatedExistsSync(node.test, fsShadowed)) return true;
  if (_isEarlyExitStatement(node.consequent)) return true;
  // Check if consequent is a BlockStatement containing an early-exit guard
  if (node.consequent && node.consequent.type === 'BlockStatement') {
    if (_scanBlockForGuard(node.consequent.body, fsShadowed)) return true;
  }
  return false;
}

function _isControlFlowStatement(node) {
  if (!node) return false;
  // Only break on statements that DEFINITELY change control flow in a way
  // that invalidates a prior guard. We recurse into most structures.
  // Break on: return/throw/break/continue (definite exits)
  // Allow through: if/for/while/switch (may contain guards inside)
  return (
    node.type === 'ReturnStatement' ||
    node.type === 'ThrowStatement' ||
    node.type === 'BreakStatement' ||
    node.type === 'ContinueStatement'
  );
}

function _isEarlyExitStatement(node) {
  if (!node) return false;
  // Single-statement consequent (no braces) is itself the early exit.
  if (node.type === 'ReturnStatement' ||
      node.type === 'ThrowStatement' ||
      node.type === 'BreakStatement' ||
      node.type === 'ContinueStatement') {
    return true;
  }
  // Block whose only statement is an early exit.
  if (node.type === 'BlockStatement' && node.body.length === 1 &&
      (node.body[0].type === 'ReturnStatement' ||
       node.body[0].type === 'ThrowStatement' ||
       node.body[0].type === 'BreakStatement' ||
       node.body[0].type === 'ContinueStatement')) {
    return true;
  }
  return false;
}

function _findStatementAncestor(statements, targetNode, parentMap) {
  // Walk up from targetNode; if any ancestor is in the statements array,
  // return its index.
  let cur = targetNode;
  while (cur) {
    const idx = statements.indexOf(cur);
    if (idx !== -1) return idx;
    const p = parentMap.get(cur);
    if (!p) return -1;
    cur = p;
  }
  return -1;
}

function _noInterveningUnguardedBranches(statements, startIdx, endIdx, parentMap, fsShadowed) {
  // If fs is shadowed by a local variable, guards are unreliable
  if (fsShadowed) return false;
  // Walk statements[startIdx..endIdx-1]. If any statement is a function
  // declaration, an if-without-else that could re-route control flow, or
  // anything that could re-introduce risk, return false.
  for (let i = startIdx; i < endIdx; i++) {
    const s = statements[i];
    if (!s) continue;
    // A nested function declaration redefines the scope.
    if (s.type === 'FunctionDeclaration') return false;
    // An if-statement with no else could leave us unguarded on its other branch
    // UNLESS its consequent contains an inner negated existsSync guard
    // (the outer if protects the call in the "then" path).
    if (s.type === 'IfStatement' && !s.alternate) {
      if (!_consequentHasNegatedExistsSyncGuard(s.consequent)) return false;
    }
    // A loop with the fs.existsSync check inside could re-evaluate the guard
    if (s.type === 'ForStatement' || s.type === 'WhileStatement' ||
        s.type === 'ForInStatement' || s.type === 'ForOfStatement' ||
        s.type === 'DoWhileStatement') return false;
    // A switch could branch
    if (s.type === 'SwitchStatement') return false;
    // VariableDeclaration that re-assigns fs or path could invalidate the guard
    if (s.type === 'VariableDeclaration') {
      for (const decl of (s.declarations || [])) {
        if (!decl.init) continue;
        const name = decl.id && decl.id.name;
        if (!name) continue;
        // If this variable shadows 'fs' or 'path', the guard's fs reference
        // may no longer point to the same module — bail out.
        if (name === 'fs' || name === 'path') return false;
      }
    }
  }
  return true;
}

// Check if a consequent BlockStatement (or single statement) contains
// an inner IfStatement whose test is a negated existsSync guard.
// This is used to handle the nested-guard pattern:
//   if (x) { if (!fs.existsSync(p)) return; }
//   fs.readFileSync(p);   ← safe (protected by inner guard)
function _consequentHasNegatedExistsSyncGuard(consequent) {
  if (!consequent) return false;
  const stmts = consequent.type === 'BlockStatement' ? consequent.body : [consequent];
  for (const stmt of stmts) {
    if (stmt.type === 'IfStatement') {
      if (stmt.test && _testIsNegatedExistsSync(stmt.test)) return true;
      // Recurse into nested ifs inside this if's consequent
      if (stmt.consequent && _consequentHasNegatedExistsSyncGuard(stmt.consequent)) return true;
    }
    // Stop at statements that are not guard-carrying
    if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement' ||
        stmt.type === 'ContinueStatement' || stmt.type === 'BreakStatement') {
      break;
    }
  }
  return false;
}

function _extractExistsSyncPathArg(testNode) {
  // Unwrap leading `!` if present
  let t = testNode;
  if (t && t.type === 'UnaryExpression' && t.operator === '!') {
    t = t.argument;
  }
  if (!t || t.type !== 'CallExpression') return null;
  if (!t.callee || t.callee.type !== 'MemberExpression') return null;
  if (!t.callee.object || t.callee.object.type !== 'Identifier') return null;
  if (t.callee.object.name !== 'fs') return null;
  if (!t.callee.property || t.callee.property.type !== 'Identifier') return null;
  if (t.callee.property.name !== 'existsSync') return null;
  if (!t.arguments || t.arguments.length === 0) return null;
  const arg = t.arguments[0];
  if (arg.type === 'Identifier') return arg.name;        // e.g. fs.existsSync(p) → 'p'
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    return JSON.stringify(arg.value);                    // e.g. fs.existsSync('/tmp/x') → '"/tmp/x"'
  }
  // e.g. fs.existsSync(path.join('/tmp', name)) - extract identifiers/literals
  // from inside the call so _callReferencesName can still match them.
  if (arg.type === 'CallExpression' && arg.arguments) {
    const extracted = [];
    for (const inner of arg.arguments) {
      if (inner.type === 'Identifier') extracted.push(inner.name);
      if (inner.type === 'Literal' && typeof inner.value === 'string') {
        extracted.push(JSON.stringify(inner.value));
      }
    }
    return extracted.length > 0 ? extracted.join('|') : null;
  }
  return null;
}

function _callReferencesName(callNode, nameOrLiteral) {
  // Returns true if any of callNode.arguments references the same identifier
  // (by name) or literal (by value) as the guard's existsSync argument.
  // Handles the '|' separator used when extracting from path.join() calls.
  if (!callNode.arguments) return false;
  const names = String(nameOrLiteral).split('|');
  for (const arg of callNode.arguments) {
    if (arg.type === 'Identifier' && names.includes(arg.name)) return true;
    if (arg.type === 'Literal' && names.includes(JSON.stringify(arg.value))) return true;
    // For path built via concatenation: path.join(X, f) — be conservative and
    // accept if X matches. This may over-relax in rare cases but covers the
    // common `path.join(dir, file)` pattern.
    if (arg.type === 'CallExpression' && arg.arguments) {
      for (const inner of arg.arguments) {
        if (inner.type === 'Identifier' && names.includes(inner.name)) return true;
        if (inner.type === 'Literal' && names.includes(JSON.stringify(inner.value))) return true;
      }
    }
  }
  return false;
}

function _testCallsExistsSync(testNode) {
  if (!testNode) return false;
  let found = false;
  helpers.walkAst(testNode, (n) => {
    if (n.type === 'CallExpression' &&
        n.callee && n.callee.type === 'MemberExpression' &&
        n.callee.object && n.callee.object.type === 'Identifier' &&
        n.callee.object.name === 'fs' &&
        n.callee.property && n.callee.property.type === 'Identifier' &&
        n.callee.property.name === 'existsSync') {
      found = true;
    }
  });
  return found;
}

function _testIsNegatedExistsSync(testNode) {
  // Match `!fs.existsSync(...)` (single UnaryExpression with operator '!')
  if (testNode.type === 'UnaryExpression' && testNode.operator === '!' &&
      testNode.argument && _testCallsExistsSync(testNode.argument)) {
    return true;
  }
  return false;
}

function _isDescendantOf(startNode, target, parentMap) {
  // Walk up via parent map looking for `target`. Returns true if `target`
  // is an ancestor of (or equal to) startNode.
  let cur = startNode;
  while (cur) {
    if (cur === target) return true;
    cur = parentMap.get(cur) || null;
  }
  return false;
}

// =====================================================================
// Comment-line detection
//
// `// uses fs.writeFileSync(...)` inside a single-line comment was flagged by
// the legacy regex. We use ast-helpers.positionInComment which works on
// extracted comment ranges.
// =====================================================================
function _isInComment(content, callNode) {
  if (!callNode.loc) return false;
  return !!helpers.positionInComment(content, callNode.loc.start.line, callNode.loc.start.column);
}

// =====================================================================
// Main detect
// =====================================================================
function detect(content, filePath) {
  helpers.clearAstCache();
  const parsed = helpers.parseAst(content, filePath);
  if (!parsed || !parsed.ast) {
    // Parse failure: caller decides. Returning `parseFailed: true` is the
    // signal — auto_fix.js can either skip or fall back to legacy.
    return { found: false, lines: [], details: '', parseFailed: true };
  }
  const { ast, lineOffset } = parsed;

  // Build the set of lines inside any try-block. AST-based, no false positives
  // from try-blocks far away (the legacy regex used a 3-line window which
  // missed cases where the try opens 10-30 lines back).
  let tryBlockLines;
  try {
    const result = buildTryBlockMap(content);
    tryBlockLines = (result && typeof result.has === 'function') ? result : new Set();
  } catch (_) {
    tryBlockLines = new Set();
  }


  // Track if 'fs' is shadowed by a local non-require assignment.
  // Skip CallExpression nodes so we don't enter require() arguments.
  let fsShadowed = false;
  helpers.walkAst(ast, (node) => {
    if (node.type === 'CallExpression') return; // skip into call args
    if (node.type === 'VariableDeclaration') {
      for (const decl of (node.declarations || [])) {
        if (decl.id && decl.id.type === 'Identifier' && decl.id.name === 'fs' && decl.init) {
          // const fs = require("fs") — safe, skip silently
          if (decl.init.type === 'CallExpression' &&
              decl.init.callee && decl.init.callee.type === 'Identifier' &&
              decl.init.callee.name === 'require') continue;
          // anything else (object, function, other var) — shadowed
          fsShadowed = true;
        }
      }
    }
  });

  const flagged = [];
  helpers.walkAst(ast, (node, parent) => {
    // Skip the .object of a MemberExpression (not a call site)
    if (parent && parent.type === 'MemberExpression' && parent.object === node) return;

    if (!_isTargetCall(node) && !_isFreeVarSyncCall(node)) return;
    if (_isInsideStringContext(ast, node)) return;
    if (_isInComment(content, node)) return;
    if (!node.loc) return;

    const startLine = node.loc.start.line + lineOffset;

    // 1. Skip if already inside try-catch (AST-reliable)
    if (tryBlockLines.has(startLine)) return;

    // 2. Skip if guarded by existsSync (e.g. `if (!fs.existsSync(p)) return;`)
    if (_isGuardedByExistsSync(ast, node, fsShadowed)) {
      return;
    }

    // 3. If fs was shadowed and guard check failed, flag it
    if (fsShadowed) {
      flagged.push(startLine);
      return;
    }

    // 4. Not guarded → flag it
    flagged.push(startLine);
  });

  // Deduplicate lines
  const lines = [...new Set(flagged)].sort((a, b) => a - b);

  return {
    found: lines.length > 0,
    lines,
    details: lines.length === 0
      ? ''
      : `${lines.length} 個 fsSync/execSync 缺少 try-catch / existsSync guard`,
  };
}

module.exports = {
  detect,
  // Exposed for testing
  _isGuardedByExistsSync,
  _isInComment,
};
