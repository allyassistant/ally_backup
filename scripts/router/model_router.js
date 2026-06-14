/**
 * model_router.js — Phase 1 Fusion Router
 *
 * 取代 archived 版本，對齊 Hermes auxiliary concept
 * (provider / model / timeout / extra_body)，保留 OpenClaw route-based 架構。
 *
 * Usage:
 *   const { routeModel } = require('./model_router');
 *   const cfg = await routeModel({ text, route, context });
 *   // => { provider, model, baseUrl, apiKey, timeout, extraBody, fallbackChain, decisionId }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Shared config loader (replaces duplicated logic in failure_recovery.js) ─

const { loadRouteModelYaml, resolveEnvPlaceholders } = require('./config_loader');
const { maybeRotate } = require('./log_rotator');

// ─── Sibling module (out-of-scope, expected to exist) ───────────────────────

let failureRecovery;
try {
  failureRecovery = require('./failure_recovery');
} catch (err) {
  failureRecovery = null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DECISION_LOG_PATH = path.join(__dirname, 'decision_log.jsonl');

const REQUIRED_ROUTES = [
  'fdq', 'direct_answer', 'sop', 'spawn', 'spawn_quality', 'code', 'browser', 'none',
];

const SCHEMA_VERSION = '1.0';
const DEFAULT_TIMEOUT = 60;  // seconds — fallback when provider + route both lack timeout

// ─── 3. Config Validation ───────────────────────────────────────────────────

/**
 * Validate config. Fail-fast on schema error.
 *
 * @param {object} config
 * @throws {Error} On any validation failure
 */
function validateRouteConfig(config) {
  if (!config.providers || typeof config.providers !== 'object') {
    throw new Error('Config validation failed: missing or invalid "providers" block');
  }
  if (!config.routes || typeof config.routes !== 'object') {
    throw new Error('Config validation failed: missing or invalid "routes" block');
  }

  const providerNames = new Set(Object.keys(config.providers));

  for (const routeName of REQUIRED_ROUTES) {
    const routeCfg = config.routes[routeName];
    if (!routeCfg) {
      throw new Error(`Config validation failed: missing required route "${routeName}"`);
    }
    if (!routeCfg.primary || typeof routeCfg.primary !== 'object') {
      throw new Error(`Config validation failed: route "${routeName}" missing or invalid "primary"`);
    }
    if (!routeCfg.primary.provider || typeof routeCfg.primary.provider !== 'string') {
      throw new Error(`Config validation failed: route "${routeName}" missing "primary.provider"`);
    }
    if (!providerNames.has(routeCfg.primary.provider)) {
      throw new Error(`Config validation failed: route "${routeName}" primary provider "${routeCfg.primary.provider}" not defined in providers`);
    }

    if (routeCfg.fallback_chain) {
      if (!Array.isArray(routeCfg.fallback_chain)) {
        throw new Error(`Config validation failed: route "${routeName}" fallback_chain is not an array`);
      }
      for (const fb of routeCfg.fallback_chain) {
        if (typeof fb !== 'string') {
          throw new Error(`Config validation failed: route "${routeName}" fallback_chain contains non-string entry`);
        }
        if (!providerNames.has(fb)) {
          throw new Error(`Config validation failed: route "${routeName}" fallback provider "${fb}" not defined in providers`);
        }
      }
    }
  }
}

// ─── 4. Decision Log Append (NON-blocking) ──────────────────────────────────

/**
 * Append to decision_log.jsonl (fire-and-forget, do NOT await).
 *
 * @param {object} entry
 */
function appendDecisionLog(entry) {
  maybeRotate(DECISION_LOG_PATH, 10, 5);
  fs.appendFile(DECISION_LOG_PATH, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.warn(`[model_router] Decision log write failed: ${err.message}`);
  });
}

// ─── 5. Provider Config Merge ───────────────────────────────────────────────

/**
 * Merge provider defaults + route overrides.
 *
 * @param {string} resolvedProvider
 * @param {object} routeCfg
 * @param {object} providers
 * @returns {{ baseUrl: string, apiKey: string, timeout: number, extraBody: object }}
 */
function mergeResolvedConfig(resolvedProvider, routeCfg, providers) {
  const base = providers[resolvedProvider] || {};
  const isPrimary = routeCfg.primary && routeCfg.primary.provider === resolvedProvider;
  const overrides = isPrimary ? routeCfg.primary : {};
  const resolvedBase = resolveEnvPlaceholders(base);

  // Bug fix: route-level timeout (e.g. browser's 90s) should apply to fallback providers too
  const routeTimeout = routeCfg.primary && routeCfg.primary.timeout !== undefined
    ? routeCfg.primary.timeout
    : undefined;

  const timeout = overrides.timeout !== undefined
    ? overrides.timeout
    : routeTimeout !== undefined
      ? routeTimeout
      : resolvedBase.timeout !== undefined
        ? resolvedBase.timeout
        : DEFAULT_TIMEOUT;

  // extraBody stays provider-specific (only for primary, different providers have different formats)
  const extraBody = isPrimary && overrides.extra_body ? overrides.extra_body : {};

  return { baseUrl: resolvedBase.base_url || '', apiKey: resolvedBase.api_key || '', timeout, extraBody };
}

// ─── 6. DecisionId ──────────────────────────────────────────────────────────

/** @returns {string} UUID v4 */
function generateDecisionId() {
  try {
    return crypto.randomUUID();
  } catch (err) {
    const b = crypto.randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return [
      b.slice(0, 4).toString('hex'),
      b.slice(4, 6).toString('hex'),
      b.slice(6, 8).toString('hex'),
      b.slice(8, 10).toString('hex'),
      b.slice(10, 16).toString('hex'),
    ].join('-');
  }
}

// ─── 7. Main Router Function ────────────────────────────────────────────────

/**
 * Route to best available provider / model.
 * @param {Object} opts
 * @returns {Promise<object>}
 * @throws {Error} If route invalid, config broken, or env var missing
 */
async function routeModel({ text, route, context = {} }) {
  const startTime = Date.now();
  const decisionId = generateDecisionId();

  if (!failureRecovery || typeof failureRecovery.resolveProvider !== 'function') {
    throw new Error('failure_recovery.js not available or missing resolveProvider() export');
  }

  // Step 1: Load config (mtime-aware cache)
  const config = loadRouteModelYaml();

  // Step 2: Validate schema
  validateRouteConfig(config);

  // Step 3: Resolve route config
  const routeCfg = config.routes[route];
  if (!routeCfg) {
    throw new Error(`Unknown route: ${route}`);
  }

  // Step 4: Build provider chain (primary + fallbacks), dedup, keep order
  const chain = [];
  const seen = new Set();
  const primaryProvider = routeCfg.primary.provider;
  if (!seen.has(primaryProvider)) { chain.push(primaryProvider); seen.add(primaryProvider); }
  if (Array.isArray(routeCfg.fallback_chain)) {
    for (const fb of routeCfg.fallback_chain) {
      if (!seen.has(fb)) { chain.push(fb); seen.add(fb); }
    }
  }

  // Step 5: Resolve first healthy provider
  let resolvedProvider;
  try {
    resolvedProvider = await failureRecovery.resolveProvider(chain);
  } catch (err) {
    throw new Error(`Provider resolution failed: ${err.message}`);
  }

  const latencyMs = Date.now() - startTime;

  if (!resolvedProvider || resolvedProvider === 'none') {
    // All providers unhealthy — return 'none' with safe defaults
    appendDecisionLog({
      ts: new Date().toISOString(), route,
      suggestedModel: routeCfg.primary.model || null,
      suggestedProvider: primaryProvider,
      actualProvider: 'none',
      fallbackDepth: chain.length - 1,
      latencyMs, success: false,
      costEstimate: routeCfg.cost_weight || 0,
      schemaVersion: SCHEMA_VERSION,
      decisionId,
    });
    return { provider: 'none', model: '', baseUrl: '', apiKey: '', timeout: 0, extraBody: {}, fallbackChain: chain, decisionId };
  }

  // Step 6: Merge resolved provider config with route overrides
  const merged = mergeResolvedConfig(resolvedProvider, routeCfg, config.providers);
  const model = routeCfg.primary.provider === resolvedProvider && routeCfg.primary.model
    ? routeCfg.primary.model
    : '';
  const fallbackDepth = chain.indexOf(resolvedProvider);

  // Step 7: Append decision log (NON-blocking)
  appendDecisionLog({
    ts: new Date().toISOString(), route,
    suggestedModel: routeCfg.primary.model || null,
    suggestedProvider: primaryProvider,
    actualProvider: resolvedProvider,
    fallbackDepth: fallbackDepth >= 0 ? fallbackDepth : null,
    latencyMs, success: true,
    costEstimate: routeCfg.cost_weight || 0,
    schemaVersion: SCHEMA_VERSION,
    decisionId,
  });

  return {
    provider: resolvedProvider,
    model,
    baseUrl: merged.baseUrl,
    apiKey: merged.apiKey,
    timeout: merged.timeout,
    extraBody: merged.extraBody,
    fallbackChain: chain,
    fallbackDepth: fallbackDepth >= 0 ? fallbackDepth : null,
    decisionId,
  };
}

// ─── Module Exports ─────────────────────────────────────────────────────────

module.exports = {
  routeModel,
  loadRouteModelYaml,
  validateRouteConfig,
  resolveEnvPlaceholders,
};
