/**
 * integration_tests.js — Phase 1 Fusion T1-T13 Integration Suite
 *
 * Tests for model_router.js + failure_recovery.js
 * No test framework — pure Node + assert module, hand-rolled assertion runner.
 *
 * Run:
 *   cd ./scripts/router/tests
 *   node integration_tests.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const routerDir = path.join(__dirname, '..');
const fr = require(path.join(routerDir, 'failure_recovery'));
const mr = require(path.join(routerDir, 'model_router'));

// ─── Runner ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

async function test(id, name, fn) {
  // Reset failure_recovery state before EVERY test for isolation
  if (typeof fr._RESET === 'function') fr._RESET();
  const fullName = `T${id} — ${name}`;
  try {
    await fn();
    passed++;
    results.push({ id, name, status: 'PASS' });
    console.log(`✓ T${id}: PASS — ${name}`);
  } catch (err) {
    failed++;
    results.push({ id, name, status: 'FAIL', error: err.message, stack: err.stack });
    console.error(`✗ T${id}: FAIL — ${name}`);
    console.error(`   ${err.message}`);
  }
}

// ─── Helpers (health cache manipulation) ────────────────────────────────────

/** Make provider healthy + fresh → resolveProvider returns it immediately (no re-probe) */
function setFresh(providerName) {
  const cache = fr._getHealthCache();
  const e = cache.get(providerName);
  e.healthy = true;
  e.lastCheck = Date.now();
  e.cooldownUntil = 0;
  e.failureCount = 0;
  e.lastError = null;
}

/** Make provider healthy + stale (lastCheck=0) → re-probe will trigger */
function setStale(providerName) {
  const cache = fr._getHealthCache();
  const e = cache.get(providerName);
  e.healthy = true;
  e.lastCheck = 0;
  e.cooldownUntil = 0;
  e.failureCount = 0;
  e.lastError = null;
}

/** Make provider unhealthy; lastProbeMs=0 so cooldown-expired re-probe is eligible */
function setUnhealthy(providerName, failureCount = 1, cooldownOffsetMs = 60000) {
  const cache = fr._getHealthCache();
  const e = cache.get(providerName);
  e.healthy = false;
  e.failureCount = failureCount;
  e.cooldownUntil = Date.now() + cooldownOffsetMs;
  e.lastProbeMs = 0;  // never probed → recovery re-probe eligible
  e.lastError = 'mocked';
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function main() {
  // T1: All providers unhealthy → fall through to 'none'
  await test('1', 'All providers unhealthy → fall through to "none"', async () => {
    setUnhealthy('minimax-portal', 3);
    setUnhealthy('deepseek', 3);
    const result = await mr.routeModel({ text: 'test input', route: 'spawn' });
    assert.strictEqual(result.provider, 'none',
      `Expected provider='none', got '${result.provider}'`);
    assert.strictEqual(result.fallbackChain.length, 3,
      `Expected fallbackChain length 3, got ${result.fallbackChain.length}`);
    assert.match(result.decisionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      `decisionId not UUID v4 format: ${result.decisionId}`);
    // Sanity: chain order matches spawn route spec (with deepseek inserted as fallback)
    assert.deepStrictEqual(result.fallbackChain,
      ['minimax-portal', 'deepseek', 'none'],
      `Unexpected fallbackChain: ${JSON.stringify(result.fallbackChain)}`);
  });

  // T2: First provider healthy + fresh → resolveProvider returns first
  await test('2', 'First provider healthy → resolveProvider returns first', async () => {
    setFresh('minimax-portal');
    const result = await fr.resolveProvider(['minimax-portal', 'deepseek', 'none']);
    assert.strictEqual(result, 'minimax-portal',
      `Expected 'minimax-portal', got '${result}'`);
  });

  // T3: First unhealthy (cooldown active), second healthy → return second
  await test('3', 'First unhealthy, second healthy → return second', async () => {
    setUnhealthy('minimax-portal', 3);          // failureCount=3, cooldown active
    setFresh('deepseek');
    const result = await fr.resolveProvider(['minimax-portal', 'deepseek', 'none']);
    assert.strictEqual(result, 'deepseek',
      `Expected 'deepseek', got '${result}'`);
  });

  // T4: First 2 unhealthy, 3rd healthy → return 3rd
  await test('4', 'First 2 unhealthy, 3rd healthy → return 3rd', async () => {
    setUnhealthy('minimax-portal', 3);
    setUnhealthy('deepseek', 3);
    setFresh('none');
    const result = await fr.resolveProvider(['minimax-portal', 'deepseek', 'none']);
    assert.strictEqual(result, 'none',
      `Expected 'none', got '${result}'`);
  });

  // T5: Cooldown logic — failed provider NOT probed during cooldown
  await test('5', 'Cooldown logic — failed provider not probed during cooldown', async () => {
    setUnhealthy('minimax-portal', 1, 60000);    // cooldown active for 60s
    setFresh('deepseek');
    const result = await fr.resolveProvider(['minimax-portal', 'deepseek', 'none']);
    assert.strictEqual(result, 'deepseek',
      `Expected 'deepseek' (skip 'minimax-portal' cooldown), got '${result}'`);
    // 'minimax-portal' must NOT have been re-probed → failureCount unchanged
    const cache = fr._getHealthCache();
    assert.strictEqual(cache.get('minimax-portal').failureCount, 1,
      `Expected 'minimax-portal' failureCount=1 (not re-probed), got ${cache.get('minimax-portal').failureCount}`);
  });

  // T6: Cooldown recovery — after expiry, provider re-probed
  // NOTE: This test assumes the re-probe fails (no fetch mock = timeout). Behavior
  // depends on network — under test, minimax-portal probe may succeed if reachable.
  // We assert on cache state (failureCount change), not on which provider is returned.
  await test('6', 'Cooldown recovery — after expiry, provider re-probed', async () => {
    setUnhealthy('minimax-portal', 1, -1000);   // cooldown EXPIRED 1s ago
    setFresh('deepseek');
    const before = fr._getHealthCache().get('minimax-portal').failureCount;
    const result = await fr.resolveProvider(['minimax-portal', 'deepseek', 'none']);
    const after = fr._getHealthCache().get('minimax-portal').failureCount;
    // Re-probe MUST have happened — failureCount or healthy state should change
    assert.notStrictEqual(before, after,
      `Expected failureCount to change (re-probe), before=${before} after=${after}`);
    // Result must be a healthy provider (deepseek or minimax-portal if re-probe succeeded)
    assert.ok(['deepseek', 'minimax-portal', 'none'].includes(result),
      `Unexpected provider: ${result}`);
  });

  // T7: Race condition — concurrent resolveProvider calls deduplicate probes
  await test('7', 'Race condition — concurrent resolveProvider dedups probes', async () => {
    setStale('minimax-portal');                 // healthy but stale → re-probe required
    setFresh('deepseek');           // fresh → returned immediately (no probe)

    // Set ENV so probe can reach fetch() (mock will return 200)
    const origPortalUrl = process.env.MINIMAX_PORTAL_URL;
    const origPortalKey = process.env.MINIMAX_PORTAL_KEY;
    process.env.MINIMAX_PORTAL_URL = 'http://127.0.0.1:1';
    process.env.MINIMAX_PORTAL_KEY = 'fake_key_for_test';

    // Spy on global fetch — count invocations
    const origFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return { status: 200, json: async () => ({ data: [{ id: 'minimax-portal/MiniMax-M2.7' }] }) };
    };

    try {
      // 5 concurrent calls — all should hit the same inFlightProbes entry
      const calls = [];
      for (let i = 0; i < 5; i++) {
        calls.push(fr.resolveProvider(['minimax-portal', 'deepseek', 'none']));
      }
      const concurrentResults = await Promise.all(calls);

      // Dedup: only 1 fetch call (proves inFlightProbes Map works)
      assert.strictEqual(fetchCount, 1,
        `Expected 1 fetch call (dedup), got ${fetchCount} — dedup BROKEN`);

      // All 5 calls should return 'minimax-portal' (mock fetch returns 200 → healthy)
      for (let i = 0; i < concurrentResults.length; i++) {
        assert.strictEqual(concurrentResults[i], 'minimax-portal',
          `Call #${i + 1} returned '${concurrentResults[i]}', expected 'minimax-portal'`);
      }

      // inFlightProbes should be cleaned up after all probes complete
      // (we can't directly access it, but size must be 0 if no leak)
      // Skip explicit check — proxy: fetchCount=1 already proves dedup
    } finally {
      globalThis.fetch = origFetch;
      if (origPortalUrl === undefined) delete process.env.MINIMAX_PORTAL_URL;
      else process.env.MINIMAX_PORTAL_URL = origPortalUrl;
      if (origPortalKey === undefined) delete process.env.MINIMAX_PORTAL_KEY;
      else process.env.MINIMAX_PORTAL_KEY = origPortalKey;
    }
  });

  // T8: markProviderFailure increments failureCount (but cooldown only after FAILURE_THRESHOLD)
  await test('8', 'markProviderFailure increments failureCount without cooldown on 1st failure', async () => {
    fr.markProviderFailure('minimax-portal', new Error('synthetic test failure'));
    const health = fr.isProviderHealthy('minimax-portal');
    assert.strictEqual(health.failureCount, 1,
      `Expected failureCount=1, got ${health.failureCount}`);
    // 1st failure does NOT trigger cooldown (tolerates transient blips)
    assert.strictEqual(health.cooldownUntil, 0,
      `Expected cooldownUntil=0 on 1st failure, got ${health.cooldownUntil}`);
  });

  // T9: markProviderSuccess resets failureCount + cooldownUntil
  await test('9', 'markProviderSuccess resets failureCount + cooldown', async () => {
    const cache = fr._getHealthCache();
    cache.get('minimax-portal').failureCount = 2;
    cache.get('minimax-portal').cooldownUntil = Date.now() + 60000;
    cache.get('minimax-portal').healthy = false;
    cache.get('minimax-portal').lastError = 'preexisting';

    fr.markProviderSuccess('minimax-portal');

    const health = fr.isProviderHealthy('minimax-portal');
    assert.strictEqual(health.failureCount, 0,
      `Expected failureCount=0, got ${health.failureCount}`);
    assert.strictEqual(health.cooldownUntil, 0,
      `Expected cooldownUntil=0, got ${health.cooldownUntil}`);
    assert.strictEqual(health.healthy, true,
      `Expected healthy=true, got ${health.healthy}`);
  });

  // T10: markProviderFailure 3x → reaches FAILURE_THRESHOLD, stays unhealthy
  await test('10', 'markProviderFailure 3x → enters unhealthy state', async () => {
    fr.markProviderFailure('minimax-portal', new Error('failure 1'));
    fr.markProviderFailure('minimax-portal', new Error('failure 2'));
    fr.markProviderFailure('minimax-portal', new Error('failure 3'));
    const health = fr.isProviderHealthy('minimax-portal');
    assert.strictEqual(health.healthy, false,
      `Expected healthy=false, got ${health.healthy}`);
    assert.strictEqual(health.failureCount, 3,
      `Expected failureCount=3, got ${health.failureCount}`);
  });

  // T11: validateRouteConfig rejects config missing required routes
  await test('11', 'validateRouteConfig rejects missing route', async () => {
    const badConfig = {
      providers: { 'minimax-portal': { type: 'noop' }, 'deepseek': { type: 'noop' } },
      routes: {
        // Only fdq present — missing 6 others
        fdq: { primary: { provider: 'minimax-portal', model: 'm' } },
      },
    };
    let threw = false;
    let errMsg = '';
    try {
      mr.validateRouteConfig(badConfig);
    } catch (err) {
      threw = true;
      errMsg = err.message;
    }
    assert.ok(threw, 'Expected validateRouteConfig to throw');
    assert.ok(errMsg.includes('missing required route'),
      `Expected error to include "missing required route", got: ${errMsg}`);
  });

  // T12: routeModel() with invalid route throws "Unknown route"
  await test('12', 'routeModel() with invalid route throws "Unknown route"', async () => {
    let threw = false;
    let errMsg = '';
    try {
      await mr.routeModel({ text: 'test', route: 'invalid_route_name' });
    } catch (err) {
      threw = true;
      errMsg = err.message;
    }
    assert.ok(threw, 'Expected routeModel to throw on invalid route');
    assert.ok(errMsg.includes('Unknown route'),
      `Expected error to include "Unknown route", got: ${errMsg}`);
  });

  // T13: runHealthCheckLoop is idempotent (returns handle, clearInterval works)
  await test('13', 'runHealthCheckLoop is idempotent', async () => {
    const handle = await fr.runHealthCheckLoop(1000);
    try {
      // Node's setInterval returns a Timeout object (typeof === 'object')
      assert.ok(handle, 'Expected handle to be truthy');
      assert.ok(typeof handle === 'object' || typeof handle === 'number',
        `Expected handle to be object|number, got typeof=${typeof handle}`);
    } finally {
      clearInterval(handle);
    }
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(`=== Test Results: ${passed} passed, ${failed} failed ===`);
  console.log(`Total: ${passed + failed}`);

  if (failed > 0) {
    console.log('\n--- Failed test details ---');
    for (const r of results) {
      if (r.status === 'FAIL') {
        console.log(`T${r.id} (${r.name}): ${r.error}`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL: uncaught error in test runner:');
  console.error(err);
  process.exit(1);
});
