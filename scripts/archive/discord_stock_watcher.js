#!/usr/bin/env node
/**
 * Discord Stock Watcher - 自動監聽工作頻道 Excel 上傳
 * 
 * 功能：
 * 1. 監聽 Discord 💼工作 channel（1473383064565710929）
 * 2. 檢測 Excel 檔案上傳（.xlsx / .xls）
 * 3. 自動下載附件到暫時目錄
 * 4. 執行 update_stock_list.js 處理
 * 
 * 用法：
 *   node scripts/discord_stock_watcher.js --watch    # 持續監聽
 *   node scripts/discord_stock_watcher.js --once     # 檢查一次
 * 
 * 安裝為 cron job（每 5 分鐘檢查）：
 *   /5 * * * * cd /Users/ally/.openclaw/workspace && node scripts/discord_stock_watcher.js --once
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

// ==================== 配置 ====================
const CONFIG = {
  // Discord channel ID（💼工作）
  workChannelId: '1473383064565710929',
  
  // 暫時下載目錄
  tempDir: '/Users/ally/.openclaw/workspace/memory/temp_stock',
  
  // 處理後移動到
  processedDir: '/Users/ally/.openclaw/workspace/memory/processed_stock',
  
  // 記錄已處理既 message ID
  stateFile: '/Users/ally/.openclaw/workspace/memory/discord_stock_watcher_state.json',
  
  // 通知既 Discord channel（⚙️系統）
  notifyChannelId: '1473376125584670872',
};

const { createStateManager } = require('../lib/state');
const { load: loadState, save: saveState } = createStateManager(CONFIG.stateFile, { processedMessages: [], lastCheck: null });

// ==================== 工具函數 ====================

function log(msg, force = true) {
  console.log(msg);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}



// ==================== Discord API 調用 ====================

/**
 * 獲取 Discord channel 最近既訊息
 */
function getRecentMessages(channelId, limit = 50) {
  try {
    // 用 openclaw 既內部機制獲取訊息
    // 注意：呢度係模擬實現，實際要用 OpenClaw 既 API
    const result = execSync(
      `openclaw message read --channel discord --channel-id "${channelId}" --limit ${limit} --json 2>/dev/null || echo "[]"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    return JSON.parse(result);
  } catch (e) {
    log(`⚠️ 獲取訊息失敗: ${e.message}`);
    return [];
  }
}

/**
 * 檢查訊息係咪包含 Excel 附件
 */
function hasExcelAttachment(message) {
  if (!message.attachments || message.attachments.length === 0) {
    return false;
  }
  
  return message.attachments.some(att => {
    const filename = att.filename?.toLowerCase() || '';
    return filename.endsWith('.xlsx') || filename.endsWith('.xls');
  });
}

/**
 * 下載 Discord 附件
 */
function downloadAttachment(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(outputPath);
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// ==================== 核心邏輯 ====================

/**
 * 處理單個 Excel 檔案
 */
async function processExcelFile(filePath, originalFilename, messageInfo) {
  try {
    log(`📊 處理: ${originalFilename}`);
    
    // 1. 執行 update_stock_list.js 處理呢個特定檔案
    const updateScript = path.join(__dirname, 'update_stock_list.js');
    
    // 創建一個臫時既配置文件俾 update_stock_list.js 用
    const tempConfig = {
      inputFile: filePath,
      originalName: originalFilename,
      messageId: messageInfo.id,
      timestamp: messageInfo.timestamp
    };
    
    const configPath = path.join(CONFIG.tempDir, 'temp_config.json');
    fs.writeFileSync(configPath, JSON.stringify(tempConfig, null, 2));
    
    // 2. 執行更新（quiet 模式）
    execSync(`node "${updateScript}" --quiet --discord`, {
      cwd: '/Users/ally/.openclaw/workspace',
      stdio: 'inherit',
      timeout: 120000
    });
    
    // 3. 移動到已處理目錄
    const processedPath = path.join(
      CONFIG.processedDir, 
      `${Date.now()}_${originalFilename}`
    );
    fs.renameSync(filePath, processedPath);
    
    // 4. 發送成功通知
    const notifyMsg = `✅ Stock List 已更新\n\n檔案: ${originalFilename}\n時間: ${new Date().toLocaleString('zh-HK')}\n處理結果: 成功`;
    
    execSync(
      `openclaw message send --channel discord -t "${CONFIG.notifyChannelId}" -m "${notifyMsg}"`,
      { stdio: 'pipe' }
    );
    
    log(`   ✅ 完成: ${originalFilename}`);
    return true;
    
  } catch (error) {
    log(`   ❌ 失敗: ${error.message}`);
    
    // 發送失敗通知
    const errorMsg = `❌ Stock List 更新失敗\n\n檔案: ${originalFilename}\n錯誤: ${error.message}\n時間: ${new Date().toLocaleString('zh-HK')}`;
    
    try {
      execSync(
        `openclaw message send --channel discord -t "${CONFIG.notifyChannelId}" -m "${errorMsg}"`,
        { stdio: 'pipe' }
      );
    } catch (e) {
      // 通知發送失敗都冇所謂
    }
    
    return false;
  }
}

/**
 * 主檢查循環
 */
async function checkOnce() {
  log(`\n🔍 檢查 Discord 工作頻道 (${new Date().toLocaleString('zh-HK')})`);
  
  ensureDir(CONFIG.tempDir);
  ensureDir(CONFIG.processedDir);
  
  const state = loadState();
  
  // 獲取最近訊息
  const messages = getRecentMessages(CONFIG.workChannelId, 20);
  
  if (messages.length === 0) {
    log('   無新訊息');
    return;
  }
  
  let processedCount = 0;
  
  for (const message of messages) {
    // 檢查係咪已經處理過
    if (state.processedMessages.includes(message.id)) {
      continue;
    }
    
    // 檢查係咪有 Excel 附件
    if (!hasExcelAttachment(message)) {
      // 記錄為已檢查（但係冇 Excel）
      state.processedMessages.push(message.id);
      continue;
    }
    
    log(`\n📎 發現 Excel 附件`);
    log(`   訊息 ID: ${message.id}`);
    log(`   時間: ${message.timestamp}`);
    
    // 下載每個 Excel 附件
    for (const attachment of message.attachments) {
      const filename = attachment.filename;
      
      if (!filename.match(/\.(xlsx|xls)$/i)) {
        continue;
      }
      
      log(`   檔案: ${filename}`);
      
      try {
        // 下載檔案
        const tempPath = path.join(CONFIG.tempDir, `${Date.now()}_${filename}`);
        await downloadAttachment(attachment.url, tempPath);
        log(`   ⬇️  已下載`);
        
        // 處理檔案
        const success = await processExcelFile(tempPath, filename, message);
        
        if (success) {
          processedCount++;
        }
        
      } catch (error) {
        log(`   ❌ 下載失敗: ${error.message}`);
      }
    }
    
    // 記錄為已處理
    state.processedMessages.push(message.id);
  }
  
  // 清理舊記錄（只保留最近 100 條）
  if (state.processedMessages.length > 100) {
    state.processedMessages = state.processedMessages.slice(-100);
  }
  
  state.lastCheck = new Date().toISOString();
  saveState(state);
  
  log(`\n✅ 檢查完成，處理咗 ${processedCount} 個檔案`);
}

/**
 * 持續監聽模式
 */
async function watchMode() {
  log('👁️  啟動 Discord Stock Watcher（監聽模式）');
  log(`   監聽頻道: ${CONFIG.workChannelId}`);
  log(`   檢查頻率: 每 30 秒`);
  log('   按 Ctrl+C 停止\n');
  
  while (true) {
    await checkOnce();
    
    // 等 30 秒再檢查
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

// ==================== 主程式 ====================

function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--watch')) {
    // 持續監聽模式
    watchMode().catch(error => {
      log(`❌ 監聽錯誤: ${error.message}`);
      process.exit(1);
    });
  } else {
    // 單次檢查模式（cron 用）
    checkOnce().then(() => {
      process.exit(0);
    }).catch(error => {
      log(`❌ 檢查錯誤: ${error.message}`);
      process.exit(1);
    });
  }
}

main();
