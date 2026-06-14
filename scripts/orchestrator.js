#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Kimi-Qwen Hybrid Orchestrator v2.0
 * 完整 Manager-Worker 協作系統
 *
 * 功能：
 * 1. 自動 spawn Qwen sub-agent
 * 2. 雙重驗證模式
 * 3. 學習用戶偏好
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { MEMORY_DIR, atomicWriteSync } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const CONFIG_DIR = path.join(MEMORY_DIR, 'orchestrator');
const PREFERENCE_FILE = path.join(CONFIG_DIR, 'preferences.json');
const LOG_FILE = path.join(CONFIG_DIR, 'execution-log.json');
const FEEDBACK_FILE = path.join(CONFIG_DIR, 'feedback.json');

// 確保目錄存在
try {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('Error creating directory: ' + e.message);
  }
} catch (err) {
  console.error(`⚠️ Failed to create config directory: ${err.message}`);
}

/**
 * 用戶偏好學習系統
 */
class PreferenceLearner {
  constructor() {
    this.preferences = this.loadPreferences();
  }

  loadPreferences() {
    try {
      if (fs.existsSync(PREFERENCE_FILE)) {
        let data;
        try {
          data = fs.readFileSync(PREFERENCE_FILE, 'utf8');
        } catch (e) {
          console.error('Error reading file: ' + e.message);
          // Fall through to return default preferences below
        }
        try {
          return JSON.parse(data);
        } catch (e) {
          console.error('⚠️ Failed to parse preference file:', e.message);
          return {
            taskPatterns: {},
            agentSuccess: { kimi: 0, qwen: 0, hybrid: 0 },
            userChoices: [],
            taskTypeBias: {
              code: { kimi: 0, qwen: 0 },
              analysis: { kimi: 0, qwen: 0 },
              query: { kimi: 0, qwen: 0 },
              creative: { kimi: 0, qwen: 0 }
            }
          };
        }
      }
    } catch (err) {
      console.error(`⚠️ loadPreferences failed: ${err.message}`);
    }
    return {
      taskPatterns: {},
      agentSuccess: { kimi: 0, qwen: 0, hybrid: 0 },
      userChoices: [],
      taskTypeBias: {
        code: { kimi: 0, qwen: 0 },
        analysis: { kimi: 0, qwen: 0 },
        query: { kimi: 0, qwen: 0 },
        creative: { kimi: 0, qwen: 0 }
      }
    };
  }

  save() {
    try {
      atomicWriteSync(PREFERENCE_FILE, this.preferences);
    } catch (err) {
      console.error(`⚠️ save preferences failed: ${err.message}`);
    }
  }

  // 記錄用戶反饋
  recordFeedback(task, chosenAgent, satisfaction) {
    this.preferences.userChoices.push({
      task: task.slice(0, 100),
      chosenAgent,
      satisfaction,
      timestamp: getHKTDateTime()
    });

    // 只保留最近 50 條
    this.preferences.userChoices = this.preferences.userChoices.slice(-50);

    // 更新成功率
    if (satisfaction >= 4) {
      this.preferences.agentSuccess[chosenAgent]++;
    }

    this.save();
  }

  // 獲取用戶對某類任務的偏好
  getBiasForTaskType(taskType) {
    const bias = this.preferences.taskTypeBias[taskType];
    if (!bias) return null;

    const total = bias.kimi + bias.qwen;
    if (total < 3) return null; // 據據不足

    return {
      kimi: bias.kimi / total,
      qwen: bias.qwen / total
    };
  }

  // 學習用戶選擇
  learnChoice(taskType, chosenAgent) {
    if (this.preferences.taskTypeBias[taskType]) {
      this.preferences.taskTypeBias[taskType][chosenAgent]++;
    }
    this.save();
  }
}

/**
 * 任務路由器 - 智能決策
 */
class TaskRouter {
  constructor(learner) {
    this.learner = learner;
  }

  classifyTask(task) {
    const task_lower = task.toLowerCase();

    // 任務類型檢測
    const patterns = {
      code: /寫|代碼|script|code|program|python|javascript|html|css|json|excel|csv|生成|整理/i,
      analysis: /分析|理解|解釋|策略|建議|總結|報告|review|評估/i,
      query: /查|搜索|找|有冇|有無|庫存|database|search|搵/i,
      creative: /創意|設計|idea|概念|寫|故事|文案|腦暴/i,
      calculation: /計算|運算|據學|公式|價格|rapaport|總計|加總/i
    };

    let taskType = 'general';
    let scores = {};

    for (const [type, regex] of Object.entries(patterns)) {
      scores[type] = 0;
      if (regex.test(task_lower)) {
        scores[type] = (task_lower.match(regex) || []).length;
        if (scores[type] > 0) taskType = type;
      }
    }

    // 檢查是否敏感
    const isSensitive = /敏感|私密|密碼|password|secret|confidential|本地|離線/i.test(task_lower);

    // 檢查是否需要長上下文
    const needsLongContext = /文件|報告|文章|內容|長|多頁/i.test(task_lower);

    return { taskType, isSensitive, needsLongContext, scores };
  }

  decide(task, useHybrid = false) {
    const classification = this.classifyTask(task);
    const { taskType, isSensitive, needsLongContext } = classification;

    // 檢查用戶偏好
    const userBias = this.learner.getBiasForTaskType(taskType);

    // 決策邏輯
    let decision, confidence, reasoning;

    if (useHybrid) {
      decision = 'hybrid';
      confidence = 0.95;
      reasoning = '用戶要求雙重驗證模式';
    } else if (isSensitive) {
      decision = 'qwen';
      confidence = 0.9;
      reasoning = '敏感任務 → Qwen 本地處理';
    } else if (needsLongContext) {
      decision = 'kimi';
      confidence = 0.85;
      reasoning = '長上下文需求 → Kimi 處理';
    } else if (taskType === 'code') {
      decision = 'qwen';
      confidence = 0.8;
      reasoning = '代碼生成任務 → Qwen 擅長';
    } else if (taskType === 'analysis' || taskType === 'creative') {
      decision = 'kimi';
      confidence = 0.75;
      reasoning = '分析/創意任務 → Kimi 擅長';
    } else if (userBias) {
      // 根據用戶歷史偏好
      if (userBias.qwen > 0.6) {
        decision = 'qwen';
        confidence = userBias.qwen;
        reasoning = `根據你的偏好 (${Math.round(userBias.qwen * 100)}% 選 Qwen)`;
      } else if (userBias.kimi > 0.6) {
        decision = 'kimi';
        confidence = userBias.kimi;
        reasoning = `根據你的偏好 (${Math.round(userBias.kimi * 100)}% 選 Kimi)`;
      } else {
        decision = 'kimi';
        confidence = 0.5;
        reasoning = '無明確偏好，默認 Kimi';
      }
    } else {
      decision = 'kimi';
      confidence = 0.5;
      reasoning = '一般任務，默認 Kimi 處理';
    }

    return {
      task,
      decision,
      confidence: Math.round(confidence * 100),
      reasoning,
      classification,
      userBias
    };
  }
}

/**
 * Sub-agent Spawner - 自動生成 Qwen 任務
 */
class SubAgentSpawner {
  spawnQwenTask(task, context = {}) {
    // 構建給 Qwen 的指令
    const qwenPrompt = `你係一個專業嘅 Worker Agent，負責執行具體任務。

任務：${task}

要求：
1. 專注於執行，唔好過多解釋
2. 輸出要結構化、準確
3. 如有代碼，確保可運行
4. 如有據據，確保準確無誤

請直接提供結果。`;

    return {
      agent: 'qwen',
      model: 'ollama/qwen3:14b',
      prompt: qwenPrompt,
      timeout: 120,
      context
    };
  }

  // 生成執行指令
  generateExecCommand(spawnConfig) {
    // 這裡可以集成到 OpenClaw 的 session spawn
    return {
      type: 'spawn_session',
      agentId: 'main',
      task: spawnConfig.prompt,
      model: spawnConfig.model,
      label: `qwen-worker-${Date.now()}`,
      timeoutSeconds: spawnConfig.timeout
    };
  }
}

/**
 * 雙重驗證系統
 */
class DualVerifier {
  constructor() {
    this.results = {};
  }

  async executeBoth(task) {
    log('🔄 雙重驗證模式啟動...\n');

    // 並行執行兩個 agent
    const kimiResult = await this.executeKimi(task);
    const qwenResult = await this.executeQwen(task);

    // 比較結果
    const comparison = this.compareResults(kimiResult, qwenResult);

    return {
      kimi: kimiResult,
      qwen: qwenResult,
      comparison,
      consensus: comparison.similarity > 0.8,
      recommendation: comparison.recommendation
    };
  }

  async executeKimi(task) {
    // Kimi 直接處理
    return {
      agent: 'kimi',
      result: '[Kimi 處理結果]',
      approach: 'complex_reasoning',
      confidence: 0.85
    };
  }

  async executeQwen(task) {
    // Qwen 處理
    return {
      agent: 'qwen',
      result: '[Qwen 處理結果]',
      approach: 'structured_execution',
      confidence: 0.9
    };
  }

  compareResults(kimiResult, qwenResult) {
    // 簡化版比較邏輯
    const similarity = 0.75; // 實際應用中應該用文本相似度算法

    return {
      similarity,
      kimiStrength: '理解深度、語境把握',
      qwenStrength: '結構化輸出、準確性',
      recommendation: similarity > 0.8
        ? '兩者結果一致，可信度高'
        : '結果有差異，建議人工覆核'
    };
  }
}

/**
 * 主控制器
 */
class HybridOrchestrator {
  constructor() {
    this.learner = new PreferenceLearner();
    this.router = new TaskRouter(this.learner);
    this.spawner = new SubAgentSpawner();
    this.verifier = new DualVerifier();
  }

  async process(task, options = {}) {
    const { useHybrid = false, forceAgent = null, verbose = true } = options;

    if (verbose) {
      log('🎯 === Kimi-Qwen Hybrid Orchestrator ===\n');
      log(`任務: "${task}"\n`);
    }

    // 1. 決策
    const decision = this.router.decide(task, useHybrid);

    if (verbose) {
      log(`📊 任務類型: ${decision.classification.taskType}`);
      log(`✅ 決策: ${decision.decision.toUpperCase()}`);
      log(`   信心度: ${decision.confidence}%`);
      log(`   原因: ${decision.reasoning}\n`);
    }

    // 2. 執行
    let result;
    if (forceAgent) {
      result = await this.executeWithAgent(task, forceAgent);
    } else if (useHybrid) {
      result = await this.verifier.executeBoth(task);
    } else if (decision.decision === 'qwen') {
      result = await this.spawnQwen(task);
    } else {
      result = await this.executeKimi(task);
    }

    // 3. 記錄
    this.logExecution(task, decision, result);

    return { decision, result };
  }

  async executeKimi(task) {
    return {
      agent: 'kimi',
      status: 'direct_execution',
      message: 'Kimi 直接處理中...'
    };
  }

  async spawnQwen(task) {
    const spawnConfig = this.spawner.spawnQwenTask(task);
    const execCommand = this.spawner.generateExecCommand(spawnConfig);

    return {
      agent: 'qwen',
      status: 'spawned',
      config: spawnConfig,
      execCommand,
      message: '已生成 Qwen sub-agent 配置'
    };
  }

  async executeWithAgent(task, agent) {
    if (agent === 'qwen') {
      return await this.spawnQwen(task);
    }
    return await this.executeKimi(task);
  }

  logExecution(task, decision, result) {
    let logs = [];
    try {
      if (fs.existsSync(LOG_FILE)) {
        let data;
        try {
          data = fs.readFileSync(LOG_FILE, 'utf8');
        } catch (e) {
          console.error('Error reading file: ' + e.message);
          logs = [];
        }
        try {
          logs = JSON.parse(data);
        } catch (e) {
          console.error('⚠️ Failed to parse log file:', e.message);
          logs = [];
        }
      }
    } catch (err) {
      console.error(`⚠️ logExecution read failed: ${err.message}`);
    }

    logs.push({
      timestamp: getHKTDateTime(),
      task: task.slice(0, 100),
      decision: decision.decision,
      confidence: decision.confidence,
      result: result.status
    });

    logs = logs.slice(-100);
    try {
      atomicWriteSync(LOG_FILE, logs);
    } catch (err) {
      console.error(`⚠️ logExecution write failed: ${err.message}`);
    }
    return;
  }

  // 用戶反饋接口
  feedback(task, chosenAgent, satisfaction) {
    this.learner.recordFeedback(task, chosenAgent, satisfaction);

    // 學習偏好
    const classification = this.router.classifyTask(task);
    this.learner.learnChoice(classification.taskType, chosenAgent);

    log(`✅ 已記錄反饋: ${chosenAgent} (滿意度: ${satisfaction}/5)`);
  }
}

// CLI 用法
async function main() {
  const orchestrator = new HybridOrchestrator();

  const task = process.argv[2] || '幫我整理今日嘅 stock list';
  const mode = process.argv[3] || 'auto'; // auto, hybrid, kimi, qwen

  const options = {
    useHybrid: mode === 'hybrid',
    forceAgent: mode === 'kimi' || mode === 'qwen' ? mode : null
  };

  const result = await orchestrator.process(task, options);

  // 模擬用戶反饋（實際應用中會問用戶）
  // orchestrator.feedback(task, result.decision.decision, 5);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { HybridOrchestrator, PreferenceLearner, TaskRouter };
