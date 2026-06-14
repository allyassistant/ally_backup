#!/usr/bin/env node

/**
 * skill_reviewer_cleanup.js — Clear processed queue entries
 *
 * Called by the cron review LLM after it finishes skill updates.
 * Archives processed entries and truncates main queue.
 */

'use strict';

const fs = require('fs');
const {
  SKILL_REVIEW_QUEUE: QUEUE_FILE,
  SKILL_REVIEW_ARCHIVE: ARCHIVE_FILE,
} = require('./lib/config');

function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log('[cleanup] Queue file not found — nothing to clean');
    process.exit(0);
  }

  let raw;
  try {
    raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
  } catch (e) {
    console.error(`File read failed: ${e.message}. Aborting cleanup to prevent data loss.`);
    process.exit(1);
  }
  const lines = raw ? raw.split('\n').filter(Boolean) : [];
  const count = lines.length;

  // Archive — failure MUST halt before truncating to prevent silent data loss
  try {
    fs.appendFileSync(ARCHIVE_FILE, raw + '\n', 'utf8');
    console.log(`[cleanup] Archived ${count} entries`);
  } catch (err) {
    console.error(`[cleanup] Archive FAILED: ${err.message}. Queue NOT truncated to prevent data loss.`);
    process.exit(1);
  }

  // Truncate main queue
  try {
    fs.writeFileSync(QUEUE_FILE, '', 'utf8');
    console.log(`[cleanup] Queue cleared (${count} entries processed)`);
  } catch (err) {
    console.warn(`[cleanup] Queue truncate failed: ${err.message}`);
    process.exit(1);
  }
}

main();
