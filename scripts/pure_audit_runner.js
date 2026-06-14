#!/usr/bin/env node
/**
 * Pure AI Audit Runner
 *
 * 這個腳本由 cron job 調用
 * 流程：
 * 1. 運行 pure_ai_audit.js --spawn 生成 payload
 * 2. 解析 SPAWN_READY 輸出
 * 3. Spawn AI sub-agent 執行審計
 * 4. 等待 sub-agent 完成
 *
 * 使用方法:
 *   node scripts/pure_audit_runner.js
 */

const { execSync, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { WS } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');

const PURE_AUDIT_JS = path.join(WS, 'scripts/pure_ai_audit.js');
const SPAWN_PAYLOAD_FILE = path.join(WS, '.state/pure_ai_audit_spawn.json');
const RESULT_FILE = path.join(WS, '.state/pure_ai_audit_results.json');

// ANSI colors
const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};

function log(color, msg) {
  console.log(`${C[color] || ''}${msg}${C.reset}`);
}

/**
 * 運行 pure_ai_audit.js --spawn
 */
function runPureAuditSpawn() {
  log('cyan', '📂 Step 1: 運行 pure_ai_audit.js --spawn...');

  try {
    const output = execFileSync('node', [PURE_AUDIT_JS, '--spawn'], {
      cwd: WS,
      encoding: 'utf8',
      timeout: 60000,
      stdio: 'pipe'
    });

    // 解析 SPAWN_READY 輸出
    const startMarker = 'PURE_AUDIT_SPAWN_READY';
    const endMarker = 'PURE_AUDIT_SPAWN_END';

    const startIdx = output.indexOf(startMarker);
    const endIdx = output.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      const jsonStr = output.substring(startIdx + startMarker.length, endIdx).trim();
      const spawnInfo = JSON.parse(jsonStr);
      log('green', `   ✅ Payload 生成成功: ${spawnInfo.filesCount} 個檔案`);
      return spawnInfo;
    } else {
      log('yellow', '   ⚠️  未找到 SPAWN_READY 標記（可能冇需要 spawn）');
      return null;
    }
  } catch (e) {
    log('red', `   ❌ pure_ai_audit.js 失敗: ${e.message}`);
    return null;
  }
}

/**
 * Spawn AI sub-agent（使用 OpenClaw CLI）
 *
 * 注意：OpenClaw CLI 沒有直接 spawn 命令
 * 但我們可以通過 gateway API 進行 spawn
 *
 * @deprecated 此函數已被棄用，請使用新的 spawn 機製
 */
function spawnAuditSubAgent(spawnInfo) {
  log('cyan', '🤖 Step 2: Spawn AI Sub-Agent...');

  // 讀取 spawn payload
  let spawnPayload;
  try {
    spawnPayload = JSON.parse(fs.readFileSync(SPAWN_PAYLOAD_FILE, 'utf8'));
  } catch (err) {
    log('red', `❌ Failed to parse spawn payload: ${err.message}`);
    return false;
  }

  log('green', `   Model: ${spawnPayload.model}`);
  log('green', `   Label: ${spawnPayload.label}`);
  log('green', `   Files: ${spawnInfo.filesCount}`);

  // 構建 spawn 命令
  // 由於 OpenClaw CLI 沒有直接 spawn，我們使用 gateway API
  // 通過 openclaw agent 命令
  const agentMessage = spawnPayload.prompt;

  // 使用 openclaw agents spawn 或者直接寫入 spawn request
  // 這裡我們採用替代方案：寫入 spawn request 到檔案
  // 然後依賴 main agent 的定時檢查來處理

  // 實際與，更好的方案是使用 sessions_yield
  // 但這需要在 OpenClaw agent context 中運行

  // 對於 cron job，我們採用寫入 marker 的方式
  // main agent 會在下次運行時檢测併處理
  log('yellow', '   ⚠️  直接 spawn 需要 OpenClaw agent context');
  log('yellow', '   📝  Spawn request 已寫入，main agent 會處理');

  // 更新 pending marker 狀態
  const pendingFile = path.join(WS, '.state/pending_spawns/pure_audit.json');
  let pending = {};
  try {
    pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  } catch (err) {
    log('yellow', `⚠️ Pending file not found or invalid, creating new: ${err.message}`);
  }
  pending.status = 'spawn-requested';
  pending.requestedAt = getHKTDateTime();
  pending.agentMessage = agentMessage;
  try {
    fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2), 'utf8');
  } catch (err) {
    log('red', `❌ Failed to write spawn request: ${err.message}`);
    return false;
  }

  return true;
}

/**
 * 主函數
 */
function main() {
  log('bold', '\n🎯 Pure AI Audit Runner\n');
  log('cyan', '═'.repeat(50) + '\n');

  // Step 1: 運行 pure_ai_audit.js --spawn
  const spawnInfo = runPureAuditSpawn();

  if (!spawnInfo) {
    log('yellow', '⚠️  冇需要 spawn，結束');
    process.exit(0);
  }

  // Step 2: Spawn sub-agent (deprecated)
  log('');
  spawnAuditSubAgent(spawnInfo);

  log('');
  log('cyan', '═'.repeat(50));
  log('green', '✅ Pure Audit Runner 完成');
  log('cyan', '═'.repeat(50) + '\n');
  log('dim', '📝 Spawn request 已記錄，等待 main agent spawn...\n');
}

// 執行
main();
