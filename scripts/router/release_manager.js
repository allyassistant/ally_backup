#!/usr/bin/env node
/**
 * release_manager.js — CLI for the releaseId schema (Phase 1)
 *
 * Commands:
 *   create "<summary>" [--actor X] [--type T] [--files "a,b,c"]
 *   list   [--limit N]
 *   current
 *   clear
 *   show <releaseId>
 *   resolve <iso-timestamp>
 *   help
 *
 * Exit codes:
 *   0  success
 *   1  not-found / failure
 *   2  invalid usage
 *
 * Pure Node.js built-ins. Failures are reported and exit non-zero.
 */

'use strict';

const path = require('path');
const {
  currentReleaseId,
  getOrCreateReleaseId,
  recordRelease,
  clearRelease,
  readReleases,
  readCurrentFile,
  lookupReleaseAtTs,
  generateReleaseId,
  getStatePaths,
} = require('./release_id');

// ────────────────────────── helpers ──────────────────────────

function printHelp() {
  const paths = getStatePaths();
  console.log(`
release_manager.js — manage releaseId for router decision tracking

Usage:
  node scripts/router/release_manager.js <command> [args]

Commands:
  create "<summary>"          Create a new release (or reuse current if active)
                              --actor <name>      who (default: "user")
                              --type <type>       manual|auto-commit|config-change|...
                              --files "a.js,b.js" comma-separated file list
  list   [--limit N]          Show recent releases (default 20)
  current                     Show current releaseId (active only)
  clear                       Mark current release expired
  show <releaseId>            Show release details (JSON)
  resolve <iso-timestamp>     Find releaseId active at a given time
  help                        Show this help

State files:
  current: ${paths.CURRENT_FILE}
  history: ${paths.RELEASES_FILE}

Examples:
  node scripts/router/release_manager.js create "v2.4 — releaseId schema"
  node scripts/router/release_manager.js current
  node scripts/router/release_manager.js list --limit 5
  node scripts/router/release_manager.js resolve 2026-07-08T20:00:00Z
`);
}

/** Parse --flag value pairs out of a string array. Positional args keep their order. */
function parseArgs(allArgs) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < allArgs.length; i++) {
    const a = allArgs[i];
    if (typeof a === 'string' && a.startsWith('--')) {
      const key = a.slice(2);
      const next = allArgs[i + 1];
      if (next !== undefined && (typeof next !== 'string' || !next.startsWith('--'))) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

/** Truncate a string for table display. */
function trunc(s, max) {
  s = String(s == null ? '' : s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ────────────────────────── commands ──────────────────────────

function cmdCreate({ positional, flags }) {
  if (positional.length === 0) {
    console.error('Error: create requires a summary string');
    return 2;
  }
  const summary = String(positional[0]);
  const actor = typeof flags.actor === 'string' ? flags.actor : 'user';
  const type = typeof flags.type === 'string' ? flags.type : 'manual';
  const filesRaw = typeof flags.files === 'string' ? flags.files : '';
  const files = filesRaw
    ? filesRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const id = getOrCreateReleaseId({ summary, actor, type, files });
  if (!id) {
    console.error('Error: failed to create release (write failed)');
    return 1;
  }
  console.log(`✓ Created release: ${id}`);
  console.log(`  type:    ${type}`);
  console.log(`  actor:   ${actor}`);
  console.log(`  summary: ${summary}`);
  if (files.length > 0) console.log(`  files:   ${files.join(', ')}`);
  return 0;
}

function cmdList({ flags }) {
  const limitRaw = flags.limit;
  const limit = Math.max(1, parseInt(limitRaw === true ? 20 : limitRaw, 10) || 20);
  const all = readReleases();
  if (all.length === 0) {
    console.log('No releases recorded yet.');
    return 0;
  }
  const recent = all.slice(-limit).reverse();
  console.log(`Recent ${recent.length} of ${all.length} release(s):\n`);
  const header = [
    'releaseId'.padEnd(38),
    'ts'.padEnd(22),
    'releasedAt'.padEnd(22),
    'type'.padEnd(16),
    'actor'.padEnd(14),
    'summary',
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of recent) {
    const row = [
      String(r.releaseId || '').padEnd(38),
      String(r.ts || '-').padEnd(22),
      String(r.releasedAt || '(active)').padEnd(22),
      String(r.type || '-').padEnd(16),
      String(r.actor || '-').padEnd(14),
      trunc(r.summary, 60),
    ].join(' | ');
    console.log(row);
  }
  return 0;
}

function cmdCurrent() {
  const cur = readCurrentFile();
  if (!cur || !cur.releaseId) {
    console.log('No current releaseId set.');
    return 0;
  }
  const isActive = !cur.releasedAt;
  console.log(`${isActive ? 'Active' : 'Last'} releaseId: ${cur.releaseId}`);
  console.log(`  status:    ${isActive ? 'active' : 'released'}`);
  console.log(`  createdAt: ${cur.createdAt || '-'}`);
  console.log(`  releasedAt: ${cur.releasedAt || '(active)'}`);
  if (isActive) {
    // Verify our public helper agrees:
    const liveId = currentReleaseId();
    if (liveId !== cur.releaseId) {
      console.log(`  ⚠️ currentReleaseId() returned: ${liveId || 'null'} (mismatch)`);
    }
  }
  return 0;
}

function cmdClear() {
  const cur = readCurrentFile();
  if (!cur || !cur.releaseId) {
    console.log('No current releaseId to clear.');
    return 0;
  }
  if (cur.releasedAt) {
    console.log(`Release ${cur.releaseId} already released at ${cur.releasedAt}`);
    return 0;
  }
  const id = clearRelease();
  if (!id) {
    console.error('Error: clearRelease failed');
    return 1;
  }
  console.log(`✓ Marked ${id} as released.`);
  return 0;
}

function cmdShow({ positional }) {
  if (positional.length === 0) {
    console.error('Error: show requires <releaseId>');
    return 2;
  }
  const target = String(positional[0]);
  const all = readReleases();
  const found = all.find(r => r.releaseId === target);
  if (!found) {
    console.error(`Release not found: ${target}`);
    return 1;
  }
  console.log(JSON.stringify(found, null, 2));
  return 0;
}

function cmdResolve({ positional }) {
  if (positional.length === 0) {
    console.error('Error: resolve requires <iso-timestamp>');
    return 2;
  }
  const ts = String(positional[0]);
  const id = lookupReleaseAtTs(ts);
  if (!id) {
    console.log(`No release active at ${ts}`);
    return 0;
  }
  console.log(`Active release at ${ts}: ${id}`);
  return 0;
}

// ────────────────────────── dispatch ──────────────────────────

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    return 0;
  }
  const cmd = String(args[0]);
  const rest = args.slice(1);
  const parsed = parseArgs(rest);

  switch (cmd) {
    case 'create': return cmdCreate(parsed);
    case 'list': return cmdList(parsed);
    case 'current': return cmdCurrent();
    case 'clear': return cmdClear();
    case 'show': return cmdShow(parsed);
    case 'resolve': return cmdResolve(parsed);
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      return 2;
  }
}

if (require.main === module) {
  try {
    const code = main();
    process.exit(typeof code === 'number' ? code : 0);
  } catch (err) {
    console.error(`release_manager error: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
}

module.exports = {
  cmdCreate,
  cmdList,
  cmdCurrent,
  cmdClear,
  cmdShow,
  cmdResolve,
  parseArgs,
};
