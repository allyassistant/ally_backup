#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Check Router Decision
 *
 * Reads .router-decision.json and returns the decision.
 * Called at session start or before spawning.
 *
 * Usage:
 *   node check-router-decision.js
 *
 * Output:
 *   JSON decision object
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('./lib/config');

const DECISION_FILE = path.join(process.env.HOME, '.openclaw', 'workspace', '.router-decision.json');

function main() {
  try {
    // Check if decision file exists
    if (!fs.existsSync(DECISION_FILE)) {
      log(JSON.stringify({ decision: 'none', reason: 'no decision file' }));
      return;
    }

    // Read and parse decision
    const content = fs.readFileSync(DECISION_FILE, 'utf8');
    const decision = JSON.parse(content);

    // Check if already processed (same message)
    if (decision.processed) {
      // Mark as unprocessed for new message
      decision.processed = false;
      // FIX: Use atomicWriteSync for non-atomic write
      atomicWriteSync(DECISION_FILE, JSON.stringify(decision, null, 2));
    }

    log(JSON.stringify(decision, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
