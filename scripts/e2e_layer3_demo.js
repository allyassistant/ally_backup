#!/usr/bin/env node
/**
 * scripts/e2e_layer3_demo.js — Layer 3 end-to-end demo
 *
 *  1. Run daily_audit_runner --dry-run → captures today's snapshot
 *  2. Build trend with 3 days of fake history → generate digest
 *  3. Build script registry → display summary
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { WS, STATE_DIR } = require('./lib/config');
const reg = require('./lib/script_registry');
const trend = require('./lib/audit_history');

// 1 hour = 60 * 60 seconds (for computing past-day offsets)
const SECONDS_PER_HOUR = 3600;
const MS_PER_DAY = SECONDS_PER_HOUR * 1000 * 24;

const TMP_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'layer3_e2e_'));

console.log('═'.repeat(72));
console.log('  Layer 3 / Phase 3 — End-to-End Demo');
console.log('═'.repeat(72));
console.log(`Workspace:  ${WS}`);
console.log(`Tmp state:  ${TMP_STATE}`);

// ---------------------------------------------------------------
// Step 1: Run daily_audit_runner --dry-run to capture a snapshot
// ---------------------------------------------------------------
console.log('\n┌─ Step 1: Run daily_audit_runner (dry-run)');
console.log('│  Captures today\'s audit snapshot to .state/audit_history/');
console.log('│');

const r1 = spawnSync('node', [
  path.join(WS, 'scripts/audit_daily_cron.js'),
  '--dry-run',
  '--no-discord',
  '--json',
], { cwd: WS, encoding: 'utf8', timeout: 600_000 });

if (r1.status !== 0) {
  console.log('│  ❌ dry-run failed:', r1?.stderr?.slice(0, 500));
} else {
  console.log('│  ✅ dry-run succeeded');
  // Try parsing the JSON envelope
  try {
    const lastLine = r1?.stdout?.trim().split('\n').filter(Boolean).pop();
    const parsed = JSON.parse(lastLine);
    console.log(`│     filesScanned: ${parsed.filesScanned}`);
    console.log(`│     summary.totalIssues: ${parsed.summary?.totalIssues}`);
    console.log(`│     canonicalPath: ${parsed.canonicalPath}`);
  } catch (_) {
    console.log('│  (could not parse JSON envelope)');
  }
}

// Copy today's snapshot into our tmp state dir
const canonicalSrc = path.join(STATE_DIR, 'audit_orchestrator_results.json');
let todaySnapshot = null;
if (fs.existsSync(canonicalSrc)) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(canonicalSrc, 'utf8'));
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  const tmpHistoryDir = path.join(TMP_STATE, 'audit_history');
  try {
    fs.mkdirSync(tmpHistoryDir, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }

  // Today's snapshot (Day 3)
  const today = trend.formatDate();
  const todayPath = path.join(tmpHistoryDir, `audit_${today}.json`);
  try {
    fs.writeFileSync(todayPath, JSON.stringify(payload));
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  todaySnapshot = payload;
  console.log(`│  📸 Today snapshot: ${todayPath} (${payload.results?.merged?.length || 0} issues)`);
}

// ---------------------------------------------------------------
// Step 2: Build 3 days of fake history (Day 1 + Day 2), generate digest
// ---------------------------------------------------------------
console.log('\n┌─ Step 2: Build 3-day fake history + generate trend digest');
console.log('│');

const tmpHistoryDir = path.join(TMP_STATE, 'audit_history');
try {
  fs.mkdirSync(tmpHistoryDir, { recursive: true });
} catch (e) {
  console.error(`Directory creation failed: ${e.message}`);
}

// Synthesize Day 1 and Day 2 payloads with realistic shape (use a sample of
// real files so the comparison shows real "new" / "resolved" / "regressed").
function synthPayload(seed, day) {
  // Sample file list from canonical payload so file names look real
  const realFiles = (todaySnapshot?.results?.merged || []).map(i => i.file);
  const sample = (n) => realFiles.slice(0, n);

  // Vary which files appear and at what severity across days
  const dayConfig = {
    1: { take: 30, boost: {}, extra: ['scripts/old_unused_module.js'] },
    2: { take: 35, boost: { 'scripts/cron_health_triage.js': 'critical' }, extra: ['scripts/mid_emerged.js'] },
  };

  const cfg = dayConfig[day];
  const files = sample(cfg.take);
  const merged = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const sev = cfg.boost[f] || (i % 7 === 0 ? 'high' : i % 3 === 0 ? 'medium' : 'low');
    merged.push({
      file: f,
      line: i + 1,
      rule: 'demo',
      severity: sev,
      source: 'local',
      message: `demo issue on ${f}`,
    });
  }
  for (const f of cfg.extra) {
    merged.push({
      file: f,
      line: 1,
      rule: 'demo',
      severity: 'medium',
      source: 'local',
      message: `demo extra on ${f}`,
    });
  }
  return { results: { merged }, summary: { totalIssues: merged.length } };
}

const today = new Date();
const day1 = new Date(today.getTime() - 2 * MS_PER_DAY);
const day2 = new Date(today.getTime() - 1 * MS_PER_DAY);

const day1Stamp = trend.formatDate(day1);
const day2Stamp = trend.formatDate(day2);

try {
  fs.writeFileSync(
    path.join(tmpHistoryDir, `audit_${day1Stamp}.json`),
    JSON.stringify(synthPayload(null, 1))
  );
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
try {
  fs.writeFileSync(
    path.join(tmpHistoryDir, `audit_${day2Stamp}.json`),
    JSON.stringify(synthPayload(null, 2))
  );
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}

const history = trend.loadAuditHistory(TMP_STATE, 7);
console.log(`│  Loaded ${history.length} day(s) of history:`);
for (const h of history) {
  console.log(`│    ${h.date}: ${h.totalIssues} issues, top=${h.topFiles[0]?.file || '-'}`);
}

const curSummary = trend.summarizeAuditPayload(todaySnapshot);
let prevSummary = null;
try {
  prevSummary = trend.summarizeAuditPayload(
    JSON.parse(fs.readFileSync(path.join(tmpHistoryDir, `audit_${day2Stamp}.json`), 'utf8'))
  );
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
const comparison = trend.compareWithPrevious(curSummary, prevSummary);

console.log('│');
console.log(`│  Comparison:`);
console.log(`│    new files:        ${comparison?.new?.length}`);
console.log(`│    resolved files:   ${comparison?.resolved?.length}`);
console.log(`│    regressed files:  ${comparison?.regressed?.length}`);
console.log(`│    persistent files: ${comparison?.persistent?.length}`);

const digest = trend.formatDigest(history, comparison, curSummary);
console.log('│');
console.log('│  ┌── Discord Digest ──────────────────────────────────');
for (const line of digest.split('\n')) {
  console.log(`│  │ ${line}`);
}
console.log('│  └─────────────────────────────────────────────────────');

// ---------------------------------------------------------------
// Step 3: Build script registry + display summary
// ---------------------------------------------------------------
console.log('\n┌─ Step 3: Build script registry');
console.log('│');
reg.clearCache(WS);
const registry = reg.getOrBuild(WS);
const persistPath = reg.persistRegistry(registry);
console.log(`│  Persisted to: ${persistPath}`);

console.log('│');
console.log(`│  Total scripts: ${registry?.summary?.total}`);
console.log('│  By tier:');
for (const [tier, n] of Object.entries(registry?.summary?.byTier)) {
  const pct = ((n / registry?.summary?.total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.min(40, Math.round(n / Math.max(1, registry?.summary?.total) * 40)));
  console.log(`│    ${tier.padEnd(11)} ${String(n).padStart(4)} (${pct}%)  ${bar}`);
}
console.log('│  By extension:');
for (const [ext, n] of Object.entries(registry?.summary?.byExtension)) {
  console.log(`│    .${ext.padEnd(5)} ${n}`);
}

// Sample lookup
console.log('│');
console.log('│  Sample lookups:');
const samples = [
  'scripts/cron_health_triage.js',
  'scripts/daily_audit_runner.js',
  'scripts/session_end.js',
  'scripts/heartbeat.sh',
  'scripts/lib/config.js',
  'scripts/lib/script_registry.js',
  'scripts/lib/audit_history.js',
];
for (const p of samples) {
  const s = reg.getScript(registry, p);
  if (s) {
    console.log(`│    ${p.padEnd(40)} → tier=${s?.tier?.padEnd(10)} size=${s.size}b deps=${s?.dependsOn?.length}`);
  }
}

console.log('│');
console.log('│  Tier distribution:');
const tiers = ['critical', 'production', 'utility', 'debug'];
for (const t of tiers) {
  const list = reg.getScriptsByTier(registry, t);
  console.log(`│    ${t.padEnd(11)} (${list.length}):`);
  for (const s of list.slice(0, 4)) {
    console.log(`│      - ${s.path}`);
  }
  if (list.length > 4) console.log(`│      ... +${list.length - 4} more`);
}

// Cleanup
try { fs.rmSync(TMP_STATE, { recursive: true, force: true }); } catch (_) {}

console.log('\n' + '═'.repeat(72));
console.log('  ✅ End-to-end demo complete');
console.log('═'.repeat(72));
