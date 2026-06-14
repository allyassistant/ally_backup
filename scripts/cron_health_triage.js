#!/usr/bin/env node
/**
 * cron_health_triage.js — Hourly scan of all cron jobs, classify health, push summary to #⚙️系統
 * (thin executor, no LLM in critical path, async spawn to avoid execSync hang on macOS)
 *
 * v1.0 — Initial implementation.
 *  - Calls `openclaw cron list --json` to get all jobs
 *  - Classifies each job: ok / warning / error / stale
 *  - Pushes Discord summary if any job changed status OR ≥6h since last push
 *  - State file tracks per-job status to suppress noise
 *
 * 用法:
 *   node scripts/cron_health_triage.js                # normal run (every-hour)
 *   node scripts/cron_health_triage.js --dry-run      # 唔 send Discord, 唔 update state
 *   node scripts/cron_health_triage.js --json         # 輸出 machine-readable JSON
 *   node scripts/cron_health_triage.js --help
 *
 * 失敗 exit 1 (stderr); stdout 純輸出。
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.cron_health_triage_state.json');
const DISCORD_CHANNEL = process.env.CRON_TRIAGE_CHANNEL || '1473376125584670872';
const STALE_THRESHOLD_HOURS = 26;   // 26h+ since lastRun = stale
const PUSH_COOLDOWN_HOURS = 6;       // force-push at most every 6h even if no change
const WARNING_STATUSES = new Set(['warning', 'skipped', 'partial']);
const ERROR_STATUSES = new Set(['error', 'failed', 'timeout']);

const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');
const DRY_RUN = process.argv.includes('--dry-run');
const JSON_OUT = process.argv.includes('--json');

function log(...args) {
  if (!QUIET) console.log(...args);
}

// ----------------- CLI help -----------------
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
cron_health_triage.js — Hourly cron health classifier (v1.0)

Usage:
  node scripts/cron_health_triage.js              # normal run
  node scripts/cron_health_triage.js --dry-run    # preview only (no Discord, no state update)
  node scripts/cron_health_triage.js --json       # output machine-readable JSON
  node scripts/cron_health_triage.js --quiet      # silent (for cron)
  node scripts/cron_health_triage.js --help

Exit codes:
  0 = clean (all ok) OR pushed successfully OR nothing changed
  1 = error (cron list failed, push failed, etc.)
`);
  process.exit(0);
}

// ----------------- State helpers -----------------
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { lastPush: null, jobStatus: {} };
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastPush: parsed.lastPush || null,
      jobStatus: parsed.jobStatus || {}
    };
  } catch (err) {
    log(`⚠️  State file corrupt; resetting: ${err.message}`);
    return { lastPush: null, jobStatus: {} };
  }
}

function saveState(state) {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log(`⚠️  Failed to save state: ${err.message}`);
  }
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
    child.stdout.on('data', d => { stdout += d.toString('utf8'); });
    child.stderr.on('data', d => { stderr += d.toString('utf8'); });
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

// ----------------- Cron fetch -----------------
async function fetchCronJobs() {
  // Use --json + 30s timeout (cron's internal). Wrap in async spawn.
  const { code, stdout, stderr } = await runChild(
    ['openclaw', 'cron', 'list', '--json', '--all', '--timeout', '30000'],
    90000
  );
  if (code !== 0) {
    throw new Error(`openclaw cron list --json failed (exit ${code}): ${stderr.slice(0, 200)}`);
  }
  // Strip any non-JSON prefix (e.g. plugin warnings)
  const firstBrace = stdout.indexOf('{');
  if (firstBrace < 0) {
    throw new Error('No JSON object in `openclaw cron list --json` output');
  }
  const jsonText = stdout.slice(firstBrace);
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse cron JSON: ${err.message}`);
  }
  if (!Array.isArray(data.jobs)) {
    throw new Error('Cron JSON missing `jobs` array');
  }
  return data.jobs;
}

// ----------------- Classification -----------------
function classifyJob(job) {
  const state = job.state || {};
  const lastStatus = state.lastStatus || state.lastRunStatus || 'unknown';
  const consecutiveErrors = state.consecutiveErrors || 0;
  const lastRunAtMs = state.lastRunAtMs || 0;

  let status = 'ok';
  let reason = '';

  // Stale: no run in STALE_THRESHOLD_HOURS, but job is enabled
  if (job.enabled !== false && lastRunAtMs > 0) {
    const ageHours = (Date.now() - lastRunAtMs) / 3600000;
    if (ageHours > STALE_THRESHOLD_HOURS) {
      status = 'stale';
      reason = `lastRun ${ageHours.toFixed(1)}h ago`;
    }
  }

  // Error: consecutiveErrors ≥ 1 OR lastStatus in ERROR_STATUSES
  if (status === 'ok') {
    if (consecutiveErrors >= 1 || ERROR_STATUSES.has(lastStatus)) {
      status = 'error';
      reason = consecutiveErrors >= 1
        ? `consecutiveErrors=${consecutiveErrors}, lastError: ${truncate(state.lastError || 'n/a', 80)}`
        : `lastStatus=${lastStatus}`;
    }
  }

  // Warning: lastStatus in WARNING_STATUSES
  if (status === 'ok' && WARNING_STATUSES.has(lastStatus)) {
    status = 'warning';
    reason = `lastStatus=${lastStatus}`;
  }

  return {
    id: job.id,
    name: job.name || '(unnamed)',
    status,
    reason,
    lastStatus,
    consecutiveErrors,
    lastRunAtMs,
  };
}

function truncate(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// ----------------- Diff vs state -----------------
function hasChanges(prevJobStatus, currentClassified) {
  for (const cj of currentClassified) {
    const prev = prevJobStatus[cj.id];
    if (!prev) return true; // new job
    if (prev.lastStatus !== cj.status) return true;
  }
  return false;
}

function shouldForcePush(state) {
  if (!state.lastPush) return true;
  const lastPushMs = Date.parse(state.lastPush);
  if (isNaN(lastPushMs)) return true;
  const hoursSince = (Date.now() - lastPushMs) / 3600000;
  return hoursSince >= PUSH_COOLDOWN_HOURS;
}

// ----------------- Discord formatting -----------------
function nowHktString() {
  const d = new Date();
  const hkt = new Date(d.getTime() + 8 * 3600 * 1000);
  const yyyy = hkt.getUTCFullYear();
  const mm = String(hkt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(hkt.getUTCDate()).padStart(2, '0');
  const hh = String(hkt.getUTCHours()).padStart(2, '0');
  const mi = String(hkt.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} HKT`;
}

function formatDiscordMessage(classified) {
  const byStatus = { ok: [], warning: [], error: [], stale: [] };
  for (const c of classified) byStatus[c.status].push(c);

  const lines = [];
  lines.push(`🩺 **Cron Health Triage** — ${nowHktString()}`);
  lines.push('');
  lines.push(
    `🟢 ${byStatus.ok.length} ok | 🟡 ${byStatus.warning.length} warning | 🔴 ${byStatus.error.length} error | ⚪ ${byStatus.stale.length} stale`
  );
  lines.push('');

  if (byStatus.error.length > 0) {
    lines.push('🔴 **Errors:**');
    for (const j of byStatus.error) {
      lines.push(`- \`${j.name}\` — ${j.reason || j.lastStatus}`);
    }
    lines.push('');
  }
  if (byStatus.stale.length > 0) {
    lines.push('⚪ **Stale (>26h since last run):**');
    for (const j of byStatus.stale) {
      lines.push(`- \`${j.name}\` — ${j.reason || 'no recent run'}`);
    }
    lines.push('');
  }
  if (byStatus.warning.length > 0) {
    lines.push('🟡 **Warnings:**');
    for (const j of byStatus.warning) {
      lines.push(`- \`${j.name}\` — ${j.reason || j.lastStatus}`);
    }
    lines.push('');
  }
  if (byStatus.error.length === 0 && byStatus.warning.length === 0 && byStatus.stale.length === 0) {
    lines.push('✅ All systems healthy.');
    lines.push('');
  }
  lines.push(`— ${classified.length} jobs scanned —`);
  return lines.join('\n');
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

// ----------------- Main -----------------
async function main() {
  let jobs;
  try {
    jobs = await fetchCronJobs();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const classified = jobs.map(classifyJob);
  const state = loadState();

  // Decide whether to push
  const changed = hasChanges(state.jobStatus, classified);
  const forced = shouldForcePush(state);
  const nonOk = classified.filter(c => c.status !== 'ok');
  const shouldPush = nonOk.length > 0 && (changed || forced);

  if (JSON_OUT) {
    const out = {
      timestamp: new Date().toISOString(),
      totalJobs: classified.length,
      counts: {
        ok: classified.filter(c => c.status === 'ok').length,
        warning: classified.filter(c => c.status === 'warning').length,
        error: classified.filter(c => c.status === 'error').length,
        stale: classified.filter(c => c.status === 'stale').length,
      },
      jobs: classified,
      pushed: shouldPush,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    const counts = {
      ok: classified.filter(c => c.status === 'ok').length,
      warning: classified.filter(c => c.status === 'warning').length,
      error: classified.filter(c => c.status === 'error').length,
      stale: classified.filter(c => c.status === 'stale').length,
    };
    log(`\n🩺 Cron Health Triage: ${counts.ok} ok / ${counts.warning} warn / ${counts.error} err / ${counts.stale} stale (${classified.length} total)`);
    if (nonOk.length > 0) {
      log('   Non-ok jobs:');
      for (const c of nonOk) {
        log(`     ${c.status.toUpperCase().padEnd(7)} ${c.name} — ${c.reason || c.lastStatus}`);
      }
    }
    if (shouldPush) {
      log(`   📤 Push to Discord (changed=${changed}, forced=${forced})`);
    } else if (nonOk.length > 0) {
      log(`   🔇 Suppress push (no change, within ${PUSH_COOLDOWN_HOURS}h cooldown)`);
    } else {
      log(`   ✅ All healthy — no push needed`);
    }
  }

  if (DRY_RUN) {
    if (!JSON_OUT) log('   (Dry run — state NOT updated)');
    process.exit(0);
  }

  if (shouldPush) {
    const text = formatDiscordMessage(classified);
    const ok = await sendDiscord(text);
    if (!ok && !JSON_OUT) {
      console.error('❌ Failed to push to Discord — state will still be updated to avoid retry storm');
    }
    // Update state regardless of push success to avoid re-pushing every hour
  }

  // Always update state with current statuses
  const newState = {
    lastPush: shouldPush ? new Date().toISOString() : state.lastPush,
    jobStatus: {},
  };
  for (const c of classified) {
    newState.jobStatus[c.id] = {
      lastStatus: c.status,
      lastPushedAt: shouldPush ? new Date().toISOString() : (state.jobStatus[c.id]?.lastPushedAt || null),
    };
  }
  saveState(newState);

  process.exit(0);
}

main().catch(err => {
  console.error(`❌ Unexpected error: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
