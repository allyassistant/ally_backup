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
 * Smart Discord notification (2026-07-13):
 *   Cron `delivery.mode = "none"` is intentionally left alone. Instead, the
 *   pipeline parses the reviewer's `--json` stats and pushes to Discord
 *   ONLY when something meaningful happened:
 *     - new skill created, OR
 *     - existing skill updated, OR
 *     - queue entries were skipped due to deduplication
 *   When the queue is empty (or all entries fail without producing changes),
 *   the pipeline stays silent. The 09:00 daily report handles the rollup.
 *
 * Usage:
 *   node scripts/skill_reviewer_pipeline.js [--quiet] [--dry-run]
 *
 * Flags:
 *   --quiet                   Suppress non-essential log output
 *   --dry-run                 Dry-run both scripts (no writes)
 *   --skip-junk-pause         Skip the junk-pause step (testing only)
 *   --skip-pitfalls-fallback  Skip the pitfalls-fallback step (testing only)
 *   --no-notify               Skip the smart Discord notification (testing only)
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

// Smart-notification plumbing.
const DISCORD_CHANNEL = '1473376125584670872';   // #⚙️系統 — same channel as daily report
const JSON_MARKER_START = '@@SKILL_REVIEWER_JSON@@';
const JSON_MARKER_END = '@@END@@';
const NOTIFY_TIMEOUT_MS = 30000;

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

function isNoNotify() {
  return process.argv.includes('--no-notify');
}

/**
 * Extract the JSON stats object emitted by skill_reviewer_bot.js with --json.
 * The bot wraps the JSON in marker delimiters so it is trivially greppable and
 * tolerant of other stdout noise. Returns the parsed object, or null if no
 * marker line was found / JSON was malformed.
 */
function parseReviewerStats(stdout) {
  if (!stdout) return null;
  var startIdx = stdout.indexOf(JSON_MARKER_START);
  if (startIdx === -1) return null;
  var endIdx = stdout.indexOf(JSON_MARKER_END, startIdx + JSON_MARKER_START.length);
  if (endIdx === -1) return null;
  var jsonText = stdout.slice(startIdx + JSON_MARKER_START.length, endIdx).trim();
  if (!jsonText) return null;
  try {
    var parsed = JSON.parse(jsonText);
    // Defensive shape check — the pipeline should not throw on a partial / odd
    // stats object. Fill missing fields with safe defaults.
    return {
      action: parsed.action || 'review',
      runId: parsed.runId || null,
      queueEmpty: parsed.queueEmpty !== false,  // default to empty (silent)
      deduplicated: typeof parsed.deduplicated === 'number' ? parsed.deduplicated : 0,
      uniqueCount: typeof parsed.uniqueCount === 'number' ? parsed.uniqueCount : 0,
      newCount: typeof parsed.newCount === 'number' ? parsed.newCount : 0,
      updatedCount: typeof parsed.updatedCount === 'number' ? parsed.updatedCount : 0,
      newNames: Array.isArray(parsed.newNames) ? parsed.newNames : [],
      updatedNames: Array.isArray(parsed.updatedNames) ? parsed.updatedNames : [],
      llmError: parsed.llmError || null,
      hadError: !!parsed.hadError,
      reason: parsed.reason || '',
    };
  } catch (e) {
    err('Failed to parse reviewer JSON stats: ' + e.message);
    return null;
  }
}

/**
 * Decide whether the pipeline should push a Discord notification.
 *
 * Notify when (any of):
 *   - newCount > 0       (new skills created)
 *   - updatedCount > 0   (existing skills updated)
 *   - deduplicated > 0   (queue had duplicates that were skipped)
 *
 * Do NOT notify when:
 *   - queue was empty (queueEmpty=true)
 *   - reviewer failed / produced no stats (no signal to act on)
 *   - all-zero (the user explicitly asked us to stay silent in this case)
 */
function shouldNotify(stats) {
  if (!stats) return false;
  if (stats.queueEmpty) return false;
  if (stats.hadError) return false;
  // Only notify when there are actual new or updated skills.
  // Deduplications alone (no new/updated) do not warrant a notification.
  return stats.newCount > 0 || stats.updatedCount > 0;
}

/**
 * Build a clean Discord notification message from reviewer stats.
 * Kept short and readable; mirrors the existing in-bot summary format.
 */
function buildNotificationMessage(stats) {
  var lines = ['💾 Skill Self-improvement:'];
  if (stats.newCount > 0) {
    lines.push('- 新建: ' + stats.newCount + ' (' + stats.newNames.join(', ') + ')');
  }
  if (stats.updatedCount > 0) {
    lines.push('- 更新: ' + stats.updatedCount + ' (' + stats.updatedNames.join(', ') + ')');
  }
  if (stats.deduplicated > 0) {
    lines.push('- 跳過: ' + stats.deduplicated + ' 條對話 (重複 / 已覆蓋)');
  }
  if (stats.uniqueCount > 0) {
    lines.push('- 隊列: ' + stats.uniqueCount + ' 條已處理');
  }
  return lines.join('\n');
}

/**
 * Push a Discord notification via `openclaw message send`. Thin executor:
 * never throws — failures are logged to stderr and swallowed so the cron
 * run completes cleanly. Returns { status, error? } for the meta block.
 */
function sendDiscordNotification(message) {
  try {
    var result = execFileSync('openclaw', [
      'message', 'send',
      '--channel', 'discord',
      '--target', 'channel:' + DISCORD_CHANNEL,
      '--message', message,
    ], {
      timeout: NOTIFY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    log('✅ Discord notification sent (' + message.length + ' chars)');
    return { status: 'sent', output: result.toString().substring(0, 200) };
  } catch (e) {
    var stderr = e.stderr ? e.stderr.toString().substring(0, 500) : '';
    var msg = e.killed || e.signal === 'SIGTERM' ? 'timeout' : (stderr || e.message);
    err('Discord notification failed: ' + msg);
    return { status: 'error', error: msg };
  }
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
  var reviewerStats = null;

  // Step 1: Run Skill Reviewer (always attempt)
  //   --json        → bot emits a single JSON line on stdout (consumed by us)
  //   --no-discord  → bot skips its own Discord push; pipeline handles delivery
  var reviewerArgs = ['--quiet', '--json', '--no-discord'];
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
    reviewerStats = parseReviewerStats(reviewerStdout);
    log('Reviewer OK (' + reviewerMs + 'ms)');
  } catch (e) {
    reviewerOk = false;
    reviewerMs = Date.now() - reviewerStart;
    var rStderr = (e.stderr || '').toString().trim();
    // Bot may have written the JSON line to stdout before crashing — try to
    // parse it for telemetry, but never let parse errors break the pipeline.
    if (e.stdout) {
      reviewerStats = parseReviewerStats(e.stdout.toString());
    }
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

  // Step 4: Smart Discord notification.
  // Only push when the reviewer's stats indicate something meaningful happened.
  // Failures inside sendDiscordNotification are swallowed (thin executor).
  var notification = { status: 'skipped', reason: 'no-stats' };
  if (isNoNotify()) {
    log('Discord notification skipped (--no-notify flag)');
    notification = { status: 'skipped', reason: 'flag' };
  } else if (!reviewerStats) {
    log('No reviewer stats — skipping notification (silent).');
    notification = { status: 'skipped', reason: 'no-stats' };
  } else if (shouldNotify(reviewerStats)) {
    var message = buildNotificationMessage(reviewerStats);
    log('Smart notification: pushing to Discord #⚙️系統');
    notification = sendDiscordNotification(message);
    notification.reason = 'changes-detected';
    notification.newCount = reviewerStats.newCount;
    notification.updatedCount = reviewerStats.updatedCount;
    notification.deduplicated = reviewerStats.deduplicated;
  } else {
    log('No changes detected (queueEmpty=' + reviewerStats.queueEmpty +
        ', new=' + reviewerStats.newCount +
        ', updated=' + reviewerStats.updatedCount +
        ', dedup=' + reviewerStats.deduplicated + ') — silent.');
    notification = {
      status: 'skipped',
      reason: 'no-changes',
      newCount: reviewerStats.newCount,
      updatedCount: reviewerStats.updatedCount,
      deduplicated: reviewerStats.deduplicated,
      queueEmpty: reviewerStats.queueEmpty,
    };
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
    notification: notification,
  };

  if (!quiet) {
    console.log(JSON.stringify(meta));
  }

  log('=== Pipeline done (' + totalMs + 'ms) ===');
  process.exit(0);
}

main();
