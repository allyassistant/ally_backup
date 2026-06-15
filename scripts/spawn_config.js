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
 *   deepseek       → deepseek-v4-flash             (reasoning enabled)
 *
 * Route-specific fallback override (for premium-on-demand routes):
 *   SPAWN_QUALITY → deepseek-v4-pro  (M3 fallback maintains quality)
 */

'use strict';

const path = require('path');

const ROUTER_DIR = path.join(__dirname, 'router');
const modelRouter = require(path.join(ROUTER_DIR, 'model_router'));

// ─── Default model per provider (fallback when router returns empty model) ──

const DEFAULT_MODELS = {
  'minimax-portal': 'minimax-portal/MiniMax-M2.7',
  'deepseek': 'deepseek-v4-flash',
};

// Route-specific fallback model (when router resolves to fallback provider)
// Overrides DEFAULT_MODELS per route — keeps quality tier appropriate
const ROUTE_DEFAULT_FALLBACK = {
  'spawn_quality': 'deepseek-v4-pro',   // M3 fallback → pro (maintain premium quality)
};

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
  if (provider === 'deepseek') {
    return undefined;
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

  const routeIdx = args.indexOf('--route');
  const taskIdx = args.indexOf('--task');

  const rawRoute = routeIdx >= 0 ? args[routeIdx + 1] : 'SPAWN';
  const task = taskIdx >= 0 ? args[taskIdx + 1] : '';

  const route = normalizeRoute(rawRoute);

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
  const model = cfg.model || ROUTE_DEFAULT_FALLBACK[route] || DEFAULT_MODELS[cfg.provider] || 'deepseek-v4-flash';

  // Thinking: map router reasoning intent to runtime-accepted value
  const thinking = resolveThinking(cfg.provider, cfg.extraBody);

  const output = {
    model,
    thinking,
    provider: cfg.provider,
    decisionId: cfg.decisionId || 'unknown',
  };

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
};
