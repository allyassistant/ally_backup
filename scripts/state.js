#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// ==================== HKT TIME HELPER ====================
/**
 * Session State Manager
 * 簡單 interface 更新 session-state.json
 */

const fs = require('fs');
const path = require('path');

const { MEMORY_DIR } = require('./lib/config');
const STATE_FILE = path.join(MEMORY_DIR, 'session-state.json');
const { getHKTDate } = require('./lib/time');
// CLI 命令
const [,, command, ...args] = process.argv;

switch (command) {
  case 'task': {
    // 新增待辦: node state.js task "更新 Rapaport" high 2026-02-05
    const state = loadState();
    state.reminders.push({
      text: args[0],
      priority: args[1] || 'normal',
      dueDate: args[2] || getHKTDate(),
      completed: false,
      createdAt: new Date().toISOString()
    });
    saveState(state);
    log(`✅ Added task: ${args[0]}`);
    break;
  }

  case 'complete': {
    // 完成待辦: node state.js complete "更新 Rapaport"
    const state = loadState();
    const task = state.reminders.find(r => r.text === args[0]);
    if (task) {
      task.completed = true;
      task.completedAt = new Date().toISOString();
      saveState(state);
      log(`✅ Completed: ${args[0]}`);
    }
    break;
  }

  case 'progress': {
    // 設置進行中: node state.js progress stockListProcessing true
    const state = loadState();
    state.inProgress[args[0]] = args[1] === 'true';
    saveState(state);
    log(`✅ Set ${args[0]}: ${args[1]}`);
    break;
  }

  case 'archive': {
    // 記錄備份時間
    const state = loadState();
    state.streamingArchive.lastArchive = new Date().toISOString();
    state.streamingArchive.messageCount = parseInt(args[0]) || 0;
    saveState(state);
    log('✅ Archive logged');
    break;
  }

  case 'list':
  case 'show': {
    const state = loadState();
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE);
    log(JSON.stringify(state, null, 2));
    break;
  }

  default:
    log(`
Session State Manager

Usage:
  node state.js task "描述" [priority] [dueDate]  - 新增待辦
  node state.js complete "描述"                     - 完成待辦
  node state.js progress [key] [true/false]         - 設置進行中狀態
  node state.js archive [messageCount]              - 記錄備份
  node state.js list                                - 顯示全部狀態（同 show）
  node state.js show                                - 顯示全部狀態

Examples:
  node state.js task "更新 Rapaport" high 2026-02-05
  node state.js progress stockListProcessing true
  node state.js complete "更新 Rapaport"
    `);
}
