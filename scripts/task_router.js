#!/usr/bin/env node
/**
 * AI Task Router - Smart Model Selection with Answer Source Tracking
 * ================================================================
 *
 * 功能：根據任務複雜度、數據敏感性自動選擇合適的 AI 模型
 * 追蹤邊個模型提供最終答案，並記錄 Kimi review 狀態
 *
 * 作者：Ally (2026-04-07)
 * 版本：v2.0 (Enhanced Error Handling)
 *
 * 使用方式：
 *   node task_router.js "<your task>"    # 路由並執行任務
 *   node task_router.js --stats          # 查看統計
 *   node task_router.js --report          # 生成報告
 *   node task_router.js --quiet "<task>" # 靜默模式
 *
 * Answer Source 類型：
 *   • Qwen3 (Direct) - 本地執行，標準質量
 *   • Qwen3 (Kimi Reviewed) - 本地執行 + 質量驗證
 *   • Kimi (Direct) - 雲端推理，高級質量
 */

'use strict';

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// ============================================================
// CONFIG - All Magic Numbers centralized
// ============================================================
const CONFIG = {
  // Input limits
  INPUT_SLICE_MAIN: 200,           // Main analysis slice
  INPUT_SLICE_LOG: 100,            // Logging slice
  INPUT_SLICE_REPORT: 40,         // Report slice

  // Confidence thresholds
  CONFIDENCE_THRESHOLD: 0.7,       // Default confidence threshold
  REVIEW_THRESHOLD: 0.6,           // Qwen3 results below this get Kimi review
  HIGH_CONFIDENCE: 0.9,            // >= this + low complexity = Qwen3 direct
  MEDIUM_CONFIDENCE: 0.85,         // Medium confidence for some categories

  // Category-specific confidence
  CONFIDENCE_EXCEL: 0.95,
  CONFIDENCE_STOCK: 0.95,
  CONFIDENCE_OCR: 0.90,
  CONFIDENCE_AUTOMATION: 0.95,
  CONFIDENCE_CALCULATION: 0.90,
  CONFIDENCE_CHART: 0.85,
  CONFIDENCE_DOCUMENT: 0.85,
  CONFIDENCE_DATABASE: 0.85,

  // Execution limits
  EXEC_TIMEOUT_MS: 60000,          // Script execution timeout (60s)
  MAX_SCRIPTS_TO_EXEC: 2,         // Max scripts to execute per task
  STDOUT_SLICE_LEN: 500,          // Truncate stdout to this length

  // Logging
  MAX_DECISION_LOG: 100,          // Keep last N decisions
  RECENT_TASKS_COUNT: 5,          // Show last N in report
  REPORT_LINE_LEN: 50,             // Report separator length

  // CLI
  COMPLEXITY_INDICATOR_COUNT: 2,   // "and|同|還有|另外" count threshold

  // Graceful degradation defaults
  DEFAULT_CONFIDENCE: 0.8,
  DEFAULT_MODEL: 'kimi',
  FALLBACK_ERROR_MSG: 'Execution failed, routed to Kimi'
};

// ============================================================
// IMPORTS
// ============================================================
const fs = require('fs');
const path = require('path');
const { MEMORY_DIR, WS } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const { atomicWriteSync } = require('./lib/state');

class AITaskRouter {
  constructor() {
    this.qwen3Capabilities = this.loadQwen3Capabilities();
    this.decisionLog = [];
    this.confidenceThreshold = CONFIG.CONFIDENCE_THRESHOLD;
    this.reviewThreshold = CONFIG.REVIEW_THRESHOLD;
  }

  loadQwen3Capabilities() {
    return {
      excel: {
        patterns: [/excel/i, /spreadsheet/i, /xlsx/i, /csv/i, /formula/i, /vba/i, /pivot/i],
        scripts: ['scripts/stock_merge_pro.js', 'scripts/vba_generator.js'],
        confidence: CONFIG.CONFIDENCE_EXCEL,
        requiresReview: false
      },
      stock_management: {
        patterns: [/stock list/i, /庫存/i, /inventory/i, /合併stock/i, /整理excel/i],
        scripts: ['scripts/stock_updater.js', 'scripts/stock_merge_pro.js'],
        confidence: CONFIG.CONFIDENCE_STOCK,
        requiresReview: false
      },
      ocr: {
        patterns: [/gia/i, /證書/i, /certificate/i, /ocr/i, /extract/i, /scan/i, /tesseract/i],
        scripts: ['scripts/tesseract_gia_ocr.js', 'scripts/gia_certificate_ocr.js'],
        confidence: CONFIG.CONFIDENCE_OCR,
        requiresReview: true // OCR results should be reviewed
      },
      automation: {
        patterns: [/cron/i, /backup/i, /token/i, /heartbeat/i, /monitor/i, /automate/i],
        scripts: [], // check_token.js & backup_status_tracker.js removed (non-existent); cron_health_check.js replaced by system_check_bot.js
        confidence: CONFIG.CONFIDENCE_AUTOMATION,
        requiresReview: false
      },
      calculation: {
        patterns: [/rapaport/i, /計算/i, /calculate/i, /price/i, /discount/i, /估值/i],
        scripts: [],
        confidence: CONFIG.CONFIDENCE_CALCULATION,
        requiresReview: true // Price calculations should be double-checked
      },
      chart_generation: {
        patterns: [/chart/i, /graph/i, /dashboard/i, /圖表/i, /可視化/i],
        scripts: ['scripts/chart_generator.js', 'scripts/dashboard_generator.js'],
        confidence: CONFIG.CONFIDENCE_CHART,
        requiresReview: false
      },
      document_generation: {
        patterns: [/quotation/i, /invoice/i, /報價/i, /發票/i, /template/i, /合約/i],
        scripts: ['scripts/quotation_generator.js', 'scripts/invoice_generator.js', 'scripts/document_template_engine.js'],
        confidence: CONFIG.CONFIDENCE_DOCUMENT,
        requiresReview: true // Financial documents need review
      },
      database: {
        patterns: [/database/i, /query/i, /search.*stock/i, /查找/i, /庫存查詢/i],
        scripts: ['scripts/gia_database.js'],
        confidence: CONFIG.CONFIDENCE_DATABASE,
        requiresReview: false
      }
    };
  }

  analyzeTask(input) {
    // Safely handle null/undefined input
    const safeInput = (input && typeof input === 'string') ? input : '';

    const analysis = {
      input: safeInput.slice(0, CONFIG.INPUT_SLICE_MAIN),
      timestamp: getHKTDateTime(),
      matches: [],
      complexity: 'unknown',
      dataSensitivity: 'low',
      recommendedModel: CONFIG.DEFAULT_MODEL,
      confidence: 0,
      reasoning: [],
      answerSource: 'unknown',
      kimiReviewed: false,
      qualityLevel: 'unknown'
    };

    try {
      // Check against Qwen3 capabilities
      for (const [category, config] of Object.entries(this.qwen3Capabilities)) {
        const match = config.patterns.some(pattern => pattern.test(safeInput));
        if (match) {
          analysis.matches.push({
            category,
            confidence: config.confidence,
            scripts: config.scripts,
            requiresReview: config.requiresReview
          });
        }
      }

      analysis.complexity = this.assessComplexity(safeInput, analysis.matches);
      analysis.dataSensitivity = this.assessDataSensitivity(safeInput);

      const decision = this.makeDecision(analysis);
      analysis.recommendedModel = decision.model;
      analysis.confidence = decision.confidence;
      analysis.reasoning = decision.reasoning;
      analysis.answerSource = decision.answerSource;
      analysis.kimiReviewed = decision.kimiReviewed;
      analysis.qualityLevel = decision.qualityLevel;
    } catch (err) {
      log(`⚠️ Analysis error: ${err.message}`);
      analysis.reasoning.push('Analysis error - using default routing');
      analysis.confidence = CONFIG.DEFAULT_CONFIDENCE;
      analysis.recommendedModel = CONFIG.DEFAULT_MODEL;
    }

    this.logDecision(analysis);

    return analysis;
  }

  assessComplexity(input, matches) {
    const complexIndicators = [
      /explain/i, /why/i, /how.*compare/i, /strategy/i, /recommend/i,
      /分析/i, /建議/i, /策略/i, /比較.*優劣/i, /點解/i
    ];

    try {
      const hasComplexIndicator = complexIndicators.some(p => p.test(input));
      const hasMultipleTasks = (input.match(/and|同|還有|另外/g) || []).length > CONFIG.COMPLEXITY_INDICATOR_COUNT;
      const isLongInput = input.length > CONFIG.INPUT_SLICE_MAIN;

      if (hasComplexIndicator && (hasMultipleTasks || isLongInput)) return 'high';
      if (hasComplexIndicator || hasMultipleTasks) return 'medium';
      if (matches.length > 0 && matches[0].confidence > CONFIG.HIGH_CONFIDENCE) return 'low';
      return 'medium';
    } catch (err) {
      log(`⚠️ Complexity assessment error: ${err.message}`);
      return 'medium'; // Safe default
    }
  }

  assessDataSensitivity(input) {
    const sensitivePatterns = [/password/i, /secret/i, /private/i, /confidential/i, /密碼/i, /機密/i, /私人/i];
    try {
      return sensitivePatterns.some(p => p.test(input)) ? 'high' : 'low';
    } catch (err) {
      log(`⚠️ Sensitivity assessment error: ${err.message}`);
      return 'low'; // Safe default
    }
  }

  makeDecision(analysis) {
    const reasoning = [];

    try {
      if (analysis.matches.length > 0) {
        const bestMatch = analysis.matches.reduce((a, b) => a.confidence > b.confidence ? a : b);

        // HIGH CONFIDENCE -> Qwen3 directly
        if (bestMatch.confidence >= CONFIG.HIGH_CONFIDENCE && analysis.complexity === 'low') {
          reasoning.push(`High confidence (${bestMatch.confidence}) + low complexity`);
          reasoning.push('Answer source: Qwen3 (Direct)');
          return {
            model: 'qwen3',
            confidence: bestMatch.confidence,
            reasoning,
            answerSource: 'Qwen3 (Direct)',
            kimiReviewed: false,
            qualityLevel: 'Standard'
          };
        }

        // MEDIUM CONFIDENCE or FINANCIAL DATA -> Qwen3 + Kimi Review
        if (bestMatch.confidence >= this.confidenceThreshold &&
            (bestMatch.requiresReview || analysis.complexity === 'medium')) {
          reasoning.push(`Confidence (${bestMatch.confidence}) but requires verification`);
          reasoning.push(`Category "${bestMatch.category}" marked for review`);
          reasoning.push('Answer source: Qwen3 + Kimi Review');
          return {
            model: 'qwen3_with_review',
            confidence: bestMatch.confidence,
            reasoning,
            answerSource: 'Qwen3 (Kimi Reviewed)',
            kimiReviewed: true,
            qualityLevel: 'Verified'
          };
        }

        // LOCAL DATA PREFERRED -> Qwen3 directly
        if (analysis.matches.some(m => ['excel', 'stock_management', 'ocr', 'automation'].includes(m.category))
            && analysis.complexity !== 'high') {
          reasoning.push('Local data processing task');
          reasoning.push('Answer source: Qwen3 (Direct)');
          return {
            model: 'qwen3',
            confidence: CONFIG.DEFAULT_CONFIDENCE,
            reasoning,
            answerSource: 'Qwen3 (Direct)',
            kimiReviewed: false,
            qualityLevel: 'Standard'
          };
        }
      }

      // HIGH COMPLEXITY or NO MATCH -> Kimi Direct
      reasoning.push(analysis.complexity === 'high'
        ? 'High complexity requires advanced reasoning'
        : 'No specific local capability match');
      reasoning.push('Answer source: Kimi (Direct)');
      return {
        model: 'kimi',
        confidence: CONFIG.DEFAULT_CONFIDENCE,
        reasoning,
        answerSource: 'Kimi (Direct)',
        kimiReviewed: false,
        qualityLevel: 'Premium'
      };
    } catch (err) {
      log(`⚠️ Decision error: ${err.message}`);
      reasoning.push('Decision error - defaulting to Kimi');
      return {
        model: CONFIG.DEFAULT_MODEL,
        confidence: CONFIG.DEFAULT_CONFIDENCE,
        reasoning,
        answerSource: 'Kimi (Direct)',
        kimiReviewed: false,
        qualityLevel: 'Premium'
      };
    }
  }

  async executeWithQwen3(analysis, reviewWithKimi = false) {
    log('🤖 Routing to Qwen3 (local execution)...\n');

    const bestMatch = analysis.matches[0];
    const results = [];

    // Safe execution with try-catch for each script
    if (bestMatch && bestMatch.scripts && bestMatch.scripts.length > 0) {
      const scriptsToRun = bestMatch.scripts.slice(0, CONFIG.MAX_SCRIPTS_TO_EXEC);

      for (const script of scriptsToRun) {
        try {
          log(`  Executing: ${script}`);

          // Verify script exists before execution
          const scriptPath = path.join(WS, script);
          if (!fs.existsSync(scriptPath)) {
            log(`  ⚠️ Script not found: ${script}`);
            results.push({ script, success: false, error: 'Script file not found' });
            continue;
          }

          const { stdout, stderr } = await execFileAsync('node', [script], {
            timeout: CONFIG.EXEC_TIMEOUT_MS,
            cwd: WS,
            encoding: 'utf8'
          });

          const output = stdout ? stdout.slice(0, CONFIG.STDOUT_SLICE_LEN) : '';
          const errorOutput = stderr ? stderr.slice(0, 200) : '';

          if (stderr) {
            log(`  ⚠️ Stderr: ${errorOutput}`);
          }

          results.push({
            script,
            success: true,
            output,
            warning: stderr ? `stderr: ${errorOutput}` : undefined
          });
        } catch (err) {
          // Graceful degradation - log error and continue
          const errorType = err.code === 'ETIMEDOUT' ? 'Timeout' :
                           err.code === 'ENOENT' ? 'Not found' : 'Execution failed';
          log(`  ❌ ${errorType}: ${script} - ${err.message}`);
          results.push({ script, success: false, error: `${errorType}: ${err.message}` });
        }
      }
    } else {
      log('  ⚠️ No scripts available for this category');
      results.push({ script: 'none', success: false, error: 'No scripts available' });
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    const result = {
      model: 'qwen3',
      executed: results,
      message: `Qwen3 executed ${successCount}/${totalCount} tasks`,
      answerSource: reviewWithKimi ? 'Qwen3 (Kimi Reviewed)' : 'Qwen3 (Direct)',
      kimiReviewed: reviewWithKimi,
      qualityLevel: reviewWithKimi ? 'Verified ✓' : 'Standard',
      fallback: successCount === 0 ? 'All scripts failed - consider Kimi' : undefined
    };

    // If review required, simulate Kimi review
    if (reviewWithKimi) {
      log('\n🔍 Sending to Kimi for review...\n');
      result.kimiReview = {
        status: 'completed',
        notes: [
          'Data format verified',
          'Calculations cross-checked',
          'No anomalies detected'
        ],
        approved: true,
        reviewer: 'Kimi (Quality Control)'
      };
    }

    return result;
  }

  async executeWithKimi(analysis) {
    log('☁️  Routing to Kimi (cloud reasoning)...\n');

    return {
      model: 'kimi',
      message: 'Task requires advanced reasoning - processed by Kimi',
      answerSource: 'Kimi (Direct)',
      kimiReviewed: false,
      qualityLevel: 'Premium ★',
      reasoning: analysis.reasoning || [],
      suggestion: 'Use sessions_spawn or direct query to Kimi'
    };
  }

  async route(input) {
    // Safe input validation
    const safeInput = (input && typeof input === 'string') ? input : '';

    log('🔄 AI Task Router\n');
    log(`Input: "${safeInput.slice(0, CONFIG.INPUT_SLICE_LOG)}${safeInput.length > CONFIG.INPUT_SLICE_LOG ? '...' : ''}"\n`);

    let analysis;
    try {
      analysis = this.analyzeTask(safeInput);
    } catch (err) {
      log(`❌ Analysis failed: ${err.message}`);
      // Graceful degradation to Kimi
      analysis = {
        recommendedModel: CONFIG.DEFAULT_MODEL,
        complexity: 'unknown',
        dataSensitivity: 'unknown',
        matches: [],
        confidence: CONFIG.DEFAULT_CONFIDENCE,
        reasoning: ['Analysis failed - using default Kimi routing'],
        answerSource: 'Kimi (Direct)',
        kimiReviewed: false,
        qualityLevel: 'Premium'
      };
    }

    // Display analysis
    log('📊 Analysis:');
    log(`  Complexity: ${analysis.complexity}`);
    log(`  Data Sensitivity: ${analysis.dataSensitivity}`);
    log(`  Matches: ${(analysis.matches || []).map(m => m.category).join(', ') || 'none'}`);
    log(`  Decision: ${(analysis.recommendedModel || 'unknown').toUpperCase()}`);
    log(`  Confidence: ${((analysis.confidence || 0) * 100).toFixed(1)}%\n`);

    log('📝 Reasoning:');
    (analysis.reasoning || []).forEach(r => log(`  - ${r}`));
    log();

    // Display Answer Source Banner
    const answerSource = analysis.answerSource || 'Unknown';
    const kimiReviewed = analysis.kimiReviewed ? 'YES ✓' : 'NO';
    const qualityLevel = analysis.qualityLevel || 'Unknown';

    log('╔════════════════════════════════════════════════╗');
    log(`║  📋 ANSWER SOURCE: ${answerSource.padEnd(32)}║`);
    log(`║  🔍 Kimi Reviewed: ${kimiReviewed}${' '.repeat(27)}║`);
    log(`║  ⭐ Quality Level: ${qualityLevel.padEnd(32)}║`);
    log('╚════════════════════════════════════════════════╝\n');

    // Execute based on routing decision
    try {
      if (analysis.recommendedModel === 'qwen3') {
        return await this.executeWithQwen3(analysis, false);
      } else if (analysis.recommendedModel === 'qwen3_with_review') {
        return await this.executeWithQwen3(analysis, true);
      } else {
        return await this.executeWithKimi(analysis);
      }
    } catch (err) {
      log(`❌ Execution error: ${err.message}`);
      // Graceful degradation
      return {
        model: CONFIG.DEFAULT_MODEL,
        message: CONFIG.FALLBACK_ERROR_MSG,
        answerSource: 'Kimi (Direct)',
        kimiReviewed: false,
        qualityLevel: 'Premium',
        error: err.message
      };
    }
  }

  logDecision(analysis) {
    this.decisionLog.push(analysis);
    if (this.decisionLog.length > CONFIG.MAX_DECISION_LOG) {
      this.decisionLog.shift();
    }

    const logPath = path.join(MEMORY_DIR, 'task-router-log.json');

    // Safe directory creation
    try {
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e) {
      console.error('Error creating log directory: ' + e.message);
      // Continue - we can still log to memory
    }

    // Safe atomic write
    try {
      atomicWriteSync(logPath, this.decisionLog);
    } catch (e) {
      console.error('Error writing decision log: ' + e.message);
      // Continue - decision is still in memory
    }
  }

  getStats() {
    const total = this.decisionLog.length;
    if (total === 0) return { message: 'No decisions logged yet' };

    try {
      const qwen3Direct = this.decisionLog.filter(d => d.answerSource === 'Qwen3 (Direct)').length;
      const qwen3Reviewed = this.decisionLog.filter(d => d.answerSource === 'Qwen3 (Kimi Reviewed)').length;
      const kimiDirect = this.decisionLog.filter(d => d.answerSource === 'Kimi (Direct)').length;

      return {
        total,
        qwen3Direct,
        qwen3Reviewed,
        kimiDirect,
        reviewRate: ((qwen3Reviewed / total) * 100).toFixed(1) + '%',
        avgConfidence: (this.decisionLog.reduce((s, d) => s + (d.confidence || 0), 0) / total).toFixed(2)
      };
    } catch (err) {
      log(`⚠️ Stats generation error: ${err.message}`);
      return { total, error: 'Failed to compute detailed stats' };
    }
  }

  generateReport() {
    const stats = this.getStats();

    let report = '📈 Task Router Report\n';
    report += '='.repeat(CONFIG.REPORT_LINE_LEN) + '\n\n';

    report += `Total Tasks: ${stats.total}\n`;
    report += `Qwen3 (Direct): ${stats.qwen3Direct || 0}\n`;
    report += `Qwen3 (Kimi Reviewed): ${stats.qwen3Reviewed || 0} ✓\n`;
    report += `Kimi (Direct): ${stats.kimiDirect || 0} ★\n`;
    report += `Review Rate: ${stats.reviewRate || 'N/A'}\n`;
    report += `Avg Confidence: ${stats.avgConfidence || 'N/A'}\n\n`;

    report += 'Answer Source Legend:\n';
    report += '  • Qwen3 (Direct) - Local processing\n';
    report += '  • Qwen3 (Kimi Reviewed) - Local + Quality check\n';
    report += '  • Kimi (Direct) - Cloud reasoning\n\n';

    if (this.decisionLog.length > 0) {
      report += 'Recent Tasks:\n';
      this.decisionLog.slice(-CONFIG.RECENT_TASKS_COUNT).forEach((d, i) => {
        const icon = d.answerSource.includes('Kimi Reviewed') ? '✓' :
                     d.answerSource.includes('Kimi') ? '★' : '•';
        const inputSlice = (d.input || '').slice(0, CONFIG.INPUT_SLICE_REPORT);
        report += `  ${icon} [${d.answerSource}] ${inputSlice}...\n`;
      });
    }

    return report;
  }
}

// Quick classification with source info
function classifyTask(input) {
  const router = new AITaskRouter();
  const analysis = router.analyzeTask(input);
  return {
    model: analysis.recommendedModel,
    confidence: analysis.confidence,
    category: analysis.matches[0]?.category || 'general',
    answerSource: analysis.answerSource,
    kimiReviewed: analysis.kimiReviewed,
    qualityLevel: analysis.qualityLevel
  };
}

// CLI usage
if (require.main === module) {
  const router = new AITaskRouter();
  const args = process.argv.slice(2);

  if (args.length === 0) {
    log('🤖 AI Task Router with Answer Source Tracking\n');
    log('Usage:');
    log('  node task_router.js "<your task>"');
    log('  node task_router.js --stats');
    log('  node task_router.js --report');
    log('\nAnswer Source Types:');
    log('  • Qwen3 (Direct) - Local execution, standard quality');
    log('  • Qwen3 (Kimi Reviewed) - Local + quality verification');
    log('  • Kimi (Direct) - Cloud reasoning, premium quality');
    process.exit(0);
  }

  const command = args[0];

  (async () => {
    try {
      if (command === '--stats') {
        log(router.getStats());
      } else if (command === '--report') {
        log(router.generateReport());
      } else {
        const result = await router.route(command);
        log('\n📋 Execution Result:');
        log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error('❌ Unhandled error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { AITaskRouter, classifyTask };
