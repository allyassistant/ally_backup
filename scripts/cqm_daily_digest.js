#!/usr/bin/env node
/**
 * cqm_daily_digest.js — Daily Discord digest of CQM scan findings
 *
 * Refactored (2026-07-17): Use CQM scan output (`.state/pure_ai_audit_results.json`)
 * as the SINGLE SOURCE OF TRUTH, instead of the legacy quarantine/ directory.
 *
 * Why this matters:
 *   - Previously, this script read scripts/quarantine/ (populated only when
 *     auto_fix.js ran). Sub-agents and manual edits that bypassed auto_fix.js
 *     caused the digest to lie ("0 pending · all clean!") while CQM scan
 *     still flagged real issues.
 *   - Now we read directly from the scan, then classify each finding into
 *     one of four statuses via scripts/lib/cqm_status_detector.js:
 *
 *       pending    — scan flagged, no fix evidence yet (action required)
 *       approved   — scan flagged, but git diff shows manual/sub-agent fix
 *                    in working tree (uncommitted); still flagged but resolved
 *       suppressed — explicit opt-out via comment or .cqmignore
 *       auto_fixed — recorded as fixed in .state/auto_repair_results.json
 *
 *   - The digest now mirrors the actual scan, eliminating the desync.
 *   - The legacy queue file (`.state/auto_repair_pending_approval.json`) is
 *     still on disk for backward compat with auto_fix.js, but no longer
 *     consulted by this digest.
 *
 * Usage:
 *   node scripts/cqm_daily_digest.js --dry-run          Preview digest (default)
 *   node scripts/cqm_daily_digest.js --send              Scan and push to Discord
 *   node scripts/cqm_daily_digest.js --json              Machine-readable output
 *   node scripts/cqm_daily_digest.js --skip-auto-fix     Skip auto_repair_results.json lookup
 *
 * Exit codes:
 *   0 = digest generated (whether or not it was sent)
 *   1 = fatal error (could not read scan, git broken, etc.)
 *
 * Cron: invoked by OpenClaw cron job "CQM Fix Daily Digest"
 *       (id: a9eda840-c127-4d87-9436-29a04f68822a, schedule: 35 2 * * * HKT).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const detector = require('./lib/cqm_status_detector');
const { getHKTDateTime } = require('./lib/time');

const SYSTEM_CHANNEL = 'channel:1473376125584670872'; // #⚙️系統
const SCAN_PATH = '.state/pure_ai_audit_results.json';
const REPO_ROOT = path.resolve(__dirname, '..');
const LOCK_DIR = path.join(REPO_ROOT, '.state');

/**
 * Idempotency lock — prevents double-send if cron retries or races.
 * Returns true if already locked (skip send), false if lock acquired (proceed).
 */
function alreadyLocked() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
  const lockFile = path.join(LOCK_DIR, `cqm_digest_sent_${today}.lock`);
  if (fs.existsSync(lockFile)) {
    console.log('⏭️  Digest already sent today, skipping (lock file exists)');
    return true;
  }
  return false;
}

/**
 * Acquire the idempotency lock. Returns false if already locked.
 */
function acquireLock() {
  const today = new Date().toISOString().slice(0, 10);
  const lockFile = path.join(LOCK_DIR, `cqm_digest_sent_${today}.lock`);
  if (alreadyLocked()) return false;
  try {
    fs.writeFileSync(lockFile, new Date().toISOString(), { mode: 0o644 });
    return true;
  } catch (e) {
    // Race: another process grabbed the lock between our check and write
    return false;
  }
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const STATUS_EMOJI = {
  pending: '⏳',
  approved: '✅',
  suppressed: '🔇',
  auto_fixed: '🤖',
  queue_fixed: '🟢',
};

/**
 * Read the CQM scan results file. Returns null on failure.
 */
function readScanResults(scanPath = SCAN_PATH) {
  const abs = path.resolve(REPO_ROOT, scanPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, error: `Scan results file not found: ${abs}` };
  }
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { ok: false, error: `Cannot read scan results: ${e.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid JSON in scan results: ${e.message}` };
  }
  if (!parsed || !Array.isArray(parsed.findings)) {
    return { ok: false, error: 'Scan results missing "findings" array' };
  }
  return { ok: true, data: parsed, absPath: abs };
}

/**
 * Classify each finding with a status. Returns enriched findings array.
 */
function classifyFindings(scanData, options = {}) {
  const findings = scanData.findings || [];
  return findings.map(f => {
    const result = detector.detectStatus(f, REPO_ROOT, options);
    return {
      ...f,
      status: result.status,
      reason: result.reason,
      commit: result.commit,
    };
  });
}

/**
 * Build the summary statistics from enriched findings.
 */
function buildSummary(findings) {
  const summary = {
    pending: 0,
    approved: 0,
    suppressed: 0,
    auto_fixed: 0,
    queue_fixed: 0,
    total: findings.length,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    byRule: {},
  };

  for (const f of findings) {
    if (summary[f.status] !== undefined) summary[f.status]++;
    if (summary.bySeverity[f.severity] !== undefined) summary.bySeverity[f.severity]++;

    const ruleKey = f.rule || 'unknown';
    if (!summary.byRule[ruleKey]) {
      summary.byRule[ruleKey] = { total: 0, pending: 0, approved: 0, suppressed: 0, auto_fixed: 0, queue_fixed: 0 };
    }
    summary.byRule[ruleKey].total++;
    if (summary.byRule[ruleKey][f.status] !== undefined) {
      summary.byRule[ruleKey][f.status]++;
    }
  }

  return summary;
}

/**
 * Format a single finding line for Discord display.
 */
function formatFinding(f, index) {
  const file = path.basename(f.file);
  const rule = f.rule || 'unknown';
  const title = f.title || '';
  // Truncate title for readability
  const shortTitle = title.length > 60 ? title.slice(0, 57) + '...' : title;
  return `  ${index}. \`${file}:${f.line}\` — ${shortTitle} (\`${rule}\`)`;
}

/**
 * Generate the Discord digest message.
 */
function generateDigest(findings, summary, options = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`🔧 **CQM Fix Digest — ${today}**`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');

  // Top summary
  lines.push('');
  lines.push(`**摘要：** ${summary.pending} 待審 · $ 已批準 · y.approved} 已批准 · ${summary.suppressed} 已屏蔽 · ${summary.queue_fixed} 已修復 · ${summary.auto_fixed} 自動修復`);
  lines.push(`**總發現：** ${summary.total} (${summary.bySeverity.critical}🔴 · ${summary.bySeverity.high}🟠 · ${summary.bySeverity.medium}🟡 · ${summary.bySeverity.low}🟢)`);

  // Breakdown by rule_id
  if (Object.keys(summary.byRule).length > 0) {
    lines.push('');
    lines.push('**按規則：**');
    const rules = Object.entries(summary.byRule).sort((a, b) => b[1].pending - a[1].pending);
    for (const [rule, counts] of rules) {
      const parts = [];
      if (counts.pending) parts.push(`${counts.pending}⏳`);
      if (counts.approved) parts.push(`${counts.approved}✅`);
      if (counts.suppressed) parts.push(`${counts.suppressed}🔇`);
      if (counts.queue_fixed) parts.push(`${counts.queue_fixed}🟢`);
      if (counts.auto_fixed) parts.push(`${counts.auto_fixed}🤖`);
      lines.push(`  • \`${rule}\` — ${parts.join(' / ')}`);
    }
  }

  // Pending by severity (actionable section)
  const pendingFindings = findings
    .filter(f => f.status === 'pending')
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99));

  if (pendingFindings.length > 0) {
    lines.push('');
    lines.push(`📋 **待審查：** ${pendingFindings.length}`);

    // Group by severity
    for (const sev of ['critical', 'high', 'medium', 'low']) {
      const group = pendingFindings.filter(f => f.severity === sev);
      if (group.length === 0) continue;
      const emoji = SEVERITY_EMOJI[sev];
      const sevLabel = sev === 'critical' ? '嚴重' : sev === 'high' ? '高' : sev === 'medium' ? '中' : '低';
      lines.push('');
      lines.push(`${emoji} **${sevLabel}：** ${group.length}`);
      const limit = Math.min(group.length, 3);
      for (let i = 0; i < limit; i++) {
        lines.push(formatFinding(group[i], i + 1));
      }
      if (group.length > limit) {
        lines.push(`  _...仲有 ${group.length - limit} 個_`);
      }
    }
  } else {
    lines.push('');
    lines.push('✅ **沒有待審項目 — 全部乾淨！**');
  }

  // Approved section (manual fixes awaiting commit)
  const approvedFindings = findings.filter(f => f.status === 'approved');
  if (approvedFindings.length > 0) {
    lines.push('');
    lines.push(`✅ **Approved (manually fixed, uncommitted):** ${approvedFindings.length}`);
    const limit = Math.min(approvedFindings.length, 5);
    for (let i = 0; i < limit; i++) {
      lines.push(formatFinding(approvedFindings[i], i + 1));
    }
    if (approvedFindings.length > limit) {
      lines.push(`  _...仲有 ${approvedFindings.length - limit} 個_`);
    }
  }

  // Suppressed section
  const suppressedFindings = findings.filter(f => f.status === 'suppressed');
  if (suppressedFindings.length > 0) {
    lines.push('');
    lines.push(`🔇 **已屏蔽：** ${suppressedFindings.length}（例如 tests、intentional）`);
  }

  // Auto-fixed section
  const autoFixedFindings = findings.filter(f => f.status === 'auto_fixed');
  if (autoFixedFindings.length > 0) {
    lines.push('');
    lines.push(`🤖 **Auto-fixed:** ${autoFixedFindings.length}`);
  }

  lines.push('');
  lines.push(`_來源：CQM Scan（${summary.total} 個發現）→ 狀態由 git diff + suppress comments 分類_`);
  lines.push('_(CQM Digest · 單一事實來源 = scan · 2026-07-17)_');

  return lines.join('\n');
}

/**
 * Build the JSON output (for tooling).
 */
function generateJsonOutput(scanData, findings, summary) {
  return {
    source: 'cqm_daily_digest',
    scanSource: scanData.source || 'unknown',
    scanGeneratedAt: scanData.generatedAt || null,
    digestGeneratedAt: new Date().toISOString(),
    summary,
    findings,
  };
}

/**
 * Push the digest to Discord via the shared helper.
 */
async function sendDigest(digestMessage, dryRun = false) {
  // Idempotency: skip if already sent today (handles cron retries/races)
  if (!dryRun && alreadyLocked()) {
    return { ok: true, skipped: true, reason: 'already_sent_today' };
  }

  // Acquire lock before sending (defensive against races)
  if (!dryRun && !acquireLock()) {
    return { ok: true, skipped: true, reason: 'lock_race' };
  }

  const discord = require('./lib/discord_push');
  const result = discord.push({
    message: digestMessage,
    target: SYSTEM_CHANNEL,
    dryRun,
  });
  if (result.ok) {
    console.log('✅ Digest sent to Discord');
    if (result.skipped) console.log('   (dry-run mode)');
  } else {
    console.error(`❌ Failed to send digest: ${result.error}`);
  }
  return result;
}

/**
 * CLI entry point.
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const doSend = args.includes('--send');
  const quiet = args.includes('--quiet');
  const jsonOnly = args.includes('--json');
  const skipAutoFix = args.includes('--skip-auto-fix');
  const skipQueue = args.includes('--skip-queue');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
cqm_daily_digest.js — Daily CQM digest to Discord (scan-based)

Usage:
  node scripts/cqm_daily_digest.js [options]

Options:
  --dry-run          Preview digest, do not send (default if no flag)
  --send             Send digest to Discord #⚙️系統
  --json             Output JSON to stdout (machine-readable)
  --skip-auto-fix    Skip .state/auto_repair_results.json lookup
  --skip-queue       Skip repair_queue.jsonl lookup (debugging)
  --quiet            Suppress console output except errors
  -n, --help         Show this help

Examples:
  # Preview the digest (default)
  node scripts/cqm_daily_digest.js

  # Send to Discord
  node scripts/cqm_daily_digest.js --send

  # Get machine-readable JSON
  node scripts/cqm_daily_digest.js --json

  # Skip queue lookup (useful for debugging)
  node scripts/cqm_daily_digest.js --dry-run --skip-queue

Exit codes:
  0  digest generated successfully
  1  fatal error (no scan results, read failure, etc.)

Cron: OpenClaw cron "CQM Fix Daily Digest" (a9eda840-...) at 02:35 HKT.
`);
    process.exit(0);
  }

  // 1. Read scan results
  const scanResult = readScanResults();
  if (!scanResult.ok) {
    console.error(`❌ ${scanResult.error}`);
    console.error('   Hint: run `node scripts/code_quality_manager.js scan` first.');
    process.exit(1);
  }
  const scanData = scanResult.data;

  // 2. Classify each finding
  const options = { skipAutoFix, skipQueue };
  const findings = classifyFindings(scanData, options);
  const summary = buildSummary(findings);

  // 3. Generate output
  if (jsonOnly) {
    const json = generateJsonOutput(scanData, findings, summary);
    console.log(JSON.stringify(json, null, 2));
    process.exit(0);
  }

  const digest = generateDigest(findings, summary);

  if (quiet) {
    // Minimal: only errors
    if (doSend && !dryRun) {
      const result = await sendDigest(digest, false);
      if (!result.ok) console.error(`❌ ${result.error}`);
    }
    // silent otherwise — no output for --quiet
  } else if (doSend && !dryRun) {
    console.log('Sending to Discord...');
    const result = await sendDigest(digest, false);
    if (result.ok) {
      console.log('✅ Digest sent to Discord');
    } else {
      console.error(`❌ Failed to send digest: ${result.error}`);
    }
    console.log('');
    console.log('Stats:');
    console.log(`  Total findings: ${summary.total}`);
    console.log(`  Pending: ${summary.pending}`);
    console.log(`  Approved: ${summary.approved}`);
    console.log(`  Suppressed: ${summary.suppressed}`);
    console.log(`  Queue-fixed: ${summary.queue_fixed}`);
    console.log(`  Auto-fixed: ${summary.auto_fixed}`);
  } else if (doSend && dryRun) {
    console.log('[dry-run] Would send to Discord');
    console.log('Run with --send to publish to Discord');
  } else {
    // Default preview
    console.log('=== CQM Fix Digest Preview ===');
    console.log('');
    console.log(digest);
    console.log('');
    console.log('Stats:');
    console.log(`  Total findings: ${summary.total}`);
    console.log(`  Pending: ${summary.pending}`);
    console.log(`  Approved: ${summary.approved}`);
    console.log(`  Suppressed: ${summary.suppressed}`);
    console.log(`  Queue-fixed: ${summary.queue_fixed}`);
    console.log(`  Auto-fixed: ${summary.auto_fixed}`);
  }
}

module.exports = {
  readScanResults,
  classifyFindings,
  buildSummary,
  generateDigest,
  generateJsonOutput,
  sendDigest,
};

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}
