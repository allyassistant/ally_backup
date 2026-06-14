#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Apple Reminders & Calendar Integration
 * Check Reminders and Calendar on every heartbeat
 *
 * Run: node scripts/apple_reminders_calendar.js
 * Trigger: Heartbeat (every 30 min)
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
let MEMORY_DIR;
try {
  MEMORY_DIR = require('./lib/config').MEMORY_DIR;
} catch (e) {
  console.error(`⚠️ Failed to get MEMORY_DIR: ${e.message}`);
  MEMORY_DIR = '/tmp';
}

// Secure temp file name generator
function getSecureTempFile(prefix) {
  try {
    return path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(8).toString('hex')}.scpt`);
  } catch (e) {
    console.error(`⚠️ Failed to create secure temp file: ${e.message}`);
    return `/tmp/${prefix}-${Date.now()}.scpt`;
  }
}

const STATE_FILE = (() => { try { return path.join(MEMORY_DIR, 'apple-integration-state.json'); } catch (e) { console.error(`⚠️ Failed to create STATE_FILE: ${e.message}`); return '/tmp/apple-integration-state.json'; } })();
const { atomicWriteSync, createStateManager } = require('./lib/state');
const { getHKTDateTime } = require('./lib/time');

// Ensure memory directory exists
try {
    if (!fs.existsSync(MEMORY_DIR)) {
        try {
            fs.mkdirSync(MEMORY_DIR, { recursive: true });
        } catch (mkdirErr) {
            console.error('⚠️ mkdir failed: ' + mkdirErr.message);
            return;
        }
    }
} catch (err) {
    console.error(`⚠️ Failed to check memory directory: ${err.message}`);
}

// ==================== PART 1: REMINDERS ====================

function checkReminders() {
    log('📋 Checking Apple Reminders...');

    let result;
    try {
        // Use remindctl CLI (already installed)
        result = execSync('remindctl today', { encoding: 'utf8', timeout: 5000 }).trim();
    } catch (e) {
        console.error('⚠️ Command failed: ' + e.message);
        return { count: 0, reminders: [], timestamp: getHKTDateTime() };
    }

    if (result && !result.includes('No reminders')) {
        const lines = result.split('\n').filter(l => l.trim());
        log(`📋 Found ${lines.length} reminders today`);
        return {
            count: lines.length,
            reminders: lines.slice(0, 10),
            timestamp: getHKTDateTime()
        };
    }

    log('📋 No reminders today');
    return { count: 0, reminders: [], timestamp: getHKTDateTime() };
}

// ==================== PART 2: CALENDAR ====================

function checkCalendar() {
    log('📅 Checking Apple Calendar...');

    try {
        // Use AppleScript for calendar
        const script = `
tell application "Calendar"
    set todayDate to current date
    set time of todayDate to 0
    set tomorrowDate to todayDate + 1 * days

    set eventCount to 0
    set eventNames to ""

    repeat with cal in calendars
        try
            set today's events to events of cal whose start date >= todayDate and start date < tomorrowDate
            repeat with e in today's events
                set eventCount to eventCount + 1
                set eventNames to eventNames & summary of e & "
            end repeat
        on error
            -- skip calendar if error
        end try
    end repeat

    return eventCount & "|" & eventNames
end tell
`;

        // Write to temp file with secure random name
        const scriptPath = getSecureTempFile('check_calendar');
        try {
            fs.writeFileSync(scriptPath, script);
        } catch (err) {
            console.error('⚠️ File write failed: ' + err.message);
            return;
        }

        let result;
        try {
          result = execFileSync('osascript', [scriptPath], { encoding: 'utf8', timeout: 10000 }).trim();
          // Clean up temp file
          try { fs.unlinkSync(scriptPath); } catch { /* ignore cleanup error */ }
        } catch (e) {
          // Clean up temp file on error
          try { fs.unlinkSync(scriptPath); } catch { /* ignore cleanup error */ }
          log('📅 No calendar access or no events');
          return { count: 0, events: [], timestamp: getHKTDateTime() };
        }

        if (result) {
            const parts = result.split('|');
            const count = parseInt(parts[0]) || 0;
            const events = parts.slice(1).filter(e => e.trim());

            log(`📅 Found ${count} events today`);
            return {
                count: count,
                events: events.slice(0, 10),
                timestamp: getHKTDateTime()
            };
        }

        log('📅 No events today');
        return { count: 0, events: [], timestamp: getHKTDateTime() };

    } catch (e) {
        log('📅 No calendar access or no events');
        return { count: 0, events: [], timestamp: getHKTDateTime() };
    }
}

// ==================== PART 3: MAIN ====================

// Shared state manager (eliminates duplicate loadState/saveState definitions)
const stateManager = createStateManager(STATE_FILE, { lastRun: null });

function shouldRun() {
    // Run once per day
    try {
        const state = stateManager.load();
        if (!state || !state.lastRun) return true;

        const lastRun = new Date(state.lastRun);
        const now = new Date();
        const hoursDiff = (now - lastRun) / (1000 * 60 * 60);
        return hoursDiff >= 24;
    } catch (e) {
        console.error(`⚠️ shouldRun check failed: ${e.message}`);
        return true;  // Run if we can't check state
    }
}

function saveState(data) {
    try {
        stateManager.save({
            lastRun: getHKTDateTime(),
            reminders: data.reminders,
            calendar: data.calendar
        });
    } catch (err) {
        console.error(`⚠️ Failed to save state: ${err.message}`);
    }
}

function main() {
    log('🍎 Apple Reminders & Calendar Integration');
    log('==========================================');

    // Check if should run
    if (!shouldRun()) {
        log('⏸️ Skipped (ran recently)');
        return;
    }

    // Check reminders
    const reminders = checkReminders();

    // Check calendar
    const calendar = checkCalendar();

    // Save state
    saveState({ reminders, calendar });

    // Summary
    log('==========================================');
    log('📊 Summary:');
    log(`   Reminders: ${reminders.count || 0} active`);
    log(`   Calendar: ${calendar.count || 0} events today`);
    log('==========================================');

    // Show details
    if (reminders.count > 0 && reminders.reminders) {
        log('\n📋 Active Reminders:');
        reminders.reminders.forEach((r, i) => {
            log(`   ${i+1}. ${r}`);
        });
    }

    if (calendar.count > 0 && calendar.events) {
        log('\n📅 Today\'s Events:');
        calendar.events.forEach((e, i) => {
            log(`   ${i+1}. ${e}`);
        });
    }
}

// Run
main();
