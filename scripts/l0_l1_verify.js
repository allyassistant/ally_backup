#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const _log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * L0/L1 Fallback Verify Script
 *
 * Fixed:
 * 1. regenerate() actually spawns the generator script
 * 2. Empty topics guard - throws if no topics extracted
 * 3. regenerate() now passes --date and --force to memory_generator.js
 * 4. getYesterdayDate() aligned with memory_generator.js (HKT-first)
 * 5. Removed hardcoded /Users/ally fallback
 * 6. LOG_FILE uses HKT date (consistent with memory_generator.js)
 * 7. Uses process.execPath instead of non-standard process.env.NODE
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn, execSync } = require('child_process');
const { MEMORY_DIR } = require('./lib/config');
const { atomicWriteSync } = require('./lib/state');
const L0_DIR = path.join(MEMORY_DIR, 'l0-abstract');
const L1_DIR = path.join(MEMORY_DIR, 'l1-overview');
const LOG_DIR = path.join(MEMORY_DIR, 'logs');

// ==================== CONFIG ====================
const CONFIG = {
  L0_TIMEOUT_MS: 120000,  // 2 minutes timeout for L0 generation
  L1_TIMEOUT_MS: 180000,  // 3 minutes timeout for L1 generation
};


// Ensure directories exist
try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
  console.error('Error: ' + e.message);
  return;
}

const LOG_FILE = path.join(LOG_DIR, `verify_${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })}.log`);

function log(msg, type = 'INFO') {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${type}] ${msg}`;
  _log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }
}

function getErrorMessage(e) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

/** Aligned with memory_generator.js: derive yesterday from HKT today string */
function getYesterdayDate() {
  const now = new Date();
  const todayHKT = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  const [year, month, day] = todayHKT.split('-').map(Number);

  let yesterdayDay = day - 1;
  let yesterdayMonth = month;
  let yesterdayYear = year;

  if (yesterdayDay === 0) {
    yesterdayMonth--;
    if (yesterdayMonth === 0) {
      yesterdayMonth = 12;
      yesterdayYear--;
    }
    yesterdayDay = new Date(yesterdayYear, yesterdayMonth, 0).getDate();
  }

  return `${yesterdayYear}-${String(yesterdayMonth).padStart(2, '0')}-${String(yesterdayDay).padStart(2, '0')}`;
}

function main() {
  try {
    const dateStr = getYesterdayDate();
    log(`Starting L0/L1 verification for ${dateStr}`);

    let issues = 0;

  // Check L0
  const l0File = path.join(L0_DIR, `${dateStr}.md`);
  let l0Exists;
  try {
    l0Exists = fs.existsSync(l0File);
  } catch (e) {
    console.error('Error checking file: ' + e.message);
    l0Exists = false;
  }
  if (!l0Exists) {
    log(`L0 MISSING, regenerating...`, 'WARN');
    const result = regenerate('L0', l0File, dateStr);
    if (result.success) {
      log(`L0 regenerated successfully`, 'SUCCESS');
    } else {
      log(`L0 regeneration failed: ${result.error}`, 'ERROR');
      issues++;
    }
  } else {
    try {
      const stat = fs.statSync(l0File);
      log(`L0 exists (${stat.size} bytes)`, 'OK');
    } catch (e) {
      console.error('Error reading file stats: ' + e.message);
      issues++;
    }
  }

  // Check L1
  const l1File = path.join(L1_DIR, `${dateStr}.md`);
  let l1Exists;
  try {
    l1Exists = fs.existsSync(l1File);
  } catch (e) {
    console.error('Error checking file: ' + e.message);
    l1Exists = false;
  }
  if (!l1Exists) {
    log(`L1 MISSING, regenerating...`, 'WARN');
    const result = regenerate('L1', l1File, dateStr);
    if (result.success) {
      log(`L1 regenerated successfully`, 'SUCCESS');
    } else {
      log(`L1 regeneration failed: ${result.error}`, 'ERROR');
      issues++;
    }
  } else {
    try {
      const stat = fs.statSync(l1File);
      log(`L1 exists (${stat.size} bytes)`, 'OK');
    } catch (e) {
      console.error('Error reading file stats: ' + e.message);
      issues++;
    }
  }

  if (issues === 0) {
    log(`✅ All verifications passed`, 'SUCCESS');
    process.exit(0);
  } else {
    log(`⚠️ ${issues} issues found`, 'WARN');
    process.exit(1);
  }
  } catch (e) {
    log(`❌ Fatal error in main: ${e.message}`, 'ERROR');
    console.error(e.stack);
    process.exit(1);
  }
}

function regenerate(type, outputFile, dateStr) {
  // Use unified memory_generator.js directly (l0_generator.js / l1_generator.js are deprecated wrappers)
  const homeDir = process.env.HOME || os.homedir();
  if (!homeDir) throw new Error('HOME environment variable required');
  const scriptPath = path.join(homeDir, '.openclaw', 'workspace', 'scripts', 'memory_generator.js');

  // First try: actually spawn the generator script with --date and --force
  try {
    if (fs.existsSync(scriptPath)) {
      log(`Running ${type} generator: memory_generator.js --level ${type} --date ${dateStr} --force`);
      // P0 Fix: Add try-catch for execFileSync
      try {
        execFileSync(process.execPath, [scriptPath, '--level', type, '--date', dateStr, '--force'], {
          timeout: type === 'L0' ? CONFIG.L0_TIMEOUT_MS : CONFIG.L1_TIMEOUT_MS,
          stdio: 'inherit'
        });
      } catch (execErr) {
        log(`⚠️ ${type} generator exec failed: ${execErr.message}`);
        // Continue to fallback method
      }

      // Check if generator wrote the file
      let fileExists;
      try {
        fileExists = fs.existsSync(outputFile);
      } catch (e) {
        console.error('Error checking file: ' + e.message);
        fileExists = false;
      }
      if (fileExists) {
        try {
          const stat = fs.statSync(outputFile);
          if (stat.size > 100) {
            log(`✅ ${type} generator success (${stat.size} bytes)`);
            return { success: true };
          } else {
            log(`⚠️ ${type} generator wrote empty file (${stat.size} bytes)`, 'WARN');
          }
        } catch (e) {
          console.error('Error reading file stats: ' + e.message);
        }
      } else {
        log(`⚠️ ${type} generator did not create file`, 'WARN');
      }
    } else {
      log(`⚠️ Generator script not found: ${scriptPath}`, 'WARN');
    }
  } catch (e) {
    log(`⚠️ ${type} generator failed: ${getErrorMessage(e)}`, 'WARN');
  }

  // Second try: inline fallback extraction
  log(`Running ${type} inline fallback extraction...`);
  return inlineFallback(type, outputFile, dateStr);
}

function inlineFallback(type, outputFile, dateStr) {
  try {
    // Find L2 files (precise: match YYYY-MM-DD.md or YYYY-MM-DD-*.md)
    const escapedDate = dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const l2Pattern = new RegExp(`^${escapedDate}(?:\\.md|-.*\\.md)$`);
    let l2Files;
    try {
      l2Files = fs.readdirSync(MEMORY_DIR)
        .filter(f => l2Pattern.test(f) && !f.includes('l0-') && !f.includes('l1-') && !f.startsWith('.'))
        .map(f => path.join(MEMORY_DIR, f))
        .sort();
    } catch (e) {
      console.error('Error reading directory: ' + e.message);
      return { success: false, error: 'Failed to read memory directory' };
    }

    if (l2Files.length === 0) {
      return { success: false, error: 'No L2 files found' };
    }

    let content = '';
    for (const file of l2Files) {
      try {
        content += fs.readFileSync(file, 'utf8') + '\n';
      } catch (e) {
        console.error('Error reading file: ' + e.message);
        continue;
      }
    }

        ` // Truncate to relevant size, line-aligned
    // Source content
    *Source: ${l2Files.length} L2 files*
    `;

    atomicWriteSync(outputFile, output);
    log(`✅ ${type} inline fallback success (${output.length} bytes)`);
    return { success: true };

  } catch (e) {
    return { success: false, error: getErrorMessage(e) };
  }
}

main();
