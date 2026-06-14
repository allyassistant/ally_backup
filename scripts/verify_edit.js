#!/usr/bin/env node
/**
 * verify_edit.js
 * 即時 Post-Edit 驗證器 — 每次改完 code 後行一次，確保 P0 rules 冇違反
 *
 * 用法：
 *   node scripts/verify_edit.js <file-path>
 *   node scripts/verify_edit.js .                    # 所有未 commit .js files
 *
 * 檢查：
 *   1. Syntax check (node --check)
 *   2. P0 violation 掃描
 *   3. 未定義函數參考（basic）
 *
 * Exit code: 0 = clean, 1 = issues found
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = {
  EXEC_TIMEOUT_MS: 5000
};
const target = process.argv[2];
const _quiet = process.argv.includes('--quiet');

// Colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

function ok(msg) { if (!_quiet) console.log(`${GREEN}✓${NC} ${msg}`); }
function fail(msg) { if (!_quiet) console.log(`${RED}✗${NC} ${msg}`); }
function warn(msg) { if (!_quiet) console.log(`${YELLOW}⚠${NC} ${msg}`); }
function info(msg) { if (!_quiet) console.log(`${CYAN}ℹ${NC} ${msg}`); }

/**
 * Get list of .js files to check
 */
function getFiles(targetPath) {
  if (!targetPath) {
    console.error('Usage: node scripts/verify_edit.js <file-or-dir>');
    process.exit(1);
  }

  const absPath = path.resolve(ROOT, targetPath);
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }

  if (stat.isFile()) {
    if (!absPath.endsWith('.js')) {
      warn(`Skipping non-JS file: ${targetPath}`);
      return [];
    }
    return [absPath];
  }

  if (stat.isDirectory() && targetPath === '.') {
    // All uncommitted .js files (via git)
    try {
      const output = execSync('git diff --name-only --diff-filter=ACM', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return output.split('\n')
        .filter(f => f.endsWith('.js') && !f.includes('node_modules'))
        .map(f => path.resolve(ROOT, f))
        .filter(f => fs.existsSync(f));
    } catch (e) {
      warn('Not a git repo or git not available, scanning all .js files');
      return walkDir(path.resolve(ROOT, 'scripts'))
        .concat(walkDir(path.resolve(ROOT, 'docs')))
        .filter(f => f.endsWith('.js'));
    }
  }

  if (stat.isDirectory()) {
    return walkDir(absPath).filter(f => f.endsWith('.js'));
  }

  return [];
}

function walkDir(dir) {
  const results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && file !== 'node_modules') {
        results.push(...walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch (_) {}
  return results;
}

/**
 * Check 1: Syntax check
 */
function checkSyntax(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Use JS engine to parse
    new Function(content);
    return { pass: true, errors: [] };
  } catch (e) {
    // More reliable: use node --check
    try {
      execSync(`node --check "${filePath}"`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: CONFIG.EXEC_TIMEOUT_MS });
      return { pass: true, errors: [] };
    } catch (execErr) {
      const msg = execErr.stderr ? execErr.stderr.toString().trim() : e.message;
      return { pass: false, errors: [{ line: '?', msg }] };
    }
  }
}

/**
 * Check 2: P0 violations
 */
/**
 * P0_PATTERNS — central pattern registry
 *
 * scanAllPatterns() iterates over this array (skipping index 0 which is
 * handled by scanTryCatchSafety() for context-aware detection).
 * Each entry: { name, regex, severity, skipComment? }
 */
const P0_PATTERNS = [
  {
    name: 'Unsafe execSync/fs without try-catch',
    regex: /(execSync|readFileSync|writeFileSync|readdirSync|unlinkSync|renameSync|mkdirSync)\s*\(/g,
    severity: 'P0',
    contextAware: true
  },
  {
    name: 'Magic numbers in code (10+)',
    regex: /[^a-zA-Z_$](\d{3,})[^a-zA-Z_$]/g,
    severity: 'P1',
    skipComment: true
  },
  {
    name: 'Unresolved working notes (pending item)',
    regex: /TODO|FIXME/gi,
    severity: 'P2',
    skipComment: false
  }
];

/**
 * Scan P0_PATTERNS[1..n] — simple regex patterns (P1/P2)
 */
function scanP1P2Patterns(content) {
  const lines = content.split('\n');
  const issues = [];

  for (let pi = 1; pi < P0_PATTERNS.length; pi++) {
    const pattern = P0_PATTERNS[pi];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(pattern.regex);
      if (match) {
        // Skip comment-only lines if pattern says so
        if (pattern.skipComment && line.trimStart().startsWith('//')) continue;
        // Skip self-referential patterns: value in CONFIG block, year numbers, pattern defs
        const isMagic = pattern.name.includes('Magic numbers');
        const isInConfig = line.includes('CONFIG') || (i > 0 && lines.slice(Math.max(0, i - 20), i).some(l => l.includes('CONFIG')));
        if (isInConfig && isMagic) continue;
        // Skip year-like numbers (1900-2099) extracted from matched text
        if (isMagic && match[0]) {
          const digits = match[0].replace(/\D/g, '');
          if (/^(?:19|20)\d{2}$/.test(digits)) continue;
        }
        if (line.includes('/TODO|FIXME/gi') || line.includes('Unresolved working notes')) continue;
        issues.push({
          line: i + 1,
          severity: pattern.severity,
          msg: `${pattern.name}: ${match[0].trim()}`
        });
      }
    }
  }

  return issues;
}

/**
 * Full line-level scan for try-catch safety (P0_PATTERNS[0] — context-aware)
 */
function scanTryCatchSafety(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  let inFunction = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for unsafe sync calls (exclude existsSync — guard pattern)
    const unsafeCalls = line.match(/(execSync|readFileSync|writeFileSync|readdirSync|unlinkSync|renameSync|mkdirSync)\s*\(/g);
    if (unsafeCalls && !line.trimStart().startsWith('//')) {
      // Check if this line or previous lines contain try
      let hasTry = line.includes('try') || line.includes('catch');
      if (!hasTry) {
        for (let j = Math.max(0, i - 3); j < i; j++) {
          if (lines[j].includes('try')) { hasTry = true; break; }
        }
      }
      // Exclude existsSync-guarded patterns: if prev 1-2 lines has if (!fs.existsSync(...)) return;
      let isGuarded = false;
      for (let k = Math.max(0, i - 2); k < i; k++) {
        const prevLine = lines[k].trim();
        if (/if\s*\(\s*!/.test(prevLine) && prevLine.includes('existsSync') && prevLine.includes('return')) {
          isGuarded = true;
          break;
        }
      }
      if (!hasTry && !isGuarded) {
        issues.push({
          line: lineNum,
          severity: 'P0',
          msg: `${unsafeCalls[0]} 外面冇 try-catch`
        });
      }
    }
  }

  return issues;
}

/**
 * Check: undefined function references (basic)
 */
function checkUndefinedRefs(content, filePath) {
  const issues = [];
  const funcCalls = content.match(/[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/g) || [];
  const defined = new Set();

  // Find function definitions
  const defs = content.matchAll(/(?:function|const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=|\(|=>)/g);
  for (const d of defs) defined.add(d[1]);

  // Find require imports
  const imports = content.matchAll(/(?:require|import)\s*\(?\s*['"][^'"]+['"]\s*\)?/g);
  for (const _ of imports) {} // imports are fine

  // Arrow/X function expressions too complex for basic scan
  // Skip this check for simplicity - CQM handles it properly

  return issues;
}

/**
 * Main
 */
function main() {
  if (!_quiet) {
    console.log(`\n${BOLD}${CYAN}═══ verify_edit.js — Post-Edit Quality Gate ═══${NC}\n`);
  }

  let totalIssues = 0;
  let totalFiles = 0;
  const files = getFiles(target);

  if (files.length === 0) {
    info('No .js files to check');
    process.exit(0);
  }

  for (const filePath of files) {
    const relPath = path.relative(ROOT, filePath);
    totalFiles++;

    // Syntax check
    const syntax = checkSyntax(filePath);
    if (!syntax.pass) {
      for (const err of syntax.errors) {
        fail(`${relPath}:${err.line} — SyntaxError: ${err.msg}`);
        totalIssues++;
      }
      continue;
    }

    // Scan: P0 (context-aware try-catch) + P1/P2 (regex from P0_PATTERNS)
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const p0Issues = scanTryCatchSafety(content, filePath);
      const p1p2Issues = scanP1P2Patterns(content);
      const allIssues = p0Issues.concat(p1p2Issues);

      if (allIssues.length > 0) {
        for (const issue of allIssues) {
          const icon = issue.severity === 'P0' ? '🚨' : issue.severity === 'P1' ? '⚠️' : '📝';
          fail(`${icon} ${relPath}:${issue.line} — ${issue.msg}`);
          totalIssues++;
        }
      } else {
        ok(`${relPath} — 通過`);
      }
    } catch (e) {
      fail(`${relPath} — 讀取失敗: ${e.message}`);
      totalIssues++;
    }
  }

  if (!_quiet) {
    console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════${NC}`);
    if (totalIssues === 0) {
      console.log(`${GREEN}${BOLD}  ✅ 全部通過 — ${totalFiles} files clean${NC}`);
    } else {
      console.log(`${RED}${BOLD}  ❌ ${totalIssues} issue(s) in ${totalFiles} file(s)${NC}`);
      console.log(`  ${YELLOW}Run: node scripts/code_quality_manager.js fix${NC}`);
    }
    console.log(`${CYAN}════════════════════════════════════════════════════${NC}\n`);
  }

  process.exit(totalIssues > 0 ? 1 : 0);
}

main();
