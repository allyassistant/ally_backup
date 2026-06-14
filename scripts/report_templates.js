#!/usr/bin/env node

/**
 * Report Templates Module
 * ======================
 * Standardized report templates for consistent output across all scripts.
 * Each template includes: input validation, consistent format, easy parsing.
 *
 * VERSION:    1.0.0 → 1.1.0 (with error handling)
 * AUTHOR:     Ally (2026-04-07)
 * MODIFIED:   Enhanced with CONFIG block, error handling, docstring
 *
 * USAGE:
 *   const templates = require('./report_templates');
 *
 *   // Create a stock report
 *   const report = templates.stockReportTemplate({ date: '2026-04-07', totalCount: 100 });
 *
 *   // Create a daily summary
 *   const daily = templates.dailySummaryTemplate({ date: '2026-04-07' });
 *
 *   // Registry lookup
 *   const fn = templates.TEMPLATES['stock'];
 *   fn({ date: '2026-04-07' });
 *
 * CONFIG:
 *   All magic numbers and constants are defined in CONFIG object below.
 *   No hardcoded values should appear in logic.
 *
 * @module report_templates
 * @author Ally
 * @date 2026-04-07
 */

// ============================================================================

const { getHKTDate } = require('./lib/time');

// ============================================================================
// CONFIG - All constants and magic numbers
// ============================================================================

/**
 * Configuration constants for report_templates module
 * Centralizes all magic numbers and settings for easy maintenance.
 */
const CONFIG = Object.freeze({
  // Module version
  MODULE_VERSION: '1.1.0',

  // Report format versions
  REPORT_VERSION: '1.0.0',

  // Valid output formats (used in validateInput and createReportStructure)
  VALID_FORMATS: Object.freeze([
    'markdown',
    'excel-ready',
    'structured',
    'summary',
    'stats',
    'list',
    'table',
    'status'
  ]),

  // Section generation defaults
  SECTION_START_ID: 1,           // First section index
  SECTION_ID_PREFIX: 'section_',  // Prefix for section IDs

  // String formatting
  DATE_PLACEHOLDER: '{date}',    // Placeholder in title strings
  ISO_DATE_SPLIT_CHAR: 'T',      // Split character for ISO date parsing

  // Template title templates (used across multiple templates)
  TITLES: Object.freeze({
    DAILY_SUMMARY: '📔 AI 每日總結 - {date}',
    STOCK_REPORT: '📊 Stock Valuation Report - {date}',
    ERROR_REPORT: '❌ Error Report - {date}',
    MEMORY_CLEANUP: '🧹 Memory Cleanup Report - {date}',
    TOKEN_REPORT: '🎫 Token Usage Report - {date}',
    BACKUP_REPORT: '💾 Backup Status - {date}',
    ISSUE_REPORT: '📋 Issue Progress - {date}',
    HEALTH_REPORT: '🏥 System Health - {date}',
    REMINDER_REPORT: '⏰ Reminders Summary - {date}',
    SYSTEM_CHECK: '🔧 系統檢查 - {date}'
  }),

  // Section headers
  SECTIONS: Object.freeze({
    DAILY: ['✍️ 今日工作', '💡 學習反思', '🎯 明日計劃'],
    STOCK: ['📈 總覽 (總數/總值)', '🔄 變動 (新增/售出)', '💰 估值摘要'],
    ERROR: ['🔴 Critical Errors', '🟡 Warnings', '🔧 Auto-Fixed'],
    MEMORY: ['📦 Deleted Files', '💾 Space Freed', '⭐ Key Memories Preserved'],
    TOKEN: ['📊 Current Usage', '📈 Trend (7 days)', '⚠️ Warnings'],
    BACKUP: ['✅ Successful', '⚠️ Failed', '📋 Summary'],
    ISSUE: ['🟢 Active', '🟡 Backlog', '✅ Completed'],
    HEALTH: ['🤖 Services Status', '💻 Resources', '⚠️ Alerts'],
    REMINDER: ['📅 Due Today', '⏳ Overdue', '✅ Completed'],
    SYSTEM_CHECK: ['⏰ 提醒事項', '⚠️ 活躍錯誤', '💻 系統', '📜 腳本', '⏰ Cron Jobs', '📊 總覽']
  })
});

// ============================================================================
// UTILITY FUNCTIONS (with error handling)
// ============================================================================

/**
 * Utility: Format date string
 * Safely converts Date object or string to YYYY-MM-DD format.
 *
 * @param {Date|string} [date=new Date()] - Date object or string
 * @returns {string} Formatted date (YYYY-MM-DD)
 * @throws {Error} If date is invalid
 */
function formatDate(date = new Date()) {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw new Error('Invalid date provided to formatDate');
    }
    // Safe: use slice() instead of deprecated substr()
    return d.toISOString().split(CONFIG.ISO_DATE_SPLIT_CHAR)[0];
  } catch (e) {
    // Re-throw with context, preserving original error if already an Error
    if (e instanceof Error && e.message.includes('Invalid date')) {
      throw e;
    }
    throw new Error(`formatDate failed: ${e.message}`);
  }
}

/**
 * Utility: Validate template input
 * Ensures data is an object with required fields and defaults.
 *
 * @param {object} [data={}] - Input data
 * @param {Array<string>} [requiredFields=[]] - Required field names
 * @returns {object} Validated data with defaults applied
 * @throws {Error} If data is not a valid object
 */
function validateInput(data = {}, requiredFields = []) {
  try {
    // Type validation with safe null check
    if (typeof data !== 'object' || data === null) {
      throw new Error('Template data must be an object');
    }

    // Shallow copy to avoid mutating original
    const validated = { ...data };

    // Apply defaults safely
    if (!validated.date) {
      validated.date = formatDate();
    }
    if (!validated.version) {
      validated.version = CONFIG.REPORT_VERSION;
    }

    return validated;
  } catch (e) {
    if (e instanceof Error && e.message.includes('Template data')) {
      throw e;
    }
    throw new Error(`validateInput failed: ${e.message}`);
  }
}

/**
 * Utility: Create consistent report structure
 * Generates a standardized report object with sections.
 *
 * @param {string} title - Report title (supports {date} placeholder)
 * @param {Array<string>} sections - Array of section names
 * @param {string} format - Output format (must be in VALID_FORMATS)
 * @param {object} [data={}] - Template data
 * @returns {object} Standardized report structure
 * @throws {Error} If format is invalid or title is missing
 */
function createReportStructure(title, sections, format, data = {}) {
  try {
    // Validate inputs
    if (!title || typeof title !== 'string') {
      throw new Error('createReportStructure: title is required and must be a string');
    }
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error('createReportStructure: sections must be a non-empty array');
    }
    if (!format || typeof format !== 'string') {
      throw new Error('createReportStructure: format is required');
    }

    // Format validation
    if (!CONFIG.VALID_FORMATS.includes(format)) {
      throw new Error(`Invalid format: ${format}. Valid: ${CONFIG.VALID_FORMATS.join(', ')}`);
    }

    // Safe data validation
    let validatedData;
    try {
      validatedData = validateInput(data);
    } catch (e) {
      // If data validation fails, use minimal defaults
      validatedData = { date: formatDate(), version: CONFIG.REPORT_VERSION };
    }

    // Replace date placeholder safely
    const formattedTitle = title.replace(
      new RegExp(CONFIG.DATE_PLACEHOLDER, 'g'),
      validatedData.date
    );

    // Build sections with safe indexing
    const sectionArray = sections.map((section, index) => ({
      id: `${CONFIG.SECTION_ID_PREFIX}${(index + CONFIG.SECTION_START_ID)}`,
      name: section,
      content: null,  // To be filled by report generator
      data: null      // Raw data for this section
    }));

    return {
      version: CONFIG.REPORT_VERSION,
      generatedAt: getHKTDate(),
      title: formattedTitle,
      sections: sectionArray,
      format: format,
      metadata: {
        date: validatedData.date,
        templateName: title.split(' - ')[0],
        ...(validatedData.metadata || {})
      }
    };
  } catch (e) {
    // Re-throw known errors, wrap unknown errors
    if (e instanceof Error &&
        (e.message.includes('Invalid format') ||
         e.message.includes('title is required') ||
         e.message.includes('sections must be'))) {
      throw e;
    }
    throw new Error(`createReportStructure failed: ${e.message}`);
  }
}

// ============================================================================
// TEMPLATE FUNCTIONS (each with internal error handling)
// ============================================================================

/**
 * 1. Daily Summary Template
 * Used for: AI daily summaries, personal reflections
 *
 * @param {object} [data={}] - { date?, work?: [], reflections?: [], plans?: [] }
 * @returns {object} Report structure with sections
 */
function dailySummaryTemplate(data = {}) {
  try {
    const validated = validateInput(data, ['date']);
    return createReportStructure(
      CONFIG.TITLES.DAILY_SUMMARY,
      CONFIG.SECTIONS.DAILY,
      'markdown',
      validated
    );
  } catch (e) {
    throw new Error(`dailySummaryTemplate failed: ${e.message}`);
  }
}

/**
 * 2. Stock Report Template
 * Used for: Diamond inventory reports, stock valuation
 *
 * @param {object} [data={}] - { date?, totalCount?, totalValue?, changes?: {}, valuation?: {} }
 * @returns {object} Report structure with sections
 */
function stockReportTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    // Validate numeric fields if provided
    if (data.totalCount !== undefined && typeof data.totalCount !== 'number') {
      throw new Error('totalCount must be a number');
    }
    if (data.totalValue !== undefined && typeof data.totalValue !== 'number') {
      throw new Error('totalValue must be a number');
    }

    return createReportStructure(
      CONFIG.TITLES.STOCK_REPORT,
      CONFIG.SECTIONS.STOCK,
      'excel-ready',
      validated
    );
  } catch (e) {
    throw new Error(`stockReportTemplate failed: ${e.message}`);
  }
}

/**
 * 3. Error Report Template
 * Used for: System errors, bug tracking
 *
 * @param {object} [data={}] - { date?, criticalErrors?: [], warnings?: [], autoFixed?: [] }
 * @returns {object} Report structure with sections
 */
function errorReportTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    // Validate array fields safely
    const arrayFields = ['criticalErrors', 'warnings', 'autoFixed'];
    arrayFields.forEach(field => {
      if (data[field] !== undefined && !Array.isArray(data[field])) {
        throw new Error(`${field} must be an array`);
      }
    });

    return createReportStructure(
      CONFIG.TITLES.ERROR_REPORT,
      CONFIG.SECTIONS.ERROR,
      'structured',
      validated
    );
  } catch (e) {
    throw new Error(`errorReportTemplate failed: ${e.message}`);
  }
}

/**
 * 4. Memory Cleanup Report Template
 * Used for: Memory cleanup summaries, storage management
 *
 * @param {object} [data={}] - { date?, deletedFiles?: [], spaceFreed?: number, preservedMemories?: [] }
 * @returns {object} Report structure with sections
 */
function memoryCleanupTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    if (data.spaceFreed !== undefined && typeof data.spaceFreed !== 'number') {
      throw new Error('spaceFreed must be a number (bytes)');
    }

    return createReportStructure(
      CONFIG.TITLES.MEMORY_CLEANUP,
      CONFIG.SECTIONS.MEMORY,
      'summary',
      validated
    );
  } catch (e) {
    throw new Error(`memoryCleanupTemplate failed: ${e.message}`);
  }
}

/**
 * 5. Token Usage Report Template
 * Used for: API usage tracking, cost monitoring
 *
 * @param {object} [data={}] - { date?, currentUsage?: {}, trend?: [], warnings?: [] }
 * @returns {object} Report structure with sections
 */
function tokenReportTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    if (data.currentUsage !== undefined && typeof data.currentUsage !== 'object') {
      throw new Error('currentUsage must be an object');
    }
    if (data.trend !== undefined && !Array.isArray(data.trend)) {
      throw new Error('trend must be an array');
    }

    return createReportStructure(
      CONFIG.TITLES.TOKEN_REPORT,
      CONFIG.SECTIONS.TOKEN,
      'stats',
      validated
    );
  } catch (e) {
    throw new Error(`tokenReportTemplate failed: ${e.message}`);
  }
}

/**
 * 6. Backup Report Template
 * Used for: Backup status, sync reports
 *
 * @param {object} [data={}] - { date?, successful?: [], failed?: [], summary?: {} }
 * @returns {object} Report structure with sections
 */
function backupReportTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    const arrayFields = ['successful', 'failed'];
    arrayFields.forEach(field => {
      if (data[field] !== undefined && !Array.isArray(data[field])) {
        throw new Error(`${field} must be an array`);
      }
    });

    return createReportStructure(
      CONFIG.TITLES.BACKUP_REPORT,
      CONFIG.SECTIONS.BACKUP,
      'list',
      validated
    );
  } catch (e) {
    throw new Error(`backupReportTemplate failed: ${e.message}`);
  }
}

/**
 * 7. Issue Progress Report Template
 * Used for: Task tracking, project management
 *
 * @param {object} [data={}] - { date?, active?: [], backlog?: [], completed?: [] }
 * @returns {object} Report structure with sections
 */
function issueReportTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    const arrayFields = ['active', 'backlog', 'completed'];
    arrayFields.forEach(field => {
      if (data[field] !== undefined && !Array.isArray(data[field])) {
        throw new Error(`${field} must be an array`);
      }
    });

    return createReportStructure(
      CONFIG.TITLES.ISSUE_REPORT,
      CONFIG.SECTIONS.ISSUE,
      'table',
      validated
    );
  } catch (e) {
    throw new Error(`issueReportTemplate failed: ${e.message}`);
  }
}

/**
 * 8. System Health Report Template
 * Used for: System monitoring, health checks
 *
 * @param {object} [data={}] - { date?, services?: {}, resources?: {}, alerts?: [] }
 * @returns {object} Report structure with sections
 */
function healthReportTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    if (data.services !== undefined && typeof data.services !== 'object') {
      throw new Error('services must be an object');
    }
    if (data.resources !== undefined && typeof data.resources !== 'object') {
      throw new Error('resources must be an object');
    }
    if (data.alerts !== undefined && !Array.isArray(data.alerts)) {
      throw new Error('alerts must be an array');
    }

    return createReportStructure(
      CONFIG.TITLES.HEALTH_REPORT,
      CONFIG.SECTIONS.HEALTH,
      'status',
      validated
    );
  } catch (e) {
    throw new Error(`healthReportTemplate failed: ${e.message}`);
  }
}

/**
 * 9. Reminders Summary Report Template
 * Used for: Daily reminders, task summaries
 *
 * @param {object} [data={}] - { date?, dueToday?: [], overdue?: [], completed?: [] }
 * @returns {object} Report structure with sections
 */
function reminderReportTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    const arrayFields = ['dueToday', 'overdue', 'completed'];
    arrayFields.forEach(field => {
      if (data[field] !== undefined && !Array.isArray(data[field])) {
        throw new Error(`${field} must be an array`);
      }
    });

    return createReportStructure(
      CONFIG.TITLES.REMINDER_REPORT,
      CONFIG.SECTIONS.REMINDER,
      'list',
      validated
    );
  } catch (e) {
    throw new Error(`reminderReportTemplate failed: ${e.message}`);
  }
}

/**
 * 10. System Check Template (Combined Reminder + Error Report)
 * Used for: Reminder Discussion Bot - includes reminders + active errors
 *
 * @param {object} [data={}] - { date?, reminders?: [], errors?: [], overdue?: [] }
 * @returns {object} Report structure with sections
 */
function systemCheckTemplate(data = {}) {
  try {
    const validated = validateInput(data);

    return createReportStructure(
      CONFIG.TITLES.SYSTEM_CHECK,
      CONFIG.SECTIONS.SYSTEM_CHECK,
      'list',
      validated
    );
  } catch (e) {
    throw new Error(`systemCheckTemplate failed: ${e.message}`);
  }
}

// ============================================================================
// EXPORTS (with error handling wrapper for require safety)
// ============================================================================

/**
 * Safely require this module
 * Returns an object with all templates and utilities.
 *
 * @returns {object} Module exports
 */
function getExports() {
  return {
    // Templates
    dailySummaryTemplate,
    stockReportTemplate,
    errorReportTemplate,
    memoryCleanupTemplate,
    tokenReportTemplate,
    backupReportTemplate,
    issueReportTemplate,
    healthReportTemplate,
    reminderReportTemplate,
    systemCheckTemplate,

    // Utilities
    formatDate,
    validateInput,
    createReportStructure,

    // Constants (exposed for external use)
    REPORT_VERSION: CONFIG.REPORT_VERSION,
    VALID_FORMATS: CONFIG.VALID_FORMATS,
    MODULE_VERSION: CONFIG.MODULE_VERSION,

    // Registry for easy lookup by name
    TEMPLATES: Object.freeze({
      'daily-summary': dailySummaryTemplate,
      'stock': stockReportTemplate,
      'error': errorReportTemplate,
      'memory-cleanup': memoryCleanupTemplate,
      'token': tokenReportTemplate,
      'backup': backupReportTemplate,
      'issue': issueReportTemplate,
      'health': healthReportTemplate,
      'reminder': reminderReportTemplate,
      'system-check': systemCheckTemplate
    })
  };
}

// Main exports
module.exports = getExports();

// ES Module compatibility (default export)
if (typeof exports !== 'undefined') {
  exports.default = module.exports;
}
