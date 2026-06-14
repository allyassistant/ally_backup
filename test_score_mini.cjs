// Minimal test for gia_cert_analyzer v8.2.0
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the file
const code = fs.readFileSync('/Users/ally/.openclaw/workspace/scripts/gia_cert_analyzer.js', 'utf8');

// Create a mock context
const context = {
  require: (mod) => {
    if (mod === 'fs') return fs;
    if (mod === 'path') return path;
    if (mod === 'https') return { request: () => {} };
    if (mod === 'child_process') return { execFileSync: () => {} };
    if (mod === 'os') return { homedir: () => '/Users/ally' };
    throw new Error('Unknown: ' + mod);
  },
  module: { exports: {} },
  exports: {},
  console,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  process: { env: { HOME: '/Users/ally', PATH: process.env.PATH } },
  Buffer,
  __dirname: '/Users/ally/.openclaw/workspace/scripts'
};
context.global = context;

// Run in sandbox
vm.createContext(context);
vm.runInContext(code, context);

const calculateClawScore = context.module.exports.calculateClawScore;
console.log('calculateClawScore type:', typeof calculateClawScore);

// Test 1: #1206091556 (58.14ct F/VS1, girdle "medium - slightly thick")
console.log('\n=== Test 1: #1206091556 (58.14ct F/VS1) ===');
const cert1 = {
  data: {
    certNumber: '1206091556',
    carat: '58.14',
    color: 'F',
    clarity: 'VS1',
    fluorescence: 'None',
    girdle: 'medium - slightly thick',
    cut: 'Excellent',
    polish: 'Excellent',
    symmetry: 'Excellent',
    depthPct: '61.2',
    tablePct: '57',
    shape: 'Round',
    comments: [],
    keyToSymbols: []
  },
  logicFlags: []
};

const result1 = calculateClawScore(cert1);
console.log('result1 keys:', Object.keys(result1));
console.log('finalScore:', result1.finalScore);
console.log('score:', result1.score);
console.log('data:', result1.data ? Object.keys(result1.data) : 'undefined');
if (result1.data) {
  console.log('girdlePenaltyApplied:', result1.data.girdlePenaltyApplied);
  console.log('girdlePenaltyAmount:', result1.data.girdlePenaltyAmount);
}
console.log('All flags:', result1.flags.map(f => f.flag));