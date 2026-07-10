#!/usr/bin/env node
/**
 * rename_with_propagation.js — Standalone Layer 2 rename CLI
 *
 * Usage:
 *   node scripts/rename_with_propagation.js <old-path> <new-path>
 *   node scripts/rename_with_propagation.js --dry-run <old> <new>
 *   node scripts/rename_with_propagation.js --plan-only <old> <new>   # show what would change, don't write
 *   node scripts/rename_with_propagation.js --no-snapshot <old> <new> # DANGEROUS — skip snapshot
 *
 * Layer 2 — Cross-Script Rename Propagation
 *   1. Build the dependency graph (one-time)
 *   2. planRename() → list of rewrites across all dependent files
 *   3. applyRenames() → snapshot, apply, verify (with rollback on failure)
 *   4. Move old file → new file (after successful rename)
 *
 * Safety:
 *   - All rewrites snapshotted to .fix_snapshots/<file>.<ts>.<pid>.pre
 *   - On any failure, all snapshots roll back
 *   - Dry-run and plan-only modes do not write anything
 *   - File must be inside the workspace (path traversal protection)
 *
 * Created: 2026-06-20 (Phase 2h wire-in)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { WS } = require('./lib/config');
const depGraph = require('./lib/dependency_graph');
const rp = require('./lib/rename_propagator');
const snapshot = require('./lib/file_snapshot');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PLAN_ONLY = args.includes('--plan-only');
const NO_SNAPSHOT = args.includes('--no-snapshot');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log(`rename_with_propagation.js — Layer 2 standalone rename CLI

Usage:
  node scripts/rename_with_propagation.js <old-path> <new-path>
  node scripts/rename_with_propagation.js --dry-run <old> <new>
  node scripts/rename_with_propagation.js --plan-only <old> <new>
  node scripts/rename_with_propagation.js --no-snapshot <old> <new>

Examples:
  node scripts/rename_with_propagation.js scripts/foo.js scripts/bar.js
  node scripts/rename_with_propagation.js scripts/lib/old.js scripts/lib/new.js

Safety:
  - All files snapshotted before write
  - Dry-run / plan-only do not write anything
  - Files must be inside the workspace
`);
  process.exit(0);
}

const positional = args.filter(a => !a.startsWith('--'));
if (positional.length !== 2) {
  console.error('Usage: node scripts/rename_with_propagation.js <old-path> <new-path>');
  console.error('Run with --help for details.');
  process.exit(2);
}

const [oldRel, newRel] = positional;
const oldPath = path.isAbsolute(oldRel) ? oldRel : path.join(WS, oldRel);
const newPath = path.isAbsolute(newRel) ? newRel : path.join(WS, newRel);

// Path traversal protection
if (!oldPath.startsWith(WS) || !newPath.startsWith(WS)) {
  console.error('❌ paths must be inside the workspace:', WS);
  process.exit(2);
}

if (!fs.existsSync(oldPath)) {
  console.error(`❌ source not found: ${oldPath}`);
  process.exit(1);
}

if (fs.existsSync(newPath)) {
  console.error(`❌ destination already exists: ${newPath}`);
  process.exit(1);
}

function log(msg) { console.log(msg); }

log(`🌐 rename_with_propagation.js — Layer 2 rename`);
log(`   source: ${path.relative(WS, oldPath)}`);
log(`   dest:   ${path.relative(WS, newPath)}`);

if (NO_SNAPSHOT && !DRY_RUN && !PLAN_ONLY) {
  log(`   ⚠️  NO SNAPSHOT — rollback on failure is disabled`);
}

try {
  // 1. Build graph
  log(`\n1. Building dependency graph...`);
  const graph = depGraph.buildDependencyGraph(WS);
  log(`   graph: ${graph?.nodes?.length} nodes, ${graph?.edges?.length} edges`);

  // 2. Plan rewrites
  log(`\n2. Planning renames...`);
  const rewrites = rp.planRename(graph, oldPath, newPath);
  log(`   planned: ${rewrites.length} rewrite(s) across dependents`);
  for (const r of rewrites.slice(0, 10)) {
    log(`   - ${path.relative(WS, r.file)}:${r.line}`);
    log(`     - ${r?.oldText?.trim()}`);
    log(`     + ${r?.newText?.trim()}`);
  }
  if (rewrites.length > 10) {
    log(`   ... and ${rewrites.length - 10} more`);
  }

  if (PLAN_ONLY) {
    log(`\n✅ Plan complete. No files modified.`);
    process.exit(0);
  }

  // 3. Apply rewrites (with snapshot)
  if (rewrites.length > 0) {
    log(`\n3. Applying rewrites${DRY_RUN ? ' (DRY RUN)' : ''}...`);
    const result = rp.applyRenames(graph, rewrites, {
      snapshot: !NO_SNAPSHOT,
      dryRun: DRY_RUN,
    });
    log(`   applied: ${result?.applied?.length} file(s)`);
    log(`   failed:  ${result?.failed?.length}`);
    if (result?.failed?.length > 0) {
      for (const f of result?.failed?.slice(0, 5)) {
        log(`   ⚠️  ${path.relative(WS, f.file)}: ${f.error}`);
      }
    }
    if (!DRY_RUN && result?.failed?.length > 0) {
      log(`\n❌ Some rewrites failed. Aborting move.`);
      log(`   (snapshots remain for manual rollback if needed)`);
      process.exit(1);
    }
  } else {
    log(`\n3. No rewrites to apply.`);
  }

  // 4. Move the file
  if (!DRY_RUN) {
    log(`\n4. Moving source → destination...`);
    try {
      // Make sure destination's parent exists
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      // Snapshot the source BEFORE the move
      let srcSnapPath = null;
      if (!NO_SNAPSHOT) {
        srcSnapPath = snapshot.snapshotFile(oldPath);
        log(`   📸 source snapshot: ${srcSnapPath}`);
      }
      fs.renameSync(oldPath, newPath);
      log(`   ✓ moved`);
    } catch (e) {
      log(`   ❌ move failed: ${e.message}`);
      process.exit(1);
    }
  } else {
    log(`\n4. (DRY RUN — would move ${path.relative(WS, oldPath)} → ${path.relative(WS, newPath)})`);
  }

  log(`\n✅ Rename complete.`);
  log(`   ${DRY_RUN ? 'DRY RUN' : 'Files updated'}: ${rewrites.length} dependent + 1 source move`);
  if (!DRY_RUN && !NO_SNAPSHOT) {
    log(`   Snapshots: ${snapshot.SNAPSHOT_DIR}`);
    log(`   To rollback: node scripts/snapshot_rollback.js --latest`);
  }
  process.exit(0);
} catch (e) {
  console.error(`\n❌ Fatal: ${e.message}`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
}
