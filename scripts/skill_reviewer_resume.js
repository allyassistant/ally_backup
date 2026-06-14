#!/usr/bin/env node
/**
 * skill_reviewer_resume.js — Manual override CLI (thin executor, no LLM)
 *
 * Week 1 Safety Net (Issue #154): force-clear skill_reviewer pause marker.
 *
 * Use case: Josh sees a 24h auto-pause is active but wants to resume
 * immediately (e.g. tracker has settled, or junk was a one-off).
 *
 * Behaviour:
 *   - Pause file missing       → {action: 'not-paused'}
 *   - Pause file expired (now >= until) → {action: 'expired'}  (do not touch file; let cron re-evaluate)
 *   - Pause file active (now < until)   → {action: 'force-resume', unlinked: true}
 *
 * Usage:
 *   node scripts/skill_reviewer_resume.js [--quiet] [--dry-run]
 *
 * Exit codes:
 *   0  always
 *
 * Why thin executor:
 *   - No LLM. Pure file IO.
 *   - Can be safely called from Discord / shell by Josh.
 *   - No side effects beyond pause file (no Discord push, no LLM call).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { WS } = require('./lib/config');

const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');

function log() {
  if (!process.argv.includes('--quiet')) console.log.apply(console, arguments);
}

function err() {
  console.error.apply(console, arguments);
}

function parseArgs() {
  const opts = { quiet: false, dryRun: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--quiet') opts.quiet = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node skill_reviewer_resume.js [--quiet] [--dry-run]');
      process.exit(0);
    } else {
      err('Unknown flag: ' + a);
      process.exit(0);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const now = Date.now();

  if (!fs.existsSync(PAUSE_FILE)) {
    log('No pause file found at ' + PAUSE_FILE);
    console.log(JSON.stringify({ action: 'not-paused' }));
    return;
  }

  let priorState;
  try {
    priorState = JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
  } catch (e) {
    err('Pause file exists but failed to parse: ' + e.message);
    console.log(JSON.stringify({ action: 'error', error: e.message, paused: true }));
    return;
  }

  // Case: pause is active (now < until)
  if (now < priorState.until) {
    const hoursRemaining = ((priorState.until - now) / (60 * 60 * 1000)).toFixed(2);
    if (opts.dryRun) {
      log('[DRY-RUN] would unlink pause file (active, ' + hoursRemaining + 'h remaining)');
      console.log(JSON.stringify({
        action: 'force-resume',
        unlinked: false,
        priorState: priorState,
        hoursRemaining: parseFloat(hoursRemaining),
        dryRun: true,
      }));
      return;
    }
    try {
      fs.unlinkSync(PAUSE_FILE);
      log('Pause file removed: ' + PAUSE_FILE);
    } catch (e) {
      err('Failed to unlink pause file: ' + e.message);
      console.log(JSON.stringify({ action: 'error', error: e.message, paused: true }));
      return;
    }
    console.log(JSON.stringify({
      action: 'force-resume',
      unlinked: true,
      priorState: priorState,
      hoursRemaining: parseFloat(hoursRemaining),
    }));
    return;
  }

  // Case: pause expired (now >= until)
  log('Pause already expired (was until ' + new Date(priorState.until).toISOString() + ')');
  console.log(JSON.stringify({
    action: 'expired',
    priorState: priorState,
    note: 'pause marker will be cleared by next skill_junk_pause.js run',
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    err('Fatal: ' + e.message);
    console.log(JSON.stringify({ action: 'error', error: e.message }));
  }
}

module.exports = {};
