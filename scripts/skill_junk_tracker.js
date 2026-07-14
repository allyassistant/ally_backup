#!/usr/bin/env node
/**
 * skill_junk_tracker.js - Daily skill pipeline health (#150, split metrics)
 * ==========================================================================
 * Computes two independent metrics over a time window:
 *   1. Validator Catch Rate = rejected / total       (target ≥25%, higher better)
 *   2. Junk-in-Production   = (passed ∩ quarantined) / passed  (target <10%)
 *
 * Why split? The original single metric (failed/total) is misleading once the
 * validator is working — it grows as the validator catches more junk, so the
 * number gets "worse" while the system is actually improving. The two split
 * metrics decouple validator health from junk-in-production health.
 *
 * The legacy `junkRatePercent` field is preserved (== validator catch rate)
 * for backward compatibility, but new consumers should use the two split
 * fields. `junkRatePercent` is now considered deprecated.
 *
 * Trigger: cron daily 23:55 HKT
 *
 * Usage:
 *   node skill_junk_tracker.js             # past 24h
 *   node skill_junk_tracker.js --days 7    # past 7 days
 *   node skill_junk_tracker.js --json     # JSON output
 *   node skill_junk_tracker.js --quiet    # silent (log only)
 *
 * VERSION: 2.1.0
 * AUTHOR: Ally (2026-06-12; 2026-07-14 internal-automation filter added)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const WS = os.homedir() + '/.openclaw/workspace';
const LOG_FILE = path.join(WS, '.skill_junk_rate.jsonl');
const SOURCE = path.join(WS, '.skill_created.jsonl');
const ARCHIVE_ROOT = path.join(WS, 'skills-learned', '_archive');

const TARGET_VALIDATOR_CATCH = 25.0;   // percent, ≥ this is good
const TARGET_JUNK_IN_PRODUCTION = 10.0; // percent, < this is good

// ── Internal automation cluster filter ──
// Skills whose names start with any of these prefixes are workspace-internal
// automation (cron jobs, email tooling, heartbeat, HA, etc.). They are needed
// for cron pipelines and have nothing to do with the user-facing skill catalog
// quality. Counting them as "junk" inflates junk rate to 90%+ and triggers
// false-positive auto-pauses. The validator (validate_skill_file.js) is correct
// for normal skills — it just doesn't have context for these internal tools.
// Source of truth: spec from skill_reviewer_bot.js / job description.
// To extend: add to INTERNAL_AUTOMATION_PREFIXES below; no other change needed.
const INTERNAL_AUTOMATION_PREFIXES = [
  'cron', 'email', 'ha-', 'bliss', 'failover',
  'daily-', 'weekly-', 'skill-',
  'heartbeat', 'anomaly', 'subagent', 'wiki', 'memory',
  'llm', 'connection', 'pattern'
];
// Reasons that indicate the validator successfully caught a problem WITHOUT
// landing any junk in the catalog. These events are also excluded from junk
// counting because they represent "validator worked correctly" — landing a
// flag, not landing a junk skill.
//   - 'post-llm pre-emit skip' : pre-emit dedup caught LLM regen-of-existing
//   - 'P5 same_name_exact_match': cross-source dedup rejected duplicate
//   - 'self-referential block (QW-2)' : QW-2 filter blocked self-ref skill
const NOISE_REASON_PATTERNS = [
  /post-llm pre-emit skip/,
  /P5 same_name_exact_match/,
  /self-referential block/,
];

function isInternalAutomation(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return INTERNAL_AUTOMATION_PREFIXES.some(function (p) { return n.indexOf(p) === 0; });
}

function isNoiseReason(reason) {
  if (!reason) return false;
  return NOISE_REASON_PATTERNS.some(function (re) { return re.test(reason); });
}

/**
 * Decide whether an event should count toward junk-rate stats.
 * Returns false (exclude from stats) when:
 *   - skill name is internal-automation prefix, OR
 *   - failure reason is a "validator caught it, no junk landed" signal
 * Returns true (count toward stats) only for events representing real
 * production-quality concerns for user-facing skills.
 */
function shouldCountForStats(ev) {
  if (isInternalAutomation(ev.name)) return false;
  if (ev.validationPassed === false && isNoiseReason(ev.reason)) return false;
  return true;
}

// Parse args
const args = process.argv.slice(2);
const days = (() => {
  const i = args.indexOf('--days');
  return i >= 0 ? parseInt(args[i + 1], 10) : 1;
})();
const jsonOnly = args.includes('--json');
const quiet = args.includes('--quiet');

function log(msg) { if (!quiet) console.log(msg); }

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Read .skill_created.jsonl and filter events within the time window.
 * @param {number} windowDays
 * @returns {Array<{ts: string, validationPassed: boolean, name: string, reason: string}>}
 */
function readEvents(windowDays) {
  if (!fs.existsSync(SOURCE)) return [];

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  let lines = [];
  try {
    lines = fs.readFileSync(SOURCE, 'utf8').trim().split('\n').filter(Boolean);
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
    return [];
  }

  const events = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (!e.ts) continue;
      const ts = new Date(e.ts).getTime();
      if (isNaN(ts)) continue;
      if (ts < cutoff) continue;
      events.push({
        ts: e.ts,
        validationPassed: e.validationPassed !== false,
        name: e.name || '?',
        reason: e.reason || ''
      });
    } catch (err) {
      // Skip malformed line
    }
  }

  return events;
}

/**
 * Scan skills-learned/_archive/ and return set of quarantined skill names.
 * Handles three observed directory formats:
 *   - quarantine-YYYY-MM-DD/<name>/SKILL.md       (date-based, nested)
 *   - quarantine-<digits>-<name>/SKILL.md         (timestamp-based, flat)
 *   - failed-validations/<name>-<digits>/SKILL.md (timestamp suffix on dir)
 *
 * Skill name extraction:
 *   - Nested format: subdir name is the skill name (e.g. "cron-context-overflow-recovery")
 *   - Flat timestamp format: strip "quarantine-<digits>-" prefix from top dir name
 *   - failed-validations: strip trailing "-<8+ digits>" suffix from subdir name
 *
 * @returns {Set<string>}
 */
function scanQuarantinedSkills() {
  const out = new Set();
  if (!fs.existsSync(ARCHIVE_ROOT)) return out;

  let topEntries = [];
  try {
    topEntries = fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true });
  } catch (e) {
    console.error(`Archive scan failed: ${e.message}`);
    return out;
  }

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    const topName = entry.name;
    const topPath = path.join(ARCHIVE_ROOT, topName);

    // failed-validations: <name>-<digits>/SKILL.md
    if (topName === 'failed-validations') {
      let subs = [];
      try { subs = fs.readdirSync(topPath, { withFileTypes: true }); } catch (e) { continue; }
      for (const sub of subs) {
        if (!sub.isDirectory()) continue;
        const baseName = sub.name.replace(/-\d{8,}$/, '');
        out.add(baseName);
      }
      continue;
    }

    // quarantine-* dirs
    if (topName.startsWith('quarantine-')) {
      let subs = [];
      try { subs = fs.readdirSync(topPath, { withFileTypes: true }); } catch (e) { continue; }
      const subdirs = subs.filter(s => s.isDirectory());

      if (subdirs.length > 0) {
        // Format 1: nested - <skill-name>/SKILL.md inside quarantine-*
        for (const sub of subdirs) {
          out.add(sub.name);
        }
      } else {
        // Format 2: flat - SKILL.md directly in quarantine-<digits>-<skill-name>
        const m = topName.match(/^quarantine-[\d-]+-(.+)$/);
        if (m) out.add(m[1]);
      }
    }
  }

  return out;
}

/**
 * Compute the two split metrics from windowed events + all-time quarantine set.
 *
 * Metric 1 (Validator Catch Rate) uses EVENT counts:
 *   - numerator = events where validationPassed=false
 *   - denominator = all events in window
 *   - N/A (0%) when no events
 *
 * Metric 2 (Junk-in-Production Rate) uses UNIQUE NAME counts:
 *   - numerator = unique passed skill names that are now in quarantine
 *   - denominator = unique passed skill names in window
 *   - null when no passed skills in window (can't compute ratio)
 *
 * Internal automation filter (2026-07-14):
 *   Events whose name matches INTERNAL_AUTOMATION_PREFIXES (cron, email, …)
 *   OR whose failure reason is a "noise" pattern (post-llm dedup skip, etc.)
 *   are EXCLUDED from both metrics. These represent cron-generated skills
 *   and validator-success signals — neither is a junk-in-production risk.
 *   The rawTotal/rawFailed fields are returned for visibility so callers
 *   can audit how much was filtered.
 *
 * @param {Array} events
 * @param {Set<string>} quarantinedNames
 */
function computeStats(events, quarantinedNames) {
  const rawTotal = events.length;
  const rawFailed = events.filter(e => !e.validationPassed).length;

  const statsEvents = events.filter(shouldCountForStats);
  const total = statsEvents.length;
  const passed = statsEvents.filter(e => e.validationPassed).length;
  const failed = total - passed;

  // Metric 1: Validator Catch Rate (event-based) — internal events excluded
  const validatorCatchRate = total === 0 ? 0 : (failed / total) * 100;

  // Metric 2: Junk-in-Production Rate (name-based cross-reference)
  const passedNames = new Set(statsEvents.filter(e => e.validationPassed).map(e => e.name));
  const passedAndQuarantined = [...passedNames].filter(n => quarantinedNames.has(n));
  const junkInProductionRate = passedNames.size > 0
    ? (passedAndQuarantined.length / passedNames.size) * 100
    : null;

  return {
    total,
    passed,
    failed,
    rawTotal,
    rawFailed,
    internalExcluded: rawTotal - total,
    validatorCatchRate: round2(validatorCatchRate),
    junkInProductionRate: junkInProductionRate === null ? null : round2(junkInProductionRate),
    junkRatePercent: round2(validatorCatchRate), // deprecated: equals validatorCatchRate
    passedAndQuarantined,
    failedNames: statsEvents.filter(e => !e.validationPassed).map(e => e.name)
  };
}

function appendLog(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    // best-effort
  }
}

function verdictIcon(pass) {
  return pass ? '✅' : '❌';
}

function main() {
  const events = readEvents(days);
  const quarantinedNames = scanQuarantinedSkills();
  const stats = computeStats(events, quarantinedNames);

  const validatorCatchPass = stats.total > 0 && stats.validatorCatchRate >= TARGET_VALIDATOR_CATCH;
  const junkInProductionPass = stats.junkInProductionRate === null
    ? null
    : stats.junkInProductionRate < TARGET_JUNK_IN_PRODUCTION;

  const result = {
    v: 2,
    ts: new Date().toISOString(),
    windowDays: days,
    windowStart: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    windowEnd: new Date().toISOString(),
    total: stats.total,
    passed: stats.passed,
    failed: stats.failed,
    // Internal automation filter (2026-07-14): how many events were excluded
    // from junk-rate stats because they're cron/internal automation clusters
    // or "validator caught it" noise. rawTotal includes those; total does not.
    rawTotal: stats.rawTotal,
    rawFailed: stats.rawFailed,
    internalExcluded: stats.internalExcluded,
    // New split metrics (v2)
    validatorCatchRate: stats.validatorCatchRate,
    validatorCatchPass,
    junkInProductionRate: stats.junkInProductionRate,
    junkInProductionPass,
    quarantinedCount: stats.passedAndQuarantined.length,
    passedAndQuarantined: stats.passedAndQuarantined,
    // Backward compat (v1 fields, deprecated)
    junkRatePercent: stats.junkRatePercent,
    target: TARGET_JUNK_IN_PRODUCTION,
    passTarget: validatorCatchPass && (junkInProductionPass !== false),
    failedNames: stats.failedNames
  };

  appendLog(result);

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const dayLabel = `past ${days} day${days > 1 ? 's' : ''}`;
    log(`\n📊 Skill Pipeline Health (${dayLabel})`);
    log(`   Total events (raw): ${stats.rawTotal}    (internal-automation excluded: ${stats.internalExcluded})`);
    log(`   Total events (stats): ${stats.total}`);
    log(`   ─────────────────────────────`);
    const catchStr = stats.total === 0 ? 'N/A' : `${stats.validatorCatchRate.toFixed(2)}%`;
    log(`   🛡️  Validator Catch Rate:  ${catchStr} (target ≥${TARGET_VALIDATOR_CATCH}%) ${verdictIcon(validatorCatchPass)}`);
    const junkStr = stats.junkInProductionRate === null ? 'N/A' : `${stats.junkInProductionRate.toFixed(2)}%`;
    const junkVerdict = junkInProductionPass === null ? '⚠️  N/A' : verdictIcon(junkInProductionPass);
    log(`   🎯 Junk-in-Production:    ${junkStr} (target <${TARGET_JUNK_IN_PRODUCTION}%)  ${junkVerdict}`);
    log(`   ─────────────────────────────`);
    log(`   Passed: ${stats.passed} | Rejected: ${stats.failed} | Quarantined: ${stats.passedAndQuarantined.length}`);
    if (stats.internalExcluded > 0) {
      log(`   Internal-automation events excluded from stats: ${stats.internalExcluded}`);
    }
    if (stats.failedNames.length > 0) {
      log(`   Failed (post-filter): ${stats.failedNames.join(', ')}`);
    }
    if (stats.passedAndQuarantined.length > 0) {
      log(`   Passed-but-quarantined: ${stats.passedAndQuarantined.join(', ')}`);
    }
    log(`\n   Log: ${LOG_FILE}`);
  }

  return result;
}

// Run
try {
  main();
} catch (err) {
  console.error('FATAL: skill_junk_tracker failed:', err.message);
  process.exit(1);
}
