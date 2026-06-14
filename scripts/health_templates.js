#!/usr/bin/env node

/**
 * Health Templates Module
 * ======================
 * 只定義 health report 嘅數據結構，無 business logic。
 * 所有狀態值、標題文案都喺呢度定義，方便維護。
 *
 * VERSION:    1.0.0
 * AUTHOR:     Ally (2026-04-07)
 *
 * USAGE:
 *   const { CONFIG, createHealthReportStructure } = require('./health_templates');
 *   const structure = createHealthReportStructure('2026-04-07');
 *
 * @module health_templates
 * @author Ally
 * @date 2026-04-07
 */

// ============================================================================
// CONFIG - All constants and magic numbers
// ============================================================================

const { getHKTDateTime } = require('./lib/time');

const CONFIG = Object.freeze({
  MODULE_VERSION: '1.0.0',

  // Report title template
  TITLES: Object.freeze({
    HEALTH_REPORT: '🏥 System Health - {date}',
    SERVICES: '🤖 Services',
    RESOURCES: '💻 Resources',
    ERRORS: '📊 Errors',
    CRON: '⏰ Cron Jobs'
  }),

  // Section names (used as keys in the report)
  SECTIONS: Object.freeze({
    SERVICES: 'services',
    RESOURCES: 'resources',
    ERRORS: 'errors',
    CRON: 'cron'
  }),

  // Status emoji indicators
  STATUS: Object.freeze({
    OK: '🟢',
    WARNING: '🟡',
    CRITICAL: '🟠',
    EMERGENCY: '🔴',
    ERROR: '🔴'
  }),

  // Discord embed colors (decimal)
  STATUS_COLORS: Object.freeze({
    HEALTHY: 0x00FF00,    // Green
    WARNING: 0xFFAA00,    // Orange
    CRITICAL: 0xFF6600,   // Orange-Red
    EMERGENCY: 0xFF0000,  // Red
    UNKNOWN: 0x808080     // Gray
  }),

  // Status to color mapping for Discord embed
  STATUS_COLOR_MAP: Object.freeze({
    OK: 'HEALTHY',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL',
    EMERGENCY: 'EMERGENCY',
    error: 'EMERGENCY'
  }),

  // Thresholds
  THRESHOLDS: Object.freeze({
    cpu: { warning: 4.0, critical: 8.0 },
    memory: { warning: 80, critical: 90 },
    errors: { warning: 5, critical: 10 },
    disk: { warning: 85, critical: 95 }
  }),

  // Date placeholder
  DATE_PLACEHOLDER: '{date}'
});

// ============================================================================
// STRUCTURE FACTORY
// ============================================================================

/**
 * Create the base health report structure
 * This is the ONLY place where the report shape is defined.
 *
 * @param {string} date - Report date (YYYY-MM-DD)
 * @returns {object} Health report structure
 */
function createHealthReportStructure(date) {
  return {
    title: CONFIG.TITLES.HEALTH_REPORT.replace(CONFIG.DATE_PLACEHOLDER, date),
    sections: [
      {
        name: CONFIG.SECTIONS.SERVICES,
        title: CONFIG.TITLES.SERVICES,
        items: []
      },
      {
        name: CONFIG.SECTIONS.RESOURCES,
        title: CONFIG.TITLES.RESOURCES,
        items: []
      },
      {
        name: CONFIG.SECTIONS.ERRORS,
        title: CONFIG.TITLES.ERRORS,
        items: []
      },
      {
        name: CONFIG.SECTIONS.CRON,
        title: CONFIG.TITLES.CRON,
        items: []
      }
    ],
    metadata: {
      generated: getHKTDateTime(),
      date: date,
      moduleVersion: CONFIG.MODULE_VERSION
    }
  };
}

// ============================================================================
// ITEM FACTORIES (for populating sections)
// ============================================================================

/**
 * Create a service status item
 * @param {object} data - { name, status, message, details? }
 * @returns {object} Service item
 */
function createServiceItem(data) {
  const statusMap = {
    OK: CONFIG.STATUS.OK,
    WARNING: CONFIG.STATUS.WARNING,
    CRITICAL: CONFIG.STATUS.CRITICAL,
    EMERGENCY: CONFIG.STATUS.EMERGENCY,
    error: CONFIG.STATUS.ERROR
  };

  return {
    name: data.name,
    status: data.status || 'UNKNOWN',
    alert: statusMap[data.status] || CONFIG.STATUS.ERROR,
    message: data.message || '',
    details: data.details || null
  };
}

/**
 * Create a resource status item
 * @param {object} data - { name, status, message, value?, available?, size? }
 * @returns {object} Resource item
 */
function createResourceItem(data) {
  const statusMap = {
    OK: CONFIG.STATUS.OK,
    WARNING: CONFIG.STATUS.WARNING,
    CRITICAL: CONFIG.STATUS.CRITICAL,
    EMERGENCY: CONFIG.STATUS.EMERGENCY,
    error: CONFIG.STATUS.ERROR
  };

  return {
    name: data.name,
    status: data.status || 'UNKNOWN',
    alert: statusMap[data.status] || CONFIG.STATUS.ERROR,
    message: data.message || '',
    value: data.value !== undefined ? data.value : null,
    available: data.available || null,
    size: data.size || null
  };
}

/**
 * Create an error status item
 * @param {object} data - { status, count, message, recent? }
 * @returns {object} Error item
 */
function createErrorItem(data) {
  const statusMap = {
    OK: CONFIG.STATUS.OK,
    WARNING: CONFIG.STATUS.WARNING,
    CRITICAL: CONFIG.STATUS.CRITICAL,
    EMERGENCY: CONFIG.STATUS.EMERGENCY,
    error: CONFIG.STATUS.ERROR
  };

  return {
    status: data.status || 'OK',
    alert: statusMap[data.status] || CONFIG.STATUS.OK,
    count: data.count || 0,
    message: data.message || '',
    recent: data.recent || []
  };
}

/**
 * Create a cron status item
 * @param {object} data - { status, totalJobs, requiredFound, requiredTotal, missingJobs, source, message }
 * @returns {object} Cron item
 */
function createCronItem(data) {
  const statusMap = {
    OK: CONFIG.STATUS.OK,
    WARNING: CONFIG.STATUS.WARNING,
    CRITICAL: CONFIG.STATUS.CRITICAL,
    EMERGENCY: CONFIG.STATUS.EMERGENCY,
    error: CONFIG.STATUS.ERROR
  };

  return {
    status: data.status || 'OK',
    alert: statusMap[data.status] || CONFIG.STATUS.OK,
    totalJobs: data.totalJobs || 0,
    requiredFound: data.requiredFound || 0,
    requiredTotal: data.requiredTotal || 0,
    missingJobs: data.missingJobs || [],
    source: data.source || 'unknown',
    message: data.message || ''
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  CONFIG,
  createHealthReportStructure,
  createServiceItem,
  createResourceItem,
  createErrorItem,
  createCronItem
};
