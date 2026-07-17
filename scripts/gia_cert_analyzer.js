#!/usr/bin/env node
/**
 * GIA Certificate Analyzer - Professional Grade
 * ================================================================
 * 分析 GIA 寶石證書,輸出專業報告(含 Score、Depth/Ratio 診斷)
 * 版本: 2.4.1 - 專業鑑定大師等級
 *
 * Features:
 * - AI Vision OCR-style extraction of GIA fields (via MiniMax VLM API)
 * - Logic Engine for red flag detection
 * - Score 評分系統 (0-100)
 * - Depth 光學診斷(針對形狀)
 * - Ratio 黃金比例評估
 * - Face-up Size 視覺大小評估
 * - 聯動風險檢測 (SI1 + Clouds not shown = Milky Risk)
 * - 專業版排版格式
 * - Discord Embed 發送
 *
 * 用法:
 *   node scripts/gia_cert_analyzer.js <image> [--json] [--report] [--send]
 *   node scripts/gia_cert_analyzer.js <image> [--md]          # Markdown 格式
 *
 * 參數:
 *   --json    輸出 JSON 格式
 *   --report  生成專業報告(含 Score、Depth/Ratio 診斷)
 *   --send    發送到 Discord (channel: 1473384999003619500)
 *   --md      輸出 Markdown 格式
 *
 * VERSION: 11.0.0
 * AUTHOR: Ally (2026-04-27)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

// ==================== PDF CONFIG ====================
const PDF_CONFIG = Object.freeze({
  command: 'pdftoppm',
  dpi: 200,
  format: 'png',
  pageRange: { first: 1, last: 1 },
  TIMEOUT_MS: 30000
});

// ==================== Config ====================
const HOME = process.env.HOME || require("os").homedir();
const AUTH_PROFILES = path.join(HOME, ".openclaw", "agents", "main", "agent", "auth-profiles.json");

// ============================================================================
// CONFIG - 專業報告設定
// ============================================================================

const CONFIG = Object.freeze({
  MODULE_VERSION: '11.0.0',
  VERSION_NOTES: 'v11.0.0: 5 new features - Knot Position Risk, Fancy Champagne Effect, Polish vs Graining distinction, Fish-eye carat multiplier, Setting Hazard Feather subdivision',

  // === v7.8.0: Girdle Penalty Multipliers by Carat ===
  GIRDLE_PENALTY: {
    // Carat < 2ct
    'very thin': 0, 'thin': 0, 'medium': 0,
    'slightly thick': 0, 'thick': -3,
    'very thick': -5, 'extremely thick': -10
  },
  GIRDLE_PENALTY_CARAT_MULT: {
    small: { min: 0, max: 2, mult: 1.0 },
    medium: { min: 2, max: 10, mult: 1.5 },
    large: { min: 10, max: 50, mult: 2.5 },
    xlarge: { min: 50, max: 999, mult: 4.0 }
  },
  // Fluorescence Synergy bonus (Low Color + Strong Blue)
  // Note: FLUOR_SYERGY is a typo in original code (should be SYNERGY) - kept for compatibility
  FLUOR_SYERGY_COLOR_MIN_INDEX: 8, // I color and lower
  FLUOR_SYERGY_BONUS: 5,

  // Embed colors
  COLORS: Object.freeze({
    STRONG_BUY: 0x00E000,     // 綠色 - 強烈推薦 (85+)
    BUY: 0x0099FF,             // 藍色 - 推薦 (70-84)
    CAUTION: 0xFFAA00,         // 黃色 - 注意 (50-69)
    CONDITIONAL: 0xFF6600,     // 橙色 - 謹慎 (30-49)
    REJECT: 0xE00000,          // 紅色 - 拒絕 (<30)
    DEFAULT: 0x888888          // 灰色 - 預設
  }),

  // Emoji map
  EMOJI: Object.freeze({
    GEM: '💎',
    APPROVE: '✅',
    CAUTION: '⚠️',
    CONDITIONAL: '❌',
    FLAG: '🚩',
    WARNING: '⚠️',
    CORE: '📊',
    OPTICAL: '📐',
    RISK: '🚩',
    RECOMMEND: '💰',
    MOVAL: '📐'    // v2.4.1 Moval flag
  }),

  // Display limits
  LIMITS: Object.freeze({
    MAX_FIELD_VALUE: 1024,
    MAX_EMBED_TOTAL: 5900
  }),

  // Discord Channel
  DISCORD_CHANNEL_ID: process.env.DISCORD_GIA_CHANNEL_ID || '1473383064565710929',

  // Timeout
  DISCORD_REQ_TIMEOUT: 15000,

  // === v8.4.0: Magic Numbers Standardization ===
  THRESHOLDS: Object.freeze({
    // Score boundaries (matching COLORS)
    SCORE_STRONG_BUY: 85,
    SCORE_BUY: 70,
    SCORE_CAUTION: 50,
    SCORE_CONDITIONAL: 30,
    
    // Depth/Ratio tolerances
    DEPTH_TOLERANCE: 0.5,      // ±0.5% for ideal
    RATIO_TOLERANCE: 0.05,     // ±0.05 for ratio
    
    // Carat thresholds
    CARAT_SMALL_MAX: 2,
    CARAT_MEDIUM_MAX: 10,
    CARAT_LARGE_MAX: 50,
    
    // Fluorescence synergy
    FLUOR_COLOR_INDEX_MIN: 8,  // I color and lower
    FLUOR_STRONG_MIN: 4,       // Strong blue and above
    
    // Girdle thickness
    GIRDLE_THICK_THRESHOLD: 0.04,  // mm
    GIRDLE_VERY_THICK_PENALTY: -5,
    GIRDLE_EXTREMELY_THICK_PENALTY: -10,
    
    // Haziness
    HAZE_SI1_INDEX: 18,        // SI1 clarity or lower
    HAZE_CLOUD_FLAG: 6,        // Cloud is primary inclusion
    HAZE_SCORE_PENALTY: -15,
    
    // Milky risk
    MILKY_CLARITY_MAX: 22,     // VS2 or lower
    MILKY_CLOUD_WEIGHT_MIN: 4, // Cloud weight >= 4
    MILKY_SCORE_PENALTY: -10,
    
    // Symmetry
    SYMMETRY_EXCELLENT: 5,
    SYMMETRY_VERY_GOOD: 4,
    SYMMETRY_GOOD: 3,

    // Cut grade penalties (Round diamonds)
    CUT_GOOD_PENALTY: -8,
    CUT_FAIR_PENALTY: -15,
    CUT_POOR_PENALTY: -20,

    // Polish/Sym penalty constants
    SYMMETRY_GOOD_PENALTY: -3,
    SYMMETRY_POOR_PENALTY: -5,
    POLISH_GOOD_PENALTY: -3,
    POLISH_POOR_PENALTY: -5,

    // Optical risk thresholds (depth %)
    NAILHEAD_DEPTH_MIN: 63.5,   // >63.5% = nail-head risk
    FISHEYE_DEPTH_MAX: 58.0,   // <58.0% = fish-eye risk

    // Date arithmetic
    DAYS_30: 30 * 24 * 60 * 60,
    DAYS_90: 90 * 24 * 60 * 60,
    DAYS_365: 365 * 24 * 60 * 60
  }),

  // === v8.6.0: Spread/Diameter Constants ===
  SPREAD_CONSTANTS: Object.freeze({
    DIAMETER_EXPONENT: 0.5,        // sqrt(carat) exponent
    DIAMETER_FACTOR: 6.45,         // Round diameter factor
    BRIOLLE_SPREAD_FACTOR: 22,     // Briolette spread index divisor
    STEP_CUT_COMPENSATION: 1.15,   // Step cut visual compensation
    SPREAD_COMPENSATION_MIN: 0.95, // No display threshold
    SPREAD_COMPENSATION_MAX: 1.05  // No display threshold
  })
});

// ============================================================================
// FANCY COLOR PIPELINE (v8.3.0 Refactored)
// ============================================================================

/**
 * v8.3.0: Fancy Color Corruption Patterns
 * 用於檢測腐敗/模糊的 Color 欄位值
 * @constant
 * @type {RegExp[]}
 */
/**
 * CORRUPT_PATTERNS: 腐敗/模糊的 Color 欄位值檢測
 * @constant
 * @type {RegExp[]}
 * @description 用於檢測 GIA Color 欄位腐敗情況：
 *   - "Fancy shapes" / "Fancy shape" → 形狀關鍵詞誤入顏色欄位
 *   - "Fancy" alone without intensity → 需要 intensity level
 *   - "like" alone → OCR 錯誤讀取
 */
const CORRUPT_PATTERNS = [
  /fancy\s+shapes?/i,           // "fancy shapes" / "fancy shape"
  /^FANCY$/i,                    // "Fancy" alone without intensity
  /^LIKE$/i                      // "like" alone - OCR error
];

/**
 * v8.4.0: Unified Fancy Color Intensity Keywords + Regex
 * 統一 Fancy Color intensity 驗證
 */
/**
 * v8.4.0: Fancy Color Intensity 驗證用的正則表達式
 * @constant
 * @type {RegExp}
 * @example FANCY_COLOR_INTENSITY_REGEX.test('Fancy Vivid') // true
 * @example FANCY_COLOR_INTENSITY_REGEX.test('Fancy') // false (no intensity)
 */
const FANCY_COLOR_INTENSITY_REGEX = /fancy\s+(light|intense|vivid|deep|dark|moderate|pure)/i;

/**
 * Fancy Color Pipeline - 統一的彩色鑽石解析流程
 * 
 * Phase 2a: 從 raw text 提取 Fancy Color
 * Phase 2b: 驗證顏色欄位是否腐敗
 * Phase 2c: 從 raw text 恢復腐敗的顏色
 * 
 * @param {string} text - GIA raw text
 * @param {string|null} rawColor - 從 extractField 得到的原始顏色欄位
 * @returns {Object} 包含 isCorrupted, recoveredColor, isFancy, fancyType, intensity, baseColor
 */
function parseFancyColorPipeline(text, rawColor) {
  // v8.5.0: Unified return object - fancyResult and fancyContext merged
  const result = {
    isCorrupted: false,
    recoveredColor: null,
    isFancy: false,
    fancyType: null,
    intensity: null,
    baseColor: 'FANCY'
  };

  // === Phase 2a: Extract Fancy Color ===
  const fancyFromText = extractFancyColor(text);
  if (fancyFromText.isFancy) {
    result.isFancy = true;
    result.fancyType = fancyFromText.fancyType;
    result.baseColor = fancyFromText.baseColor;
    // v8.5.0: Extract intensity using FANCY_COLOR_INTENSITY_REGEX
    const intensityMatch = fancyFromText.fancyType.match(FANCY_COLOR_INTENSITY_REGEX);
    if (intensityMatch) {
      result.intensity = intensityMatch[1].toLowerCase();
    }
  }

  // === Phase 2b: Validate Corruption ===
  if (rawColor) {
    // Check against corrupt patterns
    result.isCorrupted = CORRUPT_PATTERNS.some(p => p.test(rawColor));
  }

  // === Phase 2c: Recover Color if Corrupted ===
  if (result.isCorrupted) {
    const colorUpperRaw = rawColor.toUpperCase();

    if (colorUpperRaw === 'FANCY') {
      // v8.4.0: Use FANCY_COLOR_INTENSITY_REGEX for recovery
      const fancyIntensityMatch = text.match(FANCY_COLOR_INTENSITY_REGEX);
      if (fancyIntensityMatch) {
        result.recoveredColor = fancyIntensityMatch[0].trim();
      }
    } else {
      // Original recovery for "like" pattern
      const colorMatch = text.match(/color\s*grade[:\s]*([A-Z][-+]?\s*[A-Z]?)/i);
      if (colorMatch) {
        result.recoveredColor = colorMatch[1].trim();
      }
    }
  }

  return result;
}

// ============================================================================
// OPTICAL DIAGNOSIS CONSTANTS
// ============================================================================


/**
 * Depth ranges by shape (ideal percentages)
 * 用于光學診斷:判斷是否過淺(看穿效應)或過深(重量被隱藏)
 */
const DEPTH_RANGES = Object.freeze({
  'Round Brilliant': { min: 61, max: 62.5, ideal: 61.5 },
  'Radiant Cut': { min: 58, max: 68, ideal: 64 },
  'Emerald Cut': { min: 60, max: 70, ideal: 65 },
  // Note: Emerald ideal depth is 60-70%, 45% would be too shallow, not 65.7%
  'Oval Brilliant': { min: 58, max: 63, ideal: 60.5 },
  'Cushion': { min: 60, max: 68, ideal: 64 },
  'Cushion Modified Brilliant': { min: 60, max: 68, ideal: 64 },
  'Princess Cut': { min: 68, max: 75, ideal: 71.5 },
  'Marquise Brilliant': { min: 58, max: 62, ideal: 60 },
  'Pear Brilliant': { min: 55, max: 65, ideal: 60 },
  // 默認值
  'default': { min: 58, max: 68, ideal: 63 }
});

const TABLE_RANGES = Object.freeze({
  'Round Brilliant': { min: 54, max: 62, ideal: 57 },
  'Pear Brilliant': { min: 53, max: 63, ideal: 58 },
  'Emerald Cut': { min: 60, max: 69, ideal: 65 },
  'Cushion': { min: 55, max: 65, ideal: 60 },
  'Cushion Modified Brilliant': { min: 55, max: 65, ideal: 60 },
  'Oval': { min: 53, max: 63, ideal: 58 },
  'Princess': { min: 65, max: 75, ideal: 70 },
  'Asscher': { min: 57, max: 67, ideal: 62 },
  'Radiant': { min: 61, max: 69, ideal: 65 },
  'default': { min: 54, max: 68, ideal: 60 }
});

/**
 * Ratio ranges by shape (L/W ratio for fancy shapes)
 * 用於評估形狀比例是否理想
 */
const RATIO_RANGES = Object.freeze({
  'Round Brilliant': { min: 1.00, max: 1.02, ideal: 1.00 },
  'Pear Brilliant': { min: 1.40, max: 1.80, ideal: 1.55 },
  'Emerald Cut': { min: 1.30, max: 1.60, ideal: 1.45 },
  'Oval Brilliant': { min: 1.35, max: 1.50, ideal: 1.42 },
  'Cushion': { min: 1.00, max: 1.05, ideal: 1.02 },
  'Cushion Modified Brilliant': { min: 1.00, max: 1.05, ideal: 1.02 },
  'Princess Cut': { min: 1.00, max: 1.05, ideal: 1.00 },
  'Radiant Cut': { min: 1.10, max: 1.45, ideal: 1.25 },
  'Marquise Brilliant': { min: 1.85, max: 2.10, ideal: 1.95 },
  // 默認值
  'default': { min: 1.00, max: 2.00, ideal: 1.50 }
});

// ============================================================================
// FANCY CUT SPREAD EVALUATION CONSTANTS
// ============================================================================

/**
 * Fancy Depth Matrix (v7.6.1 - RTF Spec)
 * Shape-specific depth ranges for Fancy stones
 * Note: "Fancy Too Deep" = Fancy Ideal (different from regular stones)
 */
const FANCY_DEPTH_RANGES = Object.freeze({
  'Cushion': { min: 62, max: 76, ideal: 70.5 },
  'Cushion Modified Brilliant': { min: 62, max: 76, ideal: 70.5 },
  'Radiant Cut': { min: 62, max: 76, ideal: 71 },
  'Pear Brilliant': { min: 60, max: 72, ideal: 66 },
  'Oval Brilliant': { min: 60, max: 72, ideal: 66 },
  'Emerald Cut': { min: 65, max: 78, ideal: 72.5 }
});


/**
 * Fancy Table Ranges (RTF Spec)
 * All shapes: 55-68%, Ideal 58-63%
 */
const FANCY_TABLE_RANGES = Object.freeze({
  'default': { min: 55, max: 68, ideal: 60.5 },
  'Cushion': { min: 55, max: 68, ideal: 60.5 },
  'Cushion Modified Brilliant': { min: 55, max: 68, ideal: 60.5 },
  'Radiant Cut': { min: 55, max: 68, ideal: 60.5 },
  'Pear Brilliant': { min: 55, max: 68, ideal: 60.5 },
  'Oval Brilliant': { min: 55, max: 68, ideal: 60.5 },
  'Emerald Cut': { min: 55, max: 68, ideal: 60.5 }
});


/**
 * Fancy Color Modifiers (RTF Spec)
 */
const FANCY_COLOR_MODIFIER = Object.freeze({
  SATURATION_BONUS: 15,      // Fancy Vivid/Intense: +15
  GOOD_HUE_BONUS: 10,        // Purplish Pink, Greenish Blue: +10
  BAD_HUE_PENALTY: -20,      // Brownish, Grayish: -20
  TYPEIIA_BONUS: 8           // Type IIa: +8
});

/**
 * Rarity Rule (RTF Spec)
 * 10ct+ Fancy Intense: +35 bonus (even if depth > 76%)
 */
const FANCY_RARITY_RULE = Object.freeze({
  MIN_CARAT: 10,
  BONUS: 35
});

/**
 * v11.0.0: Champagne Effect (香檳效應)
 * 
 * Fancy Color + Intense/Vivid Saturation + Brownish 調 = 香檳效果
 * 呢種組合喺某些市場（亞洲）反而有正面價值
 * 
 * 注意:唔好直接扣大分,而係標註為特殊市場價值
 */
const CHAMPAGNE_EFFECT = Object.freeze({
  DETECT_COLOR: 'FANCY',
  SATURATION_INCLUSIVE: ['intense', 'vivid'],
  BROWNISH_MARKERS: ['brownish', 'brown', 'brn'],
  POSITIVE_LABEL: '💡 Champagne Effect (香檳效應)',
  DETAIL_TEMPLATE: 'Fancy {saturation} + Brownish 調 = 香檳色調,某些市場認為有價值'
});


/**
 * Fancy Depth Matrix (legacy - kept for FANCY_DEPTH_MATRIX backward refs)
 * @deprecated Use FANCY_DEPTH_RANGES instead
 */
const FANCY_DEPTH_MATRIX = Object.freeze({
  'Cushion': { depthMin: 62, depthMax: 76, tableMin: 55, tableMax: 68 },
  'Cushion Modified Brilliant': { depthMin: 62, depthMax: 76, tableMin: 55, tableMax: 68 },
  'Radiant Cut': { depthMin: 62, depthMax: 76, tableMin: 55, tableMax: 68 },
  'Pear Brilliant': { depthMin: 60, depthMax: 72, tableMin: 55, tableMax: 68 },
  'Oval Brilliant': { depthMin: 60, depthMax: 72, tableMin: 55, tableMax: 68 },
  'Emerald Cut': { depthMin: 65, depthMax: 78, tableMin: 55, tableMax: 68 }
});

/**
 * Shape Constants for Fancy Cut Spread Evaluation
 * 每克拉預期表面積 (mm2/ct)
 * 用於計算 Expected Area = constant × (carat ^ 0.66)
 */
const SHAPE_CONSTANTS = Object.freeze({
  'Emerald Cut': 45.0,           // 台面最大,顯大效果最好
  'Cushion Modified': 38.5,     // 角位容易漏光如果太深
  'Cushion Brilliant': 38.5,    // Cushion 變種
  'Oval Brilliant': 43.0,        // 接近圓鑽
  'Pear Brilliant': 41.5,        // 介乎兩者之間
  'Marquise Brilliant': 40.0,   // 馬眼形
  'Princess Cut': 42.0,           // 公主方
  'Radiant Cut': 41.0,            // 雷迪恩
  'Asscher Cut': 44.0,            // 阿斯徹
  'Heart Brilliant': 42.0         // 心形
});

// ============================================================================
// v5.0.0: FUZZY MATCHING ENGINE
// ============================================================================

/**
 * 模糊匹配函數 - 處理 OCR 拼寫錯誤
 * 例如:Clarity → Clerity, Knot → Knoat
 */
function fuzzyMatch(text, patterns) {
  const lowerText = text.toLowerCase();
  return patterns.some(pattern => {
    // Direct match
    if (lowerText.includes(pattern.toLowerCase())) return true;
    // Fuzzy match: use length-4 for long patterns (5+ chars) to avoid false positives
    // Short patterns (<=5) use 1-char offset (=3-char subseq), long patterns use 5-char subseq
    const minMatchLen = pattern.length > 5 ? 5 : 3;
    for (let i = 0; i < pattern.length - minMatchLen + 1; i++) {
      const substr = pattern.substring(i, i + minMatchLen);
      if (lowerText.includes(substr)) return true;
    }
    return false;
  });
}
// 極其關鍵的關鍵詞
const CRITICAL_PATTERNS = {
  knot: ['knot', 'knots'],
  laserDrillHole: ['laser drill', 'laser-drill', 'ldh', 'laser hole', 'laser drill hole'],
  fractureFilled: ['fracture filled', 'fracture-filled', 'glass filled', '錮鐵']
};


// ============================================================================
// OCR DATA SANITIZATION (v3.0.0)
// ============================================================================

// ============================================================================
// DATA NORMALIZATION (v3.1.0)
// ============================================================================

/**
 * 數據正規化 (Data Normalization)
 *
 * 確保所有關鍵字段格式統一,防止 OCR 微小格式錯誤導致邏輯失效
 * @param {Object} data - 證書數據
 * @param {Object} fancyContext - Fancy Color 上下文 (可選)
 */
function normalizeData(data, fancyContext) {
  if (!data) return {};

  const normalized = JSON.parse(JSON.stringify(data || {}));

  // Shape: 去除多餘空格,統一為 Title Case
  if (normalized.shape && typeof normalized.shape === 'string') {
    normalized.shape = normalized.shape.trim().replace(/\s+/g, ' ');
  }


  // Color: 去除多餘空格
  if (normalized.color && typeof normalized.color === 'string') {
    normalized.color = normalized.color.trim().replace(/\s+/g, ' ').toUpperCase();
    // v8.3.0: 形狀關鍵詞保護 - 這些詞永遠不應該是顏色
    const shapeKeywords = ['PEAR', 'ROUND', 'CUSHION', 'OVAL', 'PRINCESS', 'EMERALD', 'MARQUISE', 'RADIANT', 'HEART', 'ASSCHER', 'TRILLION', 'BAGUETTE', 'BRILLIANT'];
    const isLikelyShape = shapeKeywords.some(s => normalized.color === s);
    if (isLikelyShape) {
      normalized.color = 'UNKNOWN'; // 形狀關鍵詞出現在顏色欄位 = 腐敗
    }
  }

  // Clarity: 去除多餘空格
  if (normalized.clarity && typeof normalized.clarity === 'string') {
    normalized.clarity = normalized.clarity.trim().replace(/\s+/g, ' ');
  }

  // Polish: 統一格式
  if (normalized.polish && typeof normalized.polish === 'string') {
    normalized.polish = normalized.polish.trim().replace(/\s+/g, ' ').toLowerCase();
  }


  // Symmetry: 統一格式
  if (normalized.symmetry && typeof normalized.symmetry === 'string') {
    normalized.symmetry = normalized.symmetry.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Fluorescence: 統一格式
  if (normalized.fluorescence && typeof normalized.fluorescence === 'string') {
    normalized.fluorescence = normalized.fluorescence.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // 數值字段四捨五入到小數點後兩位(防止浮點數精度問題)
  const numericFields = ['carat', 'ratio', 'depthPct', 'tablePct', 'lengthMm', 'widthMm', 'depthMm'];
  numericFields.forEach(field => {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      const num = parseFloat(normalized[field]);
      if (!isNaN(num)) {
        normalized[field] = parseFloat(num.toFixed(2));
      }
    }
  });

  // Length/Width/Ratio 重新計算並四捨五入
  if (normalized.lengthMm && normalized.widthMm && !normalized.ratio) {
    normalized.ratio = parseFloat((normalized.lengthMm / normalized.widthMm).toFixed(2));
  }

  return normalized;
}

// ============================================================================
// OCR DATA SANITIZATION (v3.0.0)
// ============================================================================

/**
 * 數據清洗與正規化 (Data Sanitization)
 *
 * 處理 OCR 解析常見錯誤:
 * - '1' → 'I' (Color)
 * - '5' → 'S' (Symmetry/Polish)
 * - 不可見字元清理
 * - 空白清理
 */
function sanitizeData(data) {
  if (!data) return {};
  const clean = JSON.parse(JSON.stringify(data));
  // Color: '1' → 'I'
  if (clean.color && typeof clean.color === 'string') {
    clean.color = clean.color.replace(/1/g, 'I').trim();
  }
  // Symmetry: '5' → 'S'
  if (clean.symmetry && typeof clean.symmetry === 'string') {
    clean.symmetry = clean.symmetry.replace(/5/g, 'S').trim();
  }
  // Polish: 同樣問題
  if (clean.polish && typeof clean.polish === 'string') {
    clean.polish = clean.polish.replace(/5/g, 'S').trim();
  }
  // 清理所有字符串字段的不可見字元
  Object.keys(clean).forEach(key => {
    if (typeof clean[key] === 'string') {
      clean[key] = clean[key].replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    }
    if (Array.isArray(clean[key])) {
      clean[key] = clean[key].map(item => {
        if (typeof item === 'string') {
          return item.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
        }
        return item;
      });
    }
  });
  // 調用正規化
  return normalizeData(clean);
}

// ============================================================================
// OPTICAL DIAGNOSIS FUNCTIONS
// ============================================================================

/**
 * Oval Moval 檢測
 * 當 Oval Ratio > 1.65 時,觸發 Moval 警告
 * Moval = Marquise + Oval Hybrid,Bow-tie 效應極為明顯
 */
function evaluateOvalMoval(shape, ratio) {
  if (!shape || !ratio) return null;
  ratio = parseFloat(ratio);

  if (shape.toLowerCase().includes('oval')) {
    const ratioVal = parseFloat(ratio);
    if (!isNaN(ratioVal) && ratioVal > 1.65) {
      return {
        isMoval: true,
        emoji: '📐',
        label: 'Extreme Ratio: Likely Moval',
        severity: 'HIGH',
        detail: `Oval Ratio ${ratioVal} > 1.65,屬於 Moval (Marquise + Oval)。此類石頭 Bow-tie 效應極為明顯,中心可能出現黑洞效應`
      };
    }
  }
  return { isMoval: false };
}

/**
 * Oval Shape Aesthetics Score Constants
 * v8.4.0: Extracted magic numbers into named constants
 */
const OVAL_RATIO_GOLDEN_MIN = 1.40;
const OVAL_RATIO_GOLDEN_MAX = 1.45;
const OVAL_RATIO_ACCEPTABLE_MIN = 1.35;
const OVAL_RATIO_STRETCHED_MIN = 1.45;
const OVAL_RATIO_STRETCHED_MAX = 1.55;
const OVAL_RATIO_ROUND_THRESHOLD = 1.30;
const OVAL_RATIO_THIN_MIN = 1.55;
const OVAL_RATIO_THIN_MAX = 1.65;
const OVAL_RATIO_MOVAL_THRESHOLD = 1.65;
const OVAL_SCORE_GOLDEN = 5;
const OVAL_SCORE_ACCEPTABLE = 2;
const OVAL_SCORE_STRETCHED = 1;
const OVAL_SCORE_ROUND = -8;
const OVAL_SCORE_THIN = -5;
const OVAL_SCORE_MOVAL = -15;

/**
 * v8.1.0: Oval Shape Aesthetics Evaluation
 * 
 * 評估 Oval 形狀的美學比例，基於市場偏好的「啞鈴形」理論:
 * - 1.40-1.45 = Golden Zone (💎 啞鈴形理論核心)
 * - 1.35-1.40 = Acceptable
 * - 1.45-1.55 = Slightly Stretched
 * - < 1.30 = Too Round (⚠️)
 * - 1.55-1.65 = Slightly Thin
 * - > 1.65 = Extreme (MOVAL)
 *
 * @param {number} ratioVal - Oval L/W Ratio
 * @returns {Object} 評估結果 { score, emoji, label, detail }
 */
function evaluateOvalShapeAesthetics(ratioVal) {
  const r = parseFloat(ratioVal);
  if (isNaN(r)) return null;

  if (r >= OVAL_RATIO_GOLDEN_MIN && r <= OVAL_RATIO_GOLDEN_MAX) {
    return {
      score: OVAL_SCORE_GOLDEN,
      emoji: '💎',
      label: 'OVAL RATIO GOLDEN ZONE',
      detail: `Ratio ${r.toFixed(2)} 完美啞鈴形 (${OVAL_RATIO_GOLDEN_MIN}-${OVAL_RATIO_GOLDEN_MAX} Golden Zone)`
    };
  } else if (r >= OVAL_RATIO_ACCEPTABLE_MIN && r < OVAL_RATIO_GOLDEN_MIN) {
    return {
      score: OVAL_SCORE_ACCEPTABLE,
      emoji: '✅',
      label: 'OVAL RATIO ACCEPTABLE',
      detail: `Ratio ${r.toFixed(2)} 可接受 (${OVAL_RATIO_ACCEPTABLE_MIN}-${OVAL_RATIO_GOLDEN_MIN})`
    };
  } else if (r > OVAL_RATIO_STRETCHED_MIN && r <= OVAL_RATIO_STRETCHED_MAX) {
    return {
      score: OVAL_SCORE_STRETCHED,
      emoji: '⚡',
      label: 'OVAL RATIO SLIGHTLY STRETCHED',
      detail: `Ratio ${r.toFixed(2)} 輕微拉長 (${OVAL_RATIO_STRETCHED_MIN}-${OVAL_RATIO_STRETCHED_MAX})`
    };
  } else if (r < OVAL_RATIO_ROUND_THRESHOLD) {
    return {
      score: OVAL_SCORE_ROUND,
      emoji: '⚠️',
      label: 'OVAL TOO ROUND',
      detail: `Ratio ${r.toFixed(2)} < ${OVAL_RATIO_ROUND_THRESHOLD},石頭偏圓失去橢圓美感`
    };
  } else if (r > OVAL_RATIO_THIN_MIN && r <= OVAL_RATIO_THIN_MAX) {
    return {
      score: OVAL_SCORE_THIN,
      emoji: '⚠️',
      label: 'OVAL SLIGHTLY THIN',
      detail: `Ratio ${r.toFixed(2)} ${OVAL_RATIO_THIN_MIN}-${OVAL_RATIO_THIN_MAX},形狀偏薄`
    };
  } else if (r > OVAL_RATIO_MOVAL_THRESHOLD) {
    return {
      score: OVAL_SCORE_MOVAL,
      emoji: '🚩',
      label: 'OVAL EXTREME RATIO (MOVAL)',
      detail: `Ratio ${r.toFixed(2)} > ${OVAL_RATIO_MOVAL_THRESHOLD},屬於 Moval (Bow-tie 明顯)`
    };
  }
  return null;
}

/**
 * Square Modified Nailhead 檢測
 * 當 Square Modified Depth > 72% 時,觸發 Nailhead/Black Center 警告
 */
function checkSquareNailheadRisk(data, depthPct) {
  const shape = (data.shape || '').toLowerCase();


  if (!shape.includes('square') && !shape.includes('princess')) {
    return null;
  }

  const depthVal = parseFloat(depthPct);
  if (!isNaN(depthVal) && depthVal > 72) {
    return {
      hasRisk: true,
      severity: 'CRITICAL',
      label: '⚠️ Nailhead / Black Center',
      detail: `Square Modified Depth ${depthVal}% > 72%,中心光線全反射失敗,視覺上呈現黑色暗區(Nailhead Effect)`,
      scoreImpact: -20
    };
  }
  return { hasRisk: false };
}

/**
 * 評估 Fancy Cut 的克拉表面積 (Surface Area per Carat)
 *
 * 計算公式:
 * - Expected Area = shape_constant × (carat ^ 0.66)
 * - Spread Index = actual_area / expected_area
 *
 * @param {Object} data - 鑽石數據
 * @returns {Object|null} 評估結果
 */
function evaluateFancySpread(data) {
  const shape = data.shape || '';

  // 只適用於 Fancy Cut (非 Round Brilliant)
  if (shape.toLowerCase().includes('round')) {
    return null; // Round 用 Spread Factor
  }

  // 搵對應的 shape constant
  let shapeConstant = 40.0; // 預設值
  for (const [key, value] of Object.entries(SHAPE_CONSTANTS)) {
    if (shape.includes(key) || key.includes(shape)) {
      shapeConstant = value;
      break;
    }
  }

  const carat = parseFloat(data.carat);
  if (isNaN(carat) || carat <= 0) return null;

  // 嘗試獲取 measurements
  let length = null;
  let width = null;

  if (data.measurements && typeof data.measurements === 'object') {
    length = parseFloat(data.measurements.length);
    width = parseFloat(data.measurements.width);
  }

  // 如果冇 measurements,嘗試從 text 解析
  if (isNaN(length) || isNaN(width)) {
    return null; // 無法評估
  }

  const actualArea = length * width;
  const expectedArea = shapeConstant * Math.pow(carat, 0.66);
  const spreadIndex = actualArea / expectedArea;

  // 評估結果
  if (spreadIndex < 0.92) {
    return {
      status: 'very_deep',
      emoji: '📐',
      label: 'Very Deep Cut',
      detail: `表面積指數 ${(spreadIndex * 100).toFixed(0)}%,石頭睇起嚟比實際輕`,
      scoreImpact: -15,
      spreadIndex: spreadIndex
    };
  } else if (spreadIndex < 0.96) {
    return {
      status: 'deep',
      emoji: '📐',
      label: 'Deep Pavilion',
      detail: `表面積指數 ${(spreadIndex * 100).toFixed(0)}%,重量藏在深度`,
      scoreImpact: -8,
      spreadIndex: spreadIndex
    };
  } else if (spreadIndex > 1.05) {
    return {
      status: 'excellent',
      emoji: '✨',
      label: 'Excellent Spread',
      detail: `表面積指數 ${(spreadIndex * 100).toFixed(0)}%,視覺效果佳`,
      scoreImpact: 3,
      spreadIndex: spreadIndex
    };
  } else {
    return {
      status: 'normal',
      emoji: '✅',
      label: 'Normal Spread',
      detail: `表面積指數 ${(spreadIndex * 100).toFixed(0)}%`,
      scoreImpact: 0,
      spreadIndex: spreadIndex
    };
  }
}

/**
 * 評估 Depth 光學診斷
 * @param {number} depthPct - Depth 百分比
 * @param {string} shape - 鑽石形狀
 * @param {boolean} isFancyColor - 是否為 Fancy Color(v7.6.1 新增)
 * @returns {Object} 診斷結果 { status, emoji, label, detail }
 */
function evaluateDepth(depthPct, shape, isFancyColor) {
  // v7.6.1: Fancy stones use FANCY_DEPTH_MATRIX instead of regular DEPTH_RANGES
  let range;
  if (isFancyColor && FANCY_DEPTH_MATRIX[shape]) {
    const fancyRange = FANCY_DEPTH_MATRIX[shape];
    range = { min: fancyRange.depthMin, max: fancyRange.depthMax, ideal: (fancyRange.depthMin + fancyRange.depthMax) / 2 };
  } else {
    range = DEPTH_RANGES[shape] || DEPTH_RANGES['default'];
  }
  const depth = parseFloat(depthPct);

  if (isNaN(depth)) {
    return { status: 'unknown', emoji: '❓', label: 'N/A', detail: '無法計算 Depth' };
  }

  if (depth < range.min) {
    return {
      status: 'critical',
      emoji: '🔴',
      label: 'CRITICAL: Severe Windowing',
      detail: `Depth ${depth}% < 最低 ${range.min}% | 光線直接穿透,中心失去閃爍`
    };
  }

  if (depth > range.max) {
    return {
      status: 'critical',
      emoji: '🔴',
      label: 'CRITICAL: Too Deep',
      detail: `Depth ${depth}% > 最高 ${range.max}% | 視覺重量被隱藏,看起來比實際小`
    };
  }

  // 檢查是否在理想範圍 (±0.5)
  if (Math.abs(depth - range.ideal) <= 0.5) {
    return {
      status: 'ideal',
      emoji: '✅',
      label: 'Ideal Depth',
      detail: `Depth ${depth}% 完美 (理想值: ${range.ideal.toFixed(1)}%)`
    };
  }

  return {
    status: 'normal',
    emoji: '⚡',
    label: 'Normal Depth',
    detail: `Depth ${depth}% 正常 (範圍: ${range.min}-${range.max}%)`
  };
}

/**
 * v10.0.0: 階梯切工 Extinction 檢測
 * 
 * 階梯切工 (Emerald/Rectangular/Square) 的深度 > 65% 時
 * 會出現「黑洞效應」(Extinction)，光線被截斷而唔係反射
 * 
 * 觸發條件:
 * - shape 包含 "Emerald", "Rectangular", 或 "Square"
 * - depth > 65%
 * 
 * @param {number} depthPct - Depth 百分比
 * @param {string} shape - 鑽石形狀
 * @returns {Object|null} 檢測結果
 */
function checkStepCutExtinction(depthPct, shape) {
  const shapeLower = (shape || '').toLowerCase();
  
  // 檢查是否為階梯切工
  const isStepCut = /emerald|rectangular|square/i.test(shapeLower);
  if (!isStepCut) return null;
  
  const depth = parseFloat(depthPct);
  if (isNaN(depth) || depth <= 0) return null;
  
  // v10.0.0: Extinction threshold for step cuts = 65%
  if (depth > 65) {
    return {
      type: 'warning',
      label: '⚠️ High Extinction Area (階梯切工黑洞效應)',
      detail: `${shape} Depth ${depth}% > 65% = 光線被截斷而非反射,中心出現黑洞效應,火彩嚴重受損`,
      scoreImpact: -15,  // 扣分因為Extinction
      severity: 'HIGH',
      isExtinction: true
    };
  }
  
  return null;
}

/**
 * 評估 Fancy Stone (RTF Spec - v7.6.1)
 * Dedicated evaluation for Fancy colored stones using RTF spec parameters
 * Key difference from regular stones:
 * - "Fancy Too Deep" = Fancy Ideal (different from regular "Too Deep")
 * - "Fancy Ideal" range is wider and shape-specific
 *
 * @param {Object} parsed - Parsed certificate data
 * @returns {Object} { fancyScore, flags }
 */
function evaluateFancyStone(parsed) {
  const flags = [];
  let fancyScore = 80; // Base score for Fancy stones

  const shape = parsed.shape || '';
  const depthPct = parseFloat(parsed.depthPct);
  const tablePct = parseFloat(parsed.tablePct);
  const carat = parseFloat(parsed.carat);
  const colorUpper = (parsed.color || '').toUpperCase();
  const clarity = parsed.clarity || '';
  const comments = (parsed.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (parsed.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  // Get shape-specific depth range
  const shapeKey = Object.keys(FANCY_DEPTH_RANGES).find(k =>
    shape.toLowerCase().includes(k.toLowerCase())
  );
  const depthRange = shapeKey ? FANCY_DEPTH_RANGES[shapeKey] : null;

  // === Depth evaluation: Fancy Too Deep = Fancy Ideal ===
  if (depthRange && !isNaN(depthPct)) {
    if (depthPct >= depthRange.min && depthPct <= depthRange.max) {
      // In Fancy Ideal range: +10 and flag as OPTIMAL
      fancyScore += 10;
      flags.push({
        flag: '💎 OPTIMAL COLOR TRAP',
        detail: `Fancy Depth ${depthPct}% 完美 (範圍: ${depthRange.min}-${depthRange.max}%),顏色呈現最佳`
      });
    } else if (depthPct < depthRange.min) {
      // Too shallow: only penalize if < 60% (severe windowing for Fancy)
      if (depthPct < 60) {
        fancyScore -= 15;
        flags.push({
          flag: '⚠️ COLOR LEAKAGE RISK',
          detail: `Fancy Depth ${depthPct}% < 60% | 光線直接穿透,顏色流失`
        });
      }
      // Otherwise depth 60-62 range: normal (no penalty for Fancy)
    } else if (depthPct > depthRange.max) {
      // Check RARITY RULE: 10ct+ Fancy Intense/Vivid = +35 bonus (overrides depth penalty)
      const isFancyIntenseVivid = /fancy\s*(intense|vivid)/i.test(colorUpper);
      const isLargeCarat = !isNaN(carat) && carat >= FANCY_RARITY_RULE.MIN_CARAT;
      if (isFancyIntenseVivid && isLargeCarat) {
        fancyScore += FANCY_RARITY_RULE.BONUS;
        flags.push({
          flag: `💎 RARITY BONUS: +${FANCY_RARITY_RULE.BONUS}`,
          detail: `${carat.toFixed(2)}ct Fancy Intense/Vivid = 稀缺珍品,深度超標不受懲罰`
        });
      } else {
        // Normal case: penalize only if > 76% (too deep even for Fancy)
        if (depthPct > 76) {
          fancyScore -= 15;
          flags.push({
            flag: '⚠️ FANCY TOO DEEP',
            detail: `Fancy Depth ${depthPct}% > 76% | 重量藏在深度但無顏色補償`
          });
        }
      }
    }
  }

  // === Table evaluation: All Fancy shapes use 55-68% ===
  const tableRange = FANCY_TABLE_RANGES['default'];
  if (!isNaN(tablePct)) {
    if (tablePct >= tableRange.min && tablePct <= tableRange.max) {
      // Ideal table: small bonus
      const idealMid = (tableRange.min + tableRange.max) / 2;
      if (Math.abs(tablePct - idealMid) <= 3) {
        fancyScore += 3;
        flags.push({
          flag: '💎 Ideal Table',
          detail: `Fancy Table ${tablePct}% 接近理想 (${idealMid.toFixed(1)}%)`
        });
      }
    } else if (tablePct < tableRange.min) {
      fancyScore -= 8;
      flags.push({
        flag: '⚠️ Table Too Small',
        detail: `Table ${tablePct}% < ${tableRange.min}%`
      });
    } else {
      fancyScore -= 8;
      flags.push({
        flag: '⚠️ Table Too Large',
        detail: `Table ${tablePct}% > ${tableRange.max}%`
      });
    }
  }

  // === IF/VVS clarity bonus ===
  if (['IF', 'VVS1', 'VVS2'].includes(clarity)) {
    fancyScore += 5;
    flags.push({
      flag: '💎 High Clarity Bonus',
      detail: `${clarity} 淨度提升價值`
    });
  }

  // === Color modifiers (FANCY_COLOR_MODIFIER) ===
  // Saturation Bonus: Fancy Vivid/Intense = +15
  if (/fancy\s*(intense|vivid)/i.test(colorUpper)) {
    fancyScore += FANCY_COLOR_MODIFIER.SATURATION_BONUS;
    flags.push({
      flag: `💎 ${FANCY_COLOR_MODIFIER.SATURATION_BONUS}pts: Fancy Intense/Vivid`,
      detail: 'Fancy Vivid/Intense 顏色最濃郁'
    });
  }

  // Secondary Hue: Good = +10, Bad = -20
  // v11.0.0: Champagne Effect check (before Brownish penalty)
  const isFancyIntenseVivid = /fancy\s*(intense|vivid)/i.test(colorUpper);
  const hasBrownish = /brownish|brown|brn/i.test(combinedText);
  const hasGoodHue = /purplish pink|greenish blue|orangy pink|pinkish orange|blueish green/i.test(combinedText);
  
  if (isFancyIntenseVivid && hasBrownish) {
    // Champagne Effect - 某些市場認為有價值,唔直接扣大分
    flags.push({
      flag: CHAMPAGNE_EFFECT.POSITIVE_LABEL,
      detail: CHAMPAGNE_EFFECT.DETAIL_TEMPLATE.replace('{saturation}', colorUpper.match(/fancy\s*(intense|vivid)/i)[0])
    });
    // 僅給予警告而非大幅扣分 (-5 而非 -20)
    fancyScore -= 5;
    flags.push({
      flag: '⚠️ Brownish Tint: -5 (reduced from -20)',
      detail: 'Brownish + Fancy Intense/Vivid = 香檳效果,唔大幅扣分'
    });
    // P2 Fix: Good hue still applies even with Brownish
    if (hasGoodHue) {
      fancyScore += FANCY_COLOR_MODIFIER.GOOD_HUE_BONUS;
      flags.push({
        flag: `💎 ${FANCY_COLOR_MODIFIER.GOOD_HUE_BONUS}pts: Good Secondary Hue`,
        detail: '良好副色 (Purplish Pink/Greenish Blue) 市場價值提升'
      });
    }
  } else if (hasGoodHue) {
    // Good hue check (separated from brownish case)
    fancyScore += FANCY_COLOR_MODIFIER.GOOD_HUE_BONUS;
    flags.push({
      flag: `💎 ${FANCY_COLOR_MODIFIER.GOOD_HUE_BONUS}pts: Good Secondary Hue`,
      detail: '良好副色 (Purplish Pink/Greenish Blue) 市場價值提升'
    });
  } else if (/brownish|grayish/i.test(combinedText)) {
    fancyScore += FANCY_COLOR_MODIFIER.BAD_HUE_PENALTY;
    flags.push({
      flag: `🔴 ${FANCY_COLOR_MODIFIER.BAD_HUE_PENALTY}pts: Bad Secondary Hue`,
      detail: '不良副色 (Brownish/Grayish) 市場價值大幅下降'
    });
  }

  // Type IIa: +8
  if (/type\s*i?i?a/i.test(combinedText)) {
    fancyScore += FANCY_COLOR_MODIFIER.TYPEIIA_BONUS;
    flags.push({
      flag: `💎 ${FANCY_COLOR_MODIFIER.TYPEIIA_BONUS}pts: Type IIa`,
      detail: 'Type IIa 高純淨類型'
    });
  }

  return { fancyScore, flags };
}

/**
 * 評估 Ratio 黃金比例
 * @param {string|number} ratio - Ratio 值 (L/W)
 * @param {string} shape - 鑽石形狀
 * @returns {Object} 評估結果 { status, emoji, label, detail }
 */
function evaluateRatio(ratio, shape) {
  const ratioVal = parseFloat(ratio);

  if (isNaN(ratioVal)) {
    return { status: 'unknown', emoji: '❓', label: 'N/A', detail: '無法計算 Ratio' };
  }

  // === Round 專屬 Ratio 判斷 (v7.7.0 Fix) ===
  // Round 理想 ratio = 1.00, 1.00-1.01 = Ideal, >1.03 = Out of Round
  if (shape && shape.toLowerCase().includes('round')) {
    if (ratioVal <= 1.01) {
      return {
        status: 'ideal',
        emoji: '✅',
        label: 'Ideal Ratio',
        detail: `Round Ratio ${ratioVal} 完美 (1.00-1.01 理想範圍)`
      };
    } else if (ratioVal > 1.03) {
      return {
        status: 'poor',
        emoji: '❌',
        label: 'Out of Round',
        detail: `Round Ratio ${ratioVal} > 1.03,形狀偏橢圓,已唔係真正圓鑽`
      };
    } else {
      return {
        status: 'fair',
        emoji: '⚡',
        label: 'Fair Ratio',
        detail: `Round Ratio ${ratioVal} 正常但偏橢圓 (理想值: 1.00-1.01)`
      };
    }
  }

  // === Emerald Cut 特殊判斷 ===
  // Emerald 1.61 應該顯示為 Slender/Long 而唔係 Too Thick/Short
  if (shape && shape.toLowerCase().includes('emerald')) {
    const emeraldIdeal = 1.40;
    const emeraldMin = 1.30;
    const emeraldMax = 1.50;

    if (ratioVal > 1.55) {
      return {
        status: 'poor',
        emoji: '📐',
        label: 'Slender/Long',
        detail: `Ratio ${ratioVal} 偏長,1.61為長條形,側面看偏長
`
      };
    } else if (ratioVal > emeraldMax) {
      return {
        status: 'fair',
        emoji: '📐',
        label: 'Long',
        detail: `Ratio ${ratioVal} 偏長,經典比例推薦 ${emeraldMin}-${emeraldMax}`
      };
    } else if (ratioVal >= emeraldMin && ratioVal <= emeraldMax) {
      return {
        status: 'ideal',
        emoji: '📐',
        label: 'Ideal',
        detail: `Ratio ${ratioVal} 完美比例 (經典 ${emeraldIdeal})`
      };
    } else if (ratioVal < 1.25) {
      return {
        status: 'poor',
        emoji: '📐',
        label: 'Chubby/Squarish',
        detail: `Ratio ${ratioVal} 偏方/短,側面看偏短`
      };
    }
  }

  // === Heart 形狀特殊判斷 ===
  if (shape && shape.toLowerCase().includes('heart')) {
    // Heart 形狀理想 Ratio 約 1.00
    // Ratio < 1.00 = 闊/矮 (Wide/Squat)
    // Ratio > 1.00 = 長/瘦 (Long/Skinny)
    if (ratioVal < 0.90) {
      return { emoji: '📐', label: 'Wide/Squat', status: 'fair', detail: 'Heart 偏闊/矮,Ratio <0.90' };
    } else if (ratioVal <= 1.10) {
      return { emoji: '✅', label: 'Ideal', status: 'ideal', detail: 'Heart 比例理想' };
    } else {
      return { emoji: '📐', label: 'Long/Skinny', status: 'fair', detail: 'Heart 偏長/瘦,Ratio >1.10' };
    }
  }

  // === Marquise 形狀特殊判斷 ===
  if (shape && shape.toLowerCase().includes('marquise')) {
    // Marquise 理想 Ratio: 1.85-2.10
    // Ratio < 1.7 = Chubby/Short
    // Ratio > 2.2 = Slender/Long
    if (ratioVal < 1.70) {
      return { emoji: '📐', label: 'Chubby/Short', status: 'fair', detail: 'Marquise 偏短/闊' };
    } else if (ratioVal <= 2.20) {
      return { emoji: '✅', label: 'Ideal', status: 'ideal', detail: 'Marquise 標準比例' };
    } else {
      return { emoji: '📐', label: 'Slender/Long', status: 'fair', detail: 'Marquise 偏長/纖細' };
    }
  }

  // === Oval Moval 檢測 ===
  const movalResult = evaluateOvalMoval(shape, ratioVal);
  if (movalResult && movalResult.isMoval) {
    return {
      status: 'critical',
      emoji: movalResult.emoji,
      label: movalResult.label,
      detail: movalResult.detail
    };
  }

  // === Pear 形狀特殊判斷 ===
  if (shape && shape.toLowerCase().includes('pear')) {
    // Pear 理想 Ratio: 1.45-1.75
    // Ratio < 1.45 = Stubby (短粗)
    // Ratio > 1.75 = Elongated (偏長)
    if (ratioVal < 1.45) {
      return { emoji: '📐', label: 'Stubby', status: 'fair', detail: 'Pear 偏短粗' };
    } else if (ratioVal <= 1.75) {
      return { emoji: '✅', label: 'Ideal', status: 'ideal', detail: 'Pear 標準比例' };
    } else {
      return { emoji: '📐', label: 'Elongated', status: 'fair', detail: 'Pear 偏長/纖細' };
    }
  }

  // === Oval 形狀特殊判斷 (v8.1.0) ===
  // 使用新的 evaluateOvalShapeAesthetics 評估美學比例
  if (shape && shape.toLowerCase().includes('oval')) {
    const aestheticsResult = evaluateOvalShapeAesthetics(ratioVal);
    if (aestheticsResult) {
      return {
        status: aestheticsResult.score >= 5 ? 'excellent' : (aestheticsResult.score >= 2 ? 'ideal' : (aestheticsResult.score >= 0 ? 'fair' : 'warning')),
        emoji: aestheticsResult.emoji,
        label: aestheticsResult.label,
        detail: aestheticsResult.detail,
        score: aestheticsResult.score
      };
    }
  }

  // 通用判斷(非 Emerald/Heart/Marquise/Pear/Oval shapes)
  const range = RATIO_RANGES[shape] || RATIO_RANGES['default'];

  if (ratioVal < range.min) {
    return {
      status: 'warning',
      emoji: '⚠️',
      label: 'Too Thin/Stretched',
      detail: `Ratio ${ratioVal} < 最低 ${range.min} | 形狀過於拉長`
    };
  }

  if (ratioVal > range.max) {
    return {
      status: 'warning',
      emoji: '⚠️',
      label: 'Too Thick/Short',
      detail: `Ratio ${ratioVal} > 最高 ${range.max} | 形狀過於短寬`
    };
  }

  // 評價分級:Excellent (±0.05) > Ideal (±0.15) > Fair (min-max) > Poor
  if (Math.abs(ratioVal - range.ideal) <= 0.05) {
    return {
      status: 'excellent',
      emoji: '✅',
      label: 'Excellent Ratio',
      detail: `Ratio ${ratioVal} 完美 (±0.05,理想值: ${range.ideal})`
    };
  }
  if (Math.abs(ratioVal - range.ideal) <= 0.15) {
    return {
      status: 'ideal',
      emoji: '📐',
      label: 'Ideal Ratio',
      detail: `Ratio ${ratioVal} 理想 (±0.15,理想值: ${range.ideal})`
    };
  }
  if (ratioVal >= range.min && ratioVal <= range.max) {
    return {
      status: 'fair',
      emoji: '⚡',
      label: 'Fair Ratio',
      detail: `Ratio ${ratioVal} 正常 (範圍: ${range.min}-${range.max})`
    };
  }
  return {
    status: 'poor',
    emoji: '⚠️',
    label: 'Poor Ratio',
    detail: `Ratio ${ratioVal} 超出範圍 (理想值: ${range.ideal}, 範圍: ${range.min}-${range.max})`
  };
}

/**
 * 評估 Face-up Size 視覺大小
 * @param {number} carat - 克拉重量
 * @param {number} depthPct - Depth 百分比
 * @param {string} shape - 鑽石形狀
 * @returns {string|null} 警告訊息或 null
 */
function evaluateFaceUpSize(carat, depthPct, shape) {
  const targetDepth = DEPTH_RANGES[shape]?.ideal || 63;
  const depth = parseFloat(depthPct);

  if (isNaN(depth)) return null;

  const depthDeviation = depth - targetDepth;

  if (depthDeviation > 5) {
    return `⚠️ Face-up Size 偏小 (Depth ${depth}% > 理想值 ${targetDepth}%)`;
  } else if (depthDeviation > 2) {
    return `⚡ 視覺大小可能低於實際重量`;
  }
  return null;
}

/**
 * 評估 Spread Factor (顯大程度)
 * 計算公式:Spread Ratio = 平均直徑 / (sqrt(carat) * 6.45)
 *
 * 理想 1ct 圓鑽直徑 = 6.4-6.5mm
 * 如果直徑偏細,實際石頭可能只值較少克拉
 */
function evaluateSpreadFactor(data) {
  // 只適用於 Round Brilliant
  if (!data.shape || !data.shape.toLowerCase().includes('round')) {
    return null;
  }

  // 嘗試從 measurements 提取直徑
  let avgDiameter = null;

  if (data.measurements && typeof data.measurements === 'object') {
    // measurements 格式:{ length: x, width: y, depth: z }
    const length = parseFloat(data.measurements.length);
    const width = parseFloat(data.measurements.width);
    if (!isNaN(length) && !isNaN(width) && length > 0 && width > 0) {
      avgDiameter = (length + width) / 2;
    }
  }

  // 如果冇 measurements,嘗試從其他方式估算
  if (!avgDiameter) {
    return null; // 暫時未找到
  }

  const carat = parseFloat(data.carat);
  if (isNaN(carat) || carat <= 0) return null;

  // 計算 expected diameter:sqrt(carat) * DIAMETER_FACTOR
  const expectedDiameter = Math.pow(carat, CONFIG.SPREAD_CONSTANTS.DIAMETER_EXPONENT) * CONFIG.SPREAD_CONSTANTS.DIAMETER_FACTOR;
  const spreadRatio = avgDiameter / expectedDiameter;

  // 評估
  if (spreadRatio < 0.97) {
    return {
      status: 'small',
      emoji: '📐',
      label: 'Small Spread (顯小)',
      detail: `直徑 ${avgDiameter.toFixed(2)}mm 偏細,估計只值 ${(spreadRatio * carat).toFixed(2)}ct`,
      scoreImpact: -10,
      spreadRatio: spreadRatio
    };
  } else if (spreadRatio > 1.03) {
    return {
      status: 'excellent',
      emoji: '✨',
      label: 'Excellent Spread (顯大)',
      detail: `直徑 ${avgDiameter.toFixed(2)}mm 優於預期,視覺效果佳`,
      scoreImpact: 3,
      spreadRatio: spreadRatio
    };
  } else {
    return {
      status: 'normal',
      emoji: '✅',
      label: 'Normal Spread',
      detail: `直徑比例正常`,
      scoreImpact: 0,
      spreadRatio: spreadRatio
    };
  }
}

/**
 * 評估熒光導致既 Oily/Hazy Risk
 * D/E/F Color + Strong/Very Strong Blue Fluorescence = Oily Risk
 */
function evaluateFluorescenceOilyRisk(data) {
  const color = (data.color || '').toUpperCase();
  const fluor = (data.fluorescence || 'None').toUpperCase();
  const isBriolette = (data.shape || '').toLowerCase().includes('briolet');

  // v10.0.0: 螢光與色級「死亡組合」
  // D/E/F 色 + Strong/Very Strong 熒光 (任何顏色) = 高機率油光效應
  // P1 Fix: 合併重複 block，統一 isFatalCombo 標記
  const isHighColor = ['D', 'E', 'F'].includes(color);
  const isStrongFluor = /strong|very strong/i.test(fluor);
  const isFatalCombo = isHighColor && isStrongFluor && !isBriolette;
  
  if (isFatalCombo) {
    return {
      hasRisk: true,
      severity: 'HIGH',
      detail: `⚠️ 死亡組合: ${color} 色 + ${fluor} 熒光 = 高機率油光效應 (Oily/Hazy Risk)`,
      scoreImpact: -15,
      isBrioletteExempt: false,
      isFatalCombo: true
    };
  }

  // Briolette exemption: 3D facets break up hazy look, less concern for fluorescence
  // Reference: "For Briolette stones, Fluorescence is less of a concern than in Ovals/Emeralds"
  // D/E/F Color + Strong/Very Strong on Briolette = reduced penalty (3D facets partially break up hazy)
  if (isHighColor && isStrongFluor && isBriolette) {
    return {
      hasRisk: true,
      severity: 'MEDIUM',
      detail: `${color} Color + ${fluor} Fluorescence = Briolette 3D facets 分解油光效應,風險降低`,
      scoreImpact: -7,
      isBrioletteExempt: true,
      isFatalCombo: false
    };
  }

  // G/H/I Color + Very Strong = Medium Risk (reduced for Briolette)
  const isMediumColor = ['G', 'H', 'I'].includes(color);
  if (isMediumColor && isStrongFluor) {
    return {
      hasRisk: true,
      severity: isBriolette ? 'LOW' : 'MEDIUM',
      detail: isBriolette
        ? `${color} Color + ${fluor} Fluorescence = Briolette 分解朦朧外觀,風險降低`
        : `${color} Color + ${fluor} Fluorescence = 中等油光風險`,
      scoreImpact: Math.round(-8 * (isBriolette ? 0.5 : 1.0)),
      isBrioletteExempt: isBriolette
    };
  }

  return { hasRisk: false, scoreImpact: 0 };
}

function checkBGMTintRisk(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const colorField = (data.color || '').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols + ' ' + colorField;

  // v8.2.2: Build specific BGM flags array for explicit labeling
  const specificFlags = [];
  if (/brown|brn/i.test(combinedText)) specificFlags.push('❌ Brownish Tint Detected');
  if (/green|grn/i.test(combinedText) && !/greenish/i.test(combinedText)) specificFlags.push('❌ Greenish Tint Detected');
  if (/gray|gry/i.test(combinedText) && !/grayish/i.test(combinedText)) specificFlags.push('❌ Grayish Tint Detected');
  if (/milky|cloudy/i.test(combinedText)) specificFlags.push('❌ Oily/Cloudy Appearance');

  // CRITICAL: 致命的 BGM 陷阱 - 即使係 D 色,如果有 brown/green/gray tint,就極難交易
  if (/brown|green|gray|grey/i.test(combinedText)) {
    if (/faint brown|faint green|light brown|light green|medium brown|medium green/i.test(comments)) {
      return {
        type: 'critical',
        label: '❌ CRITICAL: BGM Risk (價值殺手)',
        detail: 'Comments 中發現 brown/green/gray tint,即使係高色石亦極難交易',
        scoreImpact: -25,
        severity: 'CRITICAL',
        specificFlags: specificFlags  // v8.2.2: Include specific BGM flags
      };
    }
  }

  // === v8.2.0: BGM Check - J/M Color Brownish/Greenish Tint Filter ===
  // J-M color + any Brownish/Greenish/Grayish tint in comments or color field = -15~-25 penalty
  const colorUpper = (data.color || '').toUpperCase().trim();
  const isLowColor = /^j$|^k$|^l$|^m$/i.test(colorUpper);
  const bgmKeywords = ['brown', 'faint brown', 'brownish', 'green', 'greenish', 'grayish', 'greyish'];
  const foundBGM = bgmKeywords.filter(kw => combinedText.includes(kw));
  if (isLowColor && foundBGM.length > 0) {
    return {
      type: 'high',
      label: '🔴 BGM Tint Risk (J-M 色 - 褐/綠色調)',
      detail: `J-M 色 (${colorUpper}) + 發現 ${foundBGM.join('/')} 色調,額外 -15~-25 分`,
      scoreImpact: -20,
      severity: 'HIGH',
      specificFlags: specificFlags  // v8.2.2: Include specific BGM flags
    };
  }

  // Milky risk - CRITICAL
  const hasMilky = comments.includes('milky') || comments.includes('milkyity');
  if (hasMilky) {
    return {
      type: 'critical',
      label: '❌ CRITICAL: Milky Risk (朦朧風險)',
      detail: '石頭帶朦朧,影響透明度',
      scoreImpact: -20,
      severity: 'CRITICAL',
      specificFlags: specificFlags  // v8.2.2: Include specific BGM flags
    };
  }

  return null;
}

/**
 * 檢測 Treated Diamond (處理鑽石) + Lab-Grown
 *
 * Key indicators:
 * - "Internal Laser Drilling" / "Laser Drill Hole"
 * - "HPHT Processed" (High Pressure High Temperature)
 * - "Color Treated"
 * - Lab-Grown inscriptions / Report numbers starting with "LG"
 * - Inscription mentions HPHT/Lab-Grown
 *
 * 這些係非天然鑽石,貿易商完全不接受
 */
function checkTreatmentRisk(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const inscription = (data.inscription || '').toLowerCase();
  const combinedText = `${comments} ${keyToSymbols} ${inscription}`;
  const reportNo = String(data.reportNumber || '').toUpperCase();

  // === Lab-Grown 檢測 (最高優先) ===
  if (/laboratory-grown|lab-grown|laboratory grown|lgd|cvd/i.test(combinedText) ||
      reportNo.startsWith('LG')) {
    return {
      type: 'critical',
      label: 'CRITICAL: Lab-Grown Diamond',
      detail: '實驗室培育鑽石,非天然,本系統專注天然鑽石評估',
      scoreImpact: -100,
      severity: 'CRITICAL'
    };
  }

  // === Laser Drill & HPHT & Color Treated ===
  // HPHT 但唔係 processed 的例外情況(HPHT 可能係實驗室培育標記)
  if (/laser drill|internal laser|color treated/i.test(combinedText)) {
    return {
      type: 'critical',
      label: 'CRITICAL: Treated Diamond',
      detail: '發人工處理痕跡 (雷射/HPHT/改色),貿易商不接受',
      scoreImpact: -100,
      severity: 'CRITICAL'
    };
  }


  // HPHT processed(明確已處理)
  if (/hpht\s*processed/i.test(combinedText)) {
    return {
      type: 'critical',
      label: 'CRITICAL: HPHT Processed Diamond',
      detail: 'HPHT 人工處理鑽石,貿易商不接受',
      scoreImpact: -100,
      severity: 'CRITICAL'
    };
  }

  // HPHT 作為 Lab-Grown 標記(非 processed 的情況)
  if (/hpht/i.test(combinedText) && !/hpht\s*processed/i.test(combinedText)) {
    if (/laboratory-grown|lab-grown|lgd|cvd/i.test(combinedText) || reportNo.startsWith('LG')) {
      return {
        type: 'critical',
        label: 'CRITICAL: Lab-Grown Diamond (HPHT)',
        detail: '實驗室培育鑽石 (HPHT method),非天然,本系統專注天然鑽石評估',
        scoreImpact: -100,
        severity: 'CRITICAL'
      };
    }
  }

  return null;
}

/**
 * 檢測結構性風險 (Structural Risk)
 *
 * Cavity (空孔), Chip (缺口), Knot (結晶核) = 設置時可能破裂
 * 呢啲係「老闆級」內含物,B2B 市場常被大額折扣
 */
function checkStructuralRisk(data) {
  if (!data.keyToSymbols || data.keyToSymbols.length === 0) {
    return null;
  }

  const firstSymbol = data.keyToSymbols[0].toLowerCase();
  const carat = parseFloat(data.carat) || 0;
  const clarity = data.clarity || '';

  // === Twinning Wisp Bonus in 3-5ct range ===
  // v7.7.0: Twinning Wisps in 3-5ct stones are more likely to be eye-clean
  if (carat >= 3.0 && carat <= 5.0 && /twinning|wisp/i.test(firstSymbol)) {
    return {
      type: 'info',
      label: '💎 Twinning Wisp Bonus (3-5ct Eye-Clean Likelihood)',
      detail: `${carat.toFixed(2)}ct + Twinning Wisp 在 3-5ct 範圍內更容易 Eye-Clean,實物可能更好`,
      scoreImpact: 5,
      severity: 'INFO'
    };
  }

  // === Knot = 最高風險 (CRITICAL) ===
  if (/knot/i.test(firstSymbol)) {
    // v7.7.0: Knot + VS2 = CRITICAL structural safety warning
    const isVS2 = clarity === 'VS2';
    return {
      type: 'critical',
      label: isVS2 ? 'CRITICAL: Knot Risk + VS2 (結構安全)' : 'CRITICAL: Knot Risk (最高風險)',
      detail: isVS2
        ? 'Knot (結晶核) + VS2 = 即使淨度尚可,結構安全問題仍然存在,強烈建議拒絕'
        : 'Knot (結晶核) 係最高風險,係寶石內部的另一顆鑽石晶體,導電/導熱異常,鑲嵌時可能破裂',
      scoreImpact: -35,
      severity: 'CRITICAL'
    };
  }

  // === Chip = 高風險 ===
  if (/chip/i.test(firstSymbol)) {
    return {
      type: 'critical',
      label: 'CRITICAL: Chip Risk',
      detail: 'Chip (缺口) 位於表面,鑲嵌時極易破裂',
      scoreImpact: -30,
      severity: 'HIGH'
    };
  }

  // === Cavity = 高風險 ===
  if (/cavity/i.test(firstSymbol)) {
    // v7.7.0: Cavity + VS2 = CRITICAL structural safety warning
    const isVS2 = clarity === 'VS2';
    return {
      type: 'critical',
      label: isVS2 ? 'CRITICAL: Cavity Risk + VS2 (結構安全)' : 'CRITICAL: Cavity Risk',
      detail: isVS2
        ? 'Cavity (空孔) + VS2 = 即使淨度尚可,結構安全問題仍然存在,設置時可能破裂'
        : 'Cavity (空孔) 位於表面,設置時可能破裂',
      scoreImpact: -25,
      severity: 'HIGH'
    };
  }

  // === Etch Channel = 高風險 ===
  if (/etch channel/i.test(firstSymbol)) {
    return {
      type: 'critical',
      label: 'CRITICAL: Etch Channel Risk',
      detail: 'Etch Channel (蝕刻通道) 係外力導致的結構弱點,設置時可能破裂',
      scoreImpact: -25,
      severity: 'HIGH'
    };
  }

  return null;
}

/**
 * v10.0.0: Setting Hazard (鑲嵌風險) 檢測
 * 
 * 特定形狀 (Pear/Marquise/Oval) 的尖端位置有 Cavity/Feather/Knot 時
 * 鑲嵌過程中極易破裂，需要特別注意
 * 
 * 觸發條件:
 * - shape 包含 "Pear", "Marquise", 或 "Oval"
 * - inclusion type 包含 "Cavity", "Feather", 或 "Knot"
 * - location 接近尖端 (Point)
 * 
 * @param {Object} data - GIA 證書數據
 * @returns {Object|null} 檢測結果
 */
function checkSettingHazard(data) {
  const shape = (data.shape || '').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  
  // 檢查形狀是否為高風險類型
  const isHighRiskShape = /pear|marquise|oval/i.test(shape);
  if (!isHighRiskShape) return null;
  
  // 檢查是否有高風險 inclusion types
  const hasHighRiskInclusion = /cavity|feather|knot/i.test(keyToSymbols);
  if (!hasHighRiskInclusion) return null;
  
  // 檢查位置是否接近尖端 (Point)
  const locationKeywords = ['point', 'tip', 'end', 'girdle edge', 'near girdle', 'at the point', 'on the point'];
  const commentsLower = comments.toLowerCase();
  const keyToSymbolsLower = keyToSymbols.toLowerCase();
  const combinedText = commentsLower + ' ' + keyToSymbolsLower;
  
  const nearPoint = locationKeywords.some(kw => combinedText.includes(kw));
  
  // === v11.0.0: Feather at Point 比 Pinpoint 更危險 ===
  // Feather = 羽裂,沿著解理面的裂縫,喺尖端位置更容易擴展
  // Pinpoint = 小圓點,相對穩定
  const firstSymbol = keyToSymbolsLower.split(',')[0].trim();
  const isFeatherAtPoint = /feather/i.test(firstSymbol) && nearPoint;
  const isPinpointAtPoint = /pinpoint/i.test(firstSymbol) && nearPoint;
  
  if (isFeatherAtPoint) {
    return {
      type: 'critical',
      label: '⚠️ SETTING CRITICAL ( Feather 尖端裂開風險)',
      detail: `${shape} 形狀 + 尖端位置含 Feather = 羽裂喺尖端應力集中,鑲嵌撞擊易沿解理面裂開,比 Pinpoint 更危險`,
      scoreImpact: -30,  // 比 Pinpoint 的 -20 更嚴重
      severity: 'CRITICAL',
      isSettingHazard: true,
      isFeatherCritical: true
    };
  }
  
  if (nearPoint) {
    // 確定了 Setting Hazard - 尖端位置有高風險內含物 (非 Feather)
    return {
      type: 'warning',
      label: '⚠️ SETTING RISK (鑲嵌風險:尖端位置)',
      detail: `${shape} 形狀 + 尖端位置含 Cavity/Feather/Knot = 鑲嵌時極易破裂,強烈建議避開或告知客戶需特別護理`,
      scoreImpact: -10,
      severity: 'HIGH',
      isSettingHazard: true
    };
  }
  
  // 沒有明確的尖端位置標記，但仍有可能風險
  if (/feather|cavity|knot/i.test(firstSymbol)) {
    const hasPositionInfo = /girdle|side|edge|surface/i.test(combinedText);
    if (hasPositionInfo && /point|tip|end/i.test(combinedText)) {
      return {
        type: 'warning',
        label: '⚠️ SETTING RISK (鑲嵌風險:邊緣位置)',
        detail: `${shape} 形狀 + 邊緣位置含 Feather/Cavity/Knot = 鑲嵌時需特別小心,避免撞擊尖端`,
        scoreImpact: -8,
        severity: 'MEDIUM',
        isSettingHazard: true
      };
    }
  }
  
  return null;
}

/**
 * 檢測 Girdle Dead Weight Risk (腰崖過厚風險)
 *
 * Extremely thick girdle = 石頭既重量被腰崖吸收
 * 視覺上唔會變大,但實際重量增加 = 不劃算
 *
 * GIA 通常寫:extremely thick, very thick to extremely thick
 */
function checkGirdleDeadWeightRisk(data) {
  const girdle = (data.girdle || '').toLowerCase();

  if (!girdle) return null;

  // Check for extremely thick girdle
  if (girdle.includes('extremely thick')) {
    return {
      type: 'warning',
      label: 'Girdle Dead Weight Risk (極厚腰崖)',
      detail: '腰崖 extremely thick,部分重量被腰崖吸收,視覺上唔會變大',
      scoreImpact: -15,
      severity: 'HIGH'
    };
  }

  // Check for very thick girdle
  if (girdle.includes('very thick') || girdle.includes('thick to very thick')) {
    return {
      type: 'warning',
      label: 'Girdle Thickness Warning (厚腰崖)',
      detail: '腰崖 very thick,可能影響視覺大小比例',
      scoreImpact: -8,
      severity: 'MEDIUM'
    };
  }


  return null;
}

/**
 * v11.0.0: Knot Position Risk (結構性位置風險)
 * 
 * Pear/Marquise 形狀的尖端位置有 Knot 係最危險的組合:
 * - 尖端位置係應力集中點
 * - Knot 係另一顆鑽石晶體,兩者膨脹係數不同
 * - 鑲嵌時撞擊會導致裂開
 * 
 * 觸發條件:
 * - shape = "Pear" 或 "Marquise"
 * - inclusion type 包含 "Knot"
 * - location = "Point" 或 "Edge" 或 "Girdle"
 * 
 * @param {Object} data - GIA 證書數據
 * @returns {Object|null} 檢測結果
 */
function checkKnotPositionRisk(data) {
  const shape = (data.shape || '').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  
  // 只適用於 Pear/Marquise
  const isTargetShape = /pear|marquise/i.test(shape);
  if (!isTargetShape) return null;
  
  // 檢查是否有 Knot
  const hasKnot = /knot/i.test(keyToSymbols);
  if (!hasKnot) return null;
  
  // 檢查位置是否在 Point/Edge/Girdle
  const dangerLocations = ['point', 'girdle', 'edge', 'end', 'tip', 'near girdle', 'at the point', 'on the point'];
  const combinedText = comments + ' ' + keyToSymbols;
  const atDangerLocation = dangerLocations.some(loc => combinedText.includes(loc));
  
  if (atDangerLocation) {
    return {
      type: 'critical',
      label: '⚠️ CRITICAL STRUCTURE RISK (尖端 Knot 位置風險)',
      detail: `${shape} 形狀 + 尖端/邊緣位置含 Knot = 膨脹係數不同,鑲嵌時極易沿尖端裂開,最高結構風險`,
      scoreImpact: -50,  // 扣 50 分 (比普通 Knot 的 -35 更嚴重)
      severity: 'CRITICAL',
      isKnotPositionRisk: true
    };
  }
  
  return null;
}

/**
 * 檢測 Girdle Hidden Weight Risk (腰崖隱藏重量風險)
 *
 * Extremely Thick = 可能藏 0.05-0.10ct 額外重量
 * 比 checkGirdleDeadWeightRisk 更 aggressive(用於 v2.6.0)
 */
function checkGirdleHiddenWeight(data) {
  const girdle = (data.girdle || '').toLowerCase();

  if (!girdle) return null;

  // Extremely Thick = 隱藏重量
  if (girdle.includes('extremely thick')) {
    return {
      type: 'warning',
      label: 'Girdle Hidden Weight (隱藏重量)',
      detail: 'Extremely Thick 腰崖可能藏 0.05-0.10ct 額外重量,視覺上唔會變大',
      scoreImpact: -12,
      severity: 'MEDIUM'
    };
  }

  // Very thick to extremely thick 或 thick to very thick = 重腰
  if (girdle.includes('very thick to extremely thick') || girdle.includes('thick to very thick')) {
    return {
      type: 'warning',
      label: 'Girdle Heavy Weight',
      detail: '腰崖偏厚,部分重量被腰崖吸收',
      scoreImpact: -8,
      severity: 'LOW'
    };
  }

  return null;
}

/**
 * 檢測 Symmetry Specifics (即使 3EX 都扣分)
 *
 * v2.6.0 新增:即使拋光/對稱都係 Excellent,仍可能因特定
 * 幾何問題而影響光學性能
 */
function checkSymmetrySpecifics(data) {
  const comments = (Array.isArray(data.comments) ? data.comments.join(' ') : (data.comments || '')).toLowerCase();

  // Off-center Culet(基線偏移)
  if (comments.includes('off-center culet')) {
    return {
      type: 'warning',
      label: 'Off-center Culet (基線偏移)',
      detail: '即使 3EX,基線偏移仍影響火彩均勻性',
      scoreImpact: -10,
      severity: 'MEDIUM'
    };
  }

  // Wavy Girdle(波浪腰)
  if (comments.includes('wavy girdle')) {
    return {
      type: 'warning',
      label: 'Wavy Girdle (波浪腰)',
      detail: '即使 3EX,波浪腰仍影響光學性能',
      scoreImpact: -12,
      severity: 'MEDIUM'
    };
  }

  // Good Symmetry 但有額外 finish 問題
  if (data.symmetry === 'Good' && comments.match(/girdle|culet|polish/i)) {
    return {
      type: 'info',
      label: 'Symmetry 細節注意',
      detail: 'Good Symmetry + Comments 有 finish 問題,需注意',
      scoreImpact: -3,
      severity: 'LOW'
    };
  }

  return null;
}

/**
 * v10.0.0: Hidden Polish Issue 細分檢測
 * 
 * 根據 inclusion type 細分處理方式:
 * - "Surface Graining" 或 " graining " → 原生屬性 (不扣分)
 * - "Burn Mark" 或 " polish marks " → 拋光問題，可二次加工 (輕微扣分)
 *
 * @param {Object} data - GIA 證書數據
 * @returns {Object|null} 檢測結果
 */
function checkHiddenPolishSubdivision(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();

  // v11.0.0: 原生生長紋 vs 拋光問題區分
  // "surface graining is not shown" 或 " surface graining " (前後有空格) → 原生生長紋 (不扣分)
  const hasGrainingNotShown = /surface graining is not shown|internal graining is not shown|graining.*not shown/i.test(comments);
  const hasSurfaceGraining = / surface graining /i.test(' ' + comments + ' '); // 精確匹配 " surface graining " (前後有空格)
  
  // v10.0.0: 檢查是否有 polish marks / burn mark (需要輕微扣分)
  const hasPolishMarks = /burn mark|polish marks|polish line/i.test(comments);
  
  // 檢查 polish/symmetry 聲稱是好的
  const hasGoodPolish = polish === 'excellent' || polish === 'very good';
  const hasGoodSym = symmetry === 'excellent' || symmetry === 'very good';

  // === Burn Mark / Polish Marks → 拋光問題，可二次加工 ===
  if (hasPolishMarks && hasGoodPolish) {
    return {
      type: 'warning',
      label: '⚠️ Polish Issue: Burn Mark (可二次加工)',
      detail: '發現 Burn Mark/Polish Marks = 拋光問題,可通過重新拋光修復,輕微扣分',
      scoreImpact: -5,  // 輕微扣分 (可修復)
      severity: 'LOW',
      isNativeAttribute: false,
      canRePolish: true
    };
  }

  // v11.0.0: === Surface Graining "is not shown" 或 " surface graining " → 原生屬性 (不扣分) ===
  if ((hasGrainingNotShown || hasSurfaceGraining) && hasGoodPolish) {
    if (hasSurfaceGraining || /surface graining/i.test(comments)) {
      return {
        type: 'info',
        label: 'ℹ️ 原生屬性: Surface Graining (不影響評分)',
        detail: 'Surface Graining = 晶體生長的自然特徵,唔扣分',
        scoreImpact: 0,  // 不扣分
        severity: 'INFO',
        isNativeAttribute: true,
        canRePolish: false
      };
    }
    
    // 通用 graining (內部紋理) - 也係原生屬性
    return {
      type: 'info',
      label: 'ℹ️ 原生屬性: Internal Graining (不影響評分)',
      detail: 'Internal Graining = 生長過程中的原生特徵,不扣分',
      scoreImpact: 0,  // 不扣分
      severity: 'INFO',
      isNativeAttribute: true,
      canRePolish: false
    };
  }

  // === Hidden Symmetry Issue (波紋感) ===
  if (hasGrainingNotShown && hasGoodSym) {
    return {
      type: 'warning',
      label: '⚠️ Hidden Symmetry Issue (波紋感)',
      detail: 'Symmetry 聲稱 Excellent 但 Internal graining is not shown,可能有波紋感',
      scoreImpact: -10,
      severity: 'MEDIUM'
    };
  }

  return null;
}

/**
 * 檢測隱藏的對稱問題 (Hidden Symmetry Risk) - Legacy wrapper
 * @deprecated Use checkHiddenPolishSubdivision() instead
 */
function checkHiddenSymmetryRisk(data) {
  // v10.0.0: Delegate to new subdivision function
  const result = checkHiddenPolishSubdivision(data);
  if (result) return result;
  
  // Fallback to original logic for non-polish related issues
  const comments = (data.comments || []).join(' ').toLowerCase();
  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();

  const hasGrainingNotShown = /surface graining is not shown|internal graining is not shown|graining.*not shown/i.test(comments);
  const hasPolishMarks = /burn mark|polish marks|polish line/i.test(comments);
  const hasGoodPolish = polish === 'excellent' || polish === 'very good';
  const hasGoodSym = symmetry === 'excellent' || symmetry === 'very good';

  if (hasPolishMarks && hasGoodPolish) {
    return {
      type: 'warning',
      label: '⚠️ Polish Issue: Burn Mark',
      detail: '發現 Burn Mark/Polish Marks = 拋光問題,可通過重新拋光修復',
      scoreImpact: -5,
      severity: 'LOW'
    };
  }

  if (hasGrainingNotShown && hasGoodPolish) {
    return {
      type: 'info',
      label: 'ℹ️ Native Attribute: Graining (no penalty)',
      detail: 'Graining = 原生屬性,不扣分',
      scoreImpact: 0,
      severity: 'INFO'
    };
  }

  if (hasGrainingNotShown && hasGoodSym) {
    return {
      type: 'warning',
      label: '⚠️ Hidden Symmetry Issue (波紋感)',
      detail: 'Symmetry 聲稱 Excellent 但 Internal graining is not shown,可能有波紋感',
      scoreImpact: -10,
      severity: 'MEDIUM'
    };
  }

  return null;
}

/**
 * 檢測 Eye-Clean Risk (淨度位置風險)
 *
 * v2.6.0 新增:評估 SI 淨度石頭的內含物位置風險
 * SI1/SI2 淨度石頭,某些位置的內含物可能肉眼可見
 */
function checkEyeCleanRisk(data) {
  const clarity = data.clarity || '';
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (Array.isArray(data.comments) ? data.comments.join(' ') : (data.comments || '')).toLowerCase();

  // 僅適用於 SI 淨度
  if (!['SI1', 'SI2'].includes(clarity)) return null;

  // 檢查首位瑕疵類型 (v3.0.0 Twinning Wisps 補償)
  const firstSymbol = keyToSymbols.split(',')[0].trim();
  const isFirstTwinning = firstSymbol.includes('twinning') || firstSymbol.includes('twin');

  // Twinning Wisps = 通常係 eye-clean 的好石 (v3.0.0)
  if (clarity === 'SI1' && isFirstTwinning) {
    return {
      type: 'info',
      label: '💎 Twinning Wisps Bonus (雙晶紋補償)',
      detail: 'SI1 + Twinning Wisps 通常 eye-clean,實物可能更好',
      scoreImpact: 3,
      severity: 'INFO'
    };
  }

  // SI1 + Crystal in Table = REJECT 等效
  if (clarity === 'SI1' &&
      (keyToSymbols.includes('crystal') || comments.includes('table'))) {
    return {
      type: 'warning',
      label: '⚠️ Eye-Clean Risk: Table Inclusion',
      detail: 'SI1 淨度 + Table 位置有 Crystal,肉眼可見',
      scoreImpact: -20,
      severity: 'HIGH'
    };
  }

  // SI1 + Feather in Girdle = CAUTION
  if (clarity === 'SI1' &&
      (keyToSymbols.includes('feather') || comments.includes('girdle'))) {
    return {
      type: 'warning',
      label: '⚠️ Eye-Clean Risk: Girdle Feather',
      detail: 'SI1 + Girdle 位置有 Feather,設置時需小心',
      scoreImpact: -10,
      severity: 'MEDIUM'
    };
  }

  // SI2 + 任何明顯內含物
  if (clarity === 'SI2' && keyToSymbols.match(/crystal|feather|cloud/i)) {
    return {
      type: 'warning',
      label: '⚠️ Eye-Clean Risk: SI2 Visible',
      detail: 'SI2 淨度通常肉眼可見,購買前需親眼確認',
      scoreImpact: -8,
      severity: 'LOW'
    };
  }

  return null;
}

/**
 * 檢測 Origin Premium (產地溢價)
 *
 * v2.6.0 新增:評估鑽石產地的市場溢價或制裁風險
 * 某些產地有品牌溢價,某些產地受制裁影響
 */
function checkOriginPremium(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();

  // Botswana 產地(De Beers 礦區)
  if (comments.includes('botswana')) {
    return {
      type: 'info',
      label: 'Origin Premium: Botswana (非洲之星)',
      detail: 'Botswana 產地,De Beers 礦區,市場溢價 2-5%',
      scoreImpact: 8,
      severity: 'INFO'
    };
  }

  // Canada 產地(無衝突證書)
  if (comments.includes('canada') || comments.includes('canadian')) {
    return {
      type: 'info',
      label: 'Origin Premium: Canada (楓葉國)',
      detail: 'Canada 產地,無衝突證書,市場溢價 3-7%',
      scoreImpact: 10,
      severity: 'INFO'
    };
  }

  // Russia 產地(受制裁影響)
  if (comments.includes('russia') || comments.includes('russian')) {
    return {
      type: 'warning',
      label: 'Origin Warning: Russia (受制裁)',
      detail: '俄羅斯產地,受制裁影響,某些市場可能拒絕',
      scoreImpact: -5,
      severity: 'MEDIUM'
    };
  }

  return null;
}

/**
 * 提取 Fancy Color (處理 Fancy Yellow / Fancy Vivid Pink 等)
 */
function extractFancyColor(text) {
  // v8.4.0: Add null check + use unified FANCY_COLOR_INTENSITY_REGEX
  if (!text || typeof text !== 'string') {
    return { isFancy: false };
  }
  // v8.3.0: Strict Fancy Color validation
  // Fancy Color 必須包含明確 intensity level，否則視為腐敗/非 Fancy
  const fancyMatch = text.match(/(Fancy\s+[A-Za-z\s]+)/i);
  if (fancyMatch) {
    const fancyType = fancyMatch[1].trim();
    // Data integrity: only accept if "Fancy" is clearly present
    if (text.toUpperCase().includes('FANCY')) {
      // v8.4.0: Use unified regex from INTENSITY_KEYWORDS
      if (!FANCY_COLOR_INTENSITY_REGEX.test(fancyType)) {
        return { isFancy: false };
      }
      return {
        isFancy: true,
        fancyType: fancyType,
        baseColor: 'FANCY'
      };
    }
  }
  return { isFancy: false };
}

/**
 * 計算克拉替代值 (Effective Carat Weight)
 *
 * 邏輯:如果石頭 Spread 偏細(<1.00),視覺上睇起來會比實際重量輕
 * 公式:Effective Carat = Actual Carat × Spread Ratio
 *
 * Example: 10.04ct × 0.80 = 8.03ct effective
 */
function calculateStepCutCompensation(shape) {
  // Step Cut shapes: Emerald, Square Emerald, Asscher
  const stepCutShapes = ['Emerald', 'Square Emerald', 'Asscher'];
  const exoticNoTableShapes = ['Briolette', 'Rose', 'Portuguese', 'Candlelight'];

  // Check if shape contains "Emerald" or "Asscher"
  const isStepCut = stepCutShapes.some(s =>
    shape.toLowerCase().includes(s.toLowerCase()) ||
    shape.includes('Step')
  );

  // Exotic 3D cuts (Briolette, Rose, etc.) have different geometry - no compensation
  const isExotic = EXOTIC_NO_TABLE_SHAPES.some(s => shape.toLowerCase().includes(s.toLowerCase()));
  if (isExotic) {
    return 1.0;
  }
  return isStepCut ? CONFIG.SPREAD_CONSTANTS.STEP_CUT_COMPENSATION : 1.0;
}

// Exotic 3D cuts with no table - skip Effective Carat calculation (non-Briolette)
const EXOTIC_NO_TABLE_SHAPES = ['Rose', 'Portuguese', 'Candlelight'];

/**
 * 計算 Briolette 專用 Effective Carat
 *
 * Briolette 係 3D 水滴形,沒有檯面,唔可以用普通 Spread 公式
 * 需要用 Visual Length × Visual Width / (Carat × 22) 計算
 *
 * @param {Object} data - GIA 證書數據
 * @returns {Object|null} - Effective Carat 結果
 */
function calculateBrioletteEffectiveCarat(data) {
  // Check if it's Briolette
  if (!(data.shape || '').toLowerCase().includes('briolet')) {
    return null; // Not Briolette, skip
  }

  const carat = parseFloat(data.carat);
  if (isNaN(carat) || carat <= 0) {
    return null;
  }

  // Get dimensions
  const dimsStr = data.measurements || '';
  // Extract dimensions from string like "6.05 x 5.70 x 14.06 mm"
  let d1, d2, d3;

  if (data.measurements && typeof data.measurements === 'object') {
    d1 = parseFloat(data.measurements.length);
    d2 = parseFloat(data.measurements.width);
    d3 = parseFloat(data.measurements.depth);
  } else {
    const dimsMatch = dimsStr.match(/([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
    if (!dimsMatch) {
      return null; // Cannot parse dimensions
    }
    d1 = parseFloat(dimsMatch[1]);
    d2 = parseFloat(dimsMatch[2]);
    d3 = parseFloat(dimsMatch[3]);
  }

  if (isNaN(d1) || isNaN(d2) || isNaN(d3)) {
    return null;
  }

  // Sort descending to get Visual Length and Width
  const sortedDims = [d1, d2, d3].sort((a, b) => b - a);
  const visualLength = sortedDims[0];  // Lv = longest
  // Wv = average of the two shorter dimensions (middle + shortest)
  const visualWidth = (sortedDims[1] + sortedDims[2]) / 2;

  // Calculate Briolette Spread Index (BSI)
  // Constant 22 is derived from empirical data (Briolette standard)
  const brioSpreadIndex = (visualLength * visualWidth) / (carat * CONFIG.SPREAD_CONSTANTS.BRIOLLE_SPREAD_FACTOR);

  const effectiveCarat = carat * brioSpreadIndex;

  return {
    actualCarat: carat,
    effectiveCarat: effectiveCarat,
    brioSpreadIndex: brioSpreadIndex,
    label: effectiveCarat > carat ? '視覺偏大' : '視覺偏細',
    isBriolette: true,
    details: `BSI=${brioSpreadIndex.toFixed(3)}, Lv=${visualLength.toFixed(2)}, Wv=${visualWidth.toFixed(2)}`
  };
}


/**
 * 計算 Briolette Ratio 並分類
 *
 * @param {number} visualLength - 最長維度 (mm)
 * @param {number} visualWidth - 中間維度 (mm)
 * @returns {Object} - Ratio 分類結果
 */
function evaluateBrioletteRatio(visualLength, visualWidth) {
  const ratio = visualLength / visualWidth;

  let status, label, emoji, scoreImpact = 0;

  if (ratio < 1.5) {
    status = 'chubby';
    label = 'Chubby Briolette (矮胖)';
    emoji = '📐';
    scoreImpact = -5; // Chubby = less elegant
  } else if (ratio > 3.0) {
    status = 'needle';
    label = 'Needle Briolette (易碎)';
    emoji = '⚠️';
    scoreImpact = -15; // Needle = fragile risk
  } else {
    status = 'normal';
    label = 'Normal Briolette Ratio';
    emoji = '✅';
    scoreImpact = 0;
  }

  return {
    ratio,
    status,
    label,
    emoji,
    scoreImpact,
    detail: `Ratio ${ratio.toFixed(2)} (理想範圍: 1.5-3.0)`
  };
}

/**
 * 檢查 Briolette 特殊風險
 *
 * @param {Object} data - GIA 證書數據
 * @returns {Array} - 風險列表
 */
function checkBrioletteRisks(data) {
  const risks = [];

  // Get dimensions
  const dimsStr = data.measurements || '';
  let d1, d2, d3;

  if (data.measurements && typeof data.measurements === 'object') {
    d1 = parseFloat(data.measurements.length);
    d2 = parseFloat(data.measurements.width);
    d3 = parseFloat(data.measurements.depth);
  } else {
    const dimsMatch = dimsStr.match(/([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
    if (!dimsMatch) {
      return risks; // Cannot parse dimensions
    }
    d1 = parseFloat(dimsMatch[1]);
    d2 = parseFloat(dimsMatch[2]);
    d3 = parseFloat(dimsMatch[3]);
  }

  if (!isNaN(d1) && !isNaN(d2) && !isNaN(d3)) {
    const sortedDims = [d1, d2, d3].sort((a, b) => b - a);
    const visualWidth = sortedDims[1];  // Wv = middle dimension
    const visualDepth = sortedDims[2];  // Dv = shortest dimension

    // 1. Drill Hole Risk
    // If comments mention Internal Graining or Feather near drill hole
    const comments = (data.comments || []).join(' ').toLowerCase();
    const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
    const combinedText = comments + ' ' + keyToSymbols;

    if (combinedText.includes('internal graining') ||
        (combinedText.includes('feather') && combinedText.includes('near drill'))) {
      risks.push({
        type: 'danger',
        label: '⚠️ Drill Hole Risk (鑽孔風險)',
        detail: 'Comments 提及內部紋理或羽裂 near drill hole,評分要大折扣',
        severity: 'HIGH',
        scoreImpact: -20
      });
    }

    // 2. Symmetry Check
    const symmetryRatio = Math.abs(visualWidth - visualDepth) / visualWidth;
    if (symmetryRatio > 0.10) {
      risks.push({
        type: 'warning',
        label: '⚠️ Briolette Symmetry Issue (偏心)',
        detail: `Wv (${visualWidth.toFixed(2)}) vs Dv (${visualDepth.toFixed(2)}) 相差 ${(symmetryRatio*100).toFixed(0)}% > 10%,可能導致「水準歪斜」`,
        severity: 'MEDIUM',
        scoreImpact: -10
      });
    }
  }

  return risks;
}

/**
 * 克拉替代值 (Effective Carat Weight) - 包含 Briolette 專用公式
 *
 * 邏輯:如果石頭 Spread 偏細(<1.00),視覺上睇起來會比實際重量輕
 * 公式:Effective Carat = Actual Carat × Spread Ratio
 *
 * Briolette 使用專用 BSI 公式:
 * BSI = (Lv × Wv) / (Carat × 22)
 * Effective Carat = Carat × BSI
 */
function calculateEffectiveCarat(data, spreadRatio) {
  // 檢查是否係 Briolette - 用專用公式
  if ((data.shape || '').toLowerCase().includes('briolet')) {
    return calculateBrioletteEffectiveCarat(data);
  }

  // Other exotic 3D cuts (Rose, Portuguese, Candlelight) - skip EC calculation
  if (EXOTIC_NO_TABLE_SHAPES.some(s => (data.shape || '').includes(s))) {
    return null;
  }

  const actualCarat = parseFloat(data.carat);
  if (isNaN(actualCarat) || actualCarat <= 0) {
    return null;
  }

  // Step Cut 補償:祖母綠切工天然就深,視覺上唔會縮水咁多
  const stepCutCompensation = calculateStepCutCompensation(data.shape);
  const adjustedSpreadRatio = spreadRatio * stepCutCompensation;

  // 只有當 Adjusted Spread Ratio < 0.95 或 > 1.05 時先顯示
  if (adjustedSpreadRatio >= CONFIG.SPREAD_CONSTANTS.SPREAD_COMPENSATION_MIN && adjustedSpreadRatio <= CONFIG.SPREAD_CONSTANTS.SPREAD_COMPENSATION_MAX) {
    return null; // 正常範圍,唔需要顯示
  }

  const effectiveCarat = actualCarat * adjustedSpreadRatio;
  const diff = actualCarat - effectiveCarat;

  if (adjustedSpreadRatio < 1.00) {
    // Spread 偏細 - 視覺偏輕
    return {
      actualCarat,
      effectiveCarat: effectiveCarat,
      difference: diff,
      label: '視覺偏輕',
      detail: `${actualCarat.toFixed(2)}ct 實際重量,因 Spread ${(adjustedSpreadRatio * 100).toFixed(0)}% 僅視覺相當於 ${effectiveCarat.toFixed(2)}ct`,
      stepCutCompensation: stepCutCompensation > 1.0 ? stepCutCompensation : null
    };
  } else {
    // Spread 偏大 - 視覺偏大
    return {
      actualCarat,
      effectiveCarat: effectiveCarat,
      difference: diff,
      label: '視覺偏大',
      detail: `${actualCarat.toFixed(2)}ct 實際重量,因 Spread ${(adjustedSpreadRatio * 100).toFixed(0)}% 視覺相當於 ${effectiveCarat.toFixed(2)}ct`,
      stepCutCompensation: stepCutCompensation > 1.0 ? stepCutCompensation : null
    };
  }
}

/**
 * 魚眼/漏光警示 (Windowing Risk)
 * 條件:Spread > 140% 且 Depth < 50%
 */
function checkWindowingRisk(data, fancySpreadResult, depthPct) {
  if (fancySpreadResult && fancySpreadResult.spreadIndex > 1.40 && depthPct < 50) {
    return {
      hasRisk: true,
      severity: 'CRITICAL',
      detail: '⚠️ 魚眼/漏光警示:超大表面積源於極端深度不足,石頭看起來像透明玻璃'
    };
  }
  return { hasRisk: false };
}

/**
 * 收藏級 (Investment Grade) 標記
 * 條件:D Color + FL 或 IF Clarity
 */
function checkInvestmentGrade(data) {
  const color = (data.color || '').toUpperCase();
  const clarity = (data.clarity || '').toUpperCase();

  // D Color + FL/IF = Investment Grade
  if (color === 'D' && (clarity === 'FL' || clarity === 'IF')) {
    return {
      isInvestmentGrade: true,
      detail: '💎 Investment Grade (收藏級): D/FL 頂級品質,稀缺性極高'
    };
  }
  return { isInvestmentGrade: false };
}

// ============================================================================
// FLAG DEDUPLICATION
// ============================================================================

/**
 * 邏輯併攏 - 移除重複的 Milky/Hazy 警告
 * @param {Array} flags - 原始 flags 列表
 * @returns {Array} 去重後的 flags
 */
function deduplicateFlags(flags) {
  const seen = new Set();
  const result = [];

  for (const flag of flags) {
    // 唔重複相似既 Milky/Hazy 警告
    if (flag.flag && (flag.flag.includes('Milky') || flag.flag.includes('Hazy'))) {
      if (seen.has('milky')) continue;
      seen.add('milky');
    }
    // 唔重複 CRITICAL Depth 警告
    if (flag.flag && flag.flag.includes('CRITICAL:')) {
      if (seen.has('critical_depth')) continue;
      seen.add('critical_depth');
    }
    result.push(flag);
  }
  return result;
}

// ============================================================================
// RISK DETECTION FUNCTIONS
// ============================================================================

/**
 * 增強風險檢測 (聯動報警)
 * @param {Object} data - 證書數據
 * @param {Array} existingFlags - 現有 logicFlags
 * @returns {Array} 風險標記列表
 */
/**
 * v7.8.0: Calculate Girdle Penalty with Carat-based Multiplier
 * Extremely Thick 50ct+ = -40 (force BUY → CONDITIONAL)
 */
function calculateGirdlePenalty(girdle, carat) {
  const girdleLower = (girdle || '').toLowerCase();
  if (!girdleLower) return 0;

  // Find base penalty
  let basePenalty = 0;
  const penaltyTable = CONFIG.GIRDLE_PENALTY;
  for (const [key, penalty] of Object.entries(penaltyTable)) {
    if (girdleLower.includes(key)) {
      basePenalty = penalty;
      break;
    }
  }

  // Apply carat multiplier
  let mult = 1.0;
  const caratMultTable = CONFIG.GIRDLE_PENALTY_CARAT_MULT;
  for (const [key, range] of Object.entries(caratMultTable)) {
    if (carat >= range.min && carat < range.max) {
      mult = range.mult;
      break;
    }
  }

  // For xlarge stones (50ct+), apply small penalty even for "slightly thick" or "thick" girdles
  // because any girdle irregularity costs more in absolute weight on big stones
  if (carat >= 50 && basePenalty === 0 && (girdleLower.includes('slightly thick') || girdleLower.includes('thick'))) {
    basePenalty = -2;
  }

  return Math.round(basePenalty * mult);
}

/**
 * v8.1.0: Fluorescence Offset (三級制)
 * 
 * 研究結論:
 * - Medium Blue 在低色級 (K/L/M) 中確實有補償效果，但比 Strong/Very Strong 弱
 * - Very Strong Blue 在低色級中可能過強，導致朦朧/油感風險
 * - Strong Blue 在 I/J 色中效果最好，市場接受度高
 * 
 * 三級制補償:
 * - K/L/M + Very Strong Blue: +2 (過強，可能抵消不足)
 * - K/L/M + Strong Blue: +4 (藍光適中，補償效果好)
 * - K/L/M + Medium Blue: +2 (藍光偏弱，補償效果一般)
 * - I/J + Very Strong Blue: +3 (偏強，需注意朦朧)
 * - I/J + Strong Blue: +6 (最佳補償組合)
 * - I/J + Medium Blue: +3 (藍光偏弱)
 * - H + Very Strong Blue: +2 (過強，補償不足)
 * - H + Strong Blue: +4 (藍光適中)
 * - H + Medium Blue: +1 (補償微弱)
 */
const FLUORESCENCE_OFFSET_CONFIG = Object.freeze({
  TIER3_VERY_STRONG: {
    'K': 2, 'L': 2, 'M': 2,
    'I': 3, 'J': 3,
    'H': 2
  },
  TIER2_STRONG: {
    'K': 4, 'L': 4, 'M': 4,
    'I': 6, 'J': 6,
    'H': 4
  },
  TIER1_MEDIUM: {
    'K': 2, 'L': 2, 'M': 2,
    'I': 3, 'J': 3,
    'H': 1
  }
});

function checkFluorescenceOffset(data) {
  const color = (data.color || '').toUpperCase();
  const fluor = (data.fluorescence || '').toLowerCase();
  const carat = parseFloat(data.carat) || 0;

  // 只適用於 1ct 以上的石頭
  if (carat < 1) return null;

  // 檢查是否為有效顏色
  const validColors = ['H', 'I', 'J', 'K', 'L', 'M'];
  if (!validColors.includes(color)) return null;

  // 檢查熒光強度
  const isVeryStrong = /very strong/i.test(fluor) && /blue/i.test(fluor);
  const isStrong = /^(?!very strong)strong/i.test(fluor) && /blue/i.test(fluor); // Strong but NOT Very Strong
  const isMedium = /medium/i.test(fluor) && /blue/i.test(fluor);

  // 確定補償分數
  let bonus = 0;
  let tierLabel = '';
  let detail = '';

  if (isVeryStrong) {
    bonus = FLUORESCENCE_OFFSET_CONFIG.TIER3_VERY_STRONG[color] || 0;
    tierLabel = '💎💎';
    detail = `Very Strong Blue 補償: ${bonus > 0 ? '+' + bonus : bonus} (K/L/M區間藍光可能過強)`;
  } else if (isStrong) {
    bonus = FLUORESCENCE_OFFSET_CONFIG.TIER2_STRONG[color] || 0;
    tierLabel = '💎💎';
    detail = `Strong Blue 補償: +${bonus} (藍光適中，補償效果好)`;
  } else if (isMedium) {
    bonus = FLUORESCENCE_OFFSET_CONFIG.TIER1_MEDIUM[color] || 0;
    tierLabel = '💎';
    detail = `Medium Blue 補償: +${bonus} (藍光偏弱，補償效果一般)`;
  }

  if (bonus === 0) return null;

  // 返回補償標記
  const flagLabel = tierLabel + ' FLUORESCENCE OFFSET: ' + color + ' + ' + fluor.replace(/blue/i, 'Blue');
  return {
    bonus: bonus,
    flag: flagLabel,
    detail: detail + ` | ${color}色 + ${fluor} = 藍光抵消黃色,提升視覺白度`
  };
}

/**
 * v7.8.0: Portrait Cut Detection
 * Triangular/Marquise/Pear shape + depth < 35% = intentional Portrait Cut
 * Not a manufacturing defect - label as DESIGNER SPEC instead of REJECT
 */
function checkPortraitCut(data) {
  const shape = (data.shape || '').toLowerCase();
  const depthPct = parseFloat(data.depthPct) || 0;

  // Portrait Cut indicators: triangular shapes with shallow depth
  const isTriangular = shape.includes('triangular') || shape.includes('trillion') || 
                       shape.includes('trilliant') || shape.includes('pear') ||
                       shape.includes('marquise');

  if (isTriangular && depthPct < 35 && depthPct > 0) {
    return {
      isPortraitCut: true,
      detail: `${data.shape} depth ${depthPct}% < 35% = Portrait Cut (designer spec, not defect)`
    };
  }
  return { isPortraitCut: false };
}

/**
 * v7.8.0: Briolette Fish-eye Exemption
 * Briolette has no table - skip all fish-eye / table-depth warnings
 */
function isBrioletteShape(data) {
  return (data.shape || '').toLowerCase().includes('briolet');
}

/**
 * v7.8.0: Check if shape is Portrait Cut (Triangular variants)
 */
function isPortraitCutShape(data) {
  const shape = (data.shape || '').toLowerCase();
  return shape.includes('triangular') || shape.includes('trillion') || 
         shape.includes('trilliant') || shape.includes('pear') ||
         shape.includes('marquise');
}

/**
 * v7.8.0: Portrait Cut Detection in enhancedRiskDetection
 * Triangular/Briolette/Shield 等特殊形狀,如果 Key to Symbols 或 Table/Depth 全為 N/A
 * 應標記 MANUAL REVIEW REQUIRED 而唔係 REJECT
 */
function enhancedRiskDetection(data, existingFlags = []) {
  const flags = [...existingFlags];

  // === v9.1.0: Extract common text normalization to avoid repeated join/toLowerCase calls ===
  // Returns { commentsLower, keyToSymbolsLower, combinedText } for use throughout the function
  const _normalizeText = (commentsArr, keyToSymbolsArr) => {
    const cmtLower = (commentsArr || []).join(' ').toLowerCase();
    const ktolLower = (keyToSymbolsArr || []).join(' ').toLowerCase();
    return {
      commentsLower: cmtLower,
      keyToSymbolsLower: ktolLower,
      combinedText: cmtLower + ' ' + ktolLower
    };
  };
  // Pre-compute once; reassign only if comments/keyToSymbols actually exist in data
  const _hasComments = data.comments && Array.isArray(data.comments) && data.comments.length > 0;
  const _hasKeyToSymbols = data.keyToSymbols && Array.isArray(data.keyToSymbols) && data.keyToSymbols.length > 0;
  const _text = _hasComments || _hasKeyToSymbols
    ? _normalizeText(_hasComments ? data.comments : [], _hasKeyToSymbols ? data.keyToSymbols : [])
    : { commentsLower: '', keyToSymbolsLower: '', combinedText: '' };

  // === v7.8.0: Portrait Cut Detection ===
  const portraitResult = checkPortraitCut(data);
  if (portraitResult.isPortraitCut) {
    // Flag as Designer Spec instead of REJECT
    flags.push({
      flag: '🎨 DESIGNER SPEC (Portrait Cut)',
      severity: 'INFO',
      detail: portraitResult.detail + ' - 故意淺切工,唔係光學缺陷'
    });
  }

  // === 現有 logicFlags 保留 ===


  // === 新增邏輯 ===

  // 0. 使用 evaluateDepth 結果來標記 CRITICAL Depth(基於形狀特定範圍)
  // v7.6.1: Fancy stones use FANCY_DEPTH_MATRIX
  const isFancyColor = (data.color || '').toUpperCase().includes('FANCY');
  const depthResult = evaluateDepth(data.depthPct, data.shape, isFancyColor);
  // v7.8.0: Skip depth penalty for Portrait Cuts (intentional shallow design)
  if (depthResult.status === 'critical' && !portraitResult.isPortraitCut) {
    flags.push({
      flag: `🔴 ${depthResult.label}`,
      severity: 'HIGH',
      detail: depthResult.detail
    });
  }

  // === v7.8.0: 特殊形狀 (非 Portrait Cut) Table/Depth N/A 處理 ===
  const isBriolette = isBrioletteShape(data);
  const isPortraitShape = isPortraitCutShape(data);
  const SPECIAL_SHAPES = ['triangular', 'briolet', 'shield', 'hexagonal', 'trillion', 'trilliant', 'marquise', 'baguette'];
  const isSpecialShape = SPECIAL_SHAPES.some(s => (data.shape || '').toLowerCase().includes(s));
  if (isSpecialShape && !portraitResult.isPortraitCut && !isBriolette) {
    const depthPctVal = parseFloat(data.depthPct);
    const tablePct = parseFloat(data.tablePct);
    const hasKeySymbols = data.keyToSymbols && data.keyToSymbols.length > 0 && data.keyToSymbols.some(k => k && k.toLowerCase() !== 'n/a');
    const depthNA = isNaN(depthPctVal) || depthPctVal <= 0;
    const tableNA = isNaN(tablePct) || tablePct <= 0;
    // 如果全部關鍵光學參數都係 N/A 且冇 Key to Symbols
    if (depthNA && tableNA && !hasKeySymbols) {
      flags.push({
        flag: '⚠️ MANUAL REVIEW REQUIRED (特殊形狀)',
        severity: 'HIGH',
        detail: `${data.shape} 特殊形狀光學參數全 N/A,需要人工確認切工質量`
      });
    }
  }

  // === H/IF Clarity Correction (VLM OCR fix) ===
  // VLM sometimes misreads "IF" as "Grade" or other words
  if (data.clarity && /^(grade|clarity|if|fl)$/i.test(data.clarity.trim())) {
    // === v9.1.0: Use pre-computed _text instead of recomputing ===
    if (/internally flawless|no internal|no inclusions|if\b/i.test(_text.combinedText)) {
      data.clarity = 'IF';
    }
  }

  // === v7.8.0: Briolette Skip Table/Depth optical checks ===
  // Briolette is a 3D faceted cut with no table - optical parameters don't apply
  if (isBriolette) {
    // Add info flag that Table/Depth N/A for Briolette
    flags.push({
      flag: 'ℹ️ Briolette: Table/Depth N/A',
      severity: 'INFO',
      detail: 'Briolette is a 3D faceted cut without a table - optical parameters N/A'
    });
  }

  // 1. SI1/SI2 + Clouds not shown = Milky Risk (v7.6.1: REJECT)
  // === v9.1.0: Use pre-computed _text.commentsLower instead of recomputing ===
  if (data.clarity === 'SI1' || data.clarity === 'SI2') {
    const hasCloudsNotShown = /cloud.*not.*shown/i.test(_text.commentsLower) || /clouds.*not.*shown/i.test(_text.commentsLower);
    if (hasCloudsNotShown) {
      flags.push({
        flag: '❌ Milky Risk: Clouds not shown = REJECT',
        severity: 'CRITICAL',
        detail: `SI1/SI2 + Clouds not shown = 極高奶油石風險 (Hidden cloud concentration),直接 REJECT`
      });
      // v7.6.1: Immediately mark for REJECT
      data._milkyReject = true;
    }
  }

  // 2. 極淺深度 = Severe Windowing (skip for Portrait Cut - intentional)
  const depthPctVal2 = parseFloat(data.depthPct);
  if (!isNaN(depthPctVal2) && depthPctVal2 < 55 && !portraitResult.isPortraitCut) {
    flags.push({
      flag: '🔴 CRITICAL: Severe Windowing',
      severity: 'HIGH',
      detail: `Depth ${depthPctVal2}% 極淺,光線直接穿透,中心失去閃爍`
    });
  }

  // 3. 極深深度 = Weight Hidden
  if (!isNaN(depthPctVal2) && depthPctVal2 > 70) {
    flags.push({
      flag: '🔴 CRITICAL: Weight Hidden',
      severity: 'HIGH',
      detail: `Depth ${depthPctVal2}% 過深,視覺重量被隱藏,看起來比實際小`
    });
  }

  // 4. High Color + Strong Fluorescence = Overblue/Hazy Risk
  const highColors = ['D', 'E', 'F'];
  const strongFluorescence = ['Strong', 'Very Strong'];
  if (highColors.includes(data.color) &&
      data.fluorescence &&
      strongFluorescence.some(f => data.fluorescence.includes(f))) {
    flags.push({
      flag: '🔴 Overblue/Hazy Risk',
      severity: 'HIGH',
      detail: `${data.color} color + ${data.fluorescence} fluorescence = 可能出現朦朧外觀`
    });
  }

  // 5. Very Thin girdle = Chipping Risk
  if (data.girdle && /very thin|extremely thin/i.test(data.girdle)) {
    flags.push({
      flag: '🟡 Chipping Risk',
      severity: 'MEDIUM',
      detail: `Girdle: ${data.girdle} - 側面薄弱,易損壞`
    });
  }

  // 6. Medium/None fluorescence + SI clarity = potential clarity concern
  if ((data.fluorescence === 'None' || data.fluorescence === 'Medium') &&
      (data.clarity === 'SI1' || data.clarity === 'SI2')) {
    flags.push({
      flag: '🟡 Clarity Check',
      severity: 'LOW',
      detail: `SI 淨度 + ${data.fluorescence || 'None'} 螢光 - 建議確認內含物位置`
    });
  }

  // 7. 領結效應 (增強版 v2 - 雙向檢測)
  const shape = data.shape || '';
  const bowTieEnhanced = checkBowTieRiskEnhanced(data);
  if (bowTieEnhanced) {
    flags.push({
      flag: bowTieEnhanced.label,
      severity: bowTieEnhanced.severity,
      detail: bowTieEnhanced.detail
    });
  }

  // 7b. Moval 檢測 (Oval Ratio > 1.65)
  const movalResult = evaluateOvalMoval(shape, data.ratio);
  if (movalResult && movalResult.isMoval) {
    flags.push({
      flag: `${movalResult.emoji} ${movalResult.label}`,
      severity: 'HIGH',
      detail: movalResult.detail
    });
  }

  // 8. 圓鑽角度蹺蹺板 (Crown & Pavilion Synergy)
  if (/round/i.test(shape) && data.crownAngle && data.pavilionAngle) {
    const crown = parseFloat(data.crownAngle);
    const pavilion = parseFloat(data.pavilionAngle);
    if (crown >= 35.5 && pavilion >= 41.0) {
      flags.push({
        flag: '🔴 CRITICAL: Optical Deadzone',
        severity: 'HIGH',
        detail: `冠角(${crown}°)與亭角(${pavilion}°)雙陡,光線無法全反射,即使 3EX 也會漏光發黑。`
      });
    }
  }

  // 9. 底尖陷阱 (Culet)
  if (data.culet && /large|very large/i.test(data.culet)) {
    flags.push({
      flag: '🔴 CRITICAL: Large Culet',
      severity: 'HIGH',
      detail: `底尖過大 (${data.culet}),正面看會像中心破了一個黑洞。`
    });
  }

  // 10. 首位瑕疵權重 (The "Boss" Inclusion)
  if (data.keyToSymbols && data.keyToSymbols.length > 0) {
    const firstSymbol = data.keyToSymbols[0].toLowerCase();
    if ((data.clarity === 'SI1' || data.clarity === 'SI2') &&
      (/cloud/i.test(firstSymbol) || /twinning wisp/i.test(firstSymbol))) {
      flags.push({
        flag: '🔴 High Milky/Hazy Risk',
        severity: 'HIGH',
        detail: `淨度為 ${data.clarity} 且首要瑕疵為 ${firstSymbol},極高機率影響鑽石整體透明度。`
      });
    }
  }

  return flags;
}

/**
 * 增強版領結效應預測 (Bow-tie Effect Prediction - v2)
 *
 * 兩種觸發條件:
 * 1. 太薄 (Shallow): Ratio > 1.5 + Depth < 58%
 * 2. 太深 (Deep): Ratio < 1.5 + Depth > 65%
 *
 * 對於 Marquise,理想 Ratio 範圍是 1.8-2.2
 */
function checkBowTieRiskEnhanced(data) {
  const shape = (data.shape || '').toLowerCase();
  const ratio = parseFloat(data.ratio) || 0;
  const depth = parseFloat(data.depthPct) || 0;
  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();
  const tablePct = parseFloat(data.tablePct) || 0;

  // 僅適用於 Marquise、Pear、Oval
  if (!shape.includes('marquise') &&
      !shape.includes('pear') &&
      !shape.includes('oval')) {
    return null;
  }

  // 標準 Bow-tie 檢測
  let bowTieTriggered = false;
  let bowTieScore = -15;
  let bowTieLabel = '⚠️ Bow-tie Risk: Too Thin (太薄)';
  let bowTieDetail = '';

  // 太薄情況:高 Ratio + 低 Depth
  if (ratio > 1.5 && depth < 58) {
    bowTieTriggered = true;
    bowTieDetail = `${shape} Ratio ${ratio.toFixed(2)} > 1.5 + Depth ${depth.toFixed(1)}% < 58% = 中心黑色陰影`;
  }

  // 太深情況:低 Ratio + 高 Depth
  if (ratio < 1.5 && depth > 65) {
    bowTieTriggered = true;
    bowTieScore = -20;
    bowTieLabel = '⚠️ Bow-tie Risk: Too Deep (太深)';
    bowTieDetail = `${shape} Ratio ${ratio.toFixed(2)} < 1.5 + Depth ${depth.toFixed(1)}% > 65% = 底部漏光 + 領結`;
  }

  // === Bow-tie Compensation: 3EX 異形石扣分減半 ===
  if (bowTieTriggered && polish === 'excellent' && symmetry === 'excellent') {
    if (tablePct < 58) {
      bowTieScore = -8;
      bowTieLabel = '💡 Bow-tie Mitigated (3EX補償)';
      bowTieDetail = bowTieDetail + ',但 3EX + 小 Table 切割師已補償';
    }
  }

  if (bowTieTriggered) {
    return {
      type: 'warning',
      label: bowTieLabel,
      detail: bowTieDetail,
      scoreImpact: bowTieScore,
      severity: bowTieScore <= -15 ? 'HIGH' : 'MEDIUM'
    };
  }

  // Marquise 特殊檢查:理想 Ratio 1.8-2.2  // Marquise 特殊檢查:理想 Ratio 1.8-2.2
  if (shape.includes('marquise')) {
    if (ratio < 1.8) {
      return {
        type: 'info',
        label: '💡 Marquise Ratio Warning (馬眼偏矮)',
        detail: `Marquise Ratio ${ratio.toFixed(2)} < 1.8,偏矮闊,火彩集中於兩端`,
        scoreImpact: -5,
        severity: 'LOW'
      };
    }
    if (ratio > 2.2) {
      return {
        type: 'info',
        label: '💡 Marquise Ratio Warning (馬眼偏長)',
        detail: `Marquise Ratio ${ratio.toFixed(2)} > 2.2,偏長纖細,易碎風險`,
        scoreImpact: -8,
        severity: 'MEDIUM'
      };
    }
  }

  // === v2.9.0 NEW: Chubby Oval 檢測 (Ratio < 1.2 = 扁圓形) ===
  if (shape.includes('oval') && ratio < 1.2) {
    return {
      type: 'warning',
      label: '⚠️ Chubby Oval (扁圓形): 差光學表現',
      detail: `Oval Ratio ${ratio.toFixed(2)} < 1.2 = 光學表現差,俗稱「扁 Oval」`,
      scoreImpact: -12,
      severity: 'MEDIUM'
    };
  }

  // === v2.9.0 NEW: Headlight Effect (太深的 Oval/Pear) ===
  if ((shape.includes('oval') || shape.includes('pear')) && depth > 65) {
    return {
      type: 'warning',
      label: '⚠️ Headlight Effect (死色中間)',
      detail: `${shape} 太深 (${depth.toFixed(1)}%) = 兩端閃但中間死色`,
      scoreImpact: -15,
      severity: 'HIGH'
    };
  }

  return null;
}

/**
 * 檢測 Table Percentage 風險 (Table Risk)
 *
 * Table 太大 (>64%) = Fish-eye Effect
 * Table 理想 (54-57%) = Investment Grade
 */
function checkTableRisk(data) {
  const tablePct = parseFloat(data.tablePct) || 0;
  const shape = (data.shape || '').toLowerCase();

  if (tablePct <= 0) return null;

  // v7.8.0: Briolette has no table - skip fish-eye check
  if (isBrioletteShape(data)) return null;

  // 僅適用於 Round
  if (!shape.includes('round')) return null;

  // Fish-eye Effect: Table 太大
  if (tablePct > 64) {
    return {
      type: 'warning',
      label: '⚠️ Fish-eye Effect (魚眼)',
      detail: `Table ${tablePct.toFixed(1)}% > 64%,光線從腰崖漏出,中心黑暗`,
      scoreImpact: -15,
      severity: 'HIGH'
    };
  }

  // Very Large Table
  if (tablePct > 60 && tablePct <= 64) {
    return {
      type: 'info',
      label: '💡 Large Table (大檯面)',
      detail: `Table ${tablePct.toFixed(1)}% 偏大,火彩分散`,
      scoreImpact: -3,
      severity: 'LOW'
    };
  }

  // Investment Grade Table
  if (tablePct >= 54 && tablePct <= 57) {
    return {
      type: 'info',
      label: '💎 Investment Grade Table (投資級檯面)',
      detail: `Table ${tablePct.toFixed(1)}% 完美範圍 (54-57%),光學性能最佳`,
      scoreImpact: 8,
      severity: 'INFO'
    };
  }

  return null;
}

/**
 * 檢測證書年齡風險 (Certificate Age Risk)
 *
 * 舊證書可能已經有物理損傷 (Nicks/Chips/Scratches)
 */
function checkCertificateAgeRisk(data) {
  const reportDate = data.reportDate || '';
  const comments = (data.comments || []).join(' ').toLowerCase();

  // 嘗試解析年份 - 多種格式支援
  let year = null;

  // 嘗試格式 1: YYYY-MM-DD (2026-04-27)
  let yearMatch = reportDate.match(/20(\d{2})[-\/]/);
  if (yearMatch) {
    year = parseInt('20' + yearMatch[1]);
  }

  // 嘗試格式 2: Month DD, YYYY (April 27, 2026)
  if (!year) {
    const monthYearMatch = reportDate.match(/([A-Za-z]+)\s+\d+,\s+(20\d{2})/i);
    if (monthYearMatch) {
      year = parseInt(monthYearMatch[2]);
    }
  }

  // 嘗試格式 3: DD Month YYYY (27 April 2026)
  if (!year) {
    const dayMonthYearMatch = reportDate.match(/(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i);
    if (dayMonthYearMatch) {
      year = parseInt(dayMonthYearMatch[3]);
    }
  }

  // 如果解析失敗,返回 null(不影響計算)
  if (!year || isNaN(year)) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const age = currentYear - year;

  // 安全檢查:確保 age 是有效數字
  if (isNaN(age) || age < 0 || age > 100) {
    return null;
  }

  // v7.6.x: 2015年前舊證書 = Old Certificate Flag
  if (year < 2015) {
    return {
      type: 'warning',
      label: '⚠️ Old Certificate Flag (<2015): Re-check 建議',
      detail: `證書 ${year} 年 (${age} 年前),建議要求新照片或 Re-check`,
      scoreImpact: -8,
      severity: 'HIGH'
    };
  }


  // ... 繼續原有邏輯
  if (age > 15) {
    return {
      type: 'warning',
      label: '⚠️ VERY OLD REPORT (>15 years): 物理損傷風險高',
      detail: `證書 ${year} 年 (${age} 年前),強烈建議親眼確認無損傷`,
      scoreImpact: -10,
      severity: 'HIGH'
    };
  }

  if (age > 10) {
    // 進一步檢查 Abraded
    const hasAbraded = comments.includes('abraded') || comments.includes('worn');
    if (hasAbraded) {
      return {
        type: 'warning',
        label: '⚠️ ABRADED CULET: 底尖磨損',
        detail: `舊證 (>10年) + Abraded = 底尖磨損,需要重新拋光`,
        scoreImpact: -8,
        severity: 'MEDIUM'
      };
    }
    return {
      type: 'warning',
      label: '⚠️ OLD REPORT (>10 years): 建議重新檢查',
      detail: `證書 ${year} 年 (${age} 年前),可能有打磨痕跡`,
      scoreImpact: -5,
      severity: 'MEDIUM'
    };
  }


  if (age > 7) {
    // 也檢查 Abraded
    const hasAbraded = comments.includes('abraded') || comments.includes('worn');
    if (hasAbraded) {
      return {
        type: 'warning',
        label: '⚠️ ABRADED CULET: 底尖磨損',
        detail: `證書 ${age} 年 + Abraded = 底尖磨損`,
        scoreImpact: -5,
        severity: 'MEDIUM'
      };
    }
    return {
      type: 'info',
      label: '💡 MATURE REPORT (7+ years)',
      detail: `證書 ${age} 年,建議確認狀態`,
      scoreImpact: -2,
      severity: 'LOW'
    };
  }

  return null;
}

/**
 * 檢測卡數台階風險 (Carat Threshold Risk) - v7.7.0
 *
 * 1.00ct, 1.50ct, 2.00ct, 3.00ct, 5.00ct 等臨界點
 * 石頭重量非常接近但未達到台階重量時,會有 Borderline Weight Risk
 */
function checkCaratThresholdRisk(data) {
  const carat = parseFloat(data.carat) || 0;
  if (carat <= 0) return null;

  const thresholds = [1.00, 1.50, 2.00, 3.00, 5.00, 10.00];
  const borderlineRange = 0.08; // ±0.08ct 內算是 borderline

  for (const threshold of thresholds) {
    const diff = carat - threshold;
    if (Math.abs(diff) < borderlineRange) {
      if (diff > 0) {
        // 超過台階但未達 0.08ct = 接近台階但未達
        return {
          type: 'info',
          label: '⚠️ Borderline Weight Risk',
          detail: `重量 ${carat.toFixed(2)}ct 接近 ${threshold}ct 台階,視覺效果需確認`,
          scoreImpact: -3,
          severity: 'LOW'
        };
      } else {
        // 低於台階 = borderline risk
        return {
          type: 'info',
          label: '⚠️ Borderline Weight Risk (低於台階)',
          detail: `重量 ${carat.toFixed(2)}ct 未達 ${threshold}ct 台階,實際視覺效果偏低`,
          scoreImpact: -5,
          severity: 'MEDIUM'
        };
      }
    }
  }

  return null;
}


/**
 * 圓鑽切工等級金字塔 (Round Cut Grade Pyramid)
 *
 * 確保一顆石頭只進入一個「比例類別」,防止同時加減分
 * 等級由高到低:Super Ideal > Investment Grade > Good > Fair > Poor
 */
function evaluateRoundCutGradePyramid(data) {
  const tablePct = parseFloat(data.tablePct) || 0;
  const depthPct = parseFloat(data.depthPct) || 0;
  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();

  // 預設值
  let grade = 'UNKNOWN';
  let scoreImpact = 0;
  let detail = '';

  // 等級判斷(由高到低,if-else if 確保只進入一個)
  if (tablePct >= 54 && tablePct <= 57 &&
      depthPct >= 61 && depthPct <= 62.5 &&
      polish === 'excellent' && symmetry === 'excellent') {
    // 等級 1: Super Ideal / H&A
    grade = 'SUPER_IDEAL';
    scoreImpact = 15;
    detail = `Table ${tablePct.toFixed(1)}% + Depth ${depthPct.toFixed(1)}% + 3EX`;
  } else if (tablePct >= 54 && tablePct <= 58 &&
             depthPct >= 60 && depthPct <= 63) {
    // 等級 2: Investment Grade
    grade = 'INVESTMENT_GRADE';
    scoreImpact = 8;
    detail = `Table ${tablePct.toFixed(1)}% + Depth ${depthPct.toFixed(1)}% 良好比例`;
  } else if (tablePct > 64) {
    // 等級 3: Fish-eye (與 Super Ideal 互斥)
    grade = 'FISH_EYE';
    scoreImpact = -15;
    detail = `Table ${tablePct.toFixed(1)}% > 64% = 魚眼效應`;
  } else if (tablePct >= 59 && tablePct <= 64) {
    // 等級 4: Good (正常範圍)
    grade = 'GOOD';
    scoreImpact = 0;
    detail = `Table ${tablePct.toFixed(1)}% 正常範圍`;
  } else if (tablePct < 52 || tablePct > 66 || depthPct < 56 || depthPct > 66) {
    // 等級 5: Poor (邊緣範圍)
    grade = 'POOR';
    scoreImpact = -8;
    detail = `比例偏離標準範圍`;
  }

  return { grade, scoreImpact, detail };
}

/**
 * 評估刻面光澤 (Facet Lustre) - v3.0.0
 *
 * Radiant 同 Cushion 切工最怕睇落似「碎冰」(無層次)
 * Depth > 70% 且 Table > 68% = Crushed Ice
 */
function evaluateFacetLustre(data) {
  const shape = (data.shape || '').toLowerCase();
  const tablePct = parseFloat(data.tablePct) || 0;
  const depthPct = parseFloat(data.depthPct) || 0;

  // 僅適用於 Radiant, Cushion, Square Emerald
  if (!shape.includes('radiant') &&
      !shape.includes('cushion') &&
      !shape.includes('square emerald')) {
    return null;
  }

  // Crushed Ice Effect
  if (depthPct > 70 && tablePct > 68) {
    return {
      type: 'warning',
      label: '⚠️ Crushed Ice Effect (壓碎冰)',
      detail: `深度 ${depthPct.toFixed(1)}% + Table ${tablePct.toFixed(1)}% = 刻面破碎,火彩無層次`,
      scoreImpact: -15,
      severity: 'HIGH'
    };
  }

  // 臨界情況
  if (depthPct > 68 && tablePct > 65) {
    return {
      type: 'info',
      label: '💡 Soft Facet Lustre (柔和刻面)',
      detail: '刻面偏深偏大,火彩偏軟',
      scoreImpact: -5,
      severity: 'LOW'
    };
  }

  return null;
}

/**
 * 對辦率評估 (Marketability Index) - v3.0.0
 *
 * 唔單止係粒石靚唔靚,而係粒石「好唔好賣」
 */
function evaluateMarketability(data) {
  const shape = (data.shape || '').toLowerCase();
  const carat = parseFloat(data.carat) || 0;
  const color = (data.color || '').toUpperCase().trim();
  const clarity = data.clarity || '';
  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();
  const fluor = (data.fluorescence || '').toLowerCase();

  let sellScore = 0;
  let sellLabel = '';
  const sellDetail = [];

  // === Easy Sell 評估 ===
  let easyFactors = 0;

  if (shape.includes('round')) { easyFactors++; sellDetail.push('Round 形狀'); }
  const standardWeights = [1.0, 1.5, 2.0, 3.0, 5.0];
  const isStandardWeight = standardWeights.some(w => Math.abs(carat - w) < 0.05);
  if (isStandardWeight) { easyFactors++; sellDetail.push(`經典重量 ${carat.toFixed(2)}ct`); }
  if (['D', 'E', 'F'].includes(color)) { easyFactors++; sellDetail.push(`${color} 色高色`); }
  if (['VS1', 'VS2', 'VVS1', 'VVS2', 'IF', 'FL'].includes(clarity)) { easyFactors++; sellDetail.push(`${clarity} 淨度`); }
  if (polish === 'excellent' && symmetry === 'excellent') { easyFactors++; sellDetail.push('3EX 切工'); }
  if (!fluor || fluor.includes('none')) { easyFactors++; sellDetail.push('None 熒光'); }

  // === Hard Sell 評估 ===
  let hardFactors = 0;
  if (shape.includes('marquise')) { hardFactors++; sellDetail.push(' Marquise 形狀'); }
  if (['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].includes(color)) { hardFactors++; sellDetail.push('低色'); }
  if (fluor.includes('strong') && fluor.includes('blue')) { hardFactors++; sellDetail.push('Strong Blue'); }
  const remainder = carat % 1.0;
  if (remainder > 0.05 && remainder < 0.95 && (remainder < 0.15 || remainder > 0.85)) { hardFactors++; sellDetail.push(`單卡畸數 ${carat.toFixed(2)}ct`); }

  // === 計算 Marketability Score ===
  if (easyFactors >= 4) {
    sellScore = easyFactors * 2.5;
    sellLabel = '💎💎💎 EASY SELL (熱賣)';
  } else if (easyFactors >= 2) {
    sellScore = easyFactors * 1.5;
    sellLabel = '💎💎 GOOD SELL (正常)';
  } else if (hardFactors >= 2) {
    sellScore = -hardFactors * 5;
    sellLabel = '⚠️💡 HARD SELL (難賣)';
  } else if (hardFactors >= 1) {
    sellScore = -hardFactors * 3;
    sellLabel = '💡 MODERATE (普通)';
  } else {
    sellScore = 0;
    sellLabel = '✅ STANDARD (標準)';
  }

  return {
    type: sellScore >= 5 ? 'super' : (sellScore <= -5 ? 'warning' : 'info'),
    label: sellLabel,
    detail: `對辦率評估: ${sellDetail.join(', ') || '無特殊因素'}`,
    scoreImpact: sellScore,
    severity: sellScore >= 5 ? 'SUPER' : (sellScore <= -5 ? 'HIGH' : 'LOW')
  };
}

/**
 * 檢測 Type IIa 風險
 *
 * Type IIa 鑽石通常更純淨,但亦可能是 HPHT 處理候選者
 * D 色 + Type IIa = 需要注意「油感」風險
 */
function checkTypeIIaRisk(data) {
  const color = (data.color || '').toUpperCase().trim();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const reportNo = (data.reportNo || '').toUpperCase();

  // 檢測 Type IIa
  const isTypeIIa = comments.includes('type iia') ||
                    comments.includes('type ii a') ||
                    comments.includes('type ii') ||
                    reportNo.includes('IIA');
  // 檢測 Type IIb (含有硼,帶極微藍) - v3.0.0 新增
  const isTypeIIb = comments.includes('type iib') ||
                    comments.includes('type ii b') ||
                    reportNo.includes('IIB');

  // Type IIb = "Super D" 效果 (v3.0.0 新增)
  if (isTypeIIb) {
    if (color === 'D') {
      return {
        type: 'super',
        label: '💎💎💎 Super D (Type IIb 硼鑽)',
        detail: 'Type IIb = 含有硼,帶極微藍,D 色變得更白,拍賣級溢價',
        scoreImpact: 8,
        severity: 'SUPER'
      };
    } else if (color === 'E') {
      return {
        type: 'info',
        label: '💎💎 Type IIb (硼鑽)',
        detail: 'Type IIb 硼鑽,輕微藍底增加價值',
        scoreImpact: 5,
        severity: 'INFO'
      };
    } else {
      return {
        type: 'info',
        label: '💎 Type IIb (硼鑽)',
        detail: 'Type IIb 硼鑽,稀有類型',
        scoreImpact: 3,
        severity: 'INFO'
      };
    }
  }



  if (!isTypeIIa) return null;

  // D 色 + Type IIa = HPHT 風險警告
  if (color === 'D') {
    return {
      type: 'warning',
      label: '⚠️ Type IIa + D Color: HPHT 風險候選',
      detail: 'Type IIa 鑽石可能是 HPHT 處理的候選者,注意「油感」問題',
      scoreImpact: -10,
      severity: 'HIGH'
    };
  }

  // 一般 Type IIa 警告
  return {
    type: 'info',
    label: '💎 Type IIa: 高純淨類型',
    detail: 'Type IIa = 最純淨的鑽石類型,拍賣級品質',
    scoreImpact: 3,
    severity: 'INFO'
  };
}

/**
 * 檢測底尖條件 (Culet Condition) - 黑眼圈效應
 *
 * 如果 Culet 是 Slightly Large 或更大,石頭中心會出現黑色圓點
 */
function checkCuletRisk(data) {
  const culet = (data.culet || '').toLowerCase();

  if (!culet || culet === 'none' || culet === 'unknown') return null;

  // 黑眼圈效應:Culet 太大
  if (culet.includes('large') || culet.includes('medium large')) {
    return {
      type: 'warning',
      label: '⚠️ Black Eye Effect (黑眼圈)',
      detail: `Culet ${culet} = 石頭中心出現黑色圓點`,
      scoreImpact: -10,
      severity: 'HIGH'
    };
  }

  // Culet 稍大
  if (culet.includes('slightly large')) {
    return {
      type: 'info',
      label: '💡 Large Culet (偏大底尖)',
      detail: `Culet ${culet} = 可能輕微影響中心亮度`,
      scoreImpact: -3,
      severity: 'LOW'
    };
  }

  return null;
}

/**
 * 檢測 Emerald Cut 大石顏色風險 (v7.7.0)
 *
 * 5卡以上 Emerald + H色或更低 = 色帶可見風險
 * Emerald 的開放式刻面設計讓顏色更容易被察覺
 */
function checkEmeraldColorRisk(data) {
  const shape = (data.shape || '').toLowerCase();
  if (!shape.includes('emerald')) return null;


  const carat = parseFloat(data.carat) || 0;
  const color = (data.color || '').toUpperCase().trim();


  // 5卡以上 + H色或更低 = 警告
  const LOW_COLOR_THRESHOLD = 2; // 0=D, 1=E, 2=F, 3=G, 4=H
  const colorOrder = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  const colorIndex = colorOrder.indexOf(color);

  if (carat > 5 && colorIndex >= LOW_COLOR_THRESHOLD) {
    return {
      type: 'warning',
      label: '⚠️ Color Visibility Risk (Emerald 大石)',
      detail: `${carat.toFixed(2)}ct Emerald + ${color}色 = 色帶可見風險,Emerald 開放式刻面設計讓顏色更容易被察覺,H色係安全底線`,
      scoreImpact: -15,
      severity: 'HIGH'
    };
  }

  return null;
}

/**
 * 檢測腰圍狀態 (Girdle Condition)
 *
 * Bruted (磨砂白) 比 Polished/Faceted 睇起低檔
 */
function checkGirdleCondition(data) {
  const girdle = (data.girdle || '').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();

  if (!girdle) return null;

  // Bruted = 磨砂白 (睇起低檔)
  if (girdle.includes('bruted') && !girdle.includes('polished')) {
    return {
      type: 'info',
      label: '⚠️ Bruted Girdle (磨砂腰)',
      detail: '腰圍為磨砂白,工藝感較低,但不影響火彩',
      scoreImpact: -2,
      severity: 'LOW'
    };
  }

  // Polished/Faceted = 較高級 (v7.6.1: +8 points, NOT +2!)
  if (girdle.includes('polished') || girdle.includes('faceted')) {
    return {
      type: 'info',
      label: '💎 Polished/Faceted Girdle (拋光腰)',
      detail: '腰圍精工拋光,高級工藝',
      scoreImpact: 8,
      severity: 'INFO'
    };
  }

  // v7.6.1: Very Thin girdle = -15 points (Chipping Risk)
  if (/very thin|extremely thin/i.test(girdle)) {
    return {
      type: 'warning',
      label: '⚠️ Chipping Risk: Very Thin Girdle',
      detail: `Girdle: ${data.girdle} - 側面薄弱,易損壞,扣15分`,
      scoreImpact: -15,
      severity: 'MEDIUM'
    };
  }

  // v7.6.1: Chip at girdle edge = -15 points
  if (/chip/i.test(comments) || /chip/i.test(girdle)) {
    return {
      type: 'warning',
      label: '⚠️ Chipping: Chip at Girdle Edge',
      detail: 'Girdle edge 有 chip,易損壞,扣15分',
      scoreImpact: -15,
      severity: 'MEDIUM'
    };
  }

  return null;
}

/**
 * 尋找低評級美鑽 (Under-graded Hunter)
 *
 * 大師直覺:E 色 + Strong Blue 螢光 + 乾淨石頭 = 實物極大機會睇落似 D 色
 */
function checkUnderGradedHunter(data) {
  const color = (data.color || '').toUpperCase().trim();
  const fluor = (data.fluorescence || '').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();

  // 檢查是否乾淨石頭 (無 Cloud/Grain)
  const hasClouds = comments.includes('cloud') || keyToSymbols.includes('cloud');
  const hasGraining = comments.includes('grain') || keyToSymbols.includes('grain');
  const isCleanStone = !hasClouds && !hasGraining;

  // E 色 + Strong Blue + 乾淨 = 潛在升級
  if (color === 'E' && fluor.includes('strong') && fluor.includes('blue') && isCleanStone) {
    return {
      type: 'super_find',
      label: '💎💎💎 UNDER-GRADED: 潛在 D 色效果',
      detail: 'E 色 + Strong Blue + 乾淨 = 實物可能睇落似 D 色,升級價值 +5',
      scoreImpact: 5,
      severity: 'SUPER_FIND'
    };
  }

  // D 色 + Medium Blue + 乾淨 = 可能睇落更白
  if (color === 'D' && fluor.includes('medium') && fluor.includes('blue') && isCleanStone) {
    return {
      type: 'super_find',
      label: '💎💎 UNDER-GRADED: 極致白效果',
      detail: 'D 色 + Medium Blue + 乾淨 = 實物極白,升級價值 +3',
      scoreImpact: 3,
      severity: 'SUPER_FIND'
    };
  }

  return null;
}

/**
 * 檢測超優質切工 (H&A + Super Ideal)
 *
 * 必須同時滿足:
 * - Table: 54-57%
 * - Depth: 61-62.5%
 * - Polish: Excellent
 * - Symmetry: Excellent
 */
function checkSuperIdeal(data) {
  const shape = (data.shape || '').toLowerCase();
  const tablePct = parseFloat(data.tablePct) || 0;
  const depthPct = parseFloat(data.depthPct) || 0;
  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();

  // 僅適用於 Round
  if (!shape.includes('round')) return null;

  // Check all conditions
  const hasIdealTable = tablePct >= 54 && tablePct <= 57;
  const hasIdealDepth = depthPct >= 61 && depthPct <= 62.5;
  const hasExPolish = polish === 'excellent';
  const hasExSym = symmetry === 'excellent';

  if (hasIdealTable && hasIdealDepth && hasExPolish && hasExSym) {
    return {
      type: 'super_ideal',
      label: '💎💎💎 SUPER IDEAL / H&A (最高等級)',
      detail: `Table ${tablePct.toFixed(1)}% + Depth ${depthPct.toFixed(1)}% + 3EX,光學性能頂尖`,
      scoreImpact: 15, // 最高加分
      severity: 'SUPER_IDEAL'
    };
  }

  // Near Super Ideal (差一項)
  let nearCount = 0;
  if (hasIdealTable) nearCount++;
  if (hasIdealDepth) nearCount++;
  if (hasExPolish) nearCount++;
  if (hasExSym) nearCount++;

  if (nearCount >= 3 && nearCount < 4) {
    return {
      type: 'info',
      label: '💎 Near Super Ideal (接近最高)',
      detail: '接近超優質切工,4項中符合3項',
      scoreImpact: 5,
      severity: 'INFO'
    };
  }

  return null;
}

/**
 * 檢測「基於雲狀物評級」風險
 *
 * 如果 Comment 寫 "Clarity grade is based on clouds that are not shown"
 * 代表淨度可能被低估 (實際可能更差)
 */
function checkClarityBasedOnClouds(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();

  if (comments.includes('clarity grade is based on clouds that are not shown') ||
      comments.includes('grade is based on clouds not shown')) {
    return {
      type: 'warning',
      label: '⚠️ CLARITY ON HOLD: 可能低估',
      detail: '「基於未顯示的雲狀物評級」= 實際淨度可能比證書更差,強烈建議親眼確認',
      scoreImpact: -15, // 視為接近邊界
      severity: 'HIGH'
    };
  }

  return null;
}

// ============================================================================
// v4.1.0 HELPERS
// ============================================================================

/**
 * v4.1.0: Helper to check both keyToSymbols AND Comments for a pattern
 * Fixes the Regex Gap where Cloud/Grain detection only checked Comments
 */
function checkBothField(data, pattern) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  return new RegExp(pattern, 'i').test(comments) || new RegExp(pattern, 'i').test(keyToSymbols);
}

/**
 * v4.1.0: Graining & Polish Line Risk for Investment Grade
 *
 * 對於 D/IF 等級的「晶體生長特徵」會削弱投資拍賣價值
 */
function evaluateGrainingRisk(data, flags, isInvestmentGrade) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const symbols = (data.keyToSymbols || []).join(' ').toLowerCase();

  // 檢查 Graining - 使用 checkBothField 避免 regex gap
  const hasGraining = checkBothField(data, 'graining');
  const hasSurfaceGraining = /surface graining/i.test(comments);
  const hasInternalGraining = /internal graining/i.test(comments);

  if (isInvestmentGrade && hasGraining) {
    let penalty = 0;
    let detail = '';

    if (hasInternalGraining) {
      penalty = 12;
      detail = '發現內部生長紋 (Internal Graining)。即使是 IF 等級,此特徵會削弱光線反射,減弱投資拍賣價值。';
    } else if (hasSurfaceGraining) {
      penalty = 8;
      detail = '發現表面生長紋 (Surface Graining)。對 D/IF 等級石頭而言,這類缺陷會破壞「完美」形象,拍賣行會大打折。';
    } else {
      penalty = 5;
      detail = '提供 Graining 相關描述。石頭可能被評級為「微鏡」而非「無暇」。';
    }

    flags.push({
      flag: '⚠️ INVESTMENT WARNING: Graining Detected',
      severity: 'MEDIUM',
      detail: detail
    });

    return -penalty;
  }

  return 0;
}

// ============================================================================
// v5.1.0: VVS1 OILY RISK + SPREAD FACTOR DEPTH CHECK + STANDARD DIAMETER MAP
// ============================================================================

/**
 * v5.1.0: VVS1 + Graining + Strong Blue = Oily Risk
 *
 * 這是最高級別的油感風險組合
 * VVS1 + Internal Graining + Strong Blue = Oily Risk (-15)
 */
function checkVVS1OilyRisk(data) {
  const clarity = data.clarity || '';
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const fluorescence = data.fluorescence || '';

  // VVS1 等級
  if (clarity !== 'VVS1') return null;

  // 有 Internal Graining
  const hasGraining = /internal graining|graining/i.test(comments) ||
                      /internal graining|graining/i.test(keyToSymbols);
  if (!hasGraining) return null;

  // 有 Strong Blue 熒光
  const hasStrongFluor = /strong|very strong/i.test(fluorescence) &&
                         /blue/i.test(fluorescence);
  if (!hasStrongFluor) return null;

  return {
    type: 'critical',
    label: '❌ CRITICAL: VVS1 + Graining + Strong Blue = Oily Risk',
    detail: 'VVS1 + Internal Graining + Strong Blue = 最致命的油感組合,實物看起來油膩不清澈',
    scoreImpact: -15,
    severity: 'CRITICAL'
  };
}

/**
 * v5.1.0: 視覺直徑溢價修正 (Spread Factor Adjustment)
 *
 * Spread Factor 大的石頭如果 Depth < 58%,會出現 Fish-eye,中間漏光
 * 所以加分需要減半
 */
function checkSpreadFactorWithDepth(data) {
  const spreadFactor = parseFloat(data.spreadFactor) || 0;
  const depthPct = parseFloat(data.depthPct) || 0;
  const tablePct = parseFloat(data.tablePct) || 0;

  // 如果有 Spread Factor
  if (spreadFactor > 0) {
    // 如果 Depth < 58% 且 Table > 60%,可能是 Fish-eye
    if (depthPct < 58 && tablePct > 60) {
      return {
        type: 'warning',
        label: '⚠️ Spread + Fish-eye Risk (視覺大但漏光)',
        detail: 'Spread ' + spreadFactor.toFixed(0) + '% 但 Depth ' + depthPct.toFixed(1) + '% < 58% = Fish-eye 風險,加分減半',
        scoreImpact: spreadFactor * 0.5,
        originalSpread: spreadFactor,
        adjustedSpread: spreadFactor * 0.5,
        severity: 'MEDIUM'
      };
    }

    // 如果 Depth 在理想範圍內 (58-63%),加分正常
    if (depthPct >= 58 && depthPct <= 63) {
      return {
        type: 'info',
        label: '💎 Spread Bonus: +' + spreadFactor.toFixed(0) + '% (視覺加分)',
        detail: 'Spread ' + spreadFactor.toFixed(0) + '% + Depth ' + depthPct.toFixed(1) + '% 正常 = 加分正常',
        scoreImpact: spreadFactor,
        severity: 'INFO'
      };
    }
  }

  return null;
}

/**
 * v5.1.0: 標準直徑表 (Standard Diameter Map)
 *
 * 0.90ct 到 1.00ct 之間的標準直徑變化並非線性
 * 需要一個標準直徑表來準確計算 Spread Factor
 */
const STANDARD_DIAMETER_MAP = {
  0.30: 4.30,
  0.40: 4.80,
  0.50: 5.20,
  0.60: 5.50,
  0.70: 5.75,
  0.80: 5.95,
  0.90: 6.15,
  0.95: 6.20,
  1.00: 6.40,
  1.20: 6.80,
  1.50: 7.40,
  2.00: 8.20
};

function getStandardDiameter(carat) {
  // 找到最接近的標準重量
  const weights = Object.keys(STANDARD_DIAMETER_MAP).map(Number).sort(function(a, b) { return a - b; });

  // 找到最近的權重
  let closest = weights[0];
  let minDiff = Math.abs(carat - closest);

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    const diff = Math.abs(carat - w);
    if (diff < minDiff) {
      minDiff = diff;
      closest = w;
    }
  }

  // 如果差距太大,返回線性估算
  if (minDiff > 0.1) {
    const baseWeight = weights.reduce(function(prev, curr) {
      return Math.abs(carat - curr) < Math.abs(carat - prev) ? curr : prev;
    });
    const baseDiameter = STANDARD_DIAMETER_MAP[baseWeight];
    const baseCarat = baseWeight;
    return baseDiameter + (carat - baseCarat) * 0.01;
  }

  return STANDARD_DIAMETER_MAP[closest];
}

// ============================================================================
// v5.0.0: BROWNISH TINT DETECTION
// ============================================================================

/**
 * v5.0.0: 褐色調檢測 (Brownish Tint Detection)
 * 褐色調的鑽石火彩極差,在市場上比帶黃色的便宜 20-30%
 */
function checkBrownishTint(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const color = (data.color || '').toLowerCase();
  const hasBrownish = /brownish|brown.*tint|light brown|medium brown|dark brown/i.test(comments);
  const hasGreenish = /greenish|green.*tint|light green|medium green/i.test(comments);
  const hasGrayish = /grayish|gray.*tint|light gray|medium gray/i.test(comments);
  const hasMuddy = /muddy|muddy color|muddy appearance/i.test(comments);
  const hasTint = hasBrownish || hasGreenish || hasGrayish || hasMuddy;
  if (hasTint) {
    let severity = 'HIGH';
    let scoreImpact = -20;
    let label = '❌ CRITICAL: Brownish/Grayish Tint (褐色調/灰調)';
    let detail = '發現顏色偏向:';
    if (hasBrownish) detail += ' 褐色';
    if (hasGreenish) detail += ' 綠色';
    if (hasGrayish) detail += ' 灰色';
    if (hasMuddy) detail += ' 泥土色';
    detail += '色調。此類石頭火彩極差,市場價格比正常黃色調低 20-30%。';
    const highColor = ['d', 'e', 'f'].includes(color);
    if (highColor && (hasBrownish || hasMuddy)) {
      severity = 'CRITICAL';
      scoreImpact = -30;
      label = '❌ CRITICAL: High Color + Tint (高色帶褐色)';
      detail = '高色(D-F)卻帶褐/泥土色 = 最致命的組合,拍賣行直接拒絕。';
    }
    return {
      type: severity === 'CRITICAL' ? 'critical' : 'warning',
      label: label,
      detail: detail,
      scoreImpact: scoreImpact,
      severity: severity
    };
  }
  return null;
}

// ============================================================================
// v5.0.0: CLOUD POSITION CHECK
// ============================================================================

/**
 * v5.0.0: 雲狀物分佈檢測 (Cloud Position Detection)
 * Cloud 在 keyToSymbols 的位置代表其重要性
 */
function checkCloudPosition(data) {
  const keyToSymbols = data.keyToSymbols || [];
  if (keyToSymbols.length === 0) return null;
  const cloudIndex = keyToSymbols.findIndex(symbol =>
    /cloud/i.test(symbol)
  );
  if (cloudIndex === -1) return null;
  if (cloudIndex === 0) {
    return {
      type: 'warning',
      label: '⚠️ Cloud as Main Inclusion (雲狀物為主要瑕疵)',
      detail: 'Cloud 位於 Key to Symbols 第一位 = 這是主要瑕疵。即使淨度看似乾淨,實物可能受其影響。',
      scoreImpact: -10,
      severity: 'MEDIUM'
    };
  }
  if (cloudIndex === 1) {
    return {
      type: 'info',
      label: '💡 Cloud as Secondary Inclusion (雲狀物為次要瑕疵)',
      detail: 'Cloud 位於第二位,影響較小。',
      scoreImpact: -3,
      severity: 'LOW'
    };
  }
  if (cloudIndex === keyToSymbols.length - 1 && keyToSymbols.length === 1) {
    return {
      type: 'info',
      label: '💎 Cloud Only (唯一的瑕疵)',
      detail: 'Cloud 是唯一的瑕疵,通常表示 eye-clean。',
      scoreImpact: 3,
      severity: 'INFO'
    };
  }
  return null;
}

// ============================================================================
// v5.0.0: LASER DRILL HOLE DETECTION
// ============================================================================

/**
 * v5.0.0: 激光鑽孔檢測 (Laser Drill Hole Detection)
 * LDH 屬於人為優化,應直接觸發 Zombie Score = 0
 */
function checkLaserDrillHole(data, flags) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;
  const hasLDH = fuzzyMatch(combinedText, CRITICAL_PATTERNS.laserDrillHole);
  const hasFractureFilled = fuzzyMatch(combinedText, CRITICAL_PATTERNS.fractureFilled);
  if (hasLDH) {
    flags.push({
      flag: '❌ REJECT: Laser Drill Hole (激光鑽孔)',
      severity: 'CRITICAL',
      detail: '發現激光鑽孔 (Laser Drill Hole),這是人為優化處理,Zombie Score = 0,直接 REJECT。'
    });
    return { scoreImpact: -100, isReject: true };
  }
  if (hasFractureFilled) {
    flags.push({
      flag: '❌ REJECT: Fracture Filled (裂隙填充)',
      severity: 'CRITICAL',
      detail: '發現裂隙填充 (Fracture Filled),GIA 不對此類優化石出證,但證書可能有殘留標記。'
    });
    return { scoreImpact: -100, isReject: true };
  }
  return null;
}

/**
 * v4.1.0: Pavilion Depth Risk - 底部太深導致 Headlight Effect
 *
 * 當底部太深,光線會在內部產生過多反射,
 * 這就是 "Headlight Effect",會使石頭看起來有一塊死白或黑影
 */
function checkPavilionDepthRisk(data) {
  const depthPct = parseFloat(data.depthPct) || 0;
  const shape = (data.shape || '').toLowerCase();
  // 僅適用於異形石 (非 Round Brilliant)
  if (shape.includes('round')) return null;
  // 太淺:Fish-eye Effect
  if (depthPct < 38) {
    return {
      type: 'warning',
      label: '⚠️ Fish-eye Effect (魚眼 - 太淺)',
      detail: '深度 ' + depthPct.toFixed(1) + '% < 38% = 光線從腰部漏出,中心黑暗',
      scoreImpact: -15,
      severity: 'HIGH'
    };
  }
  // 太深:Headlight Effect
  if (depthPct > 45) {
    return {
      type: 'warning',
      label: '⚠️ Headlight Effect (死區火彩 - 太深)',
      detail: '深度 ' + depthPct.toFixed(1) + '% > 45% = 光線在底部產生過多反射,中心漏光',
      scoreImpact: -15,
      severity: 'HIGH'
    };
  }
  // 偏深但可接受
  if (depthPct > 42 && depthPct <= 45) {
    return {
      type: 'info',
      label: '💡 Deep Pavilion (偏深)',
      detail: '深度 ' + depthPct.toFixed(1) + '% 偏深,火彩可能受影響',
      scoreImpact: -5,
      severity: 'LOW'
    };
  }
  // 理想範圍
  if (depthPct >= 38 && depthPct <= 42) {
    return {
      type: 'info',
      label: '💎 Ideal Pavilion Depth (理想底部深度)',
      detail: '深度 ' + depthPct.toFixed(1) + '% = 理想範圍,光學性能優秀',
      scoreImpact: 3,
      severity: 'INFO'
    };
  }
  return null;
}

/**
 * v4.1.0: Enhanced Haze Matrix with Short-circuit + Creamy Tint Detection
 *
 * 熔斷機制:當觸發 CRITICAL 問題時,立即返回不允許任何補償
 * 新增 Creamy Tint 風險:M色以下 + Strong Blue = Dirty Creamy 外觀
 */
function checkHazeMatrix(data, flags) {
  const hasStrongFluor = /Strong Blue|Very Strong Blue/i.test(data.fluorescence || '');
  const hasMediumFluor = /Medium Blue/i.test(data.fluorescence || '');
  const colorUpper = (data.color || '').toUpperCase();

  // 使用 checkBothField 避免 regex gap
  const hasClouds = checkBothField(data, 'cloud');
  const hasGrain = checkBothField(data, 'graining');

  // 檢查 Clarity on Hold (只用 comments,因為係 comment 文字)
  const comments = (data.comments || []).join(' ').toLowerCase();
  const hasClarityOnHold = /clarity grade is based on clouds/i.test(comments);

  // === TRAP A: 致命朦朧 (Strong Fluor + Clarity on Hold) ===
  // 熔斷:立即返回,不允許任何補償
  if (hasStrongFluor && hasClarityOnHold) {
    return {
      scoreImpact: -50,
      flag: '❌ CRITICAL: MILKY/HAZY TRAP',
      detail: '強熒光結合雲狀物評級,寶石100%朦朧,透明度嚴重受損,建議直接放棄',
      isShortCircuit: true // 標記為熔斷
    };
  }

  // === TRAP B: 高風險油感 (Strong Fluor + SI + Clouds) ===
  if (hasStrongFluor && (data.clarity || '').includes('SI') && hasClouds) {
    return {
      scoreImpact: -25,
      flag: '⚠️ HIGH RISK: Oily/Blurry Appearance',
      detail: '強熒光在 SI 淨度的雲狀物反映下會產生「油感」',
      isShortCircuit: true
    };
  }

  // === TRAP C: 安全熒光 (High Clarity + No Cloud/Grain) ===
  if (hasStrongFluor && ['VVS1', 'VVS2', 'IF', 'FL'].includes(data.clarity) && !hasClouds && !hasGrain) {
    return {
      scoreImpact: 0,
      flag: '✅ SAFE FLUORESCENCE',
      detail: '強熒光但淨度頂級且無雲狀物/紋理,寶石能保持清澈'
    };
  }

  // === v4.1.0 NEW: Creamy Tint Risk - M色以下 + Strong Blue ===
  const lowColors = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  if (lowColors.includes(colorUpper) && hasStrongFluor) {
    return {
      scoreImpact: -15, // 補償取消並額外扣分
      flag: '⚠️ WARNING: Creamy Tint Risk (油感風險)',
      detail: 'M色以下 + Strong/Very Strong Blue = Dirty Creamy 外觀,補償減少並扣分',
      isShortCircuit: false
    };
  }

  // === v4.1.0 NEW: Medium Blue 對低色的補償減半 ===
  if (hasMediumFluor && ['K', 'L', 'M'].includes(colorUpper)) {
    return {
      scoreImpact: 1.5, // 從 +3 減到 +1.5
      flag: '💡 Reduced Compensation (補償減半)',
      detail: 'K/L/M 色 + Medium Blue 補償因色度過低而減半',
      isShortCircuit: false
    };
  }

  return null;
}

// ============================================================================
// v4.0.0: Investment Grade Analysis + Haze Matrix (Anti-Milky System)
// ============================================================================

/**
 * v4.0.0: Investment Grade Analysis (Blue Chip Logic)
 *
 * 識別能在蘇富比/佳士得拍賣的「全明珠」級別鑽石
 */
function checkInvestmentGradeUltimate(data, score, flags) {
  const isDColor = data.color === 'D';
  const isTopClarity = ['FL', 'IF'].includes(data.clarity);
  const isTripleEx = (data.polish || '').toLowerCase() === 'excellent' &&
                     (data.symmetry || '').toLowerCase() === 'excellent' &&
                     (data.cut || '').toLowerCase() === 'excellent';
  const isNoneFluor = (data.fluorescence || '').toLowerCase().includes('none');
  const comments = (data.comments || []).join(' ');
  const isTypeIIa = /Type IIa/i.test(comments);

  // 檢查 H&A / Super Ideal
  const superIdealResult = checkSuperIdeal(data);
  const isSuperIdeal = superIdealResult ? superIdealResult.type === 'super_ideal' : false;

  // 1. 核心藍籌 (The Holy Grail)
  if (isDColor && isTopClarity && isTripleEx && isNoneFluor) {
    let bonus = 15;
    let label = '💎💎💎 INVESTMENT GRADE (Blue Chip)';

    // 如果再加上 Type IIa 和 H&A 特徵,則是博物館級
    if (isTypeIIa && isSuperIdeal) {
      bonus += 10;
      label = '🏛️ MUSEUM GRADE / AUCTION QUALITY';
    }

    const typeIIDetail = isTypeIIa ? 'Type IIa ' : '';
    const haDetail = isSuperIdeal ? (isTypeIIa ? '+ H&A' : 'H&A') : '';
    const extraText = isTypeIIa || isSuperIdeal ? `額外提升` : '';

    flags.push({
      flag: label,
      severity: 'LOW',
      detail: `全頂級配置組合是鑽石投資的黃金標準。D/IF/3EX/None 是基本門檻,${typeIIDetail}${haDetail} ${extraText}至${bonus}分`
    });
    return bonus;
  }

  return 0;
}

/**
 * v4.0.0: Haze Matrix (Anti-Milky Defense)
 *
 * 破解「六琢霧二地雷貨」的困境
 * 熒光本身不可怕,可怕的是與瑕疵的組合
 *
 * NOTE: This is the v4.0.0 legacy version kept for compatibility.
 * The v4.1.0 enhanced version with short-circuit is checkHazeMatrix() above.
 */
// v4.0.0: Legacy Haze Matrix - removed (now using checkHazeMatrix v4.1.0 with short-circuit)
// checkHazeMatrixLegacy was kept for compatibility but is no longer called

// ============================================================================
// v5.2.0 + v6.0.0 NEW FUNCTIONS
// ============================================================================

/**
 * v5.2.0: Fish-eye 二次防線 (Enhanced Fish-eye Detection)
 *
 * Table > 62% + Depth < 59% = 極明顯魚眼
 * (比之前更嚴重因為可以在檯面下看到腰圍反射影)
 */
function checkFishEyeEnhanced(data) {
  const tablePct = parseFloat(data.tablePct) || 0;
  const depthPct = parseFloat(data.depthPct) || 0;
  const shape = (data.shape || '').toLowerCase();
  const carat = parseFloat(data.carat) || 0;

  // v7.8.0: Briolette has no table - skip fish-eye check
  if (isBrioletteShape(data)) return null;


  // 僅適用於 Round
  if (!shape.includes('round')) return null;

  // === v11.0.0: 魚眼視覺補償幾何級增長 (Geometric Carat Multiplier) ===
  // carat >= 20ct → 扣分變 3倍 (-15 → -45)
  // carat >= 10ct → 扣分變 2倍 (-15 → -30)
  const fishEyeBaseScore = -15;
  let caratMultiplier = 1.0;
  let caratNote = '';
  if (carat >= 20) {
    caratMultiplier = 3.0;
    caratNote = ` (3x: ${carat.toFixed(2)}ct ≥ 20ct)`;
  } else if (carat >= 10) {
    caratMultiplier = 2.0;
    caratNote = ` (2x: ${carat.toFixed(2)}ct ≥ 10ct)`;
  }

  // === v10.0.0: 魚眼物理連動 (Physical Fish-eye Linkage) ===
  if (tablePct > 64 && depthPct < 58) {
    const adjustedScore = Math.round(fishEyeBaseScore * caratMultiplier);
    return {
      type: 'warning',
      label: '⚠️ Fish-eye Effect (魚眼:物理連動)',
      detail: `Round shape + Table ${tablePct.toFixed(1)}% > 64% + Depth ${depthPct.toFixed(1)}% < 58% = 物理連動魚眼效應${caratNote}`,
      scoreImpact: adjustedScore,
      severity: 'HIGH',
      isPhysicalLinkage: true,
      caratMultiplier: caratMultiplier
    };
  }

  // 極明顯魚眼:Table > 62% + Depth < 59%
  if (tablePct > 62 && depthPct < 59) {
    const adjustedScore = Math.round(-20 * caratMultiplier);
    return {
      type: 'critical',
      label: '❌ CRITICAL: Severe Fish-eye (極明顯魚眼)',
      detail: `Table ${tablePct.toFixed(1)}% > 62% + Depth ${depthPct.toFixed(1)}% < 59% = 魚眼極明顯${caratNote}`,
      scoreImpact: adjustedScore,
      severity: 'CRITICAL',
      caratMultiplier: caratMultiplier
    };
  }

  // 普通魚眼:Table > 60% + Depth < 58%
  if (tablePct > 60 && depthPct < 58) {
    const adjustedScore = Math.round(fishEyeBaseScore * caratMultiplier);
    return {
      type: 'warning',
      label: '⚠️ Fish-eye Effect (魚眼)',
      detail: `Table ${tablePct.toFixed(1)}% + Depth ${depthPct.toFixed(1)}% = 魚眼效應${caratNote}`,
      scoreImpact: adjustedScore,
      severity: caratMultiplier > 1 ? 'HIGH' : 'MEDIUM',
      caratMultiplier: caratMultiplier
    };
  }

  return null;
}

/**
 * v5.2.0: Premium Cut 補償
 *
 * 深度異形石故意切深(63-65%)來消除領結
 * 如果 Pavilion Depth 完美且無領結標記 = Premium Cut (+5)
 */
function checkPremiumCut(data) {
  const depthPct = parseFloat(data.depthPct) || 0;
  const pavilionDepth = data.pavilionDepth || 0;
  const shape = (data.shape || '').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const ratio = parseFloat(data.ratio) || 0;

  // 僅適用於異形石 (Oval/Pear/Marquise)
  if (!shape.includes('oval') && !shape.includes('pear') && !shape.includes('marquise')) {
    return null;
  }

  // 深度在 63-65% 之間
  if (depthPct >= 63 && depthPct <= 65) {
    // 檢查是否有領結標記
    const hasBowTie = comments.includes('bow-tie') || comments.includes('bow tie');

    // 如果無領結標記 + Pavilion 完美 = Premium Cut
    if (!hasBowTie) {
      // Pavilion Depth 如果有的話應該在 43% 左右
      if (pavilionDepth > 0 && pavilionDepth >= 42 && pavilionDepth <= 45) {
        return {
          type: 'info',
          label: '💎 Premium Cut (優質深切)',
          detail: `Depth ${depthPct.toFixed(1)}% + 無領結 + Pavilion ${pavilionDepth.toFixed(1)}% = 優質深切,消除領結的同時保持火彩`,
          scoreImpact: 5,
          severity: 'INFO'
        };
      }

      // 即使沒有 Pavilion Depth 數據,如果 Ratio 正常也是好跡象
      if (ratio > 0 && ratio <= 2.0 && ratio >= 1.3) {
        return {
          type: 'info',
          label: '💎 Premium Cut (優質深切)',
          detail: `Depth ${depthPct.toFixed(1)}% + 無領結 + Ratio ${ratio.toFixed(2)} = 優質深切,消除領結`,
          scoreImpact: 3,
          severity: 'INFO'
        };
      }
    }
  }

  return null;
}

/**
 * v6.1.1: 關鍵字權重表增強
 *
 * 升級關鍵字 (Upgrade Potential):
 * - girdle, edge, side, pavilion, feather, corner
 *
 * 降級關鍵字 (Downgrade Risk):
 * - table, center, under table, top, middle
 */
const UPGRADE_KEYWORDS = ['girdle', 'edge', 'side', 'pavilion', 'feather', 'corner', 'near girdle'];
const DOWNGRADE_KEYWORDS = ['table', 'center', 'under table', 'crown', 'top', 'middle'];

/**
 * v6.1.1: 淨度升降級預測 (Clarity Upgrade/Downgrade Prediction)
 *
 * VVS2 + Edge Pinpoint → 可能升 VVS1 (+5)
 * VS1 + Center Black Crystal → 只值 VS2 (-10)
 */
function checkClarityPrediction(data) {
  const clarity = data.clarity || '';
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combined = comments + ' ' + keyToSymbols;

  // VVS2 + Edge Pinpoint → 可能升 VVS1
  if (clarity === 'VVS2') {
    // 使用權重表判斷位置
    const hasUpgradePosition = UPGRADE_KEYWORDS.some(kw => combined.includes(kw));
    const hasSinglePinpoint = (keyToSymbols.match(/pinpoint/gi) || []).length === 1;
    const hasEdgeGraining = /internal graining|graining/i.test(combined) && hasUpgradePosition;

    // VVS2 + Edge/Girdle Pinpoint = +5
    if (hasUpgradePosition && hasSinglePinpoint) {
      return {
        type: 'info',
        label: '💎 Clarity Upgrade Potential (淨度升級潛力)',
        detail: 'VVS2 + 邊緣/腰圍Pinpoint = 有機會「執」成 VVS1',
        scoreImpact: 5,
        severity: 'INFO'
      };
    }

    // VVS2 + Internal Graining + 無雲狀物 = 執石候選 (+5)
    const hasGraining = /internal graining/i.test(combined);
    const hasClouds = /cloud/i.test(combined);
    if (hasGraining && !hasClouds) {
      return {
        type: 'info',
        label: '💎 Clarity Upgrade Potential (淨度升級潛力)',
        detail: 'VVS2 + Internal Graining + 無雲狀物 = 執石候選,有機會升級',
        scoreImpact: 5,
        severity: 'INFO'
      };
    }
  }

  // VS1 + Center Crystal → 只值 VS2 (-10)
  if (clarity === 'VS1') {
    const hasDowngradePosition = DOWNGRADE_KEYWORDS.some(kw => combined.includes(kw));
    const hasCrystal = /crystal/i.test(keyToSymbols);

    if (hasDowngradePosition && hasCrystal) {
      return {
        type: 'warning',
        label: '⚠️ Clarity Downgrade Risk (淨度降級風險)',
        detail: 'VS1 + Center/Table位置瑕疵 = 實物只值VS2,證書淨度被高估',
        scoreImpact: -10,
        severity: 'MEDIUM'
      };
    }

    // 黑色瑕疵在中央位置
    const hasBlackCenter = /black.*crystal/i.test(combined) && hasDowngradePosition;
    if (hasBlackCenter) {
      return {
        type: 'warning',
        label: '⚠️ Clarity Downgrade Risk (淨度降級風險)',
        detail: 'VS1 + 中央Black Crystal = 實物只值VS2',
        scoreImpact: -10,
        severity: 'MEDIUM'
      };
    }
  }

  return null;
}

/**
 * v6.0.0: 熒光色彩修正 (Fluorescence Color Correction)
 *
 * Strong Yellow 或 Strong White 熒光會摧毀顏色價值
 */
function checkFluorescenceColor(data) {
  const fluorescence = data.fluorescence || '';
  const fluorLower = fluorescence.toLowerCase();

  // Strong Yellow 熒光
  if (/strong.*yellow|yellow.*strong/i.test(fluorLower)) {
    return {
      type: 'critical',
      label: '❌ CRITICAL: Strong Yellow Fluorescence (強黃熒光)',
      detail: '強黃色熒光會徹底摧毀鑽石的白度,市場上極難交易',
      scoreImpact: -30,
      severity: 'CRITICAL'
    };
  }

  // Strong White 熒光
  if (/strong.*white|white.*strong/i.test(fluorLower)) {
    return {
      type: 'warning',
      label: '⚠️ Strong White Fluorescence (強白熒光)',
      detail: '強白色熒光可能影響火彩,特別是在室內光線下',
      scoreImpact: -15,
      severity: 'MEDIUM'
    };
  }

  // Medium Yellow
  if (/medium.*yellow|yellow.*medium/i.test(fluorLower)) {
    return {
      type: 'warning',
      label: '⚠️ Medium Yellow Fluorescence (中度黃熒光)',
      detail: '中度黃熒光影響顏色價值,特別是對高色石頭',
      scoreImpact: -15,
      severity: 'MEDIUM'
    };
  }

  return null;
}

// ============================================================================
// v6.1.0: CREAMY STONE COMPREHENSIVE CHECK
// ============================================================================

/**
 * v6.1.0: 奶油石綜合判定 (Creamy Stone Comprehensive Check)
 *
 * 聯動條件:Symmetry: VG + Cloud + Strong Fluor
 * 只要這三個條件中符合兩個,這顆石大概率就是「奶油鑽」
 *
 * 奶油石的特征:
 * 1. Symmetry = VG (不完美的對稱性)
 * 2. 有 Cloud 瑕疵 (即使分散也可能是奶油)
 * 3. Strong/Very Strong Fluorescence
 *
 * 任何2項達標 = ZOMBIE = 直接REJECT
 */
function checkCreamyStoneRisk(data) {
  const symmetry = data.symmetry || '';
  const keyToSymbols = data.keyToSymbols || [];
  const comments = (data.comments || []).join(' ').toLowerCase();
  const fluorescence = data.fluorescence || '';
  const fluorLower = fluorescence.toLowerCase();

  let conditionsMet = 0;
  const conditions = [];

  // 條件1: Symmetry = VG (不是 EX, 不是 GD,是 VG)
  const hasVGSymmetry = symmetry.toUpperCase() === 'VG';
  if (hasVGSymmetry) {
    conditionsMet++;
    conditions.push('Symmetry: VG');
  }

  // 條件2: 有 Cloud 瑕疵
  const hasCloud = keyToSymbols.some(s => /cloud/i.test(s)) ||
                   /cloud/i.test(comments);
  if (hasCloud) {
    conditionsMet++;
    conditions.push('Cloud Inclusion');
  }

  // 條件3: Strong/Very Strong Fluorescence
  const hasStrongFluor = /strong|very strong/i.test(fluorLower);
  if (hasStrongFluor) {
    conditionsMet++;
    conditions.push('Strong Fluor');
  }

  // 任何2項達標 = 奶油石 = REJECT
  if (conditionsMet >= 2) {
    return {
      type: 'critical',
      label: '❌ CRITICAL: Creamy Stone (奶油石)',
      detail: `發現奶油石特徵:${conditions.join(' + ')}。這類石頭火彩極差,實物看起來油膩白蒙蒙,Zombie Score = 0,直接REJECT。`,
      scoreImpact: -100,
      severity: 'CRITICAL',
      conditions: conditions,
      isZombie: true
    };
  }

  return null;
}

/**
 * v7.9.0: Structural Haze Detection
 * 10ct+ + Cloud as main inclusion + "clouds not shown" = Structural Haze (塑料感)
 * This is CRITICAL - score goes to 0 immediately
 */
function checkStructuralHaze(data) {
  const carat = parseFloat(data.carat) || 0;
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();

  // Trigger: 10ct+ + Cloud as main + clouds not shown
  const isLargeStone = carat >= 10;
  const cloudAsMain = keyToSymbols.startsWith('cloud');
  const cloudsNotShown = comments.includes('clouds not shown');

  if (isLargeStone && cloudAsMain && cloudsNotShown) {
    return {
      type: 'CRITICAL',
      label: '💀 Structural Haze (結構性煙霧)',
      detail: `10ct+ (${carat.toFixed(2)}ct) + Cloud as main + clouds not shown = 塑料感,實物火彩極差`,
      scoreImpact: -100,
      severity: 'CRITICAL',
      isZombie: true
    };
  }

  return null;
}

/**
 * v6.1.1: 立方根公式修正
 *
 * 1. 只有 Round 形狀適用 6.47 常數(異形石不適用)
 * 2. 結果加上 .toFixed(2) 避免浮點偏差
 */
function calculateStandardDiameterCubic(carat, shape) {
  // 標準係數 (對於圓形明亮切工)
  const K = 6.47;

  // 只有 Round 形狀適用此公式
  const shapeLower = (shape || '').toLowerCase();
  if (!shapeLower.includes('round')) {
    // 異形石返回線性估算或其他方法
    return null;
  }

  const diameter = K * Math.pow(carat, 1/3);
  return parseFloat(diameter.toFixed(2)); // 加精度
}

function getStandardDiameterHybrid(carat, shape) {
  if (carat >= 0.30 && carat <= 5.00) {
    return calculateStandardDiameterCubic(carat, shape);
  }
  return calculateStandardDiameterCubic(carat, shape);
}

/**
 * 計算 Score (0-100)
 * @param {Object} cert - 證書數據(含 data 和 logicFlags)
 * @returns {number} Score (0-100)
 */
function calculateClawScore(cert) {
  // v3.0.0: OCR data sanitization
  let rawData = cert.data || cert;
  rawData = sanitizeData(rawData);
  const data = rawData;
  const flags = cert.logicFlags || [];
  let score = 100;

  // === Color Penalty ===
  // v8.3.0: Color Corruption Recovery 已移至 parseFancyColorPipeline (parseGIACertificateText Phase 2)
  // calculateClawScore 直接使用已修復的 data.color
  const isFancyColor = (data.color || '').toUpperCase().includes('FANCY');
  // P0 fix: declare variables once to avoid redeclaration in if/else branches
  let colorUpper, comments, keyToSymbols, isHighColor, fluor;

  if (isFancyColor) {
    // 彩色鑽石免 penalty,額外 +5
    score += 5; // 作為特殊資產
    const hasFancyFlag = flags.some(f => f.flag && f.flag.includes('Fancy Color'));
    if (!hasFancyFlag) {
      flags.push({
        flag: '🌈 Fancy Color Asset',
        severity: 'INFO',
        detail: `彩色 (${data.color}) 具有獨特市場價值,顏色越濃郁越值錢`
      });
    }

    // === v7.6.1: Fancy Color Modifiers (Intense/Vivid = +15) ===
    colorUpper = (data.color || '').toUpperCase();
    if (/fancy\s*(intense|vivid)/i.test(colorUpper)) {
      score += 15;
      flags.push({
        flag: '💎 Fancy Intense/Vivid Color: +15 bonus',
        severity: 'INFO',
        detail: 'Fancy Intense/Vivid 等級 = 顏色最濃郁,市場價值最高'
      });
    }

    // === v7.6.1: Secondary Hue Bonus/Penalty ===
    comments = (data.comments || []).join(' ').toLowerCase();
    keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
    const combinedText = comments + ' ' + keyToSymbols;
    // Good secondary hues: Purplish Pink, Greenish Blue, etc.
    const goodHues = /purplish pink|greenish blue|orangy pink|pinkish orange|blueish green/i;
    // Bad secondary hues: Brownish, Grayish
    const badHues = /brownish|grayish/i;
    if (goodHues.test(combinedText)) {
      score += 10;
      flags.push({
        flag: '💎 Good Secondary Hue: +10 bonus',
        severity: 'INFO',
        detail: '發現良好副色 (Purplish Pink/Greenish Blue),市場價值提升'
      });
    }
    if (badHues.test(combinedText)) {
      score -= 20;
      flags.push({
        flag: '🔴 Bad Secondary Hue: -20 penalty',
        severity: 'HIGH',
        detail: '發現不良副色 (Brownish/Grayish),市場價值大幅下降'
      });
    }
  } else {
    // === Fluorescence Compensation: Blue turns yellow into white ===
    // Fixed: Use simple color lookup instead of missing colorGrades object
    colorUpper = (data.color || '').toUpperCase().trim();
    isHighColor = /^[DEFG]$/.test(colorUpper); // D/E/F colors get compensation
    fluor = (data.fluorescence || '').toLowerCase();
    comments = (data.comments || []).join(' ').toLowerCase();
    keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();

    // 檢查是否係「滿咗」的石頭
    const hasClouds = comments.includes('cloud') || keyToSymbols.includes('cloud');
    const hasGraining = comments.includes('grain') || keyToSymbols.includes('grain');
    const isFullStone = hasClouds || hasGraining; // 內含物多 = 「滿咗」

if (isHighColor && fluor.includes('medium') && fluor.includes('blue')) {
  if (isFullStone) {
    // 滿咗的石頭:補償被抵銷
    flags.push({
      flag: '⚠️ Fluorescence Compensation Blocked (補償被抵銷)',
      detail: `${data.color} + Medium Blue 但有 Clouds/Graining,補償被抵銷`
    });
    // 不加分也不扣分
  } else {
    // 乾淨的石頭:補償 +3
    score += 3;
    flags.push({
      flag: '💎 Fluorescence Compensation: Blue turns yellow into white',
      severity: 'INFO',
      detail: `${data.color} 色 + Medium Blue = 藍光抵消黃色,提升視覺白度`
    });
  }
}

// Strong Blue 有不同的風險
if (fluor.includes('strong') && fluor.includes('blue') && isHighColor) {
  if (isFullStone) {
    // 滿咗 + Strong Blue = 朦朧風險
    score -= 10;
    flags.push({
      flag: '⚠️ Strong Blue + Full Stone = Hazy Risk',
      detail: 'Strong Blue + 有雲/紋理 = 可能朦朧'
    });
  } else {
    // K/L 色 + Strong Blue 可以特別白,但有風險
    score += 2; // 少量補償
    flags.push({
      flag: '💡 Strong Blue: K/L 色可能特別白,但有輕微朦朧風險',
      detail: '強藍光對低色石頭有漂白效果,但需注意朦朧'
    });
  }
}

// === v2.6.0: Fancy Color + Blue Fluorescence = 問題 ===
if (fluor.includes('blue')) {
  score -= 10;
  flags.push({
    flag: '⚠️ Fancy Color + Blue Fluorescence',
    severity: 'MEDIUM',
    detail: '彩色鑽石 + 藍色熒光可能影響顏色穩定性'
  });
}

    // 普通白色鑽石 penalty (v7.9.0: skip D-Z penalty for Fancy Color)
    // Fancy Color 完全繞過普通顏色評分
    const colorPenaltyMap = {
      'M': 25, 'L': 20, 'K': 10, 'J': 5,
      'I': 3, 'H': 0, 'G': 0, 'F': 0, 'E': 0, 'D': 0
    };
    // v7.9.0: 如果是 Fancy Color,直接跳過 D-Z penalty
    // Fancy stones 使用獨立的 evaluateFancyStone() 評分
    if (!isFancyColor) {
      // 普通白色鑽石 penalty
      const colorPenalty = colorPenaltyMap[colorUpper] !== undefined
        ? colorPenaltyMap[colorUpper]
        : 30;
      score -= colorPenalty;
    }
  }

  // === v8.0.0: Internal Graining 隱形殺手 (10ct+ 高淨度石頭) ===
  // 當石頭有 "Internal graining is not shown" 備註，火彩會悶
  comments = (data.comments || []).join(' ').toLowerCase();
  const hasGrainingNote = /grain|internal graining|graining is not shown/i.test(comments);
  const caratWeight = parseFloat(data.carat) || 0;
  const isHighClarity = ['IF', 'FL', 'VVS1', 'VVS2', 'VS1'].includes(data.clarity);

  if (hasGrainingNote && caratWeight >= 10) {
    score -= 5;
    flags.push({
      flag: '⚠️ Internal Graining Clarity (10ct+)',
      severity: 'MEDIUM',
      detail: 'Internal Graining noted, may affect crispness/fire in 10ct+ stone'
    });
  } else if (hasGrainingNote && isHighClarity && caratWeight >= 5) {
    // 5ct+ 高淨度石頭也有一定風險
    score -= 2;
    flags.push({
      flag: '⚠️ Internal Graining (High Clarity)',
      severity: 'LOW',
      detail: 'Internal Graining noted, may affect optical performance in high-clarity stone'
    });
  }

  // === v8.0.0: 階梯切工平行度風險 (5ct+ Emerald Cut + 非 EX 對稱) ===
  const shape = (data.shape || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();

  if (shape.includes('emerald') && caratWeight >= 5 && symmetry !== 'excellent') {
    score -= 5;
    flags.push({
      flag: '⚠️ Visual Parallelism Risk',
      severity: 'MEDIUM',
      detail: '5ct+ Emerald Cut with non-EX symmetry: step facets may show visible misalignment'
    });
  }

  // === Clarity Penalty ===
  const clarityPenaltyMap = {
    'I1': 30, 'I2': 40, 'I3': 50,
    'SI2': 10, 'SI1': 5,
    'VS2': 2, 'VS1': 0,
    'VVS2': 0, 'VVS1': 0,
    'IF': 0, 'FL': 0
  };
  score -= (clarityPenaltyMap[data.clarity] || 0);

  // === Cut Penalty (主要針對圓鑽) ===
  if (/round/i.test(data.shape)) {
    if (data.cut === 'Good') score += CONFIG.CUT_GOOD_PENALTY;
    else if (data.cut === 'Fair') score += CONFIG.CUT_FAIR_PENALTY;
    else if (data.cut === 'Poor') score += CONFIG.CUT_POOR_PENALTY;
  }


  // === Polish/Sym Penalty ===
  if (data.polish === 'Good') score += CONFIG.POLISH_GOOD_PENALTY;
  else if (data.polish !== 'Excellent' && data.polish !== 'Very Good') score += CONFIG.POLISH_POOR_PENALTY;

  if (data.symmetry === 'Good') score += CONFIG.SYMMETRY_GOOD_PENALTY;
  else if (data.symmetry !== 'Excellent' && data.symmetry !== 'Very Good') score += CONFIG.SYMMETRY_POOR_PENALTY;

  // === v8.2.0: Oval Symmetry Penalty (5ct+ Oval + non-EX Symmetry) ===
  // 異形鑽若 Symmetry 不是 EX，左右不對稱會很明顯
  const shapeLower = (data.shape || '').toLowerCase();
  if (shapeLower.includes('oval') && caratWeight >= 5 && symmetry !== 'excellent') {
    score -= 7;
    flags.push({
      flag: '⚠️ Oval Symmetry Penalty (5ct+ non-EX)',
      severity: 'MEDIUM',
      detail: `5ct+ Oval + Symmetry ${symmetry} = 異形鑽不對稱明顯,額外 -7 分`
    });
  }

  // === Girdle Thickness Penalty v7.9.0 ===
  const girdlePenalty = calculateGirdlePenalty(data.girdle, caratWeight);
  if (girdlePenalty !== 0) {
    score += girdlePenalty;
    // Add warning flag if significant
    if (girdlePenalty <= -10) {
      flags.push({
        flag: '⚠️ Girdle Thickness Penalty',
        severity: 'MEDIUM',
        detail: `Girdle penalty: ${girdlePenalty} (${data.girdle} at ${carat}ct)`
      });
    }
  }

  // === v7.9.2: Girdle Dead Weight Enforcement for 50ct+ ===
  // 50ct+ 巨鑽: 即使是 "slightly thick" 或 "thick" girdle 也需要顯示死重量資訊
  const girdleLower = (data.girdle || '').toLowerCase();
  const girdlePctMatch = girdleLower.match(/(\d+\.?\d*)\s*%/);
  const girdlePct = girdlePctMatch ? parseFloat(girdlePctMatch[1]) : null;
  
  if (caratWeight >= 50) {
    let deadWeightPenalty = 0;
    let deadWeightReason = '';
    
    if (/extremely thick/i.test(girdleLower)) {
      deadWeightPenalty = 30;
      deadWeightReason = 'Girdle: [Extremely Thick] - 30% Dead weight. ' + caratWeight.toFixed(2) + 'ct stone weight is significantly inflated.';
    } else if (/very thick/i.test(girdleLower)) {
      deadWeightPenalty = 20;
      deadWeightReason = 'Girdle: [Very Thick] - 20% Dead weight. ' + caratWeight.toFixed(2) + 'ct stone weight is inflated.';
    } else if (/thick to very thick/i.test(girdleLower)) {
      deadWeightPenalty = 20;
      deadWeightReason = 'Girdle: [Thick to Very Thick] - 20% Dead weight. ' + caratWeight.toFixed(2) + 'ct stone weight is inflated.';
    } else if (girdleLower.includes('slightly thick')) {
      deadWeightPenalty = 20;  // Higher penalty because carat bonus (+35) would cancel it out
      deadWeightReason = 'Girdle: [Slightly Thick] - 20% Dead weight. 50ct+ stone weight is inflated.';
    } else if (girdleLower.includes('thick')) {
      deadWeightPenalty = 10;
      deadWeightReason = 'Girdle: [Thick] - 10% Dead weight. Some weight in girdle.';
    } else if (girdlePct !== null && girdlePct > 4.0) {
      deadWeightPenalty = 10;
      deadWeightReason = 'Girdle: [' + girdlePct + '%] - 10% Dead weight. Girdle percentage too high for ' + caratWeight.toFixed(2) + 'ct stone.';
    }
    
    if (deadWeightPenalty > 0) {
      score = Math.max(0, score - deadWeightPenalty);
      flags.push({
        flag: '💀 Girdle Dead Weight (50ct+): -' + deadWeightPenalty,
        severity: 'CRITICAL',
        detail: deadWeightReason
      });
      data.girdlePenaltyApplied = true;
      data.girdlePenaltyAmount = deadWeightPenalty;
    } else if (girdlePct !== null) {
      flags.push({
        flag: '✅ Girdle: [Medium to Slightly Thick], ' + girdlePct + '%',
        severity: 'INFO',
        detail: 'Girdle: [Medium to Slightly Thick] - 0% Dead weight. Acceptable for ' + caratWeight.toFixed(2) + 'ct stone.'
      });
    }
  }

  // === Fluorescence Synergy v7.8.0 ===
  // v8.1.0: checkFluorescenceSynergy was merged into checkFluorescenceOffset
  const fluorSynergy = checkFluorescenceOffset(data);
  if (fluorSynergy) {
    score += fluorSynergy.bonus;
    flags.push({
      flag: '💎 Fluorescence Synergy',
      severity: 'INFO',
      detail: fluorSynergy.detail
    });
  }

  // === Fluorescence Penalty ===
  // Briolette exemption: 3D facets break up hazy look, no/fewer penalty
  const isBriolette = isBrioletteShape(data);
  const fluorPenaltyMult = isBriolette ? 0.0 : 1.0; // Full exemption for Briolette

  if (data.fluorescence && data.fluorescence !== 'None') {
    if (data.fluorescence.includes('Very Strong')) score -= Math.round(12 * fluorPenaltyMult);
    else if (data.fluorescence.includes('Strong')) score -= Math.round(8 * fluorPenaltyMult);
    else if (data.fluorescence.includes('Medium') || data.fluorescence.includes('Faint')) score -= Math.round(3 * fluorPenaltyMult);
  }

  // === Depth/Table Optical Penalty ===
  // v7.6.1: Fancy stones use evaluateFancyStone() per RTF spec - skip regular depth eval
  if (isFancyColor) {
    // Call evaluateFancyStone() for Fancy stones per RTF spec
    const fancyResult = evaluateFancyStone(data);
    score = Math.max(0, score + fancyResult.fancyScore - 80); // fancyResult.fancyScore starts at 80
    // Merge Fancy flags into main flags (avoid duplicates)
    for (const f of fancyResult.flags) {
      if (!flags.some(existing => existing.flag === f.flag)) {
        flags.push(f);
      }
    }
  } else {
    // Non-Fancy stones: use regular depth evaluation
    const depthResult = evaluateDepth(data.depthPct, data.shape, false);
    if (depthResult.status === 'critical') score -= 15;
    else if (depthResult.status === 'normal') score -= 3;
  }

  const ratioResult = evaluateRatio(data.ratio, data.shape);
  if (ratioResult.status === 'warning') score -= 8;
  else if (ratioResult.status === 'ideal') score += 2; // 理想比例加分

  // === Table Optical Penalty ===
  const tableRange = TABLE_RANGES[data.shape] || TABLE_RANGES['default'];
  const table = parseFloat(data.tablePct);
  if (!isNaN(table)) {
    if (table > tableRange.max || table < tableRange.min) {
      score -= 8; // 偏離標準桌面大小
    }
  }

  // === Risk Flags Penalty ===
  let highFlags = 0, mediumFlags = 0, lowFlags = 0;

  for (const flag of flags) {
    if (flag.severity === 'HIGH') highFlags++;
    else if (flag.severity === 'MEDIUM') mediumFlags++;
    else lowFlags++;
  }

  score -= (highFlags * 15);
  score -= (mediumFlags * 8);
  score -= (lowFlags * 3);

  // === Fluorescence Oily Risk ===
  const fluorResult = evaluateFluorescenceOilyRisk(data);
  if (fluorResult.hasRisk) {
    score -= fluorResult.scoreImpact;
    flags.push({
      flag: '⚠️ Fluorescence Oily Risk',
      severity: fluorResult.severity,
      detail: fluorResult.detail
    });
  }


// === v5.0.0 NEW CHECKS ===

// 1. Laser Drill Hole (CRITICAL - 最早檢測,優先於幾乎所有其他檢查)
const ldhResult = checkLaserDrillHole(data, flags);
if (ldhResult && ldhResult.isReject) {
  // 立即返回,不繼續評估
  flags.push({ flag: '❌ REJECT: 人為優化處理 (LDH/Fracture Filled)', severity: 'CRITICAL', detail: '激光鑽孔或裂隙填充處理,Zombie Score = 0' });
  return 0;
}

// === NEW v2.6.0 RISK CHECKS ===
  // 0. Treatment/Lab-Grown = 立即 REJECT (0分) - Zombie Score Fix
  const treatmentRisk = checkTreatmentRisk(data);
  if (treatmentRisk) {
    score = 0; // Treated/Lab-Grown diamonds = immediate REJECT
    flags.push({
      flag: '🔴 ' + treatmentRisk.label + ': ' + treatmentRisk.detail,
      severity: treatmentRisk.severity,
      detail: treatmentRisk.detail
    });
    // 立即返回,不再加分
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // === v6.1.0 NEW: Creamy Stone Detection ===
  // 在其他 CRITICAL 檢測之後加入:Symmetry VG + Cloud + Strong Fluor (2-of-3 = ZOMBIE)
  const creamyRisk = checkCreamyStoneRisk(data);
  if (creamyRisk) {
    flags.push({ flag: creamyRisk.label + ': ' + creamyRisk.detail, severity: creamyRisk.severity, detail: creamyRisk.detail });
    score = 0;
    // Mark for veto rule
    data._creamyStoneZombie = true;
    // 直接返回,不再繼續評估
    return Math.max(0, Math.round(score));
  }

  // === v7.9.0 NEW: Structural Haze Detection ===
  // 10ct+ + Cloud as main + clouds not shown = Structural Haze (塑料感)
  const structuralHaze = checkStructuralHaze(data);
  if (structuralHaze) {
    flags.push({ flag: structuralHaze.label + ': ' + structuralHaze.detail, severity: structuralHaze.severity, detail: structuralHaze.detail });
    score = 0;
    // Mark for veto rule
    data._structuralHazeZombie = true;
    // 直接返回,不再繼續評估
    return Math.max(0, Math.round(score));
  }

// === v5.0.0: Brownish Tint (CRITICAL 級別) ===

// === v5.1.0 UPDATES ===

// 1. VVS1 Oily Risk (CRITICAL - 熔斷)
const vvsiOilyRisk = checkVVS1OilyRisk(data);
if (vvsiOilyRisk) {
  flags.push({ flag: vvsiOilyRisk.label + ': ' + vvsiOilyRisk.detail, severity: vvsiOilyRisk.severity, detail: vvsiOilyRisk.detail });
  score = Math.max(0, score + vvsiOilyRisk.scoreImpact);
  // 如果是 CRITICAL,設定標記稍後熔斷
  if (vvsiOilyRisk.severity === 'CRITICAL') {
    // 標記為需要熔斷,不立即返回,讓其他 CRITICAL 檢測也能執行
    data._vvs1OilyCritical = true;
  }
}

// 2. Spread Factor with Depth Check
const spreadCheck = checkSpreadFactorWithDepth(data);
if (spreadCheck) {
  flags.push({ flag: spreadCheck.label + ': ' + spreadCheck.detail, severity: spreadCheck.severity, detail: spreadCheck.detail });
  score = Math.max(0, score + spreadCheck.scoreImpact);
}

// === v5.0.0: Brownish Tint (CRITICAL 級別) ===
const brownishRisk = checkBrownishTint(data);
if (brownishRisk) {
  if (brownishRisk.severity === 'CRITICAL') {
    flags.push({ flag: brownishRisk.label + ': ' + brownishRisk.detail, severity: 'CRITICAL', detail: brownishRisk.detail });
    score = Math.max(0, score + brownishRisk.scoreImpact);
  } else {
    flags.push({ flag: brownishRisk.label + ': ' + brownishRisk.detail, severity: 'HIGH', detail: brownishRisk.detail });
    score = Math.max(0, score + brownishRisk.scoreImpact);
  }
}

// === v5.0.0: Cloud Position (影響分數) ===
const cloudPosition = checkCloudPosition(data);
if (cloudPosition) {
  flags.push({ flag: cloudPosition.label + ': ' + cloudPosition.detail, severity: cloudPosition.severity, detail: cloudPosition.detail });
  score = Math.max(0, score + cloudPosition.scoreImpact);
}


  // 1. Structural Risk (Knot > Chip > Cavity) - v2.6.0 differentiated scoring
  const structuralRisk = checkStructuralRisk(data);
  if (structuralRisk) {
    score = Math.max(0, score + structuralRisk.scoreImpact);
    flags.push({
      flag: '🔴 ' + structuralRisk.label + ': ' + structuralRisk.detail,
      severity: structuralRisk.severity,
      detail: structuralRisk.detail
    });
  }


  // 2. Girdle Hidden Weight (更 aggressive 的隱藏重量檢測)
  const girdleHiddenRisk = checkGirdleHiddenWeight(data);
  if (girdleHiddenRisk) {
    score = Math.max(0, score + girdleHiddenRisk.scoreImpact);
    flags.push({
      flag: '🟡 ' + girdleHiddenRisk.label + ': ' + girdleHiddenRisk.detail,
      severity: girdleHiddenRisk.severity,
      detail: girdleHiddenRisk.detail
    });
  }


  // 3. Symmetry Specifics (即使 3EX 都扣分)
  const symmetryRisk = checkSymmetrySpecifics(data);
  if (symmetryRisk) {
    score = Math.max(0, score + symmetryRisk.scoreImpact);
    flags.push({
      flag: (symmetryRisk.severity === 'MEDIUM' ? '🟡 ' : 'i️ ') + symmetryRisk.label + ': ' + symmetryRisk.detail,
      severity: symmetryRisk.severity,
      detail: symmetryRisk.detail
    });
  }

  // 4. Eye-Clean Risk (淨度位置風險)
  const eyeCleanRisk = checkEyeCleanRisk(data);
  if (eyeCleanRisk) {
    score = Math.max(0, score + eyeCleanRisk.scoreImpact);
    flags.push({
      flag: '🟡 ' + eyeCleanRisk.label + ': ' + eyeCleanRisk.detail,
      severity: eyeCleanRisk.severity,
      detail: eyeCleanRisk.detail
    });
  }


  // 5. Origin Premium (產地溢價)
  const originPremium = checkOriginPremium(data);
  if (originPremium) {
    score = Math.max(0, score + originPremium.scoreImpact);
    flags.push({
      flag: '💎 ' + originPremium.label + ': ' + originPremium.detail,
      severity: originPremium.severity,
      detail: originPremium.detail
    });
  }

  // 1. BGM Tint Risk (Brown, Green, Milky)
  const bgmRisk = checkBGMTintRisk(data);
  if (bgmRisk) {
    score = Math.max(0, score + bgmRisk.scoreImpact);
    flags.push({
      flag: '🔴 ' + bgmRisk.label + ': ' + bgmRisk.detail,
      severity: bgmRisk.severity,
      detail: bgmRisk.detail
    });
    // v8.2.2: Add specific BGM flags (Brownish/Greenish/Oily/Cloudy)
    if (bgmRisk.specificFlags && bgmRisk.specificFlags.length > 0) {
      for (const bgmFlag of bgmRisk.specificFlags) {
        // Avoid duplicate flags
        if (!flags.some(f => f.flag === bgmFlag)) {
          flags.push({
            flag: bgmFlag,
            severity: bgmRisk.severity,
            detail: `BGM specific detection: ${bgmFlag.replace('❌ ', '')}`
          });
        }
      }
    }
  }
  // 4. M色 + I1 或更差 = 直接 REJECT (特殊商業規則)
  const lowColorMap = ['M', 'L', 'N'];
  const lowClarityMap = ['I1', 'I2', 'I3'];
  if (lowColorMap.includes(data.color) && lowClarityMap.includes(data.clarity)) {
    score = Math.min(score, 25);
    flags.push({
      flag: '🔴 CRITICAL: M色 + I凈度 = 商業拒絕',
      severity: 'CRITICAL',
      detail: `M色或更低 + I1/I2/I3 淨度 = B2B 高端市場直接拒絕,商業價值極低`
    });
  }

  // === Square Modified Nailhead 檢測 ===
  const depthPctVal = parseFloat(data.depthPct);
  const nailheadResult = checkSquareNailheadRisk(data, depthPctVal);
  if (nailheadResult && nailheadResult.hasRisk) {
    score += nailheadResult.scoreImpact; // -20
    flags.push({
      flag: nailheadResult.label,
      severity: nailheadResult.severity,
      detail: nailheadResult.detail
    });
  }

  // === Fancy Cut Spread 評估 ===
  const fancySpreadResult = evaluateFancySpread(data);
  if (fancySpreadResult) {
    score += fancySpreadResult.scoreImpact;
    if (fancySpreadResult.status !== 'normal') {
      flags.push({
        flag: `${fancySpreadResult.emoji} ${fancySpreadResult.label}`,
        severity: fancySpreadResult.scoreImpact <= -10 ? 'HIGH' : 'MEDIUM',
        detail: fancySpreadResult.detail
      });
    }
  }

  // === Spread Factor 評估 (Round Brilliant) ===
  const spreadResult = evaluateSpreadFactor(data);

  // === Effective Carat 計算 ===
  let spreadRatio = 1.0;
  if (spreadResult && spreadResult.spreadRatio) {
    spreadRatio = spreadResult.spreadRatio;
  } else if (fancySpreadResult && fancySpreadResult.spreadIndex) {
    spreadRatio = fancySpreadResult.spreadIndex;
  }

  // 計算並存儲 Effective Carat(用於報告顯示)
  const effectiveCaratResult = calculateEffectiveCarat(data, spreadRatio);
  data.effectiveCaratResult = effectiveCaratResult;

  // === Briolette 專用評估 ===
  if ((data.shape || '').toLowerCase().includes('briolet')) {
    // 計算 Briolette Ratio 分類
    if (effectiveCaratResult && effectiveCaratResult.isBriolette) {
      // 從 effectiveCaratResult 取得 Lv 和 Wv
      const dimsStr = data.measurements || '';
      let d1, d2, d3;
      if (data.measurements && typeof data.measurements === 'object') {
        d1 = parseFloat(data.measurements.length);
        d2 = parseFloat(data.measurements.width);
        d3 = parseFloat(data.measurements.depth);
      } else {
        const dimsMatch = dimsStr.match(/([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i);
        if (dimsMatch) {
          d1 = parseFloat(dimsMatch[1]);
          d2 = parseFloat(dimsMatch[2]);
          d3 = parseFloat(dimsMatch[3]);
        }
      }
      if (!isNaN(d1) && !isNaN(d2) && !isNaN(d3)) {
        const sortedDims = [d1, d2, d3].sort((a, b) => b - a);
        const visualLength = sortedDims[0];
        const visualWidth = sortedDims[1];
        const brioRatioResult = evaluateBrioletteRatio(visualLength, visualWidth);
        data.brioletteRatioResult = brioRatioResult;
        score += brioRatioResult.scoreImpact;
        if (brioRatioResult.status !== 'normal') {
          flags.push({
            flag: `${brioRatioResult.emoji} ${brioRatioResult.label}`,
            severity: brioRatioResult.status === 'chubby' ? 'MEDIUM' : 'HIGH',
            detail: brioRatioResult.detail
          });
        }
      }

      // 檢查 Briolette 特殊風險
      const brioRisks = checkBrioletteRisks(data);
      for (const risk of brioRisks) {
        score += risk.scoreImpact;
        flags.push({
          flag: risk.label,
          severity: risk.severity,
          detail: risk.detail
        });
      }
    }
  }

  // === 魚眼/漏光警示 (Windowing Risk) ===
  const windowingResult = checkWindowingRisk(data, fancySpreadResult, depthPctVal);
  if (windowingResult.hasRisk) {
    score -= 20; // CRITICAL 級別扣分
    flags.push({
      flag: windowingResult.detail,
      severity: 'CRITICAL',
      detail: 'Spread > 140% + Depth < 50% = 極端漏光'
    });
  }

  // === Investment Grade 收藏級標記 ===
  const investmentGradeResult = checkInvestmentGrade(data);
  if (investmentGradeResult.isInvestmentGrade) {
    // Investment Grade 給予加分,但不影響 veto 邏輯
    score += 5;
    flags.push({
      flag: investmentGradeResult.detail,
      severity: 'INFO',
      detail: 'D Color + FL/IF = 稀缺性極高的收藏級寶石'
    });
  }

  // === NEW v2.8.0 ADVANCED CHECKS ===

  // 1. Table Risk (魚眼效應)
  const tableRisk = checkTableRisk(data);
  if (tableRisk) {
    flags.push({
      flag: tableRisk.label + ': ' + tableRisk.detail,
      severity: tableRisk.severity,
      detail: tableRisk.detail
    });
    score = Math.max(0, score + tableRisk.scoreImpact);
  }

  // 2. Certificate Age Risk
  const ageRisk = checkCertificateAgeRisk(data);
  if (ageRisk) {
    flags.push({
      flag: ageRisk.label + ': ' + ageRisk.detail,
      severity: ageRisk.severity,
      detail: ageRisk.detail
    });
    score = Math.max(0, score + ageRisk.scoreImpact);
  }

  // 2b. Carat Threshold Risk (卡數台階風險)
  const caratThresholdRisk = checkCaratThresholdRisk(data);
  if (caratThresholdRisk) {
    flags.push({
      flag: caratThresholdRisk.label + ': ' + caratThresholdRisk.detail,
      severity: caratThresholdRisk.severity,
      detail: caratThresholdRisk.detail
    });
    score = Math.max(0, score + caratThresholdRisk.scoreImpact);
  }

  // 3. Super Ideal / H&A (最高等級)
  const superIdeal = checkSuperIdeal(data);
  if (superIdeal) {
    flags.push({
      flag: superIdeal.label + ': ' + superIdeal.detail,
      severity: 'INFO',
      detail: superIdeal.detail
    });
    score = Math.max(0, score + superIdeal.scoreImpact);
  }

  // 4. Clarity Based on Clouds
  const clarityOnHold = checkClarityBasedOnClouds(data);
  if (clarityOnHold) {
    flags.push({
      flag: clarityOnHold.label + ': ' + clarityOnHold.detail,
      severity: clarityOnHold.severity,
      detail: clarityOnHold.detail
    });
    score = Math.max(0, score + clarityOnHold.scoreImpact);
  }

  // === NEW v2.9.0 CHECKS ===

  // 1. Type IIa Risk
  const typeIIaRisk = checkTypeIIaRisk(data);
  if (typeIIaRisk) {
    flags.push({
      flag: typeIIaRisk.label + ': ' + typeIIaRisk.detail,
      severity: typeIIaRisk.severity,
      detail: typeIIaRisk.detail
    });
    score = Math.max(0, score + typeIIaRisk.scoreImpact);
  }

  // 2. Culet Risk (Black Eye)
  const culetRisk = checkCuletRisk(data);
  if (culetRisk) {
    flags.push({
      flag: culetRisk.label + ': ' + culetRisk.detail,
      severity: culetRisk.severity,
      detail: culetRisk.detail
    });
    score = Math.max(0, score + culetRisk.scoreImpact);
  }

  // 2b. Emerald Color Risk (v7.7.0)
  const emeraldColorRisk = checkEmeraldColorRisk(data);
  if (emeraldColorRisk) {
    flags.push({
      flag: emeraldColorRisk.label + ': ' + emeraldColorRisk.detail,
      severity: emeraldColorRisk.severity,
      detail: emeraldColorRisk.detail
    });
    score = Math.max(0, score + emeraldColorRisk.scoreImpact);
  }

  // 3. Girdle Condition
  const girdleCondition = checkGirdleCondition(data);
  if (girdleCondition) {
    flags.push({
      flag: girdleCondition.label + ': ' + girdleCondition.detail,
      severity: girdleCondition.severity,
      detail: girdleCondition.detail
    });
    score = Math.max(0, score + girdleCondition.scoreImpact);
  }

  // 4. Under-graded Hunter (尋寶模式)
  const underGraded = checkUnderGradedHunter(data);
  if (underGraded) {
    flags.push({
      flag: underGraded.label + ': ' + underGraded.detail,
      severity: underGraded.severity,
      detail: underGraded.detail
    });
    score = Math.max(0, score + underGraded.scoreImpact);
  }

  // === NEW v3.0.0 CHECKS ===

  // 1. Crushed Ice Effect (壓碎冰效應)
  const crushedIce = evaluateFacetLustre(data);
  if (crushedIce) {
    if (crushedIce.type === 'warning') {
      flags.push({
        flag: crushedIce.label + ': ' + crushedIce.detail,
        severity: crushedIce.severity,
        detail: crushedIce.detail
      });
    } else {
      flags.push({
        flag: crushedIce.label + ': ' + crushedIce.detail,
        severity: crushedIce.severity,
        detail: crushedIce.detail
      });
    }
    score = Math.max(0, score + crushedIce.scoreImpact);
  }

  // 2. Marketability Index (對辦率)
  const marketability = evaluateMarketability(data);
  if (marketability) {
    // === v7.7.0 Fix: Very Deep Cut + EASY SELL 矛盾修正 ===
    // 如果 Spread < 90%,自動移除 EASY SELL 標籤
    let marketLabel = marketability.label;
    let marketScore = marketability.scoreImpact;
    if (marketLabel.includes('EASY SELL')) {
      const spreadRatio = data.spreadRatio || (data.fancySpreadResult ? data.fancySpreadResult.spreadIndex : null);
      if (spreadRatio && spreadRatio < 0.90) {
        // 替換為 CONDITIONAL label
        marketLabel = marketLabel.replace('💎💎💎 EASY SELL', '⚠️💡 CONDITIONAL SELL');
        marketScore = 0; // 移除 EASY SELL bonus
      }
    }
    flags.push({
      flag: marketLabel + ': ' + marketability.detail,
      severity: marketability.severity,
      detail: marketability.detail
    });
    score = Math.max(0, score + marketScore);
  }


  // === NEW v3.1.0 FINAL DEFENSE ===

  // 1. Hidden Symmetry Risk (拉絲感/波紋感)
  const hiddenSymRisk = checkHiddenSymmetryRisk(data);
  if (hiddenSymRisk) {
    if (hiddenSymRisk.severity === 'HIGH') {
      flags.push({ flag: hiddenSymRisk.label + ': ' + hiddenSymRisk.detail, severity: 'HIGH', detail: hiddenSymRisk.detail });
    } else {
      flags.push({ flag: hiddenSymRisk.label + ': ' + hiddenSymRisk.detail, severity: 'MEDIUM', detail: hiddenSymRisk.detail });
    }
    score = Math.max(0, score + hiddenSymRisk.scoreImpact);
  }

  // 2. Bow-tie 3EX Compensation (在 checkBowTieRiskEnhanced 已經處理)

  // === v5.2.0 + v6.0.0 NEW CHECKS ===

  // 1. Fish-eye Enhanced (CRITICAL)
  const fishEyeEnhanced = checkFishEyeEnhanced(data);
  if (fishEyeEnhanced) {
    if (fishEyeEnhanced.severity === 'CRITICAL') {
      flags.push({ flag: fishEyeEnhanced.label + ': ' + fishEyeEnhanced.detail, severity: 'HIGH', detail: fishEyeEnhanced.detail });
    } else {
      flags.push({ flag: fishEyeEnhanced.label + ': ' + fishEyeEnhanced.detail, severity: 'MEDIUM', detail: fishEyeEnhanced.detail });
    }
    score = Math.max(0, score + fishEyeEnhanced.scoreImpact);

    if (fishEyeEnhanced.severity === 'CRITICAL') {
      // Immediately set score to minimum for CRITICAL fish-eye
      score = Math.min(score, 39);
    }
  }

  // 2. Premium Cut
  const premiumCut = checkPremiumCut(data);
  if (premiumCut) {
    flags.push({ flag: premiumCut.label + ': ' + premiumCut.detail, severity: 'LOW', detail: premiumCut.detail });
    score = Math.max(0, score + premiumCut.scoreImpact);
  }

  // 3. Clarity Prediction
  const clarityPrediction = checkClarityPrediction(data);
  if (clarityPrediction) {
    if (clarityPrediction.scoreImpact > 0) {
      flags.push({ flag: clarityPrediction.label + ': ' + clarityPrediction.detail, severity: 'LOW', detail: clarityPrediction.detail });
    } else {
      flags.push({ flag: clarityPrediction.label + ': ' + clarityPrediction.detail, severity: 'MEDIUM', detail: clarityPrediction.detail });
    }
    score = Math.max(0, score + clarityPrediction.scoreImpact);
  }

  // 4. Fluorescence Color
  const fluorColor = checkFluorescenceColor(data);
  if (fluorColor) {
    if (fluorColor.severity === 'CRITICAL') {
      flags.push({ flag: fluorColor.label + ': ' + fluorColor.detail, severity: 'HIGH', detail: fluorColor.detail });
    } else {
      flags.push({ flag: fluorColor.label + ': ' + fluorColor.detail, severity: 'MEDIUM', detail: fluorColor.detail });
    }
    score = Math.max(0, score + fluorColor.scoreImpact);

    if (fluorColor.severity === 'CRITICAL') {
      // Immediately set score to minimum for CRITICAL fluor
      score = Math.min(score, 39);
    }
  }

  // === Veto Rule ===
  let hasCritical = false;
  for (const flag of flags) {
    if (flag.severity === 'HIGH') {
      if (flag.flag.includes('CRITICAL') || flag.flag.includes('Milky Risk')) {
        hasCritical = true;
        break;
      }
    }
  }

  // === v7.6.1: Milky Reject Check ===
  if (data._milkyReject) {
    hasCritical = true;
  }

  // === v7.6.1: Creamy Stone = ZOMBIE = REJECT ===
  if (data._creamyStoneZombie) {
    hasCritical = true;
  }

  // 🚨 終極一票否決 (Veto Rule) 🚨
  // 只要有致命傷,哪怕是 D/FL,最高只能給 40 分 (CONDITIONAL 以下)
  // === v8.2.1: Score 計算順序修復 ===
  // 不再這裡截斷到 100，讓後續的 bonus/penalty 正常加減
  // 最終截斷在所有計算完成後（見 return Math.max(0, Math.min(100, Math.round(finalScore)))）
  let finalScore = Math.max(0, Math.round(score));
  if (hasCritical && finalScore > 40) {
    finalScore = 39;
  }

  // === CRITICAL Depth Downgrade ===
  // 如果有 CRITICAL: Too Deep / Severe Windowing / Nail-head,分數上限 75
  let hasCriticalDepth = false;
  for (const flag of flags) {
    if (flag.flag.includes('CRITICAL: Too Deep') ||
        flag.flag.includes('CRITICAL: Severe Windowing') ||
        flag.flag.includes('CRITICAL: Nail-head') ||
        flag.flag.includes('CRITICAL: Weight Hidden')) {
      hasCriticalDepth = true;
      break;
    }
  }
  // CRITICAL Depth = 分數上限 75 (CONDITIONAL/BUY)
  if (hasCriticalDepth && finalScore > 75) {
    finalScore = 75;
  }

  // === 關鍵數據缺失評分上限 ===
  const hasCriticalMissing =
    (data.tablePct === null || data.tablePct === undefined || data.tablePct === 'N/A') ||
    (data.depthPct === null || data.depthPct === undefined || data.depthPct === 'N/A');

  if (hasCriticalMissing) {
    finalScore = Math.min(finalScore, 80); // 關鍵數據缺失,上限80
    // Add flag if not already present
    const hasMissingFlag = flags.some(f => f.flag && f.flag.includes('關鍵數據缺失'));
    if (!hasMissingFlag) {
      flags.push({
        flag: '⚠️ 關鍵數據缺失',
        severity: 'MEDIUM',
        detail: `Table/Depth 數據缺失,無法完整評估光學性能`
      });
    }
  }

  // === 大克拉加乘 (10ct+ with SI1/SI2) ===
  // Note: caratWeight already declared above at line 4339
  if (caratWeight >= 10 && (data.clarity === 'SI1' || data.clarity === 'SI2')) {
    finalScore -= 20; // 10ct+ 的 SI 石額外扣20分
    // Add flag if not already present
    const hasLargeStoneFlag = flags.some(f => f.flag && f.flag.includes('大克拉風險'));
    if (!hasLargeStoneFlag) {
      flags.push({
        flag: '⚠️ 大克拉風險 (10ct+)',
        severity: 'HIGH',
        detail: `${caratWeight}ct 大石 + SI 淨度,刻面大瑕疵難遮掩,風險幾何倍增`
      });
    }
  }

  // === v7.6.1: Carat Size Bonus (for clean stones) ===
  // Investment grade stones get size bonus (not applicable to treated/lab-grown)
  if (caratWeight >= 5 && !(data.clarity && data.clarity.startsWith('I'))) {
    let caratBonus = 0;
    let bonusLabel = '';
    if (caratWeight >= 20) {
      caratBonus = 35;
      bonusLabel = '20ct+ Bonus: +35';
    } else if (caratWeight >= 10) {
      caratBonus = 20;
      bonusLabel = '10ct+ Bonus: +20';
    } else if (caratWeight >= 5) {
      caratBonus = 10;
      bonusLabel = '5ct+ Bonus: +10';
    }
    if (caratBonus > 0) {
      // If 50ct+ with girdle dead weight penalty, NO carat bonus at all
      // because the "extraordinary size" is inflated by the thick girdle
      if (caratWeight >= 50 && data.girdlePenaltyApplied) {
        flags.push({
          flag: '⚠️ 20ct+ Bonus: 0 (Cancelled by Girdle Dead Weight)',
          severity: 'INFO',
          detail: 'Girdle Dead Weight penalty cancelled 20ct+ carat bonus. Stone weight is inflated by thick girdle.'
        });
      } else {
        finalScore = Math.min(100, finalScore + caratBonus);
        flags.push({
          flag: `💎 ${bonusLabel}`,
          severity: 'INFO',
          detail: `${caratWeight.toFixed(2)}ct 大石,稀缺性高,市場溢價`
        });
      }
    }
  }

  // === D-Color 油感懲罰 ===
  // 如果係 D 色 + Internal Graining/Oily Look,扣 25 分
  // 因為 D 色唔容許任何透明度損失,付咗頂級色既錢唔可以拎到油膩感
  colorUpper = (data.color || '').toUpperCase().trim();
  const hasOilyRisk = data.clarityCharacteristics && Array.isArray(data.clarityCharacteristics)
    ? data.clarityCharacteristics.some(c =>
        c.toLowerCase().includes('grain') ||
        c.toLowerCase().includes('internal graining')
      )
    : (data.comments || []).some(c =>
        c.toLowerCase().includes('grain') ||
        c.toLowerCase().includes('internal graining')
      );

  if (colorUpper === 'D' && hasOilyRisk) {
    finalScore = Math.max(0, finalScore - 25);
    flags.push({
      flag: '⚠️ D-Color Oily Penalty',
      severity: 'HIGH',
      detail: 'D 色因 Internal Graining 導致油膩感,透明度損失,扣 25 分'
    });
  }

  // === v4.1.0 UPDATES ===

  // 1. Pavilion Depth (Headlight Effect) - 僅適用於異形石
  const pavilionRisk = checkPavilionDepthRisk(data);
  if (pavilionRisk) {
    flags.push({
      flag: pavilionRisk.label + ': ' + pavilionRisk.detail,
      severity: pavilionRisk.severity,
      detail: pavilionRisk.detail
    });
    finalScore = Math.max(0, finalScore + pavilionRisk.scoreImpact);
  }

  // 2. Haze Matrix with Short-circuit (v4.1.0 enhanced)
  const hazeResult = checkHazeMatrix(data, flags);
  let useShortCircuit = false;
  if (hazeResult) {
    finalScore = Math.max(0, finalScore + hazeResult.scoreImpact);
    if (hazeResult.isShortCircuit) {
      useShortCircuit = true;
      // CRITICAL flags go to criticalFlags for special handling
      if (hazeResult.scoreImpact <= -40) {
        // Already handled above as CRITICAL
      }
      flags.push({
        flag: hazeResult.flag + ': ' + hazeResult.detail,
        severity: 'HIGH',
        detail: hazeResult.detail
      });
    } else {
      flags.push({
        flag: hazeResult.flag + ': ' + hazeResult.detail,
        severity: 'LOW',
        detail: hazeResult.detail
      });
    }
  }

  // 3. Investment Grade Ultimate (Blue Chip)
  const investmentBonus = checkInvestmentGradeUltimate(data, finalScore, flags);
  finalScore = Math.max(0, finalScore + investmentBonus);

  // 4. Graining Risk for Investment Grade (v4.1.0)
  const isInvestmentGrade = finalScore >= 90;
  const grainingPenalty = evaluateGrainingRisk(data, flags, isInvestmentGrade);
  if (grainingPenalty !== 0) {
    finalScore = Math.max(0, finalScore + grainingPenalty);
  }

  // 5. 最終裁決:如果 score < 40 或觸發熔斷,則 REJECT
  if (finalScore < 40 || useShortCircuit || data._vvs1OilyCritical) {
    // 強制 REJECT,設定 verdict 為 REJECT
    finalScore = Math.min(finalScore, 39);
  }

  // === v8.2.0: Fluorescence Offset Cap (MAX 95) ===
  // J-M color + Fluorescence Offset bonus should never let I-color surpass D-color
  if (finalScore > 95) {
    const hasFluorOffset = flags.some(f => f.flag && f.flag.includes('FLUORESCENCE OFFSET'));
    if (hasFluorOffset) {
      finalScore = 95;
      flags.push({
        flag: '⚠️ Fluorescence Offset Capped at 95',
        severity: 'INFO',
        detail: 'I色或更低 + Fluorescence Offset 已達封頂分 95,避免超越 D 色頂級石'
      });
    }
  }

  // === v8.2.2: I-color and below ceiling (Expert Rule) ===
  // I-color (or lower) can never score 100 regardless of other factors
  // J-color or lower has even stricter ceiling
  const COLOR_INDEX_MAP = { 'D': 0, 'E': 1, 'F': 2, 'G': 3, 'H': 4, 'I': 6, 'J': 7, 'K': 9, 'L': 11, 'M': 13 };
  const colorUpperFinal = (data.color || '').toUpperCase().trim();
  const colorIndex = COLOR_INDEX_MAP[colorUpperFinal];
  if (colorIndex !== undefined && colorIndex >= 6) {
    // I or lower: MAX 92; J or lower: MAX 88
    const ceiling = colorIndex >= 7 ? 88 : 92;
    if (finalScore > ceiling) {
      const colorName = colorIndex >= 7 ? `${colorUpperFinal}色或更低` : 'I色或更低';
      finalScore = ceiling;
      flags.push({
        flag: `⚠️ ${colorName} Score Ceiling Applied (MAX ${ceiling})`,
        severity: 'INFO',
        detail: `${colorName} 無論其他條件多優秀，最高 ${ceiling} 分（專家規則）`
      });
    }
  }

  // 邊框限制在 0-100
  return Math.max(0, Math.min(100, Math.round(finalScore)));
}

/**
 * 根據 Score 獲取 Verdict 等級
 * @param {number} score - Score
 * @param {Array} flags - 邏輯標記列表(可選,用於 CRITICAL Depth 降級)
 * @returns {Object} { grade, emoji, label, verdictText, color }
 */
function getVerdict(score, flags = []) {
  // === Extract flags for efficient pattern matching ===
  const flagText = (flags || []).map(f => f.flag || '').join('\n');

  // === v8.9.0: Refactored flag checks using regex patterns ===
  const CRITICAL_DEPTH_PATTERNS = [
    'CRITICAL: Too Deep',
    'CRITICAL: Severe Windowing',
    'CRITICAL: Nail-head',
    'CRITICAL: Weight Hidden'
  ];
  const MILKY_PATTERNS = ['Milky', 'Hazy', 'High Milky'];

  const hasCriticalDepth = CRITICAL_DEPTH_PATTERNS.some(p => flagText.includes(p));
  const hasMilkyRisk = MILKY_PATTERNS.some(p => flagText.includes(p));

  // === Score adjustments ===
  let effectiveScore = hasCriticalDepth ? Math.min(score, 84) : score;

  // Milky Risk = 強制 CONDITIONAL 級別 (40-69 分)
  // 即使原始分數 < 40，也必須提升至 69（最高 CONDITIONAL）
  if (hasMilkyRisk) {
    if (effectiveScore > 69) {
      effectiveScore = 69;
    } else if (effectiveScore < 40) {
      effectiveScore = 69;  // 提升至 CONDITIONAL 級別
    }
  }

  // === v7.6.1: Verdict Thresholds ===
  // 90-100: STRONG_BUY
  // 70-89: BUY/CAUTION (split at 70)
  // 40-69: CONDITIONAL
  // 0-39: REJECT
  if (effectiveScore >= 90) {
    return {
      grade: 'STRONG_BUY',
      emoji: '✅',
      label: '強烈推薦',
      verdictText: 'STRONG BUY',
      color: CONFIG.COLORS.STRONG_BUY
    };
  } else if (effectiveScore >= 70) {
    return {
      grade: 'BUY',
      emoji: '✅',
      label: '推薦',
      verdictText: 'BUY',
      color: CONFIG.COLORS.BUY
    };
  } else if (effectiveScore >= 40) {
    return {
      grade: 'CAUTION',
      emoji: '🟡',
      label: '注意',
      verdictText: 'CAUTION',
      color: CONFIG.COLORS.CAUTION
    };
  } else {
    return {
      grade: 'REJECT',
      emoji: '🔴',
      label: '拒絕',
      verdictText: 'REJECT',
      color: CONFIG.COLORS.REJECT
    };
  }
}

// ============================================================================
// PROFESSIONAL REPORT FORMAT FUNCTIONS
// ============================================================================

/**
 * 生成專業終端輸出格式
 * @param {Object} cert - 證書數據
 * @returns {string} 格式化報告
 */
function formatProfessionalReport(cert) {
  const data = cert.data || cert;
  const clawScore = cert.clawScore;
  const flags = cert.logicFlags || [];
  const verdict = getVerdict(clawScore, flags);
  // v7.6.1: Fancy stones use FANCY_DEPTH_MATRIX
  const isFancyColor = (data.color || '').toUpperCase().includes('FANCY');
  const depthResult = evaluateDepth(data.depthPct, data.shape, isFancyColor);
  const ratioResult = evaluateRatio(data.ratio, data.shape);

  const reportNum = data.reportNumber || 'N/A';
  const shape = data.shape || 'N/A';
  const carat = data.carat != null ? data.carat.toFixed(2) : 'N/A';
  const measurements = data.measurements
    ? `${data.measurements.length} × ${data.measurements.width} × ${data.measurements.depth}`
    : 'N/A';
  const ratio = data.ratio || 'N/A';

  // 風險標記(按 severity 分組)- 先併攏再分組
  const dedupedFlags = deduplicateFlags(flags);
  const highFlags = dedupedFlags.filter(f => f.severity === 'HIGH' || f.severity === 'CRITICAL');
  const mediumFlags = dedupedFlags.filter(f => f.severity === 'MEDIUM');
  const lowFlags = dedupedFlags.filter(f => f.severity === 'LOW');

  // 構建報告
  let report = '';

  // === High Brilliance Potential ===
  // Score >= 85 + 無 CRITICAL = ✨ High Brilliance Potential
  const hasCritical = flags.some(f => f.flag && f.flag.includes('CRITICAL'));
  const highBrillianceTag = (clawScore >= 85 && !hasCritical) ? '\n  ║  ✨ High Brilliance Potential(高分 + 理想光學)' : '';

  report += `╔══════════════════════════════════════════════════════════════╗\n`;
  report += `║  💎 OpenClaw 鑽石掃描報告 | #${reportNum.padEnd(20)}║\n`;
  report += `║  【診斷結論:${verdict.emoji} ${verdict.verdictText} - ${verdict.label} | Score: ${String(clawScore).padStart(2)}】${highBrillianceTag}    ║\n`;
  report += `╠══════════════════════════════════════════════════════════════╣\n`;
  report += `║  📊 核心參數 (Core Specs)                                   ║\n`;
  report += `║  • 形狀重量: ${shape.padEnd(25)} | ${carat} ct      ║\n`;
  report += `║  • 等級: ${(data.color + ' / ' + data.clarity).padEnd(40)}║\n`;
  report += `║  • Cut: ${(data.cut || 'N/A').padEnd(48)}║\n`;
  report += `║  • Pol/Sym: ${((data.polish || 'N/A').substring(0, 2) + '/' + (data.symmetry || 'N/A').substring(0, 2)).padEnd(46)}║\n`;
  report += `║  • 比例: ${measurements} mm (Ratio: ${ratio} - ${ratioResult.emoji} ${ratioResult.label})      ║\n`;
  // Table 光學狀態
  const tableRange = TABLE_RANGES[shape] || TABLE_RANGES['default'];
  const tablePct = parseFloat(data.tablePct);
  let tableStatus = '❓';
  if (!isNaN(tablePct)) {
    if (tablePct >= tableRange.min && tablePct <= tableRange.max) {
      tableStatus = '✅';
    } else {
      tableStatus = '⚠️';
    }
  }
  report += `║  • 光學數據: Table ${(data.tablePct || 'N/A').padEnd(5)}% (${tableStatus}) | Depth ${(data.depthPct || 'N/A')}% (${depthResult.emoji})    ║\n`;

  // Crown / Pavilion Angle
  const hasAngles = data.crownAngle || data.pavilionAngle;
  if (hasAngles) {
    report += `║  • 角度: Crown ${data.crownAngle || 'N/A'}° | Pavilion ${data.pavilionAngle || 'N/A'}°          ║\n`;
  }

  // Culet
  if (data.culet) {
    report += `║  • Culet: ${(data.culet || 'N/A').padEnd(52)}    ║\n`;
  }
  report += `╠══════════════════════════════════════════════════════════════╣\n`;

  // 光學評估(如有)
  const faceUpWarning = evaluateFaceUpSize(data.carat, data.depthPct, shape);
  if (faceUpWarning) {
    report += `║  📐 光學評估                                               ║\n`;
    report += `║  ${faceUpWarning.padEnd(59)}║\n`;
    report += `╠══════════════════════════════════════════════════════════════╣\n`;
  }

  // === Briolette 特殊顯示 ===
  const isBriolette = (data.shape || '').toLowerCase().includes('briolet');
  if (isBriolette && data.effectiveCaratResult && data.effectiveCaratResult.isBriolette) {
    const ec = data.effectiveCaratResult;
    report += `║  📐 Briolette 視覺評估                                     ║\n`;
    report += `║  • BSI (Briolette Spread Index): ${ec.brioSpreadIndex.toFixed(3)}                         ║\n`;
    report += `║  • Effective Carat: ${ec.actualCarat.toFixed(2)}ct → ${ec.effectiveCarat.toFixed(2)}ct (${ec.label})        ║\n`;
    if (data.brioletteRatioResult) {
      const br = data.brioletteRatioResult;
      report += `║  • Ratio: ${br.ratio.toFixed(2)} - ${br.emoji} ${br.label}                    ║\n`;
    }
    report += `║  • Details: ${(ec.details || '').padEnd(50)}║\n`;
    report += `╠══════════════════════════════════════════════════════════════╣\n`;
  }

  // === Spread Factor / Fancy Spread 顯示(如果適用)===
  const spreadResult = evaluateSpreadFactor(data);
  const fancySpreadResult = evaluateFancySpread(data);

  // 顯示 Spread Factor (Round) 或 Fancy Spread
  if (spreadResult && spreadResult.status !== 'normal') {
    report += `║  ${spreadResult.emoji} Spread Factor                                          ║\n`;
    report += `║  ${spreadResult.label.padEnd(59)}║\n`;
    report += `║  ${(spreadResult.detail || '').substring(0, 55).padEnd(59)}║\n`;

    // === Effective Carat 顯示 ===
    if (data.effectiveCaratResult) {
      const ec = data.effectiveCaratResult;
      const emoji = ec.label === '視覺偏輕' ? '📉' : '📈';
      report += `║  ${emoji} Effective Carat: ${ec.actualCarat.toFixed(2)}ct → ${ec.effectiveCarat.toFixed(2)}ct              ║\n`;
      report += `║    ${(ec.detail || "").substring(0, 55).padEnd(59)}║\n`;
      // 顯示 Step Cut 補償標記
      if (ec.stepCutCompensation) {
        report += `║  💎 Step Cut 補償: 祖母綠切工額外 +15% 視覺容忍度            ║\n`;
      }
    }

    report += `╠══════════════════════════════════════════════════════════════╣\n`;
  } else if (fancySpreadResult && fancySpreadResult.status !== 'normal') {
    report += `║  ${fancySpreadResult.emoji} Spread Factor                                          ║\n`;
    report += `║  ${fancySpreadResult.label.padEnd(59)}║\n`;
    report += `║  ${(fancySpreadResult.detail || "").substring(0, 55).padEnd(59)}║\n`;

    // === Effective Carat 顯示 ===
    if (data.effectiveCaratResult) {
      const ec = data.effectiveCaratResult;
      const emoji = ec.label === '視覺偏輕' ? '📉' : '📈';
      report += `║  ${emoji} Effective Carat: ${ec.actualCarat.toFixed(2)}ct → ${ec.effectiveCarat.toFixed(2)}ct              ║\n`;
      report += `║    ${(ec.detail || "").substring(0, 55).padEnd(59)}║\n`;
      // 顯示 Step Cut 補償標記
      if (ec.stepCutCompensation) {
        report += `║  💎 Step Cut 補償: 祖母綠切工額外 +15% 視覺容忍度            ║\n`;
      }
    }

    report += `╠══════════════════════════════════════════════════════════════╣\n`;
  }

  // 風險診斷
  report += `║  🚩 風險診斷 (Risk Diagnosis)                               ║\n`;
  if (flags.length === 0) {
    report += `║  • ✅ No red flags detected                                ║\n`;
  } else {
    if (highFlags.length > 0) {
      for (const flag of highFlags) {
        report += `║  • ${flag.flag}                                   ║\n`;
        report += `║    ${(flag.detail || "").substring(0, 55).padEnd(59)}║\n`;
      }
    }
    if (mediumFlags.length > 0) {
      for (const flag of mediumFlags) {
        report += `║  • ${flag.flag}                                       ║\n`;
        report += `║    ${(flag.detail || "").substring(0, 55).padEnd(59)}║\n`;
      }
    }
    if (lowFlags.length > 0) {
      for (const flag of lowFlags) {
        report += `║  • ${flag.flag}                                          ║\n`;
        report += `║    ${(flag.detail || "").substring(0, 55).padEnd(59)}║\n`;
      }
    }
  }

  report += `╠══════════════════════════════════════════════════════════════╣\n`;
  report += `║  💰 採購建議                                                ║\n`;

  // 自動生成建議原因
  let reason = '';
  if (verdict.grade === 'REJECT') reason = '多項嚴重風險,建議放棄';
  else if (verdict.grade === 'CONDITIONAL') reason = '存在重大風險,需仔細核查後方可考慮';
  else if (verdict.grade === 'CAUTION') reason = '有需要注意的項目,建議議價';
  else if (verdict.grade === 'BUY') reason = '總體良好,可考慮入手';
  else if (verdict.grade === 'STRONG_BUY') reason = '各項指標優秀,強烈推薦';
  else reason = '請綜合考慮各項指標';

  report += `║  「${(reason || "").substring(0, 56).padEnd(59)}║\n`;
  report += `╚══════════════════════════════════════════════════════════════╝\n`;

  return report;
}

/**
 * 生成 Discord Embed 格式
 * @param {Object} cert - 證書數據
 * @returns {Object} Discord Embed
 */
function generateDiscordEmbed(cert) {
  const data = cert.data || cert;
  const clawScore = cert.clawScore;
  const flags = cert.logicFlags || [];
  const verdict = getVerdict(clawScore, flags);
  // v7.6.1: Fancy stones use FANCY_DEPTH_MATRIX
  const isFancyColor = (data.color || '').toUpperCase().includes('FANCY');
  const depthResult = evaluateDepth(data.depthPct, data.shape, isFancyColor);
  const ratioResult = evaluateRatio(data.ratio, data.shape);

  const reportNum = data.reportNumber || 'N/A';
  const shape = data.shape || 'N/A';
  const carat = data.carat != null ? data.carat.toFixed(2) : 'N/A';
  const measurements = data.measurements
    ? `${data.measurements.length} × ${data.measurements.width} × ${data.measurements.depth}`
    : 'N/A';
  const ratio = data.ratio || 'N/A';
  const faceUpWarning = evaluateFaceUpSize(data.carat, data.depthPct, shape);

  // 自動生成建議原因
  let reason = '';
  if (verdict.grade === 'REJECT') reason = '多項嚴重風險,建議放棄';
  else if (verdict.grade === 'CONDITIONAL') reason = '存在重大風險,需仔細核查後方可考慮';
  else if (verdict.grade === 'CAUTION') reason = '有需要注意的項目,建議議價';
  else if (verdict.grade === 'BUY') reason = '總體良好,可考慮入手';
  else if (verdict.grade === 'STRONG_BUY') reason = '各項指標優秀,強烈推薦';
  else reason = '請綜合考慮各項指標';

  // 構建 fields
  const fields = [];

  // 核心參數
  fields.push({
    name: `📊 核心參數 (Core Specs)`,
    value: `• 形狀重量: **${shape}** | **${carat}** ct\n• 等級: **${data.color} / ${data.clarity}** | Cut: ${data.cut || 'N/A'} | Pol/Sym: ${(data.polish || 'N/A').substring(0, 2)}/${(data.symmetry || 'N/A').substring(0, 2)}\n• 比例: ${measurements} mm (Ratio: **${ratio}** - ${ratioResult.emoji} ${ratioResult.label})\n• 光學數據: Table ${data.tablePct || 'N/A'}% | Depth ${data.depthPct || 'N/A'}% (${depthResult.emoji} ${depthResult.label})`,
    inline: false
  });

  // 光學評估(如有)
  if (faceUpWarning) {
    fields.push({
      name: `📐 光學評估`,
      value: faceUpWarning,
      inline: false
    });
  }

  // 構建 fields - 先併攏
  const dedupedFlags = deduplicateFlags(flags);

  // 風險診斷
  if (dedupedFlags.length > 0) {
    let riskText = '';
    for (const flag of dedupedFlags.slice(0, 5)) {
      riskText += `• ${flag.flag}: ${flag.detail}\n`;
    }
    fields.push({
      name: `🚩 風險診斷 (Risk Diagnosis)`,
      value: riskText.trim(),
      inline: false
    });
  }

  // 採購建議
  fields.push({
    name: `💰 採購建議`,
    value: reason,
    inline: false
  });

  const now = new Date();
  const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
  const timeStr = now.toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false });

  return {
    title: `💎 OpenClaw 鑽石掃描報告 | #${reportNum}`,
    description: `【診斷結論:${verdict.emoji} ${verdict.verdictText} - ${verdict.label}】\n**Score: \`${clawScore}/100\`**`,
    color: verdict.color,
    timestamp: new Date().toISOString(),
    fields: fields,
    footer: {
      text: `💎 GIA 專業報告 v${CONFIG.MODULE_VERSION} | ${dateStr} ${timeStr} HKT`
    }
  };
}

/**
 * 發送 Embed 到 Discord
 * @param {Object} embed - Discord Embed
 */
async function sendToDiscord(embed, customChannelId = null) {
  const configPath = path.join(HOME, ".openclaw", "openclaw.json");

  // Load config
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    throw new Error(`Failed to load config: ${e.message}`);
  }

  const token = config.channels?.discord?.token || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('No Discord token found');
  }

  const channelId = customChannelId || CONFIG.DISCORD_CHANNEL_ID;
  const postData = JSON.stringify({
    embeds: [embed],
    allowed_mentions: { parse: [] }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else if (res.statusCode === 429) {
          let retryAfter = 1;
          try {
            retryAfter = JSON.parse(data).retry_after || parseFloat(res.headers['retry-after']) || 1;
          } catch (_) { /* use default */ }
          setTimeout(() => resolve(true), Math.min(retryAfter * 1000, 10000));
        } else {
          reject(new Error(`Discord API: ${res.statusCode} - ${data.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(CONFIG.DISCORD_REQ_TIMEOUT, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', e => {
      reject(new Error(e.message || 'Unknown error'));
    });

    req.write(postData);
    req.end();
  });
}

// ============================================================================
// GIA PROMPT AND LOGIC RULES (保留原有)
// ============================================================================

const GIA_PROMPT = `You are analyzing a GIA (Gemological Institute of America) diamond certificate.

Please extract ALL text and numerical data from this GIA certificate image. Focus on these specific fields:

1. Report Number (10-digit GIA report number)
2. Shape and Cutting Style (e.g., Round Brilliant, Oval, Princess, etc.)
3. Measurements (length × width × depth in mm, e.g., 6.50 × 6.53 × 3.97)
4. Carat Weight (e.g., 1.00)
5. Color Grade (D, E, F, G, H, I, J, K, L, M, etc. OR Fancy Colors like "Fancy Light Yellow", "Fancy Intense Pink", "Fancy Vivid Orange" etc.)
6. Clarity Grade (FL, IF, VVS1, VVS2, VS1, VS2, SI1, SI2, I1, I2, I3)
7. Cut Grade (Excellent, Very Good, Good, Fair, Poor) - for rounds
8. Polish (Excellent, Very Good, Good, Fair, Poor)
9. Symmetry (Excellent, Very Good, Good, Fair, Poor)
10. Fluorescence (None, Faint, Medium, Strong, Very Strong + color, e.g., "Strong Blue")
11. Comments (any additional notes from the certificate)
12. Key to Symbols (if present)
13. Inscription (if present)
14. Girdle (thin/medium/thick descriptions)
15. Table % and Depth % - CRITICAL: These are often shown in the diagram/illustration area. Look carefully for numbers near the diamond profile diagram. Table % is typically 50-70%. Depth % is typically 55-70%. If you see a diagram, estimate from the proportions shown.
16. Crown Angle and Pavilion Angle (if visible in diagram)
17. Diagram/Profile proportions - Analyze the diamond profile illustration for Table %, Depth %, and angles if present
18. Ratio (for fancy shapes - length/width)

IMPORTANT REMINDERS:
- Table % and Depth % are CRITICAL for diamond quality assessment - do NOT skip them!
- If the certificate has a diagram/profile illustration, extract the proportions shown there
- If numbers are written near a diamond shape diagram, those are likely Table/Depth values
- Return "Not visible" ONLY if you truly cannot find the data after thorough examination

Return the data as structured text with clear field labels. If a field is not visible or readable, indicate "Not visible".`;

const LOGIC_RULES = [
  {
    id: "bow_tie",
    check: (data) => {
      if (!data.shape) return null;
      const isOval = /oval/i.test(data.shape);
      if (!isOval) return null;
      const ratio = parseFloat(data.ratio);
      if (!isNaN(ratio) && (ratio < 1.30 || ratio > 1.55)) {
        return { flag: "Bow-tie Risk", severity: "HIGH", detail: `Oval ratio ${ratio.toFixed(2)} is outside safe range (1.30-1.55). Significant bow-tie effect possible.` };
      }
      return null;
    }
  },
  // === v9.0.0: Merge redundant shape checks into single guard ===
  {
    id: "nail_head",
    check: (data) => {
      if (!data.shape || !/round/i.test(data.shape)) return null;
      const depth = parseFloat(data.depthPct);
      if (!isNaN(depth) && depth > CONFIG.NAILHEAD_DEPTH_MIN) {
        return { flag: "Nail-head Risk", severity: "HIGH", detail: `Depth ${depth}% exceeds ${CONFIG.NAILHEAD_DEPTH_MIN}%. Likely to show dark center (nail-head effect) when set.` };
      }
      return null;
    }
  },
  {
    id: "fish_eye",
    check: (data) => {
      if (!data.shape || !/round/i.test(data.shape)) return null;
      const depth = parseFloat(data.depthPct);
      if (!isNaN(depth) && depth < CONFIG.FISHEYE_DEPTH_MAX) {
        return { flag: "Fish-eye Risk", severity: "MEDIUM", detail: `Depth ${depth}% is below ${CONFIG.FISHEYE_DEPTH_MAX}%. May appear shallow with fish-eye effect when viewed face-up.` };
      }
      return null;
    }
  },
  {
    id: "girdle_chipping",
    check: (data) => {
      if (!data.girdle) return null;
      const girdle = data.girdle.toLowerCase();
      if (/extremely thin/i.test(girdle) || /very thin/i.test(girdle)) {
        return { flag: "Chipping Risk", severity: "HIGH", detail: `Girdle described as "${data.girdle}" - prone to chipping during setting or wear.` };
      }
      return null;
    }
  },
  {
    id: "milky",
    check: (data) => {
      if (!data.comments) return null;
      const comments = data.comments.join(" ").toLowerCase();
      if (/clouds.*not.*shown/i.test(comments) || /cloud.*not.*shown/i.test(comments)) {
        return { flag: "Milky Risk", severity: "HIGH", detail: `Comments mention "clouds not shown" - potential for milky/clarity issue not visible in diagram.` };
      }
      return null;
    }
  },
  {
    id: "oily_graining",
    check: (data) => {
      if (!data.comments) return null;
      const comments = data.comments.join(" ").toLowerCase();
      if (/internal graining/i.test(comments)) {
        return { flag: "Oily Look Risk", severity: "MEDIUM", detail: `Internal graining mentioned in comments - may cause oily appearance affecting light performance.` };
      }
      return null;
    }
  },
  {
    id: "overblue",
    check: (data) => {
      if (!data.color || !data.fluorescence) return null;
      const highColor = ["D", "E", "F"].includes(data.color.toUpperCase());
      const strongBlue = /strong.*blue|very strong.*blue/i.test(data.fluorescence);
      if (highColor && strongBlue) {
        return { flag: "Overblue Risk", severity: "HIGH", detail: `High color (${data.color}) with strong blue fluorescence - may appear hazy or milky in UV light.` };
      }
      return null;
    }
  }
];

// ============================================================================
// HELPERS (保留原有並增強)
// ============================================================================

function log(...args) {
  console.log("[GIA Analyzer]", ...args);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif"
  };
  return mimeTypes[ext] || "image/jpeg";
}

function loadMinimaxApiKey() {
  try {
    const profiles = JSON.parse(fs.readFileSync(AUTH_PROFILES, "utf-8"));
    const profile = profiles.profiles?.["minimax:default"];
    if (profile?.type === "api_key" && profile?.key) {
      const key = profile.key.trim();
      if (key && key.length > 10) return key;
    }
    throw new Error("minimax:default profile not found or has no API key");
  } catch (e) {
    throw new Error("Failed to load MiniMax API key: " + e.message);
  }
}

async function describeImageWithMinimaxVLM({ prompt, imagePath, mimeType }) {
  const apiKey = loadMinimaxApiKey();
  
  // v8.5.0: Add error handling for file read
  let imageBuffer;
  try {
    imageBuffer = fs.readFileSync(imagePath);
  } catch (e) {
    throw new Error(`Failed to read image file: ${e.message}`);
  }
  
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  const actualMime = mimeMap[ext] || mimeType || "image/jpeg";
  const imageDataUrl = "data:" + actualMime + ";base64," + base64;

  const url = "https://api.minimax.io/v1/coding_plan/vlm";

  // v8.5.0: Add timeout for fetch to prevent hanging
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "MM-API-Source": "OpenClaw"
    },
    body: JSON.stringify({
      prompt: prompt,
      image_url: imageDataUrl
    }),
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const body = await response.text();
    throw new Error("MiniMax VLM API error (" + response.status + " " + response.statusText + "): " + body.substring(0, 300));
  }

  const json = await response.json();

  if (!json || typeof json.content !== "string") {
    const baseResp = json?.base_resp;
    if (baseResp?.status_code !== 0) {
      throw new Error("MiniMax VLM API error: " + (baseResp?.status_msg || "Unknown error"));
    }
    throw new Error("MiniMax VLM returned invalid response format");
  }

  return json.content.trim();
}

/**
 * v8.5.0: Parse GIA Certificate Text into structured data
 * @param {string} text - Raw text from GIA certificate
 * @returns {Object} Structured certificate data
 */
function parseGIACertificateText(text) {
  text = text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
  const lines = text.split("\n").map(l => l.trim()).filter(l => l && l.length > 0);

  const result = {
    reportNumber: extractField(text, /report\s*number[:\s]*#?\s*(\d+)/i)
               || extractField(text, /gia\s*report[:\s]*#?\s*(\d+)/i)
               || extractField(text, /report[:\s]*#?\s*(\d{10,})/i)
               || extractField(text, /(\d{10,})/),
    shape: extractField(text, /shape\s*(and|&|\+)?\s*cutting\s*style[:\s]*([^\n]+)/i, 2)
         || extractField(text, /shape[:\s]*([^\n]+)/i)
         || extractField(text, /(Round Brilliant|Oval|Pear|Princess|Cushion|Emerald|Asscher|Marquise|Radiant|Heart|Trillion)[^\n]*/i),
    measurements: null,
    carat: null,
    color: (() => {
         // v8.5.0: Phase 2 - Fancy Color Pipeline (統一的 Color 處理)
         // 提取 rawColor 並應用 Pipeline 進行腐敗檢測和恢復
         const rawColor = extractField(text, /color\s*grade[:\s]*([D-Z](?:\s*-\s*[A-Z])?)/i)
             || extractField(text, /color[:\s]*\b([D-Z])\b/i);
         const fancyPipelineResult = parseFancyColorPipeline(text, rawColor);

         // v8.5.0: Unified return object - isFancy replaces fancyContext.isFancy
         if (fancyPipelineResult.isFancy) {
           return fancyPipelineResult.fancyType;
         } else if (fancyPipelineResult.recoveredColor) {
           // 有腐敗但已恢復
           return fancyPipelineResult.recoveredColor;
         } else if (fancyPipelineResult.isCorrupted && !fancyPipelineResult.recoveredColor) {
           // 腐敗且無法恢復
           return 'UNKNOWN_FANCY';
         }
         // 正常 Color
         return rawColor;
       })(),
    clarity: extractField(text, /clarity\s*grade[:\s]*(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3)/i)
           || extractField(text, /clarity[:\s]*\b(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3)\b/i)
           || extractField(text, /clarity.*?:\s*(Internally\s*Flawless|Flawless)/i)
           || extractField(text, /clarity[:\s]*([A-Z]+(?:\s+[A-Z]+)?)/i),
    polish: extractField(text, /polish[:\s]*(Excellent|Very\s*Good|Good|Fair|Poor)/i)
          || extractField(text, /polish[:\s]*([A-Za-z\s]+)/i),
    symmetry: extractField(text, /symmetry[:\s]*(Excellent|Very\s*Good|Good|Fair|Poor)/i)
            || extractField(text, /symmetry[:\s]*([A-Za-z\s]+)/i),
    fluorescence: extractField(text, /fluorescence[:\s]*([^\n]+)/i)
                || extractField(text, /fluor\.?[:\s]*([^\n]+)/i),
    comments: extractMultilineField(text, /comments?[:\s]*([\s\S]+?)(?=key\s*to\s*symbols|inscription|\d{10,}|$)/i)
            || [],
    keyToSymbols: extractMultilineField(text, /key\s*to\s*symbols?[:\s]*([\s\S]+?)(?=profile|inscription|report|$)/i),
    tablePct: extractField(text, /table\s*%[:\s]*(\d+\.?\d*)/i)
           || extractField(text, /table[:\s]*(\d+\.?\d*)/i)
           || extractField(text, /table\s*(\d+\.?\d*)\s*%/i)
           || extractField(text, /table.*?(\d+\.?\d*)\s*%/i),
    culet: extractField(text, /culet[:\s]*([a-zA-Z\s]+)/i),
    crownAngle: extractField(text, /crown\s*angle[:\s]*(\d+\.?\d*)/i),
    pavilionAngle: extractField(text, /pavilion\s*angle[:\s]*(\d+\.?\d*)/i),
    depthPct: extractField(text, /depth\s*%[:\s]*(\d+\.?\d*)/i)
           || extractField(text, /depth[:\s]*(\d+\.?\d*)/i)
           || extractField(text, /depth\s*(\d+\.?\d*)\s*%/i)
           || extractField(text, /depth.*?(\d+\.?\d*)\s*%/i),
    girdle: (() => {
      // v8.2.1: Fix Girdle pattern to capture multi-word descriptors like "medium - slightly thick"
      // Added (?:\s+[\w\-,]+)* to capture trailing space-separated words (e.g., "thick" after "slightly")
      // Common formats: "Medium to Slightly Thick", "Faceted, Medium", "Medium - Slightly Thick", "Thin to Very Thick"
      const girdlePatterns = [
        /girdle[:\s]*([\w\-,]+(?:\s*[-–]\s*[\w\-,]+)*(?:\s+(?:to|-)\s+[\w\-,]+)*(?:\s+[\w\-,]+)*)/i,
        /girdle[:\s]*([\w\s\-,]+)/i,
        /girdle[:\s]*([A-Za-z\s\-]+)/i
      ];
      for (const pat of girdlePatterns) {
        const m = text.match(pat);
        if (m) {
          const val = m[1].trim();
          if (val && val.length > 1 && val.length < 100) return val;
        }
      }
      // v8.2.2: Fallback - try to extract girdle from comments/keyToSymbols if primary parsing failed
      const commentsSection = text.match(/comments?[:\s]*([\s\S]+?)(?=key\s*to\s*symbols|inscription|profile|report|\d{10,}|$)/i);
      if (commentsSection) {
        const commentsText = commentsSection[1];
        const girdleInComments = commentsText.match(/girdle[:\s]*([\w\s\-,]+?)(?:\n|,|;|$)/i);
        if (girdleInComments && girdleInComments[1]) {
          const recovered = girdleInComments[1].trim();
          if (recovered.length > 1 && recovered.length < 100) return recovered;
        }
      }
      return null;
    })(),
    inscription: extractField(text, /inscription[s]?[:\s]*([^\n]+)/i),
    ratio: null
  };

  const measMatch = text.match(/(\d+\.?\d*)\s*[-×xX*]\s*(\d+\.?\d*)\s*[×xX]\s*(\d+\.?\d*)/);
  if (measMatch) {
    result.measurements = {
      length: parseFloat(measMatch[1]),
      width: parseFloat(measMatch[2]),
      depth: parseFloat(measMatch[3])
    };
    if (parseFloat(measMatch[2]) > 0) {
      result.ratio = (parseFloat(measMatch[1]) / parseFloat(measMatch[2])).toFixed(2);
    }
  }

  const caratMatch = text.match(/carat[s]?\s*weight[:\s]*(\d+\.?\d*)/i)
                  || text.match(/\bcarat[:\s]*(\d+\.\d+)\b/i)
                  || text.match(/(\d+\.\d+)\s*carat/i);
  if (caratMatch) {
    result.carat = parseFloat(caratMatch[1]);
  }

  // Fallback: Calculate depth % from measurements if not extracted
  if (!result.depthPct && result.measurements) {
    const { length, width, depth } = result.measurements;
    if (length && width && depth && width > 0) {
      const avgDiameter = (length + width) / 2;
      result.depthPct = ((depth / avgDiameter) * 100).toFixed(1);
      log(`  📊 Fallback: Calculated depthPct ${result.depthPct}% from measurements`);
    }
  }

  return result;
}

function extractField(text, pattern, groupIndex = 1) {
  const match = text.match(pattern);
  return match ? match[groupIndex]?.trim() : null;
}

function extractMultilineField(text, pattern) {
  const match = text.match(pattern);
  if (!match) return [];
  return match[1].split(/[•\n]/)
    .map(l => l.trim())
    .filter(l => l.length > 3 && l.length < 200);
}

function runLogicEngine(data) {
  const flags = [];
  for (const rule of LOGIC_RULES) {
    try {
      const result = rule.check(data);
      if (result) {
        flags.push(result);
      }
    } catch (e) {
      log(`  ⚠️ Logic rule ${rule.id} failed: ${e.message}`);
    }
  }
  return flags;
}

function determineRecommendation(flags, data) {
  if (flags.length === 0) {
    return { action: "APPROVE", reason: "No significant red flags detected. Standard trading parameters." };
  }
  const highSeverity = flags.filter(f => f.severity === "HIGH");
  if (highSeverity.length >= 2) {
    return {
      action: "REJECT",
      reason: `${highSeverity.length} HIGH severity flags detected. Review required before trade.`
    };
  }
  if (highSeverity.length === 1) {
    return {
      action: "CONDITIONAL",
      reason: `1 HIGH severity flag: ${highSeverity[0].flag}. Verify with seller before proceeding.`
    };
  }
  return {
    action: "CAUTION",
    reason: `MEDIUM severity flags present: ${flags.map(f => f.flag).join(", ")}. Recommend price negotiation.`
  };
}

function formatReport(data, flags, recommendation, rawText) {
  const lines = [];
  lines.push("═══════════════════════════════════════════════════");
  lines.push("           GIA CERTIFICATE ANALYSIS REPORT          ");
  lines.push("═══════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Report #: ${data.reportNumber || "N/A"}`);
  lines.push(`Shape: ${data.shape || "N/A"}`);
  lines.push("");
  lines.push("─── 4Cs ──────────────────────────────────────────────");
  lines.push(`Carat:  ${data.carat ?? "N/A"}`);
  lines.push(`Color:  ${data.color || "N/A"}`);
  lines.push(`Clarity: ${data.clarity || "N/A"}`);
  lines.push(`Polish:  ${data.polish || "N/A"}`);
  lines.push(`Symmetry: ${data.symmetry || "N/A"}`);
  lines.push("");
  lines.push("─── Measurements ─────────────────────────────────────");
  if (data.measurements) {
    lines.push(`L×W×D: ${data.measurements.length} × ${data.measurements.width} × ${data.measurements.depth} mm`);
  }
  lines.push(`Table: ${data.tablePct || "N/A"}%`);
  lines.push(`Depth:  ${data.depthPct || "N/A"}%`);
  if (data.ratio) lines.push(`Ratio: ${data.ratio}`);
  lines.push(`Girdle: ${data.girdle || "N/A"}`);
  lines.push("");
  lines.push(`Fluorescence: ${data.fluorescence || "N/A"}`);
  lines.push("");
  lines.push("─── Comments ────────────────────────────────────────");
  if (data.comments && data.comments.length > 0) {
    data.comments.slice(0, 5).forEach(c => lines.push(`  • ${c}`));
  } else {
    lines.push("  None");
  }
  lines.push("");
  lines.push("─── Logic Engine Analysis ────────────────────────────");
  if (flags.length === 0) {
    lines.push("  ✅ No red flags detected");
  } else {
    flags.forEach(f => {
      const icon = f.severity === "HIGH" ? "🔴" : "🟡";
      lines.push(`  ${icon} ${f.flag} (${f.severity})`);
      lines.push(`     ${f.detail}`);
    });
  }
  lines.push("");
  lines.push("─── Trading Recommendation ───────────────────────────");
  const actionIcon = {
    APPROVE: "✅",
    CONDITIONAL: "⚠️",
    CAUTION: "🟡",
    REJECT: "❌"
  }[recommendation.action] || "❓";
  lines.push(`  ${actionIcon} ${recommendation.action}`);
  lines.push(`  ${recommendation.reason}`);
  lines.push("");
  lines.push("═══════════════════════════════════════════════════");
  return lines.join("\n");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
GIA Certificate Analyzer - Professional Grade v${CONFIG.MODULE_VERSION}
Usage: node scripts/gia_cert_analyzer.js <image_path> [--json] [--report] [--send] [--md]

Arguments:
  <image_path>    Path to GIA certificate image (PNG/JPG)
  --json          Output structured JSON instead of formatted report
  --report        Generate professional report with Score & diagnostics
  --send          Send to Discord (channel: 1473383064565710929 #💼工作)
  --channel <id>  Override Discord channel ID for --send
  --md            Output in Markdown format
  --fancy        Force Fancy mode (auto-detected if color contains "Fancy")
  --embed         Output in Discord Embed format (default output)
  --quiet         Suppress informational logs

Examples:
  node scripts/gia_cert_analyzer.js ~/Desktop/gia123.png
  node scripts/gia_cert_analyzer.js ~/Desktop/gia123.png --report
  node scripts/gia_cert_analyzer.js ~/Desktop/gia123.png --json --report
  node scripts/gia_cert_analyzer.js ~/Desktop/gia123.png --send
  node scripts/gia_cert_analyzer.js ~/Desktop/gia123.png --send --channel 987654321098765432
`);
    process.exit(0);
  }

  const imagePath = args[0];
  const isJson = args.includes("--json");
  const isReport = args.includes("--report");
  const isSend = args.includes("--send");
  const isMd = args.includes("--md");
  const isEmbed = args.includes("--embed");
  const isFancyMode = args.includes("--fancy");
  const isQuiet = args.includes("--quiet");

  // Parse --channel argument (optional override)
  const channelArgIndex = args.indexOf("--channel");
  const customChannelId = channelArgIndex !== -1 && args[channelArgIndex + 1] ? args[channelArgIndex + 1] : null;

  // Default to embed output if no format specified
  const outputAsEmbed = !isJson && !isReport && !isMd;

  // Validate image path
  if (!fs.existsSync(imagePath)) {
    console.error(`[GIA Analyzer] Error: File not found: ${imagePath}`);
    process.exit(1);
  }

  const ext = path.extname(imagePath).toLowerCase();
  const isPDF = ext === ".pdf";
  let processedImagePath = imagePath;
  let pdfPath = null;

  // Validate image path
  if (!fs.existsSync(imagePath)) {
    console.error(`[GIA Analyzer] Error: File not found: ${imagePath}`);
    process.exit(1);
  }

  // Handle PDF input - convert to PNG
  if (isPDF) {
    pdfPath = imagePath;
    // Check if pdftoppm is available
    try {
      execFileSync('which', ['pdftoppm'], { stdio: 'ignore', timeout: 5000 });
    } catch (e) {
      console.error(
        '[GIA Analyzer] Error: pdftoppm not found. ' +
        'Please install poppler-utils:\n' +
        '  macOS: brew install poppler\n' +
        '  Ubuntu/Debian: sudo apt install poppler-utils\n' +
        '  RHEL/CentOS: sudo yum install poppler-utils'
      );
      console.error('[GIA Analyzer] Alternative: convert PDF to PNG manually and use the PNG file.');
      process.exit(1);
    }

    const tmpDir = '/tmp/gia_pdf_' + Date.now();
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
    const outputBase = tmpDir + '/page';

    try {
      const args = [
        '-png',
        '-r', String(PDF_CONFIG.dpi),
        '-f', String(PDF_CONFIG.pageRange.first),
        '-l', String(PDF_CONFIG.pageRange.last),
        pdfPath,
        outputBase
      ];
      try {
        execFileSync(PDF_CONFIG.command, args, { stdio: 'pipe', timeout: PDF_CONFIG.TIMEOUT_MS });
      } catch (e) {
        throw new Error(`PDF conversion failed: ${e.message}`);
      }
      const pngFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('page-') && f.endsWith('.png'));
      if (pngFiles.length > 0) {
        pngFiles.sort();
        processedImagePath = path.join(tmpDir, pngFiles[0]);
        if (!isQuiet) log(`Converted PDF to PNG: ${path.basename(processedImagePath)}`);
      } else {
        console.error('[GIA Analyzer] Error: Failed to convert PDF to PNG - no output file generated.');
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.exit(1);
      }
    } catch (e) {
      console.error(`[GIA Analyzer] Error: PDF conversion failed - ${e.message}`);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      process.exit(1);
    }
  } else if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
    console.error(`[GIA Analyzer] Error: Unsupported file type: ${ext}. Use PNG, JPG, JPEG, WebP, GIF, or PDF.`);
    process.exit(1);
  }

  if (!isQuiet) log(`Loading image: ${path.basename(processedImagePath)}`);
  if (!isQuiet) log("Analyzing with AI Vision via MiniMax VLM API...");

  // Step 1: AI Vision Analysis
  let rawText;
  try {
    rawText = await describeImageWithMinimaxVLM({
      prompt: GIA_PROMPT,
      imagePath: processedImagePath,
      mimeType: getMimeType(processedImagePath)
    });
    if (!isQuiet) log("Image analysis complete.");
  } catch (agentError) {
    console.error(`[GIA Analyzer] Sub-agent error: ${agentError.message}`);
    console.error(`[GIA Analyzer] Please check your OpenClaw configuration.`);
    process.exit(1);
  } finally {
    // Cleanup temp PDF conversion directory
    if (pdfPath && processedImagePath !== pdfPath) {
      try {
        const tmpDir = path.dirname(processedImagePath);
        if (tmpDir.startsWith('/tmp/gia_pdf_')) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (_) { /* best-effort cleanup */ }
    }
  }

  if (!isQuiet) log("Parsing GIA certificate data...");

  // Step 2: Parse fields
  const parsed = parseGIACertificateText(rawText);

  // Step 3: Logic Engine (原有)
  const basicFlags = runLogicEngine(parsed);

  // Step 4: 增強風險檢測
  const allFlags = enhancedRiskDetection(parsed, basicFlags);

  // Step 5: Recommendation
  const recommendation = determineRecommendation(allFlags, parsed);

  // Step 6: 構建輸出結構
  const output = {
    analyzedAt: new Date().toISOString(),
    sourceFile: path.basename(imagePath),
    rawText: rawText.substring(0, 2000),
    data: parsed,
    logicFlags: allFlags,
    recommendation
  };

  // v7.6.1: Fancy stones - determine scoring mode BEFORE calculations
  // Mode: auto-detect or force with --fancy flag
  const isFancyColorMode = isFancyMode || (parsed.color && /fancy/i.test(parsed.color));
  const scoringMode = isFancyColorMode ? 'fancy' : 'white';
  if (!isQuiet && isFancyColorMode) {
    log(`🎨 Scoring Mode: FANCY (${scoringMode}) - applying FANCY_DEPTH_RANGES + FANCY_COLOR_MODIFIER`);
  }
  const depthDiagnosis = evaluateDepth(parsed.depthPct, parsed.shape, isFancyColorMode);
  const ratioDiagnosis = evaluateRatio(parsed.ratio, parsed.shape);
  output.depthDiagnosis = depthDiagnosis;
  output.ratioDiagnosis = ratioDiagnosis;

  // 計算 Score
  const clawScore = calculateClawScore(output);
  output.clawScore = clawScore;
  // v7.9.1: verdict must be defined here before module-level assignment
  const verdict = getVerdict(clawScore, allFlags);
  output.verdict = verdict.grade;
  output.verdictEmoji = verdict.emoji;
  output.scoringMode = scoringMode;  // 'fancy' or 'white'
  output.isFancyColor = isFancyColorMode;
  // v7.9.0: Add certYear to output for Old Cert risk tracking
  if (parsed.reportDate) {
    const yearMatch = parsed.reportDate.match(/20(\d{2})/);
    output.certYear = yearMatch ? parseInt('20' + yearMatch[1]) : null;
  }

  // Output - Default to Discord Embed format
  if (isJson) {
    console.log(JSON.stringify(output, null, 2));
  } else if (outputAsEmbed || isEmbed) {
    // Discord Embed format (default)
    const embed = generateDiscordEmbed(output);
    console.log(JSON.stringify(embed, null, 2));
  } else if (isMd) {
    // Markdown 格式
    let md = `# 💎 GIA 專業寶石分析報告\n\n`;
    md += `📅 ${new Date().toLocaleDateString('zh-HK', { timeZone: 'Asia/Hong_Kong' })} HKT\n\n`;
    md += `## 📋 基本資訊\n\n`;
    md += `- **報告編號:** ${parsed.reportNumber || 'N/A'}\n`;
    md += `- **形狀:** ${parsed.shape || 'N/A'}\n`;
    md += `- **克拉:** ${parsed.carat ?? 'N/A'} ct\n`;
    md += `- **顏色:** ${parsed.color || 'N/A'}\n`;
    md += `- **淨度:** ${parsed.clarity || 'N/A'}\n`;
    md += `- **Cut:** ${parsed.cut || 'N/A'}\n`;
    md += `- **Polish/Sym:** ${parsed.polish || 'N/A'} / ${parsed.symmetry || 'N/A'}\n`;
    md += `- **螢光:** ${parsed.fluorescence || 'None'}\n`;
    md += `- **Score:** ${clawScore}/100 ${verdict.emoji} ${verdict.label}\n\n`;
    md += `## 📐 光學診斷\n\n`;
    md += `- **Depth:** ${parsed.depthPct || 'N/A'}% - ${depthDiagnosis.emoji} ${depthDiagnosis.detail}\n`;
    md += `- **Ratio:** ${parsed.ratio || 'N/A'} - ${ratioDiagnosis.emoji} ${ratioDiagnosis.label}\n\n`;
    if (allFlags.length > 0) {
      md += `## 🚩 風險診斷\n\n`;
      for (const flag of allFlags) {
        md += `- ${flag.flag} (${flag.severity}): ${flag.detail}\n`;
      }
    }
    md += `\n## 💰 採購建議\n\n`;
    md += `${verdict.emoji} **${verdict.verdictText}:** ${recommendation.reason}\n`;
    console.log(md);
  } else {
    // 專業報告格式
    console.log(formatProfessionalReport(output));
  }

  // 發送到 Discord (使用預設 channel 或 custom channel)
  if (isSend) {
    if (!isQuiet) log(`Sending to Discord...${customChannelId ? ` (channel: ${customChannelId})` : ''}`);
    try {
      const embed = generateDiscordEmbed(output);
      await sendToDiscord(embed, customChannelId);
      if (!isQuiet) log("✅ Report sent to Discord");
    } catch (e) {
      console.error(`❌ Failed to send to Discord: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error(`[GIA Analyzer] Fatal error: ${e.message}`);
    process.exit(1);
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  calculateClawScore,
  getVerdict,
  evaluateDepth,
  evaluateRatio,
  evaluateFaceUpSize,
  evaluateOvalMoval,     // v2.4.1 new
  checkSquareNailheadRisk, // v2.4.1 new
  enhancedRiskDetection,
  deduplicateFlags,
  formatProfessionalReport,
  generateDiscordEmbed,
  checkWindowingRisk,
  checkInvestmentGrade,
  checkStructuralRisk,   // v2.5.1 new: Cavity/Chip/Knot detection
  checkGirdleHiddenWeight,  // v2.6.0 new: Hidden weight detection
  checkSymmetrySpecifics,  // v2.6.0 new: Even 3EX can be penalized
  checkEyeCleanRisk,       // v2.6.0 new: Eye-clean position risk
  checkOriginPremium,
  calculateEffectiveCarat, // v2.4.2 new: Effective Carat Weight
  evaluateSpreadFactor,   // v2.4.2 new
  evaluateFancySpread,    // v2.4.2 new
  // v2.8.0 new exports
  checkBowTieRiskEnhanced, // v2.8.0: Enhanced bow-tie (bi-directional)
  checkTableRisk,          // v2.8.0: Table percentage risk (fish-eye)
  checkCertificateAgeRisk, // v2.8.0: Old certificate risk
  checkSuperIdeal,         // v2.8.0: H&A / Super Ideal detection
  checkClarityBasedOnClouds, // v2.8.0: Clarity based on clouds warning
  // v4.1.0 new exports
  checkBothField,               // v4.1.0: Helper to check both keyToSymbols and Comments
  evaluateGrainingRisk,        // v4.1.0: Graining risk for investment grade
  checkPavilionDepthRisk,      // v4.1.0: Pavilion depth / Headlight effect
  checkHazeMatrix,             // v4.1.0: Enhanced Haze Matrix with short-circuit
  DEPTH_RANGES,
  RATIO_RANGES,
  TABLE_RANGES,
  // v11.0.0: Batch processing exports
  parseGIACertificateText,   // Internal parser for text extraction
  runLogicEngine,             // Internal logic engine for flag generation
  // v2.9.0 new exports
  evaluateRoundCutGradePyramid,  // v2.9.0: Round cut grade pyramid
  checkTypeIIaRisk,                // v2.9.0: Type IIa detection
  checkCuletRisk,                  // v2.9.0: Black eye effect
  checkGirdleCondition,            // v2.9.0: Girdle condition
  checkUnderGradedHunter          // v2.9.0: Treasure hunt mode
};
