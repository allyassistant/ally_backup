#!/usr/bin/env node
/**
 * spawn_config.js — Smart Router → sessions_spawn config bridge
 *
 * Wraps model_router.routeModel() to produce the exact parameters
 * for sessions_spawn. Handles fallback model defaults when the
 * router resolves a non-primary provider.
 *
 * Usage:
 *   # Default SPAWN → MiniMax-M2.7
 *   node scripts/spawn_config.js --route SPAWN --task "分析 report"
 *   # → { "model": "minimax-portal/MiniMax-M2.7", "thinking": "adaptive", "provider": "minimax-portal" }
 *
 *   # Explicit M3 premium (when Josh 講 "spawn MiniMax M3 sub agent")
 *   node scripts/spawn_config.js --route SPAWN_QUALITY --task "深入分析"
 *   # → { "model": "minimax-portal/MiniMax-M3", "thinking": "adaptive", "provider": "minimax-portal" }
 *
 * Integration workflow (from AGENTS.md):
 *   1. exec: cfg=$(node scripts/spawn_config.js --route SPAWN --task "...")
 *   2. sessions_spawn model=$(echo $cfg | jq -r .model) [thinking=$thinking] task="..."
 *
 * Provider → default model map (when router resolves fallback provider):
 *   minimax-portal → minimax-portal/MiniMax-M2.7   (reasoning enabled)
 *
 * Route-specific fallback override (for premium-on-demand routes):
 *   SPAWN_QUALITY → minimax-portal/MiniMax-M3
 */

'use strict';

const path = require('path');

const ROUTER_DIR = path.join(__dirname, 'router');
const modelRouter = require(path.join(ROUTER_DIR, 'model_router'));
const failureRecovery = require(path.join(ROUTER_DIR, 'failure_recovery'));

// ─── Default model per provider (fallback when router returns empty model) ──

const DEFAULT_MODELS = {
  'minimax-portal': 'minimax-portal/MiniMax-M2.7',
  'kimi': 'kimi/kimi-for-coding',
};

// Route-specific fallback model (when router resolves to fallback provider)
// Overrides DEFAULT_MODELS per route — keeps quality tier appropriate
const ROUTE_DEFAULT_FALLBACK = {
  'spawn_quality': 'minimax-portal/MiniMax-M3',
};

// ─── Double-spawn dedup guard ─────────────────────────────────────────────
//
// Rationale (AGENTS.md "Double-spawn 檢查"): `sessions_spawn` is sometimes
// invoked twice for the same task within seconds, producing two parallel
// sub-agents doing the same work. This guard catches the most common case:
// the main agent re-running `node scripts/spawn_config.js --task "..."` with
// the identical task text within a short window.
//
// Algorithm:
//   1. Hash (route + task text) → 16-char hex
//   2. Look for /tmp/spawn_dedup/<hash>.json
//   3. If present and < 30s old → return cached config + flag dedup:true
//   4. Otherwise → write fresh dedup record, proceed
//
// Limitations:
//   - Detects only repeat invocations of THIS script, not direct
//     `sessions_spawn model=... task=...` calls (those go through the
//     runtime, which is out of scope here).
//   - Window is fixed at 30s. Long-running spawns (>30s) will NOT be
//     deduped against a fresh invocation — that's intentional, we only
//     catch the rapid-fire case.

const DEDUP_DIR = path.join(require('os').tmpdir(), 'spawn_dedup');
const DEDUP_TTL_MS = 30_000;

function dedupKey(route, task) {
  const crypto = require('crypto');
  const normalizedTask = (task || '').trim().replace(/\s+/g, ' ');
  return crypto
    .createHash('sha256')
    .update(`${route}\x00${normalizedTask}`)
    .digest('hex')
    .slice(0, 16);
}

function readDedup(key) {
  try {
    const file = path.join(DEDUP_DIR, `${key}.json`);
    if (!require('fs').existsSync(file)) return null;
    const stat = require('fs').statSync(file);
    const age = Date.now() - stat.mtimeMs;
    if (age > DEDUP_TTL_MS) return null; // expired
    const raw = require('fs').readFileSync(file, 'utf8');
    return { entry: JSON.parse(raw), ageMs: age };
  } catch {
    return null;
  }
}

function writeDedup(key, route, task, output) {
  try {
    require('fs').mkdirSync(DEDUP_DIR, { recursive: true });
    const file = path.join(DEDUP_DIR, `${key}.json`);
    require('fs').writeFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), route, task: (task || '').slice(0, 200), output }),
      'utf8'
    );
  } catch (err) {
    // Non-fatal — dedup is best-effort
    console.warn(`[spawn_config] dedup write failed (non-fatal): ${err.message}`);
  }
}

// ─── Thinking parameter resolver ───────────────────────────────────────────

/**
 * Map router reasoning intent to the exact `thinking` value accepted by the
 * runtime provider.
 *
 * MiniMax runtime (M2.7 and M3) rejects the literal levels 'high'/'medium'/'low'
 * and only accepts 'adaptive'. Without this mapping every spawn to MiniMax
 * fails and has to be respawned manually.
 *
 * DeepSeek spawn tasks default to no reasoning because flash models are too
 * slow; route_model.yaml already encodes reasoning intent for non-spawn routes.
 */
function resolveThinking(provider, extraBody) {
  if (provider === 'minimax-portal') {
    // MiniMax only accepts 'adaptive'. If route_model.yaml requests reasoning,
    // we translate it rather than pass the unsupported level through.
    return 'adaptive';
  }

  return undefined;
}

// ─── Route → route_model.yaml key mapping ──────────────────────────────────

function normalizeRoute(route) {
  const r = String(route).toLowerCase().replace(/^ROUTER_/, '');
  if (['fdq', 'direct_answer', 'sop', 'spawn', 'spawn_quality', 'code', 'browser', 'none'].includes(r)) {
    return r;
  }
  return 'spawn'; // fallback
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // --no-dedup flag for explicit bypass (escape hatch for legitimate retries)
  const skipDedup = args.includes('--no-dedup');

  const routeIdx = args.indexOf('--route');
  const taskIdx = args.indexOf('--task');

  const rawRoute = routeIdx >= 0 ? args[routeIdx + 1] : 'SPAWN';
  const task = taskIdx >= 0 ? args[taskIdx + 1] : '';

  const route = normalizeRoute(rawRoute);

  // Double-spawn guard: short-circuit if same route+task was just resolved.
  if (!skipDedup) {
    const key = dedupKey(route, task);
    const existing = readDedup(key);
    if (existing) {
      const cached = { ...existing.entry.output, dedup: true, dedupAgeMs: existing.ageMs, dedupKey: key };
      console.warn(
        `[spawn_config] DOUBLE-SPAWN GUARD: route=${route} task="${(task || '').slice(0, 60)}" ` +
        `matched recent invocation (age=${Math.round(existing.ageMs / 1000)}s, key=${key}). ` +
        `Returning cached config. Pass --no-dedup to override.`
      );
      console.log(JSON.stringify(cached));
      return;
    }
  }

  /** @type {import('./router/model_router').RouteModelResult} */
  let cfg;
  try {
    cfg = await modelRouter.routeModel({ text: task || rawRoute, route, context: {} });
  } catch (err) {
    console.error(`[spawn_config] routeModel() error: ${err.message}`);
    // Fallback: safe defaults
    cfg = { provider: 'minimax-portal', model: '', extraBody: {}, fallbackChain: [], decisionId: 'fallback' };
  }

  // Model: use resolved model, or route-specific fallback, or provider default
  const model = cfg.model || ROUTE_DEFAULT_FALLBACK[route] || DEFAULT_MODELS[cfg.provider] || 'minimax-portal/MiniMax-M2.7';

  // Thinking: map router reasoning intent to runtime-accepted value
  const thinking = resolveThinking(cfg.provider, cfg.extraBody);

  // Build retry chain for 429 fallback. Filter out:
  //   - current resolved provider (already tried)
  //   - 'none' (terminal, not a real provider)
  // Cap at 2 candidates.
  const retryChain = (cfg.fallbackChain || [])
    .filter(p => p !== cfg.provider && p !== 'none')
    .slice(0, 2);

  const output = {
    model,
    thinking,
    provider: cfg.provider,
    decisionId: cfg.decisionId || 'unknown',
    // retryChain: ordered list of fallback providers to try on HTTP 429.
    // Call recordRateLimit(provider) after observing 429 so the next
    // spawn_config invocation avoids the failing provider.
    retryChain,
    // fallbackChain: full ordered chain including current provider.
    // Exposed for debugging and callers that want more than 2 retries.
    fallbackChain: cfg.fallbackChain || [],
  };

  // Persist dedup record (best-effort) for subsequent invocations.
  if (!skipDedup) {
    const key = dedupKey(route, task);
    // TOCTOU guard: if another process wrote the same key while we were
    // resolving the model, log a warning — this indicates a race condition.
    const existing = readDedup(key);
    if (existing) {
      console.warn(
        `[spawn_config] TOCTOU RACE DETECTED: another process wrote dedup key ${key} ` +
        `while this invocation was in progress (age=${Math.round(existing.ageMs / 1000)}s). ` +
        `This may result in a double spawn.`
      );
    }
    writeDedup(key, route, task, output);
  }

  console.log(JSON.stringify(output));
}

if (require.main === module) {
  main().catch(err => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
}

module.exports = {
  resolveThinking,
  DEFAULT_MODELS,
  ROUTE_DEFAULT_FALLBACK,
  normalizeRoute,
  // Re-export recordRateLimit so callers can mark a provider as 429'd
  // without importing failure_recovery directly.
  recordRateLimit: failureRecovery.recordRateLimit,
  // Exposed for tests / external callers
  dedupKey,
  readDedup,
  writeDedup,
  DEDUP_TTL_MS,
};
