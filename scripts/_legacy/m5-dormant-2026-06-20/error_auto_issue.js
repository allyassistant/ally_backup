#!/usr/bin/env node
/**
 * error_auto_issue.js — Daily 22:00, scan memory/errors.json for error patterns
 * repeating ≥3 times in last 7 days, auto-create P1 issue via issue_manager.
 * (thin executor, no LLM in critical path, async spawn)
 *
 * v1.0 — Initial implementation.
 *  - Groups errors by (type, problem) pattern
 *  - Filters for last 7 days AND count ≥ REPEAT_THRESHOLD (3)
 *  - State file tracks already-issued pattern hashes (idempotent)
 *  - Calls `node scripts/issue_manager.js create "<title>" --priority P1 --due YYYY-MM-DD`
 *  - Patches the created file's description with full trace (since create cmd
 *    has no --body flag)
 *
 * 用法:
 *   node scripts/error_auto_issue.js                # normal run
 *   node scripts/error_auto_issue.js --dry-run      # preview only
 *   node scripts/error_auto_issue.js --threshold 5  # 改 repeat threshold
 *   node scripts/error_auto_issue.js --lookback 14  # 改 lookback days
 *   node scripts/error_auto_issue.js --help
 *
 * 失敗 exit 1 (stderr); stdout 純輸出。
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.join(__dirname, '..');
const ERRORS_FILE = path.join(WORKSPACE_ROOT, 'memory', 'errors.json');
const STATE_FILE = path.join(WORKSPACE_ROOT, '.error_auto_issue_state.json');
const DISCORD_CHANNEL = process.env.ERROR_ISSUE_CHANNEL || '1473376125584670872';
const ISSUE_MANAGER = path.join(WORKSPACE_ROOT, 'scripts', 'issue_manager.js');
const ISSUES_DIR = path.join(WORKSPACE_ROOT, '.issues', 'active');
const STATE_CAP = 500;

const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');
const DRY_RUN = process.argv.includes('--dry-run');
const JSON_OUT = process.argv.includes('--json');

function parseIntArg(name, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) {
    const n = parseInt(process.argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return def;
}

const REPEAT_THRESHOLD = parseIntArg('--threshold', 3);
const LOOKBACK_DAYS = parseIntArg('--lookback', 7);

function log(...args) {
  if (!QUIET) console.log(...args);
}

// ----------------- CLI help -----------------
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
error_auto_issue.js — Auto-create P1 issues for recurring error patterns (v1.0)

Usage:
  node scripts/error_auto_issue.js                   # normal run (threshold=3, lookback=7d)
  node scripts/error_auto_issue.js --dry-run         # preview only (no create, no state update)
  node scripts/error_auto_issue.js --threshold 5     # raise repeat threshold
  node scripts/error_auto_issue.js --lookback 14     # extend lookback to 14 days
  node scripts/error_auto_issue.js --quiet           # silent (for cron)
  node scripts/error_auto_issue.js --help

Exit codes:
  0 = clean (no new patterns) OR all issues created successfully
  1 = error (errors.json unreadable, issue_manager failed, etc.)
`);
  process.exit(0);
}

// ----------------- Async child process -----------------
function runChild(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error(`spawn ${args[0]} ETIMEDOUT after ${timeoutMs}ms`));
    }, timeoutMs);
    child?.stdout?.on('data', d => { stdout += d.toString('utf8'); });
    child?.stderr?.on('data', d => { stderr += d.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      if (!killed) reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (killed) return;
      resolve({ code, stdout, stderr });
    });
  });
}

// ----------------- State helpers -----------------
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { issuedPatterns: [] };
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      issuedPatterns: Array.isArray(parsed.issuedPatterns) ? parsed.issuedPatterns : []
    };
  } catch (err) {
    log(`⚠️  State file corrupt; resetting: ${err.message}`);
    return { issuedPatterns: [] };
  }
}

function saveState(state) {
  try {
    const patterns = state?.issuedPatterns?.slice(-STATE_CAP);
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ issuedPatterns: patterns }, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log(`⚠️  Failed to save state: ${err.message}`);
  }
}

// ----------------- Errors file -----------------
function loadErrors() {
  if (!fs.existsSync(ERRORS_FILE)) {
    return null; // missing = clean exit
  }
  let data;
  try {
    const raw = fs.readFileSync(ERRORS_FILE, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${ERRORS_FILE}: ${err.message}`);
  }
  if (!data || !Array.isArray(data.errors)) {
    throw new Error(`${ERRORS_FILE} missing 'errors' array`);
  }
  return data.errors;
}

// ----------------- Pattern normalization -----------------
// Stable key from (type, problem) — strips numbers/hashes/whitespace for dedup
function normalizePattern(err) {
  const t = String(err.type || 'unknown').trim();
  const p = String(err.problem || '').trim();
  // Lowercase, collapse whitespace, strip trailing numbers/hashes
  const normP = p.toLowerCase().replace(/\s+/g, ' ').replace(/[0-9a-f]{8,}/gi, '<hash>').trim();
  return `${t}::${normP}`;
}

// ----------------- Pattern aggregation -----------------
function aggregatePatterns(errors, lookbackDays) {
  const cutoffMs = Date.now() - lookbackDays * 86400 * 1000;
  const groups = new Map();
  for (const e of errors) {
    const ts = e.timestamp ? Date.parse(e.timestamp) : 0;
    if (isNaN(ts) || ts < cutoffMs) continue;
    if (e.resolved === true) continue;
    const key = normalizePattern(e);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        type: e.type,
        problem: e.problem,
        samples: [],
        timestamps: [],
        severity: e.severity || 1,
      });
    }
    const g = groups.get(key);
    g?.samples?.push(`${e.problem} (source: ${e.source || 'n/a'})`);
    g?.timestamps?.push(ts);
  }
  return groups;
}

// ----------------- HKT date utilities -----------------
function hktIsoString(ms) {
  const hkt = new Date(ms + 8 * 3600 * 1000);
  const yyyy = hkt.getUTCFullYear();
  const mm = String(hkt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(hkt.getUTCDate()).padStart(2, '0');
  const hh = String(hkt.getUTCHours()).padStart(2, '0');
  const mi = String(hkt.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} HKT`;
}

function hktDateString(ms) {
  const hkt = new Date(ms + 8 * 3600 * 1000);
  return `${hkt.getUTCFullYear()}-${String(hkt.getUTCMonth() + 1).padStart(2, '0')}-${String(hkt.getUTCDate()).padStart(2, '0')}`;
}

// ----------------- Issue body builder -----------------
function buildIssueBody(pattern, count, firstSeen, lastSeen) {
  const sampleLines = pattern?.samples?.slice(0, 3).map(s => `1. \`${s.replace(/`/g, '').slice(0, 200)}\``);
  return `## Summary

Error pattern \`${pattern.type}\` has occurred **${count} times** in the last ${LOOKBACK_DAYS} days.

## Pattern Details

- **Type:** \`${pattern.type}\`
- **Problem:** \`${pattern.problem}\`
- **Severity:** ${pattern.severity}

## First/Last Seen

- First: ${hktIsoString(firstSeen)}
- Last:  ${hktIsoString(lastSeen)}

## Sample Traces

${sampleLines.join('\n')}

## Recommended Action

[blank — human decides]
`;
}

// ----------------- Issue creation -----------------
async function createIssue(pattern, count, firstSeen, lastSeen) {
  const dueDate = hktDateString(Date.now() + 7 * 86400 * 1000); // +7d
  const title = `[FIX] Recurring error: ${pattern.type} (×${count} in ${LOOKBACK_DAYS}d)`;
  // Sanitize title for shell: keep it simple, strip quotes
  const safeTitle = title.replace(/"/g, "'").slice(0, 200);

  // 1. Create issue via issue_manager
  const { code, stdout, stderr } = await runChild(
    ['node', ISSUE_MANAGER, 'create', safeTitle, '--priority', 'P1', '--due', dueDate],
    60000
  );
  if (code !== 0) {
    return { ok: false, action: 'create-failed', error: (stderr || stdout).slice(0, 300) };
  }
  // Parse ID from output: "✅ Issue created: <id> - <title>"
  const idMatch = stdout.match(/Issue created:\s*(\d+)/);
  if (!idMatch) {
    return { ok: false, action: 'create-no-id', output: stdout.slice(0, 300) };
  }
  const issueId = idMatch[1];

  // 2. Find the issue file (sanitized title naming)
  const fileNamePrefix = `${issueId}-`;
  let filePath = null;
  try {
    const files = fs.readdirSync(ISSUES_DIR).filter(f => f.startsWith(fileNamePrefix) && f.endsWith('.md'));
    if (files.length > 0) {
      filePath = path.join(ISSUES_DIR, files[0]);
    }
  } catch (err) {
    return { ok: false, action: 'find-file-failed', error: err.message, id: issueId };
  }
  if (!filePath) {
    return { ok: false, action: 'file-not-found', id: issueId };
  }

  // 3. Patch the issue file with full trace body
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const body = buildIssueBody(pattern, count, firstSeen, lastSeen);
    // Replace the default description body
    content = content.replace(
      /## Description\n\n## Progress\n- \[ \] Step 1\n- \[ \] Step 2\n\n## Notes\n/,
      body
    );
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    return { ok: false, action: 'patch-failed', error: err.message, id: issueId };
  }

  return { ok: true, id: issueId, title, filePath };
}

// ----------------- Discord push -----------------
async function sendDiscord(text) {
  try {
    const { code, stderr } = await runChild(
      ['openclaw', 'message', 'send', '--channel', 'discord', '--target', `channel:${DISCORD_CHANNEL}`, '-m', text],
      60000
    );
    if (code !== 0) {
      console.error(`❌ Discord push failed (exit ${code}): ${stderr.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`❌ Discord push failed: ${err.message}`);
    return false;
  }
}

function formatDiscordMessage(created) {
  return `🆕 **Auto-Issue Created** — ${hktIsoString(Date.now())}\n\n` +
    `**#${created.id}** — ${created.title}\n` +
    `Priority: P1 | Due: ${hktDateString(Date.now() + 7 * 86400 * 1000)}\n` +
    `\n— auto-created by error_auto_issue.js —`;
}

// ----------------- Main -----------------
async function main() {
  let errors;
  try {
    errors = loadErrors();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
  if (errors === null) {
    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({ skipped: true, reason: 'errors-file-missing' }, null, 2) + '\n');
    } else {
      log('ℹ️  memory/errors.json missing — nothing to do');
    }
    process.exit(0);
  }

  const groups = aggregatePatterns(errors, LOOKBACK_DAYS);
  const state = loadState();
  const seen = new Set(state.issuedPatterns);

  // Find patterns with count ≥ threshold AND not yet issued
  const candidates = [];
  for (const [key, g] of groups) {
    if (g?.samples?.length >= REPEAT_THRESHOLD && !seen.has(key)) {
      candidates.push({ key, ...g, count: g?.samples?.length });
    }
  }
  // Sort by count desc (most severe first)
  candidates.sort((a, b) => b.count - a.count);

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      lookbackDays: LOOKBACK_DAYS,
      threshold: REPEAT_THRESHOLD,
      totalGroups: groups.size,
      newPatterns: candidates.length,
      patterns: candidates.map(c => ({
        key: c.key,
        type: c.type,
        problem: c.problem,
        count: c.count,
        firstSeen: hktIsoString(Math.min(...c.timestamps)),
        lastSeen: hktIsoString(Math.max(...c.timestamps)),
      })),
    }, null, 2) + '\n');
  } else {
    log(`\n🔍 Error Auto-Issue: ${groups.size} patterns in last ${LOOKBACK_DAYS}d, ${candidates.length} new (≥${REPEAT_THRESHOLD} occurrences)`);
    if (candidates.length === 0) {
      log('   ✅ No new recurring patterns — no issues to create');
    } else {
      for (const c of candidates) {
        log(`   ${String(c.count).padStart(3)}× ${c.type} — ${String(c.problem || '').slice(0, 60)}`);
        log(`        key: ${c?.key?.slice(0, 80)}`);
      }
    }
  }

  if (DRY_RUN) {
    if (!JSON_OUT) log('   (Dry run — no issues, no state, no Discord)');
    process.exit(0);
  }

  let created = 0;
  let failed = 0;
  for (const c of candidates) {
    const firstSeen = Math.min(...c.timestamps);
    const lastSeen = Math.max(...c.timestamps);
    const result = await createIssue(c, c.count, firstSeen, lastSeen);
    if (result.ok) {
      created++;
      seen.add(c.key);
      if (!JSON_OUT) log(`   ✅ Created #${result.id}: ${result?.title?.slice(0, 70)}`);
      // Push to Discord
      await sendDiscord(formatDiscordMessage(result));
    } else {
      failed++;
      if (!JSON_OUT) log(`   ❌ Failed: ${JSON.stringify(result)}`);
    }
  }

  state.issuedPatterns = Array.from(seen);
  saveState(state);

  if (!JSON_OUT) {
    log(`\n   📋 Created: ${created}, Failed: ${failed}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(`❌ Unexpected error: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
