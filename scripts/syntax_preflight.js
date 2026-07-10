#!/usr/bin/env node
/**
 * syntax_preflight.js — Daily syntax check on every scripts/*.js
 *
 * Why:
 *   Incident 2026-07-09: `scripts/knowledge_ingester.js` and
 *   `scripts/rapnet_weekly.js` had garbage text (e.g. `undefined$HOMEundefined`,
 *   `www?.rapnet?.com`) that went undetected for 3-5 days. SHL's `sample`
 *   field was truncating error context to 120 chars (now 500) which masked
 *   the corruption. This script is a belt-and-braces guarantee: a daily
 *   `node --check` sweep that exits non-zero on any syntax error.
 *
 * Behaviour:
 *   - Recursively walks SCRIPTS_DIR for *.js
 *   - Excludes node_modules/, _archive/, _legacy/
 *   - Runs `node --check <file>` on each (execFileSync, no shell)
 *   - Logs OK: <file> per pass; FAIL: <file> + reason per fail
 *   - Final: `Preflight result: <N> OK, <M> FAIL`
 *   - Exit 0 on all OK; exit 1 on any FAIL
 *
 * Hooked into `scripts/audit_daily_cron.js` (04:30 daily) — if this fails,
 * the audit aborts before touching any other code.
 *
 * Usage:
 *   node scripts/syntax_preflight.js
 *   node scripts/syntax_preflight.js --quiet  # only summary line
 *
 * Exit codes:
 *   0 = all scripts pass syntax check
 *   1 = at least one script failed syntax check
 *   2 = unexpected I/O error (couldn't read scripts dir)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WORKSPACE = '/Users/ally/.openclaw/workspace';
const SCRIPTS_DIR = path.join(WORKSPACE, 'scripts');
const EXCLUDE_DIRS = new Set(['node_modules', '_archive', '_legacy']);
const CHECK_TIMEOUT_MS = 10_000;          // per-file `node --check` timeout
const MAX_DEPTH = 10;                     // safety against symlink loops

function findJsFiles(dir, depth) {
  if (depth === undefined) depth = 0;
  if (depth > MAX_DEPTH) return [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    process.stderr.write(`readdir failed for ${dir}: ${e.message}\n`);
    return [];
  }

  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...findJsFiles(full, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function checkSyntax(file) {
  try {
    execFileSync('node', ['--check', file], {
      stdio: 'pipe',
      timeout: CHECK_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (e) {
    // execFileSync throws on non-zero exit; surface stderr (truncated)
    const stderr = e.stderr ? e.stderr.toString() : '';
    const stdout = e.stdout ? e.stdout.toString() : '';
    const reason = stderr.trim() || stdout.trim() || e.message || 'unknown';
    return { ok: false, error: reason.split('\n')[0].slice(0, 200) };
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const QUIET = args.has('--quiet');

  let files;
  try {
    files = findJsFiles(SCRIPTS_DIR);
  } catch (e) {
    process.stderr.write(`FATAL: cannot list ${SCRIPTS_DIR}: ${e.message}\n`);
    process.exit(2);
  }
  files.sort();

  if (!QUIET) {
    process.stdout.write(`Scanning ${files.length} .js files under ${SCRIPTS_DIR} (excluding ${[...EXCLUDE_DIRS].join(', ')})\n`);
  }

  let okCount = 0;
  let failCount = 0;
  const failures = [];

  for (const file of files) {
    const result = checkSyntax(file);
    if (result.ok) {
      okCount++;
      if (!QUIET) process.stdout.write(`OK: ${file}\n`);
    } else {
      failCount++;
      failures.push({ file, error: result.error });
      process.stdout.write(`FAIL: ${file} — ${result.error}\n`);
    }
  }

  process.stdout.write(`Preflight result: ${okCount} OK, ${failCount} FAIL\n`);

  if (failCount > 0) {
    process.stderr.write(`\n❌ ${failCount} file(s) failed syntax check. Run \`node --check <file>\` to inspect.\n`);
    process.exit(1);
  }
  process.exit(0);
}

main();