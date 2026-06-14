#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Auto Issue Creator - 自動創建 Issue + 智能記憶路由 (改進版)
 * Run: node scripts/auto_remember.js [scan|test|smart]
 *
 * 改進：同日內容合併、更好嘅防重複機制
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { HOME, WS, MEMORY_DIR } = require('./lib/config');
const HOME_DIR = HOME;
const SESSIONS_DIR = path.join(HOME, '.openclaw', 'agents', 'main', 'sessions');
const WORKSPACE_DIR = WS;
const { createStateManager } = require('./lib/state');
const STATE_FILE = path.join(MEMORY_DIR, 'auto-issue-state.json');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE);
const { getHKTDate, getHKTDateTime } = require('./lib/time');

// ==================== CONFIG (Magic Numbers) ====================
const CONFIG = {
  TWO_HOURS_MS: 2 * 60 * 60 * 1000,  // 2 hours in milliseconds
  MAX_PROCESSED_ITEMS: 100,           // Max processed items to keep
  MIN_COUNT_THRESHOLD: 3,             // Min occurrences for preference promotion
  RETRY_DELAY_MS: 1000,               // Delay between retries in milliseconds

  // ==================== 評分權重 (from smart_memory_router.js) ====================
  KEYWORD_SCORE: 1,                  // 關鍵字匹配權重
  PATTERN_SCORE: 2,                  // 正則匹配權重

  // ==================== 顯示設定 ====================
  BAR_LENGTH: 10,                    // 評分 bar 長度
  MAX_TEXT_PREVIEW: 100,             // 分析時文字預覽上限
  MAX_TEXT_LENGTH: 80,               // 日誌時文字截斷上限
  MAX_ISSUE_TITLE: 50,               // Issue 標題上限

  // ==================== 置信度門檻 ====================
  CONFIDENCE_HIGH: 3,                // 高置信度門檻
  CONFIDENCE_MEDIUM: 1,              // 中置信度門檻

  // ==================== 日期格式 ====================
  DATE_FORMAT_LOCALE: 'zh-HK',
  DATE_FORMAT_TIMEZONE: 'Asia/Hong_Kong',
};

// ==================== SMART MEMORY ROUTER ====================

const MEMORY_CLASSIFICATIONS = [
  {
    target: 'MEMORY.md',
    keywords: ['記住', '記得', '唔好忘記', '長期', '永久', '偏好', '習慣', '鍾意'],
    patterns: [
      /記住.*(?:偏好|習慣|鍾意|唔鍾意)/i,
      /記住.*(?:聯絡人|電話|地址|email)/i,
      /記住.*(?:知識|資料|數據)/i,
      /呢個係.*(?:重要|關鍵)/i,
    ],
    description: '長期記憶：偏好、知識、重要資訊'
  },
  {
    target: 'AGENTS.md',
    keywords: ['規則', '準則', '原則', '行為', '應該', '必須', '遇到', '複雜', '問用戶', 'confirm'],
    patterns: [
      /(?:規則|準則).*係/i,
      /遇到.*(?:應該|要點做)/i,
      /(?:決定|結論).*係/i,
      /(?:永遠|一定|必須).*/i,
      /複雜.*(?:問題|請求|要求)/i,           // 複雜問題
      /(?:問|確認).*用戶/i,                  // 確認用戶
      /假如.*就.*/i,                         // 條件規則
    ],
    description: '代理規則：行為準則、決策、系統規則'
  },
  {
    target: 'TOOLS.md',
    keywords: ['工具', '指令', '參數', '用法', '技巧', 'command', '竅門'],
    patterns: [
      /(?:工具|指令).*(?:用法|用法)/i,
      /(?:記住|記得).*個command/i,
      /(?:技巧|竅門|shortcut)/i,
      /(?:設定|配置).*係/i,
      /點樣用.*/i,                           // 使用方法
    ],
    description: '工具參考：指令、技巧、配置'
  },
  {
    target: 'errors.json',
    keywords: ['錯誤', '問題', 'bug', '失敗', '教訓', '崩潰', 'crash', 'crashed', '原因'],
    patterns: [
      /(?:錯誤|問題).*係/i,
      /(?:原因|cause).*/i,
      /(?:解決|solution).*/i,
      /(?:下次|以後).*要.*/i,
      /唔好再.*/i,
      /(?:崩潰|crash).*(?:因為|係)/i,
    ],
    description: '錯誤記錄：問題、原因、解決、教訓'
  },
  {
    target: 'knowledge/preferences/',
    keywords: ['偏好', '鍾意', '唔鍾意', '喜歡', '唔喜歡', 'prefer', 'preference'],
    patterns: [
      /我(?:鍾意|喜歡|prefer).*(?:用|行|講|寫|睇|食|做)/i,
      /偏好.*(?:用|寫|講|行)/i,
      /以後.*(?:用|寫|做|行|叫).*(?:啦|好唔好|ok|好)$/i,
      /不如.*(?:用|寫|做)/i
    ],
    description: '偏好設定：鍾意/唔鍾意/習慣'
  },
  {
    target: 'knowledge/decisions/',
    keywords: ['決定', 'decision', '揀', '選擇', '方案', 'approve', 'approval'],
    patterns: [
      /我(?:決定|揀|選擇|approve)/i,
      /就用.*方案/i,
      /決定.*用/i
    ],
    description: '重要決定：選擇方案/決策'
  },
  {
    target: 'knowledge/people/',
    keywords: ['聯絡人', '電話', 'email', '地址', 'partner', '供應商', '同事', '老闆'],
    patterns: [
      /(?:電話|email|address|地址).*[0-9]/i,
      /介紹.*認識/i,
      /係我.*(?:partner|同事|老闆|供應商)/i
    ],
    description: '人物關係：聯絡方法/角色'
  }
];

const ISSUE_KEYWORDS = [
  { pattern: /要做|跟進|處理|任務|行動|之後.*做|遲啲.*做/i, priority: 'P2' },
  { pattern: /bug|錯誤.*未解決|crash|崩潰|crashed|crashing/i, priority: 'P1' },
  { pattern: /計劃.*整|打算.*做|準備.*整/i, priority: 'P2' },
];

function classifyRememberContent(text) {
  const scores = {};
  const reasons = {};

  for (const rule of MEMORY_CLASSIFICATIONS) {
    scores[rule.target] = 0;
    reasons[rule.target] = [];

    for (const keyword of rule.keywords) {
      if (text.includes(keyword)) {
        scores[rule.target] += CONFIG.KEYWORD_SCORE;
        reasons[rule.target].push(`關鍵字: "${keyword}"`);
      }
    }

    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        scores[rule.target] += CONFIG.PATTERN_SCORE;
        const match = text.match(pattern);
        reasons[rule.target].push(`模式: "${match[0].substring(0, 30)}..."`);
      }
    }
  }

  let isIssue = false;
  let issuePriority = 'P2';
  const isErrorRelated = /崩潰|錯誤|bug|失敗|原因.*係|crash/i.test(text);

  if (!isErrorRelated) {
    for (const { pattern, priority } of ISSUE_KEYWORDS) {
      if (pattern.test(text)) {
        isIssue = true;
        issuePriority = priority;
        break;
      }
    }
  }

  let bestTarget = null;
  let bestScore = 0;

  for (const [target, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  }

  if (isErrorRelated && bestTarget !== 'errors.json' && scores['errors.json'] > 0) {
    bestTarget = 'errors.json';
    bestScore = scores['errors.json'];
  }

  if (isIssue && bestScore < 4) {
    return {
      target: '.issues/',
      isIssue: true,
      priority: issuePriority,
      reason: '檢測到任務關鍵字（要做/跟進/任務）',
      confidence: 'high',
      scores, // 返回評分用於視覺化
      reasons
    };
  }

  if (bestTarget && bestScore > 0) {
    return {
      target: bestTarget,
      isIssue: false,
      reason: reasons[bestTarget][0] || '內容匹配',
      confidence: bestScore >= CONFIG.CONFIDENCE_HIGH ? 'high' : bestScore >= CONFIG.CONFIDENCE_MEDIUM ? 'medium' : 'low',
      scores, // 返回評分用於視覺化
      reasons
    };
  }

  return {
    target: 'MEMORY.md',
    isIssue: false,
    reason: '默認分類（一般記憶）',
    confidence: 'low',
    scores,
    reasons
  };
}

// ==================== 評分視覺化 (from smart_memory_router.js) ====================

function renderScoreBar(score, maxLength = CONFIG.BAR_LENGTH) {
  const filledBars = Math.min(score, maxLength);
  const emptyBars = maxLength - filledBars;
  return '█'.repeat(filledBars) + '░'.repeat(emptyBars);
}

function logClassificationResults(text, classification) {
  if (_quiet) return;

  const truncatedText = text.length > CONFIG.MAX_TEXT_LENGTH
    ? text.substring(0, CONFIG.MAX_TEXT_LENGTH) + '...'
    : text;

  console.log(`內容: "${truncatedText}"`);
  console.log('');
  console.log('📊 分類評分:');

  for (const [target, score] of Object.entries(classification.scores || {})) {
    const bar = renderScoreBar(score);
    console.log(`  ${target.padEnd(12)} ${bar} ${score}`);
  }

  console.log('');
  console.log(`✅ 建議存放: ${classification.target}`);
  console.log(`   原因: ${classification.reason}`);
  console.log(`   置信度: ${classification.confidence}`);
  console.log('');
}

// ==================== IMPROVED FILE OPERATIONS ====================

function appendToMemoryMd(content) {
  try {
    const fullPath = path.join(WORKSPACE_DIR, 'MEMORY.md');
    const timestamp = getHKTDateTime();
    const entry = `\n<!-- Auto-added: ${timestamp} -->\n${content}\n`;

    fs.appendFileSync(fullPath, entry);
    return { success: true, timestamp };
  } catch (e) {
    console.error('Failed to append to MEMORY.md:', e.message);
    return { success: false, error: e.message };
  }
}

function appendToAgentsMd(content) {
  try {
    const fullPath = path.join(WORKSPACE_DIR, 'AGENTS.md');
    const timestamp = getHKTDateTime();
    const entry = `\n<!-- Auto-added: ${timestamp} -->\n${content}\n`;

    fs.appendFileSync(fullPath, entry);
    return { success: true, timestamp };
  } catch (e) {
    console.error('Failed to append to AGENTS.md:', e.message);
    return { success: false, error: e.message };
  }
}

function appendToToolsMd(content) {
  try {
    const fullPath = path.join(WORKSPACE_DIR, 'TOOLS.md');
    const timestamp = getHKTDateTime();
    const entry = `\n<!-- Auto-added: ${timestamp} -->\n${content}\n`;

    fs.appendFileSync(fullPath, entry);
    return { success: true, timestamp };
  } catch (e) {
    console.error('Failed to append to TOOLS.md:', e.message);
    return { success: false, error: e.message };
  }
}

function addToErrors(title, content) {
  try {
    // 使用陣列參數避免命令注入
    const args = [
      path.join(__dirname, 'error_tracker.js'),
      'add',
      '--title', title,
      '--problem', content.substring(0, 100)
    ];
    const { execFileSync } = require('child_process');
    execFileSync('node', args, { encoding: 'utf-8' });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function createIssue(title, priority = 'P2', due = '') {
  try {
    const args = [
      path.join(__dirname, 'issue_manager.js'),
      'create',
      title,
      '--priority', priority
    ];
    if (due) {
      args.push('--due', due);
    }
    const result = execFileSync('node', args, { encoding: 'utf-8' });
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== STATE MANAGEMENT ====================
function isRecentlyProcessed(text, state) {
  const now = new Date();
  const today = getHKTDate();

  // 檢查是否今日已處理過
  if (state.dailySummary && state.dailySummary[today]) {
    for (const item of state.dailySummary[today]) {
      if (item.text.substring(0, 30) === text.substring(0, 30)) {
        return true;
      }
    }
  }

  // 檢查 2 小時內是否處理過
  for (const item of state.processedItems || []) {
    const itemTime = new Date(item.time);
    if ((now - itemTime) < CONFIG.TWO_HOURS_MS) {
      if (item.text.substring(0, 30) === text.substring(0, 30)) {
        return true;
      }
    }
  }

  return false;
}

function recordProcessed(text, target, state) {
  const today = getHKTDate();
  const timestamp = getHKTDateTime();

  // 記錄到 processedItems
  state.processedItems = state.processedItems || [];
  state.processedItems.push({
    text: text.substring(0, 100),
    target,
    time: timestamp,
    fullText: text.substring(0, 100) // Reduced to save memory - use hash for longer text if needed
  });

  // 只保留最近 100 條
  if (state.processedItems.length > CONFIG.MAX_PROCESSED_ITEMS) {
    state.processedItems = state.processedItems.slice(-CONFIG.MAX_PROCESSED_ITEMS);
  }

  // 記錄到 dailySummary
  state.dailySummary = state.dailySummary || {};
  state.dailySummary[today] = state.dailySummary[today] || [];
  state.dailySummary[today].push({
    text: text.substring(0, 100),
    target,
    time: timestamp
  });

  // 只保留最近 7 日
  const dates = Object.keys(state.dailySummary);
  if (dates.length > 7) {
    dates.sort();
    for (let i = 0; i < dates.length - 7; i++) {
      delete state.dailySummary[dates[i]];
    }
  }

  // Level 3: Preference Learning - Check if this appears 3+ times in 3 months
  checkAndPromoteToPreference(text, state);

  saveState(state);
}

// Level 3: Preference Learning
function checkAndPromoteToPreference(text, state) {
  // P2 Fix: Use milliseconds calculation for consistent 3-month window (90 days)
  const threeMonthsAgo = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));

  // Extract core content (remove "記住", "記得" etc.)
  const coreContent = extractCoreContent(text);

  // Count occurrences in last 3 months
  let count = 0;
  const occurrences = [];

  for (const item of state.processedItems || []) {
    const itemTime = new Date(item.time);
    if (itemTime >= threeMonthsAgo) {
      const itemCore = extractCoreContent(item.fullText || item.text);
      if (isContentSimilar(coreContent, itemCore)) {
        count++;
        occurrences.push({ time: item.time, text: item.fullText || item.text });
      }
    }
  }

  // If 3+ occurrences, promote to P0 preference (using CONFIG threshold)
  if (count >= CONFIG.MIN_COUNT_THRESHOLD) {
    const preference = {
      id: `pref-${Date.now()}`,
      content: coreContent,
      fullText: text.substring(0, 200),
      count,
      firstSeen: occurrences[0]?.time,
      lastSeen: occurrences[occurrences.length - 1]?.time,
      promotedDate: getHKTDateTime(),
      status: 'auto_promoted'
    };

    // Check if already promoted
    state.preferences = state.preferences || [];
    const alreadyPromoted = state.preferences.some(p =>
      isContentSimilar(extractCoreContent(p.content), coreContent)
    );

    if (!alreadyPromoted) {
      state.preferences.push(preference);
      log(`🎯 Level 3: Auto-promoted to P0 preference after ${count} occurrences`);
      log(`   Content: "${coreContent.substring(0, 60)}..."`);

      // Optionally notify user
      notifyPreferencePromotion(preference);
    }
  }
}

function extractCoreContent(text) {
  // Remove common prefixes
  return text
    .replace(/記住|記得|唔好忘記|記低|請記住/gi, '')
    .replace(/規則係[:：]/gi, '')
    .replace(/^\s+/, '')
    .substring(0, 100)
    .toLowerCase();
}

function isContentSimilar(a, b) {
  // Simple similarity: check if first 50 chars match or 70% overlap
  if (a.length < 10 || b.length < 10) return false;

  const aStart = a.substring(0, 50);
  const bStart = b.substring(0, 50);

  if (aStart === bStart) return true;

  // P2 Fix: Optimized from O(n²) to O(n) using Set
  const aWords = a.split(/\s+/);
  const bWords = new Set(b.split(/\s+/)); // Use Set for O(1) lookup
  const commonWords = aWords.filter(w => bWords.has(w));
  const similarity = commonWords.length / Math.max(aWords.length, bWords.size);

  return similarity >= 0.7;
}

function notifyPreferencePromotion(preference) {
  const message = `🎯 Preference Auto-Promoted (Level 3)\n\nAfter appearing ${preference.count} times in 3 months, this preference has been auto-promoted to P0:\n\n"${preference.content.substring(0, 80)}..."\n\nI'll automatically apply this preference in future without asking.`;

  // Sanitize message to prevent command injection
  const MAX_MSG_LENGTH = 1800;
  const sanitizedMsg = message.replace(/"/g, '\\"').replace(/\n/g, ' ').substring(0, MAX_MSG_LENGTH);

  // P1 Fix: Validate env var - must be numeric string
  const rawChannelId = process.env.DISCORD_SYSTEM_CHANNEL_ID || '1473376125584670872';
  const channelId = /^\d+$/.test(rawChannelId) ? rawChannelId : '1473376125584670872';

  // P1 Fix: Retry logic for notification
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = CONFIG.RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      execFileSync('openclaw', ['message', 'send', '--channel', 'discord', '-t', channelId, '-m', sanitizedMsg], {
        timeout: 15000,
        stdio: 'ignore'
      });
      return; // Success
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        // Retry with delay
        const start = Date.now();
        while (Date.now() - start < RETRY_DELAY_MS) {
          // Busy wait for simplicity (sync function)
        }
      } else {
        // Final attempt failed
        if (!_quiet) console.error(`⚠️ Preference notification failed after ${MAX_RETRIES} attempts: ${e.message}`);
      }
    }
  }
}

// ==================== PROCESS ITEM ====================

// ==================== KNOWLEDGE SAVE ====================

function saveToKnowledge(type, text) {
  const KNOWLEDGE_DIR = path.join(MEMORY_DIR, 'knowledge');
  const subDir = type.replace('knowledge/', ''); // e.g. 'preferences/', 'decisions/', 'people/'
  const targetDir = path.join(KNOWLEDGE_DIR, subDir);

  // Ensure directory exists
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  } catch (e) {
    return { success: false, error: 'Failed to create directory: ' + e.message };
  }

  // Extract title and content from text
  const cleanText = text
    .replace(/^(記住|記得|唔好忘記|記低)/i, '')
    .replace(/規則係[:：]?/i, '')
    .trim();

  // Generate filename from first meaningful words
  const words = cleanText.replace(/[^a-zA-Z0-9\u4e00-\u9fff\s]/g, '').split(/\s+/).filter(Boolean);
  const label = words.slice(0, 6).join('-').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]/g, '');
  const filename = label.substring(0, 40) + '.md';
  const filePath = path.join(targetDir, filename);

  const timestamp = getHKTDate();
  let md = '# ' + words.slice(0, 4).join(' ').substring(0, 50) + '\n\n';
  md += '> Created: ' + timestamp + '\n\n';
  md += '- ' + cleanText + '\n';

  try {
    fs.writeFileSync(filePath, md, 'utf8');

    // Refresh MEMORY.md via cross_session_bootstrap
    try {
      execFileSync('node', [
        path.join(WORKSPACE_DIR, 'scripts/cross_session_bootstrap.js'),
        '--quiet'
      ], { timeout: 10000 });
    } catch (_) {}

    return { success: true, filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function processRememberItem(text) {
  // Level 3: Check if this is already a known preference (P0)
  const state = loadState();
  const coreContent = extractCoreContent(text);

  const existingPreference = (state.preferences || []).find(p =>
    isContentSimilar(extractCoreContent(p.content), coreContent)
  );

  if (existingPreference) {
    return {
      success: true,
      target: 'P0_PREFERENCE',
      action: 'skipped',
      message: `⏭️  This is already a known P0 preference (seen ${existingPreference.count} times). Skipping.`,
      preference: existingPreference
    };
  }

  const classification = classifyRememberContent(text);

  let result = {
    success: false,
    target: classification.target,
    action: '',
    message: ''
  };

  if (classification.isIssue) {
    const issueResult = createIssue(text.substring(0, 50), classification.priority);
    result.success = issueResult.success;
    result.action = 'create_issue';
    result.message = issueResult.success
      ? `✅ 已自動創建 Issue [${classification.priority}]`
      : `❌ 創建 Issue 失敗: ${issueResult.error}`;
  } else {
    switch (classification.target) {
      case 'MEMORY.md':
        const memResult = appendToMemoryMd(text);
        result.success = memResult.success;
        result.action = memResult.action || 'append';
        if (memResult.reason === 'duplicate_content') {
          result.message = `⏭️  內容已存在於今日記錄，跳過`;
        } else {
          result.message = `✅ 已${memResult.action === 'merged' ? '合併到' : '添加到'} **MEMORY.md** (${memResult.action})`;
        }
        break;

      case 'AGENTS.md':
        const agentsResult = appendToAgentsMd(text);
        result.success = agentsResult.success;
        result.action = 'append';
        result.message = agentsResult.success
          ? `✅ 已自動記錄喺 **AGENTS.md**`
          : `❌ 記錄失敗: ${agentsResult.error}`;
        break;

      case 'TOOLS.md':
        const toolsResult = appendToToolsMd(text);
        result.success = toolsResult.success;
        result.action = 'append';
        result.message = toolsResult.success
          ? `✅ 已自動記錄喺 **TOOLS.md**`
          : `❌ 記錄失敗: ${toolsResult.error}`;
        break;

      case 'errors.json':
        const errorResult = addToErrors(text.substring(0, 40), text);
        result.success = errorResult.success;
        result.action = 'add_error';
        result.message = errorResult.success
          ? `✅ 已添加到 **errors.json**`
          : `❌ 添加失敗: ${errorResult.error}`;
        break;

      case 'knowledge/preferences/':
      case 'knowledge/decisions/':
      case 'knowledge/people/':
        const kbResult = saveToKnowledge(classification.target, text);
        result.success = kbResult.success;
        result.action = 'save_knowledge';
        result.message = kbResult.success
          ? `✅ 已記錄到 **${classification.target}** (${kbResult.filename})`
          : `❌ 記錄失敗: ${kbResult.error}`;
        break;
    }
  }

  return result;
}

// ==================== SCAN SESSIONS ====================

function scanForRememberRequests() {
  const matches = [];

  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      return matches;
    }
  } catch (e) {
    console.error('Error checking file: ' + e.message);
    return matches;
  }

  let files = [];
  try {
    files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-2);
  } catch (err) {
    log(`⚠️ Failed to read sessions directory: ${err.message}`);
    return matches;
  }

  for (const file of files) {
    const filePath = path.join(SESSIONS_DIR, file);

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      const recentLines = lines.slice(-30);

      for (const line of recentLines) {
        try {
          const msg = JSON.parse(line);
          if (msg.role === 'user' && msg.content) {
            const text = msg.content;

            if (/記住|記得|唔好忘記|規則係|要記低/i.test(text)) {
              matches.push({
                text: text.substring(0, 200),
                timestamp: msg.timestamp || new Date().toISOString()
              });
            }
          }
        } catch (e) {
          // Skip
        }
      }
    } catch (e) {
      // Skip
    }
  }

  return matches;
}

async function detectAndCreate(text) {
  const state = loadState();

  if (isRecentlyProcessed(text, state)) {
    return { success: false, reason: 'recently_processed' };
  }

  const result = processRememberItem(text);

  if (result.success) {
    recordProcessed(text, result.target, state);
  }

  return result;
}

// ==================== MAIN ====================

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'scan';

  if (command === 'test') {
    log('🧪 測試智能記憶分類（改進版 + 評分視覺化）\n');
    log('='.repeat(60));

    const testCases = [
      '記住我鍾意用繁體中文',
      '記住遇到複雜問題要先問用戶',
      '記住個command: node scripts/issue_manager.js list',
      '記住上次merge_stock.js崩潰係因為OOM',
      '記住要做：重寫整個系統',
      '規則係：永遠要用trash而唔係rm',
    ];

    for (const test of testCases) {
      log(`\n📝 輸入: "${test}"`);
      const result = classifyRememberContent(test);
      logClassificationResults(test, result);
      log('-'.repeat(60));
    }
    return;
  }

  if (command === 'preferences' || command === 'list-pref') {
    const state = loadState();
    const prefs = state.preferences || [];

    log(`🎯 P0 Preferences (Level 3 Auto-Promoted): ${prefs.length}\n`);

    if (prefs.length === 0) {
      log('No preferences have been auto-promoted yet.');
      log('Preferences appear here after being "remembered" 3+ times in 3 months.');
      return;
    }

    prefs.forEach((pref, index) => {
      log(`${index + 1}. "${pref.content.substring(0, 60)}..."`);
      log(`   Count: ${pref.count} times`);
      log(`   First seen: ${pref.firstSeen}`);
      log(`   Auto-promoted: ${pref.promotedDate}`);
      log('');
    });
    return;
  }

  if (command === 'smart' && args[1]) {
    const text = args.slice(1).join(' ');
    log(`🧠 處理: "${text.substring(0, 60)}..."\n`);

    const state = loadState();

    if (isRecentlyProcessed(text, state)) {
      log('⏭️  最近已處理過類似內容，跳過');
      return;
    }

    const result = processRememberItem(text);
    log(result.message);

    if (result.success) {
      recordProcessed(text, result.target, state);
    }
    return;
  }

  // 默認掃描模式
  log('🔍 掃描「記住」請求（改進版）...\n');

  const state = loadState();
  const matches = scanForRememberRequests();

  if (matches.length === 0) {
    log('✅ 未發現新的「記住」請求');
    return;
  }

  log(`📊 發現 ${matches.length} 個「記住」請求\n`);

  let processed = 0;
  let skipped = 0;

  for (const match of matches) {
    if (isRecentlyProcessed(match.text, state)) {
      log(`⏭️  跳過（最近已處理）: "${match.text.substring(0, 40)}..."`);
      skipped++;
      continue;
    }

    log(`\n📝 處理: "${match.text.substring(0, 60)}..."`);
    const result = processRememberItem(match.text);
    log(result.message);

    if (result.success) {
      recordProcessed(match.text, result.target, state);
      processed++;
    }
  }

  state.lastRun = getHKTDateTime();
  saveState(state);

  log(`\n✅ 完成處理 ${processed} 個，跳過 ${skipped} 個`);
}

if (require.main === module) {
  main();
}

module.exports = {
  detectAndCreate,
  classifyRememberContent,
  processRememberItem,
  appendToMemoryMd,
  isRecentlyProcessed
};
