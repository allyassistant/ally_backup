/**
 * release_id.js — ReleaseId Schema (Phase 1)
 *
 * Provides a `releaseId` field for every router decision entry so we can
 * bisect which release introduced a regression (silent mutations: rule patches,
 * skill approvals, model swaps, cron config changes — all happen silently today).
 *
 * Two state files under .state/:
 *   - current_release.json   : single mutable "what release is active right now"
 *   - releases.jsonl         : append-only history of every release created/closed
 *
 * All operations are fail-safe. Missing files or read errors return null;
 * the caller logs the entry with releaseId=null and processing continues.
 *
 * Pure Node.js built-ins: fs, path, crypto (randomUUID via Node 14.17+).
 *
 * Usage:
 *   const { currentReleaseId, getOrCreateReleaseId, lookupReleaseAtTs } =
 *     require('./release_id');
 *   const id = currentReleaseId();        // current active releaseId or null
 *   const id2 = getOrCreateReleaseId({ summary: 'manual release', actor: 'user' });
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// State files live at <workspace>/.state/ (workspace root), two levels up
// from scripts/router/. Sibling modules (hidden_drift_detector.js) use the same.
const STATE_DIR = path.join(__dirname, '..', '..', '.state');
const CURRENT_FILE = path.join(STATE_DIR, 'current_release.json');
const RELEASES_FILE = path.join(STATE_DIR, 'releases.jsonl');

// ────────────────────────── helpers ──────────────────────────

/** Generate a UUIDv4. Tries crypto.randomUUID first; falls back to randomBytes
 *  for older Node runtimes that lack it (Node 14.17+ has it; ~safe). */
function generateReleaseId() {
  try {
    return crypto.randomUUID();
  } catch (_err) {
    const b = crypto.randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return [
      h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20),
    ].join('-');
  }
}

function ensureStateDir() {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    return true;
  } catch (err) {
    console.warn(`[release_id] ensureStateDir failed: ${err.message}`);
    return false;
  }
}

/** Read & parse current_release.json. Returns null on any error. */
function readCurrentFile() {
  try {
    if (!fs.existsSync(CURRENT_FILE)) return null;
    const text = fs.readFileSync(CURRENT_FILE, 'utf8');
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    console.warn(`[release_id] readCurrentFile failed: ${err.message}`);
    return null;
  }
}

/** Atomic-ish write of current_release.json (write-temp + rename). */
function writeCurrentFile(state) {
  if (!ensureStateDir()) return false;
  const tmp = CURRENT_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, CURRENT_FILE);
    return true;
  } catch (err) {
    console.warn(`[release_id] writeCurrentFile failed: ${err.message}`);
    // Best-effort cleanup
    try { fs.unlinkSync(tmp); } catch (_e2) { /* ignore */ }
    return false;
  }
}

// ────────────────────────── public API ──────────────────────────

/**
 * Return the active releaseId, or null if there is no active release
 * or the file cannot be read. "Active" = releasedAt is null.
 *
 * @returns {string|null}
 */
function currentReleaseId() {
  const cur = readCurrentFile();
  if (!cur || !cur.releaseId) return null;
  if (cur.releasedAt) return null; // already superseded
  return cur.releaseId;
}

/**
 * Return the active releaseId, creating a new one if none is active.
 * On create, also appends an entry to releases.jsonl so the event is durable.
 *
 * @param {Object} [meta] - { type, actor, files, summary }
 * @returns {string|null} new or existing releaseId
 */
function getOrCreateReleaseId(meta) {
  meta = meta || {};
  const cur = readCurrentFile();
  if (cur && cur.releaseId && !cur.releasedAt) {
    return cur.releaseId;
  }
  const id = generateReleaseId();
  const now = new Date().toISOString();
  const state = {
    releaseId: id,
    createdAt: now,
    releasedAt: null,
  };
  if (!writeCurrentFile(state)) return null;
  recordRelease({
    releaseId: id,
    ts: now,
    releasedAt: null,
    type: typeof meta.type === 'string' ? meta.type : 'manual',
    actor: typeof meta.actor === 'string' ? meta.actor : 'user',
    files: Array.isArray(meta.files) ? meta.files.slice() : [],
    summary: typeof meta.summary === 'string' ? meta.summary : '',
  });
  return id;
}

/**
 * Append a release event to releases.jsonl. Fail-safe.
 *
 * @param {Object} entry
 */
function recordRelease(entry) {
  if (!ensureStateDir()) return;
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(RELEASES_FILE, line, 'utf8');
  } catch (err) {
    console.warn(`[release_id] recordRelease append failed: ${err.message}`);
  }
}

/**
 * Mark the current release as released (releasedAt = now). Future
 * currentReleaseId() calls will return null until getOrCreateReleaseId()
 * spins up a new one. Returns the released releaseId, or null.
 *
 * @returns {string|null}
 */
function clearRelease() {
  const cur = readCurrentFile();
  if (!cur || !cur.releaseId) return null;
  if (cur.releasedAt) return cur.releaseId; // already cleared
  const now = new Date().toISOString();
  const updated = Object.assign({}, cur, { releasedAt: now });
  if (!writeCurrentFile(updated)) return null;
  recordRelease(Object.assign({}, cur, {
    ts: cur.createdAt || now,
    releasedAt: now,
    type: 'supersede',
    actor: 'clearRelease',
    summary: 'marked expired by clearRelease()',
  }));
  return cur.releaseId;
}

/**
 * Read all release entries from releases.jsonl. Bad lines are skipped.
 *
 * @returns {Array<Object>}
 */
function readReleases() {
  if (!fs.existsSync(RELEASES_FILE)) return [];
  try {
    const text = fs.readFileSync(RELEASES_FILE, 'utf8');
    const out = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed)); }
      catch (_e) { /* skip malformed */ }
    }
    return out;
  } catch (err) {
    console.warn(`[release_id] readReleases failed: ${err.message}`);
    return [];
  }
}

/**
 * Find the releaseId active at the given timestamp. Returns null if no
 * release was active at that time, or on read error.
 *
 * @param {string|number|Date} ts - ISO string or epoch ms
 * @returns {string|null}
 */
function lookupReleaseAtTs(ts) {
  const tsMs = ts instanceof Date ? ts.getTime()
    : typeof ts === 'number' ? ts
    : Date.parse(ts);
  if (!Number.isFinite(tsMs)) return null;
  const releases = readReleases();
  let best = null;
  for (const r of releases) {
    // release entry schema: { releaseId, ts, releasedAt, type, actor, files, summary }
    const startMs = r.ts ? Date.parse(r.ts) : NaN;
    if (!Number.isFinite(startMs) || startMs > tsMs) continue;
    const endMs = r.releasedAt ? Date.parse(r.releasedAt) : null;
    if (endMs !== null && endMs < tsMs) continue;
    if (!best || startMs > Date.parse(best.ts)) best = r;
  }
  return best ? best.releaseId : null;
}

/**
 * Expose state paths for CLI tooling / debugging.
 */
function getStatePaths() {
  return {
    STATE_DIR,
    CURRENT_FILE,
    RELEASES_FILE,
  };
}

module.exports = {
  currentReleaseId,
  getOrCreateReleaseId,
  recordRelease,
  clearRelease,
  readReleases,
  readCurrentFile,
  lookupReleaseAtTs,
  generateReleaseId,
  getStatePaths,
};
