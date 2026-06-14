#!/usr/bin/env node
/**
 * anomaly_proactive_push.js — Every 30 min, check `.proactive_alerts.json` for new
 * warning/critical anomalies, push to #⚙️系統, optionally auto-degrade cron on critical.
 * (thin executor, no LLM in critical path, async spawn)
 *
 * v1.0 — Initial implementation.
 *  - Reads `.proactive_alerts.json` written by `pattern_proactive_trigger.js`
 *  - Filters for severity = `warning` | `critical` (skip `info` spam)
 *  - State file tracks pushed alert signatures to avoid duplicate pushes
 *  - Auto-degrade: if `critical` alert names a specific cron job, disable that cron
 *
 * 用法:
 *   node scripts/anomaly_proactive_push.js                # normal run
 *   node scripts/anomaly_proactive_push.js --dry-run      # preview only
 *   node scripts/anomaly_proactive_push.js --auto-degrade # 啟用 critical auto-degrade
 *   node scripts/anomaly_proactive_push.js --help
 *
 * 失敗 exit 1 (stderr); stdout 純輸出。
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.anomaly_push_state.json');
const ALERTS_FILE = path.join(__dirname, '..', '.proactive_alerts.json');
const DISCORD_CHANNEL = process.env.ANOMALY_CHANNEL || '1473376125584670872';
const STATE_CAP = 500; // FIFO cap on pushed signatures

const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');
const DRY_RUN = process.argv.includes('--dry-run');
const AUTO_DEGRADE = process.argv.includes('--auto-degrade');
const JSON_OUT = process.argv.includes('--json');

function log(...args) {
  if (!QUIET) console.log(...args);
}

// ----------------- CLI help -----------------
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
anomaly_proactive_push.js — Push new warning/critical anomalies to #⚙️系統 (v1.0)

Usage:
  node scripts/anomaly_proactive_push.js              # normal run (push new alerts)
  node scripts/anomaly_proactive_push.js --dry-run    # preview only (no Discord, no state update)
  node scripts/anomaly_proactive_push.js --auto-degrade
                                                     # additionally disable cron for critical alerts
                                                     # that name a specific job
  node scripts/anomaly_proactive_push.js --quiet      # silent (for cron)
  node scripts/anomaly_proactive_push.js --help

Exit codes:
  0 = clean (no new alerts) OR pushed successfully
  1 = error (alerts file unreadable, push failed, etc.)
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

// ----------------- State helpers -----------------
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { pushedSignatures: [] };
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      pushedSignatures: Array.isArray(parsed.pushedSignatures) ? parsed.pushedSignatures : []
    };
  } catch (err) {
    log(`⚠️  State file corrupt; resetting: ${err.message}`);
    return { pushedSignatures: [] };
  }
}

function saveState(state) {
  try {
    // FIFO: keep last STATE_CAP
    const sigs = state.pushedSignatures.slice(-STATE_CAP);
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ pushedSignatures: sigs }, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log(`⚠️  Failed to save state: ${err.message}`);
  }
}

// ----------------- Alerts file -----------------
function loadAlerts() {
  if (!fs.existsSync(ALERTS_FILE)) {
    return null; // missing = clean exit
  }
  let data;
  try {
    const raw = fs.readFileSync(ALERTS_FILE, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${ALERTS_FILE}: ${err.message}`);
  }
  if (!data || !Array.isArray(data.alerts)) {
    throw new Error(`${ALERTS_FILE} missing 'alerts' array`);
  }
  return data.alerts;
}

// ----------------- Alert signature (for dedup) -----------------
function alertSignature(alert) {
  // Combine stable fields: type + message + data hash
  const t = alert.type || 'unknown';
  const m = alert.message || '';
  const d = alert.data ? JSON.stringify(alert.data, Object.keys(alert.data).sort()) : '';
  return `${t}::${m}::${d}`;
}

// ----------------- Severity filter -----------------
// `info` = noise (e.g. "new error pattern" with count=2). Skip.
// `warning` = noteworthy. Push.
// `critical` = urgent. Push + consider auto-degrade.
function isActionable(alert) {
  const sev = (alert.severity || '').toLowerCase();
  return sev === 'warning' || sev === 'critical';
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

function formatDiscordMessage(alert) {
  const sev = (alert.severity || 'warning').toUpperCase();
  const sevEmoji = sev === 'CRITICAL' ? '🔴' : '🟡';
  const lines = [];
  lines.push(`🚨 **Anomaly Detected** — ${nowHktString()}`);
  lines.push('');
  lines.push(`**Severity: ${sevEmoji} ${sev}**`);
  lines.push(`- Type: \`${alert.type || 'unknown'}\``);
  if (alert.data?.error_type) {
    lines.push(`- Error: \`${alert.data.error_type}\` (count: ${alert.data.count || 'n/a'})`);
  } else if (alert.data?.project_name) {
    lines.push(`- Project: \`${alert.data.project_name}\` (#${alert.data.issue_id || 'n/a'})`);
  } else if (alert.data?.cron) {
    lines.push(`- Cron: \`${alert.data.cron}\``);
  } else if (alert.data?.disk) {
    lines.push(`- Disk: ${alert.data.disk}`);
  }
  lines.push(`- Detail: ${alert.message || '(no message)'}`);
  if (alert.data?.last_seen || alert.data?.first_seen) {
    const ls = alert.data.last_seen || alert.data.first_seen;
    lines.push(`- Last seen: ${ls}`);
  }
  lines.push('');
  if (alert.suggestion) {
    lines.push(`**Recommendation:** ${alert.suggestion}`);
  } else {
    lines.push(`**Recommendation:** Investigate manually.`);
  }
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

// ----------------- Auto-degrade (optional) -----------------
// Critical alerts that name a specific cron job (e.g. via alert.data.cron or error_type
// matching a cron name) → disable that cron to prevent cascading failures.
async function autoDegrade(alert) {
  const cronName = alert.data?.cron;
  if (!cronName) return null; // no specific job to disable

  // Find the cron id by name
  const { code, stdout, stderr } = await runChild(
    ['openclaw', 'cron', 'list', '--json', '--all', '--timeout', '30000'],
    60000
  );
  if (code !== 0) {
    return { ok: false, action: 'lookup-failed', error: stderr.slice(0, 200) };
  }
  const firstBrace = stdout.indexOf('{');
  if (firstBrace < 0) return { ok: false, action: 'lookup-parse-failed' };
  let data;
  try { data = JSON.parse(stdout.slice(firstBrace)); } catch (e) {
    return { ok: false, action: 'lookup-parse-failed', error: e.message };
  }
  const job = (data.jobs || []).find(j => j.name === cronName);
  if (!job) {
    return { ok: false, action: 'cron-not-found', cron: cronName };
  }

  // Disable the cron
  const { code: dCode, stderr: dErr } = await runChild(
    ['openclaw', 'cron', 'disable', job.id],
    30000
  );
  if (dCode !== 0) {
    return { ok: false, action: 'disable-failed', cron: cronName, error: dErr.slice(0, 200) };
  }
  return { ok: true, action: 'disabled', cron: cronName, id: job.id };
}

// ----------------- Main -----------------
async function main() {
  let alerts;
  try {
    alerts = loadAlerts();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  if (alerts === null) {
    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({ skipped: true, reason: 'alerts-file-missing' }, null, 2) + '\n');
    } else {
      log('ℹ️  .proactive_alerts.json missing — nothing to push');
    }
    process.exit(0);
  }

  const state = loadState();
  const seen = new Set(state.pushedSignatures);

  // Filter for actionable (warning/critical) + not yet pushed
  const newAlerts = alerts.filter(a => isActionable(a) && !seen.has(alertSignature(a)));

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      totalAlerts: alerts.length,
      newAlerts: newAlerts.length,
      autoDegradeEnabled: AUTO_DEGRADE,
      alerts: newAlerts,
    }, null, 2) + '\n');
  } else {
    log(`\n🚨 Anomaly Proactive Push: ${alerts.length} total alerts, ${newAlerts.length} new (actionable & unseen)`);
    if (newAlerts.length === 0) {
      log('   ✅ No new actionable anomalies — no push needed');
    } else {
      for (const a of newAlerts) {
        const sig = alertSignature(a);
        log(`   ${(a.severity || '?').toUpperCase().padEnd(8)} ${a.type} — ${a.message?.slice(0, 80) || '(no msg)'}`);
        log(`     sig: ${sig.slice(0, 100)}`);
      }
    }
  }

  if (DRY_RUN) {
    if (!JSON_OUT) log('   (Dry run — no push, no state update, no auto-degrade)');
    process.exit(0);
  }

  let pushed = 0;
  let degraded = 0;
  for (const alert of newAlerts) {
    const text = formatDiscordMessage(alert);
    const ok = await sendDiscord(text);
    if (ok) {
      pushed++;
      seen.add(alertSignature(alert));
    }

    if (AUTO_DEGRADE && (alert.severity || '').toLowerCase() === 'critical') {
      const result = await autoDegrade(alert);
      if (result?.ok) {
        degraded++;
        if (!JSON_OUT) log(`   🛑 Auto-degraded: ${result.cron} (${result.id})`);
      } else if (result) {
        if (!JSON_OUT) log(`   ⚠️  Auto-degrade failed: ${JSON.stringify(result)}`);
      }
    }
  }

  // Save state
  state.pushedSignatures = Array.from(seen);
  saveState(state);

  if (!JSON_OUT) {
    log(`\n   📤 Pushed: ${pushed}/${newAlerts.length}`);
    if (AUTO_DEGRADE) log(`   🛑 Auto-degraded: ${degraded} cron(s)`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(`❌ Unexpected error: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
