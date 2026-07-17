#!/usr/bin/env node
/**
 * diff_watcher.js — Phase 4 Diff Watcher
 *
 * Pure observer-style monitor for `scripts/*.js` mutations.
 * Compares the last-known commit SHA (persisted in `.diff_watcher_state.json`)
 * against current HEAD. If any `scripts/*.js` files changed between the two,
 * push a Discord alert to #⚙️系統 with file names, SHA transition, and a
 * short diff snippet.
 *
 * Design principles:
 *   - OBSERVER ONLY: never writes to scripts/ or any other tracked file
 *   - The only file this script writes is `.diff_watcher_state.json` (its own state)
 *   - Fail-soft on missing state (auto-create on first run with no alert)
 *   - Fail-soft on git errors (skip, don't crash) — only true fatal errors exit 1
 *
 * Usage:
 *   node scripts/diff_watcher.js
 *
 * Exit codes:
 *   0 = success (no changes OR alert pushed)
 *   1 = unexpected error (git missing, state write failed, discord push failed)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { WS } = require('./lib/config');
const discord = require('./lib/discord_push');

const STATE_FILE = path.join(WS, '.diff_watcher_state.json');
const DISCORD_CHANNEL = 'channel:1473376125584670872'; // #⚙️系統

// Tunables
const MAX_DIFF_FILES = 3;
const MAX_DIFF_LINES = 8;
const GIT_TIMEOUT_MS = 5000;
const GIT_DIFF_TIMEOUT_MS = 10000;

// ───────────────────────────────────────────────────────────────────────────
// State I/O (atomic)
// ───────────────────────────────────────────────────────────────────────────

function getState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.lastSha === 'string') {
      return parsed;
    }
    return { lastSha: null };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { lastSha: null };
    // Corruption: back up and start fresh (do not crash the watcher)
    try {
      fs.renameSync(STATE_FILE, STATE_FILE + '.corrupt.' + Date.now());
    } catch (_) { /* best effort */ }
    return { lastSha: null };
  }
}

function saveState(s) {
  const tmpFile = STATE_FILE + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(s, null, 2), 'utf8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    throw err;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Git helpers (fail-soft)
// ───────────────────────────────────────────────────────────────────────────

function getCurrentSha() {
  let __ret_80_0;
  try {
    __ret_80_0 = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  }).trim();
  } catch (e) {
    console.error(`Command execution failed: ${e.message}`);
    return null;
  }
  return __ret_80_0;
}

function getScriptsChanged(fromSha, toSha) {
  if (!fromSha || fromSha === toSha) return [];
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', fromSha + '..' + toSha, '--', 'scripts/'],
      { encoding: 'utf8', timeout: GIT_DIFF_TIMEOUT_MS }
    );
    return out.split('\n').map(f => f.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function getDiffSnippet(file, fromSha, toSha) {
  try {
    const out = execFileSync(
      'git',
      ['diff', fromSha + '..' + toSha, '--', file],
      { encoding: 'utf8', timeout: GIT_TIMEOUT_MS }
    );
    const lines = out.split('\n').slice(0, MAX_DIFF_LINES).join('\n');
    return '**' + file + '**:\n```diff\n' + lines + '\n```';
  } catch (_) {
    return '**' + file + '** (diff fetch failed)';
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

function main() {
  const state = getState();
  const currentSha = getCurrentSha();
  const changes = getScriptsChanged(state.lastSha, currentSha);

  // First run: bootstrap state, no alert
  if (!state.lastSha) {
    console.log('[diff_watcher] bootstrap: lastSha was null, saving HEAD and exiting');
    saveState({ lastSha: currentSha, lastChecked: new Date().toISOString() });
    return;
  }

  // No changes since last check
  if (changes.length === 0) {
    console.log('[diff_watcher] no script changes since ' + state.lastSha.substring(0, 7));
    saveState({ lastSha: currentSha, lastChecked: new Date().toISOString() });
    return;
  }

  // Filter to .js / .mjs only (spec)
  const jsChanges = changes.filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
  if (jsChanges.length === 0) {
    console.log('[diff_watcher] only non-.js script changes (count=' + changes.length + '), saving state');
    saveState({ lastSha: currentSha, lastChecked: new Date().toISOString() });
    return;
  }

  // Build diff snippets (max 3 files, 8 lines each to keep under Discord 1900-byte cap)
  const snippets = jsChanges.slice(0, MAX_DIFF_FILES).map(f =>
    getDiffSnippet(f, state.lastSha, currentSha)
  ).join('\n\n');

  const more = jsChanges.length > MAX_DIFF_FILES
    ? '\n_(+' + (jsChanges.length - MAX_DIFF_FILES) + ' more files)_'
    : '';

  const alert =
    '🔔 **Diff Watcher — scripts/ changed**\n\n' +
    'SHA: `' + state.lastSha.substring(0, 7) + '` → `' + currentSha.substring(0, 7) + '`\n' +
    'Files: ' + jsChanges.length + '\n\n' +
    snippets + more;

  const result = discord.push({ message: alert, target: DISCORD_CHANNEL });
  if (!result.ok) {
    console.error('[diff_watcher] Discord push failed:', result.error);
    process.exit(1);
  }
  console.log('[diff_watcher] alert pushed for ' + jsChanges.length + ' file(s)');
  saveState({ lastSha: currentSha, lastChecked: new Date().toISOString() });
}

try {
  main();
} catch (e) {
  console.error('[diff_watcher] fatal:', e && e.message ? e.message : e);
  process.exit(1);
}
