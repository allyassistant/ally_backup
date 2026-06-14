#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Diamond Image Processor
 * Optimizes product photos for web/catalog
 */

const fs = require('fs');
const path = require('path');
const { WS } = require('./lib/config');

class ImageProcessor {
  constructor(config = {}) {
    this.config = {
      outputDir: config.outputDir || path.join(WS, 'images', 'processed'),
      sizes: config.sizes || {
        thumbnail: { width: 150, height: 150 },
        medium: { width: 400, height: 400 },
        large: { width: 800, height: 800 },
        original: null
      },
      quality: config.quality || 85
    };

    try {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error(`❌ Failed to create output directory: ${err.message}`);
        throw err;
      }
    }
  }

  async optimize(inputPath, options = {}) {
    log(`Processing ${path.basename(inputPath)}...`);

    const results = {};

    // Generate different sizes
    for (const [sizeName, dimensions] of Object.entries(this.config.sizes)) {
      if (dimensions) {
        results[sizeName] = await this.resize(inputPath, dimensions, sizeName);
      } else {
        results[sizeName] = await this.copyOriginal(inputPath);
      }
    }

    return results;
  }

  async resize(inputPath, dimensions, sizeName) {
    // Implementation would use sharp or similar
    const outputFilename = `${path.parse(inputPath).name}_${sizeName}.jpg`;
    const outputPath = path.join(this.config.outputDir, outputFilename);

    log(`  → ${sizeName}: ${dimensions.width}x${dimensions.height}`);

    return {
      size: sizeName,
      path: outputPath,
      dimensions,
      url: `/images/processed/${outputFilename}`
    };
  }

  async copyOriginal(inputPath) {
    const outputFilename = path.basename(inputPath);
    const outputPath = path.join(this.config.outputDir, outputFilename);

    log(`  → original: copied`);

    return {
      size: 'original',
      path: outputPath,
      dimensions: null,
      url: `/images/processed/${outputFilename}`
    };
  }

  async addWatermark(inputPath, watermarkText, position = 'bottom-right') {
    log(`Adding watermark to ${path.basename(inputPath)}...`);

    const positions = {
      'bottom-right': { x: 'right-20', y: 'bottom-20' },
      'bottom-left': { x: 'left-20', y: 'bottom-20' },
      'center': { x: 'center', y: 'center' }
    };

    const outputFilename = `${path.parse(inputPath).name}_wm.jpg`;
    const outputPath = path.join(this.config.outputDir, outputFilename);

    return {
      path: outputPath,
      watermark: watermarkText,
      position: positions[position]
    };
  }

  async batchProcess(inputDir, options = {}) {
    const entries = await fs.promises.readdir(inputDir);
    const files = entries
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .map(f => path.join(inputDir, f));

    log(`Batch processing ${files.length} images...`);

    const results = [];
    for (const file of files) {
      try {
        const result = await this.optimize(file, options);
        results.push({ input: file, outputs: result });
      } catch (err) {
        console.error(`Failed to process ${file}:`, err.message);
      }
    }

    return results;
  }
}

module.exports = ImageProcessor;
