#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const _log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Apple Notes Backup Verification Script v2
 * 驗證 Apple Notes 備份完整性 (修復版)
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Secure temp file name generator
function getSecureTempFile(prefix) {
  try {
    return path.join(require('os').tmpdir(), `${prefix}-${crypto.randomBytes(8).toString('hex')}.scpt`);
  } catch (e) {
    console.error(`⚠️ Failed to create secure temp file: ${e.message}`);
    return `/tmp/${prefix}-${Date.now()}.scpt`;
  }
}

let MEMORY_DIR;
try {
  MEMORY_DIR = require('./lib/config').MEMORY_DIR;
} catch (e) {
  console.error(`⚠️ Failed to get MEMORY_DIR: ${e.message}`);
  MEMORY_DIR = '/tmp/memory';
}

const { atomicWriteSync } = require('./lib/state');
const STATE_FILE = (() => { try { return path.join(MEMORY_DIR, 'backup-verification-state.json'); } catch (e) { console.error(`⚠️ Failed to create STATE_FILE: ${e.message}`); return '/tmp/backup-verification-state.json'; } })();
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = (() => {
  try {
    return createStateManager(STATE_FILE, { lastVerification: null, verificationHistory: [], failedBackups: [], stats: { totalVerified: 0, totalFailed: 0, lastSuccessRate: 0 } });
  } catch (e) {
    console.error(`⚠️ Failed to create state manager: ${e.message}`);
    return { load: () => ({}), save: () => {} };
  }
})();
const LOG_FILE = (() => { try { return path.join(MEMORY_DIR, 'backup-verification.log'); } catch (e) { console.error(`⚠️ Failed to create LOG_FILE: ${e.message}`); return '/tmp/backup-verification.log'; } })();

const CONFIG = {
  expectedFolders: ["Ally's Notes", "Ally's Chat History", "Ally's Daily", "Ally's Memories"],
  maxRetries: 3,
  retryDelay: 2000,
  contentMinLength: 50,
};


function log(message, quiet = false) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (err) {
    console.error(`⚠️ Failed to write log: ${err.message}`);
  }
  if (!quiet) console.log(message);
}

function getTimestamp() {
  return new Date().toLocaleString('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Search for notes - Simplified version without complex AppleScript records
 */
function searchNotes(titlePattern, folder = "Ally's Notes", quiet = false) {
  const escapedPattern = titlePattern.replace(/"/g, '\\"');
  const escapedFolder = folder.replace(/"/g, '\\"');

  // Simplified AppleScript that returns tab-delimited data
  const script = `tell application "Notes"
    set output to ""
    try
      set targetFolder to folder "${escapedFolder}"
      set noteList to notes of targetFolder
      repeat with aNote in noteList
        set noteTitle to name of aNote
        if noteTitle contains "${escapedPattern}" then
          set noteBody to body of aNote
          set bodyLen to length of noteBody
          set output to output & noteTitle & "\t" & bodyLen & "\n"
        end if
      end repeat
    on error errMsg
      set output to "ERROR:" & errMsg
    end try
    return output
end tell`;

  const tempFile = getSecureTempFile('verify_notes');

  try {
    atomicWriteSync(tempFile, script);
    const output = execFileSync('osascript', [tempFile], {
      encoding: 'utf8', timeout: 30000
    });
    // Clean up temp file immediately
    try { fs.unlinkSync(tempFile); } catch (e) { /* ignore cleanup error */ }

    // Parse tab-delimited output
    const lines = output.trim().split('\n');
    const notes = [];

    for (const line of lines) {
      try {
        if (line.startsWith('ERROR:')) {
          log(`⚠️ AppleScript error: ${line.substring(6)}`, quiet);
          continue;
        }
        const parts = line.split('\t');
        if (parts.length >= 2) {
          notes.push({
            title: parts[0].trim(),
            bodyLength: parseInt(parts[1], 10) || 0
          });
        }
      } catch (e) {
        log(`⚠️ Failed to parse line: ${e.message}`, quiet);
        continue;
      }
    }

    return notes;
  } catch (error) {
    log(`❌ Error searching notes: ${error.message}`, quiet);
    try { fs.unlinkSync(tempFile); } catch { /* ignore cleanup error */ }
    return [];
  }
}

function verifyBackup(title, folder = "Ally's Chat History", quiet = false) {
  log(`🔍 Verifying: "${title}" in "${folder}"`, quiet);

  const notes = searchNotes(title, folder, quiet);

  if (notes.length === 0) {
    return {
      success: false, title, folder,
      error: 'Note not found', verifiedAt: getTimestamp()
    };
  }

  const note = notes[0];

  if (note.bodyLength < CONFIG.contentMinLength) {
    return {
      success: false, title, folder, bodyLength: note.bodyLength,
      error: `Content too short (${note.bodyLength} chars)`,
      verifiedAt: getTimestamp()
    };
  }

  return {
    success: true, title, folder, bodyLength: note.bodyLength,
    verifiedAt: getTimestamp()
  };
}

function verifyRecentBackups(quiet = false) {
  const state = loadState();
  const results = {
    timestamp: getTimestamp(),
    checks: [],
    summary: { total: 0, passed: 0, failed: 0 }
  };

  const today = new Date().toISOString().split('T')[0];

  // Check Session Archives
  const archiveNotes = searchNotes('AI Session Archive', "Ally's Chat History");
  for (const note of archiveNotes) {
    if (note.title.includes(today)) {
      const result = verifyBackup(note.title, "Ally's Chat History", quiet);
      results.checks.push(result);
      results.summary.total++;
      if (result.success) results.summary.passed++;
      else results.summary.failed++;
    }
  }

  // Check MEMORY.md backups
  const memoryNotes = searchNotes('MEMORY.md Backup', "Ally's Memories", quiet);
  for (const note of memoryNotes) {
    if (note.title.includes(today)) {
      const result = verifyBackup(note.title, "Ally's Memories", quiet);
      results.checks.push(result);
      results.summary.total++;
      if (result.success) results.summary.passed++;
      else results.summary.failed++;
    }
  }

  // Check Daily Summaries
  const dailyNotes = searchNotes('AI 每日總結', "Ally's Daily", quiet);
  for (const note of dailyNotes) {
    const result = verifyBackup(note.title, "Ally's Daily", quiet);
    results.checks.push(result);
    results.summary.total++;
    if (result.success) results.summary.passed++;
    else results.summary.failed++;
  }

  // Update state
  state.lastVerification = results;
  state.verificationHistory.push({ timestamp: getTimestamp(), summary: results.summary });
  if (state.verificationHistory.length > 30) {
    state.verificationHistory = state.verificationHistory.slice(-30);
  }

  state.stats.totalVerified += results.summary.passed;
  state.stats.totalFailed += results.summary.failed;
  state.stats.lastSuccessRate = results.summary.total > 0
    ? Math.round((results.summary.passed / results.summary.total) * 100)
    : 0;

  saveState(state);
  return results;
}

function runVerification(options = {}, quiet = false) {
  log('🚀 Starting backup verification...', quiet);

  const results = verifyRecentBackups(quiet);

  log(`\n📊 Results: Total=${results.summary.total}, Passed=${results.summary.passed}, Failed=${results.summary.failed}`, quiet);

  if (results.summary.failed > 0) {
    for (const check of results.checks.filter(c => !c.success)) {
      log(`   ❌ ${check.title}: ${check.error}`, quiet);
    }
  }

  return results;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = { notify: args.includes('--notify') };

  const results = runVerification(options, _quiet);
  log(JSON.stringify(results.summary, null, 2), _quiet);
}

module.exports = { verifyBackup, verifyRecentBackups, runVerification, searchNotes };
