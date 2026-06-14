#!/usr/bin/env node
/**
 * daily_synthesis.js - Daily Synthesis thin executor (v2.0)
 *
 * Migrated from agentTurn cron job (ID 3c11c009) — runs without LLM.
 * Follows skills-learned/daily-synthesis workflow: scan yesterday (L0/L1 + Obsidian
 * daily note + L2 supplementary), compare with day-before-yesterday, output
 * synthesis to Obsidian + Discord.
 *
 * Why yesterday not today:
 *   L0/L1 abstracts are generated at 00:05/00:35 of the NEXT day for the previous
 *   day. Cron runs at 08:00, so today's L0/L1 are always missing. Defaulting
 *   target to yesterday guarantees a full 3-day window with proper L0/L1 data.
 *
 * Usage:
 *   node scripts/daily_synthesis.js [--date YYYY-MM-DD] [--dry-run]
 *                                    [--discord-channel <id>] [--help]
 *
 * Flags:
 *   --date YYYY-MM-DD        Target date (default: yesterday HKT)
 *   --dry-run                Print output to stdout, do not write Obsidian / Discord
 *   --discord-channel <id>   Discord channel ID (default: off — omit to skip Discord push)
 *   --help / -h              Show this help
 *
 * Exit codes:
 *   0  Success
 *   1  Fatal error (FATAL: ...)
 *   2  Invalid CLI args
 *
 * Implementation notes:
 *   - Built-in modules only (fs, path, child_process)
 *   - No LLM call in this path (thin executor)
 *   - Day-N counter derived from yesterday + day-before-yesterday L0/L1
 *   - State file (.daily_synthesis_state.json) tracks last run's topics
 *   - Fail-fast: if neither L0 nor L1 exists for target, exit 1
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ============================================================
// CONSTANTS
// ============================================================

const HOME = process.env.HOME || '/tmp';
const WS_PATH = path.join(HOME, '.openclaw', 'workspace');
const MEMORY_DIR = path.join(WS_PATH, 'memory');
const L0_DIR = path.join(MEMORY_DIR, 'l0-abstract');
const L1_DIR = path.join(MEMORY_DIR, 'l1-overview');
const OBSIDIAN_VAULT = path.join(HOME, 'Documents', 'Obsidian Vault');
const OBSIDIAN_DAILY = path.join(OBSIDIAN_VAULT, 'Daily');
const STATE_FILE = path.join(WS_PATH, '.daily_synthesis_state.json');
const TZ = 'Asia/Hong_Kong';

// Default: no Discord push. Pass --discord-channel <id> to enable.
const DEFAULT_DISCORD_CHANNEL = '';

// Quiet mode (internal — driven by --dry-run so we don't spam stdout)
const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };
const warn = (...args) => console.error(...args);

// ============================================================
// CLI PARSING
// ============================================================

function printHelp() {
  console.log(`Usage: node scripts/daily_synthesis.js [options]

Daily Synthesis thin executor (no LLM).

Options:
  --date YYYY-MM-DD        Target date (default: yesterday HKT — L0/L1 ready by 08:00)
  --dry-run                Print output to stdout; do not write Obsidian or send Discord
  --discord-channel <id>   Discord channel ID (default: off — omit to skip Discord push)
  --help, -h               Show this help
  --quiet                  Suppress info logs (errors still go to stderr)

Exit codes:
  0  Success
  1  Fatal error (no L0/L1 for target date)
  2  Invalid CLI args

Cron usage (no flags needed for production):
  node scripts/daily_synthesis.js --discord-channel <target_channel_id>
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
        warn('❌ --date must be YYYY-MM-DD');
        process.exit(2);
      }
      const parts = opts.date.split('-').map(Number);
      const m = parts[1], d = parts[2];
      if (m < 1 || m > 12 || d < 1 || d > 31) {
        warn('❌ --date has invalid month/day range');
        process.exit(2);
      }
    } else if (a === '--discord-channel') {
      opts.discordChannel = args[++i];
      if (!opts.discordChannel) {
        warn('❌ --discord-channel requires a value');
        process.exit(2);
      }
    } else if (a === '--quiet') {
      // handled globally
    } else if (a.startsWith('--')) {
      warn(`❌ Unknown flag: ${a}`);
      printHelp();
      process.exit(2);
    } else {
      warn(`❌ Unexpected positional arg: ${a}`);
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
  // Returns YYYY-MM-DD for given ISO date string.
  // Default: yesterday in HKT (so L0/L1 abstracts are ready by 08:00 cron time).
  if (dateStr) return dateStr;
  const todayHKT = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const base = new Date(todayHKT + 'T00:00:00+08:00');
  base.setDate(base.getDate() - 1);
  return base.toLocaleDateString('en-CA', { timeZone: TZ });
}

function getYMD(dateStr, offsetDays) {
  // Compute YYYY-MM-DD offset from given date in HKT
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
    warn(`⚠️  Failed to read ${filePath}: ${e.message}`);
    return null;
  }
}

// Read all L2 memory files for a given date, concatenated.
// Returns { combined: string, count: number, topics: [...] }
function readL2Files(dateStr) {
  let combined = '';
  let count = 0;
  const topicSignatures = [];
  try {
    const re = new RegExp(`^${dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}\\.md$`);
    const files = fs.readdirSync(MEMORY_DIR).filter(f => re.test(f));
    count = files.length;
    for (const f of files) {
      const content = safeReadFile(path.join(MEMORY_DIR, f));
      if (content) {
        combined += content + '\n';
        // Extract topic signatures from L2 entries
        for (const sig of extractL2Signatures(content)) {
          topicSignatures.push(sig);
        }
      }
    }
  } catch (e) {
    warn(`⚠️  Failed to read L2 files for ${dateStr}: ${e.message}`);
  }
  return { combined, count, topics: topicSignatures };
}

/**
 * Extract topic signatures from L2 memory content.
 * L2 format: `- * [上午|下午HH:MM] [記錄: YYYY-MM-DD] [SOURCE]: [] <content>`
 * Heuristic: capture "action" sentences (with verbs / keywords like 完成/修復/發現/創建).
 */
function extractL2Signatures(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const sigs = [];
  // Action keywords that suggest a meaningful topic
  const actionKeywords = /(完成|修復|發現|創建|更新|測試|部署|launch|release|merged|fixed|created|added|removed|deleted|updated|deployed|closed|opened|wired|verified|published|shipped|完成|升級|替換|遷移|改用|採用|識別|驗證|偵測|重組|重構|支援|配對|配)/i;
  for (const line of lines) {
    // Match the L2 entry format: [time] [date] [source]: [] content
    // Time: [上午/下午HH:MM] or [HH:MM]
    const m = line.match(/\[[\u4e00-\u9fff]*\d{1,2}:\d{2}\][^\n]*?:\s*\[\]\s*(.+)$/);
    if (!m) continue;
    let text = m[1].trim();
    if (text.length < 12) continue;
    if (text.length > 250) text = text.substring(0, 250) + '…';
    // Skip noise
    if (/^(No new signals|No updates|Still running|Let me|Check the|Confirm|Wait|FYI|NOTE)/i.test(text)) continue;
    if (text.startsWith('[') || text.startsWith('<')) continue;
    // Only include action lines (filter out pure narration)
    if (actionKeywords.test(text)) {
      sigs.push({ raw: text, normalized: normalizeTopic(text) });
    }
  }
  // Dedupe (keep unique normalized forms)
  const seen = new Set();
  const unique = [];
  for (const s of sigs) {
    if (!seen.has(s.normalized)) {
      seen.add(s.normalized);
      unique.push(s);
    }
  }
  return unique;
}

function atomicWriteFile(filePath, content) {
  // Write to temp file then rename for atomicity
  const tmp = filePath + '.tmp';
  try {
    fs.writeFileSync(tmp, content, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  fs.renameSync(tmp, filePath);
}

// ============================================================
// TOPIC EXTRACTION (deterministic, no LLM)
// ============================================================

/**
 * Extract topic lines from L0/L1 markdown.
 * Returns array of {raw, normalized} objects.
 * Heuristic: lines starting with `*`, `-`, or numbered `1.` are topics.
 */
function extractTopics(mdContent) {
  if (!mdContent) return [];
  const lines = mdContent.split('\n');
  const topics = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Match bullet ( * or - ) or numbered (1. 2. etc.) at start
    const m = trimmed.match(/^[*\-]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/);
    if (!m) continue;
    const text = m[1].trim();
    // Skip section headers and metadata
    if (text.startsWith('#')) continue;
    if (text.length < 8) continue;
    if (/^(Action Item|Generated|Source)/i.test(text)) continue;
    topics.push({
      raw: text,
      normalized: normalizeTopic(text),
    });
  }
  return topics;
}

function normalizeTopic(text) {
  // Normalize for fuzzy comparison: lowercase, strip punctuation, collapse spaces
  return text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[\u3000-\u303f\uff00-\uffef.,!?;:'"()\[\]{}—–-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute similarity between two normalized topics (0..1).
 * Uses 4-gram overlap (Jaccard) — simple but effective for short text.
 */
function topicSimilarity(a, b) {
  if (a === b) return 1.0;
  const ngramsA = new Set(ngrams(a, 3));
  const ngramsB = new Set(ngrams(b, 3));
  if (ngramsA.size === 0 || ngramsB.size === 0) return 0;
  let inter = 0;
  for (const g of ngramsA) if (ngramsB.has(g)) inter++;
  const union = ngramsA.size + ngramsB.size - inter;
  return union > 0 ? inter / union : 0;
}

function ngrams(text, n) {
  const out = [];
  if (text.length < n) return [text];
  for (let i = 0; i <= text.length - n; i++) {
    out.push(text.substring(i, i + n));
  }
  return out;
}

// ============================================================
// STATE MANAGEMENT
// ============================================================

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { lastRunDate: null, lastTopics: [] };
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    warn(`⚠️  Failed to load state: ${e.message}, starting fresh`);
    return { lastRunDate: null, lastTopics: [] };
  }
}

function saveState(dateStr, topics) {
  try {
    const state = { lastRunDate: dateStr, lastTopics: topics };
    atomicWriteFile(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    warn(`⚠️  Failed to save state: ${e.message}`);
  }
}

// ============================================================
// SYNTHESIS COMPARISON
// ============================================================

/**
 * Compare today's topics with yesterday's and day-before's.
 * Returns { newTopics, continuing, ended }.
 *
 * - newTopics: in today, not in yesterday (Day 1)
 * - continuing: in today AND yesterday (Day 2+)
 *   - If also in dayBefore: Day 3+
 * - ended: in yesterday, not in today (Day 3+ ended)
 */
function compareTopics(today, yesterday, dayBefore) {
  const SIM_THRESHOLD = 0.4;
  const newTopics = [];
  const continuing = [];
  const ended = [];

  // For each today topic, find best match in yesterday
  for (const t of today) {
    let bestYday = 0;
    let bestYdayText = null;
    for (const y of yesterday) {
      const sim = topicSimilarity(t.normalized, y.normalized);
      if (sim > bestYday) {
        bestYday = sim;
        bestYdayText = y.raw;
      }
    }
    if (bestYday >= SIM_THRESHOLD) {
      // Check day-before for Day 3
      let dayCount = 2;
      for (const d of dayBefore) {
        if (topicSimilarity(t.normalized, d.normalized) >= SIM_THRESHOLD) {
          dayCount = 3;
          break;
        }
      }
      continuing.push({ raw: t.raw, day: dayCount, matched: bestYdayText });
    } else {
      newTopics.push(t.raw);
    }
  }

  // For each yesterday topic, check if it ended (not in today)
  for (const y of yesterday) {
    let stillActive = false;
    for (const t of today) {
      if (topicSimilarity(t.normalized, y.normalized) >= SIM_THRESHOLD) {
        stillActive = true;
        break;
      }
    }
    if (!stillActive) {
      // Was it in day-before too? Mark as Day 3 ended
      const inDayBefore = dayBefore.some(d => topicSimilarity(y.normalized, d.normalized) >= SIM_THRESHOLD);
      ended.push({ raw: y.raw, day: inDayBefore ? 3 : 2 });
    }
  }

  return { newTopics, continuing, ended };
}

// ============================================================
// OUTPUT BUILDERS
// ============================================================

function buildSynthesisMarkdown(dateStr, l0Content, l1Content, obsidianContent,
                                comparison, sourceCounts) {
  const lines = [];
  lines.push(`## Daily Synthesis — ${dateStr}`);
  lines.push('');
  lines.push(`> 自動合成 (thin executor · v2.0) — 對比 ${getYMD(dateStr, -1)} 同 ${getYMD(dateStr, -2)} 嘅 L0/L1 (target = yesterday)`);
  lines.push('');

  // Source summary
  lines.push('### 來源');
  lines.push(`* L2 memory 檔案: ${sourceCounts.l2} 個`);
  lines.push(`* L0 abstract: ${l0Content ? '✅' : '❌ 缺失'}`);
  lines.push(`* L1 overview: ${l1Content ? '✅' : '❌ 缺失'}`);
  lines.push(`* Obsidian daily note: ${obsidianContent ? '✅' : '❌ 缺失'}`);
  lines.push('');

  // New patterns
  if (comparison.newTopics.length > 0) {
    lines.push('### 🆕 新發現 (Day 1)');
    for (const t of comparison.newTopics.slice(0, 8)) {
      lines.push(`* ${t}`);
    }
    if (comparison.newTopics.length > 8) {
      lines.push(`* …另外 ${comparison.newTopics.length - 8} 個 (見 L0/L1)`);
    }
    lines.push('');
  }

  // Continuing patterns
  if (comparison.continuing.length > 0) {
    lines.push('### 🔄 持續中 (Day 2/3)');
    for (const c of comparison.continuing.slice(0, 8)) {
      lines.push(`* **Day ${c.day} of 3**: ${c.raw}`);
    }
    if (comparison.continuing.length > 8) {
      lines.push(`* …另外 ${comparison.continuing.length - 8} 個 (見 L0/L1)`);
    }
    lines.push('');
  }

  // Ended patterns
  if (comparison.ended.length > 0) {
    lines.push('### ✅ 已完結');
    for (const e of comparison.ended.slice(0, 5)) {
      lines.push(`* Day ${e.day} of 3 ended: ${e.raw}`);
    }
    if (comparison.ended.length > 5) {
      lines.push(`* …另外 ${comparison.ended.length - 5} 個`);
    }
    lines.push('');
  }

  // Empty day
  if (comparison.newTopics.length === 0 && comparison.continuing.length === 0 && comparison.ended.length === 0) {
    lines.push('### 概況');
    lines.push('* 冇新 pattern，亦冇持續中嘅 pattern。建議睇 L0/L1 原文。');
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated: ${new Date().toISOString()} · daily_synthesis.js*`);

  return lines.join('\n');
}

function buildDiscordContent(dateStr, comparison) {
  // Discord-friendly format (no markdown headers — use bold + emojis)
  const lines = [];
  lines.push(`📊 **Daily Synthesis — ${dateStr}**`);
  lines.push('');

  if (comparison.newTopics.length > 0) {
    lines.push('🆕 **新發現**');
    for (const t of comparison.newTopics.slice(0, 5)) {
      lines.push(`• ${truncateForDiscord(t, 200)}`);
    }
    if (comparison.newTopics.length > 5) {
      lines.push(`• …另外 ${comparison.newTopics.length - 5} 個`);
    }
    lines.push('');
  }

  if (comparison.continuing.length > 0) {
    lines.push('🔄 **持續中**');
    for (const c of comparison.continuing.slice(0, 5)) {
      lines.push(`• Day ${c.day} of 3: ${truncateForDiscord(c.raw, 150)}`);
    }
    if (comparison.continuing.length > 5) {
      lines.push(`• …另外 ${comparison.continuing.length - 5} 個`);
    }
    lines.push('');
  }

  if (comparison.ended.length > 0) {
    lines.push('✅ **已完結**');
    for (const e of comparison.ended.slice(0, 3)) {
      lines.push(`• Day ${e.day} ended: ${truncateForDiscord(e.raw, 120)}`);
    }
    if (comparison.ended.length > 3) {
      lines.push(`• …另外 ${comparison.ended.length - 3} 個`);
    }
    lines.push('');
  }

  if (comparison.newTopics.length === 0 && comparison.continuing.length === 0 && comparison.ended.length === 0) {
    lines.push('ℹ️ 冇新 pattern，亦冇持續中嘅 pattern。');
    lines.push('');
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function truncateForDiscord(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}

// ============================================================
// OBSIDIAN WRITER
// ============================================================

function writeObsidianNote(dateStr, synthesisMarkdown, dryRun) {
  // Obsidian Daily note path: ~/Documents/Obsidian Vault/Daily/YYYY-MM-DD.md
  const notePath = path.join(OBSIDIAN_DAILY, `${dateStr}.md`);

  if (dryRun) {
    log(`[DRY-RUN] Would write to Obsidian: ${notePath}`);
    log(`[DRY-RUN] Section: ## Daily Synthesis`);
    return { status: 'dry-run', path: notePath };
  }

  let existing = '';
  if (fs.existsSync(notePath)) {
    try {
      existing = fs.readFileSync(notePath, 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
  } else {
    // Create minimal daily note skeleton
    const dateObj = new Date(dateStr + 'T00:00:00+08:00');
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const dayName = dayNames[dateObj.getDay()];
    existing = `---
tags: [daily]
created: ${dateStr}
---

# ${dateStr} 星期${dayName}

## 今日做咗咩


## 啟發


## 明日TODO

`;
  }

  // Replace or append ## Daily Synthesis section
  const sectionHeader = `## Daily Synthesis — ${dateStr}`;
  const newSection = `## Daily Synthesis — ${dateStr}\n\n${synthesisMarkdown.replace(/^## Daily Synthesis — \d{4}-\d{2}-\d{2}\n\n/, '')}`;

  let updated;
  if (existing.includes(sectionHeader)) {
    // Replace existing section
    const sectionStart = existing.indexOf(sectionHeader);
    const beforeSection = existing.substring(0, sectionStart);
    // Find next ## header (if any) — keep it
    const afterHeader = existing.substring(sectionStart + sectionHeader.length);
    const nextHeaderMatch = afterHeader.match(/\n## [^#]/);
    let afterSection = '';
    if (nextHeaderMatch) {
      afterSection = afterHeader.substring(nextHeaderMatch.index + 1);
    }
    updated = beforeSection + newSection + (afterSection ? '\n' + afterSection : '');
  } else {
    // Append new section
    updated = existing.trimEnd() + '\n\n' + newSection + '\n';
  }

  try {
    if (!fs.existsSync(OBSIDIAN_DAILY)) {
      fs.mkdirSync(OBSIDIAN_DAILY, { recursive: true });
    }
    atomicWriteFile(notePath, updated);
    log(`✅ Obsidian 寫入成功: ${notePath}`);
    return { status: 'ok', path: notePath };
  } catch (e) {
    warn(`❌ Obsidian 寫入失敗: ${e.message}`);
    return { status: 'error', error: e.message };
  }
}

// ============================================================
// DISCORD SENDER
// ============================================================

function sendDiscordMessage(channelId, content, dryRun) {
  if (!channelId) {
    return { status: 'skipped', reason: 'no channel id (default off)' };
  }

  if (dryRun) {
    log(`[DRY-RUN] Would send to Discord channel ${channelId}:`);
    log('---');
    log(content);
    log('---');
    return { status: 'dry-run', channelId };
  }

  try {
    // Use execFileSync to avoid shell injection
    const result = execFileSync('openclaw', [
      'message', 'send',
      '--channel', 'discord',
      '--target', `channel:${channelId}`,
      '--message', content,
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, OPENCLAW_NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    log(`✅ Discord 訊息已送出 (channel: ${channelId})`);
    return { status: 'ok', channelId, output: result.substring(0, 200) };
  } catch (e) {
    // execFileSync throws on non-zero exit
    const stderr = e.stderr ? e.stderr.toString().substring(0, 500) : '';
    const msg = e.killed || e.signal === 'SIGTERM' ? 'timeout' : (stderr || e.message);
    warn(`❌ Discord 訊息送出失敗: ${msg}`);
    return { status: 'error', error: msg };
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const opts = parseArgs();
  const dateStr = getHKTDate(opts.date);
  const yday = getYMD(dateStr, -1);
  const dayBefore = getYMD(dateStr, -2);

  log(`=== Daily Synthesis ===`);
  log(`📅 目標日期: ${dateStr} (HKT, yesterday by default — L0/L1 ready by 08:00)`);
  log(`🔍 對比基準: ${yday} (Day-1), ${dayBefore} (Day-2)`);
  log(`📺 Discord channel: ${opts.discordChannel || 'off (default)'}${opts.dryRun ? ' [DRY-RUN]' : ''}`);
  log('');

  // ----- 1. Read source files -----
  log('📂 讀取來源檔案...');

  // Target date's L2 memory (supplementary, often noisy — used as fallback)
  const l2Data = readL2Files(dateStr);

  // Target date's L0/L1 (PRIMARY source — guaranteed ready because target = yesterday)
  const l0Content = safeReadFile(path.join(L0_DIR, `${dateStr}.md`));
  const l1Content = safeReadFile(path.join(L1_DIR, `${dateStr}.md`));

  // Day-1 (yday) and Day-2 (dayBefore) L0/L1
  const l0Yday = safeReadFile(path.join(L0_DIR, `${yday}.md`));
  const l1Yday = safeReadFile(path.join(L1_DIR, `${yday}.md`));
  const l0DayBefore = safeReadFile(path.join(L0_DIR, `${dayBefore}.md`));
  const l1DayBefore = safeReadFile(path.join(L1_DIR, `${dayBefore}.md`));

  // Obsidian daily note (target = yesterday)
  const obsidianPath = path.join(OBSIDIAN_DAILY, `${dateStr}.md`);
  const obsidianContent = safeReadFile(obsidianPath);

  // Previous day's Obsidian synthesis (for cross-day continuity)
  const prevObsidianPath = path.join(OBSIDIAN_DAILY, `${yday}.md`);
  const prevObsidianContent = safeReadFile(prevObsidianPath);

  log(`   L0: ${l0Content ? '✅' : '❌ missing'} | L1: ${l1Content ? '✅' : '❌ missing'} | L2 檔案: ${l2Data.count} 個 (supplementary)`);
  log(`   Yday L0: ${l0Yday ? '✅' : '❌'} | DayBefore L0: ${l0DayBefore ? '✅' : '❌'}`);
  log(`   Obsidian target: ${obsidianContent ? '✅' : '⚠️  missing'}`);
  log(`   Obsidian yday: ${prevObsidianContent ? '✅' : '⚠️  missing'}`);

  // Fail-fast: if neither L0 nor L1 exists for target, abort with clear error.
  // (L2 alone is not enough — too noisy for primary synthesis.)
  if (!l0Content && !l1Content) {
    warn(`❌ 目標日期 ${dateStr} 冇 L0 亦冇 L1，synthesis 無可用 primary data`);
    warn(`   L0 generator: 00:05 HKT daily · L1 generator: 00:35 HKT daily`);
    warn(`   Check memory/l0-abstract/${dateStr}.md 同 memory/l1-overview/${dateStr}.md`);
    process.exit(1);
  }

  // ----- 2. Extract topics and compare -----
  log('');
  log('🔬 提取 topics 同對比...');

  // Today: L2 signatures (primary) + L0/L1 topics (secondary, if available)
  const todayL2Sigs = l2Data.topics;
  const todayL0Topics = extractTopics(l0Content);
  const todayL1Topics = extractTopics(l1Content);
  let todayTopics = [...todayL0Topics, ...todayL1Topics, ...todayL2Sigs];

  // Dedup today's topics (fuzzy)
  const uniqueToday = [];
  for (const t of todayTopics) {
    let isDup = false;
    for (const u of uniqueToday) {
      if (topicSimilarity(t.normalized, u.normalized) >= 0.5) { isDup = true; break; }
    }
    if (!isDup) uniqueToday.push(t);
  }

  // Comparison baseline: yesterday's L0/L1 (always available at 8 AM)
  const ydayL0Topics = extractTopics(l0Yday);
  const ydayL1Topics = extractTopics(l1Yday);
  const ydayTopics = [...ydayL0Topics, ...ydayL1Topics];

  // Day-before: L0/L1
  const dayBeforeL0Topics = extractTopics(l0DayBefore);
  const dayBeforeL1Topics = extractTopics(l1DayBefore);
  const dayBeforeTopics = [...dayBeforeL0Topics, ...dayBeforeL1Topics];

  log(`   今日 unique topics: ${uniqueToday.length} (L0/L1: ${todayL0Topics.length + todayL1Topics.length}, L2 sigs: ${todayL2Sigs.length})`);
  log(`   昨日 topics: ${ydayTopics.length}`);
  log(`   前日 topics: ${dayBeforeTopics.length}`);

  const comparison = compareTopics(uniqueToday, ydayTopics, dayBeforeTopics);

  log(`   🆕 新: ${comparison.newTopics.length} | 🔄 持續: ${comparison.continuing.length} | ✅ 完結: ${comparison.ended.length}`);

  // ----- 3. Build synthesis markdown -----
  const synthesisMd = buildSynthesisMarkdown(
    dateStr, l0Content, l1Content, obsidianContent, comparison,
    { l2: l2Data.count }
  );

  // ----- 4. Build Discord content -----
  const discordContent = buildDiscordContent(dateStr, comparison);

  // ----- 5. Write outputs -----
  log('');
  log('💾 寫入 outputs...');

  if (opts.dryRun) {
    log('');
    log('===== [DRY-RUN] Obsidian Synthesis =====');
    log(synthesisMd);
    log('');
    log('===== [DRY-RUN] Discord Message =====');
    log(discordContent);
    log('');
  } else {
    const obsidianResult = writeObsidianNote(dateStr, synthesisMd, false);
    const discordResult = sendDiscordMessage(opts.discordChannel, discordContent, false);

    if (obsidianResult.status === 'ok') {
      const skipNote = discordResult.status === 'skipped' ? ' (Discord push off — default)' : ' ✅ Discord also sent';
      log(`✅ Obsidian 寫入成功${skipNote}`);
    }
    if (obsidianResult.status !== 'ok' || discordResult.status === 'error') {
      if (obsidianResult.status !== 'ok') warn(`⚠️  Obsidian 寫入失敗: ${obsidianResult.status}`);
      if (discordResult.status === 'error') warn('⚠️  Discord 送出失敗');
    }
  }

  // ----- 6. Save state for next run -----
  if (!opts.dryRun) {
    saveState(dateStr, uniqueToday.map(t => t.raw));
  }

  log('');
  log('✅ Daily Synthesis 完成');
  process.exit(0);
}

main().catch(err => {
  warn(`FATAL: ${err.message}`);
  if (err.stack) warn(err.stack);
  process.exit(1);
});
