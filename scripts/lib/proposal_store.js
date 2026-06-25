#!/usr/bin/env node
/**
 * lib/proposal_store.js — Centralized repair proposal I/O
 *
 * Replaces 3 identical loadProposals() implementations in:
 *   - audit_repair_proposer.js
 *   - propose_fix_notifier.js
 *   - proposal_action.js
 *
 * Provides:
 *   - load() — read .state/repair_proposals.json
 *   - save(data) — atomic write
 *   - findById(data, id) — find proposal by ID
 *   - findByRule(data, ruleId) — find proposals by rule
 *   - update(data, id, patch) — merge patch into proposal
 *   - append(data, proposal) — add new proposal with dedup
 *
 * Atomic writes via temp file + rename. Fail-open on read.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { STATE_DIR } = require('./config');

const PROPOSALS_FILE = path.join(STATE_DIR, 'repair_proposals.json');
const LOCK_FILE = PROPOSALS_FILE + '.lock';

/**
 * Load proposals from .state/repair_proposals.json.
 * Returns null on missing/corrupt (fail-open).
 */
function load() {
  try {
    if (!fs.existsSync(PROPOSALS_FILE)) return null;
    return JSON.parse(fs.readFileSync(PROPOSALS_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * Save proposals to .state/repair_proposals.json atomically.
 * Updates meta.lastUpdated before writing.
 */
function save(data) {
  if (!data || typeof data !== 'object') throw new Error('save: data must be object');
  data.meta = data.meta || {};
  data.meta.lastUpdated = new Date().toISOString();
  if (!data.proposals || !Array.isArray(data.proposals)) data.proposals = [];

  // Atomic write via temp file with cleanup on failure
  const tmp = PROPOSALS_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, PROPOSALS_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* tmp may not exist */ }
    throw e;
  }
}

/**
 * Find a proposal by ID.
 */
function findById(data, id) {
  if (!data || !Array.isArray(data.proposals)) return null;
  return data?.proposals?.find(p => p.id === id);
}

/**
 * Find all proposals matching a rule id.
 */
function findByRule(data, ruleId) {
  if (!data || !Array.isArray(data.proposals)) return [];
  return data?.proposals?.filter(p => p.rule === ruleId);
}

/**
 * Update a proposal by id (merge patch).
 * Returns the updated proposal, or null if not found.
 */
function update(data, id, patch) {
  const p = findById(data, id);
  if (!p) return null;
  Object.assign(p, patch);
  return p;
}

/**
 * Append a new proposal with dedup.
 * Dedup key: file:line:rule (skip if existing + non-rejected).
 * Returns true if appended, false if duplicate.
 *
 * Mutates `data` in place. Caller must ensure data is a valid object with
 * an array `proposals` field — pass `load()` output or a fresh
 * `{ proposals: [] }` literal. Returns false if data is null/undefined.
 */
function append(data, proposal) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.proposals)) data.proposals = [];
  const dupKey = `${proposal.file}:${proposal.line}:${proposal.rule}`;
  const isDup = data?.proposals?.some(p =>
    `${p.file}:${p.line}:${p.rule}` === dupKey && p.status !== 'rejected'
  );
  if (isDup) return false;
  // Default fields
  proposal.id = proposal.id || `PROP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  proposal.createdAt = proposal.createdAt || new Date().toISOString();
  proposal.status = proposal.status || 'pending';
  data?.proposals?.push(proposal);
  return true;
}

/**
 * Count proposals by status.
 */
function countByStatus(data) {
  const counts = { pending: 0, approved: 0, rejected: 0, applied: 0 };
  if (!data || !Array.isArray(data.proposals)) return counts;
  for (const p of data.proposals) {
    if (counts[p.status] !== undefined) counts[p.status]++;
  }
  return counts;
}

/**
 * Acquire an exclusive process-level lock around a critical section, run fn,
 * then release. Used by appendAndSave() to make load→check→push→save atomic
 * across concurrent callers.
 *
 * Same pattern as cumulative_approvals.js (Round 5 fix): mkdir(2) as the
 * atomic create-or-fail primitive, Atomics.wait for synchronous blocking,
 * 30s stale-lock recovery, try/finally for cleanup. See
 * cumulative_approvals.js:75-131 for the original implementation.
 *
 * Fails closed: if the lock cannot be acquired for any reason other than
 * a recoverable stale lock, the error propagates and the critical section
 * does not run. This preserves the invariant that at most one writer
 * mutates PROPOSALS_FILE at a time.
 */
function withExclusiveLock(fn) {
  try { fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true }); } catch (_) {}

  const STALE_MS = 30_000;
  const RETRY_DELAY_MS = 5;

  const waiter = new SharedArrayBuffer(4);
  const view = new Int32Array(waiter);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      fs.mkdirSync(LOCK_FILE);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (stat.isFile()) {
          if (Date.now() - stat.mtimeMs > STALE_MS) {
            try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
            continue;
          }
        } else if (Date.now() - stat.mtimeMs > STALE_MS) {
          try { fs.rmdirSync(LOCK_FILE); } catch (_) {}
          continue;
        }
      } catch (_) {
        continue;
      }
      Atomics.wait(view, 0, 0, RETRY_DELAY_MS);
    }
  }

  try {
    return fn();
  } finally {
    try { fs.rmdirSync(LOCK_FILE); } catch (_) {}
  }
}

/**
 * Append a new proposal with dedup AND save the result, atomically.
 * Combines load + check + push + save under an exclusive lock so two
 * concurrent callers cannot interleave (lost-update or dedup-bypass race).
 *
 * Returns true if appended, false if a non-rejected duplicate already exists.
 *
 * Use this INSTEAD of: load() → append(data, p) → save(data).
 * That three-step pattern has a TOCTOU race when called concurrently from
 * different processes (e.g., cron 04:45 audit_repair_proposer.js and a
 * future apply_fix_daemon.js running at the same time). This function
 * holds an exclusive lock for the entire read-modify-write cycle, so the
 * dedup invariant and last-writer-wins ordering are both preserved.
 */
function appendAndSave(proposal) {
  return withExclusiveLock(() => {
    let data = load();
    if (!data) data = { proposals: [], meta: {} };
    const appended = append(data, proposal);
    if (!appended) return false;
    save(data);
    return true;
  });
}

module.exports = {
  PROPOSALS_FILE,
  LOCK_FILE,
  load,
  save,
  findById,
  findByRule,
  update,
  append,
  appendAndSave,
  withExclusiveLock,
  countByStatus,
};
