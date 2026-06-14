const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * OpenClaw Auto-Skill Router
 *
 * 功能：
 * 1. 自動檢測用戶消息意圖
 * 2. 匹配相關 Skills
 * 3. 自動載入 Skills
 * 4. 執行任務
 *
 * 創建日期: 2026-02-15
 */

const path = require('path');
const { WS } = require('./lib/config');
const fs = require('fs');
const { analyzeIntent, loadMatchingSkills, getSkillSuggestion, listSkills } = require('./skills_manager');

// 載入 Skills Manager
const skillsManager = require('./skills_manager');

/**
 * 處理用戶請求
 * @param {string} message - 用戶消息
 * @param {object} context - 上下文
 * @returns {object} - 處理結果
 */
async function handleUserRequest(message, context = {}) {
  const startTime = Date.now();

  // Validate message input to prevent injection attacks
  if (typeof message !== 'string' || message.length > 10000) {
    throw new Error('Invalid message: must be a string with max length 10000');
  }

  // Step 1: 分析意圖
  log('\n=== Auto-Skill Router ===');
  log(`📨 Message: "${message}"`);

  const analysis = skillsManager.analyzeIntent(message);
  const processingTime = Date.now() - startTime;

  log(`🔍 Intent Analysis: ${processingTime}ms`);
  log(`🎯 Keywords: ${analysis.keywords.slice(0, 5).join(', ') || 'None'}`);
  log(`📊 Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);

  // 如果沒有匹配的 Skills，則使用預設模型
  if (analysis.matchedSkills.length === 0) {
    log(`\n💡 No matching skills, using default model`);

    return {
      success: true,
      method: 'default_model',
      message: message,
      analysis: analysis,
      processingTime: Date.now() - startTime
    };
  }

  // Step 2: 載入匹配的 Skills
  log(`\n📦 Loading matching skills...`);

  const loadedSkills = skillsManager.loadMatchingSkills(analysis);
  const loadedSkillNames = Object.keys(loadedSkills);

  log(`✅ Loaded: ${loadedSkillNames.join(', ') || 'None'}`);

  // Step 3: 執行 Skills
  const results = [];

  for (const [skillId, skillData] of Object.entries(loadedSkills)) {
    try {
      const skillResult = await executeSkill(skillId, skillData, message, context);
      results.push(skillResult);
    } catch (error) {
      results.push({
        skillId: skillId,
        success: false,
        error: error.message
      });
    }
  }

  // Step 4: 生成最終回覆
  const finalResponse = generateResponse(message, analysis, results);

  return {
    success: true,
    method: 'auto_skill_router',
    message: message,
    analysis: analysis,
    matchedSkills: analysis.matchedSkills.slice(0, 3),
    loadedSkills: loadedSkillNames,
    results: results,
    response: finalResponse,
    processingTime: Date.now() - startTime
  };
}

/**
 * 執行 Skill (加強錯誤處理)
 */
async function executeSkill(skillId, skillData, message, context) {
  const skill = skillData.module;

  try {
    // 根據不同類型的 Skill 調用不同函數
    if (skill.generateFormula) {
      // Excel Formula Skill
      const result = await Promise.resolve(skill.generateFormula(message, context));
      return {
        skillId: skillId,
        skillName: skillData.name,
        type: 'excel_formula',
        success: true,
        result: result
      };
    }

    if (skill.analyzeTask) {
      // Productivity Skill
      const result = await Promise.resolve(skill.analyzeTask(message, context));
      return {
        skillId: skillId,
        skillName: skillData.name,
        type: 'productivity',
        success: true,
        result: result
      };
    }

    if (skill.generateReport) {
      // Report Generation Skill
      const result = await Promise.resolve(skill.generateReport(message, context));
      return {
        skillId: skillId,
        skillName: skillData.name,
        type: 'report',
        success: true,
        result: result
      };
    }

    if (skill.estimateValue) {
      // Diamond Valuation Skill
      const result = await Promise.resolve(skill.estimateValue(message, context));
      return {
        skillId: skillId,
        skillName: skillData.name,
        type: 'valuation',
        success: true,
        result: result
      };
    }

    // 通用：返回 Skill Info
    return {
      skillId: skillId,
      skillName: skillData.name,
      type: 'general',
      success: true,
      result: skill.skill || skillData.description
    };
  } catch (error) {
    console.error(`❌ Skill ${skillId} 執行失敗: ${error.message}`);
    return {
      skillId: skillId,
      skillName: skillData.name,
      type: 'error',
      success: false,
      error: error.message
    };
  }
}

/**
 * 生成回覆
 */
function generateResponse(message, analysis, results) {
  if (results.length === 0) {
    return null;
  }

  const primaryResult = results[0];

  if (primaryResult.type === 'excel_formula') {
    return {
      type: 'excel_formula',
      formula: primaryResult.result.formula,
      explanation: primaryResult.result.explanation,
      tip: primaryResult.result.tip
    };
  }

  if (primaryResult.type === 'productivity') {
    return {
      type: 'productivity',
      suggestion: primaryResult.result.suggestion,
      suggestedAction: primaryResult.result.suggestedAction
    };
  }

  return {
    type: 'general',
    result: primaryResult.result
  };
}

/**
 * 快速檢測消息類型
 */
function quickDetect(message) {
  const messageLower = message.toLowerCase();

  const patterns = {
    excel: /excel|formula|計算|計|spreadsheet/i,
    diamond: /diamond|鑽石|gia|carat|clarity|color/i,
    task: /task|schedule|meeting|會議|時間|待辦/i,
    search: /search|搜尋|research|研究|搵嘢/i,
    quote: /quote|報價|quotation|單/i,
    code: /code|program|script|代碼|程式/i,
    file: /file|檔案|read|write|讀|寫/i
  };

  const detected = [];

  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(messageLower)) {
      detected.push(type);
    }
  }

  return detected;
}

/**
 * 創建 Skills 建議回覆
 */
function createSkillSuggestionReply(analysis) {
  if (analysis.matchedSkills.length === 0) {
    return null;
  }

  const topSkill = analysis.matchedSkills[0];

  return {
    emoji: '🎯',
    title: '自動檢測到相關 Skill',
    skill: topSkill.skillName,
    description: topSkill.description,
    file: topSkill.file,
    confidence: `${(analysis.confidence * 100).toFixed(0)}%`,
    keywords: analysis.keywords.slice(0, 5),
    suggestion: '我已經自動載入呢個 Skill 來處理你嘅請求！'
  };
}

/**
 * 主動建議可用 Skills
 * 當檢測到用戶可能有需求時，主動推薦
 */
function proactiveSuggestion(message) {
  const detected = quickDetect(message);

  if (detected.length === 0) {
    return null;
  }

  const skillsList = skillsManager.listSkills();
  const suggestions = [];

  detected.forEach(type => {
    const matchingSkills = skillsList.skills.filter(s =>
      s.keywords?.some(kw => message.toLowerCase().includes(kw.toLowerCase()))
    );

    if (matchingSkills.length > 0) {
      suggestions.push({
        detectedType: type,
        skills: matchingSkills.map(s => s.name)
      });
    }
  });

  if (suggestions.length === 0) {
    return null;
  }

  return {
    emoji: '💡',
    title: '你可能需要呢啲 Skills',
    detectedTypes: suggestions,
    action: '我可以自動載入呢啲 Skills 來幫你處理！'
  };
}

/**
 * 初始化 Auto-Skill Router
 */
function init() {
  log('\n=== Auto-Skill Router ===');
  log('🚀 Initializing...');

  // 初始化 Skills Manager
  skillsManager.init();

  const skillsList = skillsManager.listSkills();
  log(`✅ Ready with ${skillsList.totalSkills} skills`);

  // 註冊預設 Skills (如果未註冊)
  registerDefaultSkills();
}

/**
 * 註冊預設 Skills
 */
function registerDefaultSkills() {
  const defaultSkills = {
    excel_ai_formula: {
      file: "skills/excel_ai_formula.js",
      name: "Excel AI Formula Generator",
      version: "1.0.0",
      keywords: ["excel", "formula", "公式", "計算", "spreadsheet"],
      intents: ["generate_formula", "explain_formula"],
      description: "根據自然語言生成 Excel 公式",
      category: "productivity"
    },
    productivity_automation: {
      file: "skills/productivity_automation.js",
      name: "Productivity Automation",
      version: "1.0.0",
      keywords: ["task", "schedule", "時間", "管理", "gtd"],
      intents: ["task_management", "time_blocking"],
      description: "任務管理、時間區塊、GTD 工作流",
      category: "productivity"
    }
  };

  // 檢查並註冊
  for (const [skillId, skillConfig] of Object.entries(defaultSkills)) {
    try {
      const skillsPath = path.join(WS, 'skills');

      // 檢查文件是否存在
      if (fs.existsSync(path.join(skillsPath, path.basename(skillConfig.file)))) {
        // Skill 已存在，確保已註冊
        if (!skillsManager.SKILLS_REGISTRY[skillId]) {
          skillsManager.registerSkill(skillId, skillConfig);
        }
      }
    } catch (error) {
      // 忽略錯誤
    }
  }
}

// 主程式
if (require.main === module) {
  log('\n=== OpenClaw Auto-Skill Router ===\n');

  // 初始化
  init();

  // 測試 (用 for...of 代替 forEach 支援 async)
  log('\n=== Test Auto-Skill Router ===\n');

  const testMessages = [
    "幫我計吓呢粒 2.5 卡嘅鑽石值幾多錢",
    "generate excel formula for quarterly growth rate",
    "schedule meeting with client next week",
    "search latest diamond market trends",
    "呢粒石頭咩價錢"
  ];

  (async () => {
    for (const msg of testMessages) {
      try {
        log(`\n💬 "${msg}"`);
        const result = await handleUserRequest(msg);
        log(`   Skills: ${result.loadedSkills.join(', ') || 'None'}`);
        log(`   Time: ${result.processingTime}ms`);
      } catch (error) {
        log(`   ❌ Error: ${error.message}`);
      }
    }
  })();
}

module.exports = {
  handleUserRequest,
  quickDetect,
  createSkillSuggestionReply,
  proactiveSuggestion,
  init
};
