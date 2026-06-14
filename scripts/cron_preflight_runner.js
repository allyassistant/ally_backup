#!/usr/bin/env node
/**
 * cron_preflight_runner.js — Cron job preflight + post-run alert wrapper
 *
 * 用途：包裝 openclaw cron run <jobId>，加 preflight health check 同 post-run alert。
 *       解決 issue #138 — DeepSeek API hang 期間 cron 失敗冇主動通知。
 *
 * 用法：
 *   node scripts/cron_preflight_runner.js <jobId> [--dry-run] [--skip-preflight] [--skip-alert]
 *
 * 流程：
 *   1. PREFLIGHT：檢查 provider 最近 health（讀 session trajectory）
 *      - 過去 30 分鐘有 ≥2 次 hang/abort 跡象 → 標記 UNHEALTHY
 *      - 否則 HEALTHY
 *   2. 如果 UNHEALTHY + preflight 唔 skip → 唔 trigger cron，只 send Discord alert
 *   3. 否則 trigger `openclaw cron run <jobId>`
 *   4. 等待完成（polling state，每 5s check 一次，timeout 10 min）
 *   5. POST-RUN：讀 state.lastRunStatus
 *      - error → Discord alert 包含 error / model / provider / duration
 *      - ok → silent（除非有 --verbose）
 *
 * 範例：
 *   node scripts/cron_preflight_runner.js 2f9b5b1c-328a-4589-8f4b-a33a7ec387d5
 *   node scripts/cron_preflight_runner.js 2f9b5b1c-328a-4589-8f4b-a33a7ec387d5 --dry-run
 *
 * VERSION: 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace'),
  SESSIONS_DIR: path.join(process.env.HOME || '/Users/ally', '.openclaw/agents/main/sessions'),
  DISCORD_CHANNEL: '1473376125584670872', // #⚙️系統
  HEALTH_WINDOW_MS: 30 * 60 * 1000, // 30 min
  HEALTH_FAILURE_THRESHOLD: 2, // hang/abort 次數
  POST_RUN_TIMEOUT_MS: 10 * 60 * 1000, // 10 min
  POST_RUN_POLL_MS: 5000, // 5s
};

function log(...args) {
  console.log('[preflight-runner]', ...args);
}

function error(...args) {
  console.error('[preflight-runner][ERROR]', ...args);
}

function getJobInfo(jobId) {
  try {
    const out = execSync(`openclaw cron get ${jobId} 2>/dev/null || echo "NOT_FOUND"`, { encoding: 'utf8' });
    if (out.trim() === 'NOT_FOUND') return null;
    return JSON.parse(out);
  } catch (e) {
    error('Failed to get cron job info:', e.message);
    return null;
  }
}

function findSessionForJob(jobId, sinceMs) {
  // Find recent session files for this job (last 30 min)
  try {
    const sessions = fs.readdirSync(CONFIG.SESSIONS_DIR)
      .filter(f => f.endsWith('.trajectory.jsonl'))
      .map(f => {
        const full = path.join(CONFIG.SESSIONS_DIR, f);
        const stat = fs.statSync(full);
        return { file: full, mtime: stat.mtimeMs, id: f.replace('.trajectory.jsonl', '') };
      })
      .filter(s => s.mtime > sinceMs)
      .sort((a, b) => b.mtime - a.mtime);

    for (const s of sessions) {
      try {
        const content = fs.readFileSync(s.file, 'utf8');
        if (content.includes(jobId)) {
          return s;
        }
      } catch {}
    }
    return null;
  } catch (e) {
    error('Failed to find session:', e.message);
    return null;
  }
}

function checkProviderHealth(jobId) {
  const now = Date.now();
  const since = now - CONFIG.HEALTH_WINDOW_MS;
  const session = findSessionForJob(jobId, since);

  if (!session) {
    log('No recent sessions for this job, treating as HEALTHY (no data)');
    return { healthy: true, reason: 'no-recent-data', evidence: [] };
  }

  try {
    const content = fs.readFileSync(session.file, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    const evidence = [];
    let abortCount = 0;
    let failCount = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const data = event.data || {};
        // Check for abort signals
        if (data.aborted === true || data.externalAbort === true) {
          if (event.ts && new Date(event.ts).getTime() > since) {
            abortCount++;
            evidence.push({ ts: event.ts, type: 'aborted', reason: data.promptError || 'unknown' });
          }
        }
        if (data.finalStatus === 'error' || data.status === 'error') {
          if (event.ts && new Date(event.ts).getTime() > since) {
            failCount++;
          }
        }
      } catch {}
    }

    const isHealthy = abortCount < CONFIG.HEALTH_FAILURE_THRESHOLD;
    return {
      healthy: isHealthy,
      abortCount,
      failCount,
      sessionId: session.id,
      sessionMtime: session.mtime,
      evidence: evidence.slice(0, 3), // 最多 3 個 evidence
      reason: isHealthy ? 'healthy' : `recent-aborts (${abortCount} in last 30min)`,
    };
  } catch (e) {
    error('Health check read failed:', e.message);
    return { healthy: true, reason: 'read-error', evidence: [] };
  }
}

function sendDiscordAlert(embed) {
  try {
    const msg = JSON.stringify(embed).replace(/"/g, '\\"');
    const cmd = `openclaw message send --channel discord --target ${CONFIG.DISCORD_CHANNEL} --message "${msg}"`;
    execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    log('Discord alert sent');
  } catch (e) {
    error('Failed to send Discord alert:', e.message);
  }
}

function formatHealthReport(health) {
  if (health.healthy) {
    return `🟢 Provider healthy: ${health.reason || 'no data'}`;
  }
  return `🔴 Provider UNHEALTHY: ${health.reason}\nAbort count: ${health.abortCount} (last 30min)\nLatest evidence: ${JSON.stringify(health.evidence)}`;
}

async function pollUntilDone(jobId, startMs) {
  const deadline = Date.now() + CONFIG.POST_RUN_TIMEOUT_MS;
  let lastStatus = null;
  let lastError = null;
  let pollCount = 0;

  while (Date.now() < deadline) {
    pollCount++;
    const info = getJobInfo(jobId);
    if (!info) {
      error(`Poll ${pollCount}: Failed to get job state`);
      await sleep(CONFIG.POST_RUN_POLL_MS);
      continue;
    }

    const state = info.state || {};
    const isRunning = !!state.runningAtMs;
    const lastRunAt = state.lastRunAtMs || 0;

    // Check if last run started after our trigger
    if (lastRunAt > startMs) {
      lastStatus = state.lastRunStatus;
      lastError = state.lastError;
      return { lastStatus, lastError, state, polls: pollCount };
    }

    if (!isRunning && lastStatus === null) {
      // No run in progress and no result yet
      lastStatus = 'no-run-detected';
      return { lastStatus, lastError, state, polls: pollCount };
    }

    await sleep(CONFIG.POST_RUN_POLL_MS);
  }

  return { lastStatus: 'timeout', lastError: 'Post-run poll timeout', state: null, polls: pollCount };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const jobId = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const skipPreflight = args.includes('--skip-preflight');
  const skipAlert = args.includes('--skip-alert');
  const verbose = args.includes('--verbose') || process.env.PREFLIGHT_VERBOSE === '1';

  if (!jobId) {
    error('Usage: node cron_preflight_runner.js <jobId> [--dry-run] [--skip-preflight] [--skip-alert]');
    process.exit(1);
  }

  log(`Starting for jobId: ${jobId} (dryRun=${dryRun}, skipPreflight=${skipPreflight}, skipAlert=${skipAlert})`);

  // === Step 1: Get job info ===
  const jobInfo = getJobInfo(jobId);
  if (!jobInfo) {
    error(`Job not found: ${jobId}`);
    process.exit(1);
  }
  const jobName = jobInfo.name || jobId;
  log(`Job name: ${jobName}`);

  // === Step 2: Preflight health check ===
  let health = { healthy: true, reason: 'skipped' };
  if (!skipPreflight) {
    log('Running preflight health check...');
    health = checkProviderHealth(jobId);
    log(`Health: ${formatHealthReport(health)}`);

    if (!health.healthy && !dryRun) {
      const alert = {
        type: 'preflight_unhealthy',
        jobId,
        jobName,
        reason: health.reason,
        abortCount: health.abortCount,
        evidence: health.evidence,
        action: 'SKIPPED (not triggering cron)',
      };
      if (!skipAlert) {
        sendDiscordAlert(`🚨 Cron Preflight: ${jobName}\n${formatHealthReport(health)}\n\n⏭️ Cron run skipped to avoid repeated failure`);
      } else {
        log('ALERT (dry-skipped):', JSON.stringify(alert));
      }
      log('Skipping cron trigger due to unhealthy preflight');
      process.exit(0);
    }
  } else {
    log('Preflight skipped (--skip-preflight)');
  }

  if (dryRun) {
    log('DRY-RUN: Would trigger `openclaw cron run ' + jobId + '`');
    log('DRY-RUN: No action taken');
    process.exit(0);
  }

  // === Step 3: Trigger cron ===
  log(`Triggering: openclaw cron run ${jobId}`);
  const triggerStartMs = Date.now();
  try {
    execSync(`openclaw cron run ${jobId}`, { encoding: 'utf8', timeout: 30000 });
  } catch (e) {
    error('Failed to trigger cron:', e.message);
    if (!skipAlert) {
      sendDiscordAlert(`❌ Cron Preflight Runner: Failed to trigger\nJob: ${jobName} (${jobId})\nError: ${e.message}`);
    }
    process.exit(1);
  }

  // === Step 4: Poll for completion ===
  log('Polling for completion...');
  const result = await pollUntilDone(jobId, triggerStartMs);
  log(`Poll result (after ${result.polls} polls): status=${result.lastStatus}`);

  // === Step 5: Post-run alert ===
  if (result.lastStatus === 'error' || result.lastStatus === 'timeout' || result.lastStatus === 'no-run-detected') {
    const state = result.state || {};
    const errorMsg = result.lastError || 'unknown';
    const model = state.lastRunModelId || '?';
    const provider = state.lastRunProvider || '?';
    const duration = state.lastDurationMs || 0;
    const durStr = duration > 1000 ? `${(duration/1000).toFixed(1)}s` : `${duration}ms`;

    const alertText = `🔴 Cron Run Failed: ${jobName}\n` +
      `Status: ${result.lastStatus}\n` +
      `Model: ${model} (${provider})\n` +
      `Duration: ${durStr}\n` +
      `Error: ${errorMsg}\n` +
      `JobId: ${jobId}`;

    log('ALERT:', alertText);
    if (!skipAlert) {
      sendDiscordAlert(alertText);
    }
    process.exit(1);
  } else {
    const durStr = result.state?.lastDurationMs ? `${(result.state.lastDurationMs/1000).toFixed(1)}s` : '?';
    log(`✅ Cron run succeeded: ${jobName} (${durStr})`);
    if (verbose) {
      log(`  State: ${JSON.stringify(result.state, null, 2)}`);
    }
    process.exit(0);
  }
}

main().catch(e => {
  error('Unhandled error:', e.message);
  error(e.stack);
  process.exit(1);
});
