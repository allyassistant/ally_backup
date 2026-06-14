#!/usr/bin/env node
/**
 * test_umbrella_consolidation.js — Tests for Phase B LLM Umbrella Consolidation
 *
 * Tests: prompt formatting, YAML parsing, proposal writing, mock LLM.
 * Does NOT hit any real API — all LLM interactions are mocked.
 *
 * Usage:
 *   node tests/test_umbrella_consolidation.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const umbrella = require('../scripts/lib/umbrella_consolidation');

// ─── Test State ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    const msg = `${message}: expected "${expected}", got "${actual}"`;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    passed++;
  } else {
    failed++;
    const msg = `${message}: expected ${expectedStr}, got ${actualStr}`;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

// ─── Test Pair Fixture ──────────────────────────────────────────────────────

const SAMPLE_PAIR = {
  skillA: 'weather-checker',
  skillB: 'weather-alert',
  score: 0.65,
  bodyA: 'Checks current weather conditions using wttr.in. Returns temperature, humidity, and wind data for a given location. Cached for 15 minutes. Default location is Hong Kong.',
  bodyB: 'Monitors weather alerts from the Hong Kong Observatory API. Sends push notification when typhoon signal or thunderstorm warning is active. Runs every 10 minutes via cron.',
};

const HIGH_SIM_PAIR = {
  skillA: 'data-validator',
  skillB: 'data-cleaner',
  score: 0.85,
  bodyA: 'Validates incoming data formats. Checks JSON schema compliance, date formats, and required fields. Returns error report with line numbers for invalid records.',
  bodyB: 'Cleans incoming data by removing duplicates, normalizing date formats, and filling missing defaults. Uses the same validation rules as the validator before cleaning.',
};

const LOW_SIM_PAIR = {
  skillA: 'weather-checker',
  skillB: 'stock-updater',
  score: 0.15,
  bodyA: 'Checks current weather conditions using wttr.in. Returns temperature, humidity, and wind data.',
  bodyB: 'Updates stock inventory from Excel sheets. Merges multiple sources and tracks sold items. Outputs JSON.',
};

// ─── Test 1: Prompt Formatting ──────────────────────────────────────────────

function testPromptFormatting() {
  console.log('\n📋 Test 1: Prompt Formatting');

  const prompt = umbrella.formatConsolidationPrompt(SAMPLE_PAIR);

  assert(prompt.includes(SAMPLE_PAIR.skillA), 'Prompt contains skillA name');
  assert(prompt.includes(SAMPLE_PAIR.skillB), 'Prompt contains skillB name');
  assert(prompt.includes('Jaccard Similarity'), 'Prompt includes Jaccard label');
  assert(prompt.includes(SAMPLE_PAIR.score.toString()), 'Prompt includes score');
  assert(prompt.includes('Hermes consolidation rules'), 'Prompt includes Hermes rules');
  assert(prompt.includes('shouldMerge'), 'Prompt includes output YAML field');
  assert(prompt.includes('umbrellaName'), 'Prompt includes umbrellaName field');
  assert(prompt.includes('reason'), 'Prompt includes reason field');
  assert(prompt.includes('supportFilesToMove'), 'Prompt includes supportFilesToMove field');
  assert(prompt.includes('```yaml'), 'Prompt includes YAML code block fence');
  assert(prompt.includes(SAMPLE_PAIR.bodyA), 'Prompt includes bodyA content');
  assert(prompt.includes(SAMPLE_PAIR.bodyB), 'Prompt includes bodyB content');
}

// ─── Test 2: YAML Response Parsing ──────────────────────────────────────────

function testYAMLResponseParsing() {
  console.log('\n📋 Test 2: YAML Response Parsing');

  // Test 2a: Parse merge response
  const mergeYAML = `Here is my analysis:
\`\`\`yaml
shouldMerge: true
umbrellaName: "weather-utils"
reason: "Both skills deal with weather data retrieval and monitoring. Merging into a weather-utils umbrella provides a unified interface."
supportFilesToMove:
  - from: "weather-checker/references/api-docs.md"
    to: "weather-utils/references/api-docs.md"
  - from: "weather-alert/references/alert-config.md"
    to: "weather-utils/references/alert-config.md"
\`\`\`
`;

  const mergeResult = umbrella.parseYAMLResponse(mergeYAML);
  assert(mergeResult.shouldMerge === true, 'Parsed shouldMerge as true');
  assertEqual(mergeResult.umbrellaName, 'weather-utils', 'Parsed umbrellaName');
  assert(mergeResult.reason.includes('weather'), 'Parsed reason includes weather');
  assert(mergeResult.supportFilesToMove.length === 2, 'Parsed 2 support files');
  assertEqual(mergeResult.supportFilesToMove[0].from, 'weather-checker/references/api-docs.md', 'Parsed file from path');
  assertEqual(mergeResult.supportFilesToMove[0].to, 'weather-utils/references/api-docs.md', 'Parsed file to path');

  // Test 2b: Parse no-merge response
  const noMergeYAML = '```yaml\nshouldMerge: false\numbrellaName: ""\nreason: "Orthogonal domains — weather and stock data have no shared concept."\nsupportFilesToMove: []\n```';
  const noMergeResult = umbrella.parseYAMLResponse(noMergeYAML);
  assert(noMergeResult.shouldMerge === false, 'Parsed shouldMerge as false');
  assertEqual(noMergeResult.supportFilesToMove.length, 0, 'Parsed empty files array');

  // Test 2c: Parse without YAML block (raw yaml)
  const rawYAML = `shouldMerge: true
umbrellaName: "data-pipeline"
reason: "Data validation and cleaning are tightly coupled operations in a standard ETL pipeline. Sharing rule definitions avoids drift."
supportFilesToMove:
  - from: "data-validator/rules/date-rules.md"
    to: "data-pipeline/rules/date-rules.md"`;

  const rawResult = umbrella.parseYAMLResponse(rawYAML);
  assert(rawResult.shouldMerge === true, 'Parsed raw YAML shouldMerge');
  assertEqual(rawResult.umbrellaName, 'data-pipeline', 'Parsed raw YAML umbrellaName');

  // Test 2d: Handle empty input
  const emptyResult = umbrella.parseYAMLResponse('');
  assert(emptyResult.shouldMerge === false, 'Empty input returns shouldMerge=false');
  assertEqual(emptyResult.umbrellaName, '', 'Empty input returns empty name');
}

// ─── Test 3: Mock Analyzer ──────────────────────────────────────────────────

function testMockAnalyzer() {
  console.log('\n📋 Test 3: Mock Analyzer');

  // Test 3a: High similarity → merge
  const highResult = umbrella.mockAnalyzePair(HIGH_SIM_PAIR);
  assert(highResult.shouldMerge === true, 'High sim pair → shouldMerge=true');
  assert(highResult.umbrellaName.length > 0, 'High sim pair → has umbrellaName');
  assert(highResult.reason.length > 0, 'High sim pair → has reason');
  assert(highResult.supportFilesToMove.length > 0, 'High sim pair → has support files');

  // Test 3b: Low similarity → no merge
  const lowResult = umbrella.mockAnalyzePair(LOW_SIM_PAIR);
  assert(lowResult.shouldMerge === false, 'Low sim pair → shouldMerge=false');
  assertEqual(lowResult.umbrellaName, '', 'Low sim pair → empty umbrellaName');
  assertEqual(lowResult.supportFilesToMove.length, 0, 'Low sim pair → empty support files');

  // Test 3c: Moderate similarity → merge
  const modResult = umbrella.mockAnalyzePair(SAMPLE_PAIR);
  assert(modResult.shouldMerge === true, 'Moderate sim pair → shouldMerge=true');
  assert(modResult.umbrellaName.includes('weather-checker-weather-alert-group') ||
         modResult.umbrellaName.includes('weather'), 'Moderate sim → umbrella name references skills');
}

// ─── Test 4: Proposal File Writing ──────────────────────────────────────────

function testProposalWriting() {
  console.log('\n📋 Test 4: Proposal File Writing');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umbrella-test-'));
  const proposalsDir = path.join(tmpDir, 'proposals');
  try {
    const result = umbrella.mockAnalyzePair(HIGH_SIM_PAIR);
    const filePath = umbrella.saveProposal(result, proposalsDir, {
      skillA: HIGH_SIM_PAIR.skillA,
      skillB: HIGH_SIM_PAIR.skillB,
      score: HIGH_SIM_PAIR.score,
    });

    // Check directory was created
    assert(fs.existsSync(proposalsDir), 'Proposals directory was created');

    // Check file was written
    assert(fs.existsSync(filePath), 'Proposal file was written');
    assert(filePath.startsWith(proposalsDir), 'Proposal file is in proposals dir');
    assert(filePath.endsWith('.yaml'), 'Proposal file has .yaml extension');
    assert(filePath.includes(HIGH_SIM_PAIR.skillA), 'Filename contains skillA name');
    assert(filePath.includes(HIGH_SIM_PAIR.skillB), 'Filename contains skillB name');

    // Check file content
    const content = fs.readFileSync(filePath, 'utf8');
    assert(content.includes('shouldMerge: true'), 'Proposal content has shouldMerge: true');
    assert(content.includes('umbrellaName:'), 'Proposal content has umbrellaName');
    assert(content.includes('supportFilesToMove:'), 'Proposal content has supportFilesToMove');
    assert(content.includes(HIGH_SIM_PAIR.skillA), 'Proposal content references skillA in metadata');
    assert(content.includes(HIGH_SIM_PAIR.skillB), 'Proposal content references skillB in metadata');
    assert(content.includes('jaccardScore:'), 'Proposal content has jaccardScore metadata');
  } finally {
    // Clean up
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ─── Test 5: Heuristic Fallback Analyzer ────────────────────────────────────

function testHeuristicFallback() {
  console.log('\n📋 Test 5: Heuristic Fallback Analyzer');

  // Test 5a: High score → merge
  const highResult = umbrella.heuristicAnalyzePair(HIGH_SIM_PAIR);
  assert(highResult.shouldMerge === true, 'Heuristic: high score → merge');
  assert(highResult.umbrellaName.length > 0, 'Heuristic: high score → has name');

  // Test 5b: Low score → no merge
  const lowResult = umbrella.heuristicAnalyzePair(LOW_SIM_PAIR);
  assert(lowResult.shouldMerge === false, 'Heuristic: low score → no merge');
  assert(highResult.supportFilesToMove.length > 0, 'Heuristic: merge has support files');

  // Test 5c: Commmon name tokens trigger merge at 0.5-0.7 range
  const sharedTokenPair = {
    skillA: 'data-validator',
    skillB: 'data-report',
    score: 0.55,
    bodyA: 'Validates data format compliance with predefined schemas. Returns detailed error reports.',
    bodyB: 'Generates data quality reports from validation results. Formats them for email delivery.',
  };
  const sharedResult = umbrella.heuristicAnalyzePair(sharedTokenPair);
  assert(sharedResult.shouldMerge === true, 'Heuristic: shared tokens → merge at 0.55');
  assert(sharedResult.umbrellaName.includes('data'), 'Heuristic: umbrella name uses shared token');
}

// ─── Test 6: Prompt Field Integrity ─────────────────────────────────────────

function testPromptFieldIntegrity() {
  console.log('\n📋 Test 6: Prompt Field Integrity');

  const prompt = umbrella.formatConsolidationPrompt(SAMPLE_PAIR);

  // Check that all required sections are present
  const sections = [
    'You are analyzing two related skills',
    '## Skill A',
    '## Skill B',
    '## Jaccard Similarity',
    '## Hermes consolidation rules',
    '1. PREFER one broad umbrella',
    '2. Only merge if',
    '3. If skill B is a session-specific instance',
    "4. If they're orthogonal",
    '## Output (strict YAML)',
  ];

  for (const section of sections) {
    assert(prompt.includes(section), `Prompt contains section: "${section}"`);
  }
}

// ─── Test 7: Module Exports ─────────────────────────────────────────────────

function testModuleExports() {
  console.log('\n📋 Test 7: Module Exports');

  const expectedExports = [
    'formatConsolidationPrompt',
    'callLLM',
    'parseYAMLResponse',
    'heuristicAnalyzePair',
    'analyzePair',
    'mockAnalyzePair',
    'saveProposal',
  ];

  for (const name of expectedExports) {
    assert(typeof umbrella[name] === 'function', `Module exports ${name} as function`);
  }
}

// ─── Test 8: Support Files Architecture ──────────────────────────────────────

function testSupportFilesArchitecture() {
  console.log('\n📋 Test 8: Support Files Architecture');

  const ws = path.resolve(__dirname, '..');

  // x-link-analysis references
  const xLinkRefsDir = path.join(ws, 'skills', 'x-link-analysis', 'references');
  assert(fs.existsSync(xLinkRefsDir), 'x-link-analysis/references/ exists');
  const xLinkFiles = fs.readdirSync(xLinkRefsDir);
  assert(xLinkFiles.length >= 1, 'x-link-analysis/references/ has at least 1 file');

  // tools-reference references
  const toolsRefsDir = path.join(ws, 'skills', 'tools-reference', 'references');
  assert(fs.existsSync(toolsRefsDir), 'tools-reference/references/ exists');
  const toolsFiles = fs.readdirSync(toolsRefsDir);
  assert(toolsFiles.length >= 1, 'tools-reference/references/ has at least 1 file');
}

// ─── Test 9: BUG-1 — Temp file cleanup on error ────────────────────────────

function testTempFileCleanup() {
  console.log('\n📋 Test 9: BUG-1 — Temp File Cleanup on Error');

  // Snapshot temp dir before
  const tmpDir = os.tmpdir();
  let beforeFiles = [];
  try { beforeFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('umbrella-prompt-')); } catch { /* ignore */ }

  // Force callLLMViaGateway to fail by calling callLLM with a non-string prompt.
  // The internal try/finally must clean up any temp file even on write/exec failure.
  return umbrella.callLLM(null).then(result => {
    // callLLM swallows errors and returns null
    assert(result === null, 'callLLM returns null on bad input');

    // After call: no new umbrella-prompt-*.txt files should remain
    let afterFiles = [];
    try { afterFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('umbrella-prompt-')); } catch { /* ignore */ }
    const leaked = afterFiles.filter(f => !beforeFiles.includes(f));
    assert(leaked.length === 0,
      `No temp files leaked after failed LLM call (leaked: ${leaked.length}, files: ${leaked.join(', ')})`);
  }).catch(err => {
    assert(false, `callLLM should not throw, got: ${err.message}`);
  });
}

// ─── Test 10: BUG-2 — Threshold strict-greater (no auto-trigger at 0.5) ────

function testThresholdStrictGreater() {
  console.log('\n📋 Test 10: BUG-2 — Threshold Strict-Greater');

  // BUG-2 fix: heuristic must NOT auto-trigger at exactly score=0.5
  // when there are no shared name tokens. (The shared-token gate still
  // applies; the threshold is strict-greater-than so 0.5 falls through.)
  const boundaryPair = {
    skillA: 'weather-checker',
    skillB: 'stock-updater',  // no shared name tokens
    score: 0.5,               // exact threshold boundary
    bodyA: 'Checks current weather conditions using wttr.in. Returns temperature data.',
    bodyB: 'Updates stock inventory from Excel sheets. Merges multiple sources and tracks sold items.',
  };

  const result = umbrella.heuristicAnalyzePair(boundaryPair);
  assert(result.shouldMerge === false,
    'Heuristic does NOT auto-merge at exactly score=0.5 with no shared tokens (BUG-2 fix)');

  // High-similarity branch (>0.7) is independent of BUG-2 — keep that contract
  const highPair = { ...boundaryPair, score: 0.85 };
  const highResult = umbrella.heuristicAnalyzePair(highPair);
  assert(highResult.shouldMerge === true, 'High similarity (0.85) still merges regardless of BUG-2 fix');
}

// ─── Test 11: BUG-3 — YAML injection / path-traversal protection ──────────

function testYAMLInjectionProtection() {
  console.log('\n📋 Test 11: BUG-3 — YAML Injection Protection');

  // Malicious YAML with path-traversal payloads in supportFilesToMove
  const maliciousYAML = `\`\`\`yaml
shouldMerge: true
umbrellaName: "evil-umbrella"
reason: "merge"
supportFilesToMove:
  - from: "../../../etc/passwd"
    to: "/etc/shadow"
  - from: "good-skill/references/safe.md"
    to: "good-umbrella/references/safe.md"
\`\`\`
`;

  const result = umbrella.parseYAMLResponse(maliciousYAML);
  // Only the safe entry should survive; traversal entries are dropped silently
  assert(result.supportFilesToMove.length === 1,
    `Only safe path survives; got ${result.supportFilesToMove.length} entries`);
  if (result.supportFilesToMove.length > 0) {
    assertEqual(result.supportFilesToMove[0].from,
      'good-skill/references/safe.md',
      'Safe path preserved');
    assertEqual(result.supportFilesToMove[0].to,
      'good-umbrella/references/safe.md',
      'Safe to-path preserved');
  }

  // All surviving entries must be clean of traversal segments
  for (const entry of result.supportFilesToMove) {
    assert(!entry.from.includes('..'), `No '..' in from path: ${entry.from}`);
    assert(!entry.to.includes('..'), `No '..' in to path: ${entry.to}`);
  }
}

// ─── Runner ─────────────────────────────────────────────────────────────────

(async () => {
console.log('='.repeat(60));
console.log('🧪 Umbrella Consolidation — Phase B Tests');
console.log('='.repeat(60));

testModuleExports();
testPromptFormatting();
testPromptFieldIntegrity();
testYAMLResponseParsing();
testMockAnalyzer();
testHeuristicFallback();
testProposalWriting();
testSupportFilesArchitecture();

// New HIGH-bug regression tests (BUG-5)
await testTempFileCleanup();
testThresholdStrictGreater();
testYAMLInjectionProtection();

console.log('\n' + '='.repeat(60));
console.log(`📊 Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.error('\n❌ Failures:');
  for (const f of failures) {
    console.error(`   ${f}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
})();
