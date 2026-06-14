/**
 * semantic_matcher.js - Semantic Pattern Matcher
 *
 * Matches issues against semantic patterns instead of file:line specific patterns.
 * This enables cross-file false positive detection.
 *
 * Created: 2026-04-06
 * Phase 2: Semantic Pattern Learning
 */

const fs = require('fs');
const path = require('path');

// ==================== 配置常量 ====================
const SEMANTIC_CONFIG = {
  VERSION: '1.0.0',

  // 數據目錄
  DATA_DIR: path.join(__dirname, '..', '..', 'memory', 'patterns'),
  SEMANTIC_WHITELIST_FILE: 'semantic_whitelist.json',

  // 最小置信度閾值
  MIN_CONFIDENCE: 0.85,

  // 上下文窗口大小（用於 lookbehind/lookahead 匹配）
  CONTEXT_WINDOW: 50
};

// ==================== SemanticMatcher 類別 ====================
class SemanticMatcher {
  constructor(options = {}) {
    this.options = { ...SEMANTIC_CONFIG, ...options };
    this._semanticPatterns = null;
    this._initialized = false;
  }

  /**
   * initialize - 初始化，加載 semantic patterns
   */
  async initialize() {
    if (this._initialized) return;

    this._semanticPatterns = this._loadSemanticPatterns();
    this._initialized = true;

    console.log(`[SemanticMatcher] Initialized with ${this._semanticPatterns.length} patterns`);
  }

  /**
   * _loadSemanticPatterns - 加載 semantic patterns
   */
  _loadSemanticPatterns() {
    const filePath = path.join(this.options.DATA_DIR, this.options.SEMANTIC_WHITELIST_FILE);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        return data.patterns || [];
      }
    } catch (err) {
      console.error(`[SemanticMatcher] Failed to load semantic patterns: ${err.message}`);
    }

    return [];
  }

  /**
   * match - 匹配 issue 是否符合 semantic pattern
   *
   * @param {Object} issue - Issue 對像 { file, line, rule, code, context }
   * @returns {Object|null} - 匹配的 pattern 或 null
   */
  match(issue) {
    if (!this._initialized) {
      this._initializeSync();
    }

    if (!issue || !issue.rule) {
      return null;
    }

    // 獲取代碼行內容（用於上下文匹配）
    const lineContent = issue.code || issue.lineContent || '';
    const lineNumber = issue.line;

    for (const pattern of this._semanticPatterns) {
      // 檢查 rule 是否匹配
      if (pattern.rule && pattern.rule !== issue.rule) {
        continue;
      }

      // 檢查置信度
      if (pattern.confidence < this.options.MIN_CONFIDENCE && pattern.confidence < 0.85) {
        continue;
      }

      // 根據 context 類型進行匹配
      const matchResult = this._matchByContext(issue, pattern, lineContent);

      if (matchResult.matched) {
        return {
          ...pattern,
          matchDetails: matchResult,
          isFalsePositive: true,
          reason: pattern.matcher?.explanation || pattern.name
        };
      }
    }

    return null;
  }

  /**
   * _matchByContext - 根據上下文類型進行匹配
   */
  _matchByContext(issue, pattern, lineContent) {
    const matcher = pattern.matcher || {};
    const context = matcher.context || 'any';

    switch (context) {
      case 'comment':
        return this._matchCommentContext(issue, pattern, lineContent);

      case 'code':
        return this._matchCodeContext(issue, pattern, lineContent);

      case 'any':
      default:
        // 嘗試兩種上下文
        const commentResult = this._matchCommentContext(issue, pattern, lineContent);
        if (commentResult.matched) return commentResult;
        return this._matchCodeContext(issue, pattern, lineContent);
    }
  }

  /**
   * _matchCommentContext - 匹配註釋上下文
   */
  _matchCommentContext(issue, pattern, lineContent) {
    const matcher = pattern.matcher || {};
    const regexPattern = matcher.pattern || '';
    const lookbehind = matcher.lookbehind || '';
    const lookahead = matcher.lookahead || '';

    // 檢查是否為註釋行 - 如果不是註釋則不匹配
    const isComment = this._isCommentLine(lineContent);
    if (!isComment && !lineContent.includes('//') && !lineContent.includes('/*') && !lineContent.includes('*')) {
      return { matched: false, reason: 'not_a_comment' };
    }

    // 如果有 fullPattern，直接使用
    if (matcher.fullPattern) {
      try {
        const regex = new RegExp(matcher.fullPattern, 'g');
        const matches = lineContent.match(regex);

        if (matches && matches.length > 0) {
          return {
            matched: true,
            pattern: pattern.name,
            matchedValues: matches,
            context: 'comment'
          };
        }
      } catch (err) {
        console.warn(`[SemanticMatcher] Invalid fullPattern: ${matcher.fullPattern}`, err.message);
      }
    }

    // 構建完整的正則表達式
    let fullPattern = regexPattern;
    if (lookbehind) {
      fullPattern = `(?<=${lookbehind})${fullPattern}`;
    }
    if (lookahead) {
      fullPattern = `${fullPattern}(?=${lookahead})`;
    }

    try {
      const regex = new RegExp(fullPattern, 'g');
      const matches = lineContent.match(regex);

      if (matches && matches.length > 0) {
        return {
          matched: true,
          pattern: pattern.name,
          matchedValues: matches,
          context: 'comment'
        };
      }
    } catch (err) {
      console.warn(`[SemanticMatcher] Invalid regex pattern: ${fullPattern}`, err.message);
    }

    return { matched: false };
  }

  /**
   * _matchCodeContext - 匹配代碼上下文
   */
  _matchCodeContext(issue, pattern, lineContent) {
    const matcher = pattern.matcher || {};
    const regexPattern = matcher.pattern || '';
    const lookbehind = matcher.lookbehind || '';
    const lookahead = matcher.lookahead || '';

    // 構建完整的正則表達式
    let fullPattern = regexPattern;
    if (lookbehind) {
      fullPattern = `(?<=${lookbehind})${fullPattern}`;
    }
    if (lookahead) {
      fullPattern = `${fullPattern}(?=${lookahead})`;
    }

    try {
      const regex = new RegExp(fullPattern, 'g');
      const matches = lineContent.match(regex);

      if (matches && matches.length > 0) {
        return {
          matched: true,
          pattern: pattern.name,
          matchedValues: matches,
          context: 'code'
        };
      }
    } catch (err) {
      console.warn(`[SemanticMatcher] Invalid regex pattern: ${fullPattern}`, err.message);
    }

    return { matched: false };
  }

  /**
   * _isCommentLine - 檢查是否為註釋行
   */
  _isCommentLine(lineContent) {
    const trimmed = lineContent.trim();
    return (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('<!--')
    );
  }

  /**
   * _initializeSync - 同步初始化
   */
  _initializeSync() {
    this._semanticPatterns = this._loadSemanticPatterns();
    this._initialized = true;
  }

  /**
   * matchBatch - 批量匹配 issues
   *
   * @param {Array} issues - Issues 據組
   * @returns {Object} - { matched: [], unmatched: [] }
   */
  matchBatch(issues) {
    if (!this._initialized) {
      this._initializeSync();
    }

    const results = {
      matched: [],
      unmatched: [],
      stats: {
        total: issues.length,
        matched: 0,
        byPattern: {}
      }
    };

    for (const issue of issues) {
      const match = this.match(issue);

      if (match) {
        results.matched.push({
          issue,
          pattern: match
        });
        results.stats.matched++;

        const patternName = match.name;
        results.stats.byPattern[patternName] = (results.stats.byPattern[patternName] || 0) + 1;
      } else {
        results.unmatched.push(issue);
      }
    }

    return results;
  }

  /**
   * getPatterns - 獲取所有 semantic patterns
   */
  getPatterns() {
    if (!this._initialized) {
      this._initializeSync();
    }
    return this._semanticPatterns || [];
  }

  /**
   * addPattern - 添加新的 semantic pattern
   */
  addPattern(pattern) {
    if (!this._initialized) {
      this._initializeSync();
    }

    // 驗證 pattern 格式
    if (!pattern.type || pattern.type !== 'semantic') {
      throw new Error('Invalid pattern: must have type="semantic"');
    }

    if (!pattern.name || !pattern.matcher) {
      throw new Error('Invalid pattern: must have name and matcher');
    }

    // 設置默認值
    pattern.confidence = pattern.confidence || 0.85;
    pattern.auto_apply = pattern.auto_apply !== false;
    pattern.learned_at = pattern.learned_at || new Date().toISOString().split('T')[0];

    this._semanticPatterns.push(pattern);
    this._savePatterns();

    return pattern;
  }

  /**
   * _savePatterns - 保存 patterns 到文件
   */
  _savePatterns() {
    const filePath = path.join(this.options.DATA_DIR, this.options.SEMANTIC_WHITELIST_FILE);

    const data = {
      version: SEMANTIC_CONFIG.VERSION,
      description: 'Semantic Pattern Whitelist - Cross-file false positive patterns',
      generated_at: new Date().toISOString(),
      patterns: this._semanticPatterns,
      stats: {
        total_patterns: this._semanticPatterns.length,
        last_updated: new Date().toISOString().split('T')[0]
      }
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[SemanticMatcher] Patterns saved: ${filePath}`);
    } catch (err) {
      console.error(`[SemanticMatcher] Failed to save patterns: ${err.message}`);
    }
  }

  /**
   * learnFromIssue - 從 issue 學習新的 semantic pattern
   *
   * @param {Object} issue - Issue 對像
   * @param {string} reasoning - 解釋為什麼這是 FP
   */
  learnFromIssue(issue, reasoning) {
    // 分析 issue 來推斷 semantic pattern
    const lineContent = issue.code || issue.lineContent || '';

    // 推斷 pattern 類型
    let inferredPattern = this._inferPatternType(issue, reasoning, lineContent);

    if (inferredPattern) {
      this.addPattern(inferredPattern);
      return inferredPattern;
    }

    return null;
  }

  /**
   * _inferPatternType - 推斷 pattern 類型
   */
  _inferPatternType(issue, reasoning, lineContent) {
    const reasoningLower = reasoning.toLowerCase();

    // 日期年份
    if (reasoningLower.includes('日期') || reasoningLower.includes('年份') || reasoningLower.includes('date')) {
      return {
        type: 'semantic',
        name: 'inferred_comment_date',
        rule: issue.rule,
        matcher: {
          context: 'comment',
          pattern: '(20\\d{2})',
          explanation: reasoning
        },
        confidence: 0.90,
        auto_apply: true,
        examples: [{ file: issue.file, line: issue.line, reasoning }],
        learned_at: new Date().toISOString().split('T')[0]
      };
    }

    // 行號引用
    if (reasoningLower.includes('行號') || reasoningLower.includes('line') || reasoningLower.includes('原 lines')) {
      return {
        type: 'semantic',
        name: 'inferred_line_ref',
        rule: issue.rule,
        matcher: {
          context: 'comment',
          pattern: '(\\d{3,5})',
          lookbehind: '原\\s*Lines?|Lines?',
          explanation: reasoning
        },
        confidence: 0.95,
        auto_apply: true,
        examples: [{ file: issue.file, line: issue.line, reasoning }],
        learned_at: new Date().toISOString().split('T')[0]
      };
    }

    // Timeout
    if (reasoningLower.includes('timeout') || reasoningLower.includes('超時') || reasoningLower.includes('秒')) {
      return {
        type: 'semantic',
        name: 'inferred_timeout',
        rule: issue.rule,
        matcher: {
          context: 'code',
          pattern: '\\b(5000|10000|15000|30000|60000)\\b',
          lookbehind: 'timeout',
          explanation: reasoning
        },
        confidence: 0.85,
        auto_apply: true,
        examples: [{ file: issue.file, line: issue.line, reasoning }],
        learned_at: new Date().toISOString().split('T')[0]
      };
    }

    return null;
  }

  /**
   * getStats - 獲取統計信息
   */
  getStats() {
    if (!this._initialized) {
      this._initializeSync();
    }

    return {
      total_patterns: this._semanticPatterns?.length || 0,
      by_rule: this._countByRule(),
      by_context: this._countByContext(),
      version: SEMANTIC_CONFIG.VERSION
    };
  }

  /**
   * _countByRule - 按 rule 分組統計
   */
  _countByRule() {
    const counts = {};
    for (const pattern of (this._semanticPatterns || [])) {
      const rule = pattern.rule || 'unknown';
      counts[rule] = (counts[rule] || 0) + 1;
    }
    return counts;
  }

  /**
   * _countByContext - 按 context 分組統計
   */
  _countByContext() {
    const counts = {};
    for (const pattern of (this._semanticPatterns || [])) {
      const context = pattern.matcher?.context || 'any';
      counts[context] = (counts[context] || 0) + 1;
    }
    return counts;
  }
}

// ==================== Export ====================
module.exports = {
  SemanticMatcher,
  SEMANTIC_CONFIG
};

// Run if called directly
if (require.main === module) {
  const matcher = new SemanticMatcher();

  console.log('\n📊 Semantic Matcher Stats:');
  console.log(JSON.stringify(matcher.getStats(), null, 2));

  // Test matching
  console.log('\n🧪 Test Matching:');

  const testIssues = [
    {
      file: 'test.js',
      line: 10,
      rule: 'magic_numbers',
      lineContent: '// 修復 (2026-04-04) 登入問題'
    },
    {
      file: 'test.js',
      line: 20,
      rule: 'magic_numbers',
      lineContent: '// 原 Lines 100-200 需要重構'
    },
    {
      file: 'test.js',
      line: 30,
      rule: 'magic_numbers',
      lineContent: 'timeout: 10000'
    }
  ];

  for (const issue of testIssues) {
    const match = matcher.match(issue);
    console.log(`\n  Issue: ${issue.file}:${issue.line}`);
    console.log(`  Content: "${issue.lineContent}"`);
    if (match) {
      console.log(`  ✅ Matched: ${match.name}`);
      console.log(`     Reason: ${match.reason}`);
    } else {
      console.log(`  ❌ No match`);
    }
  }
}
