/**
 * scripts/lib/rules/hardcoded-home-path.ast.js
 *
 * AST-aware version of the `hardcoded-home-path` rule.
 *
 * Bug class fixed by AST migration:
 *   1. Replaced `'/Users/username/...'` even when it was a string literal arg to
 *      console.log() — corrupting log output ("/Users/username/.config" appearing
 *      in console.error messages).
 *   2. Replaced paths in JSDoc comments (line that starts with `*` or `//`)
 *      was actually excluded, but lines like ` * @example '/Users/username/x'`
 *      slipped through. The legacy regex check on `trimmed.startsWith('*')`
 *      was fragile — a leading whitespace before `*` made it look like code.
 *   3. Could replace a path that was actually a code-path argument to
 *      `path.join('/Users/username/x', y)` where the path is dynamically built —
 *      fine — but ALSO in `console.log('/Users/username/x')` where it's just a
 *      string for display.
 *
 * AST approach:
 *   - Walk `Literal` nodes with string value matching `/Users/<homeUser>` or
 *     `/home/<homeUser>`.
 *   - SKIP if the Literal is inside a "log-like" CallExpression (console.log,
 *     console.error, etc.) — these are display strings, not paths.
 *   - SKIP if the Literal is the argument to `require()` — those are module
 *     specifiers (rare with absolute paths, but possible).
 *   - SKIP if the Literal is the value of a const declaration AND the same
 *     const is later referenced (the const represents a path that's used).
 *   - ALLOW replace in: path.join(), path.resolve(), fs operations, etc.
 *
 * This is a conservative rule — when in doubt, skip. Better to leave a few
 * hardcoded paths than to corrupt log strings.
 */

'use strict';

const path = require('path');
const helpers = require('./ast-helpers');

let HOME;
try {
  ({ HOME } = require('../config'));
} catch {
  HOME = process.env.HOME || '/Users/ally';
}

const homeUser = path.basename(HOME);

// Methods that take a path as first argument (these we DO rewrite)
const PATH_CONSUMING_METHODS = new Set([
  // fs operations
  'readFileSync', 'writeFileSync', 'unlinkSync', 'rmSync', 'mkdirSync',
  'copyFileSync', 'accessSync', 'statSync', 'readdirSync', 'lstatSync',
  'existsSync', 'createReadStream', 'createWriteStream', 'openSync', 'readSync', 'appendFileSync',
  // path operations
  'join', 'resolve', 'dirname', 'basename', 'relative',
  // shell / spawn operations
  'execSync', 'execFileSync', 'spawnSync', 'spawn',
  // os
  'homedir',
]);

// Methods where the string argument is just for display/logging — SKIP
const LOG_METHODS = new Set([
  'log', 'info', 'warn', 'error', 'debug', 'trace', 'dir',
]);

function _stringLiteralValue(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function _matchesHomePath(str) {
  if (typeof str !== 'string') return false;
  return str.includes(`/Users/${homeUser}/`) || str.includes(`/Users/${homeUser}`) ||
         str.startsWith(`/Users/${homeUser}`) ||
         str.includes(`/home/${homeUser}/`) || str.includes(`/home/${homeUser}`) ||
         str.startsWith(`/home/${homeUser}`);
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
 * Decide if we should SKIP rewriting this Literal. Returns reason string or null.
 *
 * Conservative: when in doubt, SKIP. The legacy rule was over-aggressive;
 * this rule only rewrites literals that are CLEARLY path arguments to
 * path-consuming functions like path.join / fs.readFileSync.
 *
 * Special: if we're rewriting to `$HOME`, the literal must be inside a
 * context where shell/JS-template substitution makes sense:
 *   - Template literal (backticks): `${'...$HOME...'}` works at runtime
 *   - First arg of path.join / fs.*Sync / etc.: works because the consumer
 *     resolves the path against the current process's HOME env var
 *
 * Standalone string literals (e.g. `const HOME = '/Users/ally'`) are NOT
 * rewritten — replacing with `$HOME` would change semantics in JS (where
 * `$HOME` is just a literal, not env var expansion).
 */
function _shouldSkip(ast, literalNode) {
  const parentMap = _buildParentMap(ast);
  let cur = literalNode;

  // First: if the literal's parent is a VariableDeclarator with simple
  // string-literal init (const x = '...'), skip — it's a value, not a path.
  let p = parentMap.get(cur);
  if (p && p.type === 'VariableDeclarator' && p.init === cur) {
    return 'string value of const/let/var';
  }
  if (p && p.type === 'AssignmentExpression' && p.right === cur) {
    return 'right-hand side of assignment';
  }

  while (cur) {
    const parent = parentMap.get(cur);
    if (!parent) break;

    // Skip if inside a comment (defensive)
    if (parent.type === 'Line' || parent.type === 'Block') return 'in comment';

    // Skip if inside a string literal context (defensive — Literal child of
    // Literal means it's a TaggedTemplateExpression or similar — not common)
    if (parent.type === 'Literal' && typeof parent.value === 'string') return 'in string literal';

    // Check CallExpression: is this argument a path or a log message?
    if (parent.type === 'CallExpression') {
      const callee = parent.callee;
      if (callee) {
        // Member expression callee: obj.method(...)
        if (callee.type === 'MemberExpression' && !callee.computed &&
            callee.property && callee.property.type === 'Identifier') {
          const objName = callee.object && callee.object.type === 'Identifier' ? callee.object.name : null;
          const methodName = callee.property.name;

          // Skip console.log/error/etc. — these are display strings
          if (objName === 'console' && LOG_METHODS.has(methodName)) {
            return 'console.log/string';
          }

          // Skip require() — module specifier
          if (methodName === 'require' && objName === null) {
            return 'require()';
          }

          // Check: is this arg the FIRST argument of a path-consuming method?
          // If so, ALLOW the rewrite (we DO want to fix these).
          // If it's a later arg, SKIP (it might be a log message that happens
          // to contain the path).
          const argIdx = parent.arguments.indexOf(cur);
          if (argIdx === 0 && PATH_CONSUMING_METHODS.has(methodName)) {
            return null; // ALLOW rewrite
          }
          if (argIdx > 0) {
            return 'non-first arg of ' + methodName;
          }
        }
      }
      // Otherwise (e.g. plain Identifier call) — skip to be safe
      return 'unknown call arg';
    }

    // Template literal context — allow if it's a top-level template literal
    // (not a quasi fragment). Otherwise skip.
    if (parent.type === 'TemplateLiteral') {
      if (parent.quasis && parent.quasis.includes(cur)) {
        // We're a quasi (literal portion). Allow rewrite ONLY if the parent
        // is itself a top-level expression (e.g. `\`${...}/Users/username/foo\``)
        const grandparent = parentMap.get(parent);
        if (grandparent && (grandparent.type === 'ExpressionStatement' ||
            grandparent.type === 'TemplateExpression' ||
            grandparent.type === 'TaggedTemplateExpression')) {
          // Standalone template literal — rewriting the string content to
          // use `$HOME` literal wouldn't work (template literals don't
          // expand `$HOME` automatically). SKIP to be safe.
          return 'template literal value';
        }
        return null;
      }
      return 'template literal expression';
    }

    // Skip if literal is the key of an ObjectProperty
    if (parent.type === 'Property' && parent.key === cur && !parent.computed) {
      return 'object key';
    }

    // Skip if literal is the source of an ImportDeclaration
    if (parent.type === 'ImportDeclaration' && parent.source === cur) {
      return 'import source';
    }

    // Skip if literal is the source of an ExportAllDeclaration
    if (parent.type === 'ExportAllDeclaration' && parent.source === cur) {
      return 'export source';
    }

    // Skip if literal is the argument to JSON.parse / JSON.stringify
    if (parent.type === 'CallExpression' && parent.callee &&
        parent.callee.type === 'MemberExpression' && !parent.callee.computed &&
        parent.callee.object && parent.callee.object.name === 'JSON' &&
        ['parse', 'stringify'].includes(parent.callee.property.name)) {
      return 'JSON.parse/stringify';
    }

    // Top-level expression statement: bare string literal like
    // `'/Users/username/foo';` — just a value, not a path. Skip.
    if (parent.type === 'ExpressionStatement') {
      return 'bare expression statement';
    }

    cur = parent;
  }
  return 'no path-consuming context';
}

// =====================================================================
// detect(content, filePath)
// =====================================================================
function detect(content, filePath) {
  const ext = path.extname(filePath);
  if (!['.js', '.mjs', '.cjs', '.sh', '.bash', '.zsh'].includes(ext)) {
    return { found: false, details: '', lines: [] };
  }

  helpers.clearAstCache();
  const parsed = helpers.parseAst(content, filePath);

  // For shell scripts, AST parsing isn't applicable — fall back to legacy behavior
  // but with safer comment detection.
  if (['.sh', '.bash', '.zsh'].includes(ext)) {
    return _detectShell(content);
  }

  if (!parsed || !parsed.ast) {
    return { found: false, details: 'AST parse failed; rule skipped', lines: [], parseFailed: true };
  }

  const { ast, lineOffset } = parsed;
  const foundLines = new Set();

  helpers.walkAst(ast, (node) => {
    const value = _stringLiteralValue(node);
    if (value === null) return;
    if (!_matchesHomePath(value)) return;

    const skipReason = _shouldSkip(ast, node);
    if (skipReason) return;

    if (node.loc) {
      foundLines.add(node.loc.start.line + lineOffset);
    }
  });

  const lines = [...foundLines].sort((a, b) => a - b);
  if (lines.length === 0) return { found: false, details: '', lines: [] };
  return {
    found: true,
    details: `${lines.length} 行有硬編碼路徑 (AST)`,
    lines,
  };
}

function _detectShell(content) {
  const lines = content.split('\n');
  const found = [];
  const inCodeBlock = { value: false };
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Skip comment lines
    if (trimmed.startsWith('#')) return;
    if (new RegExp(`/(?:Users|home)/${homeUser}/`).test(line)) found.push(i + 1);
  });
  return {
    found: found.length > 0,
    details: `${found.length} 行有硬編碼路徑`,
    lines: found,
  };
}

// =====================================================================
// fix(content, filePath)
// =====================================================================
function fix(content, filePath) {
  const ext = path.extname(filePath);
  if (!['.js', '.mjs', '.cjs', '.sh', '.bash', '.zsh'].includes(ext)) return content;

  helpers.clearAstCache();
  const parsed = helpers.parseAst(content, filePath);

  if (['.sh', '.bash', '.zsh'].includes(ext)) {
    return _fixShell(content);
  }

  if (!parsed || !parsed.ast) return content;

  const { ast, lineOffset } = parsed;

  // Collect literals to rewrite (node + replacement text)
  const toRewrite = [];
  helpers.walkAst(ast, (node) => {
    const value = _stringLiteralValue(node);
    if (value === null) return;
    if (!_matchesHomePath(value)) return;
    const skipReason = _shouldSkip(ast, node);
    if (skipReason) return;
    if (!node.loc) return;

    // Build replacement: $HOME (POSIX) — works in both shell and JS-template contexts
    const newValue = value
      .replace(new RegExp(`/Users/${homeUser}`, 'g'), '$HOME')
      .replace(new RegExp(`/home/${homeUser}`, 'g'), '$HOME');

    toRewrite.push({ node, newValue, line: node.loc.start.line + lineOffset });
  });

  if (toRewrite.length === 0) return content;

  // Sort by line DESC so we rewrite bottom-up (preserve offsets)
  toRewrite.sort((a, b) => b.line - a.line);

  const lines = content.split('\n');
  for (const { node, newValue } of toRewrite) {
    const start = node.loc.start;
    const end = node.loc.end;
    // For Literal, the source is the raw text including quotes
    const originalRaw = helpers.getNodeText(content, node);

    // Rebuild with new value: keep quote style, replace value
    const quoteChar = originalRaw[0]; // ', ", or `
    let newRaw;
    if (quoteChar === '`') {
      // Template literal: ${} doesn't work for path substitution directly
      // (template literal evaluates at runtime, but `$HOME` in template is fine)
      newRaw = '`' + newValue + '`';
    } else {
      newRaw = quoteChar + newValue + quoteChar;
    }

    lines.splice(
      start.line - 1,
      end.line - start.line + 1,
      lines[start.line - 1].slice(0, start.column) +
      newRaw +
      lines[end.line - 1].slice(end.column)
    );
  }

  return lines.join('\n');
}

function _fixShell(content) {
  // Simple shell path replacement (no AST available)
  const lines = content.split('\n');
  const fixed = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return line;
    return line.replace(
      new RegExp(`/(?:Users|home)/${homeUser}`, 'g'),
      '$HOME'
    );
  });
  return fixed.join('\n');
}

module.exports = {
  id: 'hardcoded-home-path',
  name: '替換硬編碼路徑 (AST)',
  category: 'bug',

  detect(content, filePath) {
    return detect(content, filePath);
  },

  fix(content, filePath) {
    return fix(content, filePath);
  },

  // Exposed for testing
  _matchesHomePath,
  _shouldSkip,
};