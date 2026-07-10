#!/usr/bin/env node
/**
 * scripts/lib/dependency_graph.js — Layer 2 cross-file dependency graph
 *
 * Builds a lightweight require()/import relationship graph across all
 * .js/.mjs/.cjs files in ~/.openclaw/workspace/. No AST, no third-party
 * deps — regex-only parsing that handles the OpenClaw code style
 * (CommonJS `require('./foo')`, ESM `import x from './foo'`, dynamic
 * `import('./foo')`, and Node built-ins like `require('node:fs')`).
 *
 * Public API:
 *   const graph = buildDependencyGraph(workspacePath);
 *   graph.nodes                       // [{path, type, tier}]
 *   graph.edges                       // [{from, to, type, line}]
 *   graph.reverseEdges                // Map<path, [from]> (dependents index)
 *
 *   getDependents(graph, filePath)    // string[] (files that depend on this)
 *   getDependencies(graph, filePath)  // string[] (files this depends on)
 *
 * Tier classification: replicated from scripts/audit_repair_wire.js
 * (kept here to avoid createRequire/ESM bridge in a library module).
 *
 * Self-Healing Loop — Layer 2 (Phase 2h)
 * Created: 2026-06-19
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────
const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.state', '.issues', '.analysis',
  '.fix_snapshots', 'archive', '_archive', '_legacy', '__pycache__',
]);

// Node built-in modules we never resolve (no point tracking them).
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'child_process', 'http', 'https', 'url',
  'util', 'events', 'stream', 'buffer', 'process', 'module', 'require',
  'node:fs', 'node:path', 'node:os', 'node:crypto', 'node:child_process',
  'node:http', 'node:https', 'node:url', 'node:util', 'node:events',
  'node:stream', 'node:buffer', 'node:process',
]);

// Tier classifier (replicated from audit_repair_wire.js — see rationale in
// the module header). Production = cron/auto/daily/session/monitor/triage
// entrypoints or shell scripts or anything under archive/. Utility = rest.
const PRODUCTION_PATH_RE = new RegExp(
  '^scripts/(' +
  '(cron_|auto_|daily_|session_|.*_runner|.*_monitor|.*_triage)' +
  ')[^/]*\\.js$',
  'i'
);
const PRODUCTION_BASENAME_RE = /^(cron_|daily_|session_).*\.js$/i;

function classifyTier(relPath) {
  if (!relPath) return 'utility';
  const p = relPath.replace(/^\.\//, '');
  const base = path.basename(p);
  if (/\.sh$|\.bash$|\.zsh$/i.test(p)) return 'production';
  if (/\.sh$|\.bash$|\.zsh$/i.test(base)) return 'production';
  if (/\/archive\//.test(p)) return 'production';
  if (PRODUCTION_PATH_RE.test(p)) return 'production';
  if (PRODUCTION_BASENAME_RE.test(base)) return 'production';
  return 'utility';
}

// ── Import / require regexes ──────────────────────────────────────────────
// 1. CommonJS:  require('./foo') / require('./foo.js') / require('../bar/baz')
//    Captures: 1 = the quoted string (without quotes).
const RE_CJS_REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

// 2. ESM static import:  import x from './foo';   import { a } from './foo';
//    import * as ns from './foo';   import './foo';
//    Captures: 1 = the quoted string.
const RE_ESM_IMPORT_FROM = /import\s+(?:[\w*\s{},$]+\s+from\s+)?['"]([^'"]+)['"]/g;

// 3. Dynamic import:  await import('./foo')   import('./foo')
const RE_ESM_DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// All non-builtin specifiers start with '.' or '/' (relative / absolute).
// Builtins ('fs', 'node:fs', 'lodash', etc.) are filtered.
function isLocalSpecifier(spec) {
  if (!spec) return false;
  if (NODE_BUILTINS.has(spec)) return false;
  return spec.startsWith('.') || spec.startsWith('/');
}

// ── Walker: collect all .js/.mjs/.cjs under a root ────────────────────────
function walkJsFiles(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;

  function recurse(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // Permission denied, broken symlink, etc. — skip silently.
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (SKIP_DIRS.has(name)) continue;
      if (name.startsWith('.') && ent.isDirectory()) continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        recurse(full);
      } else if (ent.isFile() && SUPPORTED_EXTS.has(path.extname(name).toLowerCase())) {
        out.push(full);
      }
    }
  }

  recurse(root);
  return out;
}

// ── Parse a single file for its imports ───────────────────────────────────
// Returns: [{spec, line, type}]   where type ∈ 'cjs-require'|'esm-static'|'esm-dynamic'
function parseImports(content) {
  const findings = [];
  if (!content) return findings;

  // Compute line offsets once so we can resolve match.offset → line number.
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
  }
  function lineOf(offset) {
    // Binary search the lineStart containing offset.
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-indexed
  }

  function record(regex, type) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const spec = m[1];
      if (!isLocalSpecifier(spec)) continue;
      findings.push({ spec, line: lineOf(m.index), type });
    }
  }

  record(RE_CJS_REQUIRE, 'cjs-require');
  record(RE_ESM_IMPORT_FROM, 'esm-static');
  record(RE_ESM_DYNAMIC, 'esm-dynamic');

  return findings;
}

// ── Resolve a relative spec from the importer's directory ─────────────────
// Returns absolute path if the file exists (with or without extension).
// Otherwise returns null — caller can decide whether to log.
function resolveSpec(importerAbs, spec) {
  const base = path.isAbsolute(spec)
    ? spec
    : path.resolve(path.dirname(importerAbs), spec);
  try {
    if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }

  // Try adding .js / .mjs / .cjs (Node's resolution algorithm).
  for (const ext of ['.js', '.mjs', '.cjs']) {
    const candidate = base + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  // Try as directory with index.js (Node module convention).
  for (const ext of ['.js', '.mjs', '.cjs']) {
    const candidate = path.join(base, 'index' + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ── Main builder ──────────────────────────────────────────────────────────
/**
 * Build a dependency graph for all .js/.mjs/.cjs files under workspacePath.
 *
 * @param {string} workspacePath - Absolute path to workspace root.
 * @returns {{nodes: Array, edges: Array, reverseEdges: Map<string, string[]>}}
 */
function buildDependencyGraph(workspacePath) {
  const nodes = [];
  const edges = [];
  const reverseEdges = new Map();

  if (!workspacePath || !fs.existsSync(workspacePath)) {
    console.error('[dependency_graph] workspace path missing or does not exist:', workspacePath);
    return { nodes, edges, reverseEdges };
  }

  const files = walkJsFiles(workspacePath);
  const indexByPath = new Map();

  for (const abs of files) {
    const rel = path.relative(workspacePath, abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const node = {
      path: abs,
      relPath: rel,
      type: ext,
      tier: classifyTier(rel),
    };
    nodes.push(node);
    indexByPath.set(abs, node);
  }

  // Parse + resolve edges. Per-file failures are swallowed — the graph
  // remains useful even when some files are unreadable (corrupt, permission).
  for (const node of nodes) {
    let content;
    try {
      content = fs.readFileSync(node.path, 'utf8');
    } catch (e) {
      console.error(`[dependency_graph] cannot read ${node.path}: ${e.message}`);
      continue;
    }
    const imports = parseImports(content);
    for (const imp of imports) {
      const resolved = resolveSpec(node.path, imp.spec);
      if (!resolved) continue; // unresolved (likely external) — skip
      const targetNode = indexByPath.get(resolved);
      if (!targetNode) continue; // outside workspace — skip
      // Self-imports (a.js → a.js) are noise; skip them.
      if (targetNode.path === node.path) continue;

      edges.push({
        from: node.path,
        to: targetNode.path,
        type: imp.type,
        line: imp.line,
      });

      const list = reverseEdges.get(targetNode.path) || [];
      if (!list.includes(node.path)) list.push(node.path);
      reverseEdges.set(targetNode.path, list);
    }
  }

  return { nodes, edges, reverseEdges };
}

// ── Query helpers ─────────────────────────────────────────────────────────
function getDependents(graph, filePath) {
  if (!graph || !graph.reverseEdges) return [];
  // Normalize so callers can pass either absolute or a path matching a node.
  const list = graph.reverseEdges.get(filePath);
  if (list) return list.slice();
  // Try resolving by basename match (handy when absolute paths differ).
  const match = graph.nodes.find((n) => n.path === filePath);
  if (match) return (graph.reverseEdges.get(match.path) || []).slice();
  return [];
}

function getDependencies(graph, filePath) {
  if (!graph || !graph.edges) return [];
  return graph.edges.filter((e) => e.from === filePath).map((e) => e.to);
}

// ── Module exports ────────────────────────────────────────────────────────
module.exports = {
  buildDependencyGraph,
  getDependents,
  getDependencies,
  classifyTier,
  // Exposed for tests:
  parseImports,
  resolveSpec,
  walkJsFiles,
  isLocalSpecifier,
  SUPPORTED_EXTS,
  SKIP_DIRS,
  NODE_BUILTINS,
};