/**
 * pattern_analysis_daily.js
 * 每日 Pattern 分析總調度 - 順序運行所有 pattern 分析腳本
 *
 * 用法: node pattern_analysis_daily.js [--quiet]
 *
 * Cron: 每日 04:00 (Asia/Hong_Kong)
 * 0 4 * * * cd ~/.openclaw/workspace && node scripts/pattern_analysis_daily.js >> logs/pattern_analysis.log 2>&1
 */

const { execSync } = require('child_process');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

const SCRIPT_TIMEOUT_MS = 120000;

// === CONFIG ===
const HOME_DIR = process.env.HOME;
const SCRIPTS_DIR = path.join(HOME_DIR, '.openclaw/workspace/scripts');
const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');

// Scripts to run in order
const PATTERN_SCRIPTS = [
  { name: 'pattern_error_tracker', file: 'pattern_error_tracker.js' },
  { name: 'pattern_topic_graph', file: 'pattern_topic_graph.js' },
  { name: 'pattern_project_tracker', file: 'pattern_project_tracker.js' },
  { name: 'pattern_periodic_tagger', file: 'pattern_periodic_tagger.js' },
];

const CROSS_SESSION_SCRIPT = { name: 'cross_session_context', file: 'cross_session_context.js' };

// === HELPERS ===
function log(...args) {
  if (!QUIET) console.log('[pattern_analysis_daily]', ...args);
}

function logSection(title) {
  if (!QUIET) console.log('\n' + '═'.repeat(60));
  if (!QUIET) console.log(`  ${title}`);
  if (!QUIET) console.log('═'.repeat(60) + '\n');
}

function runScript(script) {
  const scriptPath = path.join(SCRIPTS_DIR, script.file);

  if (!QUIET) log(`Running: ${script.name}...`);

  let result = '';
  try {
    result = execSync(`node "${scriptPath}"`, {
      cwd: SCRIPTS_DIR,
      encoding: 'utf8',
      timeout: SCRIPT_TIMEOUT_MS,
    });
  } catch (execError) {
    log(`⚠️ ${script.name} failed: ${execError.message}`);
    return { success: false, error: execError.message };
  }

  if (!QUIET && result.trim()) {
    console.log(result.trim());
  }
  if (!QUIET) log(`✅ ${script.name} completed`);

  return { success: true, output: result };
}

// === MAIN ===
function main() {
  const startTime = Date.now();

  logSection('📊 Pattern Analysis Daily Run');
  log(`Time: ${getHKTDateTime()}`);
  log('');

  // Run all pattern scripts
  const results = [];
  for (const script of PATTERN_SCRIPTS) {
    const result = runScript(script);
    results.push({ script: script.name, ...result });
  }

  // Run cross-session context generation
  log('');
  const crossResult = runScript(CROSS_SESSION_SCRIPT);
  results.push({ script: CROSS_SESSION_SCRIPT.name, ...crossResult });

  // Summary
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);

  logSection('📈 Analysis Summary');

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  if (!QUIET) {
    console.log(`Total scripts: ${results.length}`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`⚠️ Failed: ${failCount}`);
    console.log(`Duration: ${duration}s`);
    console.log('');

    // Show failed scripts
    if (failCount > 0) {
      console.log('Failed scripts:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.script}: ${r.error}`);
      });
    }
  }

  // Exit with error if all failed
  if (failCount === results.length) {
    process.exit(1);
  }

  log('✅ Pattern analysis daily run completed');
}

// Run
try {
  main();
} catch (e) {
  console.error('[pattern_analysis_daily] Fatal error:', e.message);
  process.exit(1);
}
