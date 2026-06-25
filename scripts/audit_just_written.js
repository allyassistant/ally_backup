#!/usr/bin/env node
/**
 * scripts/audit_just_written.js — Lightweight immediate audit on freshly written files
 *
 * Phase A (2026-06-20): runs the moment LLM writes/edits a JS/MJS file, BEFORE
 * the next 04:30 daily cron. Catches the most common bug patterns in <2s so
 * the host tool call isn't blocked.
 *
 * Subset of LOW_RISK_RULES (most common offenders):
 *   1. fsSync_missing_trycatch (P0) — unsafe sync calls without try-catch
 *   2. magic_numbers (P1) — 6+ digit magic numbers outside literals
 *   3. todo_fixme (P2) — TODO/FIXME markers
 *   4. simplified_chinese (P1) — 簡體字 in code/comments
 *
 * Out of scope (heavier rules run on cron):
 *   - Layer 2 (cross-script propagation)
 *   - Layer 3 (registry + history trends)
 *   - Layer 4 (predictive hardening)
 *   - Custom rules in low-risk.js not listed above
 *
 * Usage:
 *   node scripts/audit_just_written.js /path/to/file.js
 *   node scripts/audit_just_written.js /path/to/file.mjs --json
 *
 * Output: JSON { ok, severity: 'critical'|'high'|'medium'|'low'|'none',
 *                issues: [{rule, line, severity, msg}], durationMs }
 *
 * Exit: 0 always (fail-open). Hooks depend on JSON content, not exit code.
 *
 * Performance target: < 2s for files ≤ 1000 lines.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const realtimeDedup = require('./lib/audit_realtime_dedup');
const { buildTryBlockMap } = require('./lib/audit/try-block-map');

// ── Rule 1: fsSync_missing_trycatch (P0) ─────────────────────────────────
// Bug A (2026-06-22): previous version had two false-positive sources:
//   1. `inlineTry` regex `try\s*\{[^}]*(...Sync)\s*\(` fails when the unsafe
//      sync call comes AFTER an inner brace literal on the same try line,
//      e.g. `try { foo({ a: 1 }); fs.readdirSync(); } catch (e) {}`.
//   2. `isInsideTryBlock` walked backwards and returned true on ANY previous
//      line containing `try {`, regardless of brace depth — so a try-block
//      anywhere earlier in the file would silently whitelist every later
//      line, even outside that block.
//   3. UNSAFE_SYNC_RE matched keyword substrings inside identifiers
//      (e.g. `B4_unsafe_writeFileSync`).
// Fix: AST-based try-block detection via acorn (already a project dep).
// Fallback to brace-depth heuristic only if acorn cannot parse the file.

// `\b` word-boundary prevents identifier substring matches like
// `B4_unsafe_writeFileSync` (where `_writeFileSync` is preceded by `_`, a
// word character → no boundary → no match). Real calls `fs.writeFileSync(`
// still match because `.writeFileSync` has a `.` → word boundary.
const UNSAFE_SYNC_RE = /\b(execSync|readFileSync|writeFileSync|readdirSync|unlinkSync|renameSync|mkdirSync)\s*\(/g;

/**
 * Legacy fallback for files acorn can't parse (e.g. syntax errors).
 * Approximate brace-depth walker. Less robust than AST but never throws.
 */
function isInsideTryBlockLegacy(lines, lineIdx) {
  let depth = 0;
  for (let j = lineIdx - 1; j >= 0; j--) {
    const line = lines[j];
    const closes = (line.match(/}/g) || []).length;
    const opens = (line.match(/{/g) || []).length;
    const prevDepth = depth;
    depth += opens - closes;

    // Detect top-level try block: when crossing the `try {` line, depth
    // transitions 0 → 1. Previous walker only checked `try {` when
    // depth dropped below 0, which never fires when the unsafe call is
    // inside a try at the top of the file (e.g. `try { fs.readdirSync() }`).
    if (prevDepth === 0 && depth > 0 && /try\s*\{/.test(line)) {
      return true;
    }

    if (depth < 0) {
      if (/try\s*\{/.test(line)) return true;
      return false;
    }
  }
  return false;
}

function scanTryCatchSafety(content, filePath) {
  const lines = content.split('\n');
  const issues = [];

  // Try AST-based detection first
  const tryBlockLines = buildTryBlockMap(content);
  const useAST = tryBlockLines !== null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.trimStart().startsWith('//')) continue; // skip line comments
    if (line.trimStart().startsWith('*')) continue;  // skip JSDoc continuation lines (meta-circular FP)

    const unsafeCalls = line.match(UNSAFE_SYNC_RE);
    if (!unsafeCalls) continue;

    // Check 1: is this line inside a try/catch/finally block?
    // AST path is the primary; legacy is fallback for unparseable files.
    const inTry = useAST
      ? tryBlockLines.has(lineNum)
      : isInsideTryBlockLegacy(lines, i);

    // Check 2: existsSync-guard pattern (recent lines)
    let isExistsGuard = false;
    for (let j = Math.max(0, i - 2); j < i; j++) {
      if (lines[j].match(/if\s*\(\s*!?\s*fs\.existsSync/)) {
        isExistsGuard = true;
        break;
      }
    }

    if (inTry || isExistsGuard) continue;

    issues.push({
      rule: 'fsSync_missing_trycatch',
      line: lineNum,
      severity: 'critical',
      msg: `Unsafe ${unsafeCalls[0].replace('(', '')} without try-catch`,
      file: filePath,
    });
  }

  // Defense-in-depth (Bug B mitigation): every reported `line` must actually
  // contain an unsafe sync call in the file we just read. If not, scan nearby
  // lines and re-locate — protects against future stale-content bugs where
  // a caller passes stale line numbers from a previous file version.
  return issues.map(issue => {
    const reportedLine = issue.line - 1;
    if (reportedLine >= 0 && reportedLine < lines.length) {
      if (UNSAFE_SYNC_RE.test(lines[reportedLine])) {
        UNSAFE_SYNC_RE.lastIndex = 0;
        return issue;
      }
      UNSAFE_SYNC_RE.lastIndex = 0;
    }
    // Reported line doesn't actually contain an unsafe call → find the real one
    // within ±5 lines (handles small drift from concurrent edits).
    for (let delta = 1; delta <= 5; delta++) {
      for (const dir of [-1, 1]) {
        const probe = reportedLine + dir * delta;
        if (probe >= 0 && probe < lines.length && UNSAFE_SYNC_RE.test(lines[probe])) {
          UNSAFE_SYNC_RE.lastIndex = 0;
          return { ...issue, line: probe + 1 };
        }
        UNSAFE_SYNC_RE.lastIndex = 0;
      }
    }
    // Couldn't re-locate → drop the issue rather than report a phantom line.
    return null;
  }).filter(Boolean);
}

// ── Rule 2: magic_numbers (P1) ───────────────────────────────────────────
function scanMagicNumbers(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  const MAGIC_RE = /(?<![\w'"`])(?<!#)(\d{6,})(?![\w'"`])/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('//')) continue; // skip comments

    const match = line.match(MAGIC_RE);
    if (!match) continue;

    // Skip CONFIG blocks (heuristic: prev 20 lines mention CONFIG)
    const isInConfig = line.includes('CONFIG') ||
      (i > 0 && lines.slice(Math.max(0, i - 20), i).some(l => l.includes('CONFIG')));
    if (isInConfig) continue;

    // Skip named-constant declarations: `const MAX_FILE_SIZE_BYTES = 100000;`
    // or `const ONE_DAY_MS = 86400000;`. These are intentionally explicit
    // numeric bindings — flagging them as "magic numbers" produces noise.
    // Bug 9 (2026-06-22): previous magic-number scan flagged `const ONE_DAY_MS = 86400000`
    // as P1 even though the literal is already named. Mirrors verify_edit.js
    // (which carries the same fix) for cross-tool consistency.
    if (/^\s*const\s+[A-Z_][A-Z0-9_]*\s*=/.test(line)) continue;

    // Skip year-like (1900-2099)
    const digits = match[0].replace(/\D/g, '');
    if (/^(?:19|20)\d{2}$/.test(digits)) continue;

    issues.push({
      rule: 'magic_numbers',
      line: i + 1,
      severity: 'high',
      msg: `Magic number: ${match[0]}`,
      file: filePath,
    });
  }
  return issues;
}

// ── Rule 3: todo_fixme (P2) ──────────────────────────────────────────────
function scanTodoFixme(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  const TODO_RE = /\b(TODO|FIXME)\b/gi;

  for (let i = 0; i < lines.length; i++) {
    if (TODO_RE.test(lines[i])) {
      issues.push({
        rule: 'todo_fixme',
        line: i + 1,
        severity: 'low',
        msg: lines[i].trim().slice(0, 80),
        file: filePath,
      });
    }
    TODO_RE.lastIndex = 0; // reset global regex
  }
  return issues;
}

// ── Rule 4: simplified_chinese (P1) ──────────────────────────────────────
// Light check: scan for common simplified chars that rarely appear in HK/TW code.
// Using a small set of highly distinctive simplified chars for speed.
const SIMP_CHARS = ['国', '學', '语', '类', '項', '現', '应', '實', '據', '议', '記', '設', '過', '种', '連', '復', '節', '頁', '術', '圖', '長', '兩', '变', '條', '听', '轉', '面', '寫', '谢', '為', '办', '认', '让', '给', '场', '队', '随', '導', '響', '決', '確', '题', '该', '請'];

/**
 * Count simp chars OUTSIDE string literals (single/double/backtick).
 * Prevents false positives on lines like:
 *   const SIMP_CHARS = ['国', '學', ...];
 *   const msg = `用戶 ${count} 國`;
 */
function countSimpCharsOutsideStrings(line) {
  let count = 0;
  let inString = false;
  let stringChar = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      // End of string: same quote, not escaped
      if (ch === stringChar && line[i - 1] !== '\\') {
        inString = false;
      }
    } else {
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = true;
        stringChar = ch;
      } else if (SIMP_CHARS.indexOf(ch) !== -1) {
        count++;
      }
    }
  }
  return count;
}

function scanSimplifiedChinese(content, filePath) {
  // Skip strings/comments check would be ideal but expensive. Instead:
  // count simplified chars in the whole file. If ≥ 3 distinct simplified chars
  // appear, flag the line with the highest density.
  const lines = content.split('\n');
  const charCount = new Map();

  for (const ch of SIMP_CHARS) {
    if (content.includes(ch)) charCount.set(ch, (charCount.get(ch) || 0) + 1);
  }

  if (charCount.size < 3) return []; // too few signals

  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    // Bug 10 (2026-06-22): previous version only skipped lines where the
    // entire line started with `//` (via `trimStart().startsWith('//')`),
    // and didn't handle inline `/* */` block comments at all. That caused
    // false positives on mixed code+comment lines like
    //   const MAX_FILE_LINES_WARN = 1000;  // 超過此行數提示拆分 (從500改為1000，避免過度警報)
    // where the `過` / `為` chars inside the `//` comment were counted as
    // simp chars in code. Fix: strip `/* ... */` block comments and the
    // `// ...` line comment from the line BEFORE handing it to
    // countSimpCharsOutsideStrings. The string-literal detection inside
    // that function is left untouched. Surgical change — no other rules
    // and no shared function signatures are modified.
    const codeLine = lines[i]
      .replace(/\/\*[\s\S]*?\*\//g, '')   // strip block comments on same line
      .replace(/\/\/.*$/, '');             // strip `//` line comment to EOL
    const hits = countSimpCharsOutsideStrings(codeLine);
    if (hits >= 2) {
      issues.push({
        rule: 'simplified_chinese',
        line: i + 1,
        severity: 'high',
        msg: `簡體字 detected (${hits} chars outside strings): "${lines[i].trim().slice(0, 60)}"`,
        file: filePath,
      });
    }
  }
  return issues;
}

// ── Rule 5: no_empty_catch (medium) ─────────────────────────────────────
// Empty catch blocks silently swallow errors. Common JS bug pattern
// found in 104 occurrences across scripts/*.js (2026-06-22 scan from M3 review).
//
// Mirrors `no-empty-catch` rule in scripts/lib/rules/low-risk.js but lives
// here as a separate lightweight scanner so audit_just_written.js stays
// self-contained (no import of the full LOW_RISK_RULES array just for one
// rule). Detection-only — no auto-fix (mirrors the rule's design).
//
// Skips whole-line `//` and `/* */` comments to avoid flagging documentation
// examples like `* catch (e) {}` in JSDoc.
//
// Suppresses intentional-empty markers like `/* ignore */`, `/* noop */`,
// `/* intentional */`, `// ignore`, etc. — matches the codebase convention
// for best-effort cleanup paths (see auto_fix.js loadAuditState() etc.).
//
// Two-tier heuristic (mirrors `hasIntentionalEmptyMarker()` in
// scripts/lib/rules/low-risk.js):
//   Tier 1 — Explicit markers: `/* ignore */`, `/* noop */`, etc.
//   Tier 2 — Any explanatory comment in the catch body indicates intent.
//            Catches mixed-language patterns like Cantonese / English
//            prose that document why the catch is empty.
const INTENTIONAL_EMPTY_MARKERS = [
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

function hasIntentionalEmptyMarker(text) {
  if (!text) return false;
  if (INTENTIONAL_EMPTY_MARKERS.some(re => re.test(text))) return true;
  // Tier 2: Any comment in catch body = intentional (documented).
  if (/\/\*[\s\S]*?\*\//.test(text)) return true;
  if (/\/\/.*/.test(text)) return true;
  return false;
}

function scanNoEmptyCatch(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  // Truly empty single-line: catch (e) {}  (no comment at all)
  const SINGLE_RE = /catch\s*(\([^)]*\))?\s*\{\s*\}/;
  // Single-line with optional inline comment only: catch (e) { /* ignore */ }
  const SINGLE_WITH_COMMENT_RE = /catch\s*(\([^)]*\))?\s*\{\s*((?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))\s*\}/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip whole-line comments — doc examples mentioning the pattern shouldn't trigger
    if (line.trimStart().startsWith('//')) continue;
    if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('*')) continue;

    // Case 1: Truly empty single-line catch (no comment) → always flag
    if (SINGLE_RE.test(line)) {
      issues.push({
        rule: 'no_empty_catch',
        line: i + 1,
        severity: 'medium',
        msg: 'Empty catch block — silently swallows errors',
        file: filePath,
      });
      continue;
    }

    // Case 2: Single-line catch with inline comment only → flag unless
    // the comment is an intentional-empty marker (e.g. /* ignore */).
    const inlineMatch = line.match(SINGLE_WITH_COMMENT_RE);
    if (inlineMatch) {
      if (!hasIntentionalEmptyMarker(inlineMatch[2])) {
        issues.push({
          rule: 'no_empty_catch',
          line: i + 1,
          severity: 'medium',
          msg: 'Empty catch block — silently swallows errors',
          file: filePath,
        });
      }
      continue;
    }

    // Case 3: Multi-line catch — the opening { must be at end-of-line
    // (body on subsequent lines). Single-line catches with content like
    // `catch (e) { return; }` are correctly skipped — they're handled
    // by Cases 1 & 2 above (which require empty body OR comment-only body).
    if (/catch\s*(\([^)]*\))?\s*\{[ \t]*$/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (/^\s*\}\s*$/.test(lines[j])) {
          const between = lines.slice(i + 1, j).join('\n');
          const codeOnly = between
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
            .trim();
          if (codeOnly === '' && !hasIntentionalEmptyMarker(between)) {
            issues.push({
              rule: 'no_empty_catch',
              line: i + 1,
              severity: 'medium',
              msg: 'Empty catch block — silently swallows errors',
              file: filePath,
            });
          }
          break;
        }
      }
    }
  }
  return issues;
}

// ── Aggregator ──────────────────────────────────────────────────────────
function auditFile(filePath) {
  const start = Date.now();

  if (!filePath) {
    return { ok: false, severity: 'none', issues: [], error: 'no_file_path', durationMs: 0 };
  }

  if (!fs.existsSync(filePath)) {
    return { ok: false, severity: 'none', issues: [], error: 'file_not_found', durationMs: 0 };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.js', '.mjs', '.cjs'].includes(ext)) {
    return { ok: false, severity: 'none', issues: [], error: 'not_js_file', durationMs: 0 };
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, severity: 'none', issues: [], error: `read_failed: ${e.message}`, durationMs: Date.now() - start };
  }

  // Capture file mtime BEFORE running rules so we can record it as the override
  // baseline. If the file is re-audited later, current mtime will be > override
  // mtime → re-audit. If unchanged, skip.
  let fileMtime = 0;
  try {
    fileMtime = fs.statSync(filePath).mtimeMs;
  } catch (_) {
    // stat failure handled below
  }

  // Run all 5 scanners
  const issues = [
    ...scanTryCatchSafety(content, filePath),
    ...scanMagicNumbers(content, filePath),
    ...scanTodoFixme(content, filePath),
    ...scanSimplifiedChinese(content, filePath),
    ...scanNoEmptyCatch(content, filePath),
  ];

  // Determine overall severity (highest wins)
  let severity = 'none';
  if (issues.some(i => i.severity === 'critical')) severity = 'critical';
  else if (issues.some(i => i.severity === 'high')) severity = 'high';
  else if (issues.some(i => i.severity === 'medium')) severity = 'medium';
  else if (issues.some(i => i.severity === 'low')) severity = 'low';

  return {
    ok: true,
    severity,
    issues,
    issueCount: issues.length,
    durationMs: Date.now() - start,
    fileMtime, // included for the caller to write an override entry
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────
if (require.main === module) {
  const filePath = process.argv[2];
  const result = auditFile(filePath);

  // Phase A+ (2026-06-20): record this real-time audit result so the daily
  // 04:30 cron can skip files we've already verified. Best-effort: any
  // write failure is silently dropped (audit result is more important).
  // The path is normalized to absolute so it matches what discoverJsFiles()
  // in audit_daily_cron.js returns (LLM tool calls may pass relative paths).
  if (result.ok && result.fileMtime > 0) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    realtimeDedup.appendOverride(absPath, result.fileMtime, result.severity, result.issueCount);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`severity=${result.severity} · issues=${result.issueCount} · ${result.durationMs}ms`);
    for (const i of (result.issues || []).slice(0, 5)) {
      console.log(`  ${i?.severity?.padEnd(8)} L${String(i.line).padStart(4)} ${i.rule}: ${i.msg}`);
    }
    if (result.issues && result?.issues?.length > 5) {
      console.log(`  ... and ${result?.issues?.length - 5} more`);
    }
  }
}

module.exports = { auditFile };
