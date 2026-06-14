/**
 * scripts/lib/analyzers/file-analyzer.js
 *
 * 檔案分析器
 *
 * 從 auto_fix.js 拆分出來的核心分析邏輯
 *
 * 原 Lines：
 *   - FILE_CACHE, getFileContent: Lines 49-79
 *   - analyzeFile(): Lines ~1630-1680
 *   - autoFixFile(): Lines ~1683-1720
 *
 * 依賴：
 *   - ../rules (LOW_RISK_RULES, HIGH_RISK_RULES)
 *   - ../helpers/skip-list (isSkipped)
 */

const fs = require('fs');
const path = require('path');

// File size limit: 100KB (used to skip large files in analysis)
const CONFIG = {
  MAX_FILE_SIZE_BYTES: 100000,
};

// 動態引入 rules
let rules = null;
function getRules() {
  if (!rules) {
    try {
      rules = require('../rules');
    } catch {
      // Fallback - caller should have loaded rules first
      return { LOW_RISK_RULES: [], HIGH_RISK_RULES: [] };
    }
  }
  return rules;
}

// 動態引入 skip list
let skipList = null;
function getSkipListHelpers() {
  if (!skipList) {
    try {
      skipList = require('../helpers/skip-list');
    } catch {
      skipList = {};
    }
  }
  return skipList;
}

// 嘗試引入 config
let WS;
try {
  ({ WS } = require('../config'));
} catch {
  WS = process.env.WS || path.join(process.env.HOME, '.openclaw/workspace');
}

// ==================== FILE CACHE ====================

/**
 * FILE_CACHE - 檔案內容緩存
 * 避免同一檔案被重複讀取
 */
const FILE_CACHE = new Map();

/**
 * 獲取檔案內容（使用 Cache）
 *
 * @param {string} filePath - 檔案路徑
 * @returns {Object} - { mtime, content, lines, size }
 */
function getFileContent(filePath) {
  if (FILE_CACHE.has(filePath)) {
    return FILE_CACHE.get(filePath);
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = fs.statSync(filePath);
    const cached = {
      mtime: stats.mtimeMs,
      content,
      lines: content.split('\n'),
      size: stats.size,
    };
    FILE_CACHE.set(filePath, cached);
    return cached;
  } catch (e) {
    return { mtime: 0, content: '', lines: [], size: 0 };
  }
}

// ==================== ANALYZE FILE ====================

/**
 * 分析單個檔案
 *
 * 原 Lines ~1630-1680
 *
 * @param {string} filePath - 檔案路徑
 * @returns {Object} - { file, lowRisk[], highRisk[] }
 */
function analyzeFile(filePath) {
  const { LOW_RISK_RULES, HIGH_RISK_RULES } = getRules();
  const { isSkipped } = getSkipListHelpers();

  const result = {
    file: path.relative(WS, filePath),
    lowRisk: [],
    highRisk: [],
  };

  const { content } = getFileContent(filePath);
  if (!content) {
    result.highRisk.push({
      rule: 'read-error',
      name: '無法讀取檔案',
      details: 'getFileContent returned empty content',
      severity: 'high',
    });
    return result;
  }

  // 跳過超大檔案 (> 100KB)
  if (content.length > CONFIG.MAX_FILE_SIZE_BYTES) {
    result.highRisk.push({
      rule: 'file-too-large',
      name: '檔案過大',
      details: `${(content.length / 1024).toFixed(0)}KB - 跳過詳細分析`,
      severity: 'medium',
      suggestion: '考慮拆分檔案',
    });
    return result;
  }

  // Low-risk 檢測
  for (const rule of LOW_RISK_RULES) {
    try {
      const detection = rule.detect(content, filePath);
      if (detection.found) {
        result.lowRisk.push({
          rule: rule.id,
          name: rule.name,
          category: rule.category,
          details: detection.details,
          lines: detection.lines,
        });
      }
    } catch { /* ignore */ }
  }

  // High-risk 檢測
  for (const rule of HIGH_RISK_RULES) {
    try {
      const detection = rule.detect(content, filePath);
      if (detection.found) {
        result.highRisk.push({
          rule: rule.id,
          name: rule.name,
          category: detection.category || rule.category,
          details: detection.details,
          lines: detection.lines,
          severity: detection.severity,
          suggestion: detection.suggestion,
        });
      }
    } catch { /* ignore */ }
  }

  // 過濾 Skip List 中的 false positives
  result.highRisk = result.highRisk.filter(issue => {
    if (isSkipped?.(issue, result.file)) {
      return false;
    }
    return true;
  });

  return result;
}

// ==================== AUTO FIX ====================

/**
 * 自動修復 low-risk 問題
 *
 * 原 Lines ~1683-1720
 *
 * @param {string} filePath - 檔案路徑
 * @param {Object[]} issues - lowRisk 問題陣列
 * @param {Object} options - 選項 { isDryRun }
 * @returns {Object} - { fixed, details, changed }
 */
function autoFixFile(filePath, issues, options = {}) {
  const { isDryRun = false } = options;

  if (issues.length === 0) return { fixed: 0, details: [], changed: false };

  const { LOW_RISK_RULES } = getRules();

  const { content: originalContent } = getFileContent(filePath);
  if (!originalContent) {
    return { fixed: 0, details: ['無法讀取檔案'], changed: false };
  }

  let content = originalContent;
  const fixedDetails = [];

  for (const issue of issues) {
    const rule = LOW_RISK_RULES.find(r => r.id === issue.rule);
    if (!rule || !rule.fix) continue;

    try {
      const newContent = rule.fix(content, filePath);
      if (newContent && newContent !== content) {
        content = newContent;
        fixedDetails.push(`✅ ${rule.name}`);
      }
    } catch (e) {
      fixedDetails.push(`❌ ${rule.name}: ${e.message}`);
    }
  }

  // 只在有改動且非 dry-run 時寫入
  if (content !== originalContent && !isDryRun) {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch (e) {
      return { fixed: 0, details: [`❌ 無法寫入: ${e.message}`], changed: false };
    }
  }

  return {
    fixed: fixedDetails.filter(d => d.startsWith('✅')).length,
    details: fixedDetails,
    changed: content !== originalContent,
  };
}

module.exports = {
  FILE_CACHE,
  getFileContent,
  analyzeFile,
  autoFixFile,
};
