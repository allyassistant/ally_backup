#!/usr/bin/env node
/**
 * analyze_skill_usage.js — Offline analysis of .skill_usage_log.jsonl
 *
 * Produces:
 *   - Recall count per skill
 *   - Explicit feedback counts (used / skipped / rejected)
 *   - Usage rate per skill
 *   - Skills with high recall but low usage (demotion candidates)
 *   - Suggested MIN_SCORE adjustment based on rejected rate
 *
 * Usage:
 *   node scripts/analyze_skill_usage.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const USAGE_LOG_FILE = path.join(os.homedir(), '.openclaw', 'workspace', '.skill_usage_log.jsonl');

function loadEvents() {
  if (!fs.existsSync(USAGE_LOG_FILE)) return [];
  let raw;
  try {
    raw = fs.readFileSync(USAGE_LOG_FILE, 'utf8');
  } catch (err) {
    console.error(`[analyze_skill_usage] failed to read log: ${err.message}`);
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function analyze(events) {
  const bySkill = {};

  for (const e of events) {
    if (!e.skill) continue;
    if (!bySkill[e.skill]) {
      bySkill[e.skill] = { recall: 0, used: 0, skipped: 0, rejected: 0, scores: [] };
    }
    if (e.event === 'recall_trigger') {
      bySkill[e.skill].recall++;
      if (typeof e.score === 'number') bySkill[e.skill].scores.push(e.score);
    } else if (e.event === 'used') {
      bySkill[e.skill].used++;
    } else if (e.event === 'skipped') {
      bySkill[e.skill].skipped++;
    } else if (e.event === 'rejected') {
      bySkill[e.skill].rejected++;
    }
  }

  const rows = Object.entries(bySkill).map(([skill, s]) => {
    const feedbackTotal = s.used + s.skipped + s.rejected;
    const usageRate = feedbackTotal > 0 ? s.used / feedbackTotal : 0;
    const avgScore = s.scores.length > 0
      ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length
      : 0;
    return {
      skill,
      recall: s.recall,
      used: s.used,
      skipped: s.skipped,
      rejected: s.rejected,
      usageRate,
      avgScore,
    };
  });

  rows.sort((a, b) => b.recall - a.recall);
  return rows;
}

function printReport(rows) {
  console.log('═══ Skill Usage Analysis ═══\n');
  console.log(`Total skills with recall events: ${rows.length}\n`);

  console.log('| Skill | Recall | Used | Skipped | Rejected | Usage Rate | Avg Score |');
  console.log('|-------|--------|------|---------|----------|------------|-----------|');
  for (const r of rows) {
    const rate = (r.usageRate * 100).toFixed(1);
    const score = r.avgScore.toFixed(3);
    console.log(`| ${r.skill} | ${r.recall} | ${r.used} | ${r.skipped} | ${r.rejected} | ${rate}% | ${score} |`);
  }

  const highRecallLowUsage = rows.filter(r => r.recall >= 3 && r.usageRate < 0.34);
  console.log('\n⚠️  High recall but low usage (<34% usage rate, ≥3 recalls):');
  if (highRecallLowUsage.length === 0) {
    console.log('  None yet.');
  } else {
    for (const r of highRecallLowUsage) {
      console.log(`  - ${r.skill}: ${r.recall} recalls, ${(r.usageRate * 100).toFixed(1)}% usage`);
    }
  }

  const rejectedSkills = rows.filter(r => r.rejected > 0);
  if (rejectedSkills.length > 0) {
    console.log('\n🚫 Skills with rejections:');
    for (const r of rejectedSkills) {
      console.log(`  - ${r.skill}: ${r.rejected} rejected`);
    }
  }

  const rejectedRates = rows
    .filter(r => r.rejected + r.used > 0)
    .map(r => r.rejected / (r.rejected + r.used));
  const avgRejectedRate = rejectedRates.length > 0
    ? rejectedRates.reduce((a, b) => a + b, 0) / rejectedRates.length
    : 0;
  console.log(`\n📊 Avg rejection rate among feedback skills: ${(avgRejectedRate * 100).toFixed(1)}%`);
  if (avgRejectedRate > 0.25) {
    console.log('💡 Suggestion: consider raising MIN_SCORE to reduce false-positive recalls.');
  } else if (avgRejectedRate < 0.05) {
    console.log('💡 Suggestion: MIN_SCORE may be too conservative; consider lowering to improve coverage.');
  } else {
    console.log('💡 MIN_SCORE appears well calibrated.');
  }
}

const events = loadEvents();
if (events.length === 0) {
  console.log('No usage events found. Run skill-auto-suggest and record feedback first.');
  process.exit(0);
}

printReport(analyze(events));
