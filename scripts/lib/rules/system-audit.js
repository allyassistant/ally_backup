/**
 * scripts/lib/rules/system-audit.js
 *
 * 系統審計規則
 *
 * 位置：auto_fix.js 原 Lines 1100-1600
 *
 * 獨立於檔案掃描流程，對整個 scripts/ 目錄執行全面檢查
 *
 * 審計項目：
 *   1. 語法檢查 (JS .sh)
 *   2. Hardcoded Paths 檢測
 *   3. Cron Job Script Existence 檢查
 *   4. Cron Job Hardcoded Date 檢測
 *   5. Dangling References 檢查
 *   6. Module Not Found 檢查
 *   7. Filename Pattern Mismatch 檢查
 *   8. Git Push Without Approval 檢查
 *   9. Disk Check Path Error 檢查
 *  10. Missing Helper Function 檢查
 *  11. Sync in Async 檢查
 *  12. Infinite Loop Risk 檢查
 *
 * 依賴：
 *   - lib/config (HOME, SCRIPTS_DIR)
 *   - ../helpers/file-cache (getFileContent)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

let config;
try {
  config = require('../config');
} catch {
  const homeDir = process.env.HOME || os.homedir();
  config = { HOME: homeDir, WS: path.join(homeDir, '.openclaw', 'workspace'), SCRIPTS_DIR: path.join(homeDir, '.openclaw', 'workspace', 'scripts') };
}

const { HOME, WS, SCRIPTS_DIR } = config;

// 動態引入（避免循環依賴）
let fileCache = null;
function getFileContent(filePath) {
  if (!fileCache) {
    try {
      fileCache = require('../helpers/file-cache');
    } catch {
      // Fallback: 直接讀取
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { content, lines: content.split('\n') };
      } catch {
        return { content: '', lines: [] };
      }
    }
  }
  return fileCache.getFileContent?.(filePath) || { content: '', lines: [] };
}

// 自我排除：避免審計自己
const SELF_EXCLUDE = ['auto_fix.js'];

/**
 * 系統審計 — 對整個 scripts/ 目錄執行全面檢查
 *
 * 位置：auto_fix.js 原 Lines 1100-1600
 *
 * @param {Object} options - 選項
 * @param {string} options.scriptsDir - scripts 目錄路徑
 * @returns {Object} - 審計結果
 */
function runSystemAudit(options = {}) {
  const scriptsDir = options.scriptsDir || SCRIPTS_DIR;

  const results = {
    syntax: { js: [], sh: [], ok: true },
    hardcodedPaths: [],
    cronMissing: [],
    cronHardcodedDates: [],
    danglingRefs: [],
    moduleNotFound: [],
    filenamePatternMismatch: [],
    gitPushWithoutApproval: [],
    diskCheckPathError: [],
    missingHelper: [],
    syncInAsync: [],
    infiniteLoopRisk: [],
    otherIssues: [],
  };

  // 收集所有 script 檔案
  const allFiles = [];
  const auditExtensions = ['.js', '.mjs', '.cjs', '.sh', '.bash'];
  const auditExcludeDirs = ['node_modules', '.git', 'archive', '__pycache__', 'auto-router'];

  function collectFiles(dir, depth) {
    if (depth > 2) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (auditExcludeDirs.includes(entry.name)) continue;
          collectFiles(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (auditExtensions.includes(ext)) {
            allFiles.push(fullPath);
          }
        }
      }
    } catch { /* ignore */ }
  }
  collectFiles(scriptsDir, 0);

  const jsFiles = allFiles.filter(f => ['.js', '.mjs', '.cjs'].includes(path.extname(f)));
  const shFiles = allFiles.filter(f => ['.sh', '.bash'].includes(path.extname(f)));

  // ── 1. 語法檢查 ──
  // (見原 Lines 1125-1145)
  for (const file of jsFiles) {
    try {
      execFileSync('node', ['--check', file], { stdio: 'pipe', timeout: 10000 });
    } catch (e) {
      const stderr = (e.stderr || '').toString().trim();
      results.syntax.js.push({
        file: path.relative(WS, file),
        error: stderr.split('\n').slice(0, 3).join('\n'),
      });
      results.syntax.ok = false;
    }
  }
  for (const file of shFiles) {
    try {
      execFileSync('bash', ['-n', file], { stdio: 'pipe', timeout: 10000 });
    } catch (e) {
      const stderr = (e.stderr || '').toString().trim();
      results.syntax.sh.push({
        file: path.relative(WS, file),
        error: stderr.split('\n').slice(0, 3).join('\n'),
      });
      results.syntax.ok = false;
    }
  }

  // ── 2. Hardcoded Paths 檢測 ──
  // (見原 Lines 1148-1175)
  const HARDCODED_USERS = ['ally', 'bliss'];
  const hardcodedPattern = new RegExp(`/Users/(?:${HARDCODED_USERS.join('|')})/`, 'g');

  for (const file of allFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const { content, lines } = getFileContent(file);
    if (!content) continue;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return;
      if (hardcodedPattern.test(line)) {
        hardcodedPattern.lastIndex = 0;
        const ext = path.extname(file);
        const dollarSign = String.fromCharCode(36);
        const suggestion = ['.sh', '.bash'].includes(ext)
          ? '改用 ' + dollarSign + 'HOME'
          : '改用 process.env.HOME';
        results.hardcodedPaths.push({
          file: path.relative(WS, file),
          line: i + 1,
          content: trimmed.substring(0, 120),
          suggestion,
        });
      }
      hardcodedPattern.lastIndex = 0;
    });
  }

  // ── 3. Cron Job Script Existence 檢查 ──
  // (見原 Lines 1178-1200)
  try {
    const crontab = execSync('crontab -l 2>/dev/null', { stdio: 'pipe', timeout: 5000 }).toString();
    const cronLines = crontab.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    for (const line of cronLines) {
      const pathMatches = line.match(/(?:\/[\w.~${}()-]+)+\.(?:js|sh|py|bash)\b/g);
      if (pathMatches) {
        for (const p of pathMatches) {
          const dSign = String.fromCharCode(36);
          const expanded = p
            .replace(/^~/, HOME)
            .split(dSign + 'HOME').join(HOME)
            .split(dSign + '{HOME}').join(HOME);
          if (!fs.existsSync(expanded)) {
            results.cronMissing.push({
              cronLine: line.trim().substring(0, 150),
              scriptPath: p,
              expandedPath: expanded,
            });
          }
        }
      }
    }
  } catch (e) {
    const msg = (e.message || '') + ((e.stderr || '').toString());
    if (!msg.includes('no crontab')) {
      // 靜默略過無 crontab 的情況
    }
  }

  // ── 3b. Cron Job Hardcoded Date 檢測 ──
  // (見原 Lines 1203-1235)
  const datePattern = /\d{4}-\d{2}-\d{2}/g;
  try {
    const crontab2 = execSync('crontab -l 2>/dev/null', { stdio: 'pipe', timeout: 5000 }).toString();
    crontab2.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('#')) return;
      const matches = line.match(datePattern);
      if (matches) {
        for (const dateStr of matches) {
          results.cronHardcodedDates.push({
            source: 'crontab',
            line: i + 1,
            cronLine: line.trim().substring(0, 150),
            date: dateStr,
            suggestion: '用動態日期代替硬編碼日期，例如 $(date +%Y-%m-%d)',
          });
        }
      }
    });
  } catch { /* ignore */ }

  // 3b-ii: OpenClaw cron jobs.json
  const CRON_JOBS_JSON = path.join(HOME, '.openclaw', 'cron', 'jobs.json');
  try {
    if (fs.existsSync(CRON_JOBS_JSON)) {
      const cronData = JSON.parse(fs.readFileSync(CRON_JOBS_JSON, 'utf-8'));
      for (const job of (cronData.jobs || [])) {
        const payload = job.payload || {};
        const fieldsToCheck = [
          { key: 'text', value: payload.text || '' },
          { key: 'message', value: payload.message || '' },
        ];
        for (const field of fieldsToCheck) {
          const matches = field.value.match(datePattern);
          if (matches) {
            for (const dateStr of matches) {
              results.cronHardcodedDates.push({
                source: `OpenClaw cron: ${job.name || job.id}`,
                jobId: job.id,
                jobName: job.name,
                enabled: job.enabled,
                field: `payload.${field.key}`,
                content: field.value.substring(0, 200),
                date: dateStr,
                suggestion: '移除硬編碼日期，改用動態生成',
              });
            }
          }
        }
      }
    }
  } catch { /* ignore */ }

  // ── 4. Dangling References 檢查 ──
  // (見原 Lines 1240-1290)
  const existingFiles = new Set();
  for (const f of allFiles) existingFiles.add(path.basename(f));
  try {
    const topEntries = fs.readdirSync(scriptsDir);
    for (const e of topEntries) existingFiles.add(e);
  } catch { /* ignore */ }

  for (const file of jsFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const { content, lines } = getFileContent(file);
    if (!content) continue;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      // require('./xxx') 或 require('../xxx')
      const requireMatches = line.match(/require\s*\(\s*['"`](\.[^'"`]+)['"`]\s*\)/g);
      if (requireMatches) {
        for (const rm of requireMatches) {
          const inner = rm.match(/['"`](\.[^'"`]+)['"`]/);
          if (inner) {
            let refPath = inner[1];
            if (!path.extname(refPath)) refPath += '.js';
            const resolved = path.resolve(path.dirname(file), refPath);
            try {
              if (!fs.existsSync(resolved)) {
                results.danglingRefs.push({
                  file: path.relative(WS, file),
                  line: i + 1,
                  ref: path.basename(refPath),
                  resolvedPath: path.relative(WS, resolved),
                });
              }
            } catch (e) {
              // Ignore fs errors
            }
          }
        }
      }

      // Skip require() statements (handled by Module Not Found check)
      // Fix: skip all lines containing require( to avoid false positives
      const isRequireLine = /require\s*\(/.test(line);

      // 'scripts/xxx.js' 字串引用
      if (!isRequireLine) {
        const scriptRefMatches = line.match(/['"`]((?:scripts\/)?[\w.-]+\.(?:js|sh))['"`]/g);
        if (scriptRefMatches) {
          for (const srm of scriptRefMatches) {
            const inner = srm.replace(/['"`]/g, '');
            const basename = path.basename(inner);
            if ((basename.includes('_') || basename.includes('-')) && basename !== path.basename(file)) {
              if (!existingFiles.has(basename)) {
                const already = results.danglingRefs.some(
                  d => d.file === path.relative(WS, file) && d.ref === basename
                );
                if (!already) {
                  results.danglingRefs.push({
                    file: path.relative(WS, file),
                    line: i + 1,
                    ref: basename,
                    resolvedPath: `scripts/${basename} (不存在)`,
                  });
                }
              }
            }
          }
        }
      }
    });
  }

  // ── 5. Module Not Found ──
  // (見原 Lines 1293-1320)
  for (const file of jsFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const { content, lines } = getFileContent(file);
    if (!content) continue;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      const requirePattern = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
      let match;
      while ((match = requirePattern.exec(line)) !== null) {
        const modulePath = match[1];
        if (!modulePath.startsWith('.')) continue;

        let resolved = modulePath;
        if (!path.extname(resolved)) resolved += '.js';
        const fullResolved = path.resolve(path.dirname(file), resolved);

        try {
          if (!fs.existsSync(fullResolved)) {
            const indexPath = path.resolve(path.dirname(file), modulePath, 'index.js');
            const jsonPath = path.resolve(path.dirname(file), modulePath + '.json');
            if (!fs.existsSync(indexPath) && !fs.existsSync(jsonPath)) {
              results.moduleNotFound.push({
                file: path.relative(WS, file),
                line: i + 1,
                require: modulePath,
                resolvedPath: path.relative(WS, fullResolved),
                suggestion: '確認模組路徑正確，或移除無用的 require 引用',
              });
            }
          }
        } catch (e) {
          // Ignore fs errors
        }
      }
    });
  }

  // ── 6. Filename Pattern Mismatch ──
  // (見原 Lines 1323-1350)
  for (const file of allFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const { content, lines } = getFileContent(file);
    if (!content) continue;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) return;

      const filenamePatterns = [
        /\\d\{4\}-\\d\{2\}-\\d\{2\}\\?\.md(?!.*\\d\{2,4\})/,
        /\d{4}-\d{2}-\d{2}\.md['"`)\]]/,
      ];
      for (const fp of filenamePatterns) {
        if (fp.test(line)) {
          if (/HHMM|HHmm|hhmm|timestamp|\d{4}-\d{2}-\d{2}-\d{2,4}/.test(line)) continue;
          if (/l0|l1|abstract|overview/i.test(line)) continue;
          results.filenamePatternMismatch.push({
            file: path.relative(WS, file),
            line: i + 1,
            content: trimmed.substring(0, 120),
            suggestion: 'Filename pattern 可能漏了 timestamp，考慮用 YYYY-MM-DD-HHMM.md',
          });
          break;
        }
      }
    });
  }

  // ── 7. Git Push Without Approval ──
  // (見原 Lines 1353-1375)
  for (const file of allFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const { content, lines } = getFileContent(file);
    if (!content) continue;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) return;

      if (/git\s+push\b/.test(line)) {
        let hasApproval = false;
        for (let j = Math.max(0, i - 15); j <= Math.min(lines.length - 1, i + 5); j++) {
          if (/confirm|approve|approval|批準|ask|prompt|確認|isDryRun|dry.?run/i.test(lines[j])) {
            hasApproval = true;
            break;
          }
        }
        if (!hasApproval) {
          results.gitPushWithoutApproval.push({
            file: path.relative(WS, file),
            line: i + 1,
            content: trimmed.substring(0, 120),
            suggestion: 'Git push 可能未經批準，建議加入確認邏輯（confirm/approve）',
          });
        }
      }
    });
  }

  // ── 8. Disk Check Path Error ──
  // (見原 Lines 1378-1395)
  for (const file of allFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const { content, lines } = getFileContent(file);
    if (!content) continue;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      const dollarSign = String.fromCharCode(36);
      if (/df\s+-h\s+~/.test(line) ||
          line.includes('df -h ' + dollarSign + 'HOME') ||
          line.includes('df -h ' + dollarSign + '{HOME}')) {
        results.diskCheckPathError.push({
          file: path.relative(WS, file),
          line: i + 1,
          content: trimmed.substring(0, 120),
          suggestion: 'Disk check 路徑可能錯誤，df -h ~ 只檢查 home directory，應該用 df -h / 檢查根分區',
        });
      }
    });
  }

  // ── 10. Missing Helper Function ──
  // (見原 Lines 1400-1460)
  for (const file of jsFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      const definedFuncs = new Set();
      const funcDefRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(|[a-z]))/g;
      let defMatch;
      while ((defMatch = funcDefRegex.exec(content)) !== null) {
        const name = defMatch[1] || defMatch[2];
        if (name) definedFuncs.add(name);
      }

      const requireDefRegex = /(?:const|let|var)\s*\{\s*([^}]+)\}\s*=\s*require\s*\(/g;
      let reqMatch;
      while ((reqMatch = requireDefRegex.exec(content)) !== null) {
        const names = reqMatch[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop().trim());
        names.forEach(n => { if (n) definedFuncs.add(n); });
      }

      const builtins = new Set([
        'require', 'console', 'process', 'Buffer', 'setTimeout', 'setInterval',
        'clearTimeout', 'clearInterval', 'JSON', 'Math', 'Date', 'Array',
        'Object', 'String', 'Number', 'Boolean', 'RegExp', 'Error', 'Map',
        'Set', 'Promise', 'Symbol', 'parseInt', 'parseFloat', 'isNaN',
        'isFinite', 'encodeURI', 'decodeURI', 'encodeURIComponent',
        'decodeURIComponent', '__dirname', '__filename', 'module', 'exports',
        'global', 'queueMicrotask', 'structuredClone', 'fetch', 'URL',
        'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController',
        'EventEmitter', 'describe', 'it', 'test', 'expect', 'beforeEach',
        'afterEach', 'beforeAll', 'afterAll',
        // Date methods
        'getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds',
        'getMinutes', 'getMonth', 'getSeconds', 'getTime', 'getTimezoneOffset',
        'getUTCDate', 'getUTCDay', 'getUTCFullYear', 'getUTCHours',
        'getUTCMilliseconds', 'getUTCMinutes', 'getUTCMonth', 'getUTCSeconds',
        'toDateString', 'toISOString', 'toJSON', 'toLocaleDateString',
        'toLocaleTimeString', 'toLocaleString', 'toTimeString', 'toUTCString',
        'setDate', 'setDay', 'setFullYear', 'setHours', 'setMilliseconds',
        'setMinutes', 'setMonth', 'setSeconds', 'setTime',
        'setUTCDate', 'setUTCDay', 'setUTCFullYear', 'setUTCHours',
        'setUTCMilliseconds', 'setUTCMinutes', 'setUTCMonth', 'setUTCSeconds',
        // String methods
        'charAt', 'charCodeAt', 'codePointAt', 'concat', 'endsWith',
        'includes', 'indexOf', 'lastIndexOf', 'localeCompare', 'match',
        'matchAll', 'normalize', 'padEnd', 'padStart', 'repeat',
        'replace', 'replaceAll', 'search', 'slice', 'split', 'startsWith',
        'substring', 'toLowerCase', 'toUpperCase', 'trim', 'trimEnd', 'trimStart',
        'valueOf', 'toString',
        // Array methods
        'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat',
        'every', 'filter', 'find', 'findIndex', 'flat', 'flatMap', 'forEach',
        'includes', 'indexOf', 'join', 'keys', 'lastIndexOf', 'map', 'reduce',
        'reduceRight', 'reverse', 'some', 'sort', 'values', 'entries',
        'fill', 'copyWithin', 'findLast', 'findLastIndex',
        // Object methods
        'assign', 'create', 'defineProperty', 'defineProperties', 'freeze',
        'fromEntries', 'getOwnPropertyDescriptor', 'getOwnPropertyNames',
        'getPrototypeOf', 'hasOwn', 'hasOwnProperty', 'is', 'isExtensible',
        'isFrozen', 'isSealed', 'preventExtensions', 'seal', 'setPrototypeOf',
        // JSON methods
        'stringify', 'parse',
        // Number methods
        'toFixed', 'toExponential', 'toPrecision', 'toString',
        // path helpers (commonly called)
        'join', 'resolve', 'basename', 'dirname', 'extname', 'relative',
        'isAbsolute', 'normalize', 'parse', 'format',
        // fs helpers
        'existsSync', 'readFileSync', 'writeFileSync', 'readdirSync',
        'mkdirSync', 'statSync', 'lstatSync', 'readFile', 'writeFile',
        'readdir', 'mkdir', 'stat', 'lstat', 'unlink', 'rmdir', 'rename',
        'copyFile', 'appendFile', 'access', 'realpath',
        // Common utils
        'join', 'format', 'escape', 'unescape', 'trim', 'random',
        // HTTP/network/EventEmitter
        'write', 'end', 'on', 'once', 'emit', 'listen', 'close', 'listen',
        'get', 'post', 'put', 'delete', 'request', 'createServer',
        // RegExp/test utilities
        'test', 'exec', 'match', 'compile',
        // Stream
        'pipe', 'write', 'read', 'push', 'pull',
        // Crypto
        'createHash', 'createCipher', 'createDecipher', 'randomBytes',
        'pbkdf2', 'createHmac', 'createSign', 'createVerify',
        // Other common methods
        'then', 'catch', 'finally', 'resolve', 'reject',
        'call', 'apply', 'bind', 'length', 'name', 'prototype',
        'add', 'delete', 'has', 'get', 'set', 'clear',
      ]);

      const helperCallRegex = /\b((?:[a-z]+Helper|get[A-Z]\w+|parse[A-Z]\w+|format[A-Z]\w+|build[A-Z]\w+))\s*\(/g;
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/(?:function\s|const\s|let\s|var\s)/.test(trimmed) && !/=\s*\w+Helper\s*\(/.test(trimmed)) return;

        let callMatch;
        helperCallRegex.lastIndex = 0;
        while ((callMatch = helperCallRegex.exec(line)) !== null) {
          const funcName = callMatch[1];
          if (definedFuncs.has(funcName)) continue;
          if (builtins.has(funcName)) continue;
          const charBefore = line.charAt(callMatch.index - 1);
          if (charBefore === '.') continue;

          results.missingHelper.push({
            file: path.relative(WS, file),
            line: i + 1,
            funcName,
            content: trimmed.substring(0, 120),
            suggestion: `確認 ${funcName}() 已定義或正確引入，否則會 ReferenceError`,
          });
        }
      });
    } catch { /* ignore */ }
  }

  // ── 11. Sync in Async ──
  // (見原 Lines 1463-1505)
  // Note: Severity reduced to info because sync calls in async functions are
  // common and often intentional (e.g., for atomicity, config loading, etc.)
  for (const file of allFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const ext = path.extname(file);
    if (!['.js', '.mjs', '.cjs'].includes(ext)) continue;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      let inAsyncFunc = false;
      let asyncFuncName = '';
      let asyncFuncStartBraceDepth = -1; // Track the brace depth when async func starts

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        const asyncMatch = trimmed.match(/async\s+function\s+(\w+)|(\w+)\s*=\s*async\s*(?:\(|function)/);
        if (asyncMatch && !inAsyncFunc) {
          inAsyncFunc = true;
          asyncFuncName = asyncMatch[1] || asyncMatch[2] || '(anonymous)';
          // Count all braces in the function declaration line
          // We'll find the opening { brace depth when we encounter it
          asyncFuncStartBraceDepth = -1; // unknown yet
          continue;
        }

        if (inAsyncFunc) {
          // Track when we first see the opening brace for this async function
          if (asyncFuncStartBraceDepth < 0) {
            let currentDepth = 0;
            for (const ch of line) {
              if (ch === '{') {
                currentDepth++;
                asyncFuncStartBraceDepth = currentDepth;
                break;
              }
              if (ch === '}') currentDepth--;
            }
            // If no { found on this line and start depth still unknown, keep looking
          }

          // Check for Sync calls (but skip .existsSync which is fine)
          if (/Sync\s*\(/.test(line) && !/\.existsSync/.test(line)) {
            const syncMatch = line.match(/(\w+Sync)\s*\(/);
            if (syncMatch) {
              results.syncInAsync.push({
                file: path.relative(WS, file),
                line: i + 1,
                asyncFunc: asyncFuncName,
                syncCall: syncMatch[1],
                content: trimmed.substring(0, 120),
                severity: 'info', // Lowered from warning - common pattern
                suggestion: `在 async function ${asyncFuncName}() 中用 ${syncMatch[1].replace('Sync', '')} (async 版本) 代替 ${syncMatch[1]}（如需要並發）`,
              });
            }
          }

          // Exit async function when we've seen its closing brace
          // We exit when brace depth drops back to or below the start depth
          if (asyncFuncStartBraceDepth > 0) {
            let currentDepth = asyncFuncStartBraceDepth;
            for (const ch of line) {
              if (ch === '{') currentDepth++;
              if (ch === '}') currentDepth--;
            }
            if (currentDepth <= asyncFuncStartBraceDepth && !/async\s+function/.test(line)) {
              inAsyncFunc = false;
              asyncFuncName = '';
              asyncFuncStartBraceDepth = -1;
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // ── 12. Infinite Loop Risk ──
  // (見原 Lines 1508-1550)
  for (const file of allFiles) {
    if (SELF_EXCLUDE.includes(path.basename(file))) continue;
    const ext = path.extname(file);
    if (!['.js', '.mjs', '.cjs'].includes(ext)) continue;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        const isInfiniteLoop =
          /while\s*\(\s*true\s*\)/.test(line) ||
          /while\s*\(\s*1\s*\)/.test(line) ||
          /for\s*\(\s*;\s*;\s*\)/.test(line);

        if (!isInfiniteLoop) continue;

        let hasExit = false;
        let loopBraceDepth = 0;
        let loopStarted = false;

        for (let j = i; j < Math.min(lines.length, i + 100); j++) {
          for (const ch of lines[j]) {
            if (ch === '{') { loopBraceDepth++; loopStarted = true; }
            if (ch === '}') loopBraceDepth--;
          }
          if (loopStarted && loopBraceDepth <= 0) break;
          if (j > i && /\b(break|return|throw|process\.exit)\b/.test(lines[j])) {
            hasExit = true;
            break;
          }
        }

        if (!hasExit) {
          results.infiniteLoopRisk.push({
            file: path.relative(WS, file),
            line: i + 1,
            content: trimmed.substring(0, 120),
            suggestion: '無限循環冇 break/return/throw，可能導致程式掛起',
          });
        }
      }
    } catch { /* ignore */ }
  }

  return results;
}

module.exports = {
  runSystemAudit,
};
