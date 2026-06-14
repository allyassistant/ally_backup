#!/usr/bin/env node
/**
 * 知識庫自動吸收器 (Knowledge Base Ingester)
 *
 * 用途：自動從 Discord 學習 channel 吸收內容，分類寫入 Wiki/L0/L1/Memory
 * 依據：memory/knowledge-base-design.md 分類規則
 *
 * Cron: 每日 06:30 自動運行（KB Ingest cron ID 9ebd92c9）
 *
 * 用法：
 *   node knowledge_ingester.js                                       # 正常執行
 *   node knowledge_ingester.js --dry-run                             # 測試模式（不寫入）
 *   node knowledge_ingester.js --limit 10                            # 只處理最近 N 條
 *   node knowledge_ingester.js --no-llm                              # 強制只用 keyword 分類
 *   node knowledge_ingester.js --quiet                               # 隱藏 per-message log
 *   node knowledge_ingester.js --discord-channel <id>                # 啟用 Discord self-notify
 *   node knowledge_ingester.js --log-file <path>                     # 自訂 log 檔路徑
 *   node knowledge_ingester.js --help                                # 顯示說明
 *
 * 🆕 Thin executor 模式（v3.4）：
 *   用 `--discord-channel` flag 取代 OpenClaw cron agentTurn 嘅 announce 行為。
 *   Script 自己透過 `openclaw message send` 推送結果到 Discord，無需依賴 cron agent LLM layer。
 *   準備 migrate 去 macOS crontab 直接觸發 script（繞過 cron agentTurn 嘅 hang / overload 問題）。
 *
 * 優化歷史：
 *   - v2.3: 使用 spawn + OpenClaw CLI → 需要 CLI 認證
 *   - v2.4: 使用 discord.js REST API 直接調用 Discord → 繞過 CLI
 *   - v2.9: 移除 openclaw wiki ingest CLI 調用（內部 model call 會 hang）
 *   - v2.9: 改用直接寫入 wiki/main/sources/，避開 model call
 *   - v3.0: async spawn openclaw wiki ingest + fallback direct write
 *   - v3.0: 保留 AI 分析，300s timeout 但唔 block 成個 job
 *   - v3.2: spawn timeout 300s → 5s（CLI 內部 LLM call hang，快啲 fallback direct write）
 *   - v3.2: 加 per-message progress log（每10條報一次），唔再得「分類中...」就冇聲
 *   - v3.3: 加 LLM-based 分類（classifyContentHybrid），LLM fail/timeout 自動 fallback keyword
 *   - v3.3: thin executor — 唔再依賴 cron agent LLM；用 `openclaw infer model run` 直接 call
 *   - v3.3: 加 --no-llm flag 強制只用 keyword（debug / 緊急 fallback 用）
 *   - v3.4: 🆕 加 --discord-channel flag + sendDiscordMessage() — 取代 cron agentTurn 嘅 announce
 *   - v3.4: 🆕 加 --log-file flag + logToFile() — 寫入 /tmp/kb_ingest.log 方便 cron 除錯
 *   - v3.4: 🆕 granular exit codes (0/1/2/3) — macOS crontab 友善（無 code 4，併入 0）
 *   - v3.4: 🆕 final summary 格式統一為 `✅ 完成！處理: X | 跳過: Y | 錯誤: Z` 或 `❌ FAILED: <reason>`
 *   - v3.4: 🆕 任何模式（LLM / keyword / --no-llm）都出同一個 summary 結構
 *
 * Exit codes：
 *   0  全部成功（processed > 0 或 skipped，無 error）— 包括冇新消息
 *   1  Fatal error（Discord config 缺失、API token 缺失、未捕獲 exception）
 *   2  部分成功（errors > 0 但有 processed）
 *   3  全部失敗（processed = 0 且 errors > 0）
 *
 * Cron 範例（macOS crontab，準備 migrate）：
 *   30 6 * * * cd ~/.openclaw/workspace && node scripts/knowledge_ingester.js \
 *     --discord-channel 1473376125584670872 >> /tmp/kb_ingest.log 2>&1
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('node:child_process');

// discord.js REST API
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// ============================================================
// 配置
// ============================================================

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace');

// Configuration - magic numbers extracted
const CONFIG = {
  // 學習 Channel ID
  LEARNING_CHANNEL_ID: '1473382857949970515',

  // Discord Guild ID (用於生成連結)
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || '1378455195360952420',

  // 狀態檔案（追蹤 last_ingest_id）
  STATE_FILE: path.join(WORKSPACE_DIR, '.knowledge_ingester_state.json'),

  // Batch size - Discord API 限制最多 100
  BATCH_SIZE: 100,

  // 最大批次數
  MAX_BATCHES: 1,  // v2.5: 改為 1 避免 pagination overlap 造成重複

  // API timeout (秒)
  API_TIMEOUT: 15,

  // 乾燥運行模式（不實際寫入）
  dryRun: process.argv.includes('--dry-run'),

  // Quiet mode
  quiet: process.argv.includes('--quiet'),

  // 限制處理的訊息數量
  limit: (() => {
    const idx = process.argv.indexOf('--limit');
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : null;
  })(),

  // v3.4: Discord self-notify channel（取代 cron agentTurn announce）
  // Default: '' = off（唔送）。用 --discord-channel <id> 啟用。
  discordChannel: (() => {
    const idx = process.argv.indexOf('--discord-channel');
    if (idx === -1) return '';
    const v = process.argv[idx + 1];
    // 容錯：如果 flag 後面冇 value（例如行尾），fallback empty
    if (!v || v.startsWith('--')) return '';
    return v;
  })(),

  // v3.4: Log 檔路徑（append mode，cron 除錯用）
  // Default: /tmp/kb_ingest.log
  logFile: (() => {
    const idx = process.argv.indexOf('--log-file');
    if (idx === -1) return '/tmp/kb_ingest.log';
    const v = process.argv[idx + 1];
    if (!v || v.startsWith('--')) return '/tmp/kb_ingest.log';
    return v;
  })()
};

// ============================================================
// Discord REST Client
// ============================================================

/**
 * 初始化 Discord REST client
 */
function createDiscordClient() {
  // 從 OpenClaw config 讀取 token
  const configPath = path.join(process.env.HOME || '/Users/ally', '.openclaw/openclaw.json');
  let token;

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    token = config?.channels?.discord?.token;
  } catch (e) {
    console.error('❌ 無法讀取 Discord token:', e.message);
    process.exit(1);
  }

  if (!token) {
    console.error('❌ Discord token 未配置');
    process.exit(1);
  }

  const rest = new REST({
    version: '10',
    retries: 3
  }).setToken(token);

  return rest;
}

/**
 * 使用 Discord REST API 讀取訊息
 *
 * v2.4: 直接使用 discord.js REST API
 * v3.1: 加入 retry logic (3 attempts with exponential backoff)
 */
async function readMessagesViaRest(rest, channelId, limit = 100, before = null, after = null) {
  const MAX_ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const query = new URLSearchParams({
        limit: String(Math.min(limit, 100))  // Discord API 最大 100
      });

      if (before) query.set('before', before);
      if (after) query.set('after', after);

      const route = Routes.channelMessages(channelId);
      const url = `/channels/${channelId}/messages?${query.toString()}`;

      const response = await rest.get(url);

      // REST 返回的是陣列
      return response || [];
    } catch (e) {
      lastError = e;

      // 權限錯誤唔 retry
      if (e.code === 50001 || e.code === 50013) {
        throw new Error(`權限不足: ${e.message}`);
      }
      if (e.code === 50006) {
        throw new Error(`Message too large: ${e.message}`);
      }

      // Network / timeout 類錯誤 retry
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        CONFIG.quiet || console.log(`   ⚠️ Discord API 失敗 (attempt ${attempt}/${MAX_ATTEMPTS})，${backoffMs}ms 後重試: ${e.message.slice(0, 80)}`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  // 全部 attempt 失敗
  throw new Error(`Discord API 失敗 after ${MAX_ATTEMPTS} attempts: ${lastError?.message || 'unknown'}`);
}

// ============================================================
// 輔助函數
// ============================================================

/**
 * 讀取上一次攝入的 last_ingest_id
 */
function loadLastIngestId() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, 'utf8'));
      return state.lastIngestId || null;
    }
  } catch (e) {
    CONFIG.quiet || console.warn(`⚠️ 無法讀取狀態檔案: ${e.message}`);
  }
  return null;
}

/**
 * 保存 last_ingest_id (atomic write)
 */
function saveLastIngestId(messageId) {
  if (CONFIG.dryRun) return;
  try {
    const state = { lastIngestId: messageId, updatedAt: new Date().toISOString() };
    const tmpPath = CONFIG.STATE_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, CONFIG.STATE_FILE);
  } catch (e) {
    console.error(`❌ 無法保存狀態: ${e.message}`);
  }
}

/**
 * 格式化日期
 */
function getDateStr(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * 寫入檔案（atomic write）
 */
function writeFileAtomic(filePath, content) {
  if (CONFIG.dryRun) {
    CONFIG.quiet || console.log(`  [DRY-RUN] 會寫入: ${filePath}`);
    return;
  }
  const dir = path.dirname(filePath);
  let dirExists = false;
  try { dirExists = fs.existsSync(dir); } catch (e) {}
  if (!dirExists) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
      console.error('Failed to create directory:', e.message);
      return;
    }
  }
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('Failed to write file:', e.message);
    return;
  }
}

// ============================================================
// v3.0: async spawn openclaw wiki ingest (non-blocking, timeout → fallback)
// ============================================================

/**
 * Async spawn `openclaw wiki ingest` via temp file.
 * - Writes content to a temp file
 * - Spawns CLI with 300s timeout
 * - If success → keeps the ingested wiki file, cleans temp
 * - If fail/timeout → cleans temp, returns null (caller falls back to direct write)
 * Returns: ingested filename on success, null on failure/timeout
 */
async function tryWikiIngestSpawn(content, fallbackPath) {
  if (CONFIG.dryRun) return null;

  const tmpFile = fallbackPath + '.ingest-tmp.md';
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
  } catch (e) {
    console.warn(`     ⚠️ 無法寫入 temp file: ${e.message}`);
    return null;
  }

  // v3.2: timeout 由 300s 減到 5s — `openclaw wiki ingest` CLI 內部 LLM call 會 hang
  // 5秒內無回應就直接 fallback 去 direct write
  const SPAWN_TIMEOUT = 5000;
  return new Promise((resolve) => {
    const proc = spawn('openclaw', ['wiki', 'ingest', tmpFile], {
      stdio: 'pipe',
      shell: false,
      timeout: SPAWN_TIMEOUT,
    });

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) {}
      resolve('');
    }, SPAWN_TIMEOUT);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        // Success — CLI ingested it
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        resolve(fallbackPath);
      } else {
        // CLI failed — clean temp, fallback
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        resolve('');
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      resolve('');
    });
  }).then(result => result || null);
}

// ============================================================
// Discord 訊息讀取（v2.4 - Discord REST API）
// ============================================================

/**
 * 從 Discord 學習 channel 讀取新消息
 *
 * 優化策略（v2.4）：
 *   - v2.3: spawn + CLI → 需要 CLI 認證、常有 hang 問題
 *   - v2.4: discord.js REST → 直接使用 token，穩定快速
 *   - 使用 --after 參數，只讀取自上次之後的新消息
 *   - 首次運行（無 lastIngestId）：讀取最近 100 條建立 checkpoint
 *   - 日常運行（有 lastIngestId）：只讀取新消息，極速完成
 *   - MAX_BATCHES=1（v2.5 fix: 避免 pagination overlap）
 *
 * @param {string|null} lastIngestId - 上次已處理的最新訊息 ID
 * @returns {Promise<Array>} 消息陣列（最新在前）
 */
async function readLearningChannel(lastIngestId, rest) {
  const allMessages = [];
  let oldestMessageId = null;
  let iterations = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;

  const log = (...args) => { if (!CONFIG.quiet) console.log(...args); };

  log(`📡 連接 Discord 學習 Channel (REST API)...`);

  if (lastIngestId) {
    log(`   使用 --after ${lastIngestId} 只讀取新消息`);
  } else {
    log(`   首次運行，將讀取最近 ${CONFIG.BATCH_SIZE} 條建立 checkpoint`);
  }

  while (iterations < CONFIG.MAX_BATCHES) {
    iterations++;

    let messages = [];
    try {
      messages = await readMessagesViaRest(
        rest,
        CONFIG.LEARNING_CHANNEL_ID,
        CONFIG.BATCH_SIZE,
        oldestMessageId,
        lastIngestId  // 首次運行用 after 參數
      );
    } catch (e) {
      log(`⚠️ REST API 讀取失敗 (batch ${iterations}): ${e.message.slice(0, 100)}`);
      consecutiveErrors++;

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log(`   🛑 連續 ${consecutiveErrors} 次錯誤，停止重試`);
        break;
      }

      // 等一下再試
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // Reset error counter
    consecutiveErrors = 0;

    if (!messages || messages.length === 0) {
      log(`📭 Batch ${iterations}: 無消息`);
      break;
    }

    log(`📥 Batch ${iterations}: 讀取 ${messages.length} 條消息`);

    // 首次運行：過濾掉 lastIngestId 之後的消息
    let filtered = messages;
    if (lastIngestId) {
      filtered = messages.filter(m => m.id !== lastIngestId);
      if (filtered.length < messages.length) {
        log(`🛑 已到達上次攝入位置，過濾掉 ${messages.length - filtered.length} 條重複`);
      }
    }

    // 如果有 limit
    if (CONFIG.limit && allMessages.length + filtered.length >= CONFIG.limit) {
      const needed = CONFIG.limit - allMessages.length;
      allMessages.push(...filtered.slice(0, needed));
      break;
    }

    allMessages.push(...filtered);

    // 如果是最後一頁（數量少於 batch size）
    if (messages.length < CONFIG.BATCH_SIZE) {
      break;
    }

    // 記住最舊的 message ID（用於下次 --before）
    oldestMessageId = messages[messages.length - 1].id;

    // 避免速率限制
    await new Promise(r => setTimeout(r, 200));
  }

  // 確保最新消息在前
  allMessages.reverse();

  log(`✅ 共讀取 ${allMessages.length} 條消息`);
  return allMessages;
}

// ============================================================
// 分類與目的地
// ============================================================

const { classifyContent, classifyContentHybrid, classifyWithLLM, CATEGORIES } = require('./knowledge_classifier.js');

// v3.3: LLM-based 分類開關
// 預設開啟，內部有 keyword fallback。LLM fail/timeout → 自動用 keyword。
// 用 --no-llm flag 強制只用 keyword（debug / 緊急 fallback 用）
const USE_LLM_CLASSIFY = !process.argv.includes('--no-llm');

/**
 * 根據分類獲取寫入路徑
 */
function getDestinationPaths(category) {
  const dest = {
    wiki: `${WORKSPACE_DIR}/wiki/main/sources/`,
    l0: `${WORKSPACE_DIR}/memory/l0-abstract/`,
    l1: `${WORKSPACE_DIR}/memory/l1-overview/`,
    memory: `${WORKSPACE_DIR}/memory/`,
    issue: `${WORKSPACE_DIR}/.issues/active/`
  };

  switch (category) {
    case CATEGORIES.TECHNICAL:
      return { primary: dest.wiki, secondary: null, type: 'wiki' };
    case CATEGORIES.TREND:
      return { primary: dest.l1, secondary: dest.memory, type: 'l1' };
    case CATEGORIES.INSIGHT:
      return { primary: dest.l0, secondary: dest.memory, type: 'l0' };
    case CATEGORIES.DECISION:
      return { primary: dest.wiki, secondary: null, type: 'wiki' };
    default:
      return { primary: dest.memory, secondary: null, type: 'memory' };
  }
}

// ============================================================
// 寫入邏輯
// ============================================================

/**
 * 生成 Wiki 頁面內容
 */
function generateWikiPage(msg, category, classification) {
  const dateStr = getDateStr();
  const rawTitle = msg.content.split('\n')[0].replace(/[#*`]/g, '').trim().slice(0, 80) || 'Untitled';
  const safeTitle = rawTitle.replace(/[\s]+/g, ' ').trim();
  const msgLink = `https://discord.com/channels/${CONFIG.DISCORD_GUILD_ID}/${msg.channel_id || CONFIG.LEARNING_CHANNEL_ID}/${msg.id}`;
  const pageId = `source.article-${Date.now()}`;

  return `---
pageType: source
id: ${pageId}
title: ${safeTitle}
sourceType: discord
sourceUrl: ${msgLink}
ingestedAt: ${new Date().toISOString()}
updatedAt: ${new Date().toISOString()}
status: active
tags: [${classification.category}, ingested]
---

# ${safeTitle}

> 原始訊息：🎓學習 Channel | [link](${msgLink})

${msg.content}

---

*自動攝入 | ${dateStr} | Knowledge Base Ingester v2.4*
`;
}

/**
 * v2.6: L0/L1 由 memory_generator.js AI 統一處理，唔再直接寫入
 */

/**
 * v2.8: issue 生成已移除（之前嘅 decision→issue mapping 造成 448 個 junk issues）
 */

/**
 * v2.6 CHANGE: write to memory/YYYY-MM-DD-HHMM.md in L2-log format so
 * that memory_generator.js can include it in L0/L1 synthesis.
 */

/**
 * HKT date string (YYYY-MM-DD), matching L2 Logger's convention.
 */
function getHktDate(date = new Date()) {
  return date.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '-');
}

/**
 * HKT HHMM suffix (e.g. "0601"), matching L2 Logger's convention.
 */
function getHktTimeSuffix(date = new Date()) {
  const hkt = date.toLocaleString('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false });
  return hkt.replace(':', '');
}

/**
 * 寫入 Memory 檔案 — 改用 timestamped L2 format，等 memory_generator.js 可以食到。
 */
function appendToMemory(msg, classification) {
  const now = new Date();
  const dateStr = getHktDate(now);
  const timeSuffix = getHktTimeSuffix(now);
  const memoryPath = `${WORKSPACE_DIR}/memory/${dateStr}-${timeSuffix}.md`;

  const hktTime = now.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong' });
  const preview = (msg.content || '').replace(/\n/g, ' ').trim().slice(0, 300);
  const entry = `- * [${hktTime}] [記錄: ${dateStr}] [SOURCE: Knowledge Ingester] 📚 [${classification.category}] ${preview}${msg.content && msg.content.length > 300 ? '...' : ''}\n`;

  if (CONFIG.dryRun) {
    CONFIG.quiet || console.log(`  [DRY-RUN] 會附加到: ${memoryPath}`);
    return;
  }

  const header = `# Daily Memory - ${dateStr}\n\n`;

  const fingerprint = (msg.content || '').slice(0, 80).trim();

  try {
    if (fs.existsSync(memoryPath)) {
      const existing = fs.readFileSync(memoryPath, 'utf8');
      if (fingerprint && existing.includes(fingerprint)) {
        CONFIG.quiet || console.log(`  ⏭️ 跳過重複: ${fingerprint.slice(0, 40)}...`);
        return;
      }
      fs.writeFileSync(memoryPath, existing + entry);
    } else {
      fs.writeFileSync(memoryPath, header + entry);
    }
  } catch (e) {
    console.error(`❌ 寫入 Memory 失敗: ${e.message}`);
  }
}

/**
 * 處理單條消息
 *
 * v3.1: 加入 retry 邏輯（單條 message 寫入失敗會 retry 2 次）
 */
async function processMessage(msg) {
  if (!msg.content || !msg.content.trim()) {
    return { skipped: true, reason: 'empty content' };
  }

  const classification = USE_LLM_CLASSIFY
    ? classifyContentHybrid(msg.content, 'learning')
    : classifyContent(msg.content, 'learning');
  const destinations = getDestinationPaths(classification.category);

  CONFIG.quiet || console.log(`\n📝 處理訊息: ${msg.id}`);
  CONFIG.quiet || console.log(`   分類: ${classification.category} (${(classification.confidence * 100).toFixed(0)}%)`);
  CONFIG.quiet || console.log(`   目的地: ${destinations.type}`);

  if (CONFIG.dryRun) {
    CONFIG.quiet || console.log(`   預覽: ${msg.content.slice(0, 100)}...`);
    return { success: true, dryRun: true, classification, destinations };
  }

  // 寫入主要目的地 (含 retry)
  const MAX_WRITE_ATTEMPTS = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      if (destinations.type === 'wiki') {
        // v3.0: async spawn openclaw wiki ingest — 保留 AI 分析，唔 block
        // timeout 300s → fallback direct write（唔 hang 死成個 job）
        const safeName = (msg.content.slice(0, 50).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-') || 'untitled') + '-' + Date.now() + '-' + attempt;
        const wikiContent = generateWikiPage(msg, classification.category, classification);
        const fallbackPath = `${destinations.primary}kb-${safeName}.md`;

        // Try async spawn first
        const ingested = await tryWikiIngestSpawn(wikiContent, fallbackPath);
        if (ingested) {
          CONFIG.quiet || console.log(`   ✅ 寫入 Wiki (AI ingest): ${ingested}`);
        } else {
          writeFileAtomic(fallbackPath, wikiContent);
          CONFIG.quiet || console.log(`   ✅ 寫入 Wiki (direct write): ${fallbackPath}`);
        }
      }

      // v2.6: L0/L1 由 memory_generator.js AI 統一處理，Knowledge Ingester 只寫 L2
      if (destinations.type === 'l0' || destinations.type === 'l1') {
        appendToMemory(msg, classification);
        CONFIG.quiet || console.log(`   ✅ 附加到 L2 Memory (交由 memory_generator.js 處理 L0/L1)`);
      }

      // 成功
      return { success: true, classification, destinations };

    } catch (e) {
      lastError = e;
      if (attempt < MAX_WRITE_ATTEMPTS) {
        const backoffMs = 500 * attempt;
        CONFIG.quiet || console.log(`   ⚠️ 寫入失敗 (attempt ${attempt}/${MAX_WRITE_ATTEMPTS})，${backoffMs}ms 後重試: ${e.message.slice(0, 80)}`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  // 全部 write attempt 失敗
  console.error(`   ❌ 寫入失敗 after ${MAX_WRITE_ATTEMPTS} attempts: ${lastError?.message || 'unknown'}`);
  return { success: false, error: lastError?.message || 'unknown' };
}

// ============================================================
// v3.4: Discord self-notify + Log file + Help
// ============================================================

/**
 * 寫入 log 檔（append mode）
 *
 * v3.4: 跟 mail_monitor.js pattern。Always writes（唔受 --quiet 影響），
 * 因為 cron 跑緊嗰陣 console 唔一定 visible，但 log 檔一定睇到。
 * 失敗 silently — log 寫入失敗唔應該 crash 個 job。
 */
function logToFile(msg) {
  if (!CONFIG.logFile) return;
  try {
    const t = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    fs.appendFileSync(CONFIG.logFile, `[${t}] ${msg}\n`);
  } catch (e) {
    // 沉默：log 寫入失敗唔 block 個 job
  }
}

/**
 * 送出訊息去 Discord channel（thin executor pattern）
 *
 * v3.4: 取代 cron agentTurn 嘅 announce 行為。
 * 用 execFileSync + args array 避免 shell injection（signal 與 leak 安全）。
 * - channelId 為空 → 跳過（status: skipped）
 * - dryRun 為 true → print content 唔送（status: dry-run）
 * - timeout: 30s
 * - 失敗 → log to stderr 但唔 throw（notify 失敗唔應該 crash 個 job）
 *
 * 跟 daily_synthesis.js sendDiscordMessage 同一個 pattern。
 */
function sendDiscordMessage(channelId, content, dryRun) {
  if (!channelId) {
    return { status: 'skipped', reason: 'no channel id (default off)' };
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Would send to Discord channel ${channelId}:`);
    console.log('---');
    console.log(content);
    console.log('---');
    return { status: 'dry-run', channelId };
  }

  try {
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
    logToFile(`Discord 訊息已送出 (channel: ${channelId})`);
    return { status: 'ok', channelId, output: result.substring(0, 200) };
  } catch (e) {
    // execFileSync throws on non-zero exit
    const stderr = e.stderr ? e.stderr.toString().substring(0, 500) : '';
    const msg = e.killed || e.signal === 'SIGTERM' ? 'timeout' : (stderr || e.message);
    console.error(`❌ Discord 訊息送出失敗: ${msg}`);
    return { status: 'error', error: msg };
  }
}

/**
 * 顯示 usage / 說明
 */
function printHelp() {
  console.log(`Usage: node scripts/knowledge_ingester.js [options]

知識庫自動吸收器 — 自動從 Discord 學習 channel 吸收內容並分類寫入 Wiki/L0/L1/Memory。

Options:
  --dry-run                測試模式（不實際寫入）
  --limit N                只處理最近 N 條訊息
  --no-llm                 強制只用 keyword 分類（跳過 LLM）
  --quiet                  隱藏 per-message log
  --discord-channel <id>   啟用 Discord self-notify（取代 cron agentTurn）
                           預設：off（不推送）
  --log-file <path>        Log 檔路徑（append mode，HKT timestamp）
                           預設：/tmp/kb_ingest.log
  --help, -h               顯示此說明

Exit codes：
  0  全部成功（processed > 0 或 skipped，無 error）— 包括冇新消息
  1  Fatal error（Discord config 缺失、API token 缺失、未捕獲 exception）
  2  部分成功（errors > 0 但有 processed）
  3  全部失敗（processed = 0 且 errors > 0）

Cron 範例（macOS crontab）：
  30 6 * * * cd ~/.openclaw/workspace && node scripts/knowledge_ingester.js \\
    --discord-channel 1473376125584670872 >> /tmp/kb_ingest.log 2>&1

Thin executor 模式（v3.4）：
  Script 自己透過 \`openclaw message send\` 推送結果，無需 OpenClaw cron agentTurn LLM。
  適合 macOS crontab 取代現有 cron job（9ebd92c9）。
`);
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  // v3.4: --help 處理（最早返 exit 0）
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  console.log('===========================================');
  console.log('📚 知識庫自動吸收器 (Knowledge Base Ingester)');
  console.log('===========================================');
  console.log(`時間: ${new Date().toLocaleString('zh-HK')}`);
  console.log(`模式: ${CONFIG.dryRun ? '🌵 DRY-RUN（不實際寫入）' : '✅ 正常模式'}`)
  console.log(`版本: v3.4 (LLM 分類 + keyword fallback + thin executor + Discord self-notify)`);
  console.log(`分類: ${USE_LLM_CLASSIFY ? '🧠 LLM + keyword fallback' : '🔤 純 keyword（--no-llm）'}`);
  console.log(`Discord notify: ${CONFIG.discordChannel ? `📺 channel ${CONFIG.discordChannel}` : 'off（default）'}`);
  console.log(`Log 檔: ${CONFIG.logFile}`);
  logToFile(`START: KB Ingester v3.4 (dryRun=${CONFIG.dryRun}, limit=${CONFIG.limit}, no-llm=${!USE_LLM_CLASSIFY}, discord=${CONFIG.discordChannel || 'off'})`);
  console.log('');

  // 讀取 last_ingest_id
  const lastIngestId = loadLastIngestId();
  if (lastIngestId) {
    console.log(`📍 上次攝入 ID: ${lastIngestId}`);
  } else {
    console.log('📍 首次運行，將讀取所有歷史消息');
  }
  console.log('');

  // 創建 Discord REST client
  const rest = createDiscordClient();
  console.log('🔌 Discord REST client 已初始化');
  console.log('');

  // 讀取學習 channel 新消息
  console.log('🔍 檢查學習 Channel 新消息...');
  const messages = await readLearningChannel(lastIngestId, rest);

  if (messages.length === 0) {
    console.log('📭 沒有新消息需要處理');
    logToFile('INFO: 沒有新消息需要處理');
    // v3.4: Discord self-notify（如果啟用）
    if (CONFIG.discordChannel) {
      const noMsgContent = '📚 KB Ingester — 沒有新消息需要處理';
      sendDiscordMessage(CONFIG.discordChannel, noMsgContent, CONFIG.dryRun);
    }
    // 冇新消息 → exit 0（merge with code 4）
    return;
  }

  console.log(`📊 找到 ${messages.length} 條新消息`);
  if (CONFIG.limit) {
    console.log(`📊 限制處理 ${CONFIG.limit} 條`);
  }
  console.log('');

  // 處理每條消息
  const total = messages.length;
  console.log(`📁 分類中... (共 ${total} 條)`);
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < total; i++) {
    const msg = messages[i];
    const result = await processMessage(msg);
    if (result.skipped) {
      skipped++;
    } else if (result.success) {
      processed++;
    } else {
      errors++;
    }
    // v3.2: 每 10 條報一次進度（唔印太多但知 alive）
    if ((i + 1) % 10 === 0 || i === total - 1) {
      console.log(`📊 進度: ${i + 1}/${total} (成功: ${processed}, 跳過: ${skipped}, 錯誤: ${errors})`);
    }
  }

  console.log('');
  console.log('===========================================');

  // v3.4: 統一 summary 格式（不論 LLM 成功、keyword fallback、--no-llm 都出一樣）
  // 全部失敗 → ❌ FAILED；其他 → ✅ 完成
  let summary;
  let exitCode = 0;

  if (errors > 0 && processed === 0) {
    // 全部失敗
    summary = `❌ FAILED: 全部 ${errors} 條處理失敗`;
    exitCode = 3;
  } else if (errors > 0) {
    // 部分成功
    summary = `✅ 完成！處理: ${processed} | 跳過: ${skipped} | 錯誤: ${errors}`;
    exitCode = 2;
  } else {
    // 全部成功（processed > 0 或 skipped，無 error）
    summary = `✅ 完成！處理: ${processed} | 跳過: ${skipped} | 錯誤: ${errors}`;
    exitCode = 0;
  }

  console.log(summary);
  logToFile(`SUMMARY: ${summary} (exit=${exitCode})`);

  // 更新 last_ingest_id
  if (messages.length > 0 && !CONFIG.dryRun) {
    const lastMessage = messages[0];  // v2.5: messages[0] = 最新消息 (reverse 後)
    saveLastIngestId(lastMessage.id);
    console.log(`💾 已保存 last_ingest_id: ${lastMessage.id}`);
  }
  console.log('===========================================');

  // v3.4: Discord self-notify（取代 cron agentTurn announce）
  if (CONFIG.discordChannel) {
    sendDiscordMessage(CONFIG.discordChannel, summary, CONFIG.dryRun);
  }

  // v3.4: granular exit code（macOS crontab 友善）
  // Use process.exit() 確保異步 console.log 都被 flush
  process.exit(exitCode);
}

// 直接執行
if (require.main === module) {
  main().catch(e => {
    console.error('❌ 執行失敗:', e);
    if (typeof e?.message === 'string') {
      try { fs.appendFileSync('/tmp/kb_ingest.log', `[${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}] FATAL: ${e.message}\n`); } catch (_) {}
    }
    process.exit(1);
  });
}

module.exports = { main, processMessage, classifyContent };
