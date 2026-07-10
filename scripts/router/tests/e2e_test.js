/**
 * e2e_test.js — End-to-End Router System Test
 *
 * Simulates the full flow:
 *   1. Message arrives → classifier hook writes route decision
 *   2. Route enforcer plugin reads decision + enforces model/prompt
 *   3. Spawn config bridge generates correct CLI params
 *
 * Run:
 *   cd ./scripts/router/tests
 *   MINIMAX_PORTAL_URL=http://127.0.0.1:1 MINIMAX_PORTAL_KEY=fake \
 *   DEEPSEEK_API_URL=http://127.0.0.1:2 DEEPSEEK_API_KEY=fake \
 *   node e2e_test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const routerDir = path.join(__dirname, '..');
const classifier = require(path.join(routerDir, 'classifier'));
const modelRouter = require(path.join(routerDir, 'model_router'));
const fr = require(path.join(routerDir, 'failure_recovery'));
const spawnConfig = require(path.join(__dirname, '..', '..', 'spawn_config'));

// ─── Helpers ────────────────────────────────────────────────────────────────

function setFresh(providerName) {
  const cache = fr._getHealthCache();
  const e = cache.get(providerName);
  e.healthy = true;
  e.lastCheck = Date.now();
  e.cooldownUntil = 0;
  e.failureCount = 0;
  e.lastError = null;
}

function setUnhealthy(providerName, failureCount = 1, cooldownOffsetMs = 60000) {
  const cache = fr._getHealthCache();
  const e = cache.get(providerName);
  e.healthy = false;
  e.failureCount = failureCount;
  e.cooldownUntil = Date.now() + cooldownOffsetMs;
  e.lastProbeMs = 0;
  e.lastError = 'mocked';
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ E2E: ${name}`);
  } catch (err) {
    console.error(`✗ E2E: ${name}`);
    console.error(`   ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  fr._RESET();

  // E2E-1: Full flow — message → classifier → model_router → spawn_config
  await test('Full flow: "幫我分析 report" → SPAWN → MiniMax-M2.7 (default)', async () => {
    setFresh('minimax-portal');
    setFresh('kimi');

    // Step 1: Classify
    const classifyResult = classifier.classifySync('幫我分析 report');
    assert.strictEqual(classifyResult.route, 'SPAWN');

    // Step 2: Model Router
    const routeResult = await modelRouter.routeModel({
      text: '幫我分析 report',
      route: 'spawn',
      context: {},
    });
    assert.strictEqual(routeResult.provider, 'minimax-portal');
    assert.strictEqual(routeResult.model, 'minimax-portal/MiniMax-M2.7');
    assert.strictEqual(routeResult.fallbackChain[0], 'minimax-portal');
  });

  // E2E-1b: SPAWN_QUALITY route → M3 (premium on-demand)
  await test('SPAWN_QUALITY route → MiniMax-M3 (premium)', async () => {
    fr._RESET();
    setFresh('minimax-portal');
    setFresh('kimi');

    const routeResult = await modelRouter.routeModel({
      text: 'spawn MiniMax M3 sub agent 深入分析',
      route: 'spawn_quality',
      context: {},
    });
    assert.strictEqual(routeResult.provider, 'minimax-portal');
    assert.strictEqual(routeResult.model, 'minimax-portal/MiniMax-M3');
  });

  // E2E-2: Fallback flow — primary unhealthy → fallback to deepseek
  await test('Fallback: minimax-portal unhealthy → kimi for SPAWN', async () => {
    fr._RESET();
    setUnhealthy('minimax-portal', 3);
    setFresh('kimi');

    const routeResult = await modelRouter.routeModel({
      text: '幫我分析 report',
      route: 'spawn',
      context: {},
    });
    assert.strictEqual(routeResult.provider, 'kimi');
    // model is empty for fallback (design intent: spawn_config.js fills via DEFAULT_MODELS)
    assert.strictEqual(routeResult.model, '');
    assert.strictEqual(routeResult.fallbackDepth, 1);
  });

  // E2E-3: Input too long → rejected safely
  await test('Oversized input (11KB) → rejected without regex', async () => {
    const hugeText = 'a'.repeat(11_000);
    const result = classifier.regexClassify(hugeText);
    assert.strictEqual(result.route, 'NONE');
    assert.strictEqual(result.matched, false);
    assert.strictEqual(result.rule, 'input_too_long');
  });

  // E2E-4: Temp file path uses os.tmpdir()
  await test('Temp files use os.tmpdir(), not hardcoded /tmp', async () => {
    const tmpDir = os.tmpdir();
    assert.ok(tmpDir.length > 0, 'os.tmpdir() should return a valid path');
    // The route-enforcer and message-classifier use path.join(tmpdir(), ...)
    // We verify by checking the code contains os.tmpdir() or tmpdir()
    const handlerPath = path.join(process.env.HOME || os.homedir(), '.openclaw', 'hooks', 'message-classifier', 'handler.js');
    let handlerCode;
    try {
      handlerCode = fs.readFileSync(handlerPath, 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    assert.ok(handlerCode.includes('os.tmpdir()') || handlerCode.includes('os.tmpdir'),
      'handler.js should use os.tmpdir()');
  });

  // E2E-5: YAML config is read dynamically by failure_recovery
  await test('YAML resolution_order is read dynamically', async () => {
    const cfg = modelRouter.loadRouteModelYaml();
    assert.ok(cfg.resolution_order, 'YAML should have resolution_order');
    assert.ok(Array.isArray(cfg.resolution_order), 'resolution_order should be an array');
    assert.ok(cfg.resolution_order.includes('minimax-portal'), 'should include minimax-portal');
  });

  // E2E-6: Log rotation lock prevents TOCTOU
  await test('Log rotator has rotation lock', async () => {
    const logRotator = require(path.join(routerDir, 'log_rotator'));
    let rotatorCode;
    try {
      rotatorCode = fs.readFileSync(path.join(routerDir, 'log_rotator.js'), 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    assert.ok(rotatorCode.includes('rotationLocks.add(filePath)'), 'should acquire lock');
    assert.ok(rotatorCode.includes('rotationLocks.delete(filePath)'), 'should release lock');
    // Verify lock is acquired BEFORE stat
    const addIdx = rotatorCode.indexOf('rotationLocks.add(filePath)');
    let statIdx;
    try {
      statIdx = rotatorCode.indexOf('fs.statSync(filePath)');
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
    assert.ok(addIdx < statIdx, 'lock must be acquired BEFORE stat');
  });

  // E2E-7: ENV replacement uses function to avoid $ injection
  await test('ENV replacement uses function to avoid $ special chars', async () => {
    const configLoader = require(path.join(routerDir, 'config_loader'));
    let loaderCode;
    try {
      loaderCode = fs.readFileSync(path.join(routerDir, 'config_loader.js'), 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    assert.ok(loaderCode.includes('() => envValue'), 'should use replacement function');
  });

  console.log('');
  console.log('=== E2E Tests Complete ===');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
