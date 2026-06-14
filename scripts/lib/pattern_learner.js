/**
 * pattern_learner.js - Self-Learning Pattern Store
 *
 * Learns from Batch Verification results to automatically
 * whitelist false positive patterns and track true positive patterns.
 *
 * Created: 2026-04-06
 */

const fs = require('fs');
const path = require('path');

// ==================== 配置常量 ====================
const PL_CONFIG = {
  VERSION: '1.0.0',

  // 數據目錄 (從 scripts/lib/ 到 workspace/memory/patterns/)
  DATA_DIR: path.join(__dirname, '..', '..', 'memory', 'patterns'),

  // 白名單文件
  FP_WHITELIST_FILE: 'fp_whitelist.json',
  TP_TRACKER_FILE: 'tp_tracker.json',
  SEMANTIC_WHITELIST_FILE: 'semantic_whitelist.json',

  // 置信度閾值
  FP_CONF_THRESHOLD: 0.85,    // >85% confidence = high confidence FP
  TP_CONF_THRESHOLD: 0.85,    // >85% confidence = high confidence TP

  // 最小樣本數
  MIN_SAMPLES_FOR_AUTO_LEARN: 3
};

// ==================== PatternLearner 類別 ====================
class PatternLearner {
  constructor(options = {}) {
    this.options = { ...PL_CONFIG, ...options };
    this._fpWhitelist = null;
    this._tpTracker = null;
  }

  // ==================== 核心學習方法 ====================

  /**
   * learn - 從 Batch Verification 結果學習
   *
   * @param {Object} verificationResults - BatchVerifier 的驗證結果
   * @returns {Object} - 學習結果摘要
   */
  learn(verificationResults) {
    if (!verificationResults) {
      return { learned: 0, error: 'No verification results provided' };
    }

    const { rejected = [], verified = [], needsReview = [] } = verificationResults;

    const results = {
      fpLearned: 0,    // 新學習的 FP patterns
      tpLearned: 0,   // 新學習的 TP patterns
      updated: 0,      // 更新的 patterns
      skipped: 0,      // 跳過的（樣本不足等）
      total: 0
    };

    // 處理 False Positives (rejected)
    for (const issue of rejected) {
      const result = this._learnFpPattern(issue);
      if (result.status === 'learned') results.fpLearned++;
      else if (result.status === 'updated') results.updated++;
      else if (result.status === 'skipped') results.skipped++;
      results.total++;
    }

    // 處理 True Positives (verified)
    for (const issue of verified) {
      const result = this._learnTpPattern(issue);
      if (result.status === 'learned') results.tpLearned++;
      else if (result.status === 'updated') results.updated++;
      else if (result.status === 'skipped') results.skipped++;
      results.total++;
    }

    // 保存結果
    if (results.fpLearned > 0 || results.tpLearned > 0) {
      this.save();
    }

    // ==================== Phase 2: Learn Semantic Patterns ====================
    // 當有多個相似的 false positives 時，學習 semantic pattern
    if (rejected.length >= 2) {
      const semanticResult = this._learnSemanticPatterns(rejected);
      if (semanticResult.learned > 0) {
        results.semanticLearned = semanticResult.learned;
        results.semanticPatterns = semanticResult.patterns;
      }
    }

    return results;
  }

  /**
   * _learnSemanticPatterns - 從多個相似 issues 學習 semantic pattern
   *
   * @param {Array} issues - 相似 issues 據組
   * @returns {Object} - 學習結果
   */
  _learnSemanticPatterns(issues) {
    if (!issues || issues.length < 2) {
      return { learned: 0, patterns: [] };
    }

    const results = {
      learned: 0,
      patterns: []
    };

    // 按 rule 分組
    const byRule = {};
    for (const issue of issues) {
      const rule = issue.rule || 'unknown';
      if (!byRule[rule]) byRule[rule] = [];
      byRule[rule].push(issue);
    }

    // 對每個 rule 組嘗試學習 semantic pattern
    for (const [rule, ruleIssues] of Object.entries(byRule)) {
      if (ruleIssues.length < 2) continue;

      // 分析 reasoning 來推斷 semantic pattern 類型
      const semanticPattern = this._inferSemanticPattern(ruleIssues, rule);

      if (semanticPattern) {
        // 檢查是否已存在相似的 semantic pattern
        const existing = this._findSimilarSemanticPattern(semanticPattern);

        if (!existing) {
          this._addSemanticPattern(semanticPattern);
          results.learned++;
          results.patterns.push(semanticPattern.name);
        }
      }
    }

    return results;
  }

  /**
   * _inferSemanticPattern - 推斷 semantic pattern
   */
  _inferSemanticPattern(issues, rule) {
    // 收集所有 reasoning
    const reasonings = issues.map(i => i.reasoning || '').join(' ').toLowerCase();

    // 根據 reasoning 推斷 pattern 類型
    if (reasonings.includes('日期') || reasonings.includes('年份') || reasonings.includes('date') || reasonings.includes('2026')) {
      return {
        type: 'semantic',
        name: `comment_date_year_${rule}`,
        rule: rule,
        matcher: {
          context: 'comment',
          pattern: '(20\\d{2})',
          explanation: 'Year numbers (20xx) in comments are documentation dates'
        },
        confidence: 0.95,
        auto_apply: true,
        examples: issues.slice(0, 3).map(i => ({
          file: i.file,
          line: i.line,
          reasoning: i.reasoning
        })),
        learned_at: new Date().toISOString().split('T')[0],
        source: 'inferred'
      };
    }

    if (reasonings.includes('行號') || reasonings.includes('lines') || reasonings.includes('原 lines')) {
      return {
        type: 'semantic',
        name: `comment_line_ref_${rule}`,
        rule: rule,
        matcher: {
          context: 'comment',
          pattern: '(\\d{3,5})',
          lookbehind: '原\\s*Lines?|Lines?',
          explanation: 'Numbers in line reference comments are code references, not values'
        },
        confidence: 0.99,
        auto_apply: true,
        examples: issues.slice(0, 3).map(i => ({
          file: i.file,
          line: i.line,
          reasoning: i.reasoning
        })),
        learned_at: new Date().toISOString().split('T')[0],
        source: 'inferred'
      };
    }

    if (reasonings.includes('timeout') || reasonings.includes('超時') || reasonings.includes('秒')) {
      return {
        type: 'semantic',
        name: `standard_timeout_${rule}`,
        rule: rule,
        matcher: {
          context: 'code',
          pattern: '\\b(5000|10000|15000|30000|60000)\\b',
          lookbehind: 'timeout|delay|interval',
          explanation: 'Standard timeout values in milliseconds'
        },
        confidence: 0.90,
        auto_apply: true,
        examples: issues.slice(0, 3).map(i => ({
          file: i.file,
          line: i.line,
          reasoning: i.reasoning
        })),
        learned_at: new Date().toISOString().split('T')[0],
        source: 'inferred'
      };
    }

    if (reasonings.includes('版本') || reasonings.includes('version') || reasonings.includes('ecma')) {
      return {
        type: 'semantic',
        name: `ecmascript_version_${rule}`,
        rule: rule,
        matcher: {
          context: 'code',
          pattern: '\\becma(?:ma)?Version[:\\s]*(\\d{4})',
          explanation: 'ECMAScript version numbers in parser configuration'
        },
        confidence: 0.95,
        auto_apply: true,
        examples: issues.slice(0, 3).map(i => ({
          file: i.file,
          line: i.line,
          reasoning: i.reasoning
        })),
        learned_at: new Date().toISOString().split('T')[0],
        source: 'inferred'
      };
    }

    return null;
  }

  /**
   * _findSimilarSemanticPattern - 查找相似的 semantic pattern
   */
  _findSimilarSemanticPattern(pattern) {
    const semantic = this._loadSemanticWhitelist();

    return semantic.find(p =>
      p.type === 'semantic' &&
      p.name === pattern.name &&
      p.rule === pattern.rule
    );
  }

  /**
   * _addSemanticPattern - 添加 semantic pattern
   */
  _addSemanticPattern(pattern) {
    const filePath = path.join(this.options.DATA_DIR, this.options.SEMANTIC_WHITELIST_FILE);

    let semantic;
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        semantic = JSON.parse(content);
      }
    } catch (err) {
      semantic = { patterns: [], stats: {} };
    }

    if (!semantic.patterns) semantic.patterns = [];

    semantic.patterns.push(pattern);
    semantic.stats = {
      total_patterns: semantic.patterns.length,
      last_updated: new Date().toISOString().split('T')[0]
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(semantic, null, 2), 'utf8');
      console.log(`[PatternLearner] Semantic pattern added: ${pattern.name}`);
    } catch (err) {
      console.error(`[PatternLearner] Failed to save semantic pattern: ${err.message}`);
    }
  }

  /**
   * _loadSemanticWhitelist - 加載 semantic whitelist
   */
  _loadSemanticWhitelist() {
    const filePath = path.join(this.options.DATA_DIR, this.options.SEMANTIC_WHITELIST_FILE);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        return data.patterns || [];
      }
    } catch (err) {
      console.error(`[PatternLearner] Failed to load semantic whitelist: ${err.message}`);
    }

    return [];
  }

  /**
   * learnFromFeedback - 從用戶反饋學習
   *
   * @param {string} issueId - Issue ID
   * @param {boolean} isTruePositive - true=用戶確認是 TP, false=用戶確認是 FP
   * @param {Object} context - 額外與下文（file, line, rule 等）
   * @returns {Object} - 學習結果
   */
  learnFromFeedback(issueId, isTruePositive, context = {}) {
    if (isTruePositive) {
      return this._learnTpFromFeedback(issueId, context);
    } else {
      return this._learnFpFromFeedback(issueId, context);
    }
  }

  // ==================== Pattern 獲取方法 ====================

  /**
   * getPatterns - 獲取已學習的 patterns
   *
   * @returns {Object} - { fp_patterns: [...], tp_patterns: [...] }
   */
  getPatterns() {
    const fp = this._loadFpWhitelist();
    const tp = this._loadTpTracker();

    return {
      fp_patterns: fp.patterns || [],
      tp_patterns: tp.patterns || []
    };
  }

  /**
   * getWhitelist - 獲取 FP 白名單（用於 scanner）
   *
   * @returns {string[]} - 正則表達式字符串據組
   */
  getWhitelist() {
    const fp = this._loadFpWhitelist();
    return (fp.patterns || [])
      .filter(p => p.confidence >= this.options.FP_CONF_THRESHOLD * 100)
      .map(p => p.pattern);
  }

  // ==================== Scanner 整合方法 ====================

  /**
   * updateScannerRules - 更新 scanner rules（白名單）
   *
   * 生成可以被 LocalScanner/AIScanner 使用的白名單
   * 包括 file:line patterns 和 semantic patterns
   */
  updateScannerRules() {
    const whitelist = this.getWhitelist();
    const fpData = this._loadFpWhitelist();
    const semanticPatterns = this._loadSemanticWhitelist();

    // 過濾自動應用的 semantic patterns
    const autoApplySemantic = semanticPatterns
      .filter(p => p.auto_apply && p.confidence >= 0.85)
      .map(p => ({
        name: p.name,
        type: 'semantic',
        rule: p.rule,
        pattern: p.matcher?.pattern || '',
        fullPattern: p.matcher?.fullPattern || null,
        lookbehind: p.matcher?.lookbehind || null,
        lookahead: p.matcher?.lookahead || null,
        context: p.matcher?.context || 'any',
        explanation: p.matcher?.explanation || ''
      }));

    // 生成 whitelist_patterns.js 供 scanner 使用
    const content = `/**
 * whitelist_patterns.js - False Positive Whitelist
 * AUTO-GENERATED by PatternLearner
 * DO NOT EDIT MANUALLY
 *
 * Generated: ${new Date().toISOString()}
 * File:Line patterns: ${whitelist.length}
 * Semantic patterns: ${autoApplySemantic.length}
 */

module.exports = {
  VERSION: '${PL_CONFIG.VERSION}',
  generatedAt: '${new Date().toISOString()}',

  // ==================== File:Line Patterns ====================
  // False Positive patterns (regex strings)
  // Each pattern is a string that will be used to match against
  // {file}:{line}:{rule} format
  patterns: ${JSON.stringify(whitelist, null, 2)},

  // Pattern details (for debugging)
  details: ${JSON.stringify(fpData.patterns || [], null, 2)},

  // ==================== Semantic Patterns (Phase 2) ====================
  // Cross-file semantic patterns for automatic FP detection
  semanticPatterns: ${JSON.stringify(autoApplySemantic, null, 2)},

  // Semantic pattern count
  semanticCount: ${autoApplySemantic.length},

  // Total count
  count: ${whitelist.length + autoApplySemantic.length}
};

// ==================== Semantic Pattern Matching Functions ====================
// Phase 2: Semantic Pattern Learning for cross-file FP detection

/**
 * isFalsePositive - 檢查 issue 是否為 false positive
 * 支援 file:line 匹配和 semantic pattern 匹配
 *
 * @param {Object} issue - { file, line, rule, code, lineContent }
 * @param {Object} options - { useSemantic: true/false }
 * @returns {Object} - { isFP, reason, matchedPattern, method }
 */
function isFalsePositive(issue, options = {}) {
  const { useSemantic = true } = options;

  // 1. 檢查 file:line whitelist
  if (isFileLineWhitelisted(issue)) {
    return { isFP: true, reason: 'matched_file_line_pattern', method: 'file:line' };
  }

  // 2. 檢查 semantic patterns
  if (useSemantic) {
    const semanticMatch = matchSemanticPattern(issue);
    if (semanticMatch.matched) {
      return {
        isFP: true,
        reason: semanticMatch.pattern.explanation,
        matchedPattern: semanticMatch.pattern.name,
        method: 'semantic'
      };
    }
  }

  return { isFP: false };
}

/**
 * isFileLineWhitelisted - 檢查 file:line 是否在白名單
 */
function isFileLineWhitelisted(issue) {
  const whitelist = module.exports.patterns;
  const pattern = issue.file + ':L' + issue.line + ':' + issue.rule;

  return whitelist.some(p => {
    // 精確匹配
    if (p === pattern) return true;
    // 帶關鍵詞匹配
    if (p.includes(issue.file + ':L' + issue.line + ':')) return true;
    return false;
  });
}

/**
 * matchSemanticPattern - 匹配 semantic pattern
 */
function matchSemanticPattern(issue) {
  const semanticPatterns = module.exports.semanticPatterns || [];

  if (!semanticPatterns || semanticPatterns.length === 0) {
    return { matched: false };
  }

  const lineContent = issue.code || issue.lineContent || '';
  const rule = issue.rule;

  for (const sp of semanticPatterns) {
    // 檢查 rule 匹配
    if (sp.rule && sp.rule !== rule) continue;

    // 根據 context 匹配
    if (sp.context === 'comment') {
      if (!isCommentLine(lineContent)) continue;
      if (matchSemantic(sp, lineContent)) {
        return { matched: true, pattern: sp };
      }
    } else if (sp.context === 'code') {
      if (isCommentLine(lineContent)) continue;
      if (matchSemantic(sp, lineContent)) {
        return { matched: true, pattern: sp };
      }
    } else {
      // any context
      if (matchSemantic(sp, lineContent)) {
        return { matched: true, pattern: sp };
      }
    }
  }

  return { matched: false };
}

/**
 * isCommentLine - 檢查是否為註釋行
 */
function isCommentLine(lineContent) {
  const trimmed = lineContent.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('#')
  );
}

/**
 * matchSemantic - 匹配 semantic pattern
 */
function matchSemantic(sp, content) {
  // 如果有 fullPattern，直接使用
  if (sp.fullPattern) {
    try {
      const regex = new RegExp(sp.fullPattern, 'g');
      return regex.test(content);
    } catch {
      return false;
    }
  }

  // 否則使用 pattern + lookbehind/lookahead
  try {
    let fullPattern = sp.pattern || '';
    if (sp.lookbehind) {
      fullPattern = '(?<=' + sp.lookbehind + ')' + fullPattern;
    }
    if (sp.lookahead) {
      fullPattern = fullPattern + '(?=' + sp.lookahead + ')';
    }
    const regex = new RegExp(fullPattern, 'g');
    return regex.test(content);
  } catch {
    return false;
  }
}

/**
 * filterFalsePositives - 批量過濾 false positives
 *
 * @param {Array} issues - Issues 據組
 * @param {Object} options - { useSemantic: true }
 * @returns {Object} - { falsePositives: [], truePositives: [] }
 */
function filterFalsePositives(issues, options = {}) {
  const falsePositives = [];
  const truePositives = [];

  for (const issue of issues) {
    const result = isFalsePositive(issue, options);
    if (result.isFP) {
      falsePositives.push({ issue, ...result });
    } else {
      truePositives.push(issue);
    }
  }

  return { falsePositives, truePositives };
}

// Export matching functions
module.exports.isFalsePositive = isFalsePositive;
module.exports.isFileLineWhitelisted = isFileLineWhitelisted;
module.exports.matchSemanticPattern = matchSemanticPattern;
module.exports.filterFalsePositives = filterFalsePositives;
module.exports.isCommentLine = isCommentLine;
`;

    const outputPath = path.join(__dirname, 'whitelist_patterns.js');
    try {
      fs.writeFileSync(outputPath, content, 'utf8');
      console.log(`✅ Scanner whitelist updated: ${outputPath}`);
      console.log(`   - File:Line patterns: ${whitelist.length}`);
      console.log(`   - Semantic patterns: ${autoApplySemantic.length}`);
      return { success: true, file: outputPath, count: whitelist.length, semanticCount: autoApplySemantic.length };
    } catch (err) {
      console.error(`❌ Failed to update scanner rules: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ==================== 私有方法 ====================

  /**
   * _learnFpPattern - 學習 FP pattern
   */
  _learnFpPattern(issue) {
    if (!issue || !issue.rule) {
      return { status: 'skipped', reason: 'Invalid issue' };
    }

    const fp = this._loadFpWhitelist();
    const today = new Date().toISOString().split('T')[0];

    // 構建 pattern key
    const patternKey = this._buildPatternKey(issue);

    // 檢查是否已存在
    const existing = fp.patterns.find(p => p.pattern_key === patternKey);

    if (existing) {
      // 更新置信度和樣本
      existing.count = (existing.count || 1) + 1;
      existing.last_seen = today;
      // 先 decay 5% 再 +5%，防止長期通脹。穩定點約 95-100
      existing.confidence = Math.min(100, Math.max(50, existing.confidence * 0.95) + 5);
      existing.examples.push({
        file: issue.file,
        line: issue.line,
        reasoning: issue.reasoning || '',
        learned_at: today
      });

      return { status: 'updated', pattern: existing };
    }

    // 新增 pattern
    const newPattern = {
      id: `fp_${issue.rule}_${Date.now()}`,
      pattern_key: patternKey,
      pattern: this._extractPattern(issue),
      rule: issue.rule,
      learned_at: today,
      last_seen: today,
      confidence: issue.confidence ? Math.round(issue.confidence * 100) : 70,
      count: 1,
      source: issue.source || 'batch_verification',
      examples: [{
        file: issue.file,
        line: issue.line,
        reasoning: issue.reasoning || '',
        learned_at: today
      }]
    };

    fp.patterns.push(newPattern);
    fp.stats.total_learned = (fp.stats.total_learned || 0) + 1;
    fp.stats.last_updated = today;

    return { status: 'learned', pattern: newPattern };
  }

  /**
   * _learnTpPattern - 學習 TP pattern
   */
  _learnTpPattern(issue) {
    if (!issue || !issue.rule) {
      return { status: 'skipped', reason: 'Invalid issue' };
    }

    const tp = this._loadTpTracker();
    const today = new Date().toISOString().split('T')[0];

    // 按 rule 分組跟踪
    const ruleGroup = tp.by_rule || {};
    if (!ruleGroup[issue.rule]) {
      ruleGroup[issue.rule] = { patterns: [], stats: { total: 0 } };
    }

    // 記錄 pattern
    const newPattern = {
      id: `tp_${issue.rule}_${Date.now()}`,
      file: issue.file,
      line: issue.line,
      rule: issue.rule,
      message: issue.message || issue.title || '',
      learned_at: today,
      confidence: issue.confidence ? Math.round(issue.confidence * 100) : 80,
      reasoning: issue.reasoning || '',
      source: issue.source || 'batch_verification'
    };

    ruleGroup[issue.rule].patterns.push(newPattern);
    ruleGroup[issue.rule].stats.total++;

    tp.stats = tp.stats || { total_learned: 0 };
    tp.stats.total_learned++;
    tp.stats.last_updated = today;
    tp.by_rule = ruleGroup;

    return { status: 'learned', pattern: newPattern };
  }

  /**
   * _learnFpFromFeedback - 從用戶反饋學習 FP
   */
  _learnFpFromFeedback(issueId, context) {
    const issue = {
      ...context,
      rule: context.rule || issueId,
      confidence: 1.0, // 用戶確認 = 100% confidence
      source: 'user_feedback'
    };

    return this._learnFpPattern(issue);
  }

  /**
   * _learnTpFromFeedback - 從用戶反饋學習 TP
   */
  _learnTpFromFeedback(issueId, context) {
    const issue = {
      ...context,
      rule: context.rule || issueId,
      confidence: 1.0,
      source: 'user_feedback'
    };

    return this._learnTpPattern(issue);
  }

  /**
   * _buildPatternKey - 構建 pattern key
   */
  _buildPatternKey(issue) {
    return `${issue.file}:${issue.line}:${issue.rule}`;
  }

  /**
   * _extractPattern - 從 issue 提取 pattern
   */
  _extractPattern(issue) {
    // 提取關鍵特徵作為 pattern
    const parts = [];

    if (issue.file) {
      parts.push(issue.file);
    }
    if (issue.line) {
      parts.push(`L${issue.line}`);
    }
    if (issue.rule) {
      parts.push(issue.rule);
    }
    if (issue.message) {
      // 提取關鍵詞
      const keywords = issue.message
        .match(/[a-zA-Z_]{3,}/g)
        ?.slice(0, 3)
        .join('_') || '';
      if (keywords) parts.push(keywords);
    }

    return parts.join(':');
  }

  /**
   * _loadFpWhitelist - 加載 FP 白名單
   */
  _loadFpWhitelist() {
    if (this._fpWhitelist) return this._fpWhitelist;

    const filePath = path.join(this.options.DATA_DIR, this.options.FP_WHITELIST_FILE);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        // Handle null or invalid content
        this._fpWhitelist = parsed && typeof parsed === 'object' ? parsed : { patterns: [], stats: { total_learned: 0 } };
      } else {
        this._fpWhitelist = { patterns: [], stats: { total_learned: 0 } };
      }
    } catch (err) {
      console.error(`⚠️ Failed to load FP whitelist: ${err.message}`);
      this._fpWhitelist = { patterns: [], stats: { total_learned: 0 } };
    }

    return this._fpWhitelist;
  }

  /**
   * _loadTpTracker - 加載 TP tracker
   */
  _loadTpTracker() {
    if (this._tpTracker) return this._tpTracker;

    const filePath = path.join(this.options.DATA_DIR, this.options.TP_TRACKER_FILE);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        // Handle null or invalid content
        this._tpTracker = parsed && typeof parsed === 'object' ? parsed : { patterns: [], by_rule: {}, stats: { total_learned: 0 } };
      } else {
        this._tpTracker = { patterns: [], by_rule: {}, stats: { total_learned: 0 } };
      }
    } catch (err) {
      console.error(`⚠️ Failed to load TP tracker: ${err.message}`);
      this._tpTracker = { patterns: [], by_rule: {}, stats: { total_learned: 0 } };
    }

    return this._tpTracker;
  }

  /**
   * save - 保存據據
   */
  save() {
    // 保存 FP whitelist
    const fpPath = path.join(this.options.DATA_DIR, this.options.FP_WHITELIST_FILE);
    try {
      const dir = path.dirname(fpPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fpPath, JSON.stringify(this._fpWhitelist, null, 2), 'utf8');
      console.log(`💾 FP whitelist saved: ${fpPath}`);
    } catch (err) {
      console.error(`❌ Failed to save FP whitelist: ${err.message}`);
    }

    // 保存 TP tracker
    const tpPath = path.join(this.options.DATA_DIR, this.options.TP_TRACKER_FILE);
    try {
      fs.writeFileSync(tpPath, JSON.stringify(this._tpTracker, null, 2), 'utf8');
      console.log(`💾 TP tracker saved: ${tpPath}`);
    } catch (err) {
      console.error(`❌ Failed to save TP tracker: ${err.message}`);
    }
  }

  /**
   * getStats - 獲取統計信息
   */
  getStats() {
    const fp = this._loadFpWhitelist();
    const tp = this._loadTpTracker();

    return {
      fp_whitelist: {
        total: fp.patterns?.length || 0,
        total_learned: fp.stats?.total_learned || 0,
        last_updated: fp.stats?.last_updated || null,
        high_confidence: fp.patterns?.filter(p => p.confidence >= 85).length || 0
      },
      tp_tracker: {
        total: Object.values(tp.by_rule || {}).reduce((sum, r) => sum + (r.patterns?.length || 0), 0),
        total_learned: tp.stats?.total_learned || 0,
        last_updated: tp.stats?.last_updated || null,
        by_rule: Object.keys(tp.by_rule || {}).length
      }
    };
  }
}

// ==================== Export ====================
module.exports = {
  PatternLearner,
  PL_CONFIG
};

// Run if called directly
if (require.main === module) {
  const learner = new PatternLearner();

  console.log('\n📊 Pattern Learner Stats:');
  console.log(JSON.stringify(learner.getStats(), null, 2));

  console.log('\n🔄 Updating scanner rules...');
  const result = learner.updateScannerRules();
  console.log(result);
}
