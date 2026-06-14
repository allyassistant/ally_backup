#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Issue Daily Report - 每日任務進展簡報 (L1.5)
 * Run: node scripts/issue_daily_report.js
 *
 * 生成每日任務進展報告，發送到 Discord
 * Schedule: 每日 00:10 (after L0/L1)
 */

const fs = require('fs');
const path = require('path');

const { ISSUES_DIR } = require('./lib/config');
const ACTIVE_DIR = path.join(ISSUES_DIR, 'active');
const BACKLOG_DIR = path.join(ISSUES_DIR, 'backlog');
const ARCHIVE_DIR = path.join(ISSUES_DIR, 'archive');
const REPORT_FILE = path.join(ISSUES_DIR, 'daily-report.md');
const { getHKTDate } = require('./lib/time');

// ==================== HELPERS ====================
// ==================== LOAD ISSUES ====================

function loadIssues(dir) {
  let dirExists = false;
  try {
      dirExists = fs.existsSync(dir);
  } catch (err) {
      log(`❌ 檢查目錄失敗: ${dir} - ${err.message}`);
      return [];
  }
  if (!dirExists) return [];

  let files;
  try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch (err) {
      log(`❌ 讀取 issues 目錄失敗: ${err.message}`);
      return [];
  }
  const issues = [];

  for (const file of files) {
    let content;
    try {
        content = fs.readFileSync(path.join(dir, file), 'utf-8');
    } catch (err) {
        log(`❌ 讀取檔案失敗: ${file} - ${err.message}`);
        continue;
    }
    const lines = content.split('\n');

    const frontMatter = {};
    let inFrontMatter = false;

    for (const line of lines) {
      if (line === '---') {
        inFrontMatter = !inFrontMatter;
        continue;
      }
      if (inFrontMatter) {
        const match = line.match(/^([\w-]+):\s*(.+)$/);
        if (match) {
          frontMatter[match[1]] = match[2];
        }
      }
    }

    issues.push({
      id: frontMatter.id,
      title: frontMatter.title,
      status: frontMatter.status,
      priority: frontMatter.priority || 'P2',
      due: frontMatter.due || '',
      progress: frontMatter.progress || '',
      updated: frontMatter.updated || ''
    });
  }

  return issues;
}

// ==================== GENERATE REPORT ====================

function generateReport() {
  const today = new Date().toLocaleDateString('zh-HK', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });

  const active = loadIssues(ACTIVE_DIR);
  const backlog = loadIssues(BACKLOG_DIR);
  const archive = loadIssues(ARCHIVE_DIR);

  // Sort by priority
  const priorityOrder = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };
  active.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));
  backlog.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

  // Check urgent and overdue
  const todayStr = getHKTDate();
  const urgent = active.filter(i => i.priority === 'P0' || i.priority === 'P1');
  const overdue = active.filter(i => i.due && i.due.trim() !== '' && i.due < todayStr);

  let report = `# 📋 每日任務進展報告 - ${today}\n\n`;

  // Summary
  report += `## 📊 摘要\n\n`;
  report += `- 🟢 進行中: ${active.length} 個\n`;
  report += `- 🟡 待辦: ${backlog.length} 個\n`;
  report += `- ✅ 已完成 (今日): ${archive.filter(i => i.updated === todayStr).length} 個\n`;

  if (urgent.length > 0) {
    report += `- 🔴 緊急 (P0/P1): ${urgent.length} 個\n`;
  }
  if (overdue.length > 0) {
    report += `- ⚠️ 已逾期: ${overdue.length} 個\n`;
  }

  report += `\n`;

  // Active issues
  if (active.length > 0) {
    report += `## 🟢 進行中任務 (${active.length})\n\n`;

    for (const issue of active) {
      const priority = issue.priority || 'P2';
      const due = issue.due ? ` | 截止: ${issue.due}` : '';
      const progress = issue.progress ? ` | 進度: ${issue.progress}` : '';
      const warning = issue.due && issue.due.trim() !== '' && issue.due < todayStr ? ' ⚠️逾期' : '';

      report += `**#${issue.id}** [${priority}] ${issue.title}${due}${progress}${warning}\n\n`;
    }
  }

  // Backlog
  if (backlog.length > 0) {
    report += `## 🟡 待辦任務 (${backlog.length})\n\n`;

    for (const issue of backlog.slice(0, 5)) { // Show max 5
      const priority = issue.priority || 'P2';
      report += `**#${issue.id}** [${priority}] ${issue.title}\n`;
    }

    if (backlog.length > 5) {
      report += `\n...還有 ${backlog.length - 5} 個待辦任務\n`;
    }

    report += `\n`;
  }

  // Recently completed
  const recentArchive = archive
    .filter(i => i.updated)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 3);

  if (recentArchive.length > 0) {
    report += `## ✅ 最近完成\n\n`;

    for (const issue of recentArchive) {
      report += `**#${issue.id}** ${issue.title} (完成於 ${issue.updated})\n`;
    }

    report += `\n`;
  }

  // Action items
  if (urgent.length > 0 || overdue.length > 0) {
    report += `## ⚡ 需要關注\n\n`;

    if (urgent.length > 0) {
      report += `🔴 **緊急任務** (${urgent.length}個):\n`;
      for (const issue of urgent) {
        report += `  - #${issue.id}: ${issue.title}\n`;
      }
      report += `\n`;
    }

    if (overdue.length > 0) {
      report += `⚠️ **已逾期** (${overdue.length}個):\n`;
      for (const issue of overdue) {
        report += `  - #${issue.id}: ${issue.title} (原定 ${issue.due})\n`;
      }
      report += `\n`;
    }
  }

  report += `---\n\n`;
  report += `*報告生成時間: ${new Date().toLocaleString('zh-HK')}*\n`;
  report += '*使用 `node scripts/issue_manager.js` 管理任務*\n';

  return report;
}

// ==================== MAIN ====================

function main() {
  // Ensure directories exist
  try {
    [ACTIVE_DIR, BACKLOG_DIR, ARCHIVE_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  } catch (err) {
    log(`❌ 創建目錄失敗: ${err.message}`);
  }

  const report = generateReport();

  // Save to file
  try {
    fs.writeFileSync(REPORT_FILE, report);
  } catch (err) {
    log(`❌ 保存報告失敗: ${err.message}`);
  }

  // Output to console (for Discord notification)
  log(report);

  return report;
}

// If called directly
if (require.main === module) {
  main();
}

module.exports = { generateReport, main };
