#!/usr/bin/env node
/**
 * scripts/lib/script_registry.js — Phase 3 (Layer 3) Script Registry
 *
 * Auto-builds + caches a registry of every script in workspace, classified
 * by tier (critical/production/utility/debug). This is the lookup table that
 * daily_audit_runner, audit_repair_wire, and skill_reviewer consult to make
 * tier-aware response decisions.
 *
 * Public API:
 *   const reg = require('./lib/script_registry');
 *
 *   reg.buildScriptRegistry(workspacePath)  → registry object
 *   reg.getScript(registry, relPath)        → scriptEntry | null
 *   reg.getScriptsByTier(registry, tier)    → scriptEntry[]
 *   reg.persistRegistry(registry, filePath) → writes JSON
 *   reg.loadRegistry(filePath)              → registry | null
 *   reg.getOrBuild(workspacePath)           → cached or freshly built registry
 *
 * Tier heuristic (intentionally simple, fast, predictable):
 *   critical    → matches ^scripts/(cron|auto|daily|session|heartbeat)_.*\.(js|sh)$
 *   production  → matches ^scripts/.*_(runner|monitor|triage|manager|collector)\.js$
 *                 OR .sh / .bash / .zsh scripts
 *   utility     → ^scripts/lib/.* OR ^scripts/[^_][^/]*\.js$ (default)
 *   debug       → ends in _test.js OR under _legacy/ OR _archive/
 *
 * Persists to <workspace>/.registry/scripts.json
 *
 * Created: 2026-06-19 (Phase 3 / Layer 3)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { WS, atomicWriteSync } = require('./config');

const REGISTRY_DIR = path.join(WS, '.registry');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'scripts.json');

const SUPPORTED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.sh', '.bash', '.zsh'];

const TIER_PATTERNS = {
  critical: [
    /^scripts\/(cron|auto|daily|session|heartbeat)_.*\.(js|sh|mjs|cjs|bash|zsh)$/,
  ],
  production: [
    /^scripts\/.*_(runner|monitor|triage|manager|collector)\.js$/,
    /^scripts\/.*_(runner|monitor|triage|manager|collector)\.(mjs|cjs)$/,
  ],
  debug: [
    /_test\.(js|mjs|cjs)$/,
    /\/_legacy\//,
    /\/_archive\//,
  ],
};

// In-memory cache keyed by workspace path
let _cache = new Map();

/**
 * Classify a relative path into a tier.
 * Order: debug (deprecation/legacy) > critical > production > utility
 */
function classifyTier(relPath) {
  if (!relPath || typeof relPath !== 'string') return 'utility';
  const p = relPath.replace(/^\.\//, '');
  const base = path.basename(p);

  // Debug first: _legacy/ and _archive/ always override any other rule
  // (matches whether or not path starts with scripts/)
  if (/(^|\/)_legacy(\/|$)/.test(p) || /(^|\/)_archive(\/|$)/.test(p)) return 'debug';

  // Shell scripts: critical if cron/auto/daily/session/heartbeat prefix, else production
  if (/\.(sh|bash|zsh)$/i.test(base)) {
    if (/^(cron|auto|daily|session|heartbeat)(_|\.|$)/.test(base)) return 'critical';
    return 'production';
  }

  // Test files: debug
  if (/_test\.(js|mjs|cjs)$/.test(base)) return 'debug';

  // Critical (most specific)
  for (const re of TIER_PATTERNS.critical) {
    if (re.test(p)) return 'critical';
  }

  // Production
  for (const re of TIER_PATTERNS.production) {
    if (re.test(p)) return 'production';
  }

  // Utility: scripts/lib/ always utility
  if (/^scripts\/lib\//.test(p)) return 'utility';

  // Default: anything under scripts/ with no underscores in basename → utility
  if (/^scripts\/[^_][^/]*\.(js|mjs|cjs)$/.test(p)) return 'utility';

  // Catch-all: utility (last resort)
  return 'utility';
}

/**
 * Parse require/import statements from a JS file to derive dependencies.
 * Lightweight: catches string literals inside require(...) and import ... from '...'.
 */
function extractDeps(absPath) {
  let content;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch (_) {
    return [];
  }

  const deps = new Set();
  // require('...')
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = requireRe.exec(content)) !== null) {
    deps.add(m[1]);
  }
  // import ... from '...'
  const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content)) !== null) {
    deps.add(m[1]);
  }
  // import('...')
  const dynImportRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynImportRe.exec(content)) !== null) {
    deps.add(m[1]);
  }
  return Array.from(deps);
}

/**
 * Walk a directory tree and yield .js/.mjs/.cjs/.sh files.
 * Excludes common noise dirs.
 */
function walkScripts(rootDir) {
  const exclude = new Set([
    'node_modules', '.git', '__pycache__', '.venv', '.cache', 'dist',
    '.registry', '.state', '.fix_snapshots', '.issues',
  ]);
  const results = [];
  const maxDepth = 10;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      // Skip hidden files/dirs (e.g., .git, .DS_Store) but allow our explicit dirs above
      if (e.name.startsWith('.') && !exclude.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!exclude.has(e.name)) walk(full, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          results.push(full);
        }
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

/**
 * Build the full script registry.
 * Returns: { scripts: [...], summary: {...}, builtAt, workspacePath }
 */
function buildScriptRegistry(workspacePath = WS) {
  const root = workspacePath;
  const files = walkScripts(root);

  const scripts = [];
  const byTier = { critical: 0, production: 0, utility: 0, debug: 0 };
  const byExtension = {};
  const byDir = {};

  for (const abs of files) {
    let stat;
    try { stat = fs.statSync(abs); } catch (_) { continue; }
    const rel = path.relative(root, abs);
    const tier = classifyTier(rel);
    const ext = path.extname(abs).toLowerCase().slice(1); // 'js', 'sh', etc.
    const deps = extractDeps(abs);
    const isShell = ['sh', 'bash', 'zsh'].includes(ext);

    byTier[tier] = (byTier[tier] || 0) + 1;
    byExtension[ext] = (byExtension[ext] || 0) + 1;
    const topDir = rel.split(path.sep)[0] || '';
    byDir[topDir] = (byDir[topDir] || 0) + 1;

    scripts.push({
      path: rel,
      tier,
      extension: '.' + ext,
      dependsOn: deps,
      dependedBy: [], // filled in second pass
      firstSeen: new Date(stat.birthtimeMs || stat.ctimeMs || Date.now()).toISOString(),
      lastModified: new Date(stat.mtimeMs).toISOString(),
      mtime: stat.mtimeMs,
      size: stat.size,
      importCount: deps.length,
      isShell,
    });
  }

  // Second pass: reverse dependency index (best-effort, intra-registry only)
  const byPath = new Map(scripts.map(s => [s.path, s]));
  for (const s of scripts) {
    for (const dep of s.dependsOn) {
      // Normalize: strip leading ./ and resolve relative paths
      let candidate = dep;
      if (candidate.startsWith('./') || candidate.startsWith('../')) {
        candidate = path.normalize(path.join(path.dirname(s.path), candidate));
        // strip leading ./
        if (candidate.startsWith('./')) candidate = candidate.slice(2);
      }
      // Try as-is (Node modules like 'node:fs' won't match — that's expected)
      if (byPath.has(candidate)) {
        byPath.get(candidate).dependedBy.push(s.path);
      }
    }
  }

  // Sort scripts by path for stable output
  scripts.sort((a, b) => a.path.localeCompare(b.path));

  const registry = {
    scripts,
    summary: {
      total: scripts.length,
      byTier,
      byExtension,
      byDir,
    },
    builtAt: new Date().toISOString(),
    workspacePath: root,
  };

  return registry;
}

/**
 * Persist registry to JSON file. Creates dir if needed.
 */
function persistRegistry(registry, filePath = REGISTRY_FILE) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
  }
  atomicWriteSync(filePath, registry);
  return filePath;
}

/**
 * Load registry from JSON file. Returns null if missing/corrupt.
 */
function loadRegistry(filePath = REGISTRY_FILE) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.scripts)) return null;
    return obj;
  } catch (_) {
    return null;
  }
}

/**
 * Get one script entry by relative path.
 */
function getScript(registry, relPath) {
  if (!registry || !registry.scripts) return null;
  const norm = relPath.replace(/^\.\//, '');
  return registry.scripts.find(s => s.path === norm) || null;
}

/**
 * Get all scripts matching a tier.
 */
function getScriptsByTier(registry, tier) {
  if (!registry || !registry.scripts) return [];
  return registry.scripts.filter(s => s.tier === tier);
}

/**
 * Get-or-build with cache. Clears cache if force=true.
 */
function getOrBuild(workspacePath = WS, force = false) {
  if (force) _cache.delete(workspacePath);
  if (_cache.has(workspacePath)) return _cache.get(workspacePath);
  const reg = buildScriptRegistry(workspacePath);
  _cache.set(workspacePath, reg);
  return reg;
}

/**
 * Invalidate the in-memory cache.
 */
function clearCache(workspacePath = null) {
  if (workspacePath) _cache.delete(workspacePath);
  else _cache.clear();
}

// ----------------- CLI -----------------
async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args);
  const wantsJson = flags.has('--json');
  const wantsPersist = flags.has('--persist');
  const force = flags.has('--force');
  const targetTier = args.find(a => a.startsWith('--tier='))?.split('=')[1] || null;

  if (flags.has('--help') || flags.has('-h')) {
    console.log(`script_registry.js — Build/catalog all workspace scripts (Phase 3 / Layer 3)

Usage:
  node scripts/lib/script_registry.js                # build + print summary
  node scripts/lib/script_registry.js --json         # full JSON
  node scripts/lib/script_registry.js --tier=critical
  node scripts/lib/script_registry.js --persist      # write .registry/scripts.json
  node scripts/lib/script_registry.js --force        # bypass cache
`);
    process.exit(0);
  }

  const reg = getOrBuild(WS, force);

  if (wantsPersist) {
    const out = persistRegistry(reg);
    console.log(`💾 Registry persisted to ${out}`);
  }

  if (wantsJson) {
    console.log(JSON.stringify(reg, null, 2));
    return;
  }

  if (targetTier) {
    const filtered = getScriptsByTier(reg, targetTier);
    console.log(`\n📂 Tier: ${targetTier} (${filtered.length} scripts)`);
    for (const s of filtered.slice(0, 50)) {
      console.log(`  ${s.path}  [${s.extension}, ${s.size}b]`);
    }
    if (filtered.length > 50) console.log(`  ... and ${filtered.length - 50} more`);
    return;
  }

  // Default: summary view
  console.log(`\n📚 Script Registry — built ${reg.builtAt}`);
  console.log(`   Workspace: ${reg.workspacePath}`);
  console.log(`   Total: ${reg.summary.total} scripts\n`);
  console.log(`   By tier:`);
  for (const [t, n] of Object.entries(reg.summary.byTier)) {
    const bar = '█'.repeat(Math.min(40, Math.round(n / Math.max(1, reg.summary.total) * 40)));
    console.log(`     ${t.padEnd(11)} ${String(n).padStart(4)}  ${bar}`);
  }
  console.log(`\n   By extension:`);
  for (const [e, n] of Object.entries(reg.summary.byExtension)) {
    console.log(`     .${e.padEnd(6)} ${n}`);
  }
  console.log(`\n   Top dirs:`);
  const topDirs = Object.entries(reg.summary.byDir).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [d, n] of topDirs) {
    console.log(`     ${d.padEnd(20)} ${n}`);
  }
}

module.exports = {
  buildScriptRegistry,
  persistRegistry,
  loadRegistry,
  getScript,
  getScriptsByTier,
  getOrBuild,
  clearCache,
  classifyTier,
  REGISTRY_DIR,
  REGISTRY_FILE,
  SUPPORTED_EXTENSIONS,
  TIER_PATTERNS,
};

// Run if called directly
if (require.main === module) {
  main().catch(e => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
}
