#!/usr/bin/env node
/**
 * cumulative_approvals.js — Trust-based auto-approval state
 *
 * After a user manually approves N proposals of the same rule, future
 * proposals of that rule are auto-applied without human review. This
 * honors the user's "high LLM trust" preference while keeping a safety
 * net for novel rules.
 *
 * State file: .state/cumulative_approvals.json
 *
 * Schema:
 *   {
 *     version: 1,
 *     threshold: 3,                     // manual approves before trusted
 *     rules: {
 *       "fsSync_missing_trycatch": {
 *         count: 5,                     // total approvals
 *         risk: "low",                  // low | medium | high
 *         trusted: true,                // count >= threshold
 *         approvedFiles: ["foo.js", "bar.js"],
 *         firstApprovedAt: "2026-06-19T...",
 *         lastApprovedAt: "2026-06-19T...",
 *         lastApprovedProposalId: "PROP-..."
 *       }
 *     }
 *   }
 *
 * Risk classification:
 *   - low: simple 1-2 line change (e.g., add try-catch, fix typo)
 *   - medium: 5-10 line structural change
 *   - high: function rewrite, multi-file, config change
 *
 * Auto-apply rules (when isTrusted(ruleId) is true):
 *   - severity ∈ {high, medium} (NOT critical — always manual)
 *   - risk ∈ {low, medium} (NOT high — always manual)
 *   - file.tier === production (the point of this module)
 *
 * Usage:
 *   const ca = require('./lib/cumulative_approvals');
 *   ca.recordApproval({ ruleId, file, proposalId });
 *   ca.isTrusted('fsSync_missing_trycatch');  // true/false
 *   ca.setThreshold(5);
 *   ca.getSummary();
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./config');

const STATE_FILE = path.join(STATE_DIR, 'cumulative_approvals.json');
const LOCK_FILE = STATE_FILE + '.lock';
const DEFAULT_THRESHOLD = 3;

/**
 * Acquire an exclusive process-level lock around a critical section, run fn,
 * then release.
 *
 * Node's core `fs` module does not expose `flock(2)` (no fs.flockSync as of
 * Node 22/26), so we implement a portable advisory mutex using mkdir(2) as
 * the atomic primitive. mkdir on the same filesystem is guaranteed atomic
 * by POSIX: only one of N concurrent mkdir calls for the same path can
 * succeed, and the losers get EEXIST. A short Atomics.wait gives blocking
 * semantics without busy-spinning. This is the standard fallback when
 * flock is unavailable, works identically on macOS and Linux, and
 * serializes CLI invocations / concurrent operators around the
 * read-modify-write cycle to eliminate lost-update and TOCTOU races on
 * the trust state.
 *
 * Read-side paths (isTrusted, checkAutoApply) intentionally do NOT lock —
 * staleness is acceptable for per-proposal decisions, and avoiding read
 * locks prevents contention on hot paths.
 */
function withExclusiveLock(fn) {
  // Ensure parent dir exists (it always does in practice, but be safe).
  try { fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true }); } catch (_) {}

  // Stale-lock timeout: if a previous process crashed mid-section, a
  // stale lock directory could wedge us forever. 30s is well above any
  // realistic recordApproval duration but short enough to recover from
  // a crashed operator.
  const STALE_MS = 30_000;
  const RETRY_DELAY_MS = 5;

  // Shared Int32Array + Atomics.wait/notify is the only synchronous sleep
  // primitive available on the main thread; setTimeout would yield to the
  // event loop and break our lock semantics.
  const waiter = new SharedArrayBuffer(4);
  const view = new Int32Array(waiter);

  // Loop until we win the mkdir race or detect a stale lock.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      fs.mkdirSync(LOCK_FILE);
      break; // we own the lock
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Lock path exists. It could be a directory (normal) or a stale
      // regular file left by an older version of this module that used
      // fs.openSync. Clean up legacy file-format locks.
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (stat.isFile()) {
          if (Date.now() - stat.mtimeMs > STALE_MS) {
            try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
            continue;
          }
          // Not stale — treat as a held lock and wait.
        } else if (Date.now() - stat.mtimeMs > STALE_MS) {
          // Stale lock directory (likely a crashed prior holder).
          try { fs.rmdirSync(LOCK_FILE); } catch (_) {}
          continue;
        }
      } catch (_) {
        // Lock path vanished between EEXIST and stat — loop and retry.
        continue;
      }
      // Block for RETRY_DELAY_MS. Atomics.wait yields the OS thread, so
      // we don't burn CPU. Timeout returns 'timed-out' so we just loop
      // and re-check the lock state.
      Atomics.wait(view, 0, 0, RETRY_DELAY_MS);
    }
  }

  try {
    return fn();
  } finally {
    try { fs.rmdirSync(LOCK_FILE); } catch (_) { /* best effort */ }
  }
}

// Risk classification for known rules. Default risk: medium.
const KNOWN_RISKS = {
  'trailing-whitespace': 'low',
  'missing-eof-newline': 'low',
  'consecutive-blank-lines': 'low',
  'hardcoded-home-path': 'medium',
  'missing-shebang': 'low',
  'magic-numbers-safe': 'medium',
  'simplified-chinese': 'medium',
  'fs-sync-trycatch': 'low',
  'fsSync_missing_trycatch': 'low',  // alias
  'optional-chaining': 'low',
};

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return defaultState();
    }
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return defaultState();
    return data;
  } catch (e) {
    return defaultState();
  }
}

function defaultState() {
  return {
    version: 1,
    threshold: DEFAULT_THRESHOLD,
    rules: {},
  };
}

function saveState(state) {
  state.version = 1;
  state.lastUpdated = new Date().toISOString();
  // atomic write: write to tmp, rename only if write succeeded, cleanup tmp on failure
  const tmp = STATE_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error(`Atomic save failed: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch (_) { /* tmp may not exist */ }
    throw e;  // surface error to caller (don't silently corrupt state)
  }
}

function getRisk(ruleId) {
  return KNOWN_RISKS[ruleId] || 'medium';
}

/**
 * Record a manual approval. Increments count, marks trusted if threshold reached.
 *
 * The entire read-modify-write cycle runs under withExclusiveLock so two
 * concurrent operators (or two CLI invocations) approving proposals of the
 * same rule cannot lose updates or double-count the same file. saveState
 * is still atomic via tmp+rename; the lock just guarantees the cycle is
 * serial from any other process's perspective.
 */
function recordApproval({ ruleId, file, proposalId }) {
  if (!ruleId) throw new Error('ruleId is required');
  return withExclusiveLock(() => {
    const state = loadState();
    if (!state.rules[ruleId]) {
      state.rules[ruleId] = {
        count: 0,
        risk: getRisk(ruleId),
        trusted: false,
        approvedFiles: [],
        firstApprovedAt: null,
        lastApprovedAt: null,
        lastApprovedProposalId: null,
      };
    }
    const r = state.rules[ruleId];
    // Don't double-count same file
    if (r?.approvedFiles?.includes(file)) {
      return { ...r, _alreadyApprovedFile: true };
    }
    r.count++;
    r?.approvedFiles?.push(file);
    r.firstApprovedAt = r.firstApprovedAt || new Date().toISOString();
    r.lastApprovedAt = new Date().toISOString();
    r.lastApprovedProposalId = proposalId;
    r.trusted = r.count >= state.threshold && r.risk !== 'high';
    saveState(state);
    return r;
  });
}

/**
 * Check if a rule has been manually approved enough times to auto-apply.
 *
 * NOTE: this is a read-only path and intentionally does NOT take the
 * exclusive lock. decideAction is per-proposal, not a tight loop, so the
 * cost of returning a slightly stale `trusted` value is negligible; a
 * read lock would block on every recordApproval. Callers that need a
 * fully-consistent view should use recordApproval's return value instead.
 */
function isTrusted(ruleId) {
  const state = loadState();
  const r = state.rules[ruleId];
  if (!r) return false;
  if (r.risk === 'high') return false; // high-risk rules never auto-apply
  return r.trusted === true;
}

/**
 * Check if a rule+severity combo should be auto-applied.
 * Returns { trusted, risk, count } or { trusted: false, ... }.
 */
function checkAutoApply({ ruleId, severity, tier }) {
  if (severity === 'critical') {
    return { trusted: false, reason: 'critical severity always manual' };
  }
  if (tier !== 'production') {
    return { trusted: false, reason: 'non-production tier uses existing decideAction' };
  }
  const state = loadState();
  const r = state.rules[ruleId];
  if (!r) {
    return { trusted: false, reason: 'no prior approvals', count: 0, risk: getRisk(ruleId), threshold: state.threshold };
  }
  if (r.risk === 'high') {
    return { trusted: false, reason: 'high-risk rule never auto-applies', count: r.count, risk: r.risk };
  }
  if (r.count < state.threshold) {
    return { trusted: false, reason: `count ${r.count} < threshold ${state.threshold}`, count: r.count, risk: r.risk, threshold: state.threshold };
  }
  return { trusted: true, count: r.count, risk: r.risk, threshold: state.threshold, firstApprovedAt: r.firstApprovedAt };
}

function setThreshold(n) {
  return withExclusiveLock(() => {
    const state = loadState();
    state.threshold = Math.max(1, n);
    // Re-evaluate trust for all rules
    for (const ruleId of Object.keys(state.rules)) {
      const r = state.rules[ruleId];
      r.trusted = r.count >= state.threshold && r.risk !== 'high';
    }
    saveState(state);
    return state.threshold;
  });
}

function getSummary() {
  const state = loadState();
  const summary = {
    threshold: state.threshold,
    totalRules: Object.keys(state.rules).length,
    trustedRules: 0,
    rules: {},
  };
  for (const [ruleId, r] of Object.entries(state.rules)) {
    summary.rules[ruleId] = { ...r };
    if (r.trusted) summary.trustedRules++;
  }
  return summary;
}

function listTrusted() {
  return Object.entries(loadState().rules)
    .filter(([_, r]) => r.trusted)
    .map(([ruleId, r]) => ({ ruleId, ...r }));
}

module.exports = {
  STATE_FILE,
  DEFAULT_THRESHOLD,
  KNOWN_RISKS,
  loadState,
  saveState,
  recordApproval,
  isTrusted,
  checkAutoApply,
  setThreshold,
  getSummary,
  listTrusted,
  getRisk,
};

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'summary') {
    const s = getSummary();
    console.log(JSON.stringify(s, null, 2));
  } else if (args[0] === 'list-trusted') {
    const t = listTrusted();
    console.log(JSON.stringify(t, null, 2));
  } else if (args[0] === 'set-threshold' && args[1]) {
    const n = setThreshold(parseInt(args[1], 10));
    console.log(`threshold set to ${n}`);
  } else {
    console.log(`cumulative_approvals.js — trust-based auto-approval state

Usage:
  node scripts/lib/cumulative_approvals.js summary          # show full state
  node scripts/lib/cumulative_approvals.js list-trusted     # show only trusted rules
  node scripts/lib/cumulative_approvals.js set-threshold N  # change threshold (default 3)
`);
  }
}
