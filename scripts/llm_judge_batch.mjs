#!/usr/bin/env node
/**
 * llm_judge_batch.mjs — Phase 2: window-gated LLM judge batch runner (shadow mode)
 *
 * Reads .skill_created.jsonl, picks skills created since last batch run
 * (tracked in .llm_judge_last_run.json), and judges each via llm_judge_caller.
 * Logs verdicts to .llm_judge_shadow.jsonl, failures to .llm_judge_failures.jsonl.
 *
 * Token-safety: only runs within 5 minutes after token-refresh slots
 * (04 / 09 / 13 / 18 / 23 HKT). Outside that window, exits 0 silently.
 *
 * Required env:
 *   SHADOW_MODE=true        (otherwise exits 0 silently)
 *
 * Optional env:
 *   SKILL_JUDGE_MAX_BATCH_SIZE   (default 10)
 *
 * Flags:
 *   --quiet      reduce log output
 *   --force      skip window check (for testing only)
 *
 * Exit codes:
 *   0  always (thin executor semantics — pipeline must not fail)
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WS = path.resolve(__dirname, '..');
const JUDGE_LOG = path.join(WS, '.llm_judge_shadow.jsonl');
const FAILURE_LOG = path.join(WS, '.llm_judge_failures.jsonl');
const LAST_RUN_FILE = path.join(WS, '.llm_judge_last_run.json');
const SKILL_LOG = path.join(WS, '.skill_created.jsonl');
const MAX_BATCH = parseInt(process.env.SKILL_JUDGE_MAX_BATCH_SIZE || '10', 10);

const isQuiet = process.argv.includes('--quiet');
const isForce = process.argv.includes('--force');

// Refresh slots and safe window (5 min after each slot, in HKT)
const REFRESH_SLOTS = [4, 9, 13, 18, 23];
const SAFE_WINDOW_MINUTES = 5;

function debug(msg) { if (!isQuiet) console.error('[judge-batch]', msg); }
function info(msg)  { if (!isQuiet) console.log(msg); }
function err(msg)   { console.error('[judge-batch:ERROR]', msg); }

function isWithinRefreshSafeWindow() {
  if (isForce) return true;
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  for (const slot of REFRESH_SLOTS) {
    if (hour === slot && min < SAFE_WINDOW_MINUTES) return true;
  }
  return false;
}

function getLastRunTime() {
  try {
    if (fs.existsSync(LAST_RUN_FILE)) {
      const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8'));
      const t = new Date(data.lastRun).getTime();
      if (!isNaN(t)) return t;
    }
  } catch (_) { /* corrupt file → start from 0 */ }
  return 0;
}

function setLastRunTime() {
  try {
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({ lastRun: new Date().toISOString() }, null, 2), 'utf8');
  } catch (e) {
    err('last_run write failed: ' + e.message);
  }
}

function getUnjudgedSkills(lastRunMs) {
  if (!fs.existsSync(SKILL_LOG)) return [];
  let lines;
  try {
    lines = fs.readFileSync(SKILL_LOG, 'utf8').trim().split('\n');
  } catch (_) { return []; }
  const skills = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev;
    try { ev = JSON.parse(trimmed); } catch (_) { continue; }
    if (ev.validationPassed !== true) continue;
    if (ev.symlinked !== true) continue;
    const eventTs = new Date(ev.ts).getTime();
    if (isNaN(eventTs) || eventTs <= lastRunMs) continue;
    // Keep latest event per skill name (in case of dup events)
    const existing = skills.get(ev.name);
    if (!existing || new Date(existing.ts).getTime() < eventTs) {
      skills.set(ev.name, ev);
    }
  }
  // Sort by ts asc, take up to MAX_BATCH
  return Array.from(skills.values())
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(0, MAX_BATCH);
}

function judgeOneSkill(skillName) {
  const caller = path.join(__dirname, 'llm_judge_caller.mjs');
  try {
    const out = execFileSync('node', [caller, '--skill-name', skillName, '--quiet'], {
      timeout: 65000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const text = (out || '').toString().trim();
    let result;
    try { result = JSON.parse(text); } catch (e) {
      throw new Error('caller returned non-JSON: ' + text.slice(0, 200));
    }
    if (result.consensus) {
      fs.appendFileSync(JUDGE_LOG, JSON.stringify(result) + '\n', 'utf8');
      return result;
    }
    // Caller returned an error envelope
    throw new Error(result.error || 'caller returned no consensus');
  } catch (e) {
    const errEntry = {
      v: 1,
      ts: new Date().toISOString(),
      skillName,
      error: (e.message || String(e)).slice(0, 300),
      skipReason: 'call failed'
    };
    try { fs.appendFileSync(FAILURE_LOG, JSON.stringify(errEntry) + '\n', 'utf8'); }
    catch (writeErr) { err('failure log write: ' + writeErr.message); }
    return { error: e.message, skillName };
  }
}

// ── Main ──
if (process.env.SHADOW_MODE !== 'true') {
  debug('SHADOW_MODE not set — exiting (shadow disabled)');
  process.exit(0);
}

if (!isWithinRefreshSafeWindow()) {
  debug('Outside token-safe window — skipping (silent)');
  process.exit(0);
}

const lastRun = getLastRunTime();
const skills = getUnjudgedSkills(lastRun);
debug('Found ' + skills.length + ' unjudged skills since last run');

if (skills.length === 0) {
  debug('No new skills to judge');
  setLastRunTime();
  process.exit(0);
}

const results = [];
for (let i = 0; i < skills.length; i++) {
  const ev = skills[i];
  debug('Judging: ' + ev.name + ' (' + (i + 1) + '/' + skills.length + ')');
  const r = judgeOneSkill(ev.name);
  results.push(r);
}

setLastRunTime();

const summary = {
  judged: results.filter(r => r.consensus).length,
  failed: results.filter(r => r.error && !r.consensus).length,
  total: skills.length
};

console.log(JSON.stringify(summary));
debug('Batch complete: ' + summary.judged + ' judged, ' + summary.failed + ' failed');

// Always exit 0 — thin executor semantics
process.exit(0);

export { isWithinRefreshSafeWindow, getUnjudgedSkills, judgeOneSkill };
