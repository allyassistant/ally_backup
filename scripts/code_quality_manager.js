#!/usr/bin/env node
/**
 * code_quality_manager.js - 代碼質量管理統一入口
 * 整合 fileDiscovery / issueAggregator / auditOrchestrator
 *
 * 提供統一的 CLI 介面和程式化 API
 *
 * Created: 2026-04-05
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

// ==================== 導入核心模組 ====================
const {
  FileDiscovery,
  CacheManager,
  createFileDiscovery,
  quickScan,
  DEFAULT_EXTENSIONS,
  DEFAULT_EXCLUDE_DIRS
} = require('./lib/fileDiscovery');

// ==================== 超時常量 ====================
const VERIFY_TIMEOUT_MS = 120000;  // 2 minutes
const AUTO_FIX_TIMEOUT_MS = 300000; // 5 minutes

const {
  IssueAggregator,
  IssueBuilder,
  createIssue,
  createAggregator,
  VALID_SEVERITIES,
  VALID_CATEGORIES,
  SEVERITY_WEIGHTS
} = require('./lib/issueAggregator');

const {
  AuditOrchestrator,
  LocalScanner,
  AIScanner,
  ErrorScanner,
  CONFIG: AUDIT_CONFIG
} = require('./lib/auditOrchestrator');

const {
  BatchVerifier,
  BV_CONFIG
} = require('./lib/batch_verifier');

const {
  PatternLearner,
  PL_CONFIG
} = require('./lib/pattern_learner');

const {
  AutoRepair,
  AR_CONFIG
} = require('./lib/auto_repair');

// ==================== 導入 Report 模板與生成器 (Phase 3) ====================
const {
  CodeQualityReportGenerator
} = require('./code_quality_generator');

const {
  CONFIG: TEMPLATE_CONFIG,
  createCodeQualityReportStructure
} = require('./code_quality_templates');

// ==================== 配置常量 ====================
const CQM_CONFIG = {
  VERSION: '1.0.0',
  NAME: 'Code Quality Manager',

  // 預設目錄
  DEFAULT_TARGET_DIRS: ['.'],

  // 掃描配置
  SCAN_CONFIG: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.py'],
    excludeDirs: [...DEFAULT_EXCLUDE_DIRS, '.state', '.cache', 'archive', '_legacy'],
    enableCache: true,
    cacheName: 'code_quality'
  },

  // 輸出配置
  OUTPUT: {
    dir: '.state',
    reportFile: 'code_quality_report.json',
    summaryFile: 'code_quality_summary.md'
  }
};

// ==================== Code Quality Manager ====================
class CodeQualityManager {
  constructor(options = {}) {
    this.options = {
      ...CQM_CONFIG.SCAN_CONFIG,
      ...options
    };

    // 初始化組件
    this.fileDiscovery = new FileDiscovery(this.options);
    this.issueAggregator = new IssueAggregator({
      autoDeduplicate: true,
      dedupStrategy: 'location'  // CQM-007: 統一使用 location 策略，與 auditOrchestrator 一致
    });
    this.auditOrchestrator = new AuditOrchestrator(options);
    this.batchVerifier = new BatchVerifier(options);
    // Phase 3: 使用新的 CodeQualityReportGenerator
    this.reportGenerator = new CodeQualityReportGenerator(options);

    // 執行結果
    this.results = {
      files: [],
      issues: [],
      summary: {},
      metadata: {}
    };
  }

  /**
   * 創建標準 Issue 併保留額外欄位
   * P0-2 Fix: 確保據據轉換時保留所有欄位 (reasoning, confidence 等)
   *
   * @param {Object} issue - 原始 issue 對像
   * @returns {Object} - 標準化後的 issue 對像
   */
  _createStandardIssue(issue) {
    // 標準欄位映射
    const standardFields = {
      source: issue.source || 'local',
      severity: issue.severity || 'medium',
      category: issue.category || 'reliability',
      file: issue.file,
      line: issue.line,
      rule: issue.rule,
      title: issue.message || issue.title || 'Unknown issue',
      description: issue.description || '',
      autoFixable: issue.autoFixable || false
    };

    // 收集額外欄位放入 metadata (P0-2 fix: 保留 reasoning, confidence 等)
    const metadata = {};

    // 保留 reasoning 和 confidence (常見的 BatchVerifier 輸出欄位)
    if (issue.reasoning !== undefined) metadata.reasoning = issue.reasoning;
    if (issue.confidence !== undefined) metadata.confidence = issue.confidence;
    if (issue.verified !== undefined) metadata.verified = issue.verified;

    // 保留任何其他不在標準欄位中的欄位
    const standardKeys = new Set(['source', 'severity', 'category', 'file', 'line', 'rule', 'title', 'message', 'description', 'autoFixable', 'id', 'status', 'createdAt']);
    for (const [key, value] of Object.entries(issue)) {
      if (!standardKeys.has(key) && value !== undefined) {
        metadata[key] = value;
      }
    }

    // 如果有額外欄位，加入到 standardFields
    if (Object.keys(metadata).length > 0) {
      standardFields.metadata = metadata;
    }

    return standardFields;
  }

  /**
   * 發現檔案
   */
  discoverFiles(targetDirs, options = {}) {
    const dirs = Array.isArray(targetDirs) ? targetDirs : [targetDirs];

    console.log(`🔍 Discovering files in ${dirs.length} directorie(s)...`);

    const discoveryResult = this.fileDiscovery.scanDirectories(dirs, options);

    this.results.files = discoveryResult.files;

    console.log(`   ✓ Found: ${discoveryResult.stats.total} files`);
    console.log(`   ✓ Changed: ${discoveryResult.stats.changed}`);
    console.log(`   ✓ Unchanged (cached): ${discoveryResult.stats.unchanged}`);
    console.log(`   ✓ Cache hit rate: ${discoveryResult.stats.cacheHitRate}%`);

    if (discoveryResult.errors.length > 0) {
      console.log(`   ⚠️ Errors: ${discoveryResult.errors.length}`);
    }

    return discoveryResult;
  }

  /**
   * 執行審計
   */
  async runAudit(files, options = {}) {
    console.log(`\n🎯 Running audit on ${files.length} files...`);

    const filePaths = files.map(f => typeof f === 'string' ? f : f.path);
    const auditResults = await this.auditOrchestrator.run(filePaths, options);

    // 將結果轉換為標準 Issue 格式並添加到 aggregator
    for (const issue of auditResults.merged) {
      try {
        // CQM-004: 添加 issue 驗證
        if (!issue || typeof issue !== 'object') {
          console.error(`⚠️ Invalid issue: not an object`);
          continue;
        }

        if (!issue.file) {
          console.error(`⚠️ Invalid issue: missing file property`, issue);
          continue;
        }

        // P0-2 Fix: 使用 _createStandardIssue 保留所有欄位
        const standardIssue = createIssue(this._createStandardIssue(issue));

        this.issueAggregator.add(standardIssue);
      } catch (err) {
        // CQM-004: 添加錯誤日誌
        console.error(`⚠️ Failed to process issue from ${issue?.file || 'unknown'}: ${err.message}`);
      }
    }

    return auditResults;
  }

  /**
   * 執行 Batch Verification
   * 使用 Kimi Code CLI 一次性確認多個候選問題
   */
  async runBatchVerification(candidates, options = {}) {
    if (!candidates || candidates.length === 0) {
      console.log('⚠️ No candidates to verify');
      return { verified: [], rejected: [], needsReview: [], skipped: true };
    }

    console.log(`\n🔍 Running Batch Verification on ${candidates.length} candidates...`);

    const verifyResults = await this.batchVerifier.verifyBatch(candidates, options);

    // 將驗證後的 issues 添加到 aggregator
    // 只添加 VERIFIED 且高置信度的問題
    const verifiedIssues = this.batchVerifier.convertToIssues();

    console.log(`   ✅ Verified (high confidence): ${verifiedIssues.length}`);
    console.log(`   ⚠️ Needs review: ${verifyResults.needsReview?.length || 0}`);
    console.log(`   ❌ Rejected (false positives): ${verifyResults.rejected?.length || 0}`);

    // P0-2 Fix: 將驗證後的 issues 添加到 aggregator
    // 注意: verifiedIssues 來自 BatchVerifier.convertToIssues()，包含 confidence 和 reasoning
    for (const issue of verifiedIssues) {
      try {
        // 使用 _createStandardIssue 保留 confidence, reasoning 等欄位
        const standardIssue = createIssue(this._createStandardIssue({
          ...issue,
          source: issue.source || 'batch'
        }));
        this.issueAggregator.add(standardIssue);
      } catch (err) {
        console.error(`⚠️ Failed to add verified issue: ${err.message}`);
      }
    }

    // ==================== Phase 2: Self-Learning Pattern Store ====================
    // 從 Batch Verification 結果學習 False Positive Patterns
    if (verifyResults.rejected?.length > 0 || verifyResults.verified?.length > 0) {
      console.log(`\n📚 PatternLearner: Learning from verification results...`);

      // 初始化 PatternLearner
      if (!this.patternLearner) {
        this.patternLearner = new PatternLearner();
      }

      // 學習驗證結果
      const learnResults = this.patternLearner.learn(verifyResults);

      console.log(`   📗 FP patterns learned: ${learnResults.fpLearned}`);
      console.log(`   📘 TP patterns learned: ${learnResults.tpLearned}`);
      console.log(`   🔄 Patterns updated: ${learnResults.updated}`);

      // 更新 Scanner 白名單
      console.log(`\n🔄 Updating scanner rules...`);
      this.patternLearner.updateScannerRules();
    }

    return {
      ...verifyResults,
      verifiedIssues
    };
  }

  /**
   * 執行 Auto-Repair
   * Phase 3: 根據置信度自動修復已驗證的問題
   *
   * @param {Object} verifiedResults - Batch Verification 的結果
   * @param {Object} options - 選項
   * @returns {Object} - 修復結果
   */
  async runAutoRepair(verifiedResults, options = {}) {
    const verifiedIssues = verifiedResults?.verified || [];

    if (verifiedIssues.length === 0) {
      console.log('⚠️ No verified issues to repair');
      return { skipped: true };
    }

    console.log(`\n🔧 Auto-Repair: Processing ${verifiedIssues.length} verified issues...`);

    // 初始化 AutoRepair
    if (!this.autoRepair) {
      this.autoRepair = new AutoRepair();
    }

    // Step 1: 決定修復策略
    const strategies = this.autoRepair.decideRepairStrategy(verifiedIssues);

    console.log(`\n   📊 Strategies:`);
    console.log(`      HIGH: ${strategies.high.length} — auto-fix`);
    console.log(`      MEDIUM: ${strategies.medium.length} — need approval`);
    console.log(`      LOW: ${strategies.low.length} — skip + learn`);

    // Step 2: 自動修復高置信度
    let fixResults = [];
    if (strategies.high.length > 0) {
      fixResults = await this.autoRepair.autoFix(strategies.high);
    }

    // Step 3: 請求確認中等置信度
    let approvalInfo = null;
    if (strategies.medium.length > 0) {
      approvalInfo = this.autoRepair.requestApproval(strategies.medium);
    }

    // Step 4: 學習低置信度
    if (strategies.low.length > 0) {
      this.autoRepair.learnLowConfidence(strategies.low);
    }

    return {
      strategies,
      fixResults,
      approvalInfo,
      summary: this.autoRepair.getResults()
    };
  }

  /**
   * 添加自定義 issues
   */
  addIssues(issues) {
    return this.issueAggregator.addMany(issues);
  }

  /**
   * 獲取所有 issues
   */
  getIssues(options = {}) {
    return this.issueAggregator.getAll(options);
  }

  /**
   * 生成報告
   * Phase 3: 使用 CodeQualityReportGenerator 格式化輸出
   */
  generateReport(format = 'json') {
    const issues = this.issueAggregator.getAll();
    const summary = this.issueAggregator.getSummary();

    // 使用新的 CodeQualityReportGenerator 生成報告
    const qaData = {
      issues,
      summary: {
        ...summary,
        bySeverity: summary.bySeverity || {},
        byCategory: summary.byCategory || {}
      }
    };

    return this.reportGenerator.format(format, qaData);
  }

  /**
   * 保存報告
   */
  saveReport(outputDir, options = {}) {
    const dir = outputDir || CQM_CONFIG.OUTPUT.dir;
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        console.error(`❌ 創建輸出目錄失敗: ${err.message}`);
        return [];
    }

    const formats = options.formats || ['json', 'markdown'];
    const savedFiles = [];

    for (const format of formats) {
      let content;
      let ext;
      let fileName;

      switch (format) {
        case 'json':
          content = this.generateReport('json');
          ext = 'json';
          fileName = `${CQM_CONFIG.OUTPUT.reportFile.replace('.json', '')}.${ext}`;
          break;
        case 'markdown':
        case 'md':
          content = this.generateReport('markdown');
          ext = 'md';
          fileName = `${CQM_CONFIG.OUTPUT.reportFile.replace('.json', '')}.${ext}`;
          break;
        case 'sarif':
          content = this.generateReport('sarif');
          ext = 'sarif.json';
          fileName = `${CQM_CONFIG.OUTPUT.reportFile.replace('.json', '')}.${ext}`;
          break;
        case 'compat':
          // 兼容性報告：保存為 pure_ai_audit_results.json 供 system_check_bot.js 讀取
          content = this.generateReport('compat');
          fileName = 'pure_ai_audit_results.json';
          break;
        default:
          continue;
      }

      const filePath = path.join(dir, fileName);

      try {
        fs.writeFileSync(filePath, content, 'utf8');
      } catch (err) {
        console.error(`❌ 保存報告失敗: ${err.message}`);
        continue;
      }
      savedFiles.push(filePath);
      console.log(`   💾 Saved: ${filePath}`);
    }

    return savedFiles;
  }

  /**
   * 獲取統計摘要
   */
  getSummary() {
    return this.issueAggregator.getSummary();
  }

  /**
   * 執行完整流程
   */
  async run(targetDirs, options = {}) {
    const startTime = Date.now();

    console.log(`\n${'='.repeat(50)}`);
    console.log(`  ${CQM_CONFIG.NAME} v${CQM_CONFIG.VERSION}`);
    console.log(`${'='.repeat(50)}\n`);

    // Step 1: 發現檔案
    const discoveryResult = await this.discoverFiles(
      targetDirs || CQM_CONFIG.DEFAULT_TARGET_DIRS,
      options.discovery
    );

    if (discoveryResult.files.length === 0) {
      console.log('\n⚠️ No files found to analyze');
      return this.results;
    }

    // Step 2: 執行審計
    await this.runAudit(discoveryResult.files, options.audit);

    // Step 3: 生成並保存報告
    console.log('\n📝 Generating reports...');
    // 默認包含 compat 格式供 system_check_bot.js 讀取
    const reportOptions = options.report || { formats: ['json', 'markdown', 'compat'] };
    const savedFiles = this.saveReport(options.outputDir, reportOptions);

    // 最終摘要
    const summary = this.getSummary();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n${'='.repeat(50)}`);
    console.log('  Results Summary');
    console.log(`${'='.repeat(50)}`);
    console.log(`  Total Issues: ${summary.total}`);
    console.log(`  🔴 Critical: ${summary.critical}`);
    console.log(`  🟠 High: ${summary.high}`);
    console.log(`  🟡 Medium: ${summary.medium}`);
    console.log(`  🟢 Low: ${summary.low}`);
    console.log(`  Auto-fixable: ${summary.autoFixable}`);
    console.log(`  Duration: ${duration}s`);
    console.log(`${'='.repeat(50)}\n`);

    // 設置結果
    this.results.issues = this.getIssues();
    this.results.summary = summary;
    this.results.metadata = {
      duration,
      timestamp: getHKTDateTime(),
      savedFiles
    };

    return this.results;
  }

  /**
   * 清除緩存
   */
  clearCache() {
    this.fileDiscovery.clearCache();
    console.log('✓ File discovery cache cleared');
  }

  /**
   * 獲取緩存統計
   */
  getCacheStats() {
    return this.fileDiscovery.getCacheStats();
  }
}

// ==================== CLI 命令處理 ====================
class CLIHandler {
  constructor() {
    this.commands = new Map();
    this.setupCommands();
  }

  setupCommands() {
    this.commands.set('scan', {
      description: 'Run full code quality scan',
      options: [
        { flag: '--dir <path>', desc: 'Target directory (default: current)' },
        { flag: '--ext <exts>', desc: 'File extensions (e.g., js,ts,py)' },
        { flag: '--output <dir>', desc: 'Output directory' },
        { flag: '--format <fmt>', desc: 'Report format: json, markdown, sarif' },
        { flag: '--no-cache', desc: 'Disable cache' },
        { flag: '--fresh', desc: 'Force fresh scan, ignore cache' },
        { flag: '--quiet', desc: 'Quiet mode' },
        { flag: '--no-system-check', desc: 'Skip system check after scan' },
        { flag: '--notify', desc: 'Send system check Discord notification after scan (opt-in, default off)' },
        { flag: '--enable-skill-scan', desc: 'Enable SKILL.md integrity scan on skills-learned/ (opt-in, default off)' }
      ],
      action: this.cmdScan.bind(this)
    });

    // Phase 1: Batch Verification command
    this.commands.set('verify', {
      description: 'Run batch verification on existing results (uses Kimi CLI)',
      options: [
        { flag: '--input <file>', desc: 'Input results file (default: .state/audit_orchestrator_results.json)' },
        { flag: '--batch-size <N>', desc: `Batch size per Kimi call (default: ${BV_CONFIG.BATCH_SIZE})` },
        { flag: '--output <file>', desc: 'Output file for verified results' },
        { flag: '--quiet', desc: 'Quiet mode' }
      ],
      action: this.cmdVerify.bind(this)
    });

    // Phase 3: Confidence-based Auto-Repair command
    this.commands.set('repair', {
      description: 'Auto-repair verified issues based on confidence (uses Kimi CLI)',
      options: [
        { flag: '--input <file>', desc: 'Input verified results file (default: .state/batch_verifier_results.json)' },
        { flag: '--approve <id>', desc: 'Approve and fix a specific pending issue' },
        { flag: '--quiet', desc: 'Quiet mode' }
      ],
      action: this.cmdRepair.bind(this)
    });

    // CQM-001: 添加 fix 命令
    this.commands.set('fix', {
      description: 'Run scan and auto-fix issues',
      options: [
        { flag: '--dir <path>', desc: 'Target directory (default: current)' },
        { flag: '--ext <exts>', desc: 'File extensions (e.g., js,ts,py)' },
        { flag: '--dry-run', desc: 'Preview fixes without applying' },
        { flag: '--quiet', desc: 'Quiet mode' },
        { flag: '--enable-skill-scan', desc: 'Enable SKILL.md integrity scan on skills-learned/ (opt-in, default off)' }
      ],
      action: this.cmdFix.bind(this)
    });

    this.commands.set('discover', {
      description: 'Only discover files without auditing',
      options: [
        { flag: '--dir <path>', desc: 'Target directory' },
        { flag: '--json', desc: 'Output as JSON' }
      ],
      action: this.cmdDiscover.bind(this)
    });

    this.commands.set('audit', {
      description: 'Run audit on specific files',
      options: [
        { flag: '--files <paths>', desc: 'Comma-separated file paths' },
        { flag: '--output <dir>', desc: 'Output directory' }
      ],
      action: this.cmdAudit.bind(this)
    });

    this.commands.set('cache', {
      description: 'Manage file discovery cache',
      options: [
        { flag: '--clear', desc: 'Clear cache' },
        { flag: '--stats', desc: 'Show cache stats' }
      ],
      action: this.cmdCache.bind(this)
    });

    this.commands.set('report', {
      description: 'Generate report from existing results',
      options: [
        { flag: '--input <file>', desc: 'Input results file' },
        { flag: '--format <fmt>', desc: 'Output format' },
        { flag: '--output <file>', desc: 'Output file' }
      ],
      action: this.cmdReport.bind(this)
    });

    this.commands.set('help', {
      description: 'Show help',
      options: [],
      action: this.cmdHelp.bind(this)
    });
  }

  parseArgs(args) {
    const options = {};
    const positional = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith('--')) {
        const key = arg.replace(/^--/, '');
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          options[key] = args[i + 1];
          i++;
        } else {
          options[key] = true;
        }
      } else if (arg.startsWith('-')) {
        const key = arg.replace(/^-/, '');
        options[key] = true;
      } else {
        positional.push(arg);
      }
    }

    return { command: positional[0], args: positional.slice(1), options };
  }

  async cmdScan(parsed) {
    const targetDirs = parsed.options.dir ? [parsed.options.dir] : ['.'];
    const ext = parsed.options.ext
      ? parsed.options.ext.split(',').map(e => e.startsWith('.') ? e : `.${e}`)
      : CQM_CONFIG.SCAN_CONFIG.extensions;

    const cqm = new CodeQualityManager({
      extensions: ext,
      enableCache: !parsed.options['no-cache'],
      _quiet: parsed.options.quiet
    });

    // Issue 1 fix: If --fresh flag is set, clear cache before scanning
    if (parsed.options.fresh) {
      cqm.clearCache();
    }

    // 默認生成 json、markdown 和 compat 格式的報告
    // compat 格式供 system_check_bot.js 讀取
    const reportOptions = {
      formats: parsed.options.format ? [parsed.options.format] : ['json', 'markdown', 'compat']
    };

    // CQM-003: 使用返回的 results 正確輸出報告
    const results = await cqm.run(targetDirs, {
      outputDir: parsed.options.output,
      report: reportOptions
    });

    // 輸出掃描結果摘要
    if (!parsed.options.quiet) {
      console.log('\n📊 Scan Results Summary:');
      console.log(`   Files scanned: ${results.files.length}`);
      console.log(`   Issues found: ${results.summary.total}`);
      console.log(`   🔴 Critical: ${results.summary.critical}`);
      console.log(`   🟠 High: ${results.summary.high}`);
      console.log(`   🟡 Medium: ${results.summary.medium}`);
      console.log(`   🟢 Low: ${results.summary.low}`);
    }

    // ── Skill Integrity Scan (opt-in) ──
    // 掃描 skills-learned/ 入面嘅 SKILL.md 完整性：frontmatter、命令、
    // wikilink、cross-reference、truncation。預設 off，要 --enable-skill-scan 先開。
    if (parsed.options['enable-skill-scan']) {
      try {
        const { SkillIntegrityScanner } = require('./lib/skillIntegrityScanner');
        const scanner = new SkillIntegrityScanner({ quiet: parsed.options.quiet });
        const skillIssues = scanner.scanAll();

        if (skillIssues.length > 0) {
          results.summary.total += skillIssues.length;

          // Map scanner severity to CQM severity
          for (const issue of skillIssues) {
            const sevMap = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
            const cqmSev = sevMap[issue.severity] || 'info';
            results.summary[cqmSev] = (results.summary[cqmSev] || 0) + 1;

            // Ensure files list includes the scanned file
            if (!results.files.includes(issue.file)) {
              results.files.push(issue.file);
            }
          }

          if (!parsed.options.quiet) {
            console.log(`\n📋 Skill Integrity Scan:`);
            console.log(`   Skills checked: ${scanner.summarize().skillsScanned}`);
            console.log(`   Skill issues: ${skillIssues.length}`);
            console.log(`\n📊 Updated total: ${results.summary.total} issues (${results.summary.critical}🔴 ${results.summary.high}🟠 ${results.summary.medium}🟡 ${results.summary.low}🟢)`);

            for (const issue of skillIssues) {
              const sevIcon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢', FATAL: '💥' }[issue.severity] || '⚪';
              const lineStr = issue.line > 0 ? `:${issue.line}` : '';
              console.log(`     ${sevIcon} ${issue.file}${lineStr} — ${issue.message}`);
            }
          }
        } else if (!parsed.options.quiet) {
          console.log('\n📋 Skill Integrity Scan: ✅ All 33 skills pass integrity checks');
        }

        // Store in results for report output
        if (!results.skillScan) results.skillScan = {};
        results.skillScan.issues = skillIssues;
        results.skillScan.summary = scanner.summarize();

        // Merge skill issues into saved report so system_check_bot can see them
        // system_check_generator.js reads `findings || issues`, so add to BOTH
        try {
          var outputDir = parsed.options.output || CQM_CONFIG.OUTPUT.dir;
          var compatFile = path.join(outputDir, 'pure_ai_audit_results.json');
          if (fs.existsSync(compatFile) && fs.statSync(compatFile).size > 0) {
            var report = JSON.parse(fs.readFileSync(compatFile, 'utf8'));

            // Strip stale skill issues before appending new ones (B1 fix)
            if (Array.isArray(report.findings)) {
              report.findings = report.findings.filter(function (f) { return f.source !== 'skillIntegrityScanner'; });
            }
            if (Array.isArray(report.issues)) {
              report.issues = report.issues.filter(function (f) { return f.source !== 'skillIntegrityScanner'; });
            }

            // Append new skill issues if any
            if (skillIssues.length > 0) {
              const sevMap = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
              let skillCompat = [];
              for (let si = 0; si < skillIssues.length; si++) {
                const iss = skillIssues[si];
                skillCompat.push({
                  id: 'SKILL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                  file: iss.file,
                  line: iss.line,
                  severity: sevMap[iss.severity] || 'low',
                  rule: iss.rule,
                  title: iss.message,
                  description: iss.message,
                  source: 'skillIntegrityScanner',
                  status: 'open'
                });
              }
              if (!Array.isArray(report.findings)) report.findings = [];
              report.findings.push.apply(report.findings, skillCompat);
              if (!Array.isArray(report.issues)) report.issues = [];
              report.issues.push.apply(report.issues, skillCompat);
            }

            // Recompute summary from filtered+appended findings (source of truth)
            var sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
            for (var fi = 0; fi < report.findings.length; fi++) {
              var sv = report.findings[fi].severity || 'low';
              if (sevCounts[sv] !== undefined) sevCounts[sv]++;
            }
            if (!report.summary) report.summary = {};
            for (var sk in sevCounts) report.summary[sk] = sevCounts[sk];
            report.summary.total = sevCounts.critical + sevCounts.high + sevCounts.medium + sevCounts.low;

            // Always save the cleaned report
            try {
              fs.writeFileSync(compatFile, JSON.stringify(report, null, 2), 'utf8');
            } catch (e) {
              console.error(`File write failed: ${e.message}`);
            }
            if (!parsed.options.quiet && skillIssues.length > 0) {
              const relPath = path.relative(path.resolve(__dirname, '..', '..'), compatFile);
              console.log('   📄 Updated ' + relPath + ' with ' + skillIssues.length + ' skill issues');
            }
          }
        } catch (mergeErr) {
          if (!parsed.options.quiet) {
            console.warn('   ⚠️ Could not update report with skill issues: ' + mergeErr.message);
          }
        }
      } catch (skillErr) {
        console.error(`\n⚠️ Skill integrity scan skipped: ${skillErr.message}`);
      }
    }

    // CQM-002: scan 完成後調用 system_check_bot 顯示剩余問題
    // 2026-06-07: 預設 silent 避免 sub-agents 跑 scan 嗰陣 spam Discord;
    // 要 notification 嘅 caller 必須 explicit 帶 --notify
    if (parsed.options.notify && !parsed.options['no-system-check']) {
      await this.runSystemCheckBot(parsed.options.quiet);
    }

    return results;
  }

  // Phase 1: cmdVerify - Batch Verification using Kimi CLI
  async cmdVerify(parsed) {
    const inputFile = parsed.options.input
      || path.join(__dirname, '..', '.state', 'audit_orchestrator_results.json');

    const outputFile = parsed.options.output
      || path.join(__dirname, '..', '.state', 'batch_verifier_results.json');

    const batchSize = parsed.options['batch-size']
      ? parseInt(parsed.options['batch-size'], 10)
      : BV_CONFIG.BATCH_SIZE;

    // 讀取輸入文件
    let inputData;
    try {
      const content = fs.readFileSync(inputFile, 'utf8');
      inputData = JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.error(`❌ Input file not found: ${inputFile}`);
        console.error('   Run "code_quality_manager.js scan" first to generate audit results.');
        process.exit(1);
      }
      console.error(`❌ Failed to read input file: ${err.message}`);
      process.exit(1);
    }

    // 提取候選問題
    const candidates = inputData.merged || inputData.results?.merged || inputData.issues || [];

    if (candidates.length === 0) {
      console.log('⚠️ No candidate issues found in input file');
      return;
    }

    console.log(`\n🔍 Batch Verification`);
    console.log(`   Input: ${inputFile}`);
    console.log(`   Candidates: ${candidates.length}`);
    console.log(`   Batch size: ${batchSize}`);

    // 創建 BatchVerifier 並運行
    const verifier = new BatchVerifier({ BATCH_SIZE: batchSize });
    const verifyResults = await verifier.verifyBatch(candidates);

    // 保存結果
    verifier.saveResults(outputFile);

    // 顯示摘要
    const stats = verifier.getStats();
    console.log('\n📊 Verification Summary:');
    console.log(`   Total candidates: ${stats.total}`);
    console.log(`   ✅ Verified: ${stats.verified}`);
    console.log(`   ❌ Rejected (false positives): ${stats.rejected}`);
    console.log(`   👀 Needs review: ${stats.needsReview}`);
    console.log(`   Avg confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`);
    console.log(`   Output: ${outputFile}`);

    // 如果有 rejected issues，顯示詳細信息
    if (verifyResults.rejected && verifyResults.rejected.length > 0) {
      console.log('\n❌ Rejected Issues (false positives):');
      for (const issue of verifyResults.rejected.slice(0, 5)) {
        console.log(`   - ${issue.file}${issue.line ? ':' + issue.line : ''}`);
        console.log(`     ${issue.reasoning || issue.message}`);
      }
      if (verifyResults.rejected.length > 5) {
        console.log(`   ... and ${verifyResults.rejected.length - 5} more`);
      }
    }

    // ==================== Phase 2: Self-Learning Pattern Store ====================
    // 從 Batch Verification 結果學習 False Positive Patterns
    console.log('\n📚 PatternLearner: Learning from verification results...');

    const learner = new PatternLearner();
    const learnResults = learner.learn(verifyResults);

    console.log(`   📗 FP patterns learned: ${learnResults.fpLearned}`);
    console.log(`   📘 TP patterns learned: ${learnResults.tpLearned}`);
    console.log(`   🔄 Patterns updated: ${learnResults.updated}`);

    // 顯示 PatternLearner 統計
    const learnerStats = learner.getStats();
    console.log('\n📈 Pattern Learner Stats:');
    console.log(`   FP Whitelist: ${learnerStats.fp_whitelist.total} patterns (${learnerStats.fp_whitelist.high_confidence} high confidence)`);
    console.log(`   TP Tracker: ${learnerStats.tp_tracker.total} patterns across ${learnerStats.tp_tracker.by_rule} rules`);

    // 更新 Scanner 白名單
    console.log('\n🔄 Updating scanner rules...');
    learner.updateScannerRules();
  }

  // Phase 3: cmdRepair - Confidence-based Auto-Repair
  async cmdRepair(parsed) {
    const inputFile = parsed.options.input
      || path.join(__dirname, '..', '.state', 'batch_verifier_results.json');

    // 處理 approve 命令
    if (parsed.options.approve) {
      console.log(`\n🔧 Auto-Repair: Approving issue ${parsed.options.approve}...`);
      const repair = new AutoRepair();
      const result = await repair.approveIssue(parsed.options.approve);

      console.log(`   Status: ${result.status}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      } else if (result.verification) {
        console.log(`   Verification: ${result.verification}`);
      }
      return;
    }

    // 讀取輸入文件
    let inputData;
    try {
      const content = fs.readFileSync(inputFile, 'utf8');
      inputData = JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.error(`❌ Input file not found: ${inputFile}`);
        console.error('   Run "code_quality_manager.js verify" first to generate verification results.');
        process.exit(1);
      }
      console.error(`❌ Failed to read input file: ${err.message}`);
      process.exit(1);
    }

    // 提取已驗證的問题
    const verifiedIssues = inputData.verified || [];

    if (verifiedIssues.length === 0) {
      console.log('⚠️ No verified issues to repair');
      return;
    }

    console.log(`\n🔧 Auto-Repair v${AR_CONFIG.VERSION} - Confidence-based Auto-Fix`);
    console.log(`   Input: ${inputFile}`);
    console.log(`   Verified issues: ${verifiedIssues.length}`);

    // 創建 AutoRepair 實例
    const repair = new AutoRepair();

    // Step 1: 決定修復策略
    console.log(`\n📋 Step 1: Deciding repair strategies...`);
    const strategies = repair.decideRepairStrategy(verifiedIssues);

    console.log(`\n   📊 Confidence-based Strategies:`);
    console.log(`      HIGH (>${AR_CONFIG.REPAIR_STRATEGIES.HIGH.threshold}%): ${strategies.high.length} issues — auto-fix`);
    console.log(`      MEDIUM (${AR_CONFIG.REPAIR_STRATEGIES.MEDIUM.threshold}-${AR_CONFIG.REPAIR_STRATEGIES.HIGH.threshold - 1}%): ${strategies.medium.length} issues — need approval`);
    console.log(`      LOW (<${AR_CONFIG.REPAIR_STRATEGIES.MEDIUM.threshold}%): ${strategies.low.length} issues — skip + learn`);

    // Step 2: 自動修復高置信度問题
    let fixResults = [];
    if (strategies.high.length > 0) {
      console.log(`\n🔧 Step 2: Auto-fixing HIGH confidence issues...`);
      fixResults = await repair.autoFix(strategies.high);

      const successCount = fixResults.filter(r => r.status === 'success').length;
      const failedCount = fixResults.filter(r => r.status === 'failed').length;
      console.log(`   ✅ Fixed: ${successCount}`);
      if (failedCount > 0) {
        console.log(`   ❌ Failed: ${failedCount}`);
      }
    }

    // Step 3: 請求確認中等置信度問题
    if (strategies.medium.length > 0) {
      console.log(`\n👀 Step 3: Requesting approval for MEDIUM confidence issues...`);
      const approvalResult = repair.requestApproval(strategies.medium);
      console.log(`   📝 ${approvalResult.count} issues added to pending approval`);
      console.log(`   💡 Use: node scripts/code_quality_manager.js repair --approve <id>`);
    }

    // Step 4: 學習低置信度問题
    if (strategies.low.length > 0) {
      console.log(`\n📚 Step 4: Learning from LOW confidence issues...`);
      const learnResult = repair.learnLowConfidence(strategies.low);
      console.log(`   📗 Learned: ${learnResult.learned} patterns`);
      console.log(`   ⏭️  Skipped: ${learnResult.skipped} issues`);
    }

    // 打印摘要
    repair.printSummary();

    // 保存结果
    repair.saveResults();

    console.log(`\n💾 Results saved to: .state/auto_repair_results.json`);
  }

  // CQM-002: 調用 system_check_bot.js 顯示系統狀態
  // CQM-006v2: 用 flag file 檢查 60 秒內係咪真正 call 過，唔再用 secondCall 硬參數
  async runSystemCheckBot(quiet = false) {
    const { execFileSync } = require('child_process');
    const systemCheckPath = path.join(__dirname, 'system_check_bot.js');

    try {
      if (!fs.existsSync(systemCheckPath)) {
        console.warn('⚠️ system_check_bot.js not found, skipping system check');
        return;
      }
    } catch (e) {
      console.warn('⚠️ Failed to check system_check_bot.js:', e.message);
      return;
    }

    // CQM-006v2: 用 flag file 嘅 timestamp 判斷係咪 60 秒內真正 call 過
    // 唔再用 secondCall 硬參數（會喺 --no-system-check 情況下 skip 錯）
    const flagFile = path.join(__dirname, '..', '.state', 'system_check_called.json');
    try {
      if (fs.existsSync(flagFile)) {
        const data = JSON.parse(fs.readFileSync(flagFile, 'utf8'));
        const elapsed = Date.now() - new Date(data.lastCalled).getTime();
        if (elapsed < 60000) {
          if (!quiet) {
            console.log('⏭️ System check already called recently (flag file <60s), skipping duplicate');
          }
          return;
        }
      }
    } catch (e) {
      // ignore flag file parse errors; proceed to run
    }

    try {
      if (!quiet) {
        console.log('\n🔧 Running system check...');
      }

      const output = execFileSync(process.execPath, [systemCheckPath, '--quiet'], {
        encoding: 'utf8',
        timeout: 60000,
        cwd: __dirname
      });

      // CQM-006v2: 成功 call 過後寫 flag file
      try {
        let calledData = { lastCalled: getHKTDateTime() };
        fs.writeFileSync(flagFile, JSON.stringify(calledData, null, 2), 'utf8');
      } catch (e) {
        // ignore
      }

      if (!quiet) {
        console.log('✅ System check completed');
      }
    } catch (err) {
      // 不讓 system_check_bot 的錯誤影響主流程
      console.warn('⚠️ System check failed:', err.message);
    }
  }

  // CQM-005: 調用 verify_fix.js 驗證修復結果
  async runVerifyFix(quiet = false) {
    const { execFileSync } = require('child_process');
    const verifyFixPath = path.join(__dirname, 'verify_fix.js');

    try {
      if (!fs.existsSync(verifyFixPath)) {
        console.warn('⚠️ verify_fix.js not found, skipping verification');
        return;
      }
    } catch (e) {
      console.warn('⚠️ Failed to check verify_fix.js:', e.message);
      return;
    }

    try {
      if (!quiet) {
        console.log('\n🔍 Running fix verification...');
      }

      const output = execFileSync(process.execPath, [verifyFixPath, '--quiet'], {
        encoding: 'utf8',
        timeout: VERIFY_TIMEOUT_MS,
        cwd: __dirname,
        stdio: quiet ? ['pipe', 'pipe', 'pipe'] : 'inherit'
      });

      if (!quiet) {
        console.log('✅ Fix verification completed');
      }
    } catch (err) {
      // 不讓 verify_fix 的錯誤影響主流程
      console.warn('⚠️ Fix verification failed:', err.message);
    }
  }

  async cmdDiscover(parsed) {
    const targetDir = parsed.options.dir || '.';
    const fd = createFileDiscovery();
    const result = fd.scanDirectory(targetDir);

    if (parsed.options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\nFound ${result.stats.total} files:`);
      for (const file of result.files) {
        console.log(`  ${file.relativePath} (${file.fromCache ? 'cached' : 'new'})`);
      }
    }
  }

  async cmdAudit(parsed) {
    if (!parsed.options.files) {
      console.error('Error: --files is required');
      process.exit(1);
    }

    const files = parsed.options.files.split(',');
    const cqm = new CodeQualityManager();

    await cqm.runAudit(files.map(f => f.trim()));
    cqm.saveReport(parsed.options.output);
  }

  // CQM-001: 實現 fix 命令，調用 auto_fix.js 的自動修復功能
  async cmdFix(parsed) {
    const { execFileSync } = require('child_process');
    const autoFixPath = path.join(__dirname, 'auto_fix.js');

    try {
      if (!fs.existsSync(autoFixPath)) {
        console.error('❌ auto_fix.js not found');
        process.exit(1);
      }
    } catch (e) {
      console.error('❌ Failed to check auto_fix.js:', e.message);
      process.exit(1);
    }

    console.log('🔧 Running auto-fix...');

    const args = ['fix'];
    if (parsed.options['dry-run']) {
      args.push('--dry-run');
    }
    if (parsed.options.quiet) {
      args.push('--quiet');
    }

    try {
      const output = execFileSync(process.execPath, [autoFixPath, ...args], {
        encoding: 'utf8',
        timeout: AUTO_FIX_TIMEOUT_MS,
        cwd: __dirname,
        stdio: parsed.options.quiet ? ['pipe', 'pipe', 'pipe'] : 'inherit'
      });

      if (!parsed.options.quiet && output) {
        console.log(output);
      }

      console.log('✅ Auto-fix completed');

      // CQM-007: fix 完成後重新掃描，更新 pure_ai_audit_results.json
      // 这樣 system_check_bot 才能顯示修復后的真實數字
      // 但skip system_check_bot，因為稍後會由原本的 call 出顯示
      console.log('🔄 Re-scanning to update results (skipping notification)...');
      const scanArgs = { ...parsed, options: { ...parsed.options, 'no-system-check': true } };
      await this.cmdScan(scanArgs);

      // CQM-005: fix 完成後調用 verify_fix.js 驗證修復結果
      await this.runVerifyFix(parsed.options.quiet);

      // CQM-002: fix 完成後調用 system_check_bot 顯示剩余問題
      // CQM-006v2: runSystemCheckBot 內部用 flag file 判斷 60 秒內是否已 call 過
      if (!parsed.options['no-system-check']) {
        await this.runSystemCheckBot(parsed.options.quiet);
      }
    } catch (err) {
      console.error('❌ Auto-fix failed:', err.message);
      process.exit(1);
    }
  }

  async cmdCache(parsed) {
    const cqm = new CodeQualityManager();

    if (parsed.options.clear) {
      cqm.clearCache();
    } else if (parsed.options.stats) {
      const stats = cqm.getCacheStats();
      console.log('Cache Stats:');
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log('Use --clear to clear cache or --stats to view stats');
    }
  }

  async cmdReport(parsed) {
    if (!parsed.options.input) {
      console.error('Error: --input is required');
      process.exit(1);
    }

        // CQM-004: 添加 try-catch 防止 JSON.parse crash
    let data;
    try {
      const content = fs.readFileSync(parsed.options.input, 'utf8');
      data = JSON.parse(content);
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error(`❌ Error: Invalid JSON in input file: ${parsed.options.input}`);
        console.error(`   Details: ${err.message}`);
      } else if (err.code === 'ENOENT') {
        console.error(`❌ Error: Input file not found: ${parsed.options.input}`);
      } else {
        console.error(`❌ Error reading input file: ${err.message}`);
      }
      process.exit(1);
    }

    const cqm = new CodeQualityManager();

    cqm.addIssues(data.issues);

const format = parsed.options.format || 'markdown';
    const report = cqm.generateReport(format);

    if (parsed.options.output) {
      try {
        fs.writeFileSync(parsed.options.output, report, 'utf8');
        console.log(`Report saved to: ${parsed.options.output}`);
      } catch (e) {
        console.error(`❌ Failed to write report: ${e.message}`);
      }
    } else {
      console.log(report);
    }
  }

  cmdHelp() {
    console.log(`\n${CQM_CONFIG.NAME} v${CQM_CONFIG.VERSION}`);
    console.log('\nUsage: code_quality_manager.js <command> [options]\n');
    console.log('Commands:');

    for (const [name, cmd] of this.commands) {
      console.log(`\n  ${name.padEnd(12)} ${cmd.description}`);
      for (const opt of cmd.options) {
        console.log(`    ${opt.flag.padEnd(20)} ${opt.desc}`);
      }
    }

    console.log('\nExamples:');
    console.log('  code_quality_manager.js scan --dir ./src --ext js,ts');
    console.log('  code_quality_manager.js scan --no-cache --format sarif');
    console.log('  code_quality_manager.js fix --dry-run');
    console.log('  code_quality_manager.js fix --dir ./src');
    console.log('  code_quality_manager.js verify --input .state/audit_results.json');
    console.log('  code_quality_manager.js repair --input .state/batch_verifier_results.json');
    console.log('  code_quality_manager.js repair --approve AR-1234567890-1');
    console.log('  code_quality_manager.js discover --dir ./lib --json');
    console.log('  code_quality_manager.js cache --clear');
    console.log('');
  }

  async run(args) {
    const parsed = this.parseArgs(args);
    const command = parsed.command || 'scan';

    if (!this.commands.has(command)) {
      console.error(`Unknown command: ${command}`);
      this.cmdHelp();
      process.exit(1);
    }

    await this.commands.get(command).action(parsed);
  }
}

// ==================== 便捷函數 ====================
function createCodeQualityManager(options) {
  return new CodeQualityManager(options);
}

async function quickAudit(targetDirs, options = {}) {
  const cqm = new CodeQualityManager(options);
  return await cqm.run(targetDirs, options);
}

// ==================== Export ====================
module.exports = {
  // 主要類別
  CodeQualityManager,
  CodeQualityReportGenerator,  // Phase 3: 新增的 Report Generator
  CLIHandler,

  // 便捷函數
  createCodeQualityManager,
  quickAudit,

  // 重新導出底層組件
  FileDiscovery,
  CacheManager,
  IssueAggregator,
  IssueBuilder,
  AuditOrchestrator,
  LocalScanner,
  AIScanner,
  ErrorScanner,
  BatchVerifier,
  AutoRepair,

  // 工具函數
  createFileDiscovery,
  quickScan,
  createIssue,
  createAggregator,

  // 常量
  CQM_CONFIG,
  VALID_SEVERITIES,
  VALID_CATEGORIES,
  SEVERITY_WEIGHTS,
  AUDIT_CONFIG,
  BV_CONFIG,
  AR_CONFIG,

  // Phase 3: Template 相關常量 (從 code_quality_templates.js)
  TEMPLATE_CONFIG,
  createCodeQualityReportStructure
};

// ==================== CLI 入口 ====================
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    const cli = new CLIHandler();
    cli.cmdHelp();
    return;
  }

  const cli = new CLIHandler();
  await cli.run(args);
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
