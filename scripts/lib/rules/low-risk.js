/**
 * scripts/lib/rules/low-risk.js
 * LOW_RISK_RULES - 自動修復規則
 */

const path = require('path');
const fs = require('fs');
const { buildTryBlockMap } = require('../audit/try-block-map');

let HOME;
try {
  ({ HOME } = require('../config'));
} catch {
  HOME = process.env.HOME || '/Users/ally';
}

/**
 * 簡體→繁體映射
 * 格式：[簡體, 繁體]
 * 從外部 JSON 文件載入，避免字符腐化問題
 */
let _simpMap = null;
function getSimplifiedMap() {
  if (_simpMap) return _simpMap;
  try {
    _simpMap = require('../simp_trad_map.json');
  } catch (e) {
    _simpMap = [];
  }
  return _simpMap;
}

/**
 * Check if a line is inside a markdown code block (``` ... ```).
 */
function isInsideMarkdownCodeBlock(lines, lineIdx) {
  let depth = 0;
  for (let i = 0; i < lineIdx; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Match ``` or backslash-escaped \`\`\` (documentation examples)
    const hasOpening = trimmed.startsWith('\`\`\`') || trimmed.startsWith('* \`\`\`') || trimmed.startsWith('\\\`\\\`\\\`');
    if (hasOpening) depth++;
  }
  return depth % 2 === 1;
}

/**
 * Detect "intentional empty" markers in catch body comments.
 *
 * Two-tier heuristic:
 *   Tier 1 — Explicit markers (codebase convention): `/* ignore *\/`,
 *     `/* noop *\/`, `/* silent *\/`, `/* intentional *\/`, `/* best effort *\/`,
 *     `/* non-critical *\/`, `// ignore`, `// noop`, `// intentional`. These
 *     are standardized markers meaning "I know this is empty and I'm OK
 *     with it".
 *   Tier 2 — Any explanatory comment: if the developer took the time to
 *     leave a comment (block or line) inside an empty catch, the catch is
 *     treated as intentionally documented. This catches Cantonese / mixed
 *     prose patterns like `/* git 可能不在 WS 根目錄 *\/` or
 *     `// stat failure handled below` that don't match the explicit markers
 *     but clearly indicate intent.
 *
 * The `no-empty-catch` rule's purpose is to flag SILENT error swallowing —
 * if there's a comment, it's not silent. So we err on the side of trusting
 * the developer's documentation.
 */
function hasIntentionalEmptyMarker(text) {
  if (!text) return false;

  // Tier 1: Explicit standardized markers
  const EXPLICIT_MARKERS = [
    /\/\*\s*ignore\s*\*\//i,
    /\/\*\s*ignore\s+errors?\s*\*\//i,
    /\/\*\s*no-?op\s*\*\//i,
    /\/\*\s*silent\s*\*\//i,
    /\/\*\s*intentional(?:ly)?(?:\s+empty)?\s*\*\//i,
    /\/\*\s*best[\s-]?effort\s*\*\//i,
    /\/\*\s*non[\s-]?critical\s*\*\//i,
    /\/\/\s*ignore\b/i,
    /\/\/\s*no-?op\b/i,
    /\/\/\s*intentional(?:ly)?(?:\s+empty)?\b/i,
  ];
  if (EXPLICIT_MARKERS.some(re => re.test(text))) return true;

  // Tier 2: Any block or line comment in the catch body indicates intent.
  // Whitespace-only catches fall through; anything with a comment is
  // considered documented and intentionally empty.
  if (/\/\*[\s\S]*?\*\//.test(text)) return true;
  if (/\/\/.*/.test(text)) return true;

  return false;
}

/**
 * Globals / constructors / Node.js built-ins that are guaranteed not undefined.
 * Adding ?. to chains rooted at these is harmless but adds noise, so the
 * `optional-chaining` rule skips them.
 */
const OPTIONAL_CHAINING_SAFE_ROOTS = new Set([
  // JS globals
  'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'Date', 'Promise', 'Buffer', 'console', 'Symbol', 'Error',
  'Reflect', 'globalThis', 'Intl', 'BigInt', 'Atomics',
  'SharedArrayBuffer', 'ArrayBuffer', 'DataView',
  // Browser globals (defensive — server code may still mention them)
  'window', 'document', 'navigator', 'location', 'history',
  // Built-in functions
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // Timers / microtasks
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  // Node.js module-level
  'process', 'require', 'module', 'exports', '__dirname', '__filename',
  // Common collection constructors
  'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp',
]);

/**
 * Check if position in line is inside a string literal (single/double/backtick quotes).
 * Returns true if odd number of quote characters appear before the position.
 */
function isInsideStringLiteral(line, pos) {
  const before = line.slice(0, pos);
  // Strip escaped quotes so 'it\'s' isn't counted as a closing quote.
  // Also handle \\. (line continuation, backslash before any char).
  const cleaned = before.replace(/\\./g, '');
  const sc = (cleaned.match(/'/g) || []).length;
  const dc = (cleaned.match(/"/g) || []).length;
  const bt = (cleaned.match(/`/g) || []).length;
  // Also treat regex literals as a separate lexical context: an odd number of
  // unescaped `/` before pos means we're inside a regex literal (e.g. `/foo.bar/`).
  const slashes = (cleaned.match(/\//g) || []).length;
  return sc % 2 === 1 || dc % 2 === 1 || bt % 2 === 1 || slashes % 2 === 1;
}

/**
 * Check if the match sits on the LHS of an assignment or for-loop binding.
 * Node v22+ rejects `obj?.a?.b?.c = value`, `+= -=`, `??= ||= &&=`,
 * and `for (obj?.a?.b?.c of items)` as SyntaxError.
 *
 * Heuristic: look at the chars between the END of the match and the next
 * statement boundary (semicolon / closing brace / end-of-line). If we see any
 * of these assignment operators or for/of/in keywords, the chain is LHS.
 *
 * Simpler check that catches everything: if the line CONTAINS an `=` (not part
 * of `==`, `===`, `!=`, `!==`, `=>`, `>=`, `<=`, `**=`, etc.) AFTER the match
 * position, AND there's no other complete statement before, treat as LHS.
 */
function isLhsAssignment(line, matchIndex, matchLength) {
  const tail = line.slice(matchIndex + matchLength);
  // Plain assignment: `obj.a.b = value`
  if (/^\s*=[^=]/.test(tail)) return true;
  // Compound assignment: += -= *= /= %= **= ??= ||= &&=
  if (/^\s*[+\-*/%][=]/.test(tail)) return true;
  if (/^\s*\*\*[=]/.test(tail)) return true;
  if (/^\s*\?\?[=]/.test(tail)) return true;
  if (/^\s*[|&][|&][=]/.test(tail)) return true;
  // for-of / for-in LHS: `for (obj.a.b of items)` — needs to detect ` of ` or ` in `
  // after the closing paren of for(...).
  if (/^\s+of\s+/.test(tail)) return true;
  if (/^\s+in\s+/.test(tail)) return true;
  return false;
}

const LOW_RISK_RULES = [
  {
    id: 'trailing-whitespace',
    name: '移除行尾空白',
    category: 'formatting',
    detect(content) {
      const lines = content.split('\n');
      const found = [];
      lines.forEach((line, i) => {
        if (/[ \t]+$/.test(line)) found.push(i + 1);
      });
      return { found: found.length > 0, details: `${found.length} 行有行尾空白`, lines: found };
    },
    fix(content) {
      return content.replace(/[ \t]+$/gm, '');
    },
  },
  {
    id: 'missing-eof-newline',
    name: '添加檔案末尾換行',
    category: 'formatting',
    detect(content) {
      const missing = content.length > 0 && !content.endsWith('\n');
      return { found: missing, details: missing ? '檔案末尾缺少換行符' : '', lines: missing ? [content.split('\n').length] : [] };
    },
    fix(content) {
      return content.endsWith('\n') ? content : content + '\n';
    },
  },
  {
    id: 'consecutive-blank-lines',
    name: '壓縮連續空行',
    category: 'formatting',
    detect(content) {
      const matches = content.match(/\n{4,}/g);
      return { found: !!matches, details: matches ? `${matches.length} 處有 3+ 連續空行` : '', lines: [] };
    },
    fix(content) {
      return content.replace(/\n{4,}/g, '\n\n\n');
    },
  },
  {
    id: 'hardcoded-home-path',
    name: '替換硬編碼路徑',
    category: 'bug',
    detect(content, filePath) {
      const ext = path.extname(filePath);
      const isJS = ['.js', '.mjs', '.cjs'].includes(ext);
      const isSh = ['.sh', '.bash', '.zsh'].includes(ext);
      if (!isJS && !isSh) return { found: false, details: '', lines: [] };
      const lines = content.split('\n');
      const found = [];
      const homeUser = path.basename(HOME);
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return;
        if (new RegExp(`/(?:Users|home)/${homeUser}/`, 'g').test(line)) found.push(i + 1);
      });
      return { found: found.length > 0, details: `${found.length} 行有硬編碼路徑`, lines: found };
    },
    fix(content, filePath) {
      const ext = path.extname(filePath);
      const isSh = ['.sh', '.bash', '.zsh'].includes(ext);
      const isJS = ['.js', '.mjs', '.cjs'].includes(ext);
      if (!isSh && !isJS) return null;
      const homeUser = path.basename(HOME);
      const lines = content.split('\n');
      const fixed = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*')) return line;
        return line.replace(new RegExp(`/(?:Users|home)/${homeUser}`, 'g'), String.fromCharCode(36) + 'HOME');
      });
      return fixed.join('\n');
    },
  },
  {
    id: 'missing-shebang',
    name: '添加 shebang 行',
    category: 'doc',
    detect(content, filePath) {
      const ext = path.extname(filePath);
      if (ext !== '.js') return { found: false, details: '', lines: [] };
      try {
        const stat = fs.statSync(filePath);
        const isExec = !!(stat.mode & 0o111);
        if (!isExec) return { found: false, details: '', lines: [] };
      } catch { return { found: false, details: '', lines: [] }; }
      const missing = !content.startsWith('#!');
      return { found: missing, details: missing ? '可執行 .js 檔案缺少 shebang' : '', lines: missing ? [1] : [] };
    },
    fix(content) {
      if (content.startsWith('#!')) return content;
      return '#!/usr/bin/env node\n' + content;
    },
  },
  {
    id: 'magic-numbers-safe',
    name: 'Magic Number → Named Const（安全版）',
    category: 'style',
    autoFixable: false,  // 2026-06-20: detection-only — manual extraction required (see rule docstring)
    // Why: extracting magic numbers to named constants requires semantic understanding
    // of what the number means. Generic name (e.g. NUM_1) wouldn't help. Better to surface
    // for human review than auto-fix incorrectly. Heuristic will propose instead of auto-fix.
    /**
     * Detect numbers that appear 2+ times in same file
     * and can be safely extracted to a named const.
     */
    detect(content, filePath) {
      // Find all 4+ digit standalone numbers (not in strings/comments)
      const lines = content.split('\n');
      const numberCounts = {};
      const numberLines = {};

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;
        // Skip lines that are template literal content or const definitions
        if (trimmed.startsWith('`') || /^\w+\s*[:=]/.test(trimmed) && !/^(const|let|var|return)/.test(trimmed)) continue;

        const matches = line.match(/\b(\d{4,})\b/g);
        if (!matches) continue;

        for (const num of matches) {
          if (!numberCounts[num]) {
            numberCounts[num] = 0;
            numberLines[num] = [];
          }
          numberCounts[num]++;
          numberLines[num].push(i + 1);
        }
      }

      // Only flag numbers appearing 2+ times
      const foundLines = [];
      for (const [num, count] of Object.entries(numberCounts)) {
        if (count >= 2) {
          foundLines.push(...numberLines[num]);
        }
      }

      return {
        found: foundLines.length > 0,
        details: `${foundLines.length} 個可提取 const 的 magic numbers（出現 2+ 次）`,
        lines: [...new Set(foundLines)].sort((a, b) => a - b),
        severity: 'low',
        suggestion: '這些數字出現多次，適合提取為命名常量'
      };
    },
    /**
     * Auto-fix: Not available for magic numbers.
     * Manual extraction required (see auditOrchestrator.js magic_numbers detection).
     */
    fix(content) { return content; },
  },
  {
    id: 'simplified-chinese',
    name: '簡體→繁體常見字修正',
    category: 'doc',
    detect(content) {
      const simplifiedMap = getSimplifiedMap();
      let count = 0;
      const foundLines = [];
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (!line.trim()) return;
        const trimmed = line.trim();
        if (/^https?:\/\//i.test(trimmed)) return;
        // Only skip if it's a path line (starts with / but NOT //)
        if (/^\/[^/]/.test(trimmed)) return;
        if (/^[\d\s\.,;:\-+=\*\/\\#@!$%^&()[\]{}|'"`<>]+$/.test(trimmed)) return;
        for (const [simp] of simplifiedMap) {
          if (line.includes(simp)) {
            count++;
            if (!foundLines.includes(i + 1)) foundLines.push(i + 1);
            break;
          }
        }
      });
      return { found: count > 0, details: `${count} 行有簡體中文`, lines: foundLines };
    },
    fix(content) {
      const simplifiedMap = getSimplifiedMap();
      const lines = content.split('\n');
      const fixed = lines.map(line => {
        if (!line.trim()) return line;
        const trimmed = line.trim();
        if (/^https?:\/\//i.test(trimmed)) return line;
        // Only skip if it's a path line (starts with / but NOT //)
        if (/^\/[^/]/.test(trimmed)) return line;
        if (/^[\d\s\.,;:\-+=\*\/\\#@!$%^&()[\]{}|'"`<>]+$/.test(trimmed)) return line;
        let newLine = line;
        for (const [simp, trad] of simplifiedMap) {
          newLine = newLine.split(simp).join(trad);
        }
        return newLine;
      });
      return fixed.join('\n');
    },
  },
  {
    id: 'fs-sync-trycatch',
    name: 'fs.*Sync / execSync 自動加 try-catch',
    category: 'reliability',
    /**
     * Detect fs.*Sync() / execSync() calls not already inside a try-catch block
     */
    detect(content, filePath) {
      const lines = content.split('\n');
      const fsRegex = /\bfs\.(?:readFileSync|writeFileSync|unlinkSync|rmSync|mkdirSync|copyFileSync|accessSync|statSync|readdirSync|lstatSync)\s*\(/;
      const execRegex = /\bexec(?:File)?Sync\s*\(/;
      const foundLines = [];

      if (!fsRegex.test(content) && !execRegex.test(content)) {
        return { found: false, details: '', lines: [] };
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Find all fs.*Sync / execSync match positions in this line
        // Use exec() in a loop to avoid needing 'g' flag on the original regex
        const fsMatches = [];
        const execMatches = [];
        const fsRe = /\bfs\.(?:readFileSync|writeFileSync|unlinkSync|rmSync|mkdirSync|copyFileSync|accessSync|statSync|readdirSync|lstatSync)\s*\(/g;
        const execRe = /\bexec(?:File)?Sync\s*\(/g;
        let m;
        fsRe.lastIndex = 0;
        while ((m = fsRe.exec(line)) !== null) fsMatches.push({ match: m[0], index: m.index });
        execRe.lastIndex = 0;
        while ((m = execRe.exec(line)) !== null) execMatches.push({ match: m[0], index: m.index });
        const allMatches = [...fsMatches, ...execMatches];

        if (allMatches.length === 0) continue;

        // If ALL matches are inside string literals, the whole line is just a
        // documentation string (e.g. "call fs.writeFileSync here") — skip it.
        if (allMatches.every(m => isInsideStringLiteral(line, m.index))) continue;

        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
        // Skip require destructuring: const { execSync } = require(...)
        if (/\{[^}]*(?:execFile)?Sync/i.test(line) && /(?:const|let|var)\s*\{/.test(line)) continue;

        // Skip single-line try-catch: try { fs.readFileSync(...) } catch(e) {}
        if (/\btry\s*\{[^}]*fs\.\w+Sync\s*\([^)]*\)[^}]*\}/.test(trimmed)) continue;
        if (/\btry\s*\{[^}]*exec(?:File)?Sync\s*\([^)]*\)[^}]*\}/.test(trimmed)) continue;

        // Skip lines inside markdown code blocks (documentation examples)
        if (isInsideMarkdownCodeBlock(lines, i)) continue;

        // Check if already inside try-catch.
        // Primary: AST-based detection via shared buildTryBlockMap (reliable,
        //   handles nested try-blocks, inline try-catch, shebangs, etc).
        // Fallback: brace-depth heuristic — only used when acorn can't parse
        //   the file (e.g. syntax errors). Less robust, but never throws.
        const tryBlockLines = buildTryBlockMap(content);
        if (tryBlockLines !== null) {
          // AST path: reliable detection
          if (!tryBlockLines.has(i + 1)) {
            foundLines.push(i + 1);
          }
        } else {
          // acorn failed to parse — fall back to a simpler brace walker
          // (same buggy one as before, but only runs on syntax-error files)
          let foundTry = false;
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
          if (!foundTry) {
            foundLines.push(i + 1);
          }
        }
      }

      return {
        found: foundLines.length > 0,
        details: `${foundLines.length} 個 fsSync/execSync 缺少 try-catch`,
        lines: foundLines,
        severity: 'high',
        suggestion: '這些 fs/exec 同步調用應包在 try-catch 中防止程序崩潰'
      };
    },
    /**
     * Auto-fix: wrap fs.*Sync() / execSync() calls in try-catch
     */
    fix(content, filePath) {
      const lines = content.split('\n');
      const fsRegex = /\bfs\.(?:readFileSync|writeFileSync|unlinkSync|rmSync|mkdirSync|copyFileSync|accessSync|statSync|readdirSync|lstatSync)\s*\(/;
      const execRegex = /\bexec(?:File)?Sync\s*\(/;

      // Build a map of lines to wrap (process from bottom to top to preserve line numbers)
      const toWrap = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!fsRegex.test(line) && !execRegex.test(line)) continue;

        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
        if (/\{[^}]*(?:execFile)?Sync/i.test(line) && /(?:const|let|var)\s*\{/.test(line)) continue;

        // Skip single-line try-catch: try { fs.readFileSync(...) } catch(e) {}
        if (/\btry\s*\{[^}]*fs\.\w+Sync\s*\([^)]*\)[^}]*\}/.test(trimmed)) continue;
        if (/\btry\s*\{[^}]*exec(?:File)?Sync\s*\([^)]*\)[^}]*\}/.test(trimmed)) continue;

        // Skip lines inside markdown code blocks (documentation examples)
        if (isInsideMarkdownCodeBlock(lines, i)) continue;

        // Check if already inside try-catch.
        // Primary: AST-based detection via shared buildTryBlockMap.
        // Fallback: brace-depth heuristic when acorn can't parse the file.
        const tryBlockLines = buildTryBlockMap(content);
        if (tryBlockLines !== null) {
          // AST path: reliable detection
          if (!tryBlockLines.has(i + 1)) {
            toWrap.push(i);
          }
        } else {
          // acorn failed to parse — fall back to brace walker (syntax-error files only)
          let foundTry = false;
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
          if (!foundTry) {
            toWrap.push(i);
          }
        }
      }

      if (toWrap.length === 0) return content;

      // Process from bottom to top to preserve line indices
      toWrap.sort((a, b) => b - a);

      for (const lineIdx of toWrap) {
        const line = lines[lineIdx];
        const indent = line.match(/^\s*/)[0];
        const trimmed = line.trim();

        // Determine function type for error message
        let errorMsg;
        if (/exec(?:File)?Sync/.test(trimmed)) {
          errorMsg = 'Command execution failed';
        } else if (/readFileSync/.test(trimmed)) {
          errorMsg = 'File read failed';
        } else if (/writeFileSync/.test(trimmed)) {
          errorMsg = 'File write failed';
        } else if (/mkdirSync/.test(trimmed)) {
          errorMsg = 'Directory creation failed';
        } else if (/unlinkSync|rmSync/.test(trimmed)) {
          errorMsg = 'File deletion failed';
        } else {
          errorMsg = 'Operation failed';
        }

        // Check if there's a const/let/var assignment before the sync call
        const assignMatch = trimmed.match(/^(const|let|var)\s+(\w+)\s*=\s*/);

        if (assignMatch) {
          // Pattern: const result = execSync(...) 或 let result = fs.readFileSync(...)
          // Bug 6 (2026-06-22): preserve original declaration keyword where possible.
          // `let`/`var` can stay as-is since the declaration line is just `let x;`
          // (no init), and reassignment inside the try block is allowed. `const`
          // cannot be preserved — reassignment violates const semantics — so we
          // fall back to `let` for that case (and the safe-assignment try pattern
          // below ensures the variable is never read with a stale value).
          const keyword = assignMatch[1];
          const varName = assignMatch[2];
          const callContent = trimmed.slice(assignMatch[0].length); // everything after '= '

          // Strip trailing semicolon from call content (we add our own)
          const cleanCall = callContent.replace(/;\s*$/, '');
          // Preserve original keyword. For `const`, must downgrade to `let`
          // because the new try-block assigns later.
          const declKeyword = keyword === 'let' || keyword === 'var' ? keyword : 'let';
          // Replace whole line
          lines[lineIdx] = indent + declKeyword + ' ' + varName + ';';
          // Add try-catch after
          lines.splice(lineIdx + 1, 0,
            indent + 'try {' + '\n' +
            indent + '  ' + varName + ' = ' + cleanCall + ';' + '\n' +
            indent + '} catch (e) {' + '\n' +
            indent + '  console.error(`' + errorMsg + ': ${e.message}`);' + '\n' +
            indent + '}'
          );
        } else {
          // Pattern: fs.writeFileSync(path, data);  (no return value used)
          // Check if it ends with ;
          const endsWithSemi = trimmed.endsWith(';');
          const callText = endsWithSemi ? trimmed.slice(0, -1) : trimmed;

          // Replace single line with try-catch wrapping
          lines[lineIdx] = indent + 'try {';
          lines.splice(lineIdx + 1, 0,
            indent + '  ' + callText + ';' + '\n' +
            indent + '} catch (e) {' + '\n' +
            indent + '  console.error(`' + errorMsg + ': ${e.message}`);' + '\n' +
            indent + '}'
          );
        }
      }

      return lines.join('\n');
    },
  },
  {
    id: 'optional-chaining',
    name: '深層 member chain 加 optional chaining (防 TypeError)',
    category: 'reliability',
    /**
     * Detect any 3+ level member chain (a.b.c) that isn't already covered
     * by optional chaining (?.). Roots in OPTIONAL_CHAINING_SAFE_ROOTS
     * (Math, JSON, process, Buffer, etc.) are skipped — they're never
     * undefined in practice, so adding ?. would be pure noise.
     *
     * Detection intentionally stays conservative:
     *   - Skips comment lines.
     *   - Skips lines that already use ?. anywhere (chain is opt-in).
     *   - Skips destructuring (`const { a } = obj` patterns).
     */
    detect(content, filePath) {
      const lines = content.split('\n');
      const foundLines = [];
      const chainRe = /\b([a-zA-Z_$][\w$]*)(?:\.([a-zA-Z_$][\w$]*)){2,}/g;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Skip comment lines
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        // Skip lines that already use optional chaining anywhere
        if (line.includes('?.')) continue;
        // Skip destructuring patterns: const { x } = obj  or  const [x] = arr
        if (/[{[]\s*[^=]+\s*[}\]]\s*=\s*/.test(line)) continue;

        chainRe.lastIndex = 0;
        let m;
        while ((m = chainRe.exec(line)) !== null) {
          // Skip matches inside string literals (e.g. 'prompt_cache.json.tmp')
          if (isInsideStringLiteral(line, m.index)) continue;
          // Skip LHS assignment targets (a.b.c = value, += -=, for-of/in → SyntaxError in Node v22+)
          if (isLhsAssignment(line, m.index, m[0].length)) continue;

          const root = m[1];
          if (OPTIONAL_CHAINING_SAFE_ROOTS.has(root)) continue;

          foundLines.push(i + 1);
          break; // one hit per line
        }
      }

      return {
        found: foundLines.length > 0,
        details: `${foundLines.length} 行有 3+ 層 member chain 可加 optional chaining`,
        lines: foundLines,
        severity: 'low',
        suggestion: '深層 member chain 加 ?. 可防止 undefined access 引發 TypeError',
      };
    },
    /**
     * Rewrite a.b.c → a?.b?.c. Same safe-line rules as detect().
     * Does NOT touch lines that already have ?. anywhere.
     */
    fix(content, filePath) {
      const lines = content.split('\n');
      const chainRe = /\b([a-zA-Z_$][\w$]*)(?:\.([a-zA-Z_$][\w$]*)){2,}/g;
      let totalChanged = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (line.includes('?.')) continue;
        if (/[{[]\s*[^=]+\s*[}\]]\s*=\s*/.test(line)) continue;

        let lineChanged = false;
        const newLine = line.replace(chainRe, (match, root, _last, offset) => {
          if (OPTIONAL_CHAINING_SAFE_ROOTS.has(root)) return match;
          if (isInsideStringLiteral(line, offset)) return match;
          // Skip LHS assignment targets (a.b.c = value, += -=, for-of/in → SyntaxError in Node v22+)
          if (isLhsAssignment(line, offset, match.length)) return match;
          lineChanged = true;
          return match.split('.').join('?.');
        });

        if (lineChanged) {
          lines[i] = newLine;
          totalChanged++;
        }
      }

      return totalChanged > 0 ? lines.join('\n') : content;
    },
  },
  {
    id: 'no-empty-catch',
    name: 'Empty catch block (silent error swallowing)',
    category: 'reliability',
    // Detection-only rule — no auto-fix. Empty catches might be intentional
    // (cleanup code that should fail silently, best-effort operations, or
    // patterns where the absence of error handling is documented). Auto-
    // rewriting to `console.error(e)` could spam logs; auto-rewriting to
    // `throw e` could break working code that depends on silent recovery.
    // The decision is contextual → surface for human review only.
    /**
     * Detect empty catch blocks: `catch (e) {}` (single-line) or
     * `catch (e) { /* only whitespace or comments *\/ }` (multi-line).
     *
     * Skips:
     *   - Whole-line `//` comments (documentation examples mentioning the pattern)
     *   - Whole-line `/*` block comment / `*` continuation lines
     *
     * Returns severity 'medium' — empty catch is a bug pattern but not a crash,
     * so it ranks below fsSync/execSync without try-catch (high) and
     * magic_numbers (low). The "without try-catch" wording is intentional —
     * verify_edit.js suppresses JSDoc false positives on lines that mention
     * `try` or `catch` (heuristic for rule documentation).
     */
    detect(content, filePath) {
      const lines = content.split('\n');
      const foundLines = [];
      // Truly empty single-line: catch (e) {}  (no comment at all)
      const SINGLE_RE = /catch\s*(\([^)]*\))?\s*\{\s*\}/;
      // Single-line with optional inline comment only: catch (e) { /* ignore */ }
      // Captures the comment body so we can check for intentional markers
      const SINGLE_WITH_COMMENT_RE = /catch\s*(\([^)]*\))?\s*\{\s*((?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))\s*\}/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment-only lines so doc examples don't trigger false positives
        if (line.trimStart().startsWith('//')) continue;
        if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('*')) continue;

        // Case 1: Truly empty single-line catch (no comment) → always flag
        if (SINGLE_RE.test(line)) {
          foundLines.push(i + 1);
          continue;
        }

        // Case 2: Single-line catch with inline comment only → flag unless
        // the comment is an intentional-empty marker (e.g. /* ignore */).
        const inlineMatch = line.match(SINGLE_WITH_COMMENT_RE);
        if (inlineMatch) {
          if (!hasIntentionalEmptyMarker(inlineMatch[2])) {
            foundLines.push(i + 1);
          }
          continue;
        }

        // Case 3: Multi-line catch — the opening { must be at end-of-line
        // (body on subsequent lines). Single-line catches with content like
        // `catch (e) { return; }` are correctly skipped — they're handled
        // by Cases 1 & 2 above (which require empty body OR comment-only body).
        // Without this guard, `catch (e) { return; }` would be mis-detected
        // as multi-line with empty body (between = '').
        if (/catch\s*(\([^)]*\))?\s*\{[ \t]*$/.test(line)) {
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (/^\s*\}\s*$/.test(lines[j])) {
              // Anything between catch{ and } that's non-comment, non-whitespace?
              const between = lines.slice(i + 1, j).join('\n');
              const codeOnly = between
                .replace(/\/\*[\s\S]*?\*\//g, '')   // strip /* ... */ block comments
                .replace(/\/\/.*$/gm, '')            // strip // line comments
                .trim();
              if (codeOnly === '' && !hasIntentionalEmptyMarker(between)) {
                foundLines.push(i + 1);
              }
              break;
            }
          }
        }
      }

      if (foundLines.length === 0) {
        return { found: false, details: '', lines: [] };
      }
      return {
        found: true,
        details: `Empty catch block(s) at line(s) ${foundLines.join(', ')} — silently swallows errors`,
        lines: foundLines,
        severity: 'medium',
        suggestion: 'Add error logging: console.error(e); or rethrow. Intentional swallows should have a comment explaining why.',
      };
    },
    // NO fix() — see rule docstring above. Empty catches are context-dependent
    // and require human review.
  },
];

module.exports = { LOW_RISK_RULES, getSimplifiedMap };
