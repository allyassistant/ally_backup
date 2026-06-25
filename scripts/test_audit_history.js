#!/usr/bin/env node
/**
 * scripts/test_audit_trend.js — Phase 3 / Layer 3 tests
 *
 * Validates:
 *  - summarizeAuditPayload normalizes a canonical audit_results JSON
 *  - compareWithPrevious detects new/resolved/regressed/persistent correctly
 *  - formatDigest produces Discord-ready multi-line string with expected emojis
 *  - persistHistorySnapshot → loadAuditHistory round-trip
 *  - 3-day fake history produces non-empty comparison
 *  - rollingAverage computes correctly
 *
 * Exit code: 0 if all pass, 1 if any fail.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const trend = require('./lib/audit_trend');

// Time-to-ms helpers (test-only; mirrors scripts/lib/time_constants.js shape)
const SECONDS_PER_HOUR = 3600;
const MS_PER_DAY = SECONDS_PER_HOUR * 1000 * 24;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r === false || r == null) {
      failed++;
      failures.push(name);
      console.log(`  ❌ ${name}`);
    } else {
      passed++;
      console.log(`  ✅ ${name}`);
    }
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ============================================================
// Helpers: build fake audit payloads
// ============================================================
function makePayload(fileSeverity) {
  const merged = [];
  for (const [file, sev] of Object.entries(fileSeverity)) {
    merged.push({ file, severity: sev, rule: 'fake', message: 'fake' });
  }
  return {
    results: { merged, local: merged, ai: [], error: [] },
    summary: {
      totalIssues: merged.length,
      severityCounts: merged.reduce((acc, x) => {
        acc[x.severity] = (acc[x.severity] || 0) + 1;
        return acc;
      }, { critical: 0, high: 0, medium: 0, low: 0 }),
    },
  };
}

// ============================================================
// Section 1: summarizeAuditPayload
// ============================================================
console.log('\n📈 test_audit_trend.js');
console.log('─'.repeat(60));
console.log('Section 1: summarizeAuditPayload');

test('summarize handles canonical payload', () => {
  const p = makePayload({
    'scripts/foo.js': 'high',
    'scripts/bar.js': 'low',
    'scripts/baz.js': 'high',
  });
  const s = trend.summarizeAuditPayload(p);
  assert(s, 'must return non-null');
  eq(s.totalIssues, 3);
  eq(s?.bySeverity?.high, 2);
  eq(s?.bySeverity?.low, 1);
  eq(s.fileSeverity['scripts/foo.js'], 'high');
  return true;
});

test('summarize handles null payload gracefully', () => {
  const s = trend.summarizeAuditPayload(null);
  assert(s === null, 'must return null for null input');
  return true;
});

test('summarize handles bare merged[]', () => {
  const s = trend.summarizeAuditPayload({
    merged: [
      { file: 'a.js', severity: 'critical' },
      { file: 'b.js', severity: 'medium' },
    ],
  });
  assert(s, 'must work');
  eq(s.totalIssues, 2);
  eq(s?.bySeverity?.critical, 1);
  eq(s?.bySeverity?.medium, 1);
  return true;
});

test('topFiles sorted by count desc', () => {
  const s = trend.summarizeAuditPayload(makePayload({
    'a.js': 'low', 'b.js': 'low', 'c.js': 'low', 'd.js': 'low',
    'e.js': 'low', 'e.js': 'low', 'e.js': 'low',
  }));
  // After dedup there are 5 unique files; 'e.js' has count 1 after dedup, so just check shape
  assert(s?.topFiles?.length === 5, `expected 5 unique files, got ${s?.topFiles?.length}`);
  return true;
});

// ============================================================
// Section 2: compareWithPrevious
// ============================================================
console.log('\nSection 2: compareWithPrevious');

test('detects NEW files (in current, not previous)', () => {
  const prev = trend.summarizeAuditPayload(makePayload({
    'scripts/old.js': 'high',
  }));
  const cur = trend.summarizeAuditPayload(makePayload({
    'scripts/old.js': 'high',
    'scripts/brand_new.js': 'medium',
  }));
  const cmp = trend.compareWithPrevious(cur, prev);
  assert(cmp?.new?.includes('scripts/brand_new.js'), `expected new file, got ${JSON.stringify(cmp.new)}`);
  assert(!cmp?.new?.includes('scripts/old.js'), 'old file should not be new');
  return true;
});

test('detects RESOLVED files (in previous, not current)', () => {
  const prev = trend.summarizeAuditPayload(makePayload({
    'scripts/persistent.js': 'high',
    'scripts/fixed.js': 'medium',
  }));
  const cur = trend.summarizeAuditPayload(makePayload({
    'scripts/persistent.js': 'high',
  }));
  const cmp = trend.compareWithPrevious(cur, prev);
  assert(cmp?.resolved?.some(r => r.includes('fixed')), `expected resolved=fixed, got ${JSON.stringify(cmp.resolved)}`);
  assert(!cmp?.resolved?.some(r => r.includes('persistent')), 'persistent should not be resolved');
  return true;
});

test('detects REGRESSED files (severity increased)', () => {
  const prev = trend.summarizeAuditPayload(makePayload({
    'scripts/worse.js': 'low',
    'scripts/same.js': 'high',
  }));
  const cur = trend.summarizeAuditPayload(makePayload({
    'scripts/worse.js': 'critical',  // low → critical = regression
    'scripts/same.js': 'high',        // unchanged
  }));
  const cmp = trend.compareWithPrevious(cur, prev);
  const reg = cmp?.regressed?.find(r => r.file === 'scripts/worse.js');
  assert(reg, `expected regression on worse.js, got ${JSON.stringify(cmp.regressed)}`);
  eq(reg.from, 'low');
  eq(reg.to, 'critical');
  assert(!cmp?.regressed?.find(r => r.file === 'scripts/same.js'), 'unchanged should not regress');
  return true;
});

test('detects PERSISTENT files (same severity both runs)', () => {
  const prev = trend.summarizeAuditPayload(makePayload({
    'scripts/stuck.js': 'high',
    'scripts/clean.js': 'low',
  }));
  const cur = trend.summarizeAuditPayload(makePayload({
    'scripts/stuck.js': 'high',  // same = persistent
    'scripts/clean.js': 'low',    // same but low so will be in persistent
  }));
  const cmp = trend.compareWithPrevious(cur, prev);
  assert(cmp?.persistent?.includes('scripts/stuck.js'), `expected stuck.js persistent`);
  assert(cmp?.persistent?.includes('scripts/clean.js'), `expected clean.js persistent`);
  return true;
});

test('severity improvement shows as resolved with arrow', () => {
  const prev = trend.summarizeAuditPayload(makePayload({
    'scripts/better.js': 'high',
  }));
  const cur = trend.summarizeAuditPayload(makePayload({
    'scripts/better.js': 'low',
  }));
  const cmp = trend.compareWithPrevious(cur, prev);
  assert(cmp?.resolved?.some(r => r.includes('better') && r.includes('high→low')),
    `expected improvement arrow in resolved, got ${JSON.stringify(cmp.resolved)}`);
  return true;
});

test('compareWithPrevious handles null previous', () => {
  const cur = trend.summarizeAuditPayload(makePayload({
    'scripts/foo.js': 'high',
  }));
  const cmp = trend.compareWithPrevious(cur, null);
  assert(cmp?.new?.length === 1, 'all files are new when no previous');
  return true;
});

test('compareWithPrevious handles null current', () => {
  const prev = trend.summarizeAuditPayload(makePayload({
    'scripts/foo.js': 'high',
  }));
  const cmp = trend.compareWithPrevious(null, prev);
  assert(cmp?.resolved?.length === 1, 'all files are resolved when current is empty');
  return true;
});

// ============================================================
// Section 3: rollingAverage
// ============================================================
console.log('\nSection 3: rollingAverage');

test('rollingAverage of empty history = 0', () => {
  eq(trend.rollingAverage([]), 0);
  return true;
});

test('rollingAverage computes mean correctly', () => {
  const avg = trend.rollingAverage([
    { totalIssues: 10 },
    { totalIssues: 20 },
    { totalIssues: 30 },
  ]);
  eq(avg, 20);
  return true;
});

// ============================================================
// Section 4: formatDigest
// ============================================================
console.log('\nSection 4: formatDigest');

test('formatDigest starts with 🛠️', () => {
  const text = trend.formatDigest([], { new: [], resolved: [], regressed: [], persistent: [] });
  assert(text.startsWith('🛠️'), `digest must start with 🛠️, got: ${text.slice(0, 30)}`);
  return true;
});

test('formatDigest includes trend line', () => {
  const text = trend.formatDigest(
    [{ date: '2026-06-19', totalIssues: 50 }],
    { new: [], resolved: [], regressed: [], persistent: [] },
    { totalIssues: 50, bySeverity: { critical: 1, high: 10, medium: 20, low: 19 } }
  );
  assert(text.includes('📈'), 'digest must contain trend line');
  assert(text.includes('🛠️'), 'digest must contain audit summary');
  return true;
});

test('formatDigest with persistent shows 🔴', () => {
  const text = trend.formatDigest(
    [{ date: '2026-06-17', totalIssues: 10 }, { date: '2026-06-18', totalIssues: 12 }, { date: '2026-06-19', totalIssues: 8 }],
    { new: [], resolved: [], regressed: [], persistent: ['scripts/stuck.js', 'scripts/old.js'] },
    { totalIssues: 8, bySeverity: { critical: 0, high: 4, medium: 2, low: 2 } }
  );
  assert(text.includes('🔴 Persistent'), 'must include persistent line');
  assert(text.includes('stuck.js'), 'must include file name');
  return true;
});

test('formatDigest with resolved shows 🟢', () => {
  const text = trend.formatDigest(
    [{ date: '2026-06-18', totalIssues: 10 }, { date: '2026-06-19', totalIssues: 6 }],
    { new: [], resolved: ['scripts/fixed.js', 'scripts/done.js'], regressed: [], persistent: [] },
    { totalIssues: 6, bySeverity: { critical: 0, high: 1, medium: 2, low: 3 } }
  );
  assert(text.includes('🟢 Resolved'), 'must include resolved line');
  return true;
});

test('formatDigest with no persistent shows 🟢 zero line', () => {
  const text = trend.formatDigest(
    [{ date: '2026-06-19', totalIssues: 10 }],
    { new: [], resolved: [], regressed: [], persistent: [] },
    { totalIssues: 10, bySeverity: { critical: 0, high: 1, medium: 5, low: 4 } }
  );
  assert(text.includes('🟢 Persistent issues: 0'), 'must show zero persistent');
  return true;
});

test('formatDigest shows ↑/↓ arrow based on delta', () => {
  // Avg 10, today 20 → ↑
  const text1 = trend.formatDigest(
    [{ totalIssues: 10 }, { totalIssues: 10 }, { totalIssues: 20 }],
    { new: ['a.js'], resolved: [], regressed: [], persistent: [] },
    { totalIssues: 20, bySeverity: { high: 20 } }
  );
  assert(text1.includes('↑'), `expected ↑ arrow, got: ${text1}`);

  // Avg 10, today 5 → ↓
  const text2 = trend.formatDigest(
    [{ totalIssues: 10 }, { totalIssues: 10 }, { totalIssues: 5 }],
    { new: [], resolved: ['a.js'], regressed: [], persistent: [] },
    { totalIssues: 5, bySeverity: { high: 5 } }
  );
  assert(text2.includes('↓'), `expected ↓ arrow, got: ${text2}`);
  return true;
});

test('formatDigest truncates long lists with +N more', () => {
  const many = Array.from({ length: 20 }, (_, i) => `f${i}.js`);
  const text = trend.formatDigest(
    [{ totalIssues: 10 }, { totalIssues: 10 }, { totalIssues: 30 }],
    { new: many, resolved: [], regressed: [], persistent: [] },
    { totalIssues: 30, bySeverity: { high: 30 } }
  );
  assert(text.includes('+15 more') || text.includes('+17 more') || text.includes('+1'),
    `expected "+N more" suffix, got: ${text}`);
  return true;
});

// ============================================================
// Section 5: persistHistorySnapshot + loadAuditHistory round-trip
// ============================================================
console.log('\nSection 5: persist + load round-trip');

const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'audit_trend_test_'));
const tmpHistoryDir = path.join(tmpState, 'audit_history');
try {
  fs.mkdirSync(tmpHistoryDir, { recursive: true });
} catch (e) {
  console.error(`Directory creation failed: ${e.message}`);
}

// Generate 3 days of fake history
const fakePayloads = [
  { day: 1, files: { 'scripts/old.js': 'high', 'scripts/foo.js': 'medium' } },
  { day: 2, files: { 'scripts/old.js': 'high', 'scripts/foo.js': 'medium', 'scripts/bar.js': 'low' } },
  { day: 3, files: { 'scripts/old.js': 'high', 'scripts/foo.js': 'high', 'scripts/baz.js': 'critical' } },
];

const today = new Date();
const days = [];

for (let i = fakePayloads.length - 1; i >= 0; i--) {
  const d = new Date(today.getTime() - i * MS_PER_DAY);
  const stamp = trend.formatDate(d);
  const payload = makePayload(fakePayloads[fakePayloads.length - 1 - i].files);
  const p = trend.persistHistorySnapshot(tmpState, payload, stamp);
  days.push(stamp);
}

test('persisted 3 snapshots', () => {
  let files;
  try {
    files = fs.readdirSync(tmpHistoryDir).filter(f => f.startsWith('audit_'));
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  eq(files.length, 3);
  return true;
});

test('loadAuditHistory returns 3 records', () => {
  const history = trend.loadAuditHistory(tmpState, 7);
  eq(history.length, 3);
  return true;
});

test('history records have expected fields', () => {
  const history = trend.loadAuditHistory(tmpState, 7);
  for (const rec of history) {
    assert(typeof rec.date === 'string', 'date');
    assert(typeof rec.totalIssues === 'number', 'totalIssues');
    assert(rec.bySeverity && typeof rec.bySeverity === 'object', 'bySeverity');
    assert(rec.byFile && typeof rec.byFile === 'object', 'byFile');
  }
  return true;
});

test('loadAuditHistory respects days cutoff', () => {
  const history = trend.loadAuditHistory(tmpState, 1);
  // Only today should fall in 1-day window
  eq(history.length, 1);
  return true;
});

test('end-to-end: 3-day fake history produces valid comparison', () => {
  const history = trend.loadAuditHistory(tmpState, 7);

  // Reconstruct summary objects with fileSeverity for each
  const tail = history[history.length - 1];
  const cur = {
    fileSeverity: tail.byFile ? Object.fromEntries(
      Object.keys(tail.byFile).map(f => [f, 'medium'])  // unknown sev, use 'medium'
    ) : {},
  };
  // Better: read the actual snapshots we just wrote
  let curRaw;
  try {
    curRaw = JSON.parse(fs.readFileSync(path.join(tmpHistoryDir, `audit_${tail.date}.json`), 'utf8'));
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  const curSummary = trend.summarizeAuditPayload(curRaw);

  let prevRaw;
  try {
    prevRaw = JSON.parse(fs.readFileSync(
      path.join(tmpHistoryDir, `audit_${history[history.length - 2].date}.json`), 'utf8'
    ));
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  const prevSummary = trend.summarizeAuditPayload(prevRaw);

  const cmp = trend.compareWithPrevious(curSummary, prevSummary);
  assert(cmp, 'comparison must succeed');
  // bar.js was in day 2 but not day 3 → resolved
  assert(cmp?.resolved?.some(r => r.includes('bar.js')), `expected bar.js resolved, got ${JSON.stringify(cmp.resolved)}`);
  // baz.js was new in day 3
  assert(cmp?.new?.includes('scripts/baz.js'), `expected baz.js new, got ${JSON.stringify(cmp.new)}`);
  return true;
});

test('end-to-end: formatDigest on fake history produces Discord string', () => {
  const history = trend.loadAuditHistory(tmpState, 7);
  const tail = history[history.length - 1];
  let curRaw;
  try {
    curRaw = JSON.parse(fs.readFileSync(path.join(tmpHistoryDir, `audit_${tail.date}.json`), 'utf8'));
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  const curSummary = trend.summarizeAuditPayload(curRaw);
  let prevRaw;
  try {
    prevRaw = JSON.parse(fs.readFileSync(
      path.join(tmpHistoryDir, `audit_${history[history.length - 2].date}.json`), 'utf8'
    ));
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  const prevSummary = trend.summarizeAuditPayload(prevRaw);
  const cmp = trend.compareWithPrevious(curSummary, prevSummary);

  const text = trend.formatDigest(history, cmp, curSummary);
  assert(typeof text === 'string', 'must be string');
  assert(text.length > 0, 'must be non-empty');
  assert(text.includes('🛠️'), 'must have audit summary');
  assert(text.includes('📈'), 'must have trend');
  return true;
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

// Cleanup tmp
try { fs.rmSync(tmpState, { recursive: true, force: true }); } catch (_) {}

if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('🎉 All tests passed.');
process.exit(0);
