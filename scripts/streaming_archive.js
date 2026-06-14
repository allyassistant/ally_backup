#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// HKT Time Helper
/**
 * Streaming Archive Script
 * Auto-append conversation segments to Apple Notes periodically
 * Long-term solution: Archives every N messages or every hour
 */

const { createNote } = require('./apple_notes')
const fs = require('fs');
const path = require('path');
const os = require('os');

const TRANSCRIPT_DIR = path.join(os.homedir(), '.openclaw/agents/main/sessions');
const { MEMORY_DIR } = require('./lib/config');
const STATE_FILE = path.join(MEMORY_DIR, 'streaming-archive-state.json');
const ARCHIVE_INTERVAL = 100; // Archive every 100 messages (backup condition)
const TIME_INTERVAL = 4 * 60 * 60 * 1000; // Archive every 4 hours (primary condition)
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
  try {
    const files = fs.readdirSync(TRANSCRIPT_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(TRANSCRIPT_DIR, f),
        mtime: fs.statSync(path.join(TRANSCRIPT_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].path : null;
  } catch {
    return null;
  }
}

function readNewMessages(transcriptPath, fromIndex) {
  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    let formatted = '';
    let newCount = 0;

    for (let i = fromIndex; i < lines.length; i++) {
      try {
        let msg;
        try {
          msg = JSON.parse(lines[i]);
        } catch (e) {
          continue; // Skip invalid JSON lines
        }
        if (msg.type && msg.type !== 'message') continue;

        const role = msg.role || msg.message?.role;
        const content_data = msg.content || msg.message?.content;
        const timestamp = msg.timestamp || msg.message?.timestamp;

        let timeStr = '';
        if (timestamp) {
          const date = new Date(timestamp);
          timeStr = date.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
        }

        const text = typeof content_data === 'string' ? content_data :
          Array.isArray(content_data) ? content_data.map(c => c.text || '').join(' ') : '';

        // Skip system messages and non-conversation content
        if (!text) continue;
        if (text.includes('[Queued announce')) continue;
        if (text === 'HEARTBEAT_OK') continue;
        if (text.startsWith('System:')) continue;
        if (text.includes('Read HEARTBEAT.md')) continue;
        if (text.includes('HEARTBEAT: Check session token')) continue;

        const cleanText = text
          .replace(/\[WhatsApp [^\]]+\]\s*/g, '')
          .replace(/\[message_id:[^\]]+\]/g, '')
          .replace(/\[media attached:[^\]]+\]\s*/g, '')
          .replace(/^NO_REPLY\s*$/m, '')
          .replace(/Read HEARTBEAT\.md if it exists[^\n]*/g, '')
          .replace(/Follow it strictly[^\n]*/g, '')
          .replace(/Do not infer or repeat[^\n]*/g, '')
          .replace(/If nothing needs attention[^\n]*/g, '')
          .trim();

        if (!cleanText) continue;

        // Only process user (Josh) and assistant (Ally) messages
        if (role === 'user') {
          formatted += `━━━━━━━━━━━━━━━━━━━━━━<br>`;
          formatted += `👤 Josh  ${timeStr ? `(${timeStr})` : ''}<br>`;
          formatted += `━━━━━━━━━━━━━━━━━━━━━━<br>`;
          formatted += `${cleanText.replace(/\n/g, '<br>')}<br><br>`;
          newCount++;
        } else if (role === 'assistant') {
          // Skip if assistant message is just HEARTBEAT_OK or system response
          if (cleanText === 'HEARTBEAT_OK' || cleanText.includes('HEARTBEAT_OK')) continue;
          formatted += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈<br>`;
          formatted += `🤖 Ally<br>`;
          formatted += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈<br>`;
          formatted += `${cleanText.replace(/\n/g, '<br>')}<br><br>`;
          newCount++;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return { formatted, newCount, totalLines: lines.length };
  } catch (err) {
    return { formatted: '', newCount: 0, totalLines: 0 };
  }
}

function createOrUpdateNote(title, content, isNew = false) {
  // Always create new note - append is not implemented
  // This prevents infinite recursion and ensures consistent behavior
  const fullContent = content;

  // Use memo CLI instead of AppleScript
  const { createNote } = require('./apple_notes')
  return createNote(title, fullContent, "Ally's Chat History");
}

function streamingArchive() {
  try {
    const state = loadState();
    const now = Date.now();
    const lastArchiveTime = state.lastArchiveTime ? new Date(state.lastArchiveTime).getTime() : 0;
    const timeSinceLastArchive = now - lastArchiveTime;

    const transcriptPath = findLatestTranscript();

    if (!transcriptPath) {
      log('❌ No transcript found');
      return;
    }

    // Check if session changed (new session started)
    if (state.sessionId && state.sessionId !== transcriptPath) {
      log('🔄 New session detected, resetting archive state...');
      state.lastArchivedIndex = 0;
      state.noteTitle = null;
    }

    // Check if 4 hours have passed since last archive
    if (timeSinceLastArchive < TIME_INTERVAL && state.lastArchivedIndex > 0) {
      log(`⏸️  Next archive in ${Math.ceil((TIME_INTERVAL - timeSinceLastArchive) / (60 * 60 * 1000))} hours`);
      return;
    }

    const { formatted, newCount, totalLines } = readNewMessages(transcriptPath, state.lastArchivedIndex);

    if (newCount === 0) {
      log('⏸️  No new messages to archive');
      return;
    }

    // Create note title with timestamp
    const noteTitle = `AI Session - ${getCurrentDate()} ${getCurrentTime()}`;
    state.noteTitle = noteTitle;
    state.sessionId = transcriptPath;

    // Archive new content
    const success = createOrUpdateNote(noteTitle, formatted, true);

    if (success) {
      state.lastArchivedIndex = totalLines;
      state.lastArchiveTime = new Date().toISOString();
      saveState(state);
      log(`✅ Archived ${newCount} new messages to: ${noteTitle}`);

      // Update session state
      // HR-041: Atomic write for session state
      try {
        const statePath = path.join(MEMORY_DIR, 'session-state.json');
        const sessionState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        sessionState.streamingArchive.lastArchive = new Date().toISOString();
        sessionState.streamingArchive.messageCount = newCount;
        const tmpPath = statePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(sessionState, null, 2));
        fs.renameSync(tmpPath, statePath);
      } catch { /* ignore state update error */ }
    }
  } catch (err) {
    console.error(`❌ streamingArchive error: ${err.message}`);
  }
}

// Run if called directly
if (require.main === module) {
  try {
    streamingArchive();
  } catch (err) {
    console.error(`❌ streamingArchive error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { streamingArchive, readNewMessages };
