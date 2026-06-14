#!/usr/bin/env node
/**
 * weekly_correction_generator.js - Weekly Correction Report Generator
 * ====================================================================
 * 負責將 Weekly Correction data 格式化為不同輸出
 *
 * 職責：
 * - 格式化為 Markdown
 * - 格式化為 Discord Embed
 * - 格式化為 JSON
 * - 格式化為 Simple text
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-04-09)
 */

'use strict';

const {
  CONFIG,
  createWeeklyCorrectionReportStructure,
  createTrendItem,
  createTopPatternItem,
  createRecommendation
} = require('./weekly_correction_templates');

// ============================================================================
// REPORT GENERATOR CLASS
// ============================================================================

class WeeklyCorrectionReportGenerator {
  /**
   * Constructor
   *
   * @param {Object} options - Generator options
   */
  constructor(options = {}) {
    this.options = {
      maxPatterns: options.maxPatterns || CONFIG.CLI_MAX_PATTERNS,
      maxTrends: options.maxTrends || CONFIG.CLI_MAX_TRENDS,
      ...options
    };

    this.report = null;
  }

  /**
   * Generate report structure from weekly correction data
   *
   * @param {Object} data - Weekly correction data
   * @param {string} date - Report date
   * @returns {Object} Report structure
   */
  generate(data, date) {
    // Process patterns to get top patterns
    const patterns = data.patterns || [];
    const lastErrorStats = data.lastErrorStats || { errorTypes: {} };

    const patternEntries = Object.entries(patterns);
    const topPatterns = patternEntries.length > 0
      ? patternEntries
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, this.options.maxPatterns)
          .map(([key, patternData]) => {
            const lastCount = lastErrorStats.errorTypes?.[key] || 0;
            return createTopPatternItem(key, patternData.count, lastCount);
          })
      : [];

    // Process trend analysis
    let trendAnalysis = [];
    if (lastErrorStats.errorTypes && Object.keys(lastErrorStats.errorTypes).length > 0) {
      const currentTypes = {};
      for (const [key, patternData] of Object.entries(patterns)) {
        currentTypes[key] = patternData.count;
      }

      for (const [type, lastCount] of Object.entries(lastErrorStats.errorTypes)) {
        const currentCount = currentTypes[type] || 0;
        if (currentCount > lastCount) {
          trendAnalysis.push(createTrendItem(type, currentCount - lastCount, 'up'));
        } else if (currentCount < lastCount && currentCount > 0) {
          trendAnalysis.push(createTrendItem(type, lastCount - currentCount, 'down'));
        }
      }

      // New types this week
      for (const type of Object.keys(currentTypes)) {
        if (!(type in (lastErrorStats.errorTypes || {}))) {
          trendAnalysis.push(createTrendItem(type, currentTypes[type], 'new'));
        }
      }
    }

    // Calculate recommendations
    const recommendations = this._generateRecommendations(data);

    this.report = createWeeklyCorrectionReportStructure({
      date,
      totalErrors: data.totalErrors || 0,
      patternCount: data.patternCount || 0,
      categorizedCount: Object.keys(data.categorizedErrors || {}).length,
      trendChange: data.trendChange || 0,
      lastWeekTotal: lastErrorStats.total || 0,
      newRulesCount: data.newRulesCount || 0,
      auditRulesCount: data.auditRulesCount || 0,
      patterns,
      topPatterns,
      trendAnalysis: trendAnalysis.slice(0, this.options.maxTrends),
      auditChanged: data.auditChanged || false,
      p0Count: data.p0Count || 0,
      p1Count: data.p1Count || 0,
      lastAuditReportDate: data.lastAuditReportDate || null,
      autoAppliedRules: data.autoAppliedRules || [],
      categorizedErrors: data.categorizedErrors || {},
      recommendations
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

  /**
   * Generate recommendations based on data
   *
   * @param {Object} data - Weekly correction data
   * @returns {Array} Recommendations
   */
  _generateRecommendations(data) {
    const recommendations = [];

    if (data.p0Count > 0) {
      recommendations.push(createRecommendation('critical', `處理 ${data.p0Count} 個 P0 代碼問題`));
    } else if (data.trendAnalysis && data.trendAnalysis.filter(t => t.direction === 'up').length > 0) {
      recommendations.push(createRecommendation('warning', '監控上升趨勢的錯誤類型'));
    } else {
      recommendations.push(createRecommendation('success', '系統健康，保持現狀'));
    }

    return recommendations;
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

    const trendArrow = r.summary.trendChange > 0 ? '↑' :
                       r.summary.trendChange < 0 ? '↓' : '→';

    let md = `# 每週校正循環報告\n\n`;
    md += `Generated: ${r.generatedAt}\n\n`;

    // Summary section
    md += `## ${CONFIG.TITLES.SECTION_ERRORS}\n\n`;
    md += `- **本週錯誤**: ${r.summary.totalErrors} 個\n`;
    md += `- **模式數量**: ${r.summary.patternCount} 種\n`;
    md += `- **趨勢**: ${trendArrow}${Math.abs(r.summary.trendChange)}% (vs 上週 ${r.summary.lastWeekTotal} 個)\n`;
    md += `- **AI 分類**: ${r.summary.categorizedCount} 個類別\n\n`;

    // Top patterns section
    md += `## ${CONFIG.TITLES.SECTION_TOP_PATTERNS}\n\n`;
    if (r.topPatterns && r.topPatterns.length > 0) {
      r.topPatterns.forEach((p, i) => {
        md += `${i + 1}. **${p.pattern}** (${p.count}x) ${p.diffArrow}\n`;
      });
    } else {
      md += `本週冇錯誤\n`;
    }
    md += `\n`;

    // Trend analysis section
    md += `## ${CONFIG.TITLES.SECTION_TRENDS}\n\n`;
    if (r.trendAnalysis && r.trendAnalysis.length > 0) {
      r.trendAnalysis.forEach(t => {
        md += `- ${t.emoji} **${t.type}**: ${t.label}\n`;
      });
    } else {
      md += `無上週數據對比\n`;
    }
    md += `\n`;

    // Audit section
    md += `## ${CONFIG.TITLES.SECTION_AUDIT}\n\n`;
    if (r.audit.changed) {
      md += `- 🆕 審計有變化！發現 ${r.audit.p0Count} 個 P0, ${r.audit.p1Count} 個 P1\n`;
    } else {
      md += `- 無變化 (上次報告: ${r.audit.lastReportDate || '從未'})\n`;
    }
    md += `\n`;

    // Auto fix section
    md += `## ${CONFIG.TITLES.SECTION_AUTO_FIX}\n\n`;
    md += r.summary.newRulesCount > 0
      ? `- 本週新增 ${r.summary.newRulesCount} 條規則\n`
      : `- 本週無新規則\n`;
    md += r.summary.auditRulesCount > 0
      ? `- Prevention Rules: ${r.summary.auditRulesCount} 條已生效\n`
      : `- Prevention Rules: 無\n`;
    md += `\n`;

    // Recommendations section
    md += `## ${CONFIG.TITLES.SECTION_RECOMMENDATIONS}\n\n`;
    if (r.recommendations && r.recommendations.length > 0) {
      r.recommendations.forEach(rec => {
        md += `${rec.emoji} ${rec.message}\n`;
      });
    }
    md += `\n`;

    md += `---\n`;
    md += `*🤖 由 Ally 生成 | 每週校正循環 v4*\n`;

    return md;
  }

  /**
   * Convert to Discord message format (plain text with embeds)
   *
   * @param {Object} report - Report (uses this.report if not provided)
   * @returns {string} Discord formatted string
   */
  toDiscord(report = null) {
    const r = report || this.report;
    if (!r) return '';

    const trendArrow = r.summary.trendChange > 0 ? '↑' :
                       r.summary.trendChange < 0 ? '↓' : '→';

    const lines = [
      `🔄 **每週校正循環報告** | ${r.metadata.date}`,
      ``,
      `📊 本週錯誤概覽`,
      `• 本週: ${r.summary.totalErrors} 個錯誤，${r.summary.patternCount} 種模式 (${trendArrow}${Math.abs(r.summary.trendChange)}% vs 上週 ${r.summary.lastWeekTotal} 個)`,
      `• AI 分類: ${r.summary.categorizedCount} 個類別`,
      ``,
      `🔴 本週主要問題 (Top 3)`,
      ...(r.topPatterns.length > 0
        ? r.topPatterns.map((p, i) => {
            const diff = p.count - p.lastCount;
            const diffArrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
            return `${i + 1}. ${p.pattern} (${p.count}x) ${diffArrow}`;
          })
        : ['• 本週冇錯誤']),
      ``,
      `📈 趨勢分析`,
      ...(r.trendAnalysis.length > 0
        ? r.trendAnalysis.map(t => `${t.emoji} ${t.type}: ${t.label}`)
        : ['• 無上週數據對比']),
      ``,
      `🔍 Pure AI Audit`,
      ...(r.audit.changed
        ? [`• 🆕 審計有變化！發現 ${r.audit.p0Count} 個 P0, ${r.audit.p1Count} 個 P1`]
        : [`• 無變化 (上次報告: ${r.audit.lastReportDate || '從未'})`]),
      ``,
      `🛠️ 自動修復`,
      r.summary.newRulesCount > 0
        ? `• 本週新增 ${r.summary.newRulesCount} 條規則`
        : `• 本週無新規則`,
      r.summary.auditRulesCount > 0
        ? `• Prevention Rules: ${r.summary.auditRulesCount} 條已生效`
        : `• Prevention Rules: 無`,
      ``,
      `💡 下週行動建議`,
      ...(r.recommendations.length > 0
        ? r.recommendations.map(rec => `${rec.emoji} ${rec.message}`)
        : ['🎉 系統健康，保持現狀']),
      ``,
      `🤖 由 Ally 生成 | 每週校正循環 v4`
    ];

    return lines.join('\n');
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

    // Truncate helper
    const truncate = (text, maxLen = 1024) => {
      if (!text) return '(No data)';
      if (text.length <= maxLen) return text;
      return text.slice(0, maxLen - 3) + '...';
    };

    // Build summary text
    const trendArrow = r.summary.trendChange > 0 ? '↑' :
                       r.summary.trendChange < 0 ? '↓' : '→';
    const summaryText = [
      `本週: ${r.summary.totalErrors} 個錯誤`,
      `模式: ${r.summary.patternCount} 種`,
      `趨勢: ${trendArrow}${Math.abs(r.summary.trendChange)}%`
    ].join(' | ');

    const fields = [];

    // Add summary as first field
    fields.push({
      name: '📊 錯誤概覽',
      value: truncate(summaryText),
      inline: false
    });

    // Add top patterns
    if (r.topPatterns.length > 0) {
      const patternList = r.topPatterns.map((p, i) => {
        const diff = p.count - p.lastCount;
        const diffArrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
        return `${i + 1}. ${p.pattern}: ${p.count}x ${diffArrow}`;
      }).join('\n');

      fields.push({
        name: '🔴 主要問題 (Top 3)',
        value: truncate(patternList),
        inline: false
      });
    }

    // Add trend analysis
    if (r.trendAnalysis.length > 0) {
      const trendList = r.trendAnalysis.map(t => `${t.emoji} ${t.type}: ${t.label}`).join('\n');
      fields.push({
        name: '📈 趨勢分析',
        value: truncate(trendList),
        inline: false
      });
    }

    // Add audit status
    const auditText = r.audit.changed
      ? `🆕 審計變化: P0=${r.audit.p0Count}, P1=${r.audit.p1Count}`
      : `✅ 無變化`;
    fields.push({
      name: '🔍 Pure AI Audit',
      value: truncate(auditText),
      inline: true
    });

    // Add auto-fix status
    const autoFixText = [
      `新規則: ${r.summary.newRulesCount}`,
      `Prevention: ${r.summary.auditRulesCount}`
    ].join(' | ');
    fields.push({
      name: '🛠️ 自動修復',
      value: truncate(autoFixText),
      inline: true
    });

    // Add recommendations
    if (r.recommendations.length > 0) {
      const recText = r.recommendations.map(rec => `${rec.emoji} ${rec.message}`).join('\n');
      fields.push({
        name: '💡 建議',
        value: truncate(recText),
        inline: false
      });
    }

    // Determine embed color based on severity
    let color = 0x3498db; // Default blue
    if (r.audit.p0Count > 0) color = CONFIG.SEVERITY_COLORS.critical;
    else if (r.audit.p1Count > 0) color = CONFIG.SEVERITY_COLORS.high;
    else if (r.summary.totalErrors > 10) color = CONFIG.SEVERITY_COLORS.medium;
    else color = CONFIG.SEVERITY_COLORS.low;

    const embed = {
      title: r.title || '🔄 每週校正循環報告',
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
   * Convert to simple text format
   *
   * @param {Object} report - Report (uses this.report if not provided)
   * @returns {string} Simple text format
   */
  toSimple(report = null) {
    const r = report || this.report;
    if (!r) return '';

    const lines = [
      `Weekly Correction Report - ${r.metadata.date}`,
      `Total Errors: ${r.summary.totalErrors}`,
      `Patterns: ${r.summary.patternCount}`,
      `Trend: ${r.summary.trendChange}%`,
      `New Rules: ${r.summary.newRulesCount}`,
      `Audit Rules: ${r.summary.auditRulesCount}`
    ];

    return lines.join('\n');
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Generate report and return in specified format
   *
   * @param {string} format - Output format (json/markdown/discord/simple)
   * @param {Object} data - Weekly correction data
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
      case 'discord':
        return this.toDiscord();
      case 'embed':
        return this.toDiscordEmbed();
      case 'simple':
        return this.toSimple();
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

    const dir = outputDir || '.state';
    const formats = options.formats || ['json', 'markdown'];
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
          filename = 'weekly_correction_report.json';
          break;
        case 'markdown':
        case 'md':
          content = this.toMarkdown();
          filename = 'weekly_correction_report.md';
          break;
        case 'discord':
          content = this.toDiscord();
          filename = 'weekly_correction_report.txt';
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
  WeeklyCorrectionReportGenerator
};
