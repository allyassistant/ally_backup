#!/usr/bin/env node
/**
 * code_quality_generator.js - Code Quality Report Generator
 * ==========================================================
 * 負責將 Code Quality data 格式化為不同輸出
 *
 * 職責：
 * - 格式化為 Markdown
 * - 格式化為 Discord Embed
 * - 格式化為 JSON
 * - 格式化為 SARIF
 * - 格式化為 Simple text
 * - 格式化為 Compat (system_check_bot.js 兼容)
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-04-07)
 */

'use strict';

const {
  CONFIG,
  createCodeQualityReportStructure,
  groupBySeverity,
  groupByCategory
} = require('./code_quality_templates');
const { getHKTDateTime } = require('./lib/time');

// ============================================================================
// REPORT GENERATOR CLASS
// ============================================================================

class CodeQualityReportGenerator {
  /**
   * Constructor
   *
   * @param {Object} options - Generator options
   */
  constructor(options = {}) {
    this.options = {
      maxIssuesPerGroup: options.maxIssuesPerGroup || CONFIG.CLI_MAX_ISSUES_PER_GROUP,
      ...options
    };

    this.report = null;
  }

  /**
   * Generate report structure from QA data
   *
   * @param {Object} qaData - Quality assurance data
   * @param {string} date - Report date
   * @returns {Object} Report structure
   */
  generate(qaData, date) {
    this.report = createCodeQualityReportStructure({
      date,
      summary: qaData.summary || {},
      issues: qaData.issues || [],
      totalFiles: qaData.totalFiles,
      filesScanned: qaData.filesScanned
    });

    return this.report;
  }

  /**
   * Set report directly (alternative to generate)
   *
   * @param {Object} report - Report structure
   */
  setReport(report) {
    this.report = report;
  }

  // ==========================================================================
  // OUTPUT FORMATS
  // ==========================================================================

  /**
   * Convert to Markdown format
   *
   * @param {Object} report - Report (uses this.report if not provided)
   * @returns {string} Markdown formatted string
   */
  toMarkdown(report = null) {
    const r = report || this.report;
    if (!r) return '';

    const timestamp = getHKTDateTime();
    let md = `# Code Quality Report\n\n`;
    md += `Generated: ${timestamp}\n\n`;

    // Summary section
    md += `## Summary\n\n`;
    md += `- **Total Issues**: ${r.summary.total || 0}\n`;
    md += `- **Critical**: ${r.summary.critical || 0} 🔴\n`;
    md += `- **High**: ${r.summary.high || 0} 🟠\n`;
    md += `- **Medium**: ${r.summary.medium || 0} 🟡\n`;
    md += `- **Low**: ${r.summary.low || 0} 🟢\n`;
    md += `- **Auto-fixable**: ${r.summary.autoFixable || 0}\n\n`;

    // Severity distribution
    if (r.summary.bySeverity && Object.keys(r.summary.bySeverity).length > 0) {
      md += `### By Severity\n\n`;
      md += `| Severity | Count |\n`;
      md += `|----------|-------|\n`;
      for (const [sev, count] of Object.entries(r.summary.bySeverity)) {
        const emoji = CONFIG.SEVERITY_EMOJI[sev] || '';
        md += `| ${sev} ${emoji} | ${count} |\n`;
      }
      md += `\n`;
    }

    // Category distribution
    if (r.summary.byCategory && Object.keys(r.summary.byCategory).length > 0) {
      md += `### By Category\n\n`;
      md += `| Category | Count |\n`;
      md += `|----------|-------|\n`;
      for (const [cat, count] of Object.entries(r.summary.byCategory)) {
        const label = CONFIG.CATEGORIES[cat] || cat;
        md += `| ${label} | ${count} |\n`;
      }
      md += `\n`;
    }

    // Detailed issues
    if (r.issues && r.issues.length > 0) {
      md += `## Issues\n\n`;

      const bySeverity = groupBySeverity(r.issues);

      for (const severity of CONFIG.SEVERITY_ORDER) {
        const group = bySeverity[severity] || [];
        if (group.length === 0) continue;

        const titleKey = `SECTION_${severity.toUpperCase()}`;
        const title = CONFIG.TITLES[titleKey] || `${severity.toUpperCase()} Issues`;

        md += `### ${title} (${group.length})\n\n`;

        for (const issue of group.slice(0, this.options.maxIssuesPerGroup)) {
          md += `- **${issue.file}${issue.line ? ':' + issue.line : ''}**\n`;
          md += `  - Rule: \`${issue.rule || 'N/A'}\`\n`;
          md += `  - ${issue.title || issue.message || 'No description'}\n`;
          if (issue.suggestion) {
            md += `  - 💡 ${issue.suggestion}\n`;
          }
          md += `\n`;
        }

        if (group.length > this.options.maxIssuesPerGroup) {
          md += `*... and ${group.length - this.options.maxIssuesPerGroup} more*\n\n`;
        }
      }
    }

    return md;
  }

  /**
   * Convert to Discord Embed format
   *
   * @param {Object} report - Report (uses this.report if not provided)
   * @returns {Object} Discord embed object
   */
  toDiscordEmbed(report = null) {
    const r = report || this.report;
    if (!r) return null;

    // Truncate content if too long (Discord field value limit is 1024 chars)
    const truncate = (text, maxLen = 1024) => {
      if (!text) return '(No data)';
      if (text.length <= maxLen) return text;
      return text.slice(0, maxLen - 3) + '...';
    };

    // Build summary text
    const summaryText = [
      `Total: ${r.summary.total || 0}`,
      `🔴 ${r.summary.critical || 0}`,
      `🟠 ${r.summary.high || 0}`,
      `🟡 ${r.summary.medium || 0}`,
      `🟢 ${r.summary.low || 0}`
    ].join(' | ');

    // Build severity fields
    const fields = [];

    // Add summary as first field
    fields.push({
      name: '📊 Summary',
      value: truncate(summaryText),
      inline: false
    });

    // Add severity breakdown
    const bySeverity = groupBySeverity(r.issues || []);
    for (const severity of CONFIG.SEVERITY_ORDER) {
      const group = bySeverity[severity] || [];
      if (group.length === 0) continue;

      const emoji = CONFIG.SEVERITY_EMOJI[severity] || '';
      const titleKey = `SECTION_${severity.toUpperCase()}`;
      const sectionName = CONFIG.TITLES[titleKey] || severity;

      // Format issues list
      const issueList = group.slice(0, 5).map(issue => {
        const loc = `${issue.file}${issue.line ? ':' + issue.line : ''}`;
        return `• **${loc}**: ${issue.title || issue.message || 'N/A'}`;
      }).join('\n');

      const moreText = group.length > 5 ? `\n*... and ${group.length - 5} more*` : '';

      fields.push({
        name: `${emoji} ${sectionName} (${group.length})`,
        value: truncate(issueList + moreText),
        inline: false
      });
    }

    // Determine embed color based on highest severity
    let color = 0x3498db; // Default blue
    if (r.summary.critical > 0) color = CONFIG.SEVERITY_COLORS.critical;
    else if (r.summary.high > 0) color = CONFIG.SEVERITY_COLORS.high;
    else if (r.summary.medium > 0) color = CONFIG.SEVERITY_COLORS.medium;
    else if (r.summary.low > 0) color = CONFIG.SEVERITY_COLORS.low;

    const embed = {
      title: r.title || '📊 Code Quality Report',
      color,
      fields,
      footer: {
        text: `Generated: ${r.generatedAt}`
      },
      timestamp: r.generatedAt
    };

    return embed;
  }

  /**
   * Convert to JSON string
   *
   * @param {Object} report - Report (uses this.report if not provided)
   * @returns {string} JSON formatted string
   */
  toJSON(report = null) {
    const r = report || this.report;
    if (!r) return '{}';

    return JSON.stringify(r, null, 2);
  }

  /**
   * Convert to SARIF format
   *
   * @param {Array} issues - Issues list (uses this.report.issues if not provided)
   * @param {string} toolName - Tool name for SARIF
   * @returns {string} SARIF formatted JSON string
   */
  toSARIF(issues = null, toolName = 'code-quality-manager') {
    const issueList = issues || (this.report ? this.report.issues : []) || [];

    const sarifObj = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [{
        tool: {
          driver: {
            name: toolName,
            version: CONFIG.REPORT_VERSION
          }
        },
        results: issueList.map(i => ({
          ruleId: i.rule || 'unknown',
          level: this._mapSeverityToSarifLevel(i.severity),
          message: { text: i.title || i.message || '' },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: i.file },
              region: { startLine: i.line || 1 }
            }
          }]
        }))
      }]
    };

    return JSON.stringify(sarifObj, null, 2);
  }

  /**
   * Map severity to SARIF level
   *
   * @param {string} severity - Severity level
   * @returns {string} SARIF level
   */
  _mapSeverityToSarifLevel(severity) {
    return CONFIG.SARIF_LEVEL[severity] || 'warning';
  }

  /**
   * Convert to simple text format
   *
   * @param {Object} report - Report (uses this.report if not provided)
   * @returns {string} Simple text format
   */
  toSimple(report = null) {
    const r = report || this.report;
    if (!r || !r.issues) return '';

    return r.issues.map(i =>
      `${(i.severity || 'unknown').toUpperCase()}: ${i.file}${i.line ? ':' + i.line : ''} - ${i.title || i.message || 'Unknown issue'}`
    ).join('\n');
  }

  /**
   * Convert to compat format (for system_check_bot.js compatibility)
   *
   * @param {Object} report - Report (uses this.report if not provided)
   * @returns {string} JSON compat format string
   */
  toCompat(report = null) {
    const r = report || this.report;
    if (!r) return '{}';

    return JSON.stringify({
      summary: {
        critical: r.summary.critical || 0,
        high: r.summary.high || 0,
        medium: r.summary.medium || 0,
        low: r.summary.low || 0
      },
      findings: (r.issues || []).map(i => ({
        file: i.file,
        line: i.line,
        severity: i.severity,
        title: i.title || i.message || 'Unknown issue',
        rule: i.rule || 'unknown',
        category: i.category || 'reliability'
      })),
      generatedAt: r.generatedAt || getHKTDateTime(),
      source: 'code-quality-manager'
    }, null, 2);
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Generate report and return in specified format
   *
   * @param {string} format - Output format (json/markdown/sarif/simple/compat)
   * @param {Object} data - QA data
   * @param {string} date - Report date
   * @returns {string} Formatted output
   */
  format(format, data, date) {
    this.generate(data, date);

    switch (format.toLowerCase()) {
      case 'json':
        return this.toJSON();
      case 'markdown':
      case 'md':
        return this.toMarkdown();
      case 'sarif':
        return this.toSARIF();
      case 'simple':
        return this.toSimple();
      case 'compat':
        return this.toCompat();
      default:
        return this.toJSON();
    }
  }

  /**
   * Save report to files
   *
   * @param {string} outputDir - Output directory
   * @param {Object} options - Save options
   * @returns {Array<string>} List of saved file paths
   */
  save(outputDir, options = {}) {
    const fs = require('fs');
    const path = require('path');

    const dir = outputDir || CONFIG.OUTPUT.dir;
    const formats = options.formats || ['json', 'markdown', 'compat'];
    const savedFiles = [];

    // Ensure directory exists
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.error(`❌ Failed to create output directory: ${err.message}`);
      return savedFiles;
    }

    for (const format of formats) {
      let content;
      let filename;

      switch (format) {
        case 'json':
          content = this.toJSON();
          filename = CONFIG.OUTPUT.reportFile;
          break;
        case 'markdown':
        case 'md':
          content = this.toMarkdown();
          filename = CONFIG.OUTPUT.summaryFile;
          break;
        case 'sarif':
          content = this.toSARIF();
          filename = 'code_quality_report.sarif.json';
          break;
        case 'compat':
          content = this.toCompat();
          filename = 'pure_ai_audit_results.json';
          break;
        default:
          continue;
      }

      const filePath = path.join(dir, filename);

      try {
        // Atomic write
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, content, 'utf8');
        fs.renameSync(tmpPath, filePath);
        savedFiles.push(filePath);
      } catch (err) {
        console.error(`❌ Failed to save ${format} report: ${err.message}`);
      }
    }

    return savedFiles;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  CodeQualityReportGenerator
};
