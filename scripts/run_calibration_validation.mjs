#!/usr/bin/env node
/**
 * run_calibration_validation.mjs — Validate M3 judge against calibration set
 *
 * Reads .calibration_set.json, runs llm_judge_caller.mjs on each skill,
 * compares M3 verdict with groundTruth, computes metrics.
 *
 * Usage:
 *   node scripts/run_calibration_validation.mjs [--quiet]
 *
 * Config (env):
 *   SKILL_JUDGE_TIMEOUT_MS  (default TIMEOUT_MS)
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// ── Constants ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WS = path.resolve(__dirname, '..');
const CALLER = path.join(__dirname, 'llm_judge_caller.mjs');
const CALIB_FILE = path.join(WS, '.calibration_set.json');
const SKILL_DIR = path.join(WS, 'skills-learned');
const ARCHIVE_DIR = path.join(SKILL_DIR, '_archive');
const RESULT_FILE = path.join(WS, '.calibration_result.json');

const CONFIG = {
  TIMEOUT_MS_DEFAULT: 60000,
  MAX_BUFFER_BYTES: 1024 * 1024,
  REASON_MAX_CHARS: 200,
  PERCENT_MULTIPLIER: 100,
  MS_PER_SECOND: 1000
};
const TIMEOUT_MS = parseInt(process.env.SKILL_JUDGE_TIMEOUT_MS || String(CONFIG.TIMEOUT_MS_DEFAULT), 10);
const MAX_BUFFER_BYTES = CONFIG.MAX_BUFFER_BYTES;
const REASON_MAX_CHARS = CONFIG.REASON_MAX_CHARS;
const PERCENT_MULTIPLIER = CONFIG.PERCENT_MULTIPLIER;
const MS_PER_SECOND = CONFIG.MS_PER_SECOND;
const isQuiet = process.argv.includes('--quiet');

// Temp symlink prefix for archived skills
const TMP_PREFIX = '.calib-';

// ── Helpers ──
function log(msg) { if (!isQuiet) console.error('[calib]', msg); }
function ratioToPctStr(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator * PERCENT_MULTIPLIER).toFixed(1) : 'N/A';
}
function f1Ratio(tp, fp, fn) {
  return (tp + fp + fn) > 0 ? (2 * tp / (2 * tp + fp + fn) * PERCENT_MULTIPLIER).toFixed(1) : 'N/A';
}
function msToSeconds(ms) { return (ms / MS_PER_SECOND).toFixed(0); }

function resolveSkillDir(skillName, source) {
  // source format: "_archive/quarantine-2026-06-10/xxx" or "_archive/quarantine-12345-xxx" or "_archive/xxx"
  if (!source || source.startsWith('_archive/')) {
    const fullPath = path.join(SKILL_DIR, source);
    if (fs.existsSync(path.join(fullPath, 'SKILL.md'))) return fullPath;
    // Try searching for the skill in archive dirs
    if (fs.existsSync(ARCHIVE_DIR)) {
      let dirs;
      try { dirs = fs.readdirSync(ARCHIVE_DIR); }
      catch (e) { return null; }
      for (const d of dirs) {
        const candidate = path.join(ARCHIVE_DIR, d);
        if (!fs.statSync(candidate).isDirectory()) continue;
        if (d.includes(skillName) && fs.existsSync(path.join(candidate, 'SKILL.md'))) {
          return candidate;
        }
        // Check inside the dir for matching subdir
        let subFiles = [];
        try { subFiles = fs.readdirSync(candidate); } catch (e) { continue; }
        for (const sf of subFiles) {
          const subPath = path.join(candidate, sf);
          if (fs.statSync(subPath).isDirectory() && sf === skillName) {
            if (fs.existsSync(path.join(subPath, 'SKILL.md'))) return subPath;
          }
        }
        // Check if quarantine dir IS the skill: quarantine-xxxx-name
        if (d.startsWith('quarantine') && d.endsWith(skillName)) {
          if (fs.existsSync(path.join(candidate, 'SKILL.md'))) return candidate;
        }
      }
    }
  }
  // Default: try skills-learned/<name>
  return path.join(SKILL_DIR, skillName);
}

function makeTempLink(skillName, actualDir) {
  // Creates skills-learned/.calib-<skillName> -> actualDir
  // Returns null on failure, tmpLink name on success
  const tmpLink = path.join(SKILL_DIR, TMP_PREFIX + skillName);
  try {
    if (fs.existsSync(tmpLink)) fs.unlinkSync(tmpLink);
    const relTarget = path.relative(SKILL_DIR, actualDir);
    fs.symlinkSync(relTarget, tmpLink);
    log(`Symlinked ${tmpLink} -> ${relTarget}`);
    return tmpLink;
  } catch (e) {
    log('Failed to symlink: ' + e.message);
    return null;
  }
}

function removeTempLink(skillName) {
  const tmpLink = path.join(SKILL_DIR, TMP_PREFIX + skillName);
  try { if (fs.existsSync(tmpLink)) fs.unlinkSync(tmpLink); }
  catch (_) {}
}

function callJudge(skillName, judgeName) {
  try {
    const out = execFileSync('node', [CALLER, '--skill-name', judgeName, '--quiet'], {
      cwd: WS,
      env: Object.assign({}, process.env, {
        SKILL_LLM_JUDGE_ACTIVE: 'false',
        SKILL_JUDGE_SINGLE: 'true',
        SKILL_JUDGE_WORKSPACE: WS,
        SKILL_JUDGE_TIMEOUT_MS: String(TIMEOUT_MS)
      }),
      timeout: TIMEOUT_MS * 2,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(out.trim());
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    return {
      error: true,
      skillName,
      judgeName,
      message: stderr || e.message || String(e),
      verdict: null,
      action: 'error'
    };
  }
}

// ── Main ──
function main() {
  const startTotal = Date.now();

  if (!fs.existsSync(CALIB_FILE)) {
    console.error('Calibration file not found: ' + CALIB_FILE);
    process.exit(1);
  }

  let calib;
  try {
    calib = JSON.parse(fs.readFileSync(CALIB_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read calibration file: ' + e.message);
    process.exit(1);
  }
  if (!calib._summary.readyForValidation) {
    console.error('Calibration set not ready: joshReviewed must be true');
    process.exit(1);
  }

  // Flatten good + junk
  const entries = [
    ...calib.good.map(e => ({ ...e, groundTruth: 'good' })),
    ...calib.junk.map(e => ({ ...e, groundTruth: 'junk' }))
  ];

  log(`Validating ${entries.length} entries...`);

  let results = [];
  let passCount = 0, failCount = 0, errorCount = 0;
  let tp = 0, tn = 0, fp = 0, fn = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { skillName, groundTruth, source } = entry;

    log(`[${i+1}/${entries.length}] ${skillName} (groundTruth=${groundTruth})`);

    // Find the actual SKILL.md location
    const actualDir = resolveSkillDir(skillName, source);
    if (!actualDir || !fs.existsSync(path.join(actualDir, 'SKILL.md'))) {
      log(`  ERROR: SKILL.md not found for ${skillName}`);
      results.push({ skillName, groundTruth, verdict: null, action: 'error', message: 'SKILL.md not found' });
      errorCount++;
      continue;
    }

    // Determine judge name: live skill uses natural name, archived uses temp link
    const naturalPath = path.join(SKILL_DIR, skillName);
    const hasNatural = fs.existsSync(path.join(naturalPath, 'SKILL.md'));
    let judgeName = skillName;
    let needsCleanup = false;

    if (!hasNatural) {
      // Archived: create temp symlink
      const linkPath = makeTempLink(skillName, actualDir);
      if (!linkPath) {
        log(`  ERROR: Cannot create symlink for ${skillName}`);
        results.push({ skillName, groundTruth, verdict: null, action: 'error', message: 'Cannot symlink' });
        errorCount++;
        continue;
      }
      judgeName = TMP_PREFIX + skillName;
      needsCleanup = true;
    }

    const judgeResult = callJudge(skillName, judgeName);
    const verdict = judgeResult.judge1?.verdict;
    const classification = (verdict === 'pass') ? 'good'
                        : (verdict === 'junk') ? 'junk'
                        : 'error';

    if (groundTruth === 'good' && classification === 'good') { tp++; passCount++; }
    else if (groundTruth === 'junk' && classification === 'junk') { tn++; passCount++; }
    else if (groundTruth === 'good' && classification === 'junk') { fn++; failCount++; }
    else if (groundTruth === 'junk' && classification === 'good') { fp++; failCount++; }
    else { errorCount++; }

    results.push({
      skillName, groundTruth,
      m3Verdict: verdict,
      classification,
      correct: groundTruth === classification,
      latencyMs: judgeResult.judge1?.latencyMs || 0,
      m3Reason: (judgeResult.judge1?.reason || '').slice(0, REASON_MAX_CHARS)
    });

    log(`  verdict=${verdict} | correct=${groundTruth === classification} | latency=${judgeResult.judge1?.latencyMs || '?'}ms`);

    if (needsCleanup) removeTempLink(skillName);
  }

  const total = entries.length;
  const accuracy = ratioToPctStr(tp + tn, total);
  const precisionStr = ratioToPctStr(tp, tp + fp);
  const recallStr = ratioToPctStr(tp, tp + fn);
  const f1Str = f1Ratio(tp, fp, fn);

  const output = {
    v: 1,
    ts: new Date().toISOString(),
    summary: {
      total, passed: passCount, failed: failCount, errors: errorCount,
      accuracy: accuracy + '%',
      precision: precisionStr + '%',
      recall: recallStr + '%',
      f1: f1Str + '%',
      truePositive: tp, trueNegative: tn,
      falsePositive: fp, falseNegative: fn
    },
    thresholds: { accuracy: '>=90%', precision: '>=95%', recall: '>=85%', f1: '>=87%' },
    durationMs: Date.now() - startTotal,
    results
  };

  // Write result file
  try { fs.writeFileSync(RESULT_FILE, JSON.stringify(output, null, 2), 'utf8'); }
  catch (e) { console.error('Failed to write result file: ' + e.message); }

  log(`Done in ${msToSeconds(Date.now() - startTotal)}s`);
  console.log(JSON.stringify(output.summary, null, 2));
}

main();
