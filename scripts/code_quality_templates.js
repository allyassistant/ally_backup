#!/usr/bin/env node
/**
 * code_quality_templates.js - Code Quality Report Templates
 * =========================================================
 * 只定義 Code Quality Report 嘅數據結構
 *
 * 職責：
 * - 定義 CONFIG 常量
 * - 定義 Report 結構
 * - Severity/CATEGORY 分類
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-04-07)
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
  REPORT_NAME: 'Code Quality Manager',

  // Output formats
  VALID_FORMATS: Object.freeze([
    'json',
    'markdown',
    'md',
    'sarif',
    'simple',
    'compat'
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
    critical: 0xFF0000,  // Red
    high: 0xFF8800,      // Orange
    medium: 0xFFDD00,    // Yellow
    low: 0x00FF00        // Green
  }),

  // Report titles
  TITLES: Object.freeze({
    CODE_QUALITY_REPORT: '📊 Code Quality Report - {date}',
    SECTION_CRITICAL: '🚨 Critical Issues',
    SECTION_HIGH: '⚠️ High Priority Issues',
    SECTION_MEDIUM: '📝 Medium Priority Issues',
    SECTION_LOW: 'ℹ️ Low Priority Issues'
  }),

  // Category labels
  CATEGORIES: Object.freeze({
    reliability: 'Reliability',
    security: 'Security',
    performance: 'Performance',
    maintainability: 'Maintainability',
    correctness: 'Correctness',
    'best-practice': 'Best Practice'
  }),

  // SARIF severity mapping
  SARIF_LEVEL: Object.freeze({
    critical: 'error',
    high: 'error',
    medium: 'warning',
    low: 'note'
  }),

  // Output configuration
  OUTPUT: Object.freeze({
    dir: '.state',
    reportFile: 'code_quality_report.json',
    summaryFile: 'code_quality_summary.md'
  }),

  // CLI display
  CLI_MAX_ISSUES_PER_GROUP: 10
});

// ============================================================================
// TEMPLATE STRUCTURE FUNCTIONS
// ============================================================================

/**
 * Create a standard Code Quality Report structure
 *
 * @param {Object} data - Report data
 * @param {string} data.date - Report date
 * @param {string} data.version - Report version
 * @param {Object} data.summary - Summary statistics
 * @param {Array} data.issues - List of issues
 * @returns {Object} Report structure
 */
function createCodeQualityReportStructure(data = {}) {
  const date = data.date || getHKTDate();

  return {
    version: CONFIG.REPORT_VERSION,
    generatedAt: getHKTDateTime(),
    title: CONFIG.TITLES.CODE_QUALITY_REPORT.replace('{date}', date),

    // Summary statistics
    summary: {
      total: data.summary?.total || 0,
      critical: data.summary?.critical || 0,
      high: data.summary?.high || 0,
      medium: data.summary?.medium || 0,
      low: data.summary?.low || 0,
      autoFixable: data.summary?.autoFixable || 0,
      bySeverity: data.summary?.bySeverity || {},
      byCategory: data.summary?.byCategory || {}
    },

    // Issue list
    issues: data.issues || [],

    // Metadata
    metadata: {
      date,
      reportVersion: CONFIG.REPORT_VERSION,
      moduleVersion: CONFIG.MODULE_VERSION,
      totalFiles: data.totalFiles || 0,
      filesScanned: data.filesScanned || 0,
      ...data.metadata
    }
  };
}

/**
 * Create a section for the report
 *
 * @param {string} name - Section name
 * @param {string} emoji - Section emoji
 * @param {Array} issues - Issues in this section
 * @returns {Object} Section structure
 */
function createSection(name, emoji, issues = []) {
  return {
    name: `${emoji} ${name}`,
    emoji,
    issues,
    count: issues.length
  };
}

/**
 * Group issues by severity
 *
 * @param {Array} issues - List of issues
 * @returns {Object} Issues grouped by severity
 */
function groupBySeverity(issues) {
  const groups = {
    critical: [],
    high: [],
    medium: [],
    low: []
  };

  for (const issue of issues) {
    const severity = issue.severity || 'medium';
    if (groups[severity]) {
      groups[severity].push(issue);
    } else {
      groups.medium.push(issue);
    }
  }

  return groups;
}

/**
 * Group issues by category
 *
 * @param {Array} issues - List of issues
 * @returns {Object} Issues grouped by category
 */
function groupByCategory(issues) {
  const groups = {};

  for (const issue of issues) {
    const category = issue.category || 'maintainability';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(issue);
  }

  return groups;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // CONFIG
  CONFIG,

  // Template functions
  createCodeQualityReportStructure,
  createSection,
  groupBySeverity,
  groupByCategory,

  // Constants (re-exported for convenience)
  SEVERITY_ORDER: CONFIG.SEVERITY_ORDER,
  SEVERITY_EMOJI: CONFIG.SEVERITY_EMOJI,
  SEVERITY_COLORS: CONFIG.SEVERITY_COLORS,
  CATEGORIES: CONFIG.CATEGORIES,
  VALID_FORMATS: CONFIG.VALID_FORMATS
};
