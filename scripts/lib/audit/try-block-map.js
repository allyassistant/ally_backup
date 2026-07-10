'use strict';
const acorn = require('acorn');

/**
 * AST-based try-block map. Returns Set<1-indexed-line-number> for every line
 * that lies inside a try, catch, or finally block. Returns null if acorn
 * cannot parse the file (caller falls back to brace-depth heuristic).
 *
 * Why AST? The legacy brace-depth walker had two failure modes:
 *   - Wrong on inline try-catch with nested object literals (Bug A).
 *   - Wrong when the same file has multiple try-blocks at different scopes
 *     (the walker returns true on the first prior `try {` regardless of
 *     whether the target line actually falls inside that block).
 *
 * Cost: ~5-20ms for a 1000-line file. Well within the <2s target.
 */
function buildTryBlockMap(content) {
  // Strip shebang (`#!...`) before parsing — acorn doesn't allow it but real
  // Node scripts use it. Track the line offset so we can shift AST line
  // numbers back to the original file's numbering (otherwise L128 becomes
  // L127 in the AST and we'd mis-attribute try-blocks).
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
  } catch (_) {
    return null;
  }
  const linesInsideTry = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'TryStatement' && node.loc) {
      // Mark lines inside the try-block body (shifted by shebang offset)
      if (node.block && node.block.loc) {
        for (let ln = node.block.loc.start.line + lineOffset; ln <= node.block.loc.end.line + lineOffset; ln++) {
          linesInsideTry.add(ln);
        }
      }
      // Mark lines inside the catch handler
      if (node.handler && node.handler.body && node.handler.body.loc) {
        for (let ln = node.handler.body.loc.start.line + lineOffset; ln <= node.handler.body.loc.end.line + lineOffset; ln++) {
          linesInsideTry.add(ln);
        }
      }
      // Mark lines inside the finally block
      if (node.finalizer && node.finalizer.loc) {
        for (let ln = node.finalizer.loc.start.line + lineOffset; ln <= node.finalizer.loc.end.line + lineOffset; ln++) {
          linesInsideTry.add(ln);
        }
      }
    }

    // Recurse — TryStatement children handled above, but nested function
    // bodies etc. need full traversal.
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) visit(item);
      } else if (child && typeof child === 'object' && child.type) {
        visit(child);
      }
    }
  }

  visit(ast);
  return linesInsideTry;
}
module.exports = { buildTryBlockMap };
