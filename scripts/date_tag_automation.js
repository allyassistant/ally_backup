#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Date Tag Automation for MEMORY.md
 * 日期標籤自動化系統
 *
 * Features:
 * - 自動為新條目添加日期標籤
 * - 標準化日期格式
 * - 自動更新 "Last Updated" 標記
 * - 追蹤內容變更歷史
 */

const fs = require('fs');
const path = require('path');

const { WS, MEMORY_DIR } = require('./lib/config');
const MEMORY_FILE = path.join(WS, 'MEMORY.md');
const STATE_FILE = path.join(MEMORY_DIR, 'date-tag-state.json');
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE, { taggedSections: [], lastAutoTag: null, updateHistory: [] });

// Date format patterns
const DATE_FORMATS = {
  standard: 'YYYY-MM-DD',
  chinese: 'YYYY年M月D日',
  full: 'YYYY-MM-DD HH:mm'
};

// Tag patterns
const TAGS = {
  created: '📅 Created',
  updated: '🔄 Updated',
  reviewed: '👁️ Reviewed',
  expires: '⏰ Expires'
};

/**
 * Get current date in standard format
 */
function getStandardDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Get current date in Chinese format
 */
function getChineseDate() {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

/**
 * Get current timestamp
 */
function getTimestamp() {
  const now = new Date();
  return now.toLocaleString('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Read MEMORY.md
 */
function readMemoryFile() {
  try {
    return fs.readFileSync(MEMORY_FILE, 'utf8');
  } catch (e) {
    console.error('Error reading file: ' + e.message);
    return '';
  }
}

/**
 * Write MEMORY.md
 */
function writeMemoryFile(content) {
  try {
    const tmpPath = MEMORY_FILE + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, MEMORY_FILE);
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }
}

/**
 * Check if a section already has date tags
 */
function hasDateTags(section) {
  return section.includes(TAGS.created) ||
         section.includes(TAGS.updated) ||
         section.includes('Created:') ||
         section.includes('Updated:');
}

/**
 * Add date tags to a section
 */
function addDateTags(section, options = {}) {
  const today = getStandardDate();
  const chineseDate = getChineseDate();

  // Don't add if already has tags
  if (hasDateTags(section) && !options.force) {
    return section;
  }

  const lines = section.split('\n');
  const taggedLines = [];
  let headerFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    taggedLines.push(line);

    // After the header, add date tags
    if (!headerFound && line.startsWith('#') && i < 3) {
      headerFound = true;
      taggedLines.push('');
      taggedLines.push(`*${TAGS.created}: ${today} | ${TAGS.updated}: ${today}*`);
    }
  }

  return taggedLines.join('\n');
}

/**
 * Update "Updated" date for modified sections
 */
function updateModifiedDate(content, sectionTitle) {
  const today = getStandardDate();
  const lines = content.split('\n');
  let inTargetSection = false;
  let sectionStart = -1;
  let sectionEnd = -1;

  // Find section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#') && line.includes(sectionTitle)) {
      inTargetSection = true;
      sectionStart = i;
      continue;
    }

    if (inTargetSection && line.startsWith('#') && !line.includes(sectionTitle)) {
      sectionEnd = i;
      break;
    }
  }

  if (sectionStart === -1) return content;
  if (sectionEnd === -1) sectionEnd = lines.length;

  // Update date in section
  for (let i = sectionStart; i < sectionEnd && i < sectionStart + 5; i++) {
    const line = lines[i];

    // Update existing Updated tag
    if (line.includes(TAGS.updated) || line.includes('Updated:')) {
      lines[i] = line.replace(/Updated:\s*\d{4}-\d{2}-\d{2}/, `Updated: ${today}`);
      lines[i] = line.replace(/🔄 Updated:\s*\d{4}-\d{2}-\d{2}/, `🔄 Updated: ${today}`);
      break;
    }
  }

  return lines.join('\n');
}

/**
 * Auto-tag new sections
 */
function autoTagNewSections() {
  const content = readMemoryFile();
  const state = loadState();
  const lines = content.split('\n');

  let modified = false;
  let newContent = [];
  let currentSection = [];
  let currentHeader = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for section header
    if (line.startsWith('## ') || line.startsWith('### ')) {
      // Process previous section
      if (currentSection.length > 0 && currentHeader) {
        const sectionText = currentSection.join('\n');

        if (!hasDateTags(sectionText)) {
          // Add date tags
          const taggedSection = addDateTags(sectionText);
          newContent.push(taggedSection);
          modified = true;

          // Record in state
          state.taggedSections.push({
            header: currentHeader,
            taggedAt: getTimestamp(),
            autoTagged: true
          });
        } else {
          newContent.push(sectionText);
        }
      }

      currentHeader = line;
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  // Process last section
  if (currentSection.length > 0 && currentHeader) {
    const sectionText = currentSection.join('\n');

    if (!hasDateTags(sectionText)) {
      const taggedSection = addDateTags(sectionText);
      newContent.push(taggedSection);
      modified = true;

      state.taggedSections.push({
        header: currentHeader,
        taggedAt: getTimestamp(),
        autoTagged: true
      });
    } else {
      newContent.push(sectionText);
    }
  }

  if (modified) {
    state.lastAutoTag = getTimestamp();
    saveState(state);
    writeMemoryFile(newContent.join('\n'));
  }

  return {
    modified,
    taggedCount: state.taggedSections.filter(s => s.autoTagged).length
  };
}

/**
 * Update global "Last Updated" timestamp
 */
function updateGlobalTimestamp() {
  const content = readMemoryFile();
  const today = getStandardDate();
  const chineseDate = getChineseDate();

  // Look for existing Last Updated line
  const updatedContent = content.replace(
    /\*Last Updated:\s*\d{4}-\d{2}-\d{2}\*/,
    `*Last Updated: ${today}*`
  ).replace(
    /最後更新:\s*\d{4}年\d{1,2}月\d{1,2}日/,
    `最後更新: ${chineseDate}`
  );

  if (content !== updatedContent) {
    writeMemoryFile(updatedContent);
    return { updated: true, date: today };
  }

  return { updated: false };
}

/**
 * Add date tag to specific section
 */
function tagSection(sectionTitle, options = {}) {
  const content = readMemoryFile();
  const state = loadState();

  const today = getStandardDate();
  const lines = content.split('\n');
  let inSection = false;
  let sectionStart = -1;
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#') && line.includes(sectionTitle)) {
      inSection = true;
      sectionStart = i;

      // Check if already tagged
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (!hasDateTags(nextLine) || options.force) {
          // Insert date tag after header
          lines.splice(i + 1, 0, '', `*${TAGS.created}: ${today} | ${TAGS.updated}: ${today}*`);
          modified = true;

          state.taggedSections.push({
            header: sectionTitle,
            taggedAt: getTimestamp(),
            autoTagged: false
          });
          saveState(state);
        }
      }
      break;
    }
  }

  if (modified) {
    writeMemoryFile(lines.join('\n'));
  }

  return { modified, section: sectionTitle };
}

/**
 * Get sections without date tags
 */
function getUntaggedSections() {
  const content = readMemoryFile();
  const lines = content.split('\n');
  const untagged = [];

  let currentHeader = null;
  let currentSection = [];

  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('### ')) {
      if (currentHeader && currentSection.length > 0) {
        const sectionText = currentSection.join('\n');
        if (!hasDateTags(sectionText)) {
          untagged.push({
            header: currentHeader,
            preview: sectionText.substring(0, 100) + '...'
          });
        }
      }
      currentHeader = line;
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  // Check last section
  if (currentHeader && currentSection.length > 0) {
    const sectionText = currentSection.join('\n');
    if (!hasDateTags(sectionText)) {
      untagged.push({
        header: currentHeader,
        preview: sectionText.substring(0, 100) + '...'
      });
    }
  }

  return untagged;
}

/**
 * Generate date tag report
 */
function generateReport() {
  const state = loadState();
  const untagged = getUntaggedSections();

  let report = `# MEMORY.md 日期標籤報告\n\n`;
  report += `生成時間: ${getTimestamp()}\n\n`;

  report += `## 📊 統計\n\n`;
  report += `- 已標記區域: ${state.taggedSections.length}\n`;
  report += `- 未標記區域: ${untagged.length}\n`;
  report += `- 最後自動標記: ${state.lastAutoTag || 'N/A'}\n\n`;

  if (untagged.length > 0) {
    report += `## ⚠️ 未標記區域\n\n`;
    for (const section of untagged) {
      report += `- ${section.header}\n`;
    }
    report += `\n`;
  }

  report += `## 🏷️ 標籤格式\n\n`;
  report += '```\n';
  report += `*📅 Created: ${getStandardDate()} | 🔄 Updated: ${getStandardDate()}*\n`;
  report += '```\n';

  return report;
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'auto':
      const autoResult = autoTagNewSections();
      const globalResult = updateGlobalTimestamp();
      log(JSON.stringify({ ...autoResult, globalUpdate: globalResult }, null, 2));
      break;

    case 'tag':
      const sectionTitle = args[1];
      if (!sectionTitle) {
        console.error('請提供區域名稱');
        process.exit(1);
      }
      const tagResult = tagSection(sectionTitle, { force: args.includes('--force') });
      log(JSON.stringify(tagResult, null, 2));
      break;

    case 'update':
      const updateTitle = args[1];
      if (!updateTitle) {
        console.error('請提供區域名稱');
        process.exit(1);
      }
      const content = readMemoryFile();
      const updated = updateModifiedDate(content, updateTitle);
      writeMemoryFile(updated);
      log(JSON.stringify({ updated: true, section: updateTitle }, null, 2));
      break;

    case 'untagged':
      log(JSON.stringify(getUntaggedSections(), null, 2));
      break;

    case 'scan':
    case 'report':
      log(generateReport());
      break;

    case 'global':
      log(JSON.stringify(updateGlobalTimestamp(), null, 2));
      break;

    default:
      log(`
Date Tag Automation System

Usage:
  node date_tag_automation.js [command] [options]

Commands:
  auto              - 自動標記新區域並更新全局時間戳
  tag [section]     - 為特定區域添加日期標籤
  update [section]  - 更新特定區域的 Updated 日期
  untagged          - 列出未標記的區域
  scan              - 掃描並生成日期標籤報告（同 report）
  report            - 生成日期標籤報告
  global            - 更新全局 Last Updated 時間戳

Examples:
  node date_tag_automation.js auto
  node date_tag_automation.js tag "Rapaport 價格計算"
  node date_tag_automation.js update "Stock List 整合流程"
      `);
  }
}

module.exports = {
  addDateTags,
  updateModifiedDate,
  autoTagNewSections,
  updateGlobalTimestamp,
  tagSection,
  getUntaggedSections,
  generateReport,
  hasDateTags,
  getStandardDate,
  getChineseDate,
  TAGS
};
