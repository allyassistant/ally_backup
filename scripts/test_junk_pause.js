#!/usr/bin/env node
/**
 * test_junk_pause.js — Unit tests for skill_junk_pause.js
 *
 * Tests the thin executor's logic by writing mock .skill_junk_rate.jsonl
 * data and running the script as a subprocess.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { WS } = require('./lib/config');

const SCRIPT = path.join(__dirname, 'skill_junk_pause.js');
const JUNK_RATE_FILE = path.join(WS, '.skill_junk_rate.jsonl');
const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');

let passed = 0;
let failed = 0;

function logPass(msg) { passed++; console.log('  ✅ ' + msg); }
function logFail(msg) { failed++; console.log('  ❌ ' + msg); }
function assert(cond, msg) { cond ? logPass(msg) : logFail(msg); }

function backup(file) {
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  return null;
}
function restore(file, content) {
  if (content === null) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch(e) {} }
  else { fs.writeFileSync(file, content, 'utf8'); }
}

function runScript(args) {
  try {
    const out = execFileSync('node', [SCRIPT].concat(args), {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: out.trim(), stderr: '', code: 0 };
  } catch (e) {
    return { ok: false, stdout: (e.stdout || '').toString().trim(), stderr: (e.stderr || '').toString().trim(), code: e.status || 1 };
  }
}

function runTests() {
  const junkBackup = backup(JUNK_RATE_FILE);
  const pauseBackup = backup(PAUSE_FILE);

  console.log('═══════════════════════════════════════════════════');
  console.log('  Skill Junk Pause Unit Tests');
  console.log('═══════════════════════════════════════════════════');

  // ── Test 1: 5 entries with ~22% avg junk rate → should pause ──
  console.log('\n── Test 1: 22% junk rate → pause ──');
  const now = Date.now();
  const entries = [];
  for (let i = 0; i < 5; i++) {
    entries.push({
      v: 2,
      ts: new Date(now - i * 60 * 60 * 1000).toISOString(),
      junkInProductionRate: 20 + i,
      validatorCatchRate: 50,
      total: 10,
      passed: 8,
      failed: 2,
    });
  }
  try {
    fs.writeFileSync(JUNK_RATE_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  try { if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE); } catch(e) {}

  const r1 = runScript(['--threshold', '0.15']);
  assert(r1.ok, 'script exited 0 (got code ' + r1.code + ')');
  assert(fs.existsSync(PAUSE_FILE), 'pause file created');
  const pause = JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
  assert(typeof pause.until === 'number' && pause.until > Date.now(), 'pause.until is in the future');
  assert(typeof pause.reason === 'string', 'reason field exists');
  assert(r1.stdout.includes('"action":"pause"'), 'stdout has action:pause');

  // ── Test 2: rate below threshold → no pause ──
  console.log('\n── Test 2: 5% junk rate → no pause ──');
  const entries2 = [];
  for (let i = 0; i < 3; i++) {
    entries2.push({
      v: 2,
      ts: new Date(now - i * 60 * 60 * 1000).toISOString(),
      junkInProductionRate: 5,
      validatorCatchRate: 50,
      total: 10,
      passed: 9,
      failed: 1,
    });
  }
  try {
    fs.writeFileSync(JUNK_RATE_FILE, entries2.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  try { if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE); } catch(e) {}

  const r2 = runScript(['--threshold', '0.15']);
  assert(r2.ok, 'script exited 0');
  assert(!fs.existsSync(PAUSE_FILE), 'no pause file created (rate below threshold)');
  assert(r2.stdout.includes('"action":"no-action"'), 'stdout has action:no-action');

  // ── Test 3: expired pause → cleared ──
  console.log('\n── Test 3: expired pause → cleared ──');
  const expiredPause = {
    pausedAt: new Date(now - 86400000).toISOString(),
    until: now - 60000,
    reason: 'old pause',
    junkRateAtPause: 0.22,
    threshold: 0.15,
  };
  fs.writeFileSync(PAUSE_FILE, JSON.stringify(expiredPause, null, 2) + '\n', 'utf8');
  fs.writeFileSync(JUNK_RATE_FILE, entries2.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  const r3 = runScript(['--threshold', '0.15']);
  assert(r3.ok, 'script exited 0');
  assert(!fs.existsSync(PAUSE_FILE), 'expired pause file cleared');
  assert(r3.stdout.includes('"action":"resume"'), 'stdout has action:resume');

  // ── Test 4: active pause → untouched ──
  console.log('\n── Test 4: active pause → kept ──');
  const activePause = {
    pausedAt: new Date(now - 3600000).toISOString(),
    until: now + 3600000,
    reason: 'active pause',
    junkRateAtPause: 0.22,
    threshold: 0.15,
  };
  try {
    fs.writeFileSync(PAUSE_FILE, JSON.stringify(activePause, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }

  const r4 = runScript(['--threshold', '0.15']);
  assert(r4.ok, 'script exited 0');
  assert(fs.existsSync(PAUSE_FILE), 'active pause file kept');
  assert(r4.stdout.includes('"action":"keep-paused"'), 'stdout has action:keep-paused');
  assert(r4.stdout.includes('hoursLeft'), 'stdout shows hours');

  // ── Cleanup ──
  restore(JUNK_RATE_FILE, junkBackup);
  restore(PAUSE_FILE, pauseBackup);

  console.log('\n─────────────────────────────────────────────────');
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('─────────────────────────────────────────────────');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
