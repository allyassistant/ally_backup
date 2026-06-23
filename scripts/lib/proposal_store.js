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

module.exports = {
  PROPOSALS_FILE,
  load,
  save,
  findById,
  findByRule,
  update,
  append,
  countByStatus,
};
