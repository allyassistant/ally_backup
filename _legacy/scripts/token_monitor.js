#!/usr/bin/env node
/**
 * Token Monitor Helper
 * Checks session status and determines if we need to spawn sub-agent or start fresh
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../memory/heartbeat-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastCheck: null, history: [], alerts: { lastAlert: null, alertThreshold: 70 } };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function shouldSpawnSubAgent(task) {
  // Task complexity indicators
  const heavyIndicators = [
    /process.*\d{3,}.*diamond/i,
    /stock.*list.*multiple/i,
    /pdf.*extract/i,
    /batch.*excel/i,
    /merge.*file/i,
    /\d{3,}.*records/i,
    /large.*data/i
  ];
  
  return heavyIndicators.some(pattern => pattern.test(task));
}

function checkTokenStatus(tokensIn, tokensOut, contextUsed, contextLimit) {
  const percentage = Math.round((contextUsed / contextLimit) * 100);
  
  let status = 'normal';
  let action = null;
  
  if (percentage < 50) {
    status = 'normal';
    action = 'continue';
  } else if (percentage < 70) {
    status = 'warning';
    action = 'monitor';
  } else {
    status = 'critical';
    action = 'suggest_reset';
  }
  
  return { percentage, status, action };
}

// Export for use in other scripts
module.exports = {
  shouldSpawnSubAgent,
  checkTokenStatus,
  loadState,
  saveState
};

// CLI usage
if (require.main === module) {
  const state = loadState();
  console.log('Token Monitor Status:', state.lastCheck || 'No data yet');
  console.log('Threshold:', state.alerts?.alertThreshold || 70, '%');
}
