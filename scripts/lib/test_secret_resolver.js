#!/usr/bin/env node
/**
 * Test suite for scripts/lib/secret_resolver.js
 *
 * Tests:
 * 1. resolveSecret on plaintext (legacy) string
 * 2. resolveSecret on SecretRef env source
 * 3. resolveSecret on malformed SecretRef
 * 4. resolveSecret on missing path
 * 5. resolveSecret on file source
 * 6. getDiscordToken convenience wrapper
 * 7. getProviderApiKey convenience wrapper
 * 8. describeSecret debug helper
 * 9. Real-world: Discord token from actual openclaw.json
 * 10. Env var not set returns null
 */

const assert = require('node:assert');
const { resolveSecret, getDiscordToken, getProviderApiKey, describeSecret } = require('./secret_resolver');

// Arbitrary numeric value used to test rejection of non-string non-object tokens.
// (Not a real secret — chosen for memorability in test output.)
const TEST_NUMERIC_TOKEN = 12345;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('=== Secret Resolver Test Suite ===\n');

test('1. resolveSecret on plaintext string', () => {
  const config = { channels: { discord: { token: 'plaintext-token-abc123' } } };
  assert.strictEqual(resolveSecret(config, 'channels?.discord?.token'), 'plaintext-token-abc123');
});

test('2. resolveSecret on SecretRef env source', () => {
  process.env.TEST_SECRET_X = 'resolved-value-123';
  const config = { a: { b: { c: { source: 'env', provider: 'default', id: 'TEST_SECRET_X' } } } };
  assert.strictEqual(resolveSecret(config, 'a?.b?.c'), 'resolved-value-123');
  delete process.env.TEST_SECRET_X;
});

test('3. resolveSecret on malformed SecretRef (no source)', () => {
  const config = { a: { b: { id: 'ENV_VAR' } } };
  assert.strictEqual(resolveSecret(config, 'a.b'), null);
});

test('4. resolveSecret on malformed SecretRef (unknown source)', () => {
  const config = { a: { b: { source: 'vault', id: 'secret/path' } } };
  assert.strictEqual(resolveSecret(config, 'a.b'), null);
});

test('5. resolveSecret on missing path', () => {
  const config = { channels: { discord: {} } };
  assert.strictEqual(resolveSecret(config, 'channels?.discord?.token'), null);
});

test('6. resolveSecret on null config', () => {
  assert.strictEqual(resolveSecret(null, 'any.path'), null);
  assert.strictEqual(resolveSecret(undefined, 'any.path'), null);
});

test('7. resolveSecret on file source', () => {
  const tmpFile = '/tmp/test_secret_file_' + Date.now();
  require('fs').writeFileSync(tmpFile, '  file-content-with-whitespace  \n');
  const config = { a: { b: { source: 'file', provider: 'default', id: tmpFile } } };
  assert.strictEqual(resolveSecret(config, 'a.b'), 'file-content-with-whitespace');
  require('fs').unlinkSync(tmpFile);
});

test('8. resolveSecret on missing file returns null', () => {
  const config = { a: { b: { source: 'file', provider: 'default', id: '/nonexistent/path' } } };
  assert.strictEqual(resolveSecret(config, 'a.b'), null);
});

test('9. resolveSecret on SecretRef env var not set returns null', () => {
  const config = { a: { b: { source: 'env', provider: 'default', id: 'DEFINITELY_NOT_SET_XYZ_123' } } };
  assert.strictEqual(resolveSecret(config, 'a.b'), null);
});

test('10. resolveSecret on SecretRef env with no id returns null', () => {
  const config = { a: { b: { source: 'env' } } };
  assert.strictEqual(resolveSecret(config, 'a.b'), null);
});

test('11. getDiscordToken convenience wrapper (with config)', () => {
  process.env.TEST_DC_TOKEN = 'dc-token-123';
  const config = { channels: { discord: { token: { source: 'env', provider: 'default', id: 'TEST_DC_TOKEN' } } } };
  assert.strictEqual(getDiscordToken(config), 'dc-token-123');
  delete process.env.TEST_DC_TOKEN;
});

test('11b. getDiscordToken with no config arg reads openclaw.json', () => {
  // Real openclaw.json has channels.discord.token SecretRef
  const result = getDiscordToken();
  // May be null (env not loaded) or the actual token — depends on env state
  // We just verify it doesn't throw
  assert.ok(result === null || typeof result === 'string');
});

test('12. getProviderApiKey convenience wrapper (with config)', () => {
  process.env.TEST_MOONSHOT_KEY = 'moonshot-key-abc';
  const config = { models: { providers: { moonshot: { apiKey: { source: 'env', id: 'TEST_MOONSHOT_KEY' } } } } };
  assert.strictEqual(getProviderApiKey('moonshot', config), 'moonshot-key-abc');
  delete process.env.TEST_MOONSHOT_KEY;
});

test('13. describeSecret on plaintext', () => {
  const config = { a: { token: 'plaintext-123456' } };  // 16 chars
  const desc = describeSecret(config, 'a.token');
  assert.deepStrictEqual(desc, { type: 'plaintext', length: 16 });
});

test('14. describeSecret on SecretRef env (resolved)', () => {
  process.env.TEST_D2 = 'present-value';
  const config = { a: { token: { source: 'env', provider: 'default', id: 'TEST_D2' } } };
  const desc = describeSecret(config, 'a.token');
  assert.deepStrictEqual(desc, {
    type: 'SecretRef', source: 'env', provider: 'default', id: 'TEST_D2', resolved: 'present',
  });
  delete process.env.TEST_D2;
});

test('15. describeSecret on SecretRef env (missing)', () => {
  const config = { a: { token: { source: 'env', provider: 'default', id: 'NOT_SET_X' } } };
  const desc = describeSecret(config, 'a.token');
  assert.strictEqual(desc.resolved, 'missing');
});

test('16. Real-world: resolve Discord token from actual openclaw.json', () => {
  try {
    const config = require('$HOME/.openclaw/openclaw.json');
    const desc = describeSecret(config, 'channels?.discord?.token');
    assert.strictEqual(desc.type, 'SecretRef');
    assert.strictEqual(desc.source, 'env');
    assert.strictEqual(desc.id, 'OPENCLAW_DISCORD_TOKEN');
    // If env is loaded (via .env), should resolve. If not, will be 'missing'.
    // We don't assert on resolved status because it depends on env loading.
  } catch (e) {
    throw new Error('Failed to read openclaw.json: ' + e.message);
  }
});

test('17. Numeric (non-string non-object) value returns null', () => {
  const config = { a: { token: TEST_NUMERIC_TOKEN } };
  assert.strictEqual(resolveSecret(config, 'a.token'), null);
});

test('18. Boolean value returns null', () => {
  const config = { a: { token: true } };
  assert.strictEqual(resolveSecret(config, 'a.token'), null);
});

test('19. Empty dot path returns null', () => {
  const config = { a: { b: 'value' } };
  assert.strictEqual(resolveSecret(config, ''), null);
});

test('20. Path with empty part returns null', () => {
  const config = { a: { b: 'value' } };
  assert.strictEqual(resolveSecret(config, 'a..b'), null);
});

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
