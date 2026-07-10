#!/usr/bin/env node
/**
 * scripts/lib/audit_trend.js — Phase 3 (Layer 3) Audit Trend Tracker
 *
 * Tracks audit results over time to detect regressions, resolution velocity,
 * and persistent issues. Reads date-stamped snapshots from
 * <state>/audit_history/audit_<YYYY-MM-DD>.json and produces a comparison
 * vs a previous run.
 *
 * Public API:
 *   const trend = require('./lib/audit_trend');
 *
 *   trend.loadAuditHistory(stateDir, days=7)           → [{date, totalIssues, ...}, ...]
 *   trend.compareWithPrevious(current, previous)        → {new, resolved, regressed, persistent}
 *   trend.formatDigest(history, comparison)             → Discord-ready string
 *   trend.persistHistorySnapshot(stateDir, payload, date?) → writes audit_<date>.json
 *   trend.summarizeAuditPayload(auditResultsPayload)   → normalized trend record
 *
 * The cron pattern is:
 *   1. daily_audit_runner writes .state/audit_orchestrator_results.json (canonical)
 *   2. trend.persistHistorySnapshot() copies it to .state/audit_history/audit_<date>.json
 *   3. trend.loadAuditHistory() reads back last N days for trend digest
 *
 * Created: 2026-06-19 (Phase 3 / Layer 3)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ONE_DAY_MS } = require('./time_constants');

const { WS, STATE_DIR, atomicWriteSync } = require('./config');

const HISTORY_DIR = path.join(STATE_DIR, 'audit_history');

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * Ensure the history directory exists.
 */
function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    try {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
  }
}

/**
 * Normalize an audit_results payload into a trend record.
 * Accepts the canonical shape:
 *   { results: { merged: [...] }, summary: {...}, savedAt: ... }
 * or a bare { merged: [...] } / { issues: [...] } object.
 */
function summarizeAuditPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  // Find the merged/issues array
  const merged =
    (payload.results && payload?.results?.merged) ||
    payload.merged ||
    payload.issues ||
    [];

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byFile = {};
  // For regressed detection we keep severity per file (max severity wins)
  const fileSeverity = {};

  for (const issue of merged) {
    if (!issue) continue;
    const sev = (issue.severity || 'medium').toLowerCase();
    if (bySeverity[sev] !== undefined) bySeverity[sev] += 1;

    const f = issue.file || '<unknown>';
    byFile[f] = (byFile[f] || 0) + 1;
    // Track max severity per file. Use undefined sentinel so first observed
    // severity is always recorded (initial 'low' was suppressing legitimate
    // 'low' findings on first sight).
    const curSev = fileSeverity[f];
    if (curSev === undefined || (SEVERITY_ORDER[sev] || 0) > (SEVERITY_ORDER[curSev] || 0)) {
      fileSeverity[f] = sev;
    }
  }

  const topFiles = Object.entries(byFile)
    .map(([file, count]) => ({ file, count, severity: fileSeverity[file] }))
    .sort((a, b) => b.count - a.count);

  return {
    totalIssues: merged.length,
    bySeverity,
    byFile,
    fileSeverity,
    topFiles,
    issueCount: merged.length,
  };
}

/**
 * Persist the canonical audit output as a date-stamped snapshot.
 * Returns the snapshot path.
 */
function persistHistorySnapshot(stateDir, payload, date = null) {
  const dir = stateDir || STATE_DIR;
  const historyDir = path.join(dir, 'audit_history');
  if (!fs.existsSync(historyDir)) {
    try {
      fs.mkdirSync(historyDir, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
  }
  const d = date || new Date();
  const stamp = formatDate(d);
  const out = path.join(historyDir, `audit_${stamp}.json`);
  atomicWriteSync(out, payload);
  return out;
}

/**
 * Load last `days` days of audit history from the history dir.
 * Returns array sorted by date ascending. Most recent is last.
 */
function loadAuditHistory(stateDir = STATE_DIR, days = 7) {
  const historyDir = path.join(stateDir, 'audit_history');
  if (!fs.existsSync(historyDir)) return [];

  const cutoff = Date.now() - days * ONE_DAY_MS;
  let files = [];
  try {
    files = fs.readdirSync(historyDir)
      .filter(f => /^audit_\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map(f => {
        const m = f.match(/^audit_(\d{4}-\d{2}-\d{2})\.json$/);
        if (!m) return null;
        const t = Date.parse(m[1] + 'T00:00:00Z');
        return { file: f, date: m[1], ts: t };
      })
      .filter(Boolean)
      .filter(x => x.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts);
  } catch (e) {
    console.error(`[audit_history] loadAuditHistory failed: ${e.message}`);
  }

  const history = [];
  for (const meta of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(historyDir, meta.file), 'utf8'));
      const summary = summarizeAuditPayload(raw);
      if (summary) {
        history.push({
          date: meta.date,
          file: meta.file,
          totalIssues: summary.totalIssues,
          bySeverity: summary.bySeverity,
          byFile: summary.byFile,
          topFiles: summary?.topFiles?.slice(0, 10),
        });
      }
    } catch (_) { /* skip corrupt */ }
  }

  return history;
}

/**
 * Compare two trend records. Returns { new, resolved, regressed, persistent }.
 * Files are compared by (file, severity).
 */
function compareWithPrevious(current, previous) {
  const cur = current || {};
  const prev = previous || {};

  const curSeverity = cur.fileSeverity || {};
  const prevSeverity = prev.fileSeverity || {};

  const curFiles = new Set(Object.keys(curSeverity));
  const prevFiles = new Set(Object.keys(prevSeverity));

  const newFiles = [];
  const resolved = [];
  const persistent = [];
  const regressed = [];

  // New: appears in current, not previous
  for (const f of curFiles) {
    if (!prevFiles.has(f)) {
      newFiles.push(f);
    }
  }

  // Resolved: appears in previous, not current
  for (const f of prevFiles) {
    if (!curFiles.has(f)) {
      resolved.push(f);
    }
  }

  // Persistent + Regressed: appears in both
  for (const f of curFiles) {
    if (prevFiles.has(f)) {
      const cSev = curSeverity[f];
      const pSev = prevSeverity[f];
      const cOrder = SEVERITY_ORDER[cSev] || 0;
      const pOrder = SEVERITY_ORDER[pSev] || 0;
      if (cOrder > pOrder) {
        regressed.push({ file: f, from: pSev, to: cSev });
      } else if (cOrder === pOrder) {
        persistent.push(f);
      } else {
        // severity decreased — count as improvement, surface in resolved
        resolved.push(`${f} (${pSev}→${cSev})`);
      }
    }
  }

  return {
    new: newFiles.sort(),
    resolved: resolved.sort(),
    regressed: regressed.sort((a, b) => {
      if (typeof a === 'string') return a.localeCompare(b);
      return a?.file?.localeCompare(b.file);
    }),
    persistent: persistent.sort(),
  };
}

/**
 * Compute rolling average of totalIssues over the history (excluding the last / current).
 */
function rollingAverage(history) {
  if (!history || history.length === 0) return 0;
  const sum = history.reduce((acc, h) => acc + (h.totalIssues || 0), 0);
  return Math.round((sum / history.length) * 10) / 10;
}

/**
 * Count consecutive days each file has appeared in the history (from newest going back).
 * Files that appear in the most recent record are checked for streak length.
 */
function persistentFilesOverDays(history, days = 3) {
  if (!history || history.length < 2) return [];
  // Use only the tail (most recent `days` records)
  const tail = history.slice(-days);
  if (tail.length === 0) return [];

  // File must appear in all tail records
  const fileCounts = {};
  for (const rec of tail) {
    for (const f of Object.keys(rec.byFile || {})) {
      fileCounts[f] = (fileCounts[f] || 0) + 1;
    }
  }
  return Object.entries(fileCounts)
    .filter(([, n]) => n >= Math.min(days, tail.length))
    .map(([f]) => f)
    .sort();
}

/**
 * Render the trend data as a Discord-ready multi-line digest.
 * Format designed to be scannable: emoji + concise numbers.
 */
function formatDigest(history, comparison, currentSummary = null) {
  const lines = [];
  const cmp = comparison || {};
  const hist = history || [];
  const nowHkt = formatHktTimestamp(new Date());

  // Header: title + timestamp + scan scope
  lines.push('🛠️ **每日 audit 結果**');
  lines.push(`⏰ ${nowHkt} · ${(currentSummary && currentSummary.scriptCount) || '?'} scripts 掃描`);
  lines.push('');

  // Issues block (severity: critical → high → medium → low, column-aligned)
  if (currentSummary) {
    const sev = currentSummary.bySeverity || {};
    const total = currentSummary.totalIssues || 0;
    lines.push(`📊 **Issues: ${total} 個**`);
    lines.push(`   Critical: ${sev.critical || 0}    High: ${sev.high || 0}    Medium: ${sev.medium || 0}    Low: ${sev.low || 0}`);
    lines.push('');
  } else {
    lines.push('🛠️ 每日 audit 完成');
    lines.push('');
  }

  // Trend vs rolling avg (rounded to integer)
  if (hist.length >= 2) {
    const avg = rollingAverage(hist.slice(0, -1)); // exclude today
    const todayTotal = (currentSummary && currentSummary.totalIssues) ||
                       (hist[hist.length - 1] && hist[hist.length - 1].totalIssues) || 0;
    const deltaRaw = todayTotal - avg;
    const delta = Math.round(deltaRaw);
    const arrow = deltaRaw > 0 ? '↑' : deltaRaw < 0 ? '↓' : '→';
    const sign = deltaRaw > 0 ? '+' : '';
    const avgRounded = Math.round(avg * 10) / 10;
    const newCount = (cmp.new || []).length;
    lines.push(`📈 **Trend**: ${arrow} ${sign}${delta} issues (vs ${hist.length - 1}d avg ${avgRounded} → 今日 ${todayTotal})`);
    if (newCount > 0) {
      const newPreview = (cmp.new || []).slice(0, 3).map(stripDir).join(', ');
      const newSuffix = newCount > 3 ? `, +${newCount - 3} more` : '';
      lines.push(`   新增: ${newPreview}${newSuffix}`);
    }
    lines.push('');
  } else {
    lines.push('📈 **Trend**: 首次運行 (需要 ≥2 日 history)');
    lines.push('');
  }

  // Persistent issues (>3 days)
  const persistent = cmp.persistent || [];
  if (persistent.length > 0) {
    const preview = persistent.slice(0, 5).map(stripDir).join(', ');
    const suffix = persistent.length > 5 ? `, +${persistent.length - 5} more` : '';
    lines.push(`🔴 **持續 issues (>3 天)**: ${persistent.length} files`);
    lines.push(`   ${preview}${suffix}`);
  } else {
    lines.push('🟢 **持續 issues (>3 天)**: 0 files (全部清咗 ✓)');
  }
  lines.push('');

  // Resolved since yesterday
  const resolved = cmp.resolved || [];
  if (resolved.length > 0) {
    const preview = resolved.slice(0, 5).map(stripDir).join(', ');
    const suffix = resolved.length > 5 ? `, +${resolved.length - 5} more` : '';
    lines.push(`🟢 **已修復 (since yesterday)**: ${resolved.length} files`);
    lines.push(`   ${preview}${suffix}`);
  } else {
    lines.push('⚪ **已修復 (since yesterday)**: 0 files');
  }
  lines.push('');

  // Regressions (optional)
  const regressed = cmp.regressed || [];
  if (regressed.length > 0) {
    const preview = regressed.slice(0, 3).map(r => {
      const f = stripDir(typeof r === 'string' ? r : r.file);
      return typeof r === 'string' ? f : `${f} (${r.from}→${r.to})`;
    }).join(', ');
    lines.push(`⚠️ **退步 (regressions)**: ${regressed.length} files`);
    lines.push(`   ${preview}`);
  }

  // Strip the trailing empty line
  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/**
 * Format a Date as YYYY-MM-DD HH:MM HKT.
 */
function formatHktTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} HKT`;
}

/**
 * Strip dir prefix for compact display (scripts/foo.js → foo.js).
 */
function stripDir(p) {
  if (!p) return '';
  return p.replace(/^scripts\//, '').replace(/^.*\//, '');
}

/**
 * Format Date → YYYY-MM-DD (UTC). Accepts Date or YYYY-MM-DD string passthrough.
 */
function formatDate(d = new Date()) {
  if (typeof d === 'string') return d; // already a stamp
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// ----------------- CLI -----------------
async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args);
  const days = parseInt((args.find(a => a.startsWith('--days=')) || '--days=7').split('=')[1], 10);
  const wantsJson = flags.has('--json');

  if (flags.has('--help') || flags.has('-h')) {
    console.log(`audit_trend.js — Layer 3 trend tracker

Usage:
  node scripts/lib/audit_trend.js                # digest for last 7 days
  node scripts/lib/audit_trend.js --days=14
  node scripts/lib/audit_trend.js --json         # full JSON
`);
    process.exit(0);
  }

  const history = loadAuditHistory(STATE_DIR, days);
  let current = null;
  if (history.length > 0) {
    current = {
      ...history[history.length - 1],
      fileSeverity: deriveSeverityFromTopFiles(history[history.length - 1]),
    };
  }
  const previous = history.length >= 2
    ? {
        ...history[history.length - 2],
        fileSeverity: deriveSeverityFromTopFiles(history[history.length - 2]),
      }
    : null;
  const comparison = compareWithPrevious(current, previous);

  if (wantsJson) {
    console.log(JSON.stringify({ history, current, previous, comparison }, null, 2));
    return;
  }

  console.log(formatDigest(history, comparison, current));
  console.log(`\n📚 History: ${history.length} day(s) of snapshots`);
  if (history.length > 0) {
    console.log('   Date         Total  Top file');
    for (const h of history) {
      const top = (h.topFiles && h.topFiles[0]) ? `${h.topFiles[0].file} (${h.topFiles[0].count})` : '-';
      console.log(`   ${h.date}  ${String(h.totalIssues).padStart(5)}  ${top}`);
    }
  }
}

/**
 * Reconstruct fileSeverity map from a history record (it doesn't store it natively).
 * Best-effort: derive from topFiles where available.
 */
function deriveSeverityFromTopFiles(record) {
  if (!record) return {};
  if (record.fileSeverity) return record.fileSeverity;
  const out = {};
  for (const tf of (record.topFiles || [])) {
    if (tf.severity) out[tf.file] = tf.severity;
  }
  return out;
}

module.exports = {
  loadAuditHistory,
  compareWithPrevious,
  formatDigest,
  persistHistorySnapshot,
  summarizeAuditPayload,
  rollingAverage,
  persistentFilesOverDays,
  stripDir,
  formatDate,
  HISTORY_DIR,
};

// Run if called directly
if (require.main === module) {
  main().catch(e => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
}
