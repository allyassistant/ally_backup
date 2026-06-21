#!/usr/bin/env node
/**
 * auditOrchestrator.js - 審計調度器
 * 協調三種 Scanner：Local / AI / Error
 *
 * 基於 Phase 1 的 fileDiscovery.js 和 issueAggregator.js
 *
 * Created: 2026-04-05
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { SCRIPTS_DIR, MEMORY_DIR, STATE_DIR, ERRORS_JSON, atomicWriteSync } = require('./config');
const { isFalsePositive } = require('./whitelist_patterns');
const { getSimplifiedMap } = require('./rules/low-risk');

// ==================== 共用常量 ====================
// CQM-008: 提取 severityOrder 為共用常量
const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
const AI_AUDIT_TIMEOUT_MS = 180000;

// CQM-007: Magic number 白名單
const MAGIC_NUMBER_WHITELIST = [
  // 版本號 (e.g., 1.0.0, 2.1.3)
  /^\d+\.\d+\.\d+$/,
  // IP 地址片段 (0-255)
  /^(25[0-5]|2[0-4]\d|[01]?\d?\d)$/,
  // 常見 timestamp/年份 (1970-2030)
  /^(197[0-9]|198\d|199\d|20[0-2]\d|2030)$/,
  // 常見 HTTP 狀態碼
  /^[1-5]\d{2}$/,
  // 端口號 (常用)
  /^(80|443|8080|3000|5432|3306|6379|27017)$/
];

// Phase 1: Context-based whitelist for magic_numbers (減少誤報)
// ==================== Magic Numbers 白名單 ====================
// 用於 comment_date 的嚴格匹配，避免過度寬泛導致漏報或誤報
const COMMENT_DATE_KEYWORDS = ['created', 'modified', 'date', 'updated', 'changed', 'fixed', '修復', '更新'];

const WHITELIST_CONTEXTS = [
  // 註釋中的日期關鍵詞 - 必須包含完整日期格式關鍵詞
  { type: 'comment_date', test: (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('#')) return false;
    if (!COMMENT_DATE_KEYWORDS.some(kw => trimmed.toLowerCase().includes(kw))) return false;
    if (!/\d{4}/.test(trimmed)) return false;
    return true;
  } },
  // 行號引用
  { type: 'line_reference', test: (line) => /lines?\s*~?\d+/i.test(line) },
  // 配置對象中的數字（任何 indent + 任何 key case）
  { type: 'config_object', test: (line) => /^\s+[a-zA-Z_]\w*:\s*\d+/.test(line) },
  // 日期格式
  { type: 'date_format', test: (line) => /\d{4}-\d{2}-\d{2}/.test(line) },
  // URL 中的數字
  { type: 'url_version', test: (line) => /https?:\/\/[^\s]*\d{4,}/.test(line) },
  // Regex pattern 中的數字
  { type: 'regex_pattern', test: (line) => /\/.*\(.*\d+.*\).*\//.test(line) || /\[.*\d+.*\]/.test(line) },
  // 常量定義檔案中的分類數字
  { type: 'constant_category', test: (line) => /pattern.*:\s*\/.*\d+/.test(line) || /knownConstants.*Set\(\[/.test(line) },
  // 陣列中的數字
  { type: 'array_element', test: (line) => /^\s+\d{3,}(,|\s*$)/.test(line) },
  // 模板字符串中的數字
  { type: 'string_literal', test: (line) => /`.*\d{3,}.*`/.test(line) || /".*\d{3,}.*"/.test(line) || /'.*\d{3,}.*'/.test(line) },
  // 註釋行（//, #, *, /* 開頭）— 數字只係文檔
  { type: 'comment_line', test: (line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
  } },
  // const/let/var 賦值 = 數字 — 數字已命名，以及 method call 鏈中的數字參數
  { type: 'const_assign', test: (line) => {
    const trimmed = line.trim();
    return /^(const|let|var)\s+\w+\s*=\s*\d+/.test(trimmed) ||
           /^(const|let|var)\s+\w+\s*=\s*\d+\s*\*/.test(trimmed) ||
           /\.(slice|substring|substr)\s*\([^)]*\b(\d{4,})\b/.test(trimmed);
  } },
  // Discord 錯誤碼（e.code === 數字）
  { type: 'discord_error_code', test: (line) => {
    const trimmed = line.trim();
    return /e\.code\s*===\s*\d{4,}/.test(trimmed);
  } },
  // Python 像素範圍 /* area/pixel 等 */
  { type: 'pixel_range', test: (line) => {
    const trimmed = line.trim();
    return /(area|pixel|size)\s*(<=|>=|\d)/.test(trimmed) && /\d{4,}/.test(trimmed);
  } },
  // Template literal 入面既數字（multiline backtick strings）
  { type: 'template_inside', test: (line, lines, lineIdx) => {
    // 檢查附近 5 行有冇 backtick（前面或後面）
    const start = Math.max(0, lineIdx - 5);
    const end = Math.min(lines.length - 1, lineIdx + 5);
    for (let i = start; i <= end; i++) {
      if (lines[i].includes('`')) return true;
    }
    return false;
  } },
  // 數據對象行（含有 quoted string + 數字 > 1000，似 data rows）
  { type: 'data_row', test: (line) => {
    const trimmed = line.trim();
    // 行中有 quoted string + 開頭係 { 或 indent + {
    return /['"].+['"]\s*[:,]/.test(trimmed) && /^\s*\{/.test(trimmed) && /\b\d{4,}\b/.test(trimmed);
  } }
];

// CQM-005: 文件大小限制 (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

// ==================== 常量定義 ====================
const CONFIG = {
  // Scanner 來源
  SCANNER_SOURCES: {
    LOCAL: 'local',      // auto_fix rules (rule-based)
    AI: 'ai',          // pure_ai_audit (LLM-based)
    ERROR: 'error_json'  // errors.json (runtime errors)
  },

  // AI 觸發閾值
  AI_THRESHOLD: {
    highSeverityCount: 5,   // 超過 5 個 high severity → 觸發 AI
    criticalExists: 1,        // 有 1 個 critical → 觸發 AI
    mediumSeverityCount: 10     // 超過 10 個 medium → 觸發 AI
  },

  // 輸出檔案
  OUTPUT_FILE: '.state/audit_orchestrator_results.json',
  CACHE_FILE: '.state/audit_orchestrator_cache.json'
};

// ==================== Issue Builder 簡化版 ====================
class Issue {
  constructor(data) {
    this.id = data.id || `issue_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.file = data.file || null;
    this.line = data.line || null;
    this.rule = data.rule || null;
    this.message = data.message || '';
    this.severity = data.severity || 'medium';
    this.source = data.source || 'local';
    this.category = data.category || 'reliability';
    this.autoFixable = data.autoFixable !== undefined ? data.autoFixable : false;
    this.confidence = data.confidence !== undefined ? data.confidence : null;
    this.createdAt = data.createdAt || new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      file: this.file,
      line: this.line,
      rule: this.rule,
      message: this.message,
      severity: this.severity,
      source: this.source,
      category: this.category,
      autoFixable: this.autoFixable !== undefined ? this.autoFixable : false,
      confidence: this.confidence !== undefined ? this.confidence : null,
      createdAt: this.createdAt
    };
  }
}

// ==================== Local Scanner ====================
class LocalScanner {
  constructor(options = {}) {
    this.options = options;
    this.issues = [];
  }

  /**
   * 運行 Local Scanner (基於 auto_fix rules)
   */
  async run(files) {
    const issues = [];

    // 掃描每個檔案
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');

        // 簡化的規則檢測
        // CQM-005: 檢查文件大小
        if (content.length > MAX_FILE_SIZE) {
          issues.push(new Issue({
            file: path.relative(process.cwd(), file),
            line: 1,
            rule: 'file_too_large',
            message: `File size (${(content.length / 1024).toFixed(1)}KB) exceeds limit (${MAX_FILE_SIZE / 1024}KB)`,
            severity: 'medium',
            source: CONFIG?.SCANNER_SOURCES?.LOCAL,
            category: 'maintainability'
          }));
        }

        // P0: fs.*_sync missing trycatch (fs.writeFileSync, fs.unlinkSync, fs.rmSync, etc.)
        const fsSyncCallRegex = /\bfs\.(?:readFileSync|writeFileSync|unlinkSync|rmSync|mkdirSync|copyFileSync|accessSync|statSync|readdirSync|lstatSync)\s*\(/;
        if (fsSyncCallRegex.test(content)) {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip single-line comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

            if (fsSyncCallRegex.test(line)) {
              // 跳過 regex literal (例如 /fs\.readFileSync/)
              if (/\/[^\/]*fs\.\w+Sync/.test(line)) {
                continue;
              }

              // 跳過 description fields (desc:, reason:, pattern:, message: 等)
              const descriptionFields = ['desc:', 'reason:', 'pattern:', 'message:', 'suggestion:', 'details:', 'title:'];
              for (const field of descriptionFields) {
                if (line.includes(field) && line.indexOf(field) < line.indexOf('fs.')) {
                  continue;
                }
              }

              let foundTry = false;
              // CQM-008: 先檢查當前行是否為 try-catch 單行模式（如 try { fs.readFileSync(...) } catch(e) {}）
              if (/\btry\s*\{[^}]*fs\.(?:readFileSync|writeFileSync|copyFileSync|mkdirSync|unlinkSync|existsSync|statSync|lstatSync|accessSync|readdirSync)[^}]*\}/.test(lines[i])) {
                foundTry = true;
              } else {
                let braceCount = 0;
                for (let j = i - 1; j >= 0; j--) {
                  const prevLine = lines[j];
                  braceCount += (prevLine.match(/\{/g) || []).length;
                  braceCount -= (prevLine.match(/\}/g) || []).length;
                  if (/\btry\s*\{/.test(prevLine) && braceCount >= 0) {
                    foundTry = true;
                    break;
                  }
                  if (braceCount < -1) break;
                  if (i - j > 20) break;
                }
              }


              if (!foundTry) {
                // Check if this is a false positive
                const issueForCheck = {
                  file: path.relative(process.cwd(), file),
                  line: i + 1,
                  rule: 'fsSync_missing_trycatch',
                  title: 'fs.*Sync function found without try-catch protection',
                  code: lines[i]
                };
                const fpResult = isFalsePositive(issueForCheck);
                if (fpResult.isFP) {
                  if (this?.options?._logFP) {
                    console.log(`  [FP Skip] ${path.relative(process.cwd(), file)}:${i+1} - ${fpResult.reason}`);
                  }
                  continue;
                }

                issues.push(new Issue({
                  file: path.relative(process.cwd(), file),
                  line: i + 1,
                  rule: 'fsSync_missing_trycatch',
                  message: `fs.*Sync function found without try-catch protection`,
                  severity: 'high',
                  source: CONFIG?.SCANNER_SOURCES?.LOCAL,
                  category: 'reliability'
                }));
              }
            }
          }
        }

        // P0: execSync_missing_trycatch
        // Match ONLY actual function calls, not destructuring assignments like `const { execSync } = require(...)`
        const execCallRegex = /\bexec(?:File)?Sync\s*\(/;
        const execSyncMatches = content.match(execCallRegex);
        if (execSyncMatches) {
          // Track if we're inside a template string or comment block
          let inTemplateString = false;
          let inBlockComment = false;
          let templateDepth = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Track template literals (backticks) - can span multiple lines
            // Count opening and closing backticks on this line
            const backtickCount = (line.match(/`/g) || []).length;
            if (backtickCount > 0) {
              // Check if this line starts a template string (various patterns)
              if (trimmed.startsWith('return `') ||
                  trimmed.startsWith('const `') ||
                  trimmed.startsWith('let `') ||
                  trimmed.match(/^\s*(const|let|var)\s+\w+\s*=\s*`/) ||
                  trimmed.match(/^\s*\w+:\s*`/) ||
                  trimmed.match(/^\s*desc\s*=\s*`/)) {
                templateDepth = 1;
                inTemplateString = true;
              } else if (inTemplateString) {
                templateDepth += backtickCount % 2; // Odd = toggled, even = balanced
                if (templateDepth <= 0 || backtickCount % 2 === 0) {
                  inTemplateString = false;
                  templateDepth = 0;
                }
              }
            }

            // Track block comments
            if (trimmed.startsWith('/*')) {
              inBlockComment = true;
            }
            if (inBlockComment && trimmed.includes('*/')) {
              inBlockComment = false;
              continue;
            }

            // Skip if inside template string or block comment
            if (inTemplateString || inBlockComment) {
              continue;
            }

            // Skip lines that are clearly documentation/markdown (contain | columns or start with #)
            if ((trimmed.includes('|') && trimmed.includes('---')) || trimmed.startsWith('#') || trimmed.startsWith('##')) {
              continue;
            }

            // Skip destructuring lines: const { execSync } = require(...) or let { execFileSync } = ...
            if (/\{[^}]*(?:execFile)?Sync/i.test(line) && /const\s*\{|let\s*\{|var\s*\{/.test(line)) {
              continue;
            }

            // Skip single-line comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
              continue;
            }

            // Check for actual function calls
            if (execCallRegex.test(line)) {
              // Scan backward to find if there's a try block before this line
              let foundTry = false;
              // CQM-008: 先檢查當前行是否為 try-catch 單行模式（如 try { require('child_process').execSync(...) } catch(e) {}）
              if (/\btry\s*\{[^}]*exec(?:File)?Sync\s*\([^)]*\)[^}]*\}/.test(lines[i])) {
                foundTry = true;
              } else {
                let braceCount = 0;
                for (let j = i - 1; j >= 0; j--) {
                  const prevLine = lines[j];
                  // Count braces
                  braceCount += (prevLine.match(/\{/g) || []).length;
                  braceCount -= (prevLine.match(/\}/g) || []).length;
                  // If we hit a try { before closing any brace, we're in a try block
                  if (/\btry\s*\{/.test(prevLine) && braceCount >= 0) {
                    foundTry = true;
                    break;
                  }
                  // If we close more braces than we open (negative braceCount), we've exited the function
                  if (braceCount < -1) break;
                  // Don't look too far back (max 20 lines)
                  if (i - j > 20) break;
                }
              }

              if (!foundTry) {
                // CQM-001: 改用 path.relative 保留路徑信息
                issues.push(new Issue({
                  file: path.relative(process.cwd(), file),
                  line: i + 1,
                  rule: 'execSync_missing_trycatch',
                  message: `execSync or execFileSync found without try-catch protection`,
                  severity: 'high',
                  source: CONFIG?.SCANNER_SOURCES?.LOCAL,
                  category: 'reliability'
                }));
              }
            }
          }
        }

        // P1: magic_numbers (Phase 1: 加入 context 檢測減少誤報)
        const magicNumberPattern = /\b(\d{4,}|\d+\.\d{4,})\b/g;
        let match;
        while ((match = magicNumberPattern.exec(content)) !== null) {
          const lineNum = content.slice(0, match.index).split('\n').length;
          const num = match[0];
          const lineContent = lines[lineNum - 1] || '';

          // CQM-007: 使用白名單排除常見的合法數字
          const isWhitelisted = MAGIC_NUMBER_WHITELIST.some(pattern => pattern.test(num));

          // Phase 1: Context 檢測 - 跳過常見誤報
          const isContextWhitelisted = WHITELIST_CONTEXTS.some(ctx => ctx.test(lineContent, lines, lineNum - 1));

          if (!isWhitelisted && !isContextWhitelisted && !num.includes('.') && parseInt(num) > 1000) {
            // Phase 2: Semantic Pattern Check - 使用 semantic matcher 過濾 false positives
            const issueForCheck = {
              file: path.relative(process.cwd(), file),
              line: lineNum,
              rule: 'magic_numbers',
              code: lineContent,
              lineContent: lineContent
            };

            const fpResult = isFalsePositive(issueForCheck);
            if (fpResult.isFP) {
              // Skip this issue - it's a semantic false positive
              if (this?.options?._logFP) {
                console.log(`  [FP Skip] ${path.relative(process.cwd(), file)}:${lineNum} - ${fpResult.reason}`);
              }
              continue;
            }

            // CQM-001: 改用 path.relative 保留路徑信息
            issues.push(new Issue({
              file: path.relative(process.cwd(), file),
              line: lineNum,
              rule: 'magic_numbers',
              message: `Hardcoded magic number: ${num}. Should be named constant.`,
              severity: 'low',
              source: CONFIG?.SCANNER_SOURCES?.LOCAL,
              category: 'style'
            }));
          }
        }

        // P1: simplified-chinese detection (low-risk.js rule)
        // 白名單：映射表檔案，跳過 simplified-chinese 檢測
        const SIMPLIFIED_WHITELIST = [
          'scripts/lib/rules/low-risk.js',
          'scripts/lib/helpers/rule-helpers.js',
          'scripts/translator.js'
        ];
        const relativePath = path.relative(process.cwd(), file);
        if (SIMPLIFIED_WHITELIST.some(p => relativePath.endsWith(p))) {
          // 跳過白名單檔案
          continue;
        }

        const simplifiedMap = getSimplifiedMap();
        const foundSimplifiedLines = new Set();
        let simplifiedCount = 0;
        lines.forEach((line, i) => {
          const trimmed = line.trim();
          const isComment = /^\s*(\/\/|#|\*)/.test(trimmed);
          const hasString = /['"`].*['"`]/.test(line);
          if (!isComment && !hasString) return;
          for (const [simp] of simplifiedMap) {
            if (line.includes(simp)) {
              simplifiedCount++;
              foundSimplifiedLines.add(i + 1);
              break; // count once per line
            }
          }
        });
        if (simplifiedCount > 0) {
          const uniqueLines = Array.from(foundSimplifiedLines).sort((a, b) => a - b);
          issues.push(new Issue({
            file: path.relative(process.cwd(), file),
            line: uniqueLines[0],
            rule: 'simplified-chinese',
            message: `${simplifiedCount} 處簡體中文（線 ${uniqueLines.slice(0, 3).join(',')}${uniqueLines.length > 3 ? '...' : ''}）。建議改為繁體。`,
            severity: 'low',
            source: CONFIG?.SCANNER_SOURCES?.LOCAL,
            category: 'style',
            autoFixable: true,
            confidence: 0.95
          }));
        }

      } catch (err) {
        // CQM-012: 編碼處理 - 記錄讀取失敗的檔案
        issues.push(new Issue({
          file: path.relative(process.cwd(), file),
          line: null,
          rule: 'file_read_error',
          message: `Failed to read file: ${err.message}`,
          severity: 'medium',
          source: CONFIG?.SCANNER_SOURCES?.LOCAL,
          category: 'reliability'
        }));
      }
    }

    this.issues = issues;
    return issues;
  }

  getIssues() {
    return this.issues;
  }
}

// ==================== AI Scanner ====================
class AIScanner {
  constructor(options = {}) {
    this.options = options;
    this.issues = [];
  }

  /**
   * 運行 AI Scanner (基於 pure_ai_audit)
   * 注意：這是簡化版，實際使用時會 spawn pure_ai_audit.js
   */
  async run(files) {
    const issues = [];

    // 檢查是否可以運行 pure_ai_audit
    const auditScript = path.join(SCRIPTS_DIR, 'pure_ai_audit.js');

    let canRunAudit = false;
    try {
        canRunAudit = fs.existsSync(auditScript);
    } catch (err) {
        console.error(`⚠️ 檢查 AI scanner 失敗: ${err.message}`);
    }
    if (!canRunAudit) {
      console.error('⚠️ pure_ai_audit.js not found, skipping AI scan');
      return issues;
    }

        // 實際調用 pure_ai_audit.js
        try {
          const result = execFileSync(process.execPath, [auditScript, '--files', files.join(','), '--json'], {
            encoding: 'utf8',
            timeout: AI_AUDIT_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024
          });

          // 解析 pure_ai_audit.js 的 JSON 輸出
          try {
            const aiResults = JSON.parse(result);
            if (Array.isArray(aiResults.issues)) {
              for (const aiIssue of aiResults.issues) {
                issues.push(new Issue({
                  file: aiIssue.file,
                  line: aiIssue.line,
                  rule: aiIssue.rule,
                  message: aiIssue.title || aiIssue.message,
                  severity: aiIssue.severity || 'medium',
                  source: CONFIG?.SCANNER_SOURCES?.AI,
                  category: aiIssue.category || 'reliability',
                  confidence: aiIssue.confidence || 0.7
                }));
              }
              console.error(`   Found ${aiResults?.issues?.length} AI issues`);
            }
          } catch (parseErr) {
            console.error(`⚠️ Failed to parse AI scan results: ${parseErr.message}`);
          }
        } catch (err) {
          console.error(`⚠️ AI scan failed: ${err.message}`);
        }

        this.issues = issues;
        return issues;
  }

  getIssues() {
    return this.issues;
  }
}

// ==================== Error Scanner ====================
class ErrorScanner {
  constructor(options = {}) {
    this.options = options;
    this.issues = [];
  }

  /**
   * 運行 Error Scanner (基於 errors.json)
   */
  async run(files) {
    const issues = [];

    // 讀取 errors.json
    let errorsJsonExists = false;
    try {
        errorsJsonExists = fs.existsSync(ERRORS_JSON);
    } catch (err) {
        console.error(`⚠️ 檢查 errors.json 失敗: ${err.message}`);
    }
    if (!errorsJsonExists) {
      return issues;
    }

    try {
      const errorsData = JSON.parse(fs.readFileSync(ERRORS_JSON, 'utf8'));
      const errors = errorsData.errors || [];

      // 獲取相關檔案的 error
      const fileBasenames = new Set(files.map(f => path.basename(f)));

      for (const error of errors) {
        // 檢查 error 是否與掃描的檔案相關
        if (error.file && fileBasenames.has(error.file)) {
          issues.push(new Issue({
            file: error.file,
            line: error.line || null,
            rule: 'runtime_error',
            message: error.message || error.problem || 'Runtime error detected',
            severity: error.severity || 'high',
            source: CONFIG?.SCANNER_SOURCES?.ERROR,
            category: 'reliability'
          }));
        }
      }

    } catch (err) {
      console.error(`⚠️ Failed to read errors.json: ${err.message}`);
    }

    this.issues = issues;
    return issues;
  }

  getIssues() {
    return this.issues;
  }
}

// ==================== Audit Orchestrator ====================
class AuditOrchestrator {
  constructor(options = {}) {
    this.options = {
      ...CONFIG,
      ...options
    };

    this.localScanner = new LocalScanner(options);
    this.aiScanner = new AIScanner(options);
    this.errorScanner = new ErrorScanner(options);

    this.results = {
      local: [],
      ai: [],
      error: [],
      merged: [],
      summary: {}
    };
  }

  /**
   * shouldRunAI - 智能判斷是否需要 AI 分析
   * 基於 Local Scanner 的結果決定是否觸發 AI Scanner
   */
  shouldRunAI(localIssues) {
    const highCount = localIssues.filter(i => i.severity === 'high').length;
    const criticalCount = localIssues.filter(i => i.severity === 'critical').length;
    const mediumCount = localIssues.filter(i => i.severity === 'medium').length;

    const threshold = this?.options?.AI_THRESHOLD;

    // 觸發條件：
    // 1. 有 critical 問題
    // 2. high severity 超過閾值
    // 3. medium severity 超過閾值
    const shouldRun =
      criticalCount >= threshold.criticalExists ||
      highCount >= threshold.highSeverityCount ||
      mediumCount >= threshold.mediumSeverityCount;

    if (!this?.options?._quiet) {
      console.log(`\n🤔 shouldRunAI decision:`);
      console.log(`   Critical: ${criticalCount}/${threshold.criticalExists}`);
      console.log(`   High: ${highCount}/${threshold.highSeverityCount}`);
      console.log(`   Medium: ${mediumCount}/${threshold.mediumSeverityCount}`);
      console.log(`   → ${shouldRun ? 'YES' : 'NO'}`);
    }

    return shouldRun;
  }

  /**
   * run - 執行完整審計流程
   */
  async run(files, options = {}) {
    if (!this?.options?._quiet) {
      console.log('\n🎯 Audit Orchestrator Starting');
      console.log(`   Files to audit: ${files.length}`);
    }

    // Step 1: Local Scanner
    if (!this?.options?._quiet) console.log('\n📍 Step 1: Running Local Scanner...');
    const localIssues = await this?.localScanner?.run(files);
    this.results.local = localIssues.map(i => i.toJSON());

    if (!this?.options?._quiet) {
      console.log(`   Found ${localIssues.length} local issues`);
    }

    // Step 2: AI Scanner (if needed)
    const runAI = this.shouldRunAI(localIssues);

    if (runAI) {
      if (!this?.options?._quiet) console.log('\n🤖 Step 2: Running AI Scanner...');
      const aiIssues = await this?.aiScanner?.run(files);
      this.results.ai = aiIssues.map(i => i.toJSON());

      if (!this?.options?._quiet) {
        console.log(`   Found ${aiIssues.length} AI issues`);
      }
    } else {
      if (!this?.options?._quiet) {
        console.log('\n⏭️ Step 2: Skipping AI Scanner (threshold not met)');
      }
    }

    // Step 3: Error Scanner (always)
    if (!this?.options?._quiet) console.log('\n⚠️ Step 3: Running Error Scanner...');
    const errorIssues = await this?.errorScanner?.run(files);
    this.results.error = errorIssues.map(i => i.toJSON());

    if (!this?.options?._quiet) {
      console.log(`   Found ${errorIssues.length} error-related issues`);
    }

    // Step 4: Merge results
    if (!this?.options?._quiet) console.log('\n🔀 Step 4: Merging results...');
    this.results.merged = this.merge();

    if (!this?.options?._quiet) {
      console.log(`   Merged: ${this?.results?.merged?.length} unique issues`);
    }

    // Generate summary
    this.results.summary = this.generateSummary();

    return this.results;
  }

  /**
   * merge - 合併三種 Scanner 的結果
   * 去除重複，按 severity 排序
   */
  merge() {
    const allIssues = [
      ...this?.results?.local,
      ...this?.results?.ai,
      ...this?.results?.error
    ];

    // CQM-002: 去重：基於完整路徑 file + line + rule + message (避免 key 碰撞)
    const seen = new Map();
    const uniqueIssues = [];

    for (const issue of allIssues) {
      // 使用更精確的 key，包含 message 前 50 個字符以避免碰撞
      const messageHash = (issue.message || '').substring(0, 50);
      const key = `${issue.file}:${issue.line}:${issue.rule}:${messageHash}`;

      if (!seen.has(key)) {
        seen.set(key, issue);
        uniqueIssues.push(issue);
      } else {
        // 如果已存在，保留 severity 較高的
        const existing = seen.get(key);
        // CQM-008: 使用共用的 SEVERITY_ORDER
        if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[existing.severity]) {
          // 合併 source
          const sources = new Set([...(existing.source || '').split(','), issue.source]);
          existing.source = [...sources].join(',');
          existing.severity = issue.severity;
        }
      }
    }

    // CQM-008: 按 severity 排序 (使用共用常量)
    uniqueIssues.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

    return uniqueIssues;
  }

  /**
   * generateSummary - 生成摘要
   */
  generateSummary() {
    const issues = this?.results?.merged;
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const sourceCounts = { local: 0, ai: 0, error_json: 0 };
    const ruleCounts = {};

    for (const issue of issues) {
      severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;

      if (issue.source) {
        issue?.source?.split(',').forEach(s => {
          sourceCounts[s] = (sourceCounts[s] || 0) + 1;
        });
      }

      if (issue.rule) {
        ruleCounts[issue.rule] = (ruleCounts[issue.rule] || 0) + 1;
      }
    }

    return {
      totalIssues: issues.length,
      severityCounts,
      sourceCounts,
      ruleCounts,
      generatedAt: new Date().toISOString()
    };
  }

  getResults() {
    return this.results;
  }

  /**
   * saveResults - 保存結果到檔案
   */
  saveResults(outputPath = null) {
    const filePath = outputPath || path.join(SCRIPTS_DIR, '..', this?.options?.OUTPUT_FILE);

    atomicWriteSync(filePath, {
      results: this.results,
      summary: this?.results?.summary,
      config: this.options,
      savedAt: new Date().toISOString()
    });

    if (!this?.options?._quiet) {
      console.log(`\n💾 Results saved to: ${filePath}`);
    }

    return filePath;
  }
}

// ==================== 路徑安全檢查 ====================
// CQM-010: 路徑遍歷檢查
function isPathSafe(filePath, baseDir = process.cwd()) {
  const resolved = path.resolve(filePath);
  const baseResolved = path.resolve(baseDir);
  return resolved.startsWith(baseResolved);
}

// CQM-011: 統一掃描邏輯 (與 FileDiscovery 保持一致)
function unifiedScan(dir, options = {}) {
  const {
    extensions = ['.js'],
    excludeDirs = ['node_modules', '.git', '__pycache__', '.venv', '.cache', 'dist'],
    maxDepth = 10
  } = options;

  const results = [];

  const scanDir = (currentDir, depth = 0) => {
    // CQM-010: 路徑遍歷檢查
    if (!isPathSafe(currentDir, dir)) {
      console.error(`⚠️ Path traversal blocked: ${currentDir}`);
      return;
    }

    if (depth > maxDepth) {
      console.warn(`⚠️ Max depth (${maxDepth}) reached at: ${currentDir}`);
      return;
    }

    try {
      // CQM-012: 明確指定編碼
      const entries = fs.readdirSync(currentDir, { withFileTypes: true, encoding: 'utf8' });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            scanDir(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch (err) {
      console.error(`⚠️ Scan error: ${err.message}`);
    }
  };

  scanDir(dir);
  return results;
}

// ==================== CLI 入口 ====================
async function main() {
  const args = process.argv.slice(2);
  const options = {
    _quiet: args.includes('--quiet') || args.includes('-q')
  };

  // 預設：掃描 scripts 目錄
  let targetDir = SCRIPTS_DIR;
  let targetFiles = [];

  // 解析參數
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      targetDir = args[i + 1];
      i++;
    } else if (args[i] === '--files' && args[i + 1]) {
      targetFiles = args[i + 1].split(',');
      i++;
    }
  }

  // CQM-010: 驗證目錄路徑安全
  if (!isPathSafe(targetDir, process.cwd()) && !isPathSafe(targetDir, SCRIPTS_DIR)) {
    console.error(`⚠️ Invalid target directory: ${targetDir}`);
    process.exit(1);
  }

  // 如果沒有指定檔案，掃描目標目錄
  if (targetFiles.length === 0) {
    // CQM-011: 使用統一掃描邏輯
    targetFiles = unifiedScan(targetDir, { extensions: ['.js'] });
  } else {
    // CQM-010: 驗證檔案路徑安全
    targetFiles = targetFiles.filter(file => {
      const safe = isPathSafe(file, process.cwd()) || isPathSafe(file, SCRIPTS_DIR);
      if (!safe) {
        console.error(`⚠️ Path traversal blocked: ${file}`);
      }
      return safe;
    });
  }

  if (!options._quiet) {
    console.log(`\n🎯 Audit Orchestrator`);
    console.log(`   Target: ${targetFiles.length} files`);
  }

  // Run orchestrator
  const orchestrator = new AuditOrchestrator(options);
  await orchestrator.run(targetFiles, options);

  // Save results
  orchestrator.saveResults();

  // Print summary
  if (!options._quiet) {
    console.log('\n📊 Summary');
    console.log('─'.repeat(30));
    console.log(`   Total: ${orchestrator?.results?.summary?.totalIssues} issues`);
    console.log(`   Critical: ${orchestrator?.results?.summary?.severityCounts?.critical}`);
    console.log(`   High: ${orchestrator?.results?.summary?.severityCounts?.high}`);
    console.log(`   Medium: ${orchestrator?.results?.summary?.severityCounts?.medium}`);
    console.log(`   Low: ${orchestrator?.results?.summary?.severityCounts?.low}`);
  }
}

// Export
module.exports = {
  AuditOrchestrator,
  Issue,
  LocalScanner,
  AIScanner,
  ErrorScanner,
  CONFIG
};

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
