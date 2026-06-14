#!/usr/bin/env node
/**
 * auto_repair.js - Confidence-based Auto-Repair Module
 *
 * Phase 3: 基於 Batch Verification + Pattern Learning結果，實現按 Confidence 自動修復
 *
 * 修復策略：
 * - HIGH (confidence >= 90%): Auto-fix (直接修復)
 * - MEDIUM (confidence >= 70%): Request approval (需要確認)
 * - LOW (confidence < 70%): Skip + learn (跳過併學習)
 *
 * Created: 2026-04-06
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

// ==================== 配置常量 ====================
const AR_CONFIG = {
  VERSION: '1.0.0',
  NAME: 'Auto-Repair',

  // Kimi CLI 路徑
  KIMI_CLI: path.join(process.env.HOME || '/Users/ally', '.local', 'bin', 'kimi'),

  // Workspace 路徑
  WORKSPACE: path.join(process.env.HOME || '/Users/ally', '.openclaw', 'workspace'),

  // Pattern Learner 數據目錄
  PATTERN_DIR: path.join(process.env.HOME || '/Users/ally', '.openclaw', 'workspace', 'memory', 'patterns'),

  // TP Tracker 文件
  TP_TRACKER_FILE: 'tp_tracker.json',

  // 修復结果輸出
  OUTPUT_FILE: '.state/auto_repair_results.json',

  // 置信度阈值 (百分比)
  REPAIR_STRATEGIES: {
    HIGH: {
      threshold: 90,     // >= 90%
      auto_fix: true,
      notify: false,
      description: '高置信度，直接自動修復'
    },
    MEDIUM: {
      threshold: 70,    // 70-89%
      auto_fix: true,
      notify: true,
      description: '中等置信度，需用戶確認后修復'
    },
    LOW: {
      threshold: 0,     // < 70%
      auto_fix: false,
      notify: false,
      learn: true,
      description: '低置信度，跳過併學習'
    }
  },

  // Kimi CLI 超時 (毫秒)
  KIMI_TIMEOUT_MS: 180000,  // 3 minutes

  // 修復批次大小
  FIX_BATCH_SIZE: 5
};

// ==================== Issue 结构定義 ====================
/**
 * @typedef {Object} VerifiedIssue
 * @property {string} file
 * @property {number|null} line
 * @property {string} rule
 * @property {string} message
 * @property {string} severity
 * @property {string} source
 * @property {number} confidence - 0.0-1.0
 * @property {string} reasoning
 * @property {string} suggestion
 */

/**
 * @typedef {Object} RepairResult
 * @property {string} status - 'success' | 'failed' | 'skipped' | 'pending_approval'
 * @property {VerifiedIssue} issue
 * @property {string} [fixed_code] - 修復后的代碼片段
 * @property {string} [error] - 錯誤信息
 * @property {string} [verification] - 驗證结果
 */

// ==================== AutoRepair 类 ====================
class AutoRepair {
  constructor(options = {}) {
    this.options = { ...AR_CONFIG, ...options };
    this.strategies = this.options.REPAIR_STRATEGIES;
    this.results = {
      high: { total: 0, success: 0, failed: 0 },
      medium: { total: 0, pending: 0, approved: 0 },
      low: { total: 0, skipped: 0, learned: 0 },
      all: []
    };
    this._kimiAvailable = null;
  }

  // ==================== 核心方法 ====================

  /**
   * decideRepairStrategy - 根據 confidence 決定修復策略
   *
   * @param {VerifiedIssue[]} verifiedIssues - 已驗證的問题列表
   * @returns {Object} - 按策略分組的問题
   */
  decideRepairStrategy(verifiedIssues) {
    if (!verifiedIssues || verifiedIssues.length === 0) {
      return { high: [], medium: [], low: [], summary: { total: 0 } };
    }

    const grouped = {
      high: [],      // >= 90% - auto-fix
      medium: [],    // 70-89% - request approval
      low: []        // < 70% - skip + learn
    };

    for (const issue of verifiedIssues) {
      const confidence = typeof issue.confidence === 'number'
        ? issue.confidence * 100
        : (issue.confidence || 0.5) * 100;

      if (confidence >= this.strategies.HIGH.threshold) {
        grouped.high.push({ ...issue, _confidence: confidence, _strategy: 'HIGH' });
      } else if (confidence >= this.strategies.MEDIUM.threshold) {
        grouped.medium.push({ ...issue, _confidence: confidence, _strategy: 'MEDIUM' });
      } else {
        grouped.low.push({ ...issue, _confidence: confidence, _strategy: 'LOW' });
      }
    }

    // 更新統計
    this.results.high.total = grouped.high.length;
    this.results.medium.total = grouped.medium.length;
    this.results.low.total = grouped.low.length;

    grouped.summary = {
      total: verifiedIssues.length,
      high: grouped.high.length,
      medium: grouped.medium.length,
      low: grouped.low.length,
      autoFixCount: grouped.high.length,
      pendingApproval: grouped.medium.length,
      skipAndLearn: grouped.low.length
    };

    return grouped;
  }

  /**
   * autoFix - 自動修復高置信度問题 (>= 90%)
   *
   * @param {VerifiedIssue[]} issues - 需要修復的問题
   * @param {Object} options - 選項
   * @returns {RepairResult[]} - 修復结果
   */
  async autoFix(issues, options = {}) {
    if (!issues || issues.length === 0) {
      return [];
    }

    console.log(`\n🔧 Auto-Repair: Auto-fixing ${issues.length} high-confidence issues...`);

    const results = [];
    const batchSize = options.batchSize || AR_CONFIG.FIX_BATCH_SIZE;

    // 分批處理
    for (let i = 0; i < issues.length; i += batchSize) {
      const batch = issues.slice(i, i + batchSize);
      console.log(`   📦 Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} issues`);

      for (const issue of batch) {
        const result = await this._fixSingleIssue(issue, options);
        results.push(result);

        // 記錄到 TP Tracker
        if (result.status === 'success') {
          this._recordFixToTracker(issue, result);
        }

        this.results.all.push(result);

        if (result.status === 'success') {
          this.results.high.success++;
        } else if (result.status === 'failed') {
          this.results.high.failed++;
        }
      }
    }

    return results;
  }

  /**
   * requestApproval - 請求用戶確認中等置信度問题 (70-89%)
   *
   * @param {VerifiedIssue[]} issues - 需要確認的問题
   * @returns {Object} - 包含待確認問题的信息
   */
  requestApproval(issues) {
    if (!issues || issues.length === 0) {
      return { pending: [], message: 'No issues need approval' };
    }

    console.log(`\n👀 Auto-Repair: ${issues.length} issues need user approval:`);

    const approvalList = issues.map((issue, idx) => {
      console.log(`\n   [${idx + 1}] ${issue.file}${issue.line ? ':' + issue.line : ''}`);
      console.log(`       Rule: ${issue.rule}`);
      console.log(`       Confidence: ${(issue._confidence || issue.confidence * 100).toFixed(0)}%`);
      console.log(`       Issue: ${issue.message || issue.title}`);
      if (issue.suggestion) {
        console.log(`       Suggestion: ${issue.suggestion}`);
      }
      if (issue.reasoning) {
        console.log(`       Reasoning: ${issue.reasoning}`);
      }

      return {
        id: `AR-${Date.now()}-${idx}`,
        issue,
        approved: null,
        timestamp: null
      };
    });

    // 保存待確認列表
    const approvalFile = path.join(
      this.options.WORKSPACE,
      '.state',
      'auto_repair_pending_approval.json'
    );

    try {
      fs.mkdirSync(path.dirname(approvalFile), { recursive: true });
      fs.writeFileSync(approvalFile, JSON.stringify(approvalList, null, 2), 'utf8');
      console.log(`\n   💾 Pending approval list saved: ${approvalFile}`);
    } catch (e) {
      console.error(`   ❌ Failed to save approval list: ${e.message}`);
    }

    this.results.medium.pending = issues.length;

    return {
      pending: approvalList,
      count: issues.length,
      message: `Use 'node scripts/code_quality_manager.js approve <id>' to approve issues`
    };
  }

  /**
   * approveIssue - 批準併修復單個問题
   *
   * @param {string} issueId - Issue ID
   * @param {Object} options - 選項
   * @returns {RepairResult} - 修復结果
   */
  async approveIssue(issueId, options = {}) {
    const approvalFile = path.join(
      this.options.WORKSPACE,
      '.state',
      'auto_repair_pending_approval.json'
    );

    let approvalList = [];
    try {
      const content = fs.readFileSync(approvalFile, 'utf8');
      approvalList = JSON.parse(content);
    } catch (e) {
      return { status: 'failed', error: 'Cannot read approval list: ' + e.message };
    }

    const approvalItem = approvalList.find(a => a.id === issueId);
    if (!approvalItem) {
      return { status: 'failed', error: `Issue ${issueId} not found in approval list` };
    }

    // 標記為已批準
    approvalItem.approved = true;
    approvalItem.timestamp = new Date().toISOString();

    try {
      fs.writeFileSync(approvalFile, JSON.stringify(approvalList, null, 2), 'utf8');
    } catch (e) {
      console.error(`   ❌ Failed to update approval list: ${e.message}`);
    }

    // 執行修復
    console.log(`\n✅ Approving issue: ${issueId}`);
    const result = await this._fixSingleIssue(approvalItem.issue, options);

    if (result.status === 'success') {
      this._recordFixToTracker(approvalItem.issue, result);
      this.results.medium.approved++;
    }

    this.results.all.push(result);
    return result;
  }

  /**
   * verifyFix - 驗證修復结果
   *
   * @param {VerifiedIssue} originalIssue - 原始問题
   * @param {string} fixedCode - 修復后的代碼
   * @param {Object} options - 選項
   * @returns {Object} - 驗證结果
   */
  verifyFix(originalIssue, fixedCode, options = {}) {
    if (!originalIssue || !fixedCode) {
      return { verified: false, error: 'Missing original issue or fixed code' };
    }

    const filePath = path.join(this.options.WORKSPACE, originalIssue.file);

    // 檢查文件是否存在
    try {
      if (!fs.existsSync(filePath)) {
        return { verified: false, error: `File not found: ${originalIssue.file}` };
      }
    } catch (e) {
      return { verified: false, error: `Failed to check file: ${e.message}` };
    }

    // 讀取文件內容
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return { verified: false, error: `Cannot read file: ${e.message}` };
    }

    // 基本驗證：檢查是否包含問题代碼或修復代碼
    const verification = {
      file: originalIssue.file,
      line: originalIssue.line,
      rule: originalIssue.rule,
      originalMessage: originalIssue.message,
      verified: true,
      checks: []
    };

    // 语法檢查
    const syntaxCheck = this._checkSyntax(filePath);
    verification.checks.push({
      name: 'syntax',
      passed: syntaxCheck.ok,
      error: syntaxCheck.error
    });

    if (!syntaxCheck.ok) {
      verification.verified = false;
      verification.verification = `Syntax error: ${syntaxCheck.error}`;
      return verification;
    }

    // 檢查原問题是否已修復
    if (originalIssue.message) {
      const originalPresent = content.includes(originalIssue.message);
      verification.checks.push({
        name: 'original_issue_present',
        passed: !originalPresent,
        note: originalPresent ? 'Original issue message still present' : 'Original issue fixed'
      });
    }

    // 檢查修復建议是否存在
    if (originalIssue.suggestion) {
      // 提取關键修復词
      const fixKeywords = this._extractFixKeywords(originalIssue.suggestion);
      const hasFix = fixKeywords.some(kw => content.includes(kw));
      verification.checks.push({
        name: 'fix_keywords_present',
        passed: hasFix,
        keywords: fixKeywords
      });
    }

    verification.verification = verification.verified
      ? 'Fix verified successfully'
      : 'Fix verification failed';

    return verification;
  }

  // ==================== Kimi CLI 集成 ====================

  /**
   * checkKimiAvailability - 檢查 Kimi CLI 是否可用
   */
  checkKimiAvailability() {
    if (this._kimiAvailable !== null) {
      return this._kimiAvailable;
    }

    try {
      execFileSync(this.options.KIMI_CLI, ['--version'], {
        encoding: 'utf8',
        timeout: 10000
      });
      this._kimiAvailable = true;
    } catch (err) {
      try {
        fs.accessSync(this.options.KIMI_CLI, fs.constants.X_OK);
        this._kimiAvailable = true;
      } catch (e) {
        this._kimiAvailable = false;
      }
    }

    return this._kimiAvailable;
  }

  /**
   * callKimiForFix - 調用 Kimi CLI 生成修復代碼
   *
   * @param {VerifiedIssue} issue - 問题
   * @param {Object} options - 選項
   * @returns {string} - Kimi 的修復建议
   */
  async callKimiForFix(issue, options = {}) {
    if (!this.checkKimiAvailability()) {
      throw new Error('Kimi CLI not available');
    }

    const prompt = this._buildFixPrompt(issue);

    // 創建臨時 prompt 文件
    let tmpPromptFile;
    try {
      tmpPromptFile = path.join(
        require('os').tmpdir(),
        `kimi_fix_prompt_${Date.now()}.txt`
      );
      fs.writeFileSync(tmpPromptFile, prompt, 'utf8');
    } catch (e) {
      throw new Error(`Failed to write prompt file: ${e.message}`);
    }

    try {
      const output = await this._callKimiAsync(tmpPromptFile);
      return output;
    } finally {
      try {
        fs.unlinkSync(tmpPromptFile);
      } catch (e) {
        // ignore cleanup error
      }
    }
  }

  /**
   * _callKimiAsync - 異步調用 Kimi CLI
   */
  _callKimiAsync(promptFile) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.KIMI_CLI,
        [
          '-C',
          '-w', this.options.WORKSPACE,
          '-p', promptFile,
          '--print'
        ]
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0 && !stdout) {
          reject(new Error(`Kimi CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  // ==================== 私有方法 ====================

  /**
   * _fixSingleIssue - 修復單個問题
   */
  async _fixSingleIssue(issue, options = {}) {
    const result = {
      status: 'pending',
      issue,
      timestamp: new Date().toISOString()
    };

    try {
      // 如果有修復建议，直接應用
      if (issue.suggestion) {
        result.status = 'success';
        result.fixed_code = issue.suggestion;
        result.verification = 'Applied suggestion directly';

        // 應用修復
        const applyResult = this._applyFix(issue, issue.suggestion);
        if (!applyResult.success) {
          result.status = 'failed';
          result.error = applyResult.error;
        }

        return result;
      }

      // 否則調用 Kimi CLI
      if (this.checkKimiAvailability()) {
        console.log(`      🤖 Calling Kimi CLI for: ${issue.file}:${issue.line}`);

        const kimiResponse = await this.callKimiForFix(issue, options);
        const fixCode = this._extractFixFromResponse(kimiResponse);

        if (fixCode) {
          result.fixed_code = fixCode;

          // 應用修復
          const applyResult = this._applyFix(issue, fixCode);
          if (applyResult.success) {
            result.status = 'success';
            result.verification = 'Fix applied via Kimi CLI';
          } else {
            result.status = 'failed';
            result.error = applyResult.error;
          }
        } else {
          result.status = 'failed';
          result.error = 'Kimi CLI did not return valid fix code';
        }
      } else {
        result.status = 'failed';
        result.error = 'Kimi CLI not available and no suggestion provided';
      }
    } catch (err) {
      result.status = 'failed';
      result.error = err.message;
    }

    return result;
  }

  /**
   * _applyFix - 應用修復到文件
   */
  _applyFix(issue, fixCode) {
    const filePath = path.join(this.options.WORKSPACE, issue.file);

    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${issue.file}` };
      }
    } catch (e) {
      return { success: false, error: `Failed to check file: ${e.message}` };
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return { success: false, error: `Cannot read file: ${e.message}` };
    }

    // 如果有行號，尝試在该行附近應用修復
    if (issue.line && typeof issue.line === 'number') {
      const lines = content.split('\n');

      if (issue.line > 0 && issue.line <= lines.length) {
        // 构建修復代碼，可能包含多行
        const fixLines = fixCode.split('\n');

        // 简單策略：如果修復代碼有多行，替换從 issue.line 開始的多行
        if (fixLines.length > 1) {
          const startIdx = issue.line - 1;
          const endIdx = startIdx + fixLines.length;

          lines.splice(startIdx, endIdx - startIdx, ...fixLines);
          content = lines.join('\n');
        } else {
          // 單行修復：替换该行
          lines[issue.line - 1] = fixLines[0];
          content = lines.join('\n');
        }

        // 寫入文件
        const tmpFile = `${filePath}.tmp.${Date.now()}`;
        try {
          fs.writeFileSync(tmpFile, content, 'utf8');
          fs.renameSync(tmpFile, filePath);
          return { success: true };
        } catch (e) {
          try { fs.unlinkSync(tmpFile); } catch {}
          return { success: false, error: e.message };
        }
      }
    }

    // 没有行號：追加修復注釋或無法處理
    return {
      success: false,
      error: 'No line number specified, cannot apply fix automatically'
    };
  }

  /**
   * _buildFixPrompt - 构建修復 prompt
   */
  _buildFixPrompt(issue) {
    const filePath = path.join(this.options.WORKSPACE, issue.file);

    // 讀取問题文件的內容
    let fileContent = '';
    try {
      if (fs.existsSync(filePath)) {
        fileContent = fs.readFileSync(filePath, 'utf8');
        // 如果文件太大，只讀取相關部分
        if (fileContent.length > 10000 && issue.line) {
          const lines = fileContent.split('\n');
          const startLine = Math.max(0, issue.line - 10);
          const endLine = Math.min(lines.length, issue.line + 10);
          fileContent = lines.slice(startLine, endLine).join('\n');
          fileContent = `// ... (lines ${startLine + 1}-${endLine} of ${lines.length})\n${fileContent}`;
        }
      }
    } catch (e) {
      fileContent = '(unable to read file)';
    }

    return `你是代碼修復助手。請修復以下問题：

## 問题信息
- **文件**: ${issue.file}
- **行號**: ${issue.line || 'N/A'}
- **規則**: ${issue.rule}
- **严重程度**: ${issue.severity}
- **問题描述**: ${issue.message || issue.title || 'No description'}
- **修復建议**: ${issue.suggestion || '請根據問题描述自行判斷修復方案'}

## 代碼與下文
\`\`\`
${fileContent}
\`\`\`

## 任務
請生成修復后的代碼。只返回修復后的代碼片段（相關行），不要包含其他解釋。

## 輸出格式
請以 JSON 格式返回：
\`\`\`json
{
  "fix": "修復后的代碼",
  "explanation": "修復說明（1-2句）"
}
\`\`\`
`;
  }

  /**
   * _extractFixFromResponse - 從 Kimi 響應中提取修復代碼
   */
  _extractFixFromResponse(response) {
    if (!response) return null;

    // 尝試提取 JSON
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        return data.fix || data.code || data.solution;
      } catch (e) {
        // continue to fallback
      }
    }

    // 尝試提取 code block
    const codeMatch = response.match(/```\s*([\s\S]*?)\s*```/);
    if (codeMatch) {
      return codeMatch[1].trim();
    }

    // 返回原始響應（作為最后手段）
    return response.trim();
  }

  /**
   * _recordFixToTracker - 記錄修復结果到 TP Tracker
   */
  _recordFixToTracker(issue, result) {
    const trackerPath = path.join(this.options.PATTERN_DIR, AR_CONFIG.TP_TRACKER_FILE);

    let tracker = { patterns: [], by_rule: {}, stats: { total_learned: 0 } };

    try {
      if (fs.existsSync(trackerPath)) {
        const content = fs.readFileSync(trackerPath, 'utf8');
        tracker = JSON.parse(content);
      }
    } catch (e) {
      // 使用默認空 tracker
    }

    const today = new Date().toISOString().split('T')[0];

    // 按 rule 分组
    const rule = issue.rule || 'unknown';
    if (!tracker.by_rule[rule]) {
      tracker.by_rule[rule] = { patterns: [], stats: { total: 0 } };
    }

    // 添加修復記錄
    const fixRecord = {
      id: `FIX-${Date.now()}`,
      file: issue.file,
      line: issue.line,
      rule,
      message: issue.message,
      confidence: issue.confidence,
      fixed_at: today,
      success: result.status === 'success',
      verification: result.verification
    };

    tracker.by_rule[rule].patterns.push(fixRecord);
    tracker.by_rule[rule].stats.total++;
    tracker.stats.total_learned = (tracker.stats.total_learned || 0) + 1;
    tracker.stats.last_updated = today;

    // 確保目錄存在
    try {
      fs.mkdirSync(path.dirname(trackerPath), { recursive: true });
      fs.writeFileSync(trackerPath, JSON.stringify(tracker, null, 2), 'utf8');
    } catch (e) {
      console.error(`   ⚠️ Failed to record fix to tracker: ${e.message}`);
    }
  }

  /**
   * _learnLowConfidence - 學習低置信度問题（跳過但記錄）
   */
  learnLowConfidence(issues) {
    if (!issues || issues.length === 0) return { learned: 0 };

    console.log(`\n📚 Auto-Repair: Learning from ${issues.length} low-confidence issues...`);

    const PatternLearner = require('./pattern_learner').PatternLearner;
    const learner = new PatternLearner();

    // 使用 PatternLearner 學習这些低置信度問题
    const learnResult = learner.learn({
      verified: [],  // 这些是低置信度，不算真正的 TP
      rejected: issues.map(i => ({ ...i, confidence: i._confidence / 100 })),  // 作為潜在的 FP 學習
      needsReview: []
    });

    this.results.low.learned = learnResult.fpLearned || 0;

    return {
      learned: learnResult.fpLearned || 0,
      skipped: issues.length
    };
  }

  /**
   * _checkSyntax - 檢查文件语法
   */
  _checkSyntax(filePath) {
    const ext = path.extname(filePath);

    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      try {
        execFileSync('node', ['--check', filePath], { timeout: 5000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    } else if (ext === '.sh' || ext === '.bash') {
      try {
        execFileSync('bash', ['-n', filePath], { timeout: 5000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    return { ok: true }; // 未知扩展名，跳過檢查
  }

  /**
   * _extractFixKeywords - 從修復建议中提取關键词
   */
  _extractFixKeywords(suggestion) {
    if (!suggestion) return [];

    // 提取英文單词和代碼相關词汇
    const keywords = suggestion
      .match(/[a-zA-Z_]{3,}/g)
      ?.filter(w => !['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your'].includes(w.toLowerCase()))
      || [];

    return [...new Set(keywords)];
  }

  // ==================== 结果方法 ====================

  /**
   * getResults - 獲取修復结果
   */
  getResults() {
    return {
      ...this.results,
      summary: {
        total: this.results.high.total + this.results.medium.total + this.results.low.total,
        highSuccess: this.results.high.success,
        highFailed: this.results.high.failed,
        mediumPending: this.results.medium.pending,
        mediumApproved: this.results.medium.approved,
        lowSkipped: this.results.low.skipped,
        lowLearned: this.results.low.learned
      }
    };
  }

  /**
   * saveResults - 保存结果到文件
   */
  saveResults(outputPath = null) {
    const filePath = outputPath || path.join(
      this.options.WORKSPACE,
      AR_CONFIG.OUTPUT_FILE
    );

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(this.results, null, 2), 'utf8');
      console.log(`💾 Auto-repair results saved to: ${filePath}`);
    } catch (e) {
      console.error(`❌ Failed to save results: ${e.message}`);
    }

    return filePath;
  }

  /**
   * printSummary - 打印摘要
   */
  printSummary() {
    console.log(`\n📊 Auto-Repair Summary:`);
    console.log(`   HIGH (>${this.strategies.HIGH.threshold}%): ${this.results.high.total} issues`);
    console.log(`      ✅ Fixed: ${this.results.high.success}`);
    console.log(`      ❌ Failed: ${this.results.high.failed}`);
    console.log(`   MEDIUM (${this.strategies.MEDIUM.threshold}-${this.strategies.HIGH.threshold - 1}%): ${this.results.medium.total} issues`);
    console.log(`      ⏳ Pending approval: ${this.results.medium.pending}`);
    console.log(`      ✅ Approved & fixed: ${this.results.medium.approved}`);
    console.log(`   LOW (<${this.strategies.MEDIUM.threshold}%): ${this.results.low.total} issues`);
    console.log(`      ⏭️  Skipped: ${this.results.low.skipped}`);
    console.log(`      📚 Learned: ${this.results.low.learned}`);
  }
}

// ==================== CLI 入口 ====================
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // 解析參數
  let inputFile = null;
  let command = 'repair';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputFile = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      command = 'help';
    } else if (args[i] === 'repair') {
      command = 'repair';
    } else if (args[i] === 'approve' && args[i + 1]) {
      command = 'approve';
      options.issueId = args[i + 1];
      i++;
    }
  }

  if (command === 'help') {
    console.log(`
Auto-Repair v${AR_CONFIG.VERSION} - Confidence-based Auto-Fix

Usage:
  node scripts/lib/auto_repair.js repair --input <file>
  node scripts/lib/auto_repair.js approve <issue-id>
  node scripts/lib/auto_repair.js --help

Commands:
  repair         Run auto-repair on verified issues
  approve <id>   Approve and fix a pending issue

Options:
  --input <file>  Input file with verified issues (JSON)
  --help, -h      Show this help message

Confidence Strategies:
  HIGH (>= 90%):   Auto-fix immediately
  MEDIUM (70-89%): Request user approval first
  LOW (< 70%):    Skip and learn patterns

Examples:
  # Run repair on batch verification results
  node scripts/lib/auto_repair.js repair --input .state/batch_verifier_results.json

  # Approve a specific issue
  node scripts/lib/auto_repair.js approve AR-1234567890-1
`);
    return;
  }

  if (command === 'repair') {
    // 默認輸入文件
    if (!inputFile) {
      inputFile = path.join(
        process.env.HOME || '/Users/ally',
        '.openclaw', 'workspace',
        '.state', 'batch_verifier_results.json'
      );
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

    console.log(`\n🔧 Auto-Repair v${AR_CONFIG.VERSION}`);
    console.log(`   Input: ${inputFile}`);
    console.log(`   Verified issues: ${verifiedIssues.length}`);

    // 創建 AutoRepair 實例
    const repair = new AutoRepair();

    // Step 1: 決定修復策略
    console.log(`\n📋 Step 1: Deciding repair strategies...`);
    const strategies = repair.decideRepairStrategy(verifiedIssues);
    console.log(`   HIGH (auto-fix): ${strategies.high.length}`);
    console.log(`   MEDIUM (approval): ${strategies.medium.length}`);
    console.log(`   LOW (skip+learn): ${strategies.low.length}`);

    // Step 2: 自動修復高置信度問题
    let fixResults = [];
    if (strategies.high.length > 0) {
      console.log(`\n🔧 Step 2: Auto-fixing HIGH confidence issues...`);
      fixResults = await repair.autoFix(strategies.high);
    }

    // Step 3: 請求確認中等置信度問题
    if (strategies.medium.length > 0) {
      console.log(`\n👀 Step 3: Requesting approval for MEDIUM confidence issues...`);
      repair.requestApproval(strategies.medium);
    }

    // Step 4: 學習低置信度問题
    if (strategies.low.length > 0) {
      console.log(`\n📚 Step 4: Learning from LOW confidence issues...`);
      repair.learnLowConfidence(strategies.low);
    }

    // 打印摘要
    repair.printSummary();

    // 保存结果
    repair.saveResults();

    return;
  }

  if (command === 'approve') {
    const repair = new AutoRepair();
    const result = await repair.approveIssue(options.issueId);

    console.log(`\n✅ Approval Result:`);
    console.log(`   Status: ${result.status}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    } else if (result.verification) {
      console.log(`   Verification: ${result.verification}`);
    }

    return;
  }
}

// ==================== Export ====================
module.exports = {
  AutoRepair,
  AR_CONFIG
};

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
