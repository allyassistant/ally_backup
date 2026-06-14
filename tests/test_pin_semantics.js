#!/usr/bin/env node

/**
 * test_pin_semantics.js — Unit test for pin semantics helper
 *
 * Verifies that isActionBlockedByPin() correctly:
 * 1. Blocked: delete, archive, consolidate, status_change_to_archived, status_change_to_stale
 * 2. NOT blocked: any other action (patch, provenance change, rename, etc.)
 *
 * Run: node tests/test_pin_semantics.js
 */

'use strict';

const { isActionBlockedByPin } = require('../scripts/lib/pin_semantics');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

console.log('\n🧪 isActionBlockedByPin() — Pin Semantics Test Suite');
console.log('═══════════════════════════════════════════════════\n');

// ── BLOCKED actions ──
test('blocks "delete"', () => assert(isActionBlockedByPin('delete') === true));
test('blocks "archive"', () => assert(isActionBlockedByPin('archive') === true));
test('blocks "consolidate"', () => assert(isActionBlockedByPin('consolidate') === true));
test('blocks "status_change_to_archived"', () => assert(isActionBlockedByPin('status_change_to_archived') === true));
test('blocks "status_change_to_stale"', () => assert(isActionBlockedByPin('status_change_to_stale') === true));

// ── NOT blocked actions ──
test('ALLOWS "patch" (content patch)', () => assert(isActionBlockedByPin('patch') === false));
test('ALLOWS "promote" (draft→active)', () => assert(isActionBlockedByPin('promote') === false));
test('ALLOWS "provenance_change"', () => assert(isActionBlockedByPin('provenance_change') === false));
test('ALLOWS "rename"', () => assert(isActionBlockedByPin('rename') === false));
test('ALLOWS "add_support_file"', () => assert(isActionBlockedByPin('add_support_file') === false));
test('ALLOWS "symlink"', () => assert(isActionBlockedByPin('symlink') === false));
test('ALLOWS empty string', () => assert(isActionBlockedByPin('') === false));
test('ALLOWS unknown action', () => assert(isActionBlockedByPin('unknown_action') === false));
test('ALLOWS undefined (graceful)', () => assert(isActionBlockedByPin(undefined) === false));
test('ALLOWS null (graceful)', () => assert(isActionBlockedByPin(null) === false));

// ── Case sensitivity ──
test('case-sensitive: "Archive" != "archive"', () => assert(isActionBlockedByPin('Archive') === false));
test('case-sensitive: "DELETE" != "delete"', () => assert(isActionBlockedByPin('DELETE') === false));

// ── Edge cases ──
test('does NOT block "status_change_to_active"', () => assert(isActionBlockedByPin('status_change_to_active') === false));
test('does NOT block "status_change_to_draft"', () => assert(isActionBlockedByPin('status_change_to_draft') === false));

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

process.exit(failed > 0 ? 1 : 0);
