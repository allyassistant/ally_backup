#!/usr/bin/env node
/**
 * test_resume.js — Unit test for skill_reviewer_resume.js
 *
 * Test scenarios:
 *   1. No pause file → action: not-paused
 *   2. Pause file with `until` in the past → action: expired (file untouched)
 *   3. Pause file with `until` in the future → action: force-resume (file removed)
 *   4. Pause file with future `until` + --dry-run → action: force-resume, unlinked: false
 *   5. Corrupt pause file → action: error, paused: true
 *
 * Approach: back up real file, write mock, run script, restore.
 *
 * Exit code: 0 if all pass, 1 otherwise.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { WS } = require('./lib/config');
const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');
const SCRIPT = path.join(WS, 'scripts', 'skill_reviewer_resume.js');

let pass = 0, fail = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    pass++;
    console.log('  ✅ ' + msg);
  } else {
    fail++;
    failures.push(msg);
    console.log('  ❌ ' + msg);
  }
}

function backup(file) {
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  return null;
}

function restore(file, content) {
  if (content === null) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
      console.error(`File deletion failed: ${e.message}`);
    }
  } else {
    try {
      fs.writeFileSync(file, content, 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
  }
}

function runScript(args) {
  try {
    const out = execFileSync('node', [SCRIPT].concat(args), {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: out, stderr: '', code: 0 };
  } catch (e) {
    return { ok: false, stdout: e.stdout ? e.stdout.toString() : '', stderr: e.stderr ? e.stderr.toString() : '', code: e.status || 1 };
  }
}

function runTests() {
  const pauseBackup = backup(PAUSE_FILE);
  try {
    if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);
  } catch (e) {
    console.error(`File deletion failed: ${e.message}`);
  }

  try {
    const now = Date.now();

    // ── Test 1: no pause file → not-paused ──
    console.log('\n── Test 1: no pause file → not-paused ──');
    const r1 = runScript([]);
    assert(r1.ok, 'script exited 0');
    assert(/"action"\s*:\s*"not-paused"/.test(r1.stdout), 'stdout action: not-paused');
    assert(!fs.existsSync(PAUSE_FILE), 'no pause file created');

    // ── Test 2: expired pause (until in past) → expired ──
    console.log('\n── Test 2: expired pause → action: expired (file untouched) ──');
    const expiredPause = {
      pausedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
      until: now - 60 * 60 * 1000,  // 1h ago
      reason: 'auto-pause: test expired',
      junkRateAtPause: 0.20,
      threshold: 0.15,
    };
    fs.writeFileSync(PAUSE_FILE, JSON.stringify(expiredPause, null, 2), 'utf8');
    const r2 = runScript([]);
    assert(r2.ok, 'script exited 0');
    assert(/"action"\s*:\s*"expired"/.test(r2.stdout), 'stdout action: expired');
    assert(fs.existsSync(PAUSE_FILE), 'expired pause file NOT removed (cron will handle)');
    // Verify content preserved
    let r2_content;
    try {
      r2_content = JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    assert(r2_content.until === expiredPause.until, 'pause file content preserved');

    // ── Test 3: active pause (until in future) → force-resume, file removed ──
    console.log('\n── Test 3: active pause → force-resume, file removed ──');
    const activePause = {
      pausedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      until: now + 22 * 60 * 60 * 1000,  // 22h from now
      reason: 'auto-pause: test active',
      junkRateAtPause: 0.20,
      threshold: 0.15,
    };
    try {
      fs.writeFileSync(PAUSE_FILE, JSON.stringify(activePause, null, 2), 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
    const r3 = runScript([]);
    assert(r3.ok, 'script exited 0');
    assert(/"action"\s*:\s*"force-resume"/.test(r3.stdout), 'stdout action: force-resume');
    assert(/"unlinked"\s*:\s*true/.test(r3.stdout), 'stdout unlinked: true');
    assert(!fs.existsSync(PAUSE_FILE), 'pause file removed');

    // ── Test 4: active pause + --dry-run → force-resume, unlinked: false ──
    console.log('\n── Test 4: active pause + --dry-run → unlinked: false ──');
    try {
      fs.writeFileSync(PAUSE_FILE, JSON.stringify(activePause, null, 2), 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
    const r4 = runScript(['--dry-run']);
    assert(r4.ok, 'script exited 0');
    assert(/"action"\s*:\s*"force-resume"/.test(r4.stdout), 'stdout action: force-resume');
    assert(/"unlinked"\s*:\s*false/.test(r4.stdout), 'stdout unlinked: false (dry-run)');
    assert(fs.existsSync(PAUSE_FILE), 'pause file preserved in dry-run');

    // Cleanup before next test
    try {
      if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);
    } catch (e) {
      console.error(`File deletion failed: ${e.message}`);
    }

    // ── Test 5: corrupt pause file → error ──
    console.log('\n── Test 5: corrupt pause file → action: error ──');
    try {
      fs.writeFileSync(PAUSE_FILE, 'not valid json {{{', 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
    const r5 = runScript([]);
    assert(r5.ok, 'script exited 0 (thin executor never fails cron)');
    assert(/"action"\s*:\s*"error"/.test(r5.stdout), 'stdout action: error');
    assert(/"paused"\s*:\s*true/.test(r5.stdout), 'stdout paused: true (file exists)');

  } finally {
    restore(PAUSE_FILE, pauseBackup);
  }
}

console.log('═══════════════════════════════════════════════════');
console.log('  Skill Resume CLI Unit Tests');
console.log('═══════════════════════════════════════════════════');

runTests();

console.log('\n─────────────────────────────────────────────────');
console.log('  Results: ' + pass + ' passed, ' + fail + ' failed');
console.log('─────────────────────────────────────────────────');

if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(function (m) { console.log('  • ' + m); });
  process.exit(1);
}

process.exit(0);
