#!/usr/bin/env node
/**
 * Daily Maintenance - Parallel Execution
 * 同時執行多個 maintenance scripts，節省時間
 *
 * 使用方式:
 *   node scripts/daily_maintenance.js
 *
 * 並行執行:
 *   - memory_section_cleanup.js
 *   - session_cleanup.js
 * 順序執行:
 *   - issue_auto_followup.js
 */

const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { exec: execCallback } = require('child_process');
const fs = require('fs');

const exec = promisify(execCallback);

// Auto-detect machine (via shared config)
const { HOME, isBliss, WS: WS_PATH } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const NODE = process.execPath;

// CONFIG: Magic numbers extracted to named constants
const CONFIG = {
  // Timeouts (ms)
  DEFAULT_TIMEOUT: 120000,
  LONG_TIMEOUT: 180000,
  SHORT_TIMEOUT: 60000,
  // File permissions
  DIR_MODE: 0o755,
  // Paths
  BACKUP_DIR_NAME: 'workspace-backup-bak',
};

// Quiet mode support (--quiet flag suppresses info output)
const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

log(`=== Daily Maintenance (${isBliss ? 'Bliss' : 'Ally'}) ===`);
log(`⏱️  ${getHKTDateTime()}`);
log('');

// Helper to check if script exists and is within workspace
function scriptExists(scriptPath) {
  try {
    // Security: resolve to absolute path and verify it's within WS_PATH
    const resolved = path.resolve(scriptPath);
    const wsResolved = path.resolve(WS_PATH);
    if (!resolved.startsWith(wsResolved + path.sep) && resolved !== wsResolved) {
      log(`⚠️  Security: script path "${scriptPath}" is outside workspace, skipping`);
      return false;
    }
    return fs.existsSync(resolved);
  } catch {
    return false;
  }
}

// Helper to run script with timeout
async function runScript(scriptPath, scriptName, timeout = CONFIG.DEFAULT_TIMEOUT, args = '') {
  if (!scriptExists(scriptPath)) {
    log(`⚠️  ${scriptName}: script not found, skipping`);
    return { name: scriptName, status: 'skipped', reason: 'not_found' };
  }

  const start = Date.now();
  try {
    log(`🚀 ${scriptName}: starting...`);

    const cmd = args ? `${NODE} ${scriptPath} ${args}` : `${NODE} ${scriptPath}`;
    // Track child process for graceful shutdown
    const childProc = execCallback(cmd, {
      cwd: WS_PATH,
      timeout: timeout
    });
    runningProcesses.add(childProc);

    await new Promise((resolve, reject) => {
      childProc.on('exit', (code) => {
        runningProcesses.delete(childProc);
        if (code === 0) resolve();
        else reject(new Error(`exit code ${code}`));
      });
      childProc.on('error', (err) => {
        runningProcesses.delete(childProc);
        reject(err);
      });
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
}

// Define parallel jobs
// NOTE: error_autofix.js removed - runs via System Check (10:00, 15:00, 22:00)
const PARALLEL_JOBS = [
  { script: 'memory_section_cleanup.js', name: 'Memory Section Cleanup', timeout: CONFIG.LONG_TIMEOUT },
  { script: 'session_cleanup.js', name: 'Session Cleanup', timeout: CONFIG.DEFAULT_TIMEOUT, args: '--cron --include-subagents' },
  { script: 'weekly_correction_loop.js', name: 'Mini-Curator (Inactivity)', timeout: CONFIG.SHORT_TIMEOUT, args: '--inactivity-trigger --quiet' },
];

// Backup directory for .bak files
const BACKUP_DIR = path.join(HOME, '.openclaw', CONFIG.BACKUP_DIR_NAME);

// Security: Validate path is within expected directory (prevent path traversal)
// Uses realpath to resolve symlinks (prevents symlink escape)
function isPathSafe(basePath, targetPath) {
  try {
    const resolvedBase = fs.realpathSync(basePath);
    const resolvedTarget = fs.realpathSync(targetPath);
    return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
  } catch (e) {
    // Fallback to path.resolve if realpath fails (e.g. target doesn't exist yet)
    const resolvedBase = path.resolve(basePath);
    const resolvedTarget = path.resolve(targetPath);
    return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
  }
}

// Helper: Move .bak files to backup directory
async function moveBakFilesToBackup() {
  const scriptsDir = path.join(WS_PATH, 'scripts');
  const backupDir = BACKUP_DIR;

  try {
    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true, mode: CONFIG.DIR_MODE });
    }

    // Find all .bak files in scripts/
    let bakFiles;
    try {
      bakFiles = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.bak') || f.includes('.bak.'));
    } catch (e) {
      log(`⚠️  Cannot read scripts directory: ${e.message}`);
      return { status: 'error', error: e.message };
    }

    if (bakFiles.length === 0) {
      log('📁 .bak cleanup: No .bak files found in scripts/');
      return { status: 'ok', moved: 0 };
    }

    // Move each .bak file
    let moved = 0;
    let failed = 0;
    for (const file of bakFiles) {
      const src = path.join(scriptsDir, file);
      const dest = path.join(backupDir, file);

      // Security: Verify source is within scriptsDir (prevent path traversal)
      if (!isPathSafe(scriptsDir, src)) {
        log(`   ⚠️  Security: "${file}" is outside scripts/, skipping`);
        failed++;
        continue;
      }

      // Security: Verify destination is within backupDir
      if (!isPathSafe(backupDir, dest)) {
        log(`   ⚠️  Security: destination for "${file}" is unsafe, skipping`);
        failed++;
        continue;
      }

      try {
        fs.renameSync(src, dest);
        moved++;
        log(`   📦 Moved: ${file}`);
      } catch (e) {
        log(`   ⚠️  Failed to move ${file}: ${e.message}`);
        failed++;
      }
    }

    log(`✅ .bak cleanup: Moved ${moved}/${bakFiles.length} files to ${CONFIG.BACKUP_DIR_NAME}/`);
    if (failed > 0) {
      log(`   ⚠️  Failed: ${failed} files`);
    }
    return { status: 'ok', moved, failed, total: bakFiles.length };

  } catch (e) {
    log(`⚠️  .bak cleanup failed: ${e.message}`);
    return { status: 'error', error: e.message };
  }
}

// Sequential jobs (should run after parallel)
const SEQUENTIAL_JOBS = [
  { script: 'issue_auto_followup.js', name: 'Issue Auto Followup', timeout: CONFIG.SHORT_TIMEOUT },
];

// Run jobs in parallel
async function runParallelJobs(jobs) {
  log(`🚀 Starting ${jobs.length} jobs in parallel...`);
  log('---');

  const start = Date.now();
  const results = await Promise.all(
    jobs.map(job => runScript(
      `${WS_PATH}/scripts/${job.script}`,
      job.name,
      job.timeout,
      job.args || ''
    ))
  );

  const totalDuration = ((Date.now() - start) / 1000).toFixed(1);
  log('---');
  log(`✅ Parallel jobs completed in ${totalDuration}s`);

  return results;
}

// Run jobs sequentially
async function runSequentialJobs(jobs) {
  const results = [];

  for (const job of jobs) {
    log('');
    const result = await runScript(
      `${WS_PATH}/scripts/${job.script}`,
      job.name,
      job.timeout,
      job.args || ''
    );
    results.push(result);
  }

  return results;
}

// Track running child processes for graceful shutdown
const runningProcesses = new Set();

// Graceful shutdown handler
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('');
  log(`⚠️  Received ${signal}, shutting down gracefully...`);
  // Kill all tracked child processes
  if (runningProcesses.size > 0) {
    log(`   Killing ${runningProcesses.size} running process(es)...`);
    for (const cp of runningProcesses) {
      try {
        if (cp && !cp.killed) {
          cp.kill('SIGTERM');
        }
      } catch (_) {}
    }
    // Force kill after 2 seconds
    setTimeout(() => {
      for (const cp of runningProcesses) {
        try {
          if (cp && !cp.killed) cp.kill('SIGKILL');
        } catch (_) {}
      }
      log(`✅ Cleanup complete, exiting.`);
      process.exit(128 + (signal === 'SIGTERM' ? 15 : 2));
    }, 2000).unref();
  } else {
    log(`✅ No running processes to clean up, exiting.`);
    process.exit(128 + (signal === 'SIGTERM' ? 15 : 2));
  }
}

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Main execution
async function main() {
  const allResults = [];

  // Phase 1: Parallel jobs
  log('📦 Phase 1: Parallel Jobs');
  const parallelResults = await runParallelJobs(PARALLEL_JOBS);
  allResults.push(...parallelResults);

  // Phase 2: Sequential jobs (if needed)
  if (SEQUENTIAL_JOBS.length > 0) {
    log('');
    log('📦 Phase 2: Sequential Jobs');
    const sequentialResults = await runSequentialJobs(SEQUENTIAL_JOBS);
    allResults.push(...sequentialResults);
  }

  // Phase 3: .bak files cleanup
  log('');
  log('📦 Phase 3: .bak Files Cleanup');
  const bakResult = await moveBakFilesToBackup();
  allResults.push({ name: '.bak Cleanup', ...bakResult });

  // Summary
  log('');
  log('===================================');
  log('📊 Maintenance Summary');
  log('===================================');

  const ok = allResults.filter(r => r.status === 'ok').length;
  const skipped = allResults.filter(r => r.status === 'skipped').length;
  const errors = allResults.filter(r => r.status === 'error').length;

  log(`✅ OK: ${ok}/${allResults.length}`);
  if (skipped > 0) log(`⚠️  Skipped: ${skipped}`);
  if (errors > 0) log(`❌ Errors: ${errors}`);

  log('');
  log('✅ Daily Maintenance Complete');

  // Exit with error code if any jobs failed
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('❌ Maintenance failed:', e.message);
  process.exit(1);
});
