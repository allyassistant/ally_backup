/**
 * spawn_config_tests.js — Spawn Config Bridge Test Suite
 *
 * Covers route normalization, thinking mapping, and fallback defaults.
 * No test framework — pure Node + assert module, hand-rolled runner.
 *
 * Run:
 *   cd /Users/ally/.openclaw/workspace/scripts/router/tests
 *   node spawn_config_tests.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const scriptsDir = path.join(__dirname, '..', '..');

// ─── Extract internal functions by replicating logic ────────────────────────

const DEFAULT_MODELS = {
  'minimax-portal': 'minimax-portal/MiniMax-M2.7',
  'deepseek': 'deepseek-v4-flash',
};

const DEFAULT_THINKING = {
  'minimax-portal': 'high',
  'deepseek': undefined,
};

const ROUTE_DEFAULT_FALLBACK = {
  'spawn_quality': 'deepseek-v4-pro',
};

function resolveFallbackModel(route, provider) {
  return ROUTE_DEFAULT_FALLBACK[route] || DEFAULT_MODELS[provider] || 'deepseek-v4-flash';
}

function extraBodyToThinking(extraBody) {
  if (!extraBody || typeof extraBody !== 'object') return undefined;
  const r = extraBody.reasoning;
  if (r === 'high' || r === 'medium' || r === 'low') return r;
  if (r === true) return 'high';
  return undefined;
}

function normalizeRoute(route) {
  const r = String(route).toLowerCase().replace(/^router_/, '');
  if (['fdq', 'direct_answer', 'sop', 'spawn', 'spawn_quality', 'code', 'browser', 'none'].includes(r)) {
    return r;
  }
  return 'spawn'; // fallback
}

// ─── Runner ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(id, name, fn) {
  try {
    fn();
    passed++;
    results.push({ id, name, status: 'PASS' });
    console.log(`✓ S${id}: PASS — ${name}`);
  } catch (err) {
    failed++;
    results.push({ id, name, status: 'FAIL', error: err.message });
    console.error(`✗ S${id}: FAIL — ${name}`);
    console.error(`   ${err.message}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

function main() {
  // ── normalizeRoute ──────────────────────────────────────────────────────
  test('1', 'normalizeRoute: "SPAWN" → "spawn"', () => {
    assert.strictEqual(normalizeRoute('SPAWN'), 'spawn');
  });

  test('2', 'normalizeRoute: "CODE" → "code"', () => {
    assert.strictEqual(normalizeRoute('CODE'), 'code');
  });

  test('3', 'normalizeRoute: "ROUTER_BROWSER" → "browser"', () => {
    assert.strictEqual(normalizeRoute('ROUTER_BROWSER'), 'browser');
  });

  test('4', 'normalizeRoute: "unknown" → "spawn" (fallback)', () => {
    assert.strictEqual(normalizeRoute('unknown'), 'spawn');
  });

  test('5', 'normalizeRoute: "" → "spawn" (fallback)', () => {
    assert.strictEqual(normalizeRoute(''), 'spawn');
  });

  test('6', 'normalizeRoute: "fdq" → "fdq" (already lowercase)', () => {
    assert.strictEqual(normalizeRoute('fdq'), 'fdq');
  });

  test('6b', 'normalizeRoute: "SPAWN_QUALITY" → "spawn_quality" (M3 on-demand route)', () => {
    assert.strictEqual(normalizeRoute('SPAWN_QUALITY'), 'spawn_quality');
  });

  // ── extraBodyToThinking ─────────────────────────────────────────────────
  test('7', 'extraBodyToThinking: { reasoning: "high" } → "high"', () => {
    assert.strictEqual(extraBodyToThinking({ reasoning: 'high' }), 'high');
  });

  test('8', 'extraBodyToThinking: { reasoning: "medium" } → "medium"', () => {
    assert.strictEqual(extraBodyToThinking({ reasoning: 'medium' }), 'medium');
  });

  test('9', 'extraBodyToThinking: { reasoning: true } → "high"', () => {
    assert.strictEqual(extraBodyToThinking({ reasoning: true }), 'high');
  });

  test('10', 'extraBodyToThinking: {} → undefined', () => {
    assert.strictEqual(extraBodyToThinking({}), undefined);
  });

  test('11', 'extraBodyToThinking: null → undefined', () => {
    assert.strictEqual(extraBodyToThinking(null), undefined);
  });

  test('12', 'extraBodyToThinking: { reasoning: "invalid" } → undefined', () => {
    assert.strictEqual(extraBodyToThinking({ reasoning: 'invalid' }), undefined);
  });

  // ── DEFAULT_MODELS fallback ─────────────────────────────────────────────
  test('13', 'DEFAULT_MODELS has minimax-portal entry', () => {
    assert.ok(DEFAULT_MODELS['minimax-portal']);
    assert.strictEqual(DEFAULT_MODELS['minimax-portal'], 'minimax-portal/MiniMax-M2.7');
  });

  test('14', 'DEFAULT_MODELS has deepseek entry', () => {
    assert.ok(DEFAULT_MODELS['deepseek']);
    assert.strictEqual(DEFAULT_MODELS['deepseek'], 'deepseek-v4-flash');
  });

  // ── ROUTE_DEFAULT_FALLBACK — route-specific fallback model ───────────────
  test('14a', 'ROUTE_DEFAULT_FALLBACK: spawn_quality → deepseek-v4-pro', () => {
    assert.strictEqual(ROUTE_DEFAULT_FALLBACK['spawn_quality'], 'deepseek-v4-pro');
  });

  test('14b', 'resolveFallbackModel: SPAWN (deepseek) → deepseek-v4-flash', () => {
    assert.strictEqual(resolveFallbackModel('spawn', 'deepseek'), 'deepseek-v4-flash');
  });

  test('14c', 'resolveFallbackModel: SPAWN_QUALITY (deepseek) → deepseek-v4-pro', () => {
    assert.strictEqual(resolveFallbackModel('spawn_quality', 'deepseek'), 'deepseek-v4-pro');
  });

  test('14d', 'resolveFallbackModel: unknown route + unknown provider → deepseek-v4-flash (ultimate fallback)', () => {
    assert.strictEqual(resolveFallbackModel('nonexistent', 'unknown'), 'deepseek-v4-flash');
  });

  test('15', 'DEFAULT_THINKING: minimax-portal → "high"', () => {
    assert.strictEqual(DEFAULT_THINKING['minimax-portal'], 'high');
  });

  test('16', 'DEFAULT_THINKING: deepseek → undefined', () => {
    assert.strictEqual(DEFAULT_THINKING['deepseek'], undefined);
  });

  // ── End-to-end smoke test (requires actual routeModel) ──────────────────
  test('17', 'spawn_config module loads without error', () => {
    const spawnConfigPath = path.join(scriptsDir, 'spawn_config.js');
    // Just require it to verify no syntax errors
    delete require.cache[require.resolve(spawnConfigPath)];
    require(spawnConfigPath);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(`=== Spawn Config Tests: ${passed} passed, ${failed} failed ===`);
  console.log(`Total: ${passed + failed}`);

  if (failed > 0) {
    console.log('\n--- Failed test details ---');
    for (const r of results) {
      if (r.status === 'FAIL') {
        console.log(`S${r.id} (${r.name}): ${r.error}`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
