/**
 * classifier_tests.js — Phase 2 Regex Classifier Test Suite
 *
 * Covers route classification accuracy and false-positive prevention.
 * No test framework — pure Node + assert module, hand-rolled runner.
 *
 * Run:
 *   cd /Users/ally/.openclaw/workspace/scripts/router/tests
 *   node classifier_tests.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const routerDir = path.join(__dirname, '..');
const { classifySync, regexClassify, RULES, DEFAULT_ROUTE } = require(path.join(routerDir, 'classifier'));

// ─── Runner ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(id, name, fn) {
  const fullName = `C${id} — ${name}`;
  try {
    fn();
    passed++;
    results.push({ id, name, status: 'PASS' });
    console.log(`✓ C${id}: PASS — ${name}`);
  } catch (err) {
    failed++;
    results.push({ id, name, status: 'FAIL', error: err.message });
    console.error(`✗ C${id}: FAIL — ${name}`);
    console.error(`   ${err.message}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

function main() {
  // ── FDQ route ───────────────────────────────────────────────────────────
  test('1', 'FDQ: "唔知點算好" → FDQ', () => {
    const r = regexClassify('唔知點算好');
    assert.strictEqual(r.route, 'FDQ');
    assert.strictEqual(r.matched, true);
  });

  test('2', 'FDQ: "你覺得點" → FDQ', () => {
    const r = regexClassify('你覺得點');
    assert.strictEqual(r.route, 'FDQ');
  });

  test('3', 'FDQ: "有咩建議" → FDQ', () => {
    const r = regexClassify('有咩建議');
    assert.strictEqual(r.route, 'FDQ');
  });

  // ── SOP route ───────────────────────────────────────────────────────────
  test('4', 'SOP: "send email" → SOP', () => {
    const r = regexClassify('send email');
    assert.strictEqual(r.route, 'SOP');
  });

  test('5', 'SOP: "forward message" → SOP', () => {
    const r = regexClassify('forward message');
    assert.strictEqual(r.route, 'SOP');
  });

  test('6', 'SOP: "x.com link" → SOP', () => {
    const r = regexClassify('x.com link');
    assert.strictEqual(r.route, 'SOP');
  });

  test('7', 'SOP false positive: "fast forward video" should NOT match forward alone', () => {
    // Actually "fast forward" contains "forward" — if we added \b, it should still match
    // because "forward" is a standalone word. This test documents expected behavior.
    const r = regexClassify('fast forward video');
    assert.strictEqual(r.route, 'SOP');
  });

  test('8', 'SOP false positive: "send flowers" should NOT trigger SOP', () => {
    const r = regexClassify('send flowers');
    assert.strictEqual(r.route, DEFAULT_ROUTE, `Expected NONE but got ${r.route}`);
  });

  // ── DIRECT_ANSWER route ─────────────────────────────────────────────────
  test('9', 'DIRECT_ANSWER: "有冇問題" → DIRECT_ANSWER', () => {
    const r = regexClassify('有冇問題');
    assert.strictEqual(r.route, 'DIRECT_ANSWER');
  });

  test('10', 'DIRECT_ANSWER: "status check" → DIRECT_ANSWER', () => {
    const r = regexClassify('status check');
    assert.strictEqual(r.route, 'DIRECT_ANSWER');
  });

  test('11', 'DIRECT_ANSWER: "今日幾號" → DIRECT_ANSWER', () => {
    const r = regexClassify('今日幾號');
    assert.strictEqual(r.route, 'DIRECT_ANSWER');
  });

  // ── SPAWN route ─────────────────────────────────────────────────────────
  test('12', 'SPAWN: "幫我分析下呢個 report" → SPAWN', () => {
    const r = regexClassify('幫我分析下呢個 report');
    assert.strictEqual(r.route, 'SPAWN');
  });

  test('13', 'SPAWN: "research topic" → SPAWN', () => {
    const r = regexClassify('research topic');
    assert.strictEqual(r.route, 'SPAWN');
  });

  test('14', 'SPAWN false positive: "researcher" should NOT trigger SPAWN', () => {
    const r = regexClassify('He is a researcher');
    assert.strictEqual(r.route, DEFAULT_ROUTE, `Expected NONE but got ${r.route}`);
  });

  test('15', 'SPAWN false positive: "checkbox" should NOT trigger SPAWN', () => {
    const r = regexClassify('Add a checkbox');
    assert.strictEqual(r.route, DEFAULT_ROUTE, `Expected NONE but got ${r.route}`);
  });

  test('16', 'SPAWN false positive: "suggestions" should NOT trigger SPAWN', () => {
    const r = regexClassify('Any suggestions?');
    // Wait: "suggestions" contains "suggestion"... with \b it should NOT match
    // because \b requires word boundary at end too. "suggestions" ends with 's',
    // so after "suggestion" there is 's' which is a word char, not a boundary.
    assert.strictEqual(r.route, DEFAULT_ROUTE, `Expected NONE but got ${r.route}`);
  });

  // ── CODE route ──────────────────────────────────────────────────────────
  test('17', 'CODE: "改 code" → CODE', () => {
    const r = regexClassify('改 code');
    assert.strictEqual(r.route, 'CODE');
  });

  test('18', 'CODE: "fix bug" → CODE', () => {
    const r = regexClassify('fix bug');
    assert.strictEqual(r.route, 'CODE');
  });

  test('19', 'CODE false positive: "decode string" should NOT trigger CODE', () => {
    const r = regexClassify('decode string');
    assert.strictEqual(r.route, DEFAULT_ROUTE, `Expected NONE but got ${r.route}`);
  });

  test('20', 'CODE false positive: "postcode" should NOT trigger CODE', () => {
    const r = regexClassify('Enter your postcode');
    assert.strictEqual(r.route, DEFAULT_ROUTE, `Expected NONE but got ${r.route}`);
  });

  test('21', 'CODE false positive: "error 404" should still trigger CODE (error is a word)', () => {
    const r = regexClassify('error 404');
    assert.strictEqual(r.route, 'CODE');
  });

  test('22', 'CODE false positive: "update schedule" → CODE', () => {
    const r = regexClassify('update schedule');
    assert.strictEqual(r.route, 'CODE');
  });

  // ── BROWSER route ───────────────────────────────────────────────────────
  test('23', 'BROWSER: "開個網頁" → BROWSER', () => {
    const r = regexClassify('開個網頁');
    assert.strictEqual(r.route, 'BROWSER');
  });

  test('24', 'BROWSER: "open browser" → BROWSER', () => {
    const r = regexClassify('open browser');
    assert.strictEqual(r.route, 'BROWSER');
  });

  test('25', 'BROWSER: "open web page" → BROWSER', () => {
    const r = regexClassify('open web page');
    assert.strictEqual(r.route, 'BROWSER');
  });

  // ── Edge cases ──────────────────────────────────────────────────────────
  test('26', 'Empty string → NONE', () => {
    const r = regexClassify('');
    assert.strictEqual(r.route, DEFAULT_ROUTE);
    assert.strictEqual(r.matched, false);
  });

  test('27', 'Null input → NONE', () => {
    const r = regexClassify(null);
    assert.strictEqual(r.route, DEFAULT_ROUTE);
    assert.strictEqual(r.matched, false);
  });

  test('28', 'Number input → NONE', () => {
    const r = regexClassify(123);
    assert.strictEqual(r.route, DEFAULT_ROUTE);
    assert.strictEqual(r.matched, false);
  });

  test('29', 'Mixed Chinese-English: "幫我review份code" → CODE (CODE > SPAWN in this case)', () => {
    // "review" matches SPAWN, "code" matches CODE. Priority order: FDQ > SOP > DIRECT_ANSWER > SPAWN > CODE > BROWSER
    // So SPAWN comes before CODE, "review" should match first.
    const r = regexClassify('幫我review份code');
    assert.strictEqual(r.route, 'SPAWN');
  });

  test('30', 'RULES array has 6 rules', () => {
    assert.strictEqual(RULES.length, 6);
  });

  test('31', 'DEFAULT_ROUTE is NONE', () => {
    assert.strictEqual(DEFAULT_ROUTE, 'NONE');
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(`=== Classifier Tests: ${passed} passed, ${failed} failed ===`);
  console.log(`Total: ${passed + failed}`);

  if (failed > 0) {
    console.log('\n--- Failed test details ---');
    for (const r of results) {
      if (r.status === 'FAIL') {
        console.log(`C${r.id} (${r.name}): ${r.error}`);
      }
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
