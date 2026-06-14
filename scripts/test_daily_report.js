#!/usr/bin/env node
/**
 * test_daily_report.js — Unit test for skill_reviewer_daily_report.js
 *
 * Test scenarios:
 *   1. Mock 10 entries in .skill_created.jsonl (7 pass, 3 reject) → verify report contains expected counts
 *   2. Mock .skill_junk_rate.jsonl with 18% rate → verify junk line shows it and flag
 *   3. Mock .skill_reviewer_pause.json active → verify pause line
 *   4. With --dry-run, no Discord push attempted
 *
 * Approach: back up real files, write mock data, run script, restore.
 *
 * Exit code: 0 if all pass, 1 otherwise.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { WS } = require('./lib/config');
const SKILL_CREATED_LOG = path.join(WS, '.skill_created.jsonl');
const JUNK_RATE_FILE = path.join(WS, '.skill_junk_rate.jsonl');
const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');
const SCRIPT = path.join(WS, 'scripts', 'skill_reviewer_daily_report.js');

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
  const createdBackup = backup(SKILL_CREATED_LOG);
  const junkBackup = backup(JUNK_RATE_FILE);
  const pauseBackup = backup(PAUSE_FILE);

  // Clean slate
  try {
    if (fs.existsSync(SKILL_CREATED_LOG)) fs.unlinkSync(SKILL_CREATED_LOG);
  } catch (e) {
    console.error(`File deletion failed: ${e.message}`);
  }
  try {
    if (fs.existsSync(JUNK_RATE_FILE)) fs.unlinkSync(JUNK_RATE_FILE);
  } catch (e) {
    console.error(`File deletion failed: ${e.message}`);
  }
  try {
    if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);
  } catch (e) {
    console.error(`File deletion failed: ${e.message}`);
  }

  try {
    const now = Date.now();
    // ── Setup: 10 events (7 pass+symlinked, 2 fail+quarantine, 1 paused) ──
    const events = [];
    for (let i = 0; i < 7; i++) {
      events.push({
        v: 1,
        ts: new Date(now - i * 60 * 60 * 1000).toISOString(),
        name: 'cron-skill-' + i,
        file: 'skills-learned/cron-skill-' + i + '/SKILL.md',
        bytes: 3000,
        pitfallsCount: 3,
        workflowSteps: 4,
        validationPassed: true,
        symlinked: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      events.push({
        v: 1,
        ts: new Date(now - (7 + i) * 60 * 60 * 1000).toISOString(),
        name: 'bad-skill-' + i,
        file: 'skills-learned/bad-skill-' + i + '/SKILL.md',
        bytes: 500,
        validationPassed: false,
        symlinked: false,
        reason: 'pre-write validator fail (QW-3)',
      });
    }
    events.push({
      v: 1,
      ts: new Date(now - 9 * 60 * 60 * 1000).toISOString(),
      name: 'paused-skill-1',
      file: 'skills-learned/paused-skill-1/SKILL.md',
      bytes: 3000,
      validationPassed: true,
      symlinked: false,
      reason: 'auto-paused (junk rate > 0.15 until 2026-06-13)',
    });

    try {
      fs.writeFileSync(SKILL_CREATED_LOG, events.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n', 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }

    // ── Test 1: junk rate below threshold, no pause ──
    console.log('\n── Test 1: 7 pass + 2 reject + 1 paused, junk=10% ──');
    const junkEntry = {
      v: 2,
      ts: new Date(now).toISOString(),
      windowDays: 1,
      junkInProductionRate: 10,
      validatorCatchRate: 30,
      target: 10,
      total: 30,
      passed: 20,
      failed: 10,
    };
    try {
      fs.writeFileSync(JUNK_RATE_FILE, JSON.stringify(junkEntry) + '\n', 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }

    const r1 = runScript(['--dry-run', '--no-discord']);
    assert(r1.ok, 'script exited 0 (code ' + r1.code + ')');
    assert(/Total: 10/.test(r1.stdout), 'Total: 10 in stdout');
    assert(/Passed: 8/.test(r1.stdout), 'Passed: 8 in stdout (7 symlinked + 1 paused)');
    assert(/Rejected: 2/.test(r1.stdout), 'Rejected: 2 in stdout');
    assert(/Junk-in-Production \(24h\): 10\.00%/.test(r1.stdout), 'Junk-in-Production 10.00% in stdout');
    assert(/Validator Catch Rate: 30\.00%/.test(r1.stdout), 'Validator Catch Rate 30.00% in stdout');
    assert(/Top clusters: cron\(7\)/.test(r1.stdout), 'Top clusters includes cron(7)');
    assert(/Pause status: inactive/.test(r1.stdout), 'Pause status: inactive in stdout');

    // ── Test 2: junk rate above threshold → flag ──
    console.log('\n── Test 2: junk rate 18% (above 15% threshold) ──');
    const junkEntry2 = Object.assign({}, junkEntry, { junkInProductionRate: 18 });
    try {
      fs.writeFileSync(JUNK_RATE_FILE, JSON.stringify(junkEntry2) + '\n', 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }

    const r2 = runScript(['--dry-run', '--no-discord']);
    assert(r2.ok, 'script exited 0');
    assert(/Junk-in-Production \(24h\): 18\.00%.*⚠️/.test(r2.stdout), 'junk line has ⚠️ flag when above threshold');

    // ── Test 3: active pause ──
    console.log('\n── Test 3: active pause file ──');
    const activePause = {
      pausedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      until: now + 22 * 60 * 60 * 1000,
      reason: 'auto-pause: junk rate 18% > 15%',
      junkRateAtPause: 0.18,
      threshold: 0.15,
    };
    try {
      fs.writeFileSync(PAUSE_FILE, JSON.stringify(activePause, null, 2), 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }

    const r3 = runScript(['--dry-run', '--no-discord']);
    assert(r3.ok, 'script exited 0');
    assert(/Pause status: ACTIVE/.test(r3.stdout), 'Pause status: ACTIVE in stdout');
    assert(/18\.00%/.test(r3.stdout), 'Pause line shows junkRateAtPause 18%');

    // ── Test 4: --no-discord suppresses Discord call (we use --dry-run too) ──
    console.log('\n── Test 4: --no-discord does not invoke openclaw ──');
    const r4 = runScript(['--dry-run', '--no-discord']);
    assert(r4.ok, 'script exited 0 with --no-discord');
    // Verify the report is still printed
    assert(r4.stdout.indexOf('Skill Reviewer Daily Report') !== -1, 'report still printed to stdout');

  } finally {
    restore(SKILL_CREATED_LOG, createdBackup);
    restore(JUNK_RATE_FILE, junkBackup);
    restore(PAUSE_FILE, pauseBackup);
  }
}

console.log('═══════════════════════════════════════════════════');
console.log('  Skill Daily Report Unit Tests');
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
