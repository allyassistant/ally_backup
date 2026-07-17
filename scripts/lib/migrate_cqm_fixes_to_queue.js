#!/usr/bin/env node
/**
 * scripts/lib/migrate_cqm_fixes_to_queue.js
 *
 * Backfill .state/repair_queue.jsonl from the CQM high-fix batch (2026-07-17).
 * Reads the 44 flagged file:line:rule entries from .state/pure_ai_audit_results.json
 * and the current git diff to match which ones were actually fixed by the sub-agent.
 *
 * Only writes queue entries for findings that:
 *   1. Were in the CQM report as HIGH severity
 *   2. The git diff shows the line was actually modified (file was touched)
 *
 * This is idempotent — safe to re-run. Won't duplicate entries.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { append, QUEUE_FILE } = require('./repair_queue');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCAN_FILE = path.join(REPO_ROOT, '.state/pure_ai_audit_results.json');
const SUBAGENT_FIXED_ACTOR = 'sub-agent:cqm-high-fix-batch';

function getModifiedLinesInFile(file) {
  try {
    const output = execFileSync('git', ['diff', 'HEAD', '--', file], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 10000,
    });
    // Collect modified line numbers from hunk headers
    const lines = [];
    const hunkMatch = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
    let m;
    while ((m = hunkMatch.exec(output)) !== null) {
      const start = parseInt(m[1], 10);
      const count = m[2] ? parseInt(m[2], 10) : 1;
      for (let i = 0; i < count; i++) lines.push(start + i);
    }
    return lines;
  } catch {
    return [];
  }
}

function main() {
  // Read CQM findings (high only)
  let scanData;
  try {
    scanData = JSON.parse(fs.readFileSync(SCAN_FILE, 'utf8'));
  } catch (e) {
    console.error(`Cannot read scan file: ${e.message}`);
    process.exit(1);
  }

  const highFindings = (scanData.findings || []).filter(f => f.severity === 'high');
  console.log(`Found ${highFindings.length} high-severity findings in CQM report`);

  // For each finding, check if the file has uncommitted changes
  let written = 0;
  let skipped = 0;

  for (const finding of highFindings) {
    const { file, line, rule } = finding;

    // Skip test files (not fixed by sub-agent)
    if (file.includes('test_') || file.includes('/test/')) {
      skipped++;
      continue;
    }

    // Skip skills-learned (not in scope)
    if (file.includes('skills-learned/')) {
      skipped++;
      continue;
    }

    const modifiedLines = getModifiedLinesInFile(file);
    if (!modifiedLines.includes(line)) {
      // Line wasn't modified — either already fixed long ago, or test file
      skipped++;
      continue;
    }

    append({
      file,
      line,
      rule,
      status: 'fixed',
      actor: SUBAGENT_FIXED_ACTOR,
      details: `Migrated from CQM batch (2026-07-17) — line ${line} modified in git diff`,
    });
    written++;
    console.log(`  ✅ queued: ${file}:${line} (${rule})`);
  }

  console.log(`\nDone. Wrote ${written} entries, skipped ${skipped}`);
  console.log(`Queue file: ${QUEUE_FILE}`);
}

main();
