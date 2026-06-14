#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const _log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Unified Memory Generator - L0 Abstract / L1 Overview
 * Replaces: l0_generator.js + l1_generator.js (>90% duplicated code)
 *
 * Usage:
 *   node memory_generator.js --level L0       # Generate L0 Abstract (150-200 words, 5 topics)
 *   node memory_generator.js --level L1       # Generate L1 Overview (500-600 words, 8-10 topics)
 *   node memory_generator.js --level L0 --date 2026-03-20   # Specific date
 *   node memory_generator.js --level L1 --force              # Overwrite existing
 *
 * v3.1 - P1: Switch from Ollama to MiniMax via OpenClaw CLI (no API key needed)
 *        - P2: Add input deduplication + Domain Expert Role Prompting
 */

const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const { atomicWriteSync } = require('./lib/state');

// ==================== HELPERS ====================

/**
 * v4: Conversation-round-aware truncation
 * Truncates L2 content at conversation boundary (time gap > 30min)
 * to ensure model sees complete conversation rounds, not cut-off sentences.
 */
function truncateAtConversationBoundary(content, maxChars) {
  if (!content || content.length <= maxChars) return content;

  const chars = Array.from(content);
  const truncated = chars.slice(-maxChars).join('');
  const lines = truncated.split('\n');

  // Collect all entry start lines and timestamps
  let entryIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\- \* \[(?:上午|下午)?(\d{2}:\d{2})\]/);
    if (m) {
      const minutes = parseInt(m[1].split(':')[0]) * 60 + parseInt(m[1].split(':')[1]);
      entryIndices.push({ line: i, time: minutes });
    }
  }

  // Safety buffer at 85% of window — guaranteed fallback
  const safeLine = Math.floor(lines.length * 0.85);

  if (entryIndices.length < 2) {
    // Too few entries to detect boundaries, use safety buffer
    if (entryIndices.length === 1) return lines.slice(entryIndices[0].line).join('\n');
    return lines.slice(safeLine).join('\n');
  }

  // Find boundaries (time gaps > 30 min)
  let boundaries = [];
  let allSparse = true;
  for (let i = 1; i < entryIndices.length; i++) {
    const prev = entryIndices[i - 1];
    const curr = entryIndices[i];
    let gap = curr.time - prev.time;
    if (gap < -720) gap += 1440;
    if (gap > 720) gap = 1440 - gap;
    if (gap > 30) {
      boundaries.push(curr.line);
    } else {
      allSparse = false; // Found a tight cluster
    }
  }

  // If ALL gaps are > 30 min (uniform sparse data like hourly log entries),
  // boundary detection is meaningless — use safety buffer instead
  if (allSparse) {
    return lines.slice(safeLine).join('\n');
  }

  // Find boundary closest to safeLine from the end
  // Prefer boundary at or before safeLine (maximizes content)
  // Instead of closest, use boundary that's closest to but before safeLine
  let bestBoundary = safeLine;
  for (const b of boundaries) {
    if (b <= safeLine && b > bestBoundary) {
      bestBoundary = b;
    }
  }

  return lines.slice(bestBoundary).join('\n');
}

// ==================== CONFIG ====================

const IS_CRON = process.env.MEMORY_GEN_CRON === 'true';

// v3: MiniMax via OpenClaw CLI (replacing direct API call)
// Timeouts for L0/L1 generation (milliseconds)
const L0_TIMEOUT_MS = 150000;
const L1_TIMEOUT_MS = 300000;

const MINIMAX_CONFIG = {
  model: 'minimax-portal/MiniMax-M2.7',
  temperature: 0.3,
  timeoutMs: 180000,  // 3 min timeout (CLI may be slower)
  cmd: 'openclaw'
};

// v3: Expert role prompt for generating better summaries
const EXPERT_ROLE_PROMPT = `你係 Josh 既私人助理，專門幫佢整理每日工作記錄。

你需要：
- 專注用戶既實際對話內容，唔係系統流程、cron logs、config dumps
- 避免重複內容、空白記錄、系統通知
- 如果 detect 到任務或待辦事項，必須 highlight 出嚟
- 全部用繁體中文（香港用語），絕對禁止簡體中文、唔好用「噉多位」「各位」呢類開場白
- 格式用 bullet point，唔好 section 式排版

你的風格：
- 簡潔明瞭，重點突出
- 聚焦有意義既對話，過濾噪音
- 識別 Action Items / 待完成既任務
- 語氣正式但自然，唔好扮演對話角色`;

const L0_INPUT_WINDOW = 12000;
const L1_INPUT_WINDOW = 20000;

const LEVEL_CONFIG = {
  L0: {
    label: 'L0 Abstract',
    outputDir: 'l0-abstract',
    wordRange: '150-200',
    topicCount: '5',
    topicDescription: '5 個最重要既 topics',
    detailInstruction: `直接輸出，唔需要標題解釋。\n- 每點用 * 開頭（bullet point）\n- 如果今日有 action item，第一點必須係 ⚠️ Action Item\n- 每點 1-2 句，保持精簡\n- 只記錄今日發生嘅事，唔好回顧過去\n- 每點最多 1 句（~30字），禁止具體數字同檔案名，用標題式極簡寫法\n- 只能陳述對話記錄直接支援既事實，唔好憑空推測\n- 如果資訊唔喺 source material 入面，必須標註 (未確認)`,
    inputWindow: L0_INPUT_WINDOW,
    timeoutMs: L0_TIMEOUT_MS,
    fallbackScanLines: 50,
    fallbackMaxTopics: 5,
    logPrefix: 'l0_generator',
    fallbackHeader: "## Today's Key Topics",
    fallbackFormat: (topics) => topics.map(t => `* ${t}`).join('\n'),
  },
  L1: {
    label: 'L1 Overview',
    outputDir: 'l1-overview',
    wordRange: '500-600',
    topicCount: '8-10',
    topicDescription: '8-10 個重要 topics',
    detailInstruction: '詳細摘要\n- 直接輸出，唔需要標題解釋\n- 每點用 * 開頭（bullet point），唔好用 section 排版\n- 唔好重複 L0 嘅內容結構 — L1 應該有更多分析同 context\n- 如果今日有 action item，第一點必須係 ⚠️ Action Item\n- 可以 include 系統 insight / 模式識別 / 趨勢觀察\n- 語氣保持客觀，唔好用「噉多位」「各位」呢啲開場白\n- 只能陳述對話記錄直接支援既事實，唔好憑空推測系統狀態\n- 如果資訊唔喺 source material 入面，必須標註 (未確認) 前綴\n- 任何 <context> block 入面嘅 system state 係 ground truth，可以信賴\n- 如果 source 同 <context> 有矛盾，以 <context> 為準',
    inputWindow: L1_INPUT_WINDOW,
    timeoutMs: L1_TIMEOUT_MS,
    fallbackScanLines: 80,
    fallbackMaxTopics: 10,
    logPrefix: 'l1_generator',
    fallbackHeader: '## Key Topics',
    fallbackFormat: (topics) => topics.map((t, i) => `${i + 1}. ${t}`).join('\n'),
  },
};

// ==================== SHARED SETUP ====================

const s2hkConverter = OpenCC.Converter({ from: 'cn', to: 'hk' });

const MEMORY_DIR = path.join(process.env.HOME || '/tmp', '.openclaw', 'workspace', 'memory');
const LOG_DIR = path.join(MEMORY_DIR, 'logs');

/** Safely extract an error message from any thrown value */
function getErrorMessage(e) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return String(e); } catch { return 'unknown error'; }
}

// ==================== CLI PARSING ====================

function parseArgs() {
  try {
    const args = process.argv.slice(2);
    const opts = { level: null, date: null, force: false };

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--level':
          opts.level = (args[++i] || '').toUpperCase();
          break;
        case '--date':
          opts.date = args[++i];
          break;
        case '--force':
          opts.force = true;
          break;
        default:
          // Support bare L0/L1 as first arg for backward compat
          if (/^L[01]$/i.test(args[i]) && !opts.level) {
            opts.level = args[i].toUpperCase();
          }
          break;
      }
    }

    if (!opts.level || !LEVEL_CONFIG[opts.level]) {
      console.error('Usage: node memory_generator.js --level L0|L1 [--date YYYY-MM-DD] [--force]');
      process.exit(1);
    }

    return opts;
  } catch (e) {
    console.error(`❌ parseArgs error: ${e.message}`);
    process.exit(1);
  }
}

// ==================== DATE HELPERS ====================

function getYesterdayDate() {
  try {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  } catch (e) {
    console.error(`❌ getYesterdayDate error: ${e.message}`);
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
    } catch (_) {
      return new Date().toISOString().split('T')[0];
    }
  }
}

// ==================== LOGGING ====================

let _logFile = null;
function initLog(cfg) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      } catch (e) {
        console.error('Error: ' + e.message);
        return;
      }
    }
    _logFile = path.join(LOG_DIR, `${cfg.logPrefix}_${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })}.log`);
  } catch (e) {
    console.error('Error: ' + e.message);
  }
}

function log(msg, type = 'INFO') {
  try {
    const timestamp = new Date().toISOString();
    const runMode = IS_CRON ? '[CRON]' : '[MANUAL]';
    const line = `[${timestamp}] [${type}] ${runMode} ${msg}`;
    _log(line);
    if (_logFile) {
      try {
        fs.appendFileSync(_logFile, line + '\n');
      } catch (e) {
        console.error('Error: ' + e.message);
      }
    }
  } catch (e) {
    console.error('Error: ' + e.message);
  }
}

/**
 * 發送 Discord 通知（僅限 cron 運行）
 */
function notifyDiscord(title, message) {
  if (!IS_CRON) return;

  try {
    const { spawnSync } = require('child_process');
    const webhook = '1473376125584670872';
    const fullMsg = title + '\n```' + message + '```';
    spawnSync('/opt/homebrew/bin/openclaw', [
      'message', 'send',
      '--channel', 'discord',
      '--target', 'channel:' + webhook,
      '--message', fullMsg
    ], { timeout: 10000 });
  } catch (e) {
    log('Discord notification failed: ' + e.message, 'WARN');
  }
}

// ==================== MINIMAX via OpenClaw CLI (v3.1) ====================

/**
 * v3.1: Call MiniMax via OpenClaw CLI (no direct API key needed)
 * Uses `openclaw infer model run --model minimax-portal/MiniMax-M2.7 --prompt "..." --json`
 */
function callViaOpenClaw(prompt, cfg) {
  const { execFileSync } = require('child_process');

  // Build full prompt with expert role as system context
  // No manual shell escaping needed — execFileSync passes args directly
  // to the child process without going through a shell.
  const fullPrompt = `${EXPERT_ROLE_PROMPT}

${prompt}`;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    try {
      const stdout = execFileSync(MINIMAX_CONFIG.cmd, [
        'infer', 'model', 'run',
        '--model', MINIMAX_CONFIG.model,
        '--prompt', fullPrompt,
        '--json'
      ], {
        timeout: cfg.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, OPENCLAW_NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log(`OpenClaw CLI responded in ${elapsed}s`, 'SUCCESS');

      // Find and parse JSON output (ignore config warnings on stderr)
      const output = stdout.toString();
      const jsonStart = output.indexOf('{');
      if (jsonStart === -1) {
        reject(new Error('No JSON found in CLI output'));
        return;
      }

      const parsed = JSON.parse(output.substring(jsonStart));
      const outputs = parsed.outputs || [];

      if (outputs.length > 0 && outputs[0].text) {
        resolve(outputs[0].text.trim());
      } else {
        reject(new Error('No text output from MiniMax via OpenClaw CLI'));
      }
    } catch (err) {
      // Distinguish between timeout and other errors
      if (err.killed || err.signal === 'SIGTERM') {
        reject(new Error(`TIMEOUT after ${cfg.timeoutMs / 1000}s: ${err.message}`));
      } else {
        reject(new Error(`OpenClaw CLI failed: ${err.message}`));
      }
    }
  });
}

/**
 * v4: Gather ground truth system state for L1 generation
 * Injects context XML block with current cron/issue/system status
 * to prevent hallucination about system components
 */
function gatherSystemContext(dateStr, level) {
  if (!IS_CRON) return ''; // Only inject ground truth during cron runs

  const { execSync } = require('child_process');
  const timestamp = new Date().toISOString();
  let context = `<context timestamp="${timestamp}">\n`;

  // Cron jobs status — only for L1 (cfg.label is 'L1 Overview')
  if (level === 'L1 Overview') {
    context += `<cron_jobs>\n`;
    try {
      const { execFileSync } = require('child_process');
      // Use execFileSync to avoid shell parsing; stderr is intentionally ignored.
      const cronList = execFileSync('openclaw', ['cron', 'list', '--json'], {
        timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 50, stdio: ['pipe', 'pipe', 'ignore']
      });
      const jobs = JSON.parse(cronList);
      if (Array.isArray(jobs)) {
        jobs.forEach(j => {
          const enabled = j.enabled !== false ? 'active' : 'disabled';
          const sched = j.schedule ? (j.schedule.expr || j.schedule.kind || '') : '';
          context += `  <job name="${(j.name || 'unknown').replace(/"/g, '&quot;')}" status="${enabled}" schedule="${sched.replace(/"/g, '&quot;')}"/>\n`;
        });
      }
    } catch (e) {
      context += `  <!-- cron list error: ${e.message.replace(/"/g, '&quot;')} -->\n`;
    }
    context += `</cron_jobs>\n`;
  }

  context += `</context>`;
  return context;
}

/**
 * v3.1: Call MiniMax with retry logic via OpenClaw CLI
 */
function callMiniMax(content, dateStr, cfg, attempt = 1) {
  // v4: Inject ground truth context for L1
  const systemContext = gatherSystemContext(dateStr, cfg.label);

  const prompt = `生成 ${cfg.label} for ${dateStr}。

要求：
- ${cfg.wordRange} 字
- ${cfg.topicDescription}
- ${cfg.detailInstruction}

${systemContext ? systemContext + '\n\n' : ''}對話記錄：
${content}`;

  return callViaOpenClaw(prompt, cfg).catch(err => {
    if (attempt === 1) {
      log(`OpenClaw call failed (attempt 1): ${err.message}, retrying...`, 'WARN');
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          callMiniMax(content, dateStr, cfg, 2).then(resolve).catch(reject);
        }, 1000);
      });
    }
    throw err;
  });
}

/**
 * v3.1: Check if OpenClaw CLI is available
 */
function checkMiniMaxAvailable() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('which', ['openclaw'], { stdio: 'pipe', timeout: 5000 });
    log('OpenClaw CLI available');
    return true;
  } catch (err) {
    log('OpenClaw CLI not found in PATH', 'ERROR');
    return false;
  }
}

// ==================== FALLBACK (v2 — major rewrite) ====================

/**
 * v2: Aggressive noise-line detector
 * Handles: cron IDs anywhere in line, self-logging, config dumps, system prompts
 */
function isNoiseLine(line) {
  // Remove ANY line containing a cron ID (UUID format)
  if (/\[cron:[a-f0-9-]{10,}\]/i.test(line)) return true;
  // Remove log-to-daily-memory self-logging artifacts
  if (/Daily Memory Logger/i.test(line)) return true;
  if (/✅ Logged:.*\[MAIN\]/i.test(line)) return true;
  if (/Logged: \[MAIN\]/i.test(line)) return true;
  // Remove config/constant dump lines from code
  if (/^(label|outputDir|wordRange|topicCount|detailInstruction|numPredict)\s*:/i.test(line.trim())) return true;
  if (/LEVEL_CONFIG|L0|L1|\'L0\'|\'L1\'/i.test(line) && /outputDir|wordRange|topic/.test(line)) return true;
  // Remove system prompt artifacts
  if (/system:|BOOTSTRAP|HEARTBEAT|SOUL\.md|MEMORY\.md|AGENTS\.md|IDENTITY\.md/i.test(line)) return true;
  // Remove tool output blobs (browser, JSON responses)
  if (/"(profiles|targets|cdpPort|cdpUrl|wsUrl)":/i.test(line)) return true;
  if (/Process (exited|still running)/i.test(line)) return true;
  if (/Command (exited|still running)/i.test(line)) return true;
  // Remove markdown noise
  if (/^#{1,4}\s*\*$/.test(line)) return true;
  if (/^\s*[-•]\s*\*$/.test(line) && line.length < 30) return true;
  // Remove log-to-daily-memory entries that are system artifacts
  if (/^\[MAIN\]:\s*(L0|L1):\s*\//i.test(line)) return true;
  // Remove daily memory file header lines
  if (/^#\s*Daily\s*Memory\s*-\s*\d{4}-\d{2}-\d{2}/i.test(line)) return true;
  return false;
}

/**
 * v2: Major fallback rewrite
 * - Phase 1: Aggressive noise removal BEFORE processing
 * - Phase 2: Deduplicate by exact normalized content (not prefix)
 * - Phase 3: Score for conversational quality (Chinese punctuation, real content)
 * - Phase 4: Final exact dedup + variety check
 */
function generateFallback(content, dateStr, fileCount, cfg) {
  try {
    if (!content || content.trim().length === 0) {
      throw new Error('No L2 content available for fallback extraction');
    }

    try {
      const lines = content.split('\n');

      // Phase 1: Aggressive noise removal BEFORE all other processing
      const cleaned = [];
      for (const raw of lines) {
        let line = raw
          .replace(/\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[^\]]*\]/g, '')
          .replace(/^#{1,4}\s*/, '')
          .replace(/[*`_~]/g, '')
          .replace(/^\s*[-•]\s*/, '')
          .trim();

        if (line.length < 15) continue;
        if (isNoiseLine(line)) continue;
        if (line.startsWith('---')) continue;
        if (/^[\[\]()]+\s*$/.test(line)) continue;
        if (/^\s*$/.test(line)) continue;

        cleaned.push(line);
      }

      if (cleaned.length === 0) {
        throw new Error('All L2 content was noise — nothing to extract');
      }

      // Phase 2: Deduplicate by EXACT normalized content
      const seenExact = new Set();
      const unique = [];
      for (const line of cleaned) {
        const key = line.toLowerCase().replace(/\s+/g, ' ').substring(0, 80);
        if (!seenExact.has(key)) {
          seenExact.add(key);
          unique.push(line);
        }
      }

      // Phase 3: Score for conversational quality
      const scored = unique.map(line => {
        let score = 0;
        score += (line.match(/[，。？！、；：]/g) || []).length * 3;
        score += (line.match(/[\u4e00-\u9fff]/g) || []).length * 0.5;
        if (/['"]\s*:\s*['"]/.test(line)) score -= 20;
        if (/^(label|outputDir|wordRange)/i.test(line.trim())) score -= 30;
        if (/\s=\s*(true|false|null)/i.test(line)) score -= 15;
        if (line.includes('\n')) score -= 5;
        if (line.length >= 30 && line.length <= 200) score += 10;
        if (/[完成|修復|問題|錯誤|更新|創建|發現]/i.test(line)) score += 5;
        return { text: line, score };
      });
      scored.sort((a, b) => b.score - a.score);

      // Phase 4: Pick top N, with variety via exact dedup
      const rawTopics = scored.slice(0, cfg.fallbackMaxTopics * 2).map(s => s.text);
      const seenFinal = new Set();
      const topics = [];
      for (const t of rawTopics) {
        const key = t.substring(0, 60).toLowerCase();
        if (!seenFinal.has(key)) {
          seenFinal.add(key);
          topics.push(t);
        }
        if (topics.length >= cfg.fallbackMaxTopics) break;
      }

      if (topics.length === 0) {
        throw new Error('No meaningful topics extracted from L2 content');
      }

      const summaryParagraph = topics.length >= 3
        ? `當日共有 ${topics.length} 個主要討論話題，涵蓋：${topics.slice(0, 3).map(t => t.substring(0, 40)).join('、')}等方面。`
        : '';

      return `# ${cfg.label} - ${dateStr}\n\n${summaryParagraph}\n\n${cfg.fallbackHeader}\n${cfg.fallbackFormat(topics)}\n\n---\n*Generated: ${new Date().toISOString()} (extraction fallback v2)\n*Source: ${fileCount} L2 files*`;
    } catch (innerErr) {
      console.error(`⚠️ Fallback extraction error: ${innerErr.message}`);
      throw innerErr;
    }
  } catch (e) {
    console.error(`❌ generateFallback error: ${e.message}`);
    throw e;
  }
}

// ==================== MAIN ====================

async function main() {
  const opts = parseArgs();
  const cfg = LEVEL_CONFIG[opts.level];
  const runMode = IS_CRON ? '[CRON]' : '[MANUAL]';
  log(`Starting ${cfg.label}...`);

  let memoryDirExists;
  try {
    memoryDirExists = fs.existsSync(MEMORY_DIR);
  } catch (e) {
    console.error('Error checking directory: ' + e.message);
    memoryDirExists = false;
  }
  if (!memoryDirExists) {
    console.error(`記憶目錄不存在: ${MEMORY_DIR}`);
    process.exit(1);
  }

  initLog(cfg);

  const dateStr = opts.date || getYesterdayDate();
  const outputDir = path.join(MEMORY_DIR, cfg.outputDir);
  const outputFile = path.join(outputDir, `${dateStr}.md`);
  const tempDir = path.join(outputDir, '.temp');

  // Ensure directories exist
  for (const dir of [outputDir, tempDir]) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error(`❌ Failed to create dir ${dir}: ${err.message}`);
    }
  }

  const tempFile = path.join(tempDir, `${cfg.logPrefix}_${dateStr}.tmp`);

  log(`Starting ${cfg.label} Generator for ${dateStr}`);

  let l2Files = [];
  let l2Content = '';

  try {
    // Check if already generated
    try {
      if (fs.existsSync(outputFile) && !opts.force) {
        log(`${cfg.label} already exists: ${outputFile}`, 'SKIP');
        process.exit(0);
      }
    } catch (e) {
      console.error('Error checking file: ' + e.message);
    }

    // Find all L2 files for the target date
    const escapedDate = dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const l2Pattern = new RegExp(`^${escapedDate}-[0-9]{4}\\.md$`);

    // CROSS-MIDNIGHT FIX: Also scan next day's first few files
    // Conversation around midnight spills into the next day's L2 files.
    // We grab up to 4 files (covers ~00:00-00:20) to catch the tail end.
    const targetDate = new Date(dateStr + 'T00:00:00+08:00');
    const nextDateObj = new Date(targetDate);
    nextDateObj.setDate(nextDateObj.getDate() + 1);
    const nextDateStr = nextDateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
    const escapedNextDate = nextDateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Only match timestamped files from next day (e.g. 2026-05-29-0000.md, -0005.md)
    // NOT the base .md file (e.g. 2026-05-29.md) — that's for the next day's generator
    const nextDayPattern = new RegExp(`^${escapedNextDate}-(00|01)[0-5][0-9]\\.md$`);

    const naturalSort = (files) => {
      const timestamped = files.filter(f => /-.*\.md$/.test(path.basename(f)));
      const base = files.filter(f => path.basename(f) === `${dateStr}.md`);
      return timestamped.sort().concat(base.sort());
    };

    try {
      const allFiles = fs.readdirSync(MEMORY_DIR)
        .filter(f => !f.includes('l0-') && !f.includes('l1-') && !f.startsWith('.'));
      const targetFiles = allFiles.filter(f => l2Pattern.test(f));
      const nextDayFiles = allFiles.filter(f => nextDayPattern.test(f));
      if (nextDayFiles.length > 0) {
        log(`Cross-midnight: found ${nextDayFiles.length} next-day file(s) from ${nextDateStr}: ${nextDayFiles.join(', ')}`);
      }
      l2Files = targetFiles.concat(nextDayFiles)
        .map(f => path.join(MEMORY_DIR, f));
      l2Files = naturalSort(l2Files);
    } catch (err) {
      console.error(`❌ Failed to read memory dir: ${err.message}`);
      l2Files = [];
    }

    // Also check archive directory for target date AND next day
    const archiveMonth = dateStr.substring(0, 7);
    const archiveDir = path.join(MEMORY_DIR, '_archive', archiveMonth);
    try {
      if (fs.existsSync(archiveDir)) {
        const archivedFiles = fs.readdirSync(archiveDir)
          .filter(f => l2Pattern.test(f))
          .map(f => path.join(archiveDir, f));
        l2Files = l2Files.concat(naturalSort(archivedFiles));
      }
    } catch (err) {
      console.error(`⚠️ Failed to read archive dir: ${err.message}`);
    }

    // Check next day's archive (for month/year boundary edge case)
    const nextArchiveMonth = nextDateStr.substring(0, 7);
    if (nextArchiveMonth !== archiveMonth) {
      const nextArchiveDir = path.join(MEMORY_DIR, '_archive', nextArchiveMonth);
      try {
        if (fs.existsSync(nextArchiveDir)) {
          const nextArchivedFiles = fs.readdirSync(nextArchiveDir)
            .filter(f => nextDayPattern.test(f))
            .map(f => path.join(nextArchiveDir, f));
          if (nextArchivedFiles.length > 0) {
            log(`Cross-midnight archive: found ${nextArchivedFiles.length} file(s) in ${nextArchiveMonth} archive`);
            l2Files = l2Files.concat(naturalSort(nextArchivedFiles));
          }
        }
      } catch (err) {
        console.error(`⚠️ Failed to read next-day archive dir: ${err.message}`);
      }
    }

    if (l2Files.length === 0) {
      log(`No L2 files found for ${dateStr}`, 'ERROR');
      process.exit(1);
    }

    log(`Found ${l2Files.length} L2 files`);

    // Read and combine L2 content
    for (const file of l2Files) {
      try {
        l2Content += fs.readFileSync(file, 'utf8') + '\n';
      } catch (e) {
        log(`Error reading ${file}: ${getErrorMessage(e)}`, 'WARN');
      }
    }

    // v4: Conversation-round-aware truncation
    const chars = Array.from(l2Content);
    let contentToSend;
    if (chars.length > cfg.inputWindow) {
      contentToSend = truncateAtConversationBoundary(l2Content, cfg.inputWindow);
    } else {
      log(`[TRUNCATION] L2 content ${chars.length} chars <= ${cfg.inputWindow} window, no truncation needed`);
      contentToSend = l2Content;
    }

    // v3: PRE-FILTER before sending to MiniMax + DEDUPLICATION
    const rawLines = contentToSend.split('\n');
    const seenContentHashes = new Set();
    const cleanedLines = [];

    for (const raw of rawLines) {
      let line = raw
        .replace(/\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[^\]]*\]/g, '')
        .replace(/^#{1,4}\s*/, '')
        .replace(/[*_`~]/g, '')
        .replace(/^\s*[-•]\s*/, '')
        .trim();

      if (line.length < 15) continue;
      if (isNoiseLine(line)) continue;
      if (line.startsWith('---')) continue;
      if (/^[\[\]()]+\s*$/.test(line)) continue;
      if (/^\s*$/.test(line)) continue;

      // v3: Exact content deduplication
      const normalizedKey = line.toLowerCase().replace(/\s+/g, ' ').substring(0, 100);
      if (seenContentHashes.has(normalizedKey)) {
        continue;
      }
      seenContentHashes.add(normalizedKey);
      cleanedLines.push(line);
    }

    contentToSend = cleanedLines.join('\n');
    log(`MiniMax input pre-filtered + dedup: ${rawLines.length} → ${cleanedLines.length} lines (unique)`);

    log(`Using last ${contentToSend.length} chars of L2 (window: ${cfg.inputWindow})`);

    // v3.1: Pre-check OpenClaw CLI availability
    const cliOk = checkMiniMaxAvailable();
    if (!cliOk) {
      throw new Error('openclaw CLI not found in PATH — cannot call MiniMax');
    }

    // v3.1: Call MiniMax via OpenClaw CLI (with retry built in)
    log('Calling ' + MINIMAX_CONFIG.model + ' via OpenClaw CLI...');
    const summary = await callMiniMax(contentToSend, dateStr, cfg);

    if (!summary || summary.length < 20) {
      throw new Error(`MiniMax returned invalid response: ${summary}`);
    }

    // Convert Simplified → Traditional Chinese (HK)
    let convertedSummary;
    try {
      convertedSummary = s2hkConverter(summary);
      log(`Applied OpenCC s2hk conversion (${summary.length} → ${convertedSummary.length} chars)`);
    } catch (e) {
      console.error(`⚠️ OpenCC conversion failed: ${e.message}, using original`);
      convertedSummary = summary;
    }

    // Build output
    const output = `# ${cfg.label} - ${dateStr}\n\n${convertedSummary}\n\n---\n*Generated: ${new Date().toISOString()}*\n*Source: ${l2Files.length} L2 files*`;

    // Atomic write
    atomicWriteSync(tempFile, output);
    try {
      fs.renameSync(tempFile, outputFile);
    } catch (e) {
      console.error('Error renaming file: ' + e.message);
      throw new Error('Failed to rename temp file');
    }

    try {
      const finalContent = fs.readFileSync(outputFile, 'utf8');
      if (finalContent.length < 50) throw new Error('Final file content too short');
      log(`✅ SUCCESS: ${cfg.label} written (${finalContent.length} chars)`, 'SUCCESS');
    } catch (e) {
      console.error('Error reading final file: ' + e.message);
      throw e;
    }

    process.exit(0);

  } catch (e) {
    log(`Error: ${getErrorMessage(e)}`, 'ERROR');

    // Cleanup temp file
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (_) { /* ignore */ }

    // Try v2 fallback
    log('Trying v2 enhanced extraction fallback...', 'WARN');
    try {
      const fallback = generateFallback(l2Content || '', dateStr, l2Files.length, cfg);
      atomicWriteSync(tempFile, fallback);
      try {
        fs.renameSync(tempFile, outputFile);
      } catch (e) {
        console.error('Error renaming temp file in fallback: ' + e.message);
        throw e;
      }
      log(`✅ SUCCESS: ${cfg.label} written (v2 fallback, ${fallback.length} chars)`, 'SUCCESS');
      process.exit(0);
    } catch (e2) {
      log(`Fallback also failed: ${getErrorMessage(e2)}`, 'ERROR');
      notifyDiscord(`❌ ${cfg.label} 全部失敗`, `Primary: ${getErrorMessage(e)}\nFallback: ${getErrorMessage(e2)}`);
      process.exit(1);
    }
  }
}

// Run
(async () => {
  try {
    await main();
  } catch(e) {
    log(`Fatal: ${getErrorMessage(e)}`, 'ERROR');
    const label = 'Memory Generator';
    notifyDiscord(`❌ ${label} 完全失敗`, `Error: ${getErrorMessage(e)}`);
    process.exit(1);
  }
})();
