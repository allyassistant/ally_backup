#!/usr/bin/env node

/**
 * Preference Tracker
 * 偏好自動更新機製
 * 追蹤用戶偏好候選，從對話中識別偏好關鍵詞，計算置信度並生成 Discord 報告
 *
 * 使用方法:
 *   node scripts/preference_tracker.js --analyze "對話內容"  # 分析單條對話
 *   node scripts/preference_tracker.js --report              # 生成 Discord 報告
 *   node scripts/preference_tracker.js --quiet               # 靜默模式
 */

const fs = require('fs');
const path = require('path');
const { MEMORY_DIR, atomicWriteSync } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');

// ==================== CONFIG ====================
const CONFIG = {
  STATE_FILE: path.join(MEMORY_DIR, 'preference-tracker-state.json'),
  CONFIDENCE: {
    HIGH: 5,    // >= 5 次: high
    MEDIUM: 3,  // 3-4 次: medium
    LOW: 2      // 2 次: low
  },
  PATTERNS: {
    traditional_chinese: {
      keywords: ['繁體', '正體', '用繁體', '繁體中文', '繁體字'],
      category: 'language'
    },
    time_preference: {
      keywords: ['每個禮拜', '每日', '每週', '幾時', '每天', '每週三', '每個月'],
      category: 'schedule'
    },
    tool_preference: {
      keywords: ['Kimi', 'MiniMax', 'Claude', 'GPT', 'OpenAI', 'Gemini'],
      category: 'tool'
    },
    report_preference: {
      keywords: ['報告', '通知', '告訴我', '提醒我', '報表', '發送'],
      category: 'report'
    },
    language_preference: {
      keywords: ['廣東話', '粵語', '英文', '中文', '普通話', '國語'],
      category: 'language'
    }
  }
};

// ==================== QUIET MODE ====================
const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// ==================== STATE MANAGEMENT ====================

/**
 * 初始化或載入 state
 */
function loadState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      const content = fs.readFileSync(CONFIG.STATE_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`⚠️ Failed to load state: ${err.message}`);
  }

  // Default state
  return {
    candidates: [],
    confirmed: [],
    lastUpdated: getHKTDateTime()
  };
}

/**
 * 使用 atomic write 儲存 state
 */
function saveState(state) {
  try {
    state.lastUpdated = getHKTDateTime();
    atomicWriteSync(CONFIG.STATE_FILE, state);
    return true;
  } catch (err) {
    console.error(`❌ Failed to save state: ${err.message}`);
    return false;
  }
}

// ==================== PREFERENCE DETECTION ====================

/**
 * 從對話內容中識別偏好關鍵詞
 * @param {string} text - 對話內容
 * @returns {Array} 識別到的偏好列表
 */
function detectPreferences(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const detected = [];

  for (const [type, config] of Object.entries(CONFIG.PATTERNS)) {
    for (const keyword of config.keywords) {
      try {
        // 使用正則表達式進行不區分大小寫匹配
        const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = text.match(regex);

        if (matches && matches.length > 0) {
          detected.push({
            type,
            category: config.category,
            keyword,
            count: matches.length,
            timestamp: getHKTDateTime()
          });
          break; // 同類型只記錄一次
        }
      } catch (err) {
        // 無效的正則表達式，跳過
        console.error(`⚠️ Invalid regex for keyword "${keyword}": ${err.message}`);
      }
    }
  }

  return detected;
}

/**
 * 更新候選偏好列表
 */
function updateCandidates(state, newPreferences) {
  if (!newPreferences || newPreferences.length === 0) {
    return state;
  }

  for (const pref of newPreferences) {
    try {
      // 查找是否已存在相同類型的候選
      const existingIndex = state.candidates.findIndex(
        c => c.type === pref.type && c.keyword === pref.keyword
      );

      if (existingIndex >= 0) {
        // 更新現有候選
        state.candidates[existingIndex].count++;
        state.candidates[existingIndex].lastSeen = pref.timestamp;
        state.candidates[existingIndex].occurrences = state.candidates[existingIndex].occurrences || [];
        state.candidates[existingIndex].occurrences.push(pref.timestamp);

        // 只保留最近 10 次出現時間
        if (state.candidates[existingIndex].occurrences.length > 10) {
          state.candidates[existingIndex].occurrences =
            state.candidates[existingIndex].occurrences.slice(-10);
        }
      } else {
        // 添加新候選
        state.candidates.push({
          type: pref.type,
          category: pref.category,
          keyword: pref.keyword,
          count: 1,
          firstSeen: pref.timestamp,
          lastSeen: pref.timestamp,
          occurrences: [pref.timestamp],
          confirmed: false
        });
      }
    } catch (err) {
      console.error(`⚠️ Failed to update candidate: ${err.message}`);
    }
  }

  return state;
}

/**
 * 計算置信度等級
 */
function getConfidenceLevel(count) {
  if (count >= CONFIG.CONFIDENCE.HIGH) return 'high';
  if (count >= CONFIG.CONFIDENCE.MEDIUM) return 'medium';
  if (count >= CONFIG.CONFIDENCE.LOW) return 'low';
  return 'none';
}

/**
 * 將高置信度的候選移動到 confirmed
 */
function promoteConfirmed(state) {
  try {
    const toPromote = state.candidates.filter(
      c => c.count >= CONFIG.CONFIDENCE.HIGH && !c.confirmed
    );

    for (const candidate of toPromote) {
      candidate.confirmed = true;
      candidate.promotedAt = getHKTDateTime();

      // 檢查是否已存在於 confirmed
      const existingIndex = state.confirmed.findIndex(
        c => c.type === candidate.type && c.keyword === candidate.keyword
      );

      if (existingIndex >= 0) {
        // 更新現有 confirmed
        state.confirmed[existingIndex] = candidate;
      } else {
        // 添加到 confirmed
        state.confirmed.push(candidate);
      }

      log(`✅ Promoted to confirmed: ${candidate.type} (${candidate.keyword}) - ${candidate.count} times`);
    }
  } catch (err) {
    console.error(`⚠️ Failed to promote confirmed: ${err.message}`);
  }

  return state;
}

// ==================== DISCORD REPORT ====================

/**
 * 生成 Discord 格式的偏好報告
 */
function generateDiscordReport(state) {
  const lines = [];
  lines.push('## 🎯 偏好置信度報告');
  lines.push('');

  // 按類別分組 - 使用 Map 避免重複（已確認的候選不重複計算）
  const byCategory = {};
  const processed = new Set();

  for (const candidate of [...state.candidates, ...state.confirmed]) {
    try {
      const key = `${candidate.type}-${candidate.keyword}`;
      if (processed.has(key)) continue;
      processed.add(key);

      const level = getConfidenceLevel(candidate.count);
      if (level === 'none') continue;

      const category = candidate.category || 'other';
      if (!byCategory[category]) {
        byCategory[category] = { high: [], medium: [], low: [] };
      }

      byCategory[category][level].push(candidate);
    } catch (err) {
      console.error(`⚠️ Failed to process candidate for report: ${err.message}`);
    }
  }

  // 輸出分組結果
  const categoryNames = {
    language: '🗣️ 語言偏好',
    schedule: '⏰ 時間偏好',
    tool: '🛠️ 工具偏好',
    report: '📊 報告偏好',
    other: '📌 其他偏好'
  };

  for (const [category, levels] of Object.entries(byCategory)) {
    if (levels.high.length === 0 && levels.medium.length === 0 && levels.low.length === 0) {
      continue;
    }

    lines.push(`**${categoryNames[category] || category}**`);
    lines.push('');

    // High confidence
    if (levels.high.length > 0) {
      lines.push('🟢 **高置信度** (>= 5 次)');
      for (const c of levels.high) {
        const icon = c.confirmed ? '✅' : '📈';
        lines.push(`${icon} ${c.type}: "${c.keyword}" (${c.count} 次)`);
      }
      lines.push('');
    }

    // Medium confidence
    if (levels.medium.length > 0) {
      lines.push('🟡 **中置信度** (3-4 次)');
      for (const c of levels.medium) {
        lines.push(`📊 ${c.type}: "${c.keyword}" (${c.count} 次)`);
      }
      lines.push('');
    }

    // Low confidence
    if (levels.low.length > 0) {
      lines.push('🔴 **低置信度** (2 次)');
      for (const c of levels.low) {
        lines.push(`📍 ${c.type}: "${c.keyword}" (${c.count} 次)`);
      }
      lines.push('');
    }
  }

  // 統計摘要
  const totalHigh = Object.values(byCategory).reduce((sum, l) => sum + l.high.length, 0);
  const totalMedium = Object.values(byCategory).reduce((sum, l) => sum + l.medium.length, 0);
  const totalLow = Object.values(byCategory).reduce((sum, l) => sum + l.low.length, 0);
  const totalConfirmed = state.confirmed.length;

  lines.push('---');
  lines.push('**📈 統計摘要**');
  lines.push(`• 已確認偏好: ${totalConfirmed}`);
  lines.push(`• 高置信度候選: ${totalHigh}`);
  lines.push(`• 中置信度候選: ${totalMedium}`);
  lines.push(`• 低置信度候選: ${totalLow}`);
  lines.push(`• 最後更新: ${new Date().toLocaleString('zh-TW')}`);

  return lines.join('\n');
}

// ==================== COMMANDS ====================

/**
 * 分析對話內容
 */
function analyzeCommand(text) {
  if (!text) {
    console.error('❌ 請提供對話內容: --analyze "對話內容"');
    return 1;
  }

  log('🔍 分析對話內容...\n');

  try {
    const state = loadState();
    const detected = detectPreferences(text);

    if (detected.length === 0) {
      log('ℹ️ 未檢測到任何偏好關鍵詞');
      return 0;
    }

    log(`檢測到 ${detected.length} 個偏好候選:`);
    for (const d of detected) {
      log(`  • ${d.type} (${d.category}): "${d.keyword}"`);
    }

    updateCandidates(state, detected);
    promoteConfirmed(state);

    if (saveState(state)) {
      log('\n✅ 已更新偏好追蹤狀態');
    }

    return 0;
  } catch (err) {
    console.error(`❌ 分析失敗: ${err.message}`);
    return 1;
  }
}

/**
 * 生成報告
 */
function reportCommand() {
  log('📊 生成偏好報告...\n');

  try {
    const state = loadState();

    if (state.candidates.length === 0 && state.confirmed.length === 0) {
      log('ℹ️ 目前沒有任何偏好數據');
      return 0;
    }

    const report = generateDiscordReport(state);
    log(report);

    return 0;
  } catch (err) {
    console.error(`❌ 生成報告失敗: ${err.message}`);
    return 1;
  }
}

/**
 * 顯示狀態
 */
function statusCommand() {
  log('📋 偏好追蹤狀態\n');

  try {
    const state = loadState();

    log('**候選偏好:**');
    if (state.candidates.length === 0) {
      log('  (無)');
    } else {
      for (const c of state.candidates) {
        const level = getConfidenceLevel(c.count);
        const levelIcon = { high: '🟢', medium: '🟡', low: '🔴', none: '⚪' }[level];
        log(`  ${levelIcon} ${c.type}: "${c.keyword}" - ${c.count} 次 (${c.confirmed ? '已確認' : level})`);
      }
    }

    log('\n**已確認偏好:**');
    if (state.confirmed.length === 0) {
      log('  (無)');
    } else {
      for (const c of state.confirmed) {
        log(`  ✅ ${c.type}: "${c.keyword}" - ${c.count} 次`);
      }
    }

    log(`\n最後更新: ${state.lastUpdated || 'N/A'}`);

    return 0;
  } catch (err) {
    console.error(`❌ 獲取狀態失敗: ${err.message}`);
    return 1;
  }
}

/**
 * 重置狀態
 */
function resetCommand() {
  try {
    const emptyState = {
      candidates: [],
      confirmed: [],
      lastUpdated: getHKTDateTime()
    };

    if (saveState(emptyState)) {
      log('🗑️ 已重置偏好追蹤狀態');
    }

    return 0;
  } catch (err) {
    console.error(`❌ 重置失敗: ${err.message}`);
    return 1;
  }
}

// ==================== MAIN ====================

function main() {
  const args = process.argv.slice(2);

  // 過濾掉 --quiet
  const commands = args.filter(a => a !== '--quiet');

  if (commands.includes('--analyze')) {
    const analyzeIndex = commands.indexOf('--analyze');
    const text = commands[analyzeIndex + 1];
    return analyzeCommand(text);
  } else if (commands.includes('--report')) {
    return reportCommand();
  } else if (commands.includes('--status')) {
    return statusCommand();
  } else if (commands.includes('--reset')) {
    return resetCommand();
  } else {
    log(`
偏好追蹤器 (Preference Tracker)
==============================

自動追蹤用戶偏好，從對話中識別關鍵詞並計算置信度。

使用方法:
  node scripts/preference_tracker.js --analyze "對話內容"  # 分析對話
  node scripts/preference_tracker.js --report              # 生成 Discord 報告
  node scripts/preference_tracker.js --status              # 顯示當前狀態
  node scripts/preference_tracker.js --reset               # 重置所有數據
  node scripts/preference_tracker.js --quiet [command]     # 靜默模式

偏好類別:
  • language: 繁體/正體/廣東話/英文/中文
  • schedule: 每日/每週/每個禮拜/幾時
  • tool: Kimi/MiniMax/Claude
  • report: 報告/通知/告訴我

置信度計算:
  • >= 5 次: high (高置信度)
  • 3-4 次: medium (中置信度)
  • 2 次: low (低置信度)

State file: memory/preference-tracker-state.json
`);
    return 0;
  }
}

// Run
process.exit(main());
