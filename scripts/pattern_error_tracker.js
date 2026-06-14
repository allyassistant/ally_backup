/**
 * pattern_error_tracker.js
 * 問題規律追蹤 - 從 L2 記憶掃描錯誤模式
 *
 * 用法: node pattern_error_tracker.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

// === CONFIG ===
const MEMORY_DIR = path.join(process.env.HOME, '.openclaw/workspace/memory');
const OUTPUT_FILE = path.join(MEMORY_DIR, 'patterns', 'errors.json');
const DRY_RUN = process.argv.includes('--dry-run');

// Error keywords to scan
const ERROR_KEYWORDS = ['error', 'Error', '錯誤', 'fail', 'failed', 'exception', 'Exception', 'warning', 'Warning', 'Timeout', 'timeout'];

// Date extraction patterns
const DATE_PATTERN = /(\d{4}-\d{2}-\d{2})/g;
const SESSION_PATTERN = /session[_-]?id[:\s]*([a-zA-Z0-9-]+)/i;

function log(...args) {
  console.log('[pattern_error_tracker]', ...args);
}

function ensurePatternsDir() {
  const patternsDir = path.dirname(OUTPUT_FILE);
  try {
    if (!fs.existsSync(patternsDir)) {
      fs.mkdirSync(patternsDir, { recursive: true });
      log('📁 Created patterns directory:', patternsDir);
    }
  } catch (e) {
    console.error('Error creating directory: ' + e.message);
    return;
  }
}

function getMemoryFiles() {
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const cutoff = fourteenDaysAgo.toISOString().slice(0, 10); // YYYY-MM-DD

    const files = fs.readdirSync(MEMORY_DIR);
    const memoryFiles = files
      .filter(f => {
        if (!/^\d{4}-\d{2}-\d{2}.*\.md$/.test(f)) return false;
        // Extract date from filename and filter to last 14 days
        const fileDate = f.slice(0, 10);
        return fileDate >= cutoff;
      })
      .map(f => path.join(MEMORY_DIR, f))
      .sort();

    log(`📂 Found ${memoryFiles.length} memory files (since ${cutoff})`);
    return memoryFiles;
  } catch (e) {
    log('❌ Error reading memory directory:', e.message);
    return [];
  }
}

function extractDateFromContent(content, fallbackDate) {
  const match = content.match(DATE_PATTERN);
  return match ? match[0] : fallbackDate;
}

function extractSessionId(content) {
  const match = content.match(SESSION_PATTERN);
  return match ? match[1] : 'unknown';
}

function categorizeError(line) {
  const lower = line.toLowerCase();

  if (lower.includes('timeout') || lower.includes('TIMEOUT')) return 'L0 timeout';
  if (lower.includes('syntax') || lower.includes('語法')) return 'Syntax error';
  if (lower.includes('permission') || lower.includes('權限')) return 'Permission error';
  if (lower.includes('network') || lower.includes('網絡')) return 'Network error';
  if (lower.includes('memory') || lower.includes('記憶')) return 'Memory error';
  if (lower.includes('json') || lower.includes('parse')) return 'JSON parse error';
  if (lower.includes('file') || lower.includes('檔案')) return 'File error';
  if (lower.includes('api') || lower.includes('API')) return 'API error';
  if (lower.includes('discord')) return 'Discord error';
  if (lower.includes('github')) return 'GitHub error';
  if (lower.includes('exec') || lower.includes('spawn')) return 'Process error';
  if (lower.includes('404') || lower.includes('not found')) return 'Not found error';
  if (lower.includes('401') || lower.includes('auth')) return 'Auth error';
  if (lower.includes('fail') || lower.includes('failed')) return 'Operation failed';
  if (lower.includes('exception')) return 'Exception';
  if (lower.includes('warning')) return 'Warning';
  if (lower.includes('error') || line.includes('錯誤')) return 'Generic error';

  return 'Unknown error';
}

/**
 * Check all active OpenClaw cron jobs for failures.
 * Adds cron error patterns to the analysis for display in bootstrap context.
 */
function checkCronFailures(errorsByType) {
  const { execSync } = require('child_process');
  const today = getHKTDateTime ? getHKTDateTime().slice(0, 10) : new Date().toISOString().slice(0, 10);

  let jobs = [];
  try {
    const stdout = execSync('openclaw cron list --json 2>/dev/null', {
      timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 50
    });
    const parsed = JSON.parse(stdout);
    jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || []);
  } catch (e) {
    log('⚠️ Could not query cron status:', e.message);
    return;
  }

  jobs.forEach(j => {
    const state = j.state || {};
    const errCount = state.consecutiveErrors || 0;
    if (errCount > 0 || state.lastRunStatus === 'error') {
      const name = j.name || 'unknown';
      const errorType = 'Cron Error: ' + name;
      const errMsg = state.lastError || 'Unknown failure';
      const lastRun = state.lastRunAtMs
        ? new Date(state.lastRunAtMs).toISOString().slice(0, 10)
        : today;

      if (!errorsByType[errorType]) {
        errorsByType[errorType] = {
          error_type: errorType,
          first_seen: lastRun,
          last_seen: lastRun,
          count: 0,
          sessions: ['cron'],
          examples: []
        };
      }

      errorsByType[errorType].count += errCount || 1;
      errorsByType[errorType].last_seen = lastRun;

      if (errorsByType[errorType].examples.length < 3) {
        errorsByType[errorType].examples.push(`${lastRun}: ${errMsg.slice(0, 120)}`);
      }
    }
  });

  log(`🕐 Cron check: ${jobs.length} jobs scanned`);
}

function analyzeErrors() {
  const memoryFiles = getMemoryFiles();
  log(`📂 Found ${memoryFiles.length} memory files`);

  const errorsByType = {};

  memoryFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileName = path.basename(filePath);
      const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
      const fileDate = dateMatch ? dateMatch[1] : 'unknown';

      const lines = content.split('\n');
      lines.forEach(line => {
        const hasError = ERROR_KEYWORDS.some(kw => line.includes(kw));
        if (hasError) {
          const errorType = categorizeError(line);
          const sessionId = extractSessionId(content);

          if (!errorsByType[errorType]) {
            errorsByType[errorType] = {
              error_type: errorType,
              first_seen: fileDate,
              last_seen: fileDate,
              count: 0,
              sessions: [],
              examples: []
            };
          }

          errorsByType[errorType].count++;
          errorsByType[errorType].last_seen = fileDate;

          if (!errorsByType[errorType].sessions.includes(sessionId)) {
            errorsByType[errorType].sessions.push(sessionId);
          }

          // Store first 3 examples
          if (errorsByType[errorType].examples.length < 3) {
            const example = line.trim().substring(0, 100);
            if (!errorsByType[errorType].examples.includes(example)) {
              errorsByType[errorType].examples.push(`${fileDate}: ${example}`);
            }
          }
        }
      });
    } catch (e) {
      log(`⚠️ Error reading ${filePath}: ${e.message}`);
    }
  });

  // Calculate patterns
  Object.values(errorsByType).forEach(err => {
    if (err.count >= 3) {
      err.pattern = `出現 ${err.count} 次`;
    } else if (err.count === 2) {
      err.pattern = '間歇性出現';
    } else {
      err.pattern = '單次出現';
    }
  });

  return errorsByType;
}

function generateOutput(errorsByType) {
  const errors = Object.values(errorsByType)
    .sort((a, b) => b.count - a.count);

  return {
    last_updated: getHKTDateTime(),
    errors: errors
  };
}

function main() {
  try {
    console.log('\n🔍 === Pattern Error Tracker ===\n');
    log('Starting error pattern analysis...');
    log('Dry run:', DRY_RUN ? 'YES (no files will be written)' : 'NO');

    ensurePatternsDir();

    const errorsByType = analyzeErrors();
    checkCronFailures(errorsByType);
    const output = generateOutput(errorsByType);

    console.log('\n📊 Results:');
    console.log(`   Total error types: ${output.errors.length}`);
    output.errors.forEach(err => {
      console.log(`   • ${err.error_type}: ${err.count} occurrences (${err.first_seen} ~ ${err.last_seen})`);
    });

    if (output.errors.length > 0 && output.errors[0].examples) {
      console.log('\n📝 Top error examples:');
      output.errors[0].examples.slice(0, 2).forEach(ex => {
        console.log(`   "${ex.substring(0, 80)}..."`);
      });
    }

    if (!DRY_RUN) {
      try {
        const tmpFile = OUTPUT_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(output, null, 2));
        fs.renameSync(tmpFile, OUTPUT_FILE);
        log(`\n✅ Written to ${OUTPUT_FILE}`);
      } catch (e) {
        log('\n❌ Failed to write output:', e.message);
      }
    } else {
      log('\n🔍 [DRY-RUN] Would write:', JSON.stringify(output, null, 2).substring(0, 200) + '...');
    }

    return output;
  } catch (e) {
    log('\n❌ main() failed:', e.message);
    process.exit(1);
  }
}

main();
