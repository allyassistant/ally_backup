#!/usr/bin/env node

/**
 * Error Report Generator
 * =====================
 * Generates formatted error reports using error_templates.
 * Responsible for formatting error data into different output formats.
 *
 * VERSION:    1.0.0
 * AUTHOR:     Ally (2026-04-07)
 *
 * USAGE:
 *   const { ErrorReportGenerator } = require('./error_generator');
 *
 *   const generator = new ErrorReportGenerator();
 *   const report = generator.generate(errorData, date);
 *   console.log(generator.toMarkdown(report));
 *
 * @module error_generator
 * @author Ally
 * @date 2026-04-07
 */

const {
  CONFIG,
  createErrorReportStructure,
  createErrorItem
} = require('./error_templates');
const { getHKTDateTime } = require('./lib/time');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get severity icon by level number
 * @param {number} level - Severity level (1-4)
 * @returns {string} Emoji icon
 */
function getSeverityIcon(level) {
  const icons = {
    1: CONFIG.SEVERITY_LEVELS.CRITICAL.emoji,
    2: CONFIG.SEVERITY_LEVELS.HIGH.emoji,
    3: CONFIG.SEVERITY_LEVELS.MEDIUM.emoji,
    4: CONFIG.SEVERITY_LEVELS.LOW.emoji
  };
  return icons[level] || '⚪';
}

/**
 * Truncate text to max length
 * @param {string} text - Text to truncate
 * @param {number} maxLen - Maximum length
 * @returns {string} Truncated text
 */
function truncate(text, maxLen = 1024) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

// ============================================================================
// ERROR REPORT GENERATOR CLASS
// ============================================================================

class ErrorReportGenerator {
  constructor(options = {}) {
    this.report = null;
    this.options = {
      maxItemsPerSection: options.maxItemsPerSection || 50,
      maxProblemLength: options.maxProblemLength || 60,
      ...options
    };
  }

  /**
   * Generate error report from error data
   * @param {object} errorData - Error data object { errors, active, resolved }
   * @param {string} date - Report date (YYYY-MM-DD)
   * @returns {object} Generated error report
   */
  generate(errorData, date = '') {
    // Create base structure
    this.report = createErrorReportStructure(date);

    if (!errorData || !errorData.errors) {
      return this.report;
    }

    const errors = errorData.errors;

    // Categorize errors into sections
    const critical = [];
    const warning = [];
    const info = [];
    const resolved = [];

    errors.forEach(error => {
      const item = createErrorItem(error);

      if (error.resolved) {
        resolved.push(item);
      } else if (error.severity === 1) {
        critical.push(item);
      } else if (error.severity === 2) {
        warning.push(item);
      } else {
        info.push(item);
      }
    });

    // Populate sections (limit items)
    const maxItems = this.options.maxItemsPerSection;
    this.report.sections.find(s => s.name === 'critical').items = critical.slice(0, maxItems);
    this.report.sections.find(s => s.name === 'warning').items = warning.slice(0, maxItems);
    this.report.sections.find(s => s.name === 'info').items = info.slice(0, maxItems);
    this.report.sections.find(s => s.name === 'resolved').items = resolved.slice(0, maxItems);

    // Add summary metadata
    this.report.metadata.totalErrors = errors.length;
    this.report.metadata.activeCount = critical.length + warning.length + info.length;
    this.report.metadata.resolvedCount = resolved.length;

    return this.report;
  }

  /**
   * Convert report to Markdown format
   * @param {object} report - Report object (uses this.report if not provided)
   * @returns {string} Markdown formatted string
   */
  toMarkdown(report = null) {
    const r = report || this.report;
    if (!r) return '';

    const lines = [];

    lines.push(`# ${r.title}`);
    lines.push('');
    lines.push(`*Generated: ${r.metadata.generated}*`);
    lines.push('');

    // Summary
    if (r.metadata.activeCount !== undefined) {
      lines.push(`📊 Summary: ${r.metadata.activeCount} active, ${r.metadata.resolvedCount} resolved`);
      lines.push('');
    }

    // Sections
    r.sections.forEach(section => {
      if (section.items.length === 0 && section.name !== 'resolved') {
        // Skip empty non-resolved sections
        return;
      }

      lines.push(`## ${section.icon || ''} ${section.title}`);
      lines.push('');

      if (section.items.length === 0) {
        lines.push('*(No items)*');
        lines.push('');
        return;
      }

      section.items.forEach(item => {
        const icon = getSeverityIcon(item.severity);
        lines.push(`${icon} **[${item.date}]** ${item.title}`);
        lines.push(`   - Source: ${item.source}`);
        lines.push(`   - ${truncate(item.problem, this.options.maxProblemLength)}`);
        if (item.count > 1) {
          lines.push(`   - Count: ${item.count}x`);
        }
        if (item.resolved) {
          const resolvedDate = item.resolvedAt ? new Date(item.resolvedAt).toLocaleDateString('en-CA') : 'unknown';
          lines.push(`   - ✅ Resolved: ${resolvedDate} (${item.resolvedBy || 'manual'})`);
        }
        lines.push('');
      });
    });

    return lines.join('\n');
  }

  /**
   * Convert report to Discord embed format
   * @param {object} report - Report object (uses this.report if not provided)
   * @returns {object} Discord embed object
   */
  toDiscordEmbed(report = null) {
    const r = report || this.report;
    if (!r) return null;

    const embed = {
      title: truncate(r.title, 256),
      color: 0xe74c3c, // Red for error reports
      fields: [],
      footer: {
        text: `Generated: ${r.metadata.generated}`
      },
      timestamp: getHKTDateTime()
    };

    // Add summary field
    if (r.metadata.activeCount !== undefined) {
      embed.fields.push({
        name: '📊 Summary',
        value: `Active: ${r.metadata.activeCount} | Resolved: ${r.metadata.resolvedCount}`,
        inline: true
      });
    }

    // Add section fields
    r.sections.forEach(section => {
      if (section.items.length === 0) return;

      const items = section.items.slice(0, 10); // Discord field limit
      const value = items.map(item => {
        const icon = getSeverityIcon(item.severity);
        const problem = truncate(item.problem, 40);
        return `${icon} ${item.date}: ${item.title} - ${problem}`;
      }).join('\n');

      embed.fields.push({
        name: `${section.icon || ''} ${section.title} (${section.items.length})`,
        value: truncate(value, 1024),
        inline: false
      });
    });

    return embed;
  }

  /**
   * Convert report to JSON format
   * @param {object} report - Report object (uses this.report if not provided)
   * @returns {string} JSON formatted string
   */
  toJSON(report = null) {
    const r = report || this.report;
    if (!r) return '{}';
    return JSON.stringify(r, null, 2);
  }

  /**
   * Get report statistics
   * @param {object} report - Report object (uses this.report if not provided)
   * @returns {object} Statistics object
   */
  getStats(report = null) {
    const r = report || this.report;
    if (!r) return {};

    const stats = {
      total: r.metadata.totalErrors || 0,
      active: r.metadata.activeCount || 0,
      resolved: r.metadata.resolvedCount || 0
    };

    r.sections.forEach(section => {
      stats[section.name] = section.items.length;
    });

    return stats;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  ErrorReportGenerator,
  getSeverityIcon,
  truncate
};

// ============================================================================
// CLI DEMO
// ============================================================================

if (require.main === module) {
  const log = (...args) => console.log(...args);

  log('📝 Error Report Generator CLI Demo\n');
  log('='.repeat(60));

  const generator = new ErrorReportGenerator();

  // Create sample error data
  const sampleData = {
    errors: [
      {
        id: 'err001',
        date: '2026-04-07',
        title: 'Auth Error',
        problem: '401 Authentication failed',
        source: 'system',
        severity: 1,
        count: 3,
        resolved: false
      },
      {
        id: 'err002',
        date: '2026-04-06',
        title: 'Rate Limit',
        problem: '429 Too Many Requests',
        source: 'api',
        severity: 2,
        count: 5,
        resolved: false
      },
      {
        id: 'err003',
        date: '2026-04-05',
        title: 'Network Error',
        problem: 'EAI_AGAIN network failure',
        source: 'system',
        severity: 3,
        count: 2,
        resolved: true,
        resolvedAt: '2026-04-06T10:00:00.000Z',
        resolvedBy: 'auto-resolve'
      }
    ]
  };

  // Generate report
  const report = generator.generate(sampleData, '2026-04-07');
  log('\n📋 Generated Report:');
  log(`  Title: ${report.title}`);
  log(`  Sections: ${report.sections.map(s => `${s.name}(${s.items.length})`).join(', ')}`);
  log(`  Stats: ${JSON.stringify(generator.getStats(report))}`);

  // Markdown output
  log('\n📄 Markdown Output:');
  log('-'.repeat(60));
  log(generator.toMarkdown(report));

  // Discord embed
  log('\n📱 Discord Embed:');
  log('-'.repeat(60));
  const embed = generator.toDiscordEmbed(report);
  log(`  Title: ${embed.title}`);
  log(`  Color: 0x${embed.color.toString(16)}`);
  log(`  Fields: ${embed.fields.length}`);

  // JSON output
  log('\n📦 JSON Output (preview):');
  log('-'.repeat(60));
  const json = generator.toJSON(report);
  log(json.slice(0, 500) + '...');

  log('\n' + '='.repeat(60));
  log('✅ Demo completed!');
}
