#!/usr/bin/env node
/**
 * Stock List Watcher
 * Monitor ~/Desktop/Stock list/ for changes and auto-merge to diamond_stock.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STOCK_DIR = '/Users/ally/Desktop/Stock list';
const STATE_FILE = '/Users/ally/.openclaw/workspace/memory/stock-watcher-state.json';
const MERGE_SCRIPT = '/Users/ally/.openclaw/workspace/scripts/merge_stock.js';
const { createStateManager } = require('../lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE);

// Get file hash for comparison
function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

// Get current state of directory
function getDirectoryState() {
  const state = {};
  try {
    const files = fs.readdirSync(STOCK_DIR)
      .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'))
      .map(f => path.join(STOCK_DIR, f));
    
    for (const file of files) {
      const stats = fs.statSync(file);
      state[path.basename(file)] = {
        mtime: stats.mtime.getTime(),
        size: stats.size,
        hash: getFileHash(file)
      };
    }
  } catch (err) {
    console.error('❌ Error reading stock directory:', err.message);
  }
  return state;
}

// Load previous state
// Save current state
// Check for changes
function detectChanges(current, previous) {
  const changes = {
    added: [],
    modified: [],
    deleted: []
  };
  
  // Check for new or modified files
  for (const [filename, info] of Object.entries(current)) {
    if (!previous[filename]) {
      changes.added.push(filename);
    } else if (previous[filename].hash !== info.hash) {
      changes.modified.push(filename);
    }
  }
  
  // Check for deleted files
  for (const filename of Object.keys(previous)) {
    if (!current[filename]) {
      changes.deleted.push(filename);
    }
  }
  
  return changes;
}

// Run merge script
function runMerge() {
  console.log('🔄 Running stock merge...');
  try {
    require('child_process').execSync(`node ${MERGE_SCRIPT}`, { 
      stdio: 'inherit',
      cwd: '/Users/ally/.openclaw/workspace'
    });
    return true;
  } catch (err) {
    console.error('❌ Merge failed:', err.message);
    return false;
  }
}

// Create notification for WhatsApp
function createNotification(changes) {
  const messages = [];
  if (changes.added.length) messages.push(`新增: ${changes.added.join(', ')}`);
  if (changes.modified.length) messages.push(`修改: ${changes.modified.join(', ')}`);
  if (changes.deleted.length) messages.push(`刪除: ${changes.deleted.join(', ')}`);
  
  return `📊 Stock List 更新檢測\n\n${messages.join('\n')}\n\n已自動合併至 database。`;
}

// Main watcher function
async function watchStockList() {
  console.log('🔍 Checking stock list directory...');
  
  // Check if directory exists
  if (!fs.existsSync(STOCK_DIR)) {
    console.log(`⏸️  Stock directory not found: ${STOCK_DIR}`);
    return { changed: false };
  }
  
  // Load previous state
  const state = loadState();
  
  // Get current state
  const current = getDirectoryState();
  
  // Detect changes
  const changes = detectChanges(current, state.files);
  
  const hasChanges = changes.added.length > 0 || 
                     changes.modified.length > 0 || 
                     changes.deleted.length > 0;
  
  if (hasChanges) {
    console.log('📁 Changes detected:', changes);
    
    // Run merge
    const success = runMerge();
    
    if (success) {
      // Update state
      saveState({
        files: current,
        lastCheck: new Date().toISOString(),
        lastMerge: new Date().toISOString()
      });
      
      // Return notification
      return {
        changed: true,
        notification: createNotification(changes),
        changes
      };
    }
  } else {
    console.log('✅ No changes detected');
    
    // Update check time only
    saveState({
      files: current,
      lastCheck: new Date().toISOString(),
      lastMerge: state.lastMerge
    });
  }
  
  return { changed: false };
}

// Run if called directly
if (require.main === module) {
  watchStockList().then(result => {
    if (result.changed) {
      console.log('\n' + result.notification);
    }
    // Update cron job state
    try {
      const { updateCronJobState } = require('./cron_health_check');
      updateCronJobState('heartbeat', result.changed ? 'warning' : 'success', {
        changed: result.changed,
        changes: result.changes
      });
    } catch (e) {}
    process.exit(0);
  }).catch(err => {
    console.error('❌ Watch stock failed:', err.message);
    // Update cron job state for failure
    try {
      const { updateCronJobState } = require('./cron_health_check');
      updateCronJobState('heartbeat', 'failed', { error: err.message });
    } catch (e) {}
    process.exit(1);
  });
}

module.exports = { watchStockList, detectChanges };
