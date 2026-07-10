#!/usr/bin/env node
/**
 * m3_advisory_cache.js — Content-hash-keyed M3 advisory verdict cache
 *
 * Plan C Fix #3 (2026-06-24): avoid re-calling M3 for skills whose content
 * hasn't changed. Keyed by (skillName, sha256(content)). Invalidates when
 * the SKILL.md content changes (new sha256 → cache miss → fresh M3 call).
 *
 * Cache file: <WS>/.state/m3_advisory_cache.json
 * Shape: { [skillName]: { contentHash, cachedAt, verdict } }
 *
 * Failure semantics:
 *   - Read failure  → treat as miss, caller falls through to M3 call
 *   - Write failure → caller still returns the M3 verdict; cache is best-effort
 *   - Never throws — all errors swallowed
 *
 * Public API:
 *   getCached(skillName, content)  → verdict object or null
 *   setCached(skillName, content, verdict)  → void (best-effort)
 *   clearCache()  → void (best-effort)
 *   hashContent(content)  → sha256 hex string
 *   CACHE_FILE  → absolute path constant
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { WS } = require('./config');
const CACHE_FILE = path.join(WS, '.state', 'm3_advisory_cache.json');

function hashContent(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex');
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (_) { return {}; }
}

function saveCache(cache) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) { /* best effort */ }
}

function getCached(skillName, content) {
  if (!skillName || typeof skillName !== 'string') return null;
  const hash = hashContent(content);
  const cache = loadCache();
  const entry = cache[skillName];
  if (entry && entry.contentHash === hash) {
    return entry.verdict;
  }
  return null;
}

function setCached(skillName, content, verdict) {
  if (!skillName || typeof skillName !== 'string') return;
  if (!verdict || typeof verdict !== 'object') return;
  const hash = hashContent(content);
  const cache = loadCache();
  cache[skillName] = {
    contentHash: hash,
    cachedAt: new Date().toISOString(),
    verdict: verdict,
  };
  saveCache(cache);
}

function clearCache() {
  try { fs.unlinkSync(CACHE_FILE); } catch (_) {}
}

module.exports = { getCached, setCached, clearCache, hashContent, CACHE_FILE };
