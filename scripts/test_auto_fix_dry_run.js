#!/usr/bin/env node
/**
 * End-to-end test: run the actual buggy rules' fix() through validateFix()
 * to prove Phase 1 catches real-world corruption before it hits disk.
 */
const path = require('path');
const fs = require('fs');
const { validateFix } = require('./lib/rules/validation');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✅ ${name}`); passed++; }
  catch (e) { console.log(`❌ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Test the actual optional-chaining rule on a real-world problematic line
test('optional-chaining rule on string literal with dots', () => {
  const oldCode = `// Test file
const tmpPath = '.cache.json.tmp';
const another = 'foo.bar.baz';
module.exports = { tmpPath, another };
`;
  // The buggy fix() output (simulated from real corruption seen earlier):
  const badFixOutput = `// Test file
const tmpPath = '.cache?.json?.tmp';
const another = 'foo?.bar?.baz';
module.exports = { tmpPath, another };
`;
  // Both files parse — the bug is semantic, not syntactic.
  // The identifier check should NOT catch this either (path strings are stripped).
  // Phase 1 limitation: this specific bug class isn't caught.
  // It IS caught when the rule tries to use the result as code, but the
  // string itself is fine.
  const result = validateFix({ oldContent: oldCode, newContent: badFixOutput, filePath: '/tmp/test.js', rule: { id: 'optional-chaining' } });
  // Document the gap: Phase 1 doesn't catch this — Phase 3 (semantic eq) needed.
  assert(result.valid === true, 'Phase 1 has known gap here — see test docstring');
});

test('hardcoded-home-path: log message inside string', () => {
  const oldCode = `console.log('Failed: /Users/ally/.config/x');
module.exports = 1;
`;
  const badFixOutput = `console.log('Failed: $HOME/.config/x');
module.exports = 1;
`;
  // Same limitation — strings are stripped before identifier extraction.
  const result = validateFix({ oldContent: oldCode, newContent: badFixOutput, filePath: '/tmp/test.js', rule: { id: 'hardcoded-home-path' } });
  assert(result.valid === true, 'Phase 1 has known gap here — see test docstring');
});

test('simplified-chinese: actual identifier rename', () => {
  // Real-world example: simplified Chinese var name
  const oldCode = `const 数据 = [1,2,3];
module.exports = { 数据 };
`;
  const badFixOutput = `const 數據 = [1,2,3];
module.exports = { 數據 };
`;
  // This SHOULD be caught — identifiers ARE caught.
  const result = validateFix({ oldContent: oldCode, newContent: badFixOutput, filePath: '/tmp/test.js', rule: { id: 'simplified-chinese' } });
  assert(!result.valid, 'identifier rename should be caught');
  assert(result.checks.find(c => c.name === 'identifiers' && !c.valid), 'identifier check must fail');
});

test('simplified-chinese: only string content changes (should PASS validation)', () => {
  // If the rule only changes a comment or a string, no identifier loss
  const oldCode = `// 我们是好朋友
const x = 1;
module.exports = x;
`;
  const badFixOutput = `// 我們是好朋友
const x = 1;
module.exports = x;
`;
  // Comment is stripped before tokenization — no identifier loss detected.
  // This is a false NEGATIVE for the rule (the rule DOES corrupt comments)
  // but a true NEGATIVE for identifier-preservation validation.
  const result = validateFix({ oldContent: oldCode, newContent: badFixOutput, filePath: '/tmp/test.js', rule: { id: 'simplified-chinese' } });
  // Phase 1 limitation: comment rewriting is a content change, not an identifier change.
  // This is fine for now — comment changes don't break code.
  assert(result.valid, 'comment-only change is OK from identifier-preservation perspective');
});

test('LHS optional chaining — actual real-world case', () => {
  // The corruption we saw: audit2?.results?.local[0].file = wsRelativeProd;
  const oldCode = `const arr = [{ file: 'a' }];
arr[0].file = 'b';
module.exports = arr;
`;
  const badFixOutput = `const arr = [{ file: 'a' }];
arr?.[0].file = 'b';
module.exports = arr;
`;
  const result = validateFix({ oldContent: oldCode, newContent: badFixOutput, filePath: '/tmp/test.js', rule: { id: 'optional-chaining' } });
  assert(!result.valid, 'LHS optional chaining must be caught');
  assert(result.checks.find(c => c.name === 'syntax' && !c.valid), 'syntax check must fail');
});

console.log(`\n══════════════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════`);
console.log(`\n📋 Phase 1 Coverage:`);
console.log(`✅ Catch: LHS optional chaining (SyntaxError)`);
console.log(`✅ Catch: Variable rename (identifier loss)`);
console.log(`⚠️  Miss: String literal with dots (semantic, Phase 3)`);
console.log(`⚠️  Miss: Log message path replacement (semantic, Phase 3)`);
process.exit(failed > 0 ? 1 : 0);