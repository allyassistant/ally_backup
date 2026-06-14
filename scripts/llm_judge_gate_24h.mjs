#!/usr/bin/env node
/**
 * llm_judge_gate_24h.mjs — Phase 3: 24h Adaptive Gate evaluator
 *
 * Reads .llm_judge_shadow.jsonl, evaluates 6 metrics against the Option C spec,
 * and outputs a structured PASS / EXTEND-72h / ABORT verdict as a single-line
 * JSON object on stdout. Designed to run after 24h of shadow data has
 * accumulated (pipeline runs every 30 min on 5 batch windows/day).
 *
 * Usage:
 *   node scripts/llm_judge_gate_24h.mjs [--quiet] [--brief]
 *   node scripts/llm_judge_gate_24h.mjs --help
 *
 * Flags:
 *   --quiet    suppress non-JSON stderr (for cron / piping)
 *   --brief    output just the verdict line, no full JSON
 *   --help     show usage
 *
 * Optional env:
 *   OPENCLAW_WS    workspace root (default: parent of script dir)
 *
 * Exit codes:
 *   0  always (thin executor semantics — caller decides what to do with verdict)
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──
const WS = process.env.OPENCLAW_WS || path.resolve(__dirname, '..');
const JUDGE_LOG = path.join(WS, '.llm_judge_shadow.jsonl');
const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 3600 * 1000;

// ── Parse args ──
const isQuiet = process.argv.includes('--quiet');
const isBrief = process.argv.includes('--brief');
const isHelp = process.argv.includes('--help');

if (isHelp) {
  console.log(
    `llm_judge_gate_24h.mjs — Phase 3 24h Adaptive Gate evaluator

Usage:
  node scripts/llm_judge_gate_24h.mjs [flags]

Flags:
  --quiet    suppress non-JSON stderr (for cron / piping)
  --brief    output just the verdict line, no full JSON
  --help     show this help

Reads:   \${WS}/.llm_judge_shadow.jsonl
Window:  last 24h, shadowMode == true
Output:  single-line JSON to stdout (or one-line verdict if --brief)

Verdicts:
  PASS        all 6 metrics pass thresholds → proceed to Phase 3 active judge
  EXTEND-72h  mixed pass / gray → run another 24h shadow window
  ABORT       any hard veto → re-audit prompt, model, or cost
`
  );
  process.exit(0);
}

function debug(msg) { if (!isQuiet) console.error('[judge-gate]', msg); }
function err(msg)   { console.error('[judge-gate:ERROR]', msg); }

// ── I/O helpers ──
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    })
    .filter(Boolean);
}

function parseTs(ts) {
  if (ts == null) return NaN;
  if (typeof ts === 'number') return ts;
  const t = new Date(ts).getTime();
  return isNaN(t) ? NaN : t;
}

// ── 6-metric threshold tables (Option C spec) ──
const THRESHOLDS = {
  // ≥4 pass, 2-3 extend, <2 abort
  validSamples: (v) => (v >= 4 ? 'PASS' : v >= 2 ? 'EXTEND-72h' : 'ABORT'),
  // 100% pass, 75-99% extend, <75% abort
  bothJudgeSuccess: (v) => (v >= 100 ? 'PASS' : v >= 75 ? 'EXTEND-72h' : 'ABORT'),
  // 0 pass, N/A, ≥1 abort
  catastrophicMismatches: (v) => (v === 0 ? 'PASS' : 'ABORT'),
  // ≤25% pass, 26-50% extend, >50% abort
  splitRate: (v) => (v <= 25 ? 'PASS' : v <= 50 ? 'EXTEND-72h' : 'ABORT'),
  // 0% pass, N/A, ≥1 abort  (any occurrence = veto)
  bothJunkOnHeuristicPass: (v) => (v === 0 ? 'PASS' : 'ABORT'),
  // ≤$0.05 pass, $0.05-0.10 extend, >$0.10 abort
  costPerSkill: (v) => (v <= 0.05 ? 'PASS' : v <= 0.10 ? 'EXTEND-72h' : 'ABORT'),
};

// ── Read + filter ──
const all = readJsonl(JUDGE_LOG);
const now = Date.now();
const cutoff = now - WINDOW_MS;

const inWindow = all.filter((e) => {
  const t = parseTs(e.ts);
  return !isNaN(t) && t >= cutoff;
});
const totalEvents = inWindow.length;
const qualifying = inWindow.filter((e) => e.shadowMode === true);
const qualifyingEvents = qualifying.length;

debug(`Total in window: ${totalEvents}, qualifying (shadowMode=true): ${qualifyingEvents}`);

// ── Metric 1: valid samples (parsed, non-error consensus) ──
const validEvents = qualifying.filter((e) => e.consensus && e.consensus !== 'error');
const validSamples = validEvents.length;

// ── Metric 2: both-judge call success ──
const bothOkCount = qualifying.filter(
  (e) => e.judge1 && e.judge2 && e.judge1.ok === true && e.judge2.ok === true
).length;
const bothJudgeSuccess = qualifyingEvents > 0
  ? +(bothOkCount / qualifyingEvents * 100).toFixed(1)
  : 0;

// ── Metric 3: catastrophic mismatches (heuristic passed ∧ both judges said junk) ──
const catastrophicMismatches = qualifying.filter(
  (e) =>
    e.heuristicResult &&
    e.heuristicResult.validationPassed === true &&
    e.consensus === 'both-junk'
).length;

// ── Metric 4: split rate (judges disagree) ──
const splitCount = qualifying.filter((e) => e.consensus === 'split').length;
const splitRate = qualifyingEvents > 0
  ? +(splitCount / qualifyingEvents * 100).toFixed(1)
  : 0;

// ── Metric 5: both-junk rate on heuristic-passed ──
const heuristicPassedCount = qualifying.filter(
  (e) => e.heuristicResult && e.heuristicResult.validationPassed === true
).length;
const bothJunkOnHeuristicPass = heuristicPassedCount > 0
  ? +((catastrophicMismatches / heuristicPassedCount) * 100).toFixed(1)
  : 0;

// ── Metric 6: cost per skill ──
const totalCost = qualifying.reduce((s, e) => s + (e.costUsd || 0), 0);
const costPerSkill = qualifyingEvents > 0
  ? +(totalCost / qualifyingEvents).toFixed(4)
  : 0;

// ── Evaluate per-metric thresholds ──
const metrics = {
  validSamples:            { value: validSamples,            threshold: THRESHOLDS.validSamples(validSamples) },
  bothJudgeSuccess:        { value: bothJudgeSuccess,        threshold: THRESHOLDS.bothJudgeSuccess(bothJudgeSuccess) },
  catastrophicMismatches:  { value: catastrophicMismatches,  threshold: THRESHOLDS.catastrophicMismatches(catastrophicMismatches) },
  splitRate:               { value: splitRate,               threshold: THRESHOLDS.splitRate(splitRate) },
  bothJunkOnHeuristicPass: { value: bothJunkOnHeuristicPass, threshold: THRESHOLDS.bothJunkOnHeuristicPass(bothJunkOnHeuristicPass) },
  costPerSkill:            { value: costPerSkill,            threshold: THRESHOLDS.costPerSkill(costPerSkill) },
};

// ── Aggregate verdict ──
const metricEntries = Object.entries(metrics);
const aborts = metricEntries.filter(([, m]) => m.threshold === 'ABORT').map(([k]) => k);
const extends72h = metricEntries.filter(([, m]) => m.threshold === 'EXTEND-72h').map(([k]) => k);
const passes = metricEntries.filter(([, m]) => m.threshold === 'PASS').map(([k]) => k);

let verdict;
let reason;
let manualActions;

if (aborts.length > 0) {
  verdict = 'ABORT';
  reason = `Hard veto on ${aborts.length} metric(s): ${aborts.join(', ')}`;
  manualActions = [
    `Inspect abort metric(s): ${aborts.join(', ')}`,
    'Review raw .llm_judge_shadow.jsonl + .llm_judge_failures.jsonl',
    'Re-audit judge prompt / model choice before re-running shadow',
  ];
} else if (extends72h.length === 0 && passes.length === 6) {
  verdict = 'PASS';
  reason = 'All 6 metrics pass thresholds';
  manualActions = [
    'Set cron env: SKILL_LLM_JUDGE_ACTIVE=true',
    'Monitor 7-day post-activation junk rate',
  ];
} else {
  verdict = 'EXTEND-72h';
  const parts = [];
  if (extends72h.length > 0) parts.push(`gray: ${extends72h.join(', ')}`);
  if (passes.length > 0) parts.push(`pass: ${passes.length}/6`);
  reason = `Continue shadow — ${parts.join('; ')}`;
  manualActions = [
    'Continue shadow mode for another 24h window',
    `Focus investigation on: ${extends72h.join(', ') || '—'}`,
  ];
}

// ── Build output ──
const output = {
  v: 1,
  ts: new Date(now).toISOString(),
  windowStart: new Date(cutoff).toISOString(),
  windowEnd: new Date(now).toISOString(),
  totalEvents,
  qualifyingEvents,
  metrics,
  verdict,
  reason,
  manualActions,
};

if (isBrief) {
  // Single-line verdict summary (still goes to stdout; --quiet only silences stderr)
  console.log(`${verdict} | ${reason}`);
} else {
  // Single-line JSON, no pretty-print
  console.log(JSON.stringify(output));
}

process.exit(0);
