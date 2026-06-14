#!/usr/bin/env node

/**
 * queue_depth.js — Skill Review Queue Depth & Visibility Tool
 *
 * Reads .skill_review_queue.jsonl and reports:
 *   - Total entries
 *   - Last entry timestamp
 *   - Oldest entry timestamp
 *   - v1 vs v2 format count
 *   - Error breakdown (successful vs failed entries)
 *
 * Usage:
 *   node scripts/queue_depth.js              # Human-readable summary
 *   node scripts/queue_depth.js --watch      # Live monitoring (refreshes every 10s)
 *   node scripts/queue_depth.js --json       # Machine-readable JSON output
 *   node scripts/queue_depth.js --verbose    # Show last 5 entries
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUEUE_FILE = path.join(os.homedir(), '.openclaw', 'workspace', '.skill_review_queue.jsonl');
const WATCH_INTERVAL = 10000; // 10 seconds

function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) {
    return { exists: false, entries: [] };
  }
  let raw;
  try {
    raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  if (!raw) return { exists: true, entries: [] };

  let entries;
  try {
    entries = raw.split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); }
        catch { return { _parseError: true, _raw: line.slice(0, 100) }; }
      });
  } catch {
    return { exists: true, entries: [] };
  }
  return { exists: true, entries };
}

function analyzeQueue() {
  const { exists, entries } = readQueue();

  if (!exists) {
    return {
      exists: false,
      file: QUEUE_FILE,
      error: 'Queue file does not exist'
    };
  }

  const total = entries.length;
  const parseErrors = entries.filter(e => e._parseError).length;

  // Timestamps
  const timestamps = entries
    .filter(e => e.ts && typeof e.ts === 'string')
    .map(e => e.ts);

  // Format detection (v1 vs v2)
  let v1 = 0, v2 = 0, unknownFormat = 0;
  for (const e of entries) {
    if (e._parseError) { unknownFormat++; continue; }
    if (e.v === 2) v2++;
    else if (e.v === 1) v1++;
    else if (e.compressed) v2++; // v2-like (has compressed field)
    else if (e.userPrompt) v1++; // v1-like (no v field but has basic fields)
    else unknownFormat++;
  }

  // Success/failure stats
  let successCount = 0, failCount = 0;
  const toolCounts = {};
  let totalToolCalls = 0;
  for (const e of entries) {
    if (e._parseError) continue;
    if (e.success === false) failCount++;
    else successCount++;
    totalToolCalls += e.toolCallCount || 0;
    if (Array.isArray(e.compressed)) {
      for (const turn of e.compressed) {
        if (turn && Array.isArray(turn.toolNames)) {
          for (const tn of turn.toolNames) {
            toolCounts[tn] = (toolCounts[tn] || 0) + 1;
          }
        }
      }
    }
  }

  return {
    exists: true,
    file: QUEUE_FILE,
    total,
    parseErrors,
    v1,
    v2,
    unknownFormat,
    successCount,
    failCount,
    totalToolCalls,
    toolCounts,
    oldestTimestamp: timestamps.length > 0 ? timestamps.reduce((a, b) => a < b ? a : b) : null,
    newestTimestamp: timestamps.length > 0 ? timestamps.reduce((a, b) => a > b ? a : b) : null,
    lastEntries: entries.slice(-5).map(e => ({
      ts: e.ts || 'unknown',
      prompt: e.userPrompt ? e.userPrompt.slice(0, 60) : '(no prompt)',
      success: e.success !== false,
      error: e.error ? e.error.slice(0, 80) : null,
      tools: e.toolCallCount || 0
    }))
  };
}

function formatTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return ts;
  }
}

function formatAge(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diffMs = now - d.getTime();
    if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s ago`;
    if (diffMs < 3600000) return `${Math.round(diffMs / 60000)}m ago`;
    if (diffMs < 86400000) return `${Math.round(diffMs / 3600000)}h ago`;
    return `${Math.round(diffMs / 86400000)}d ago`;
  } catch {
    return ts;
  }
}

function printHuman(analysis) {
  if (!analysis.exists) {
    console.log(`\n📊 Queue Depth Report\n`);
    console.log(`❌ Queue file not found: ${analysis.file}`);
    return;
  }

  console.log(`\n📊 === Skill Review Queue Depth Report ===\n`);
  console.log(`📄 Queue file:         ${analysis.file}`);
  console.log(`────────────────────────────────────────────`);
  console.log(`📦 Total entries:      ${analysis.total}`);
  console.log(`✅ Successful:         ${analysis.successCount}`);
  console.log(`❌ Failed:             ${analysis.failCount}`);
  console.log(`⚠️  Parse errors:       ${analysis.parseErrors}`);
  console.log(`🛠️  Total tool calls:   ${analysis.totalToolCalls}`);
  console.log(``);
  console.log(`📐 Format breakdown:`);
  console.log(`   v2 (current):       ${analysis.v2}`);
  console.log(`   v1 (legacy):        ${analysis.v1}`);
  console.log(`   Unknown:            ${analysis.unknownFormat}`);
  console.log(``);
  console.log(`⏰ Timestamps:`);
  console.log(`   Oldest entry:       ${formatTime(analysis.oldestTimestamp)} (${formatAge(analysis.oldestTimestamp)})`);
  console.log(`   Newest entry:       ${formatTime(analysis.newestTimestamp)} (${formatAge(analysis.newestTimestamp)})`);
  console.log(``);

  // Tool usage breakdown
  const toolKeys = Object.keys(analysis.toolCounts).sort((a, b) => analysis.toolCounts[b] - analysis.toolCounts[a]);
  if (toolKeys.length > 0) {
    console.log(`🔧 Tool usage (top 10):`);
    for (const t of toolKeys.slice(0, 10)) {
      console.log(`   ${t}: ${analysis.toolCounts[t]}`);
    }
    if (toolKeys.length > 10) {
      console.log(`   ... and ${toolKeys.length - 10} more tools`);
    }
    console.log(``);
  }

  // Last 5 entries
  if (analysis.lastEntries.length > 0) {
    console.log(`🕐 Last ${analysis.lastEntries.length} entries:`);
    for (const e of analysis.lastEntries) {
      const icon = e.success ? '✅' : '❌';
      const errSuffix = e.error ? ` — ${e.error}` : '';
      console.log(`   ${icon} [${formatAge(e.ts)}] ${e.prompt} (${e.tools} tools)${errSuffix}`);
    }
    console.log(``);
  }
}

function printJSON(analysis) {
  console.log(JSON.stringify(analysis, null, 2));
}

function runReport(options = {}) {
  const analysis = analyzeQueue();
  if (options.json) {
    printJSON(analysis);
  } else {
    printHuman(analysis);
    if (options.verbose && analysis.lastEntries.length > 0) {
      console.log(`💡 Tip: Use --json for machine-readable output`);
    }
  }
  return analysis;
}

function watchMode() {
  console.log(`🔄 Watching queue file: ${QUEUE_FILE}`);
  console.log(`   (refreshes every ${WATCH_INTERVAL / 1000}s, Ctrl+C to stop)\n`);

  function tick() {
    const analysis = analyzeQueue();
    const now = new Date().toLocaleString('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      hour12: false
    });

    const oldest = formatAge(analysis.oldestTimestamp);
    const newest = formatAge(analysis.newestTimestamp);

    console.log(`[${now}] ${analysis.total} entries | ✅${analysis.successCount} ❌${analysis.failCount} | v2:${analysis.v2} v1:${analysis.v1} | oldest:${oldest} newest:${newest}`);

    if (analysis.total > 30) {
      console.log(`   ⚠️  Queue is getting full (${analysis.total}/50 max)`);
    }
  }

  tick();
  setInterval(tick, WATCH_INTERVAL);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--watch')) {
    watchMode();
    return;
  }

  const options = {
    json: args.includes('--json'),
    verbose: args.includes('--verbose')
  };

  runReport(options);
}

main();
