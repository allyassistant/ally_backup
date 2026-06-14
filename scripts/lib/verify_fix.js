#!/usr/bin/env node
/**
 * verify_fix.js — Verify auto-fix persistence
 * =============================================
 * Reads auto_fix_history.json, re-scans fixed files with LOW_RISK_RULES
 * to confirm fixes are still valid, and updates verify_fix_log.json.
 *
 * Usage:
 *   node scripts/lib/verify_fix.js                    # Normal mode
 *   node scripts/lib/verify_fix.js --quiet            # Quiet mode
 *   node scripts/lib/verify_fix.js --force            # Re-verify all (not just unverified)
 *   node scripts/lib/verify_fix.js --hour-limit 48    # Only verify fixes < 48h old
 *
 * Exports:
 *   getFixCategory(fix)  — Categorize a fix as FORMATTING or QUALITY
 *   runVerification(opts)— Run verification, returns { results, summary }
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Paths ──
const STATE_DIR = path.join(__dirname, '..', '..', '.state');
const HISTORY_PATH = path.join(STATE_DIR, 'auto_fix_history.json');
const VERIFY_LOG_PATH = path.join(STATE_DIR, 'verify_fix_log.json');
const WORKSPACE_DIR = path.resolve(__dirname, '..', '..'); // workspace/

// ── LOW_RISK_RULES for re-detection ──
let LOW_RISK_RULES;
try {
  ({ LOW_RISK_RULES } = require('./rules/low-risk'));
} catch (e) {
  LOW_RISK_RULES = [];
}

// ── Category helpers ──

const FORMATTING_ISSUES = ['trailing-whitespace', 'missing-eof-newline', 'consecutive-blank-lines', 'missing-shebang'];
const FORMATTING_KEYWORDS = ['行尾空白', '換行符', '空白行', 'shebang'];

/**
 * Categorize a fix as FORMATTING or QUALITY.
 * @param {Object} fix — A fix record from auto_fix_history.json
 * @returns {'FORMATTING' | 'QUALITY'}
 */
function getFixCategory(fix) {
  const text = ((fix.issue || '') + ' ' + (fix.fix_applied || '')).toLowerCase();

  // Check by issue id pattern (formatting vs quality)
  const id = fix.rule || fix.id || '';
  if (FORMATTING_ISSUES.some(k => id.includes(k) || id.toLowerCase().includes(k))) {
    return 'FORMATTING';
  }

  // Check by keyword
  if (FORMATTING_KEYWORDS.some(k => text.includes(k))) {
    return 'FORMATTING';
  }

  // Audit records
  if (fix.isAuditRecord) return 'QUALITY';

  return 'QUALITY';
}

/**
 * Re-detect issues on a file using the matching LOW_RISK_RULE.
 * @param {Object} fix — Fix record
 * @returns {Object} — { stillFixed: boolean, currentCount: number, verificationFailures: string[] }
 */
function verifySingleFix(fix) {
  const result = { stillFixed: true, currentCount: 0, failures: [] };

  if (!fix.file) return result;
  if (fix.isAuditRecord) return result; // Skip audit records

  // Resolve file path
  const filePath = path.resolve(WORKSPACE_DIR, fix.file);
  if (!fs.existsSync(filePath)) {
    result.failures.push(`File ${fix.file} no longer exists`);
    result.stillFixed = false;
    return result;
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    result.failures.push(`Cannot read ${fix.file}: ${e.message}`);
    result.stillFixed = false;
    return result;
  }

  // Determine which rule to use for re-detection
  const ruleId = fix.rule || guessRuleIdFromFix(fix);
  const rule = LOW_RISK_RULES.find(r => r.id === ruleId);

  if (rule && rule.detect) {
    try {
      const detection = rule.detect(content, filePath);
      result.currentCount = detection.lines ? detection.lines.length : (detection.found ? 1 : 0);

      if (result.currentCount > 0) {
        // If fix had specific lines, check if those same lines still trigger
        if (fix.lines && fix.lines.length > 0 && detection.lines) {
          const stillFailing = fix.lines.filter(ln => detection.lines.includes(ln));
          if (stillFailing.length > 0) {
            result.failures.push(`${stillFailing.length} previously fixed line(s) still have issue`);
            result.stillFixed = false;
          }
        } else {
          result.failures.push(`${result.currentCount} issue(s) still detected in file`);
          result.stillFixed = false;
        }
      }
    } catch (e) {
      result.failures.push(`Detection error: ${e.message}`);
      result.stillFixed = false;
    }
  } else {
    // No matching rule — mark as inconclusive
    result.failures.push(`No matching rule found for ${ruleId}`);
    result.stillFixed = null; // Unknown
  }

  return result;
}

/**
 * Guess the LOW_RISK_RULE id from a fix's issue description.
 */
function guessRuleIdFromFix(fix) {
  const text = (fix.issue || '').toLowerCase();
  if (text.includes('行尾空白') || text.includes('trailing')) return 'trailing-whitespace';
  if (text.includes('換行符') || text.includes('eof') || text.includes('newline')) return 'missing-eof-newline';
  if (text.includes('空白行') || text.includes('blank')) return 'consecutive-blank-lines';
  if (text.includes('shebang')) return 'missing-shebang';
  if (text.includes('home') || text.includes('路徑')) return 'hardcoded-home-path';
  if (text.includes('簡體') || text.includes('chinese') || text.includes('simp')) return 'simplified-chinese';
  if (text.includes('magic') || text.includes('magic')) return 'magic-numbers-safe';
  if (text.includes('trycatch') || text.includes('try-catch') || text.includes('sync')) return 'fs-sync-trycatch';
  return null;
}

/**
 * Run verification on all unverified (or all) fixes in auto_fix_history.json.
 * @param {Object} options
 * @param {boolean} options.force — Re-verify all fixes, not just unverified
 * @param {number} options.hourLimit — Only verify fixes newer than N hours (default 168 = 7d)
 * @param {boolean} options.quiet — Suppress console output
 * @returns {Object} — { results: Array, summary: Object, verifyLog: Object }
 */
function runVerification(options = {}) {
  const { force = false, hourLimit = 168, quiet = false } = options;
  const results = [];
  let historyData = { fixes: [] };

  // Read history
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      historyData = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch (e) {
    if (!quiet) console.error(`[verify_fix] Cannot read history: ${e.message}`);
    return { results, summary: { total: 0, success: 0, fail: 0, skip: 0 } };
  }

  const now = Date.now();
  const maxAge = hourLimit * 60 * 60 * 1000;
  const fixes = (historyData.fixes || []).filter(f => !f.isAuditRecord);

  let verified = 0;
  let failed = 0;
  let skipped = 0;

  for (const fix of fixes) {
    // Check age limit
    const age = now - new Date(fix.timestamp || now).getTime();
    if (age > maxAge) {
      skipped++;
      continue;
    }

    // Skip if already verified (unless force)
    if (!force && fix.verified && fix.last_verification) {
      skipped++;
      continue;
    }

    // Run verification
    const vResult = verifySingleFix(fix);
    const fixResult = {
      fix_id: fix.id,
      file: fix.file,
      issue: fix.issue,
      age_hours: Math.round(age / (60 * 60 * 1000)),
      verified_at: new Date().toISOString(),
      is_dry_run: false,
      verdict: vResult.stillFixed === false ? 'fail' : (vResult.stillFixed === null ? 'inconclusive' : 'success'),
      success_rate: vResult.stillFixed === false ? 0 : (vResult.stillFixed === null ? null : 100),
      message: vResult.stillFixed === false
        ? `❌ 修復失效 — ${vResult.failures.join('; ')}`
        : (vResult.stillFixed === null
          ? `⚠️ 無法確認 — ${vResult.failures.join('; ')}`
          : `✅ 修復成功 — ${fix.issue}`),
      details: vResult
    };

    // Update fix record in history
    fix.verified = vResult.stillFixed !== false;
    fix.last_verification = fixResult.verified_at;
    fix.success_rate = fixResult.success_rate;
    if (vResult.stillFixed === false) {
      fix.failures = (fix.failures || 0) + 1;
      fix.status = fix.failures >= 3 ? 'deprecated' : 'active';
    }

    if (vResult.stillFixed === false) failed++;
    else verified++;

    results.push(fixResult);
  }

  // Update history file
  try {
    fs.writeFileSync(HISTORY_PATH + '.tmp', JSON.stringify(historyData, null, 2), 'utf8');
    fs.renameSync(HISTORY_PATH + '.tmp', HISTORY_PATH);
  } catch (e) {
    if (!quiet) console.error(`[verify_fix] Cannot write history: ${e.message}`);
  }

  // Build verify log
  const summary = {
    total: results.length,
    success: verified,
    fail: failed,
    skip: skipped
  };
  const verifyLog = {
    timestamp: new Date().toISOString(),
    timestampHKT: new Date().toLocaleString('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      hour12: true
    }),
    dry_run: false,
    results,
    summary
  };

  // Write verify log
  try {
    fs.writeFileSync(VERIFY_LOG_PATH + '.tmp', JSON.stringify(verifyLog, null, 2), 'utf8');
    fs.renameSync(VERIFY_LOG_PATH + '.tmp', VERIFY_LOG_PATH);
  } catch (e) {
    if (!quiet) console.error(`[verify_fix] Cannot write verify log: ${e.message}`);
  }

  if (!quiet) {
    console.log(`[verify_fix] Verified: ${verified}, Failed: ${failed}, Skipped: ${skipped}`);
  }

  return { results, summary, verifyLog };
}

// ── CLI entry point ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const force = args.includes('--force');

  let hourLimit = 168;
  const hlArg = args.find(a => a.startsWith('--hour-limit'));
  if (hlArg) hourLimit = parseInt(hlArg.split('=')[1]) || 168;

  const result = runVerification({ force, hourLimit, quiet });
  if (!quiet) {
    console.log(`\nSummary: ${result.summary.total} verified, ${result.summary.success} success, ${result.summary.fail} fail, ${result.summary.skip} skipped`);
  }
}

module.exports = { getFixCategory, runVerification, verifySingleFix };
