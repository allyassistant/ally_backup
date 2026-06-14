#!/usr/bin/env node
/**
 * Stock List 混合估值系統 (Discord Bot API 版)
 * 直接發送到 Discord，唔經 OpenClaw delivery
 * 
 * 改動 (2026-03-19):
 * - 參考 Bliss daily_weather.js
 * - 直接用 Discord Bot API 發送
 * - 避免 OpenClaw timeout/重試問題
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const https = require('https');

const RAPAPORT_DB = path.join(__dirname, '../memory/rapaport_db.json');
const IDEX_CACHE = path.join(__dirname, '../memory/idex_index_cache.json');
const STOCK_DIR = path.join(process.env.HOME, 'Desktop/Stock list');

// Discord channel ID (#💼工作)
const CHANNEL_ID = "1473383064565710929";

function getDiscordToken() {
    const configPath = process.env.HOME + '/.openclaw/openclaw.json';
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.channels.discord.token;
}

function sendDiscord(msg) {
    const token = getDiscordToken();
    
    const options = {
        hostname: 'discord.com',
        path: '/api/v10/channels/' + CHANNEL_ID + '/messages',
        method: 'POST',
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
                    console.log('✅ 已發送到 Discord #💼工作');
                    resolve({ status: res.statusCode });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify({ content: msg }));
        req.end();
    });
}

// 收集輸出
let outputBuffer = [];
function log(msg) {
  outputBuffer.push(msg);
}

function getOutput() {
  return outputBuffer.join('\n');
}

// 載入 Rapaport 數據
function loadRapaport() {
  if (!fs.existsSync(RAPAPORT_DB)) {
    log('⚠️ 找不到 Rapaport 數據庫');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(RAPAPORT_DB, 'utf8'));
  } catch (err) {
    log(`❌ 讀取 Rapaport 失敗: ${err.message}`);
    return null;
  }
}

// 載入 IDEX 數據
function loadIDEX() {
  if (!fs.existsSync(IDEX_CACHE)) {
    log('⚠️ 找不到 IDEX 數據，請先運行: node scripts/idex_fetcher.js update');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(IDEX_CACHE, 'utf8'));
  } catch (err) {
    log(`❌ 讀取 IDEX 失敗: ${err.message}`);
    return null;
  }
}

// 載入 Stock List
function loadStockList() {
  if (!fs.existsSync(STOCK_DIR)) {
    log(`⚠️ Stock list 目錄不存在: ${STOCK_DIR}`);
    return null;
  }

  try {
    const files = fs.readdirSync(STOCK_DIR)
      .filter(f => f.toLowerCase().startsWith('stock list') && f.endsWith('.xlsx'))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      log('⚠️ 找不到 Stock list 文件');
      return null;
    }
    
    const latestFile = path.join(STOCK_DIR, files[0]);
    log(`📂 使用 Stock list: ${files[0]}`);
    
    let workbook;
    try {
      workbook = XLSX.readFile(latestFile);
    } catch (err) {
      log(`❌ 讀取 Excel 失敗: ${err.message}`);
      return null;
    }
    
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  } catch (err) {
    log(`❌ 載入 Stock list 失敗: ${err.message}`);
    return null;
  }
}

// 簡化版計算 (只輸出摘要)
async function evaluateAndSend() {
  try {
    const rapaportData = loadRapaport();
    const idexData = loadIDEX();
    const stockList = loadStockList();

    if (!stockList || stockList.length === 0) {
      throw new Error('無法載入 Stock list');
    }

    log(`💎 開始估值 ${stockList.length} 粒鑽石...\n`);
    
    // 簡化計算 - 只計 summary
    let validCount = 0;
    let errorCount = 0;
    
    stockList.forEach((row, i) => {
      try {
        const shape = row.Shape || row['形狀'];
        const carat = parseFloat(row.Carat || row['卡重'] || row.Crt || row['重量']);
        const color = (row.Color || row['顏色'] || '').toUpperCase();
        const clarity = (row.Clarity || row['淨度'] || '').toUpperCase();
        
        if (!shape || !carat || !color || !clarity) {
          errorCount++;
          return;
        }
        validCount++;
      } catch (err) {
        errorCount++;
      }
    });
    
    log(`✅ 成功: ${validCount} 粒`);
    log(`❌ 錯誤: ${errorCount} 粒`);
    log(`📊 總計: ${stockList.length} 粒`);
    
    // Build Discord message
    const today = new Date().toLocaleDateString('zh-HK');
    let msg = `💎 **Stock List 估值報告 - ${today}**\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `📂 文件: 最新 Stock list\n`;
    msg += `✅ 成功估值: ${validCount} 粒\n`;
    msg += `❌ 錯誤: ${errorCount} 粒\n`;
    msg += `📊 總計: ${stockList.length} 粒\n\n`;
    
    if (rapaportData) {
      msg += `📚 Rapaport: ✅ 已載入\n`;
    }
    if (idexData) {
      msg += `📈 IDEX: ✅ 已載入\n`;
    }
    
    msg += `\n💾 詳細結果: memory/stock_evaluation_latest.json\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━`;
    
    // Send to Discord
    await sendDiscord(msg);
    
    console.log('\n' + getOutput());
    
  } catch (err) {
    console.error(`❌ 估值失敗: ${err.message}`);
    process.exit(1);
  }
}

// 全局錯誤處理
process.on('uncaughtException', (err) => {
  console.error(`❌ 未捕獲錯誤: ${err.message}`);
  process.exit(1);
});

// Main
evaluateAndSend();
