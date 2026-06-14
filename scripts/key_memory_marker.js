#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Key Memory Marker System
 * 關鍵記憶標記機制
 *
 * Features:
 * - 標記重要記憶防止誤刪
 * - 自動識別關鍵內容
 * - 保護標記區域在維護時不被刪除
 * - 生成關鍵記憶摘要
 */

const fs = require('fs');
const path = require('path');

const { WS, MEMORY_DIR } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const MEMORY_FILE = path.join(WS, 'MEMORY.md');
const STATE_FILE = path.join(MEMORY_DIR, 'key-memory-markers.json');
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE, { markedSections: [], autoDetected: [], lastScan: null, protectedLines: [] });

// Marker patterns
const MARKERS = {
  start: '### 🎯 KEY MEMORY START',
  end: '### 🎯 KEY MEMORY END',
  inline: '📌',
  important: '⭐',
  critical: '🔴'
};

// Auto-detect patterns for key memories
const KEY_MEMORY_PATTERNS = [
  { pattern: /重要聯絡|聯絡方式|contact/i, type: 'contact', priority: 'high' },
  { pattern: /用戶偏好|preference|偏好/i, type: 'preference', priority: 'high' },
  { pattern: /Rapaport|價格計算|估值/i, type: 'business_rule', priority: 'high' },
  { pattern: /Stock List|Template|標準流程/i, type: 'workflow', priority: 'high' },
  { pattern: /GitHub|Repository|API Key/i, type: 'technical', priority: 'medium' },
  { pattern: /Qwen3|訓練|學習/i, type: 'learning', priority: 'medium' },
  { pattern: /待實施|進行中|待決定/i, type: 'pending', priority: 'high' }
];


/**
 * Read MEMORY.md content
 */
function readMemoryFile() {
  try {
    return fs.readFileSync(MEMORY_FILE, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Find marked sections in MEMORY.md
 */
function findMarkedSections(content) {
  const sections = [];
  const lines = content.split('\n');
  let currentSection = null;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;

    // Check for start marker
    if (line.includes(MARKERS.start) || line.includes('<!-- KEY MEMORY -->')) {
      currentSection = {
        startLine: lineNumber,
        endLine: null,
        title: extractTitle(line),
        content: []
      };
    }

    // Check for end marker
    if (currentSection && (line.includes(MARKERS.end) || line.includes('<!-- END KEY MEMORY -->'))) {
      currentSection.endLine = lineNumber;
      sections.push(currentSection);
      currentSection = null;
      continue;
    }

    // Add content to current section
    if (currentSection) {
      currentSection.content.push(line);
    }
  }

  return sections;
}

/**
 * Extract title from marker line
 */
function extractTitle(line) {
  // Try to extract title after marker
  const match = line.match(/[:：]\s*(.+)/);
  if (match) return match[1].trim();

  // Or use the whole line without marker
  return line.replace(/#{1,6}\s*/, '').replace(MARKERS.start, '').trim() || 'Untitled';
}

/**
 * Auto-detect key memories based on patterns
 */
function autoDetectKeyMemories(content) {
  const detected = [];
  const lines = content.split('\n');

  // Find headers and their content
  let currentHeader = null;
  let currentContent = [];
  let headerLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this is a header
    if (line.startsWith('#')) {
      // Process previous section if exists
      if (currentHeader) {
        const sectionText = currentContent.join('\n');

        for (const { pattern, type, priority } of KEY_MEMORY_PATTERNS) {
          if (pattern.test(currentHeader) || pattern.test(sectionText)) {
            detected.push({
              header: currentHeader,
              line: headerLine,
              type,
              priority,
              preview: sectionText.substring(0, 200) + '...'
            });
            break;
          }
        }
      }

      currentHeader = line;
      headerLine = i + 1;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  return detected;
}

/**
 * Get protected line ranges (marked sections)
 */
function getProtectedRanges(content) {
  const sections = findMarkedSections(content);
  const ranges = [];

  for (const section of sections) {
    if (section.endLine) {
      ranges.push({
        start: section.startLine,
        end: section.endLine,
        type: 'marked_section'
      });
    }
  }

  return ranges;
}

/**
 * Check if a line is within protected range
 */
function isLineProtected(lineNumber, protectedRanges) {
  for (const range of protectedRanges) {
    if (lineNumber >= range.start && lineNumber <= range.end) {
      return true;
    }
  }
  return false;
}

/**
 * Add key memory markers to a section
 */
function addMarkers(title, content) {
  return `${MARKERS.start}: ${title}
${content}
${MARKERS.end}`;
}

/**
 * Scan and update key memory markers
 */
function scanAndUpdate() {
  const content = readMemoryFile();
  const state = loadState();

  // Find existing marked sections
  const markedSections = findMarkedSections(content);

  // Auto-detect potential key memories
  const autoDetected = autoDetectKeyMemories(content);

  // Update state
  state.markedSections = markedSections.map(s => ({
    title: s.title,
    startLine: s.startLine,
    endLine: s.endLine,
    lineCount: s.endLine - s.startLine + 1
  }));

  state.autoDetected = autoDetected;
  state.lastScan = getHKTDateTime();

  // Calculate protected lines
  const protectedLines = [];
  for (const section of markedSections) {
    if (section.endLine) {
      for (let i = section.startLine; i <= section.endLine; i++) {
        protectedLines.push(i);
      }
    }
  }
  state.protectedLines = protectedLines;

  saveState(state);

  return {
    markedSections: state.markedSections,
    autoDetected: state.autoDetected,
    protectedLineCount: protectedLines.length
  };
}

/**
 * Generate key memory summary
 */
function generateSummary() {
  const state = loadState();
  const content = readMemoryFile();

  let summary = `# 關鍵記憶摘要\n\n`;
  summary += `生成時間: ${new Date().toLocaleString('zh-HK')}\n\n`;

  // Marked sections
  summary += `## 🎯 已標記區域 (${state.markedSections.length})\n\n`;
  for (const section of state.markedSections) {
    summary += `- **${section.title}** (第 ${section.startLine}-${section.endLine} 行, ${section.lineCount} 行)\n`;
  }

  // Auto-detected
  summary += `\n## 🔍 自動檢測到的關鍵記憶 (${state.autoDetected.length})\n\n`;
  const byPriority = { high: [], medium: [], low: [] };
  for (const item of state.autoDetected) {
    byPriority[item.priority].push(item);
  }

  if (byPriority.high.length > 0) {
    summary += `### 🔴 高優先級\n`;
    for (const item of byPriority.high) {
      summary += `- ${item.header} (${item.type})\n`;
    }
    summary += `\n`;
  }

  if (byPriority.medium.length > 0) {
    summary += `### 🟡 中優先級\n`;
    for (const item of byPriority.medium) {
      summary += `- ${item.header} (${item.type})\n`;
    }
    summary += `\n`;
  }

  summary += `\n## 📊 統計\n\n`;
  summary += `- 受保護行數: ${state.protectedLines.length}\n`;
  summary += `- 最後掃描: ${state.lastScan || 'N/A'}\n`;

  return summary;
}

/**
 * Get maintenance-safe content (excluding protected ranges)
 * This is used by memory_maintenance.js
 */
function getMaintenanceSafeContent() {
  const content = readMemoryFile();
  const state = loadState();
  const lines = content.split('\n');
  const protectedRanges = getProtectedRanges(content);

  const safeLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isLineProtected(i + 1, protectedRanges)) {
      safeLines.push(lines[i]);
    } else {
      // Keep marker lines but mark them
      const line = lines[i];
      if (line.includes(MARKERS.start) || line.includes(MARKERS.end)) {
        safeLines.push(line);
      } else {
        safeLines.push(`<!-- PROTECTED: ${line.substring(0, 50)}... -->`);
      }
    }
  }

  return safeLines.join('\n');
}

/**
 * Validate markers are balanced
 */
function validateMarkers() {
  const content = readMemoryFile();
  const lines = content.split('\n');

  let openCount = 0;
  let closeCount = 0;
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes(MARKERS.start) || line.includes('<!-- KEY MEMORY -->')) {
      openCount++;
    }

    if (line.includes(MARKERS.end) || line.includes('<!-- END KEY MEMORY -->')) {
      closeCount++;
      if (openCount < closeCount) {
        issues.push(`Line ${i + 1}: 發現結束標記但無對應開始標記`);
      }
    }
  }

  if (openCount > closeCount) {
    issues.push(`有 ${openCount - closeCount} 個開始標記無對應結束標記`);
  }

  return {
    valid: issues.length === 0,
    openCount,
    closeCount,
    issues
  };
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'scan':
      const result = scanAndUpdate();
      log(JSON.stringify(result, null, 2));
      break;

    case 'summary':
      log(generateSummary());
      break;

    case 'validate':
      const validation = validateMarkers();
      log(JSON.stringify(validation, null, 2));
      break;

    case 'protected':
      const content = readMemoryFile();
      const ranges = getProtectedRanges(content);
      log(JSON.stringify(ranges, null, 2));
      break;

    default:
      log(`
Key Memory Marker System

Usage:
  node key_memory_marker.js [command]

Commands:
  scan       - 掃描並更新關鍵記憶標記
  summary    - 生成關鍵記憶摘要
  validate   - 驗證標記是否平衡
  protected  - 顯示受保護的行範圍

Markers:
  ${MARKERS.start} - 開始標記
  ${MARKERS.end} - 結束標記
  ${MARKERS.inline} - 行內重要標記
      `);
  }
}

module.exports = {
  findMarkedSections,
  autoDetectKeyMemories,
  getProtectedRanges,
  isLineProtected,
  addMarkers,
  scanAndUpdate,
  generateSummary,
  getMaintenanceSafeContent,
  validateMarkers,
  MARKERS
};
