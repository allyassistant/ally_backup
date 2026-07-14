/**
 * failure_recovery.js — Phase 1 Fusion Provider Health & Fallback Resolution
 * Unblocks model_router.js routeModel() runtime call.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Shared config loader (replaces duplicated logic in model_router.js) ─────

const { loadRouteModelYaml, resolveEnvPlaceholders } = require('./config_loader');
const { maybeRotate } = require('./log_rotator');

const DECISION_LOG_PATH = path.join(__dirname, 'decision_log.jsonl');

// Defaults (overridden by YAML health_check settings)
const HEALTH_CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;
const COOLDOWN_MS = 60_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_PROBE_MS = 30_000;
const DEFAULT_PROBE_CONCURRENCY = 3;
const DEFAULT_RESOLUTION_ORDER = ['minimax-portal', 'kimi', 'none'];

// ─── State ──────────────────────────────────────────────────────────────────

const healthCache = new Map();
const inFlightProbes = new Map();

function getResolutionOrder() {
  try {
    const cfg = loadRouteModelYaml();
    if (cfg.resolution_order && Array.isArray(cfg.resolution_order)) {
      return cfg.resolution_order;
    }
  } catch (err) {
    console.warn('[failure_recovery] Failed to read resolution_order from YAML, using default:', err.message);
  }
  return DEFAULT_RESOLUTION_ORDER;
}

function getHealthCheckSettings() {
  try {
    const cfg = loadRouteModelYaml();
    const hc = cfg.health_check || {};
    return {
      failureThreshold: hc.failure_threshold !== undefined ? hc.failure_threshold : DEFAULT_FAILURE_THRESHOLD,
      recoveryProbeMs: hc.recovery_probe_interval !== undefined ? hc.recovery_probe_interval * 1000 : DEFAULT_RECOVERY_PROBE_MS,
      probeConcurrency: hc.max_concurrent_probes !== undefined ? hc.max_concurrent_probes : DEFAULT_PROBE_CONCURRENCY,
    };
  } catch (err) {
    console.warn('[failure_recovery] Failed to read health_check settings from YAML, using defaults:', err.message);
    return {
      failureThreshold: DEFAULT_FAILURE_THRESHOLD,
      recoveryProbeMs: DEFAULT_RECOVERY_PROBE_MS,
      probeConcurrency: DEFAULT_PROBE_CONCURRENCY,
    };
  }
}

function initHealthCache() {
  healthCache.clear();
  for (const name of getResolutionOrder()) {
    healthCache.set(name, {
      healthy: true, lastCheck: 0, cooldownUntil: 0,
      failureCount: 0, lastError: null, lastProbeMs: 0,
    });
  }
}
initHealthCache();

// ─── Config ─────────────────────────────────────────────────────────────────

function loadConfig() {
  // Use shared loader (mtime-aware cache) — do NOT resolve env placeholders here.
  // Each consumer resolves only the fields it needs, so a missing env var for one
  // provider doesn't break requests that don't use that provider.
  return loadRouteModelYaml();
}

function appendDecisionLog(entry) {
  maybeRotate(DECISION_LOG_PATH, 10, 5);
  fs.appendFile(DECISION_LOG_PATH, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.warn(`[failure_recovery] Decision log write failed: ${err.message}`);
  });
}

// ─── Probe ──────────────────────────────────────────────────────────────────

async function probeProvider(providerConfig) {
  const { type } = providerConfig;
  if (type === 'noop') return true;

  let resolvedBaseUrl, resolvedKey;
  try {
    resolvedBaseUrl = resolveEnvPlaceholders(providerConfig.base_url || '');
    resolvedKey = resolveEnvPlaceholders(providerConfig.api_key || '');
  }
  catch (err) {
    console.warn(`[failure_recovery] ENV missing for provider probe: ${err.message}`);
    return false;
  }

  const url = `${resolvedBaseUrl}/models`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const probeStart = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - probeStart;

    // 200 = healthy, 401 = key accepted (server alive), 404 = endpoint not found but server alive (Anthropic-style APIs)
    const isReachable = response.status === 200 || response.status === 401 || response.status === 404;
    if (!isReachable) {
      console.warn(`[failure_recovery] Probe HTTP ${response.status} for ${resolvedBaseUrl}`);
      return false;
    }

    // Deep check: for 200 responses, verify the body looks like a valid models list
    if (response.status === 200) {
      try {
        const body = await response.json();
        const models = body.data || body.models || null;
        const isList = body.object === 'list';
        if (!models && !isList) {
          // Some APIs return a different structure; don't fail probe if we can't verify
          console.warn(`[failure_recovery] Unexpected /models response structure from ${resolvedBaseUrl}`);
        }
      } catch (parseErr) {
        console.warn(`[failure_recovery] Failed to parse /models JSON from ${resolvedBaseUrl}: ${parseErr.message}`);
        // Don't fail probe for parse errors — server is reachable
      }
    }

    // Latency degradation warning (but still healthy)
    if (latencyMs > PROBE_TIMEOUT_MS * 0.8) {
      console.warn(`[failure_recovery] Provider ${resolvedBaseUrl} probe latency high: ${latencyMs}ms`);
    }

    return true;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[failure_recovery] Probe failed for ${resolvedBaseUrl}: ${err.message}`);
    return false;
  }
}

// ─── Health API ─────────────────────────────────────────────────────────────

function isProviderHealthy(providerName) {
  if (!healthCache.has(providerName)) {
    return { healthy: false, lastCheck: 0, cooldownUntil: 0, failureCount: 0 };
  }
  const entry = healthCache.get(providerName);
  const now = Date.now();
  if (entry.cooldownUntil > now) {
    return {
      healthy: false, lastCheck: entry.lastCheck,
      cooldownUntil: entry.cooldownUntil, failureCount: entry.failureCount,
    };
  }
  return {
    healthy: entry.healthy, lastCheck: entry.lastCheck,
    cooldownUntil: entry.cooldownUntil, failureCount: entry.failureCount,
  };
}

function markProviderFailure(providerName, error) {
  if (!healthCache.has(providerName)) throw new Error(`unknown provider: ${providerName}`);
  const entry = healthCache.get(providerName);
  const now = Date.now();
  const settings = getHealthCheckSettings();
  entry.failureCount += 1;
  entry.lastError = error ? (error.message || String(error)) : null;
  entry.lastCheck = now;

  // Only mark unhealthy + cooldown after failureThreshold consecutive failures
  // This tolerates transient network blips (1-2 failures) without triggering full cooldown
  if (entry.failureCount >= settings.failureThreshold) {
    entry.cooldownUntil = now + COOLDOWN_MS;
    entry.healthy = false;
  }

  appendDecisionLog({
    ts: new Date().toISOString(), event: 'provider_failure',
    provider: providerName, failureCount: entry.failureCount,
    cooldownUntil: entry.cooldownUntil, lastError: entry.lastError,
  });
}

function markProviderSuccess(providerName) {
  if (!healthCache.has(providerName)) throw new Error(`unknown provider: ${providerName}`);
  const entry = healthCache.get(providerName);
  entry.healthy = true;
  entry.failureCount = 0;
  entry.cooldownUntil = 0;
  entry.lastError = null;
  entry.lastCheck = Date.now();
  appendDecisionLog({
    ts: new Date().toISOString(), event: 'provider_recovery', provider: providerName,
  });
}

// ─── Core Resolution ────────────────────────────────────────────────────────

async function resolveProvider(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error('chain is empty');
  }

  const config = loadConfig();
  const providers = config.providers || {};
  const settings = getHealthCheckSettings();

  for (const providerName of chain) {
    if (!healthCache.has(providerName)) {
      console.warn(`[failure_recovery] Unknown provider in chain: ${providerName}, skipping`);
      continue;
    }
    if (providerName === 'none') return 'none';

    const health = isProviderHealthy(providerName);
    if (health.healthy) {
      const entry = healthCache.get(providerName);
      const now = Date.now();
      if (now - entry.lastCheck > HEALTH_CACHE_TTL_MS) {
        const providerCfg = providers[providerName];
        if (!providerCfg) {
          console.warn(`[failure_recovery] Provider config missing for ${providerName}, skipping`);
          continue;
        }
        const ok = await _executeProbe(providerName, providerCfg);
        entry.lastProbeMs = Date.now(); // Track probe completion time
        if (ok) { markProviderSuccess(providerName); return providerName; }
        markProviderFailure(providerName, 'probe failed');
        continue;
      }
      return providerName;
    }

    const entry = healthCache.get(providerName);
    const now = Date.now();
    if (entry.cooldownUntil <= now && now - entry.lastProbeMs > settings.recoveryProbeMs) {
      const providerCfg = providers[providerName];
      if (!providerCfg) {
        console.warn(`[failure_recovery] Provider config missing for ${providerName}, skipping`);
        continue;
      }
      const ok = await _executeProbe(providerName, providerCfg);
      entry.lastProbeMs = now;
      if (ok) { markProviderSuccess(providerName); return providerName; }
      markProviderFailure(providerName, 'recovery probe failed');
      continue;
    }
  }

  appendDecisionLog({ ts: new Date().toISOString(), event: 'all_unhealthy', chain });
  return 'none';
}

async function _executeProbe(providerName, providerCfg) {
  if (inFlightProbes.has(providerName)) return inFlightProbes.get(providerName);
  const promise = (async () => {
    try { return await probeProvider(providerCfg); }
    catch (err) {
      console.warn(`[failure_recovery] Probe error for ${providerName}: ${err.message}`);
      return false;
    } finally { inFlightProbes.delete(providerName); }
  })();
  inFlightProbes.set(providerName, promise);
  return promise;
}

// ─── Background Loop ────────────────────────────────────────────────────────

async function runHealthCheckLoop(intervalMs = 60_000) {
  async function tick() {
    const config = loadConfig();
    const providers = config.providers || {};
    const settings = getHealthCheckSettings();
    const resolutionOrder = getResolutionOrder();

    const jobs = [];
    for (const providerName of resolutionOrder) {
      if (providerName === 'none') continue;
      const providerCfg = providers[providerName];
      if (!providerCfg) continue;
      jobs.push(async () => {
        const ok = await _executeProbe(providerName, providerCfg);
        if (ok) markProviderSuccess(providerName);
        else markProviderFailure(providerName, 'background probe failed');
      });
    }

    const queue = [...jobs];
    const workers = [];
    for (let i = 0; i < settings.probeConcurrency; i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const job = queue.shift();
          try { await job(); }
          catch (err) { console.warn(`[failure_recovery] Background job error: ${err.message}`); }
        }
      })());
    }
    await Promise.all(workers);
  }

  await tick();
  const handle = setInterval(() => {
    tick().catch((err) => console.warn(`[failure_recovery] Loop error: ${err.message}`));
  }, intervalMs);
  return handle;
}

// ─── Reset ──────────────────────────────────────────────────────────────────

function resetAll() {
  initHealthCache();
  inFlightProbes.clear();
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  resolveProvider,
  isProviderHealthy,
  markProviderFailure,
  markProviderSuccess,
  runHealthCheckLoop,
  _probeProvider: probeProvider,
  _loadConfig: loadConfig,
  _getHealthCache: () => healthCache,
  _RESET: resetAll,
};
