#!/usr/bin/env node
/**
 * WhatsApp Stock List Handler
 * When user sends Excel file, ask if they want to update stock list
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Store pending confirmations
const pendingConfirmations = new Map();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Handler for incoming Excel files
async function handleIncomingFile(filePath, sender) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Only handle Excel files
  if (!['.xlsx', '.xls'].includes(ext)) {
    return null;
  }
  
  console.log(`📎 Received Excel file: ${path.basename(filePath)}`);
  console.log(`   From: ${sender}`);
  
  // Generate confirmation ID
  const confirmId = generateId();
  pendingConfirmations.set(confirmId, { filePath, sender, timestamp: Date.now() });
  
  return {
    type: 'stock_list',
    confirmId: confirmId,
    filePath: filePath,
    fileName: path.basename(filePath),
    message: `你想用 "${path.basename(filePath)}" 更新 stock list？\n\n請回覆「係」或「yes」確認，或「唔係」取消。`
  };
}

// Handle user's confirmation response
async function handleConfirmation(confirmId, response, sender) {
  const pending = pendingConfirmations.get(confirmId);
  
  if (!pending) {
    return { success: false, message: '呢個確認已經過期喇，請send過個file先.' };
  }
  
  // Check sender matches
  if (pending.sender !== sender) {
    return { success: false, message: '呢個確認唔係屬於你既，請send過個file先.' };
  }
  
  // Clean up
  pendingConfirmations.delete(confirmId);
  
  const isConfirm = ['係', 'yes', 'y', "係呀", "ok", "ok啦"].includes(response.toLowerCase());
  
  if (!isConfirm) {
    return { success: false, message: '好既，已經取消咗。', cancelled: true };
  }
  
  // Run merge script
  console.log(`🔄 Running merge script with: ${pending.filePath}`);
  
  try {
    const output = execSync(`node scripts/merge_stock.js "${pending.filePath}"`, {
      cwd: '/Users/ally/.openclaw/workspace',
      encoding: 'utf8'
    });
    
    return { 
      success: true, 
      message: `✅ Stock list 已更新！\n\n${output}`
    };
  } catch (err) {
    return { 
      success: false, 
      message: `❌ Merge失敗: ${err.message}` 
    };
  }
}

// Parse command line arguments (for testing)
if (require.main === module) {
  const command = process.argv[2];
  const filePath = process.argv[3];
  const sender = process.argv[4] || '+852XXXXXX';
  
  if (command === 'handle' && filePath) {
    handleIncomingFile(filePath, sender).then(result => {
      if (result) {
        console.log('\n📤 Response:');
        console.log(result.message);
        console.log('\nConfirm ID:', result.confirmId);
      } else {
        console.log('❌ Not an Excel file');
      }
    });
  } else if (command === 'confirm' && filePath) {
    const confirmId = process.argv[3];
    const response = process.argv[4];
    handleConfirmation(confirmId, response, sender).then(result => {
      console.log('\n📤 Response:');
      console.log(result.message);
    });
  } else {
    console.log('Usage:');
    console.log('  node whatsapp_stock_handler.js handle <file_path> [sender]');
    console.log('  node whatsapp_stock_handler.js confirm <confirm_id> <response> [sender]');
  }
}

module.exports = { handleIncomingFile, handleConfirmation };
