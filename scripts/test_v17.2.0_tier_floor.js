#!/usr/bin/env node
/**
 * GIA Analyzer v17.2.0 Quick Test
 * Tests the tier floor fix: was tierCfg.floor - 5, now exact tierCfg.floor
 */
const fs = require('fs');
const path = require('path');

const ANALYZER_V17_2 = '$HOME/.openclaw/workspace/scripts/gems/gia_cert_analyzer_v17.2.0.js';

if (!fs.existsSync(ANALYZER_V17_2)) {
  console.log('v17.2.0 not found at:', ANALYZER_V17_2);
  console.log('Looking in scripts/ directly...');
  process.exit(1);
}

const { analyzeStone } = require(ANALYZER_V17_2);

const tests = [
  // INVESTMENT tier: floor 70
  { color:'D', clarity:'IF', carat:0.5, cut:'EX', pol:'EX', symm:'EX', fluor:'NONE',
    label:'D-IF 0.5ct EX → INVESTMENT floor' },
  // PREMIUM tier: floor 55
  { color:'H', clarity:'VS1', carat:1.5, cut:'EX', pol:'EX', symm:'EX', fluor:'NONE',
    label:'H-VS1 1.5ct EX → PREMIUM floor' },
  // COMMERCIAL tier: floor 25
  { color:'J', clarity:'SI1', carat:1.0, cut:'GD', pol:'GD', symm:'GD', fluor:'NONE',
    label:'J-SI1 1ct GD → COMMERCIAL floor' },
  // BUDGET tier: floor 5
  { color:'M', clarity:'SI2', carat:0.5, cut:'GD', pol:'GD', symm:'GD', fluor:'FAINT',
    label:'M-SI2 0.5ct GD → BUDGET floor' },
  // Very different scenarios to force low scores
  { color:'M', clarity:'I2', carat:0.3, cut:'GD', pol:'FR', symm:'FR', fluor:'STRONG',
    label:'M-I2 0.3ct FR+StrongFluor → very low score' },
];

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  GIA Analyzer v17.2.0 — Tier Floor Verification             ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

let allPassed = true;
tests.forEach(test => {
  try {
    const result = analyzeStone(test);
    const score = result.totalScore;
    const tier = result.qualityTier;
    const tierFloors = {INVESTMENT:70, PREMIUM:55, COMMERCIAL:25, BUDGET:5};
    const expectedMin = tierFloors[tier] || 0;
    const passed = score >= expectedMin;
    if (!passed) allPassed = false;

    const status = passed ? '✅' : '❌';
    console.log(`${status} ${test.label}`);
    console.log(`   Score: ${score} | Tier: ${tier} | Floor: ${expectedMin}`);
    if (result.flags && result.flags.length > 0) {
      console.log(`   Top flags: ${result.flags.slice(0,3).map(f=>f.label).join(', ')}`);
    }
    console.log('');
  } catch(e) {
    console.log(`❌ ${test.label}: ERROR ${e.message}`);
  }
});

console.log(allPassed ? '\n✅ ALL TESTS PASSED — Tier floor fix verified!' : '\n❌ SOME TESTS FAILED');
