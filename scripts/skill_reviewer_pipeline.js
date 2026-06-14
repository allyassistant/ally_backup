#!/usr/bin/env node
/**
 * skill_reviewer_pipeline.js — Thin executor (no LLM)
 *
 * Week 1 Safety Net (Issue #154): sequential wrapper that runs
 * Skill Reviewer → Skill Junk Pause → Skill Pitfalls Fallback in one process.
 *
 * Always runs junk-pause and pitfalls-fallback regardless of reviewer's exit code,
 * so safety nets stay operational even when reviewer fails.
 *
 * Usage:
 *   node scripts/skill_reviewer_pipeline.js [--quiet] [--dry-run]
 *
 * Flags:
 *   --quiet                 Suppress non-essential log output
 *   --dry-run               Dry-run both scripts (no writes)
 *   --skip-junk-pause       Skip the junk-pause step (testing only)
 *   --skip-pitfalls-fallback  Skip the pitfalls-fallback step (testing only)
 *
 * Exit codes:
 *   0  always (thin executor — failures inside do not block cron)
 *
 * Why thin executor:
 *   - Zero LLM calls. Pure subprocess orchestration.
 *   - exit 0 ensures cron never sees a failure.
 *   - Metadata written to stdout as JSON lines.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPT_REVIEWER = path.join(__dirname, 'skill_reviewer_bot.js');
const SCRIPT_JUNK_PAUSE = path.join(__dirname, 'skill_junk_pause.js');
const SCRIPT_PITFALLS_FALLBACK = path.join(__dirname, 'skill_pitfalls_fallback.js');
const SCRIPT_LLM_JUDGE_BATCH = path.join(__dirname, 'llm_judge_batch.mjs');

// Phase 2: shadow LLM judge batch — 10 skills × ~60s each = 10 min upper bound
const LLM_JUDGE_BATCH_TIMEOUT_MS = 600000; // 10 min

// ── Helpers ──

function log() {
  if (!process.argv.includes('--quiet')) console.log.apply(console, arguments);
}

function err() {
  console.error.apply(console, arguments);
}

function shouldSkipJunkPause() {
  return process.argv.includes('--skip-junk-pause');
}

function shouldSkipPitfallsFallback() {
  return process.argv.includes('--skip-pitfalls-fallback');
}

function isDryRun() {
  return process.argv.includes('--dry-run');
}

// ── Main ──

function main() {
  const startTotal = Date.now();
  const quiet = process.argv.includes('--quiet');

  log('=== Skill Reviewer Pipeline ===');
  if (isDryRun()) log('[DRY-RUN]');

  // Step 0: Phase 2 — Shadow LLM Judge (if SHADOW_MODE=true).
  // Window-gated internally; silent exit 0 outside refresh-safe window.
  // Failure here never blocks the pipeline (thin executor semantics).
  if (process.env.SHADOW_MODE === 'true') {
    var judgeStart = Date.now();
    try {
      execFileSync('node', [SCRIPT_LLM_JUDGE_BATCH, '--quiet'], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: LLM_JUDGE_BATCH_TIMEOUT_MS,
      });
      log('LLM judge batch OK (' + (Date.now() - judgeStart) + 'ms)');
    } catch (e) {
      var jStderr = (e.stderr || '').toString().trim();
      log('LLM judge batch skipped: ' + (jStderr || e.message));
    }
  }

  var reviewerOk = true;
  var reviewerStdout = '';
  var reviewerMs = 0;

  // Step 1: Run Skill Reviewer (always attempt)
  var reviewerArgs = ['--quiet'];
  if (isDryRun()) reviewerArgs.push('--dry-run');

  var reviewerStart = Date.now();
  try {
    var rOut = execFileSync('node', [SCRIPT_REVIEWER].concat(reviewerArgs), {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    reviewerStdout = rOut.trim();
    reviewerMs = Date.now() - reviewerStart;
    log('Reviewer OK (' + reviewerMs + 'ms)');
  } catch (e) {
    reviewerOk = false;
    reviewerMs = Date.now() - reviewerStart;
    var rStderr = (e.stderr || '').toString().trim();
    err('Reviewer FAILED (' + reviewerMs + 'ms): ' + (rStderr || e.message));
    // Continue to junk-pause anyway — safety net must always operate
  }

  // Step 2: Run Skill Junk Pause (always, unless --skip-junk-pause)
  var junkOk = true;
  var junkStdout = '';
  var junkMs = 0;

  if (shouldSkipJunkPause()) {
    log('Junk pause skipped (--skip-junk-pause flag)');
  } else {
    var junkArgs = ['--quiet'];
    if (isDryRun()) junkArgs.push('--dry-run');

    var junkStart = Date.now();
    try {
      var jOut = execFileSync('node', [SCRIPT_JUNK_PAUSE].concat(junkArgs), {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      junkStdout = jOut.trim();
      junkMs = Date.now() - junkStart;
      log('Junk pause OK (' + junkMs + 'ms)');
    } catch (e) {
      junkOk = false;
      junkMs = Date.now() - junkStart;
      var jStderr = (e.stderr || '').toString().trim();
      err('Junk pause FAILED (' + junkMs + 'ms): ' + (jStderr || e.message));
    }
  }

  // Step 3: Run Skill Pitfalls Fallback (always, unless --skip-pitfalls-fallback)
  // Issue #159 Fix #4: safety net for skills missing `## Pitfalls` section.
  // Independent of reviewer + junk-pause: a failure here does not block
  // the cron run (thin executor semantics).
  var pitfallsOk = true;
  var pitfallsStdout = '';
  var pitfallsMs = 0;

  if (shouldSkipPitfallsFallback()) {
    log('Pitfalls fallback skipped (--skip-pitfalls-fallback flag)');
  } else {
    // Note: pitfalls-fallback exit code is 1 under --dry-run when changes
    // would be made (CI gate). We treat exit-1 as "ok" for pipeline purposes
    // because that is the expected dry-run signal — not a script error.
    // Real failures (exit 2) are still surfaced.
    var pitfallsArgs = ['--quiet'];
    if (isDryRun()) pitfallsArgs.push('--dry-run');

    var pitfallsStart = Date.now();
    try {
      var pOut = execFileSync('node', [SCRIPT_PITFALLS_FALLBACK].concat(pitfallsArgs), {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      pitfallsStdout = pOut.trim();
      pitfallsMs = Date.now() - pitfallsStart;
      log('Pitfalls fallback OK (' + pitfallsMs + 'ms)');
    } catch (e) {
      pitfallsMs = Date.now() - pitfallsStart;
      // Exit 1 from pitfalls-fallback under --dry-run is expected (CI gate)
      // — treat as success. Only exit 2+ counts as a real failure.
      var pStatus = e.status;
      if (isDryRun() && pStatus === 1) {
        pitfallsStdout = (e.stdout || '').toString().trim();
        pitfallsMs = Date.now() - pitfallsStart;
        log('Pitfalls fallback OK (dry-run, exit 1 = changes pending, ' + pitfallsMs + 'ms)');
      } else {
        pitfallsOk = false;
        var pStderr = (e.stderr || '').toString().trim();
        err('Pitfalls fallback FAILED (' + pitfallsMs + 'ms, exit ' + pStatus + '): ' + (pStderr || e.message));
      }
    }
  }

  var totalMs = Date.now() - startTotal;

  // Output metadata JSON for cron consumption
  var meta = {
    action: 'pipeline',
    pipelineOk: reviewerOk && junkOk && pitfallsOk,
    reviewerOk: reviewerOk,
    junkOk: !shouldSkipJunkPause() ? junkOk : null,
    pitfallsOk: !shouldSkipPitfallsFallback() ? pitfallsOk : null,
    reviewerMs: reviewerMs,
    junkMs: junkMs,
    pitfallsMs: pitfallsMs,
    totalMs: totalMs,
    dryRun: isDryRun(),
    skippedJunkPause: shouldSkipJunkPause(),
    skippedPitfallsFallback: shouldSkipPitfallsFallback(),
  };

  if (!quiet) {
    console.log(JSON.stringify(meta));
  }

  log('=== Pipeline done (' + totalMs + 'ms) ===');
  process.exit(0);
}

main();
