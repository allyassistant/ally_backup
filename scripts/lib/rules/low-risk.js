/**
 * scripts/lib/rules/low-risk.js
 * LOW_RISK_RULES - 自動修復規則
 */

const path = require('path');
const fs = require('fs');

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
        if (!fsRegex.test(line) && !execRegex.test(line)) continue;

        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;
        // Skip require destructuring: const { execSync } = require(...)
        if (/\{[^}]*(?:execFile)?Sync/i.test(line) && /(?:const|let|var)\s*\{/.test(line)) continue;

        // Skip description fields
        const descFields = ['desc:', 'reason:', 'pattern:', 'message:', 'suggestion:', 'details:', 'title:'];
        if (descFields.some(f => line.includes(f) && line.indexOf(f) < line.indexOf('fs.'))) continue;

        // Skip single-line try-catch: try { fs.readFileSync(...) } catch(e) {}
        if (/\btry\s*\{[^}]*fs\.\w+Sync\s*\([^)]*\)[^}]*\}/.test(trimmed)) continue;
        if (/\btry\s*\{[^}]*exec(?:File)?Sync\s*\([^)]*\)[^}]*\}/.test(trimmed)) continue;

        // Skip lines inside markdown code blocks (documentation examples)
        if (isInsideMarkdownCodeBlock(lines, i)) continue;

        // Check if already inside try-catch
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

        // Check if already inside try-catch
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
          const keyword = assignMatch[1];
          const varName = assignMatch[2];
          const callContent = trimmed.slice(assignMatch[0].length); // everything after '= '

          // Strip trailing semicolon from call content (we add our own)
          const cleanCall = callContent.replace(/;\s*$/, '');
          // Replace whole line
          lines[lineIdx] = indent + 'let ' + varName + ';';
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
];

module.exports = { LOW_RISK_RULES, getSimplifiedMap };
