/**
 * scripts/lib/helpers/index.js
 *
 * Helper 模組統一出口
 */

const tryCatchHelpersAST = require('./try-catch-helpers-ast');
const tryCatchHelpers = require('./try-catch-helpers');
const ruleHelpers = require('./rule-helpers');
const skipList = require('./skip-list');
const fileCache = require('./file-cache');

// Context-aware audit helpers (新增)
let contextHelpers = null;
try {
  contextHelpers = require('./context_helpers');
} catch { /* optional dependency */ }

// Whitelist patterns (新增)
let whitelistPatterns = null;
try {
  whitelistPatterns = require('./whitelist_patterns');
} catch { /* optional dependency */ }

// 使用新的 AST 版本作為主要實現
const isProtectedByTryNew = tryCatchHelpersAST.isProtectedByTry;

module.exports = {
  // try-catch helpers (新 AST 版本 + 舊版兼容)
  isProtectedByTry: isProtectedByTryNew,
  isProtectedByFunctionLevelTry: tryCatchHelpersAST.isProtectedByFunctionLevelTry,
  isProtectedByGlobalTry: tryCatchHelpers.isProtectedByGlobalTry,
  isPureFunction: tryCatchHelpers.isPureFunction,
  isProtectedByPromise: tryCatchHelpers.isProtectedByPromise,
  hasAtomicWriteHelper: tryCatchHelpers.hasAtomicWriteHelper,

  // rule helpers
  getSimplifiedMap: ruleHelpers.getSimplifiedMap,

  // skip list
  loadSkipList: skipList.loadSkipList,
  saveSkipList: skipList.saveSkipList,
  markFalsePositive: skipList.markFalsePositive,
  isSkipped: skipList.isSkipped,
  showSkipList: skipList.showSkipList,
  handleSkipCommand: skipList.handleSkipCommand,

  // file cache
  FILE_CACHE: fileCache.FILE_CACHE,
  getFileContent: fileCache.getFileContent,

  // context-aware helpers (新增)
  ...(contextHelpers || {}),

  // whitelist patterns (新增)
  whitelist: whitelistPatterns,
};
