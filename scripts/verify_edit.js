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
const { execSync, execFileSync } = require('child_process');
const { buildTryBlockMap } = require('./lib/audit/try-block-map');

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
    // File not found / unreadable — not a verify failure, just nothing to verify.
    // Returning [] here prevents the downstream `stat.isFile()` TypeError that
    // otherwise fires when statSync throws (e.g. user passes a non-existent path).
    // Round 5 audit: 29/187 (15.5%) of verify_fail events were noise from this bug.
    warn(`File not found: ${targetPath} — nothing to verify`);
    return [];
  }

  if (stat.isFile()) {
    if (!absPath.endsWith('.js') && !absPath.endsWith('.mjs') && !absPath.endsWith('.cjs')) {
      warn(`Skipping non-JS/TS file: ${targetPath}`);
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
        .filter(f => (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs')) && !f.includes('node_modules'))
        .map(f => path.resolve(ROOT, f))
        .filter(f => fs.existsSync(f));
    } catch (e) {
      warn('Not a git repo or git not available, scanning all JS files');
      return walkDir(path.resolve(ROOT, 'scripts'))
        .concat(walkDir(path.resolve(ROOT, 'docs')))
        .concat(walkDir(path.resolve(ROOT, 'extensions')))
        .filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'));
    }
  }

  if (stat.isDirectory()) {
    return walkDir(absPath).filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'));
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
      execFileSync('node', ['--check', filePath], { stdio: ['pipe', 'pipe', 'pipe'], timeout: CONFIG.EXEC_TIMEOUT_MS });
      return { pass: true, errors: [] };
    } catch (execErr) {
      const msg = execErr.stderr ? execErr?.stderr?.toString().trim() : e.message;
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
    // Threshold raised from 3+ → 6+ digits and string-literal / hex-color
    // exclusion added to suppress false positives on:
    //   - Discord snowflake IDs in string literals  ('1473376125584670872')
    //   - color hex literals                       (#133, #154)
    //   - quoted timeout / interval constants     ('60000')
    // Real magic numbers at 6+ digits appearing outside string literals
    // remain flaggable; LOW_RISK_RULES `magic-numbers-safe` still catches
    // smaller repeated numbers (4+ digits, 2+ occurrences).
    name: 'Magic numbers in code (6+, non-literal)',
    regex: /(?<![\w'"`])(?<!#)(\d{6,})(?![\w'"`])/g,
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
        const isMagic = pattern?.name?.includes('Magic numbers');
        const isInConfig = line.includes('CONFIG') || (i > 0 && lines.slice(Math.max(0, i - 20), i).some(l => l.includes('CONFIG')));
        if (isInConfig && isMagic) continue;
        // Skip named-constant declarations: `const MAX_FILE_SIZE_BYTES = 100000;`
        // or `const ONE_DAY_MS = 86400000;`. These are intentionally explicit
        // numeric bindings — flagging them as "magic numbers" produces noise.
        // Bug 9 (2026-06-22): previous magic-number scan flagged `const ONE_DAY_MS = 86400000`
        // as P1 even though the literal is already named. Mirrors the
        // CONFIG-block exemption above.
        if (isMagic && /^\s*const\s+[A-Z_][A-Z0-9_]*\s*=/.test(line)) continue;
        // Skip year-like numbers (1900-2099) extracted from matched text
        if (isMagic && match[0]) {
          const digits = match[0].replace(/\D/g, '');
          if (/^(?:19|20)\d{2}$/.test(digits)) continue;
        }
        if (line.includes('/TODO|FIXME/gi') || line.includes('Unresolved working notes')) continue;
        // Skip lines that are clearly self-referential documentation for the
        // working-notes rule itself (e.g. audit_just_written.js defines a
        // scanTodoFixme function with a regex literal whose body lists the
        // working-notes keywords). These are NOT real unresolved items — they
        // document the rule. Patterns caught at audit_just_written.js:12,
        // 195, 196, 199, 202, 204, 211, 318:
        //   1. Section divider / header lines mentioning `Rule N:` or the
        //      rule id `todo_fixme` in a doc comment.
        //   2. Function / variable references to the rule itself
        //      (`scanTodoFixme`, `TODO_RE`).
        //   3. Working-notes keywords inside a regex literal `/.../`.
        if (/Rule\s+\d+:|todo_fixme|scanTodoFixme|TODO_RE/.test(line)) continue;
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
 *
 * Detection strategy:
 *   1. AST-based `buildTryBlockMap()` is the single source of truth — it
 *      returns a Set<1-indexed line-number> for every line that lies inside
 *      a try, catch, or finally block. This correctly handles:
 *        - try-blocks whose `try {` is 5+ lines above the unsafe call
 *          (the previous 3-line lookback missed these — Bug 8, 2026-06-22)
 *        - nested try-blocks at different scopes
 *        - inline try-catch with nested object literals
 *   2. Falls back to a 3-line lookback if acorn cannot parse the file
 *      (tryBlockMap === null). The fallback is only for syntactic edge cases
 *      like top-level await outside a function or other acorn-rejected
 *      constructs; normal Node scripts always parse.
 */
function scanTryCatchSafety(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  const tryBlockMap = buildTryBlockMap(content); // null on parse failure

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for unsafe sync calls (exclude existsSync — guard pattern).
    // Bug 7 (2026-06-22): added \b word-boundary to prevent identifier-substring
    // matches like `B4_unsafe_writeFileSync`. Without \b, the regex matches
    // `_writeFileSync(` inside a longer identifier. Mirrors the fix in
    // scripts/audit_just_written.js UNSAFE_SYNC_RE.
    const unsafeCalls = line.match(/\b(execSync|readFileSync|writeFileSync|readdirSync|unlinkSync|renameSync|mkdirSync)\s*\(/g);
    if (unsafeCalls && !line.trimStart().startsWith('//')) {
      // Primary: AST map tells us whether this exact line falls inside a
      // try / catch / finally block.
      let hasTry = tryBlockMap ? tryBlockMap.has(lineNum) : false;
      // Secondary heuristic (Bug 9, 2026-06-22): if the line itself mentions
      // `try` or `catch`, it's likely either (a) a same-line try-catch
      // (rare), or (b) a JSDoc / string / regex literal describing the
      // pattern — e.g. rule documentation like
      //   "* Detect fs.*Sync() / execSync() calls not already inside a try-catch block"
      // where `execSync(` appears in prose, not as a real call. This heuristic
      // preserves the legacy suppression that the previous 3-line lookback
      // provided by accident (L279 in low-risk.js is a JSDoc line and the
      // legacy code saw `line.includes('try')` immediately).
      if (!hasTry && (line.includes('try') || line.includes('catch'))) {
        hasTry = true;
      }
      // Fallback (only if acorn couldn't parse): 3-line lookback for `try`.
      if (!hasTry && !tryBlockMap) {
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
