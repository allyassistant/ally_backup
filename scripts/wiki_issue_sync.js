#!/usr/bin/env node
/**
 * Issue → Wiki Sync Script
 * 將 active issues 同步到 Wiki Claims
 *
 * 用法: node scripts/wiki_issue_sync.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

const WORKSPACE = path.join(process.env.HOME, '.openclaw/workspace');
const ISSUES_DIR = path.join(WORKSPACE, '.issues/active');
const WIKI_VAULT = path.join(WORKSPACE, '.openclaw-wiki');
const ISSUES_WIKI_DIR = path.join(WIKI_VAULT, 'issues');

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

function parseIssue(content, filename) {
  // 提取標題
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : filename;

  // 提取 Problem
  const problemMatch = content.match(/##\s*Problem\s*\n+([\s\S]*?)(?=\n##|$)/i);
  const problem = problemMatch ? problemMatch[1].trim().substring(0, 200) : '';

  // 提取 Solution
  const solutionMatch = content.match(/##\s*Solution\s*\n+([\s\S]*?)(?=\n##|$)/i);
  const solution = solutionMatch ? solutionMatch[1].trim().substring(0, 200) : '';

  // 提取 Priority
  const priorityMatch = content.match(/priority:\s*(P[0-3])/i);
  const priority = priorityMatch ? priorityMatch[1] : 'P2';

  // 提取 Tags
  const tagsMatch = content.match(/tags:\s*\[([^\]]+)\]/);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [];

  return { filename, title, problem, solution, priority, tags };
}

function generateIssuePage(issue) {
  const pageName = `issue-${issue.filename.replace('.md', '')}`;
  const safeTitle = issue.title.replace(/"/g, '\\"');
  const safeProblem = issue.problem.replace(/"/g, '\\"').replace(/\n/g, ' ');

  let content = `# ${issue.title}

> Source: [.issues/active/${issue.filename}](../../.issues/active/${issue.filename})
> Priority: ${issue.priority}
> Synced: ${getHKTDateTime()}

## Claims

`;

  // Problem Claim
  if (issue.problem) {
    content += `- [claim::${pageName}-problem] ${safeProblem.substring(0, 100)}${safeProblem.length > 100 ? '...' : ''}
  - status: supported
  - confidence: ${issue.priority === 'P0' ? '0.95' : issue.priority === 'P1' ? '0.90' : '0.85'}
  - freshness: fresh
  - priority: ${issue.priority}
  - tags: [issue, ${issue.tags.join(', ') || 'general'}]
  - evidence:
    - source: .issues/active/${issue.filename}
      quote: "${safeProblem.substring(0, 80)}${safeProblem.length > 80 ? '...' : ''}"
      type: problem_statement

`;
  }

  // Solution Claim
  if (issue.solution) {
    const safeSolution = issue.solution.replace(/"/g, '\\"').replace(/\n/g, ' ');
    content += `- [claim::${pageName}-solution] ${safeSolution.substring(0, 100)}${safeSolution.length > 100 ? '...' : ''}
  - status: supported
  - confidence: 0.80
  - freshness: fresh
  - tags: [issue, solution, ${issue.tags.join(', ') || 'general'}]
  - evidence:
    - source: .issues/active/${issue.filename}
      quote: "Solution documented in issue"
      type: solution

`;
  }

  // Metadata Section
  content += `## Issue Metadata

| Field | Value |
|-------|-------|
| Issue ID | ${issue.filename.replace('.md', '')} |
| Priority | ${issue.priority} |
| Status | active |
| Tags | ${issue.tags.join(', ') || 'none'} |

## Related

- [Back to Issues Index](./index.md)
`;

  return { pageName, content };
}

function syncIssuesToWiki() {
  log('info', 'Syncing Issues to Wiki...\n');

  // 確保目錄存在
  if (!DRY_RUN) {
    try {
      fs.mkdirSync(ISSUES_WIKI_DIR, { recursive: true });
    } catch (e) {
      throw new Error(`Failed to create wiki dir: ${e.message}`);
    }
  }

  // 讀取所有 active issues
  const issueFiles = (() => {
    try {
      return fs.readdirSync(ISSUES_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
    } catch (e) {
      log('error', `Failed to read ISSUES_DIR: ${e.message}`);
      return [];
    }
  })();

  log('info', `Found ${issueFiles.length} active issues\n`);

  let syncedCount = 0;
  let skippedCount = 0;

  issueFiles.forEach(filename => {
    const filePath = path.join(ISSUES_DIR, filename);
    const content = (() => {
      try { return fs.readFileSync(filePath, 'utf8'); }
      catch (e) { log('error', `Failed to read issue file ${filename}: ${e.message}`); return ''; }
    })();
    if (!content) return;
    const issue = parseIssue(content, filename);


    const { pageName, content: pageContent } = generateIssuePage(issue);
    const pagePath = path.join(ISSUES_WIKI_DIR, `${pageName}.md`);

    // 檢查是否需要更新
    let shouldUpdate = true;
    try {
      if (fs.existsSync(pagePath)) {
        const existingContent = (() => {
          try { return fs.readFileSync(pagePath, 'utf8'); }
          catch (e) { log('warn', `Failed to read existing page: ${e.message}`); return ''; }
        })();
        // 簡單比較：如果標題相同且不是 dry-run，則跳過
        if (existingContent.includes(issue.title) && !DRY_RUN) {
          // 檢查 sync 時間
          const syncMatch = existingContent.match(/Synced:\s*(\S+)/);
          if (syncMatch) {
            const syncTime = new Date(syncMatch[1]);
            const fileTime = (() => {
              try { return fs.statSync(filePath).mtime; }
              catch (e) { return new Date(0); }
            })();
            if (syncTime > fileTime) {
              shouldUpdate = false;
              skippedCount++;
            }
          }
        }
      }
    } catch (e) {
      log('warn', `Failed to check page path: ${e.message}`);
    }

    if (shouldUpdate) {
      if (DRY_RUN) {
        log('info', `[DRY-RUN] Would sync: ${issue.title}`);
      } else {
        try {
          fs.writeFileSync(pagePath, pageContent);
          log('success', `Synced: ${issue.title}`);
        } catch (e) {
          throw new Error(`Failed to write ${pagePath}: ${e.message}`);
        }
      }
      syncedCount++;
    } else {
      log('info', `Skipped (up-to-date): ${issue.title}`);
    }
  });

  console.log('');
  log('info', `Summary: ${syncedCount} synced, ${skippedCount} skipped`);

  // 生成 Index 頁面
  if (!DRY_RUN && syncedCount > 0) {
    generateIssuesIndex(issueFiles);
  }

  return syncedCount;
}

function generateIssuesIndex(issueFiles) {
  log('info', 'Generating issues index...');

  let indexContent = `# Issues Index

> Auto-generated from .issues/active
> Updated: ${getHKTDateTime()}

## Active Issues

| Issue | Priority | Description |
|-------|----------|-------------|
`;

  issueFiles.forEach(filename => {
    const filePath = path.join(ISSUES_DIR, filename);
    const content = (() => {
      try { return fs['readFileSync'](filePath, 'utf8'); }
      catch (e) { log('error', `Failed to read issue file ${filename}: ${e.message}`); return ''; }
    })();
    if (!content) return;
    const issue = parseIssue(content, filename);
    const pageName = `issue-${filename.replace('.md', '')}`;

    indexContent += `| [${issue.title.substring(0, 30)}...](./${pageName}.md) | ${issue.priority} | ${issue.problem.substring(0, 40)}... |\n`;
  });

  indexContent += `

## Statistics

- Total Active: ${issueFiles.length}
- Last Sync: ${getHKTDateTime()}

## See Also

- [Error Patterns](../errors/error-patterns.md)
- [Project Wiki](../projects/index.md)
`;

  try {
    fs.writeFileSync(path.join(ISSUES_WIKI_DIR, 'index.md'), indexContent);
    log('success', 'Issues index generated');
  } catch (e) {
    throw new Error(`Failed to write index: ${e.message}`);
  }
}

// 主執行
if (require.main === module) {
  try {
    if (DRY_RUN) {
      log('warn', 'Running in DRY-RUN mode (no changes will be made)\n');
    }

    const synced = syncIssuesToWiki();

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

module.exports = { syncIssuesToWiki, parseIssue };
