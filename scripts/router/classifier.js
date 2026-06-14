/**
 * Router Classifier — Phase 2 (Regex-only)
 *
 * Fast regex-based classification (~1ms).
 * LLM slow path removed (77% timeout rate, non-blocking but useless).
 *
 * Flow:
 *   1. Regex match (~1ms) → return immediately
 *   2. Regex miss → NONE（一般對話，Ally 用 judgment）
 *
 * Usage:
 *   const { classifySync } = require('./router/classifier');
 *   const result = classifySync("幫我分析下呢個 report");
 *   // { route: 'SPAWN', matched: true, rule: 'AGENTS.md Rule 4' }
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { maybeRotate } = require('./log_rotator');
// Day 4 integration: enrich route decisions with provider/model config (fail-safe)
const { routeModel } = require('./model_router');

/**
 * @typedef {Object} ClassifyResult
 * @property {string} route - Route label
 * @property {boolean} matched - Whether a rule was matched
 * @property {string} rule - Rule identifier
 */

/**
 * @typedef {Object} Rule
 * @property {string} route - Route to assign
 * @property {RegExp} pattern - Regex pattern
 * @property {string} ruleId - Human-readable rule ID
 */

/** @type {Rule[]} */
const RULES = [
  // FDQ — 模糊、唔明確、需要問清楚
  {
    route: 'FDQ',
    pattern: /(?:唔知|模糊|諗下|你覺得點|搞個|整個|你點睇|有咩建議|諗諗)/i,
    ruleId: 'AGENTS.md Rule 1',
  },
  // SOP — 標準流程（放 DIRECT_ANSWER 前面避免 URL match 到 status keyword）
  // Word boundaries (\b) on English terms prevent partial matches like 'fast forward' → forward
  {
    route: 'SOP',
    pattern: /(?:x\.com|twitter\.com|\bemail\b|\bmail\b|X link|轉寄|\bforward\b|\bcompose\b|send\s+.*?\bemail\b|\bemail\b\s+.*?send)/i,
    ruleId: 'AGENTS.md Rule 3',
  },
  // DIAGNOSTIC_CHECK — 檢查 + system/diagnostic context → SPAWN (priority over DIRECT_ANSWER)
  // Catches: 檢查/驗證/診斷/audit + (router/系統/gateway/功能/健康/狀態/正常運作/...)
  // Uses lookahead to require BOTH conditions before matching
  {
    route: 'SPAWN',
    pattern: /^(?=.*(?:檢查|驗證|診斷|\baudit\b|深入檢查|trace))(?=.*(?:router|system|系統|gateway|功能|cron|log|sync|健康|health|狀態|運作|smart|router|HA|cluster|heartbeat|fallback|provider|model))/i,
    ruleId: 'Diagnostic Check → SPAWN (priority)',
  },
  // DIRECT_ANSWER — Yes/No/Status 查詢
  {
    route: 'DIRECT_ANSWER',
    pattern: /(?:有冇|係唔係|會唔會|邊度|幾時|咩\bstatus\b|\bstatus\b|可唔可以|今日|聽日|尋日|而家|正常|運作)/i,
    ruleId: 'AGENTS.md Rule 2',
  },
  // SPAWN — 需要探索/research/分析/評估
  // Word boundaries prevent partial matches like 'researcher' → research, 'checkbox' → check
  {
    route: 'SPAWN',
    pattern: /(?:\bresearch\b|分析|研究|深入|\bexplore\b|\bspawn\b|比較|方案|\breport\b|報告|\bcheck\b|檢查|跟進|調查|\breview\b|評估|討論|設計|架構|流程|可行性|\bsuggestion\b)/i,
    ruleId: 'AGENTS.md Rule 4',
  },
  // CODE — 改 code
  // Word boundaries prevent partial matches like 'decode' → code, 'postcode' → code
  {
    route: 'CODE',
    pattern: /(?:改|修|寫|\bimplement\b|\brefactor\b|代碼|\bcode\b|\bdebug\b|\bfix\b|\bbug\b|\brevise\b|\bupdate\b|改動|修復|錯誤|\berror\b)/i,
    ruleId: 'AGENTS.md Rule 5',
  },
  // BROWSER — 需要開 browser
  {
    route: 'BROWSER',
    pattern: /(?:上網|睇下|\bbrowser\b|\bweb\b|網站|網頁|打開.*link|開.*網|瀏覽)/i,
    ruleId: 'AGENTS.md Rule 6',
  },
];

/** @type {string} */
const DEFAULT_ROUTE = 'NONE';
const MAX_INPUT_LENGTH = 10_000; // 10KB — reject oversized inputs to prevent ReDoS/performance issues

/**
 * Regex-based classification (~1ms).
 * @param {string} text
 * @returns {ClassifyResult}
 */
function regexClassify(text) {
  if (!text || typeof text !== 'string') {
    return { route: DEFAULT_ROUTE, matched: false, rule: 'invalid_input' };
  }
  if (text.length > MAX_INPUT_LENGTH) {
    return { route: DEFAULT_ROUTE, matched: false, rule: 'input_too_long' };
  }

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { route: rule.route, matched: true, rule: rule.ruleId };
    }
  }

  return { route: DEFAULT_ROUTE, matched: false, rule: 'AGENTS.md Rule 7 (catch-all)' };
}

/**
 * Classify a message text — sync, ~1ms.
 * Replaces the old async classify() which had LLM slow path.
 * Always returns immediately — no blocking, no API calls.
 */
function classifySync(text, channel = '') {
  const result = regexClassify(text);
  logDecision(result, text, { channel });
  // Day 4: best-effort provider/model enrichment (fail-safe, non-blocking)
  try {
    const p = routeModel({ text, route: String(result.route).toLowerCase(), context: { channel } });
    if (p && typeof p.then === 'function') {
      p.then((cfg) => {
        if (cfg && cfg.provider) {
          result.provider = cfg.provider;
          result.model = cfg.model;
        }
      }).catch((err) => {
        console.warn('[classifier] routeModel() failed (fail-safe):', err.message);
      });
    }
  } catch (err) {
    console.warn('[classifier] routeModel() sync fail (fail-safe):', err.message);
  }
  return result;
}

/**
 * Log a routing decision to a JSON Lines file.
 * Uses async I/O deferred via nextTick to avoid blocking the classifier sync path.
 */
function logDecision(result, text, metadata = {}) {
  const entry = {
    ts: new Date().toISOString(),
    route: result.route,
    matched: result.matched,
    rule: result.rule,
    textPreview: text ? String(text).substring(0, 100) : '',
    ...metadata,
  };

  const line = JSON.stringify(entry) + '\n';
  // Defer to next tick so classifySync returns immediately (~1ms guarantee)
  process.nextTick(() => {
    maybeRotate(config.decisionLogPath, 10, 5);
    fs.appendFile(config.decisionLogPath, line, 'utf8', (err) => {
      if (err) console.error('[router] Failed to write decision log:', err.message);
    });
  });
}

module.exports = {
  classifySync,
  logDecision,
  regexClassify,
  RULES,
  DEFAULT_ROUTE,
};
