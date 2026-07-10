#!/usr/bin/env node
/**
 * scripts/lib/rename_propagator.js — Layer 2 rename propagation
 *
 * Given a rename event (oldPath → newPath), compute the set of dependent
 * files whose require()/import specifier must be rewritten, then apply
 * the rewrites using snapshot/rollback (Phase 2e snapshot.js).
 *
 * Pure functions: planRename() never touches the filesystem.
 * Side effects: applyRenames() does — but wrapped in try/catch with
 * per-file snapshot/rollback so a partial failure does not corrupt state.
 *
 * Self-Healing Loop — Layer 2 (Phase 2h)
 * Created: 2026-06-19
 */
'use strict';

const fs = require('fs');
const path = require('path');

const snapshot = require('./file_snapshot');
const depGraph = require('./dependency_graph');

// ── Specifier rewriting ───────────────────────────────────────────────────
// Given an importer (absolute path), the old module (absolute path), and
// the new module (absolute path), compute the relative require()/import
// specifier that the importer would need to use to reach the new path.
function computeNewSpecifier(importerAbs, oldModuleAbs, newModuleAbs) {
  const newRel = path.relative(path.dirname(importerAbs), newModuleAbs);
  // Normalize: Node accepts both './foo' and 'foo' (when ./ is implicit);
  // emit './' prefix to keep diffs minimal.
  if (!newRel.startsWith('.')) return './' + newRel;
  return newRel;
}

// ── Identify every line in the importer that mentions the OLD module ──────
// We don't just match the full require/import statement — a file may also
// contain the path in comments, error messages, or string literals that
// reference the file. Conservative: any line containing the old absolute
// path or the old relative spec is a candidate for a precise rewrite.
//
// Important: bare basenames like 'foo.js' or 'foo' MUST only match inside
// a quoted-string context (a require/import literal), not inside JS
// identifiers like `const foo = ...` or `console.log(foo)`. Otherwise we'd
// rewrite unrelated code that happens to mention the file's name.
function findRewriteCandidates(importerAbs, oldModuleAbs, oldImportSpec, importerContent) {
  const lines = importerContent.split('\n');
  const oldBasename = path.basename(oldModuleAbs);
  const oldRelToImporter = path.relative(path.dirname(importerAbs), oldModuleAbs);
  const oldRelNoExt = oldRelToImporter.replace(/\.(js|mjs|cjs)$/, '');
  const oldBasenameNoExt = path.basename(oldModuleAbs, path.extname(oldModuleAbs));
  // Variants we try to substitute. Order matters — longer / more specific
  // first. Each variant is tagged `bare: true` if it lacks any path
  // separator AND lacks a leading `./` or `/` — those are the ones that
  // collide with JS identifiers and require a quoted-string context.
  const oldVariantsRaw = [
    { v: oldModuleAbs, bare: false },
    { v: oldRelToImporter, bare: isBareName(oldRelToImporter) },
    { v: oldRelNoExt, bare: isBareName(oldRelNoExt) },
    { v: './' + oldRelToImporter, bare: false },
    { v: './' + oldRelNoExt, bare: false },
    { v: oldBasename, bare: isBareName(oldBasename) },
    { v: oldBasenameNoExt, bare: isBareName(oldBasenameNoExt) },
  ].filter((x) => x.v);
  // De-dupe while preserving order AND keeping the `bare` flag (true wins).
  const seen = new Set();
  const variants = [];
  for (const { v, bare } of oldVariantsRaw) {
    if (seen.has(v)) {
      // If we already inserted v but the new occurrence is bare, upgrade.
      const existing = variants.find((x) => x.v === v);
      if (bare) existing.bare = true;
      continue;
    }
    seen.add(v);
    variants.push({ v, bare });
  }

  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines to avoid polluting docstrings.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const { v, bare } of variants) {
      if (!line.includes(v)) continue;
      // Bare variants (no slash) must appear inside a quoted-string context
      // to avoid matching JS identifiers.
      if (bare && !isInsideQuotedContext(line, v)) continue;
      // Normalize the recorded variant: if it's a bare basename, upgrade
      // to the './' form so the split-join in applyRenames produces a
      // correct require()/import specifier.
      const recordedVariant = bare ? './' + v : v;
      hits.push({ line: i + 1, variant: recordedVariant });
      break; // one match per line is enough
    }
  }
  return hits;
}

// True if `name` is a bare basename (no path separator, no leading dot,
// no absolute prefix). Such names collide with JS identifiers and need
// extra context validation.
function isBareName(name) {
  if (!name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.startsWith('.') || name.startsWith('/')) return false;
  return true;
}

// Return true if `variant` appears inside a quoted string on this line.
// Cheap heuristic: walk left-to-right tracking quoted spans; if a quote
// is still open when we reach the variant's offset, it's inside a string.
function isInsideQuotedContext(line, variant) {
  const idx = line.indexOf(variant);
  if (idx < 0) return false;
  let inSingle = false, inDouble = false, inTpl = false;
  for (let i = 0; i < idx; i++) {
    const ch = line[i];
    if (ch === '\\') { i++; continue; }
    if (inSingle) { if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '"') inDouble = false; continue; }
    if (inTpl)    { if (ch === '`') inTpl = false;    continue; }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '`') inTpl = true;
  }
  return inSingle || inDouble || inTpl;
}

// ── planRename ────────────────────────────────────────────────────────────
/**
 * Plan the textual rewrites required across all dependents of oldPath.
 *
 * @param {object} graph - Output of buildDependencyGraph().
 * @param {string} oldPath - Absolute path of the file being renamed.
 * @param {string} newPath - Absolute path of the file after rename.
 * @param {string} [oldImportSpecifier] - Optional hint from the caller
 *   about the specifier it used (used to filter false positives when the
 *   new file collides with another file of the same name).
 * @returns {Array<{file: string, line: number, oldText: string, newText: string, reason: string}>}
 *   Empty array on error (fail-open).
 */
function planRename(graph, oldPath, newPath, oldImportSpecifier) {
  if (!graph || !oldPath || !newPath) return [];
  let dependents;
  try {
    dependents = depGraph.getDependents(graph, oldPath);
  } catch (e) {
    console.error(`[rename_propagator] getDependents failed: ${e.message}`);
    return [];
  }
  if (!dependents || dependents.length === 0) return [];

  const rewrites = [];
  for (const dependentAbs of dependents) {
    let content;
    try {
      content = fs.readFileSync(dependentAbs, 'utf8');
    } catch (e) {
      console.error(`[rename_propagator] cannot read dependent ${dependentAbs}: ${e.message}`);
      continue;
    }

    const candidates = findRewriteCandidates(dependentAbs, oldPath, oldImportSpecifier, content);
    if (candidates.length === 0) continue;

    for (const cand of candidates) {
      const newSpecifier = computeNewSpecifier(dependentAbs, oldPath, newPath);
      const lines = content.split('\n');
      const idx = cand.line - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const oldLine = lines[idx];
      // Build the new line by replacing ONLY the variant occurrence — keep
      // the surrounding require()/import syntax intact.
      const newLine = oldLine.split(cand.variant).join(newSpecifier);
      if (newLine === oldLine) continue;
      rewrites.push({
        file: dependentAbs,
        line: cand.line,
        oldText: oldLine,
        newText: newLine,
        reason: 'import path references renamed module',
        oldVariant: cand.variant,
        newSpecifier,
      });
    }
  }
  return rewrites;
}

// ── applyRenames ──────────────────────────────────────────────────────────
/**
 * Apply a batch of rewrites. Each rewrite snapshots the target file BEFORE
 * the mutation (via lib/file_snapshot.js), then writes atomically. If the
 * rewrite fails, the file is rolled back from its snapshot.
 *
 * @param {object} graph - Output of buildDependencyGraph().
 * @param {Array} rewrites - Output of planRename().
 * @param {object} [opts] - { snapshot: true (default), dryRun: false }.
 * @returns {{applied: Array, failed: Array, snapshotDir: string|null}}
 */
function applyRenames(graph, rewrites, opts = {}) {
  const useSnapshot = opts.snapshot !== false;
  const dryRun = !!opts.dryRun;
  const applied = [];
  const failed = [];

  if (!Array.isArray(rewrites) || rewrites.length === 0) {
    return { applied, failed, snapshotDir: useSnapshot ? snapshot.SNAPSHOT_DIR : null };
  }

  // De-dupe by file — we only need ONE snapshot per file even if multiple
  // lines in it change. Snapshotting twice in a row would create noise and
  // also waste writes. Group rewrites by file first.
  const byFile = new Map();
  for (const r of rewrites) {
    const list = byFile.get(r.file) || [];
    list.push(r);
    byFile.set(r.file, list);
  }

  for (const [filePath, fileRewrites] of byFile.entries()) {
    let snapPath = null;
    let originalContent = null;
    try {
      originalContent = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      failed.push({ file: filePath, error: `cannot read: ${e.message}` });
      continue;
    }

    if (useSnapshot && !dryRun) {
      try {
        snapPath = snapshot.snapshotFile(filePath);
      } catch (e) {
        failed.push({ file: filePath, error: `snapshot failed: ${e.message}` });
        continue;
      }
    }

    // Apply all rewrites for this file on the in-memory copy.
    let modified = originalContent;
    let changedLines = 0;
    let firstError = null;
    for (const r of fileRewrites) {
      const lines = modified.split('\n');
      const idx = r.line - 1;
      if (idx < 0 || idx >= lines.length) {
        const err = { file: filePath, line: r.line, error: 'line index out of range after earlier mutations', rewrite: r };
        if (!firstError) firstError = err;
        failed.push(err);
        continue;
      }
      if (lines[idx] !== r.oldText) {
        // Line drift: another rewrite in the same batch already touched
        // this line, or the file content shifted. Skip this rewrite but
        // keep going — fail-open.
        const err = { file: filePath, line: r.line, error: 'oldText no longer matches file content (drift)', rewrite: r };
        if (!firstError) firstError = err;
        failed.push(err);
        continue;
      }
      lines[idx] = r.newText;
      modified = lines.join('\n');
      changedLines++;
    }

    if (changedLines === 0) {
      if (snapPath && !dryRun) {
        // Nothing changed but we snapshotted — that's fine, the next run
        // can clean it up via cleanOldSnapshots. Don't fail.
      }
      // Only push a summary failure if we haven't already pushed a more
      // specific per-rewrite error (avoids double-counting drift).
      if (!firstError) {
        failed.push({ file: filePath, error: 'no rewrites produced a valid mutation (all drifted)' });
      }
      continue;
    }

    if (dryRun) {
      applied.push({ file: filePath, snapPath, rewrites: fileRewrites.length, changedLines, dryRun: true });
      continue;
    }

    try {
      const tmp = filePath + '.rename.tmp';
      fs.writeFileSync(tmp, modified, 'utf8');
      fs.renameSync(tmp, filePath);
      applied.push({ file: filePath, snapPath, rewrites: fileRewrites.length, changedLines });
    } catch (e) {
      // Roll back from snapshot.
      if (snapPath) {
        try {
          snapshot.rollback(snapPath, filePath);
        } catch (rbErr) {
          failed.push({ file: filePath, error: `write failed: ${e.message}; rollback also failed: ${rbErr.message}`, snapPath });
          continue;
        }
      }
      failed.push({ file: filePath, error: `write failed: ${e.message}`, snapPath, rolledBack: !!snapPath });
    }
  }

  return {
    applied,
    failed,
    snapshotDir: useSnapshot ? snapshot.SNAPSHOT_DIR : null,
  };
}

// ── Module exports ────────────────────────────────────────────────────────
module.exports = {
  planRename,
  applyRenames,
  // Exposed for tests:
  computeNewSpecifier,
  findRewriteCandidates,
};
