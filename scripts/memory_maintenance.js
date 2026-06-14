#!/usr/bin/env node
// HKT Time Helper
/**
 * MEMORY.md Auto-Maintenance Script
 * Checks MEMORY.md size, backs up if needed, then cleans up
 */

const { createNote } = require("./apple_notes");
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getHKTDate } = require('./lib/time');
const { createStateManager, atomicWriteSync } = require('./lib/state');

const { WS, MEMORY_DIR } = require('./lib/config');
const MEMORY_PATH = (() => { try { return path.join(WS, 'MEMORY.md'); } catch (e) { console.error(`⚠️ Failed to create MEMORY_PATH: ${e.message}`); return ''; } })();
const STATE_FILE = (() => { try { return path.join(MEMORY_DIR, 'memory-maintenance-state.json'); } catch (e) { console.error(`⚠️ Failed to create STATE_FILE: ${e.message}`); return ''; } })();
const { load: loadState, save: saveState } = (() => {
  try {
    return createStateManager(STATE_FILE);
  } catch (e) {
    console.error(`⚠️ Failed to create state manager: ${e.message}`);
    return { load: () => ({}), save: () => {} };
  }
})();
// UPDATED 2026-02-19: Focus on duplicate detection for cleanup
// L0/L1/L2 handles context, MEMORY.md auto-cleans duplicates
const LINE_THRESHOLD = Infinity;  // Skip line-based cleanup
const WARNING_THRESHOLD = Infinity;

// Character limit - Infinity (size doesn't trigger cleanup, only duplicates)
const CHAR_LIMIT = Infinity;

// DUPLICATE DETECTION MODE - always run duplicate cleanup regardless of size
const ALWAYS_CLEAN_DUPLICATES = true;

// NEW 2026-02-19: Prevent duplicate backups
const MAX_BACKUPS_PER_DAY = 1;

// Check if we already have a backup today
function hasBackupToday() {
  try {
    const { date } = getCurrentDateTime();
    const script = `osascript -e 'tell application "Notes" to name of notes in folder "Ally'"'"'s Memories"'`;
    let output;
    try {
      output = execSync(script, { encoding: 'utf8' });
    } catch (e) {
      console.error('Error: ' + e.message);
      return false;
    }
    const notes = output.split(', ').map(n => n.trim());
    return notes.some(n => n.includes(date));
  } catch (e) {
    console.error('Error: ' + e.message);
    return false;
  }
}

// Compare with latest backup content
function isContentSameAsLatest(content) {
  try {
    const script2 = `osascript -e 'tell application "Notes" to body of first note of folder "Ally'"'"'s Memories"'`;
    let latestContent;
    try {
      latestContent = execSync(script2, { encoding: 'utf8' }).trim();
    } catch (e) {
      console.error('Error: ' + e.message);
      return false;
    }
    // Normalize and compare
    const normalizedNew = content.replace(/\s+/g, ' ').trim();
    const normalizedLatest = latestContent.replace(/^.*ORIGINAL CONTENT.*\n/, '').replace(/\s+/g, ' ').trim();
    return normalizedNew === normalizedLatest;
  } catch (e) {
    console.error('Error: ' + e.message);
    return false; // No previous backup
  }
}
function getCurrentDateTime() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
  return { date, time, full: `${date} ${time}` };
}

function backupToAppleNotes(content, lineCount, triggerMsg, quiet = false) {
  // NEW 2026-02-19: Check before backup
  // Check 1: Already have backup today?
  if (hasBackupToday()) {
    if (!quiet) console.log('⚠️ Backup already exists today - skipping (daily limit reached)');
    return 'skipped_exists';
  }

  // Check 2: Content same as latest backup?
  if (isContentSameAsLatest(content)) {
    if (!quiet) console.log('⚠️ Content unchanged from latest backup - skipping');
    return 'skipped_unchanged';
  }

  const { date, time } = getCurrentDateTime();
  const noteTitle = `MEMORY.md Backup - ${date} ${time}`;

  // Plain text format with newlines (easier to read/restore)
  const summary = `═══════════════════════════════════════
📦 MEMORY.md Backup
═══════════════════════════════════════

📅 Backup Time: ${date} ${time}
📝 Original Lines: ${lineCount}
⚠️ Trigger: ${triggerMsg || 'Size or Duplicate detection'}

═══════════════════════════════════════
📝 ORIGINAL CONTENT (Pre-Cleanup)
═══════════════════════════════════════

`;

  // Keep content as-is (plain text with newlines)
  const fullContent = summary + content;

  const success = createNote(noteTitle, fullContent, "Ally's Memories");

  if (success) {
    if (!quiet) console.log(`✅ Backed up MEMORY.md to Apple Notes: ${noteTitle}`);
    return 'saved';
  } else {
    console.error('❌ Failed to backup to Apple Notes');
    return false;
  }
}

function cleanupMemoryMd(content) {
  const lines = content.split('\n');
  const originalCount = lines.length;

  const cleanedLines = [];
  let removedCount = 0;
  let mergedCount = 0;

  // Track sections to identify duplicates
  const seenSections = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines at the start (but keep between sections)
    if (cleanedLines.length === 0 && trimmed === '') {
      removedCount++;
      continue;
    }

    // Skip completed TODO items (marked with ✅ or [x] or "已完成")
    if (trimmed.match(/^-?\s*[✅☑✓✔✗✘]/) ||
        trimmed.match(/\[x\]/i) ||
        trimmed.includes('已完成') ||
        trimmed.includes('（已完成）') ||
        trimmed.includes('(已完成)')) {
      removedCount++;
      continue;
    }

    // Skip old date-specific entries (older than 60 days)
    const dateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const accessDate = new Date(dateMatch[1]);
      // 檢查是否為無效日期
      if (isNaN(accessDate.getTime())) {
        console.error(`⚠️ Invalid date detected: ${dateMatch[1]}`);
      } else {
        const daysDiff = (new Date() - accessDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 60 && (trimmed.includes('已') || trimmed.includes('完成'))) {
          removedCount++;
          continue;
        }
      }
    }

    // Detect and skip duplicate headers
    if (trimmed.startsWith('#') || trimmed.startsWith('##')) {
      const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenSections.has(normalized)) {
        // Skip this header and its content until next header or empty line
        mergedCount++;
        i++;
        const maxIterations = 10000; // Safety limit to prevent infinite loops
        let iterations = 0;
        while (i < lines.length && !lines[i].trim().startsWith('#') && lines[i].trim() !== '' && iterations < maxIterations) {
          i++;
          removedCount++;
          iterations++;
        }
        if (i > 0) i--; // Adjust for the for loop increment, with safety check
        continue;
      }
      seenSections.add(normalized);
    }

    // NEW 2026-02-20: Detect duplicate "Last Updated" sections
    // These are sections with same timestamp that were duplicated
    if (trimmed.match(/^\*Last Updated: \d{4}-\d{2}-\d{2}/)) {
      const timestamp = trimmed.match(/(\d{4}-\d{2}-\d{2})/)[1];
      // Check if we've seen this exact timestamp section before
      const timestampKey = `lastUpdated_${timestamp}`;
      if (seenSections.has(timestampKey)) {
        // This is a duplicate! Skip until next header
        mergedCount++;
        i++;
        const maxIterations = 10000; // Safety limit to prevent infinite loops
        let iterations = 0;
        while (i < lines.length && !lines[i].trim().startsWith('#') && iterations < maxIterations) {
          i++;
          removedCount++;
          iterations++;
        }
        if (i > 0) i--; // Adjust for the for loop increment, with safety check
        continue;
      }
      seenSections.add(timestampKey);
    }

    // Skip consecutive empty lines (keep only one)
    if (trimmed === '' && cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() === '') {
      removedCount++;
      continue;
    }

    // Skip old "Updated on" metadata lines (older than 30 days)
    if (trimmed.match(/^[Uu]pdated on \d{4}-\d{2}-\d{2}$/)) {
      const updateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2})/);
      if (updateMatch) {
        const updateDate = new Date(updateMatch[1]);
        // 檢查是否為無效日期
        if (isNaN(updateDate.getTime())) {
          console.error(`⚠️ Invalid update date detected: ${updateMatch[1]}`);
        } else {
          const daysDiff = (new Date() - updateDate) / (1000 * 60 * 60 * 24);
          if (daysDiff > 30) {
            removedCount++;
            continue;
          }
        }
      }
    }

    cleanedLines.push(line);
  }

  // Remove trailing empty lines
  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() === '') {
    cleanedLines.pop();
    removedCount++;
  }

  const newContent = cleanedLines.join('\n');
  const newCount = cleanedLines.length;

  return {
    content: newContent,
    originalCount,
    newCount,
    removedCount,
    mergedCount
  };
}

function sendDiscordNotification(originalCount, newCount, removedCount, mergedCount, backupResult, quiet = false) {
  const { date, time } = getCurrentDateTime();

  // Backup status lookup table
  let backupStatus = '';
  if (backupResult === 'saved') {
    backupStatus = '💾 Backup saved to: Ally\'s Memories';
  } else if (backupResult === 'skipped_exists') {
    backupStatus = '⏭️ Backup skipped (already exists today)';
  } else if (backupResult === 'skipped_unchanged') {
    backupStatus = '⏭️ Backup skipped (content unchanged)';
  } else if (backupResult === false) {
    backupStatus = '❌ Backup failed';
  } else {
    backupStatus = `❓ Backup unknown status: ${backupResult}`;
  }

  const discordMessage = `🧹 MEMORY.md Auto-Cleanup\n\n` +
    `📊 Stats:\n` +
    `• Original: ${originalCount} lines\n` +
    `• After cleanup: ${newCount} lines\n` +
    `• Removed: ${removedCount} lines\n` +
    `• Merged: ${mergedCount} sections\n\n` +
    `${backupStatus}\n` +
    `📝 ${date} ${time}`;

  // Console log (respects quiet mode)
  if (!quiet) console.log(discordMessage);

  // Note: Discord notification via message.js removed (dangling reference)
}

function memoryMaintenance(quiet = false) {
  const log = (...args) => { if (!quiet) console.log(...args); };

  try {
    if (!fs.existsSync(MEMORY_PATH)) {
      log('⏸️  MEMORY.md not found');
      return;
    }
  } catch (e) {
    log('⚠️ Error checking MEMORY.md:', e.message);
    return;
  }

  // Check if today is Sunday (for cleanup)
  const today = new Date().getDay();
  const isSunday = today === 0;

  // Read MEMORY.md content with try-catch
  let content;
  try {
    content = fs.readFileSync(MEMORY_PATH, 'utf8');
  } catch (err) {
    log(`❌ Failed to read MEMORY.md: ${err.message}`);
    return;
  }

  const charCount = content.length;
  const lines = content.split('\n');
  const lineCount = lines.length;

  log(`📊 MEMORY.md: ${charCount} chars, ${lineCount} lines`);

  // Cleanup only runs on Sunday
  const needsSizeCleanup = isSunday && (lineCount >= LINE_THRESHOLD || charCount >= CHAR_LIMIT);
  const needsDuplicateCleanup = isSunday && ALWAYS_CLEAN_DUPLICATES;

  // Always try backup (but check daily limit first)
  const state = loadState();

  // If no cleanup needed and it's not Sunday, just do backup
  if (!needsSizeCleanup && !needsDuplicateCleanup) {
    if (!isSunday) {
      log('📅 Not Sunday - running backup only (cleanup skipped)');
    } else {
      log('✅ MEMORY.md size is healthy');
      state.lastCheck = new Date().toISOString();
      saveState(state);
    }
    // Continue to backup (don't return)
  }

  // Determine if we need to run cleanup (only on Sunday)
  let triggerMsg = '';
  if (needsSizeCleanup && needsDuplicateCleanup) {
    triggerMsg = 'Size limit + Duplicate detection';
  } else if (needsSizeCleanup) {
    triggerMsg = `Exceeds ${LINE_THRESHOLD} lines or ${CHAR_LIMIT} chars`;
  } else if (needsDuplicateCleanup) {
    triggerMsg = 'Duplicate detection (Sunday cleanup)';
  }

  // Step 1: Backup to Apple Notes (always try, even on non-Sunday)
  log(`📦 Running backup...`);
  const backupSuccess = backupToAppleNotes(content, lineCount, triggerMsg || 'No cleanup needed', quiet);
  if (!backupSuccess) {
    console.error('❌ Backup failed, aborting');
    return;
  }

  // Only run cleanup on Sunday
  if (!isSunday) {
    log('✅ Done (backup only - cleanup runs on Sunday)');
    return;
  }

  // Step 2: Clean up MEMORY.md (only on Sunday)
  log(`⚠️  Starting cleanup: ${triggerMsg}...`);
  const result = cleanupMemoryMd(content);

  // Step 3: Write cleaned content
  try {
    atomicWriteSync(MEMORY_PATH, result.content);
  } catch (err) {
    console.error(`❌ Failed to write cleaned MEMORY.md: ${err.message}`);
    return;
  }

  // Step 4: Update state
  state.lastCheck = new Date().toISOString();
  state.lastCleanup = new Date().toISOString();
  state.backupCount = (state.backupCount || 0) + 1;
  saveState(state);

  // Step 5: Send notification
  sendDiscordNotification(
    result.originalCount,
    result.newCount,
    result.removedCount,
    result.mergedCount,
    backupSuccess,
    quiet
  );

  log(`✅ Cleanup complete: ${result.originalCount} → ${result.newCount} lines`);

  // NEW 2026-02-19: Weekly session cleanup
  if (isSunday) {
    log('🧹 Running weekly session cleanup...');
    try {
      const cmd = 'node ' + path.join(__dirname, 'weekly_session_cleanup.js');
      try {
        execSync(cmd, { encoding: 'utf8' });
      } catch (e) {
        log('⚠️ Session cleanup failed:', e.message);
      }
    } catch (e) {
      log('⚠️ Session cleanup error:', e.message);
    }
  }

  // NEW 2026-02-20: Weekly Correction Loop
  if (isSunday) {
    log('🔄 Running weekly correction loop...');
    try {
      const cmd = 'node ' + path.join(__dirname, 'weekly_correction_loop.js');
      try {
        execSync(cmd, { encoding: 'utf8' });
      } catch (e) {
        log('⚠️ Correction loop failed:', e.message);
      }
    } catch (e) {
      log('⚠️ Correction loop error:', e.message);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const _quiet = process.argv.includes('--quiet');
  memoryMaintenance(_quiet);
}

module.exports = { memoryMaintenance, cleanupMemoryMd };
