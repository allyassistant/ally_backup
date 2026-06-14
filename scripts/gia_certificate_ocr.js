#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * GIA Certificate OCR Processor
 * Extracts all data from GIA certificate images/PDFs
 */

const fs = require('fs');
const path = require('path');
const { WS } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');

class GIACertificateOCR {
  constructor(config = {}) {
    this.config = {
      // Support multiple OCR providers
      provider: config.provider || 'tesseract', // tesseract, google, azure
      language: config.language || 'eng',
      dataDir: config.dataDir || path.join(WS, 'data', 'gia_certificates')
    };

    // 添加 try-catch 處理權限錯誤
    try {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    } catch (err) {
      log(`⚠️ Failed to create data directory: ${err.message}`);
      throw err;
    }

    // GIA field patterns for validation
    this.patterns = {
      reportNumber: /GIAs*Reports*Number[s:]+(\d{10,})/i,
      shape: /Shapes+ands+Cuttings+Style[s:]+([\w\s]+)/i,
      measurements: /Measurements[s:]+(\d+\.\d+)\s*x\s*(\d+\.\d+)\s*x\s*(\d+\.\d+)/i,
      caratWeight: /Carats+Weight[s:]+(\d+\.\d+)/i,
      colorGrade: /Colors+Grade[s:]+([D-M])/i,
      clarityGrade: /Claritys+Grade[s:]+([FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3]+)/i,
      cutGrade: /Cuts+Grade[s:]+(\w+)/i,
      polish: /Polish[s:]+(\w+)/i,
      symmetry: /Symmetry[s:]+(\w+)/i,
      fluorescence: /Fluorescence[s:]+(\w+\s*\w*)/i,
      inscription: /Inscription(s)[s:]+([\w\s]+)/i,
      comments: /Comments[s:]+([\s\S]+?)(?=\w+:|$)/i
    };
  }

  async processImage(imagePath) {
    log(`Processing GIA certificate: ${path.basename(imagePath)}`);

    // Step 1: OCR extraction
    const rawText = await this.extractText(imagePath);

    // Step 2: Parse fields
    const parsedData = this.parseFields(rawText);

    // Step 3: Validate
    const validation = this.validate(parsedData);

    // Step 4: Save result
    const result = {
      sourceFile: imagePath,
      processedAt: getHKTDateTime(),
      rawText: rawText.substring(0, 1000), // Truncate for storage
      extractedData: parsedData,
      validation: validation,
      confidence: this.calculateConfidence(parsedData, validation)
    };

    this.saveResult(result);
    return result;
  }

  async extractText(imagePath) {
    // Mock implementation - would use actual OCR library
    // For Tesseract: const { createWorker } = require('tesseract.js');
    // For Google: Google Cloud Vision API
    // For Azure: Azure Computer Vision

    log('  → Running OCR...');

    // Simulated OCR output
    return `
GIA Report Number: 1234567890
Shape and Cutting Style: Round Brilliant
Measurements: 6.50 - 6.53 x 3.97 mm
Carat Weight: 1.00 carat
Color Grade: G
Clarity Grade: VS1
Cut Grade: Excellent
Polish: Excellent
Symmetry: Excellent
Fluorescence: None
Inscription(s): GIA 1234567890
Comments: None
`.trim();
  }

  parseFields(text) {
    const data = {};

    // FIX: Add try-catch around regex operations
    try {
      for (const [field, pattern] of Object.entries(this.patterns)) {
        const match = text.match(pattern);
        if (match) {
          data[field] = match[1].trim();
        }
      }

      // Special handling for measurements
      if (text.includes('Measurements')) {
        const mm = text.match(/(\d+\.\d+)\s*x\s*(\d+\.\d+)\s*x\s*(\d+\.\d+)/);
        if (mm) {
          data.measurements = {
            length: parseFloat(mm[1]),
            width: parseFloat(mm[2]),
            depth: parseFloat(mm[3])
          };
        }
      }

      // Extract carat as number (添加 null 檢查)
      if (data.caratWeight) {
        const match = data.caratWeight.match(/(\d+\.\d+)/);
        if (match && match[1]) {
          const carat = parseFloat(match[1]);
          if (!isNaN(carat)) data.carat = carat;
        }
      }
    } catch (err) {
      // Log error but continue with partial data
      log(`⚠️ Error parsing fields: ${err.message}`);
    }

    return data;
  }

  validate(data) {
    const errors = [];
    const warnings = [];

    // Required fields
    const required = ['reportNumber', 'shape', 'carat', 'colorGrade', 'clarityGrade'];
    required.forEach(field => {
      if (!data[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    });

    // Validate report number format (10 digits)
    if (data.reportNumber && !/^\d{10}$/.test(data.reportNumber.replace(/\s/g, ''))) {
      warnings.push('Report number format may be incorrect (expected 10 digits)');
    }

    // Validate color grade
    const validColors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    if (data.colorGrade && !validColors.includes(data.colorGrade.toUpperCase())) {
      warnings.push(`Unusual color grade: ${data.colorGrade}`);
    }

    // Validate clarity grade
    const validClarities = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];
    if (data.clarityGrade && !validClarities.includes(data.clarityGrade.toUpperCase())) {
      warnings.push(`Unusual clarity grade: ${data.clarityGrade}`);
    }

    // Validate carat range
    if (data.carat && (data.carat < 0.01 || data.carat > 100)) {
      warnings.push(`Unusual carat weight: ${data.carat}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  calculateConfidence(data, validation) {
    let score = 100;

    // Deduct for missing fields
    const required = ['reportNumber', 'shape', 'carat', 'colorGrade', 'clarityGrade'];
    const missing = required.filter(f => !data[f]).length;
    score -= missing * 15;

    // Deduct for validation errors
    score -= validation.errors.length * 20;
    score -= validation.warnings.length * 5;

    return Math.max(0, score);
  }

  // 驗證並清理文件名，防止路徑遍歷攻擊
  sanitizeFilename(reportNumber) {
    if (!reportNumber) return Date.now().toString();
    // 只允許字母數字字符，移除路徑字符
    return reportNumber.toString().replace(/[^a-zA-Z0-9]/g, '');
  }

  async saveResult(result) {
    // 使用清理後的 reportNumber 防止路徑遍歷
    const safeReportNumber = this.sanitizeFilename(result.extractedData.reportNumber);
    const filename = `gia_${safeReportNumber || Date.now()}.json`;
    const filepath = path.join(this.config.dataDir, filename);
    await fs.promises.writeFile(filepath, JSON.stringify(result, null, 2));
    log(`  → Saved: ${filepath}`);
  }

  async batchProcess(directory) {
    // 使用 fs.promises.readdir 替代同步版本，避免阻塞事件循環
    const entries = await fs.promises.readdir(directory).catch(() => []);
    const files = entries
      .filter(f => /.(jpg|jpeg|png|pdf|tiff)$/i.test(f))
      .map(f => path.join(directory, f));

    log(`Batch processing ${files.length} certificates...`);

    const results = [];
    for (const file of files) {
      try {
        const result = await this.processImage(file);
        results.push({ file, success: true, result });
      } catch (err) {
        results.push({ file, success: false, error: err.message });
      }
    }

    return results;
  }
}

module.exports = GIACertificateOCR;
