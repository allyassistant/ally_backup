#!/usr/bin/env node
/**
 * Pure AI Audit Scanner - v2.0
 * Scans JS files for security, error handling, logic errors, and performance issues
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, '.openclaw', 'workspace', 'scripts');

// Skip these directories
const SKIP_DIRS = ['archive', '__tests__', 'lib/rules', 'lib/analyzers', 'lib/helpers', '_legacy', 'node_modules'];

// Files from payload to audit
const FILES_TO_AUDIT = [
  'adaptive_timeout.js', 'ai_image_generator.js', 'analyze_magic_numbers.js',
  'apple_notes.js', 'apple_reminders_calendar.js', 'archive_smart.js',
  'auto-router/handler.js', 'auto-spawn.js', 'auto_fix_history.js',
  'auto_issue_creator.js', 'auto_skill_router.js',
  'autoops/daily_stock_monitor.js', 'autoops/health_monitor.js', 'autoops/token_monitor.js',
  'browser_autoclose.js', 'chart_generator.js', 'check-router-decision.js',
  'check_pure_audit_pending.js', 'churn_predictor.js', 'code_quality_manager.js',
  'contact_manager.js', 'contract_checker.js',
  'cross_session_bootstrap.js', 'cross_session_context.js',
  'customer360.js', 'customer_analyzer.js',
  'daily_maintenance.js', 'daily_summary_bot.js', 'dashboard_generator.js',
  'date_tag_automation.js', 'diamond_valuation.js', 'document_template_engine.js',
  'email_generator.js', 'error_tracker.js', 'excel_report_generator.js',
  'gia_batch_processor.js', 'gia_certificate_ocr.js', 'gia_database.js',
  'gia_image_verifier.js', 'gia_ocr.js',
  'health_monitor.js', 'heartbeat_recall.js',
  'hooks/message_received.js',
  'idex_fetcher.js', 'idex_fetcher_bot.js',
  'image_processor.js', 'inventory_forecaster.js', 'invoice_generator.js',
  'issue_auto_followup.js', 'issue_daily_report.js', 'issue_manager.js',
  'issue_reminders_sync.js',
  'key_memory_marker.js', 'kimi_cli_runner.js',
  'l0_generator.js', 'l0_l1_verify.js', 'l1_generator.js',
  'lib/analyzers/file-analyzer.js', 'lib/analyzers/index.js',
  'lib/auditOrchestrator.js', 'lib/config.js', 'lib/fileDiscovery.js',
  'lib/helpers/context_helpers.js', 'lib/helpers/file-cache.js',
  'lib/helpers/index.js', 'lib/helpers/rule-helpers.js',
  'lib/helpers/skip-list.js', 'lib/helpers/try-catch-helpers-ast.js',
  'lib/helpers/try-catch-helpers.js', 'lib/helpers/whitelist_patterns.js',
  'lib/index.js', 'lib/issueAggregator.js', 'lib/state.js', 'lib/time.js',
  'log_to_daily_memory.js',
  'market_monitor.js', 'memory_archiver.js', 'memory_cleanup.js',
  'memory_distiller.js', 'memory_generator.js', 'memory_maintenance.js',
  'memory_sanitizer.js', 'memory_section_cleanup.js', 'memory_temporal_search.js',
  'merge_multi_sheet.js', 'news_summarizer.js', 'orchestrator.js',
  'pattern_analysis_daily.js', 'pattern_archive.js', 'pattern_error_tracker.js',
  'pattern_periodic_tagger.js', 'pattern_proactive_trigger.js',
  'pattern_project_tracker.js', 'pattern_resolver.js', 'pattern_topic_graph.js',
  'powerquery_generator.js', 'preference_tracker.js',
  'price_alert_system.js', 'price_history.js', 'price_predictor.js',
  'pure_audit_runner.js',
  'quotation_generator.js', 'rapaport_extractor.js',
  'rapnet_sender.js', 'rapnet_weekly.js', 'rapnet_weekly_workflow.js',
  'reminder_discussion.js', 'reminder_discussion_bot.js',
  'report_generator.js', 'report_templates.js',
  'session_cleanup.js', 'session_recovery.js',
  'skills_manager.js', 'smart_followup.js', 'smart_memory_router.js',
  'smart_query.js', 'state.js', 'status-server.js',
  'stock_merge_pro.js', 'stock_updater.js', 'streaming_archive.js',
  'system_check_bot.js', 'system_status_report.js',
  'task_router.js', 'terminology_manager.js',
  'tesseract_gia_ocr.js', 'timezone_fixer.js',
  'token_archive.js', 'translator.js',
  'update_rapaport_universal.js',
  'vba_generator.js', 'verify_backup.js', 'verify_fix.js',
  'watermark_manager.js', 'weekly_correction_loop.js',
  'weekly_parallel.js', 'weekly_session_cleanup.js'
];

// Patterns
const PATTERNS = {
  // Security: eval / Function constructor
  eval: /\b(eval|new\s+Function\s*\(|setTimeout\s*\(\s*(?:['"`][^'"`]*['"`]\s*,)|setInterval\s*\(\s*(?:['"`][^'"`]*['"`]\s*,))\b/,

  // Security: hardcoded secrets
  hardcodedSecret: /\b(password|secret|api_key|apikey|api-key|auth_token|authkey|access_token)\s*[=:]\s*['"][^'"]{4,}/i,

  // Security: shell injection (user input in exec/shell commands)
  shellInjection: /`\$\{.*?(?:req|input|user|param|body|query|argv|process\.argv).*?\}`|execSync\s*\(\s*`[^`]*\$\{.*?(?:req|input|user|param|body|query).*?\}`/,

  // Security: path traversal
  pathTraversal: /(?:\breadFile|\bwriteFile|\breaddir|\bopen|\bcreateReadStream|\bcreateWriteStream)\s*\(\s*(?:req|input|user|param|body|query|filename|file|path)\./,

  // Error handling: execSync without try-catch (we'll do line-level check)
  execSyncBare: /\bexecSync\s*\([^)]+\)(?!\s*[,;]?\s*(?:catch|\}))/,

  // Error handling: exec without try-catch (bare exec call)
  execBare: /\bexec\s*\([^)]+\)(?!\s*[,;]?\s*(?:catch|\}))/,

  // Error handling: fs.writeFileSync/readFileSync without try-catch
  fsSyncBare: /\b(readFileSync|writeFileSync|readdirSync|mkdirSync|unlinkSync|renameSync|appendFileSync|copyFileSync|statSync|existsSync)\s*\([^)]+\)(?!\s*[,;]?\s*(?:catch|\}))/,

  // Error handling: async without try-catch in function body
  asyncWithoutTry: /\basync\s+(?:function|\([^)]*\)\s*=>)\s*\{[^}]*\b(?:await|execSync|writeFileSync|readFileSync|exec\()/,

  // Performance: sync operations that could be async
  syncInAsync: /\basync\s+function[^}]*\{[^}]*\bfs\.(?:readFileSync|writeFileSync|readdirSync|mkdirSync|statSync|existsSync)/,

  // Type: potential undefined/null issues
  undefinedCheck: /\.forEach\s*\(\s*\([^)]*\)\s*=>/,

  // Logic: double log declaration (two function log or const+function)
  doubleLog: /\b(?:function|const|let|var)\s+log\s*[=(]/,

  // Logic: returns in try without proper control flow
  returnInTry: /try\s*\{[^}]*return[^}]*\}\s*catch/,

  // Security: crypto with hardcoded IV/key
  insecureCrypto: /crypto\.createCipher\(|decipher\(|createDecipher\(/,

  // Error: unhandled promise rejection
  unhandledRejection: /\.then\s*\([^)]*\)\s*(?!\s*\.catch)/,
};

// Priority mapping
const PRIORITY = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
};

function shouldSkip(file) {
  for (const skip of SKIP_DIRS) {
    if (file.includes(skip + '/') || file === skip) return true;
  }
  return false;
}

function isInComment(line, col) {
  const before = line.substring(0, col);
  // Simple check: if there's // or /* before this position not inside a string
  // Remove string literals first
  const withoutStrings = before.replace(/['"`][^'"`]*/g, 'X');
  return /\/\//.test(withoutStrings) || /\/\*/.test(withoutStrings);
}

function findIssues(filePath, content) {
  const issues = [];
  const lines = content.split('\n');
  const isLegacy = filePath.includes('_legacy/');

  // Pre-scan for double log declarations
  const logDeclLines = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return;
    if (PATTERNS.doubleLog.test(trimmed)) {
      logDeclLines.push(i + 1);
    }
  });
  const hasDoubleLog = logDeclLines.length >= 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comment-only lines for most patterns
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;

    // Check for eval
    if (PATTERNS.eval.test(line)) {
      const inComment = line.includes('//') && line.indexOf('//') < line.indexOf('eval');
      if (!inComment) {
        issues.push({ line: lineNum, code: line.trim(), pattern: 'eval', severity: PRIORITY.CRITICAL, file: filePath });
      }
    }

    // Check for hardcoded secrets
    const secretMatch = line.match(PATTERNS.hardcodedSecret);
    if (secretMatch) {
      // Skip if in comment
      if (!isInComment(line, secretMatch.index)) {
        issues.push({ line: lineNum, code: line.trim(), pattern: 'hardcoded_secret', severity: PRIORITY.CRITICAL, file: filePath });
      }
    }

    // Check for shell injection patterns
    if (PATTERNS.shellInjection.test(line)) {
      if (!isInComment(line, line.indexOf('execSync') || 0)) {
        issues.push({ line: lineNum, code: line.trim(), pattern: 'shell_injection', severity: PRIORITY.CRITICAL, file: filePath });
      }
    }

    // Check for path traversal
    if (PATTERNS.pathTraversal.test(line)) {
      issues.push({ line: lineNum, code: line.trim(), pattern: 'path_traversal', severity: PRIORITY.HIGH, file: filePath });
    }

    // Check for insecure crypto
    if (PATTERNS.insecureCrypto.test(line)) {
      issues.push({ line: lineNum, code: line.trim(), pattern: 'insecure_crypto', severity: PRIORITY.HIGH, file: filePath });
    }

    // Check for execSync/execFileSync without try-catch
    // Match ONLY actual function calls, not destructuring assignments like `const { execSync } = require(...)`
    // Must be preceded by word characters (function call) not by { (destructuring)
    const execCallRegex = /\bexec(?:File)?Sync\s*\(/;
    if (execCallRegex.test(line)) {
      // Skip destructuring lines (const { execSync } = require(...))
      if (/\{[^}]*(?:execFile)?Sync/i.test(line) && /const\s*\{|let\s*\{|var\s*\{/.test(line)) {
        continue;
      }
      const surrounding = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 3));
      const block = surrounding.join('\n');
      if (!/try\s*\{[^}]*\}\s*catch/.test(block) && !/\}?\s*catch/.test(block)) {
        let severity = PRIORITY.MEDIUM;
        if (/writeFileSync|errors\.json|state\.json|config|cache/.test(line)) {
          severity = PRIORITY.HIGH;
        } else if (/readFileSync|readdirSync/.test(line)) {
          severity = PRIORITY.LOW;
        }
        issues.push({ line: lineNum, code: line.trim(), pattern: 'execSync_missing_trycatch', severity, file: filePath });
      }
    }

    // Check for fs sync operations without try-catch
    if (/\b(writeFileSync|readFileSync|readdirSync|mkdirSync|unlinkSync|renameSync|appendFileSync|copyFileSync|statSync|existsSync)\s*\(/.test(line)) {
      const surrounding = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 3));
      const block = surrounding.join('\n');
      if (!/try\s*\{[^}]*\}\s*catch/.test(block) && !/\}?\s*catch/.test(block)) {
        let severity = PRIORITY.MEDIUM;
        if (/writeFileSync.*(?:errors\.json|state\.json|config|cache)/.test(line)) {
          severity = PRIORITY.HIGH;
        } else if (/readFileSync|readdirSync|statSync|existsSync/.test(line)) {
          severity = PRIORITY.LOW;
        } else if (/writeFileSync|mkdirSync|unlinkSync|renameSync|copyFileSync/.test(line)) {
          severity = PRIORITY.MEDIUM;
        }
        issues.push({ line: lineNum, code: line.trim(), pattern: 'fs_sync_missing_trycatch', severity, file: filePath });
      }
    }

    // Check for double log declaration - only flag if there are 2+ log declarations in the file
    if (hasDoubleLog && PATTERNS.doubleLog.test(line)) {
      issues.push({ line: lineNum, code: line.trim(), pattern: 'double_log_declaration', severity: PRIORITY.HIGH, file: filePath });
    }
  }

  return issues;
}

function auditFiles() {
  const allIssues = [];

  for (const file of FILES_TO_AUDIT) {
    if (shouldSkip(file)) continue;

    const filePath = path.join(BASE, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 102400) {
        console.log(`Skipping large file: ${file} (${stat.size} bytes)`);
        continue;
      }
    } catch (e) {
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      continue;
    }

    const issues = findIssues(file, content);
    allIssues.push(...issues);

    if (issues.length > 0) {
      const criticalCount = issues.filter(i => i.severity === PRIORITY.CRITICAL).length;
      const highCount = issues.filter(i => i.severity === PRIORITY.HIGH).length;
      const mediumCount = issues.filter(i => i.severity === PRIORITY.MEDIUM).length;
      const lowCount = issues.filter(i => i.severity === PRIORITY.LOW).length;
      console.log(`${file}: ${issues.length} issues (C:${criticalCount} H:${highCount} M:${mediumCount} L:${lowCount})`);
    }
  }

  // Sort by severity
  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return allIssues;
}

const issues = auditFiles();

// Summary
const counts = {
  Critical: issues.filter(i => i.severity === 'Critical').length,
  High: issues.filter(i => i.severity === 'High').length,
  Medium: issues.filter(i => i.severity === 'Medium').length,
  Low: issues.filter(i => i.severity === 'Low').length,
};

console.log('\n========== SUMMARY ==========');
console.log(`Total issues: ${issues.length}`);
console.log(`Critical: ${counts.Critical}`);
console.log(`High: ${counts.High}`);
console.log(`Medium: ${counts.Medium}`);
console.log(`Low: ${counts.Low}`);
console.log('==============================');

// Print all issues
console.log('\n========== ALL ISSUES ==========');
for (const issue of issues) {
  const emoji = issue.severity === 'Critical' ? '🔴' : issue.severity === 'High' ? '🟠' : issue.severity === 'Medium' ? '🟡' : '⚪';
  console.log(`\n${emoji} [${issue.file}]`);
  console.log(`  Line: ${issue.line}`);
  console.log(`  Pattern: ${issue.pattern}`);
  console.log(`  Severity: ${issue.severity}`);
  console.log(`  Code: ${issue.code.substring(0, 120)}`);
}
