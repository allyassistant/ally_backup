#!/usr/bin/env node
/**
 * llm_judge_calibration.mjs — Phase 2: shadow-mode calibration report
 *
 * After 7+ days of shadow data, compares LLM judge verdicts against
 * heuristic pass/fail signal from .skill_created.jsonl. Surfaces:
 *   - consistency rate (agreement between M3 + deepseek-flash)
 *   - mismatches (heuristic passed but both judges said junk)
 *   - disagreements (split verdicts)
 *   - failure rate
 *   - cost estimate
 *   - recommendation: proceed to Phase 3 (active judge) OR extend shadow
 *
 * Usage:
 *   node scripts/llm_judge_calibration.mjs [--days N] [--format cli|discord|markdown]
 *
 * Flags:
 *   --days N          analysis window in days (default 7)
 *   --format FMT      cli (default, stdout + .md file) | discord (push to #⚙️system)
 *   --force           run even with insufficient data
 *
 * Output:
 *   - stdout: human-readable report
 *   - .llm_judge_calibration_report.md: persistent report
 *   - if --format discord: also pushed to channel 1473376125584670872 via openclaw CLI
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const discord = require('./lib/discord_push.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WS = path.resolve(__dirname, '..');
const JUDGE_LOG = path.join(WS, '.llm_judge_shadow.jsonl');
const FAILURE_LOG = path.join(WS, '.llm_judge_failures.jsonl');
const REPORT_PATH = path.join(WS, '.llm_judge_calibration_report.md');
const DISCORD_CHANNEL = '1473376125584670872'; // #⚙️系統

// ── Parse args ──
let DAYS = 7;
const daysArg = process.argv.indexOf('--days');
if (daysArg >= 0) DAYS = parseInt(process.argv[daysArg + 1] || '7', 10);

let FORMAT = 'cli';
const formatArg = process.argv.indexOf('--format');
if (formatArg >= 0) FORMAT = process.argv[formatArg + 1] || 'cli';
const isForce = process.argv.includes('--force');

function debug(msg) { console.error('[judge-cal]', msg); }
function err(msg)   { console.error('[judge-cal:ERROR]', msg); }

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  return text.trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

// ── Read shadow logs ──
const allEntries = readJsonl(JUDGE_LOG);
const cutoff = Date.now() - DAYS * 86400000;
const entries = allEntries.filter((e) => {
  const t = new Date(e.ts).getTime();
  return !isNaN(t) && t >= cutoff;
});

const failures = readJsonl(FAILURE_LOG).filter((f) => {
  const t = new Date(f.ts).getTime();
  return !isNaN(t) && t >= cutoff;
});

// ── Stats ──
const total = entries.length;
const bothPass = entries.filter((e) => e.consensus === 'both-pass').length;
const bothJunk = entries.filter((e) => e.consensus === 'both-junk').length;
const split    = entries.filter((e) => e.consensus === 'split').length;
const skip     = entries.filter((e) => e.consensus === 'skip').length;
const errors   = entries.filter((e) => e.consensus === 'error').length;

// Mismatch: heuristic passed + both judges said junk
const mismatches = entries.filter((e) =>
  e.consensus === 'both-junk' &&
  e.heuristicResult && e.heuristicResult.validationPassed === true
);

// Heuristic missed: heuristic failed + both judges said pass
const heuristicMissed = entries.filter((e) =>
  e.consensus === 'both-pass' &&
  e.heuristicResult && e.heuristicResult.validationPassed === false
);

const costTotal = entries.reduce((s, e) => s + (e.costUsd || 0), 0);
const consistency = total > 0 ? ((bothPass + bothJunk) / total * 100).toFixed(1) : 'N/A';
const mismatchRate = total > 0 ? (mismatches.length / total * 100).toFixed(1) : '0.0';
const failureRate = (allEntries.length + failures.length) > 0
  ? (failures.length / (allEntries.length + failures.length) * 100).toFixed(1)
  : '0.0';

// ── Build report ──
const report = [];
report.push('');
report.push('# 📊 Phase 2 LLM Judge Calibration Report');
report.push('');
report.push('**Period:** Last ' + DAYS + ' days  |  **Generated:** ' + new Date().toISOString());
report.push('');
report.push('## Summary');
report.push('');
report.push('| Metric | Value |');
report.push('|--------|-------|');
report.push('| Total skills judged | ' + total + ' |');
report.push('| Consistency (agreement) | ' + consistency + '% |');
report.push('| Both pass | ' + bothPass + ' |');
report.push('| Both junk | ' + bothJunk + ' |');
report.push('| Split (disagreement) | ' + split + ' |');
report.push('| Skip (one judge failed) | ' + skip + ' |');
report.push('| Error (both failed) | ' + errors + ' |');
report.push('| Mismatch rate (heuristic pass → both-junk) | ' + mismatchRate + '% |');
report.push('| Heuristic missed (heuristic fail → both-pass) | ' + heuristicMissed.length + ' |');
report.push('| Judge call failures | ' + failures.length + ' (' + failureRate + '%) |');
report.push('| Cost estimate (USD) | $' + costTotal.toFixed(2) + ' |');
report.push('');

report.push('## Mismatched Skills (heuristic pass → both judges say junk)');
report.push('');
if (mismatches.length === 0) {
  report.push('*(none)*');
} else {
  for (const m of mismatches) {
    const reason = (m.judge1 && m.judge1.reason) ? m.judge1.reason : 'N/A';
    report.push('- `' + m.skillName + '` — ' + reason);
  }
}
report.push('');

report.push('## Heuristic Misses (heuristic fail → both judges say pass)');
report.push('');
if (heuristicMissed.length === 0) {
  report.push('*(none)*');
} else {
  for (const m of heuristicMissed) {
    const reason = (m.judge1 && m.judge1.reason) ? m.judge1.reason : 'N/A';
    report.push('- `' + m.skillName + '` — ' + reason);
  }
}
report.push('');

// ── Recommendation logic ──
const consistencyNum = consistency === 'N/A' ? 0 : parseFloat(consistency);
const mismatchNum = parseFloat(mismatchRate);
const costOk = costTotal <= 25;
const sampleOk = total >= 20;  // minimum sample size

let recommendPhase3 = false;
let extendShadow = false;
let insufficientData = false;

if (!sampleOk) {
  insufficientData = true;
  report.push('## Verdict Recommendation');
  report.push('');
  report.push('- ⏸️ **Insufficient data** (' + total + ' judged, need ≥20)');
  report.push('  - Shadow has not accumulated enough samples yet');
  report.push('  - Continue shadow mode; re-run calibration in ' + DAYS + ' days');
} else if (consistencyNum >= 70 && mismatchNum <= 20 && costOk) {
  recommendPhase3 = true;
  report.push('## Verdict Recommendation');
  report.push('');
  report.push('- ✅ **Phase 3 ready** — all criteria met:');
  report.push('  - consistency ' + consistency + '% ≥ 70% target');
  report.push('  - mismatch ' + mismatchRate + '% ≤ 20% target');
  report.push('  - cost $' + costTotal.toFixed(2) + ' ≤ $25 budget');
  report.push('  - sample size ' + total + ' ≥ 20');
} else {
  extendShadow = true;
  report.push('## Verdict Recommendation');
  report.push('');
  report.push('- ⏳ **Extend shadow mode** — criteria not yet met:');
  if (consistencyNum < 70) report.push('  - consistency ' + consistency + '% < 70% target');
  if (mismatchNum > 20)     report.push('  - mismatch ' + mismatchRate + '% > 20% target');
  if (!costOk)              report.push('  - cost $' + costTotal.toFixed(2) + ' > $25 budget');
}
report.push('');

report.push('## Next Steps');
report.push('');
if (recommendPhase3) {
  report.push('1. Proceed to **Phase 3 Active Judge**');
  report.push('2. Enable `SKILL_LLM_JUDGE_ACTIVE=true` in cron');
  report.push('3. Monitor 1-week junk rate after activation');
  report.push('4. Set `S1 mismatch` escalation back to automatic if consistency holds');
} else if (extendShadow) {
  report.push('1. **Extend shadow mode** for another ' + DAYS + ' days');
  report.push('2. Re-run calibration to confirm improvement');
  report.push('3. If still not meeting criteria, audit judge prompt + model choice');
} else if (insufficientData) {
  report.push('1. Continue shadow mode until ≥20 samples accumulate');
  report.push('2. Re-run calibration after sufficient data');
} else {
  report.push('1. Review raw shadow log for anomalies');
  report.push('2. Check `.llm_judge_failures.jsonl` for systemic issues');
}
report.push('');

const reportMd = report.join('\n');

// ── Persist + output ──
try { fs.writeFileSync(REPORT_PATH, reportMd, 'utf8'); }
catch (e) { err('report write failed: ' + e.message); }

console.log(reportMd);
debug('Report written to: ' + REPORT_PATH);

// ── Discord push (if requested) ──
if (FORMAT === 'discord') {
  const tmpFile = path.join(WS, '.llm_judge_calibration_tmp.md');
  let pushOk = false;
  try {
    // Write report to a temp file (multi-line content needs file input, not argv)
    fs.writeFileSync(tmpFile, reportMd, 'utf8');
    const result = discord.push({ media: tmpFile, target: 'channel:' + DISCORD_CHANNEL, timeoutMs: 15000 });
    if (!result.ok) {
      err('Discord push failed: ' + result.error);
      console.log('\n[fallback] Manual: cat ' + REPORT_PATH + ' | openclaw message send --channel ' + DISCORD_CHANNEL);
    } else {
      pushOk = true;
      debug('Report pushed to Discord #' + DISCORD_CHANNEL);
    }
  } catch (e) {
    err('Discord push failed: ' + e.message);
    console.log('\n[fallback] Manual: cat ' + REPORT_PATH + ' | openclaw message send --channel ' + DISCORD_CHANNEL);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}
