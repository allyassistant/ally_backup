#!/usr/bin/env node
/**
 * Daily Memory Logger
 * Unified logging for all sessions/channels to memory/YYYY-MM-DD-HHMM.md
 * Run: node scripts/log_to_daily_memory.js
 *
 * Usage:
 *   node scripts/log_to_daily_memory.js --append "⭐ Important thing happened"
 *   node scripts/log_to_daily_memory.js --auto (auto-detect from sessions)
 *
 * Output format: memory/YYYY-MM-DD-HHMM.md (timestamped for multiple sessions per day)
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, '..', 'memory');

// Configuration - magic numbers extracted
const CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024,    // 50MB
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
  DEDUP_KEY_LENGTH: 50,
  MAX_LOG_CONTENT: 500,
  MAX_CONTENT_PREVIEW: 300,
  MAX_CONTENT_LENGTH: 300,
  TAIL_LINES: 300,
  RECENT_LINES: 80,
  MAX_MESSAGES_TO_LOG: 30,
};

// Quiet mode flag
let QUIET = false;

// Helper: Compute TODAY's date and filename each time (avoids midnight stale value)
function getTodayDate() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '-');
}

function getTimeSuffix() {
  const now = new Date();
  const hours = String(now.toLocaleString('en', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', hour12: false })).padStart(2, '0');
  const minutes = String(now.toLocaleString('en', { timeZone: 'Asia/Hong_Kong', minute: '2-digit' })).padStart(2, '0');
  return `${hours}${minutes}`;
}

function getDayFilePath() {
  return path.join(MEMORY_DIR, `${getTodayDate()}-${getTimeSuffix()}.md`);
}

// Keep module-level getter for backward compatibility (now functions, not stale values)
const DATE = getTodayDate(); // Still used by some callers
const TIME_SUFFIX = getTimeSuffix();
const DAY_FILE = getDayFilePath();

// Ensure memory directory exists
let memDirExists = false;
try {
  memDirExists = fs.existsSync(MEMORY_DIR);
} catch (e) {
  console.error(`Failed to check memory directory: ${e.message}`);
}
if (!memDirExists) {
  try {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  } catch (e) {
    console.error(`Failed to create memory directory: ${e.message}`);
  }
}

// Get today's file content or create new
function getOrCreateDayFile() {
  const dayFile = getDayFilePath();
  let dayFileExists = false;
  try {
    dayFileExists = fs.existsSync(dayFile);
  } catch (e) {
    console.error(`Failed to check day file: ${e.message}`);
  }
  if (dayFileExists) {
    try {
      return fs.readFileSync(dayFile, 'utf8');
    } catch (e) {
      console.error(`Failed to read day file: ${e.message}`);
      return '';
    }
  }
  // Create new file with header
  const header = `# Daily Memory - ${getTodayDate()}\n\n`;
  try {
    fs.writeFileSync(dayFile, header);
  } catch (e) {
    console.error(`Failed to write day file: ${e.message}`);
  }
  return header;
}

// Parse event date from entry (雙時態 support)
// Looks for patterns like: [事件: 2026-03-01] or "3月1號" or "2026-03-01"
function extractEventDate(entry) {
  // Pattern 1: Explicit [事件: YYYY-MM-DD]
  const explicitMatch = entry.match(/\[事件:\s*(\d{4}-\d{2}-\d{2})\]/);
  if (explicitMatch) return explicitMatch[1];

  // Pattern 2: Date in YYYY-MM-DD format
  const isoMatch = entry.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Pattern 3: Relative dates (明天, 下星期, etc.)
  // Use HKT-based date to avoid UTC issues in cron environment
  const hktDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  const today = new Date(hktDateStr + 'T00:00:00+08:00');
  const year = today.getFullYear();

  if (entry.includes('明天')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Use local date string with HKT timezone
    return tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  }
  if (entry.includes('後天')) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return dayAfter.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  }
  if (entry.includes('下星期') || entry.includes('下週')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  }

  // No event date found - return null (will use record date)
  return null;
}

// Atomic write helper - writes full content to temp file then renames for atomicity
// NOTE: This is a full REPLACEMENT write (not an append).
// Callers should read existing content, append new content, then pass the combined result.
function atomicAppend(filePath, content) {
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    // Fallback to regular write if atomic fails
    try { fs.writeFileSync(filePath, content); } catch (e2) {
      console.error(`Failed to write: ${e2.message}`);
    }
  }
}

// Append to today's file
function appendEntry(entry, marker = '') {
  const content = getOrCreateDayFile();
  const timestamp = new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong' });
  const recordDate = getTodayDate(); // Today's date as YYYY-MM-DD

  // Extract event date for dual-temporal support
  const eventDate = extractEventDate(entry);

  // Format: [HH:MM] [事件: YYYY-MM-DD | 記錄: YYYY-MM-DD] content
  let temporalTag = '';
  if (eventDate && eventDate !== recordDate) {
    temporalTag = `[事件: ${eventDate} | 記錄: ${recordDate}] `;
  } else {
    temporalTag = `[記錄: ${recordDate}] `;
  }

  const formattedEntry = `- ${marker} [${timestamp}] ${temporalTag}${entry}\n`;

  // NEW 2026-02-21: Check if content already exists (avoid duplicates)
  // Use full entry text (trimmed) for more precise matching
  const entryKey = entry.trim().slice(0, 200);
  // Match against the markdown list items in the file
  if (content.includes(entryKey)) {
    if (!QUIET) console.log(`⏭️ Skipped (duplicate): ${entry.slice(0, 50)}...`);
    return;
  }

  // Use atomic append (read + append + tmp + rename)
  const newContent = content + formattedEntry;
  try {
    atomicAppend(getDayFilePath(), newContent);
  } catch (e) {
    // Last resort fallback
    try { fs.appendFileSync(getDayFilePath(), formattedEntry); } catch (e2) {
      console.error(`Failed to append: ${e2.message}`);
    }
  }

  if (!QUIET) console.log(`✅ Logged: ${entry}`);
  if (eventDate && !QUIET) {
    console.log(`   📅 Event date: ${eventDate} | Record date: ${recordDate}`);
  }
}

// ============================================================
// Helper: Extract actual Discord message from EXTERNAL_UNTRUSTED_CONTENT block
// ============================================================
function extractDiscordMessage(text) {
  // Pattern: <<<EXTERNAL_UNTRUSTED_CONTENT id="...">>> ... UNTRUSTED Discord message body\n[MESSAGE]<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>
  const discordBodyMatch = text.match(/UNTRUSTED Discord message body\n([\s\S]*?)(?=<<<END_EXTERNAL_UNTRUSTED_CONTENT|$)/i);
  if (discordBodyMatch) {
    return discordBodyMatch[1].trim();
  }
  return null;
}

// ============================================================
// Helper: Extract sender from message metadata
// ============================================================
function extractSender(text) {
  // Pattern: "sender": "𝕛𝕆𝕤ℍ𝕦𝔸"
  const senderMatch = text.match(/"sender":\s*"([^"]+)"/);
  if (senderMatch) {
    return senderMatch[1];
  }
  // Alternative pattern: sender (untrusted metadata): {"label": "NAME", ...}
  const labelMatch = text.match(/"name":\s*"([^"]+)"/);
  if (labelMatch) {
    return labelMatch[1];
  }
  return null;
}

// ============================================================
// Helper: Extract actual content from assistant message
// ============================================================
function extractAssistantContent(contentArray) {
  if (!Array.isArray(contentArray)) return null;

  let result = '';
  for (const c of contentArray) {
    const type = c.type;
    const txt = c.text || c.content || '';

    if (type === 'output_text' || type === 'text') {
      // Skip if it's just thinking or tool call
      if (txt.startsWith('The sub-agent') || txt.startsWith('[Internal') || txt.startsWith('<<<')) {
        continue;
      }
      result += txt + ' ';
    }
  }
  return result.trim() || null;
}

// ============================================================
// Enhanced skip patterns for noise
// ============================================================
const SKIP_PATTERNS = [
  // === Cron noise (most common) ===
  'AI HOT 推送',
  'Now I have the raw data',
  'Anomaly monitor',
  'Anomaly Monitor 結果',
  '📡 一切正常',
  '🦾 Ally online',
  '⚙️ Bliss online',
  '👌 Good 有返反應',
  '有3個警報',
  'L0/L1知識庫檔案數量超出基線',
  'Code Quality Manager',
  'Daily Maintenance',
  'Daily Summary',
  'daily summary for',
  'L0 Abstract',
  'L1 Overview',
  'Wiki vectorizer 完成',
  'Wiki vectorizer',
  'Knowledge Base Daily Ingest',
  'cross_session_bootstrap',
  'daily memory logger completed',
  'daily memory logger executed',
  'Daily maintenance ran',
  'Spawn 咗 MiniMax M3',
  'Now let me run the report',
  '已關閉',
  'heartbeat',
  'failover',

  // === Metadata & System ===
  'untrusted metadata',
  'conversation_info',
  '"message_id"',
  '"sender_id"',
  'system:',
  'Tool cron not found',
  'HOMEDIR_TOKEN/.openclaw',
  '=== ',
  '```',
  'Process exited',
  'Command still running',
  'HEARTBEAT_OK',
  'NO_REPLY',

  // === Bootstrap files (read repeatedly) ===
  '# SOUL.md',
  '# AGENTS.md',
  '# MEMORY.md',
  '# USER.md',
  '# TOOLS.md',
  '# HEARTBEAT.md',
  '# IDENTITY.md',
  '# BOOTSTRAP.md',
  'SOUL.md - Who You Are',
  'AGENTS.md - 行為準則',
  'MEMORY.md -',
  'IDENTITY.md - Who Am I',
  'Session Startup sequence',
  'Execute your Session Startup',

  // === Tool outputs ===
  '"profiles": [',
  '"enabled": true',
  '"targetId":',
  '"status": "error"',
  '"status": "ok"',
  '{   "profiles":',
  '{   "enabled":',
  'cdpPort',
  'cdpUrl',
  'wsUrl',
  'Process exited with code',
  'Command exited with code',

  // === Cron job / Logger noise ===
  'Daily Memory Logger',
  'node scripts/log_to_',
  'Logged:',
  '完成了',
  'Code Quality Manager 流程完成',
  'Code Quality Manager 完成',
  'L0 Abstract',
  'L1 Overview',
  'Daily Maintenance 完成',
  'System check 完成',
  'Weekly Parallel 完成',

  // === Sub-agent + HA noise ===
  '等待結果...',
  '深入研究中...',
  '🔍 Kimi Code CLI',
  'Failover 通知',
  '恢復通知',
  'Bliss 已離線',
  'Bliss 已番咗上線',
  '已 spawn',

  // === Internal context blocks ===
  '<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>',
  '<<<END_OPENCLAW_INTERNAL_CONTEXT>>>',
  '<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>',
  '<<<END_UNTRUSTED_CHILD_RESULT>>>',
  '[Internal task completion event]',
  'subagent task',

  // === Tool result JSON (not actual conversation) ===
  '"ok": true',
  '"ok": false',
  'runtime context (internal)',

  // === RapNet / Stock noise ===
  'RapNet 每週更新',
  'Successfully wrote',
  'bytes to',

  // === Session/Token reports ===
  'Subagent Session Token 報告',
  'Session ID',
  'Input Tokens',
  'Output Tokens',
  'Bootstrap Files',
  'Session 狀態',

  // === Overly specific bootstrap/analysis patterns (removed — was catching real conversation)
  'bootstrapMaxChars',
  'Workspace Bootstrap',
  'Bootstrap truncation',
  'Session Token 報告',
  '📊 分析結果',

  // (Removed aggressive filters that were catching real conversation)
  // Old removed patterns: 讓我, 等陣, 等我, Let me add, Let me check, etc.
];


function shouldSkipContent(text) {
  for (const pattern of SKIP_PATTERNS) {
    if (text.includes(pattern)) {
      return true;
    }
  }
  return false;
}

// ============================================================
// Auto-detect activities from active sessions (ENHANCED v4 - FIXED)
// ============================================================
function autoDetectActivities() {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const HOME_DIR = os.homedir();

    // Track last logged position per session file (to avoid re-scanning old content)
    const POSITION_FILE = path.join(MEMORY_DIR, '.session_positions.json');

    function getSessionPositions() {
      if (!fs.existsSync(POSITION_FILE)) return {};
      try {
        return JSON.parse(fs.readFileSync(POSITION_FILE, 'utf8'));
      } catch (e) {
        return {};
      }
    }

    function saveSessionPositions(positions) {
      try {
        // Keep only last 3 days of positions to avoid file bloat
        const now = Date.now();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const cleaned = {};
        for (const [key, val] of Object.entries(positions)) {
          if (val.timestamp && (now - val.timestamp) < threeDaysMs) {
            cleaned[key] = val;
          }
        }
        try {
          fs.writeFileSync(POSITION_FILE, JSON.stringify(cleaned, null, 2));
        } catch (e) {
          console.error(`File write failed: ${e.message}`);
        }
      } catch (e) {
        if (!QUIET) console.error(`Failed to save session positions: ${e.message}`);
      }
    }

    // Load session positions (track which bytes we've already read per file)
    const sessionPositions = getSessionPositions();
    const updatedPositions = { ...sessionPositions };

    // Scan ALL agent sessions (main + discord + whatsapp)
    const AGENTS_DIR = path.join(HOME_DIR, '.openclaw/agents');
    const now = Date.now();
    const oneDayAgo = now - CONFIG.ONE_DAY_MS;

    let allMessages = [];

    // Get all agent directories
    let agentsDirExists = false;
    try { agentsDirExists = fs.existsSync(AGENTS_DIR); } catch (e) {
      if (!QUIET) console.error(`Failed to check agents directory: ${e.message}`);
    }
    if (agentsDirExists) {
      let agents;
      try {
        agents = fs.readdirSync(AGENTS_DIR);
      } catch (e) {
        if (!QUIET) console.error(`Failed to read agents directory: ${e.message}`);
        agents = [];
      }

      for (const agent of agents) {
        const sessionsDir = path.join(AGENTS_DIR, agent, 'sessions');
        let sessionsDirExists = false;
        try { sessionsDirExists = fs.existsSync(sessionsDir); } catch (e) {
          if (!QUIET) console.error(`Failed to check sessions dir: ${e.message}`);
        }
        if (!sessionsDirExists) continue;

        let sessionFiles;
        try {
          sessionFiles = fs.readdirSync(sessionsDir)
            .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted.') && !f.includes('.trajectory'));
        } catch (e) {
          if (!QUIET) console.error(`Failed to read sessions directory: ${e.message}`);
          continue;
        }

        for (const file of sessionFiles) {
          const filePath = path.join(sessionsDir, file);
          let stats;
          try {
            stats = fs.statSync(filePath);
          } catch (e) {
            if (!QUIET) console.error(`Failed to stat file ${file}: ${e.message}`);
            continue;
          }

          // Skip extremely large files
          if (stats.size > CONFIG.MAX_FILE_SIZE) {
            if (!QUIET) console.log(`⏭️ Skipped (extreme: ${(stats.size/1024/1024).toFixed(1)}MB): ${file}`);
            continue;
          }

          // Determine where to start reading: from last known position or tail if new
          const fileKey = `${agent}/${file}`;
          const lastPos = sessionPositions[fileKey];
          const prevBytes = lastPos ? lastPos.bytes : 0;
          const isNewLineSinceLastRun = stats.size > prevBytes;

          // Skip if no new content since last run
          if (!isNewLineSinceLastRun && prevBytes > 0) {
            continue;
          }

          // Only read files modified in last 24 hours
          if (stats.mtimeMs > oneDayAgo) {
            try {
              const { execFileSync } = require('child_process');
              let recentLines = [];

              if (prevBytes > 0) {
                // Read only from last known position using tail -c +<bytes>
                try {
                  const tailOutput = execFileSync('tail', ['-c', '+' + String(prevBytes + 1), filePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
                  recentLines = tailOutput.split('\n').filter(l => l.trim());
                } catch (e) {
                  // Fallback: read last N lines
                  try {
                    const fallbackOutput = execFileSync('tail', ['-n', String(CONFIG.TAIL_LINES), filePath], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
                    recentLines = fallbackOutput.split('\n').filter(l => l.trim());
                  } catch (e2) {
                    let content;
                    try { content = fs.readFileSync(filePath, 'utf8'); } catch (e3) { content = ''; }
                    recentLines = content.split('\n').filter(l => l.trim());
                  }
                }
              } else {
                // First time: read last N lines
                try {
                  const tailOutput = execFileSync('tail', ['-n', String(CONFIG.TAIL_LINES), filePath], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
                  recentLines = tailOutput.split('\n').filter(l => l.trim()).slice(-CONFIG.RECENT_LINES);
                } catch (e) {
                  let content;
                  try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { content = ''; }
                  recentLines = content.split('\n').filter(l => l.trim()).slice(-CONFIG.RECENT_LINES);
                }
              }

              for (const line of recentLines) {
                try {
                  const msg = JSON.parse(line);
                  const msgRole = (msg.message && msg.message.role) || msg.role || '';
                  const contentArray = msg.message && msg.message.content;

                  // Skip system messages
                  if (msgRole === 'system') continue;

                  // ========================================
                  // PROCESS USER MESSAGES
                  // ========================================
                  if (msgRole === 'user' && Array.isArray(contentArray)) {
                    for (const c of contentArray) {
                      if (c.type !== 'text') continue;
                      const text = c.text || '';

                      // Skip if too short
                      if (text.length < 3) continue;

                      // Extract sender
                      const sender = extractSender(text);

                      // Extract actual Discord message from EXTERNAL_UNTRUSTED_CONTENT block
                      const discordMsg = extractDiscordMessage(text);

                      if (discordMsg) {
                        // Found actual Discord message
                        const cleanMsg = discordMsg.trim();
                        // Only check skip on the extracted message content, NOT the full text block
                        if (cleanMsg.length >= 2 && !shouldSkipContent(cleanMsg)) {
                          allMessages.push({
                            agent: agent,
                            role: 'user',
                            sender: sender || 'unknown',
                            content: cleanMsg,
                            timestamp: msg.timestamp || stats.mtimeMs
                          });
                        }
                      } else if (sender) {
                        // User message without Discord body (e.g. webchat or other source)
                        // Use first meaningful line as content
                        const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('Conversation info') && !l.startsWith('Sender'));
                        if (lines.length > 0) {
                          const content = lines.join(' ').trim().slice(0, CONFIG.MAX_CONTENT_LENGTH);
                          if (content.length >= 2 && !shouldSkipContent(content)) {
                            allMessages.push({
                              agent: agent,
                              role: 'user',
                              sender: sender,
                              content: content,
                              timestamp: msg.timestamp || stats.mtimeMs
                            });
                          }
                        }
                      }
                    }
                  }

                  // ========================================
                  // PROCESS ASSISTANT MESSAGES
                  // ========================================
                  if (msgRole === 'assistant' && Array.isArray(contentArray)) {
                    const assistantContent = extractAssistantContent(contentArray);
                    if (assistantContent && assistantContent.length >= 2) {
                      // Skip if too short or noise
                      if (shouldSkipContent(assistantContent)) continue;

                      // Truncate if too long
                      let cleanContent = assistantContent.trim();
                      if (cleanContent.length > CONFIG.MAX_LOG_CONTENT) {
                        cleanContent = cleanContent.slice(0, CONFIG.MAX_LOG_CONTENT) + '...';
                      }

                      allMessages.push({
                        agent: agent,
                        role: 'assistant',
                        sender: 'Ally',
                        content: cleanContent,
                        timestamp: msg.timestamp || stats.mtimeMs
                      });
                    }
                  }

                  // ========================================
                  // PROCESS TOOL RESULT MESSAGES (Discord bridge)
                  // ========================================
                  if (msgRole === 'toolResult' && Array.isArray(contentArray)) {
                    for (const c of contentArray) {
                      if (c.type !== 'text') continue;
                      const text = c.text || '';

                      // Check if this tool result contains a Discord message
                      const discordMsg = extractDiscordMessage(text);
                      if (discordMsg) {
                        const sender = extractSender(text);
                        const cleanMsg = discordMsg.trim();
                        // Only check skip on the extracted Discord message
                        if (sender && cleanMsg.length >= 2 && !shouldSkipContent(cleanMsg)) {
                          allMessages.push({
                            agent: agent,
                            role: 'user',
                            sender: sender,
                            content: cleanMsg,
                            timestamp: msg.timestamp || stats.mtimeMs
                          });
                        }
                      }
                    }
                  }

                } catch (e) {
                  // Skip parse errors
                }
              }

              // Track last read position after content processed successfully
              updatedPositions[fileKey] = {
                bytes: stats.size,
                timestamp: Date.now()
              };
            } catch (e) {
              // Skip unreadable files
            }
          }
        }
      }
    }

    // Save session positions for next run
    saveSessionPositions(updatedPositions);

    // Sort by timestamp (newest first)
    allMessages.sort((a, b) => b.timestamp - a.timestamp);

    // Get unique messages (dedupe by content + sender)
    const uniqueMessages = [];
    const seenKeys = new Set();
    for (const msg of allMessages) {
      // Create key from sender + first 50 chars of content
      const key = `${msg.sender}:${msg.content.slice(0, CONFIG.DEDUP_KEY_LENGTH)}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueMessages.push(msg);
      }
    }

    // Log the actual content
    let activitiesFound = 0;

    if (uniqueMessages.length > 0) {
      // Log the most recent meaningful messages
      const toLog = uniqueMessages.slice(0, CONFIG.MAX_MESSAGES_TO_LOG);

      for (const msg of toLog) {
        // Determine channel type
        let channelName = msg.agent;
        if (msg.agent === 'main') {
          channelName = '[MAIN]';
        } else {
          channelName = `[MSG]${msg.agent}`;
        }

        // Format: [sender: X] content
        const senderLabel = msg.sender !== 'Ally' ? `sender: ${msg.sender}] ` : '] ';
        const contentPreview = msg.content.replace(/\n/g, ' ').slice(0, CONFIG.MAX_CONTENT_PREVIEW);
        appendEntry(`${channelName}: [${senderLabel}${contentPreview}`, '*');
        activitiesFound++;
      }
    }

    // If no messages detected, log system check
    if (activitiesFound === 0) {
      appendEntry('[SYSTEM] - no new activity', '*');
      activitiesFound = 1;
    }

    if (!QUIET) console.log(`✅ Logged ${activitiesFound} message(s) from sessions`);

  } catch (e) {
    // Fallback: just log that we're checking
    if (!QUIET) console.error(`⚠️ autoDetectActivities error: ${e.message}`);
    appendEntry('[SYSTEM]', '*');
    if (!QUIET) console.log('✅ Logged system check (fallback)');
  }
}

// Main
const args = process.argv.slice(2);

// Parse args for --quiet first
if (args.includes('--quiet') || args.includes('-q')) {
  QUIET = true;
}

if (args.includes('--auto')) {
  // Auto-detect from sessions
  autoDetectActivities();
} else if (args.includes('--append') || args.includes('-a')) {
  // Append custom entry (handle marker flag before building entry to avoid greediness)
  const appendIndex = args.indexOf('--append') !== -1 ? args.indexOf('--append') : args.indexOf('-a');

  // Extract marker and its value before building entry
  const markerIndex = args.indexOf('--marker');
  let marker = '📝';
  if (markerIndex > appendIndex) {
    // marker comes after --append, extract it
    marker = args[markerIndex + 1] || '📝';
    // Build entry from everything between --append and --marker
    const entryParts = args.slice(appendIndex + 1, markerIndex);
    const entry = entryParts.join(' ');
    if (entry) {
      appendEntry(entry, marker);
    } else {
      if (!QUIET) console.log('❌ Please provide entry: --append "Your activity"');
    }
  } else {
    // No marker after append, entry is everything after --append
    const entry = args.slice(appendIndex + 1).join(' ');
    marker = markerIndex !== -1 ? args[markerIndex + 1] || '📝' : '📝';
    if (entry) {
      appendEntry(entry, marker);
    } else {
      if (!QUIET) console.log('❌ Please provide entry: --append "Your activity"');
    }
  }

} else if (args.includes('--help') || args.includes('-h')) {
  if (!QUIET) console.log(`
Daily Memory Logger
===================

Usage:
  node scripts/log_to_daily_memory.js --append "Activity description"
  node scripts/log_to_daily_memory.js --auto
  node scripts/log_to_daily_memory.js --help

Options:
  --append, -a    Append a specific entry
  --marker        Custom marker (default: 📝)
  --auto          Auto-detect from active sessions
  --quiet, -q     Suppress output
  --help, -h      Show this help

Examples:
  node scripts/log_to_daily_memory.js --append "⭐ Fixed memory_maintenance bug"
  node scripts/log_to_daily_memory.js --append "📝 Discussed backup strategy" --marker "📝"
  node scripts/log_to_daily_memory.js --auto
  `);
} else {
  // Default: show today's file
  const content = getOrCreateDayFile();
  if (!QUIET) {
    console.log(`\n📅 Today's Memory (${DATE}):\n`);
    console.log(content || '(No entries yet)');
  }
}
