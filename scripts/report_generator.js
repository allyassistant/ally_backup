#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Report Generator Module
 * Uses templates from report_templates.js to generate standardized reports
 */

const path = require('path');
const fs = require('fs');
const { WS } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');

const {
  dailySummaryTemplate,
  stockReportTemplate,
  errorReportTemplate,
  memoryCleanupTemplate,
  tokenReportTemplate,
  backupReportTemplate,
  issueReportTemplate,
  healthReportTemplate,
  reminderReportTemplate,
  TEMPLATES,
  formatDate,
  REPORT_VERSION
} = require('./report_templates');

// ============================================================================
// DATA FORMATTING UTILITIES
// ============================================================================

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format number as currency
 * @param {number} value - Value to format
 * @param {string} currency - Currency code (default: 'USD')
 * @returns {string} Formatted currency string
 */
function formatCurrency(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(value);
}

/**
 * Format number with locale separators
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Format value as percentage
 * @param {number} value - Value to format (e.g., 0.75)
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage string (e.g., "75.0%")
 */
function formatPercent(value, decimals = 1) {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Report Generator Class
 * Generates standardized reports using templates
 */
class ReportGenerator {
  /**
   * Constructor
   * @param {object} options - Configuration options
   * @param {string} options.outputDir - Output directory for saved reports
   * @param {string} options.defaultFormat - Default output format (markdown/json)
   */
  constructor(options = {}) {
    let outputDir;
    try {
      outputDir = options.outputDir || path.join(WS, 'reports');
    } catch (e) {
      console.error(`⚠️ Failed to create outputDir: ${e.message}`);
      outputDir = '/tmp/reports';
    }
    this.options = {
      outputDir,
      defaultFormat: options.defaultFormat || 'markdown',
      ...options
    };

    // Ensure output directory exists
    try {
      if (!fs.existsSync(this.options.outputDir)) {
        fs.mkdirSync(this.options.outputDir, { recursive: true });
      }
    } catch (err) {
      console.error(`⚠️ Failed to create output directory: ${err.message}`);
    }
  }

  /**
   * Generate a report using a template
   * @param {string} templateName - Template name from TEMPLATES registry
   * @param {object} data - Data to populate the report
   * @param {object} options - Additional options
   * @returns {object} Generated report object
   */
  generate(templateName, data = {}, options = {}) {
    const templateFn = TEMPLATES[templateName];
    if (!templateFn) {
      throw new Error(`Unknown template: ${templateName}. Available: ${Object.keys(TEMPLATES).join(', ')}`);
    }

    // Generate base report structure from template
    const report = templateFn(data);

    // Populate each section with data
    report.sections = report.sections.map(section => {
      return this.populateSection(section, data, report.format);
    });

    // Add generator metadata
    report.generatedBy = 'ReportGenerator';
    report.generatorVersion = REPORT_VERSION;
    report.options = options;

    return report;
  }

  /**
   * Populate a section with data based on section name and format
   * @param {object} section - Section object from template
   * @param {object} data - Input data
   * @param {string} format - Report format
   * @returns {object} Populated section
   */
  populateSection(section, data, format) {
    const populated = { ...section };
    const sectionName = section.name;

    // Map section names to data fields
    const sectionDataMap = {
      // Daily Summary
      '✍️ 今日工作': data.work,
      '💡 學習反思': data.reflections,
      '🎯 明日計劃': data.plans,

      // Stock Report
      '📈 總覽 (總數/總值)': {
        totalCount: data.totalCount,
        totalValue: data.totalValue,
        summary: data.summary
      },
      '🔄 變動 (新增/售出)': data.changes,
      '💰 估值摘要': data.valuation,

      // Error Report
      '🔴 Critical Errors': data.criticalErrors,
      '🟡 Warnings': data.warnings,
      '🔧 Auto-Fixed': data.autoFixed,

      // Memory Cleanup
      '📦 Deleted Files': data.deletedFiles,
      '💾 Space Freed': data.spaceFreed,
      '⭐ Key Memories Preserved': data.preservedMemories,

      // Token Report
      '📊 Current Usage': data.currentUsage,
      '📈 Trend (7 days)': data.trend,
      '⚠️ Warnings': data.tokenWarnings || data.warnings,

      // Backup Report
      '✅ Successful': data.successful,
      '⚠️ Failed': data.failed,
      '📋 Summary': data.summary,

      // Issue Report
      '🟢 Active': data.active,
      '🟡 Backlog': data.backlog,
      '✅ Completed': data.completed,

      // Health Report
      '🤖 Services Status': data.services,
      '💻 Resources': data.resources,
      '⚠️ Alerts': data.alerts,

      // Reminder Report
      '📅 Due Today': data.dueToday,
      '⏳ Overdue': data.overdue,
      '✅ Completed': data.reminderCompleted || data.completed
    };

    // Get raw data for this section
    const rawData = sectionDataMap[sectionName];
    populated.data = rawData !== undefined ? rawData : null;

    // Format content based on data type and format
    populated.content = this.formatContent(rawData, format, sectionName);

    return populated;
  }

  /**
   * Format content based on data type and output format
   * @param {any} data - Raw data
   * @param {string} format - Target format
   * @param {string} sectionName - Section name for context
   * @returns {string} Formatted content
   */
  formatContent(data, format, sectionName) {
    if (data === null || data === undefined) {
      return '(No data available)';
    }

    // Handle arrays
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return '(Empty list)';
      }

      if (format === 'markdown') {
        return data.map(item => {
          if (typeof item === 'string') {
            return `- ${item}`;
          }
          if (typeof item === 'object') {
            return `- ${JSON.stringify(item)}`;
          }
          return `- ${String(item)}`;
        }).join('\n');
      }

      return JSON.stringify(data, null, 2);
    }

    // Handle numbers (especially for metrics)
    if (typeof data === 'number') {
      if (sectionName.includes('Space') || sectionName.includes('Usage')) {
        // Format bytes
        if (data > 1024 * 1024 * 1024) {
          return `${(data / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        } else if (data > 1024 * 1024) {
          return `${(data / (1024 * 1024)).toFixed(2)} MB`;
        } else if (data > 1024) {
          return `${(data / 1024).toFixed(2)} KB`;
        }
        return `${data} bytes`;
      }

      if (sectionName.includes('Value') || sectionName.includes('估值')) {
        return `$${data.toLocaleString()}`;
      }

      return data.toLocaleString();
    }

    // Handle objects
    if (typeof data === 'object') {
      if (format === 'markdown') {
        return Object.entries(data)
          .map(([key, value]) => `- **${key}**: ${this.formatValue(value)}`)
          .join('\n');
      }
      return JSON.stringify(data, null, 2);
    }

    // Handle strings and other types
    return String(data);
  }

  /**
   * Format a single value for display
   * @param {any} value - Value to format
   * @returns {string} Formatted value
   */
  formatValue(value) {
    if (value === null || value === undefined) {
      return 'N/A';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Convert report to Markdown string
   * @param {object} report - Report object
   * @returns {string} Markdown formatted string
   */
  toMarkdown(report) {
    let md = `# ${report.title}\n\n`;
    md += `*Generated: ${report.generatedAt}*\n`;
    md += `*Version: ${report.version}*\n\n`;

    if (report.metadata) {
      md += `---\n`;
      Object.entries(report.metadata).forEach(([key, value]) => {
        md += `**${key}**: ${value}  \n`;
      });
      md += `---\n\n`;
    }

    report.sections.forEach(section => {
      md += `## ${section.name}\n`;
      md += `${section.content || '(No content)'}\n\n`;
    });

    if (report.generatedBy) {
      md += `---\n`;
      md += `*Generated by: ${report.generatedBy} v${report.generatorVersion}*\n`;
    }

    return md;
  }

  /**
   * Convert report to JSON string
   * @param {object} report - Report object
   * @returns {string} JSON formatted string
   */
  toJSON(report) {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Save report to file
   * @param {object} report - Report object
   * @param {string} filename - Output filename
   * @param {string} format - Output format (markdown/json)
   * @returns {string} Path to saved file
   */
  save(report, filename, format = null) {
    const outputFormat = format || this.options.defaultFormat;
    const content = outputFormat === 'markdown' ? this.toMarkdown(report) : this.toJSON(report);

    // Ensure filename has correct extension
    let finalFilename = filename;
    if (outputFormat === 'markdown' && !filename.endsWith('.md')) {
      finalFilename = `${filename}.md`;
    } else if (outputFormat === 'json' && !filename.endsWith('.json')) {
      finalFilename = `${filename}.json`;
    }

    const safeFilename = path.basename(finalFilename); // Sanitize filename
    const filepath = path.join(this.options.outputDir, safeFilename);
    // HR-079: Atomic write for report save
    const tmpPath = filepath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, filepath);
    } catch (err) {
      console.error(`⚠️ Failed to save report to ${filepath}: ${err.message}`);
      throw err;
    }

    return filepath;
  }

  /**
   * List available templates
   * @returns {Array<string>} List of template names
   */
  listTemplates() {
    return Object.keys(TEMPLATES);
  }

  /**
   * Get template info
   * @param {string} templateName - Template name
   * @returns {object} Template information
   */
  getTemplateInfo(templateName) {
    const templateFn = TEMPLATES[templateName];
    if (!templateFn) {
      throw new Error(`Unknown template: ${templateName}`);
    }

    // Generate a sample report to get structure
    const sample = templateFn({ date: 'YYYY-MM-DD' });

    return {
      name: templateName,
      title: sample.title,
      sections: sample.sections.map(s => s.name),
      format: sample.format
    };
  }

  // ============================================================================
  // NEW FEATURES: Data Formatting & Output Methods
  // ============================================================================

  /**
   * Convert report to Discord embed format
   * @param {object} report - Report object
   * @returns {object} Discord embed object
   */
  toDiscordEmbed(report) {
    const colors = {
      'daily-summary': 0x3498db,    // Blue
      'stock': 0x2ecc71,           // Green
      'error': 0xe74c3c,           // Red
      'memory-cleanup': 0x9b59b6,  // Purple
      'token': 0xf1c40f,           // Yellow
      'backup': 0x1abc9c,          // Teal
      'issue': 0xe67e22,           // Orange
      'health': 0x34495e,          // Dark
      'reminder': 0x95a5a6,        // Gray
      'system-check': 0x9b59b6     // Purple for system check
    };

    // Truncate content if too long (Discord field value limit is 1024 chars)
    const truncate = (text, maxLen = 1024) => {
      if (!text) return '(No data)';
      if (text.length <= maxLen) return text;
      return text.substring(0, maxLen - 3) + '...';
    };

    // Determine inline based on section name (not inline for longer content)
    const shouldInline = (sectionName) => {
      const noInlineSections = ['提醒事項', '活躍錯誤', '腳本'];
      return !noInlineSections.some(s => sectionName.includes(s));
    };

    const embed = {
      title: report.title,
      color: colors[report.metadata?.templateName] || 0x3498db,
      fields: report.sections.map(section => ({
        name: truncate(section.name, 256),  // Discord limit for name is 256
        value: truncate(section.content || '(No data)'),
        inline: shouldInline(section.name)
      })),
      footer: {
        text: `Generated: ${report.generatedAt}`
      },
      timestamp: new Date().toISOString()
    };

    // Add metadata as description if available
    if (report.metadata) {
      const metaText = Object.entries(report.metadata)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' | ');
      embed.description = truncate(metaText, 4096);  // Discord description limit
    }

    return embed;
  }

  /**
   * Convert data array to markdown table format
   * @param {Array<object>} data - Array of data objects
   * @param {Array<object>} columns - Column definitions [{key, header, align}]
   * @returns {string} Markdown formatted table
   */
  toTable(data, columns) {
    if (!Array.isArray(data) || data.length === 0) {
      return '(No data)';
    }

    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error('Columns definition is required');
    }

    // Validate column definitions
    columns.forEach((col, idx) => {
      if (!col.key || !col.header) {
        throw new Error(`Column ${idx} must have 'key' and 'header' properties`);
      }
    });

    // Build header row
    const header = columns.map(c => c.header).join(' | ');

    // Build separator row with alignment
    const separator = columns.map(c => {
      const align = c.align || 'left';
      if (align === 'center') return ':---:';
      if (align === 'right') return '---:';
      return '---';  // left align (default)
    }).join(' | ');

    // Build data rows
    const rows = data.map(item =>
      columns.map(c => {
        const value = item[c.key];
        // Handle null/undefined
        if (value === null || value === undefined) return '';
        // Convert to string and escape pipe characters
        return String(value).replace(/\|/g, '\\|');
      }).join(' | ')
    );

    return [header, separator, ...rows].join('\n');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = ReportGenerator;

// Also export individual functions for convenience
module.exports.ReportGenerator = ReportGenerator;
module.exports.TEMPLATES = TEMPLATES;
module.exports.formatDate = formatDate;
module.exports.REPORT_VERSION = REPORT_VERSION;

// Export new data formatting utilities
module.exports.formatBytes = formatBytes;
module.exports.formatCurrency = formatCurrency;
module.exports.formatNumber = formatNumber;
module.exports.formatPercent = formatPercent;

// ============================================================================
// CLI DEMO
// ============================================================================

if (require.main === module) {
  log('📝 Report Generator CLI Demo\n');
  log('=' .repeat(60));

  const generator = new ReportGenerator();

  // Show available templates
  log('\n📋 Available Templates:');
  generator.listTemplates().forEach(name => {
    const info = generator.getTemplateInfo(name);
    log(`  • ${name}: ${info.title}`);
  });

  log('\n' + '='.repeat(60));

  // ============================================================
  // NEW FEATURE 1: Data Formatting Utilities Demo
  // ============================================================
  log('\n🔧 FEATURE 1: Data Formatting Utilities');
  log('-'.repeat(60));

  log('\n📦 formatBytes():');
  log(`  formatBytes(0)           = "${formatBytes(0)}"`);
  log(`  formatBytes(1024)        = "${formatBytes(1024)}"`);
  log(`  formatBytes(1536000)     = "${formatBytes(1536000)}"`);
  log(`  formatBytes(1073741824)  = "${formatBytes(1073741824)}"`);

  log('\n💰 formatCurrency():');
  log(`  formatCurrency(1234.56)           = "${formatCurrency(1234.56)}"`);
  log(`  formatCurrency(1234.56, 'EUR')    = "${formatCurrency(1234.56, 'EUR')}"`);
  log(`  formatCurrency(1234.56, 'HKD')    = "${formatCurrency(1234.56, 'HKD')}"`);
  log(`  formatCurrency(1234567.89, 'USD') = "${formatCurrency(1234567.89, 'USD')}"`);

  log('\n🔢 formatNumber():');
  log(`  formatNumber(1234)      = "${formatNumber(1234)}"`);
  log(`  formatNumber(1234567)   = "${formatNumber(1234567)}"`);
  log(`  formatNumber(1234567890) = "${formatNumber(1234567890)}"`);

  log('\n📊 formatPercent():');
  log(`  formatPercent(75)         = "${formatPercent(75)}"`);
  log(`  formatPercent(12.34)      = "${formatPercent(12.34)}"`);
  log(`  formatPercent(12.34, 2)   = "${formatPercent(12.34, 2)}"`);
  log(`  formatPercent(12.34, 0)   = "${formatPercent(12.34, 0)}"`);

  // ============================================================
  // NEW FEATURE 2: Discord Embed Output Demo
  // ============================================================
  log('\n\n🎨 FEATURE 2: Discord Embed Output');
  log('-'.repeat(60));

  const stockReport = generator.generate('stock', {
    date: formatDate(),
    totalCount: 150,
    totalValue: 2500000,
    changes: {
      added: 15,
      sold: 8,
      netChange: '+7'
    },
    valuation: {
      averagePrice: 16667,
      topCategory: 'Round Brilliant'
    }
  });

  const discordEmbed = generator.toDiscordEmbed(stockReport);
  log('\n📱 Discord Embed Structure:');
  log(`  Title: ${discordEmbed.title}`);
  log(`  Color: 0x${discordEmbed.color.toString(16)} (Green for stock template)`);
  log(`  Fields: ${discordEmbed.fields.length}`);
  discordEmbed.fields.forEach((field, idx) => {
    log(`    [${idx + 1}] ${field.name}: ${field.value.substring(0, 40)}${field.value.length > 40 ? '...' : ''}`);
  });
  log(`  Footer: ${discordEmbed.footer.text}`);
  log(`  Timestamp: ${discordEmbed.timestamp}`);

  // Show different template colors
  log('\n🎨 Template Colors:');
  const colorDemo = ['daily-summary', 'stock', 'error', 'memory-cleanup', 'token'];
  colorDemo.forEach(template => {
    const report = generator.generate(template, { date: formatDate() });
    const embed = generator.toDiscordEmbed(report);
    log(`  ${template.padEnd(15)} = 0x${embed.color.toString(16).padStart(6, '0')}`);
  });

  // ============================================================
  // NEW FEATURE 3: Table Format for Stock Report Demo
  // ============================================================
  log('\n\n📊 FEATURE 3: Table Format');
  log('-'.repeat(60));

  // Sample stock data
  const stockData = [
    { shape: 'Round', carat: 1.5, color: 'D', value: 25000 },
    { shape: 'Princess', carat: 1.2, color: 'E', value: 18000 },
    { shape: 'Emerald', carat: 2.0, color: 'F', value: 32000 },
    { shape: 'Oval', carat: 1.8, color: 'G', value: 28000 }
  ];

  const stockColumns = [
    { key: 'shape', header: 'Shape', align: 'left' },
    { key: 'carat', header: 'Carat', align: 'right' },
    { key: 'color', header: 'Color', align: 'center' },
    { key: 'value', header: 'Value', align: 'right' }
  ];

  const stockTable = generator.toTable(stockData, stockColumns);
  log('\n📋 Stock Table (Markdown format):');
  log(stockTable);

  // Demo with different data types
  log('\n\n📋 Error Report Table:');
  const errorData = [
    { level: 'Critical', message: 'Database timeout', count: 5 },
    { level: 'Warning', message: 'High memory usage', count: 12 },
    { level: 'Info', message: 'Cache refreshed', count: 48 }
  ];

  const errorColumns = [
    { key: 'level', header: 'Level', align: 'center' },
    { key: 'message', header: 'Message', align: 'left' },
    { key: 'count', header: 'Count', align: 'right' }
  ];

  log(generator.toTable(errorData, errorColumns));

  // Edge case demos
  log('\n\n📋 Edge Cases:');
  log('  Empty data:');
  log(`    ${generator.toTable([], stockColumns)}`);
  log('  Null values:');
  const nullData = [
    { shape: 'Round', carat: null, color: 'D', value: 25000 },
    { shape: null, carat: 1.2, color: 'E', value: undefined }
  ];
  log(generator.toTable(nullData, stockColumns));

  // ============================================================
  // Original Demo: Daily Summary Report
  // ============================================================
  log('\n\n📝 Demo: Daily Summary Report');
  log('-'.repeat(60));

  const dailyData = {
    date: formatDate(),
    work: ['處理用戶查詢', '更新系統設定', '修復 Bug #123'],
    reflections: ['學到新嘢：async/await 進階用法', '改善了錯誤處理流程'],
    plans: ['繼續優化報告生成器', '準備週末部署']
  };

  const dailyReport = generator.generate('daily-summary', dailyData);
  log('\nGenerated Report Structure:');
  log(`  Title: ${dailyReport.title}`);
  log(`  Sections: ${dailyReport.sections.length}`);
  dailyReport.sections.forEach(section => {
    log(`    - ${section.name}: ${section.content?.split('\n').length || 0} lines`);
  });

  log('\nMarkdown Output (preview):');
  const dailyMarkdown = generator.toMarkdown(dailyReport);
  log(dailyMarkdown.split('\n').slice(0, 15).join('\n'));
  log('...');

  // ============================================================
  // Demo: Save reports
  // ============================================================
  log('\n\n💾 Demo: Save Reports');
  log('-'.repeat(60));

  const savedFiles = [];

  try {
    // Save with new features
    const stockMd = generator.toMarkdown(stockReport);
    const stockTableMd = '\n\n## 📊 Stock Table\n\n' + stockTable;
    const combinedStock = stockMd + stockTableMd;

    const stockPath = path.join(generator.options.outputDir, 'stock-report-with-table.md');
    // HR-079: Atomic write for stock report
    const stockTmpPath = stockPath + '.tmp';
    try {
      fs.writeFileSync(stockTmpPath, combinedStock, 'utf8');
      fs.renameSync(stockTmpPath, stockPath);
      savedFiles.push(stockPath);
      log(`✅ Saved: ${stockPath}`);
    } catch (e) {
      log(`⚠️ Failed to save stock report: ${e.message}`);
    }

    const dailyPath = generator.save(dailyReport, 'daily-summary-demo', 'markdown');
    savedFiles.push(dailyPath);
    log(`✅ Saved: ${dailyPath}`);

    const errorReport = generator.generate('error', {
      date: formatDate(),
      criticalErrors: ['Database connection timeout', 'API rate limit exceeded'],
      warnings: ['High memory usage', 'Slow query detected'],
      autoFixed: ['Temporary file cleanup', 'Cache refresh']
    });

    const errorPath = generator.save(errorReport, 'error-report-demo');
    savedFiles.push(errorPath);
    log(`✅ Saved: ${errorPath}`);

    // Save Discord embed as JSON for reference
    // HR-079: Atomic write for Discord embed JSON
    const embedPath = path.join(generator.options.outputDir, 'discord-embed-demo.json');
    const embedTmpPath = embedPath + '.tmp';
    try {
      fs.writeFileSync(embedTmpPath, JSON.stringify(discordEmbed, null, 2), 'utf8');
      fs.renameSync(embedTmpPath, embedPath);
      savedFiles.push(embedPath);
      log(`✅ Saved Discord embed: ${embedPath}`);
    } catch (e) {
      log(`⚠️ Failed to save Discord embed: ${e.message}`);
    }

    log(`\n📁 All reports saved to: ${generator.options.outputDir}`);

    // Clean up demo files
    log('\n🧹 Cleaning up demo files...');
    savedFiles.forEach(filepath => {
      try {
        fs.unlinkSync(filepath);
        log(`  🗑️  Deleted: ${path.basename(filepath)}`);
      } catch (e) {
        // Ignore cleanup errors
      }
    });

  } catch (error) {
    log(`⚠️  Save demo skipped: ${error.message}`);
  }

  // ============================================================
  // Feature Test Summary
  // ============================================================
  log('\n\n' + '='.repeat(60));
  log('✅ Feature Test Summary');
  log('='.repeat(60));

  const tests = [
    { name: 'formatBytes()', pass: formatBytes(1024) === '1 KB' },
    { name: 'formatCurrency()', pass: formatCurrency(100).startsWith('$') },
    { name: 'formatNumber()', pass: formatNumber(1000) === '1,000' },
    { name: 'formatPercent()', pass: formatPercent(75) === '75.0%' },
    { name: 'toDiscordEmbed()', pass: typeof generator.toDiscordEmbed(stockReport) === 'object' },
    { name: 'toTable()', pass: generator.toTable(stockData, stockColumns).includes('Shape | Carat') },
    { name: 'Backward Compatible', pass: typeof generator.toMarkdown === 'function' && typeof generator.toJSON === 'function' }
  ];

  let passCount = 0;
  tests.forEach(test => {
    const status = test.pass ? '✅' : '❌';
    if (test.pass) passCount++;
    log(`  ${status} ${test.name}`);
  });

  log(`\n📊 Test Results: ${passCount}/${tests.length} passed`);

  log('\n' + '='.repeat(60));
  log('✅ Demo completed!');
  log('\nUsage example:');
  log(`
const {
  ReportGenerator,
  formatBytes,
  formatCurrency,
  formatNumber,
  formatPercent
} = require('./report_generator');

const generator = new ReportGenerator();

// Generate report
const report = generator.generate('daily-summary', {
  date: '2026-03-23',
  work: ['Task 1', 'Task 2'],
  reflections: ['Learned something'],
  plans: ['Plan 1']
});

// Convert to Discord embed
const discordEmbed = generator.toDiscordEmbed(report);

// Create table
const table = generator.toTable(data, [
  { key: 'name', header: 'Name', align: 'left' },
  { key: 'value', header: 'Value', align: 'right' }
]);

// Format utilities
log(formatBytes(1024));        // "1 KB"
log(formatCurrency(100));      // "$100.00"
log(formatNumber(1000));       // "1,000"
log(formatPercent(0.75));      // "75.0%"

// Save report
const filepath = generator.save(report, 'my-report', 'markdown');
log('Report saved to:', filepath);
  `);
}
