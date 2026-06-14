// scripts/lib/state.js
// 共用 state management + atomic write
// Created: 2026-03-30

const fs = require('fs');
const path = require('path');

function atomicWriteSync(filePath, data) {
  const tmpFile = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpFile, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) { /* ignore cleanup errors */ }
    throw err;
  }
}

function createStateManager(stateFile, defaultState) {
  const getDefault = () => {
    if (defaultState === undefined) return {};
    if (typeof defaultState === 'function') return defaultState();
    return JSON.parse(JSON.stringify(defaultState));
  };
  return {
    load: () => {
      try {
        try {
          return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch (e) {
          console.error(`⚠️ Failed to parse state file ${stateFile}:`, e.message);
          return getDefault();
        }
      } catch { return getDefault(); }
    },
    save: (state) => {
      atomicWriteSync(stateFile, state);
    }
  };
}

module.exports = { atomicWriteSync, createStateManager };
