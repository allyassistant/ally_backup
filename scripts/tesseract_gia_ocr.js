#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Tesseract OCR Integration for GIA Certificate Processing
 * Uses tesseract.js to extract text from GIA certificate images
 */

const { createWorker } = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const { getHKTDate, getHKTDateTime } = require('./lib/time');

class TesseractGIAOCR {
  constructor(options = {}) {
    this.options = {
      language: options.language || 'eng',
      oem: options.oem || 3, // OCR Engine Mode: 3 = Default
      psm: options.psm || 6,  // Page Segmentation Mode: 6 = Assume single uniform block of text
      ...options
    };
    this.worker = null;
  }

  async initialize() {
    log('Initializing Tesseract worker...');
    this.worker = await createWorker(this.options.language);

    // Set parameters for better accuracy with documents
    await this.worker.setParameters({
      tessedit_ocr_engine_mode: this.options.oem,
      tessedit_pageseg_mode: this.options.psm,
      preserve_interword_spaces: '1',
    });

    log('✓ Tesseract ready');
  }

  async processImage(imagePath) {
    if (!this.worker) {
      await this.initialize();
    }

    log(`Processing: ${path.basename(imagePath)}`);

    try {
      const { data: { text, confidence, words } } = await this.worker.recognize(imagePath);

      return {
        success: true,
        rawText: text,
        confidence,
        wordCount: words.length,
        sourceFile: imagePath,
        processedAt: getHKTDateTime()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        sourceFile: imagePath
      };
    }
  }

  async processGIACertificate(imagePath) {
    const result = await this.processImage(imagePath);

    if (!result.success) {
      return result;
    }

    // Parse GIA-specific fields
    const parsedData = this.parseGIAFields(result.rawText);

    return {
      ...result,
      parsedData,
      validation: this.validateGIADate(parsedData)
    };
  }

  parseGIAFields(text) {
    const data = {};
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    // Common GIA certificate field patterns
    const patterns = {
      reportNumber: [/GIA\s*Report\s*(?:Number|#)?[\s:]*(\d{7,10})/i, /Report\s*(?:Number|#)[\s:]*(\d{7,10})/i],
      shape: [/Shape\s*(?:and\s*Cutting\s*Style)?[\s:]*([\w\s]+?)(?=\n|$)/i, /Shape[\s:]*([\w\s]+)/i],
      measurements: [/Measurements?[\s:]*(\d+\.?\d*)\s*[-x]\s*(\d+\.?\d*)\s*[-x]\s*(\d+\.?\d*)/i],
      caratWeight: [/Carat\s*Weight[\s:]*(\d+\.\d+)/i, /Weight[\s:]*(\d+\.\d+)\s*carat/i],
      colorGrade: [/Color\s*(?:Grade)?[\s:]*([D-M])/i],
      clarityGrade: [/Clarity\s*(?:Grade)?[\s:]*([FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3]+)/i],
      cutGrade: [/Cut\s*(?:Grade)?[\s:]*(\w+)/i],
      polish: [/Polish[\s:]*(\w+)/i],
      symmetry: [/Symmetry[\s:]*(\w+)/i],
      fluorescence: [/Fluorescence[\s:]*(\w+\s*\w*)/i],
      inscription: [/Inscription\(s\)?[\s:]*([\w\s]+)/i],
      comments: [/Comments[\s:]*([\s\S]+?)(?=\n\w+:|$)/i]
    };

    for (const [field, regexes] of Object.entries(patterns)) {
      for (const regex of regexes) {
        const match = text.match(regex);
        if (match) {
          data[field] = match[1].trim();
          break;
        }
      }
    }

    // Extract measurements as object
    if (data.measurements) {
      const mm = text.match(/(\d+\.?\d*)\s*[-x]\s*(\d+\.?\d*)\s*[-x]\s*(\d+\.?\d*)/);
      if (mm) {
        data.measurements = {
          length: parseFloat(mm[1]),
          width: parseFloat(mm[2]),
          depth: parseFloat(mm[3])
        };
      }
    }

    // Extract carat as number
    if (data.caratWeight) {
      const carat = parseFloat(data.caratWeight);
      if (!isNaN(carat)) data.carat = carat;
    }

    return data;
  }

  validateGIADate(data) {
    const errors = [];
    const warnings = [];

    // Required fields
    const required = ['reportNumber', 'shape', 'carat', 'colorGrade', 'clarityGrade'];
    required.forEach(field => {
      if (!data[field]) {
        errors.push(`Missing: ${field}`);
      }
    });

    // Validate formats
    if (data.reportNumber && !/^\d{7,10}$/.test(data.reportNumber.replace(/\s/g, ''))) {
      warnings.push('Report number format unusual');
    }

    const validColors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    if (data.colorGrade && !validColors.includes(data.colorGrade.toUpperCase())) {
      warnings.push(`Unusual color: ${data.colorGrade}`);
    }

    const validClarities = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];
    if (data.clarityGrade && !validClarities.includes(data.clarityGrade.toUpperCase())) {
      warnings.push(`Unusual clarity: ${data.clarityGrade}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      fieldCount: Object.keys(data).length
    };
  }

  async batchProcess(directory, options = {}) {
    let files;
    try {
      files = fs.readdirSync(directory)
        .filter(f => /\.(jpg|jpeg|png|tiff|bmp|pdf)$/i.test(f))
        .map(f => path.join(directory, f));
    } catch (e) {
      console.error('Error: ' + e.message);
      files = [];
    }

    log(`\nBatch processing ${files.length} images...\n`);

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      data: []
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      log(`[${i + 1}/${files.length}] ${path.basename(file)}`);

      const result = await this.processGIACertificate(file);
      results.processed++;

      if (result.success) {
        results.successful++;
        results.data.push(result);
        log(`  ✓ Confidence: ${result.confidence.toFixed(1)}%`);
        if (result.parsedData.reportNumber) {
          log(`  ✓ Report #: ${result.parsedData.reportNumber}`);
        }
      } else {
        results.failed++;
        log(`  ✗ ${result.error}`);
      }
    }

    return results;
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      log('Tesseract worker terminated');
    }
  }

  exportToJSON(results, outputPath) {
    try {
      // HR-068: Atomic write for JSON export
      const tmpPath = outputPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(results, null, 2));
      fs.renameSync(tmpPath, outputPath);
      log(`\nExported to: ${outputPath}`);
    } catch (e) {
      console.error('Error: ' + e.message);
    }
  }

  exportToCSV(results, outputPath) {
    try {
      const headers = ['ReportNumber', 'Shape', 'Carat', 'Color', 'Clarity', 'Cut', 'Polish', 'Symmetry', 'Fluorescence', 'Confidence'];

      const rows = results.data
        .filter(r => r.parsedData)
        .map(r => {
          const d = r.parsedData;
          return [
            d.reportNumber || '',
            d.shape || '',
            d.carat || '',
            d.colorGrade || '',
            d.clarityGrade || '',
            d.cutGrade || '',
            d.polish || '',
            d.symmetry || '',
            d.fluorescence || '',
            r.confidence.toFixed(1)
          ].join(',');
        });

      const csv = [headers.join(','), ...rows].join('\n');
      // HR-068: Atomic write for CSV export
      const tmpPath = outputPath + '.tmp';
      try {
        fs.writeFileSync(tmpPath, csv);
        fs.renameSync(tmpPath, outputPath);
        log(`Exported to: ${outputPath}`);
      } catch (e) {
        console.error('Error: ' + e.message);
      }
    } catch (e) {
      console.error('Error: ' + e.message);
    }
  }
}
if (require.main === module) {
  const ocr = new TesseractGIAOCR();

  const args = process.argv.slice(2);
  const command = args[0];
  const input = args[1];

  (async () => {
    try {
      if (command === 'single' && input) {
        const result = await ocr.processGIACertificate(input);
        log('\n' + JSON.stringify(result, null, 2));
      } else if (command === 'batch' && input) {
        const results = await ocr.batchProcess(input);
        log('\n=== Summary ===');
        log(`Processed: ${results.processed}`);
        log(`Successful: ${results.successful}`);
        log(`Failed: ${results.failed}`);

        // Export results
        const timestamp = getHKTDate();
        ocr.exportToJSON(results, `gia_ocr_results_${timestamp}.json`);
        ocr.exportToCSV(results, `gia_ocr_results_${timestamp}.csv`);
      } else {
        log('Usage:');
        log('  node tesseract_gia_ocr.js single <image-path>');
        log('  node tesseract_gia_ocr.js batch <directory>');
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      await ocr.terminate();
    }
  })();
}

module.exports = TesseractGIAOCR;
