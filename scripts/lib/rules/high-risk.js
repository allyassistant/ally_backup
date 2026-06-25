/**
 * scripts/lib/rules/high-risk.js
 *
 * HIGH_RISK_RULES - 18 個高風險檢測規則
 *
 * 位置：auto_fix.js 原 Lines 540-1100
 *
 * 規則列表：
 *   1.  eval-usage                    (eval/new Function)
 *   2.  hardcoded-secrets             (硬編碼密鑰)
 *   3.  missing-error-handling        (缺少錯誤處理)
 *   4.  file-too-long                 (檔案過長)
 *   5.  deprecated-patterns            (deprecated 用法)
 *   6.  todo-fixme                    (TODO/FIXME)
 *   7.  inconsistent-return-value      (返回值不一致)
 *   8.  function-missing-try-catch     (重要函據缺 try-catch)
 *   9.  hardcoded-path-in-string      (String 中嵌入絕對路徑)
 *  10.  function-needs-quiet-param     (Function 輸出太冗長)
 *  11.  magic-string-in-function      (Function 內 hardcoded 魔術據值)
 *  12.  python-hardcoded-uuid         (Python hardcoded UUID)
 *  13.  python-hardcoded-paths        (Python 硬編碼路徑)
 *  14.  silent-fail-env              (環境變量缺失導致靜默失敗)
 *  15.  hardcoded-node-path           (exec/Spawn hardcoded node 路徑)
 *  16.  missing-atomic-write         (檔案寫入缺少 atomic write)
 *  17.  duplicate-hkt-date-helper     (重複 HKT 時間 Helper 定義)
 *  18.  duplicate-load-save-state     (重複 loadState/saveState 定義)
 *
 * 依賴 helpers/try-catch-helpers.js:
 *   - isPureFunction()
 *   - isProtectedByTry()
 *   - isProtectedByGlobalTry()
 *   - isProtectedByPromise()
 *   - hasAtomicWriteHelper()
 */

const path = require('path');

// 動態引入 helpers（避免循環依賴）
let helpers = null;
let contextHelpers = null;
function getHelpers() {
  if (!helpers) {
    try {
      helpers = require('../helpers');
    } catch {
      helpers = {};
    }
  }
  return helpers;
}

// 動態引入 context_helpers（上下文感知檢測）
function getContextHelpers() {
  if (!contextHelpers) {
    try {
      contextHelpers = require('../helpers/context_helpers');
    } catch {
      contextHelpers = null;
    }
  }
  return contextHelpers;
}

// ============================================================
// Skip Logic - 規則定義檔自身豁免
// ============================================================
// 不檢測規則定義檔本身，避免 regex/關鍵字被當作問題
// 修復 (2026-04-04)：擴展到整個 lib/rules/ 和 lib/helpers/ 目錄
const RULE_DEF_FILES = [
  'high-risk.js',
  'low-risk.js',
  'rule-helpers.js',
  'try-catch-helpers.js',
  'try-catch-helpers-ast.js',
  'skip-list.js',
  'file-cache.js',
  'index.js',
  'rules-index.js',
];

function isRuleDefinitionFile(filePath) {
  if (!filePath) return false;
  // 豁免所有 lib/rules/ 目錄下的檔案
  if (/\/lib\/rules\//.test(filePath)) return true;
  // 豁免所有 lib/helpers/ 目錄下的檔案
  if (/\/lib\/helpers\//.test(filePath)) return true;
  // 按名稱豁免（額外保障）
  const fileName = path.basename(filePath);
  return RULE_DEF_FILES.includes(fileName);
}

function skipIfRuleDef(filePath) {
  if (isRuleDefinitionFile(filePath)) {
    return { found: false, details: '', lines: [], severity: null };
  }
  return null; // 不跳過
}

// ============================================================
// CLI Detection - 識別主要 CLI Script
// ============================================================
const CLI_HELPER_FILES = [
  'pure_ai_audit.js',
  'system_check_bot.js',
  'auto_fix.js',
  'memory_generator.js',
  'l1_generator.js',
  'l0_abstract_generator.js',
  'weekly_correction_loop.js',
  'error_tracker.js',
  'issue_manager.js',
  'cross_session_bootstrap.js',
  'pattern_analysis_daily.js',
];

function isCLIHelperFile(filePath) {
  if (!filePath) return false;
  const fileName = path.basename(filePath);
  return CLI_HELPER_FILES.includes(fileName);
}

function isCLIScript(content) {
  // 檢測 shebang
  if (content.startsWith('#!')) return true;
  // 檢測 main() 函數定義（CLI entry point）
  if (/^(?:async\s+)?function\s+main\s*\(/m.test(content)) return true;
  // 檢測命令行參數解析（常見 CLI 工具）
  if (/\b(yargs|minimist|commander|meow|caporal)\s*\(/.test(content)) return true;
  if (/process\.argv/.test(content) && content.includes('--')) return true;
  return false;
}

const MAX_FILE_LINES_WARN = 1000; // 從原配置複製

/**
 * HIGH_RISK_RULES - 高風險檢測規則陣列
 *
 * 位置：auto_fix.js 原 Lines 540-1100
 *
 * 每個 rule 有：
 *   - id: 唯一識別碼
 *   - name: 規則名稱
 *   - category: 分類
 *   - severity: 嚴重程度 (critical/high/medium/low)
 *   - detect(content, filePath): 檢測函據
 */
const HIGH_RISK_RULES = [
  // ============================================================
  // Rule 1: eval-usage
  // ============================================================
  {
    id: 'eval-usage',
    name: '動態程式碼執行 (eval 或 new Function)',
    category: 'security',
    severity: 'critical',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/\beval\s*\(/.test(line) || /new\s+Function\s*\(/.test(line)) {
          found.push(i + 1);
        }
      });
      return {
        found: found.length > 0,
        details: `${found.length} 處使用動態程式碼執行`,
        lines: found,
        severity: 'critical',
        suggestion: '用 JSON.parse()、vm 模組或其他安全方式替代',
      };
    },
  },

  // ============================================================
  // Rule 2: hardcoded-secrets
  // ============================================================
  {
    id: 'hardcoded-secrets',
    name: '可能的硬編碼密鑰',
    category: 'security',
    severity: 'critical',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      const patterns = [
        /(?:api[_-]?key|apikey|secret|token|password|passwd|auth)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}/i,
        /(?:sk|pk|ak|key)-[A-Za-z0-9]{20,}/,
        /Bearer\s+[A-Za-z0-9._-]{20,}/,
      ];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return;
        if (/process\.env\./i.test(line)) return;
        for (const p of patterns) {
          if (p.test(line)) {
            found.push(i + 1);
            break;
          }
        }
      });
      return {
        found: found.length > 0,
        details: `${found.length} 處疑似硬編碼密鑰/Token`,
        lines: found,
        severity: 'critical',
        suggestion: '改用 process.env.XXX 或 .env 文件',
      };
    },
  },

  // ============================================================
  // Rule 3: missing-error-handling
  // ============================================================
  {
    id: 'missing-error-handling',
    name: '缺少錯誤處理',
    category: 'reliability',
    severity: 'high',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;

      // CLI Script 豁免：CLI 工具通常有全局錯誤處理或 shebang
      if (isCLIScript(content) || isCLIHelperFile(filePath)) {
        return { found: false, details: '', lines: [], severity: 'high' };
      }

      const h = getHelpers();
      const lines = content.split('\n');
      const found = [];

      // ============================================================
      // Helper Functions for fsSync Detection
      // ============================================================
      // Helper: 移除 comment 進行檢測
      function stripComments(code) {
        // 移除 block comments /* ... */
        let result = code.replace(/\/\*[\s\S]*?\*\//g, '');
        // 移除 single-line comment // ...
        result = result.replace(/\/\/.*$/, '');
        return result;
      }

      // Helper: 檢查 match 是否在 string literal 或 regex literal 內
      // NOTE: 唔好加入 description/title 等 keyword heuristic — 會產生 false
      // negatives（真正嘅 fs call 被當成喺 string 入面而 skip）。Quote/slash
      // count 已經足夠判斷是否喺 string/regex literal 內。
      function isInsideString(code, matchStart) {
        const beforeMatch = code.slice(0, matchStart);

        // 1. 檢查普通 quotes
        const quotes = (beforeMatch.match(/['"`]/g) || []).length;
        if (quotes % 2 === 1) return true;

        // 2. 檢查是否在 regex literal 內 (例如 /fs\.readFileSync/)
        const slashes = (beforeMatch.replace(/[^/]/g, '').match(/\//g) || []).length;
        if (slashes % 2 === 1) return true;

        return false;
      }

      // 已經在 try-catch 內的函數調用豁免模式
      const safeCallPatterns = [
        /safeReadFile\s*\(/,
        /safeWriteFile\s*\(/,
        /safeJsonParse\s*\(/,
        /atomicWriteSync\s*\(/,
        // 新增：配置和狀態管理函數
        /loadConfig/,
        /parseConfig/,
        /loadState/,
        /saveState/,
        /loadCache/,
        /saveCache/,
        // 新增：目錄確保函數
        /ensureDir/,
        /init\w*Dir/,
        /ensure\w*Exists/,
      ];

      // 獲取上下文感知 helpers
      const ch = getContextHelpers();
      const useContextAware = ch !== null;

      lines.forEach((line, i) => {
        const trimmed = line.trim();

        // P0: 跳過 comment 行
        if (trimmed.startsWith('/*') || trimmed.startsWith('*/')) return;
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        // 移除 comment 後檢測
        const codeOnly = stripComments(line);
        if (!/\bfs\.\w+Sync\s*\(/.test(codeOnly)) return;

        // P1: 檢查是否在 string literal 內
        const fsMatch = codeOnly.match(/\bfs\.\w+Sync\s*\(/);
        if (fsMatch && isInsideString(codeOnly, fsMatch.index)) return;

        // 跳過已經是安全調用的行
        if (safeCallPatterns.some(p => p.test(trimmed))) return;

        // exec/危險 fs 寫入 = High
        if (/execSync\s*\(/.test(line) || /spawnSync\s*\(/.test(line)) {
          if (!(h.isProtectedByTry?.(lines, i, filePath)) && !(h.isProtectedByPromise?.(lines, i))) {
            found.push({ line: i + 1, severity: 'high' });
          }
        }
        // 危險 fs 寫入/刪除 = High
        if (/\bfs\.(writeFileSync|unlinkSync|copyFileSync|renameSync)\s*\(/.test(line)) {
          if (!(h.isProtectedByTry?.(lines, i, filePath)) && !(h.isProtectedByPromise?.(lines, i))) {
            found.push({ line: i + 1, severity: 'high' });
          }
        }
        // 使用 context_helpers 進行 mkdirSync 上下文感知檢測
        if (/\bfs\.mkdirSync\s*\(/.test(line)) {
          if (useContextAware && ch.shouldRequireTryCatchForMkdir) {
            const result = ch.shouldRequireTryCatchForMkdir(lines, i);
            if (result.required) {
              found.push({ line: i + 1, severity: result.severity || 'high' });
            }
            // 如果不需要，根據嚴重性決定是否添加
            else if (result.severity === 'info') {
              found.push({ line: i + 1, severity: 'info' });
            }
          } else {
            // 原有邏輯（無 context_helpers 時的後備）
            const prevLines = lines.slice(Math.max(0, i - 3), i);
            const hasExistsCheck = prevLines.some(l => /existsSync\s*\(/.test(l));
            const hasRecursive = /recursive\s*:\s*true/.test(line);
            const isEnsureFunc = lines.slice(0, i).join('\n').match(/function\s+(ensure|init)\w*Dir/);

            if ((hasExistsCheck && hasRecursive) || isEnsureFunc) {
              // 完全跳過
            } else if (hasRecursive) {
              found.push({ line: i + 1, severity: 'info' });
            } else {
              found.push({ line: i + 1, severity: 'high' });
            }
          }
        }
        // 新增 (2026-04-14): fs.existsSync 檢查 - 使用 defensive check pattern
        // 修復：hasDefensiveCheck 處理「先檢查、後操作」既 pattern
        if (/\bfs\.existsSync\s*\(/.test(line)) {
          if (h.isProtectedByTry?.(lines, i) || h.hasDefensiveCheck?.(lines, i)) {
            // skip - 有 protección
          } else {
            // existsSync 本身就係一個 check，根據上下文調整 severity
            found.push({ line: i + 1, severity: 'info' });
          }
        }
        // 一般 fs 讀取 = Low（影響有限）
        // 修復：使用 context_helpers 進行上下文感知檢測
        if (/fs\.(readFileSync|readdirSync|statSync|accessSync)\s*\(/.test(line)) {
          if (!(h.isProtectedByTry?.(lines, i, filePath)) && !(h.isProtectedByPromise?.(lines, i))) {
            let adjustedSeverity = 'low';

            // 優先使用 context_helpers 的上下文感知檢測
            if (useContextAware) {
              if (/readFileSync/.test(line) && ch.shouldRequireTryCatchForReadFile) {
                const result = ch.shouldRequireTryCatchForReadFile(lines, i);
                if (!result.required && result.severity) {
                  adjustedSeverity = result.severity;
                }
              } else if (/readdirSync/.test(line) && ch.shouldRequireTryCatchForReaddir) {
                const result = ch.shouldRequireTryCatchForReaddir(lines, i);
                if (!result.required && result.severity) {
                  adjustedSeverity = result.severity;
                }
              }
            } else {
              // 原有後備邏輯（無 context_helpers 時）
              const prevContext = lines.slice(Math.max(0, i - 5), i).join('\n');
              const isConfigReading = /config\.json|settings\.json|\.env|CONFIG\./i.test(prevContext) ||
                                     /loadConfig|parseConfig|loadState/.test(prevContext);
              const isTemplateReading = /template|\.md['"\s]|\.txt['"\s]|\.html['"\s]/i.test(line);
              const isInternalScan = /SCRIPTS_DIR|STATE_DIR|WS\s*[),]|__dirname|CONFIG\./.test(line) ||
                                    /['"]\.\/\w+['"]/.test(line);
              const isExistsCheck = /existsSync/.test(line);

              const funcContext = lines.slice(0, i).join('\n').match(
                /(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/g
              );
              const lastFunc = funcContext?.[funcContext.length - 1];
              const isSafeHelperFunc = lastFunc &&
                /(load|parse|get|read|ensure|init|check|find)[A-Z]\w*/.test(lastFunc);

              if (isExistsCheck || isConfigReading || isTemplateReading ||
                  (isInternalScan && /readdirSync/.test(line)) ||
                  (isSafeHelperFunc && !/write|delete|remove/.test(line))) {
                adjustedSeverity = 'info';
              }
            }

            found.push({ line: i + 1, severity: adjustedSeverity });
          }
        }
      });

      // 分類問題嚴重性
      const highLines = found.filter(f => f.severity === 'high');
      const lowLines = found.filter(f => f.severity === 'low');
      const infoLines = found.filter(f => f.severity === 'info');
      const overallSeverity = highLines.length > 0 ? 'high' : (lowLines.length > 0 ? 'low' : (infoLines.length > 0 ? 'low' : null));

      // 如果只有 info，視為無問題（太瑣碎）
      if (highLines.length === 0 && lowLines.length === 0 && infoLines.length > 0) {
        return { found: false, details: '', lines: [], severity: 'low' };
      }

      // 如果只有 low/info，且數量很少，視為無問題
      if (highLines.length === 0 && lowLines.length <= 2) {
        return { found: false, details: '', lines: [], severity: 'low' };
      }

      return {
        found: found.length > 0,
        details: found.length > 0
          ? `${highLines.length} 處 High-risk + ${lowLines.length} 處 Low-risk`
          : '',
        lines: [...highLines, ...lowLines].map(f => f.line).slice(0, 10),
        severity: overallSeverity,
        suggestion: '為 execSync / fs 同步操作加上 try-catch，或為 Promise chain 加上 .catch() / .on("error")',
      };
    },
  },

  // ============================================================
  // Rule 4: file-too-long (已註釋 - 2026-04-07)
  // 原因：檔案過長係維護性問題，唔係安全問題，大量噪音
  // ============================================================
  // {
  //   id: 'file-too-long',
  //   name: '檔案過長',
  //   category: 'architecture',
  //   severity: 'medium',
  //   detect(content, filePath) {
  //     const skip = skipIfRuleDef(filePath);
  //     if (skip) return skip;
  //     const lineCount = content.split('\n').length;
  //     return {
  //       found: lineCount > MAX_FILE_LINES_WARN,
  //       details: `${lineCount} 行（建議 < ${MAX_FILE_LINES_WARN} 行）`,
  //       lines: [],
  //       severity: 'medium',
  //       suggestion: '考慮拆分為多個模組',
  //     };
  //   },
  // },

  // ============================================================
  // Rule 5: deprecated-patterns
  // ============================================================
  {
    id: 'deprecated-patterns',
    name: '可能的 deprecated 用法',
    category: 'maintenance',
    severity: 'medium',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      const deprecatedPatterns = [
        { regex: /new\s+Buffer\s*\(/, desc: 'new Buffer() → Buffer.from()' },
        { regex: /\.substr\s*\(/, desc: '.substr() → .substring()' },
        { regex: /url\.parse\s*\(/, desc: 'url.parse() → new URL()' },
        { regex: /path\.exists\s*\(/, desc: 'path.exists() → fs\\.existsSync()' },
      ];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        for (const dp of deprecatedPatterns) {
          // 改進 4: Skip regex literals - 如果 match 前面有 .match( 或 .test(, 就係 regex usage, 唔係 deprecated API
          const matchIdx = line.indexOf(dp.regex.toString().slice(1, -1));
          if (matchIdx > 0) {
            const beforeMatch = line.substring(0, matchIdx);
            // 如果前面有 / 或 .match( 或 .test(, 就跳過
            if (beforeMatch.includes('.match(') || beforeMatch.includes('.test(') || beforeMatch.endsWith('/')) continue;
          }
          if (dp.regex.test(line)) {
            found.push({ line: i + 1, desc: dp.desc });
          }
        }
      });
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.desc}`).join('; '),
        lines: found.map(f => f.line),
        severity: 'medium',
        suggestion: '更新到推薦的 API',
      };
    },
  },

  // ============================================================
  // Rule 6: todo-fixme
  // ============================================================
  {
    id: 'todo-fixme',
    name: '未完成的 TODO/FIXME',
    category: 'maintenance',
    severity: 'low',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        // 排除明顯是規則定義的情況
        // 例如: id: 'todo-fixme', keywords: [...], name: '...TODO...'
        if (/^ {0,8}id:\s*['"][^'"]*(?:TODO|FIXME|HACK|XXX)[^'"]*['"]/.test(trimmed)) return;
        if (/^ {0,8}name:\s*['"][^'"]*(?:TODO|FIXME|HACK|XXX)[^'"]*['"]/.test(trimmed)) return;
        if (/^ {0,8}keywords:\s*\[/.test(trimmed)) return;
        if (/^ {0,8}severity:\s*['"][^'"]*(?:TODO|FIXME|HACK|XXX)[^'"]*['"]/.test(trimmed)) return;
        // 排除 category keyword 配置：todo: ['跟進', '...']
        if (/^ {0,8}todo:\s*\[/.test(trimmed)) return;
        if (/^ {0,8}fixme:\s*\[/.test(trimmed)) return;
        if (/^ {0,8}hack:\s*\[/.test(trimmed)) return;
        if (/^ {0,8}xxx:\s*\[/.test(trimmed)) return;
        // 排除 'todo' / 'FIXME' 等作為 string literal comparison 值
        // 例如：if (f.category === 'todo') — 'todo' 係值，唔係 TODO comment
        // 匹配 === 'TODO' / === 'todo' / === "FIXME" 等 keyword literal 作為比較值
        if (/(?:===?|!==?)\s*['\"](?:TODO|FIXME|HACK|XXX)['\"]/i.test(trimmed)) return;

        // 跳過行內註釋中的 TODO/FIXME（HACK/XXX）
        // 例如：const x = 1; // TODO: something 呢個唔係真正的 TODO comment
        const inlineCommentIndex = trimmed.indexOf('//');
        if (inlineCommentIndex > 0) {
          const afterComment = trimmed.substring(inlineCommentIndex);
          if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(afterComment)) return;
        }

        if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(trimmed)) {
          found.push({ line: i + 1, text: trimmed.substring(0, 80) });
        }
      });
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.text}`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'low',
        suggestion: '清理 TODO/FIXME 標記',
      };
    },
  },

  // ============================================================
  // Rule 7: inconsistent-return-value
  // ============================================================
  {
    id: 'inconsistent-return-value',
    name: '條件分支中返回值不一致',
    category: 'reliability',
    severity: 'high',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      let braceDepth = 0;
      let inIfBlock = false;
      let ifStartLine = -1;
      let funcName = '';
      const returnTrueInIf = [];
      const returnTrueOutIf = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        const funcMatch = trimmed.match(/(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?/);
        if (funcMatch) {
          funcName = funcMatch[1] || funcMatch[2] || '';
        }

        if (/\bif\s*\(/.test(trimmed) && !inIfBlock) {
          inIfBlock = true;
          ifStartLine = i + 1;
          braceDepth = 0;
        }

        for (const ch of line) {
          if (ch === '{') braceDepth++;
          if (ch === '}') {
            braceDepth--;
            if (braceDepth <= 0 && inIfBlock) inIfBlock = false;
          }
        }

        if (/\breturn\s+true\b/.test(trimmed)) {
          if (inIfBlock) {
            returnTrueInIf.push({ line: i + 1, funcName, ifLine: ifStartLine });
          } else {
            returnTrueOutIf.push({ line: i + 1, funcName });
          }
        }
      }

      for (const inIf of returnTrueInIf) {
        const matchingOutIf = returnTrueOutIf.find(o =>
          o.funcName === inIf.funcName && o.funcName !== '' &&
          Math.abs(o.line - inIf.line) < 100
        );
        if (matchingOutIf) {
          found.push({ line: inIf.line, funcName: inIf.funcName, ifLine: inIf.ifLine, otherLine: matchingOutIf.line });
        }
      }

      const sensitivePatterns = /backup|notify|notification|send|dispatch|deliver/i;
      for (const inIf of returnTrueInIf) {
        if (sensitivePatterns.test(inIf.funcName) && !found.some(f => f.line === inIf.line)) {
          found.push({ line: inIf.line, funcName: inIf.funcName, ifLine: inIf.ifLine, otherLine: null });
        }
      }

      // Notification Pattern Whitelist: 這些函數名本身就預期通知/派遣，唔係 inconsistent return
      const notificationFuncNames = /notify|sendNotification|sendMessage|postToDiscord|sendDiscord|sendSignal|sendWhatsApp|sendEmail|dispatch/i;
      const isWhitelistedFunc = (name) => notificationFuncNames.test(name);
      const filteredFound = found.filter(f => !isWhitelistedFunc(f.funcName));

      return {
        found: filteredFound.length > 0,
        details: filteredFound.map(f =>
          `L${f.line}: ${f.funcName || '(anonymous)'}() — if block 內 return true` +
          (f.otherLine ? ` (L${f.otherLine} 亦有 return true，語義可能不一致)` : ' (backup/notification 函據需特別留意)')
        ).join('\n    '),
        lines: filteredFound.map(f => f.line),
        severity: 'high',
        suggestion: '確保不同條件分支的返回值能區分「成功」與「跳過」，建議返回 { success, skipped, reason } 或用不同值',
      };
    },
  },

  // ============================================================
  // Rule 8: function-missing-try-catch
  // ============================================================
  {
    id: 'function-missing-try-catch',
    name: '重要函據缺少 top-level try-catch',
    category: 'logic',
    severity: 'high',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;

      // CLI Script 豁免：CLI 工具通常有全局錯誤處理
      if (isCLIScript(content) || isCLIHelperFile(filePath)) {
        return { found: false, details: '', lines: [], severity: 'high' };
      }

      const h = getHelpers();
      const lines = content.split('\n');
      const found = [];

      // NOTE: require(), JSON.parse(), JSON.stringify() 已移除
      // 這些是常見標準操作，會造成大量誤報
      // 真正需要 try-catch 的是 exec/fs write/network 操作
      const riskyPatterns = [
        /\bexecSync\s*\(/, /\bexec\s*\(/, /\bspawn\s*\(/, /\bspawnSync\s*\(/,
        /\bhttp\.(request|get|post|Agent)/, /\bhttps\.(request|get|post|Agent)/,
        /\bprocess\.exit\s*\(/,
        // 檔案寫入和危險 fs 操作才需要 try-catch（read-only 放 Low）
        /\bfs\.(writeFileSync|unlinkSync|mkdirSync|copyFileSync|renameSync)\s*\(/,
        /\bfs\.(writeFile|unlink|mkdir|copyFile|rename)\s*\(/,
      ];

      // 對於 async function，這些 pattern 是 Promise-based，風險較低
      const asyncSafePatterns = [
        /\bfetch\s*\(/,
        /\bfs\.promises\./,
        /\.then\s*\(/,
        /\.catch\s*\(/,
      ];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const funcMatch = line.match(/^(async\s+)?function\s+(\w+)/);
        if (!funcMatch) continue;

        const isAsync = !!funcMatch[1];
        const funcName = funcMatch[2];
        if (funcName === 'function-missing-try-catch' || funcName === 'detect') continue;

        let braceCount = 0;
        let inFunc = false;
        let hasRiskyOp = false;
        let hasAsyncSafeOp = false;
        const riskyOpLines = []; // 收集每個 risky op 的行號（1-indexed）
        const funcContentLines = [];
        let funcLineCount = 0;

        for (let j = i; j < Math.min(i + 200, lines.length); j++) {
          const l = lines[j];
          const trimmed = l.trim();
          if (l.includes('{')) { inFunc = true; }
          if (inFunc) {
            for (const ch of l) {
              if (ch === '{') braceCount++;
              if (ch === '}') braceCount--;
            }
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
            funcLineCount++;
            // 收集每個 risky op 的行號
            for (const p of riskyPatterns) {
              if (p.test(trimmed)) {
                hasRiskyOp = true;
                riskyOpLines.push(j + 1); // 1-indexed 行號
                break;
              }
            }
            // 檢查 async safe operations
            for (const p of asyncSafePatterns) {
              if (p.test(trimmed)) {
                hasAsyncSafeOp = true;
              }
            }
            funcContentLines.push(trimmed);
            if (inFunc && braceCount === 0 && j > i + 2) break;
          }
        }

        if (!hasRiskyOp) continue;
        if (h.isPureFunction?.(funcName)) continue;

        // ============================================================
        // P1: Short Function Exemption (< 10 lines with basic handling)
        // ============================================================
        if (funcLineCount < 10) {
          // 短函數檢查是否有基本 error handling
          const hasTryCatch = funcContentLines.some(l => /\btry\s*\{/.test(l));
          const hasErrorReturn = funcContentLines.some(l => /\breturn\s+(null|false|undefined|\{\})\s*;?\s*$/.test(l));
          if (hasTryCatch || hasErrorReturn) continue;
        }

        // ============================================================
        // P0: Async Function with try-catch exemption
        // ============================================================
        // 如果是 async function 且內部有 try-catch，視為有保護
        if (isAsync) {
          const hasTryCatch = funcContentLines.some(l => /\btry\s*\{/.test(l));
          const hasCatch = funcContentLines.some(l => /\bcatch\s*\(/.test(l));
          if (hasTryCatch && hasCatch) continue;

          // 如果只有 Promise-based 操作（fs.promises/fetch），風險較低
          if (hasAsyncSafeOp && !hasRiskyOp) continue;
        }

        // ============================================================
        // P1 Deep Scan: 檢查函數內部是否有 try-catch 包圍所有危險操作
        // ============================================================
        // 策略：收集函數內所有危險操作行，逐一檢查是否被 try-catch 保護
        // 包括 function-level try-catch（整個函數包在 try 內）
        // 和 inline try-catch（危險操作本身被 try 包圍）

        // 1. 先檢查是否整個函數被 try-catch 包圍（function-level）
        const isFuncLevelProtected = h.isProtectedByFunctionLevelTry?.(lines, i, filePath);
        if (isFuncLevelProtected) continue;

        // 2. 深度掃描：對每個危險操作，檢查是否有 try-catch 直接包圍
        // 或在函數外部有 try-catch
        const isProtected = riskyOpLines.every(rLine =>
          h.isProtectedByTry?.(lines, rLine - 1, filePath) ||
          h.isProtectedByGlobalTry?.(lines, rLine - 1)
        );
        if (isProtected) continue;

        // 3. 排除 ensurePatternsDir 系列函數（已知會被外層 try-catch 包圍）
        if (/\bensure\w*Dir\b/.test(funcName)) continue;

        // 4. 排除已經被 isPureFunction 標記為安全的函數
        // （如 safeWriteFile, safeReadFile 等 helper）
        if (h.isPureFunction?.(funcName)) continue;

        const nonTrivialLines = funcContentLines.filter(l =>
          l && !l.startsWith('//') && !l.startsWith('*') &&
          !/^\}$/.test(l) && !/^\{$/.test(l) &&
          !/^\s*(?:const|let|var)\s+\w+\s*$/.test(l)
        );
        if (nonTrivialLines.length <= 1) continue;

        if (inFunc) found.push({ line: i + 1, func: funcName, async: isAsync });
      }
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: function ${f.func}()${f.async ? ' [async]' : ''} 缺少 try-catch`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'high',
        suggestion: '包含危險操作（fs write/exec/network）的函據應該有 top-level try-catch 防止 unhandled errors',
      };
    },
  },

  // ============================================================
  // Rule 9: hardcoded-path-in-string
  // ============================================================
  {
    id: 'hardcoded-path-in-string',
    name: 'String 中嵌入絕對路徑',
    category: 'logic',
    severity: 'high',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      // Whitelist: HOME || fallback 標準 Pattern
      const homeFallbackPattern = /process\.env\.HOME\s*\|\|/;
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        // 跳過 HOME || fallback pattern（標準安全用法）
        if (homeFallbackPattern.test(line)) return;
        if (/\/Users\/\w+/.test(line) || /\/home\/\w+/.test(line)) {
          found.push(i + 1);
        }
      });
      return {
        found: found.length > 0,
        details: `${found.length} 行包含絕對路徑`,
        lines: found,
        severity: 'high',
        suggestion: '改用路徑變量或 path.join(process.env.HOME, ...) 代替硬編碼路徑',
      };
    },
  },

  // ============================================================
  // Rule 10: function-needs-quiet-param
  // ============================================================
  {
    id: 'function-needs-quiet-param',
    name: 'Function 輸出太冗長（console.log）',
    category: 'logic',
    severity: 'low',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;

      // ============================================================
      // P0 CLI Detection: CLI Script 豁免 console.log 檢測
      // ============================================================
      // CLI 工具大量 console.log 係預期行為，不應標記
      if (isCLIScript(content) || isCLIHelperFile(filePath)) {
        return { found: false, details: '', lines: [], severity: 'low' };
      }

      const lines = content.split('\n');
      const found = [];

      // 排除明顯係用嚟 logging/debugging 嘅函數名（呢啲預期有輸出）
      const loggingFuncNames = /^(log|info|warn|error|print|debug|trace|verbose|fmt|format)$/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const funcMatch = line.match(/^(?:async\s+)?function\s+(\w+)/);
        if (!funcMatch) continue;

        const funcName = funcMatch[1];

        // 跳過明顯係 logging 工具函數
        if (loggingFuncNames.test(funcName)) continue;

        // 跳過 rule 本身（避免打擾自己）
        if (funcName === 'function-needs-quiet-param' || funcName === 'detect') continue;

        let consoleLogCount = 0;
        let hasQuiet = /\bquiet\b/.test(line);
        let braceCount = 0;
        let inFunc = false;
        let funcLineCount = 0;

        for (let j = i; j < Math.min(i + 80, lines.length); j++) {
          const l = lines[j];
          if (l.includes('{')) { inFunc = true; }
          if (inFunc) {
            for (const ch of l) {
              if (ch === '{') braceCount++;
              if (ch === '}') braceCount--;
            }
            const trimmed = l.trim();
            if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
              const matches = l.match(/\bconsole\.(log|error|warn|info)\s*\(/g);
              if (matches) consoleLogCount += matches.length;
            }
            funcLineCount++;
            if (inFunc && braceCount === 0 && j > i + 2) break;
          }
        }

        // P2 閾值調整：
        // - 提高到 5 個 console.log（原本是 2）
        // - 短函數（< 20 行）豁免，因為有少量 console.log 係正常
        const isShortFunc = funcLineCount < 20;
        if (isShortFunc) continue; // 短函據完全豁免

        if (consoleLogCount >= 5 && !hasQuiet) {
          found.push({ line: i + 1, func: funcName, count: consoleLogCount });
        }
      }
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.func}() 有 ${f.count} 處 console.log 但冇 quiet 參據`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'warning',
        suggestion: '大量輸出的 function 應加 quiet 參據抑制輸出',
      };
    },
  },

  // ============================================================
  // Rule 11: magic-string-in-function
  // ============================================================
  {
    id: 'magic-string-in-function',
    name: 'Function 內 hardcoded 魔術據值/字串',
    category: 'logic',
    severity: 'medium',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      const magicPattern = /['"]1473384999[0-9]{6}['"]/;
      const ipPattern = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
      const portPattern = /:\d{4,5}/;

      // 引入 skip-list helper 進行 style preference 過濾
      let isStylePreference;
      try {
        const skipList = require('../helpers/skip-list');
        isStylePreference = skipList.isStylePreference;
      } catch {
        isStylePreference = () => false;
      }

      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (trimmed.startsWith('const ') && trimmed.includes('=')) return;

        // 檢查是否為魔術數值/字串
        const hasMagicNumber = magicPattern.test(line);
        const hasIpPattern = ipPattern.test(line) && !line.includes('//');
        const hasPortPattern = portPattern.test(line) && /\btarget\b|\bchannel\b|\bport\b/i.test(line);

        if (hasMagicNumber || hasIpPattern || hasPortPattern) {
          // 檢查是否為已知的 style preference（過濾 false positive）
          const matchedStr = hasMagicNumber ? line.match(magicPattern)?.[0] :
                              hasIpPattern ? line.match(ipPattern)?.[0] :
                              line.match(portPattern)?.[0];

          if (isStylePreference(matchedStr || '', line)) {
            return; // 跳過已知的 style preference 值
          }

          found.push({ line: i + 1, detail: line.trim().substring(0, 60) });
        }
      });
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.detail}${f.detail.length > 60 ? '...' : ''}`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'warning',
        suggestion: '魔術據值/字串應提升到 CONFIG 區域作為常量',
      };
    },
  },

  // ============================================================
  // Rule 12: python-hardcoded-uuid
  // ============================================================
  {
    id: 'python-hardcoded-uuid',
    name: 'Python 檔案含 hardcoded UUID',
    category: 'logic',
    severity: 'high',
    detect(content, filePath) {
      if (!filePath.endsWith('.py')) return { found: false };
      const lines = content.split('\n');
      const found = [];
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('*')) return;
        if (uuidPattern.test(line)) {
          found.push({ line: i + 1, detail: line.trim().substring(0, 60) });
        }
      });
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.detail}`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'high',
        suggestion: 'UUID 應外部化到 config 或環境變量',
      };
    },
  },

  // ============================================================
  // Rule 13: python-hardcoded-paths
  // ============================================================
  {
    id: 'python-hardcoded-paths',
    name: 'Python 檔案含 /Users/xxx 路徑',
    category: 'logic',
    severity: 'high',
    detect(content, filePath) {
      if (!filePath.endsWith('.py')) return { found: false };
      const lines = content.split('\n');
      const found = [];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('*')) return;
        if (/\/Users\/\w+/.test(line) || /\/home\/\w+/.test(line)) {
          found.push({ line: i + 1, detail: line.trim().substring(0, 60) });
        }
      });
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.detail}`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'high',
        suggestion: 'Python 檔案路徑應使用 ~/ 或環境變量',
      };
    },
  },

  // ============================================================
  // Rule 14: silent-fail-env
  // ============================================================
  {
    id: 'silent-fail-env',
    name: '環境變量缺失導致靜默失敗',
    category: 'logic',
    severity: 'high',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.includes('${') && trimmed.includes(':-') && !trimmed.includes('echo') && !trimmed.includes('if') && !trimmed.includes('exit')) {
          if (/^\w+=\$\{/.test(trimmed) || /^\w+=\${/.test(trimmed)) {
            let hasCheck = false;
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
              if (lines[j].includes('if [ -z') || lines[j].includes('echo "❌') || lines[j].includes('exit 1')) {
                hasCheck = true;
                break;
              }
            }
            if (!hasCheck) {
              found.push({ line: i + 1, detail: trimmed.substring(0, 60) });
            }
          }
        }
      });
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.detail}`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'high',
        suggestion: 'Bash script 應檢查環境變量是否已設定，未設定則立即退出',
      };
    },
  },

  // ============================================================
  // Rule 15: hardcoded-node-path
  // ============================================================
  {
    id: 'hardcoded-node-path',
    name: 'exec/Spawn 使用 hardcoded node 路徑',
    category: 'logic',
    severity: 'high',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;
      const lines = content.split('\n');
      const found = [];
      const nodePathPattern = /\/(opt\/homebrew|usr\/local)\/bin\/node/;
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (nodePathPattern.test(line)) {
          found.push({ line: i + 1, detail: trimmed.substring(0, 60) });
        }
      });
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.detail}`).join('\n    '),
        lines: found.map(f => f.line),
        severity: 'high',
        suggestion: '改用 process.execPath（Node.js）或動態獲取 node 路徑',
      };
    },
  },

  // ============================================================
  // Rule 16: missing-atomic-write
  // ============================================================
  {
    id: 'missing-atomic-write',
    name: '檔案寫入缺少 atomic write 保護',
    category: 'logic',
    severity: 'medium',
    detect(content, filePath) {
      const skip = skipIfRuleDef(filePath);
      if (skip) return skip;

      const h = getHelpers();
      if (h.hasAtomicWriteHelper?.(content)) {
        return { found: false, details: '', lines: [], severity: 'medium' };
      }

      const lines = content.split('\n');
      const found = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (!/writeFileSync\s*\(/.test(line)) continue;

        // ============================================================
        // P1 Atomic Write 準確識別：識別 tmp+rename pattern
        // ============================================================
        // Pattern 1: tmpPath / tmpFile / tempPath + renameSync(target)
        // 例如: fs.writeFileSync(tmpPath, data); fs.renameSync(tmpPath, filePath);
        const tmpVarMatch = line.match(/writeFileSync\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (tmpVarMatch) {
          const varName = tmpVarMatch[1];
          // 檢查這行是否是 tmp/temp 類型的變量
          const isTmpVar = /\b(tmp|temp|backup|bak|cache|cached)[A-Za-z0-9_$]*\b/i.test(varName);
          if (isTmpVar) {
            // 這是 tmp 寫入，後面一定會跟 rename，豁免
            continue;
          }
          // 如果不是 tmpvar，檢查後面 N 行是否有 renameSync(同樣的 var)
          let hasRename = false;
          for (let j = i; j < Math.min(i + 10, lines.length); j++) {
            if (lines[j].includes('renameSync') && lines[j].includes(varName)) {
              hasRename = true;
              break;
            }
          }
          if (hasRename) continue;
        }

        // Pattern 2: 直接寫入目標檔案（無 tmp）
        const directPathMatch = line.match(/writeFileSync\s*\(\s*['"]([^'"]+)['"]/);
        if (directPathMatch) {
          const targetPath = directPathMatch[1];
          // 排除明顯係 cache/config 的檔案（經常覆寫，不需 atomic）
          if (/\.(json|tmp|bak|cache|lock|log)$/i.test(targetPath)) continue;
          // 小檔案豁免：flag/tracker/heartbeat/status/report/temp/tmp/cache
          if (/[\/-](?:flag|tracker|heartbeat|status)\b/i.test(targetPath)) continue;
          if (/[\/-](?:report|temp|tmp|cache)[\/-]/i.test(targetPath)) continue;
          // 排除明確標記為 atomic 的 helper
          if (line.includes('atomic')) continue;
          // 檢查後面是否有 renameSync
          let hasRename = false;
          for (let j = i; j < Math.min(i + 10, lines.length); j++) {
            if (lines[j].includes('renameSync') && lines[j].includes(targetPath)) {
              hasRename = true;
              break;
            }
          }
          if (hasRename) continue;
          // 檢查上下文 - 如果前幾行有建立 tmpPath
          let contextHasTmp = false;
          for (let k = Math.max(0, i - 5); k < i; k++) {
            if (/tmpPath|tmpFile|tempPath|backupPath/i.test(lines[k])) {
              contextHasTmp = true;
              break;
            }
          }
          if (contextHasTmp) continue;
        }

        // ============================================================
        // P1 New: 如果這行已經被 try-catch 包圍，跳過（try-catch 已經提供基本保護）
        // ============================================================
        if (h.isProtectedByTry?.(lines, i, filePath)) {
          continue;
        }

        // 未被豁免，加入 found
        const contextBefore = lines.slice(Math.max(0, i - 3), i);
        const contextAfter = lines.slice(i + 1, Math.min(lines.length, i + 4));
        found.push({
          line: i + 1,
          detail: trimmed.substring(0, 60),
          context: { before: contextBefore, current: trimmed, after: contextAfter },
        });
      }
      return {
        found: found.length > 0,
        details: found.map(f => `L${f.line}: ${f.detail}`).join('\n    '),
        lines: found.map(f => f.line),
        context: found.map(f => f.context),
        severity: 'medium',
        suggestion: '重要檔案寫入應使用 atomic write（先寫 .tmp 再 rename）防止 crash 時據據損壞',
      };
    },
  },

  // ============================================================
  // Rule 17: duplicate-hkt-date-helper
  // ============================================================
  {
    id: 'duplicate-hkt-date-helper',
    name: '重複 HKT 時間 Helper 定義',
    category: 'code-duplication',
    severity: 'high',
    detect(content, filePath) {
      if (filePath && filePath.includes('lib/time')) return { found: false };
      const re = /function\s+getHKT(Date|DateTime|Time)\s*\(/g;
      const matches = [];
      let m;
      while ((m = re.exec(content))) {
        const line = content.substring(0, m.index).split('\n').length;
        matches.push({ line, detail: `本地定義 getHKT${m[1]}，應使用 lib/time.js` });
      }
      return {
        found: matches.length > 0,
        details: matches.map(f => `L${f.line}: ${f.detail}`).join('\n    '),
        lines: matches.map(f => f.line),
        severity: 'high',
        suggestion: '刪除本地定義，改為 require(\'./lib/time\')',
      };
    },
  },

  // ============================================================
  // Rule 18: duplicate-load-save-state
  // ============================================================
  {
    id: 'duplicate-load-save-state',
    name: '重複 loadState/saveState 定義',
    category: 'code-duplication',
    severity: 'high',
    detect(content, filePath) {
      if (filePath && filePath.includes('lib/state')) return { found: false };
      const re = /function\s+(loadState|saveState)\s*\(/g;
      const matches = [];
      let m;
      while ((m = re.exec(content))) {
        const line = content.substring(0, m.index).split('\n').length;
        matches.push({ line, detail: `本地定義 ${m[1]}，應使用 lib/state.js` });
      }
      return {
        found: matches.length > 0,
        details: matches.map(f => `L${f.line}: ${f.detail}`).join('\n    '),
        lines: matches.map(f => f.line),
        severity: 'high',
        suggestion: '刪除本地定義，改為 require(\'./lib/state\')',
      };
    },
  },
];

module.exports = {
  HIGH_RISK_RULES,
};
