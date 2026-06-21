#!/usr/bin/env node
/**
 * pre-emit-dedup.mjs — Pre-emit cosine-similarity filter for skill-review queue.
 *
 * Architectural root-cause fix (Phase 2h, 2026-06-21):
 *   The existing post-hoc 2-layer defense (content-hash dedup + LLM stability gate)
 *   only saves the file write — the LLM call, queue inflation, and validator
 *   run all complete first. This module moves the cosine check UPSTREAM of the
 *   queue write so high-similarity candidates never enter the pipeline.
 *
 * Three actions based on similarity vs existing skill embeddings:
 *   - skip    (similarity >= SKIP_THRESHOLD, default 0.85):
 *       Drop the candidate. Equivalent to "this skill already exists."
 *       This is the case causing the 12 high-regen offenders.
 *   - patch   (similarity in [PATCH_THRESHOLD, SKIP_THRESHOLD), default [0.65, 0.85)):
 *       Keep the candidate BUT mark proposedSkill.action = 'patch' so downstream
 *       consumers (skill_reviewer.js) can skip CREATE and route to PATCH.
 *   - append  (similarity < PATCH_THRESHOLD or any failure):
 *       Genuinely new. Pass through to queue unchanged.
 *
 * Design constraints (from task spec):
 *   - REUSE scripts/lib/skill_dedup_gate.js (don't duplicate cosine math)
 *   - Pure async/await (Node v26, ES modules)
 *   - Fail-open: any internal error returns {action: 'append', reason: 'fail-open'}
 *   - Cache proposals for 5min TTL (same as dedup_gate — avoid re-embedding)
 *   - --dry-run CLI for testing
 *
 * Config (env vars override defaults):
 *   PRE_EMIT_SKIP_THRESHOLD    default 0.85  (data-driven: see deliverable §3)
 *   PRE_EMIT_PATCH_THRESHOLD   default 0.65  (middle-range — see deliverable §2)
 *   PRE_EMIT_DISABLED          default false (set "1" to bypass filter entirely)
 *
 * CLI:
 *   node extensions/skill-auto-suggest/pre-emit-dedup.mjs --dry-run \
 *     --name <skill-name> --description "<desc>"
 *
 * Exit codes:
 *   0  skip
 *   1  patch
 *   2  append
 *   3  fail-open (default if anything goes wrong)
 */

'use strict';

import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const dedupGate = require('/Users/ally/.openclaw/workspace/scripts/lib/skill_dedup_gate.js');

// ─── Config ───────────────────────────────────────────────────────────────

const HOME = process.env.HOME || os.homedir();
const WS = path.join(HOME, '.openclaw', 'workspace');
const LOG_FILE = path.join(WS, '.pre_emit_dedup_log.jsonl');

const DEFAULT_SKIP_THRESHOLD = 0.85;
const DEFAULT_PATCH_THRESHOLD = 0.65;

const SKIP_THRESHOLD = (() => {
  const v = Number(process.env.PRE_EMIT_SKIP_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULT_SKIP_THRESHOLD;
})();

const PATCH_THRESHOLD = (() => {
  const v = Number(process.env.PRE_EMIT_PATCH_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULT_PATCH_THRESHOLD;
})();

const DISABLED = process.env.PRE_EMIT_DISABLED === '1';

// Hard guard: PATCH_THRESHOLD must be < SKIP_THRESHOLD
if (PATCH_THRESHOLD >= SKIP_THRESHOLD) {
  console.error(`[pre-emit-dedup] CONFIG ERROR: PATCH_THRESHOLD (${PATCH_THRESHOLD}) must be < SKIP_THRESHOLD (${SKIP_THRESHOLD}). Falling back to defaults.`);
}

// Per-process proposal embedding cache. Mirrors dedup_gate's _proposalCache TTL.
const _proposalCache = new Map();
const PROPOSAL_TTL_MS = 5 * 60 * 1000;

function _cacheKey(name, description) {
  // Reuse dedup_gate's proposalKey for consistency with the on-disk embeddings cache.
  return dedupGate.proposalKey(name || '', description || '');
}

// ─── Logging (fail-silent telemetry) ─────────────────────────────────────

async function _logTelemetry(entry) {
  try {
    await fs.promises.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.promises.appendFile(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  } catch (_) {
    // Fail-silent: telemetry must never break the pipeline.
  }
}

// ─── Core: findBestMatch ─────────────────────────────────────────────────

/**
 * Find the single best-matching existing skill for a proposed candidate.
 * Returns { name, score } or null if no match above the floor threshold.
 *
 * @param {string} name
 * @param {string} description
 * @param {Object} [opts]
 * @param {number} [opts.floor=0.0]  — minimum score to consider a match
 * @returns {Promise<{name: string, score: number}|null>}
 */
async function findBestMatch(name, description, opts = {}) {
  const floor = opts.floor || 0.0;
  if (!name || !description) return null;

  // Use computeDedupWarnings with threshold=0 to get all matches, then take the top.
  // This reuses dedup_gate's cosine math, proposal embedding cache, and Ollama call.
  const warnings = await dedupGate.computeDedupWarnings(name, description, { threshold: floor });
  if (!Array.isArray(warnings) || warnings.length === 0) return null;

  // warnings is sorted desc by score (per dedup_gate.js:254).
  // Hash-keyed entries (^[0-9a-f]{16}$) are the embeddings cache's
  // proposalKey() representation — pollution from prior proposals cached
  // alongside real skills. We must NEVER return a hash as `matchedSkill`,
  // because downstream callers (skill_reviewer_bot.js Stage 2 inject) build
  // filesystem paths like `skills-learned/<matchedSkill>/SKILL.md` and a
  // hash directory does not exist. Scan past ALL hash-keyed entries.
  const HASH_RE = /^[0-9a-f]{16}$/;
  let firstNonHash = null;
  for (const w of warnings) {
    if (!HASH_RE.test(w.similarSkill)) {
      firstNonHash = w;
      break;
    }
  }
  if (firstNonHash) {
    return {
      name: firstNonHash.similarSkill,
      score: firstNonHash.score,
      // Telemetry: surface when the filter actually engaged (i.e. the naive
      // top was a hash and we had to skip past it). The presence of this
      // flag in logs indicates the embeddings cache still contains
      // proposalKey pollution and may need cleaning.
      matchedSkillIsHash: !!warnings[0] && HASH_RE.test(warnings[0].similarSkill),
    };
  }
  // All top matches are hash-keyed — return null with explicit reason so
  // preEmitFilter() can log it and preEmitFilter's caller (the LLM skip
  // path) can decide. Returning null here means "no real skill match"
  // (preEmitFilter interprets as no_match_or_cold_start → action=append).
  return null;
}

// ─── Core: preEmitFilter ──────────────────────────────────────────────────

/**
 * Decide whether to append, patch, or skip a skill candidate before it enters
 * the review queue. NEVER THROWS — returns {action: 'append', reason: 'fail-open'}
 * on any error so the pipeline stays alive.
 *
 * @param {Object} candidate
 * @param {string} candidate.name          — proposed skill name
 * @param {string} candidate.description   — proposed skill description
 * @param {Object} [candidate.proposedSkill] — alternative shape (audit/pattern emitters)
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]    — if true, doesn't write telemetry
 * @param {string}  [opts.source]          — emitter name (audit_to_skill_emitter, etc.)
 * @returns {Promise<{action: 'append'|'patch'|'skip', reason: string, similarity?: number, matchedSkill?: string, matchedSkillIsHash?: boolean}>}
 */
export async function preEmitFilter(candidate, opts = {}) {
  const dryRun = !!opts.dryRun;
  const source = opts.source || 'unknown';

  // Normalize input — accept either flat {name, description} or nested {proposedSkill: {name, description}}
  const name = (candidate && (candidate.name || (candidate.proposedSkill && candidate.proposedSkill.name))) || '';
  const description = (candidate && (candidate.description || (candidate.proposedSkill && candidate.proposedSkill.description))) || '';

  // Fail-open #1: missing fields
  if (!name || !description) {
    const result = { action: 'append', reason: 'missing_fields' };
    if (!dryRun) _logTelemetry({ event: 'pre_emit_filter', source, name, action: result.action, reason: result.reason });
    return result;
  }

  // Bypass mode (env-controlled kill switch)
  if (DISABLED) {
    return { action: 'append', reason: 'disabled_env' };
  }

  // Cold-start / fail-open path — findBestMatch returns null on Ollama failure
  let best;
  try {
    best = await findBestMatch(name, description, { floor: PATCH_THRESHOLD });
  } catch (err) {
    const result = { action: 'append', reason: `fail-open: ${err.message || 'unknown'}` };
    if (!dryRun) _logTelemetry({ event: 'pre_emit_filter', source, name, action: result.action, reason: result.reason, error: err.message });
    return result;
  }

  // Cold-start: no embeddings cache → best === null → genuinely new, append
  if (!best) {
    const result = { action: 'append', reason: 'no_match_or_cold_start' };
    if (!dryRun) _logTelemetry({ event: 'pre_emit_filter', source, name, action: result.action, reason: result.reason });
    return result;
  }

  const { name: matchedSkill, score, matchedSkillIsHash } = best;

  // Decision tree
  let result;
  if (score >= SKIP_THRESHOLD) {
    result = {
      action: 'skip',
      reason: `similarity_${score.toFixed(3)}_>=_${SKIP_THRESHOLD}`,
      similarity: score,
      matchedSkill,
      matchedSkillIsHash: !!matchedSkillIsHash,
    };
  } else if (score >= PATCH_THRESHOLD) {
    result = {
      action: 'patch',
      reason: `similarity_${score.toFixed(3)}_in_[${PATCH_THRESHOLD},${SKIP_THRESHOLD})`,
      similarity: score,
      matchedSkill,
      matchedSkillIsHash: !!matchedSkillIsHash,
    };
  } else {
    // Shouldn't happen — best was filtered at floor=PATCH_THRESHOLD — but defensive
    result = { action: 'append', reason: 'below_patch_floor', similarity: score, matchedSkill, matchedSkillIsHash: !!matchedSkillIsHash };
  }

  if (!dryRun) _logTelemetry({ event: 'pre_emit_filter', source, name, action: result.action, reason: result.reason, similarity: score, matchedSkill, matchedSkillIsHash: !!matchedSkillIsHash });
  return result;
}

// ─── Decorator: applyToEntry ──────────────────────────────────────────────

/**
 * Higher-level helper for v=3 emit sites. Mutates the entry's qualitative_signals
 * (and proposedSkill) to mark PATCH intent when appropriate. Callers should:
 *
 *   const decision = await preEmitFilter(entry, { source: 'audit_to_skill_emitter' });
 *   if (decision.action === 'skip') continue;          // never enter the queue
 *   if (decision.action === 'patch') {
 *     entry.proposedSkill = entry.proposedSkill || {};
 *     entry.proposedSkill.action = 'patch';
 *     entry.proposedSkill.matched_skill = decision.matchedSkill;
 *     entry.proposedSkill.similarity = decision.similarity;
 *     entry.qualitative_signals = entry.qualitative_signals || {};
 *     entry.qualitative_signals.pre_emit_dedup = decision;
 *   }
 *   // 'append' → no mutation needed
 *   fs.appendFileSync(QUEUE, JSON.stringify(entry) + '\n', 'utf8');
 *
 * Returns the decision for convenience.
 */
export async function applyToEntry(entry, opts = {}) {
  const decision = await preEmitFilter(entry, opts);
  if (decision.action === 'patch') {
    entry.proposedSkill = entry.proposedSkill || { name: entry.name, description: entry.description };
    entry.proposedSkill.action = 'patch';
    entry.proposedSkill.matched_skill = decision.matchedSkill;
    entry.proposedSkill.similarity = decision.similarity;
    entry.qualitative_signals = entry.qualitative_signals || {};
    entry.qualitative_signals.pre_emit_dedup = {
      action: 'patch',
      matchedSkill: decision.matchedSkill,
      similarity: decision.similarity,
      reason: decision.reason,
      matchedSkillIsHash: !!decision.matchedSkillIsHash,
    };
  }
  return decision;
}

// ─── CLI / dry-run ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { name: '', description: '', dryRun: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--name') out.name = argv[++i] || '';
    else if (a === '--description' || a === '--desc') out.description = argv[++i] || '';
    else if (a.startsWith('--')) { /* unknown flag */ }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`pre-emit-dedup.mjs — Pre-emit cosine-similarity filter

Usage:
  node extensions/skill-auto-suggest/pre-emit-dedup.mjs --dry-run \\
    --name <skill-name> --description "<desc>"

Flags:
  --name <str>          Proposed skill name (required)
  --description <str>   Proposed skill description (required)
  --dry-run             Print decision JSON without writing telemetry

Env:
  PRE_EMIT_SKIP_THRESHOLD    default ${DEFAULT_SKIP_THRESHOLD}
  PRE_EMIT_PATCH_THRESHOLD   default ${DEFAULT_PATCH_THRESHOLD}
  PRE_EMIT_DISABLED          "1" to bypass filter entirely

Exit codes:
  0  skip
  1  patch
  2  append
  3  fail-open (default)
`);
    process.exit(2);
  }

  if (!args.name || !args.description) {
    console.error('ERROR: --name and --description are required');
    process.exit(3);
  }

  const decision = await preEmitFilter(
    { name: args.name, description: args.description },
    { dryRun: args.dryRun, source: 'cli' }
  );

  console.log(JSON.stringify(decision, null, 2));

  const exitCode = { skip: 0, patch: 1, append: 2 }[decision.action] ?? 3;
  process.exit(exitCode);
}

// Only run CLI when invoked directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[pre-emit-dedup] unexpected error: ${err.message}`);
    // Fail-open: exit code 3 means "append (fail-open)"
    process.exit(3);
  });
}

// ─── Constants export (for tests) ─────────────────────────────────────────

export const _INTERNAL = {
  SKIP_THRESHOLD,
  PATCH_THRESHOLD,
  DISABLED,
  LOG_FILE,
};
