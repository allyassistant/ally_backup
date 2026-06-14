/**
 * Model Router — Phase 1
 *
 * 根據 intent route 揀最適合的 model。
 * Cost-quality 權衡：簡單 query 用平 model，複雜用貴 model。
 *
 * Usage:
 *   const { getModelForRoute, ROUTE_MODEL_MAP } = require('./router/model_router');
 *   const modelConfig = getModelForRoute('RESEARCH');
 *   // { primary: 'minimax-portal/MiniMax-M2.7', fallback: 'deepseek/deepseek-v4-pro', reason: '...' }
 */

const config = require('./config');

/**
 * Route → Model mapping
 *
 * All model names use exact OpenClaw format.
 * null = skip model routing (use default)
 *
 * @typedef {Object} ModelConfig
 * @property {string|null} primary - Primary model to use
 * @property {string|null} fallback - Fallback model if primary unavailable
 * @property {string} reason - Why this model was chosen
 */

/** @type {Record<string, ModelConfig>} */
const ROUTE_MODEL_MAP = {
  /**
   * FDQ: 模糊/需要問清楚
   * 多 round 對話用月費已包的 MiniMax
   */
  FDQ: {
    primary: 'minimax-portal/MiniMax-M2.7',
    fallback: null,
    reason: '月費已包，多 round 對話適合 FDQ 問清楚流程',
  },

  /**
   * DIRECT_ANSWER: Yes/No/Status 查詢
   * 簡單 query 用 flash 又快又準
   */
  DIRECT_ANSWER: {
    primary: 'deepseek/deepseek-v4-flash',
    fallback: null,
    reason: '簡單 query 用 flash 夠快夠準',
  },

  /**
   * SOP: 標準流程（X link 分析、Email）
   * Flash 夠，但複雜 email 可能需要 MiniMax 1M context
   */
  SOP: {
    primary: 'deepseek/deepseek-v4-flash',
    fallback: 'minimax-portal/MiniMax-M2.7',
    reason: 'SOP 需要 1M context 時 fallback 到 MiniMax',
  },

  /**
   * RESEARCH: 需要分析/探索/spawn
   * 複雜分析用較強模型
   */
  RESEARCH: {
    primary: 'minimax-portal/MiniMax-M2.7',
    fallback: 'deepseek/deepseek-v4-pro',
    reason: '複雜分析用較強模型',
  },

  /**
   * CODE: 改 code/write code/debug
   * Code 任務用 Kimi Code CLI，唔經呢度 routing
   */
  CODE: {
    primary: null,
    fallback: null,
    reason: 'Code 用 Kimi Code CLI，不經 model routing',
  },

  /**
   * BROWSER: 需要開 browser 上網
   * Browser 結果分析用 flash 夠
   */
  BROWSER: {
    primary: 'deepseek/deepseek-v4-flash',
    fallback: null,
    reason: 'Browser 結果分析用 flash 夠',
  },

  /**
   * NONE: 一般對話、閒聊
   * Default flash
   */
  NONE: {
    primary: 'deepseek/deepseek-v4-flash',
    fallback: null,
    reason: 'Default route',
  },

  /**
   * SPAWN: Spawn sub-agent
   * 預設 MiniMax sub-agent
   */
  SPAWN: {
    primary: 'minimax-portal/MiniMax-M2.7',
    fallback: 'deepseek/deepseek-v4-flash',
    reason: 'Sub-agent 預設用 MiniMax',
  },
};

/**
 * Get model configuration for a given route.
 *
 * @param {string} route - Route label (FDQ, DIRECT_ANSWER, SOP, etc.)
 * @returns {ModelConfig} Model configuration with primary, fallback, reason
 */
function getModelForRoute(route) {
  if (!route || typeof route !== 'string') {
    return ROUTE_MODEL_MAP.NONE;
  }

  const config = ROUTE_MODEL_MAP[route.toUpperCase().trim()];

  if (!config) {
    // Unknown route → default to NONE config
    return ROUTE_MODEL_MAP.NONE;
  }

  return config;
}

/**
 * Get just the primary model for a route (convenience helper).
 *
 * @param {string} route
 * @returns {string|null} Primary model name, or null if skip routing
 */
function getPrimaryModel(route) {
  return getModelForRoute(route).primary;
}

/**
 * Get routing advice as a human-readable string.
 *
 * @param {string} route
 * @returns {string}
 */
function getRoutingAdvice(route) {
  const modelConfig = getModelForRoute(route);

  if (!modelConfig.primary) {
    return `[ModelRouter] Route '${route}' uses external handler (CODE → Kimi Code CLI)`;
  }

  let advice = `[ModelRouter] Route '${route}' → Primary: ${modelConfig.primary}`;
  if (modelConfig.fallback) {
    advice += ` | Fallback: ${modelConfig.fallback}`;
  }
  advice += ` (${modelConfig.reason})`;

  return advice;
}

module.exports = {
  ROUTE_MODEL_MAP,
  getModelForRoute,
  getPrimaryModel,
  getRoutingAdvice,
};
