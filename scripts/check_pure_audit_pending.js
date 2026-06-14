#!/usr/bin/env node
/**
 * Pure Audit Spawn Checker
 *
 * 檢查是否有待處理的 pure_audit spawn
 * 由 main agent 在啟動時或定期調用
 *
 * 使用方法:
 *   node scripts/check_pure_audit_pending.js        # 檢查並返回狀態
 *   node scripts/check_pure_audit_pending.js --spawn  # 檢查並觸發 spawn
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

const WORKSPACE = path.join(__dirname, '..');
const PENDING_FILE = path.join(WORKSPACE, '.state/pending_spawns/pure_audit.json');
const SPAWN_PAYLOAD_FILE = path.join(WORKSPACE, '.state/pure_ai_audit_spawn.json');
const RESULT_FILE = path.join(WORKSPACE, '.state/pure_ai_audit_results.json');

/**
 * 讀取 pending spawn 狀態
 */
function getPendingStatus() {
  try {
    if (!fs.existsSync(PENDING_FILE)) {
      return { hasPending: false };
    }

    let pending;
    try {
      pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    } catch (e) {
      console.error('⚠️ Failed to parse pending file:', e.message);
      pending = { count: 0 };
    }
    const spawnPayload = fs.existsSync(SPAWN_PAYLOAD_FILE)
      ? (() => { try { return JSON.parse(fs.readFileSync(SPAWN_PAYLOAD_FILE, 'utf8')); } catch (e) { return null; } })()
      : null;

    return {
      hasPending: pending.status === 'pending',
      pending,
      spawnPayload,
      resultExists: fs.existsSync(RESULT_FILE)
    };
  } catch (e) {
    return { hasPending: false, error: e.message };
  }
}

/**
 * 清除 pending 狀態
 */
function clearPending() {
  try {
    if (fs.existsSync(PENDING_FILE)) {
      let pending;
      try {
        pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
      } catch (e) {
        console.error('⚠️ Failed to parse pending file:', e.message);
        pending = { count: 0 };
      }
      pending.status = 'processed';
      pending.processedAt = getHKTDateTime();
      fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), 'utf8');
    }
  } catch (e) {
    // ignore
  }
}

/**
 * 主函數
 */
function main() {
  const args = process.argv.slice(2);
  const doSpawn = args.includes('--spawn');
  const quiet = args.includes('--quiet');

  const status = getPendingStatus();

  if (status.error) {
    if (!quiet) console.error(`❌ Error: ${status.error}`);
    process.exit(1);
  }

  if (!status.hasPending) {
    if (!quiet) console.log('ℹ️  No pending pure_audit spawn');
    process.exit(1); // 沒有 pending
  }

  if (!quiet) {
    console.log('📋 Pure Audit Pending Spawn:');
    console.log(`   Created: ${status.pending.createdAt}`);
    console.log(`   Files: ${status.spawnPayload?._meta?.totalFiles || 'N/A'}`);
    console.log(`   Result exists: ${status.resultExists}`);
    console.log('');
  }

  if (doSpawn) {
    // 返回 spawn payload JSON（供 main agent 讀取並 spawn）
    console.log('PURE_AUDIT_SPAWN_PAYLOAD_START');
    console.log(JSON.stringify(status.spawnPayload, null, 2));
    console.log('PURE_AUDIT_SPAWN_PAYLOAD_END');

    // 標記為已處理（等 sub-agent 完成後再更新）
    // 注意：這只是標記請求已接收，實際 spawn 由 main agent 執行
    if (!quiet) {
      console.log('');
      console.log('✅ Pending spawn 已報告，等待 main agent spawn...');
    }
  }

  process.exit(0); // 有 pending
}

// 導出函數
module.exports = {
  getPendingStatus,
  clearPending
};

// CLI 入口
if (require.main === module) {
  main();
}
