#!/usr/bin/env node
/**
 * skill_pitfalls_fallback.js — Thin executor (no LLM)
 *
 * Auto-insert a placeholder `## Pitfalls` section into any skill file
 * under `skills-learned/` that is missing one. The skill_reviewer bot's
 * prompt now mandates `## Pitfalls` (Fix #2 — see the MANDATORY block in
 * `skill_reviewer_bot.js`), but historical drafts and edge-case LLM
 * outputs may still lack the section. This script provides a
 * deterministic safety net so those skills pass the post-write validator
 * (`validate_skill_file.js`) instead of being quarantined.
 *
 * Behaviour:
 *   - Scans skills-learned/<dir>/SKILL.md (one level deep, direct children
 *     of `skills-learned/`). Archived / quarantined subdirs (anything
 *     under `skills-learned/_archive/`) are SKIPPED on purpose — we do
 *     not want to "rescue" files that were explicitly quarantined.
 *   - For each file missing a `## Pitfalls` section (line-anchored
 *     header `^## Pitfalls[ \t]*$`), injects a placeholder block:
 *         \n## Pitfalls\n- (none yet — add pitfalls as discovered)\n
 *     The placeholder is appended at the end of the file (before any
 *     trailing whitespace) so it can be edited in place by a human or
 *     sub-agent later. It is intentionally minimal — it satisfies the
 *     "section exists" validator check but its single bullet does NOT
 *     satisfy the `PITFALLS_MIN = 3` check, so a placeholder is still
 *     flagged for human review. This is the desired behaviour: silent
 *     rescue of the structure, loud signal that the content is thin.
 *   - Pre-write backup: every modified file is copied to
 *     `skills-learned/.backup-{timestamp}/<original-relative-path>` so
 *     we can revert if the injection is undesirable. Backups are
 *     timestamped at the start of each run (one backup per run, not
 *     per file) so all changes from a single run live together.
 *
 * Usage:
 *   node scripts/skill_pitfalls_fallback.js [--quiet] [--dry-run] [--verbose]
 *
 * Flags:
 *   --quiet     Suppress per-file output; print only the final summary JSON.
 *   --dry-run   Report what would change, do not write to disk. Exit code
 *               is 1 if any change would be made (for CI gating).
 *   --verbose   Log every file scanned (even ones that already have Pitfalls).
 *
 * Exit codes:
 *   0  success (no changes, or changes written successfully)
 *   1  --dry-run detected files that would be modified (CI signal)
 *   2  fatal error (read/write/backup failure that we could not recover from)
 *
 * Why thin executor:
 *   - Zero LLM calls. Pure file IO.
 *   - Mirrors the pattern from `skill_junk_pause.js` (no-LLM, JSON output,
 *     graceful error handling, never blocks its caller).
 *   - Idempotent: running twice in a row is a no-op the second time,
 *     because files with `## Pitfalls` are skipped.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { WS, SKILLS_LEARNED } = require('./lib/config');
const { safeWriteFileSync } = require('./lib/disk_guard');

// ── Constants ──

const PITFALLS_HEADER_REGEX = /^##\s+Pitfalls[ \t]*$/m;
const PLACEHOLDER_BLOCK = '\n## Pitfalls\n- (none yet — add pitfalls as discovered)\n';
const SKIP_DIRS = new Set(['_archive']);  // quarantined + failed-validations subdirs

// ── Helpers ──

function log() {
  if (!process.argv.includes('--quiet')) console.log.apply(console, arguments);
}

function err() {
  console.error.apply(console, arguments);
}

function isVerbose() {
  return process.argv.includes('--verbose');
}

function isDryRun() {
  return process.argv.includes('--dry-run');
}

/**
 * Check whether a file already has a `## Pitfalls` section.
 * Line-anchored match to mirror the validator's detection logic.
 */
function hasPitfallsSection(content) {
  return PITFALLS_HEADER_REGEX.test(content);
}

/**
 * Build the backup root path for a given run. One backup dir per run
 * so all changes from a single invocation are colocated and can be
 * reverted as a group with `rm -rf skills-learned/.backup-<ts>`.
 */
function backupDirFor(ts) {
  return path.join(SKILLS_LEARNED, '.backup-' + ts);
}

/**
 * Discover skill files to process.
 *
 * Scans only skills-learned/<dir>/SKILL.md (one level deep, direct children).
 * Skips the `skills-learned/_archive/` subtree entirely — quarantined
 * and failed-validation files are explicitly out of scope.
 *
 * Returns an array of absolute paths to SKILL.md files in scope.
 */
function discoverSkillFiles() {
  if (!fs.existsSync(SKILLS_LEARNED)) return [];
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(SKILLS_LEARNED, { withFileTypes: true });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;          // _archive/
    if (entry.name.startsWith('.backup-')) continue;  // our own backup dirs
    const skillPath = path.join(SKILLS_LEARNED, entry.name, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      out.push(skillPath);
    }
  }
  return out;
}

/**
 * Inject a `## Pitfalls` placeholder into a file that lacks one.
 *
 * Strategy: append the placeholder at end-of-file, after stripping
 * any trailing whitespace. The placeholder itself starts with a
 * newline so it always sits on its own line. We do NOT try to splice
 * it into a specific position — appending is the simplest, most
 * predictable behaviour, and a human editor can move the section
 * later if they prefer a different position.
 *
 * @returns {{ newContent: string, injectedBytes: number }}
 */
function injectPitfallsPlaceholder(content) {
  const trimmed = content.replace(/\s+$/, '');   // strip trailing whitespace
  const newContent = trimmed + PLACEHOLDER_BLOCK;
  return { newContent, injectedBytes: PLACEHOLDER_BLOCK.length };
}

/**
 * Process a single file. Returns a status object describing the action.
 */
function processFile(absPath, backupDir) {
  let content;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return { file: absPath, action: 'read-error', error: e.message };
  }
  if (hasPitfallsSection(content)) {
    return { file: absPath, action: 'skip-has-pitfalls' };
  }
  const { newContent, injectedBytes } = injectPitfallsPlaceholder(content);
  if (isDryRun()) {
    return { file: absPath, action: 'would-inject', injectedBytes };
  }
  // Backup BEFORE write so a crash mid-write still has the original.
  if (backupDir) {
    try {
      const rel = path.relative(SKILLS_LEARNED, absPath);
      const backupPath = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(absPath, backupPath);
    } catch (e) {
      return { file: absPath, action: 'backup-error', error: e.message };
    }
  }
  // Atomic write via disk_guard (ENOSPC-safe, tmp + rename).
  const ok = safeWriteFileSync(absPath, newContent);
  if (!ok) {
    return { file: absPath, action: 'write-error', error: 'ENOSPC' };
  }
  return { file: absPath, action: 'injected', injectedBytes };
}

// ── Main ──

function main() {
  const startTs = new Date();
  const tsTag = startTs.toISOString().replace(/[:.]/g, '-');
  const verbose = isVerbose();
  const dryRun = isDryRun();

  log('=== Skill Pitfalls Fallback ===');
  if (dryRun) log('[DRY-RUN] no files will be modified');

  const files = discoverSkillFiles();
  if (verbose) log('Discovered ' + files.length + ' SKILL.md file(s) in scope');

  // Single backup dir per run (only created if we actually need it)
  const backupDir = dryRun ? null : backupDirFor(tsTag);

  const results = {
    scanned: 0,
    skipped: 0,
    injected: 0,
    wouldInject: 0,
    errors: [],
  };
  const details = [];

  for (const absPath of files) {
    results.scanned++;
    if (verbose) log('  scan: ' + path.relative(WS, absPath));
    const r = processFile(absPath, backupDir);
    details.push(r);
    switch (r.action) {
      case 'skip-has-pitfalls':
        results.skipped++;
        if (verbose) log('    → skip (already has Pitfalls)');
        break;
      case 'injected':
        results.injected++;
        log('  INJECT: ' + path.relative(WS, absPath) + ' (+' + r.injectedBytes + 'B)');
        break;
      case 'would-inject':
        results.wouldInject++;
        log('  WOULD INJECT: ' + path.relative(WS, absPath) + ' (+' + r.injectedBytes + 'B)');
        break;
      case 'read-error':
      case 'backup-error':
      case 'write-error':
        results.errors.push({ file: path.relative(WS, absPath), action: r.action, error: r.error });
        err('  ERROR (' + r.action + '): ' + path.relative(WS, absPath) + ' — ' + r.error);
        break;
    }
  }

  if (results.injected > 0 && !dryRun) {
    log('Backup of modified files: ' + backupDir);
  }

  const summary = {
    action: 'pitfalls-fallback',
    timestamp: startTs.toISOString(),
    dryRun: dryRun,
    backupDir: backupDir || null,
    scanned: results.scanned,
    skipped: results.skipped,
    injected: results.injected,
    wouldInject: results.wouldInject,
    errors: results.errors,
  };

  // Final summary JSON (always emitted, even under --quiet, for cron consumption)
  console.log(JSON.stringify(summary));

  // Exit code semantics:
  //   0  success (no work, or all writes succeeded)
  //   1  --dry-run detected changes (CI gate signal)
  //   2  fatal error
  if (results.errors.length > 0 && results.injected === 0 && results.wouldInject === 0) {
    process.exit(2);
  }
  if (dryRun && results.wouldInject > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    err('Fatal: ' + e.message);
    console.log(JSON.stringify({ action: 'error', error: e.message }));
    process.exit(2);
  }
}

module.exports = {
  hasPitfallsSection,
  injectPitfallsPlaceholder,
  discoverSkillFiles,
  processFile,
  PLACEHOLDER_BLOCK,
};
