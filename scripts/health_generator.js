#!/usr/bin/env node

/**
 * Health Generator Module
 * =======================
 * 負責將 health data 格式化為不同輸出格式。
 * 只做格式化，唔做 business logic。
 *
 * VERSION:    1.0.0
 * AUTHOR:     Ally (2026-04-07)
 *
 * USAGE:
 *   const { HealthReportGenerator } = require('./health_generator');
 *   const generator = new HealthReportGenerator();
 *
 *   generator.populate(report, healthData);
 *   console.log(generator.toMarkdown());
 *   console.log(generator.toDiscordEmbed());
 *
 * @module health_generator
 * @author Ally
 * @date 2026-04-07
 */

const {
  CONFIG,
  createHealthReportStructure,
  createServiceItem,
  createResourceItem,
  createErrorItem,
  createCronItem
} = require('./health_templates');

// ============================================================================
// HEALTH REPORT GENERATOR
// ============================================================================

class HealthReportGenerator {
  constructor() {
    this.report = null;
  }

  /**
   * Generate report structure with date
   * @param {string} date - Report date (YYYY-MM-DD)
   * @returns {object} Report structure
   */
  generate(date) {
    this.report = createHealthReportStructure(date);
    return this.report;
  }

  /**
   * Populate report with health check data
   * Maps raw check results to the appropriate section.
   *
   * @param {object} healthData - Raw health check data from check*() functions
   */
  populate(healthData) {
    if (!this.report) {
      throw new Error('Call generate() first');
    }

    // Services section: gateway, sessions, channels, model, memoryFiles
    const servicesSection = this.report.sections.find(s => s.name === 'services');
    if (servicesSection) {
      // Gateway
      if (healthData.gateway) {
        servicesSection.items.push(createServiceItem({
          name: 'Gateway',
          status: healthData.gateway.status || 'UNKNOWN',
          message: healthData.gateway.message || '',
          details: healthData.gateway.pid ? { pid: healthData.gateway.pid } : null
        }));
      }

      // Sessions
      if (healthData.sessions) {
        servicesSection.items.push(createServiceItem({
          name: 'Sessions',
          status: healthData.sessions.status || 'UNKNOWN',
          message: healthData.sessions.message || '',
          details: healthData.sessions.count !== undefined ? { count: healthData.sessions.count } : null
        }));
      }

      // Channels
      if (healthData.channels) {
        servicesSection.items.push(createServiceItem({
          name: 'Channels',
          status: healthData.channels.status || 'UNKNOWN',
          message: healthData.channels.message || '',
          details: healthData.channels
        }));
      }

      // Model
      if (healthData.model) {
        servicesSection.items.push(createServiceItem({
          name: 'Model',
          status: healthData.model.status || 'UNKNOWN',
          message: healthData.model.message || '',
          details: healthData.model.model ? { model: healthData.model.model } : null
        }));
      }

      // Memory Files
      if (healthData.memoryFiles) {
        servicesSection.items.push(createServiceItem({
          name: 'Memory Files',
          status: healthData.memoryFiles.status || 'UNKNOWN',
          message: healthData.memoryFiles.message || '',
          details: healthData.memoryFiles
        }));
      }
    }

    // Resources section: system, disk
    const resourcesSection = this.report.sections.find(s => s.name === 'resources');
    if (resourcesSection) {
      // System (CPU + Memory)
      if (healthData.system) {
        resourcesSection.items.push(createResourceItem({
          name: 'System',
          status: healthData.system.status || 'UNKNOWN',
          message: healthData.system.message || '',
          value: healthData.system.memPercent,
          available: healthData.system.memFreeGB ? `${healthData.system.memFreeGB}G free` : null,
          size: healthData.system.memTotalGB ? `${healthData.system.memTotalGB}G total` : null
        }));
      }

      // Disk
      if (healthData.disk) {
        resourcesSection.items.push(createResourceItem({
          name: 'Disk',
          status: healthData.disk.status || 'UNKNOWN',
          message: healthData.disk.message || '',
          value: healthData.disk.value,
          available: healthData.disk.available,
          size: healthData.disk.size
        }));
      }
    }

    // Errors section
    const errorsSection = this.report.sections.find(s => s.name === 'errors');
    if (errorsSection && healthData.errors) {
      errorsSection.items.push(createErrorItem({
        status: healthData.errors.status || 'OK',
        count: healthData.errors.count || 0,
        message: healthData.errors.message || '',
        recent: healthData.errors.recent || []
      }));
    }

    // Cron section
    const cronSection = this.report.sections.find(s => s.name === 'cron');
    if (cronSection && healthData.cron) {
      cronSection.items.push(createCronItem({
        status: healthData.cron.status || 'OK',
        totalJobs: healthData.cron.totalJobs || 0,
        requiredFound: healthData.cron.requiredFound || 0,
        requiredTotal: healthData.cron.requiredTotal || 0,
        missingJobs: healthData.cron.missingJobs || [],
        source: healthData.cron.source || 'unknown',
        message: healthData.cron.message || ''
      }));
    }
  }

  // ============================================================================
  // OUTPUT FORMATS
  // ============================================================================

  /**
   * Convert to Markdown format (console output style)
   * @returns {string} Markdown formatted report
   */
  toMarkdown() {
    if (!this.report) return '';

    const lines = [];
    lines.push('=== Health Monitor ===');
    lines.push(`Time: ${this.report.metadata?.generated ? new Date(this.report.metadata.generated).toLocaleTimeString('en-US', { timeZone: 'Asia/Hong_Kong' }) : ''}`);
    lines.push('');

    this.report.sections.forEach(section => {
      if (section.items.length === 0) return;

      if (section.name === 'services') {
        section.items.forEach(item => {
          lines.push(`${item.alert} ${item.name}: ${item.message}`);
        });
      } else if (section.name === 'resources') {
        section.items.forEach(item => {
          lines.push(`${item.alert} ${item.name}: ${item.message}`);
        });
      } else if (section.name === 'errors') {
        section.items.forEach(item => {
          lines.push(`${item.alert} Errors: ${item.message}`);
        });
      } else if (section.name === 'cron') {
        section.items.forEach(item => {
          lines.push(`${item.alert} Cron: ${item.message}`);
        });
      }
    });

    return lines.join('\n');
  }

  /**
   * Convert to Discord embed format
   * @returns {object} Discord embed object
   */
  toDiscordEmbed() {
    if (!this.report) return null;

    // Determine overall status color
    let overallStatus = 'OK';
    this.report.sections.forEach(section => {
      section.items.forEach(item => {
        if (item.status === 'CRITICAL' || item.status === 'EMERGENCY' || item.status === 'error') {
          overallStatus = 'CRITICAL';
        } else if (item.status === 'WARNING' && overallStatus !== 'CRITICAL') {
          overallStatus = 'WARNING';
        }
      });
    });

    const colorKey = CONFIG.STATUS_COLOR_MAP[overallStatus] || 'UNKNOWN';
    const embedColor = CONFIG.STATUS_COLORS[colorKey] || CONFIG.STATUS_COLORS.UNKNOWN;

    const fields = [];

    // Services section
    const servicesSection = this.report.sections.find(s => s.name === 'services');
    if (servicesSection && servicesSection.items.length > 0) {
      servicesSection.items.forEach(item => {
        fields.push({
          name: `${item.alert} ${item.name}`,
          value: item.message || '(No data)',
          inline: true
        });
      });
    }

    // Resources section
    const resourcesSection = this.report.sections.find(s => s.name === 'resources');
    if (resourcesSection && resourcesSection.items.length > 0) {
      resourcesSection.items.forEach(item => {
        fields.push({
          name: `${item.alert} ${item.name}`,
          value: item.message || '(No data)',
          inline: true
        });
      });
    }

    // Errors section
    const errorsSection = this.report.sections.find(s => s.name === 'errors');
    if (errorsSection && errorsSection.items.length > 0) {
      errorsSection.items.forEach(item => {
        fields.push({
          name: `${item.alert} Errors`,
          value: item.message || '0 last hour',
          inline: false
        });
      });
    }

    // Cron section
    const cronSection = this.report.sections.find(s => s.name === 'cron');
    if (cronSection && cronSection.items.length > 0) {
      cronSection.items.forEach(item => {
        fields.push({
          name: `${item.alert} Cron`,
          value: item.message || 'Unknown',
          inline: false
        });
      });
    }

    return {
      title: this.report.title,
      color: embedColor,
      fields: fields,
      footer: {
        text: `Generated: ${this.report.metadata?.generated || new Date().toISOString()}`
      },
      timestamp: this.report.metadata?.generated || new Date().toISOString()
    };
  }

  /**
   * Convert to JSON format
   * @returns {string} JSON string
   */
  toJSON() {
    return JSON.stringify(this.report, null, 2);
  }

  /**
   * Convert to compact status board format (cron mode style)
   * Returns array of issues for compact display
   * @returns {Array<string>} Array of issue strings
   */
  toStatusBoard() {
    if (!this.report) return [];

    const issues = [];
    const time = this.report.metadata?.generated
      ? new Date(this.report.metadata.generated).toLocaleTimeString('en-US', { timeZone: 'Asia/Hong_Kong' })
      : '';

    this.report.sections.forEach(section => {
      section.items.forEach(item => {
        if (item.status !== 'OK') {
          issues.push(`[${time}] ${item.alert} ${item.name}: ${item.message}`);
        }
      });
    });

    return issues;
  }

  /**
   * Get overall status summary
   * @returns {object} { status, alert, issueCount }
   */
  getSummary() {
    if (!this.report) return { status: 'UNKNOWN', alert: CONFIG.STATUS.ERROR, issueCount: 0 };

    let overallStatus = 'OK';
    let issueCount = 0;

    this.report.sections.forEach(section => {
      section.items.forEach(item => {
        if (item.status !== 'OK') {
          issueCount++;
          if (item.status === 'CRITICAL' || item.status === 'EMERGENCY' || item.status === 'error') {
            overallStatus = 'CRITICAL';
          } else if (item.status === 'WARNING' && overallStatus !== 'CRITICAL') {
            overallStatus = 'WARNING';
          }
        }
      });
    });

    const statusMap = {
      OK: CONFIG.STATUS.OK,
      WARNING: CONFIG.STATUS.WARNING,
      CRITICAL: CONFIG.STATUS.CRITICAL,
      EMERGENCY: CONFIG.STATUS.EMERGENCY
    };

    return {
      status: overallStatus,
      alert: statusMap[overallStatus] || CONFIG.STATUS.ERROR,
      issueCount
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  HealthReportGenerator
};
