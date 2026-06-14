#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const _log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Auto Spawn - Option 2 自動模式
 * 每次回復前調用，自動檢查並 spawn sub-agent
 */

const { checkRouterDecision } = require('./check-router-decision.js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('./lib/config');

// 顏色輸出
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function log(color, msg) {
  _log(`${colors[color]}${msg}${colors.reset}`);
}

/**
 * 檢查是否需要 spawn sub-agent
 * @returns {object|null} - 返回 decision 數據或 null
 */
function checkNeedSpawn() {
  try {
    const decision = checkRouterDecision();

    if (decision && decision.decision === 'spawn') {
      return decision;
    }

    return null;
  } catch (err) {
    // 安全降級：讀取 router decision 失敗時，唔 spawn，繼續正常回覆
    console.error(`⚠️ checkNeedSpawn error: ${err.message}`);
    return null;
  }
}

/**
 * 獲取 session label
 */
function getSessionLabel(decision) {
  try {
    const label = decision.agentLabel || 'task';
    const model = decision.suggestedModel || 'minimax';
    return `${label}-${model}`;
  } catch (e) {
    console.error(`❌ getSessionLabel error: ${e.message}`);
    return 'task-minimax';
  }
}

/**
 * 調用 OpenClaw spawn sub-agent
 */
async function spawnSubAgent(decision) {
  try {
    const sessionLabel = getSessionLabel(decision);
    const model = decision.suggestedModel || 'minimax/MiniMax-M2.5';

    // 注意：OpenClaw spawn 需要通過 API/工具調用，不支持 CLI
    // 當前方案：只通知用戶，不自動 spawn
    // 用戶需要手動確認

    log('cyan', `🎯 檢測到 ${decision.agentLabel} 任務 (${decision.complexity})`);
    log('cyan', `   建議: spawn ${decision.suggestedModel} sub-agent`);
    log('yellow', `   ⚠️ 注意: 自動 spawn 功能需要通過 API 實現`);

    // 記錄需要 spawn 嘅信息
    log('yellow', `   📝 請 Ally 手動 spawn...`);

    // 返回 true 表示已處理（停止回覆流程）
    return true;
  } catch (e) {
    console.error(`❌ spawnSubAgent error: ${e.message}`);
    return false;
  }
}

/**
 * 模擬 spawn（用於測試）
 */
async function simulateSpawn(decision) {
  try {
    const sessionLabel = getSessionLabel(decision);
    const model = decision.suggestedModel || 'minimax/MiniMax-M2.5';

    log('magenta', `🔮 [模擬模式] 將會 spawn sub-agent:`);
    log('magenta', `   Model: ${model}`);
    log('magenta', `   Label: ${sessionLabel}`);
    log('magenta', `   Reason: ${decision.reason}`);
    log('magenta', `   Complexity: ${decision.complexity}`);

    // 模擬延遲
    await new Promise(resolve => setTimeout(resolve, 500));

    log('green', `✅ [模擬] Sub-agent spawn 成功!`);
    return true;
  } catch (e) {
    console.error(`❌ simulateSpawn error: ${e.message}`);
    return false;
  }
}

/**
 * 主函數 - 自動 spawn
 * @param {object} options - 選項
 * @param {boolean} options.dryRun - 是否只模擬，不實際 spawn
 * @param {boolean} options.quiet - 是否靜默模式
 * @returns {boolean} - true = 已 spawn，false = 未 spawn
 */
async function autoSpawn(options = {}) {
  try {
    const { dryRun = false, quiet = false } = options;

    if (!quiet) {
      log('cyan', '🔍 檢查 router decision...');
    }

    const decision = checkNeedSpawn();

    if (!decision) {
      if (!quiet) {
        log('yellow', 'ℹ️  無需 spawn (decision = self 或已處理)');
      }
      return false;
    }

    if (!quiet) {
      log('cyan', `🎯 檢測到 ${decision.agentLabel || 'task'} 任務 (${decision.complexity})`);
      log('cyan', `   準備 spawn ${decision.suggestedModel || 'minimax'} sub-agent...`);
    }

    // 通知用戶（模擬輸出）
    const notifyMsg = `檢測到 ${decision.agentLabel || 'task'} 任務 (${decision.complexity})，準備 spawn ${decision.suggestedModel || 'minimax'} sub-agent...`;

    if (!quiet) {
      _log(`\n📢 通知用戶: ${notifyMsg}\n`);
    }

    // 執行 spawn
    let success;
    if (dryRun) {
      success = await simulateSpawn(decision);
    } else {
      success = await spawnSubAgent(decision);
    }

    return success;
  } catch (err) {
    // 安全降級：autoSpawn 失敗時，唔 spawn，繼續正常回覆
    console.error(`⚠️ autoSpawn error: ${err.message}`);
    return false;
  }
}

/**
 * 快速檢查函數（用於 Ally 每次回復前調用）
 * @returns {boolean} - true = 應該停止回覆流程（已 spawn）
 */
function shouldStopAndSpawn() {
  try {
    const decision = checkRouterDecision();

    if (decision && decision.decision === 'spawn') {
      // 記錄到日誌，但不實際 spawn（由外部處理）
      _log(`🎯 檢測到 ${decision.agentLabel || 'task'} 任務，需要 spawn sub-agent`);
      return decision;
    }

    return null;
  } catch (e) {
    console.error(`❌ shouldStopAndSpawn error: ${e.message}`);
    return null;
  }
}

// CLI 入口
async function main() {
  try {
    const args = process.argv.slice(2);

    // 解析參數
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const quiet = args.includes('--quiet') || args.includes('-q');
    const test = args.includes('--test') || args.includes('-t');

      // 測試模式：創建一個模擬的 spawn decision
    if (test) {
      log('magenta', '🧪 測試模式：創建模擬 spawn decision...');

      // 創建測試用的 decision 文件
      const testDecision = {
        decision: 'spawn',
        complexity: 'high',
        reason: '測試 spawn 功能',
        suggestedModel: 'minimax/MiniMax-M2.5',
        agentLabel: 'coder',
        runtime: null,
        timestamp: Date.now(),
        message: '幫我寫一個複雜嘅 Python 腳本處理數據',
        processed: false
      };

      const decisionFile = path.join(process.env.HOME, '.openclaw/workspace', '.router-decision.json');
      try {
        atomicWriteSync(decisionFile, testDecision);
      } catch (e) {
        console.error('Error writing file atomically: ' + e.message);
        process.exit(1);
      }

      log('green', `✅ 已創建測試 decision 文件`);
    }

    // 執行 auto spawn
    const spawned = await autoSpawn({ dryRun, quiet });

    if (spawned) {
      log('green', '\n✅ 流程完成：已觸發 sub-agent spawn');
      process.exit(0); // 0 = 已 spawn，應該停止回覆流程
    } else {
      log('yellow', '\nℹ️  流程完成：無需 spawn，繼續正常回覆');
      process.exit(1); // 1 = 未 spawn，繼續正常回覆
    }
  } catch (e) {
    console.error(`❌ main error: ${e.message}`);
    process.exit(1);
  }
}

// 如果直接運行此文件
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

// 導出函數供其他模塊使用
module.exports = {
  autoSpawn,
  shouldStopAndSpawn,
  checkNeedSpawn,
  spawnSubAgent,
  simulateSpawn
};
