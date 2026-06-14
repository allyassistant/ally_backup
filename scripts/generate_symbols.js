#!/usr/bin/env node
/**
 * generate_symbols.js
 *
 * 掃描 scripts/ 目錄，提取所有 JS 和 Shell 文件中的 symbols（函數、變量、類等），
 * 生成 SYMBOLS.md 導航地圖。
 *
 * 升級功能 v2：Cron + Errors + Logs 整合
 * - 讀取 HEARTBEAT.md → Cron Job 關聯（⏰）
 * - 讀取 memory/errors.json → Error 熱點（🔥）
 * - 內建 Log Pattern 表 → 預期日誌關鍵字（📋）
 *
 * 用法：
 *   node scripts/generate_symbols.js           # 標準輸出
 *   node scripts/generate_symbols.js --quiet   # 安靜模式
 *   node scripts/generate_symbols.js --output /path/to/output.md  # 指定輸出路徑
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============ 配置 ============
const SCRIPTS_DIR = path.join(process.env.HOME, '.openclaw/workspace/scripts');
const HEARTBEAT_PATH = path.join(process.env.HOME, '.openclaw/workspace/HEARTBEAT.md');
const ERRORS_JSON_PATH = path.join(process.env.HOME, '.openclaw/workspace/memory/errors.json');
const ISSUES_DIR_ACTIVE = path.join(process.env.HOME, '.openclaw/workspace/.issues/active');
const ISSUES_DIR_BACKLOG = path.join(process.env.HOME, '.openclaw/workspace/.issues/backlog');
const OUTPUT_PATH = path.join(SCRIPTS_DIR, 'SYMBOLS.md');

// ============ Regex Patterns ============
const JS_PATTERNS = {
  funcDecl: /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g,
  arrow1: /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
  arrow2: /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:(?!\bfunction\b)[^=])*=>/g,
  classDecl: /class\s+([a-zA-Z0-9_$]+)/g,
// v3.2: Additional patterns for better coverage
  moduleExports: /module\.exports\s*=\s*\{[^}]*\}/g,
};

const SH_PATTERNS = {
  funcStyle1: /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\)\s*\{/gm,
  funcStyle2: /^function\s+([a-zA-Z0-9_$]+)/gm,
};

// ============ 分類映射 ============
const CATEGORY_MAP = {
  'memory': 'Memory Management',
  'monitor': 'Heartbeat & Monitoring',
  'lib': 'Library Functions',
  'archive': 'Archive & Backup',
  'autoops': 'Automation & Operations',
  'discord': 'Discord Integration',
  'stock': 'Stock Processing',
  'auto-router': 'Auto Router',
  '__tests__': 'Tests',
  '__pycache__': 'Python Cache',
  '_legacy': 'Legacy',
  '_fix': 'Fix Scripts',
};

// ============ 內建 Log Pattern 表 ============
const LOG_PATTERNS = {
  atomicAppend:      '[MEM_WRITE_SUCCESS] / [MEM_WRITE_FAILED]',
  atomicWrite:       '[MEM_WRITE_SUCCESS] / [MEM_WRITE_FAILED]',
  callOllama:        '[OLLAMA_SUCCESS] / [OLLAMA_TIMEOUT]',
  callKimi:          '[KIMI_SUCCESS] / [KIMI_ERROR]',
  heartbeat:        '[HEARTBEAT_OK] / [HEARTBEAT_STALE]',
  heartbeatCheck:   '[HEARTBEAT_OK] / [HEARTBEAT_STALE]',
  failoverCheck:    '[FAILOVER_IDLE] / [FAILOVER_TRIGGERED]',
  logToDailyMemory: '[LOG_SUCCESS] / [LOG_SKIP]',
  memoryGenerator:  '[GEN_L0_OK] / [GEN_L1_OK] / [GEN_ERROR]',
  sendMessage:       '[MSG_SENT] / [MSG_FAILED]',
  sendDiscord:       '[DISCORD_OK] / [DISCORD_ERROR]',
  execCommand:       '[EXEC_OK] / [EXEC_ERROR]',
  spawnSubagent:     '[SPAWN_OK] / [SPAWN_TIMEOUT]',
};

// ============ Issues 整合功能 ============

/**
 * Priority emoji 映射
 */
function priorityEmoji(priority) {
  const map = { P0: '🚨', P1: '🔥', P2: '📌', P3: '📎' };
  return map[priority] || '';
}

function regexEscape(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 讀取指定目錄的所有 Issue 文件
 */
function loadIssuesFromDir(dirPath) {
  const issues = [];
  try {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, f), 'utf8');
        issues.push(parseIssue(content, f));
      } catch (e) {
        // 忽略無法讀取的檔案
      }
    }
  } catch (e) {
    // 目錄不存在，忽略
  }
  return issues;
}

/**
 * 解析單個 Issue 文件
 */
function parseIssue(content, filename) {
  const idMatch = content.match(/(?:^|\n)id:\s*(\d+)/i);
  const id = idMatch ? idMatch[1] : (filename.match(/(?:^|_)(0?\d+)\.md$/)?.[1] || '000');

  const titleMatch = content.match(/(?:^|\n)title:\s*(.+)/i);
  const title = titleMatch ? titleMatch[1].trim() : '無標題';

  const priorityMatch = content.match(/(?:^|\n)priority:\s*(P\d+)/i);
  const priority = priorityMatch ? priorityMatch[1].toUpperCase() : 'P0';

  const statusMatch = content.match(/(?:^|\n)status:\s*(.+)/i);
  const status = statusMatch ? statusMatch[1].trim().toLowerCase() : 'active';

  // 提取提及的 .js / .sh 檔案名（帶反引號或空白包圍）
  const files = [];
  const scriptRefs = content.match(/[`\s]([a-zA-Z0-9_-]+\.(?:js|sh))\b/g);
  if (scriptRefs) {
    for (const ref of scriptRefs) {
      const name = ref.trim().replace(/[`\s]/g, '');
      if (name && !files.includes(name)) files.push(name);
    }
  }

  return { id, title, priority, status, files, filename };
}

/**
 * 載入所有 Issues（active + backlog）
 */
function loadAllIssues() {
  const active = loadIssuesFromDir(ISSUES_DIR_ACTIVE);
  const backlog = loadIssuesFromDir(ISSUES_DIR_BACKLOG);
  return [...active, ...backlog];
}

/**
 * 過濾顯示用的 Issues（排除 closed/completed/backlog）
 */
function getDisplayableIssues(allIssues) {
  return allIssues.filter(issue => {
    const s = issue.status;
    return s !== 'closed' && s !== 'completed' && s !== 'backlog';
  });
}

/**
 * 根據 symbol 名稱和所屬檔案，找到相關的 Issues
 */
function findIssueLinks(symbolName, filePath, displayableIssues) {
  const scriptFileName = path.basename(filePath);

  return displayableIssues.filter(issue => {
    try {
      // 1. Issue 標題包含 symbol 名稱（精確單詞匹配）
      const symbolWord = new RegExp(`\\b${regexEscape(symbolName || '')}\\b`, 'i');
      if (symbolWord.test(issue.title || '')) return true;

      // 2. Issue files 列表包含此 script 檔案名
      if (issue.files && issue.files.some(f => f === scriptFileName)) return true;

      return false;
    } catch {
      return false; // skip on invalid symbol/regex
    }
  });
}

// ============ Cron Jobs 整合（讀取 HEARTBEAT.md）============

/**
 * 從 HEARTBEAT.md 解析 Cron Jobs，返回 script → cron info 映射
 */
function loadCronJobsFromHeartbeat() {
  const cronByScript = {};  // scriptName → { schedule, id, jobName, status }

  try {
    const content = fs.readFileSync(HEARTBEAT_PATH, 'utf8');

    // 解析 Cron Jobs 表格：直接全文匹配所有 schedule/script/status 行
    // 匹配 7 列版本: | # | Name | Schedule | Script | Session | Status |
    //           和 8 列版本: | # | Name | Schedule | Script | | Session | Status | (每週)
    // Schedule 列允許 bold markers (**00:41**) 和空格 (Monday 10:00)
    const cronTableRowRegex = /\|\s*\d+\s*\|[^|]+\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|[^|]*\|\s*([^|]+?)\s*\|/g;
    let rowMatch;
    while ((rowMatch = cronTableRowRegex.exec(content)) !== null) {
      // 從 Schedule 列移除 **bold** markdown，合併多餘空白
      const schedule = rowMatch[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
      const scriptCmd = rowMatch[2].trim();
      const status = rowMatch[3].replace(/\*\*/g, '').trim();
      const scriptName = scriptCmd.split(' ')[0];
      if (!scriptName) continue;

      if (!cronByScript[scriptName]) {
        cronByScript[scriptName] = { schedule, id: null, jobName: null, status };
      } else if (cronByScript[scriptName].schedule !== schedule) {
        // 多時間 cron（如 10:00,15:00,22:00）合併 schedule
        cronByScript[scriptName].schedule += ' / ' + schedule;
      }
    }

    // 解析詳細區塊：### 1. L0 AI Generator ... ID: a240652b ...
    // 格式：ID: xxxxxx, Schedule: 5 0 * * * (00:05 HKT), Script: memory_generator.js ...
    const idBlockRegex = /### \d+\. (.+?)\n```\nID: ([a-z0-9]+)\nSchedule: [^\n]+\(([^\)]+)\)\nScript: ([^\n]+)/g;
    let blockMatch;
    while ((blockMatch = idBlockRegex.exec(content)) !== null) {
      const jobName = blockMatch[1].trim();
      const cronId = blockMatch[2].trim();
      const schedule = blockMatch[3].trim();
      const scriptLine = blockMatch[4].trim();
      const scriptName = scriptLine.split(' ')[0];

      if (cronByScript[scriptName]) {
        cronByScript[scriptName].id = cronId;
        cronByScript[scriptName].jobName = jobName;
      }
    }

  } catch (e) {
    // HEARTBEAT.md 不存在，忽略
  }

  // 統計
  const totalCronJobs = Object.keys(cronByScript).length;
  return { cronByScript, totalCronJobs };
}

// ============ Errors 整合（讀取 memory/errors.json）============

/**
 * 從 memory/errors.json 解析錯誤，統計每個 script 的錯誤
 */
function loadErrorsFromJson() {
  const errorsByScript = {};  // scriptName → { count, lastSeen, types: [] }

  try {
    const raw = fs.readFileSync(ERRORS_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    const errors = data.errors || [];

    // 遍歷所有未解決的錯誤
    for (const err of errors) {
      if (err.resolved) continue;

      // 嘗試從 source 提取 script 名稱
      // source 格式: "session:xxxxxx" 或 "manual"
      let scriptName = null;
      const src = err.source || '';

      if (src.startsWith('session:')) {
        // session 來源無法直接對應 script，但 HEARTBEAT.md cron jobs
        // 會告訴我們哪些 script 經常在某個 session 出現
        // 我們用 error title 中的關鍵字來識別
        // 例如："L0 timeout" → memory_generator.js
        const title = (err.title || '').toLowerCase();
        const problem = (err.problem || '').toLowerCase();

        if (title.includes('l0') || problem.includes('l0')) {
          scriptName = 'memory_generator.js';
        } else if (title.includes('l1') || problem.includes('l1')) {
          scriptName = 'memory_generator.js';
        } else if (title.includes('timeout') && (title.includes('cron') || title.includes('job'))) {
          // Cron Timeout 可能來自任何 cron job
          scriptName = '__cron_generic__';
        } else {
          // 根據 error type 推斷
          const type = (err.type || '').toLowerCase();
          if (type.includes('discord')) scriptName = 'discord_bot.js';
          else if (type.includes('whatsapp')) scriptName = 'whatsapp_handler.js';
          else if (type.includes('minimax') || type.includes('kimi') || type.includes('ollama')) {
            scriptName = 'memory_generator.js'; // AI 相關通常是 memory generator
          }
        }
      } else if (src === 'manual') {
        // 手動記錄的錯誤，直接用 tags 中的 script 名
        const tags = err.tags || [];
        for (const tag of tags) {
          if (tag.endsWith('.js') || tag.endsWith('.sh')) {
            scriptName = tag;
            break;
          }
        }
      }

      if (!scriptName) continue;

      if (!errorsByScript[scriptName]) {
        errorsByScript[scriptName] = { count: 0, lastSeen: null, types: new Set() };
      }
      errorsByScript[scriptName].count += (err.count || 1);
      errorsByScript[scriptName].types.add(err.type);

      // 更新 lastSeen（取最晚的 date）
      const errDate = err.date;
      if (!errorsByScript[scriptName].lastSeen || errDate > errorsByScript[scriptName].lastSeen) {
        errorsByScript[scriptName].lastSeen = errDate;
      }
    }

  } catch (e) {
    // errors.json 不存在或無法解析，忽略
  }

  return errorsByScript;
}

// ============ Log Pattern 表 ============

/**
 * 根據 symbol 名稱查詢預期 log pattern
 */
function getLogPattern(symbolName) {
  if (!symbolName) return null;
  // 精確匹配
  if (LOG_PATTERNS[symbolName]) return LOG_PATTERNS[symbolName];

  // 前綴匹配
  for (const [key, pattern] of Object.entries(LOG_PATTERNS)) {
    if (symbolName.startsWith(key) || key.startsWith(symbolName)) {
      return pattern;
    }
  }

  return null;
}

// ============ Cron / Error Display Helpers ============

/**
 * 生成 Cron job 的顯示字串
 */
function buildCronTag(scriptName, cronByScript) {
  const info = cronByScript[scriptName];
  if (!info) return null;

  let tag = `⏰ Cron: ${info.schedule}`;
  if (info.id) tag += ` [${info.id}]`;
  if (info.jobName) tag += ` (${info.jobName})`;
  return tag;
}

/**
 * 判斷是否為 HIGH ERROR RATE
 * 24 小時內 count > 5 → 🔥
 */
function isHighErrorRate(scriptName, errorsByScript) {
  const info = errorsByScript[scriptName];
  if (!info) return null;

  const isRecent = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = (now - d) / (1000 * 60 * 60 * 24);
    return diff <= 1;
  };

  if (info.count > 5 && isRecent(info.lastSeen)) {
    return { count: info.count, types: [...info.types], lastSeen: info.lastSeen };
  }
  return null;
}

// ============ 工具函數 ============

function isComment(line) {
  return /^\s*(\/\/|\/\*|\*|#\s)/.test(line.trim());
}

function cleanComment(line) {
  return line
    .replace(/^\s*\/\/\s*/, '')
    .replace(/^\s*\/\*\*?\s*/, '')
    .replace(/^\s*\*\s?/, '')
    .replace(/\*\/\s*$/, '')
    .replace(/^\s*#\s*/, '')
    .replace(/^\s*\*\//, '')
    .trim();
}

function extractPrecedingComments(lines, currentLine) {
  const comments = [];
  for (let i = 1; i <= 5; i++) {
    const idx = currentLine - i;
    if (idx < 0) break;
    const prevLine = lines[idx];
    if (isComment(prevLine)) {
      comments.unshift(cleanComment(prevLine));
    } else {
      break;
    }
  }
  return comments.join(' ').trim();
}

function getCategory(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts.length === 1) return 'Root Scripts';
  const firstDir = parts[0];
  return CATEGORY_MAP[firstDir] || firstDir;
}

function getSymbolIcon(type) {
  const icons = {
    'function': '🔧',
    'arrow function': '➡️',
    'variable': '📦',
    'class': '🏗️',
  };
  return icons[type] || '';
}

function getJSsymbolType(patternName) {
  const map = {
    funcDecl: 'function',
    arrow1: 'arrow function',
    arrow2: 'arrow function',
    classDecl: 'class',
  };
  return map[patternName] || 'unknown';
}

async function extractSymbolsFromFile(filePath, ext) {
  const symbols = [];

  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const lines = content.split('\n');

    if (ext === '.js') {
      for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];

        for (const [patternName, pattern] of Object.entries(JS_PATTERNS)) {
          pattern.lastIndex = 0;
          const match = pattern.exec(line);
          if (match) {
            const symbolName = match[1];
            if (!symbols.find(s => s.name === symbolName && s.line === lineNum)) {
              symbols.push({
                name: symbolName,
                line: lineNum,
                type: getJSsymbolType(patternName),
                summary: extractPrecedingComments(lines, i) || null,
              });
            }
          }
        }

        const varMatch = line.match(/^(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/);
        if (varMatch) {
          const symbolName = varMatch[1];
          if (!symbols.find(s => s.name === symbolName && s.line === lineNum)) {
            symbols.push({
              name: symbolName,
              line: lineNum,
              type: 'variable',
              summary: extractPrecedingComments(lines, i) || null,
            });
          }
        }
      }
    } else if (ext === '.sh') {
      const shellLines = content.split('\n');
      for (let i = 0; i < shellLines.length; i++) {
        const lineNum = i + 1;
        const line = shellLines[i];
        const seenNames = new Set();
        for (const [patternName, pattern] of Object.entries(SH_PATTERNS)) {
          pattern.lastIndex = 0;
          const match = pattern.exec(line);
          if (match) {
            const symbolName = match[1];
            if (!seenNames.has(symbolName)) {
              seenNames.add(symbolName);
              symbols.push({
                name: symbolName,
                line: lineNum,
                type: 'function',
                summary: extractPrecedingComments(shellLines, i) || null,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    return { error: err.message, symbols: [] };
  }

  return { symbols };
}

function scanDirectory(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', '__pycache__'].includes(entry.name)) continue;
        results.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.js', '.sh'].includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    // 忽略無法訪問的目錄
  }
  return results;
}

// ============ Markdown 生成 ============

function generateMarkdown(symbolsByFile, stats, displayableIssues, cronByScript, errorsByScript) {
  const today = new Date().toISOString().split('T')[0];

  // 計算 error stats
  const totalErrorCount = Object.values(errorsByScript).reduce((sum, e) => sum + e.count, 0);
  const hotScripts = Object.entries(errorsByScript)
    .filter(([_, info]) => {
      if (info.count <= 5 || !info.lastSeen) return false;
      const diff = (new Date() - new Date(info.lastSeen)) / (1000 * 60 * 60 * 24);
      return diff <= 1;
    })
    .map(([name]) => name);

  let md = `---
type: symbols_index
last_updated: ${today}
scope: scripts/
total_files: ${stats.files}
total_errors: ${totalErrorCount}
total_symbols: ${stats.symbols}
total_issues: ${displayableIssues.length}
total_crons: ${Object.keys(cronByScript).length}
hot_scripts: ${hotScripts.length}
---

# 🛠️ Scripts & Symbols Master Map

> 此文件為 OpenClaw 的核心導航地圖。尋找具體邏輯實現時，請優先檢索此處。

**生成時間：** ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}
**掃描範圍：** \`${SCRIPTS_DIR}\`

---

`;

  const categories = {};

  for (const [filePath, symbols] of Object.entries(symbolsByFile)) {
    if (symbols.length === 0) continue;
    const relativePath = path.relative(SCRIPTS_DIR, filePath);
    const category = getCategory(relativePath);
    if (!categories[category]) categories[category] = [];
    categories[category].push({ filePath, relativePath, symbols });
  }

  const sortedCategories = Object.keys(categories).sort();

  for (const category of sortedCategories) {
    md += `## 📂 ${category}\n\n`;
    const files = categories[category];
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const fileGroup of files) {
      const scriptFileName = path.basename(fileGroup.filePath);

      md += `### \`${fileGroup.relativePath}\`\n`;

      // === Script-level metadata ===
      const scriptCron = buildCronTag(scriptFileName, cronByScript);
      const scriptErrors = isHighErrorRate(scriptFileName, errorsByScript);

      if (scriptCron || scriptErrors) {
        md += `> **Script Info:** `;
        const infos = [];
        if (scriptCron) infos.push(scriptCron);
        if (scriptErrors) {
          const typeList = scriptErrors.types.slice(0, 3).join(', ');
          infos.push(`🔥 HIGH ERROR RATE: ${scriptErrors.count} errors (${typeList})`);
        }
        md += infos.join(' | ') + '\n\n';
      }

      const sortedSymbols = [...fileGroup.symbols].sort((a, b) => a.line - b.line);

      for (const symbol of sortedSymbols) {
        const typeIcon = getSymbolIcon(symbol.type);
        const summaryStr = symbol.summary || '[無描述]';

        const memoryWikiPatterns = [
          'log_to_daily_memory', 'memory_generator',
          'memory_section_cleanup', 'memory_archiver', 'memory_distiller',
        ];
        const isMemoryScript = memoryWikiPatterns.some(p => fileGroup.relativePath.includes(p));
        const wikiLink = isMemoryScript ? '\n  - 📖 Wiki: memory-architecture' : '';

        // === Issue Links ===
        const issueLinks = findIssueLinks(symbol.name, fileGroup.filePath, displayableIssues);
        let issueTags = '';
        if (issueLinks.length > 0) {
          for (const issue of issueLinks) {
            const emoji = priorityEmoji(issue.priority);
            const emojiStr = emoji ? ` ${emoji}` : '';
            issueTags += `\n  - 🔗 Issue: #${issue.id}${emojiStr} (${issue.title})`;
          }
        }

        // === Cron tag for this symbol ===
        const symbolCron = buildCronTag(scriptFileName, cronByScript);
        const cronTag = symbolCron ? `\n  - ${symbolCron}` : '';

        // === Error tag for this symbol ===
        const symbolError = isHighErrorRate(scriptFileName, errorsByScript);
        let errorTag = '';
        if (symbolError) {
          const typeList = symbolError.types.slice(0, 3).join(', ');
          errorTag = `\n  - 🔥 HIGH ERROR RATE: ${symbolError.count} errors (${typeList})`;
        }

        // === Log pattern ===
        const logPattern = getLogPattern(symbol.name);
        const logTag = logPattern ? `\n  - 📋 Log: ${logPattern}` : '';

        md += `- Line ${symbol.line}: \`${symbol.type} ${symbol.name}\` ${typeIcon}\n`;
        md += `  - 💡 ${summaryStr}${wikiLink}${cronTag}${errorTag}${logTag}${issueTags}\n`;
      }
      md += '\n';
    }
  }

  md += `---\n\n## 📋 Symbol Types Legend\n\n`;
  md += `| Type | Icon | Description |\n`;
  md += `|------|------|-------------|\n`;
  md += `| \`function\` | 🔧 | 函數聲明 |\n`;
  md += `| \`arrow function\` | ➡️ | 箭頭函數 |\n`;
  md += `| \`variable\` | 📦 | 常量/變量 |\n`;
  md += `| \`class\` | 🏗️ | 類聲明 |\n`;
  md += `| \`function\` (shell) | 🔧 | Shell 函數 |\n\n`;

  md += `## 🔗 Issue Tags Legend\n\n`;
  md += `| Emoji | Priority | 說明 |\n`;
  md += `|------|----------|------|\n`;
  md += `| 🚨 | P0 | 最高優先，緊急 |\n`;
  md += `| 🔥 | P1 | 高優先，待重構 |\n`;
  md += `| 📌 | P2 | 中優先，功能增強 |\n`;
  md += `| 📎 | P3 | 低優先，優化探索 |\n\n`;

  md += `## ⏰ Cron Job Legend\n\n`;
  md += `| Emoji | 說明 |\n`;
  md += `|------|------|\n`;
  md += `| ⏰ | Cron Job 關聯（讀取 HEARTBEAT.md） |\n`;
  md += `| 🔥 | HIGH ERROR RATE（24h 內 >5 個錯誤） |\n`;
  md += `| 📋 | 預期 Log 關鍵字（內建表） |\n\n`;
  md += `> Cron Jobs、Errors、Logs 數據來自 HEARTBEAT.md、memory/errors.json、內建 LOG_PATTERNS 表。\n`;
  md += `> 已關閉（closed/completed/backlog）的 Issue 不會顯示於符號地圖。\n\n`;

  return md;
}

// ============ 主函數 ============

async function main() {
  const args = process.argv.slice(2);
  let quiet = false;
  let outputPath = OUTPUT_PATH;

  for (const arg of args) {
    if (arg === '--quiet') {
      quiet = true;
    } else if (arg === '--output' || arg === '-o') {
      const idx = args.indexOf(arg);
      if (idx !== -1 && args[idx + 1]) outputPath = args[idx + 1];
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法: node generate_symbols.js [選項]\n  --quiet              安靜模式\n  --output <路徑>       指定輸出檔案\n  --help, -h            顯示幫助');
      return;
    }
  }

  let outputExists = false;
  try { outputExists = fs.existsSync(outputPath); } catch (e) {}
  if (outputExists) {
    const backupPath = outputPath + '.backup';
    try { fs.copyFileSync(outputPath, backupPath); } catch (e) {
      console.error('Failed to backup:', e.message);
      return;
    }
    if (!quiet) console.log(`📄 已備份原檔案至: ${backupPath}`);
  }

  if (!quiet) console.log('🔍 正在掃描 scripts/ 目錄...');

  // 載入 Issues
  const allIssues = loadAllIssues();
  const displayableIssues = getDisplayableIssues(allIssues);
  if (!quiet) {
    console.log(`📋 載入 ${allIssues.length} 個 Issues（${displayableIssues.length} 個顯示中，${allIssues.length - displayableIssues.length} 個已關閉）`);
  }

  // 載入 Cron Jobs（從 HEARTBEAT.md）
  const { cronByScript, totalCronJobs } = loadCronJobsFromHeartbeat();
  if (!quiet) {
    console.log(`⏰ 載入 ${totalCronJobs} 個 Cron Jobs（來自 HEARTBEAT.md）`);
  }

  // 載入 Errors（從 memory/errors.json）
  const errorsByScript = loadErrorsFromJson();
  const hotCount = Object.entries(errorsByScript)
    .filter(([_, info]) => {
      if (info.count <= 5 || !info.lastSeen) return false;
      const diff = (new Date() - new Date(info.lastSeen)) / (1000 * 60 * 60 * 24);
      return diff <= 1;
    }).length;
  if (!quiet) {
    const totalErr = Object.values(errorsByScript).reduce((s, e) => s + e.count, 0);
    console.log(`🔥 載入 ${hotCount} 個熱點腳本，總計 ${totalErr} 個錯誤（來自 memory/errors.json）`);
  }

  const files = scanDirectory(SCRIPTS_DIR);
  const stats = { files: files.length, errors: 0, symbols: 0 };
  const symbolsByFile = {};
  const errors = [];

  if (!quiet) console.log(`📁 找到 ${files.length} 個 JS/Shell 檔案\n`);

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const relativePath = path.relative(SCRIPTS_DIR, filePath);
    if (!quiet) process.stdout.write(`  處理中: ${relativePath}...\n`);

    const result = await extractSymbolsFromFile(filePath, ext);
    if (result.error) {
      errors.push({ file: relativePath, error: result.error });
      stats.errors++;
    } else {
      symbolsByFile[filePath] = result.symbols;
      stats.symbols += result.symbols.length;
    }
  }

  // === v3: Call Graph Extraction ===
  if (!quiet) console.log('\n🔗 提取 Call Graph...');
  const { callGraph, reverseCallGraph } = extractCallGraph(symbolsByFile);
  const edgeCount = Object.values(callGraph).reduce((s, c) => s + c.length, 0);

  // === v3: Snapshot / Change Detection ===
  const currentSnapshot = buildSnapshotHash(symbolsByFile);
  const previousSnapshot = loadPreviousSnapshot();
  const changes = generateChangeSummary(currentSnapshot, previousSnapshot);
  saveSnapshot(currentSnapshot);

  // === Save call graph data ===
  const stateDir = path.join(path.dirname(OUTPUT_PATH), '..', '.state');
  try {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  } catch (e) {
    console.error(`Error creating state dir: ${e.message}`);
  }
  const cgPath = path.join(stateDir, 'SYMBOLS_CALLGRAPH.json');
  try {
    const cgData = { callGraph, reverseCallGraph, generatedAt: new Date().toISOString() };
    fs.writeFileSync(cgPath + '.tmp', JSON.stringify(cgData, null, 2), 'utf8');
    fs.renameSync(cgPath + '.tmp', cgPath);
  } catch (e) {
    if (!quiet) console.error('Failed to save call graph:', e.message);
  }
  const chPath = path.join(stateDir, 'SYMBOLS_CHANGES.json');
  try {
    fs.writeFileSync(chPath + '.tmp', JSON.stringify(changes, null, 2), 'utf8');
    fs.renameSync(chPath + '.tmp', chPath);
  } catch (e) {}

  if (!quiet) console.log('\n📝 生成 SYMBOLS.md...\n');

  const md = generateMarkdown(symbolsByFile, stats, displayableIssues, cronByScript, errorsByScript);
  try {
    fs.writeFileSync(outputPath, md, 'utf8');
  } catch (e) {
    console.error('Failed to write SYMBOLS.md:', e.message);
    return;
  }

  if (!quiet) {
    console.log('\n========== 完成 ==========\n');
    console.log(`📄 輸出檔案: ${outputPath}`);
    console.log(`📁 處理檔案: ${stats.files}`);
    console.log(`⚠️  錯誤數量: ${stats.errors}`);
    console.log(`🔧 Symbol 總數: ${stats.symbols}`);
    console.log(`🔗 Call Graph: ${edgeCount} 條 edges`);
    console.log(`📦 變更: ${changes.summary}`);
    console.log(`🔗 Issue Tags: ${displayableIssues.length} 個顯示中`);
    console.log(`⏰ Cron Jobs: ${totalCronJobs} 個`);
    console.log(`🔥 Error 熱點: ${hotCount} 個腳本`);
    if (errors.length > 0) console.log('\n⚠️ 錯誤詳情已記錄至 SYMBOLS_ERROR.log');
  } else {
    console.log(`Processed ${stats.files} files, ${stats.errors} errors, ${stats.symbols} symbols, ${totalCronJobs} crons, ${hotCount} hot | ${edgeCount} edges | ${changes.summary}`);
  }
}

main().catch(err => {
  console.error('執行錯誤:', err);
  process.exit(1);
});
// ============ CALL GRAPH EXTRACTION (v3) ============

function extractCallGraph(symbolsByFile) {
  // Helper: strip type prefix
  function cleanName(name) {
    return String(name).replace(/^(?:function|arrow function|variable|class|const|let|var)\s+/i, '').trim();
  }

  // Build global symbol lookup
  const allSymbols = {};
  const builtin = new Set([
    'if','for','while','switch','catch','return','typeof','delete','throw',
    'new','else','case','in','of','require','import','export','default',
    'JSON','Object','Array','String','Number','Boolean','Math','Date','RegExp',
    'Set','Map','Promise','WeakMap','WeakSet','Symbol','BigInt','Infinity','NaN',
    'console','process','Buffer','Error','TypeError','SyntaxError',
    'parseInt','parseFloat','setTimeout','setInterval','clearTimeout','clearInterval',
    'isNaN','isFinite','undefined','null','true','false',
    'exports','module','constructor','toString','hasOwnProperty','valueOf',
    'fs','path','os','http','https','stream','util','events','crypto',
    'zlib','assert','net','tls','url','querystring','readline','cluster',
    'dns','dgram','punycode','string_decoder','timers','tty',
    'v8','vm','worker_threads','perf_hooks','inspector','async_hooks','http2',
    'diagnostics_channel','child_process',
    'it','describe','beforeEach','afterEach','before','after','test','expect','jest','vi',
    'then','catch','finally','resolve','reject','all','race','any',
    'map','filter','reduce','forEach','find','findIndex','some','every','includes',
    'flat','flatMap','sort','reverse','slice','splice','concat','join','split',
    'trim','trimStart','trimEnd','replace','replaceAll','match','matchAll','search',
    'indexOf','lastIndexOf','startsWith','endsWith','charAt','charCodeAt',
    'toUpperCase','toLowerCase','keys','values','entries',
    'has','get','set','add','delete','clear','apply','bind','call',
    'length','name','prototype','__proto__','constructor','super','this','arguments',
    'async','await','yield','generator','function','class','extends','static',
    'push','pop','shift','unshift',
    'readFileSync','writeFileSync','readdirSync','existsSync','mkdirSync',
    'unlinkSync','copyFileSync','renameSync','statSync','appendFileSync',
    'chmodSync','chownSync','symlinkSync','readlinkSync','realpathSync',
    'accessSync','openSync','closeSync'
  ]);

  for (const [filePath, symbols] of Object.entries(symbolsByFile)) {
    for (const raw of symbols) {
      const name = cleanName(raw.name);
      if (name && name.length > 1) {
        allSymbols[name] = true;
      }
    }
  }

  const callGraph = {};
  const reverseCallGraph = {};
  const funcCallRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

  for (const [filePath, symbols] of Object.entries(symbolsByFile)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileName = path.relative(SCRIPTS_DIR, filePath);
      const localSymbols = new Set();
      for (const raw of symbols) {
        localSymbols.add(cleanName(raw.name));
      }

      const sorted = symbols.map(r => ({ name: cleanName(r.name), line: r.line }))
        .filter(s => s.name && s.name.length > 1)
        .sort((a, b) => a.line - b.line);
      const lines = content.split('\n');

      for (let i = 0; i < sorted.length; i++) {
        const sym = sorted[i];
        const nextSym = sorted[i + 1];
        const bodyEnd = nextSym ? nextSym.line - 1 : lines.length;
        const bodyLines = lines.slice(Math.max(0, sym.line - 1), bodyEnd);
        const bodyText = bodyLines.join('\n');

        const bodyCalls = new Set();
        funcCallRegex.lastIndex = 0;
        let bm;
        while ((bm = funcCallRegex.exec(bodyText)) !== null) {
          const cname = bm[1];
          if (cname === sym.name) continue;
          if (cname.length < 2 || builtin.has(cname)) continue;
          if (allSymbols[cname]) {
            bodyCalls.add(cname);
          }
        }

        if (bodyCalls.size > 0) {
          callGraph[sym.name] = [...bodyCalls].sort();
          for (const callee of bodyCalls) {
            if (!reverseCallGraph[callee]) reverseCallGraph[callee] = [];
            if (!reverseCallGraph[callee].includes(sym.name)) {
              reverseCallGraph[callee].push(sym.name);
            }
          }
        }
      }
    } catch (e) {
      // skip unreadable files
    }
  }

  return { callGraph, reverseCallGraph };
}

// ============ SNAPSHOT / CHANGE DETECTION (v3) ============

const SNAPSHOT_PATH = path.join(path.dirname(OUTPUT_PATH), '..', '.state', 'SYMBOLS_SNAPSHOT.json');

function buildSnapshotHash(symbolsByFile) {
  const snapshot = {};
  const crypto = require('crypto');
  for (const [filePath, symbols] of Object.entries(symbolsByFile)) {
    const relPath = path.relative(SCRIPTS_DIR, filePath);
    const hashContent = symbols.map(s => s.name + ':' + s.line).sort().join('|');
    snapshot[relPath] = {
      hash: crypto.createHash('md5').update(hashContent).digest('hex').slice(0, 8),
      count: symbols.length,
      symbols: symbols.map(s => ({ name: s.name, line: s.line }))
    };
  }
  return snapshot;
}

function loadPreviousSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function saveSnapshot(snapshot) {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = SNAPSHOT_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmp, SNAPSHOT_PATH);
  } catch (e) {}
}

function generateChangeSummary(current, previous) {
  const changes = { added: [], modified: [], deleted: [], totalAdded: 0, totalDeleted: 0 };
  if (!previous) { changes.summary = 'first_run'; return changes; }

  for (const [file, info] of Object.entries(current)) {
    const prev = previous[file];
    if (!prev) { changes.added.push({ file, count: info.count }); changes.totalAdded += info.count; }
    else if (prev.hash !== info.hash) {
      changes.modified.push({ file, prevCount: prev.count, currCount: info.count });
    }
  }
  for (const [file, info] of Object.entries(previous)) {
    if (!current[file]) { changes.deleted.push({ file, count: info.count }); changes.totalDeleted += info.count; }
  }

  const parts = [];
  if (changes.totalAdded > 0) parts.push('新增 ' + changes.totalAdded + ' 個 symbols');
  if (changes.totalDeleted > 0) parts.push('刪除 ' + changes.totalDeleted + ' 個 symbols');
  if (changes.modified.length > 0) parts.push('修改 ' + changes.modified.length + ' 個檔案');
  changes.summary = parts.length > 0 ? parts.join('、') : '無變更';
  return changes;
}


