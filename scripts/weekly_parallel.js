#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };
const { getHKTDateTime } = require('./lib/time');

/**
 * Weekly Parallel Scheduler
 * 執行每週並行 jobs
 *
 * 使用方式:
 *   node scripts/weekly_parallel.js            # 執行所有
 *   node scripts/weekly_parallel.js --monday   # 只執行 Monday jobs
 *   node scripts/weekly_parallel.js --sunday   # 只執行 Sunday jobs
 */

const os = require('os');
const { promisify } = require('util');
const { execFile: execFileCallback } = require('child_process');
const fs = require('fs');

const execFile = promisify(execFileCallback);

// Auto-detect machine (via shared config)
const { HOME, isBliss, WS: WS_PATH } = require('./lib/config');
const NODE = process.execPath;

const DEFAULT_SCRIPT_TIMEOUT_MS = 120000;
const RAPNET_TIMEOUT_MS = 300000;

// Helper to check if script exists
function scriptExists(path) {
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

// Helper to run script with timeout
async function runScript(scriptPath, scriptName, timeout = DEFAULT_SCRIPT_TIMEOUT_MS, args = '', isShell = false) {
  try {
    if (!scriptExists(scriptPath)) {
      log(`⚠️  ${scriptName}: script not found, skipping`);
      return { name: scriptName, status: 'skipped', reason: 'not_found' };
    }

    const start = Date.now();
    try {
      log(`🚀 ${scriptName}: starting...`);

      // Parse args safely - split by space but respect quotes
      const parsedArgs = args ? args.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g)?.map(arg =>
        arg.replace(/^["']|["']$/g, '')
      ) || [] : [];

      // Build command arguments array (no shell string concatenation)
      const cmdArgs = isShell
        ? [scriptPath, ...parsedArgs]
        : [scriptPath, ...parsedArgs];
      const cmd = isShell ? 'bash' : NODE;

      await execFile(cmd, cmdArgs, {
        cwd: WS_PATH,
        timeout: timeout
      });

      const duration = ((Date.now() - start) / 1000).toFixed(1);
      log(`✅ ${scriptName}: completed (${duration}s)`);
      return { name: scriptName, status: 'ok', duration };

    } catch (e) {
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      const errorMsg = e.killed ? 'timeout' : e.message.split('\n')[0];
      log(`⚠️  ${scriptName}: ${errorMsg} (${duration}s)`);
      return { name: scriptName, status: 'error', error: errorMsg };
    }
  } catch (err) {
    console.error(`❌ runScript error: ${err.message}`);
    return { name: scriptName, status: 'error', error: err.message };
  }
}

// Monday jobs (07:00-08:00)
const MONDAY_JOBS = [
  { script: 'idex_fetcher_bot.js', name: 'IDEX 數據更新', timeout: DEFAULT_SCRIPT_TIMEOUT_MS },
  // { script: 'stock_valuation_bot.js', name: 'Stock Valuation', timeout: 60000 }, // REMOVED: deprecated valuation script
  { script: 'rapnet_weekly_workflow.js', name: 'RapNet Resources', timeout: RAPNET_TIMEOUT_MS },
];

// Sunday jobs (10:00) - weekly_correction_loop_bot.js removed (2026-04-02, use weekly_correction_loop.js via cron instead)
const SUNDAY_JOBS = [
  { script: 'deep_cleanup.sh', name: 'Deep Cleanup', timeout: RAPNET_TIMEOUT_MS, isShell: true },
];

// Run jobs in parallel
async function runParallelJobs(jobs) {
  const results = await Promise.all(
    jobs.map(job => {
      const scriptPath = `${WS_PATH}/scripts/${job.script}`;
      return runScript(scriptPath, job.name, job.timeout, job.args || '', job.isShell || false);
    })
  );
  return results;
}

// Parse command line args
const args = process.argv.slice(2);
const mode = args[0] || 'all';

async function main() {
  log(`=== Weekly Parallel Scheduler ===`);
  log(`⏱️  ${getHKTDateTime()}`);
  log('');

  const results = [];

  // Monday jobs
  if (mode === 'all' || mode === '--monday' || mode === 'monday') {
    log('📦 Monday Jobs (07:00 routine)');
    log('---');
    const mondayResults = await runParallelJobs(MONDAY_JOBS);
    results.push(...mondayResults);
    log('');
  }

  // Sunday jobs
  if (mode === 'all' || mode === '--sunday' || mode === 'sunday') {
    log('📦 Sunday Jobs (10:00 routine)');
    log('---');
    const sundayResults = await runParallelJobs(SUNDAY_JOBS);
    results.push(...sundayResults);
    log('');
  }

  // Summary
  log('===================================');
  log('📊 Summary');
  log('===================================');

  const ok = results.filter(r => r.status === 'ok').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;

  log(`✅ OK: ${ok}/${results.length}`);
  if (skipped > 0) log(`⚠️  Skipped: ${skipped}`);
  if (errors > 0) log(`❌ Errors: ${errors}`);
  log('');
  log('✅ Weekly Parallel Complete');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
