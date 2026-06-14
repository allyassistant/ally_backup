#!/usr/bin/env node
/**
 * weekly_correction_templates.js - Weekly Correction Loop Templates
 * ================================================================
 * 只定義 Weekly Correction Report 嘅數據結構
 *
 * 職責：
 * - 定義 CONFIG 常量
 * - 定義 Report 結構
 * - Severity/CATEGORY 分類
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-04-09)
 */

'use strict';

const { getHKTDate, getHKTDateTime } = require('./lib/time');

// ============================================================================
// CONFIG - All constants and magic numbers
// ============================================================================

const CONFIG = Object.freeze({
  MODULE_VERSION: '1.0.0',

  // Report metadata
  REPORT_VERSION: '1.0.0',
  REPORT_NAME: 'Weekly Correction Loop',

  // Error analysis
  RECENT_ERRORS_DAYS: 7,
  MIN_OCCURRENCES_AUTO_ADD: 3,
  MAX_PROCESSED_ERRORS: 100,
  FALLBACK_DAYS: 8,

  // Report formatting
  TRUNCATE_LIMIT: 1024,
  EMBED_LIMIT: 5900,
  RULE_PREVIEW_LENGTH: 60,

  // Backup retention
  MAX_BACKUPS: 7,

  // Discord
  DISCORD_CHANNEL_ID: process.env.DISCORD_SYSTEM_CHANNEL_ID || '1473376125584670872',

  // Output formats
  VALID_FORMATS: Object.freeze([
    'json',
    'markdown',
    'md',
    'discord',
    'simple'
  ]),

  // Severity levels
  SEVERITY_ORDER: ['critical', 'high', 'medium', 'low'],

  // Severity emojis
  SEVERITY_EMOJI: Object.freeze({
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢'
  }),

  // Severity colors (Discord embed colors)
  SEVERITY_COLORS: Object.freeze({
    critical: 0xFF0000,
    high: 0xFF8800,
    medium: 0xFFDD00,
    low: 0x00FF00
  }),

  // Report titles
  TITLES: Object.freeze({
    WEEKLY_REPORT: '🔄 **每週校正循環報告** | {date}',
    SECTION_ERRORS: '📊 本週錯誤概覽',
    SECTION_TOP_PATTERNS: '🔴 本週主要問題 (Top 3)',
    SECTION_TRENDS: '📈 趨勢分析',
    SECTION_AUDIT: '🔍 Pure AI Audit',
    SECTION_AUTO_FIX: '🛠️ 自動修復',
    SECTION_RECOMMENDATIONS: '💡 下週行動建議'
  }),

  // AI Error categories
  AI_CATEGORIES: Object.freeze({
    timeout: 'Timeout',
    file: 'File System',
    json: 'JSON/Parse',
    memory: 'Memory',
    network: 'Network',
    permission: 'Permission/Auth',
    syntax: 'Code Syntax/Runtime',
    process: 'Process/Concurrency',
    resource: 'Resource Exhaustion',
    external: 'External Service',
    cron: 'Cron/Schedule',
    ha: 'HA/Sync',
    data: 'Data/Storage',
    shell: 'Shell/Script',
    unknown: 'Unknown'
  }),

  // Target categories for audit
  AUDIT_TARGET_CATEGORIES: Object.freeze([
    'execSync_missing_trycatch',
    'magic_numbers'
  ]),

  AUDIT_TARGET_SEVERITIES: Object.freeze([
    'critical',
    'high'
  ]),

  // CLI display
  CLI_MAX_PATTERNS: 3,
  CLI_MAX_TRENDS: 3
});

// ============================================================================
// TEMPLATE STRUCTURE FUNCTIONS
// ============================================================================

/**
 * Create a standard Weekly Correction Report structure
 *
 * @param {Object} data - Report data
 * @returns {Object} Report structure
 */
function createWeeklyCorrectionReportStructure(data = {}) {
  const date = data.date || getHKTDate();

  return {
    version: CONFIG.REPORT_VERSION,
    generatedAt: getHKTDateTime(),
    title: CONFIG.TITLES.WEEKLY_REPORT.replace('{date}', date),

    // Summary statistics
    summary: {
      totalErrors: data.totalErrors || 0,
      patternCount: data.patternCount || 0,
      categorizedCount: data.categorizedCount || 0,
      trendChange: data.trendChange || 0,
      lastWeekTotal: data.lastWeekTotal || 0,
      newRulesCount: data.newRulesCount || 0,
      auditRulesCount: data.auditRulesCount || 0
    },

    // Error patterns
    patterns: data.patterns || [],

    // Top patterns
    topPatterns: data.topPatterns || [],

    // Trend analysis
    trendAnalysis: data.trendAnalysis || [],

    // Audit findings
    audit: {
      changed: data.auditChanged || false,
      p0Count: data.p0Count || 0,
      p1Count: data.p1Count || 0,
      lastReportDate: data.lastAuditReportDate || null
    },

    // Auto-applied rules
    autoAppliedRules: data.autoAppliedRules || [],

    // AI categorized errors
    categorizedErrors: data.categorizedErrors || {},

    // Recommendations
    recommendations: data.recommendations || [],

    // Metadata
    metadata: {
      date,
      reportVersion: CONFIG.REPORT_VERSION,
      moduleVersion: CONFIG.MODULE_VERSION,
      ...data.metadata
    }
  };
}

/**
 * Create a section for the report
 *
 * @param {string} name - Section name
 * @param {string} emoji - Section emoji
 * @param {Array} items - Items in this section
 * @returns {Object} Section structure
 */
function createSection(name, emoji, items = []) {
  return {
    name: `${emoji} ${name}`,
    emoji,
    items,
    count: items.length
  };
}

/**
 * Create trend analysis item
 *
 * @param {string} type - Error type
 * @param {number} change - Change count
 * @param {string} direction - 'up', 'down', 'new'
 * @returns {Object} Trend item
 */
function createTrendItem(type, change, direction) {
  return {
    type,
    change,
    direction,
    emoji: direction === 'new' ? '🆕' : (direction === 'up' ? '↑' : '↓'),
    label: direction === 'new' ? `新增 ${change}x` :
           direction === 'up' ? `+${change}x` : `-${change}x`
  };
}

/**
 * Create top pattern item
 *
 * @param {string} pattern - Pattern key
 * @param {number} count - Occurrence count
 * @param {number} lastCount - Last week count
 * @returns {Object} Pattern item
 */
function createTopPatternItem(pattern, count, lastCount = 0) {
  const diff = count - lastCount;
  return {
    pattern,
    count,
    lastCount,
    diff,
    diffArrow: diff > 0 ? '↑' : (diff < 0 ? '↓' : '→')
  };
}

/**
 * Create recommendation item
 *
 * @param {string} type - Recommendation type
 * @param {string} message - Recommendation message
 * @returns {Object} Recommendation item
 */
function createRecommendation(type, message) {
  const emoji = {
    critical: '⚠️',
    warning: '📊',
    success: '🎉',
    info: 'ℹ️'
  }[type] || 'ℹ️';

  return {
    type,
    emoji,
    message
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // CONFIG
  CONFIG,

  // Template functions
  createWeeklyCorrectionReportStructure,
  createSection,
  createTrendItem,
  createTopPatternItem,
  createRecommendation,

  // Constants (re-exported for convenience)
  SEVERITY_ORDER: CONFIG.SEVERITY_ORDER,
  SEVERITY_EMOJI: CONFIG.SEVERITY_EMOJI,
  SEVERITY_COLORS: CONFIG.SEVERITY_COLORS,
  AI_CATEGORIES: CONFIG.AI_CATEGORIES,
  VALID_FORMATS: CONFIG.VALID_FORMATS
};
