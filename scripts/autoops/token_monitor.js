#!/usr/bin/env node
/**
 * Qwen3 AutoOps Token Monitor - Fixed Version
 *
 * 只喺有問題先輸出，正常時保持靜默
 *
 * Created: 2026-02-15
 * Fixed: 2026-02-15
 */

const fs = require('fs');
const { execSync } = require('child_process');

const STATE_FILE = process.env.HOME + '/.openclaw/workspace/memory/heartbeat-state.json';

// Token thresholds
const THRESHOLDS = {
  WARNING: 50,  // 50%
  CRITICAL: 70  // 70%
};

function getTokenUsage() {
  try {
    // 讀取 session 資料
    const result = execSync('openclaw sessions list --json 2>/dev/null || echo "{}"', {
      encoding: 'utf8',
      timeout: 10000
    });

    const data = JSON.parse(result);
    const sessions = data.sessions || [];

    // 找 main session
    const mainSession = sessions.find(s => s.key === 'agent:main:main');

    if (mainSession && mainSession.totalTokens && mainSession.contextTokens) {
      const percentage = (mainSession.totalTokens / mainSession.contextTokens) * 100;
      return {
        found: true,
        percentage: Math.round(percentage),
        used: mainSession.totalTokens,
        total: mainSession.contextTokens
      };
    }

    return { found: false, percentage: 0 };
  } catch (e) {
    return { found: false, percentage: 0, error: e.message };
  }
}

function main() {
  const tokenData = getTokenUsage();

  // 如果搵唔到資料，靜默結束
  if (!tokenData.found) {
    process.exit(0);
  }

  const percentage = tokenData.percentage;

  // 保存狀態（靜默）
  try {
    const existing = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8') || '{}');
    existing.lastTokenCheck = new Date().toISOString();
    existing.tokenPercentage = percentage;
    fs.writeFileSync(STATE_FILE, JSON.stringify(existing, null, 2));
  } catch (e) {
    // Ignore
  }

  // 只喺超過 threshold 先輸出
  if (percentage < THRESHOLDS.WARNING) {
    // 正常 - 靜默結束
    process.exit(0);
  }

  // 有問題 - 輸出警告（注意：用 exit 0 避免被誤認為執行失败）
  let emoji = '🟡';
  let level = 'WARNING';

  if (percentage >= THRESHOLDS.CRITICAL) {
    emoji = '🔴';
    level = 'CRITICAL';
  }

  console.log(`${emoji} **Token Monitor Alert**`);
  console.log(`Level: ${level}`);
  console.log(`Usage: ${percentage}% (${tokenData.used?.toLocaleString() || '?'} / ${tokenData.total?.toLocaleString() || '?'})`);

  if (percentage >= THRESHOLDS.CRITICAL) {
    console.log(`\n⚠️ Auto-archive may be triggered!`);
  }

  // Exit 0 表示腳本正常執行，只是檢测到高用量
  process.exit(0);
}

main();
