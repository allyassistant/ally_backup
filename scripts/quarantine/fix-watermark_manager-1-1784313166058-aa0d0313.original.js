#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Watermark Manager
 * Adds branded watermarks to diamond images
 */

class WatermarkManager {
  constructor(config = {}) {
    this.config = {
      defaultText: config.defaultText || '© Diamond Co.',
      fontSize: config.fontSize || 24,
      opacity: config.opacity || 0.5,
      color: config.color || '#FFFFFF'
    };
  }

  createWatermark(text, options = {}) {
    return {
      text: text || this.config.defaultText,
      fontSize: options.fontSize || this.config.fontSize,
      color: options.color || this.config.color,
      opacity: options.opacity || this.config.opacity,
      font: options.font || 'Arial',
      style: options.style || 'normal'
    };
  }

  getPositions() {
    return {
      'bottom-right': { x: 'calc(100% - 20px)', y: 'calc(100% - 20px)', anchor: 'end' },
      'bottom-left': { x: '20px', y: 'calc(100% - 20px)', anchor: 'start' },
      'top-right': { x: 'calc(100% - 20px)', y: '20px', anchor: 'end' },
      'top-left': { x: '20px', y: '20px', anchor: 'start' },
      'center': { x: '50%', y: '50%', anchor: 'middle' },
      'tile': { pattern: 'repeat', spacing: 100 }
    };
  }

  async apply(inputPath, watermark, position = 'bottom-right') {
    log(`Applying watermark to ${inputPath}...`);
    
    const positions = this.getPositions();
    const pos = positions[position];

    return {
      input: inputPath,
      watermark: this.createWatermark(watermark),
      position: pos,
      output: inputPath.replace(/\.([^\.]+)$/, '_wm.$1')
    };
  }

  generateLogoWatermark(logoPath, options = {}) {
    return {
      type: 'logo',
      source: logoPath,
      width: options.width || 100,
      height: options.height || 100,
      opacity: options.opacity || 0.3,
      position: options.position || 'bottom-right'
    };
  }
}

module.exports = WatermarkManager;
