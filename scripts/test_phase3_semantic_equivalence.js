#!/usr/bin/env node
/**
 * Phase 3 test suite — Semantic equivalence checks.
 *
 * Verifies that `semanticEquivalenceCheck()` correctly detects semantic drift
 * (identifier renaming, node count loss) while allowing safe surface changes
 * (whitespace, reordering, .??. insertion).
 *
 * Run: node scripts/test_phase3_semantic_equivalence.js
 */
const path = require('path');
const v = require('./lib/rules/validation');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✅ ${name}`); passed++; }
  catch (e) { console.log(`❌ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ====================================================================
// semanticEquivalenceCheck tests
// ====================================================================
console.log('\n--- semanticEquivalenceCheck ---');

test('SE-1: identical content passes', () => {
  const input = "const x = 1;\nmodule.exports = x;\n";
  const result = v.semanticEquivalenceCheck(input, input, '/tmp/test.js');
  assert(result !== null, 'should not be null (JS file)');
  assert(result.valid, 'identical content should be valid');
});

test('SE-2: whitespace-only change passes', () => {
  const oldCode = "const x=1;\nmodule.exports=x;\n";
  const newCode = "const x = 1;\nmodule.exports = x;\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  assert(result.valid, 'whitespace change should be valid');
});

test('SE-3: optional-chaining insertion passes (safe)', () => {
  const oldCode = "const x = a.b.c;\nmodule.exports = x;\n";
  const newCode = "const x = a?.b?.c;\nmodule.exports = x;\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  // The identifiers 'a', 'b', 'c' should still be present
  // (they're the same identifiers, just with ?. between them)
  assert(result.valid, `?. insertion should pass semantic check, got: ${result.details}`);
});

test('SE-4: variable rename FAILS (catches simplified-chinese bug)', () => {
  const oldCode = "const 数据 = [1,2,3];\nmodule.exports = { 数据 };\n";
  const newCode = "const 數據 = [1,2,3];\nmodule.exports = { 數據 };\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  assert(!result.valid, 'variable rename should be rejected');
  assert(result.details.includes('数据'), `should mention lost identifier '数据', got: ${result.details}`);
});

test('SE-5: property key rename in object literal FAILS', () => {
  // Object { 数据 } is shorthand for { 数据: 数据 } — the key IS an identifier
  const oldCode = "const obj = { 应用: 1 };\nmodule.exports = obj;\n";
  const newCode = "const obj = { 應用: 1 };\nmodule.exports = obj;\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  assert(!result.valid, 'property key rename should be rejected');
});

test('SE-6: function name rename FAILS', () => {
  const oldCode = "function 边角计算() { return 1; }\nmodule.exports = 边角计算;\n";
  const newCode = "function 邊角計算() { return 1; }\nmodule.exports = 邊角計算;\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  assert(!result.valid, 'function rename should be rejected');
});

test('SE-7: SKIPS non-JS file', () => {
  const oldCode = 'echo "hello"';
  const newCode = 'echo "HELLO"';
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.sh');
  assert(result === null, 'non-JS file should return null (skip)');
});

test('SE-8: code injection (adding new identifier) passes', () => {
  // Adding a new identifier is OK — we only check for LOST identifiers
  const oldCode = "const x = 1;\nmodule.exports = x;\n";
  const newCode = "const x = 1;\nconst y = 2;\nmodule.exports = x;\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  assert(result.valid, 'adding identifiers should be valid');
});

test('SE-9: node count drop >10% FAILS (structural integrity)', () => {
  // Simulate a fix that deletes most of the code
  const oldCode = "const x = 1;\nconst y = 2;\nconst z = 3;\nmodule.exports = x;\n";
  const newCode = "const x = 1;\nmodule.exports = x;\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  assert(!result.valid, 'significant node drop should be rejected');
});

test('SE-10: actual optional-chaining AST fix output passes (regression)', () => {
  const oldCode = "const c = user.settings.theme.primary;\nmodule.exports = c;\n";
  const newCode = "const c = user?.settings?.theme?.primary;\nmodule.exports = c;\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result !== null, 'should not be null');
  assert(result.valid, `optional-chaining fix should be semantically equivalent, got: ${result.details}`);
});

test('SE-11: validateFix() integrates semantic check', () => {
  // When semantic check detects rename, validateFix should fail
  const oldCode = "const 数据 = [1,2,3];\nmodule.exports = { 数据 };\n";
  const newCode = "const 數據 = [1,2,3];\nmodule.exports = { 數據 };\n";
  const result = v.validateFix({ oldContent: oldCode, newContent: newCode, filePath: '/tmp/test.js', rule: { id: 'simplified-chinese' } });
  assert(!result.valid, 'validateFix should reject identifier rename');
  const semanticCheck = result.checks.find(c => c.name === 'semantic');
  assert(semanticCheck && !semanticCheck.valid, 'semantic check should fail');
});

test('SE-12: SEMANTIC_VALIDATION=false env var disables semantic check', () => {
  // Save original env
  const orig = process.env.SEMANTIC_VALIDATION;
  process.env.SEMANTIC_VALIDATION = 'false';
  
  const oldCode = "const 数据 = [1,2,3];\nmodule.exports = { 数据 };\n";
  const newCode = "const 數據 = [1,2,3];\nmodule.exports = { 數據 };\n";
  const result = v.semanticEquivalenceCheck(oldCode, newCode, '/tmp/test.js');
  assert(result === null, 'with SEMANTIC_VALIDATION=false, should return null (skip)');
  
  // Verify validateFix still runs (just without semantic check)
  const vResult = v.validateFix({ oldContent: oldCode, newContent: newCode, filePath: '/tmp/test.js', rule: { id: 'simplified-chinese' } });
  assert(vResult.checks.find(c => c.name === 'semantic') === undefined || vResult.checks.find(c => c.name === 'semantic').valid,
    'semantic check should not fail when disabled');
  
  // Restore
  process.env.SEMANTIC_VALIDATION = orig;
});

// ====================================================================
// Summary
// ====================================================================
console.log(`\n══════════════════════════════════════`);
console.log(`Phase 3: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);
process.exit(failed > 0 ? 1 : 0);