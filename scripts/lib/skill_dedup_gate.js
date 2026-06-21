'use strict';

/**
 * dedup_gate.js — Phase 2f: Soft server-side dedup gate for skill creation.
 *
 * Compares a proposed skill's name+description against existing skill
 * embeddings via cosine similarity. Returns warning lines for any existing
 * skill whose similarity exceeds a configurable threshold (default 0.85).
 *
 * The reviewer pipeline injects these warnings into the prompt's
 * "Aggregated Signals" section so the LLM is strongly nudged to PATCH
 * instead of CREATE — but the LLM still has final say (soft gate).
 *
 * Reuses the existing embeddings cache at
 * ~/.openclaw/workspace/.skill_auto_suggest_embeddings.json written by
 * the skill-auto-suggest extension. If the cache is missing or stale for
 * a given proposed skill, calls Ollama (configurable provider) to
 * generate the proposed-skill embedding on demand and persists it.
 *
 * Fail-open: any error returns an empty array — never blocks the
 * reviewer's prompt build.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const HOME = process.env.HOME || os.homedir();
const WS = path.join(HOME, '.openclaw', 'workspace');
const EMBEDDINGS_CACHE_FILE = path.join(WS, '.skill_auto_suggest_embeddings.json');
const EMBEDDINGS_CACHE_FILE_LEGACY = path.join(WS, '.skill_auto_suggest_embeddings.json'); // explicit alias

// Default config — overridable via env vars (Phase 2f OQ-2).
const DEFAULT_THRESHOLD = 0.85;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const DEDUP_TIMEOUT_MS = Number(process.env.DEDUP_TIMEOUT_MS || 4000);

// B-2: hash-keyed entries in the embeddings cache represent proposalKey()
// pollution (see proposalKey() below) — short 16-char sha256 prefixes from
// prior proposals cached alongside real skills. They must NEVER appear as a
// `similarSkill` value because downstream callers (skill_reviewer_bot.js
// Stage 2 inject, etc.) build filesystem paths like
// `skills-learned/<similarSkill>/SKILL.md` — a hash directory does not
// exist, the LLM sees a warning with no real skill to PATCH, and the
// candidate is silently lost. Mirror of the filter in
// extensions/skill-auto-suggest/pre-emit-dedup.mjs:128-135.
const HASH_KEY_RE = /^[0-9a-f]{16}$/;

// Per-process cache so a single reviewer run doesn't re-embed the same
// proposed skill for multiple checks. Cleared on process exit.
const _proposalCache = new Map(); // key -> { vector, ts }
const _runCache = new Map();      // proposedKey -> warning array (per computeDedupWarnings call)
const PROPOSAL_TTL_MS = 5 * 60 * 1000;

// Medium-2 (2026-06-21): file-level mutex around the embeddings cache
// read-modify-write cycle. The cache is shared between 3 writers
// (skill-auto-suggest extension, skill_dedup_gate.js, skill_reviewer_bot.js
// indirectly) and `saveEmbeddingsCache` uses tmp+rename — without a lock,
// two concurrent writers can both rename their own tmp and the second
// rename wins, silently dropping the first writer's content. The data loss
// is benign today (different proposalKey hashes, no overlap) but it's a
// design weakness. We use mkdir-as-mutex mirroring the bot's LOCK_DIR
// pattern — no new dependencies, and the trade-off is the same: a stale
// lock from a SIGKILL'd process blocks the next writer until manual
// cleanup (mitigated by the 30s timeout in `withEmbeddingsLock`).
const EMBEDDINGS_LOCK_DIR = EMBEDDINGS_CACHE_FILE + '.lockdir';
const EMBEDDINGS_LOCK_TIMEOUT_MS = 30 * 1000;
const EMBEDDINGS_LOCK_RETRY_MS = 50;

// ── Cosine similarity (mirrors extensions/skill-auto-suggest/embedding.mjs) ──

/**
 * Compute cosine similarity between two vectors. Returns value in [-1, 1].
 * Mirrors the helper in extensions/skill-auto-suggest/embedding.mjs so the
 * reviewer stays consistent with the auto-suggest scoring math.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return -1;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Cosine in [-1, 1] → normalized [0, 1] similarity score.
 * Phase 2f default threshold 0.85 operates on this normalized score
 * (matches scoreSkillVector in matcher.mjs so reviewers and auto-suggest
 * agree on what counts as "similar").
 */
function normalizeSimilarity(similarity) {
  return Math.max(0, Math.min(1, (similarity + 1) / 2));
}

// ── Embeddings cache I/O ──

/**
 * Load the embeddings cache. Returns null on any error / missing file.
 * The cache is a JSON object: { model, generatedAt, embeddings: {name: vector[]} }.
 */
function loadEmbeddingsCache() {
  try {
    if (!fs.existsSync(EMBEDDINGS_CACHE_FILE)) return null;
    const raw = fs.readFileSync(EMBEDDINGS_CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.embeddings) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Persist the embeddings cache atomically (write to .tmp, rename).
 * Used after adding a new proposed-skill embedding on demand.
 */
function saveEmbeddingsCache(data) {
  const target = EMBEDDINGS_CACHE_FILE;
  const tmp = target + '.tmp.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

/**
 * Acquire a mkdir-based mutex on the embeddings cache file. Released via
 * rmdir. Bounded wait (30s default) so a SIGKILL'd predecessor doesn't
 * block the system forever. Returns null if the lock could not be
 * acquired within the timeout — caller should treat that as a soft
 * failure (skip the write) so we never block the reviewer's hot path.
 */
async function withEmbeddingsLock(fn) {
  const start = Date.now();
  while (Date.now() - start < EMBEDDINGS_LOCK_TIMEOUT_MS) {
    try {
      fs.mkdirSync(EMBEDDINGS_LOCK_DIR, { recursive: false });
      try {
        return await fn();
      } finally {
        try { fs.rmdirSync(EMBEDDINGS_LOCK_DIR); } catch {}
      }
    } catch (e) {
      if (e && e.code !== 'EEXIST') throw e;
      await new Promise(r => setTimeout(r, EMBEDDINGS_LOCK_RETRY_MS));
    }
  }
  return null;
}

// ── Ollama provider (subset of extensions/skill-auto-suggest/embedding.mjs) ──

/**
 * Minimal Ollama embed call with a hard timeout so a stalled daemon
 * never blocks the reviewer build. Returns null on any error.
 */
async function embedWithOllama(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEDUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.embedding)) return null;
    return data.embedding;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ── Proposal key + embedding cache ──

/**
 * Build a stable cache key for the proposed skill. The cache key
 * intentionally hashes name+description so two different proposals with
 * the same text share a cached embedding (within TTL).
 */
function proposalKey(name, description) {
  const payload = `${(name || '').trim().toLowerCase()}\n${(description || '').trim()}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Build the text we embed. Concatenates name + description with a separator
 * so the embedding captures both intent (name) and content (description).
 */
function buildProposalText(name, description) {
  return `${(name || '').trim()}\n${(description || '').trim()}`;
}

/**
 * Get or compute the proposed skill's embedding. Returns null if Ollama
 * is unreachable — caller then returns an empty warning list (fail-open).
 */
async function getProposalEmbedding(name, description) {
  const key = proposalKey(name, description);
  const cached = _proposalCache.get(key);
  if (cached && (Date.now() - cached.ts) < PROPOSAL_TTL_MS) {
    return cached.vector;
  }

  const cache = loadEmbeddingsCache();
  if (cache && cache.model === OLLAMA_MODEL && cache.embeddings && Array.isArray(cache.embeddings[key])) {
    _proposalCache.set(key, { vector: cache.embeddings[key], ts: Date.now() });
    return cache.embeddings[key];
  }

  // Cache miss — call Ollama.
  const text = buildProposalText(name, description);
  const vector = await embedWithOllama(text);
  if (!vector) return null;

  _proposalCache.set(key, { vector, ts: Date.now() });

  // Best-effort persist: append into the existing cache under the proposal key
  // so subsequent runs (and skill-auto-suggest) can reuse it. Serialize the
  // read-modify-write via withEmbeddingsLock so concurrent writers don't
  // clobber each other's tmp+rename (Medium-2). If the lock can't be
  // acquired (timeout) we skip the persist — the in-process _proposalCache
  // still serves this run, and a future run will retry.
  try {
    const result = await withEmbeddingsLock(async () => {
      const freshCache = loadEmbeddingsCache();
      const next = freshCache && freshCache.model === OLLAMA_MODEL
        ? { ...freshCache, embeddings: { ...(freshCache.embeddings || {}), [key]: vector } }
        : { model: OLLAMA_MODEL, generatedAt: new Date().toISOString(), embeddings: { [key]: vector } };
      return saveEmbeddingsCache(next);
    });
    if (result === null) {
      // Lock timeout — skip persist, this run still works via in-process cache.
    }
  } catch { /* best-effort */ }

  return vector;
}

// ── Core: computeDedupWarnings ──

/**
 * Compare a proposed skill against every existing embedding and return
 * warnings for matches above the configured threshold.
 *
 * Pure-async function: no I/O outside the embeddings cache + Ollama call.
 *
 * @param {string} proposedName
 * @param {string} proposedDescription
 * @param {Object} [options]
 * @param {number} [options.threshold]  — cosine in [0, 1]; default 0.85 (or DEDUP_THRESHOLD env)
 * @param {Object<string, number[]>} [options.skillEmbeddings]
 *   Optional override for the existing-skill embedding map (skips the
 *   on-disk cache). Used by tests. Keys are skill names; values are vectors.
 * @returns {Promise<Array<{line: string, similarSkill: string, score: number}>>}
 *   Empty array on any error or no matches (fail-open).
 */
async function computeDedupWarnings(proposedName, proposedDescription, options = {}) {
  if (!proposedName || !proposedDescription) return [];

  const threshold = options.threshold !== undefined
    ? options.threshold
    : Number(process.env.DEDUP_THRESHOLD || DEFAULT_THRESHOLD);

  const cacheKey = `${proposalKey(proposedName, proposedDescription)}|t=${threshold}`;
  if (_runCache.has(cacheKey)) return _runCache.get(cacheKey);

  const proposalVector = await getProposalEmbedding(proposedName, proposedDescription);
  if (!proposalVector) {
    _runCache.set(cacheKey, []);
    return [];
  }

  // Use injected skillEmbeddings (tests) or load from disk (production).
  let skillEmbeddings = options.skillEmbeddings;
  if (!skillEmbeddings) {
    const cache = loadEmbeddingsCache();
    if (!cache || !cache.embeddings) {
      _runCache.set(cacheKey, []);
      return [];
    }
    skillEmbeddings = cache.embeddings;
  }

  const matches = [];
  for (const [name, vector] of Object.entries(skillEmbeddings)) {
    // B-2: skip hash-keyed entries (proposalKey() cache pollution from prior
    // proposals). Downstream callers build filesystem paths from similarSkill
    // (`skills-learned/<similarSkill>/SKILL.md`) — a hash directory doesn't
    // exist, so the LLM sees a "similar to <hash>" warning with no real
    // skill to PATCH and silently drops the candidate. Mirror of the filter
    // in extensions/skill-auto-suggest/pre-emit-dedup.mjs:128-135.
    if (HASH_KEY_RE.test(name)) continue;
    if (!Array.isArray(vector) || vector.length !== proposalVector.length) continue;
    const cos = cosineSimilarity(proposalVector, vector);
    const norm = normalizeSimilarity(cos);
    if (norm >= threshold) {
      matches.push({ similarSkill: name, score: norm });
    }
  }

  // Sort by descending similarity so the most-similar existing skill
  // appears first in the warning block.
  matches.sort((a, b) => b.score - a.score);

  const warnings = matches.map(m => ({
    line: `  - Dedup warning: proposed skill "${proposedName}" is ${m?.score?.toFixed(2)} similar to existing "${m.similarSkill}" — strongly consider PATCH instead of CREATE.`,
    similarSkill: m.similarSkill,
    score: m.score,
  }));

  _runCache.set(cacheKey, warnings);
  return warnings;
}

/**
 * Synchronous variant used by the reviewer's hot path. Only consults the
 * embeddings already on disk — does NOT call Ollama. This keeps prompt
 * build deterministic and cache-friendly (the prompt cache hashes
 * everything we inject, so async Ollama calls would invalidate it).
 *
 * If the proposal's own embedding is not cached, this returns an empty
 * array (fail-open). The async `computeDedupWarnings` path can warm the
 * cache for future runs.
 *
 * @param {string} proposedName
 * @param {string} proposedDescription
 * @param {Object} [options]
 * @param {number} [options.threshold]
 * @returns {Array<{line: string, similarSkill: string, score: number}>}
 */
function computeDedupWarningsSync(proposedName, proposedDescription, options = {}) {
  if (!proposedName || !proposedDescription) return [];

  const threshold = options.threshold !== undefined
    ? options.threshold
    : Number(process.env.DEDUP_THRESHOLD || DEFAULT_THRESHOLD);

  const key = proposalKey(proposedName, proposedDescription);

  // Resolve the proposal vector: caller-injected embeddings take precedence
  // (used by tests + warm-cache scenarios); otherwise fall back to disk cache.
  let proposalVector = null;
  if (options.skillEmbeddings && Array.isArray(options.skillEmbeddings[key])) {
    proposalVector = options.skillEmbeddings[key];
  } else {
    const cache = loadEmbeddingsCache();
    if (!cache || !cache.embeddings || !Array.isArray(cache.embeddings[key])) return [];
    proposalVector = cache.embeddings[key];
  }
  if (!Array.isArray(proposalVector)) return []; // not cached → fail-open

  const skillEmbeddings = options.skillEmbeddings || loadEmbeddingsCache()?.embeddings || {};

  const matches = [];
  for (const [name, vector] of Object.entries(skillEmbeddings)) {
    if (name === key) continue; // don't compare against itself
    // B-2: skip hash-keyed entries (proposalKey() cache pollution). See
    // computeDedupWarnings above and pre-emit-dedup.mjs:128-135.
    if (HASH_KEY_RE.test(name)) continue;
    if (!Array.isArray(vector) || vector.length !== proposalVector.length) continue;
    const cos = cosineSimilarity(proposalVector, vector);
    const norm = normalizeSimilarity(cos);
    if (norm >= threshold) {
      matches.push({ similarSkill: name, score: norm });
    }
  }
  matches.sort((a, b) => b.score - a.score);

  return matches.map(m => ({
    line: `  - Dedup warning: proposed skill "${proposedName}" is ${m?.score?.toFixed(2)} similar to existing "${m.similarSkill}" — strongly consider PATCH instead of CREATE.`,
    similarSkill: m.similarSkill,
    score: m.score,
  }));
}

/**
 * Collect dedup warnings for every entry in a batch that carries a
 * `proposedSkill: { name, description }` payload. Returns a flat list of
 * signal lines ready to be merged into `formatSignalLines` output.
 *
 * @param {Array<Object>} entries — raw queue entries
 * @returns {Array<string>}  — dedup warning lines (deduped by proposed name)
 */
function collectDedupSignals(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const seen = new Set();
  const lines = [];
  for (const e of entries) {
    if (!e || !e.proposedSkill || !e?.proposedSkill?.name || !e?.proposedSkill?.description) continue;
    const key = `${e?.proposedSkill?.name}|${e?.proposedSkill?.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const warnings = computeDedupWarningsSync(
      e?.proposedSkill?.name,
      e?.proposedSkill?.description,
      options,
    );
    for (const w of warnings) lines.push(w.line);
  }
  return lines;
}

/**
 * Format warning lines for direct injection into the Aggregated Signals
 * section. Returns an array of strings prefixed with `> ` so they match
 * the existing `formatSignalLines` shape.
 */
function formatDedupWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return [];
  return warnings.map(w => w.line);
}

/**
 * Clear in-process caches. Exposed for tests.
 */
function _clearCaches() {
  _proposalCache.clear();
  _runCache.clear();
}

module.exports = {
  computeDedupWarnings,
  computeDedupWarningsSync,
  collectDedupSignals,
  formatDedupWarnings,
  cosineSimilarity,
  normalizeSimilarity,
  loadEmbeddingsCache,
  saveEmbeddingsCache,
  embedWithOllama,
  proposalKey,
  buildProposalText,
  _clearCaches,
  // Internal constants exported for tests
  EMBEDDINGS_CACHE_FILE,
  EMBEDDINGS_CACHE_FILE_LEGACY,
  DEFAULT_THRESHOLD,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
};
