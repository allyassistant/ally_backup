#!/usr/bin/env node
/**
 * scripts/test_dependency_graph.js — Tests for dependency_graph.js (Module A)
 *
 * Verifies:
 *   1. parseImports() handles CJS require, ESM import, dynamic import.
 *   2. resolveSpec() resolves with/without extension.
 *   3. walkJsFiles() skips node_modules / archive / .git etc.
 *   4. buildDependencyGraph() on a synthetic fixture produces correct edges.
 *   5. getDependents() and getDependencies() return correct sets.
 *   6. Tier classification matches audit_repair_wire.js heuristics.
 *   7. Fail-open: bad input (null, missing dir) → empty graph.
 *
 * Self-Healing Loop — Layer 2 (Phase 2h)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const dg = require('./lib/dependency_graph');

let passed = 0, failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ❌ ${label}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── 1. parseImports ──────────────────────────────────────────────────────
section('1. parseImports — regex coverage');

{
  const cjs = `const x = require('./foo');
const y = require("../bar/baz");
const fs = require('fs');
const crypto = require('node:crypto');
const lodash = require('lodash');`;
  const out = dg.parseImports(cjs);
  // fs/crypto/lodash are not local → filtered.
  assert(out.length === 2, `CJS: filtered non-local (got ${out.length}, want 2)`);
  assert(out[0].spec === './foo' && out[0].type === 'cjs-require', 'CJS: first spec + type');
  assert(out[0].line === 1, 'CJS: first line is 1');
  assert(out[1].spec === '../bar/baz', 'CJS: relative-up spec');
  assert(out[1].line === 2, 'CJS: second line is 2');
}

{
  const esm = `import a from './alpha';
import { b } from '../beta';
import * as ns from './gamma';
import './side-effect';
import lodash from 'lodash';
const m = await import('./dyn');`;
  const out = dg.parseImports(esm);
  // 4 local (./alpha, ../beta, ./gamma, ./side-effect, ./dyn) — but lodash is non-local
  // Note: 'import "./side-effect"' matches RE_ESM_IMPORT_FROM
  // 'import("./dyn")' also matches RE_ESM_DYNAMIC — total = 5 local.
  assert(out.length === 5, `ESM: 5 local imports (got ${out.length})`);
  const specs = out.map((o) => o.spec).sort();
  assert(specs.includes('./alpha'), 'ESM: includes ./alpha');
  assert(specs.includes('../beta'), 'ESM: includes ../beta');
  assert(specs.includes('./gamma'), 'ESM: includes ./gamma');
  assert(specs.includes('./side-effect'), 'ESM: includes ./side-effect');
  assert(specs.includes('./dyn'), 'ESM: includes ./dyn (dynamic)');
}

// ── 2. resolveSpec ───────────────────────────────────────────────────────
section('2. resolveSpec — extension probing');

const tmpResolve = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-resolve-'));
try {
  const a = path.join(tmpResolve, 'foo.js');
  const bNoExt = path.join(tmpResolve, 'noext');
  const importerStub = path.join(tmpResolve, 'importer.js'); // used as the "from" file
  fs.writeFileSync(a, 'module.exports = 1;');
  fs.writeFileSync(bNoExt + '.mjs', 'export default 1;');
  fs.writeFileSync(path.join(tmpResolve, 'qux.cjs'), 'module.exports = 1;');
  fs.writeFileSync(importerStub, '// stub');

  // resolveSpec resolves spec relative to dirname(importer), so importer MUST be a file.
  assert(dg.resolveSpec(importerStub, './foo') === a, 'resolveSpec: ./foo → foo.js');
  assert(dg.resolveSpec(importerStub, './foo.js') === a, 'resolveSpec: ./foo.js exact');
  assert(dg.resolveSpec(importerStub, './noext') === bNoExt + '.mjs', 'resolveSpec: adds .mjs');
  assert(dg.resolveSpec(importerStub, './qux.cjs') === path.join(tmpResolve, 'qux.cjs'), 'resolveSpec: .cjs exact');
  assert(dg.resolveSpec(importerStub, './nope') === null, 'resolveSpec: missing → null');
} finally {
  fs.rmSync(tmpResolve, { recursive: true, force: true });
}

// ── 3. walkJsFiles + synthetic fixture ────────────────────────────────────
section('3. walkJsFiles + buildDependencyGraph — synthetic fixture');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-graph-'));
try {
  // Layout:
  //   root/
  //     scripts/
  //       alpha.js         requires lib/dedup_gate.js + cron_helper.js
  //       beta.js          requires lib/dedup_gate.js (via ESM)
  //       gamma.mjs        imports lib/dedup_gate.js
  //       archive/
  //         old.js         requires lib/dedup_gate.js   (skipped: archive dir)
  //       lib/
  //         dedup_gate.js  exports dedup (the target)
  //       cron_helper.js   utility
  //     node_modules/foo/index.js   (skipped)
  //     .fix_snapshots/x.js          (skipped)
  fs.mkdirSync(path.join(tmpRoot, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'scripts', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'node_modules', 'foo'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, '.fix_snapshots'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'scripts', 'lib', 'dedup_gate.js'),
    'function dedup(x) { return x; }\nmodule.exports = { dedup };');
  fs.writeFileSync(path.join(tmpRoot, 'scripts', 'cron_helper.js'),
    'module.exports = { run: () => 1 };');
  const alphaContent = [
    "const { dedup } = require('./lib/dedup_gate.js');",
    "const helper = require('./cron_helper.js');",
    "console.log(dedup(1));",
  ].join('\n');
  try {
    fs.writeFileSync(path.join(tmpRoot, 'scripts', 'alpha.js'), alphaContent);
  } catch (e) {
    console.error('File write failed: ' + e.message);
  }
  const betaContent = [
    "const dg = require('./lib/dedup_gate.js');",
    "console.log(dg.dedup(2));",
  ].join('\n');
  try {
    fs.writeFileSync(path.join(tmpRoot, 'scripts', 'beta.js'), betaContent);
  } catch (e) {
    console.error('File write failed: ' + e.message);
  }
  try {
    fs.writeFileSync(path.join(tmpRoot, 'scripts', 'gamma.mjs'),
      `import { dedup } from './lib/dedup_gate.js';
    console.log(dedup(3));`);
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  try {
    fs.writeFileSync(path.join(tmpRoot, 'scripts', 'archive', 'old.js'),
    `const x = require('../lib/dedup_gate.js');`);
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  try {
    fs.writeFileSync(path.join(tmpRoot, 'node_modules', 'foo', 'index.js'),
    `const y = require('../../scripts/lib/dedup_gate.js');`);
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  try {
    fs.writeFileSync(path.join(tmpRoot, '.fix_snapshots', 'x.js'),
    `module.exports = 1;`);
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }

  const graph = dg.buildDependencyGraph(tmpRoot);

  const dedup = path.join(tmpRoot, 'scripts', 'lib', 'dedup_gate.js');
  const alpha = path.join(tmpRoot, 'scripts', 'alpha.js');
  const beta = path.join(tmpRoot, 'scripts', 'beta.js');
  const gamma = path.join(tmpRoot, 'scripts', 'gamma.mjs');

  assert(graph.nodes.length >= 5, `nodes: at least 5 (got ${graph.nodes.length})`);
  assert(!graph.nodes.some((n) => n.path.includes('node_modules')), 'nodes: excludes node_modules');
  assert(!graph.nodes.some((n) => n.path.includes('.fix_snapshots')), 'nodes: excludes .fix_snapshots');
  assert(!graph.nodes.some((n) => n.path.includes('/archive/')), 'nodes: excludes archive/');

  const alphaNode = graph.nodes.find((n) => n.path === alpha);
  const betaNode = graph.nodes.find((n) => n.path === beta);
  const gammaNode = graph.nodes.find((n) => n.path === gamma);
  const dedupNode = graph.nodes.find((n) => n.path === dedup);
  const cronNode = graph.nodes.find((n) => n.path === path.join(tmpRoot, 'scripts', 'cron_helper.js'));
  assert(!!alphaNode && !!betaNode && !!gammaNode && !!dedupNode && !!cronNode, 'nodes: all expected files present');

  // Tier checks (cron_helper.js basename starts with cron_ → production)
  assert(cronNode && cronNode.tier === 'production', `cron_helper.js tier = production (got ${cronNode && cronNode.tier})`);
  assert(dedupNode && dedupNode.tier === 'utility', `dedup_gate.js tier = utility (got ${dedupNode && dedupNode.tier})`);

  // Edges
  const edgesToDedup = graph.edges.filter((e) => e.to === dedup);
  assert(edgesToDedup.length === 3, `edges → dedup_gate.js = 3 (got ${edgesToDedup.length})`);
  const fromFiles = edgesToDedup.map((e) => e.from).sort();
  assert(fromFiles.includes(alpha) && fromFiles.includes(beta) && fromFiles.includes(gamma),
    'edges: alpha, beta, gamma all → dedup');

  // Edge types
  const alphaEdge = edgesToDedup.find((e) => e.from === alpha);
  const gammaEdge = edgesToDedup.find((e) => e.from === gamma);
  assert(alphaEdge && alphaEdge.type === 'cjs-require', `alpha edge type = cjs-require (got ${alphaEdge && alphaEdge.type})`);
  assert(gammaEdge && gammaEdge.type === 'esm-static', `gamma edge type = esm-static (got ${gammaEdge && gammaEdge.type})`);

  // getDependents
  const dependents = dg.getDependents(graph, dedup);
  assert(dependents.length === 3, `getDependents(dedup) = 3 (got ${dependents.length})`);
  assert(dependents.includes(alpha) && dependents.includes(beta) && dependents.includes(gamma),
    'getDependents: alpha + beta + gamma');

  // getDependencies
  const alphaDeps = dg.getDependencies(graph, alpha);
  assert(alphaDeps.length === 2, `getDependencies(alpha) = 2 (got ${alphaDeps.length})`);
  assert(alphaDeps.includes(dedup), 'getDependencies(alpha): includes dedup');

  // Reverse-edge lookup by node path
  const rev = graph.reverseEdges.get(dedup) || [];
  assert(rev.length === 3, 'reverseEdges: dedup → 3 dependents');
} finally {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (e) {
    console.error(`File deletion failed: ${e.message}`);
  }
}

// ── 4. Real-workspace smoke test (uses dedup_gate.js if present) ──────────
section('4. Real-workspace smoke test');
{
  const HOME = process.env.HOME || os.homedir();
  const WS = path.join(HOME, '.openclaw', 'workspace');
  if (!fs.existsSync(WS)) {
    console.log('   ⚠️  workspace not present — skipped');
  } else {
    const graph = dg.buildDependencyGraph(WS);
    assert(graph.nodes.length > 50, `real workspace: nodes > 50 (got ${graph.nodes.length})`);
    assert(graph.edges.length > 0, `real workspace: edges > 0 (got ${graph.edges.length})`);

    const dedup = path.join(WS, 'scripts', 'lib', 'dedup_gate.js');
    if (fs.existsSync(dedup)) {
      const deps = dg.getDependents(graph, dedup);
      console.log(`   ℹ️  lib/dedup_gate.js dependents (real): ${deps.length}`);
      assert(deps.length > 0, `lib/dedup_gate.js has at least 1 dependent (got ${deps.length})`);
    } else {
      console.log('   ⚠️  lib/dedup_gate.js not found — skipped dependent check');
    }

    const snapshot = require('./lib/snapshot');
    const depsSnap = dg.getDependents(graph, path.join(WS, 'scripts', 'lib', 'snapshot.js'));
    assert(depsSnap.length > 0, `lib/snapshot.js has dependents (got ${depsSnap.length})`);
  }
}

// ── 5. Fail-open behavior ─────────────────────────────────────────────────
section('5. Fail-open behavior');

{
  const graph = dg.buildDependencyGraph('/this/does/not/exist/anywhere');
  assert(graph.nodes.length === 0 && graph.edges.length === 0, 'missing workspace → empty graph');
  assert(dg.getDependents(graph, '/x') !== null, 'getDependents on empty graph → []');
  assert(Array.isArray(dg.getDependents(null, '/x')), 'getDependents null graph → []');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────`);
console.log(`Total: ${passed + failed}, ✅ passed: ${passed}, ❌ failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
process.exit(0);