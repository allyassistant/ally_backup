#!/usr/bin/env node
/**
 * system_check_generator.js - System Check Report Generator
 * =========================================================
 * Generator class 負責組裝數據並生成唔同 format 既輸出
 *
 * 職責：
 * - 收集所有數據 (issues, errors, code quality, scripts, cron, etc.)
 * - 組裝 Discord embed
 * - 輸出多 format (Discord embed / JSON / Markdown)
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-04-14)
 */

'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  CONFIG,
  createEmbedStructure,
  createField,
  createSeparator,
  truncateFieldValue,
  enforceEmbedLimit,
  getHKTDateString,
  getHKTYesterday,
  getHKTTime,
  getStatusIcon,
  getCategoryEmoji
} = require('./system_check_templates');

// Load config
let HOME, WS, STATE_DIR, SCRIPTS_DIR, MEMORY_DIR, ISSUES_DIR;
try {
  const config = require('./config');
  HOME = config.HOME;
  WS = config.WS;
  STATE_DIR = config.STATE_DIR;
  SCRIPTS_DIR = config.SCRIPTS_DIR;
  MEMORY_DIR = config.MEMORY_DIR;
  ISSUES_DIR = config.ISSUES_DIR;
} catch (e) {
  HOME = process.env.HOME;
  WS = path.join(HOME, '.openclaw', 'workspace');
  STATE_DIR = path.join(WS, '.state');
  SCRIPTS_DIR = path.join(WS, 'scripts');
  MEMORY_DIR = path.join(WS, 'memory');
  ISSUES_DIR = path.join(WS, '.issues');
}

// ============================================================================
// SYSTEM CHECK GENERATOR CLASS
// ============================================================================

class SystemCheckGenerator {
  constructor(options = {}) {
    this.options = {
      format: options.format || 'discord',
      quiet: options.quiet || false,
      ...options
    };

    this.date = getHKTDateString();
    this.data = {};
    this.embed = null;
  }

  // ==================== Data Collection Methods ====================

  /**
   * Collect all system check data
   *
   * @returns {Promise<Object>} Collected data
   */
  async collectAll() {
    const log = (...args) => { if (!this.options.quiet) console.log(...args); };

    log(`🔧 Collecting system check data for ${this.date}...`);

    this.data = {
      date: this.date,
      issues: this.getActiveIssues(),
      totalIssueCount: this.getTotalActiveIssues(),
      followup: this.getIssueAutoFollowup(),
      errors: this.getActiveErrors(),
      autoFixStatus: this.getAutoFixStatus(),
      pureAudit: await this.getPureAIAuditResults(),
      verifyFixStatus: this.getVerifyFixStatus(),
      scriptsStatus: this.getScriptsStatus(),
      cronStatus: this.getCronStatus(),
      memoryHealth: this.getMemoryHealth(),

      systemResources: this.getSystemResources()
    };

    log(`📅 Issues: ${this.data.issues.length}`);
    log(`⚠️ Active Errors: ${this.data.errors.length}`);
    log(`💻 System: CPU ${this.data.systemResources.cpu}%, Mem ${this.data.systemResources.memory}`);

    return this.data;
  }

  /**
   * Get total count of active issues (without display limit)
   *
   * @returns {number} Total active issues
   */
  getTotalActiveIssues() {
    try {
      const issuesDir = path.join(ISSUES_DIR, "active");
      if (!fs.existsSync(issuesDir)) return 0;
      return fs.readdirSync(issuesDir).filter(function (f) { return f.endsWith(".md") && !f.endsWith(".bak"); }).length;
    } catch (e) {
      console.warn("[getTotalActiveIssues] Error:", e.message);
      return 0;
    }
  }

  /**
   * Get active issues from .issues/active/
   *
   * @returns {Array} Active issues
   */
  getActiveIssues() {
    const reminders = [];
    const MAX_DISPLAY = CONFIG.LIMITS.MAX_DISPLAY_ISSUES;

    try {
      const issuesDir = path.join(ISSUES_DIR, 'active');
      if (!fs.existsSync(issuesDir)) return reminders;

      const files = fs.readdirSync(issuesDir)
        .filter(f => f.endsWith('.md') && !f.endsWith('.bak'));

      const issues = [];
      const seen = new Set();

      files.forEach(file => {
        try {
          const content = fs.readFileSync(path.join(issuesDir, file), 'utf8');
          const idMatch = content.match(/^id:\s*(\d+)/m);
          const titleMatch = content.match(/^title:\s*(.+?)$/m);
          const priorityMatch = content.match(/^priority:\s*(\w+)/m);
          const dueMatch = content.match(/^due:\s*(.+?)$/m);

          if (idMatch && titleMatch) {
            const issue = {
              id: idMatch[1],
              title: titleMatch[1].slice(0, 35),
              priority: priorityMatch ? priorityMatch[1] : 'P?',
              due: dueMatch ? dueMatch[1] : 'N/A'
            };
            if (!seen.has(issue.id)) {
              seen.add(issue.id);
              issues.push(issue);
            }
          }
        } catch (e) {
          console.warn('[getActiveIssues] Failed to read:', file, e.message);
        }
      });

      // Sort by priority first, then due date
      const prioOrder = { P0: 0, P1: 1, P2: 2, P3: 3, 'P?': 4 };
      const now = new Date();

      issues.sort((a, b) => {
        const pa = prioOrder[a.priority] !== undefined ? prioOrder[a.priority] : 4;
        const pb = prioOrder[b.priority] !== undefined ? prioOrder[b.priority] : 4;
        if (pa !== pb) return pa - pb;
        if (!a.due || a.due === 'N/A') return 1;
        if (!b.due || b.due === 'N/A') return -1;
        const da = new Date(a.due);
        const db = new Date(b.due);
        if (isNaN(da.getTime())) return 1;
        if (isNaN(db.getTime())) return -1;
        return da - db;
      });

      issues.slice(0, MAX_DISPLAY).forEach(issue => {
        const icon = { P0: '🔴', P1: '🟠', P2: '🟡', P3: '⚪' }[issue.priority] || '⚪';
        reminders.push(`${icon} #${issue.id} ${issue.title} [${issue.priority}]`);
      });

    } catch (e) {
      console.warn('[getActiveIssues] Error:', e.message);
    }

    return reminders;
  }

  /**
   * Get issue auto followup status
   *
   * @returns {Object} Followup data
   */
  getIssueAutoFollowup() {
    try {
      const scriptPath = path.join(SCRIPTS_DIR, 'issue_auto_followup.js');
      if (!fs.existsSync(scriptPath)) {
        return { summary: '⚠️ Script not found', reminders: 0, progress: 0, auto: 0, details: [] };
      }

      const output = execFileSync(process.execPath, [scriptPath, 'all'], {
        encoding: 'utf8',
        timeout: CONFIG.ISSUE_FOLLOWUP_TIMEOUT,
        cwd: WS,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const remindMatch = output.match(/提醒:\s*(\d+)/);
      const progressMatch = output.match(/進度檢查:\s*(\d+)/);
      const autoMatch = output.match(/自動完成:\s*(\d+)/);

      const reminders = remindMatch ? parseInt(remindMatch[1]) : 0;
      const progress = progressMatch ? parseInt(progressMatch[1]) : 0;
      const auto = autoMatch ? parseInt(autoMatch[1]) : 0;

      // Extract detail lines
      const details = [];
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('⏰') || trimmed.startsWith('🔴') || (trimmed.startsWith('⚠️') && trimmed.includes('Issue #'))) {
          details.push(trimmed);
        } else if (/^#\d+\s/.test(trimmed) && trimmed.includes('日無更新')) {
          details.push('📊 ' + trimmed);
        } else if (trimmed.startsWith('- #') && trimmed.includes(':')) {
          details.push('🤖 ' + trimmed.slice(2));
        }
      }

      return {
        summary: `🔔 提醒: ${reminders} | 📊 進度: ${progress} | 🤖 自動完成: ${auto}`,
        reminders, progress, auto, details
      };

    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString().trim() : '';
      return {
        summary: `⚠️ ${(e.message || 'Error').slice(0, 60)}${stderr ? ' | ' + stderr.slice(0, 40) : ''}`,
        reminders: 0, progress: 0, auto: 0, details: []
      };
    }
  }

  /**
   * Get active errors from errors.json
   *
   * @returns {Array} Active errors
   */
  getActiveErrors() {
    const errors = [];
    const MAX_DISPLAY = CONFIG.LIMITS.MAX_DISPLAY_ERRORS;

    try {
      const errorsFile = path.join(MEMORY_DIR, 'errors.json');
      if (!fs.existsSync(errorsFile)) return errors;

      const data = JSON.parse(fs.readFileSync(errorsFile, 'utf8'));
      const errorsList = Array.isArray(data.errors) ? data.errors : [];
      const active = errorsList.filter(e => e.resolved !== true);

      active.slice(0, MAX_DISPLAY).forEach(e => {
        try {
          errors.push({
            title: ((e && e.title) || 'Error').slice(0, 30),
            type: (e && e.type) || '',
            timestamp: (e && e.timestamp) || '',
            problem: ((e && e.problem) || '').slice(0, 25)
          });
        } catch (err) {
          console.warn('[getActiveErrors] Failed to process:', err.message);
        }
      });

    } catch (e) {
      console.warn('[getActiveErrors] Error:', e.message);
    }

    return errors;
  }

  /**
   * Get system resources (CPU, Memory, Disk)
   *
   * @returns {Object} System resources
   */
  getSystemResources() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // CPU usage
    let cpuUsage = '0.00';
    try {
      const topOutput = execFileSync('/usr/bin/top', ['-l', '1', '-n', '0', '-s', '0'], {
        encoding: 'utf8',
        timeout: CONFIG.CPU_CHECK_TIMEOUT
      });
      const cpuMatch = topOutput.match(/CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys/);
      if (cpuMatch) {
        cpuUsage = (parseFloat(cpuMatch[1]) + parseFloat(cpuMatch[2])).toFixed(2);
      }
    } catch (e) {
      const cpus = os.cpus();
      let usage = 0;
      cpus.forEach(cpu => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        usage += ((total - cpu.times.idle) / total) * 100;
      });
      cpuUsage = (usage / cpus.length).toFixed(2);
    }

    const memGB = (usedMem / (1024 * 1024 * 1024)).toFixed(0);

    // Disk usage
    let diskInfo = 'Unknown';
    try {
      const dfOutput = execFileSync('/bin/df', ['-h', '/'], { encoding: 'utf8', timeout: CONFIG.DISK_CHECK_TIMEOUT });
      const lines = dfOutput.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 5) {
          diskInfo = `${parts[2]} / ${parts[1]} (${parts[4]})`;
        }
      }
    } catch (e) {
      console.warn('[getSystemResources] df failed:', e.message);
    }

    const load = os.loadavg()[0].toFixed(2);

    return { cpu: cpuUsage, memory: memGB + 'G', disk: diskInfo, load: load };
  }

  /**
   * Get scripts status
   *
   * @returns {Object} Scripts status
   */
  getScriptsStatus() {
    const scripts = [
      { path: 'memory_generator.js', type: 'Core', desc: 'L0/L1 Generator' },
      { path: 'l0_l1_verify.js', type: 'Core', desc: 'L0/L1 Verify' },
      { path: 'daily_summary_bot.js', type: 'Core', desc: 'Daily Summary' },
      { path: 'system_check_bot.js', type: 'Core', desc: 'System Check' },
      { path: 'code_quality_manager.js', type: 'Core', desc: 'Code Quality Manager' },
      { path: 'daily_maintenance.js', type: '維護', desc: 'Daily Maintenance' },
      { path: 'error_tracker.js', type: '維護', desc: 'Error Tracker' },
      { path: 'auto_fix.js', type: 'Legacy', desc: 'Auto Fix (已移至 _legacy)' },
      { path: 'log_to_daily_memory.js', type: '維護', desc: 'Memory Logger' },
      { path: 'memory_section_cleanup.js', type: '維護', desc: 'Memory Cleanup' },
      { path: 'heartbeat_recall.js', type: '健康', desc: 'Heartbeat Recall' },
      { path: 'generate_symbols.js', type: '工具', desc: 'Symbol Map' },
      { path: 'get_symbol_info.js', type: '工具', desc: 'Symbol Info' },
      { path: 'kimi_cli_runner.js', type: '工具', desc: 'Kimi CLI Runner' },
      { path: 'knowledge_ingester.js', type: '工具', desc: 'KB Ingester' },
      { path: 'knowledge_classifier.js', type: '工具', desc: 'KB Classifier' }
    ];

    const byType = {};
    let okCount = 0, failCount = 0;
    const failedScripts = [];  // P0: Track failed script names

    scripts.forEach(s => {
      try {
        const fullPath = path.join(SCRIPTS_DIR, s.path);
        const exists = fs.existsSync(fullPath);
        if (!byType[s.type]) byType[s.type] = [];
        byType[s.type].push({ name: s.path.replace('.js', ''), ok: exists, desc: s.desc });
        if (exists) okCount++; else {
          failCount++;
          failedScripts.push(s.path);  // P0: Record failed script name
        }
      } catch (e) {
        if (!byType[s.type]) byType[s.type] = [];
        byType[s.type].push({ name: s.path.replace('.js', ''), ok: false, desc: s.desc });
        failCount++;
        failedScripts.push(s.path);  // P0: Record failed script name
      }
    });

    return { byType, okCount, failCount, failedScripts };
  }

  /**
   * Get cron jobs status
   *
   * @returns {Object} Cron status
   */
  getCronStatus() {
    try {
      const cronOutput = execFileSync('openclaw', ['gateway', 'call', 'cron.list', '--json'], {
        encoding: 'utf8',
        timeout: CONFIG.CRON_CHECK_TIMEOUT,
        stdio: ['pipe', 'pipe', 'ignore']
      });

      let jobs = [];
      try {
        const data = JSON.parse(cronOutput);
        jobs = data.jobs || [];
      } catch (e) {
        return { results: [`⚠️ Parse error: ${e.message || String(e)}`], okCount: 0, pendingCount: 0, skippedCount: 0 };
      }

      const jobStatusMap = {};
      jobs.forEach(job => {
        jobStatusMap[job.name] = job.state?.lastRunStatus || 'unknown';
      });

      // Helper: extract HH:MM from cron expr like "5 0 * * *" or "0 10,15,22 * * *"
      function extractTime(expr) {
        if (!expr) return '??:??';
        const parts = expr.trim().split(/\s+/);
        if (parts.length < 5) return expr;
        const minute = parts[0];
        const hourPart = parts[1];
        const hour = hourPart.split(',')[0];
        return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
      }

      // Helper: categorize by hour
      function categorizeByTime(expr) {
        if (!expr) return '其他';
        const parts = expr.trim().split(/\s+/);
        if (parts.length < 5) return '其他';
        const hour = parseInt(parts[1].split(',')[0], 10);
        if (isNaN(hour)) return '其他';
        if (hour < 5) return '凌晨';
        if (hour < 10) return '上午';
        if (hour < 15) return '下午';
        return '晚間';
      }

      // Helper: day suffix for weekly jobs (day 4=Thu, 0=Sun, 1=Mon)
      function daySuffix(expr) {
        if (!expr) return '';
        const parts = expr.trim().split(/\s+/);
        if (parts.length < 5) return '';
        const day = parts[4];
        if (day === '0') return ' (Sun)';
        if (day === '1') return ' (Mon)';
        return '';
      }

      // Dynamically build cronJobs from API data
      const cronJobs = jobs.map(job => ({
        id: job.id,
        name: job.name || 'Unknown',
        time: extractTime(job.schedule?.expr),
        schedule: job.schedule?.expr || '',
        category: categorizeByTime(job.schedule?.expr),
        day: daySuffix(job.schedule?.expr)
      }));

      const results = [];
      let okCount = 0, pendingCount = 0, skippedCount = 0;
      // Include all categories; skip empty ones
      const categories = ['凌晨', '上午', '下午', '晚間'];
      const COL_WIDTH = CONFIG.LIMITS.COL_WIDTH;

      categories.forEach(cat => {
        const jobsInCat = cronJobs.filter(j => j.category === cat);
        if (jobsInCat.length === 0) return;

        results.push(`${getCategoryEmoji(cat)} ${cat}`);

        jobsInCat.forEach(job => {
          let status = job.state?.lastRunStatus || jobStatusMap[job.name] || 'unknown';
          const icon = getStatusIcon(status);
          if (status === 'ok') okCount++;
          else if (status === 'skipped') skippedCount++;
          else pendingCount++;

          // Show readable time (HH:MM) + job name
          const displayName = `${job.time} ${job.name}${job.day}`;
          results.push(`\`${displayName.padEnd(COL_WIDTH)} ${icon}\``);
        });
      });

      // P0: Collect pending job names
      const pendingJobs = [];
      cronJobs.forEach(job => {
        let status = job.state?.lastRunStatus || jobStatusMap[job.name] || 'unknown';
        if (status !== 'ok' && status !== 'skipped') {
          const displayName = job.schedule.length > 0
            ? `${job.schedule}${job.day} ${job.name}`
            : `${job.time} ${job.name}${job.day}`;
          pendingJobs.push(displayName.trim());
        }
      });

      results.push('');
      results.push(`📊 總共: ${cronJobs.length} jobs`);

      return { results, okCount, pendingCount, skippedCount, pendingJobs };
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString().trim() : '';
      return {
        results: [`⚠️ Error: ${err.message || String(err)}${stderr ? ' | stderr: ' + stderr.slice(0, 60) : ''}`],
        okCount: 0, pendingCount: 0, skippedCount: 0,
        pendingJobs: []
      };
    }
  }

  /**
   * Get memory health status
   *
   * @returns {Object} Memory health
   */
  getMemoryHealth() {
    const memDir = MEMORY_DIR;
    const l0Dir = path.join(memDir, 'l0-abstract');
    const l1Dir = path.join(memDir, 'l1-overview');
    const l2Pattern = /^\d{4}-\d{2}-\d{2}/;

    let fileCount = 0, l0Exists = false, l1Exists = false, l2Exists = false;
    let largeFiles = [];
    const THRESHOLD_KB = CONFIG.LIMITS.LARGE_FILE_THRESHOLD_KB;
    const MAX_LARGE = CONFIG.LIMITS.MAX_DISPLAY_LARGE_FILES;

    try {
      if (fs.existsSync(memDir)) {
        const files = fs.readdirSync(memDir);
        fileCount = files.length;

        const yesterdayStr = getHKTYesterday();
        if (fs.existsSync(l0Dir)) l0Exists = fs.readdirSync(l0Dir).some(f => f.startsWith(yesterdayStr));
        if (fs.existsSync(l1Dir)) l1Exists = fs.readdirSync(l1Dir).some(f => f.startsWith(yesterdayStr));
        l2Exists = files.some(f => l2Pattern.test(f));

        files.filter(f => f.endsWith('.md') || f.endsWith('.json')).forEach(file => {
          try {
            const stats = fs.statSync(path.join(memDir, file));
            const sizeKB = Math.round(stats.size / 1024);
            if (sizeKB > THRESHOLD_KB) {
              largeFiles.push({ file, sizeKB });
            }
          } catch (e) {
            console.warn('[getMemoryHealth] stat failed:', file, e.message);
          }
        });
      }
    } catch (e) {
      console.warn('[getMemoryHealth] Error:', e.message);
    }

    return {
      fileCount,
      l0: l0Exists ? CONFIG.EMOJI.ok : CONFIG.EMOJI.error,
      l1: l1Exists ? CONFIG.EMOJI.ok : CONFIG.EMOJI.error,
      l2: l2Exists ? CONFIG.EMOJI.ok : CONFIG.EMOJI.error,
      largeFiles: largeFiles.slice(0, MAX_LARGE),
      hasLarge: largeFiles.length > 0
    };
  }

  /**
   * Get auto-fix status
   *
   * @returns {Object|null} Auto-fix status
   */
  getAutoFixStatus() {
    try {
      const reportPath = path.join(STATE_DIR, 'auto_fix_report.json');
      if (!fs.existsSync(reportPath)) return null;

      const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const summary = data.summary || data;

      return {
        filesScanned: summary.filesScanned || data.filesScanned || 0,
        highRisk: summary.highRiskTotal || data.highRisk?.length || 0,
        lowRiskFixed: summary.lowRiskFixed || data.lowRiskFixed || 0,
        systemAudit: summary.systemAuditIssues || data.systemAudit?.length || 0
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get verify-fix status
   *
   * @returns {Object|null} Verify-fix status
   */
  getVerifyFixStatus() {
    try {
      const logPath = path.join(STATE_DIR, 'verify_fix_log.json');
      const historyPath = path.join(STATE_DIR, 'auto_fix_history.json');

      // Import verify_fix.js — auto-verify fixes before reading status
      let getFixCategory;
      try {
        const verifyFix = require('./verify_fix.js');
        getFixCategory = verifyFix.getFixCategory;
        // Auto-run verification on unverified fixes (within last 72h)
        try {
          verifyFix.runVerification({ hourLimit: 72, quiet: true });
        } catch (vErr) {
          // Verification is best-effort
          if (process.env.DEBUG) console.warn('[getVerifyFixStatus] Auto-verify failed:', vErr.message);
        }
      } catch (e) {
        getFixCategory = (fix) => {
          const text = ((fix.issue || '') + ' ' + (fix.fix_applied || '')).toLowerCase();
          if (text.includes('行尾空白') || text.includes('換行符') || text.includes('trailing')) {
            return 'FORMATTING';
          }
          return 'QUALITY';
        };
      }

      let historyData = { fixes: [] };
      try {
        if (fs.existsSync(historyPath)) {
          historyData = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }
      } catch (e) {
        console.warn(`[getVerifyFixStatus] Failed to read history: ${e.message}`);
      }

      const fixes = (historyData.fixes || []).filter(f => !f.isAuditRecord);
      const formattingFixes = fixes.filter(f => getFixCategory(f) === 'FORMATTING');
      const qualityFixes = fixes.filter(f => getFixCategory(f) === 'QUALITY');

      const formatting = {
        total: formattingFixes.length,
        verified: formattingFixes.filter(f => f.verified).length
      };

      const quality = {
        total: qualityFixes.length,
        verified: qualityFixes.filter(f => f.verified).length,
        pending: qualityFixes.filter(f => !f.verified && f.status !== 'deprecated').length,
        deprecated: qualityFixes.filter(f => f.status === 'deprecated').length,
        successRate: 0
      };

      const qualityWithRate = qualityFixes.filter(f => f.success_rate !== null && f.verified);
      quality.successRate = qualityWithRate.length > 0
        ? Math.round(qualityWithRate.reduce((sum, f) => sum + f.success_rate, 0) / qualityWithRate.length)
        : (quality.verified > 0 ? 100 : 0);

      let lastResult = null;
      try {
        if (fs.existsSync(logPath)) {
          const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
          lastResult = logData;
        }
      } catch (e) {
        console.warn(`[getVerifyFixStatus] Failed to read log: ${e.message}`);
      }

      return {
        total: fixes.length,
        verified: formatting.verified + quality.verified,
        deprecated: quality.deprecated,
        pending: quality.pending,
        lastRun: lastResult ? lastResult.timestampHKT : null,
        lastSummary: lastResult ? lastResult.summary : null,
        formatting,
        quality
      };

    } catch (e) {
      console.warn('[getVerifyFixStatus] Error:', e.message);
      return null;
    }
  }

  /**
   * Get Pure AI Audit results (with auto-refresh)
   *
   * @returns {Promise<Object>} Audit results
   */
  async getPureAIAuditResults() {
    try {
      // Auto-refresh: Run scan before reading
      const cqmPath = path.join(SCRIPTS_DIR, 'code_quality_manager.js');
      const stateDir = STATE_DIR;

      try {
        if (!this.options.quiet) console.log('[Auto-Refresh] Running code quality scan...');
        // --enable-skill-scan: include skill integrity issues in system check output
        execFileSync(process.execPath, [cqmPath, 'scan', '--quiet', '--no-system-check', '--enable-skill-scan', '--output', stateDir], {
          encoding: 'utf8',
          timeout: CONFIG.CQM_SCAN_TIMEOUT,
          cwd: WS,
          stdio: this.options.quiet ? ['pipe', 'pipe', 'pipe'] : 'inherit'
        });
      } catch (scanErr) {
        if (!this.options.quiet) console.warn('[Auto-Refresh] Scan failed:', scanErr.message);
      }

      // Read results
      const resultFile = path.join(stateDir, 'pure_ai_audit_results.json');
      let fileExists = false;
      try {
        fileExists = fs.existsSync(resultFile);
      } catch (e) {
        console.error(`Failed to check result file: ${e.message}`);
        return { summary: { critical: 0, high: 0, medium: 0, low: 0 }, details: [], error: e.message };
      }
      if (!fileExists) {
        return { summary: { critical: 0, high: 0, medium: 0, low: 0 }, details: [], error: null };
      }

      let content;
      try {
        content = fs.readFileSync(resultFile, 'utf8');
      } catch (e) {
        console.error(`Failed to read result file: ${e.message}`);
        return { summary: { critical: 0, high: 0, medium: 0, low: 0 }, details: [], error: e.message };
      }

      let results;
      try {
        results = JSON.parse(content);
      } catch (e) {
        console.error(`Failed to parse result JSON: ${e.message}`);
        return { summary: { critical: 0, high: 0, medium: 0, low: 0 }, details: [], error: e.message };
      }

      const summary = results.summary || results;
      const critical = summary.critical || results.critical || 0;
      const high = summary.high || results.high || 0;
      const medium = summary.medium || results.medium || 0;
      const low = summary.low || results.low || 0;

      let issues = results.findings || results.issues || [];

      // Filter out magic_numbers (style/low severity)
      const magicNumCount = issues.filter(i => i.rule === 'magic_numbers').length;
      issues = issues.filter(i => i.rule !== 'magic_numbers');
      const filteredLow = low - magicNumCount;

      return {
        summary: { critical, high, medium, low: filteredLow },
        critical, high, medium, low: filteredLow,
        details: issues,
        error: null
      };

    } catch (e) {
      return { summary: { critical: 0, high: 0, medium: 0, low: 0 }, details: [], error: e.message };
    }
  }

  // ==================== Embed Building Methods ====================

  /**
   * Load previous period state for comparison (P1-4)
   *
   * @returns {Object|null} Previous state or null
   */
  loadPreviousState() {
    try {
      const statePath = path.join(STATE_DIR, 'system_check_state.json');
      if (fs.existsSync(statePath)) {
        const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return data;
      }
    } catch (e) {
      console.warn('[loadPreviousState] Error:', e.message);
    }
    return null;
  }

  /**
   * Save current state for future comparison (P1-4)
   */
  saveCurrentState() {
    try {
      const statePath = path.join(STATE_DIR, 'system_check_state.json');
      const state = {
        date: this.date,
        timestamp: new Date().toISOString(),
        issuesCount: this.data.issues.length,
        errorsCount: this.data.errors.length,
        scriptsOk: this.data.scriptsStatus.okCount,
        scriptsFail: this.data.scriptsStatus.failCount,
        cronOk: this.data.cronStatus.okCount,
        cronPending: this.data.cronStatus.pendingCount,
        cronSkipped: this.data.cronStatus.skippedCount
      };
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (e) {
      console.warn('[saveCurrentState] Error:', e.message);
    }
  }

  /**
   * Build comparison string with previous period — Delta Priority format
   * - Only shows items WITH changes using +/- deltas
   * - Items without changes summarized as "其他 X 項無變化"
   * - Discord-friendly tree format
   *
   * @param {Object} prev Previous state
   * @returns {string} Comparison string
   */
  buildComparison(prev) {
    if (!prev) return '📊 上期對比\n└─ 無歷史數據 (首次運行)';

    const cur = {
      issues: this.data.issues.length,
      errors: this.data.errors.length,
      scriptsOk: this.data.scriptsStatus.okCount,
      scriptsFail: this.data.scriptsStatus.failCount,
      cronOk: this.data.cronStatus.okCount,
      cronPending: this.data.cronStatus.pendingCount,
      cronSkipped: this.data.cronStatus.skippedCount
    };

    const items = [
      { label: 'Issues', prev: prev.issuesCount, cur: cur.issues },
      { label: 'Errors', prev: prev.errorsCount || 0, cur: cur.errors },
      { label: 'Scripts ok', prev: prev.scriptsOk, cur: cur.scriptsOk },
      { label: 'Scripts fail', prev: prev.scriptsFail, cur: cur.scriptsFail },
      { label: 'Cron ok', prev: prev.cronOk, cur: cur.cronOk },
      { label: 'Cron pending', prev: prev.cronPending, cur: cur.cronPending },
      { label: 'Cron skipped', prev: prev.cronSkipped || 0, cur: cur.cronSkipped }
    ];

    const changed = [];
    let unchangedCount = 0;

    items.forEach(item => {
      const diff = item.cur - item.prev;
      if (diff !== 0) {
        const sign = diff > 0 ? '+' : '';
        changed.push({ label: item.label, from: item.prev, to: item.cur, diff, sign });
      } else {
        unchangedCount++;
      }
    });

    // Build tree lines
    const lines = ['📊 上期對比'];

    if (changed.length === 0) {
      lines.push('└─ 所有項目無變化');
    } else {
      changed.forEach((item, idx) => {
        const prefix = idx === changed.length - 1 ? '└─' : '├─';
        lines.push(`${prefix} ${item.label}: ${item.from} → ${item.to} (${item.sign}${item.diff})`);
      });
      if (unchangedCount > 0) {
        lines.push(`└─ 其他 ${unchangedCount} 項無變化`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Build inline fix suggestion for low severity issues (P1-3)
   *
   * @param {Array} details Issue details
   * @returns {string} Fix suggestion string
   */
  buildLowSeverityFix(details) {
    if (!details || details.length === 0) return '';

    const suggestions = [];
    details.forEach(d => {
      if (!d || typeof d !== 'object') return;

      const issueText = (d.issue || d.title || d.message || '').toLowerCase();

      // P1-3: Simplified Chinese fix suggestion
      if (issueText.includes('簡體') || issueText.includes('简體') ||
          (d.file && d.file.includes('簡體')) || (d.file && d.file.includes('简體'))) {
        const fileName = d.file || 'Unknown';
        suggestions.push(`📝 **${fileName}**: 發現簡體中文 → 建議改為繁體中文`);
      }

      // Generic low severity fix suggestion
      if (d.severity === 'low' && d.suggestion) {
        suggestions.push(`📝 **${d.file || 'Unknown'}**: ${d.suggestion}`);
      }
    });

    if (suggestions.length > 0) {
      return '\n\n💡 **Inline Fix 建議:**\n' + suggestions.slice(0, 2).join('\n');
    }
    return '';
  }

  /**
   * Build complete Discord embed
   *
   * @returns {Object} Discord embed
   */
  buildEmbed() {
    const { issues, errors, pureAudit, autoFixStatus, verifyFixStatus, scriptsStatus, cronStatus, memoryHealth, systemResources, totalIssueCount } = this.data;

    const hasErrors = errors.length > 0;
    const hktTime = getHKTTime();

    const embed = createEmbedStructure({ date: this.date, errors, time: hktTime });
    embed.title = `🔧 系統檢查 — ${this.date} ${hktTime}`;

    // Issues section: show only P0/P1 (up to 5)
    const topIssues = issues.filter(function (r) {
      return r.indexOf("[P0]") !== -1 || r.indexOf("[P1]") !== -1;
    }).slice(0, 5);
    const issueCount = issues.length > 0
      ? `📋 Issues (${topIssues.length} of ${totalIssueCount || issues.length})`
      : "📋 Issues (0)";
    const issueLine = topIssues.length > 0 ? topIssues.join("\n") : "⚪ 無 P0/P1 事項";
    embed.fields.push(createField(issueCount, issueLine));
    embed.fields.push(createSeparator());

    // Code Quality + Fix Verification + Skill Scan (merged)
    const critCount = pureAudit.critical || 0;
    const highCount = pureAudit.high || 0;
    const medCount = pureAudit.medium || 0;
    const lowCount = pureAudit.low || 0;

    // Severity helper for skill scan display
    function toPascalSeverity(s) {
      if (!s) return "⚪";
      const m = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" };
      return m[s.toLowerCase()] || "⚪";
    }

    const autoFixLine = autoFixStatus ? `🔧 Auto-fix: ${autoFixStatus.highRisk || 0} high-risk queued, ${autoFixStatus.lowRiskFixed || 0} fixed` : "";
    const verifyQty = verifyFixStatus && verifyFixStatus.quality ? verifyFixStatus.quality : { total: 0, verified: 0 };
    const verifyLine = verifyQty.total > 0 ? `✅ Verify: ${verifyQty.verified}/${verifyQty.total}` : "";

    // Extract skill scan entries from pureAudit details
    var skillDetails = [];
    if (pureAudit.details) {
      for (var si = 0; si < pureAudit.details.length; si++) {
        var d = pureAudit.details[si];
        if (d && d.source === "skillIntegrityScanner") {
          var name = d.file || "";
          name = name.replace("skills-learned/", "").replace(".md", "");
          skillDetails.push(toPascalSeverity(d.severity) + " " + name);
        }
      }
    }
    var skillLine = skillDetails.length > 0
      ? "🎯 Skill scan: " + skillDetails.join(" · ")
      : "";

    var qualityLines = [];
    qualityLines.push(`🔴 ${critCount}  🟠 ${highCount}  🟡 ${medCount}  ⚪ ${lowCount}`);
    if (autoFixLine) qualityLines.push(autoFixLine);
    if (verifyLine) qualityLines.push(verifyLine);
    if (skillLine) qualityLines.push(skillLine);
    if (qualityLines.length === 0) qualityLines.push("✅ No issues");

    embed.fields.push(createField("🛠️ Code Quality", qualityLines.join("\n")));
    embed.fields.push(createSeparator());

    // Operations: Scripts + Cron + System (condensed 1-line each)
    var opsLines = [];
    var scriptsFail = (scriptsStatus.failedScripts && scriptsStatus.failedScripts.length > 0)
      ? " ❌ " + scriptsStatus.failedScripts.join(", ") : "";
    opsLines.push(`📜 Scripts: ${scriptsStatus.okCount}/${scriptsStatus.okCount + scriptsStatus.failCount} ✅${scriptsFail}`);

    var cronSummary = `⏰ Cron: ${cronStatus.okCount}✅`;
    if (cronStatus.pendingCount > 0) cronSummary += " " + cronStatus.pendingCount + "⏳";
    if (cronStatus.skippedCount > 0) cronSummary += " " + cronStatus.skippedCount + "⏭️";
    if (cronStatus.pendingJobs && cronStatus.pendingJobs.length > 0) {
      cronSummary += " " + cronStatus.pendingJobs.slice(0, 2).map(function (j) { return j.replace(/^[\d\*\?,/\-\s]{1,15}/, "").replace(/^\(\w+\)\s*/, "").trim().slice(0, 30); }).join(" · ");
    }
    opsLines.push(cronSummary);

    opsLines.push(`💻 CPU ${systemResources.cpu}% · Mem ${systemResources.memory} · Disk ${systemResources.disk} · Load ${systemResources.load}`);

    embed.fields.push(createField("📊 Operations", opsLines.join("\n")));
    embed.fields.push(createSeparator());

    // Summary: Memory + Followup
    var summaryLines = [];
    var followupData = this.data.followup || {};
    summaryLines.push(`📁 Files: ${memoryHealth.fileCount} | L0:${memoryHealth.l0} L1:${memoryHealth.l1} L2:${memoryHealth.l2}`);
    summaryLines.push(`🔔 Followup: ${followupData.reminders || 0} reminders · ${followupData.progress || 0} progress · ${followupData.auto || 0} auto`);
    embed.fields.push(createField("📋 Summary", summaryLines.join("\n")));

    embed.footer = { text: `🔧 系統檢查 | ${this.date} ${hktTime}` };

    enforceEmbedLimit(embed);

    this.embed = embed;
    this.saveCurrentState();

    return embed;
  }

  // ==================== Output Methods ====================

  /**
   * Generate output in specified format
   *
   * @param {string} format - Output format (discord, json, markdown)
   * @returns {string|Object} Formatted output
   */
  generate(format) {
    if (!this.embed) this.buildEmbed();

    switch (format) {
      case 'json':
        return this.toJSON();
      case 'markdown':
      case 'md':
        return this.toMarkdown();
      case 'discord':
      default:
        return this.embed;
    }
  }

  /**
   * Convert to JSON string
   *
   * @returns {string} JSON string
   */
  toJSON() {
    return JSON.stringify({
      date: this.date,
      generatedAt: new Date().toISOString(),
      data: this.data,
      embed: this.embed
    }, null, 2);
  }

  /**
   * Convert to Markdown format
   *
   * @returns {string} Markdown string
   */
  toMarkdown() {
    const { issues, errors, pureAudit, scriptsStatus, cronStatus, memoryHealth, systemResources } = this.data;

    let md = `# 🔧 系統檢查 - ${this.date}\n\n`;
    md += `📅 ${this.date.replace('-', '年').replace('-', '月')}日 每日系統健康報告\n\n`;

    // Issues
    md += `## 📋 Issues (${issues.length})\n`;
    if (issues.length > 0) {
      issues.forEach(r => md += `- ${r}\n`);
    } else {
      md += '無待辦事項\n';
    }
    md += '\n';

    // Code Quality
    md += `## 🔍 Code Quality Manager\n`;
    md += `🔴 ${pureAudit.critical} Critical | 🟠 ${pureAudit.high} High | 🟡 ${pureAudit.medium} Medium | ⚪ ${pureAudit.low} Low\n\n`;

    // Scripts
    md += `## 📜 Scripts\n`;
    md += `✅ ${scriptsStatus.okCount} | ❌ ${scriptsStatus.failCount}\n\n`;

    // Cron
    md += `## ⏰ Cron Jobs\n`;
    md += `✅ ${cronStatus.okCount} | ⏳ ${cronStatus.pendingCount} | ⏭️ ${cronStatus.skippedCount}\n\n`;

    // Summary
    md += `## 📊 Summary\n`;
    md += `📁 Files: ${memoryHealth.fileCount} | L0:${memoryHealth.l0} L1:${memoryHealth.l1} L2:${memoryHealth.l2}\n\n`;

    // System
    md += `## 💻 System\n`;
    md += `CPU: ${systemResources.cpu}% | Mem: ${systemResources.memory} | Disk: ${systemResources.disk} | Load: ${systemResources.load}\n\n`;

    md += `---\n*Generated at ${getHKTTime()} HKT*\n`;

    return md;
  }

  // ==================== Discord Sending ====================

  /**
   * Send embed to Discord
   *
   * @returns {Promise<boolean>} Success status
   */
  async sendToDiscord() {
    if (!this.embed) this.buildEmbed();

    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const SYSTEM_CHANNEL_ID = CONFIG.DISCORD_SYSTEM_CHANNEL_ID;

    // Load config
    let configExists = false;
    try {
      configExists = fs.existsSync(configPath);
    } catch (e) {
      console.error(`❌ Failed to check config file: ${e.message}`);
      return false;
    }
    if (!configExists) {
      console.error(`❌ Config file not found: ${configPath}`);
      return false;
    }

    let config;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error(`❌ Failed to parse config: ${e.message}`);
      return false;
    }

    const token = config.channels?.discord?.token || process.env.DISCORD_TOKEN;
    if (!token) {
      console.log('⚠️ No Discord token in config or env');
      return false;
    }

    const postData = JSON.stringify({
      embeds: [this.embed],
      allowed_mentions: { parse: [] }
    });

    // First attempt
    const result = await this._discordPost(postData, token, SYSTEM_CHANNEL_ID);
    if (result.ok) return true;

    // Retry on 429
    if (result.status === 429) {
      const waitMs = Math.min((result.retryAfter || 1) * 1000, 10000);
      await new Promise(r => setTimeout(r, waitMs));
      const retry = await this._discordPost(postData, token, SYSTEM_CHANNEL_ID);
      if (retry.ok) return true;
    }

    return false;
  }

  /**
   * Internal Discord POST helper
   *
   * @private
   */
  _discordPost(postData, token, channelId) {
    return new Promise((resolve) => {
      const options = {
        hostname: 'discord.com',
        path: `/api/v10/channels/${channelId}/messages`,
        method: 'POST',
        headers: {
          'Authorization': `Bot ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true });
          } else if (res.statusCode === 429) {
            let retryAfter = 1;
            try {
              retryAfter = JSON.parse(data).retry_after ||
                parseFloat(res.headers['retry-after']) || 1;
            } catch (_) { /* use default */ }
            resolve({ ok: false, status: 429, retryAfter });
          } else {
            if (!this.options.quiet) console.log(`⚠️ API: ${res.statusCode} — ${data.slice(0, 200)}`);
            resolve({ ok: false, status: res.statusCode });
          }
        });
      });

      req.setTimeout(CONFIG.DISCORD_REQ_TIMEOUT, () => {
        if (!this.options.quiet) console.log(`⚠️ Request timeout (${CONFIG.DISCORD_REQ_TIMEOUT / 1000}s)`);
        req.destroy();
        resolve({ ok: false, status: 0 });
      });

      req.on('error', e => {
        if (!this.options.quiet) console.log('⚠️ ' + (e.message || 'Unknown error'));
        resolve({ ok: false, status: 0 });
      });

      req.write(postData);
      req.end();
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  SystemCheckGenerator
};
