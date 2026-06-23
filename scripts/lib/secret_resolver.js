/**
 * Secret Resolver — Generic SecretRef Resolver for OpenClaw config
 *
 * OpenClaw uses SecretRef objects instead of plaintext secrets:
 *   { source: 'env', provider: 'default', id: 'OPENCLAW_DISCORD_TOKEN' }
 *
 * Direct access (config.channels.discord.token) returns the SecretRef OBJECT,
 * not the secret. Calling code must resolve the SecretRef to get the actual
 * secret value.
 *
 * 2026-06-23 incident: 11 scripts read `config.channels.discord.token`
 * directly and got the SecretRef object instead of the token string, causing
 * 401 Unauthorized errors on every Discord REST call. KB Ingester silently
 * failed to ingest for a day because the 401 was caught and treated as
 * "0 new messages".
 *
 * Supported sources (extensible):
 *   - env:     { source: 'env', provider: 'default', id: 'ENV_VAR_NAME' }
 *              → reads process.env[id]
 *   - file:    { source: 'file', provider: 'default', id: '/path/to/file' }
 *              → reads file contents (for future use)
 *
 * Returns null if:
 *   - Path doesn't exist
 *   - SecretRef is malformed
 *   - Env var is not set
 *   - File can't be read
 *
 * Throws nothing — fail-soft. Callers should check for null.
 */

const fs = require('node:fs');

/**
 * Resolve a secret from config at the given dot-path.
 *
 * @param {object} config - OpenClaw config object
 * @param {string} dotPath - e.g. 'channels.discord.token'
 * @returns {string|null} - resolved secret or null
 */
function resolveSecret(config, dotPath) {
  if (!config || !dotPath) return null;
  const pathParts = dotPath.split('.').map(p => p.replace(/\?$/, ''));
  let ref = config;
  for (const p of pathParts) {
    if (ref == null) return null;
    ref = ref[p];
  }
  if (ref == null) return null;
  // Legacy plaintext (string)
  if (typeof ref === 'string') return ref;
  // SecretRef object
  if (typeof ref !== 'object') return null;
  if (!ref.source) return null;
  switch (ref.source) {
    case 'env':
      return resolveFromEnv(ref);
    case 'file':
      return resolveFromFile(ref);
    default:
      return null;  // unknown source type
  }
}

function resolveFromEnv(ref) {
  if (!ref.id) return null;
  return process.env[ref.id] || null;
}

function resolveFromFile(ref) {
  if (!ref.id) return null;
  try {
    return fs.readFileSync(ref.id, 'utf8').trim();
  } catch (_) {
    return null;
  }
}

/**
 * Convenience wrapper: resolve Discord token from config.
 * If config is omitted, reads ~/.openclaw/openclaw.json automatically.
 * Most call sites should use this form.
 */
function getDiscordToken(config) {
  if (config) return resolveSecret(config, 'channels?.discord?.token');
  return resolveSecret(readOpenclawConfig(), 'channels?.discord?.token');
}

/**
 * Convenience wrapper: resolve a model provider's API key.
 * If config is omitted, reads ~/.openclaw/openclaw.json automatically.
 */
function getProviderApiKey(providerName, config) {
  if (config) return resolveSecret(config, `models?.providers?.${providerName}.apiKey`);
  return resolveSecret(readOpenclawConfig(), `models?.providers?.${providerName}.apiKey`);
}

/**
 * Internal: read OpenClaw config from default path.
 * Caches result for the process lifetime.
 */
let _configCache = null;
function readOpenclawConfig() {
  if (_configCache) return _configCache;
  const path = require('node:path');
  const configPath = process.env.OPENCLAW_CONFIG ||
    path.join(process.env.HOME || '/Users/ally', '.openclaw', 'openclaw.json');
  try {
    _configCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return _configCache;
  } catch (_) {
    return null;
  }
}

/** Reset internal cache — for tests or after config file changes. */
function _resetCache() {
  _configCache = null;
}

/**
 * Debug helper: describe a SecretRef without exposing the value.
 * @returns {object} { type, source, id, resolved: 'present'|'missing' }
 */
function describeSecret(config, dotPath) {
  if (!config || !dotPath) return null;
  const pathParts = dotPath.split('.').map(p => p.replace(/\?$/, ''));
  let ref = config;
  for (const p of pathParts) {
    if (ref == null) return null;
    ref = ref[p];
  }
  if (ref == null) return null;
  if (typeof ref === 'string') {
    return { type: 'plaintext', length: ref.length };
  }
  if (typeof ref !== 'object') return null;
  const resolved = resolveSecret(config, dotPath);
  return {
    type: 'SecretRef',
    source: ref.source,
    provider: ref.provider,
    id: ref.id,
    resolved: resolved ? 'present' : 'missing',
  };
}

module.exports = {
  resolveSecret,
  getDiscordToken,
  getProviderApiKey,
  describeSecret,
  _resetCache,
};
