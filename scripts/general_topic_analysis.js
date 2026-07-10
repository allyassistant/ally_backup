#!/usr/bin/env node
/**
 * general_topic_analysis.js — General Discussion Topic Analysis (v1.0)
 *
 * Analyzes general discussion topics from yesterday's L2 memory files,
 * extracts top themes, and outputs structured analysis to Obsidian + Discord.
 *
 * Thin executor (no LLM) — uses deterministic keyword frequency analysis.
 * Designed to run at 08:00 daily (after L0 at 00:05 / L1 at 00:35).
 *
 * Usage:
 *   node scripts/general_topic_analysis.js [options]
 *
 * Options:
 *   --date YYYY-MM-DD        Target date (default: yesterday HKT)
 *   --dry-run                Print to stdout, no writes / Discord
 *   --discord-channel <id>   Discord channel ID (default: #🤖一般 1473343330170572904)
 *   --help, -h               Show this help
 *
 * Exit codes:
 *   0  Success
 *   1  Fatal error
 *   2  Invalid CLI args
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const discord = require('./lib/discord_push');

// ============================================================
// CONSTANTS
// ============================================================

const HOME = process.env.HOME || '/tmp';
const WS_PATH = path.join(HOME, '.openclaw', 'workspace');
const MEMORY_DIR = path.join(WS_PATH, 'memory');
const OBSIDIAN_VAULT = path.join(HOME, 'Documents', 'Obsidian Vault');
const OUTPUT_DIR = path.join(OBSIDIAN_VAULT, '03-Output');
const TZ = 'Asia/Hong_Kong';

// Default Discord channel: #🤖一般
const DEFAULT_DISCORD_CHANNEL = '1473343330170572904';

// ============================================================
// CLI PARSING
// ============================================================

function printHelp() {
  console.log(`Usage: node scripts/general_topic_analysis.js [options]

Analyzes general discussion topics from L2 memory files.

Options:
  --date YYYY-MM-DD        Target date (default: yesterday HKT)
  --dry-run                Print output; no Obsidian / Discord writes
  --discord-channel <id>   Discord channel ID (default: #🤖一般)
  --help, -h               Show this help

Exit codes:
  0  Success
  1  Fatal error
  2  Invalid CLI args
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    date: null,
    dryRun: false,
    discordChannel: DEFAULT_DISCORD_CHANNEL,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--date') {
      opts.date = args[++i];
      if (!opts.date || !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
        console.error('❌ --date must be YYYY-MM-DD');
        process.exit(2);
      }
    } else if (a === '--discord-channel') {
      opts.discordChannel = args[++i];
      if (!opts.discordChannel) {
        console.error('❌ --discord-channel requires a value');
        process.exit(2);
      }
    } else if (a.startsWith('--')) {
      console.error(`❌ Unknown flag: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

// ============================================================
// DATE HELPERS
// ============================================================

function getHKTDate(dateStr) {
  if (dateStr) return dateStr;
  const todayHKT = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const base = new Date(todayHKT + 'T00:00:00+08:00');
  base.setDate(base.getDate() - 1);
  return base.toLocaleDateString('en-CA', { timeZone: TZ });
}

function getYMD(dateStr, offsetDays) {
  const base = new Date(dateStr + 'T00:00:00+08:00');
  base.setDate(base.getDate() + offsetDays);
  return base.toLocaleDateString('en-CA', { timeZone: TZ });
}

// ============================================================
// FILE HELPERS
// ============================================================

function safeReadFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`⚠️  Failed to read ${filePath}: ${e.message}`);
    return null;
  }
}

function atomicWriteFile(filePath, content) {
  const tmp = filePath + '.tmp';
  try {
    fs.writeFileSync(tmp, content, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  fs.renameSync(tmp, filePath);
}

// ============================================================
// L2 MEMORY PARSING
// ============================================================

/**
 * Read all L2 memory files for a given date.
 * Returns combined raw text + entry count.
 */
function readL2Files(dateStr) {
  let combined = '';
  let count = 0;
  try {
    const re = new RegExp(`^${dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}\\.md$`);
    const files = fs.readdirSync(MEMORY_DIR).filter(f => re.test(f));
    count = files.length;
    for (const f of files.sort()) {
      const content = safeReadFile(path.join(MEMORY_DIR, f));
      if (content) combined += content + '\n';
    }
  } catch (e) {
    console.error(`⚠️  Failed to read L2 files for ${dateStr}: ${e.message}`);
  }
  return { combined, count };
}

/**
 * Extract discussion entries from L2 memory content.
 *
 * L2 format (actual):
 *   - * [上午02:03] [記錄: 2026-06-29] [MAIN]: [] content
 *
 * Fields:
 *   - Time: [上午/下午HH:MM] or [HH:MM]
 *   - Record date: [記錄: YYYY-MM-DD]
 *   - Source label: [MAIN] or [sub-agent or Discord user]
 *   - Empty bracket: []
 *   - Content: actual message text
 *
 * We filter out:
 *   - Heartbeat/system entries (HEARTBEAT_OK, cron, shell, etc.)
 *   - Short entries (< 20 chars)
 *   - Technical noise (JSON blobs, error traces)
 *
 * Returns array of { time, source, content, category } objects.
 */
function extractDiscussionEntries(content) {
  if (!content) return [];

  const entries = [];
  const lines = content.split('\n');

  // Regex for L2 entry (actual format):
  //   - * [上午02:03] [記錄: 2026-06-29] [MAIN]: [] content
  const entryRe = /^\s*-\s+\*\s+\[(上午|下午)?(\d{1,2}:\d{2})\]\s+\[記錄:\s*\d{4}-\d{2}-\d{2}\]\s+\[([^\]]+)\]:\s*\[\]\s*(.+)$/;

  // Skip keywords (low-value entries to filter out)
  const skipKeywords = [
    /^(HEARTBEAT_OK|Heartbeat|心跳|NO_REPLY)/i,
    /^node scripts\//,
    /^openclaw /,
    /^(cron|mail_monitor|failover)/i,
    /^(tail|cat|ls|cd |grep|curl|ssh|echo|mkdir)/i,
    /^Error:/i,
    /^\[\d{4}-\d{2}-\d{2}T/i,  // ISO timestamps
    /^\s*\{/,                   // JSON start
    /^\s*```/,                  // Code block
    /^⚠️/,                      // Warning lines
    /^✅/,                      // Checkmark lines (system status)
    /^❌/,                      // Error lines
    /^—{3,}/,                   // Dividers
  ];

  for (const line of lines) {
    const m = line.match(entryRe);
    if (!m) continue;

    const ampm = m[1] || '';
    const time = m[2];
    const source = m[3].trim();
    const entryContent = m[4].trim();

    // Minimum length check
    if (entryContent.length < 20) continue;

    // Skip system/heartbeat noise
    let isNoise = false;
    for (const re of skipKeywords) {
      if (re.test(entryContent)) {
        isNoise = true;
        break;
      }
    }
    if (isNoise) continue;

    // Skip entries from known system sources
    const systemSources = ['system', 'scheduler', 'cron', 'heartbeat'];
    if (systemSources.includes(source.toLowerCase())) continue;

    // Categorize the entry
    const category = categorizeEntry(entryContent);

    entries.push({
      time: (ampm || '') + time,
      source,
      content: entryContent,
      category,
    });
  }

  return entries;
}

/**
 * Categorize a discussion entry by content.
 */
function categorizeEntry(text) {
  const lower = text.toLowerCase();

  // Question
  if (text.includes('？') || text.includes('?') ||
      /^(請問|有冇|係咪|可唔可以|點樣|點解|邊度|幾時|咩係|乜嘢係)/.test(text)) {
    return 'question';
  }

  // Technical / code
  if (/^(code|config|script|fix|bug|deploy|error|issue|api|key|token|ssh|git)/i.test(lower) ||
      /`[^`]+`/.test(text) ||
      /\b(query|sql|json|yaml|yml|md|js|ts|py|sh|bash|zsh)\b/i.test(lower)) {
    return 'technical';
  }

  // Decision / action
  if (text.includes('決定') || text.includes('用呢個') ||
      /^(決定|同意|好|ok|done|完成|做緊|開始)/i.test(text)) {
    return 'decision';
  }

  // Opinion / discussion
  if (/^(我覺得|我認為|建議|不如|或者|其實|老實|講真)/.test(text)) {
    return 'opinion';
  }

  // Link / reference
  if (/https?:\/\//i.test(text) || /\[\[[^\]]+\]\]/.test(text)) {
    return 'reference';
  }

  // Status / update
  if (/^(update|進度|已|仍未|等緊|準備|繼續)/.test(text)) {
    return 'status';
  }

  return 'general';
}

// ============================================================
// KEYWORD & THEME ANALYSIS
// ============================================================

/**
 * Tokenize Chinese + English text into meaningful keywords.
 */
function tokenize(text) {
  const tokens = [];
  const cleaned = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');

  // Extract Chinese phrases (2-6 chars)
  const chineseRe = /[\u4e00-\u9fff\u3400-\u4dbf]{2,6}/g;
  let m;
  while ((m = chineseRe.exec(cleaned)) !== null) {
    tokens.push(m[0]);
  }

  // Extract English words (3+ chars, not common stop words)
  const stopWords = new Set([
    'the', 'this', 'that', 'and', 'for', 'with', 'from', 'was', 'are',
    'have', 'has', 'had', 'not', 'but', 'its', 'all', 'can', 'you',
    'your', 'our', 'will', 'just', 'been', 'some', 'what', 'when',
    'where', 'which', 'how', 'does', 'done', 'need', 'here', 'there',
  ]);
  const englishRe = /\b[a-zA-Z]{3,}\b/g;
  while ((m = englishRe.exec(cleaned)) !== null) {
    const word = m[0].toLowerCase();
    if (!stopWords.has(word)) tokens.push(word);
  }

  return tokens;
}

/**
 * Extract top themes from discussion entries.
 *
 * Algorithm:
 * 1. Tokenize all entry content
 * 2. Count frequency of each token
 * 3. Group related tokens by shared words
 * 4. Return top themes with supporting entries
 */
function extractThemes(entries) {
  if (entries.length === 0) {
    return { themes: [], topKeywords: [], categoryBreakdown: {} };
  }

  // Count all tokens
  const freq = {};
  for (const entry of entries) {
    const tokens = tokenize(entry.content);
    for (const t of tokens) {
      freq[t] = (freq[t] || 0) + 1;
    }
  }

  // Sort by frequency, get top 30
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  const topKeywords = sorted.map(([word, count]) => ({ word, count }));

  // Build themes by clustering entries that share top keywords
  const keywordSet = new Set(sorted.slice(0, 15).map(([w]) => w));
  const themes = [];
  const usedEntryIds = new Set();

  for (const [word] of sorted.slice(0, 12)) {
    const matching = entries.filter((e, idx) => {
      if (usedEntryIds.has(idx)) return false;
      const tokens = tokenize(e.content);
      return tokens.includes(word) || tokens.some(t => t.includes(word) || word.includes(t));
    });

    if (matching.length >= 2) {
      themes.push({
        keyword: word,
        count: matching.length,
        entries: matching.slice(0, 4).map(e => ({
          time: e.time,
          source: e.source,
          snippet: e?.content?.substring(0, 100) + (e?.content?.length > 100 ? '…' : ''),
          category: e.category,
        })),
      });
      matching.forEach((_, idx) => {
        const realIdx = entries.indexOf(matching[idx]);
        if (realIdx >= 0) usedEntryIds.add(realIdx);
      });
    }
  }

  // Category breakdown
  const categoryBreakdown = {};
  for (const entry of entries) {
    categoryBreakdown[entry.category] = (categoryBreakdown[entry.category] || 0) + 1;
  }

  return {
    themes: themes.slice(0, 10),
    topKeywords: topKeywords.slice(0, 20),
    categoryBreakdown,
  };
}

// ============================================================
// OUTPUT BUILDERS
// ============================================================

function buildObsidianNote(dateStr, entries, analysis) {
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][new Date(dateStr + 'T00:00:00+08:00').getDay()];

  const lines = [];

  lines.push(`---
tags: [general-topic-analysis, daily]
created: ${dateStr}
category: Daily
type: analysis
---

# General Topic Analysis — ${dateStr} (星期${dayOfWeek})

> 自動分析「一般討論」主題 — 基於 L2 memory entries 嘅關鍵字頻率分析

---`);

  lines.push('');
  lines.push('## 📊 總覽');
  lines.push('');
  lines.push(`| 指標 | 數值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 分析日期 | ${dateStr} |`);
  lines.push(`| 討論 entries | ${entries.length} |`);
  lines.push(`| 主題類別 | ${Object.keys(analysis.categoryBreakdown).length} 種 |`);

  if (entries.length > 0) {
    const uniqueSources = new Set(entries.map(e => e.source)).size;
    lines.push(`| 討論來源 | ${uniqueSources} 個 |`);
  }
  lines.push('');

  // Category breakdown
  const catNames = {
    question: '❓ 問題',
    technical: '🔧 技術',
    decision: '✅ 決定',
    opinion: '💬 意見',
    reference: '🔗 參考',
    status: '📋 狀態',
    general: '💭 一般',
  };

  lines.push('### 討論類型分佈');
  const sortedCats = Object.entries(analysis.categoryBreakdown).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCats) {
    const bar = '█'.repeat(Math.max(1, Math.round(count / entries.length * 20)));
    const pct = Math.round(count / entries.length * 100);
    lines.push(`- ${catNames[cat] || cat}: ${bar} ${count} (${pct}%)`);
  }
  lines.push('');

  // Top keywords
  if (analysis?.topKeywords?.length > 0) {
    lines.push('### 🏷️ Top Keywords');
    lines.push('');
    const keywordRows = [];
    for (const kw of analysis?.topKeywords?.slice(0, 15)) {
      keywordRows.push(`| ${kw.word} | ${kw.count} |`);
    }
    lines.push(`| Keyword | Frequency |`);
    lines.push(`|---------|-----------|`);
    for (const row of keywordRows) lines.push(row);
    lines.push('');
  }

  // Themes
  if (analysis?.themes?.length > 0) {
    lines.push('### 🔥 討論主題');
    lines.push('');
    for (const theme of analysis.themes) {
      lines.push(`#### ${theme.keyword} (${theme.count} 條討論)`);
      lines.push('');
      for (const entry of theme.entries) {
        const catEmoji = {
          question: '❓', technical: '🔧', decision: '✅',
          opinion: '💬', reference: '🔗', status: '📋', general: '💭',
        }[entry.category] || '💭';
        lines.push(`- ${catEmoji} [${entry.time}] ${entry.source}: ${entry.snippet}`);
      }
      lines.push('');
    }
  }

  // Recent entries (last 10, most interesting)
  if (entries.length > 0) {
    lines.push('### 📝 Recent Discussion Entries');
    lines.push('');
    // Take last entries (reverse chronological by file order)
    const recent = entries.slice(-10).reverse();
    for (const entry of recent) {
      const catEmoji = {
        question: '❓', technical: '🔧', decision: '✅',
        opinion: '💬', reference: '🔗', status: '📋', general: '💭',
      }[entry.category] || '💭';
      lines.push(`- ${catEmoji} [${entry.time}] **${entry.source}**: ${entry?.content?.substring(0, 200)}${entry?.content?.length > 200 ? '…' : ''}`);
    }
    lines.push('');
  }

  // Insights
  lines.push('### 💡 啟發');
  lines.push('');
  if (analysis?.categoryBreakdown?.question && analysis?.categoryBreakdown?.question > 0) {
    lines.push(`- 有 ${analysis?.categoryBreakdown?.question} 個問題未解答，可能需要跟進`);
  }
  if (analysis?.categoryBreakdown?.decision && analysis?.categoryBreakdown?.decision > 2) {
    lines.push('- 今日有不少決定/行動，進度良好');
  }
  if (analysis?.categoryBreakdown?.technical && analysis?.categoryBreakdown?.technical > 3) {
    lines.push('- 技術討論活躍，可能有新方向或問題需要關注');
  }

  // Cross-links
  lines.push('');
  lines.push('---');
  lines.push('🔗 **相關筆記**');
  lines.push(`- [[Daily Synthesis — ${dateStr}]]`);
  lines.push('- [[General Topic Analysis — Template]]');

  lines.push('');
  lines.push('---');
  lines.push(`> 🖊️ 一般討論分析 | ${dateStr} | 自動生成`);

  return lines.join('\n');
}

function buildDiscordSummary(dateStr, entries, analysis) {
  const lines = [];

  if (entries.length === 0) {
    lines.push(`📊 **一般討論分析 — ${dateStr}**`);
    lines.push('');
    lines.push('ℹ️ 冇錄到討論內容，可能係靜態日。');
    return lines.join('\n');
  }

  lines.push(`📊 **一般討論分析 — ${dateStr}**`);
  lines.push('');

  // Category bar
  const catNames = {
    question: '❓問題', technical: '🔧技術', decision: '✅決定',
    opinion: '💬意見', reference: '🔗參考', status: '📋狀態', general: '💭一般',
  };
  const sortedCats = Object.entries(analysis.categoryBreakdown).sort((a, b) => b[1] - a[1]);
  const catLine = sortedCats.map(([c, n]) => `${catNames[c] || c}${n}`).join(' · ');
  lines.push(`📝 **${entries.length}** entries | ${catLine}`);
  lines.push('');

  // Top keywords
  if (analysis?.topKeywords?.length > 0) {
    const topWords = analysis?.topKeywords?.slice(0, 8).map(k => `\`${k.word}\``).join(' ');
    lines.push(`🏷️ **Top Keywords:** ${topWords}`);
    lines.push('');
  }

  // Top themes (up to 5)
  if (analysis?.themes?.length > 0) {
    lines.push('🔥 **討論主題**');
    for (const theme of analysis?.themes?.slice(0, 5)) {
      const samples = theme?.entries?.slice(0, 2).map(e =>
        e?.snippet?.replace(/[❓🔧✅💬🔗📋💭]/g, '').trim()
      ).join(' | ');
      lines.push(`• **${theme.keyword}** (${theme.count}條): ${samples.substring(0, 120)}`);
    }
    lines.push('');
  }

  // Notable: questions needing answers
  if (analysis?.categoryBreakdown?.question && analysis?.categoryBreakdown?.question > 0) {
    const questionEntries = entries.filter(e => e.category === 'question').slice(0, 3);
    if (questionEntries.length > 0) {
      lines.push('❓ **未解答問題**');
      for (const q of questionEntries) {
        lines.push(`• ${q?.content?.substring(0, 100)}`);
      }
      lines.push('');
    }
  }

  lines.push(`🔗 Obsidian: 03-Output/${dateStr.substring(0, 7)}/${dateStr}-analysis-general-topics.md`);

  return lines.join('\n');
}

function truncateForDiscord(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}

// ============================================================
// OBSIDIAN WRITER
// ============================================================

function writeObsidianNote(dateStr, obsidianContent, dryRun) {
  const monthDir = dateStr.substring(0, 7); // YYYY-MM
  const outputDir = path.join(OUTPUT_DIR, monthDir);

  const filename = `${dateStr}-analysis-general-topics.md`;
  const filepath = path.join(OUTPUT_DIR, monthDir, filename);

  if (dryRun) {
    console.log(`[DRY-RUN] Would write: ${filepath}`);
    return { status: 'dry-run', path: filepath };
  }

  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    atomicWriteFile(filepath, obsidianContent);
    console.log(`✅ Obsidian 寫入成功: ${filepath}`);
    return { status: 'ok', path: filepath };
  } catch (e) {
    console.error(`❌ Obsidian 寫入失敗: ${e.message}`);
    return { status: 'error', error: e.message };
  }
}

// ============================================================
// DISCORD SENDER
// ============================================================

function sendDiscordMessage(channelId, content, dryRun) {
  if (dryRun) {
    console.log(`[DRY-RUN] Discord channel: ${channelId}`);
    console.log('---');
    console.log(content);
    console.log('---');
    return { status: 'dry-run', channelId };
  }

  try {
    const result = discord.push({ message: content, target: `channel:${channelId}`, timeoutMs: 30000 });
    if (!result.ok) throw new Error(result.error);
    console.log(`✅ Discord 已送出 (channel: ${channelId})`);
    return { status: 'ok', channelId, output: result.output || '' };
  } catch (e) {
    const stderr = e.stderr ? e?.stderr?.toString().substring(0, 500) : '';
    const msg = e.killed || e.signal === 'SIGTERM' ? 'timeout' : (stderr || e.message);
    console.error(`❌ Discord 送出失敗: ${msg}`);
    return { status: 'error', error: msg };
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const opts = parseArgs();
  const dateStr = getHKTDate(opts.date);

  console.log(`=== General Topic Analysis ===`);
  console.log(`📅 目標日期: ${dateStr} (HKT)`);
  console.log(`📺 Discord channel: ${opts.discordChannel}${opts.dryRun ? ' [DRY-RUN]' : ''}`);
  console.log('');

  // ----- 1. Read L2 memory files -----
  console.log('📂 讀取 L2 memory 檔案...');
  const l2Data = readL2Files(dateStr);
  console.log(`   找到 ${l2Data.count} 個檔案`);

  if (l2Data.count === 0) {
    console.log('⚠️  冇 L2 memory 檔案，嘗試讀取前一日...');
    const fallbackDate = getYMD(dateStr, -1);
    const fallback = readL2Files(fallbackDate);
    if (fallback.count === 0) {
      console.log('❌ 前一日都冇資料，退出');
      process.exit(1);
    }
    // Use fallback
    const fallbackEntries = extractDiscussionEntries(fallback.combined);
    const fallbackAnalysis = extractThemes(fallbackEntries);
    const obsidianContent = buildObsidianNote(fallbackDate, fallbackEntries, fallbackAnalysis);
    writeObsidianNote(fallbackDate, obsidianContent, opts.dryRun);
    const discordContent = buildDiscordSummary(fallbackDate, fallbackEntries, fallbackAnalysis);
    sendDiscordMessage(opts.discordChannel, discordContent, opts.dryRun);
    console.log('✅ 完成 (fallback to ' + fallbackDate + ')');
    process.exit(0);
  }

  // ----- 2. Extract discussion entries -----
  console.log('🔍 提取討論 entries...');
  const entries = extractDiscussionEntries(l2Data.combined);
  console.log(`   討論 entries: ${entries.length}`);

  if (entries.length === 0) {
    console.log('⚠️  冇討論內容，寫 empty report');
  }

  // Show sample
  if (entries.length > 0) {
    const catCounts = {};
    for (const e of entries) {
      catCounts[e.category] = (catCounts[e.category] || 0) + 1;
    }
    console.log(`   類型分佈:`, JSON.stringify(catCounts));
    console.log(`   最舊: [${entries[0].time}] ${entries[0].source} — ${entries[0].content.substring(0, 60)}`);
    if (entries.length > 1) {
      console.log(`   最新: [${entries[entries.length - 1].time}] ${entries[entries.length - 1].source} — ${entries[entries.length - 1].content.substring(0, 60)}`);
    }
  }

  // ----- 3. Theme analysis -----
  console.log('');
  console.log('📊 分析討論主題...');
  const analysis = extractThemes(entries);
  console.log(`   Top keywords: ${analysis?.topKeywords?.length}`);
  console.log(`   主題 cluster: ${analysis?.themes?.length}`);
  if (analysis?.themes?.length > 0) {
    for (const t of analysis?.themes?.slice(0, 5)) {
      console.log(`   - ${t.keyword}: ${t.count} 條`);
    }
  }

  // ----- 4. Build outputs -----
  console.log('');
  console.log('✍️  生成 Obsidian note...');
  const obsidianContent = buildObsidianNote(dateStr, entries, analysis);
  const obsidianResult = writeObsidianNote(dateStr, obsidianContent, opts.dryRun);

  console.log('');
  console.log('📤 生成 Discord summary...');
  const discordContent = buildDiscordSummary(dateStr, entries, analysis);
  const discordResult = sendDiscordMessage(opts.discordChannel, discordContent, opts.dryRun);

  // ----- 5. Summary -----
  console.log('');
  console.log('=== 總結 ===');
  console.log(`📂 L2 檔案: ${l2Data.count}`);
  console.log(`💬 討論 entries: ${entries.length}`);
  console.log(`🔥 主題 clusters: ${analysis?.themes?.length}`);
  console.log(`📝 Obsidian: ${obsidianResult.status === 'ok' || obsidianResult.status === 'dry-run' ? '✅' : '❌'} ${obsidianResult.path || ''}`);
  console.log(`📺 Discord: ${discordResult.status === 'ok' || discordResult.status === 'dry-run' ? '✅' : '❌'}`);

  process.exit(0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
