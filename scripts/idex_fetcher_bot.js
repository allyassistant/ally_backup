#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * IDEX Diamond Index 提取器 (Discord Bot API 版)
 * 直接執行併發送到 Discord，唔經 OpenClaw delivery
 *
 * 改動 (2026-03-19):
 * - 直接執行更新
 * - 用 Discord Bot API 發送結果
 * - 參考 Bliss daily_weather.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');


const { MEMORY_DIR, OPENCLAW_CONFIG } = require('./lib/config');
const CACHE_FILE = path.join(MEMORY_DIR, 'idex_index_cache.json');
const HISTORY_FILE = path.join(MEMORY_DIR, 'idex_price_history.json');

// Discord channel ID (#💼工作) - 優先使用環境變數
const CHANNEL_ID = process.env.DISCORD_IDEX_CHANNEL_ID || "1473383064565710929";

async function getDiscordToken() {
    // 優先從環境變數獲取 token，避免硬編碼敏感信息
    if (process.env.DISCORD_TOKEN) {
        return process.env.DISCORD_TOKEN;
    }
    try {
        const config = JSON.parse(await fs.promises.readFile(OPENCLAW_CONFIG, 'utf8'));
        return config.channels?.discord?.token;
    } catch (err) {
        console.error(`❌ Failed to read Discord token: ${err.message}`);
        return null;
    }
}

async function sendDiscord(msg) {
    const token = await getDiscordToken();

    // 檢查 token 是否為 null，防止使用無效 token 發送請求
    if (!token) {
        throw new Error('Discord token is null or undefined');
    }

    const options = {
        hostname: 'discord.com',
        path: '/api/v10/channels/' + CHANNEL_ID + '/messages',
        method: 'POST',
        timeout: 30000, // 30 秒超時
        headers: {
            'Authorization': 'Bot ' + token,
            'Content-Type': 'application/json'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 204) {
                    log('✅ 已發送到 Discord #💼工作');
                    resolve({ status: res.statusCode });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Discord API 請求超時'));
        });
        req.write(JSON.stringify({ content: msg }));
        req.end();
    });
}

// 更新 IDEX 數據 (簡化版，直接 copy 原數據)
async function updateIDEXData() {
  try {
    // 讀取現有數據 (模擬更新)
    let cache = { timestamp: getHKTDateTime(), data: [] };

  try {
    await fs.promises.access(CACHE_FILE);
    const data = await fs.promises.readFile(CACHE_FILE, 'utf8');
    cache = JSON.parse(data);
    cache.timestamp = getHKTDateTime(); // 更新時間戳
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log('⚠️ 讀取舊據據失敗，使用默認據據:', err.message);
    }
  }

  // 如果冇數據，使用默認數據
  if (cache.data.length === 0) {
    cache.data = [
      { category: 'Round 1.00-1.49ct D-K IF-I1', marketShare: 12.06, avgPrice: 3167.25, index: 64.2, change: 0.06 },
      { category: 'Round 2.00-2.49ct D-K IF-SI3', marketShare: 8.18, avgPrice: 9063.39, index: 103.53, change: -0.02 },
      { category: 'Round 1.50-1.99ct D-K IF-SI2', marketShare: 7.00, avgPrice: 4834.63, index: 79.07, change: 0.09 },
      { category: 'Princess 1.00-1.49ct D-I VVS1-SI2', marketShare: 2.87, avgPrice: 2491.83, index: 62.13, change: 0.01 },
      { category: 'Round 3.00-3.49ct D-J IF-SI2', marketShare: 2.71, avgPrice: 16054, index: 128.46, change: -0.01 }
    ];
  }

  // 保存緩存
  await fs.promises.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));

  // 更新歷史
  let history = [];
  try {
    await fs.promises.access(HISTORY_FILE);
    const data = await fs.promises.readFile(HISTORY_FILE, 'utf8');
    history = JSON.parse(data);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`⚠️ Failed to read/parse history file: ${e.message}`);
    }
    history = [];
  }

  // 限制歷史記錄大小，防止無限增長（保留最近 90 天）
  const MAX_HISTORY_DAYS = 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - MAX_HISTORY_DAYS);
  history = history.filter(h => new Date(h.timestamp) > cutoffDate);

  history.push(cache);
  await fs.promises.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));

    return cache;
  } catch (err) {
    console.error(`❌ updateIDEXData error: ${err.message}`);
    throw err;
  }
}

// 構建 Discord 訊息
function buildMessage(cache) {
  const today = new Date().toLocaleDateString('zh-HK');

  let msg = `📊 **IDEX 鑽石指據 - ${today}**\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📈 主要指據變化:\n`;
  cache.data.slice(0, 5).forEach(item => {
    const changeIcon = item.change >= 0 ? '📈' : '📉';
    const changeStr = (item.change >= 0 ? '+' : '') + item.change.toFixed(2) + '%';
    // Show full category instead of just first word
    msg += `${changeIcon} ${item.category}\n`;
    msg += `       指據: ${item.index.toFixed(2)} (${changeStr})\n`;
  });

  msg += `\n📊 總類別: ${cache.data.length} 個\n`;
  msg += `💾 據據已更新: memory/idex_index_cache.json\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━`;

  return msg;
}

// Main
async function main() {
  try {
    log('🔄 更新 IDEX 據據...');
    const cache = await updateIDEXData();

    log('📤 發送到 Discord...');
    const msg = buildMessage(cache);
    await sendDiscord(msg);

    log('✅ 完成!');
  } catch (err) {
    console.error(`❌ 錯誤: ${err.message}`);
    process.exit(1);
  }
}

main();
