#!/usr/bin/env node
/**
 * skill_m3_advisory.js — Hybrid Mode: Heuristic-primary + M3 advisory overlay
 *
 * Background (2026-06-18):
 *   M3 calibration: accuracy 72%, precision 67.6%, recall 88.5% —
 *   NOT production-grade for hard veto (would over-quarantine).
 *   New model: heuristic remains source of truth for symlink/quarantine;
 *   M3 runs in parallel as advisory ONLY, logging alignment for observability.
 *
 * Architecture (Hybrid Mode):
 *   - Reads .skill_created.jsonl events since last cursor
 *   - For each new "wrote" event (heuristic verdict source):
 *       - Maps to heuristicVerdict: 'pass' | 'quarantine' | 'cycle'
 *       - Calls scripts/llm_judge_caller.mjs (M3 single mode, 15s timeout)
 *       - Computes alignment: 'agree' | 'disagree' | 'm3-error' | 'm3-timeout'
 *       - Appends to .skill_m3_advisory.jsonl (best-effort, non-blocking)
 *   - Symlink/quarantine decision is NEVER consulted from M3 verdict.
 *
 * Env vars:
 *   SKILL_M3_ADVISORY=true         Master switch (default false = inert)
 *   SKILL_M3_ADVISORY_DRY_RUN=true  Log "would-call" instead of calling M3
 *   SKILL_M3_ADVISORY_MAX_PER_RUN=N Cap on calls per invocation (default 10)
 *
 * Hard rules:
 *   - Best-effort: ALL errors swallowed (timeout, crash, parse fail).
 *   - Does NOT write to symlink paths or quarantine directories.
 *   - Does NOT block pipeline if M3 fails.
 *
 * Usage:
 *   node scripts/skill_m3_advisory.js [--quiet] [--dry-run]
 *
 * Exit codes:
 *   0  always (advisory never blocks)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// P3-1: canonicalize WS — use lib/config as source of truth, allow SKILL_JUDGE_WORKSPACE override for calibration scripts.
const { WS: CONFIG_WS } = require('./lib/config');
const WS = process.env.SKILL_JUDGE_WORKSPACE || CONFIG_WS;
// Plan C Fix #3: content-hash-keyed M3 advisory cache. Loaded lazily inside
// the call path so a missing/broken cache file does not block startup.
let _m3Cache = null;
function _getM3Cache() {
  if (_m3Cache !== null) return _m3Cache;
  try {
    _m3Cache = require('./lib/m3_advisory_cache');
  } catch (e) {
    err('[advisory] m3_advisory_cache load failed (fallback to no cache): ' + e.message);
    _m3Cache = false;  // sentinel: don't keep retrying
  }
  return _m3Cache || null;
}
const SKILL_CREATED_LOG = path.join(WS, '.skill_created.jsonl');
const ADVISORY_LOG = path.join(WS, '.skill_m3_advisory.jsonl');
const CURSOR_FILE = path.join(WS, '.skill_m3_advisory_cursor.json');
const PAUSE_FILE = path.join(WS, '.skill_reviewer_pause.json');

function isPaused() {
  if (!fs.existsSync(PAUSE_FILE)) return false;
  try {
    const d = JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8'));
    if (typeof d.until === 'number' && d.until > Date.now()) return true;
  } catch (_) { /* unreadable → not paused */ }
  return false;
}
const CONFIG = {
  MB: 1024 * 1024,
  ADVISORY_LOG_MAX_BYTES: 10 * 1024 * 1024,
  DISCORD_HTTP_TIMEOUT_MS: 5000,
  PERCENT_MULTIPLIER: 100,
  MS_PER_MINUTE: 60000,
  CURL_SLACK_MS: 1000
};
const SCRIPT_LLM_JUDGE_CALLER = path.join(__dirname, 'llm_judge_caller.mjs');
const ADVISORY_LOG_MAX_BYTES = CONFIG.ADVISORY_LOG_MAX_BYTES;  // P3-2: 10MB cap to prevent unbounded growth

const MAX_PER_RUN = parseInt(process.env.SKILL_M3_ADVISORY_MAX_PER_RUN, 10) || 10;
const ADVISORY_TIMEOUT_MS = 15000;  // H3: fail-fast per task spec
const MAX_BUFFER_BYTES = CONFIG.MB;
const DAY_MS = 24 * 3600 * 1000;
const ROLLING_WINDOW_DAYS = 7;
const ALIGNMENT_WARN_THRESHOLD_PCT = 70;

// ── W2 Warning Mode: Discord push when 7-day alignment drops ──
const WARN_STATE_FILE = path.join(WS, '.skill_m3_advisory_warn_state.json');
const WARN_THRESHOLD_PCT = parseInt(process.env.SKILL_M3_WARN_THRESHOLD_PCT, 10) || ALIGNMENT_WARN_THRESHOLD_PCT;
const WARN_COOLDOWN_MS = (parseInt(process.env.SKILL_M3_WARN_COOLDOWN_HOURS, 10) || 4) * 60 * 60 * 1000;
const DISCORD_HTTP_TIMEOUT_MS = CONFIG.DISCORD_HTTP_TIMEOUT_MS;  // 5s hard timeout for webhook push

// ── P0-5: mkdir-as-mutex for log rotation ──
// Sync version of withEmbeddingsLock (scripts/lib/skill_dedup_gate.js:147).
// Coordinates writer's rename(LOG→LOG.old)+appendFileSync with reader's
// existsSync(LOG)+readFileSync so the reader can never see the gap between
// rename and re-create. Without this guard, computeRollingAlignment() can
// briefly observe existsSync=false → return null → Discord warn push skipped.
const ADVISORY_LOCK_DIR = ADVISORY_LOG + '.rotate.lockdir';
const ADVISORY_LOCK_TIMEOUT_MS = 5000;  // 5s upper bound (sync spin-wait)
const ADVISORY_LOCK_RETRY_MS = 50;       // poll interval between attempts

function withAdvisoryLock(fn) {
  // Self-heal stale lock: if a previous advisory run SIGKILL'd while holding
  // the lock, remove it before spinning. Matches skill_reviewer.js pattern
  // (line ~918-925). Without this, every subsequent advisory invocation
  // would burn its full 5s timeout waiting for a dead lock.
  try {
    var st = fs.statSync(ADVISORY_LOCK_DIR);
    var lockAgeMs = Date.now() - st.mtimeMs;
    // If the lock is older than the timeout, the holding process is gone
    // (advisory runs are bounded by the pipeline wall clock, never this long).
    if (lockAgeMs > ADVISORY_LOCK_TIMEOUT_MS) {
      log('[advisory] removing stale lock (age: ' + Math.round(lockAgeMs / 1000) + 's)');
      fs.rmSync(ADVISORY_LOCK_DIR, { recursive: true, force: true });
    }
  } catch (e) {
    // No lock exists — proceed normally
  }
  var start = Date.now();
  while (Date.now() - start < ADVISORY_LOCK_TIMEOUT_MS) {
    try {
      fs.mkdirSync(ADVISORY_LOCK_DIR, { recursive: false });
      try {
        return fn();
      } finally {
        try { fs.rmdirSync(ADVISORY_LOCK_DIR); } catch (_) {}
      }
    } catch (e) {
      if (e && e.code !== 'EEXIST') throw e;
      // Sync spin (script uses sync I/O throughout — event-loop blocking
      // is acceptable for this short-lived advisory invocation).
      var waitUntil = Date.now() + ADVISORY_LOCK_RETRY_MS;
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }
  // Lock could not be acquired within timeout — caller decides how to fail-soft.
  return undefined;
}

// ── Helpers ──

function log() {
  if (!process.argv.includes('--quiet')) console.log.apply(console, arguments);
}

function err() {
  console.error.apply(console, arguments);
}

function isOptIn() {
  return process.env.SKILL_M3_ADVISORY === 'true';
}

function isDryRun() {
  return process.env.SKILL_M3_ADVISORY_DRY_RUN === 'true' || process.argv.includes('--dry-run');
}

/**
 * Map a .skill_created.jsonl event to one of four heuristic verdicts:
 *   - 'pass'          : validationPassed=true AND symlinked=true
 *   - 'quarantine'    : validationPassed=false (failed validator → quarantined)
 *   - 'cycle'         : validationPassed=true AND symlinked=false (passed but
 *                       not promoted: paused / AUTO_APPLY=false / draft)
 *   - 'dedup-skipped' : validationPassed=false with reason starting with
 *                       'post-llm pre-emit skip' (Stage 2 pre-emit dedup
 *                       blocked re-emit of an existing skill — NOT a real
 *                       quality failure). Plan C Fix #2 (2026-06-24).
 * Fails closed: unknown shape → 'cycle' (lowest-impact verdict).
 */
function mapHeuristicVerdict(ev) {
  if (ev.validationPassed === false) {
    // Plan C Fix #2: distinguish "real validator failure" (quarantine) from
    // "Stage 2 dedup blocked a re-emit" (dedup-skipped). Without this branch,
    // M3 advisory showed spurious "disagree" because heuristic='quarantine'
    // implied a quality issue that didn't exist.
    if (ev.reason && typeof ev.reason === 'string' &&
        ev?.reason?.indexOf('post-llm pre-emit skip') === 0) {
      return 'dedup-skipped';
    }
    return 'quarantine';
  }
  if (ev.validationPassed === true && ev.symlinked === true) return 'pass';
  if (ev.validationPassed === true && ev.symlinked === false) return 'cycle';
  return 'cycle';
}

/**
 * Plan C Fix #1: check if a skill is already stable + symlinked. If so,
 * the M3 advisory call would be wasted (re-emit noise). Mirrors the helper
 * in llm_judge_batch.mjs so both call sites apply the same gate.
 */
function isStableSymlinked(skillName) {
  if (!skillName || typeof skillName !== 'string') return false;
  try {
    var skillsLearned = path.join(WS, 'skills-learned');
    var skillsActive = path.join(WS, 'skills');
    var symlinkPath = path.join(skillsActive, '_learned_' + skillName);
    if (!fs.existsSync(symlinkPath)) return false;
    var skillMd = path.join(skillsLearned, skillName, 'SKILL.md');
    if (!fs.existsSync(skillMd)) return false;
    var stat = fs.statSync(skillMd);
    var ageMs = Date.now() - stat.mtimeMs;
    // Same 24h window as llm_judge_batch.mjs / skill_reviewer_bot.js gate
    return ageMs < DAY_MS;
  } catch (_) { return false; }
}

/**
 * Read cursor (last processed line index in .skill_created.jsonl).
 * Returns 0 if file missing/corrupt (fail-safe: re-process from start).
 */
function readCursor() {
  try {
    if (!fs.existsSync(CURSOR_FILE)) return 0;
    var data = JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8'));
    return typeof data.lastLineIdx === 'number' && data.lastLineIdx >= 0 ? data.lastLineIdx : 0;
  } catch (_) {
    return 0;
  }
}

function writeCursor(lastLineIdx) {
  // P2-2: atomic-ish — write to .tmp then rename. Prevents the case where
  // append succeeds but cursor write fails → duplicate log entries next run.
  var tmp = CURSOR_FILE + '.tmp';
  try {
    fs.writeFileSync(
      tmp,
      JSON.stringify({ v: 1, ts: new Date().toISOString(), lastLineIdx: lastLineIdx }) + '\n',
      'utf8'
    );
  } catch (e) {
    err('cursor write (tmp) failed: ' + e.message);
    return false;
  }
  try {
    fs.renameSync(tmp, CURSOR_FILE);
    return true;
  } catch (e) {
    err('cursor rename failed: ' + e.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

/**
 * Read new events from .skill_created.jsonl starting at `startIdx`.
 * Only returns "wrote" events (skip dedup-skipped: no new content to judge).
 */
function readNewEvents(startIdx) {
  if (!fs.existsSync(SKILL_CREATED_LOG)) return { events: [], lastIdx: startIdx };
  var lines;
  try {
    lines = fs.readFileSync(SKILL_CREATED_LOG, 'utf8').split('\n');
  } catch (e) {
    // P3-1: surface total read failure loudly so it shows up even in --quiet mode.
    // Cursor is NOT advanced here — next run will retry from same position.
    console.error('[advisory] CRITICAL: cannot read .skill_created.jsonl — cursor not advanced, investigate manually: ' + e.message);
    return { events: [], lastIdx: startIdx };
  }
  var events = [];
  var lastIdx = startIdx;
  for (var i = startIdx; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try {
      var ev = JSON.parse(line);
      // Only judge NEW writes (skip dedup-skipped: no content change).
      if (ev.dedup && ev.dedup !== 'wrote') continue;
      // Skip self-referential blocks (these are quarantine events anyway,
      // already captured by heuristicVerdict='quarantine' from validationPassed=false).
      events.push({ ev: ev, lineIdx: i });
      lastIdx = i + 1;
    } catch (_) { /* skip malformed */ }
  }
  return { events: events, lastIdx: lastIdx };
}

/**
 * Call M3 judge via llm_judge_caller.mjs (single-mode, fast timeout).
 * Returns { ok, verdict, confidence, latencyMs, error?, fromCache? }.
 * NEVER throws — all errors caught and returned as { ok: false }.
 *
 * Plan C Fix #3 (2026-06-24): wraps the raw M3 call with a content-hash
 * cache. If (skillName, sha256(SKILL.md)) matches a previous successful
 * verdict, returns the cached result and skips the M3 call entirely.
 * On miss, calls M3 then stores the verdict for next time. Cache read
 * and write failures are silently ignored (fail-open: caller falls
 * through to the live M3 call).
 */
function callM3Judge(skillName) {
  var start = Date.now();
  // Read SKILL.md content for cache key.
  var content = '';
  try {
    content = fs.readFileSync(path.join(WS, 'skills-learned', skillName, 'SKILL.md'), 'utf8');
  } catch (_) { /* missing file → empty content hash, cache miss is fine */ }

  // Cache lookup — fail-open if cache module unavailable.
  var cache = _getM3Cache();
  if (cache) {
    try {
      var cached = cache.getCached(skillName, content);
      if (cached && typeof cached === 'object') {
        return Object.assign({}, cached, { fromCache: true });
      }
    } catch (_) { /* fall through to live call */ }
  }

  try {
    var stdout = execFileSync('node', [SCRIPT_LLM_JUDGE_CALLER, '--skill-name', skillName, '--quiet'], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: ADVISORY_TIMEOUT_MS,
      env: Object.assign({}, process.env, {
        // Force M3-only single mode + 15s timeout for fail-soft advisory.
        SKILL_JUDGE_SINGLE: 'true',
        SKILL_JUDGE_TIMEOUT_MS: String(ADVISORY_TIMEOUT_MS)
      })
    });
    var raw = (stdout || '').trim();
    if (!raw) {
      var emptyResult = { ok: false, verdict: 'error', confidence: null, latencyMs: Date.now() - start, error: 'empty output' };
      return emptyResult;
    }
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      var parseResult = { ok: false, verdict: 'error', confidence: null, latencyMs: Date.now() - start, error: 'JSON parse failed: ' + e.message };
      return parseResult;
    }
    var j1 = parsed.judge1 || {};
    var v = j1.verdict === 'pass' ? 'pass' : j1.verdict === 'junk' ? 'junk' : 'error';
    var m3Result = {
      ok: v !== 'error',
      verdict: v,
      confidence: typeof j1.confidence === 'number' ? j1.confidence : null,
      latencyMs: typeof j1.latencyMs === 'number' ? j1.latencyMs : (Date.now() - start),
      error: v === 'error' ? (j1.reason || 'unknown') : null
    };
    // Store successful verdicts in cache (skip errors — they don't represent
    // a real content assessment).
    if (cache && m3Result.ok) {
      try { cache.setCached(skillName, content, m3Result); } catch (_) {}
    }
    return m3Result;
  } catch (e) {
    var isTimeout = e.code === 'ETIMEDOUT' || /timeout/i.test(e.message || '');
    return {
      ok: false,
      verdict: 'error',
      confidence: null,
      latencyMs: Date.now() - start,
      error: isTimeout ? 'timeout' : (e.message || String(e))
    };
  }
}

/**
 * Compute alignment from heuristic + M3 verdicts.
 *   - agree         : both judge same direction (pass/pass or quarantine/junk)
 *   - disagree      : verdicts diverge (heuristic pass vs M3 junk, or vice versa)
 *   - m3-error      : M3 call failed (non-timeout error)
 *   - m3-timeout    : M3 call exceeded timeout
 *   - cycle-m3      : heuristic='cycle' AND M3 ran (no symmetric verdict for cycle)
 *   - dedup-skipped : heuristic='dedup-skipped' (Plan C Fix #2) — pre-emit
 *                     dedup blocked re-emit, NOT a real quality disagreement.
 *                     Recorded for visibility but does NOT count toward
 *                     disagreement rate.
 *
 * Note: 'cycle' has no M3 counterpart — heuristic passed validation but
 * didn't symlink for non-quality reasons (paused / draft).
 * M3 can only judge quality (pass/junk), so 'cycle' is recorded as
 * 'cycle-m3' for visibility but does NOT count toward disagreement.
 */
function computeAlignment(heuristicVerdict, m3Result) {
  if (m3Result.error === 'timeout') return 'm3-timeout';
  if (!m3Result.ok) return 'm3-error';
  if (heuristicVerdict === 'cycle') return 'cycle-m3';
  // Plan C Fix #2: dedup-skipped is its own bucket (not cycle-m3, not disagree).
  if (heuristicVerdict === 'dedup-skipped') return 'dedup-skipped';
  if (heuristicVerdict === 'pass' && m3Result.verdict === 'pass') return 'agree';
  if (heuristicVerdict === 'quarantine' && m3Result.verdict === 'junk') return 'agree';
  return 'disagree';
}

/**
 * Append a single advisory record to .skill_m3_advisory.jsonl.
 * Best-effort: any failure returns false, never throws.
 */
function appendAdvisory(record) {
  try {
    // Ensure log file is 0644 per spec (caller's umask may be 077; chmod after create).
    if (!fs.existsSync(ADVISORY_LOG)) {
      try {
        fs.writeFileSync(ADVISORY_LOG, '', { mode: 0o644, flag: 'a' });
        try { fs.chmodSync(ADVISORY_LOG, 0o644); } catch (_) {}
      } catch (_) {}
    }
    // P3-2 + P0-5: rotation + append inside mkdir-mutex so reader can't see
    // the gap between rename(LOG→LOG.old) and re-create by appendFileSync.
    // Best-effort: any failure here is swallowed (log rotation is non-critical).
    var locked = withAdvisoryLock(function() {
      try {
        var stats = fs.statSync(ADVISORY_LOG);
        if (stats.size > ADVISORY_LOG_MAX_BYTES) {
          fs.renameSync(ADVISORY_LOG, ADVISORY_LOG + '.old');
          log('[advisory] Log rotated (>10MB)');
        }
      } catch (_) {}
      fs.appendFileSync(ADVISORY_LOG, JSON.stringify(record) + '\n', 'utf8');
    });
    if (locked === undefined) {
      // Lock timeout (>5s) — fail soft so pipeline doesn't hang on a stuck holder.
      err('advisory log append: lock timeout (>5s) — skipping record');
      return false;
    }
    return true;
  } catch (e) {
    err('advisory log append failed: ' + e.message);
    return false;
  }
}

/**
 * Compute 7-day rolling alignment rate from .skill_m3_advisory.jsonl.
 * Returns { total, agree, disagree, m3Error, m3Timeout, cycleM3, agreeRatePct }.
 * Returns null if log is missing or has <1 record.
 */
function computeRollingAlignment() {
  // P0-5: wrap in mkdir-mutex to coordinate with writer's rotation+append.
  // Without this guard, writer's rename(LOG→LOG.old) can leave a brief gap
  // where existsSync(LOG)=false → this returns null → Discord warn push
  // is silently skipped for that run. See withAdvisoryLock above.
  try {
    var result = withAdvisoryLock(function() {
      if (!fs.existsSync(ADVISORY_LOG)) return null;
      var lines;
      try { lines = fs.readFileSync(ADVISORY_LOG, 'utf8').split('\n'); }
      catch (_) { return null; }
      var cutoff = Date.now() - ROLLING_WINDOW_DAYS * DAY_MS;
      // DAY_MS already includes the 24×3600×1000 factorization above
      var stats = { total: 0, agree: 0, disagree: 0, m3Error: 0, m3Timeout: 0, cycleM3: 0, dedupSkipped: 0 };
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          var ev = JSON.parse(line);
          var t = Date.parse(ev.ts);
          if (isNaN(t) || t < cutoff) continue;
          stats.total++;
          if (ev.alignment === 'agree') stats.agree++;
          else if (ev.alignment === 'disagree') stats.disagree++;
          else if (ev.alignment === 'm3-error') stats.m3Error++;
          else if (ev.alignment === 'm3-timeout') stats.m3Timeout++;
          else if (ev.alignment === 'cycle-m3') stats.cycleM3++;
          else if (ev.alignment === 'dedup-skipped') stats.dedupSkipped++;
        } catch (_) { /* skip */ }
      }
      if (stats.total === 0) return null;
      var judgeable = stats.agree + stats.disagree;  // exclude cycle-m3 from rate denom
      var rate = judgeable > 0 ? (stats.agree / judgeable) * CONFIG.PERCENT_MULTIPLIER : 0;
      return Object.assign({}, stats, {
        judgeable: judgeable,
        agreeRatePct: parseFloat(rate.toFixed(1))
      });
    });
    // Lock timeout (undefined) → null (matches existing fail-safe null semantics).
    return result === undefined ? null : result;
  } catch (e) {
    return null;
  }
}

/**
 * Read warning state file (.skill_m3_advisory_warn_state.json).
 * Returns { lastWarnedAt, lastAgreeRatePct } or null if missing/corrupt.
 * Fail-safe: any error → null (treat as "never warned").
 */
function readWarnState() {
  try {
    if (!fs.existsSync(WARN_STATE_FILE)) return null;
    var data = JSON.parse(fs.readFileSync(WARN_STATE_FILE, 'utf8'));
    if (typeof data.lastWarnedAt !== 'number') return null;
    return {
      lastWarnedAt: data.lastWarnedAt,
      lastAgreeRatePct: typeof data.lastAgreeRatePct === 'number' ? data.lastAgreeRatePct : null
    };
  } catch (_) {
    return null;
  }
}

/**
 * Atomic write of warning state file (tmp + rename pattern, matches cursor).
 * Best-effort: any failure logged to stderr, never thrown.
 */
function writeWarnState(lastWarnedAt, lastAgreeRatePct) {
  var tmp = WARN_STATE_FILE + '.tmp';
  var payload = JSON.stringify({ v: 1, ts: new Date().toISOString(), lastWarnedAt: lastWarnedAt, lastAgreeRatePct: lastAgreeRatePct }) + '\n';
  try {
    fs.writeFileSync(tmp, payload, 'utf8');
  } catch (e) {
    err('warn state write (tmp) failed: ' + e.message);
    return false;
  }
  try {
    fs.renameSync(tmp, WARN_STATE_FILE);
    return true;
  } catch (e) {
    err('warn state rename failed: ' + e.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

/**
 * W2: Push Discord warning embed to #⚙️系統 when 7-day alignment drops
 * below WARN_THRESHOLD_PCT. Debounced via WARN_STATE_FILE — max 1 push
 * per WARN_COOLDOWN_MS (default 4 hours). Fail-soft: any error logged
 * to stderr, never thrown, never blocks the pipeline.
 *
 * Format (per spec):
 *   ⚠️ M3 Advisory — Alignment Dropped
 *   Skill: <skillName>  (or "N/A" if from rolling window)
 *   Heuristic: <verdict> | M3: <verdict>
 *   7-day rolling: <agreeRatePct>%
 *   Stats: agree=X disagree=Y m3-err=Z m3-timeout=A cycle-m3=B
 *   Window: last <ROLLING_WINDOW_DAYS> days
 *
 * @param {Object} stats  - return value of computeRollingAlignment()
 * @param {Object} lastEvent - last processed event { ev, alignment } or null
 *                             (for Skill + Heuristic/M3 verdict context)
 */
function maybePushWarning(stats, lastEvent) {
  if (!stats || typeof stats.agreeRatePct !== 'number') return false;
  if (stats.agreeRatePct >= WARN_THRESHOLD_PCT) return false;

  // Cooldown check: skip if warned recently.
  var now = Date.now();
  var state = readWarnState();
  if (state && (now - state.lastWarnedAt) < WARN_COOLDOWN_MS) {
    log('[advisory] WARN: alignment ' + stats.agreeRatePct + '% < ' + WARN_THRESHOLD_PCT + '% — suppressed (cooldown ' + Math.round((WARN_COOLDOWN_MS - (now - state.lastWarnedAt)) / CONFIG.MS_PER_MINUTE) + 'min left)');
    return false;
  }

  // Build message body per spec.
  var skillName = 'N/A';
  var heuristicV = 'N/A';
  var m3V = 'N/A';
  if (lastEvent && lastEvent.ev && typeof lastEvent?.ev?.name === 'string') {
    skillName = lastEvent?.ev?.name;
    if (lastEvent?.ev?.validationPassed === false) heuristicV = 'quarantine';
    else if (lastEvent?.ev?.validationPassed === true && lastEvent?.ev?.symlinked === true) heuristicV = 'pass';
    else heuristicV = 'cycle';
    // M3 verdict captured from the last processed event (set in main() loop).
    if (lastEvent.m3Verdict) m3V = lastEvent.m3Verdict;
  }

  var content =
    '⚠️ **M3 Advisory — Alignment Dropped**\n' +
    'Skill: ' + skillName + '\n' +
    'Heuristic: ' + heuristicV + ' | M3: ' + m3V + '\n' +
    '7-day rolling: ' + stats.agreeRatePct + '%\n' +
    'Stats: agree=' + stats.agree + ' disagree=' + stats.disagree + ' m3-err=' + stats.m3Error + ' m3-timeout=' + stats.m3Timeout + ' cycle-m3=' + stats.cycleM3 + '\n' +
    'Window: last ' + ROLLING_WINDOW_DAYS + ' days';

  // Resolve webhook URL.
  var webhookUrl = process.env.DISCORD_WEBHOOK_SYSTEM;
  if (!webhookUrl) {
    err('[advisory] WARN: alignment ' + stats.agreeRatePct + '% < ' + WARN_THRESHOLD_PCT + '% — webhook not configured, logging only:\n' + content);
    // Still record lastWarnedAt to enforce cooldown even when webhook is missing
    // (prevents stderr flood if env stays unset for hours).
    writeWarnState(now, stats.agreeRatePct);
    return false;
  }

  // POST via curl (execFileSync args array — no shell injection).
  // 5s timeout, fail-soft: any error logged, state still updated.
  var payload = JSON.stringify({ content: content, username: '🦾 Ally' });
  try {
    execFileSync('curl', ['-sS', '-X', 'POST', '-H', 'Content-Type: application/json', '--data', payload, '--max-time', String(Math.floor(DISCORD_HTTP_TIMEOUT_MS / CONFIG.CURL_SLACK_MS)), webhookUrl], {
      encoding: 'utf8',
      timeout: DISCORD_HTTP_TIMEOUT_MS + CONFIG.CURL_SLACK_MS,  // small slack over curl --max-time
      stdio: ['pipe', 'pipe', 'pipe']
    });
    log('[advisory] WARN: alignment ' + stats.agreeRatePct + '% < ' + WARN_THRESHOLD_PCT + '% — Discord push OK');
    writeWarnState(now, stats.agreeRatePct);
    return true;
  } catch (e) {
    err('[advisory] WARN push failed: ' + (e.stderr ? e?.stderr?.toString().trim() : e.message));
    // Do NOT update state on push failure — let next run retry (subject to cooldown).
    return false;
  }
}

// ── Main ──

function main() {
  var startTs = Date.now();

  if (!isOptIn()) {
    log('[advisory] SKILL_M3_ADVISORY!=true — inert (no-op). Set SKILL_M3_ADVISORY=true to enable.');
    return;
  }

  log('[advisory] === M3 Advisory overlay (Hybrid Mode) ===');
  if (isDryRun()) log('[advisory] DRY-RUN: log "would-call" instead of M3 call');

  // P2-1: Skip if skill_reviewer_bot is paused (auto-pause from junk rate spike).
  // Checks pause expiry, not just file existence — stale pause files shouldn't block.
  if (isPaused()) {
    log('[advisory] Pipeline paused — skipping');
    return;
  }

  var cursor = readCursor();
  var scan = readNewEvents(cursor);
  var events = scan.events;
  var newCursor = scan.lastIdx;

  if (events.length === 0) {
    log('[advisory] No new "wrote" events since cursor=' + cursor + ' — nothing to advise.');
    writeCursor(newCursor);  // advance cursor even on empty (matches file growth)
    return;
  }

  var toProcess = events.slice(0, MAX_PER_RUN);
  var skipped = events.length - toProcess.length;
  log('[advisory] Processing ' + toProcess.length + ' skill(s)' + (skipped > 0 ? ' (skipped ' + skipped + ' due to MAX_PER_RUN=' + MAX_PER_RUN + ')' : '') + ' — cursor ' + cursor + ' -> ' + newCursor);

  var processed = 0;
  var counts = { agree: 0, disagree: 0, m3Error: 0, m3Timeout: 0, cycleM3: 0 };
  var lastEvent = null;  // tracked for W2 warning context (Skill + Heuristic verdict)

  for (var i = 0; i < toProcess.length; i++) {
    var entry = toProcess[i];
    var ev = entry.ev;
    var skillName = ev.name;
    var heuristicVerdict = mapHeuristicVerdict(ev);

    // ── Plan C Fix #1 + #2: skip M3 call for already-stable skills OR
    // for events that were already dedup-skipped by Stage 2 pre-emit filter.
    // Both are wasted-cost cases: the content hasn't changed so M3 would
    // return the same verdict as before. Record the skip for observability
    // but never invoke M3.
    var skipReason = null;
    if (heuristicVerdict === 'dedup-skipped') {
      skipReason = 'dedup-skipped event (no M3 call needed)';
    } else if (isStableSymlinked(skillName)) {
      skipReason = 'already-stable-symlinked-skill';
    }
    if (skipReason) {
      var skipRecord = {
        ts: new Date().toISOString(),
        skill: skillName,
        heuristicVerdict: heuristicVerdict,
        m3Verdict: null,
        m3Confidence: null,
        alignment: heuristicVerdict === 'dedup-skipped' ? 'dedup-skipped' : 'cycle-m3',
        latencyMs: 0,
        skipReason: skipReason
      };
      appendAdvisory(skipRecord);
      var bucket = heuristicVerdict === 'dedup-skipped' ? 'dedupSkipped' : 'cycleM3';
      counts[bucket] = (counts[bucket] || 0) + 1;
      log('[advisory] ' + skillName + ' — skipped M3 (' + skipReason + ', heuristic=' + heuristicVerdict + ')');
      lastEvent = { ev: ev, alignment: skipRecord.alignment };
      processed++;
      continue;
    }

    if (isDryRun()) {
      // ── Dry-run: log "would-call" without invoking M3 ──
      var dryRecord = {
        ts: new Date().toISOString(),
        skill: skillName,
        heuristicVerdict: heuristicVerdict,
        m3Verdict: null,
        m3Confidence: null,
        alignment: 'dry-run',
        latencyMs: 0,
        dryRun: true
      };
      appendAdvisory(dryRecord);
      log('[advisory] [dry-run] would-call M3 for "' + skillName + '" (heuristic=' + heuristicVerdict + ')');
      lastEvent = { ev: ev, alignment: 'dry-run' };
      processed++;
      continue;
    }

    // ── Real call: best-effort, errors swallowed ──
    var m3Result = callM3Judge(skillName);
    var alignment = computeAlignment(heuristicVerdict, m3Result);
    if (m3Result.fromCache) {
      log('[advisory] ' + skillName + ' — M3 verdict from cache (heuristic=' + heuristicVerdict + ', skipped M3 call)');
    }
    var record = {
      ts: new Date().toISOString(),
      skill: skillName,
      heuristicVerdict: heuristicVerdict,
      m3Verdict: m3Result.verdict,
      m3Confidence: m3Result.confidence,
      alignment: alignment,
      latencyMs: m3Result.latencyMs
    };
    // P1-issue-2026-06-24: capture M3 error reason so we can category root cause
    // of the 51.85% m3-error rate. Always set (null on success) for shape stability.
    if (m3Result.error) record.m3Error = String(m3Result.error).slice(0, 200);
    appendAdvisory(record);
    counts[alignment] = (counts[alignment] || 0) + 1;
    log('[advisory] ' + skillName + ' — heuristic=' + heuristicVerdict + ' m3=' + m3Result.verdict + ' (conf=' + (m3Result.confidence != null ? m3Result?.confidence?.toFixed(2) : 'null') + ') -> ' + alignment + ' (' + m3Result.latencyMs + 'ms)');
    lastEvent = { ev: ev, alignment: alignment, m3Verdict: m3Result.verdict };
    processed++;
  }

  // Advance cursor even if some calls failed (we logged them; re-running
  // would double-log unless we filter by skill name — keep simple for now).
  writeCursor(newCursor);

  // ── 7-day rolling alignment telemetry ──
  var rolling = computeRollingAlignment();
  if (rolling) {
    log('[advisory] 7-day rolling: total=' + rolling.total + ' agree=' + rolling.agree + ' disagree=' + rolling.disagree + ' m3-err=' + rolling.m3Error + ' m3-timeout=' + rolling.m3Timeout + ' cycle-m3=' + rolling.cycleM3 + ' | judgeable-rate=' + rolling.agreeRatePct + '% (' + rolling.judgeable + ' samples)');
    if (rolling.judgeable >= 10 && rolling.agreeRatePct < 70) {
      log('[advisory] WARN: alignment < 70% — M3 may be too noisy, consider disabling advisory or recalibrating.');
    } else if (rolling.total >= 10 && rolling.disagree === 0 && rolling.m3Error === 0 && rolling.m3Timeout === 0) {
      log('[advisory] M3 in sync with heuristic.');
    }
  }

  // ── W2: Discord warning push on alignment drop (opt-out for dry-run + paused) ──
  if (rolling && !isDryRun() && !isPaused()) {
    maybePushWarning(rolling, lastEvent);
  }

  log('[advisory] === Done in ' + (Date.now() - startTs) + 'ms — processed ' + processed + ' ===');
}

// ── CLI ──
if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (e) {
    // Advisory NEVER throws out — fails closed silently.
    err('[advisory] fatal: ' + e.message);
    process.exit(0);
  }
}

module.exports = { main, mapHeuristicVerdict, computeAlignment, computeRollingAlignment, maybePushWarning, isStableSymlinked };
