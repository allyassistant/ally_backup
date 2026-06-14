#!/usr/bin/env node
/**
 * Simple Translation Utility
 * ===========================
 * Business-focused translation for diamond industry terms.
 * Supports batch translation with fallback to original text on error.
 *
 * Author:  Ally (2026-04-07)
 * Version: 1.0.0
 *
 * Usage:
 *   const Translator = require('./translator.js');
 *   const t = new Translator();
 *
 *   t.translate('in stock', 'zh-HK');        // '有貨'
 *   t.translate('out of stock', 'zh-CN');    // '缺货'
 *   t.translateBatch(['memo', 'rough diamond'], 'zh-HK');
 *     // ['寄賣', '原石']
 *
 * Supported Languages: zh-CN (Simplified), zh-HK (Traditional Cantonese)
 */

// ============================================================================
// CONFIG - Tunable constants
// ============================================================================
const CONFIG = {
  DEFAULT_LANGUAGE: 'zh-HK',
  SUPPORTED_LANGS: ['zh-CN', 'zh-HK'],
  MAX_TEXT_LENGTH: 10000,  // Max input length per translation (chars)
  MAX_BATCH_SIZE: 100,    // Max items per batch
};

class Translator {
  constructor(options = {}) {
    this.config = {
      defaultLang: options.defaultLang || CONFIG.DEFAULT_LANGUAGE,
      maxTextLength: options.maxTextLength || CONFIG.MAX_TEXT_LENGTH,
    };

    this.phrases = {
      'out of stock': { 'zh-CN': '缺货', 'zh-HK': '冇貨' },
      'in stock': { 'zh-CN': '現货', 'zh-HK': '有貨' },
      'memo': { 'zh-CN': '寄售', 'zh-HK': '寄賣' },
      'sight holder': { 'zh-CN': '看货商', 'zh-HK': '看貨商' },
      'rough diamond': { 'zh-CN': '毛坯钻石', 'zh-HK': '原石' },
      'polished diamond': { 'zh-CN': '抛光钻石', 'zh-HK': '打磨鑽石' },
      'carat weight': { 'zh-CN': '克拉重量', 'zh-HK': '卡數' },
      'table percentage': { 'zh-CN': '台面比例', 'zh-HK': '台面比例' },
      'depth percentage': { 'zh-CN': '深度比例', 'zh-HK': '深度比例' },
      'certificate': { 'zh-CN': '證书', 'zh-HK': '證書' }
    };
  }

  /**
   * Translate a single text string to target language.
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code (zh-CN or zh-HK)
   * @returns {string} Translated text (falls back to original on error)
   */
  translate(text, targetLang) {
    // Input validation with try-catch
    try {
      // Guard: null/undefined input
      if (text == null) {
        console.warn('[translator] Warning: null/undefined input, returning empty string');
        return '';
      }

      // Guard: text too long
      if (text.length > this.config.maxTextLength) {
        console.warn(`[translator] Warning: text exceeds ${this.config.maxTextLength} chars, truncating`);
        text = text.slice(0, this.config.maxTextLength);
      }

      // Guard: invalid language
      if (targetLang && !CONFIG.SUPPORTED_LANGS.includes(targetLang)) {
        console.warn(`[translator] Warning: unsupported lang '${targetLang}', using default`);
        targetLang = this.config.defaultLang;
      }

      const lang = targetLang || this.config.defaultLang;
      let result = String(text);

      for (const [phrase, translations] of Object.entries(this.phrases)) {
        const regex = new RegExp(phrase, 'gi');
        result = result.replace(regex, translations[lang] || phrase);
      }

      return result;
    } catch (e) {
      // Safe fallback: return original text on any error
      console.error(`[translator] Error during translation: ${e.message}`);
      return String(text);
    }
  }

  /**
   * Translate multiple texts in batch.
   * @param {string[]} texts - Array of texts to translate
   * @param {string} targetLang - Target language code
   * @returns {string[]} Array of translated texts
   */
  translateBatch(texts, targetLang) {
    try {
      // Guard: not an array
      if (!Array.isArray(texts)) {
        console.warn('[translator] Warning: texts is not an array, wrapping in array');
        texts = [texts];
      }

      // Guard: batch too large
      if (texts.length > CONFIG.MAX_BATCH_SIZE) {
        console.warn(`[translator] Warning: batch size ${texts.length} exceeds limit ${CONFIG.MAX_BATCH_SIZE}, truncating`);
        texts = texts.slice(0, CONFIG.MAX_BATCH_SIZE);
      }

      return texts.map(t => this.translate(t, targetLang));
    } catch (e) {
      // Safe fallback: return original array on error
      console.error(`[translator] Error during batch translation: ${e.message}`);
      return Array.isArray(texts) ? texts.map(t => String(t)) : [String(texts)];
    }
  }
}

// ============================================================================
// CLI Mode (for testing)
// ============================================================================
if (require.main === module) {
  const t = new Translator();

  const testTexts = [
    'in stock',
    'out of stock',
    'memo',
    'rough diamond certificate',
    null,
    '',
  ];

  console.log('=== Translator CLI Test ===');
  console.log(`Default lang: ${t.config.defaultLang}`);
  console.log('');

  for (const text of testTexts) {
    const zhHK = t.translate(text, 'zh-HK');
    const zhCN = t.translate(text, 'zh-CN');
    console.log(`"${text}" → zh-HK: "${zhHK}" | zh-CN: "${zhCN}"`);
  }

  console.log('');
  console.log('Batch test:');
  const batch = t.translateBatch(['in stock', 'memo', 'rough diamond'], 'zh-HK');
  console.log(`  Result: ${JSON.stringify(batch)}`);
}

module.exports = Translator;
