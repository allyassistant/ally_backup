#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// HKT Time Helper
/**
 * Token Archive Script - Archive full conversation to Apple Notes
 * When token reaches 70%, archive complete conversation transcript
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { MEMORY_DIR } = require('./lib/config');
const STATE_FILE = path.join(MEMORY_DIR, 'heartbeat-state.json');
const TRANSCRIPT_DIR = path.join(os.homedir(), '.openclaw/agents/main/sessions');
const THRESHOLD = 70;
const ALERT_THRESHOLD = 50;
const { getHKTDate } = require('./lib/time');
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE);
function getCurrentDate() {
  return getHKTDate();
}

function getCurrentTime() {
  return new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
}

function findLatestTranscript() {
  let files;
  try {
    files = fs.readdirSync(TRANSCRIPT_DIR);
  } catch (e) {
    console.error('Error: ' + e.message);
    return null;
  }
  files = files
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      let mtime;
      try {
        mtime = fs.statSync(path.join(TRANSCRIPT_DIR, f)).mtime;
      } catch (e) {
        console.error('Error: ' + e.message);
        return { name: f, path: path.join(TRANSCRIPT_DIR, f), mtime: new Date(0) };
      }
      return {
        name: f,
        path: path.join(TRANSCRIPT_DIR, f),
        mtime
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

function readTranscript(transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch (err) {
    console.error('Error: ' + err.message);
    return `Could not read transcript: ${err.message}`;
  }
  const lines = content.trim().split('\n').filter(line => line.trim());

  let formatted = '';
  let msgCount = 0;

  for (const line of lines) {
    try {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        continue; // Skip invalid JSON lines
      }

      // Skip non-message types
      if (msg.type && msg.type !== 'message') continue;

      const role = msg.role || msg.message?.role;
      const content_data = msg.content || msg.message?.content;
      const timestamp = msg.timestamp || msg.message?.timestamp;

      // Extract time from timestamp
      let timeStr = '';
      if (timestamp) {
        const date = new Date(timestamp);
        timeStr = date.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
      }

      if (role === 'user') {
        const text = extractText(content_data);
        if (text && !text.includes('[Queued announce')) {
          // Clean up the text
          const cleanText = text
            .replace(/\[WhatsApp [^\]]+\]\s*/g, '')
            .replace(/\[message_id:[^\]]+\]/g, '')
            .replace(/\[media attached:[^\]]+\]\s*/g, '')
            .trim();

          if (cleanText) {
            // Use HTML <br> for line breaks in Apple Notes
            formatted += `━━━━━━━━━━━━━━━━━━━━━━<br>`;
            formatted += `👤 Josh  ${timeStr ? `(${timeStr})` : ''}<br>`;
            formatted += `━━━━━━━━━━━━━━━━━━━━━━<br>`;
            formatted += `${cleanText.replace(/\n/g, '<br>')}<br><br>`;
            msgCount++;
          }
        }
      } else if (role === 'assistant') {
        const text = extractText(content_data);
        if (text && text !== 'HEARTBEAT_OK' && !text.includes('[Queued announce')) {
          const cleanText = text
            .replace(/^NO_REPLY\s*$/m, '')
            .replace(/HEARTBEAT_OK\s*/g, '')
            .trim();

          if (cleanText) {
            formatted += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈<br>`;
            formatted += `🤖 Ally<br>`;
            formatted += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈<br>`;
            formatted += `${cleanText.replace(/\n/g, '<br>')}<br><br>`;
            msgCount++;
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (msgCount === 0) {
    return 'No messages found in transcript.';
  }

  return formatted;
  }

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c;
      if (c && c.text) return c.text;
      return '';
    }).join(' ');
  }
  if (content.text) return content.text;
  return JSON.stringify(content);
}

function archiveToAppleNotes(transcript, tokenInfo) {
  const title = `AI Session Archive - ${getCurrentDate()} ${getCurrentTime()}`;

  // Format content with HTML <br> for Apple Notes
  const header = `═══════════════════════════════════════<br>` +
    `<b>💬 AI SESSION ARCHIVE</b><br>` +
    `═══════════════════════════════════════<br><br>` +
    `📅 <b>Date:</b> ${getCurrentDate()}<br>` +
    `⏰ <b>Time:</b> ${getCurrentTime()}<br>` +
    `📊 <b>Token Usage:</b> ${tokenInfo}<br><br>` +
    `═══════════════════════════════════════<br>` +
    `<b>📝 CONVERSATION LOG</b><br>` +
    `═══════════════════════════════════════<br><br>`;

  const footer = `<br><br>═══════════════════════════════════════<br>` +
    `✅ <i>Auto-archived by Ally AI Assistant</i><br>` +
    `═══════════════════════════════════════`;

  // Combine - limit to ~5000 chars
  let fullContent = header + transcript;
  if (fullContent.length > 5000) {
    fullContent = fullContent.substring(0, 5000) + `<br><br>[... Content truncated - conversation too long ...]`;
  }
  fullContent += footer;

  // Use memo CLI instead of AppleScript
  const { createNote } = require('./apple_notes')
  const success = createNote(title, fullContent, "Ally's Chat History");

  if (success) {
    log(`✅ Archived to Apple Notes: ${title}`);
    // Send WhatsApp notification
    sendWhatsAppNotification(title, tokenInfo);
    return { success: true, title };
  } else {
    console.error('❌ Failed to archive to Apple Notes');
    return { success: false, error: 'Failed to create note' };
  }
}

function sendWhatsAppNotification(archiveTitle, tokenInfo) {
  const message = `🔄 Session Token Alert\n\n` +
    `Token 用量已達 ${tokenInfo}，對話內容已自動存檔至 Apple Notes。\n\n` +
    `📋 存檔標題：${archiveTitle}\n` +
    `📁 位置：Ally's Notes folder\n\n` +
    `請輸入「/reset」開新 session 以繼續使用。\n\n` +
    `✅ Ally AI Assistant`;

  try {
    // 使用陣列參數避免命令注入
    const { execFileSync } = require('child_process');
    execFileSync('openclaw', [
      'message', 'send',
      '--channel', 'whatsapp',
      '-t', '+852XXXXXX',
      '-m', message
    ], {
      timeout: 15000,
      stdio: 'pipe'
    });
    log('✅ WhatsApp notification sent to +852XXXXXX');
  } catch (err) {
    console.error('❌ Failed to send WhatsApp:', err.message);
  }
}

function checkAndArchive(currentPercentage) {
  try {
    const state = loadState();
    const sessionId = state.lastCheck?.sessionId || 'unknown';

  // Check if already archived this session
  if (state.archivedSessions?.includes(sessionId)) {
    return { action: 'already_archived', percentage: currentPercentage };
  }

  // First warning at 50%
  if (currentPercentage >= ALERT_THRESHOLD && currentPercentage < THRESHOLD) {
    if (!state.alerts?.firstWarningSent) {
      state.alerts.firstWarningSent = true;
      state.alerts.firstWarningAt = new Date().toISOString();
      saveState(state);
      return {
        action: 'warn',
        percentage: currentPercentage,
        message: `Token at ${currentPercentage}%. Will auto-archive conversation at 70%.`
      };
    }
  }

  // Archive at 70%
  if (currentPercentage >= THRESHOLD) {
    log('🔴 Token at 70%+. Archiving conversation to Apple Notes...');

    const transcriptPath = findLatestTranscript();
    const transcript = transcriptPath ? readTranscript(transcriptPath) : 'Could not load transcript.';
    const result = archiveToAppleNotes(transcript, `${currentPercentage}%`);

    if (result.success) {
      state.archivedSessions = state.archivedSessions || [];
      state.archivedSessions.push(sessionId);
      state.alerts.firstWarningSent = false;
      state.alerts.archiveCompleted = true;
      state.alerts.archiveTime = new Date().toISOString();
      state.alerts.archivedTitle = result.title;
      saveState(state);

      return {
        action: 'archive_complete',
        percentage: currentPercentage,
        title: result.title,
        message: `✅ Conversation archived to: ${result.title}\\n🔄 Please use /reset to start fresh session.`
      };
    }

    return { action: 'archive_failed', percentage: currentPercentage, error: result.error };
  }

    return { action: 'normal', percentage: currentPercentage };
  } catch (err) {
    console.error(`❌ checkAndArchive error: ${err.message}`);
    return { action: 'error', percentage: currentPercentage, error: err.message };
  }
}

// CLI usage
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const percentage = parseInt(args[0], 10);

    if (isNaN(percentage)) {
      log('Usage: node token_archive.js <percentage>');
      process.exit(1);
    }

    const result = checkAndArchive(percentage);
    log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`❌ CLI error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { checkAndArchive, archiveToAppleNotes, findLatestTranscript, readTranscript };
