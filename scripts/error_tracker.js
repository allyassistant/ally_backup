#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// ==================== Error Tracker V4 ====================
// IMPROVED: Template-Engine Separation - list/stats use ErrorReportGenerator

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');


const { MEMORY_DIR, ERRORS_JSON, HOME, WS } = require('./lib/config');
const { getHKTDate } = require('./lib/time');
const LOG_DIR = path.join(WS, 'logs');
const HOME_DIR = HOME;
const SESSIONS_DIR = path.join(HOME, '.openclaw', 'agents', 'main', 'sessions');

// Template-Engine: Import ErrorReportGenerator
const { ErrorReportGenerator } = require('./error_generator');

// ==================== CONFIG (Magic Numbers) ====================
const CONFIG = {
  RECENT_ERROR_DAYS: 7,      // Show errors from last 7 days in "recent" queries
  ARCHIVE_THRESHOLD_DAYS: 30, // Auto-archive resolved errors older than 30 days
  MAX_ERRORS: 200,           // Cap errors.json at 200 entries
  // P2 Fix: Extract magic numbers to CONFIG
  MAX_LOG_LINES: 500,        // Max lines to scan from log files
  MAX_SESSION_FILES: 20,     // Max session files to scan
  MAX_SESSION_LINES: 100,    // Max lines to scan per session file
};

// ==================== AUTO RESOLVE RULES ====================
// Auto-resolve 根據 severity 等級：
//   Severity 1 → 7 天後 auto-resolve
//   Severity 2 → 14 天後 auto-resolve
//   Severity 3 → 30 天後 auto-resolve
//   Severity 4 → 30 天後 auto-resolve（同 severity 3）
// Severity 1 (🔴) 核心錯誤默認不resolve，但如有 days 設定則遵守

const AUTO_RESOLVE_RULES = {
  // Severity 1 (🔴) - 7天後resolve（核心錯誤，一般更長）
  'Auth Error': { resolve: true, days: 7 },
  'Permission Error': { resolve: true, days: 7 },
  'Permission Denied': { resolve: true, days: 7 },
  'Syntax Error': { resolve: true, days: 7 },
  'Reference Error': { resolve: true, days: 7 },
  'Module Error': { resolve: true, days: 7 },
  'Gateway Error': { resolve: true, days: 7 },
  'Memory Error': { resolve: true, days: 7 },
  'Python Module': { resolve: true, days: 7 },
  'File Not Found': { resolve: true, days: 7 },

  // Severity 2 (🟠) - 14天後resolve
  'Rate Limit': { resolve: true, days: 14, notify: true },
  'API Aborted': { resolve: true, days: 14 },
  'Kimi Error': { resolve: true, days: 14 },
  'MiniMax Error': { resolve: true, days: 14 },
  'Ollama Error': { resolve: true, days: 14 },
  'Discord Error': { resolve: true, days: 14 },
  'WhatsApp Error': { resolve: true, days: 14 },
  'Connection Error': { resolve: true, days: 14 },

  // Severity 3 (🟡) - 30天後resolve
  'File Error': { resolve: true, days: 30 },
  'Import Error': { resolve: true, days: 30 },
  'DNS Error': { resolve: true, days: 30 },
  'Network Error': { resolve: true, days: 30 },
  'Timeout Error': { resolve: true, days: 30 },
  'Type Error': { resolve: true, days: 30 },
  'Cron Timeout': { resolve: true, days: 30 },
  'Cron Error': { resolve: true, days: 14, notify: true },
};

// ==================== COMPREHENSIVE ERROR PATTERNS ====================
const ERROR_PATTERNS = [
  // === API / Authentication Errors ===
  { pattern: /401.*authentication/i, type: 'Auth Error', severity: 1, extract: /401.*?(authentication|api key|invalid)/i },
  { pattern: /invalid.*api.*key/i, type: 'Auth Error', severity: 1, extract: /invalid api key/i },
  { pattern: /API.*rate.*limit/i, type: 'Rate Limit', severity: 2, extract: /API.*rate.*limit/i },
  { pattern: /rate.*limit.*exceeded/i, type: 'Rate Limit', severity: 2, extract: /rate limit.*exceeded/i },
  { pattern: /403.*forbidden/i, type: 'Permission Error', severity: 2, extract: /403.*?forbidden/i },
  { pattern: /(HTTP|status|code)[\s:]*429|\b429\b.*(?:rate|limit|too many|throttl)/i, type: 'Rate Limit', severity: 2, extract: /429.*?(?:too many|rate|limit|throttl)/i },

  // === Network Errors ===
  { pattern: /ECONNREFUSED/i, type: 'Connection Error', severity: 2, extract: /ECONNREFUSED.*?(\d+\.\d+\.\d+\.\d+)/i },
  { pattern: /ENOTFOUND/i, type: 'DNS Error', severity: 3, extract: /ENOTFOUND.*?([^"\s]+)/i },
  { pattern: /EAI_AGAIN/i, type: 'Network Error', severity: 3, extract: /EAI_AGAIN/i },
  { pattern: /ETIMEDOUT/i, type: 'Timeout Error', severity: 3, extract: /ETIMEDOUT/i },
  { pattern: /connection.*timeout/i, type: 'Timeout Error', severity: 3, extract: /connection timeout/i },

  // === File System Errors ===
  { pattern: /ENOENT.*no.*such.*file/i, type: 'File Not Found', severity: 3, extract: /no such file.*?['"]([^'"]+)['"]/i },
  { pattern: /ENOENT/i, type: 'File Error', severity: 4, extract: /ENOENT.*?(['"][^'"]+['"])/i },
  { pattern: /EACCES/i, type: 'Permission Denied', severity: 2, extract: /EACCES.*?permission/i },

  // === JavaScript Errors ===
  { pattern: /SyntaxError:/i, type: 'Syntax Error', severity: 1, extract: /SyntaxError:.*/i },
  { pattern: /ReferenceError:/i, type: 'Reference Error', severity: 2, extract: /ReferenceError:.*/i },
  { pattern: /TypeError:/i, type: 'Type Error', severity: 3, extract: /TypeError:.*/i },
  { pattern: /Cannot find module/i, type: 'Module Error', severity: 2, extract: /Cannot find module ['"]([^'"]+)['"]/i },

  // === Service Specific Errors ===
  { pattern: /errorMessage.*aborted/i, type: 'API Aborted', severity: 3, extract: /errorMessage["']?\s*[:=]\s*["']?([^"'}]+)/i },
  { pattern: /MiniMax.*error/i, type: 'MiniMax Error', severity: 2, extract: /MiniMax.*?error/i },
  { pattern: /Kimi.*error/i, type: 'Kimi Error', severity: 2, extract: /Kimi.*?error/i },
  { pattern: /Ollama.*error/i, type: 'Ollama Error', severity: 3, extract: /Ollama.*?error/i },
  { pattern: /Discord.*error/i, type: 'Discord Error', severity: 2, extract: /Discord.*?error/i },
  { pattern: /WhatsApp.*error/i, type: 'WhatsApp Error', severity: 2, extract: /WhatsApp.*?error/i },

  // === Cron/Job Errors ===
  { pattern: /job.*timed.*out/i, type: 'Cron Timeout', severity: 3, extract: /job.*timed.*out/i },
  { pattern: /cron.*timeout/i, type: 'Cron Timeout', severity: 3, extract: /cron timeout/i },

  // === System Errors ===
  { pattern: /gateway.*closed/i, type: 'Gateway Error', severity: 1, extract: /gateway closed/i },
  { pattern: /out of memory|OOM/i, type: 'Memory Error', severity: 1, extract: /out of memory|OOM/i },

  // === Python Errors ===
  { pattern: /No module named/i, type: 'Python Module', severity: 2, extract: /No module named ['"]([^'"]+)['"]/i },
  { pattern: /ImportError:/i, type: 'Import Error', severity: 3, extract: /ImportError:.*/i },
];


function loadErrors() {
  try {
    let exists;
    try {
      exists = fs.existsSync(ERRORS_JSON);
    } catch (e) {
      console.error('⚠️ existsSync failed: ' + e.message);
      exists = false;
    }
    if (!exists) {
      return { schema: 'openclaw.errors.v1', metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), totalErrors: 0 }, errors: [] };
    }
    let data;
    try {
      data = fs.readFileSync(ERRORS_JSON, 'utf-8');
    } catch (e) {
      console.error('⚠️ File read failed: ' + e.message);
      return { schema: 'openclaw.errors.v1', metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), totalErrors: 0 }, errors: [] };
    }
    return JSON.parse(data);
  } catch (err) {
    console.error(`⚠️ Failed to load/parse errors.json: ${err.message}`);
    return { schema: 'openclaw.errors.v1', metadata: { createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), totalErrors: 0 }, errors: [] };
  }
}

const LOCK_FILE = ERRORS_JSON + '.lock';
const LOCK_TIMEOUT_MS = 10000; // 10 seconds max wait

// Simple file lock using lock file
async function acquireLock() {
  const startTime = Date.now();
  while (fs.existsSync(LOCK_FILE)) {
    if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
      throw new Error('Timeout waiting for errors.json lock');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: Date.now() }), 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (err) {
    console.error('⚠️ Failed to release lock:', err.message);
  }
}

async function saveErrors(data) {
  await acquireLock();
  try {
    const tmpFile = ERRORS_JSON + '.tmp';
    if (!data.metadata) data.metadata = {};
    data.metadata.lastUpdated = new Date().toISOString();
    data.metadata.totalErrors = data.errors.length;

    // ── Backup errors.json before writing (保留最近 5 個備份) ──
    let BACKUP_DIR;
    try {
      BACKUP_DIR = path.join(MEMORY_DIR, 'errors_backups');
    } catch (e) {
      console.error(`⚠️ Failed to create backup dir path: ${e.message}`);
      BACKUP_DIR = null;
    }
    const MAX_BACKUPS = 5;
    const backupPattern = /^errors\.json\.bak\.\d{8}_\d{4}$/;

    if (BACKUP_DIR) {
      try {
        // Ensure backup directory exists
        let backupDirExists;
        try {
          backupDirExists = fs.existsSync(BACKUP_DIR);
        } catch (e) {
          console.error('⚠️ existsSync failed: ' + e.message);
          backupDirExists = false;
        }
        if (!backupDirExists) {
          try {
            fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o755 });
          } catch (e) {
            if (e.code !== 'EEXIST') {
              console.error('⚠️ mkdir failed: ' + e.message);
              return;
            }
            // EEXIST is okay, directory already exists
          }
        }

        // Create timestamped backup
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const timeStr = now.toISOString().slice(11, 16).replace(':', '');
        const backupFile = path.join(BACKUP_DIR, `errors.json.bak.${dateStr}_${timeStr}`);

        // Only backup if source errors.json exists
        let errorsJsonExists;
        try {
          errorsJsonExists = fs.existsSync(ERRORS_JSON);
        } catch (e) {
          console.error('⚠️ existsSync failed: ' + e.message);
          errorsJsonExists = false;
        }
        if (errorsJsonExists) {
          try {
            fs.copyFileSync(ERRORS_JSON, backupFile);
          } catch (e) {
            console.error('⚠️ copyFile failed: ' + e.message);
            return;
          }
          log(`📦 errors.json backup created: errors.json.bak.${dateStr}_${timeStr}`);

          // Keep only the 5 most recent backups (delete older ones)
          let backups;
          try {
            backups = fs.readdirSync(BACKUP_DIR)
              .filter(f => backupPattern.test(f))
              .sort()
              .reverse(); // newest first
          } catch (e) {
            console.error('⚠️ readdir failed: ' + e.message);
            backups = [];
          }

          if (backups.length > MAX_BACKUPS) {
            const toDelete = backups.slice(MAX_BACKUPS); // 6th, 7th, ... oldest
            for (const oldBackup of toDelete) {
              try {
                const oldBackupPath = path.join(BACKUP_DIR, oldBackup);
                fs.unlinkSync(oldBackupPath);
                log(`🗑️ Cleaned old errors backup: ${oldBackup}`);
              } catch (e) {
                // ignore cleanup errors
              }
            }
          }
        }
      } catch (e) {
        log(`⚠️ errors.json backup failed (non-fatal): ${e.message}`);
        // Non-fatal: continue with save even if backup fails
      }
    }

    // ── Atomic write: write to temp file then rename (async) ──
    try {
      await fsPromises.writeFile(tmpFile, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('⚠️ File write failed: ' + e.message);
      return;
    }
    try {
      await fsPromises.rename(tmpFile, ERRORS_JSON);
    } catch (e) {
      console.error('⚠️ rename failed: ' + e.message);
      return;
    }
  } catch (err) {
    console.error(`❌ saveErrors failed: ${err.message}`);
    // 清理殘留 tmp 檔案（如果存在）
    try {
      let tmpExists;
      try {
        tmpExists = fs.existsSync(tmpFile);
      } catch (e) {
        tmpExists = false;
      }
      if (tmpExists) {
        fs.unlinkSync(tmpFile);
      }
    } catch (_) { /* ignore cleanup errors */ }
  } finally {
    releaseLock();
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function shouldIgnoreLine(line) {
  if (!line || line.trim().length < 15) return true;
  if (line.includes('"thinking"') && !line.includes('error')) return true;
  if (line.includes('"content":[') && !line.includes('error')) return true;
  return false;
}

function extractCleanMessage(line, patternObj) {
  // P1-6 Fix: Return message consistent with matched pattern type
  // Previously global fallback (e.g. line.includes('401')) would override
  // the matched pattern, causing type="Rate Limit" + problem="401 Unauthorized"

  if (!patternObj) {
    // No pattern matched — use generic line-level detection
    // Medium Fix: Strengthen fallback to avoid false positives from comments/non-error lines
    const trimmed = line.trim();
    // Skip lines that are too short or look like non-error content
    if (trimmed.length < 10) return 'Error';
    // Skip obvious non-error patterns
    if (/^(?:info|debug|verbose|trace|---|\*|#|\/\/)/i.test(trimmed)) return 'Error';
    // Only match actual error indicators (status codes in error context)
    if (/status.*(?:401|403|429)\b|error.*(?:401|403|429)\b|401.*(?:unauthorized|auth)|403.*(?:forbidden|denied)|429.*(?:rate|limit|too many)/i.test(trimmed)) {
      if (trimmed.includes('401')) return '401 Unauthorized';
      if (trimmed.includes('403')) return '403 Forbidden';
      if (trimmed.includes('429')) return '429 Too Many Requests';
    }
    if (/aborted|timeout|cancelled|failed/i.test(trimmed)) {
      if (trimmed.includes('"aborted"')) return 'Request aborted';
      if (trimmed.includes('"timeout"')) return 'Timeout';
    }
    return 'Error';
  }

  // Pattern matched — return message appropriate to the pattern type
  const type = patternObj.type;

  switch (type) {
    case 'Auth Error':
      if (line.includes('401')) return '401 Authentication failed';
      if (line.includes('invalid')) return 'Invalid API key';
      return 'Authentication error';
    case 'Permission Error':
      if (line.includes('403')) return '403 Forbidden';
      return 'Permission denied';
    case 'Permission Denied':
      return 'EACCES permission denied';
    case 'Rate Limit':
      if (line.includes('429')) return '429 Too Many Requests';
      return 'Rate limit exceeded';
    case 'Connection Error':
      return 'Connection refused (ECONNREFUSED)';
    case 'DNS Error':
      return 'DNS lookup failed (ENOTFOUND)';
    case 'Network Error':
      return 'Network error (EAI_AGAIN)';
    case 'Timeout Error':
      return 'Connection timeout';
    case 'File Not Found':
      return 'File not found (ENOENT)';
    case 'File Error':
      return 'File system error';
    case 'Syntax Error':
    case 'Reference Error':
    case 'Type Error':
    case 'Module Error':
    case 'Import Error':
    case 'Python Module':
      // For code errors, try to extract the actual message from the line
      if (patternObj.extract) {
        const match = line.match(patternObj.extract);
        if (match) return match[0].slice(0, 80);
      }
      return type;
    case 'API Aborted':
      return 'Request aborted';
    case 'Cron Timeout':
      return 'Cron job timed out';
    case 'Gateway Error':
      return 'Gateway closed';
    case 'Memory Error':
      return 'Out of memory';
    case 'Ollama Error':
      // Ollama-specific: check for auth vs generic error
      if (line.includes('401')) return 'Ollama 401 - check API key';
      return 'Ollama service error';
    case 'MiniMax Error':
      return 'MiniMax API error';
    case 'Kimi Error':
      return 'Kimi API error';
    case 'Discord Error':
      return 'Discord delivery error';
    case 'WhatsApp Error':
      return 'WhatsApp delivery error';
    default:
      return type;
  }
}

function findErrorInLine(line) {
  for (const p of ERROR_PATTERNS) {
    try {
      if (p.pattern.test(line)) {
        return {
          type: p.type,
          severity: p.severity,
          title: p.type,
          problem: extractCleanMessage(line, p)
        };
      }
    } catch (e) {
      // Skip invalid patterns
      continue;
    }
  }
  return null;
}

function extractSourceFromLine(line) {
  // Try to find session ID or cron job name
  const sessionMatch = line.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
  if (sessionMatch) return `session:${sessionMatch[0].slice(0, 8)}`;

  return 'system';
}

function scanLogsForErrors() {
  const errorsFound = [];
  const logFile = path.join(LOG_DIR, 'system.log');

  try {
    let logFileExists;
    try {
      logFileExists = fs.existsSync(logFile);
    } catch (e) {
      console.error('⚠️ existsSync failed: ' + e.message);
      return errorsFound;
    }
    if (logFileExists) {
      let content;
      try {
        content = fs.readFileSync(logFile, 'utf-8');
      } catch (e) {
        console.error('⚠️ readFileSync failed: ' + e.message);
        return errorsFound;
      }
      const lines = content.split('\n').slice(-CONFIG.MAX_LOG_LINES);

      for (const line of lines) {
        if (shouldIgnoreLine(line)) continue;

        const error = findErrorInLine(line);
        if (error) {
          error.source = extractSourceFromLine(line);
          error.tags = ['auto-detected', 'log', getHKTDate()];
          errorsFound.push(error);
        }
      }
    }
  } catch (e) {
    // Error reading log file, ignore and continue
  }

  return errorsFound;
}

function scanSessionsForErrors() {
  const errorsFound = [];

  let sessionsDirExists;
  try {
    sessionsDirExists = fs.existsSync(SESSIONS_DIR);
  } catch (e) {
    console.error('⚠️ existsSync failed: ' + e.message);
    sessionsDirExists = false;
  }
  if (!sessionsDirExists) return errorsFound;

  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl')).slice(-CONFIG.MAX_SESSION_FILES);
  } catch (e) {
    console.error('⚠️ readdir failed: ' + e.message);
    return [];
  }

  for (const file of files) {
    try {
      const filePath = path.join(SESSIONS_DIR, file);
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        console.error('⚠️ readFileSync failed: ' + e.message);
        continue;
      }
      const lines = content.split('\n').slice(-CONFIG.MAX_SESSION_LINES);

      for (const line of lines) {
        if (shouldIgnoreLine(line)) continue;

        const error = findErrorInLine(line);
        if (error) {
          error.source = `session:${file.slice(0, 8)}`;
          error.tags = ['auto-detected', 'session', getHKTDate()];
          errorsFound.push(error);
        }
      }
    } catch (e) {
      // Error reading session file, skip and continue
    }
  }

  return errorsFound;
}

/**
 * P1-8: Archive/remove resolved errors older than 30 days
 * Keeps errors.json lean for better read performance
 */
function archiveOldResolved(data) {
  const thirtyDaysAgo = Date.now() - (CONFIG.ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const before = data.errors.length;

  data.errors = data.errors.filter(e => {
    // Keep all unresolved errors
    if (!e.resolved) return true;
    // Keep resolved errors younger than 30 days
    const ts = new Date(e.resolvedAt || e.timestamp).getTime();
    return ts > thirtyDaysAgo;
  });

  const removed = before - data.errors.length;
  if (removed > 0) {
    log(`🗑️ Archived ${removed} resolved error(s) older than 30 days`);
  }
}

async function addError(error) {
  const data = loadErrors();
  const today = getHKTDate();

  // Check for duplicate by title + problem hash (cross-day dedup)
  const problemKey = (error.problem || '').slice(0, 50);
  const errorHash = `${error.title}-${problemKey}`;
  
  // Look for existing error within last 7 days (not just today)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const existing = data.errors.find(e =>
    !e.resolved &&
    new Date(e.timestamp).getTime() > sevenDaysAgo &&
    e.title === error.title &&
    (e.problem || '').slice(0, 50) === problemKey
  );

  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastSeen = new Date().toISOString();
    log(`⚠️ Duplicate (cross-day), count: ${existing.count}`);
  } else {
    data.errors.unshift({
      id: generateId(),
      date: today,
      timestamp: new Date().toISOString(),
      ...error,
      count: 1,
      resolved: false
    });
    log(`✅ Added: ${error.type} - ${error.problem?.slice(0, 40)}`);
  }

  // P1-8: Archive resolved errors older than 30 days, then enforce cap
  archiveOldResolved(data);

  // Keep only last 200 errors (increased from 50 to prevent data loss)
  if (data.errors.length > CONFIG.MAX_ERRORS) {
    data.errors = data.errors.slice(0, CONFIG.MAX_ERRORS);
  }

  await saveErrors(data);
}

function getDaysDiff(timestamp) {
  const errorDate = new Date(timestamp);
  // P1 Fix: Validate date
  if (isNaN(errorDate.getTime())) {
    return 0; // Invalid date, assume today (0 days diff)
  }
  const now = new Date();
  const diffTime = now - errorDate;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

async function autoResolve() {
  const data = loadErrors();
  const unresolved = data.errors.filter(e => !e.resolved);

  if (unresolved.length === 0) {
    return;
  }

  let resolvedCount = 0;
  const notifications = [];

  for (const error of unresolved) {
    const rule = AUTO_RESOLVE_RULES[error.type];

    // 如果冇 rule 或者 resolve = false，跳過
    if (!rule || rule.resolve === false) {
      continue;
    }

    // 檢查日子
    const daysOld = getDaysDiff(error.timestamp);
    const thresholdDays = rule.days || 1;

    // Severity 4 視為 Severity 3 處理
    const effectiveSeverity = error.severity === 4 ? 3 : error.severity;

    if (daysOld >= thresholdDays) {
      // 標記為已resolve
      error.resolved = true;
      error.resolvedAt = new Date().toISOString();
      error.resolvedBy = 'auto-resolve';
      resolvedCount++;

      // 如果需要通知
      if (rule.notify) {
        notifications.push(`✅ Auto-resolved: [${error.type}] ${error.title} (${daysOld} days old)`);
      }
    }
  }

  if (resolvedCount > 0) {
    await saveErrors(data);
    log(`\n🧹 Auto-resolved ${resolvedCount} error(s)`);

    // 顯示通知
    if (notifications.length > 0) {
      log('\n📢 Notifications:');
      notifications.forEach(n => log(`   ${n}`));
    }
  }

  return resolvedCount;
}

/**
 * Check all active OpenClaw cron jobs for failures.
 * Queries openclaw cron list --json and records any jobs with errors
 * in the error tracking system.
 */
async function checkCronStatus() {
  log('\n🕐 Checking cron job status...');
  const { execSync } = require('child_process');

  let jobs = [];
  try {
    const stdout = execSync('openclaw cron list --json 2>/dev/null', {
      timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 50
    });
    const parsed = JSON.parse(stdout);
    jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || []);
  } catch (e) {
    log(`⚠️ Could not query cron status: ${e.message}`);
    return;
  }

  const failed = jobs.filter(j => {
    const state = j.state || {};
    return state.lastRunStatus === 'error' || (state.consecutiveErrors || 0) > 0;
  });

  if (failed.length === 0) {
    log('✅ All cron jobs OK');
    return;
  }

  log(`⚠️ Found ${failed.length} failed cron job(s):`);
  for (const j of failed) {
    const state = j.state || {};
    const name = j.name || 'unknown';
    const errCount = state.consecutiveErrors || 0;
    const errMsg = state.lastError || 'Unknown error';
    const lastRun = state.lastRunAtMs ? new Date(state.lastRunAtMs).toISOString() : 'unknown';
    const detail = `[${lastRun}] ${errMsg.slice(0, 200)}`;

    log(`  🔴 ${name}: ${errCount} error(s) — ${errMsg.slice(0, 100)}`);

    await addError({
      type: 'Cron Error',
      severity: errCount > 3 ? 1 : 2,
      title: `Cron job failed: ${name}`,
      problem: detail,
      source: 'cron',
      tags: ['cron', name.toLowerCase().replace(/[^a-z0-9]/g, '-'), getHKTDate()]
    });
  }

  log('✅ Cron check complete');
}

async function scan() {
  log('🔍 Scanning for errors...\n');

  const cronErrors = await checkCronStatus();
  const logErrors = scanLogsForErrors();
  const sessionErrors = scanSessionsForErrors();
  const allErrors = [...logErrors, ...sessionErrors];

  log(`📊 Found: ${logErrors.length} log, ${sessionErrors.length} session errors`);

  // Deduplicate by title + problem
  const unique = [];
  const seen = new Set();
  for (const e of allErrors) {
    const key = `${e.title}-${(e.problem || '').slice(0, 20)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  log(`📝 Adding ${unique.length} unique errors...\n`);
  for (const e of unique) {
    await addError(e);
  }

  // 運行 auto-resolve
  log('\n🔄 Running auto-resolve...');
  try {
    await autoResolve();
  } catch (err) {
    log(`⚠️ Auto-resolve error: ${err.message}`);
  }

  // NOTE: archiveOldResolved + cap 50 already run inside each addError() call above,
  // so we don't repeat them here. autoResolve() also saves after resolving.

  log('\n✅ Scan complete');
}

async function list() {
  const data = loadErrors();

  // Template-Engine: Use ErrorReportGenerator for output
  const generator = new ErrorReportGenerator({ maxItemsPerSection: 10, maxProblemLength: 50 });

  // Sort errors by severity, then by date
  const sortedErrors = [...data.errors].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    if (a.severity !== b.severity) return a.severity - b.severity;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  const report = generator.generate({ errors: sortedErrors }, getHKTDate());
  log(generator.toMarkdown(report));

  // Additional stats at bottom
  const activeCount = data.errors.filter(e => !e.resolved).length;
  const resolvedCount = data.errors.filter(e => e.resolved).length;
  log(`\n📊 Summary: ${activeCount} active, ${resolvedCount} resolved`);
}

async function stats() {
  const data = loadErrors();
  const today = getHKTDate();

  // Template-Engine: Use ErrorReportGenerator for stats
  const generator = new ErrorReportGenerator();
  const report = generator.generate({ errors: data.errors }, today);
  const stats = generator.getStats(report);

  log('📊 Error Statistics:');
  log(`   Total errors: ${stats.total}`);
  log(`   Active (unresolved): ${stats.active}`);
  log(`   Resolved: ${stats.resolved}`);
  log(`   Today: ${data.errors.filter(e => e.date === today).length}`);

  // By severity
  log('\n📈 Active Errors by Severity:');
  log(`   🔴 Critical: ${stats.critical || 0}`);
  log(`   🟠 Warning: ${stats.warning || 0}`);
  log(`   🟡 Info: ${stats.info || 0}`);

  // By type (active only)
  const byType = {};
  data.errors.filter(e => !e.resolved).slice(0, 50).forEach(e => {
    byType[e.type] = (byType[e.type] || 0) + 1;
  });

  if (Object.keys(byType).length > 0) {
    log('\n📈 Active Errors by Type:');
    Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      log(`   ${type}: ${count}`);
    });
  }

  // Auto-resolve 統計
  const autoResolved = data.errors.filter(e => e.resolvedBy === 'auto-resolve').length;
  if (autoResolved > 0) {
    log(`\n🧹 Auto-resolved: ${autoResolved} errors`);
  }
}

async function cmdAdd() {
  const args = process.argv.slice(3);
  let title = '', problem = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title' && args[i + 1]) {
      title = args[++i];
    } else if (args[i] === '--problem' && args[i + 1]) {
      problem = args[++i];
    }
  }

  if (!title) {
    log('Usage: node error_tracker.js add --title "Error Title" --problem "Description"');
    return;
  }

  await addError({
    type: 'Manual',
    severity: 2,
    title: title,
    problem: problem || title,
    source: 'manual',
    tags: ['manual', getHKTDate()]
  });
}

const cmd = process.argv[2] || 'scan';
if (cmd === 'scan') scan().catch(err => console.error('❌ Scan failed:', err.message));
else if (cmd === 'list') list();
else if (cmd === 'stats') stats();
else if (cmd === 'add') cmdAdd().catch(err => console.error('❌ Add failed:', err.message));
else if (cmd === 'check-crons') checkCronStatus().catch(err => console.error('❌ Cron check failed:', err.message));
else log('Usage: node error_tracker.js [scan|list|stats|add|check-crons]');
