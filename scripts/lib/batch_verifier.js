#!/usr/bin/env node
/**
 * batch_verifier.js - Batch Verification Module
 *
 * 使用 Kimi Code CLI 一次性確認多個候選問題
 * 減少 Token 消耗，加快驗證速度
 *
 * Created: 2026-04-06
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

// ==================== 配置常量 ====================
const BV_CONFIG = {
  VERSION: '1.0.0',
  NAME: 'Batch Verifier',

  // Kimi CLI 路徑
  KIMI_CLI: path.join(process.env.HOME || '/Users/ally', '.local', 'bin', 'kimi'),

  // 批次大小（每次 Kimi call 的候選問題數）
  BATCH_SIZE: 17,

  // 並行處理 batch 數量（2-5）
  MAX_PARALLEL_BATCHES: 3,

  // 最小置信度閾值
  MIN_CONFIDENCE: 0.6,

  // Prompt 模板目錄
  PROMPT_TEMPLATE_DIR: path.join(__dirname, '..', '..', 'memory', 'templates'),

  // 輸出
  OUTPUT_FILE: '.state/batch_verifier_results.json'
};

// ==================== Issue 結構定義 ====================
/**
 * @typedef {Object} CandidateIssue
 * @property {string} file
 * @property {number|null} line
 * @property {string} rule
 * @property {string} message
 * @property {string} severity
 * @property {string} source
 */

// ==================== Batch Verifier ====================
class BatchVerifier {
  constructor(options = {}) {
    this.options = {
      ...BV_CONFIG,
      ...options
    };

    this.results = {
      verified: [],
      rejected: [],
      needsReview: [],
      confidence: {},
      metadata: {}
    };

    this._kimiAvailable = null; // cache check
  }

  /**
   * checkKimiAvailability - 檢查 Kimi CLI 是否可用
   */
  checkKimiAvailability() {
    if (this._kimiAvailable !== null) {
      return this._kimiAvailable;
    }

    try {
      // 嘗試獲取版本信息
      execFileSync(this.options.KIMI_CLI, ['--version'], {
        encoding: 'utf8',
        timeout: 10000
      });
      this._kimiAvailable = true;
    } catch (err) {
      // 如果是參數錯誤（--version 可能不支持），檢查文件是否存在
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
   * buildBatchPrompt - 構建批次分析 Prompt
   *
   * @param {CandidateIssue[]} candidates - 候選問題列表
   * @returns {string} - 完整的 prompt
   */
  buildBatchPrompt(candidates) {
    if (!candidates || candidates.length === 0) {
      return '';
    }

    const prompt = `你是代碼質量審計助手。你的任務是驗證以下候選問題是否真實有效。

## 驗證標準

對於每個候選問題，你需要判斷：

1. **真實問題 (VERIFIED)** - 問題確實存在且有價值修復
   - 代碼邏輯錯誤
   - 安全性漏洞
   - 嚴重的性能問題
   - 明確的 TypeError/NullReference 等

2. **誤報 (REJECTED)** - 問題無效或不值得修復
   - 註釋中的內容（代碼示例）
   - 文檔字符串中的代碼
   - 已安全包裝的 execSync（已有 try-catch）
   - 白名單中的 Magic Numbers
   - 測試檔案中的問題

3. **需要人工審核 (NEEDS_REVIEW)** - 無法確定，需要人工確認
   - 與下文不足
   - 涉及業務邏輯
   - 可能的問題但不確定

## 候選問題（共 ${candidates.length} 個）

${candidates.map((c, idx) => {
  return `
### [${idx + 1}] ${c.file}${c.line ? ':' + c.line : ''}
- **規則**: ${c.rule || 'unknown'}
- **嚴重程度**: ${c.severity}
- **來源**: ${c.source || 'unknown'}
- **描述**: ${c.message || c.title || 'No description'}

`;
}).join('\n')}

## 輸出格式

請以 JSON 格式返回結果：

\`\`\`json
{
  "verifications": [
    {
      "index": 1,
      "file": "相對路徑",
      "line": 行號,
      "rule": "規則名",
      "verdict": "VERIFIED | REJECTED | NEEDS_REVIEW",
      "confidence": 0.0-1.0,
      "reasoning": "判斷理由（1-2句）",
      "suggestion": "修復建議（如適用）"
    }
  ],
  "batch_summary": {
    "total": 總據,
    "verified": 確認據,
    "rejected": 誤報據,
    "needs_review": 待審核據,
    "avg_confidence": 平均置信度
  }
}
\`\`\`

## 重要提醒

- 請嚴格按照與述標準判斷
- 只標記為 VERIFIED 如果問題確實存在且有意義
- REJECTED 適用於明顯的誤報
- 保持高置信度（>0.8）如果問題很明確
- 結果必須是合法的 JSON

現在請分析以與 ${candidates.length} 個候選問題：`;

    return prompt;
  }

  /**
   * _extractJsonFromMarkdown - 從 Markdown code block 提取 JSON
   *
   * 支持格式：
   * - ```json ... ```
   * - ``` ... ```
   * - ```json\n ... ```
   * - ```\n ... ```
   *
   * @param {string} text - 原始文本
   * @returns {Object} - {success: bool, json: string, method: string}
   */
  _extractJsonFromMarkdown(text) {
    // 方法 1: 標準 ```json ... ``` 格式
    const standardMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (standardMatch) {
      const json = standardMatch[1].trim();
      return { success: true, json, method: 'markdown-json-block' };
    }

    // 方法 2: 通用 ``` ... ``` 格式（無語言標記）
    const genericMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    if (genericMatch) {
      const json = genericMatch[1].trim();
      return { success: true, json, method: 'markdown-generic-block' };
    }

    // 方法 3: 單行 ``` ... ``` 格式
    const inlineMatch = text.match(/`([^`]+)`/);
    if (inlineMatch && inlineMatch[1].includes('"verifications"')) {
      return { success: true, json: inlineMatch[1], method: 'inline-json' };
    }

    return { success: false, json: text, method: 'none' };
  }

  /**
   * _tryParseJson - 嘗試解析 JSON，處理唔完整/損壞的情況
   *
   * @param {string} jsonStr - JSON 字符串
   * @returns {Object} - {success: bool, data: object, error: string, method: string}
   */
  _tryParseJson(jsonStr) {
    // 清理前導/尾隨空白
    const cleaned = jsonStr.trim();

    // 方法 1: 直接 JSON.parse
    try {
      const data = JSON.parse(cleaned);
      return { success: true, data, error: null, method: 'direct-parse' };
    } catch (e) {
      // continue to next method
    }

    // 方法 2: 移除 BOM 和特殊字符
    const stripped = cleaned
      .replace(/^\uFEFF/, '')  // Remove BOM
      .replace(/[\u200B-\u200D\uFEFF]/g, '')  // Remove zero-width chars
      .replace(/,\s*([}\]])/g, '$1');  // Remove trailing commas

    try {
      const data = JSON.parse(stripped);
      return { success: true, data, error: null, method: 'stripped-parse' };
    } catch (e) {
      // continue to next method
    }

    // 方法 3: 修復常見的 JSON 錯誤
    // 3a: 單引號 → 雙引號
    let fixed = stripped.replace(/'/g, '"');
    // 3b: 未加引號的 key
    fixed = fixed.replace(/(\s*)(\w+)(\s*):/g, '$1"$2"$3:');
    // 3c: 尾隨逗號
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    // 3d: 移除註釋
    fixed = fixed.replace(/\/\/.*$/gm, '');
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

    try {
      const data = JSON.parse(fixed);
      return { success: true, data, error: null, method: 'fixed-quotes-parse' };
    } catch (e) {
      return { success: false, data: null, error: e.message, method: 'all-failed' };
    }
  }

  /**
   * parseBatchResponse - 解析 Kimi 返回的 JSON 結果
   *
   * 解析策略（按優先級）：
   * 1. Markdown JSON block 提取 + 直接解析
   * 2. Markdown generic block 提取 + 修復後解析
   * 3. Raw JSON 直接解析
   * 4. Fallback regex 提取
   *
   * @param {string} response - Kimi CLI 返回的文本
   * @returns {Object} - 結構化的驗證結果
   */
  parseBatchResponse(response) {
    if (!response || typeof response !== 'string') {
      return { error: 'Empty or invalid response' };
    }

    const debug = {
      parseAttempts: [],
      finalMethod: null
    };

    // ===== Step 1: Markdown code block 提取 =====
    const blockResult = this._extractJsonFromMarkdown(response);
    debug.parseAttempts.push({
      step: 1,
      method: `extract-markdown-${blockResult.method}`,
      success: blockResult.success
    });

    // ===== Step 2: 嘗試解析 =====
    let parseResult;
    if (blockResult.success) {
      parseResult = this._tryParseJson(blockResult.json);
      debug.parseAttempts.push({
        step: 2,
        method: `parse-${parseResult.method}`,
        success: parseResult.success
      });
    } else {
      parseResult = this._tryParseJson(response);
      debug.parseAttempts.push({
        step: 2,
        method: `parse-raw-${parseResult.method}`,
        success: parseResult.success
      });
    }

    // ===== Step 3: 驗證結構 =====
    if (parseResult.success) {
      const data = parseResult.data;

      if (data && data.verifications && Array.isArray(data.verifications)) {
        debug.finalMethod = `success-${parseResult.method}`;
        return {
          verifications: data.verifications,
          batch_summary: data.batch_summary || {
            total: data.verifications.length,
            verified: data.verifications.filter(v => v.verdict === 'VERIFIED').length,
            rejected: data.verifications.filter(v => v.verdict === 'REJECTED').length,
            needs_review: data.verifications.filter(v => v.verdict === 'NEEDS_REVIEW').length,
            avg_confidence: this._calcAvgFromVerifications(data.verifications)
          },
          _debug: debug
        };
      } else if (data && data.results && Array.isArray(data.results)) {
        // 可能返回的是 {results: [...]} 格式
        debug.finalMethod = `success-results-array`;
        return {
          verifications: data.results,
          batch_summary: data.batch_summary || {
            total: data.results.length,
            verified: data.results.filter(v => v.verdict === 'VERIFIED').length,
            rejected: data.results.filter(v => v.verdict === 'REJECTED').length,
            needs_review: data.results.filter(v => v.verdict === 'NEEDS_REVIEW').length,
            avg_confidence: this._calcAvgFromVerifications(data.results)
          },
          _debug: debug
        };
      } else {
        debug.parseAttempts.push({
          step: 3,
          method: 'invalid-structure',
          success: false,
          reason: 'missing verifications array'
        });
      }
    }

    // ===== Step 4: Fallback regex 提取 =====
    console.log(`   🔧 [parseBatchResponse] JSON parse failed, trying fallback regex...`);
    console.log(`   📝 [debug] Attempts: ${debug.parseAttempts.map(a => `${a.method}(${a.success ? '✅' : '❌'})`).join(' → ')}`);

    const fallbackResult = this._parseFallback(response);
    if (fallbackResult.verifications && fallbackResult.verifications.length > 0) {
      debug.finalMethod = 'fallback-regex';
      fallbackResult._debug = debug;
      console.log(`   ✅ [fallback] Extracted ${fallbackResult.verifications.length} items via regex`);
      return fallbackResult;
    }

    // ===== Step 5: 完全失敗 =====
    debug.finalMethod = 'completely-failed';
    return {
      error: `Failed to parse response after all methods. Last error: ${parseResult.error || 'unknown'}`,
      _debug: debug
    };
  }

  /**
   * _calcAvgFromVerifications - 從 verifications 據組計算平均置信度
   */
  _calcAvgFromVerifications(verifications) {
    if (!verifications || verifications.length === 0) return 0;
    const confidences = verifications
      .map(v => v.confidence || 0)
      .filter(c => typeof c === 'number');
    if (confidences.length === 0) return 0;
    return confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  /**
   * _parseFallback - 寬鬆解析（當 JSON 解析失敗時）
   *
   * 用 regex 提取每個 item 的:
   * - file (相對路徑)
   * - line (行號)
   * - is_true_positive (verdict)
   * - confidence (置信度)
   * - reason (reasoning)
   */
  _parseFallback(response) {
    const debug = { regexMatches: 0 };

    // ===== 方法 1: 嘗試提取 JSON block =====
    let textToParse = response;
    try {
      const jsonBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        textToParse = jsonBlockMatch[1].trim();
      }
    } catch (e) {
      // ignore
    }

    // ===== 方法 2: 直接 JSON.parse（最後一次嘗試）=====
    try {
      const directParse = JSON.parse(textToParse);
      if (directParse.verifications && Array.isArray(directParse.verifications)) {
        console.log(`   ✅ [fallback] Direct parse succeeded`);
        return {
          verifications: directParse.verifications,
          batch_summary: directParse.batch_summary || {
            total: directParse.verifications.length,
            verified: directParse.verifications.filter(v => v.verdict === 'VERIFIED').length,
            rejected: directParse.verifications.filter(v => v.verdict === 'REJECTED').length,
            needs_review: directParse.verifications.filter(v => v.verdict === 'NEEDS_REVIEW').length,
            avg_confidence: this._calcAvgFromVerifications(directParse.verifications)
          },
          _fallbackMethod: 'direct-parse'
        };
      }
    } catch (e) {
      // ignore
    }

    // ===== 方法 3: Regex 提取每個 item =====
    const result = {
      verifications: [],
      batch_summary: { total: 0, verified: 0, rejected: 0, needs_review: 0, avg_confidence: 0 },
      _fallbackMethod: 'regex-extraction'
    };

    // 提取 verdict - 多种格式
    // 格式1: "verdict": "VERIFIED"
    // 格式2: 'verdict': 'VERIFIED'
    // 格式3: verdict: VERIFIED
    // 格式4: "verdict":"VERIFIED"
    const verdictRegex = /verdict["\s:']+([A-Z_]{3,})/gi;
    const verdicts = [];
    let match;
    while ((match = verdictRegex.exec(response)) !== null) {
      verdicts.push(match[1].toUpperCase());
    }

    // 提取 confidence - 多种格式
    const confidenceRegex = /confidence["\s:]+([0-9]*\.?[0-9]+)/gi;
    const confidences = [];
    while ((match = confidenceRegex.exec(response)) !== null) {
      confidences.push(parseFloat(match[1]));
    }

    // 提取 file 路徑
    const fileRegex = /file["\s:]+["']?([^"'\n,}]+)/gi;
    const files = [];
    while ((match = fileRegex.exec(response)) !== null) {
      files.push(match[1].trim());
    }

    // 提取 line 行號
    const lineRegex = /line["\s:]+([0-9]+)/gi;
    const lines = [];
    while ((match = lineRegex.exec(response)) !== null) {
      lines.push(parseInt(match[1], 10));
    }

    // 提取 reasoning
    const reasoningRegex = /reasoning["\s:]+"?([^"]+)"?/gi;
    const reasonings = [];
    while ((match = reasoningRegex.exec(response)) !== null) {
      reasonings.push(match[1].trim());
    }

    debug.regexMatches = verdicts.length;

    if (verdicts.length > 0) {
      // 建立 verifications 數組
      for (let i = 0; i < verdicts.length; i++) {
        result.verifications.push({
          index: i + 1,
          file: files[i] || null,
          line: lines[i] || null,
          verdict: verdicts[i],
          confidence: confidences[i] || confidences[0] || 0.5,
          reasoning: reasonings[i] || reasonings[0] || 'Extracted via fallback regex parser'
        });
      }

      result.batch_summary = {
        total: verdicts.length,
        verified: verdicts.filter(v => v === 'VERIFIED').length,
        rejected: verdicts.filter(v => v === 'REJECTED').length,
        needs_review: verdicts.filter(v => v === 'NEEDS_REVIEW').length,
        avg_confidence: confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0.5
      };

      console.log(`   ✅ [fallback-regex] Extracted ${result.verifications.length} items:`);
      console.log(`      📊 V=${result.batch_summary.verified} R=${result.batch_summary.rejected} N=${result.batch_summary.needs_review}`);

      return result;
    }

    return {
      error: 'Fallback regex extraction found no verdicts',
      _debug: debug,
      _fallbackMethod: 'regex-failed'
    };
  }

  /**
   * verifyBatch - 驗證一批候選問題
   *
   * @param {CandidateIssue[]} candidates - 候選問題列表
   * @param {Object} options - 選項
   * @returns {Object} - 驗證結果
   */
  async verifyBatch(candidates, options = {}) {
    if (!candidates || candidates.length === 0) {
      return {
        verified: [],
        rejected: [],
        needsReview: [],
        confidence: {},
        metadata: { total: 0, skipped: true }
      };
    }

    const batchSize = options.batchSize || this.options.BATCH_SIZE;
    const skipKimi = options.skipKimi || !this.checkKimiAvailability();

    console.log(`\n🔍 Batch Verifier Starting`);
    console.log(`   Candidates: ${candidates.length}`);
    console.log(`   Batch size: ${batchSize}`);
    console.log(`   Kimi available: ${!skipKimi ? '✅' : '❌'}`);

    const verified = [];
    const rejected = [];
    const needsReview = [];
    const confidence = {};

    if (skipKimi) {
      console.log('   ⚠️ Skipping Kimi verification (CLI not available)');
      console.log('   → All candidates marked as NEEDS_REVIEW');

      for (const candidate of candidates) {
        const key = `${candidate.file}:${candidate.line}:${candidate.rule}`;
        confidence[key] = 0.5;
        needsReview.push({
          ...candidate,
          confidence: 0.5,
          reasoning: 'Kimi CLI not available, manual review required'
        });
      }

      this.results = { verified, rejected, needsReview, confidence };
      return this.results;
    }

    // 分批處理
    const batches = [];
    for (let i = 0; i < candidates.length; i += batchSize) {
      batches.push(candidates.slice(i, i + batchSize));
    }

    // 並行處理配置
    const maxParallel = Math.min(
      Math.max(2, options.maxParallelBatches || this.options.MAX_PARALLEL_BATCHES),
      5
    );

    console.log(`   Total batches: ${batches.length}`);
    console.log(`   Max parallel: ${maxParallel}`);

    // 並行處理 batch 的輔助函數
    const processBatch = async (batch, batchNum) => {
      console.log(`\n   📦 Batch ${batchNum}/${batches.length} (${batch.length} candidates)...`);

      const batchVerified = [];
      const batchRejected = [];
      const batchNeedsReview = [];
      const batchConfidence = {};

      try {
        // 構建 prompt
        const prompt = this.buildBatchPrompt(batch);

        // 調用 Kimi
        console.log(`      🤖 Calling Kimi CLI...`);
        const response = await this._callKimiAsync(prompt);

        // 解析結果
        const parsed = this.parseBatchResponse(response);

        if (parsed.error) {
          console.log(`      ⚠️ Parse error: ${parsed.error}`);
          // 將整批標記為需要審核
          for (const candidate of batch) {
            const key = `${candidate.file}:${candidate.line}:${candidate.rule}`;
            batchConfidence[key] = 0.3;
            batchNeedsReview.push({
              ...candidate,
              confidence: 0.3,
              reasoning: `Parse failed: ${parsed.error}`
            });
          }
          return { verified: batchVerified, rejected: batchRejected, needsReview: batchNeedsReview, confidence: batchConfidence };
        }

        // 處理驗證結果
        console.log(`      ✅ Parsed ${parsed.verifications.length} verifications`);

        for (const v of parsed.verifications) {
          let idx = v.index;
          if (idx >= 1 && idx <= batch.length) {
            idx = idx - 1; // Convert 1-indexed to 0-indexed
          } else if (idx >= 0 && idx < batch.length) {
            // Already 0-indexed, keep as-is
          } else {
            console.log(`      ⚠️ Invalid index ${v.index}, skipping`);
            continue;
          }

          const candidate = batch[idx];
          const key = `${candidate.file}:${candidate.line}:${candidate.rule}`;

          batchConfidence[key] = v.confidence || 0.5;

          const resultItem = {
            ...candidate,
            confidence: v.confidence || 0.5,
            reasoning: v.reasoning || '',
            suggestion: v.suggestion || '',
            verdict: v.verdict
          };

          switch (v.verdict) {
            case 'VERIFIED':
              // 只接受高置信度的 VERIFIED
              if (v.confidence >= this.options.MIN_CONFIDENCE) {
                batchVerified.push(resultItem);
                console.log(`         ✅ VERIFIED (${(v.confidence * 100).toFixed(0)}%): ${candidate.file}:${candidate.line}`);
              } else {
                batchNeedsReview.push(resultItem);
                console.log(`         🤔 LOW CONF (${(v.confidence * 100).toFixed(0)}%): ${candidate.file}:${candidate.line}`);
              }
              break;

            case 'REJECTED':
              batchRejected.push(resultItem);
              console.log(`         ❌ REJECTED: ${candidate.file}:${candidate.line} - ${v.reasoning}`);
              break;

            case 'NEEDS_REVIEW':
            default:
              batchNeedsReview.push(resultItem);
              console.log(`         👀 NEEDS_REVIEW: ${candidate.file}:${candidate.line}`);
              break;
          }
        }

      } catch (err) {
        // 檢查是否為超時錯誤
        const isTimeout = err.message && (
          err.message.includes('timeout') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('ENOTEMPTY') || // process already killed
          err.message.includes('SIGTERM') ||
          err.message.includes('SIGKILL')
        );

        if (isTimeout) {
          console.log(`      ⚠️ Batch ${batchNum} timeout after 60s, skipping verification (marked as NEEDS_REVIEW)`);
        } else {
          console.log(`      ❌ Batch ${batchNum} failed: ${err.message}`);
        }

        // 將整批標記為需要審核
        for (const candidate of batch) {
          const key = `${candidate.file}:${candidate.line}:${candidate.rule}`;
          batchConfidence[key] = isTimeout ? 0.3 : 0.2;
          batchNeedsReview.push({
            ...candidate,
            confidence: isTimeout ? 0.3 : 0.2,
            reasoning: isTimeout
              ? 'Kimi CLI timeout after 60s, skipped verification'
              : `Batch failed: ${err.message}`
          });
        }
      }

      return { verified: batchVerified, rejected: batchRejected, needsReview: batchNeedsReview, confidence: batchConfidence };
    };

    // 並行處理所有 batches
    for (let i = 0; i < batches.length; i += maxParallel) {
      const batchGroup = batches.slice(i, i + maxParallel);
      const batchNums = batchGroup.map((_, idx) => i + idx + 1);

      console.log(`\n🚀 Processing batch group ${Math.floor(i / maxParallel) + 1}/${Math.ceil(batches.length / maxParallel)} (${batchGroup.length} parallel)`);

      const results = await Promise.all(
        batchGroup.map((batch, idx) => processBatch(batch, batchNums[idx]))
      );

      // 合併結果
      for (const result of results) {
        verified.push(...result.verified);
        rejected.push(...result.rejected);
        needsReview.push(...result.needsReview);
        Object.assign(confidence, result.confidence);
      }
    }

    // 設置結果
    this.results = {
      verified,
      rejected,
      needsReview,
      confidence,
      metadata: {
        total: candidates.length,
        verifiedCount: verified.length,
        rejectedCount: rejected.length,
        needsReviewCount: needsReview.length,
        batchCount: batches.length,
        avgConfidence: this._calcAvgConfidence(confidence),
        timestamp: new Date().toISOString()
      }
    };

    console.log(`\n   📊 Batch Verification Summary:`);
    console.log(`      ✅ Verified: ${verified.length}`);
    console.log(`      ❌ Rejected: ${rejected.length}`);
    console.log(`      👀 Needs Review: ${needsReview.length}`);
    console.log(`      Avg Confidence: ${(this.results.metadata.avgConfidence * 100).toFixed(1)}%`);

    return this.results;
  }

  /**
   * _callKimiAsync - 異步調用 Kimi CLI
   */
  _callKimiAsync(prompt) {
    return new Promise((resolve, reject) => {
      try {
        const tmpPromptFile = path.join(
          os.tmpdir(),
          `kimi-prompt-${Date.now()}.txt`
        );

        // 寫入 prompt 到臨時文件
        fs.writeFileSync(tmpPromptFile, prompt, 'utf8');

        const child = spawn(
          this.options.KIMI_CLI,
          [
            '-C',
            '-w', path.join(process.env.HOME || '/Users/ally', '.openclaw', 'workspace'),
            '-p', tmpPromptFile,
            '--print'
          ]
        );

        let stdout = '';
        let stderr = '';
        let timeoutId = null;

        // 設置 2 分鐘超時計時器
        const TIMEOUT_MS = 120000;
        timeoutId = setTimeout(() => {
          console.log(`   ⚠️ [batch_verifier] Kimi CLI timeout after ${TIMEOUT_MS/1000}s, killing process...`);
          child.kill('SIGTERM');
          setTimeout(() => {
            // 如果還沒死，強行 kill
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }, TIMEOUT_MS);

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          // 清除超時計時器
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          // 清理臨時文件
          try {
            fs.unlinkSync(tmpPromptFile);
          } catch (e) {
            // ignore
          }

          if (code !== 0 && !stdout) {
            reject(new Error(`Kimi CLI exited with code ${code}: ${stderr}`));
          } else {
            resolve(stdout);
          }
        });

        child.on('error', (err) => {
          // 清除超時計時器
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          try {
            fs.unlinkSync(tmpPromptFile);
          } catch (e) {
            // ignore
          }
          reject(err);
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * _calcAvgConfidence - 計算平均置信度
   */
  _calcAvgConfidence(confidenceMap) {
    const values = Object.values(confidenceMap);
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * getResults - 獲取驗證結果
   */
  getResults() {
    return this.results;
  }

  /**
   * saveResults - 保存結果到文件
   */
  saveResults(outputPath = null) {
    const filePath = outputPath || path.join(
      process.env.HOME || '/Users/ally',
      '.openclaw', 'workspace',
      this.options.OUTPUT_FILE
    );

    const dir = path.dirname(filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      // ignore
    }

    try {
      fs.writeFileSync(filePath, JSON.stringify(this.results, null, 2), 'utf8');
      console.log(`💾 Batch verification results saved to: ${filePath}`);
    } catch (err) {
      console.error(`❌ Failed to save results: ${err.message}`);
    }

    return filePath;
  }

  /**
   * convertToIssues - 將驗證結果轉換為標準 Issue 格式
   *
   * 只保留 VERIFIED 問題（高置信度），返回給 code_quality_manager.js
   */
  convertToIssues() {
    const { verified, rejected, needsReview } = this.results;

    // 只返回 VERIFIED 且高置信度的問題
    return verified.map(v => ({
      file: v.file,
      line: v.line,
      rule: v.rule,
      title: v.message || v.title || 'Verified issue',
      severity: v.severity,
      source: v.source,
      category: v.category || 'reliability',
      confidence: v.confidence,
      verified: true,
      reasoning: v.reasoning
    }));
  }

  /**
   * getStats - 獲取統計信息
   */
  getStats() {
    const { verified, rejected, needsReview, metadata } = this.results;
    return {
      total: (metadata?.total) || 0,
      verified: verified.length,
      rejected: rejected.length,
      needsReview: needsReview.length,
      avgConfidence: metadata?.avgConfidence || 0,
      kimiUsed: this.checkKimiAvailability()
    };
  }
}

// ==================== CLI 入口 ====================
async function main() {
  const args = process.argv.slice(2);
  const options = {
    _quiet: args.includes('--quiet') || args.includes('-q')
  };

  // 解析參數
  let inputFile = null;
  let batchSize = BV_CONFIG.BATCH_SIZE;
  let maxParallel = BV_CONFIG.MAX_PARALLEL_BATCHES;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputFile = args[i + 1];
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--max-parallel' && args[i + 1]) {
      maxParallel = Math.min(Math.max(2, parseInt(args[i + 1], 10)), 5);
      i++;
    }
  }

  if (!inputFile) {
    console.log(`Batch Verifier v${BV_CONFIG.VERSION}`);
    console.log('\nUsage:');
    console.log('  batch_verifier.js --input <file> [--batch-size N] [--max-parallel 2-5] [--quiet]');
    console.log('\nOptions:');
    console.log('  --input <file>        Input JSON file with candidate issues');
    console.log('  --batch-size N        Batch size (default: 20)');
    console.log('  --max-parallel 2-5    Max parallel batches (default: 2, max: 5)');
    console.log('  --quiet, -q           Suppress non-essential output');
    console.log('\nExample:');
    console.log('  batch_verifier.js --input .state/audit_orchestrator_results.json --max-parallel 3');
    process.exit(1);
  }

  // 讀取輸入文件
  let inputData;
  try {
    const content = fs.readFileSync(inputFile, 'utf8');
    inputData = JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to read input file: ${err.message}`);
    process.exit(1);
  }

  // 提取候選問題
  const candidates = inputData.merged || inputData.results?.merged || inputData.issues || [];

  if (candidates.length === 0) {
    console.log('⚠️ No candidate issues found in input file');
    process.exit(0);
  }

  console.log(`\n🔍 Batch Verifier`);
  console.log(`   Input: ${inputFile}`);
  console.log(`   Candidates: ${candidates.length}`);

  // 運行驗證
  const verifier = new BatchVerifier({ BATCH_SIZE: batchSize, MAX_PARALLEL_BATCHES: maxParallel });
  const results = await verifier.verifyBatch(candidates, { maxParallelBatches: maxParallel });

  // 保存結果
  verifier.saveResults();

  // 顯示摘要
  const stats = verifier.getStats();
  console.log('\n📊 Final Stats:');
  console.log(`   Total: ${stats.total}`);
  console.log(`   ✅ Verified: ${stats.verified}`);
  console.log(`   ❌ Rejected: ${stats.rejected}`);
  console.log(`   👀 Needs Review: ${stats.needsReview}`);
  console.log(`   Avg Confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`);
}

// Export
module.exports = {
  BatchVerifier,
  BV_CONFIG
};

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
