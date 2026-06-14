#!/usr/bin/env node

/**
 * Error Templates Module
 * ======================
 * Template definitions for error reports - data structures only, no business logic.
 * Follows the same patterns as report_templates.js.
 *
 * VERSION:    1.0.0
 * AUTHOR:     Ally (2026-04-07)
 *
 * USAGE:
 *   const { CONFIG, createErrorReportStructure } = require('./error_templates');
 *
 * @module error_templates
 * @author Ally
 * @date 2026-04-07
 */

// ============================================================================
// CONFIG - All constants and magic numbers
// ============================================================================

const { getHKTDateTime } = require('./lib/time');

const CONFIG = Object.freeze({
  MODULE_VERSION: '1.0.0',
  REPORT_VERSION: '1.0.0',

  // Date placeholder
  DATE_PLACEHOLDER: '{date}',

  // Severity levels with emoji, label, and auto-resolve delay (minutes)
  SEVERITY_LEVELS: Object.freeze({
    CRITICAL: { emoji: '🔴', label: 'Critical', minDelay: 0 },
    HIGH: { emoji: '🟠', label: 'High', minDelay: 5 },
    MEDIUM: { emoji: '🟡', label: 'Medium', minDelay: 30 },
    LOW: { emoji: '🟢', label: 'Low', minDelay: 120 }
  }),

  // Section types
  SECTION_TYPES: Object.freeze({
    CRITICAL: 'critical',
    WARNING: 'warning',
    INFO: 'info',
    RESOLVED: 'resolved'
  })
});

// ============================================================================
// TITLE TEMPLATES
// ============================================================================

const TITLES = Object.freeze({
  ERROR_REPORT: '❌ Error Report - {date}',
  CRITICAL: '🔴 Critical',
  WARNING: '🟠 Warning',
  INFO: '🟡 Info',
  RESOLVED: '✅ Recently Resolved'
});

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create error report structure
 * @param {string} date - Report date (YYYY-MM-DD)
 * @returns {object} Standardized error report structure
 */
function createErrorReportStructure(date = '') {
  return {
    title: TITLES.ERROR_REPORT.replace(CONFIG.DATE_PLACEHOLDER, date),
    sections: [
      { name: CONFIG.SECTION_TYPES.CRITICAL, title: TITLES.CRITICAL, items: [], icon: CONFIG.SEVERITY_LEVELS.CRITICAL.emoji },
      { name: CONFIG.SECTION_TYPES.WARNING, title: TITLES.WARNING, items: [], icon: CONFIG.SEVERITY_LEVELS.HIGH.emoji },
      { name: CONFIG.SECTION_TYPES.INFO, title: TITLES.INFO, items: [], icon: CONFIG.SEVERITY_LEVELS.MEDIUM.emoji },
      { name: CONFIG.SECTION_TYPES.RESOLVED, title: TITLES.RESOLVED, items: [], icon: CONFIG.SEVERITY_LEVELS.LOW.emoji }
    ],
    metadata: {
      generated: getHKTDateTime(),
      date: date,
      version: CONFIG.REPORT_VERSION
    }
  };
}

/**
 * Create a single error item structure
 * @param {object} error - Error data
 * @returns {object} Formatted error item
 */
function createErrorItem(error) {
  return {
    id: error.id || '',
    date: error.date || '',
    title: error.title || 'Unknown Error',
    problem: error.problem || '',
    source: error.source || 'unknown',
    severity: error.severity || 3,
    count: error.count || 1,
    resolved: error.resolved || false,
    resolvedAt: error.resolvedAt || null,
    resolvedBy: error.resolvedBy || null,
    tags: error.tags || []
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  CONFIG,
  TITLES,
  createErrorReportStructure,
  createErrorItem
};
