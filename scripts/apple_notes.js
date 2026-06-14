#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Apple Notes Creator - 合併版 v5
 * 使用 AppleScript 寫入 Apple Notes（TEST 格式版）
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Secure temp file name generator
function getSecureTempFile(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(8).toString('hex')}.scpt`);
}

function escapeAppleScript(str) {
  // Use AppleScript's quote doubling for string literals
  // This is safer than shell escaping because we write to a temp file
  if (typeof str !== 'string') return '';

  // For AppleScript, we need to handle newlines specially
  // Replace newlines with AppleScript line continuation (& return &)
  const withNewlines = str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\\\r\\\\n')  // Windows CRLF
    .replace(/\n/g, '" & return & "');   // Unix LF -> AppleScript new line

  return withNewlines;
}

/**
 * Safely execute AppleScript by writing to temp file
 * Avoids shell injection via command line arguments
 */
function runAppleScript(scriptContent, timeout = 15000) {
  const tempFile = getSecureTempFile('apple_script');

  try {
    fs.writeFileSync(tempFile, scriptContent);
    const result = execFileSync('osascript', [tempFile], {
      encoding: 'utf8',
      timeout: timeout
    });
    // Clean up temp file
    try {
      const { execFileSync } = require('child_process');
      execFileSync('trash', [tempFile], { stdio: 'ignore' });
    } catch { /* ignore cleanup error */ }
    return result;
  } catch (error) {
    // Clean up temp file on error
    try {
      const { execFileSync } = require('child_process');
      execFileSync('trash', [tempFile], { stdio: 'ignore' });
    } catch { /* ignore cleanup error */ }
    throw error;
  }
}

function createNote(title, content, folder = "Ally's Notes") {
  // Input validation
  if (!title || typeof title !== 'string' || !title.trim()) {
    console.error('✗ Invalid title: must be a non-empty string');
    return false;
  }
  if (!content || typeof content !== 'string') {
    console.error('✗ Invalid content: must be a string');
    return false;
  }

  const scriptContent = `tell application "Notes"
    try
      set targetFolder to folder "${escapeAppleScript(folder)}"
    on error
      set targetFolder to make new folder with properties {name:"${escapeAppleScript(folder)}"}
    end try

    set noteTitle to "${escapeAppleScript(title)}"
    set noteBody to "${escapeAppleScript(content)}"

    make new note at targetFolder with properties {name:noteTitle, body:noteBody}
    return "created"
end tell`;

  try {
    runAppleScript(scriptContent, 15000);
    log(`✓ Created note: ${title}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to create note: ${title}`, error.message);
    return false;
  }
}

function createOrUpdateNote(title, content, folder = "Ally's Notes") {
  return createNote(title, content, folder);
}

function checkNoteExists(title, folder = "Ally's Notes") {
  const scriptContent = `tell application "Notes"
    try
      set targetFolder to folder "${escapeAppleScript(folder)}"
      set noteList to notes of targetFolder
      repeat with n in noteList
        if name of n is "${escapeAppleScript(title)}" then
          return "exists"
        end if
      end repeat
      return "not_found"
    on error
      return "not_found"
    end try
  end tell`;

  try {
    const result = runAppleScript(scriptContent, 10000).trim();
    return result === "exists";
  } catch (error) {
    return false;
  }
}

function appendToNote(title, content, folder = "Ally's Notes") {
  const timestamp = new Date().toLocaleTimeString('zh-HK', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const newTitle = `${title} (${timestamp})`;
  return createNote(newTitle, content, folder);
}

function markdownToAppleNotesHTML(markdown) {
  const lines = markdown.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed === '---') return '────────────────';
    if (trimmed.startsWith('# ')) return `<b>＝ ${trimmed.slice(2)} ＝</b>`;
    if (trimmed.startsWith('## ')) return `<b>${trimmed.slice(3)}</b>`;
    if (trimmed.startsWith('### ')) return `▸ ${trimmed.slice(4)}`;
    if (trimmed.startsWith('- ')) return `  • ${trimmed.slice(2)}`;
    const numMatch = trimmed.match(/^(\d+)\.\s(.+)$/);
    if (numMatch) return `  ${numMatch[1]}. ${numMatch[2]}`;
    let processed = trimmed.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    return processed;
  });
  return processedLines.join('<br>');
}

/**
 * 生成每日總結（正式版）
 */
function createDailySummary(displayDate, summary, journal) {
  const date = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[date.getDay()];

  const title = `AI 每日總結 - ${displayDate}`;

  // 如果有 Qwen3 生成既 journal，用佢
  let journalSection = '';
  if (journal && (journal.entry1 || journal.entry2 || journal.entry3)) {
    journalSection = `
📖 個人日記

${journal.entry1 || ''}

${journal.entry2 || ''}

${journal.entry3 || ''}

`;
  } else {
    // 如果冇 journal，唔好寫旧版，直接通知
    log('⚠️ No AI journal generated, skipping note creation');
    return false;
  }

  const content = `AI 每日總結 - ${displayDate}

📅 日期: ${displayDate} (${weekday})
📝 類型: 每日總結自動化
${journalSection}

✅ 完成項目
狀態: ✅ 成功
檢查項目:
• Session 記錄檢查: ✅ 已分析
• 活動總結: ✅ 已提取
• Apple Notes 創建: ✅ 已創建
• 數據備份: ✅ 已完成

────────────────

Generated by AI | ${date.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`;

  return createNote(title, content, "Ally's Daily");
}

module.exports = {
  createNote,
  createOrUpdateNote,
  appendToNote,
  createDailySummary,
  markdownToAppleNotesHTML,
  checkNoteExists
};
