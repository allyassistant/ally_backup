/**
 * Shared Config Loader — Unified YAML + ENV resolution for router modules.
 *
 * Replaces duplicated logic in model_router.js and failure_recovery.js.
 * Uses mtime-aware caching (accurate, no unnecessary re-reads).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PATH = path.join(__dirname, 'route_model.yaml');
const ENV_PLACEHOLDER_REGEX = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/** @type {{ mtime: number, config: object }|null} */
let yamlCache = null;

// ─── 1. YAML Loading (mtime-aware cache) ────────────────────────────────────

/**
 * Load and parse route_model.yaml with mtime-aware caching.
 *
 * @returns {object} Parsed YAML config
 * @throws {Error} If file missing, unreadable, or YAML parse fails
 */
function loadRouteModelYaml() {
  let stats;
  try {
    stats = fs.statSync(CONFIG_PATH);
  } catch (err) {
    throw new Error(`Failed to stat route config: ${err.message}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Route config is not a file: ${CONFIG_PATH}`);
  }

  const currentMtime = stats.mtimeMs;
  if (yamlCache && yamlCache.mtime === currentMtime) {
    return yamlCache.config;
  }

  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read route config: ${err.message}`);
  }

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`Failed to parse route config YAML: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Route config YAML parsed to non-object');
  }

  yamlCache = { mtime: currentMtime, config: parsed };
  return parsed;
}

// ─── 2. ENV Var Resolution ──────────────────────────────────────────────────

/**
 * Recursively replace `${VAR_NAME}` with `process.env[VAR_NAME]`.
 *
 * @param {*} obj
 * @returns {*}
 * @throws {Error} If a referenced env var is not defined
 */
function resolveEnvPlaceholders(obj) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    let result = obj;
    let match;
    ENV_PLACEHOLDER_REGEX.lastIndex = 0;
    while ((match = ENV_PLACEHOLDER_REGEX.exec(obj)) !== null) {
      const envValue = process.env[match[1]];
      if (envValue === undefined) {
        throw new Error(`Missing required environment variable: ${match[1]}`);
      }
      result = result.replace(new RegExp(`\\$\\{${match[1]}\\}`, 'g'), () => envValue);
    }
    return result;
  }

  if (Array.isArray(obj)) {
    return obj.map(resolveEnvPlaceholders);
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = resolveEnvPlaceholders(obj[key]);
    }
    return result;
  }

  return obj;
}

// ─── 3. Cache Invalidation (for tests) ──────────────────────────────────────

function _invalidateCache() {
  yamlCache = null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  loadRouteModelYaml,
  resolveEnvPlaceholders,
  _invalidateCache,
};
