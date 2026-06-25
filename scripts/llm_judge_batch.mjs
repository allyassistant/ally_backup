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
const ACTIVE_LOG = path.join(WS, '.llm_judge_active.jsonl');
const FAILURE_LOG = path.join(WS, '.llm_judge_failures.jsonl');
const LAST_RUN_FILE = path.join(WS, '.llm_judge_last_run.json');
const SKILL_LOG = path.join(WS, '.skill_created.jsonl');
const MAX_BATCH = parseInt(process.env.SKILL_JUDGE_MAX_BATCH_SIZE || '10', 10);
const ACTIVE_MODE = process.env.SKILL_LLM_JUDGE_ACTIVE === 'true';

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

// ── Plan C Fix #1: early-skip gate for stable + symlinked skills ──
// Re-emit noise reduction (2026-06-24). A skill that has been active +
// symlinked for >STABLE_SKIP_HOURS hours is considered stable; running
// the LLM judge on it again wastes tokens (cantonese-exec-loop-recovery
// was being re-judged 5-8x/day). Returns true only if the SKILL.md has
// a fresh symlink AND the mtime is within the stable window.
// Env: SKILL_STABLE_SKIP_HOURS (default 24).
const STABLE_SKIP_HOURS = (() => {
  const v = parseInt(process.env.SKILL_STABLE_SKIP_HOURS, 10);
  return Number.isFinite(v) && v > 0 ? v : 24;
})();
const STABLE_SKIP_MS = STABLE_SKIP_HOURS * 3600 * 1000;
const SKILLS_ACTIVE_DIR = path.join(WS, 'skills');
const SKILLS_LEARNED_DIR = path.join(WS, 'skills-learned');

function isStableSymlinked(skillName) {
  try {
    const skillDir = path.join(SKILLS_LEARNED_DIR, skillName);
    const symlinkPath = path.join(SKILLS_ACTIVE_DIR, '_learned_' + skillName);
    if (!fs.existsSync(symlinkPath)) return false;
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) return false;
    const stat = fs.statSync(skillMd);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < STABLE_SKIP_MS;
  } catch (_) { return false; }
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
  // Sort by ts asc, then drop skills that are already stable + symlinked.
  // These don't need re-judging — the LLM verdict would be the same as last time
  // and re-emit noise dominates the M3 cost (~$0.30/day all-sources, $0.10/day cantonese).
  return Array.from(skills.values())
    .filter(s => !isStableSymlinked(s.name))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(0, MAX_BATCH);
}

function judgeOneSkill(skillName) {
  const caller = path.join(__dirname, 'llm_judge_caller.mjs');
  try {
    // Active mode (single judge M3) vs shadow mode (dual judge)
    const envOverride = ACTIVE_MODE
      ? Object.assign({}, process.env, { SKILL_JUDGE_SINGLE: 'true', SKILL_LLM_JUDGE_ACTIVE: 'true' })
      : Object.assign({}, process.env, { SKILL_LLM_JUDGE_ACTIVE: 'false' });
    const out = execFileSync('node', [caller, '--skill-name', skillName, '--quiet'], {
      env: envOverride,
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
      // C3-fix 2026-06-18: active mode writes to .llm_judge_active.jsonl
      // (was co-mingled with shadow log). Keeps shadow.jsonl → shadow-only,
      // active.jsonl → active-only. Gate evaluator reads shadow.jsonl only.
      const logFile = (result.activeMode === true) ? ACTIVE_LOG : JUDGE_LOG;
      fs.appendFileSync(logFile, JSON.stringify(result) + '\n', 'utf8');
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
const modeActive = process.env.SKILL_LLM_JUDGE_ACTIVE === 'true';
if (process.env.SHADOW_MODE !== 'true' && !modeActive) {
  debug('Neither SHADOW_MODE nor SKILL_LLM_JUDGE_ACTIVE set — exiting');
  process.exit(0);
}
if (modeActive) {
  debug('Active judge mode — running M3-only single-judge closer');
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

export { isWithinRefreshSafeWindow, getUnjudgedSkills, judgeOneSkill, isStableSymlinked };
