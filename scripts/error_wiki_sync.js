#!/usr/bin/env node
/**
 * Error → Wiki Sync Script
 * 將 errors.json 中的錯誤同步到 Wiki
 *
 * 用法: node scripts/error_wiki_sync.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

const WORKSPACE = path.join(process.env.HOME, '.openclaw/workspace');
const ERRORS_FILE = path.join(WORKSPACE, 'memory/errors.json');
const WIKI_VAULT = path.join(WORKSPACE, '.openclaw-wiki');
const ERRORS_WIKI_DIR = path.join(WIKI_VAULT, 'errors');

// 解析命令行參數
const DRY_RUN = process.argv.includes('--dry-run');

function log(level, message) {
  const colors = {
    info: '\x1b[34m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
  };
  console.log(`${colors[level] || ''}[${level.toUpperCase()}]${colors.reset} ${message}`);
}

function loadErrors() {
  try {
    if (!fs.existsSync(ERRORS_FILE)) {
      throw new Error(`Errors file not found: ${ERRORS_FILE}`);
    }
  } catch (e) {
    throw new Error(`Failed to check errors file: ${e.message}`);
  }

  const data = (() => {
    try {
      return JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to read errors file: ${e.message}`);
    }
  })();
  return data.errors || [];
}

function groupErrorsByType(errors) {
  const grouped = {};

  errors.forEach(error => {
    const type = error.type || 'Unknown';
    if (!grouped[type]) {
      grouped[type] = {
        type: type,
        errors: [],
        severity: error.severity || 2,
        totalCount: 0
      };
    }
    grouped[type].errors.push(error);
    grouped[type].totalCount += error.count || 1;
  });

  return grouped;
}

function calculateConfidence(errorGroup) {
  // 基於錯誤數量計算 confidence
  const count = errorGroup.totalCount;
  if (count >= 20) return 0.95;
  if (count >= 10) return 0.90;
  if (count >= 5) return 0.85;
  if (count >= 3) return 0.75;
  return 0.65;
}

function determineStatus(errorGroup) {
  // 如果有多個未解決的錯誤，標記為 contested
  const unresolvedCount = errorGroup.errors.filter(e => !e.resolved).length;
  if (unresolvedCount > 5) return 'contested';
  if (unresolvedCount > 0) return 'supported';
  return 'superseded'; // 所有錯誤都已解決
}

function generateErrorTypePage(typeKey, errorGroup) {
  const typeId = typeKey.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const confidence = calculateConfidence(errorGroup);
  const status = determineStatus(errorGroup);

  let content = `# Error Pattern: ${errorGroup.type}

> Auto-generated from errors.json
> Type ID: \`${typeId}\`
> Updated: ${getHKTDateTime()}

## Summary

| Metric | Value |
|--------|-------|
| Total Occurrences | ${errorGroup.totalCount} |
| Unique Instances | ${errorGroup.errors.length} |
| Severity Level | ${errorGroup.severity}/5 |
| Confidence | ${confidence.toFixed(2)} |

## Claims

- [claim::error-${typeId}] ${errorGroup.type} is a recurring error pattern
  - status: ${status}
  - confidence: ${confidence.toFixed(2)}
  - freshness: fresh
  - tags: [error, pattern, ${typeId}]
  - evidence:
`;

  // 添加最近的 3 個錯誤作為 evidence
  const recentErrors = errorGroup.errors
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 3);

  recentErrors.forEach(error => {
    const safeProblem = (error.problem || 'Unknown error')
      .replace(/"/g, '\\"')
      .substring(0, 100);
    content += `    - source: memory/errors.json
      quote: "${safeProblem}${safeProblem.length >= 100 ? '...' : ''}"
      timestamp: ${error.timestamp || error.date}
      severity: ${error.severity || 2}
`;
  });

  content += `

## Recent Occurrences

| Date | Problem | Count | Status |
|------|---------|-------|--------|
`;

  errorGroup.errors
    .sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date))
    .slice(0, 10)
    .forEach(error => {
      const date = error.date || error.timestamp?.split('T')[0] || 'Unknown';
      const problem = (error.problem || 'Unknown').substring(0, 40).replace(/\|/g, '\\|');
      const count = error.count || 1;
      const resolved = error.resolved ? '✅' : '❌';
      content += `| ${date} | ${problem}... | ${count} | ${resolved} |\n`;
    });

  content += `

## Prevention

- Monitor logs for "${errorGroup.type}" patterns
- Set up alerts when count exceeds threshold
- Review related issues for context

## Related

- [All Error Patterns](./error-patterns.md)
- [System Health](../system/health.md)
`;

  return { typeId, content };
}

function generateErrorPatternsIndex(groupedErrors) {
  const totalErrors = Object.values(groupedErrors).reduce((sum, g) => sum + g.totalCount, 0);
  const totalTypes = Object.keys(groupedErrors).length;

  let content = `# Error Patterns

> Auto-generated from errors.json
> Updated: ${getHKTDateTime()}

## Summary

| Metric | Value |
|--------|-------|
| Total Error Types | ${totalTypes} |
| Total Occurrences | ${totalErrors} |
| Unresolved Errors | ${Object.values(groupedErrors).flatMap(g => g.errors).filter(e => !e.resolved).length} |

## Error Types

| Type | Count | Severity | Confidence | Status |
|------|-------|----------|------------|--------|
`;

  Object.values(groupedErrors)
    .sort((a, b) => b.totalCount - a.totalCount)
    .forEach(group => {
      const typeId = group.type.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const confidence = calculateConfidence(group);
      const status = determineStatus(group);
      content += `| [${group.type}](./error-${typeId}.md) | ${group.totalCount} | ${group.severity}/5 | ${confidence.toFixed(2)} | ${status} |\n`;
    });

  content += `

## Top Issues

### High Frequency Errors (>10 occurrences)
`;

  Object.values(groupedErrors)
    .filter(g => g.totalCount >= 10)
    .forEach(group => {
      content += `- **${group.type}**: ${group.totalCount} occurrences\n`;
    });

  content += `

### High Severity Errors (Severity 4-5)
`;

  Object.values(groupedErrors)
    .filter(g => g.severity >= 4)
    .forEach(group => {
      content += `- **${group.type}**: Severity ${group.severity}\n`;
    });

  content += `

## See Also

- [Active Issues](../issues/index.md)
- [System Logs](./logs/)
`;

  return content;
}

function syncErrorsToWiki() {
  log('info', 'Syncing Errors to Wiki...\n');

  const errors = loadErrors();
  log('info', `Loaded ${errors.length} total errors`);

  const unresolvedErrors = errors.filter(e => !e.resolved);
  log('info', `${unresolvedErrors.length} unresolved errors\n`);

  const grouped = groupErrorsByType(unresolvedErrors);
  log('info', `Grouped into ${Object.keys(grouped).length} error types\n`);

  if (DRY_RUN) {
    log('warn', 'Running in DRY-RUN mode (no changes will be made)\n');
  } else {
    try {
      fs.mkdirSync(ERRORS_WIKI_DIR, { recursive: true });
    } catch (e) {
      throw new Error(`Failed to create wiki dir: ${e.message}`);
    }
  }

  // 為每個錯誤類型生成頁面
  let syncedCount = 0;
  Object.entries(grouped).forEach(([type, errorGroup]) => {
    const { typeId, content } = generateErrorTypePage(type, errorGroup);
    const pagePath = path.join(ERRORS_WIKI_DIR, `error-${typeId}.md`);

    if (DRY_RUN) {
      log('info', `[DRY-RUN] Would create: error-${typeId}.md`);
    } else {
      try {
        fs.writeFileSync(pagePath, content);
        log('success', `Created: error-${typeId}.md (${errorGroup.totalCount} occurrences)`);
      } catch (e) {
        throw new Error(`Failed to write ${pagePath}: ${e.message}`);
      }
    }
    syncedCount++;
  });

  // 生成總索引頁面
  const indexContent = generateErrorPatternsIndex(grouped);
  const indexPath = path.join(ERRORS_WIKI_DIR, 'error-patterns.md');

  if (DRY_RUN) {
    log('info', `[DRY-RUN] Would update: error-patterns.md`);
  } else {
    try {
      fs.writeFileSync(indexPath, indexContent);
      log('success', 'Updated: error-patterns.md');
    } catch (e) {
      throw new Error(`Failed to write index: ${e.message}`);
    }
  }

  console.log('');
  log('info', `Summary: ${syncedCount} error types processed`);

  return syncedCount;
}

// 主執行
if (require.main === module) {
  try {
    const synced = syncErrorsToWiki();

    if (synced > 0 && !DRY_RUN) {
      console.log('');
      log('info', 'Remember to run: openclaw wiki compile');
    }

    process.exit(0);
  } catch (error) {
    log('error', error.message);
    console.error(error);
    process.exit(1);
  }
}

module.exports = { syncErrorsToWiki, groupErrorsByType };
