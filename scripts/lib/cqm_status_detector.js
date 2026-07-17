#!/usr/bin/env node
/**
 * cqm_status_detector.js — Status detection for CQM digest findings
 *
 * For each finding from `.state/pure_ai_audit_results.json`,
 * classify into one of four statuses:
 *   - 'pending'    - scan flagged, no fix evidence yet (default)
 *   - 'approved'   - scan flagged, but git diff shows file was modified
 *                    in working tree (manual or sub-agent fix, uncommitted)
 *   - 'suppressed' - explicit user opt-out via comment or .cqmignore
 *   - 'auto_fixed' - recorded as fixed in .state/auto_repair_results.json
 *
 * Priority order (most authoritative first):
 *   1. suppressed (explicit user intent - always wins)
 *   2. approved   (git evidence of manual fix)
 *   3. auto_fixed (recorded in auto_repair_results.json)
 *   4. pending    (default fallback)
 *
 * Suppress mechanisms supported:
 *   - Line-level:  "// cqm-ignore: <rule_id>" (exact rule) or
 *                  "// cqm-ignore" (wildcard for all rules on this line)
 *   - File-level:  slash-star cqm-ignore star-slash (wildcard) or
 *                  slash-star cqm-ignore: rule_a, rule_b star-slash (specific rules)
 *                  Must appear in the first 50 lines of the file.
 *   - Repo-level:  .cqmignore file at repo root (gitignore-style patterns)
 *                  Patterns: "path/to/file.js", "path:line", "glob/*.js"
 *
 * Usage:
 *   const detector = require('./lib/cqm_status_detector');
 *   const result = detector.detectStatus(finding, repoRoot);
 *   // → { status: 'pending'|'approved'|'suppressed'|'auto_fixed', reason: '...' }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HEAD_LINES_FOR_FILE_IGNORE = 50;
const GIT_TIMEOUT_MS = 5000;

/**
 * Parse suppress comments from a single file.
 * Returns { fileLevel, lineIgnores } where:
 *   fileLevel === true           → wildcard (ignore all rules)
 *   fileLevel === ['rule_a',...] → only ignore these rules
 *   lineIgnores: Map<lineNumber, Set<ruleId|'*'>>
 */
function parseIgnoreComments(filePath) {
  const fileLevel = false;
  const lineIgnores = new Map();

  if (!filePath || !fs.existsSync(filePath)) {
    return { fileLevel, lineIgnores };
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { fileLevel, lineIgnores };
  }

  const lines = content.split('\n');

  // 1. File-level: search the head for /* cqm-ignore ... */
  //    Only the first matching header counts; later ones are ignored.
  let resolvedFileLevel = false;
  for (let i = 0; i < Math.min(lines.length, HEAD_LINES_FOR_FILE_IGNORE); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('/*')) continue;

    // Match /* cqm-ignore */ or /* cqm-ignore: rule_a, rule_b */
    const m = trimmed.match(/^\/\*\s*cqm-ignore(?:\s*:\s*([^*]+?))?\s*\*\//);
    if (m) {
      if (m[1]) {
        const rules = m[1].split(',').map(s => s.trim()).filter(Boolean);
        if (rules.length > 0) resolvedFileLevel = rules;
      } else {
        resolvedFileLevel = true; // wildcard
      }
      break; // only the first one counts
    }
  }

  // 2. Line-level: // cqm-ignore or // cqm-ignore: rule_id
  //    We allow trailing inline comments on the same line.
  const lineRegex = /\/\/\s*cqm-ignore(?:\s*:\s*([^\/\n]+?))?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = ln.match(lineRegex);
    if (!m) continue;
    const lineNum = i + 1;
    if (m[1]) {
      const rules = m[1].split(',').map(s => s.trim()).filter(Boolean);
      if (rules.length > 0) lineIgnores.set(lineNum, new Set(rules));
    } else {
      lineIgnores.set(lineNum, new Set(['*']));
    }
  }

  return { fileLevel: resolvedFileLevel, lineIgnores };
}

/**
 * Load .cqmignore file (gitignore-style). Empty list if missing.
 */
function loadCqmignore(repoRoot) {
  const p = path.join(repoRoot, '.cqmignore');
  if (!fs.existsSync(p)) return [];
  let content;
  try {
    content = fs.readFileSync(p, 'utf8');
  } catch (e) {
    return [];
  }
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

/**
 * Match a single .cqmignore pattern against a file:line.
 * Pattern forms:
 *   - 'path/to/file.js'             → exact file match (any line)
 *   - 'path/to/file.js:42'          → exact file:line match
 *   - 'scripts/test_*'              → glob (basic `*` support)
 *   - 'path:10-20'                  → line range (inclusive)
 *   - '!negation'                   → handled at higher layer if needed
 */
function matchCqmignorePattern(pattern, filePath, line) {
  // Range syntax: path:start-end (after the colon)
  let filePattern = pattern;
  let lineSpec = null;
  const colonIdx = pattern.lastIndexOf(':');
  if (colonIdx > 0) {
    const after = pattern.slice(colonIdx + 1);
    // Treat "10-20" as range; "42" as exact line
    if (/^\d+(-\d+)?$/.test(after)) {
      filePattern = pattern.slice(0, colonIdx);
      lineSpec = after;
    }
  }

  // Glob match
  let fileMatches;
  if (filePattern.includes('*')) {
    // Convert simple glob to regex; escape other regex chars
    const re = new RegExp(
      '^' +
        filePattern
          .split('*')
          .map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$'
    );
    fileMatches = re.test(filePath);
  } else {
    fileMatches = (filePath === filePattern) || filePath.endsWith('/' + filePattern);
  }
  if (!fileMatches) return false;

  if (lineSpec === null) return true;

  if (lineSpec.includes('-')) {
    const [start, end] = lineSpec.split('-').map(n => parseInt(n, 10));
    return line >= start && line <= end;
  }
  return String(line) === lineSpec;
}

/**
 * Compare file against git HEAD. Returns:
 *   { isModified, modifiedLines: number[], lastCommit: string|null, diffSize: number }
 *
 * If the working tree has uncommitted changes, `modifiedLines` is the list of
 * NEW line numbers (post-edit) touched by the diff. We use `git diff HEAD`
 * which combines staged + unstaged into a single unified diff.
 */
function compareAgainstGit(filePath, repoRoot, findingLine) {
  let diffOutput = '';
  try {
    diffOutput = execFileSync(
      'git',
      ['diff', 'HEAD', '--no-color', '-U0', '--', filePath],
      { cwd: repoRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (e) {
    // git may not be available, file may not be tracked, etc.
    return { isModified: false, modifiedLines: [], lastCommit: null, diffSize: 0 };
  }

  // Get last committed SHA for traceability
  let lastCommit = null;
  try {
    lastCommit = execFileSync(
      'git',
      ['log', '-1', '--format=%H', '--', filePath],
      { cwd: repoRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim() || null;
  } catch (e) {
    // ignore
  }

  if (!diffOutput.trim()) {
    return { isModified: false, modifiedLines: [], lastCommit, diffSize: 0 };
  }

  // Parse unified diff hunks: @@ -oldStart,oldCount +newStart,newCount @@
  const modifiedLines = [];
  const hunkRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
  let m;
  while ((m = hunkRegex.exec(diffOutput)) !== null) {
    const newStart = parseInt(m[3], 10);
    const newCount = m[4] ? parseInt(m[4], 10) : 1;
    for (let i = 0; i < newCount; i++) {
      modifiedLines.push(newStart + i);
    }
  }

  return {
    isModified: modifiedLines.includes(findingLine),
    modifiedLines,
    lastCommit,
    diffSize: diffOutput.length,
  };
}

/**
 * Load .state/repair_queue.jsonl (append-only fix queue).
 */
function loadRepairQueue(repoRoot) {
  const filePath = path.join(repoRoot, '.state', 'repair_queue.jsonl');
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function isQueueFixed(finding, queueEntries) {
  if (!Array.isArray(queueEntries) || queueEntries.length === 0) return null;
  return queueEntries.find(e =>
    e.status === 'fixed' &&
    e.file === finding.file &&
    String(e.line) === String(finding.line) &&
    (e.rule === finding.rule || !e.rule || !finding.rule)
  ) || null;
}

/**
 * Load .state/auto_repair_results.json and return the array of repair records.
 * Robust to missing file or schema drift.
 */
function loadAutoRepairResults(repoRoot) {
  const filePath = path.join(repoRoot, '.state', 'auto_repair_results.json');
  if (!fs.existsSync(filePath)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return [];
  }
  // Two known shapes:
  //   { all: [...] }        — modern shape
  //   { high: {success:[..]}} — alternate shape
  if (Array.isArray(data.all)) return data.all;
  if (data.high && Array.isArray(data.high.success)) return data.high.success;
  return [];
}

/**
 * Check if a finding has a matching entry in auto_repair_results.json.
 * Match on file + line (+ rule when available).
 */
function isAutoFixed(finding, autoRepairResults) {
  if (!Array.isArray(autoRepairResults) || autoRepairResults.length === 0) return false;

  return autoRepairResults.some(r => {
    if (!r || r.status !== 'success') return false;
    const issue = r.issue || r;
    if (!issue) return false;
    const fileMatch = issue.file === finding.file;
    const lineMatch = String(issue.line) === String(finding.line);
    const ruleMatch = !finding.rule || !issue.rule || issue.rule === finding.rule;
    return fileMatch && lineMatch && ruleMatch;
  });
}

/**
 * Detect the status of a single finding.
 * Returns { status, reason, commit?, fixRecord? }
 */
function detectStatus(finding, repoRoot, options = {}) {
  if (!finding || !finding.file) {
    return { status: 'pending', reason: 'Invalid finding (missing file)' };
  }
  const filePath = path.join(repoRoot, finding.file);
  const ruleId = finding.rule || '';
  const lineNum = finding.line;

  // 1. Suppressed — explicit user opt-out wins
  try {
    const { fileLevel, lineIgnores } = parseIgnoreComments(filePath);

    // Line-level first (more specific)
    if (lineIgnores.has(lineNum)) {
      const rules = lineIgnores.get(lineNum);
      if (rules.has('*') || rules.has(ruleId)) {
        return {
          status: 'suppressed',
          reason: `Line ${lineNum} has // cqm-ignore${rules.has('*') ? '' : ': ' + ruleId}`,
        };
      }
    }

    // File-level
    if (fileLevel === true) {
      return {
        status: 'suppressed',
        reason: `File header has /* cqm-ignore */ (wildcard)`,
      };
    }
    if (Array.isArray(fileLevel) && fileLevel.length > 0) {
      if (fileLevel.includes('*') || fileLevel.includes(ruleId)) {
        return {
          status: 'suppressed',
          reason: `File header has /* cqm-ignore: ${ruleId} */`,
        };
      }
    }
  } catch (e) {
    // ignore parse failure and continue
  }

  // 2. Queue-fixed — repair queue (authoritative fix record)
  if (!options.skipQueue) {
    try {
      const queue = loadRepairQueue(repoRoot);
      const record = isQueueFixed(finding, queue);
      if (record) {
        return {
          status: 'queue_fixed',
          reason: `Repair queue record: ${record.actor} at ${record.timestamp}`,
          fixRecord: record,
        };
      }
    } catch (e) { /* ignore */ }
  }

  // .cqmignore patterns
  try {
    const patterns = loadCqmignore(repoRoot);
    for (const pattern of patterns) {
      if (matchCqmignorePattern(pattern, finding.file, lineNum)) {
        return {
          status: 'suppressed',
          reason: `Matched .cqmignore pattern: ${pattern}`,
        };
      }
    }
  } catch (e) {
    // ignore
  }

  // 3. Approved — git evidence of manual fix
  try {
    const gitResult = compareAgainstGit(finding.file, repoRoot, lineNum);
    if (gitResult.isModified) {
      return {
        status: 'approved',
        reason: `git diff shows line ${lineNum} modified in working tree (uncommitted)`,
        commit: gitResult.lastCommit,
      };
    }
  } catch (e) {
    // ignore git failure
  }

  // 4. Auto-fixed
  if (!options.skipAutoFix) {
    try {
      const repairs = loadAutoRepairResults(repoRoot);
      if (isAutoFixed(finding, repairs)) {
        return {
          status: 'auto_fixed',
          reason: `Match in .state/auto_repair_results.json (file:line:rule)`,
        };
      }
    } catch (e) {
      // ignore
    }
  }

  // 5. Default: pending
  return {
    status: 'pending',
    reason: 'Scan flagged, no suppress comment, no git diff, no auto-fix record',
  };
}

module.exports = {
  detectStatus,
  parseIgnoreComments,
  compareAgainstGit,
  loadAutoRepairResults,
  loadRepairQueue,
  isQueueFixed,
  loadCqmignore,
  matchCqmignorePattern,
  isAutoFixed,
};
