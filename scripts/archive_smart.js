#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// HKT Time Helper
/**
 * Smart Archive with Timestamp Check
 * 可用於 Heartbeat，只會在需要時執行
 */

const fs = require('fs');
const path = require('path');

const { MEMORY_DIR } = require('./lib/config');
const DAILY_DIR = path.join(MEMORY_DIR, '_daily');
const ARCHIVE_DIR = path.join(MEMORY_DIR, '_archive');
const STATE_FILE = path.join(MEMORY_DIR, 'archive-state.json');
const { getHKTDate } = require('./lib/time');

function getFileDate(filename) {
  try {
    const match = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(`${match[1]}-${match[2]}-${match[3]}`);
  } catch (e) {
    console.error(`❌ getFileDate error: ${e.message}`);
    return null;
  }
}

function daysDiff(date1, date2) {
  try {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((date2 - date1) / msPerDay);
  } catch (e) {
    console.error(`❌ daysDiff error: ${e.message}`);
    return 0;
  }
}

function shouldRun() {
  try {
    if (!fs.existsSync(STATE_FILE)) return true;
    
    let state;
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.error('⚠️ Failed to parse state file:', e.message);
      state = { lastArchive: null };
    }
    if (!state || !state.lastRun) {
      return true;
    }
    const lastRun = new Date(state.lastRun);
    const now = new Date();
    
    // 每天只運行一次
    return lastRun.getDate() !== now.getDate() || 
           lastRun.getMonth() !== now.getMonth() ||
           lastRun.getFullYear() !== now.getFullYear();
  } catch (e) {
    console.error(`❌ shouldRun error: ${e.message}`);
    return true; // 降級：如果檢查失敗，預設應該運行
  }
}

// 執行
if (require.main === module) {
  // archiveOldFiles removed - unused function
}

module.exports = { shouldRun };
