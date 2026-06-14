const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * OpenClaw Skills Manager
 *
 * 功能：
 * 1. 註山所有 Skills
 * 2. 關鍵詞匹配
 * 3. 自動載入 Skills
 * 4. 與下文檢測
 *
 * 創建日期: 2026-02-15
 */

const fs = require('fs');
const path = require('path');

const { WS } = require('./lib/config');

// Skills Registry - 記錄所有可用的 Skills
const SKILLS_REGISTRY = {
  // === DIAMOND & BUSINESS ===
  diamond_valuation: {
    file: "skills/diamond_valuation.js",
    name: "Diamond Valuation (Rapaport)",
    version: "1.0.0",
    created: "2026-02-15",
    source: "MEMORY.md - Rapaport Pricing",
    keywords: ["diamond", "鑽石", "rapaport", "估價", "價格", "4c", "gia", "carat", "color", "clarity", "幾多錢", "咩價"],
    intents: ["valuation", "pricing", "估價", "報價", "價值", "計價"],
    description: "根據 Rapaport 表格計算鑽石價格",
    category: "business",
    exists: true
  },

  // === EXCEL & PRODUCTIVITY ===
  excel_ai_formula: {
    file: "skills/excel_ai_formula.js",
    name: "Excel AI Formula Generator",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["excel", "formula", "公式", "spreadsheet", "計", "計算"],
    intents: ["generate_formula", "explain_formula", "生成公式", "解釋公式"],
    description: "根據自然語言生成 Excel 公式",
    category: "productivity",
    exists: true
  },

  productivity_automation: {
    file: "skills/productivity_automation.js",
    name: "Productivity Automation",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["task", "schedule", "project", "時間", "管理", "gtd", "todo", "待辦"],
    intents: ["task_management", "time_blocking", "項目分解"],
    description: "任務管理、時間區塊、GTD 工作流",
    category: "productivity",
    exists: true
  },

  // === RESEARCH & SEARCH (Tools, not Skills) ===
  perplexity_search: {
    file: "scripts/perplexity_search.js",
    name: "Perplexity Search",
    version: "1.0.0",
    keywords: ["search", "搜尋", "research", "研究", "搵嘢", "latest"],
    intents: ["research", "search", "查詢"],
    description: "用 Perplexity 搜尋資訊",
    category: "research",
    isTool: true,  // 呢個係工具，唔係可載入嘅 Skill
    exists: true
  },

  web_search: {
    file: "tools/web_search",
    name: "Web Search",
    version: "1.0.0",
    keywords: ["web", "與網", "internet", "search engine"],
    intents: ["search", "research"],
    description: "網頁搜尋",
    category: "research",
    isTool: true,
    exists: false  // 呢個係 OpenClaw 內置tool
  },

  // === FILE & DATA ===
  file_processor: {
    file: "skills/file_processor.js",
    name: "File Processor",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["file", "檔案", "read", "write", "處理", "打開", "save"],
    intents: ["read_file", "write_file", "處理檔案"],
    description: "讀寫、處理檔案",
    category: "utility",
    exists: true
  },

  data_analyzer: {
    file: "skills/data_analyzer.js",
    name: "Data Analyzer",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["analyze", "分析", "data", "據據", "統計", "report"],
    intents: ["analyze", "分析", "統計"],
    description: "據據分析、統計",
    category: "utility",
    exists: true
  },

  // === MEMORY & KNOWLEDGE ===
  memory_manager: {
    file: "skills/memory_manager.js",
    name: "Memory Manager",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["remember", "記住", "memory", "記憶", "save", "記錄"],
    intents: ["save_memory", "recall", "儲存記憶", "回憶"],
    description: "儲存/回憶記憶",
    category: "knowledge",
    exists: true
  },

  learning_processor: {
    file: "skills/learning_processor.js",
    name: "Learning Processor",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["learn", "學習", "extract", "提炼", "summary", "學嘢"],
    intents: ["learn_from_content", "extract_key_points"],
    description: "從內容中學習、提取要點",
    category: "knowledge",
    exists: true
  },

  // === NOTIFICATION ===
  whatsapp_notification: {
    file: "skills/whatsapp_notification.js",
    name: "WhatsApp Notification",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["whatsapp", "message", "通知", "send", "發送", "notify"],
    intents: ["send_notification", "send_message"],
    description: "發送 WhatsApp 通知",
    category: "notification",
    exists: true
  },

  reminder_manager: {
    file: "skills/reminder_manager.js",
    name: "Reminder Manager",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["reminder", "提醒", "alarm", "通知", "待辦", "todo"],
    intents: ["set_reminder", "create_reminder"],
    description: "設定提醒事項",
    category: "notification",
    exists: true
  },

  // === MONITORING ===
  health_monitor: {
    file: "scripts/health_monitor.js",
    name: "Health Monitor",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["health", "monitor", "狀態", "檢查", "system status"],
    intents: ["check_status", "monitor_system"],
    description: "系統健康檢查",
    category: "monitoring",
    exists: true
  },

  token_monitor: {
    file: "scripts/autoops/token_monitor.js",
    name: "Token Monitor",
    version: "1.0.0",
    created: "2026-02-15",
    keywords: ["token", "usage", "配額", "monitor", "tokens"],
    intents: ["check_tokens", "monitor_usage"],
    description: "監控 Token 使用量",
    category: "monitoring",
    exists: true
  }
};

/**
 * 分析用戶消息，提取意圖
 * @param {string} message - 用戶消息
 * @returns {object} - 分析結果
 */
function analyzeIntent(message) {
  const messageLower = message.toLowerCase();

  const result = {
    originalMessage: message,
    keywords: [],
    intents: [],
    matchedSkills: [],
    category: null,
    confidence: 0
  };

  // 提取關鍵詞和匹配 Skills
  for (const [skillId, skill] of Object.entries(SKILLS_REGISTRY)) {
    let matchCount = 0;

    // 檢查 keywords
    for (const keyword of skill.keywords) {
      if (messageLower.includes(keyword.toLowerCase())) {
        result.keywords.push(keyword);
        matchCount++;
      }
    }

    // 檢查 intents
    for (const intent of skill.intents) {
      if (messageLower.includes(intent.toLowerCase())) {
        result.intents.push(intent);
        matchCount += 2; // Intent 匹配權重更高
      }
    }

    // 如果有匹配，添加到 matchedSkills
    if (matchCount > 0) {
      result.matchedSkills.push({
        skillId: skillId,
        skillName: skill.name,
        matchScore: matchCount,
        category: skill.category,
        file: skill.file,
        description: skill.description
      });
    }
  }

  // 計算置信度 (改進版)
  if (result.matchedSkills.length > 0) {
    const topSkill = result.matchedSkills[0];
    const totalKeywords = SKILLS_REGISTRY[topSkill.skillId]?.keywords?.length || 1;

    // 基於: 1) 匹配數量 2) 佔總keyword比例 3) 是否匹配到 intent
    const baseScore = topSkill.matchScore;
    const keywordRatio = result.keywords.length / Math.max(totalKeywords, 3);
    const hasIntentMatch = result.intents.length > 0 ? 1.5 : 1.0;

    // 綜合計算 (最高 1.0)
    result.confidence = Math.min(
      (baseScore * 0.3 + keywordRatio * 0.5 + hasIntentMatch * 0.2) / 2,
      1.0
    );
  }

  // 排序 matchedSkills
  result.matchedSkills.sort((a, b) => b.matchScore - a.matchScore);

  // 確定主要類別
  if (result.matchedSkills.length > 0) {
    result.category = result.matchedSkills[0].category;
  }

  return result;
}

/**
 * 根據分析結果自動載入 Skills
 * @param {object} analysis - 分析結果
 * @returns {object} - 載入的 Skills
 */
function loadMatchingSkills(analysis) {
  const loadedSkills = {};

  // 只載入置信度 >= 0.2 且 matchScore >= 2 的 Skills
  analysis.matchedSkills
    .filter(skill => {
      // 過濾掉 tools，只載入 actual skills
      if (SKILLS_REGISTRY[skill.skillId]?.isTool) {
        return false;
      }
      // 提高 threshold：需要至少 match 2 個 keywords/intents
      return skill.matchScore >= 2;
    })
    .slice(0, 2) // 最多載入 2 個 Skills
    .forEach(skill => {
      try {
        // Validate skill.file to prevent path traversal
        if (!skill.file || typeof skill.file !== 'string' || skill.file.includes('..')) {
          console.warn(`⚠️ Invalid skill file path: ${skill?.file}`);
          return;
        }
        const skillPath = path.join(WS, skill.file.replace('.js', ''));

        // 嘗試載入 Skill (combined check and require to avoid race condition)
        try {
          const skillModule = require(skillPath);

          // 驗證 skill module 是否有效
          if (!skillModule || typeof skillModule !== 'object') {
            console.warn(`⚠️ Skill ${skill.skillId} 載入失敗：無效模組`);
            return;
          }

          loadedSkills[skill.skillId] = {
            name: skill.skillName,
            module: skillModule,
            matchScore: skill.matchScore,
            description: skill.description
          };
        } catch (error) {
          console.warn(`⚠️ 載入 Skill ${skill.skillId} 失敗: ${error.message}`);
          // 繼續處理下一個 skill，唔會 crash
        }
      } catch (error) {
        console.warn(`⚠️ 載入 Skill ${skill.skillId} 失敗: ${error.message}`);
        // 繼續處理下一個 skill，唔會 crash
      }
    });

  return loadedSkills;
}

/**
 * 創建 Skills 使用建議
 * @param {object} analysis - 分析結果
 * @returns {string} - 使用建議
 */
function getSkillSuggestion(analysis) {
  if (analysis.matchedSkills.length === 0) {
    return null;
  }

  const topSkill = analysis.matchedSkills[0];

  return `
=== Skills 匹配結果 ===

📊 置信度: ${(analysis.confidence * 100).toFixed(0)}%

🎯 建議使用的 Skill:
   ${topSkill.skillName}
   文件: ${topSkill.file}
   描述: ${topSkill.description}

📋 其他匹配 Skills:
${analysis.matchedSkills.slice(1, 4).map((s, i) => `   ${i+2}. ${s.skillName} (${s.matchScore} 分)`).join('\n')}

💡 使用方式:
   調用 Skill: ${topSkill.skillId}
   自動載入模塊進行處理
`;
}

/**
 * 註山新 Skill
 * @param {string} skillId - Skill ID
 * @param {object} skillConfig - Skill 配置
 */
function registerSkill(skillId, skillConfig) {
  SKILLS_REGISTRY[skillId] = skillConfig;

  // 保存到文件
  saveRegistry();

  log(`✅ Registered new skill: ${skillId} - ${skillConfig.name}`);
}

/**
 * 取消註山 Skill
 * @param {string} skillId - Skill ID
 */
function unregisterSkill(skillId) {
  if (SKILLS_REGISTRY[skillId]) {
    delete SKILLS_REGISTRY[skillId];
    saveRegistry();
    log(`✅ Unregistered skill: ${skillId}`);
  }
}

/**
 * 保存 Registry 到文件
 * HR-035: Atomic write implementation
 */
function saveRegistry() {
  const registryPath = path.join(WS, 'scripts', 'skills_registry.json');
  const tmpPath = registryPath + '.tmp';
  try {
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(SKILLS_REGISTRY, null, 2));
      fs.renameSync(tmpPath, registryPath);
    } catch (e) {
      console.error('Error writing file: ' + e.message);
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch (_) { /* ignore cleanup */ }
    }
  } catch (err) {
    console.error(`⚠️ Failed to save registry: ${err.message}`);
  }
}

/**
 * 列出所有註山的 Skills
 */
function listSkills() {
  const skillsList = Object.entries(SKILLS_REGISTRY).map(([id, skill]) => ({
    id: id,
    name: skill.name,
    category: skill.category,
    keywords: skill.keywords.slice(0, 5), // 只顯示前5個關鍵詞
    description: skill.description
  }));

  return {
    totalSkills: skillsList.length,
    byCategory: groupByCategory(skillsList),
    skills: skillsList
  };
}

/**
 * 按類別分組 Skills
 */
function groupByCategory(skillsList) {
  const grouped = {};

  skillsList.forEach(skill => {
    if (!grouped[skill.category]) {
      grouped[skill.category] = [];
    }
    grouped[skill.category].push(skill);
  });

  return grouped;
}

/**
 * 搜尋 Skills
 * @param {string} query - 搜尋關鍵詞
 * @returns {array} - 匹配的 Skills
 */
function searchSkills(query) {
  const queryLower = query.toLowerCase();

  const results = [];

  for (const [skillId, skill] of Object.entries(SKILLS_REGISTRY)) {
    // 檢查名稱
    if (skill.name.toLowerCase().includes(queryLower)) {
      results.push({ skillId, ...skill, matchType: 'name' });
    }

    // 檢查關鍵詞
    for (const keyword of skill.keywords) {
      if (keyword.toLowerCase().includes(queryLower)) {
        results.push({ skillId, ...skill, matchType: 'keyword', matchedKeyword: keyword });
        break;
      }
    }

    // 檢查意圖
    for (const intent of skill.intents) {
      if (intent.toLowerCase().includes(queryLower)) {
        results.push({ skillId, ...skill, matchType: 'intent', matchedIntent: intent });
        break;
      }
    }
  }

  return results;
}

/**
 * 初始化 Skills Manager
 */
function init() {
  log('🚀 Skills Manager initialized');
  log(`   Registered skills: ${Object.keys(SKILLS_REGISTRY).length}`);

  // 嘗試載入現有的 Skills
  const loaded = loadAllSkills();
  log(`   Loaded skills: ${Object.keys(loaded).length}`);
}

/**
 * 載入所有 Skills
 */
function loadAllSkills() {
  const loaded = {};
  try {
    for (const [skillId, skill] of Object.entries(SKILLS_REGISTRY)) {
      try {
        // Validate skill.file to prevent path traversal
        if (!skill.file || typeof skill.file !== 'string' || skill.file.includes('..')) {
          console.warn(`⚠️ Invalid skill file path: ${skill?.file}`);
          continue;
        }
        const skillPath = path.join(WS, skill.file.replace('.js', ''));
        try {
          if (fs.existsSync(skillPath + '.js')) {
            loaded[skillId] = require(skillPath);
          }
        } catch (e) {
          console.error('Error checking file: ' + e.message);
        }
      } catch (error) {
        // 忽略錯誤
      }
    }
  } catch (err) {
    console.error(`⚠️ loadAllSkills error: ${err.message}`);
  }
  return loaded;
}

// 主程式
if (require.main === module) {
  log('\n=== OpenClaw Skills Manager ===\n');

  // 初始化
  init();

  // 列出所有 Skills
  const list = listSkills();
  log(`\n📦 Total Skills: ${list.totalSkills}`);

  // 按類別顯示
  for (const [category, skills] of Object.entries(list.byCategory)) {
    log(`\n📁 ${category} (${skills.length}):`);
    skills.forEach(s => {
      log(`   - ${s.name}`);
    });
  }

  // 測試 Intent 分析
  log('\n=== Test Intent Analysis ===');

  const testMessages = [
    "幫我計吓呢粒鑽石嘅價值",
    "generate excel formula for growth rate",
    "schedule meeting with client",
    "search latest diamond trends",
    "set reminder for 3pm meeting"
  ];

  testMessages.forEach(msg => {
    const analysis = analyzeIntent(msg);
    log(`\n💬 "${msg}"`);
    log(`   Keywords: ${analysis.keywords.slice(0, 3).join(', ') || 'None'}`);
    log(`   Top Skill: ${analysis.matchedSkills[0]?.skillName || 'None'}`);
    log(`   Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
  });
}

module.exports = {
  SKILLS_REGISTRY,
  analyzeIntent,
  loadMatchingSkills,
  getSkillSuggestion,
  registerSkill,
  unregisterSkill,
  listSkills,
  searchSkills,
  init,
  loadAllSkills
};
