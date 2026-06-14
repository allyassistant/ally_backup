#!/usr/bin/env node
/**
 * system_check_templates.js - System Check Report Templates
 * =========================================================
 * 定義 System Check 既所有 CONFIG、template structure、格式定義
 *
 * 職責：
 * - 定義 CONFIG 常量 (顏色、emoji、閾值)
 * - 定義 Report 結構
 * - 格式化函數
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-04-14)
 */

'use strict';

const path = require('path');
const os = require('os');

// ============================================================================
// CONFIG - All constants and magic numbers
// ============================================================================

const CONFIG = Object.freeze({
  MODULE_VERSION: '1.0.0',

  // Report metadata
  REPORT_NAME: 'System Check',
  REPORT_VERSION: '1.0.0',

  // Output formats
  VALID_FORMATS: Object.freeze(['discord', 'json', 'markdown', 'md']),

  // Embed colors
  COLORS: Object.freeze({
    OK: 0x00E000,        // Green
    WARNING: 0xFFAA00,     // Orange/Yellow
    ERROR: 0xE00000,       // Red
    DEFAULT: 0x0099FF      // Blue
  }),

  // Severity emojis
  EMOJI: Object.freeze({
    ok: '✅',
    warning: '⚠️',
    error: '❌',
    pending: '⏳',
    skipped: '⏭️',
    info: 'ℹ️',
    check: '🔍',
    tool: '🔧',
    issue: '📋',
    reminder: '🔔',
    progress: '📊',
    automation: '🤖',
    scripts: '📜',
    cron: '⏰',
    system: '💻',
    summary: '📊',
    success: '✅',
    fail: '❌',
    asterisk: '✳️'
  }),

  // Section emojis (按 category)
  CATEGORY_EMOJI: Object.freeze({
    '凌晨': '🌅',
    '與午': '🌞',
    '下午': '🌆',
    '深夜': '🌙'
  }),

  // Severity status icons
  STATUS_ICONS: Object.freeze({
    ok: '✅',
    error: '❌',
    skipped: '⏭️',
    pending: '⏳',
    unknown: '⏳'
  }),

  // === Display limits ===
  LIMITS: Object.freeze({
    MAX_DISPLAY_ISSUES: 8,
    MAX_DISPLAY_ERRORS: 5,
    MAX_DISPLAY_LARGE_FILES: 3,
    LARGE_FILE_THRESHOLD_KB: 500,
    MAX_DISPLAY_SCRIPTS: 8,
    COL_WIDTH: 44,
    FIELD_TRUNCATE_LIMIT: 1024,
    EMBED_TOTAL_LIMIT: 5900
  }),

  // === Date/Time helpers ===
  TIMEZONE: 'Asia/Hong_Kong',
  TIME_FORMAT: { hour: '2-digit', minute: '2-digit', hour12: false },

  // === Separator ===
  SEPARATOR: Object.freeze({
    name: '━━━━━━━━━━━━━━━━━━━━',
    value: '\u200b',
    inline: false
  }),

  // === Field names ===
  FIELD_NAMES: Object.freeze({
    ISSUES: 'Issues',
    CODE_QUALITY: 'Code Quality Manager',
    FIX_VERIFICATION: 'Fix Verification',
    SCRIPTS: 'Scripts',
    CRON: 'Cron',
    SUMMARY: 'Summary',
    SYSTEM: '系統'
  }),

  // === Timeout values (ms) ===
  ONE_YEAR_MS: 365 * 24 * 60 * 60 * 1000,
  ISSUE_FOLLOWUP_TIMEOUT: 30000,
  CPU_CHECK_TIMEOUT: 10000,
  DISK_CHECK_TIMEOUT: 5000,
  CRON_CHECK_TIMEOUT: 15000,
  CQM_SCAN_TIMEOUT: 120000,
  DISCORD_REQ_TIMEOUT: 15000,

  // === Discord Channel IDs ===
  DISCORD_SYSTEM_CHANNEL_ID: process.env.DISCORD_SYSTEM_CHANNEL_ID || '1473376125584670872'
});

// ============================================================================
// TEMPLATE STRUCTURE FUNCTIONS
// ============================================================================

/**
 * Create a standard System Check Report structure
 *
 * @param {Object} data - Report data
 * @param {string} data.date - Report date
 * @param {Object} data.summary - Summary statistics
 * @returns {Object} Report structure
 */
function createSystemCheckReportStructure(data = {}) {
  const date = data.date || getHKTDateString();

  return {
    version: CONFIG.REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    title: `🔧 系統檢查 - ${date}`,
    description: `📅 ${date.replace('-', '年').replace('-', '月')}日 每日系統健康報告`,

    // Summary
    summary: {
      issues: data.issues?.length || 0,
      errors: data.errors?.length || 0,
      codeQuality: data.codeQuality || { critical: 0, high: 0, medium: 0, low: 0 },
      scripts: data.scripts || { ok: 0, fail: 0 },
      cron: data.cron || { ok: 0, pending: 0, skipped: 0 },
      resources: data.resources || { cpu: 0, memory: 0, disk: 'N/A', load: 0 }
    },

    // Embed (Discord format)
    embed: createEmbedStructure(data)
  };
}

/**
 * Create Discord embed structure
 *
 * @param {Object} data - Report data
 * @returns {Object} Discord embed
 */
function createEmbedStructure(data = {}) {
  const date = data.date || getHKTDateString();
  const hasErrors = (data.errors?.length || 0) > 0;
  const now = new Date();
  const hktTime = now.toLocaleString('zh-HK', { timeZone: CONFIG.TIMEZONE, ...CONFIG.TIME_FORMAT });

  return {
    title: `🔧 系統檢查 - ${date}`,
    description: `📅 ${date.replace('-', '年').replace('-', '月')}日 每日系統健康報告`,
    color: hasErrors ? CONFIG.COLORS.ERROR : CONFIG.COLORS.OK,
    timestamp: new Date().toISOString(),
    fields: [],

    // Footer
    footer: {
      text: `🔧 系統檢查 | ${date} ${hktTime}`
    }
  };
}

/**
 * Create a section field for embed
 *
 * @param {string} name - Field name
 * @param {string|Array} value - Field value (string or array of lines)
 * @param {boolean} inline - Inline flag
 * @returns {Object} Field structure
 */
function createField(name, value, inline = false) {
  if (Array.isArray(value)) {
    value = value.join('\n');
  }

  return {
    name,
    value: truncateFieldValue(value, CONFIG.LIMITS.FIELD_TRUNCATE_LIMIT),
    inline
  };
}

/**
 * Create separator field
 *
 * @returns {Object} Separator field
 */
function createSeparator() {
  return { ...CONFIG.SEPARATOR };
}

// ============================================================================
// FORMATTER FUNCTIONS
// ============================================================================

/**
 * Truncate field value to Discord's 1024 character limit
 *
 * @param {string} value - Value to truncate
 * @param {number} limit - Character limit
 * @returns {string} Truncated value
 */
function truncateFieldValue(value, limit = CONFIG.LIMITS.FIELD_TRUNCATE_LIMIT) {
  if (!value || typeof value !== 'string') return '\u200b';
  if (value.length <= limit) return value;
  return value.slice(0, limit - 3) + '...';
}

/**
 * Enforce Discord embed total character limit
 *
 * @param {Object} embed - Discord embed object
 * @param {number} limit - Character limit
 * @returns {Object} Modified embed
 */
function enforceEmbedLimit(embed, limit = CONFIG.LIMITS.EMBED_TOTAL_LIMIT) {
  if (!embed || !embed.fields) return embed;

  const countChars = () => {
    let total = (embed.title || '').length + (embed.description || '').length;
    if (embed.footer && embed.footer.text) total += embed.footer.text.length;
    if (embed.author && embed.author.name) total += embed.author.name.length;
    for (const f of embed.fields) {
      total += (f.name || '').length + (f.value || '').length;
    }
    return total;
  };

  let total = countChars();
  if (total <= limit) return embed;

  // Truncate longest field values first
  const fields = embed.fields;
  while (total > limit && fields.length > 0) {
    let longestIdx = 0;
    let longestLen = 0;

    for (let i = 0; i < fields.length; i++) {
      const vLen = (fields[i].value || '').length;
      if (vLen > longestLen) {
        longestLen = vLen;
        longestIdx = i;
      }
    }

    if (longestLen <= 10) break;

    const excess = total - limit;
    const newLen = Math.max(10, longestLen - excess - 3);
    fields[longestIdx].value = fields[longestIdx].value.slice(0, newLen) + '...';
    total = countChars();
  }

  return embed;
}

// ============================================================================
// DATE/TIME FUNCTIONS
// ============================================================================

/**
 * Get HKT date string (local timezone)
 *
 * @param {Date} date - Optional date object
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getHKTDateString(date) {
  if (!date) date = new Date();
  return date.toLocaleDateString('sv-SE', { timeZone: CONFIG.TIMEZONE });
}

/**
 * Get HKT yesterday date string
 *
 * @returns {string} Yesterday date string in YYYY-MM-DD format
 */
function getHKTYesterday() {
  const todayHKT = getHKTDateString(new Date());
  const parts = todayHKT.split('-');
  const d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Get current time in HKT
 *
 * @returns {string} Time string in HH:MM format
 */
function getHKTTime() {
  const now = new Date();
  return now.toLocaleString('zh-HK', { timeZone: CONFIG.TIMEZONE, ...CONFIG.TIME_FORMAT });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get cron status icon by status
 *
 * @param {string} status - Status string
 * @returns {string} Icon emoji
 */
function getStatusIcon(status) {
  return CONFIG.STATUS_ICONS[status] || CONFIG.STATUS_ICONS.unknown;
}

/**
 * Get category emoji
 *
 * @param {string} category - Category name
 * @returns {string} Category emoji
 */
function getCategoryEmoji(category) {
  return CONFIG.CATEGORY_EMOJI[category] || '📅';
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  CONFIG,
  createSystemCheckReportStructure,
  createEmbedStructure,
  createField,
  createSeparator,
  truncateFieldValue,
  enforceEmbedLimit,
  getHKTDateString,
  getHKTYesterday,
  getHKTTime,
  getStatusIcon,
  getCategoryEmoji
};
