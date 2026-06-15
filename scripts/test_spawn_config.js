#!/usr/bin/env node
/**
 * Unit tests for spawn_config.js thinking resolution.
 */

'use strict';

const { resolveThinking } = require('./spawn_config');

let passed = 0;
let failed = 0;

function test(label, condition, detail = '') {
  if (condition) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

console.log('═══ spawn_config thinking resolver tests ═══\n');

test(
  'minimax-portal with reasoning:high → adaptive',
  resolveThinking('minimax-portal', { reasoning: 'high' }) === 'adaptive'
);

test(
  'minimax-portal with reasoning:true → adaptive',
  resolveThinking('minimax-portal', { reasoning: true }) === 'adaptive'
);

test(
  'minimax-portal with no extraBody → adaptive',
  resolveThinking('minimax-portal', {}) === 'adaptive'
);

test(
  'deepseek with reasoning:high → undefined (spawn avoids flash reasoning)',
  resolveThinking('deepseek', { reasoning: 'high' }) === undefined
);

test(
  'deepseek with no extraBody → undefined',
  resolveThinking('deepseek', {}) === undefined
);

test(
  'unknown provider → undefined',
  resolveThinking('openai', { reasoning: 'high' }) === undefined
);

console.log(`\n─── Results: ${passed} passed, ${failed} failed ───`);
process.exit(failed > 0 ? 1 : 0);
