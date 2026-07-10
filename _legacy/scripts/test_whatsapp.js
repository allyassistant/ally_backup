#!/usr/bin/env node
/**
 * Test WhatsApp Notification
 */

const { execSync } = require('child_process');

const message = `⚠️ Token Alert (50%) - TEST\n\n` +
  `Session token 已達 50%。\n\n` +
  `💡 建議：準備開新 session\n` +
  `⏰ 70% 時會自動存檔並通知\n\n` +
  `想現在 reset 請輸入「/reset」\n\n` +
  `✅ 這是測試訊息 - Ally AI`;

try {
  execSync(`openclaw message send --channel whatsapp -t process.env.JOSH_NUMBER || "+852XXXXXXXX" -m "${message}"`, { 
    timeout: 15000,
    stdio: 'pipe'
  });
  console.log('✅ WhatsApp test message sent to +852XXXXXX');
} catch (err) {
  console.error('❌ 發送失敗:', err.message);
}
