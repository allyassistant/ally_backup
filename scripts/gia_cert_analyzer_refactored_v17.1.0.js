#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const PDF_CONFIG = Object.freeze({
  command: 'pdftoppm', dpi: 200, format: 'png',
  pageRange: { first: 1, last: 1 }, TIMEOUT_MS: 30000
});

const HOME = process.env.HOME || require("os").homedir();
const AUTH_PROFILES = path.join(HOME, ".openclaw", "agents", "main", "agent", "auth-profiles.json");

const CONFIG = Object.freeze({
  MODULE_VERSION: '17.1.0',
  VERSION_NOTES: 'v17.1.0: 50-cycle Closed-Loop Test (~500 rounds, ~105 fixes). Diamond Expert Audit applied across 5 rounds. Depth-Table Balance math corrected. Fraud Lock moved to end-of-pipeline. reportType wired into lab-grown detection. Fancy I2/I3 clarity penalties added. Milky/Hazy case-sensitivity fix. SPREAD_CONSTANTS scope fix. Green Fluor detection added. Padparadscha & Type Ia/IaB detection. Cross-lab grading (IGI/EGL/HRD). Crown-Pavilion AGS pairing. Culet-Clarity reflector interaction. Antique Cut depth/table expanded. Discord Embed fully redesigned (12 sections). 9 new check functions. Full 140-function export coverage.',

  GIRDLE_PENALTY: {
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

  COLORS: Object.freeze({
    STRONG_BUY: 0x00E000, BUY: 0x0099FF, CAUTION: 0xFFAA00,
    CONDITIONAL: 0xFF6600, REJECT: 0xE00000, DEFAULT: 0x888888
  }),

  DISCORD_CHANNEL_ID: process.env.DISCORD_GIA_CHANNEL_ID || '1473383064565710929',
  DISCORD_REQ_TIMEOUT: 15000,

  THRESHOLDS: Object.freeze({
    SCORE_STRONG_BUY: 85, SCORE_BUY: 70, SCORE_CAUTION: 50, SCORE_CONDITIONAL: 30,
    DEPTH_TOLERANCE: 0.5, RATIO_TOLERANCE: 0.05,
    CARAT_SMALL_MAX: 2, CARAT_MEDIUM_MAX: 10, CARAT_LARGE_MAX: 50,
    FLUOR_COLOR_INDEX_MIN: 8, FLUOR_STRONG_MIN: 4,
    GIRDLE_THICK_THRESHOLD: 0.04,
    HAZE_SI1_INDEX: 18, HAZE_CLOUD_FLAG: 6, HAZE_SCORE_PENALTY: -15,
    MILKY_CLARITY_MAX: 22, MILKY_CLOUD_WEIGHT_MIN: 4, MILKY_SCORE_PENALTY: -10,
    NAILHEAD_DEPTH_MIN: 63.5, FISHEYE_DEPTH_MAX: 58.0
  }),

  SPREAD_CONSTANTS: Object.freeze({
    DIAMETER_EXPONENT: 0.5, DIAMETER_FACTOR: 6.45,
    BRIOLLE_SPREAD_FACTOR: 22, STEP_CUT_COMPENSATION: 1.15,
    SPREAD_COMPENSATION_MIN: 0.95, SPREAD_COMPENSATION_MAX: 1.05
  })
});

const RE = {
  CLOUD: /cloud/i,
  CLOUD_NOT_SHOWN: /cloud.*not\s*shown|clouds\s*not\s*shown/i,
  FLUOR_STRONG: /strong|very strong/i,
  FLUOR_MEDIUM: /medium/i,
  FLUOR_BLUE: /blue/i,
  CLARITY_SI: /si/i,
  GARBLED_TEXT: /[\u0000-\u001F\u007F-\u009F]/,
  REPEATED_CHARS: /(.)\1{5,}/,
  NON_ASCII_GARBAGE: /[^\x20-\x7E\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/g
};

const DIAMOND_TYPE = {
  WHITE_COLORS: ['D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
  FANCY_PREFIXES: ['Fancy','Vivid','Intense','Deep','Light','Pale'],
  FANCY_COLORS: ['Chameleon','Violet','Purple',
                'Pink','Blue','Green','Orange','Red','Yellow',
                'Brown','Black','Gray','Grey','White',
                'Champagne','Cognac','Chocolate',
                'Pinkish','Purplish','Bluish','Greenish','Orangy','Reddish','Yellowness','Greyish','Grayish'],
  ROUND_SHAPES: ['Round Brilliant','Round','RB','Round Diamond'],
  FANCY_SHAPES: ['Oval Brilliant','Oval','Pear Brilliant','Pear','Marquise Brilliant','Marquise',
    'Emerald Cut','Emerald','Asscher Cut','Asscher','Princess Cut','Princess',
    'Cushion Brilliant','Cushion','Radiant Cut','Radiant','Heart Brilliant','Heart',
    'Trillion Brilliant','Trillion','Triangle Brilliant','Triangle','Baguette','Cannon',
    'Old European Cut','Old Mine Cut','Cushion Modified'],
  SPECIALTY_SHAPES: ['Briolette','Rose Cut','Rose','Portuguese','Candlelight','Portrait'],

  isWhiteDiamond(color) {
    if (!color) return false;
    return this.WHITE_COLORS.includes(color.toUpperCase().trim());
  },
  isFancyColor(color) {
    if (!color) return false;
    const c = color.toUpperCase();
    return this.FANCY_PREFIXES.some(p => c.includes(p.toUpperCase()))
        || this.FANCY_COLORS.some(fc => c.includes(fc.toUpperCase()));
  },
  getFancyColorName(color) {
    if (!color) return null;
    const c = color.toUpperCase();
    for (const fc of this.FANCY_COLORS) {
      if (c.includes(fc.toUpperCase())) return fc;
    }
    return null;
  },
  isRoundShape(shape) {
    if (!shape) return false;
    const s = shape.toUpperCase();
    return this.ROUND_SHAPES.some(rs => s.includes(rs.toUpperCase()));
  },
  isFancyShape(shape) {
    if (!shape) return false;
    const s = shape.toUpperCase();
    return this.FANCY_SHAPES.some(fs => s.includes(fs.toUpperCase()));
  },
  isSpecialtyShape(shape) {
    if (!shape) return false;
    const s = shape.toUpperCase();
    return this.SPECIALTY_SHAPES.some(ss => s.includes(ss.toUpperCase()));
  }
};

const FLUOR_COLORS = {
  BLUE: /blue/i, GREEN: /green/i, YELLOW: /yellow/i,
  ORANGE: /orange/i, WHITE: /white/i, RED: /red/i,
  BLUE_GREEN: /blue-?green/i, YELLOW_GREEN: /yellow-?green/i,
  STRONG_PATTERNS: /strong|very strong|very strong blue/i,
  MEDIUM_PATTERNS: /medium/i,
  WEAK_PATTERNS: /faint|weak/i,
  NONE_PATTERNS: /none/i,

  analyze(fluor) {
    if (!fluor) return { color: null, strength: null, hasFluor: false };
    const f = fluor.toLowerCase();
    let color = null;
    if (this.BLUE_GREEN.test(f)) color = 'Blue-Green';
    else if (this.YELLOW_GREEN.test(f)) color = 'Yellow-Green';
    else if (this.BLUE.test(f)) color = 'Blue';
    else if (this.GREEN.test(f)) color = 'Green';
    else if (this.YELLOW.test(f)) color = 'Yellow';
    else if (this.ORANGE.test(f)) color = 'Orange';
    else if (this.RED.test(f)) color = 'Red';
    else if (this.WHITE.test(f)) color = 'White';
    let strength = null;
    if (this.STRONG_PATTERNS.test(f)) strength = 'Strong';
    else if (this.MEDIUM_PATTERNS.test(f)) strength = 'Medium';
    else if (this.WEAK_PATTERNS.test(f)) strength = 'Weak';
    else if (!this.NONE_PATTERNS.test(f)) strength = 'Faint';
    return { color, strength, hasFluor: color !== null || strength !== null, rawValue: fluor };
  }
};

const CARAT_TIERS = {
  MAGIC_NUMBERS: [0.3, 0.4, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0],
  BOUNDARIES: [0.3, 0.5, 1.0, 2.0, 3.0, 5.0],
  getTier(carat) {
    const c = typeof carat === 'number' ? carat : parseFloat(carat);
    if (isNaN(c)) return { tier: null, isMagic: false, boundary: null };
    const isMagic = this.MAGIC_NUMBERS.some(m => Math.abs(c - m) < 0.01);
    let boundary = null, closest = null, diff = Infinity;
    for (const b of this.BOUNDARIES) { const d = Math.abs(c - b); if (d < diff) { diff = d; closest = b; } }
    boundary = diff < 0.1 ? closest : null;
    let tier = null;
    if (c < 0.3) tier = 'Pip'; else if (c < 0.5) tier = 'Light'; else if (c < 1.0) tier = 'Carat'; else if (c < 2.0) tier = 'Mid'; else if (c < 3.0) tier = 'Large'; else if (c < 5.0) tier = 'Jumbo'; else tier = 'Mega';
    return { tier, isMagic, boundary, carat: c };
  },
  getTierLabel(carat) {
    const t = this.getTier(carat);
    if (!t.tier) return 'Unknown';
    let label = `${t.tier} (${t.carat.toFixed(2)}ct)`;
    if (t.isMagic) label += ' ✨';
    if (t.boundary) label += ` [~${t.boundary}ct]`;
    return label;
  }
};

const CUT_GRADE = {
  RATINGS: ['Excellent','Very Good','Good','Fair','Poor'],
  RANK_MAP: { 'Excellent': 0, 'Very Good': 1, 'Good': 2, 'Fair': 3, 'Poor': 4 },
  analyze(data) {
    const shape = data.shape || '';
    const isRound = DIAMOND_TYPE.isRoundShape(shape);
    const cutGrade = data.cutGrade || data.cut || '';
    const polish = data.polish || '';
    const symmetry = data.symmetry || '';
    const result = { shape, isRound, cutGrade: cutGrade || 'Non-Graded', polish: polish || 'Non-Graded', symmetry: symmetry || 'Non-Graded', gradeScore: null, polishScore: this.getRatingScore(polish), symmetryScore: this.getRatingScore(symmetry), overallScore: null, hasCutGrade: !!cutGrade, warnings: [] };
    if (isRound && cutGrade) { result.gradeScore = this.RANK_MAP[cutGrade] ?? null; result.overallScore = (result.gradeScore || 0) * 2 + (result.polishScore || 0) + (result.symmetryScore || 0); }
    else { result.overallScore = (result.polishScore || 0) + (result.symmetryScore || 0); if (!isRound && polish === 'Poor') result.warnings.push('Poor Polish may cause uneven surface appearance'); if (!isRound && symmetry === 'Poor') result.warnings.push('Poor Symmetry may cause shape asymmetry'); }
    if (isRound) { if (cutGrade === 'Poor' || cutGrade === 'Fair') result.warnings.push(cutGrade + ' Cut Grade affects fire and brightness'); if (polish === 'Poor') result.warnings.push('Poor Polish affects surface luster'); if (symmetry === 'Poor') result.warnings.push('Poor Symmetry affects optical symmetry'); }
    return result;
  },
  getRatingScore(rating) { if (!rating) return null; return this.RANK_MAP[rating] ?? null; },
  isIdealCut(data) { const a = this.analyze(data); return a.isRound && a.cutGrade === 'Excellent' && a.polish === 'Excellent' && a.symmetry === 'Excellent'; }
};

const LAB_TREATMENT = {
  LAB_GROWN_PATTERNS: [/laboratory\s*grown/i, /lab\s*created/i, /lab\s*grown/i, /synthetic/i, /man-?made/i, /cultured/i, /grown/i, /gem quality lab/i],
  HPHT_PATTERN: /hpht/i, IRRADIATED_PATTERN: /irradiated/i, LASER_DRILLED_PATTERN: /laser\s*drilled/i, FRACTURE_FILLED_PATTERN: /fracture\s*filled/i, COATED_PATTERN: /coated/i, FLUORESCENCE_TREATED_PATTERN: /fluorescence\s*treated/i, COLOR_ENHANCED_PATTERN: /color\s*enhanced/i, HPA_PATTERN: /high\s*pressure\s*(?:anneal|process)/i,
  detectLabGrown(data) {
    const reportType = (data.reportType || '').toLowerCase();
    if (/laboratory.?grown|lab.?grown|synthetic/i.test(reportType)) return { isLabGrown: true, type: 'LGDR (Report Type)' };
    const text = this.getCombinedText(data);
    for (const p of this.LAB_GROWN_PATTERNS) { if (p.test(text)) return { isLabGrown: true, type: this.getLabGrownType(text) }; }
    return { isLabGrown: false, type: null };
  },
  getLabGrownType(text) { const t = text.toLowerCase(); if (/chemical\s*vapor/i.test(t)) return 'CVD'; if (/high\s*pressure.*high\s*temperature/i.test(t) || /hpht/i.test(t)) return 'HPHT'; if (/chemical\s*deposition/i.test(t)) return 'CVD'; if (/flux/i.test(t)) return 'Flux'; if (/hydrothermal/i.test(t)) return 'Hydrothermal'; return 'Lab Grown'; },
  detectTreatment(data) { const text = this.getCombinedText(data); const treatments = []; if (this.HPHT_PATTERN.test(text)) treatments.push('HPHT'); if (this.IRRADIATED_PATTERN.test(text)) treatments.push('Irradiated'); if (this.LASER_DRILLED_PATTERN.test(text)) treatments.push('Laser Drilled'); if (this.FRACTURE_FILLED_PATTERN.test(text)) treatments.push('Fracture Filled'); if (this.COATED_PATTERN.test(text)) treatments.push('Coated'); return { hasTreatment: treatments.length > 0, treatments }; },
  getCombinedText(data) { return [data.description, data.comments, data.additionalComments, data.reportNumber].join(' ').toLowerCase(); }
};

const CLARITY_RANK = {
  RANKS: ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2','I1','I2','I3'],
  getIndex(clarity) { if (!clarity) return -1; return this.RANKS.indexOf(clarity.toUpperCase().trim()); },
  isLowClarity(clarity) { return this.getIndex(clarity) >= 6; },
  getLabel(clarity) { const i = this.getIndex(clarity); if (i < 0) return 'Unknown'; if (i <= 1) return 'Top Quality'; if (i <= 3) return 'VVS'; if (i <= 5) return 'VS'; if (i <= 7) return 'SI'; return 'Included'; },
  getEyeClean(clarity) { const i = this.getIndex(clarity); if (i < 0) return 'Unknown'; if (i <= 5) return 'Eye-Clean'; if (i <= 7) return 'May be eye-clean'; return 'Not Eye-Clean'; }
};
// ============================================================================
// SECTION 4: OPTICAL CONSTANTS & FUNCTIONS (v17.1.0)
// ============================================================================

const DEPTH_RANGES = Object.freeze({
  'Round Brilliant': { min: 59, max: 63, ideal: 61.5 },
  'Radiant Cut': { min: 58, max: 68, ideal: 64 },
  'Emerald Cut': { min: 60, max: 70, ideal: 65 },
  'Oval Brilliant': { min: 56, max: 65, ideal: 60.5 },
  'Cushion': { min: 60, max: 68, ideal: 64 },
  'Cushion Modified Brilliant': { min: 60, max: 68, ideal: 64 },
  'Princess Cut': { min: 68, max: 75, ideal: 71.5 },
  'Asscher Cut': { min: 60, max: 70, ideal: 65 },
  'Heart Brilliant': { min: 55, max: 65, ideal: 60 },
  'Marquise Brilliant': { min: 55, max: 64, ideal: 60 },
  'Pear Brilliant': { min: 53, max: 66, ideal: 60 },
  'default': { min: 58, max: 68, ideal: 63 }
});

const TABLE_RANGES = Object.freeze({
  'Round Brilliant': { min: 54, max: 62, ideal: 57 },
  'Radiant Cut': { min: 60, max: 72, ideal: 66 },
  'Emerald Cut': { min: 60, max: 72, ideal: 66 },
  'Oval Brilliant': { min: 53, max: 65, ideal: 58 },
  'Cushion': { min: 56, max: 69, ideal: 62 },
  'Cushion Modified Brilliant': { min: 56, max: 69, ideal: 62 },
  'Princess Cut': { min: 62, max: 75, ideal: 68 },
  'Asscher Cut': { min: 60, max: 72, ideal: 66 },
  'Heart Brilliant': { min: 52, max: 64, ideal: 58 },
  'Marquise Brilliant': { min: 53, max: 65, ideal: 58 },
  'Pear Brilliant': { min: 53, max: 65, ideal: 58 },
  'default': { min: 54, max: 72, ideal: 60 }
});

const RATIO_RANGES = Object.freeze({
  'Round Brilliant': { min: 1.00, max: 1.02, ideal: 1.00 },
  'Oval Brilliant': { min: 1.30, max: 1.55, ideal: 1.40 },
  'Marquise Brilliant': { min: 1.70, max: 2.10, ideal: 1.85 },
  'Pear Brilliant': { min: 1.45, max: 1.75, ideal: 1.55 },
  'Heart Brilliant': { min: 0.90, max: 1.15, ideal: 1.00 },
  'Emerald Cut': { min: 1.30, max: 1.55, ideal: 1.40 },
  'Radiant Cut': { min: 1.00, max: 1.40, ideal: 1.20 },
  'Princess Cut': { min: 1.00, max: 1.08, ideal: 1.00 },
  'Asscher Cut': { min: 1.00, max: 1.08, ideal: 1.00 },
  'Cushion': { min: 1.00, max: 1.25, ideal: 1.10 },
  'Cushion Modified Brilliant': { min: 1.00, max: 1.25, ideal: 1.10 },
  'default': { min: 1.00, max: 1.50, ideal: 1.20 }
});

const FANCY_DEPTH_RANGES = Object.freeze({
  'Radiant Cut': { min: 62, max: 72, ideal: 68 },
  'Cushion': { min: 62, max: 72, ideal: 68 },
  'Cushion Modified Brilliant': { min: 62, max: 72, ideal: 68 },
  'Pear Brilliant': { min: 58, max: 68, ideal: 64 },
  'Oval Brilliant': { min: 58, max: 66, ideal: 62 },
  'Emerald Cut': { min: 62, max: 72, ideal: 68 },
  'default': { min: 60, max: 72, ideal: 66 }
});

const FANCY_TABLE_RANGES = Object.freeze({
  'Radiant Cut': { min: 62, max: 76, ideal: 70 },
  'Cushion': { min: 60, max: 74, ideal: 68 },
  'Cushion Modified Brilliant': { min: 60, max: 74, ideal: 68 },
  'Pear Brilliant': { min: 55, max: 68, ideal: 62 },
  'Oval Brilliant': { min: 55, max: 68, ideal: 62 },
  'Emerald Cut': { min: 62, max: 76, ideal: 70 },
  'default': { min: 58, max: 74, ideal: 66 }
});

const FANCY_COLOR_MODIFIER = Object.freeze({
  'FANCY VIVID': { score: 30, factor: 1.5 },
  'FANCY INTENSE': { score: 25, factor: 1.3 },
  'FANCY DEEP': { score: 22, factor: 1.25 },
  'FANCY DARK': { score: 5, factor: 0.7 },
  'FANCY LIGHT': { score: 10, factor: 0.85 },
  'FANCY': { score: 15, factor: 1.0 },
  'FAINT': { score: 3, factor: 0.6 },
  'VERY LIGHT': { score: 5, factor: 0.7 },
  'LIGHT': { score: 7, factor: 0.8 }
});

const FANCY_RARITY_RULE = Object.freeze({
  'RED': { bonus: 40, label: 'Red Diamond — Extreme Rarity (Rarest)' },
  'VIOLET': { bonus: 30, label: 'Violet Diamond Rarity Premium' },
  'GREEN': { bonus: 28, label: 'Green Diamond — Naturally Rarer Than Blue' },
  'BLUE': { bonus: 25, label: 'Blue Diamond Rarity Premium' },
  'ORANGE': { bonus: 20, label: 'Orange Diamond Rarity Premium (Verify Natural)' },
  'PINK': { bonus: 25, label: 'Pink Diamond — Argyle Closed, Premium Rising' },
  'PURPLE': { bonus: 22, label: 'Purple Diamond Rarity Premium' },
  'CHAMELEON': { bonus: 35, label: 'Chameleon Diamond — Color-Change Effect' },
  'YELLOW': { bonus: 5, label: 'Yellow Diamond — Most Common Fancy' },
  'BROWN': { bonus: 2, label: 'Brown Diamond — Champagne/Cognac' },
  'GRAY': { bonus: 5, label: 'Gray Diamond — Undervalued Rarity' },
  'BLACK': { bonus: 0, label: 'Black Diamond — Common/Treated' },
  'WHITE': { bonus: 8, label: 'White Fancy Diamond — Opalescent Rarity' }
});

const CHAMPAGNE_EFFECT = Object.freeze({
  colorRange: ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'],
  modifiers: {
    'CHAMPAGNE': { bonus: 10, label: 'Champagne Diamond — Premium Low Color' },
    'COGNAC': { bonus: 15, label: 'Cognac Diamond — Darker Champagne Premium' },
    'HONEY': { bonus: 8, label: 'Honey Tone — Warm Low Color Appeal' }
  }
});

// ============================================================================
// SECTION 4A: OPTICAL FUNCTIONS
// ============================================================================

function evaluateDepth(depthPct, shape, isFancyColor, carat) {
  const shapeLower = (shape || '').toLowerCase();

  if (shapeLower && DIAMOND_TYPE.isSpecialtyShape(shapeLower)) {
    return { status: 'bypass', emoji: '\u2139\ufe0f', label: 'N/A (Designer Cut)', detail: shape + ' \u70ba\u8a2d\u8a08\u5e2b\u5207\u5de5\uff0c\u6dfa\u6df1\u5ea6\u4fc2\u85dd\u8853\u50f9\u503c\u6240\u5728\uff0c\u8df3\u904e\u6a19\u6e96\u6df1\u5ea6\u8a55\u4f30' };
  }

  // Antique cuts: use wider tolerance (OEC/OMC typically 58-72% depth)
  const isAntique = /old mine|old european|old miner|antique/i.test(shapeLower);
  if (isAntique) {
    const d = parseFloat(depthPct);
    if (isNaN(d)) return { status: 'bypass', emoji: '\u2139\ufe0f', label: 'N/A (Antique Cut)', detail: shape + ' depth unknown, skipped' };
    if (d >= 58 && d <= 72) return { status: 'ideal', emoji: '\u2705', label: 'Antique Cut Depth: Acceptable', detail: 'Depth ' + d + '% within antique range (58-72%). Old cuts naturally have deeper proportions.' };
    if (d < 50 || d > 78) return { status: 'critical', emoji: '\u26a0\ufe0f', label: 'Antique Cut: Extreme Depth', detail: 'Depth ' + d + '% outside even antique tolerance' };
    return { status: 'normal', emoji: '\u26a1', label: 'Antique Cut Depth: Atypical', detail: 'Depth ' + d + '% — atypical but antique cuts vary widely' };
  }

  let lookupShape = shape || 'default';

  if (shapeLower.includes('round') && !shapeLower.includes('brilliant')) lookupShape = 'Round Brilliant';
  else if (shapeLower.includes('pear') && !shapeLower.includes('brilliant')) lookupShape = 'Pear Brilliant';
  else if (shapeLower.includes('marquise') && !shapeLower.includes('brilliant')) lookupShape = 'Marquise Brilliant';
  else if (shapeLower.includes('oval') && !shapeLower.includes('brilliant')) lookupShape = 'Oval Brilliant';
  else if (shapeLower.includes('cushion') && !shapeLower.includes('modified')) lookupShape = 'Cushion';
  else if (shapeLower.includes('cushion') && shapeLower.includes('modified')) lookupShape = 'Cushion Modified Brilliant';
  else if (shapeLower.includes('princess')) lookupShape = 'Princess Cut';
  else if (shapeLower.includes('asscher')) lookupShape = 'Asscher Cut';
  else if (shapeLower.includes('heart')) lookupShape = 'Heart Brilliant';
  else if (shapeLower.includes('radiant')) lookupShape = 'Radiant Cut';
  else if (shapeLower.includes('emerald')) lookupShape = 'Emerald Cut';

  let range;
  if (isFancyColor && (shapeLower.includes('cushion') || shapeLower.includes('radiant') ||
      shapeLower.includes('pear') || shapeLower.includes('oval') || shapeLower.includes('emerald'))) {
    range = FANCY_DEPTH_RANGES[lookupShape] || FANCY_DEPTH_RANGES['default'];
  } else {
    range = DEPTH_RANGES[lookupShape] || DEPTH_RANGES['default'];
  }

  const depth = parseFloat(depthPct);
  if (isNaN(depth)) return { status: 'unknown', emoji: '\u2753', label: 'N/A', detail: '\u7121\u6cd5\u8a08\u7b97 Depth' };

  // Large stone tolerance: 5ct+ fancy shapes get +2% depth range (weight retention is market-accepted)
  var caratNum = parseFloat(carat);
  var depthBonus = (!isNaN(caratNum) && caratNum >= 5 && !/round/i.test(shapeLower)) ? 2 : 0;
  var adjMin = range.min - depthBonus;
  var adjMax = range.max + depthBonus;

  // Extreme values likely indicate data errors, not real proportions
  if (depth < adjMin - 10) {
    return { status: 'critical', emoji: '\u26a0\ufe0f', label: 'Probable Data Error (Extreme Shallow)', detail: 'Depth ' + depth + '% is ' + (adjMin - depth).toFixed(0) + '% below normal minimum of ' + adjMin + '% — likely a data/OCR error rather than real proportions' };
  }
  if (depth > adjMax + 10) {
    return { status: 'critical', emoji: '\u26a0\ufe0f', label: 'Probable Data Error (Extreme Deep)', detail: 'Depth ' + depth + '% is ' + (depth - adjMax).toFixed(0) + '% above normal maximum of ' + adjMax + '% — likely a data/OCR error rather than real proportions' };
  }

  if (depth < adjMin) {
    return { status: 'critical', emoji: '\ud83d\udd34', label: 'CRITICAL: Severe Windowing', detail: 'Depth ' + depth + '% < \u6700\u4f4e ' + adjMin + '% | \u5149\u7dda\u76f4\u63a5\u7a7f\u900f,\u4e2d\u5fc3\u5931\u53bb\u9583\u720d' };
  }
  if (depth > adjMax) {
    return { status: 'critical', emoji: '\ud83d\udd34', label: 'CRITICAL: Too Deep', detail: 'Depth ' + depth + '% > \u6700\u9ad8 ' + adjMax + '% | \u8996\u89ba\u91cd\u91cf\u88ab\u96b1\u85cf,\u770b\u8d77\u4f86\u6bd4\u5be6\u969b\u5c0f' };
  }
  if (Math.abs(depth - range.ideal) <= 0.5) {
    return { status: 'ideal', emoji: '\u2705', label: 'Ideal Depth', detail: 'Depth ' + depth + '% \u5b8c\u7f8e (\u7406\u60f3\u503c: ' + range.ideal.toFixed(1) + '%)' };
  }
  return { status: 'normal', emoji: '\u26a1', label: 'Normal Depth', detail: 'Depth ' + depth + '% \u6b63\u5e38 (\u7bc4\u570d: ' + range.min + '-' + range.max + '%)' };
}

function evaluateRatio(ratio, shape) {
  const shapeLower = (shape || '').toLowerCase();
  const r = parseFloat(ratio);
  if (isNaN(r) || r <= 0) return null;

  // Round-specific perfect ratio check
  if (/round/i.test(shapeLower) && r >= 1.00 && r <= 1.01) {
    return { status: 'ideal', label: '\u2705 Perfect Round Ratio (1.00-1.01)', detail: 'Ratio = \u5b8c\u7f8e\u5713\u5f62 (1.00-1.01)', score: 2 };
  }

  // Square Emerald bonus: 1.00-1.05 ratio on Emerald Cut = perfect square, rare and premium
  if (shapeLower.includes('emerald')) {
    const isSquareEmerald = /square\s*emerald|emerald\s*square/i.test(shape);
    if ((isSquareEmerald || r <= 1.06) && r >= 1.00 && r <= 1.06) {
      return { status: 'ideal', label: '\u2705 Perfect Square Emerald (' + r.toFixed(2) + ')', detail: 'Square Emerald Ratio ' + r.toFixed(2) + ' = rarely achieved perfect square proportions. Premium +5 for square precision.', score: 5 };
    }
  }

  let lookupShape = 'default';
  if (shapeLower.includes('round')) lookupShape = 'Round Brilliant';
  else if (shapeLower.includes('oval')) lookupShape = 'Oval Brilliant';
  else if (shapeLower.includes('marquise')) lookupShape = 'Marquise Brilliant';
  else if (shapeLower.includes('pear')) lookupShape = 'Pear Brilliant';
  else if (shapeLower.includes('heart')) lookupShape = 'Heart Brilliant';
  else if (shapeLower.includes('emerald')) lookupShape = 'Emerald Cut';
  else if (shapeLower.includes('radiant')) lookupShape = 'Radiant Cut';
  else if (shapeLower.includes('princess')) lookupShape = 'Princess Cut';
  else if (shapeLower.includes('asscher')) lookupShape = 'Asscher Cut';
  else if (shapeLower.includes('cushion') && !shapeLower.includes('modified')) lookupShape = 'Cushion';
  else if (shapeLower.includes('cushion') && shapeLower.includes('modified')) lookupShape = 'Cushion Modified Brilliant';

  const range = RATIO_RANGES[lookupShape] || RATIO_RANGES['default'];

  if (r >= range.ideal - 0.03 && r <= range.ideal + 0.03) {
    return { status: 'ideal', label: '\u2705 Ideal Ratio', detail: 'Ratio ' + r.toFixed(2) + ' = \u7406\u60f3\u6bd4\u4f8b (' + shape + ')' };
  }
  if (r >= range.min && r <= range.max) {
    return { status: 'normal', label: '\u26a1 Normal Ratio', detail: 'Ratio ' + r.toFixed(2) + ' = \u6b63\u5e38\u7bc4\u570d (' + range.min.toFixed(2) + '-' + range.max.toFixed(2) + ')' };
  }
  return { status: 'warning', label: '\u26a0\ufe0f Outlier Ratio', detail: 'Ratio ' + r.toFixed(2) + ' = \u8d85\u51fa\u6b63\u5e38\u7bc4\u570d (' + range.min.toFixed(2) + '-' + range.max.toFixed(2) + ')' };
}

function evaluateFaceUpSize(carat, depthPct, shape) {
  const c = parseFloat(carat);
  const d = parseFloat(depthPct);
  if (isNaN(c) || isNaN(d) || c <= 0) return null;

  const diameterWeight = CONFIG.SPREAD_CONSTANTS.DIAMETER_FACTOR * Math.pow(c, CONFIG.SPREAD_CONSTANTS.DIAMETER_EXPONENT);
  const depthLoss = (d - 61.5) / 100;
  const adjustedSpread = diameterWeight * (1 - depthLoss * 0.4);

  let status, label, detail;
  if (adjustedSpread >= diameterWeight * 1.02) {
    status = 'excellent'; label = '\ud83d\udc8e Excellent Spread';
    detail = 'Face-up size ' + adjustedSpread.toFixed(2) + 'mm > expected ' + diameterWeight.toFixed(2) + 'mm (\u6dfa\u6df1\u5ea6\u653e\u5927\u6548\u679c)';
  } else if (adjustedSpread >= diameterWeight * 0.98) {
    status = 'good'; label = '\u2705 Good Spread';
    detail = 'Face-up size ' + adjustedSpread.toFixed(2) + 'mm ~ expected ' + diameterWeight.toFixed(2) + 'mm';
  } else if (adjustedSpread >= diameterWeight * 0.92) {
    status = 'fair'; label = '\u26a1 Fair Spread';
    detail = 'Face-up size ' + adjustedSpread.toFixed(2) + 'mm < expected ' + diameterWeight.toFixed(2) + 'mm (\u6df1\u5ea6\u904e\u5927\u7e2e\u5c0f\u6aaf\u9762)';
  } else {
    status = 'poor'; label = '\u26a0\ufe0f Poor Spread';
    detail = 'Face-up size ' + adjustedSpread.toFixed(2) + 'mm << expected ' + diameterWeight.toFixed(2) + 'mm (\u56b4\u91cd\u7e2e\u6c34)';
  }

  return { status: status, label: label, detail: detail, actualSpread: adjustedSpread, expectedSpread: diameterWeight, spreadRatio: adjustedSpread / diameterWeight };
}

function evaluateSpreadFactor(data) {
  const carat = parseFloat(data.carat);
  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);
  if (isNaN(carat) || isNaN(depthPct) || carat <= 0) return null;

  let spreadScore = 0;
  const flags = [];

  const idealDepth = 61.5;
  const depthDelta = Math.abs(depthPct - idealDepth);
  if (depthDelta <= 1) { spreadScore += 10; flags.push('Depth \u63a5\u8fd1\u7406\u60f3 = \u6aaf\u9762\u6700\u5927\u5316'); }
  else if (depthDelta <= 3) { spreadScore += 5; }
  else { spreadScore -= 5; flags.push('Depth \u504f\u96e2\u7406\u60f3 = \u6aaf\u9762\u7e2e\u5c0f'); }

  if (!isNaN(tablePct)) {
    const shape = (data.shape || '').toLowerCase();
    let tableRange = TABLE_RANGES['Round Brilliant'];
    if (shape.includes('oval')) tableRange = TABLE_RANGES['Oval Brilliant'];
    else if (shape.includes('marquise')) tableRange = TABLE_RANGES['Marquise Brilliant'];
    else if (shape.includes('pear')) tableRange = TABLE_RANGES['Pear Brilliant'];

    if (tablePct >= tableRange.ideal - 2 && tablePct <= tableRange.ideal + 2) {
      spreadScore += 5; flags.push('Table \u63a5\u8fd1\u7406\u60f3');
    } else if (tablePct > tableRange.max) {
      spreadScore -= 5; flags.push('Table \u904e\u5927 = \u706b\u5f69\u4e0d\u8db3');
    } else if (tablePct < tableRange.min) {
      spreadScore -= 3; flags.push('Table \u904e\u5c0f = \u5149\u7dda\u9032\u5165\u4e0d\u8db3');
    }
  }

  if (carat >= 1) spreadScore += 2;
  if (carat >= 2) spreadScore += 3;
  if (carat >= 5) spreadScore += 5;

  spreadScore = Math.max(-15, Math.min(25, spreadScore));

  return {
    score: spreadScore,
    type: spreadScore >= 10 ? 'info' : (spreadScore >= 0 ? 'info' : 'warning'),
    label: spreadScore >= 10 ? '\ud83d\udc8e Excellent Spread Factor' : (spreadScore >= 0 ? '\u2705 Good Spread Factor' : '\u26a0\ufe0f Poor Spread Factor'),
    detail: flags.join(' | ') || 'Spread factor based on depth, table, and carat',
    scoreImpact: spreadScore >= 10 ? 5 : (spreadScore >= 0 ? 0 : spreadScore),
    severity: spreadScore >= 10 ? 'INFO' : (spreadScore >= 0 ? 'INFO' : 'MEDIUM')
  };
}

// ============================================================================
// SECTION 5: RISK DETECTION FUNCTIONS (Original, Unchanged)
// ============================================================================

function checkTreatmentRisk(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  if (/hpht|high pressure high temperature/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: HPHT Treatment Detected', detail: 'HPHT treatment = artificially altered color, significant value loss', scoreImpact: -50, severity: 'CRITICAL' };
  }
  if (/irradiat|irradiated/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: Irradiated Diamond', detail: 'Irradiated diamond = artificially altered color, reject', scoreImpact: -50, severity: 'CRITICAL' };
  }
  if (/\bcoated\b|\bcoating\b/i.test(combinedText) && !/\buncoated\b|\bno coating\b/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: Coated Diamond', detail: 'Surface coating = unstable treatment', scoreImpact: -100, severity: 'CRITICAL' };
  }
  if (/clarity\s*enhanc|fracture\s*fill/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: Clarity Enhanced (Fracture Filled)', detail: 'Fracture filled = poor stability, heat-sensitive', scoreImpact: -100, severity: 'CRITICAL' };
  }
  return null;
}

function checkStructuralRisk(data) {
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = keyToSymbols + ' ' + comments;

  const hasFeather = /feather/i.test(combinedText);
  const hasCavity = /cavity/i.test(combinedText);
  const hasChip = /chip/i.test(combinedText);
  const hasKnot = /knot/i.test(combinedText);
  const hasCleavage = /cleavage/i.test(combinedText);

  if (!hasFeather && !hasCavity && !hasChip && !hasKnot && !hasCleavage) return null;

  let scoreImpact = 0;
  let severity = 'LOW';
  const findings = [];

  if (hasFeather) {
    const isLarge = /large|prominent|sever/i.test(combinedText);
    if (isLarge) { scoreImpact -= 15; severity = 'HIGH'; findings.push('Large feather = structural risk, may extend'); }
    else { scoreImpact -= 5; severity = 'MEDIUM'; findings.push('Feather present = minor structural risk'); }
  }
  if (hasCavity) { scoreImpact -= 12; if (severity !== 'HIGH') severity = 'HIGH'; findings.push('Cavity = open surface void, weakens structure'); }
  if (hasChip) { scoreImpact -= 15; severity = 'HIGH'; findings.push('Chip = surface fracture, structural damage'); }
  if (hasKnot) { scoreImpact -= 10; severity = 'HIGH'; findings.push('Knot = crystal reaching surface, polish risk'); }
  if (hasCleavage) { scoreImpact -= 20; severity = 'CRITICAL'; findings.push('Cleavage plane = critical structural weakness'); }

  if (findings.length === 0) return null;
  return { type: severity === 'CRITICAL' ? 'critical' : 'warning', label: 'Structural Risk Detected', detail: findings.join(' | '), scoreImpact: scoreImpact, severity: severity };
}

function checkGirdleDeadWeightRisk(data) {
  const girdle = (data.girdle || '').toLowerCase();
  if (!girdle) return null;

  if (/very thick|extremely thick|thick to very thick/i.test(girdle)) {
    const carat = parseFloat(data.carat) || 0;
    const penalty = carat >= 3 ? 20 : (carat >= 1 ? 12 : 8);
    return { type: 'warning', label: 'Girdle Dead Weight Risk', detail: 'Girdle: ' + data.girdle + ' = too thick, hides weight. ' + (carat >= 1 ? carat.toFixed(2) + 'ct impact significant.' : ''), scoreImpact: -penalty, severity: 'MEDIUM' };
  }
  if (/thick/i.test(girdle) && !/very|extremely/i.test(girdle)) {
    return { type: 'info', label: 'Thick Girdle', detail: 'Girdle: ' + data.girdle + ' = slightly thick, minor weight hiding', scoreImpact: -4, severity: 'LOW' };
  }
  return null;
}

function checkAuctionGradeCompensation(data) {
  const carat = parseFloat(data.carat) || 0;
  const color = (data.color || '').toUpperCase();
  const clarity = (data.clarity || '').toUpperCase();
  const shape = (data.shape || '').toLowerCase();

  let scoreImpact = 0;
  const findings = [];

  if (carat >= 5 && ['D', 'E', 'F'].includes(color) && ['FL', 'IF', 'VVS1'].includes(clarity)) {
    scoreImpact += 20; findings.push('5ct+ D-F/IF-VVS1 = auction grade, premium 20-40%');
  } else if (carat >= 3 && ['D', 'E'].includes(color) && ['IF', 'VVS1', 'VVS2'].includes(clarity)) {
    scoreImpact += 10; findings.push('3ct+ D-E/IF-VVS2 = investment grade, premium 10-20%');
  } else if (carat >= 2 && color === 'D' && clarity === 'IF') {
    scoreImpact += 15; findings.push('2ct+ D-IF = extreme rarity, auction premium');
  }

  if (shape.includes('round') && carat >= 3 && ['D', 'E', 'F'].includes(color)) {
    scoreImpact += 5; findings.push('3ct+ Round D-F = most popular auction shape');
  }

  if (findings.length === 0) return null;
  return { type: 'info', label: 'Auction Grade Premium', detail: findings.join(' | '), scoreImpact: scoreImpact, severity: 'INFO' };
}

function checkSymmetrySpecifics(data) {
  const symmetry = (data.symmetry || '').toLowerCase();
  if (!symmetry || /excellent|very good/i.test(symmetry)) return null;
  const shape = (data.shape || '').toLowerCase();
  if (/good/i.test(symmetry)) {
    const penalty = /round/i.test(shape) ? 5 : 3;
    return { type: 'info', label: 'Symmetry: Good', detail: 'Good symmetry = slight asymmetry, may affect fire distribution', scoreImpact: -penalty, severity: 'LOW' };
  }
  if (/fair|poor/i.test(symmetry)) {
    const penalty2 = /round/i.test(shape) ? 12 : 8;
    return { type: 'warning', label: 'Symmetry: Fair/Poor', detail: data.symmetry + ' symmetry = obvious asymmetry, severely impacts optics', scoreImpact: -penalty2, severity: 'HIGH' };
  }
  return null;
}

function checkEyeCleanRisk(data) {
  if (isFancyColorExtended(data.color)) return null;
  const clarity = (data.clarity || '').toUpperCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  if (['VVS1', 'VVS2', 'VS1'].includes(clarity)) {
    return { type: 'info', label: 'Eye-Clean Confirmed', detail: clarity + ' = no visible inclusions at normal viewing distance', scoreImpact: 5, severity: 'INFO' };
  }

  if (clarity === 'VS2') {
    const hasLarge = /large|prominent/i.test(combinedText);
    if (hasLarge) {
      return { type: 'warning', label: 'VS2 May Not Be Eye-Clean', detail: 'VS2 + Large inclusion = may be eye-visible', scoreImpact: -5, severity: 'MEDIUM' };
    }
    return { type: 'info', label: 'VS2 - Likely Eye-Clean', detail: 'VS2 usually not eye-visible unless large inclusion noted', scoreImpact: 2, severity: 'INFO' };
  }

  if (clarity === 'SI1') {
    return { type: 'warning', label: 'SI1 = Possible Eye-Visible', detail: 'SI1 may have eye-visible inclusions under close inspection', scoreImpact: -8, severity: 'MEDIUM' };
  }

  if (clarity === 'SI2') {
    const hasCloud = /cloud/i.test(combinedText);
    if (hasCloud) {
      return { type: 'critical', label: 'SI2 + Cloud = Likely Eye-Visible', detail: 'SI2 + Cloud combo = high probability of eye-visible haze', scoreImpact: -15, severity: 'HIGH' };
    }
    return { type: 'warning', label: 'SI2 = Eye-Visible Likely', detail: 'SI2 grade usually has eye-visible inclusions', scoreImpact: -12, severity: 'HIGH' };
  }

  return null;
}

function checkCreamyStoneRisk(data) {
  if (isFancyColorExtended(data.color)) return null;
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;
  const fluorescence = (data.fluorescence || '').toLowerCase();

  const hasCreamy = /creamy|milky|oily|cloudy/i.test(combinedText);
  const hasStrongFluor = /strong|very strong/i.test(fluorescence);
  const clarity = (data.clarity || '').toUpperCase();

  if (!hasCreamy && !(hasStrongFluor && clarity === 'SI2')) return null;

  if (hasCreamy) {
    return { type: 'critical', label: 'Creamy/Milky Stone', detail: 'Creamy/Milky = clouds severely impact transparency, value loss 30-50%', scoreImpact: -30, severity: 'CRITICAL' };
  }
  if (hasStrongFluor && clarity === 'SI2') {
    return { type: 'warning', label: 'Creamy Risk: Strong Fluor + SI2', detail: 'Strong fluorescence + SI2 = high milky risk, inspect in person', scoreImpact: -15, severity: 'HIGH' };
  }
  return null;
}

function checkStructuralHaze(data) {
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = keyToSymbols + ' ' + comments;

  const hasHaze = /haze|hazy/i.test(combinedText);
  if (!hasHaze) return null;

  const clarity = (data.clarity || '').toUpperCase();
  if (['SI2', 'I1', 'I2', 'I3'].includes(clarity)) {
    return { type: 'warning', label: 'Haze + Low Clarity', detail: clarity + ' + Haze = structural haze, severe transparency loss', scoreImpact: -18, severity: 'HIGH' };
  }
  return { type: 'info', label: 'Haze Detected', detail: 'Haze noted = minor transparency impact, more visible in high colors', scoreImpact: -6, severity: 'LOW' };
}

function checkSuperIdeal(data) {
  const shape = (data.shape || '').toLowerCase();
  if (!/round/i.test(shape)) return null;

  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);
  const crownAngle = parseFloat(data.crownAngle);
  const pavilionAngle = parseFloat(data.pavilionAngle);

  if (isNaN(depthPct) || isNaN(tablePct)) return null;

  let criteria = 0;
  if (depthPct >= 61.0 && depthPct <= 62.0) criteria++;
  if (tablePct >= 55 && tablePct <= 57) criteria++;
  if (!isNaN(crownAngle) && crownAngle >= 34.0 && crownAngle <= 35.0) criteria++;
  if (!isNaN(pavilionAngle) && pavilionAngle >= 40.6 && pavilionAngle <= 41.0) criteria++;

  if (criteria >= 4) {
    return { type: 'info', label: 'SUPER IDEAL CUT', detail: 'Crown 34-35 + Pavilion 40.6-41.0 + Table 55-57% + Depth 61-62% = perfect optics', scoreImpact: 15, severity: 'SUPER_IDEAL' };
  }
  if (criteria >= 3) {
    return { type: 'info', label: 'Near Super Ideal', detail: criteria + '/4 criteria met = near super ideal cut', scoreImpact: 8, severity: 'INFO' };
  }
  return null;
}

function checkCrownPavilionPairing(data) {
  const shape = (data.shape || '').toLowerCase();
  if (!/round/i.test(shape) || /briolet|rose|portrait|portuguese|candlelight/i.test(shape)) return null;
  const crownAngle = parseFloat(data.crownAngle);
  const pavilionAngle = parseFloat(data.pavilionAngle);
  if (isNaN(crownAngle) || isNaN(pavilionAngle)) return null;

  const AGS_PAIRINGS = [
    { caMin: 34.0, caMax: 34.3, paMin: 40.8, paMax: 41.0, desc: 'Optimal fire-brilliance balance' },
    { caMin: 34.5, caMax: 34.8, paMin: 40.6, paMax: 40.8, desc: 'High brilliance, slightly less fire' },
    { caMin: 35.0, caMax: 35.3, paMin: 40.4, paMax: 40.6, desc: 'Maximum brilliance, reduced fire' }
  ];

  let bestScore = 0, bestDesc = '';
  for (const p of AGS_PAIRINGS) {
    const caMatch = crownAngle >= p.caMin && crownAngle <= p.caMax;
    const paMatch = pavilionAngle >= p.paMin && pavilionAngle <= p.paMax;
    if (caMatch && paMatch) {
      bestScore = 8; bestDesc = p.desc; break;
    }
    const caNear = Math.abs(crownAngle - (p.caMin + p.caMax) / 2) <= 0.3;
    const paNear = Math.abs(pavilionAngle - (p.paMin + p.paMax) / 2) <= 0.3;
    if (caNear && paNear && bestScore < 4) {
      bestScore = 4; bestDesc = 'Near ' + p.desc;
    }
  }

  if (bestScore === 0) {
    const lightLeakage = (crownAngle < 33.5 && pavilionAngle < 40.4) || (crownAngle > 36 && pavilionAngle > 41.0);
    const nailHeadRisk = (crownAngle >= 33.5 && crownAngle <= 35.5 && pavilionAngle > 41.0);
    const fishEyeRisk = (crownAngle > 35.5 && pavilionAngle <= 40.5);
    if (lightLeakage) {
      return { type: 'warning', label: 'Crown-Pavilion Anti-Pairing (Light Leakage)', detail: 'CA ' + crownAngle.toFixed(1) + '\u00B0 / PA ' + pavilionAngle.toFixed(1) + '\u00B0 = known light-leakage anti-pairing per AGS ray-tracing', scoreImpact: -6, severity: 'HIGH' };
    }
    if (nailHeadRisk) {
      return { type: 'warning', label: 'Crown-Pavilion: Deep Pavilion (Nailhead Risk)', detail: 'CA ' + crownAngle.toFixed(1) + '\u00B0 / PA ' + pavilionAngle.toFixed(1) + '\u00B0 = normal crown with overly deep pavilion — nailhead effect risk, center goes dark', scoreImpact: -8, severity: 'HIGH' };
    }
    if (fishEyeRisk) {
      return { type: 'warning', label: 'Crown-Pavilion: Steep Crown+Shallow Pavilion', detail: 'CA ' + crownAngle.toFixed(1) + '\u00B0 / PA ' + pavilionAngle.toFixed(1) + '\u00B0 = steep crown + shallow pavilion — fish-eye effect risk, girdle reflection visible through table', scoreImpact: -8, severity: 'HIGH' };
    }
    return null;
  }

  return { type: 'info', label: 'Crown-Pavilion AGS Pairing: Optimal', detail: 'CA ' + crownAngle.toFixed(1) + '\u00B0 / PA ' + pavilionAngle.toFixed(1) + '\u00B0 = ' + bestDesc + ' (AGS-verified complementary pairing)', scoreImpact: bestScore, severity: bestScore >= 8 ? 'SUPER' : 'INFO' };
}

function checkHeartsAndArrows(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + (data.inscription || '').toLowerCase() + ' ' + ((data.keyToSymbols || []).join(' ').toLowerCase());
  if (!/H\s*&?\s*A|hearts\s*(?:and|&)\s*arrows/i.test(combinedText)) return null;
  const shape = (data.shape || '').toLowerCase();
  if (!/round/i.test(shape)) return null;
  return {
    type: 'info',
    label: 'Hearts & Arrows (Optical Symmetry)',
    detail: 'H&A designation = perfect optical symmetry verified by H&A viewer. All 8 arrows and 8 hearts aligned. Premium 10-20% over standard 3EX.',
    scoreImpact: 12,
    severity: 'SUPER'
  };
}

function checkDColorBlueFluorMilky(data) {
  const color = (data.color || '').toUpperCase().trim();
  const clarity = (data.clarity || '').toUpperCase().trim();
  const fluor = (data.fluorescence || '').toLowerCase();
  if (color !== 'D' || !['IF', 'FL'].includes(clarity)) return null;
  const isVeryStrong = /very strong.*blue|blue.*very strong/i.test(fluor);
  const isStrong = /strong.*blue|blue.*strong/i.test(fluor);
  if (!isVeryStrong && !isStrong) return null;
  return {
    type: 'warning',
    label: 'WARNING: D-IF/FL + Strong Blue Fluor (Milky Trap)',
    detail: 'D-' + clarity + ' + ' + (isVeryStrong ? 'Very Strong' : 'Strong') + ' Blue fluorescence = high risk of milky/hazy appearance. Top color+clarity with strong blue fluor is a known market trap. Careful in-person inspection strongly advised.',
    scoreImpact: -12,
    severity: 'HIGH'
  };
}

function checkTypeIaClassification(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const isTypeIa = /type\s*ia\b|type\s*ia\s*b/i.test(comments);
  if (!isTypeIa) return null;
  const color = (data.color || '').toUpperCase();
  const hasBCenter = /b[\s-]center|b[\s-]centers|high nitrogen/i.test(comments);
  if (hasBCenter && ['D','E','F'].includes(color)) {
    return { type: 'warning', label: 'Type IaB + D-F Color (Hidden Brown Undertone)', detail: 'Type IaB with high nitrogen B-centers may exhibit warm brown undertone invisible on cert but visible in certain lighting. 98% of natural diamonds are Type Ia. Recommend UV-Vis verification for D-F color accuracy.', scoreImpact: -8, severity: 'HIGH' };
  }
  if (/type\s*ia\s*b/i.test(comments) && !hasBCenter) {
    return { type: 'info', label: 'Type IaB Classification Noted', detail: 'Type IaB diamond — nitrogen in B-center form. Verify no brown undertone impact on color grade.', scoreImpact: 0, severity: 'LOW' };
  }
  return null;
}

function checkTypeIIbUltraWhite(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const isTypeIIb = /type\s*ii\s*b|type\s*iib/i.test(comments);
  if (!isTypeIIb) return null;
  const color = (data.color || '').toUpperCase().trim();
  if (!['D', 'E'].includes(color)) return null;
  return {
    type: 'info',
    label: 'Type IIb Ultra-White Effect (Boron Bonus)',
    detail: color + '-color Type IIb = boron impurity absorbs trace yellow, making stone appear even whiter than same-color Type Ia/IIa. This "ultra-white" effect commands 5-15% premium in Asian markets.',
    scoreImpact: 8,
    severity: 'SUPER'
  };
}

function checkTypeIIaRisk(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + (data.reportNumber || '').toLowerCase();

  const isTypeIIa = /type\s*ii\s*a|type\s*iia/i.test(combinedText);
  if (!isTypeIIa) return null;

  const color = (data.color || '').toUpperCase();
  const isHighColor = ['D', 'E', 'F'].includes(color);

  if (isHighColor) {
    return { type: 'info', label: 'Type IIa + High Color Premium', detail: 'Type IIa D-F = highest chemical purity, no nitrogen. Auction premium 10-25%', scoreImpact: 10, severity: 'SUPER' };
  }

  return { type: 'info', label: 'Type IIa Diamond', detail: 'Type IIa = highest purity type, but may have slight brown undertone (needs UV-Vis confirmation)', scoreImpact: 3, severity: 'INFO' };
}

function checkFishEyeEnhanced(data) {
  // Fancy colors use Color-First depth evaluation — skip white diamond fish-eye check
  if (isFancyColorExtended(data.color)) return null;
  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);
  const pavilionAngle = parseFloat(data.pavilionAngle);

  if (isNaN(depthPct)) return null;

  let fishEyeRisk = false;
  let detail = '';

  if (!isNaN(pavilionAngle) && pavilionAngle < 40) {
    fishEyeRisk = true;
    detail = 'Pavilion Angle ' + pavilionAngle + ' < 40 = fish-eye effect high risk';
  }
  if (!isNaN(tablePct) && !isNaN(depthPct)) {
    const balance = depthPct - tablePct;
    var isDeepFancy = !/round/i.test(data.shape || '') && depthPct > 62;
    // Deep fancy shapes don't get fish-eye (fish-eye is a shallow-stone problem)
    // For fancy shapes with depth > 62%, skip depth-table gap check
    if (!isDeepFancy && balance < 4) {
      fishEyeRisk = true;
      detail += (detail ? ' | ' : '') + 'Depth-Table ' + depthPct + '%-' + tablePct + '% = ' + balance.toFixed(0) + '% gap (fish-eye risk)';
    }
  }

  if (depthPct && !isNaN(depthPct) && depthPct < CONFIG.THRESHOLDS.FISHEYE_DEPTH_MAX) {
    fishEyeRisk = true;
    detail += (detail ? ' | ' : '') + 'Shallow depth ' + depthPct + '% = fish-eye effect';
  }

  if (!fishEyeRisk) return null;

  return { type: 'warning', label: 'Fish-Eye Effect Risk', detail: detail, scoreImpact: -12, severity: 'HIGH' };
}

function checkCuletRisk(data) {
  const culet = (data.culet || '').toLowerCase();
  if (!culet) return null;

  const isAntique = /old mine|old european|old miner|antique|rose cut/i.test(data.shape || '');

  if (/very large|extremely large/i.test(culet)) {
    if (isAntique) return { type: 'info', label: 'Large Culet (Antique — Expected)', detail: 'Open/large culet is characteristic of antique cuts. This is desirable for collectors, not a defect.', scoreImpact: 3, severity: 'INFO' };
    return { type: 'warning', label: 'Very Large Culet', detail: 'Culet too large = visible hole at bottom, affects aesthetics', scoreImpact: -10, severity: 'MEDIUM' };
  }
  if (/large/i.test(culet)) {
    if (isAntique) return { type: 'info', label: 'Large Culet (Antique Character)', detail: 'Large culet = expected antique feature, adds vintage character', scoreImpact: 2, severity: 'INFO' };
    return { type: 'info', label: 'Large Culet', detail: 'Large culet = may be eye-visible, antique cut characteristic', scoreImpact: -5, severity: 'LOW' };
  }
  if (/medium/i.test(culet)) {
    return { type: 'info', label: 'Medium Culet', detail: 'Medium culet = slightly visible, larger than modern standard', scoreImpact: -2, severity: 'LOW' };
  }
  if (/none|pointed/i.test(culet)) {
    return { type: 'info', label: 'None/Pointed Culet', detail: 'No culet = modern ideal standard', scoreImpact: 2, severity: 'INFO' };
  }
  return null;
}

function evaluateCuletSize(data) {
  const culet = (data.culet || '').toLowerCase();
  if (!culet) return { size: 'unknown', label: 'N/A', scoreImpact: 0 };

  if (/none|pointed/i.test(culet)) return { size: 'none', label: 'None', scoreImpact: 2 };
  if (/very small/i.test(culet)) return { size: 'very_small', label: 'Very Small', scoreImpact: 1 };
  if (/small/i.test(culet)) return { size: 'small', label: 'Small', scoreImpact: 0 };
  if (/medium/i.test(culet)) return { size: 'medium', label: 'Medium', scoreImpact: -2 };
  if (/slightly large/i.test(culet)) return { size: 'slightly_large', label: 'Slightly Large', scoreImpact: -4 };
  if (/large/i.test(culet)) return { size: 'large', label: 'Large', scoreImpact: -8 };
  if (/very large|extremely large/i.test(culet)) return { size: 'very_large', label: 'Very Large', scoreImpact: -15 };

  return { size: 'unknown', label: 'N/A', scoreImpact: 0 };
}

function checkCuletClarityInteraction(data) {
  const culet = (data.culet || '').toLowerCase();
  if (!/large|very large|extremely large/i.test(culet)) return null;
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = keyToSymbols + ' ' + comments;
  if (!/crystal/i.test(combinedText)) return null;
  const hasNearBottom = /pavilion|culet|bottom|lower/i.test(combinedText);
  const carat = parseFloat(data.carat) || 0;
  let scoreImpact = hasNearBottom ? -15 : -8;
  if (carat >= 2) scoreImpact -= 4;
  const isFancy = isFancyColorExtended(data.color);
  if (isFancy) scoreImpact = Math.round(scoreImpact * 0.5);
  return { type: 'warning', label: 'Culet-Clarity Reflector Risk', detail: 'Culet ' + culet + ' + crystal inclusion' + (hasNearBottom ? ' near pavilion/culet' : '') + ' = internal reflection magnifies visual impact. Optical clarity worse than grade suggests.', scoreImpact: scoreImpact, severity: scoreImpact <= -12 ? 'HIGH' : 'MEDIUM' };
}

function checkNaturalsExtraFacet(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  const hasNatural = /natural/i.test(combinedText);
  const hasExtraFacet = /extra\s*facet/i.test(combinedText);

  if (!hasNatural && !hasExtraFacet) return null;

  const findings = [];
  let scoreImpact = 0;

  if (hasNatural) {
    const girdleMatch = /natural.*girdle|girdle.*natural/i.test(combinedText);
    if (girdleMatch) {
      findings.push('Natural on Girdle = original crystal surface, no optical impact');
    } else {
      findings.push('Natural = original crystal surface retained');
      scoreImpact -= 3;
    }
  }

  if (hasExtraFacet) {
    findings.push('Extra Facet = additional facet, may be correction cut or cutting error');
    scoreImpact -= 4;
  }

  if (findings.length === 0) return null;
  return { type: scoreImpact < 0 ? 'warning' : 'info', label: 'Naturals/Extra Facets', detail: findings.join(' | '), scoreImpact: scoreImpact, severity: scoreImpact < -3 ? 'MEDIUM' : 'LOW' };
}

function checkExtendedInclusionTypes(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;
  const color = (data.color || '').toUpperCase();
  let scoreImpact = 0;
  const findings = [];

  if (/indented\s*natural/i.test(combinedText)) {
    scoreImpact -= 12;
    findings.push('Indented Natural — surface penetration into crown/pavilion, face-up visible, setting risk');
  }
  if (/etch\s*(?:channel|groove)/i.test(combinedText)) {
    scoreImpact -= 15;
    findings.push('Etch Channel — worm-like surface tubes, harbors dirt, weakens structure');
  }
  if (/twinning\s*plane/i.test(combinedText)) {
    scoreImpact -= 15;
    findings.push('Twinning Plane(s) — structural cleavage-plane vulnerability, critical setting risk');
  }
  if (/\bbruise\b/i.test(combinedText)) {
    scoreImpact -= 8;
    findings.push('Bruise — impact damage with root-like feather, common on pre-owned stones');
  }
  if (/twinning\s*wisp/i.test(combinedText) && !/twinning\s*plane/i.test(combinedText)) {
    const colorIndex = DIAMOND_TYPE.WHITE_COLORS.indexOf(color);
    if (colorIndex >= 0 && colorIndex <= 2) {
      scoreImpact -= 8;
      findings.push('Twinning Wisp on D-F color — veiled/hazy appearance, 10-15% market discount');
    } else if (colorIndex >= 3 && colorIndex <= 5) {
      scoreImpact -= 3;
      findings.push('Twinning Wisp on G-I color — moderate impact');
    }
  }
  if (/polish\s*line|burn\s*mark/i.test(combinedText)) {
    scoreImpact -= 3;
    findings.push('Polish Lines / Burn Marks — polish defects reducing luster grade');
  }
  if (/abrasion|scratch|nick|pit/i.test(combinedText)) {
    const blemishCount = (combinedText.match(/abrasion|scratch|nick|pit/gi) || []).length;
    const blemishPenalty = Math.min(10, blemishCount * 3);
    if (blemishPenalty > 0) {
      scoreImpact -= blemishPenalty;
      findings.push('Wear blemishes (abrasion/scratch/nick/pit) ×' + blemishCount + ' — -' + blemishPenalty);
    }
  }

  if (findings.length === 0) return null;
  return { type: scoreImpact <= -15 ? 'critical' : 'warning', label: 'Extended Inclusion Risk', detail: findings.join(' | '), scoreImpact: scoreImpact, severity: scoreImpact <= -15 ? 'CRITICAL' : 'MEDIUM' };
}

function evaluateInclusionSize(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  if (/large|prominent/i.test(combinedText)) return { grade: 'large', label: 'Large Inclusions', scoreImpact: -10 };
  if (/medium/i.test(combinedText)) return { grade: 'medium', label: 'Medium Inclusions', scoreImpact: -5 };
  if (/small/i.test(combinedText)) return { grade: 'small', label: 'Small Inclusions', scoreImpact: 0 };
  if (/very small|minute/i.test(combinedText)) return { grade: 'very_small', label: 'Very Small Inclusions', scoreImpact: 2 };

  return { grade: 'unknown', label: 'N/A', scoreImpact: 0 };
}

function checkBearding(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  if (!/beard/i.test(combinedText)) return null;

  if (/heavy|severe/i.test(combinedText)) {
    return { type: 'warning', label: 'Heavy Bearding', detail: 'Heavy bearding = severe girdle fringing, transparency and structure compromised', scoreImpact: -12, severity: 'HIGH' };
  }
  return { type: 'info', label: 'Bearding Present', detail: 'Bearding = girdle fringing, moderate levels usually cosmetic', scoreImpact: -4, severity: 'LOW' };
}

function checkFluorescenceColor(data) {
  if (isFancyColorExtended(data.color)) return null;
  const fluor = (data.fluorescence || '').toLowerCase();
  const color = (data.color || '').toUpperCase();
  if (!fluor || fluor === 'none') return null;

  let scoreImpact = 0;
  let label = '';
  let detail = '';

  if (/blue/i.test(fluor)) {
    const isLowColor = ['J', 'K', 'L', 'M'].includes(color);
    const isMidColor = ['G', 'H', 'I'].includes(color);
    const isHighColor = ['D', 'E', 'F'].includes(color);
    const isFaint = /faint/i.test(fluor) && !/medium|strong|very strong/i.test(fluor);

    if (isFaint) {
      return { type: 'info', label: 'Faint Blue Fluor (No Impact)', detail: color + ' + Faint Blue = no optical impact, stone remains fully transparent', scoreImpact: 0, severity: 'INFO' };
    }

    if (isLowColor) { scoreImpact = 4; label = 'Blue Fluor + Low Color (bonus)'; detail = color + ' + Blue Fluor = fluorescence offsets yellow tone'; }
    else if (isMidColor) { scoreImpact = 1; label = 'Blue Fluor + Mid Color'; detail = color + ' + Blue Fluor = slight bonus'; }
    else if (isHighColor) { scoreImpact = -5; label = 'Blue Fluor + High Color'; detail = color + ' + Blue Fluor = may appear oily'; }
    else { scoreImpact = 2; label = 'Blue Fluor'; detail = 'Blue fluorescence detected'; }
    return { type: scoreImpact < 0 ? 'warning' : 'info', label: label, detail: detail, scoreImpact: scoreImpact, severity: scoreImpact < 0 ? 'MEDIUM' : 'INFO' };
  }

  if (/yellow/i.test(fluor)) {
    // Yellow fluor now handled by checkYellowFluorImpact (more nuanced)
    return null;
  }

  if (/white/i.test(fluor)) {
    scoreImpact = -3;
    return { type: 'info', label: 'White Fluorescence', detail: 'White fluorescence = minor transparency impact', scoreImpact: scoreImpact, severity: 'LOW' };
  }

  if (/green/i.test(fluor) && !/blue|yellow|white/i.test(fluor)) {
    if (['D','E','F'].includes(color)) return { type: 'critical', label: 'Green Fluor + High Color (Fatal)', detail: color + ' + Green fluorescence = greenish tint destroys colorless value', scoreImpact: -30, severity: 'CRITICAL' };
    if (['G','H','I'].includes(color)) return { type: 'warning', label: 'Green Fluor + Mid Color', detail: color + ' + Green fluorescence = slight greenish tint', scoreImpact: -12, severity: 'HIGH' };
    return { type: 'info', label: 'Green Fluorescence', detail: 'Green fluorescence detected — verify visual appearance', scoreImpact: -5, severity: 'LOW' };
  }

  return null;
}

function checkCertificateAgeRisk(data) {
  var certYear = null;
  var dateStr = data.reportDate || data.gradingDate || data.issueDate || '';
  if (dateStr) {
    var m4 = String(dateStr).match(/((?:19|20)\d{2})/);
    if (m4) certYear = parseInt(m4[1]);
    if (!certYear) { var m = String(dateStr).match(/(\d{4})/); if (m) certYear = parseInt(m[1]); }
  }
  if (!certYear) {
    var reportNumber = String(data.reportNumber || '');
    if (!reportNumber) return null;
    var cleaned = reportNumber.replace(/\D/g, '');
    if (cleaned.length >= 10) certYear = 2000 + parseInt(cleaned.substring(0, 2));
  }
  if (!certYear || certYear > new Date().getFullYear() + 1 || certYear < 1980) return null;

  var age = new Date().getFullYear() - certYear;
  if (age > 20) {
    return { type: 'warning', label: 'Certificate > 20 Years Old', detail: 'Cert year approx ' + certYear + ', over 20 years. Stone may have changed hands many times or worn', scoreImpact: -5, severity: 'MEDIUM' };
  }
  if (age > 10) {
    return { type: 'info', label: 'Certificate > 10 Years Old', detail: 'Cert year ' + certYear + ', over 10 years. Suggest re-grading', scoreImpact: -2, severity: 'LOW' };
  }
  return { type: 'info', label: 'Recent Certificate', detail: 'Recent cert year, data reliability higher', scoreImpact: 2, severity: 'INFO' };
}

function checkCaratThresholdRisk(data) {
  const carat = parseFloat(data.carat) || 0;
  if (carat <= 0) return null;

  const thresholds = [0.50, 0.70, 0.90, 1.00, 1.50, 2.00, 3.00, 5.00, 10.00];
  const findings = [];

  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i];
    const diff = carat - t;
    if (diff < 0 && Math.abs(diff) < 0.05) {
      findings.push('Carat ' + carat.toFixed(2) + ' < ' + t.toFixed(2) + ' threshold, ' + Math.abs(diff).toFixed(2) + 'ct short of step');
    }
  }

  if (findings.length === 0) return null;
  return { type: 'info', label: 'Carat Threshold Gap', detail: findings.join(' | ') + ' | Small gap to next price step, premium opportunity lost', scoreImpact: -3, severity: 'LOW' };
}

function checkUnderGradedHunter(data) {
  const clarity = (data.clarity || '').toUpperCase();
  const color = (data.color || '').toUpperCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  const clues = [];
  if (clarity === 'SI2' && !/cloud|feather|crystal|needle|pinpoint/i.test(combinedText)) {
    clues.push('SI2 but no specific inclusion noted = possibly under-graded clarity');
  }
  if (color === 'I' && /brown|tint/i.test(combinedText)) {
    clues.push('I color with Brown Tint = actual color may be J-K');
  }
  if (clarity === 'VS2' && /eye\s*clean/i.test(combinedText)) {
    clues.push('VS2 noted Eye-Clean = possibly under-graded to VS1');
  }

  if (clues.length === 0) return null;
  return { type: 'info', label: 'Under-Grade Hunter Clues', detail: clues.join(' | ') + ' | Further assessment may reveal upgrade potential', scoreImpact: 0, severity: 'INFO' };
}

function checkHazeMatrix(data, flags) {
  const hasStrongFluor = /Strong Blue|Very Strong Blue/i.test(data.fluorescence || '');
  const hasMediumFluor = /Medium Blue/i.test(data.fluorescence || '');
  const colorUpper = (data.color || '').toUpperCase();
  const hasClouds = Array.isArray(data.keyToSymbols)
    ? data.keyToSymbols.some(function(s) { return /cloud/i.test(s || ''); })
    : /cloud/i.test((data.keyToSymbols || '').toString());
  const hasGrain = Array.isArray(data.keyToSymbols)
    ? data.keyToSymbols.some(function(s) { return /grain/i.test(s || ''); })
    : /grain/i.test((data.keyToSymbols || '').toString());
  const comments = (data.comments || []).join(' ').toLowerCase();
  const hasClarityOnHold = /clarity grade is based on clouds/i.test(comments);
  const isSI = clarityIsSI(data.clarity);

  const isFancy = isFancyColorExtended(data.color);

  if (hasStrongFluor && hasClarityOnHold) {
    const impact = isFancy ? -25 : -50;
    return { type: 'critical', label: 'CRITICAL: MILKY/HAZY TRAP', detail: 'Strong fluorescence + clarity based on clouds = 100% milky stone, severe transparency loss' + (isFancy ? ' | Color-first: fancy color partially offsets milky penalty' : ''), scoreImpact: impact, severity: 'CRITICAL', isShortCircuit: !isFancy };
  }

  if (hasStrongFluor && isSI && hasClouds) {
    return { type: 'warning', label: 'HIGH RISK: Oily/Blurry Appearance', detail: 'Strong fluorescence in SI clarity with clouds = oily appearance' + (isFancy ? ' | Color-first: reduced penalty for fancy color' : ''), scoreImpact: isFancy ? -12 : -25, severity: 'HIGH', isShortCircuit: !isFancy };
  }

  if (hasStrongFluor && ['VVS1','VVS2','IF','FL'].includes(data.clarity) && !hasClouds && !hasGrain) {
    return { type: 'info', label: 'SAFE FLUORESCENCE', detail: 'Strong fluorescence but top clarity + no clouds/grain = stone remains clear', scoreImpact: 0, severity: 'INFO' };
  }

  const lowColors = ['M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
  if (lowColors.includes(colorUpper) && hasStrongFluor) {
    return { type: 'warning', label: 'WARNING: Creamy Tint Risk', detail: 'M or lower color + Strong/Very Strong Blue = dirty creamy appearance, compensation canceled and penalty applied', scoreImpact: -15, severity: 'HIGH', isShortCircuit: false };
  }

  if (hasMediumFluor && ['K','L','M'].includes(colorUpper)) {
    return { type: 'info', label: 'Reduced Compensation', detail: 'K/L/M color + Medium Blue compensation halved due to low color', scoreImpact: 1, severity: 'LOW', isShortCircuit: false };
  }

  return null;
}

function evaluateGrainingRisk(data, flags, isInvestmentGrade) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;
  const hasGraining = /grain/i.test(combinedText);
  if (!hasGraining) return 0;
  const isInternal = /internal\s*grain/i.test(combinedText);
  const isSurface = /surface\s*grain/i.test(combinedText);
  const clarity = (data.clarity || '').toUpperCase();
  let scoreImpact = 0;
  if (isInternal) { scoreImpact -= 6; }
  else if (isSurface) { scoreImpact -= 3; }
  else { scoreImpact -= 4; }
  if (isInvestmentGrade && hasGraining) { scoreImpact -= 5; }
  if (['FL', 'IF'].includes(clarity)) { scoreImpact -= 8; }
  if (scoreImpact < 0 && flags) {
    flags.push({ type: scoreImpact <= -10 ? 'warning' : 'info', label: scoreImpact <= -10 ? 'Severe Graining Risk' : 'Graining Detected', detail: (isInternal ? 'Internal graining' : (isSurface ? 'Surface graining' : 'Graining')) + ' = affects optical performance', scoreImpact, severity: scoreImpact <= -10 ? 'HIGH' : 'LOW' });
  }
  return scoreImpact;
}

function checkWindowingRisk(data, fancySpreadResult, depthPct) {
  const shape = (data.shape || '').toLowerCase();
  const isFancy = !/round/i.test(shape);
  if (!isFancy) return null;
  // Fancy colored diamonds use Color-First depth evaluation — skip standard windowing check
  if (isFancyColorExtended(data.color)) return null;

  const d = parseFloat(depthPct);
  if (isNaN(d)) return null;

  if (d < 53) {
    return { type: 'critical', label: 'CRITICAL: Severe Windowing (Fancy)', detail: 'Depth ' + d + '% < 53% = center completely see-through, light passes through, all scintillation lost', scoreImpact: -25, severity: 'CRITICAL' };
  }
  if (d < 58) {
    return { type: 'warning', label: 'Moderate Windowing', detail: 'Depth ' + d + '% < 58% = center window effect visible from side view', scoreImpact: -12, severity: 'HIGH' };
  }
  if (d > 75) {
    return { type: 'warning', label: 'Excessive Depth (Fancy)', detail: 'Depth ' + d + '% > 75% = too deep, scintillation pattern too dark', scoreImpact: -10, severity: 'MEDIUM' };
  }
  return null;
}

function checkInvestmentGrade(data) {
  const color = (data.color || '').toUpperCase();
  const clarity = (data.clarity || '').toUpperCase();
  const carat = parseFloat(data.carat) || 0;
  const shape = (data.shape || '').toLowerCase();
  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);

  if (carat < 1) return null;

  const isHighColor = ['D', 'E', 'F'].includes(color);
  const isHighClarity = ['FL', 'IF', 'VVS1', 'VVS2'].includes(clarity);
  const isRound = /round/i.test(shape);

  if (isHighColor && isHighClarity && isRound && carat >= 1.5) {
    if (!isNaN(depthPct) && !isNaN(tablePct)) {
      if (depthPct >= 61 && depthPct <= 62 && tablePct >= 55 && tablePct <= 58) {
        return { type: 'info', label: 'INVESTMENT GRADE A', detail: color + '-' + clarity + ' Round ' + carat + 'ct perfect optics = top investment asset', scoreImpact: 18, severity: 'SUPER', grade: 'INVESTMENT GRADE A' };
      }
    }
    return { type: 'info', label: 'INVESTMENT GRADE B', detail: color + '-' + clarity + ' Round ' + carat + 'ct = quality investment asset', scoreImpact: 12, severity: 'SUPER', grade: 'INVESTMENT GRADE B' };
  }

  if (isHighColor && (clarity === 'VS1' || clarity === 'VS2') && isRound && carat >= 2) {
    return { type: 'info', label: 'Near Investment Grade', detail: color + '-' + clarity + ' Round ' + carat + 'ct = near investment grade', scoreImpact: 5, severity: 'INFO' };
  }

  return null;
}

function evaluateRoundCutGradePyramid(data) {
  const shape = (data.shape || '').toLowerCase();
  if (!/round/i.test(shape)) return null;

  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);
  const crownAngle = parseFloat(data.crownAngle);
  const pavilionAngle = parseFloat(data.pavilionAngle);

  if (isNaN(depthPct) || isNaN(tablePct)) return null;

  let score = 0;
  const findings = [];

  if (!isNaN(pavilionAngle)) {
    if (pavilionAngle >= 40.6 && pavilionAngle <= 41.0) { score += 5; findings.push('Pavilion 40.6-41.0 = TOP'); }
    else if (pavilionAngle >= 40.2 && pavilionAngle <= 41.4) { score += 2; findings.push('Pavilion angle OK'); }
    else { score -= 5; findings.push('Pavilion angle off'); }
  }

  if (!isNaN(crownAngle)) {
    if (crownAngle >= 34.0 && crownAngle <= 35.0) { score += 5; findings.push('Crown 34-35 = TOP'); }
    else if (crownAngle >= 32.5 && crownAngle <= 36.0) { score += 2; findings.push('Crown angle OK'); }
    else { score -= 5; findings.push('Crown angle off'); }
  }

  if (tablePct >= 55 && tablePct <= 58) { score += 4; findings.push('Table 55-58% = TOP'); }
  else if (tablePct >= 54 && tablePct <= 62) { score += 1; findings.push('Table OK'); }
  else { score -= 4; findings.push('Table off'); }

  if (depthPct >= 61.0 && depthPct <= 62.5) { score += 4; findings.push('Depth 61-62.5% = TOP'); }
  else if (depthPct >= 59 && depthPct <= 63.5) { score += 1; findings.push('Depth OK'); }
  else { score -= 4; findings.push('Depth off'); }

  let grade;
  if (score >= 16) grade = 'EX Top';
  else if (score >= 12) grade = 'VG Top';
  else if (score >= 6) grade = 'Good';
  else if (score >= 0) grade = 'Fair';
  else grade = 'Poor';

  return { type: 'info', label: 'Round Cut Grade: ' + grade, detail: findings.join(' | '), scoreImpact: score >= 12 ? 5 : (score < 6 ? -5 : 0), severity: score >= 12 ? 'INFO' : (score < 6 ? 'MEDIUM' : 'LOW'), grade: grade, rawScore: score };
}

function evaluateFacetLustre(data) {
  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();

  if (!polish && !symmetry) return null;

  let scoreImpact = 0;
  const findings = [];

  if (/excellent/i.test(polish)) { scoreImpact += 5; findings.push('Polish: Excellent'); }
  else if (/very good/i.test(polish)) { scoreImpact += 2; findings.push('Polish: VG'); }
  else if (/good/i.test(polish)) { findings.push('Polish: Good (OK)'); }
  else if (/fair|poor/i.test(polish)) { scoreImpact -= 8; findings.push('Polish: Fair/Poor = luster insufficient'); }

  if (/excellent/i.test(symmetry)) { scoreImpact += 5; findings.push('Sym: Excellent'); }
  else if (/very good/i.test(symmetry)) { scoreImpact += 2; findings.push('Sym: VG'); }
  else if (/good/i.test(symmetry)) { findings.push('Sym: Good (OK)'); }
  else if (/fair|poor/i.test(symmetry)) { scoreImpact -= 8; findings.push('Sym: Fair/Poor = optical path deviation'); }

  if (findings.length === 0) return null;

  return { type: scoreImpact < 0 ? 'warning' : 'info', label: scoreImpact >= 5 ? 'Excellent Facet Lustre' : (scoreImpact >= 0 ? 'Good Facet Lustre' : 'Subpar Facet Lustre'), detail: findings.join(' | '), scoreImpact: scoreImpact, severity: scoreImpact < -5 ? 'HIGH' : (scoreImpact < 0 ? 'MEDIUM' : 'INFO') };
}

function checkTableRisk(data) {
  const tablePct = parseFloat(data.tablePct);
  if (isNaN(tablePct)) return null;

  if (tablePct > 70) {
    return { type: 'warning', label: 'Table > 70%', detail: 'Table ' + tablePct + '% > 70% = table too large, fire severely insufficient', scoreImpact: -15, severity: 'HIGH' };
  }
  if (tablePct > 65) {
    return { type: 'info', label: 'Table > 65%', detail: 'Table ' + tablePct + '% > 65% = table large, fire reduced but brightness increased', scoreImpact: -5, severity: 'LOW' };
  }
  if (tablePct < 50) {
    return { type: 'warning', label: 'Table < 50%', detail: 'Table ' + tablePct + '% < 50% = table too small, insufficient light entry', scoreImpact: -12, severity: 'HIGH' };
  }
  if (tablePct < 52) {
    return { type: 'info', label: 'Table < 52%', detail: 'Table ' + tablePct + '% < 52% = table small, light entry restricted', scoreImpact: -3, severity: 'LOW' };
  }
  return null;
}

function checkBowTieRiskEnhanced(data) {
  const shape = (data.shape || '').toLowerCase();
  const isBowTieShape = /oval|pear|marquise|heart/i.test(shape);
  if (!isBowTieShape) return null;

  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);

  if (!isNaN(depthPct) && !isNaN(tablePct)) {
    let bowTieScore = 0;
    const findings = [];

    if (depthPct < 58) { bowTieScore += 10; findings.push('Shallow depth = severe Bow-Tie'); }
    else if (depthPct < 60) { bowTieScore += 5; findings.push('Shallow-ish depth = mild Bow-Tie'); }

    if (tablePct > 68) { bowTieScore += 8; findings.push('Large table = worsens Bow-Tie'); }

    if (bowTieScore >= 10) {
      return { type: 'warning', label: 'Significant Bow-Tie Risk', detail: findings.join(' | ') + ' | Bow-Tie = dark bow-tie zone, affects aesthetics', scoreImpact: -(bowTieScore), severity: 'HIGH' };
    }
    if (bowTieScore >= 5) {
      return { type: 'info', label: 'Mild Bow-Tie Risk', detail: findings.join(' | '), scoreImpact: -(bowTieScore), severity: 'MEDIUM' };
    }
  }

  return null;
}

function checkFluorescenceOffset(data) {
  const color = (data.color || '').toUpperCase();
  const fluor = (data.fluorescence || '').toLowerCase();
  const carat = parseFloat(data.carat) || 0;
  if (carat < 0.7) return null;
  const validColors = ['G','H','I','J','K','L','M'];
  if (!validColors.includes(color)) return null;

  const isVeryStrong = /very strong.*blue|blue.*very strong/i.test(fluor);
  const isStrong = !isVeryStrong && /strong.*blue|blue.*strong/i.test(fluor);
  const isMedium = !isVeryStrong && !isStrong && /medium.*blue|blue.*medium/i.test(fluor);

  const TIER3 = { 'G': 2, 'H': 4, 'K': 4, 'L': 4, 'M': 4, 'I': 6, 'J': 6 };
  const TIER2 = { 'G': 1, 'H': 2, 'K': 2, 'L': 2, 'M': 2, 'I': 3, 'J': 3 };
  const TIER1 = { 'G': 1, 'H': 1, 'K': 2, 'L': 2, 'M': 2, 'I': 3, 'J': 3 };

  let bonus = 0, tierLabel = '', detail = '';
  if (isVeryStrong) { bonus = TIER3[color] || 0; tierLabel = '!!'; detail = 'Very Strong Blue compensation: ' + (bonus > 0 ? '+' + bonus : bonus); }
  else if (isStrong) { bonus = TIER2[color] || 0; tierLabel = '!!'; detail = 'Strong Blue compensation: +' + bonus; }
  else if (isMedium) { bonus = TIER1[color] || 0; tierLabel = '!'; detail = 'Medium Blue compensation: +' + bonus; }

  if (bonus === 0) return null;
  return { type: 'info', label: tierLabel + ' FLUORESCENCE OFFSET: ' + color + ' + ' + fluor.replace(/blue/i, 'Blue'), detail: detail + ' | ' + color + ' color + ' + fluor + ' = blue light offsets yellow', scoreImpact: bonus, severity: 'INFO' };
}

function checkMeasurementsCaratConsistency(data) {
  const carat = parseFloat(data.carat);
  const measurements = data.measurements || '';
  if (isNaN(carat) || !measurements) return null;

  const measStr = String(measurements);
  const mmMatch = measStr.match(/(\d+\.?\d*)\s*[xX\-–]\s*(\d+\.?\d*)\s*[xX\-–]\s*(\d+\.?\d*)/);
  if (!mmMatch) return null;

  const l = parseFloat(mmMatch[1]);
  const w = parseFloat(mmMatch[2]);
  const d = parseFloat(mmMatch[3]);
  if (isNaN(l) || isNaN(w) || isNaN(d)) return null;

  const shape = (data.shape || '').toLowerCase();
  var cleanShape = shape.replace(/\bmodified\b|\bcut-?cornered\b|\bbrilliant\b|\bstep\s*cut\b/gi, '').trim();
  var shapeFactor = 0.0061; // default: round brilliant
  if (/emerald|asscher|baguette/i.test(cleanShape)) shapeFactor = 0.0070;
  else if (/princess/i.test(cleanShape)) shapeFactor = 0.0080;
  else if (/marquise/i.test(cleanShape)) shapeFactor = 0.0057;
  else if (/pear/i.test(cleanShape)) shapeFactor = 0.0059;
  else if (/oval/i.test(cleanShape)) shapeFactor = 0.0060;
  else if (/heart/i.test(cleanShape)) shapeFactor = 0.0059;
  else if (/cushion\s*modified/i.test(shape)) shapeFactor = 0.0060;
  else if (/cushion|radiant/i.test(cleanShape)) shapeFactor = 0.0065;
  else if (/triangular|triangle|trill/i.test(cleanShape)) shapeFactor = 0.0057;
  else if (/kite/i.test(cleanShape)) shapeFactor = 0.0045;
  else if (/briolet/i.test(cleanShape)) shapeFactor = 0.0038;
  else if (!/round/i.test(cleanShape)) shapeFactor = 0.0062; // unknown fancy

  const estimatedCarat = (l * w * d * shapeFactor);
  const diff = Math.abs(carat - estimatedCarat);
  const pctDiff = (diff / carat) * 100;

  var isRound = /round/i.test(shape) && !/briolet|rose|portrait|candlelight|old/i.test(shape);
  var isFancyNonStandard = /briolet|kite|rose|portrait|candlelight/i.test(cleanShape);

  // Check girdle thickness for extra tolerance
  var girdleStr = (data.girdle || '').toLowerCase();
  var hasThickGirdle = /thick|extremely|very\s+thick|heavy/i.test(girdleStr);
  var hasSuperThickGirdle = /extremely|ultra/i.test(girdleStr);

  // Base thresholds
  var warnThreshold = 15;
  var fraudThreshold = 35;
  if (isRound) { warnThreshold = 15; fraudThreshold = 20; }
  else if (isFancyNonStandard) { warnThreshold = 40; fraudThreshold = 55; }
  else { warnThreshold = 28; fraudThreshold = 40; }

  // Girdle dead weight adjustment: thick girdle adds real weight not captured by L*W*D
  if (hasThickGirdle) { warnThreshold += 8; fraudThreshold += 10; }
  if (hasSuperThickGirdle) { warnThreshold += 12; fraudThreshold += 15; }

  // Large stones have proportionally more weight in girdle
  if (carat >= 10) { warnThreshold += 5; fraudThreshold += 5; }
  if (carat >= 25) { warnThreshold += 8; fraudThreshold += 8; }

  if (pctDiff > fraudThreshold) {
    return { type: 'critical', label: 'CRITICAL: Measurement-Carat Mismatch (>' + fraudThreshold.toFixed(0) + '%)', detail: 'Carat ' + carat + 'ct vs estimated ' + estimatedCarat.toFixed(2) + 'ct (diff ' + pctDiff.toFixed(0) + '%) = severe data inconsistency. Possible fraudulent certificate, girdle dead-weight hiding, or measurement error. Shape factor ' + shapeFactor.toFixed(4) + '.', scoreImpact: -25, severity: 'CRITICAL', fraudLock: true };
  }
  if (pctDiff > warnThreshold) {
    return { type: 'warning', label: 'Measurement-Carat Mismatch', detail: 'Carat ' + carat + 'ct vs estimated ' + estimatedCarat.toFixed(2) + 'ct (diff ' + pctDiff.toFixed(0) + '%) = possible data error or non-standard proportions' + (hasThickGirdle ? ' | Thick girdle accounts for some weight difference' : ''), scoreImpact: -12, severity: 'HIGH' };
  }
  if (pctDiff > 8) {
    return { type: 'info', label: 'Measurement-Carat Deviation', detail: 'Diff ' + pctDiff.toFixed(0) + '% = possibly special proportions', scoreImpact: -3, severity: 'LOW' };
  }
  return null;
}

function checkInscriptionMatch(data) {
  const reportNumber = String(data.reportNumber || '').trim();
  const inscription = (data.inscription || '').toLowerCase();

  if (!reportNumber || !inscription) return null;

  const cleanedReport = reportNumber.replace(/^GIA\s*/i, '').replace(/\s/g, '');
  if (cleanedReport.length < 7) return null;

  if (inscription.includes(cleanedReport)) {
    return { type: 'info', label: 'Inscription Matches Report', detail: 'Laser inscription matches certificate number', scoreImpact: 5, severity: 'INFO' };
  }

  return { type: 'warning', label: 'Inscription Mismatch or Missing', detail: 'Laser inscription does not match or not found = verify stone matches certificate', scoreImpact: -10, severity: 'HIGH' };
}

function checkFancyColorDistribution(data) {
  const color = (data.color || '').toUpperCase();
  if (!color.includes('FANCY')) return null;

  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  if (/uneven|unequal/i.test(combinedText)) {
    return { type: 'warning', label: 'Uneven Color Distribution', detail: 'Fancy color uneven distribution = market discount 10-20%', scoreImpact: -15, severity: 'HIGH' };
  }
  if (/even/i.test(combinedText)) {
    return { type: 'info', label: 'Even Color Distribution', detail: 'Even color distribution = bonus factor', scoreImpact: 5, severity: 'INFO' };
  }
  return null;
}

function evaluateInclusionColor(data) {
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = keyToSymbols + ' ' + comments;

  if (/black\s*(crystal|inclusion|spot)/i.test(combinedText)) {
    return { type: 'warning', label: 'Black Inclusion', detail: 'Black inclusion = highest visual impact, easily eye-visible', scoreImpact: -10, severity: 'HIGH' };
  }
  if (/white\s*(crystal|inclusion)/i.test(combinedText)) {
    return { type: 'info', label: 'White Inclusion', detail: 'White inclusion = lower visual impact, harder to spot', scoreImpact: -2, severity: 'LOW' };
  }
  if (/transparent|colorless\s*(crystal|inclusion)/i.test(combinedText)) {
    return { type: 'info', label: 'Transparent Inclusion', detail: 'Transparent inclusion = virtually invisible', scoreImpact: 0, severity: 'INFO' };
  }
  return null;
}

function evaluateFirstInclusionRisk(data) {
  const symbols = DataGuard.safeArray(data.keyToSymbols);
  if (symbols.length === 0) return null;
  const first = symbols[0].toLowerCase();
  const clarity = (data.clarity || '').toUpperCase();
  let riskType = null, detail = '';
  if (/cloud/i.test(first)) {
    // Cloud is only a MILKY risk for SI1 and below; VVS/VS clouds are microscopic
    var isHighClarity = ['FL','IF','VVS1','VVS2','VS1','VS2'].includes(clarity);
    riskType = isHighClarity ? 'VISIBLE' : 'MILKY';
    detail = isHighClarity
      ? 'Primary inclusion is Cloud — ' + clarity + ' grade: microscopic, no milky/haze risk'
      : 'Primary inclusion is Cloud — chief risk is hazy/milky appearance affecting transparency';
  }
  else if (/crystal/i.test(first) && /black|dark/i.test(first)) { riskType = 'EYE_VISIBLE'; detail = 'Primary inclusion is Dark Crystal — highest eye-visibility risk, likely visible to naked eye'; }
  else if (/feather/i.test(first)) { riskType = 'STRUCTURAL'; detail = 'Primary inclusion is Feather — chief risk is structural integrity, especially under thermal/pressure stress'; }
  else if (/cavity|chip|knot/i.test(first)) { riskType = 'SURFACE'; detail = 'Primary inclusion is surface-reaching — setting risk elevated, structural concern'; }
  else if (/crystal/i.test(first)) { riskType = 'VISIBLE'; detail = 'Primary inclusion is Crystal — eye-visibility depends on position, size, and color'; }
  else return null;
  const severityMap = { MILKY: 'HIGH', EYE_VISIBLE: 'HIGH', STRUCTURAL: 'HIGH', SURFACE: 'CRITICAL', VISIBLE: 'MEDIUM' };
  return { type: 'info', label: 'First Inclusion: ' + symbols[0] + ' (' + riskType + ' Risk)', detail, scoreImpact: 0, severity: severityMap[riskType] || 'LOW', riskType };
}

function checkCertificateEra(data) {
  const reportNum = String(data.reportNumber || '');
  // Use actual date from certificate if available (from OCR), else estimate from report number
  var certYear = null;
  var dateStr = data.reportDate || data.gradingDate || data.issueDate || '';
  if (dateStr) {
    var m4 = String(dateStr).match(/((?:19|20)\d{2})/);
    if (m4) certYear = parseInt(m4[1]);
    if (!certYear) { var m = String(dateStr).match(/(\d{4})/); if (m) certYear = parseInt(m[1]); }
  }
  if (!certYear) {
    var digits = reportNum.replace(/\D/g, '');
    if (digits.length >= 10) certYear = 2000 + parseInt(digits.substring(0, 2));
  }
  if (!certYear || certYear > new Date().getFullYear() + 1 || certYear < 1980) return null;

  var flags = [];
  if (certYear < 2006) {
    flags.push('Pre-2006 certificate: no GIA online report check available. Physical re-grading strongly recommended.');
  } else if (certYear < 2014) {
    flags.push('Legacy GIA certificate (' + certYear + '): Cut Grade standards have changed since. Modern re-grade may differ.');
  }
  if (flags.length === 0) return null;
  return { type: 'info', label: 'Certificate Era (' + certYear + ')', detail: flags.join(' | '), scoreImpact: 0, severity: certYear < 2006 ? 'HIGH' : 'MEDIUM' };
}

function evaluateCrownHeightRound(data) {
  const shape = (data.shape || '').toLowerCase();
  if (!/round/i.test(shape) || /briolet|rose|portrait|portuguese|candlelight/i.test(shape)) return null;
  const crownAngle = parseFloat(data.crownAngle);
  const tablePct = parseFloat(data.tablePct);
  if (isNaN(crownAngle) || isNaN(tablePct)) return null;
  const crownRad = crownAngle * Math.PI / 180;
  const crownHeightPct = (1 - tablePct / 100) * Math.tan(crownRad) / 2 * 100;
  if (isNaN(crownHeightPct) || !isFinite(crownHeightPct) || crownHeightPct <= 0) return null;
  let scoreImpact = 0, label = '', severity = 'LOW', detail = '';
  if (crownHeightPct < 12) {
    scoreImpact = -10; label = 'Crown Height Too Low'; severity = 'HIGH';
    detail = 'CH ' + crownHeightPct.toFixed(1) + '% < 12% — fire severely insufficient, light return compromised';
  } else if (crownHeightPct < 14) {
    scoreImpact = -5; label = 'Crown Height Slightly Low'; severity = 'MEDIUM';
    detail = 'CH ' + crownHeightPct.toFixed(1) + '% < 14% — fire reduced';
  } else if (crownHeightPct >= 14 && crownHeightPct <= 16.5) {
    scoreImpact = 3; label = 'Crown Height Ideal'; severity = 'INFO';
    detail = 'CH ' + crownHeightPct.toFixed(1) + '% = optimal fire-brilliance balance (14-16.5%)';
  } else if (crownHeightPct > 17.5) {
    scoreImpact = -5; label = 'Crown Height Too High'; severity = 'MEDIUM';
    detail = 'CH ' + crownHeightPct.toFixed(1) + '% > 17.5% — over-compresses pavilion, light leakage risk';
  }
  if (scoreImpact === 0) return null;
  return { type: scoreImpact < 0 ? 'warning' : 'info', label: label, detail: detail, scoreImpact: scoreImpact, severity: severity };
}

function checkTableCrownInteraction(data) {
  const tablePct = parseFloat(data.tablePct);
  const crownAngle = parseFloat(data.crownAngle);
  if (isNaN(tablePct) || isNaN(crownAngle)) return null;
  if (tablePct < 62 || crownAngle > 33.0) return null;
  const severity = (crownAngle <= 32.0 && tablePct >= 64) ? 2 : 1;
  const scoreImpact = severity === 2 ? -15 : -8;
  return { type: 'warning', label: 'Table-Crown Anti-Pairing (Fire Killer)', detail: 'Table ' + tablePct + '% + Crown ' + crownAngle.toFixed(1) + '\u00B0 = severe fire loss. Large table with shallow crown starves the stone of dispersion.', scoreImpact: scoreImpact, severity: severity === 2 ? 'HIGH' : 'MEDIUM' };
}

function checkHPATreatment(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + (data.reportNumber || '').toLowerCase();
  if (/high\s*pressure\s*(?:anneal|process)|hpa|hpht\s*processed|hpht\s*treated/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: HPA/HPHT Color Treatment', detail: 'High Pressure Annealing/Processing detected — artificially altered color. Not natural color origin.', scoreImpact: -35, severity: 'CRITICAL' };
  }
  const color = (data.color || '').toUpperCase();
  if (['D','E','F'].includes(color) && /type\s*ii\s*a|type\s*iia/i.test(combinedText) && !/color\s*origin|natural\s*color/i.test(combinedText)) {
    return { type: 'warning', label: 'Suspected HPA Treatment (Type IIa D-F)', detail: 'Type IIa + D-F color without color origin statement = possible High Pressure Annealing. Verify certificate for treatment disclosure.', scoreImpact: -8, severity: 'HIGH' };
  }
  return null;
}

function checkFacetConsistency(data) {
  if (!/round/i.test(data.shape || '')) return null;
  const caMin = parseFloat(data.crownAngleMin);
  const caMax = parseFloat(data.crownAngleMax);
  const paMin = parseFloat(data.pavilionAngleMin);
  const paMax = parseFloat(data.pavilionAngleMax);
  const caRange = !isNaN(caMin) && !isNaN(caMax) ? caMax - caMin : null;
  const paRange = !isNaN(paMin) && !isNaN(paMax) ? paMax - paMin : null;
  const findings = [];
  let scoreImpact = 0;
  if (caRange !== null) {
    if (caRange < 0.5) { findings.push('Crown angle range ' + caRange.toFixed(1) + '° = excellent facet consistency'); scoreImpact += 3; }
    else if (caRange < 1.0) { findings.push('Crown angle range ' + caRange.toFixed(1) + '° = good consistency'); }
    else { findings.push('Crown angle range ' + caRange.toFixed(1) + '° = uneven faceting — light performance degraded'); scoreImpact -= 5; }
  }
  if (paRange !== null) {
    if (paRange < 0.3) { findings.push('Pavilion angle range ' + paRange.toFixed(1) + '° = exceptional precision'); scoreImpact += 3; }
    else if (paRange < 0.6) { findings.push('Pavilion angle range ' + paRange.toFixed(1) + '° = good precision'); }
    else { findings.push('Pavilion angle range ' + paRange.toFixed(1) + '° = uneven pavilion — fire distribution impaired'); scoreImpact -= 5; }
  }
  if (findings.length === 0) return null;
  return { type: scoreImpact < 0 ? 'warning' : 'info', label: scoreImpact >= 3 ? 'Excellent Facet Consistency' : (scoreImpact < 0 ? 'Facet Consistency Warning' : 'Facet Consistency'), detail: findings.join(' | '), scoreImpact, severity: scoreImpact < 0 ? 'MEDIUM' : 'INFO' };
}

function checkGradingLabInfo(data) {
  const lab = (data.gradingLab || '').trim();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const reportNum = (data.reportNumber || '').toLowerCase();
  const combined = lab + ' ' + comments + ' ' + reportNum;
  if (!lab && !/igi|hrd|egl|ags/i.test(combined)) return null;

  // Guard: if GIA is explicitly mentioned, skip non-GIA lab detection
  var isClearlyGIA = /GIA|gemological institute of america/i.test(combined);
  if (/igi/i.test(combined) && !isClearlyGIA) {
    return { type: 'warning', label: 'Non-GIA Lab: IGI (Stricter Scoring)', detail: 'IGI grading tends to be 1-2 grades looser on color and 1 grade looser on clarity vs GIA standards. IGI G = GIA H-I, IGI SI1 ≈ GIA SI2. Score may overstate true GIA-equivalent grade.', scoreImpact: -8, severity: 'HIGH' };
  }
  if (/egl/i.test(combined) && !/golconda/i.test(combined)) {
    return { type: 'critical', label: 'Non-GIA Lab: EGL (Major Deviation Risk)', detail: 'EGL grading is typically 2-3 grades looser than GIA. EGL G ≈ GIA J-K. EGL VS1 ≈ GIA SI1. Score is unreliable — request GIA recertification.', scoreImpact: -15, severity: 'CRITICAL' };
  }
  if (/hrd/i.test(combined)) {
    return { type: 'info', label: 'Non-GIA Lab: HRD (Minor Deviation)', detail: 'HRD grading is slightly stricter on color, slightly looser on clarity. HRD G ≈ GIA G, HRD VS1 ≈ GIA VS1-SI1. Minor adjustment applied.', scoreImpact: -3, severity: 'LOW' };
  }
  if (/ags/i.test(combined)) {
    return { type: 'info', label: 'AGS Laboratory (Ideal Cut Expert)', detail: 'AGS is the gold standard for cut grading. AGS Ideal = GIA Excellent with tighter optical precision. Consider AGS grade authoritative for proportions.', scoreImpact: 2, severity: 'INFO' };
  }

  let detail = '';
  const isPremium = /new york|tokyo/i.test(lab);
  const isStandard = /carlsbad/i.test(lab);
  const isRegional = /mumbai|hong kong|bangkok|dubai/i.test(lab);
  if (isPremium) detail = lab + ' is widely considered the most conservative GIA lab. D-F color grades from this lab carry premium market trust.';
  else if (isStandard) detail = lab + ' is the GIA global headquarters. Standard grading reference.';
  else if (isRegional) detail = lab + ' serves regional markets. Some buyers prefer NY/Tokyo-graded stones for D-F colors.';
  else detail = 'Grading lab: ' + lab;
  return { type: 'info', label: 'Grading Lab: ' + lab, detail, scoreImpact: 0, severity: 'INFO' };
}

function checkCutGradeApplicable(data) {
  const shape = (data.shape || '').toLowerCase();
  const isRound = /round/i.test(shape);
  const hasCutGrade = data.cutGrade && data.cutGrade !== 'Non-Graded' && !/n\/a|not applicable/i.test(data.cutGrade);
  if (isRound && !hasCutGrade) {
    return { type: 'warning', label: 'Cut Grade Missing (Round Diamond)', detail: 'Round diamond should have a Cut Grade from GIA. Missing Cut Grade = possible OCR error or data corruption.', scoreImpact: 0, severity: 'MEDIUM' };
  }
  if (!isRound && hasCutGrade) {
    const isPrincess = /princess/i.test(shape);
    if (isPrincess) {
      return { type: 'info', label: 'Cut Grade Present (Princess Cut)', detail: 'GIA has formally graded Princess Cut since August 2019. Cut Grade is fully applicable and expected.', scoreImpact: 0, severity: 'INFO' };
    }
    return { type: 'info', label: 'Cut Grade Present (Fancy Shape)', detail: 'GIA does not formally grade Cut for most fancy shapes (except Princess since 2019). The presence of a cut grade may indicate an older certificate, non-GIA report, or special request.', scoreImpact: 0, severity: 'INFO' };
  }
  return null;
}

function checkReportTypeLimitations(data) {
  const reportType = (data.reportType || '').toLowerCase();
  if (!reportType || !/dossier/i.test(reportType)) return null;
  const flags = [];
  if (data.inclusionPlotDescription) {
    flags.push('Inclusion plot description is not available on Diamond Dossier — AI-generated data may be unreliable');
    data.inclusionPlotDescription = null;
  }
  if (data.crownHeightPct || data.pavilionDepthPct) {
    flags.push('Proportions diagram data is not available on Diamond Dossier — these values should be null');
    data.crownHeightPct = null;
    data.pavilionDepthPct = null;
  }
  if (flags.length === 0) return null;
  return { type: 'info', label: 'Diamond Dossier Limitations', detail: flags.join(' | ') + ' | Dossier has no inclusion plot or proportions diagram. Assessments based on these are limited.', scoreImpact: 0, severity: 'MEDIUM' };
}

function checkAdditionalInscription(data) {
  const ai = (data.additionalInscription || '').toLowerCase();
  if (!ai) return null;
  const findings = [];
  let scoreImpact = 0;
  if (/ags/i.test(ai)) {
    findings.push('AGS dual-certificate detected — stone graded by both GIA and AGS. Exceptional quality signal.');
    scoreImpact += 8;
  }
  if (/forevermark/i.test(ai)) {
    findings.push('De Beers Forevermark inscription — premium brand diamond. Retail premium 5-15%.');
    scoreImpact += 5;
  }
  if (/H\s*&?\s*A|hearts.*arrow/i.test(ai)) {
    findings.push('H&A designation confirmed in laser inscription — independently verified optical symmetry.');
    scoreImpact += 5;
  }
  if (/brand/i.test(ai)) {
    findings.push('Branded diamond inscription detected — premium branding adds retail value.');
    scoreImpact += 3;
  }
  if (findings.length === 0) return null;
  return { type: 'info', label: 'Additional Inscription Value', detail: findings.join(' | '), scoreImpact, severity: scoreImpact >= 8 ? 'SUPER' : 'INFO' };
}

function checkMeasurementTolerance(data) {
  if (!/round/i.test(data.shape || '')) return null;
  const ca = parseFloat(data.crownAngle);
  const pa = parseFloat(data.pavilionAngle);
  const tbl = parseFloat(data.tablePct);
  const dep = parseFloat(data.depthPct);
  const findings = [];
  const TOLERANCE = { crownAngle: 0.5, pavilionAngle: 0.5, tablePct: 1.0, depthPct: 0.5 };

  if (!isNaN(ca) && ca >= 34.0 - TOLERANCE.crownAngle && ca <= 35.0 + TOLERANCE.crownAngle && (ca < 34.0 || ca > 35.0)) {
    findings.push('Crown angle ' + ca + '° is borderline Super Ideal (within ±0.5° GIA measurement tolerance)');
  }
  if (!isNaN(pa) && pa >= 40.6 - TOLERANCE.pavilionAngle && pa <= 41.0 + TOLERANCE.pavilionAngle && (pa < 40.6 || pa > 41.0)) {
    findings.push('Pavilion angle ' + pa + '° is borderline Super Ideal (within ±0.5° GIA measurement tolerance)');
  }
  if (findings.length === 0) return null;
  return { type: 'info', label: 'Borderline Proportions (Tolerance Zone)', detail: findings.join(' | ') + ' | These values may actually fall within ideal range considering GIA measurement tolerances. Request lab scan for precise values.', scoreImpact: 0, severity: 'INFO' };
}

function validateClarityConsistency(data) {
  const chars = (data.clarityCharacteristics || '').toLowerCase();
  const symbols = DataGuard.safeArray(data.keyToSymbols).map(function(s) { return s.toLowerCase(); });
  if (!chars || symbols.length === 0) return null;
  const charParts = chars.split(/[,;\/]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  const missingFromChars = symbols.filter(function(s) {
    return !charParts.some(function(c) { return s.includes(c) || c.includes(s.split(/\s+/)[0]); });
  });
  if (missingFromChars.length > 0) {
    return { type: 'warning', label: 'Clarity Data Inconsistency', detail: 'Key to Symbols has inclusions (' + missingFromChars.join(', ') + ') not reflected in Clarity Characteristics. Possible OCR error or incomplete data extraction.', scoreImpact: 0, severity: 'MEDIUM' };
  }
  return null;
}

function checkSI2LusterPenalty(data) {
  const clarity = (data.clarity || '').toUpperCase();
  if (clarity !== 'SI2') return null;
  if (isFancyColorExtended(data.color)) return { type: 'info', label: 'Fancy SI2 (Color-First Luster Tolerance)', detail: 'SI2 luster penalty waived for fancy color — color dominates value', scoreImpact: 0, severity: 'INFO' };

  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  const cloudCount = (combinedText.match(/cloud/gi) || []).length;
  const crystalCount = (combinedText.match(/crystal/gi) || []).length;
  const featherCount = (combinedText.match(/feather/gi) || []).length;

  const totalInclusions = cloudCount + crystalCount + featherCount;
  if (totalInclusions >= 3) {
    return { type: 'warning', label: 'SI2 + Multiple Inclusions = Luster Penalty', detail: 'SI2 + ' + totalInclusions + ' inclusions = multiple scatter points reduce transparency/luster', scoreImpact: -8, severity: 'HIGH' };
  }
  return null;
}

function checkBothField(data, pattern) {
  if (!data || !pattern) return false;
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const re = new RegExp(pattern, 'i');
  return re.test(comments) || re.test(keyToSymbols);
}

function checkPortraitCut(data) {
  return getPortraitCutResult(data);
}

function evaluateGirdleConsistency(data) {
  const girdle = (data.girdle || '').toLowerCase();
  if (!girdle) return null;

  if (/very thin to thick|thin to thick|uneven/i.test(girdle)) {
    const carat = parseFloat(data.carat) || 0;
    const penalty = carat >= 2 ? 8 : 5;
    return { type: 'warning', label: 'Inconsistent Girdle', detail: 'Girdle: ' + data.girdle + ' = girdle thickness inconsistent, may affect setting stability', scoreImpact: -penalty, severity: 'MEDIUM' };
  }
  return null;
}

function calculateGirdlePenalty(girdle, carat) {
  if (!girdle) return 0;
  const g = girdle.toLowerCase();
  const c = parseFloat(carat) || 0;
  let base = 0;

  // THICK: weight hiding issue
  if (/extremely thick/i.test(g)) base = -15;
  else if (/very thick/i.test(g)) base = -10;
  else if (/thick/i.test(g) && !/thin/i.test(g)) base = -4;
  else if (/slightly thick/i.test(g)) base = -2;

  // THIN: chipping/durability risk
  if (/extremely thin/i.test(g)) base -= 12;
  else if (/very thin/i.test(g)) base -= 8;
  else if (/^thin$/i.test(g.trim()) && !/thick/i.test(g)) base -= 5;

  if (c >= 50 && base < 0) base = Math.round(base * CONFIG.GIRDLE_PENALTY_CARAT_MULT.xlarge.mult);
  else if (c >= 3 && base < 0) base = Math.round(base * CONFIG.GIRDLE_PENALTY_CARAT_MULT.large.mult);
  else if (c >= 2 && base < 0) base = Math.round(base * CONFIG.GIRDLE_PENALTY_CARAT_MULT.medium.mult);
  else if (c >= 0 && base < 0) base = Math.round(base * CONFIG.GIRDLE_PENALTY_CARAT_MULT.small.mult);

  if (base === 0) {
    if (/faceted/i.test(g)) return 3;
    if (/polished/i.test(g)) return 1;
  }
  return base;
}

function deduplicateFlags(flags) {
  if (!Array.isArray(flags) || flags.length === 0) return [];
  const seen = {};
  return flags.filter(function(f) {
    const key = (f.label || '') + '|' + (f.detail || '');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

// ============================================================================
// SECTION 6: NEW FUNCTIONS (Rounds 1-10)
// ============================================================================

function checkClarityBasedOnClouds(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;
  const isFancy = isFancyColorExtended(data.color);
  const fancyReduction = isFancy ? 0.5 : 1.0; // Fancy: clarity matters less

  if (comments.includes('clarity grade is based on clouds that are not shown') ||
      comments.includes('grade is based on clouds not shown')) {
    return { type: 'critical', label: 'CRITICAL: CLARITY ON HOLD (Clouds Not Shown)', detail: 'Clarity based on clouds not shown = actual clarity may be 1-3 grades lower, eye-visible clouds likely' + (isFancy ? ' | Fancy color: color value partially offsets clarity risk' : ''), scoreImpact: Math.round(-25 * fancyReduction), severity: 'CRITICAL' };
  }

  if (/additional\s+clouds?\s+(?:are\s+)?not\s+shown/i.test(combinedText)) {
    const clarity = (data.clarity || '').toUpperCase();
    const isSI2 = clarity === 'SI2';
    const isSI1 = clarity === 'SI1';
    let scoreImpact = isSI2 ? Math.round(-25 * fancyReduction) : (isSI1 ? Math.round(-18 * fancyReduction) : Math.round(-12 * fancyReduction));
    let severity = isSI2 ? 'CRITICAL' : 'HIGH';
    let detail = 'Additional clouds not shown = actual clarity may be 1-2 grades lower than stated';
    if (isSI2) {
      detail = 'SI2 + Additional clouds not shown = CRITICAL MILKY TRAP. 90% of SI2 stones with this comment are milky/cloudy. Actual appearance may be I1-I2 grade. This is a known market trap.' + (isFancy ? ' | Fancy color partially mitigates clarity impact.' : '');
      scoreImpact = Math.round(-30 * fancyReduction);
    } else if (isSI1) {
      detail += '. SI1 grade + clouds not shown = high risk of eye-visible haze';
    }
    return { type: isSI2 ? 'critical' : 'warning', label: isSI2 ? 'CRITICAL: SI2 + Clouds Not Shown (Milky Trap)' : 'Additional Clouds Not Shown (borderline clarity)', detail: detail, scoreImpact: scoreImpact, severity: isSI2 ? 'CRITICAL' : severity };
  }
  // Positive signal: fully documented clouds
  if (/clouds?\s*(?:are\s*)?shown\b(?!\s*not)/i.test(combinedText) && !/not\s*shown/i.test(combinedText)) {
    return { type: 'info', label: 'Clouds Fully Documented', detail: 'Clouds are shown = all cloud inclusions fully plotted on certificate. Good transparency signal.', scoreImpact: 2, severity: 'INFO' };
  }
  // Differentiate harmless pinpoints
  if (/pinpoints?\s+(?:are\s+)?not\s+shown/i.test(combinedText) && !/cloud.*not\s*shown|grade is based/i.test(combinedText)) {
    return { type: 'info', label: 'Pinpoints Not Shown (Harmless)', detail: 'Pinpoints not shown = microscopic dots too small to plot. Normal.', scoreImpact: 0, severity: 'INFO' };
  }
  return null;
}

function evaluateGrainingDetail(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;
  const clarity = (data.clarity || '').toUpperCase();

  const hasSurfaceGraining = /surface\s*graining/i.test(combinedText);
  const hasInternalGraining = /internal\s*graining/i.test(combinedText);
  const hasInternalGrainingNotShown = /internal\s*graining\s*(?:is\s*)?not\s*shown/i.test(combinedText);
  const hasSurfaceGrainingNotShown = /surface\s*graining\s*(?:is\s*)?not\s*shown/i.test(combinedText);
  const hasGrainingNotShown = /graining\s*is\s*not\s*shown/i.test(combinedText);
  const hasCrossHatch = /cross[\s-]?hatch|crosshatch/i.test(combinedText);

  if (!hasSurfaceGraining && !hasInternalGraining && !hasGrainingNotShown && !hasCrossHatch) return null;

  const findings = [];
  let scoreImpact = 0;
  let severity = 'LOW';

  if (hasCrossHatch) { findings.push('Cross-hatch graining = cross-hatch growth lines, affects optical performance, may produce oily appearance'); scoreImpact -= 10; severity = 'HIGH'; }

  if (hasInternalGrainingNotShown) {
    // Scale graining penalty by clarity: high clarity = GIA standard note, not a real defect
    var isHighCl = ['FL','IF','VVS1','VVS2','VS1','VS2'].includes(clarity);
    var grainPenalty = isHighCl ? -3 : -12;
    findings.push('Internal Graining NOT SHOWN = internal growth lines not plotted, may affect transparency but cannot assess severity from certificate plot');
    scoreImpact += grainPenalty;
    severity = isHighCl ? 'LOW' : 'HIGH';
  }
  else if (hasInternalGraining) {
    if (['FL', 'IF'].includes(clarity)) { findings.push('Internal Graining in ' + clarity + ' = undermines flawless image in top clarity'); scoreImpact -= 8; severity = 'HIGH'; }
    else if (['VVS1', 'VVS2', 'VS1', 'VS2'].includes(clarity)) { findings.push('Internal Graining = internal growth lines, may affect transparency'); scoreImpact -= 4; severity = 'MEDIUM'; }
    else {
      const colorUpper = (data.color || '').toUpperCase();
      const isLowColor = ['J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'].includes(colorUpper);
      if (isLowColor) { findings.push('Internal Graining = minor texture in J-K grades, does not affect fire'); scoreImpact -= 0; if (severity === 'LOW') severity = 'INFO'; }
      else { findings.push('Internal Graining = internal growth lines'); scoreImpact -= 2; }
    }
  }

  if (hasSurfaceGrainingNotShown) {
    var isHighCl2 = ['FL','IF','VVS1','VVS2','VS1','VS2'].includes(clarity);
    var surfPenalty = isHighCl2 ? -2 : -5;
    findings.push('Surface Graining NOT SHOWN = surface growth lines not plotted, usually minor optical impact');
    scoreImpact += surfPenalty;
    if (severity !== 'HIGH') severity = 'MEDIUM';
  }
  else if (hasSurfaceGraining) {
    if (['FL', 'IF'].includes(clarity)) { findings.push('Surface Graining in ' + clarity + ' = surface growth lines in top clarity, affects polish quality but not clarity grade'); scoreImpact -= 5; if (severity !== 'HIGH') severity = 'MEDIUM'; }
    else { findings.push('Surface Graining = surface growth lines, minor luster impact'); scoreImpact -= 2; }
  }

  if (hasGrainingNotShown && !hasInternalGrainingNotShown && !hasSurfaceGrainingNotShown) { findings.push('Graining is not shown = growth lines not plotted, may affect transparency assessment'); scoreImpact -= 3; if (severity === 'LOW') severity = 'MEDIUM'; }

  if (findings.length === 0) return null;
  var isCritical = severity === 'CRITICAL' || scoreImpact <= -15;
  if (isCritical && hasInternalGrainingNotShown && !hasSurfaceGrainingNotShown) {
    isCritical = false; // Internal graining alone never critical (standard GIA disclaimer)
  }
  return { type: isCritical ? 'critical' : 'warning', label: isCritical ? 'CRITICAL: Severe Graining Detected' : 'Graining Detail', detail: findings.join(' | '), scoreImpact: scoreImpact, severity: isCritical ? 'CRITICAL' : severity, findings: findings };
}

function checkPhosphorescence(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + (data.reportNumber || '').toLowerCase();

  const isTypeIIb = /type\s*ii\s*b|type\s*iib|type\s*ii\-b/i.test(combinedText);
  if (!isTypeIIb) return null;

  const fluorescence = (data.fluorescence || '').toLowerCase();
  const hasUVReactive = /strong|very strong|medium/i.test(fluorescence);

  if (!hasUVReactive) {
    return { type: 'info', label: 'Type IIb: Check Phosphorescence', detail: 'Type IIb boron diamond usually UV-reactive with possible phosphorescence. No fluorescence = verify Type IIb label authenticity', scoreImpact: 0, severity: 'INFO' };
  }

  const hasPhosphorescence = /phosphorescen/i.test(combinedText);
  if (hasPhosphorescence) {
    return { type: 'info', label: 'Type IIb Phosphorescence Confirmed', detail: 'Type IIb + UV reactive + phosphorescence confirmed = key identifying feature of natural blue/IIb diamond. Auction premium +5-10%', scoreImpact: 5, severity: 'INFO' };
  }

  return { type: 'info', label: 'Type IIb: Phosphorescence Status Unknown', detail: 'Type IIb boron diamond usually has phosphorescence but cert does not note it. Request UV reaction video from seller to confirm natural origin', scoreImpact: 0, severity: 'INFO' };
}

function evaluateEmeraldCrownHeight(data) {
  const shape = (data.shape || '').toLowerCase();
  const isStepCut = /emerald|asscher|baguette/i.test(shape);
  if (!isStepCut) return null;

  const tablePct = parseFloat(data.tablePct);
  const depthPct = parseFloat(data.depthPct);
  const crownAngle = parseFloat(data.crownAngle);

  if (isNaN(tablePct) || isNaN(depthPct)) return null;

  let crownHeightPct;
  if (!isNaN(crownAngle)) { const crownRad = crownAngle * Math.PI / 180; crownHeightPct = (1 - tablePct / 100) * Math.tan(crownRad) / 2 * 100; if (!isFinite(crownHeightPct) || crownHeightPct <= 0) crownHeightPct = depthPct * 0.14; }
  else { crownHeightPct = depthPct * 0.14; }

  if (crownHeightPct < 10) {
    return { type: 'warning', label: 'Emerald Crown Height Too Shallow', detail: 'Step-cut crown height ~' + crownHeightPct.toFixed(1) + '% < 10%. Step-cut mirror reflection effect insufficient, stone appears dark without layering.', scoreImpact: -12, severity: 'HIGH', crownHeightPct: crownHeightPct };
  }
  if (crownHeightPct < 12) {
    return { type: 'info', label: 'Emerald Crown Height Suboptimal', detail: 'Step-cut crown height ~' + crownHeightPct.toFixed(1) + '% < 12%. Ideal hall of mirrors step reflection needs >= 12% Crown Height.', scoreImpact: -5, severity: 'MEDIUM', crownHeightPct: crownHeightPct };
  }
  if (crownHeightPct >= 12 && crownHeightPct <= 16) {
    return { type: 'info', label: 'Emerald Crown Height: Ideal', detail: 'Crown height ~' + crownHeightPct.toFixed(1) + '% = ideal range (12-16%). Step-cut mirror reflection maximized.', scoreImpact: 3, severity: 'INFO', crownHeightPct: crownHeightPct };
  }
  if (crownHeightPct > 18) {
    return { type: 'warning', label: 'Emerald Crown Height Too Deep', detail: 'Crown height ~' + crownHeightPct.toFixed(1) + '% > 18%. Crown too deep hides weight and may cause dark center.', scoreImpact: -8, severity: 'MEDIUM', crownHeightPct: crownHeightPct };
  }
  return null;
}

function checkGirdleCondition(data) {
  const girdle = (data.girdle || '').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  if (!girdle) return null;

  if (girdle.includes('faceted')) {
    return { type: 'info', label: 'Faceted Girdle (top craftsmanship)', detail: 'Faceted girdle = additional facets on girdle, brighter than polished, premium craftsmanship', scoreImpact: 10, severity: 'INFO' };
  }
  if (girdle.includes('polished')) {
    return { type: 'info', label: 'Polished Girdle (standard quality)', detail: 'Polished girdle = standard quality girdle finish', scoreImpact: 5, severity: 'INFO' };
  }
  if ((girdle.includes('bruted') || /rough|unpolished|ungrained/i.test(girdle)) && !girdle.includes('polished') && !girdle.includes('faceted')) {
    return { type: 'info', label: 'Bruted Girdle (frosted)', detail: 'Bruted girdle = frosted/matte finish, lower craftsmanship, no transparent facet reflection', scoreImpact: -5, severity: 'LOW' };
  }
  if (/very thin|extremely thin/i.test(girdle)) {
    return { type: 'warning', label: 'Chipping Risk: Very Thin Girdle', detail: 'Girdle: ' + data.girdle + ' - side fragile, susceptible to damage', scoreImpact: -15, severity: 'MEDIUM' };
  }
  if (/chip/i.test(comments) || /chip/i.test(girdle)) {
    return { type: 'warning', label: 'Chipping: Chip at Girdle Edge', detail: 'Girdle edge has chip, susceptible to damage', scoreImpact: -15, severity: 'MEDIUM' };
  }
  return null;
}

function checkUnifiedTintRisk(data) {
  if (isFancyColorExtended(data.color)) return null;
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const colorField = (data.color || '').toLowerCase();
  const colorUpper = (data.color || '').toUpperCase().trim();
  const combinedText = comments + ' ' + keyToSymbols + ' ' + colorField;

  const hasBrownish = /brownish|brown.*tint|light brown|medium brown|dark brown/i.test(combinedText);
  const hasGreenish = /greenish|green.*tint|light green|medium green/i.test(combinedText);
  const hasGrayish = /grayish|gray.*tint|light gray|medium gray/i.test(combinedText);
  const hasMuddy = /muddy|muddy color|muddy appearance/i.test(combinedText);
  const hasOily = /milky|cloudy|oily/i.test(combinedText) && !/natural/i.test(combinedText);

  if (!hasBrownish && !hasGreenish && !hasGrayish && !hasMuddy && !hasOily) return null;

  const isLowColor = /^[JKLM]$/i.test(colorUpper);
  const tintTypes = [];
  if (hasBrownish) tintTypes.push('Brown');
  if (hasGreenish) tintTypes.push('Green');
  if (hasGrayish) tintTypes.push('Gray');
  if (hasMuddy) tintTypes.push('Muddy');

  let scoreImpact = 0, severity = 'MEDIUM', label = '';

  if (hasOily) { scoreImpact -= 20; severity = 'CRITICAL'; label = 'CRITICAL: Oily/Cloudy Appearance'; }
  else if (hasMuddy) { scoreImpact -= 20; severity = 'HIGH'; label = 'CRITICAL: Muddy Tint'; }
  else if (tintTypes.length > 0) { scoreImpact -= Math.min(tintTypes.length * 10, 25); severity = scoreImpact <= -20 ? 'HIGH' : 'MEDIUM'; label = tintTypes.join('/') + ' Tint Detected'; }

  if (['D', 'E', 'F'].includes(colorUpper)) { scoreImpact -= 10; severity = 'CRITICAL'; label = label + ' (High Color Killer)'; }
  if (isLowColor && tintTypes.length > 0) { scoreImpact -= 5; severity = scoreImpact <= -25 ? 'CRITICAL' : severity; }

  return { type: severity === 'CRITICAL' ? 'critical' : 'warning', label: label, detail: tintTypes.length > 0 ? tintTypes.join('/') + ' tint reduces market value ' + Math.abs(scoreImpact) + ' points. ' + (isLowColor ? 'J-M low color + off-tone = very low market acceptance.' : '') : 'Oily appearance affects transparency', scoreImpact: scoreImpact, severity: severity, tintTypes: tintTypes };
}

function checkSurfaceReaching(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  const surfaceReachingPatterns = [/surface[\s-]reaching/i, /reaches?\s+(?:the\s+)?surface/i, /breaks?\s+(?:the\s+)?surface/i, /open\s+(?:to\s+(?:the\s+)?)?surface/i];

  for (let i = 0; i < surfaceReachingPatterns.length; i++) {
    if (surfaceReachingPatterns[i].test(combinedText)) {
      const hasCriticalType = /feather|knot|cavity|chip/i.test(combinedText);
      const shape = (data.shape || '').toLowerCase();
      const isPointy = /pear|marquise|heart|trill/i.test(shape);

      let scoreImpact = -20;
      let detail = 'Surface-reaching inclusion detected = inclusion breaks surface, structural integrity compromised';
      if (hasCriticalType) { scoreImpact = -30; detail = 'Surface-reaching feather/knot/cavity = inclusion penetrating surface, fracture risk when setting/wearing'; }
      if (isPointy) { scoreImpact -= 10; detail += ' | Pointed shape + surface penetration = tip stress easily causes crack propagation'; }

      return { type: 'critical', label: hasCriticalType ? 'CRITICAL: Surface-Reaching Critical Inclusion' : 'Surface-Reaching Inclusion', detail: detail, scoreImpact: scoreImpact, severity: scoreImpact <= -30 ? 'CRITICAL' : 'HIGH' };
    }
  }
  return null;
}

function checkSilkEffect(data) {
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  const hasNeedle = /needle/i.test(combinedText);
  if (!hasNeedle) return null;

  const needleMatches = combinedText.match(/needle/gi);
  const needleCount = needleMatches ? needleMatches.length : 1;
  const hasParallel = /parallel|group|cluster|concentrat/i.test(combinedText);
  const hasMultiple = needleCount >= 2;

  if (hasParallel || hasMultiple) {
    const carat = parseFloat(data.carat) || 0;
    const scoreImpact = carat >= 3 ? -10 : -5;
    const severity = carat >= 3 ? 'HIGH' : 'MEDIUM';
    return { type: 'warning', label: 'Silk Effect Risk (parallel needles)', detail: 'Multiple parallel needles (' + needleCount + ' detected) = silk effect risk. Parallel needles scatter light, affecting transparency and fire. ' + (carat >= 3 ? 'More visible in 3ct+ stones.' : ''), scoreImpact: scoreImpact, severity: severity, needleCount: needleCount };
  }
  return null;
}

function checkFancyColorSecondaryHue(data) {
  const color = (data.color || '').toUpperCase();
  if (!color.includes('FANCY')) return null;

  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + color.toLowerCase();

  const isYellow = /yellow/i.test(color);
  const isBlue = /blue/i.test(color);
  const isPink = /pink/i.test(color);
  const isGreen = /green/i.test(color);
  const isOrange = /orange/i.test(color);
  const isPurple = /purple/i.test(color);
  const isRed = /red/i.test(color);

  const hasBrownish = /brownish|brown\s*(?:ish|y|secondary)/i.test(combinedText);
  const hasGreenish = /greenish|green\s*(?:ish|y|secondary)/i.test(combinedText);
  const hasGrayish = /grayish|gray\s*(?:ish|y|secondary)/i.test(combinedText);
  const hasPurplish = /purplish|purple\s*(?:ish|y|secondary)/i.test(combinedText);
  const hasOrangy = /orang[eiy]/i.test(combinedText);
  const hasPinkish = /pinkish/i.test(combinedText);
  const hasYellowish = /yellowish|yellow\s*(?:ish|y|secondary)/i.test(combinedText);
  const hasBluish = /bluish|blue\s*(?:ish|y|secondary)/i.test(combinedText);

  let scoreImpact = 0;
  const findings = [];

  // Yellow combinations
  if (isYellow && hasBrownish) { scoreImpact -= 15; findings.push('Brownish-yellow = market discount 15-25%'); return { type: 'warning', label: 'Fancy Yellow w/ Brownish Hue', detail: findings.join(''), scoreImpact, severity: 'HIGH' }; }
  if (isYellow && hasOrangy) { scoreImpact += 8; findings.push('Orangy-yellow = warm saturation premium 5-10%'); return { type: 'info', label: 'Fancy Yellow w/ Orangy Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }
  if (isYellow && hasGreenish) { scoreImpact -= 10; findings.push('Greenish-yellow = olive tone, market discount'); return { type: 'warning', label: 'Fancy Yellow w/ Greenish Hue', detail: findings.join(''), scoreImpact, severity: 'MEDIUM' }; }

  // Blue combinations
  if (isBlue && hasGreenish) { scoreImpact += 5; findings.push('Greenish-blue = teal/natural feel premium'); return { type: 'info', label: 'Fancy Blue w/ Greenish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }
  if (isBlue && hasGrayish) { scoreImpact -= 10; findings.push('Grayish-blue = dull, reduced saturation'); return { type: 'warning', label: 'Fancy Blue w/ Grayish Hue', detail: findings.join(''), scoreImpact, severity: 'MEDIUM' }; }
  if (isBlue && hasPurplish) { scoreImpact += 5; findings.push('Purplish-blue = violet-blue, desirable'); return { type: 'info', label: 'Fancy Blue w/ Purplish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }

  // Pink combinations
  if (isPink && hasPurplish) { scoreImpact += 10; findings.push('Purplish-pink = highly desirable, auction premium'); return { type: 'info', label: 'Fancy Pink w/ Purplish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }
  if (isPink && hasBrownish) { scoreImpact -= 20; findings.push('Brownish-pink = lowest value fancy pink'); return { type: 'critical', label: 'CRITICAL: Fancy Pink w/ Brownish Hue', detail: findings.join(''), scoreImpact, severity: 'CRITICAL' }; }
  if (isPink && hasOrangy) { scoreImpact += 8; findings.push('Orangy-pink = warm pink, Argyle signature color'); return { type: 'info', label: 'Fancy Pink w/ Orangy Hue (Argyle)', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }

  // Green combinations
  if (isGreen && hasGrayish) { scoreImpact -= 15; findings.push('Grayish-green = severely reduced value'); return { type: 'warning', label: 'Fancy Green w/ Grayish Hue', detail: findings.join(''), scoreImpact, severity: 'HIGH' }; }
  if (isGreen && hasYellowish) { scoreImpact += 3; findings.push('Yellowish-green = brighter appearance'); return { type: 'info', label: 'Fancy Green w/ Yellowish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }
  if (isGreen && hasBluish) { scoreImpact += 5; findings.push('Bluish-green = desirable teal tone'); return { type: 'info', label: 'Fancy Green w/ Bluish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }

  // Orange combinations
  if (isOrange && hasPinkish) { scoreImpact += 10; findings.push('Pinkish-orange = near-Padparadscha, premium'); return { type: 'info', label: 'Fancy Orange w/ Pinkish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }
  if (isOrange && hasBrownish) { scoreImpact -= 8; findings.push('Brownish-orange = muddy, market discount'); return { type: 'warning', label: 'Fancy Orange w/ Brownish Hue', detail: findings.join(''), scoreImpact, severity: 'MEDIUM' }; }
  if (isOrange && hasYellowish) { scoreImpact += 3; findings.push('Yellowish-orange = bright, desirable'); return { type: 'info', label: 'Fancy Orange w/ Yellowish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }

  // Red combinations
  if (isRed && hasPurplish) { scoreImpact += 5; findings.push('Purplish-red = classic fancy red (all natural reds are purplish-red)'); return { type: 'info', label: 'Fancy Red w/ Purplish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }
  if (isRed && hasBrownish) { scoreImpact -= 15; findings.push('Brownish-red = brick tone, market discount'); return { type: 'warning', label: 'Fancy Red w/ Brownish Hue', detail: findings.join(''), scoreImpact, severity: 'HIGH' }; }

  // Purple combinations
  if (isPurple && hasPinkish) { scoreImpact += 5; findings.push('Pinkish-purple = desirable mauve tone'); return { type: 'info', label: 'Fancy Purple w/ Pinkish Hue', detail: findings.join(''), scoreImpact, severity: 'INFO' }; }
  if (isPurple && hasGrayish) { scoreImpact -= 10; findings.push('Grayish-purple = dull, market discount'); return { type: 'warning', label: 'Fancy Purple w/ Grayish Hue', detail: findings.join(''), scoreImpact, severity: 'MEDIUM' }; }

  return null;
}

function checkAntiqueCutException(data) {
  const shape = (data.shape || '').toLowerCase();
  const isAntique = /old mine|old european|old miner|antique/i.test(shape);
  if (!isAntique) return null;

  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);
  const flags = [];
  let scoreImpact = 0;

  if (!isNaN(depthPct) && depthPct > 65 && depthPct <= 72) { flags.push('Old Mine depth ' + depthPct + '% is within acceptable antique range (up to 72%)'); scoreImpact += 5; }
  else if (!isNaN(depthPct) && depthPct > 72) { flags.push('Old Mine depth ' + depthPct + '% exceeds typical antique maximum (72%)'); scoreImpact -= 3; }
  if (!isNaN(tablePct) && tablePct < 50 && tablePct >= 38) { flags.push('Small table ' + tablePct + '% = characteristic of Old Mine cuts (not a defect, typical range 38-50%)'); scoreImpact += 5; }

  if (flags.length > 0) {
    return { type: 'info', label: 'Antique Cut Optical Exception', detail: flags.join(' | ') + ' | Antique cut optical parameters exempt from modern Round Brilliant standards', scoreImpact: scoreImpact, severity: 'INFO', isAntique: true };
  }
  return null;
}

function evaluateStarLowerHalfLength(data) {
  const shape = (data.shape || '').toLowerCase();
  if (!/round/i.test(shape)) return null;

  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = (data.keyToSymbols || []).join(' ').toLowerCase() + ' ' + comments;

  const starMatch = combinedText.match(/star\s*(?:facet\s*)?length[:\s]*(\d+)/i);
  const lowerHalfMatch = combinedText.match(/lower\s*(?:half|girdle|girdle\s*facet)[:\s]*(\d+)/i);

  if (!starMatch && !lowerHalfMatch) return null;

  const findings = [];
  let scoreImpact = 0;

  if (starMatch) {
    const starPct = parseInt(starMatch[1]);
    if (starPct < 45) { findings.push('Star Length ' + starPct + '% < 45% = star facets too short, insufficient scintillation, scattered fire'); scoreImpact -= 5; }
    else if (starPct > 60) { findings.push('Star Length ' + starPct + '% > 60% = star facets too long, too rapid scintillation, unstable fire'); scoreImpact -= 5; }
    else if (starPct >= 50 && starPct <= 55) { findings.push('Star Length ' + starPct + '% = ideal range (50-55%), optimal scintillation pattern'); scoreImpact += 3; }
  }

  if (lowerHalfMatch) {
    const lhPct = parseInt(lowerHalfMatch[1]);
    if (lhPct < 70) { findings.push('Lower Half ' + lhPct + '% < 70% = lower half facets too short, insufficient fire'); scoreImpact -= 5; }
    else if (lhPct > 85) { findings.push('Lower Half ' + lhPct + '% > 85% = lower half facets too long, blocky scintillation pattern'); scoreImpact -= 3; }
    else if (lhPct >= 75 && lhPct <= 80) { findings.push('Lower Half ' + lhPct + '% = ideal range (75-80%), optimal fire-scintillation balance'); scoreImpact += 3; }
  }

  if (findings.length === 0) return null;
  return { type: scoreImpact < 0 ? 'warning' : 'info', label: scoreImpact < 0 ? 'Facet Length Warning' : 'Facet Length: Ideal', detail: findings.join(' | '), scoreImpact: scoreImpact, severity: scoreImpact < 0 ? 'MEDIUM' : 'INFO', starLength: starMatch ? parseInt(starMatch[1]) : null, lowerHalfLength: lowerHalfMatch ? parseInt(lowerHalfMatch[1]) : null };
}

function checkDepthTableBalance(data) {
  const shape = (data.shape || '').toLowerCase();
  if (!/round/i.test(shape)) return null;

  const depthPct = parseFloat(data.depthPct);
  const tablePct = parseFloat(data.tablePct);
  if (isNaN(depthPct) || isNaN(tablePct)) return null;

  const balance = depthPct - tablePct;

  // Ideal balance for Round Brilliant: depth 61-62% minus table 55-57% = 4-7%
  // Expected range for most rounds: -10 to +15
  if (balance >= 3 && balance <= 8) {
    return { type: 'info', label: 'Depth-Table Balance: Ideal', detail: 'Total Depth ' + depthPct + '% - Table ' + tablePct + '% = ' + balance + '% (ideal 3-8%). Crown+Pavilion budget perfectly allocated.', scoreImpact: 3, severity: 'INFO', balance: balance };
  }
  if (balance < 1) {
    return { type: 'warning', label: 'Depth-Table Imbalance (Crown Too Thin)', detail: 'Total Depth ' + depthPct + '% - Table ' + tablePct + '% = ' + balance + '% < 1%. Crown/Pavilion too thin, fire severely insufficient.', scoreImpact: -8, severity: 'HIGH', balance: balance };
  }
  if (balance > 12) {
    return { type: 'warning', label: 'Depth-Table Imbalance (Crown Too Thick)', detail: 'Total Depth ' + depthPct + '% - Table ' + tablePct + '% = ' + balance + '% > 12%. Crown too thick, over-compresses Pavilion.', scoreImpact: -8, severity: 'HIGH', balance: balance };
  }
  if (balance > 8) {
    return { type: 'info', label: 'Depth-Table Balance: Slightly High', detail: 'Total Depth ' + depthPct + '% - Table ' + tablePct + '% = ' + balance + '%. Crown slightly thick but acceptable.', scoreImpact: -2, severity: 'LOW', balance: balance };
  }
  return { type: 'info', label: 'Depth-Table Balance: Slightly Low', detail: 'Total Depth ' + depthPct + '% - Table ' + tablePct + '% = ' + balance + '%. Crown slightly thin but within acceptable range.', scoreImpact: -2, severity: 'LOW', balance: balance };
}

function checkLaserDrillEnhanced(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const inscription = (data.inscription || '').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols + ' ' + inscription;

  if (/laser\s*drill\s*hole/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: Laser Drill Hole Detected', detail: 'Laser drill hole = artificial clarity enhancement. Value only 30-50% of untreated. Reject immediately.', scoreImpact: -100, severity: 'CRITICAL' };
  }
  if (/internal\s*laser\s*drill/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: Internal Laser Drilling', detail: 'Internal laser drilling = treatment traces may only be discovered after setting. Clarity grade is a false impression.', scoreImpact: -100, severity: 'CRITICAL' };
  }
  if (/km\s*treat|laser\s*treat|laser\s*km/i.test(combinedText)) {
    return { type: 'critical', label: 'CRITICAL: Laser Treatment (KM/Broad)', detail: 'Laser treatment (KM method) = large area laser treatment, structurally weakened.', scoreImpact: -100, severity: 'CRITICAL' };
  }
  return null;
}

function checkFluorClarityMasking(data) {
  const clarity = (data.clarity || '').toUpperCase();
  const fluorescence = (data.fluorescence || '').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const hasClouds = /cloud/i.test((data.keyToSymbols || []).join('') + comments);

  const isStrongBlue = /strong.*blue|blue.*strong/i.test(fluorescence) && !/yellow|white/i.test(fluorescence);
  if (!isStrongBlue) return null;

  if ((clarity === 'SI1' || clarity === 'SI2') && !hasClouds) {
    return { type: 'info', label: 'Fluor Clarity Masking Effect', detail: clarity + ' + Strong Blue Fluor (no clouds) = UV white fluorescence fills inclusions, less visible in daylight. Visual clarity upgraded ~1 grade.', scoreImpact: 3, severity: 'INFO' };
  }
  if (clarity === 'VS2' && !hasClouds) {
    return { type: 'info', label: 'Mild Fluor Clarity Masking', detail: 'VS2 + Strong Blue Fluor = mild inclusion masking effect, looks cleaner in daylight', scoreImpact: 1, severity: 'INFO' };
  }
  return null;
}

function checkPavilionBulge(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  const hasBulge = /pavilion\s*(bulge|convex|rounded|swollen)/i.test(combinedText) || /bulge/i.test(keyToSymbols);
  if (!hasBulge) return null;

  const carat = parseFloat(data.carat) || 0;
  const multiplier = carat >= 5 ? 2.5 : (carat >= 2 ? 1.5 : 1.0);

  return { type: 'warning', label: 'Pavilion Bulge Detected (weight hidden)', detail: 'Pavilion has bulge = weight hidden in pavilion rather than spread across table, visually smaller than same-weight stones. ' + (carat >= 5 ? '5ct+ impact is very significant.' : ''), scoreImpact: Math.round(-15 * multiplier), severity: carat >= 5 ? 'HIGH' : 'MEDIUM' };
}

function checkNaturalExtended(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  if (!/natural/i.test(combinedText)) return null;

  const onCrown = /natural.*crown|crown.*natural/i.test(combinedText);
  const onPavilion = /natural.*pavilion|pavilion.*natural/i.test(combinedText);

  if (onCrown) {
    return { type: 'warning', label: 'Natural on Crown (unusual location)', detail: 'Natural (original crystal surface) on Crown = very unusual. Naturals typically only on Girdle. May be surface defect extending to Crown.', scoreImpact: -8, severity: 'MEDIUM' };
  }
  if (onPavilion) {
    return { type: 'info', label: 'Natural on Pavilion', detail: 'Natural (original crystal surface) on Pavilion = relatively rare but better than on Crown. Usually invisible after setting.', scoreImpact: -3, severity: 'LOW' };
  }
  return null;
}

function evaluateInclusionPosition(data) {
  const symbols = DataGuard.safeArray(data.keyToSymbols);
  if (!symbols.length) return null;
  const symbolsText = symbols.join(' ').toLowerCase();
  let scoreImpact = 0;
  const findings = [];
  const POSITION_WEIGHT = {
    'table center': -15, 'table': -12, 'centre': -12, 'center': -12,
    'crown': -8, 'bezel': -8,
    'girdle edge': -5, 'girdle': -4, 'edge': -5,
    'pavilion': -3, 'bottom': -3, 'culet': -3,
    'surface': -6, 'internal': -4
  };
  let worstWeight = 0;
  const foundPositions = [];
  for (const [pos, weight] of Object.entries(POSITION_WEIGHT)) {
    if (symbolsText.includes(pos)) {
      foundPositions.push(pos);
      if (weight < worstWeight) worstWeight = weight;
    }
  }
  if (foundPositions.length > 0) {
    scoreImpact = worstWeight;
    findings.push(...foundPositions.map(function(p) { return 'Inclusion at ' + p; }));
  }
  if (findings.length === 0) return null;
  return { type: scoreImpact <= -12 ? 'warning' : 'info', label: 'Inclusion Position Assessment', detail: findings.join(' | ') + ' | Location significantly affects eye-visibility and value', scoreImpact, severity: scoreImpact <= -12 ? 'HIGH' : (scoreImpact <= -6 ? 'MEDIUM' : 'LOW') };
}

function evaluateGrainingSeverity(data) {
  const comments = DataGuard.combinedText(data);
  if (!/grain/i.test(comments)) return null;
  let severityMult = 1.0;
  let label = 'Standard Graining';
  if (/heavy|severe|reflective|pronounced/i.test(comments)) { severityMult = 2.5; label = 'Heavy/Reflective Graining (Severe)'; }
  else if (/moderate/i.test(comments)) { severityMult = 1.0; label = 'Moderate Graining'; }
  else if (/faint|slight|minor/i.test(comments)) { severityMult = 0.5; label = 'Faint Graining (Minor)'; }
  if (severityMult === 1.0) return { type: 'info', label, detail: 'Graining present at moderate/normal level — no premium impact', scoreImpact: 0, severity: 'INFO', multiplier: severityMult };
  const penalty = severityMult > 1.0 ? Math.round(-6 * (severityMult - 1.0)) : 0;
  return { type: severityMult > 1.5 ? 'warning' : 'info', label, detail: 'Graining severity modifiers applied (' + Math.round(severityMult * 100) + '% weight). Heavy/reflective graining can severely impact transparency.', scoreImpact: penalty, severity: severityMult > 1.5 ? 'HIGH' : 'LOW', multiplier: severityMult };
}

function evaluateClaritySubGrade(data) {
  const clarity = (data.clarity || '').toUpperCase();
  if (!['SI1','SI2','VS2','I1'].includes(clarity)) return null;
  const symbols = DataGuard.safeArray(data.keyToSymbols);
  const inclusionCount = symbols.length;
  const comments = DataGuard.combinedText(data);
  let adjustment = 0;
  const reasons = [];
  if (inclusionCount <= 1) { adjustment += 3; reasons.push('Only 1 inclusion — top of grade range'); }
  else if (inclusionCount >= 5) { adjustment -= 4; reasons.push('Multiple (' + inclusionCount + ') inclusions — bottom of grade range'); }
  if (/large|prominent|severe/i.test(comments)) { adjustment -= 4; reasons.push('Large/prominent inclusion noted'); }
  if (/small|minute|tiny/i.test(comments) && inclusionCount <= 2) { adjustment += 2; reasons.push('Small inclusions only'); }
  if (adjustment === 0) return null;
  return { type: adjustment < 0 ? 'warning' : 'info', label: adjustment < 0 ? 'Low-End ' + clarity + ' (Sub-grade Warning)' : 'High-End ' + clarity + ' (Sub-grade Bonus)', detail: reasons.join(' | ') + ' | Clarity grade is a range, not a point', scoreImpact: adjustment, severity: adjustment < 0 ? 'MEDIUM' : 'LOW' };
}

function checkFluorescenceEvenness(data) {
  const fluor = (data.fluorescence || '').toLowerCase();
  if (!fluor || fluor === 'none') return null;
  const comments = DataGuard.combinedText(data);
  if (/uneven|patchy|mottled|blotchy|irregular/i.test(fluor + ' ' + comments)) {
    return { type: 'critical', label: 'CRITICAL: Patchy/Uneven Fluorescence', detail: 'Uneven or patchy fluorescence = "flowery" appearance under UV light. This is a severe aesthetic defect that makes the stone appear splotchy. Market discount 20-40%.', scoreImpact: -25, severity: 'CRITICAL' };
  }
  if (/even|uniform/i.test(fluor + ' ' + comments)) {
    return { type: 'info', label: 'Even Fluorescence (Positive)', detail: 'Even fluorescence distribution = no splotchy appearance under UV', scoreImpact: 2, severity: 'INFO' };
  }
  return null;
}

function checkFancyFluorInteraction(data) {
  const color = (data.color || '').toUpperCase();
  if (!color.includes('FANCY')) return null;
  const fluor = (data.fluorescence || '').toLowerCase();
  if (!fluor || fluor === 'none') return null;
  const hasStrongBlue = /strong.*blue|blue.*strong|very strong.*blue/i.test(fluor);
  if (!hasStrongBlue) return null;
  const isYellow = /yellow/i.test(color);
  const isPink = /pink/i.test(color);
  const isBlue = /blue/i.test(color);
  if (isYellow) {
    return { type: 'warning', label: 'Fancy Yellow + Blue Fluor (Color Dilution)', detail: 'Fancy Yellow + Strong Blue fluorescence = blue light dilutes yellow saturation, reducing color value. Market discount 10-20%.', scoreImpact: -15, severity: 'HIGH' };
  }
  if (isPink) {
    return { type: 'info', label: 'Fancy Pink + Blue Fluor (Purple Shift Potential)', detail: 'Fancy Pink + Strong Blue fluorescence = possible purple hue enhancement under UV/daylight. Some markets value this combination.', scoreImpact: 5, severity: 'INFO' };
  }
  if (isBlue) {
    return { type: 'info', label: 'Fancy Blue + Blue Fluor (Color Intensification)', detail: 'Fancy Blue + Strong Blue fluorescence = blue fluor intensifies the natural blue body color, enhancing overall color saturation. Market premium for this combination.', scoreImpact: 8, severity: 'INFO' };
  }
  return null;
}

function checkFancyTreatmentRisk(data) {
  const color = (data.color || '').toUpperCase();
  if (!color.includes('FANCY')) return null;
  const comments = (data.comments || []).join(' ').toLowerCase();
  const isOrange = /orange/i.test(color);
  const isGreen = /green/i.test(color);
  const isYellow = /yellow/i.test(color);
  if (isOrange) {
    return { type: 'critical', label: 'CRITICAL: Fancy Orange — Verify Natural Origin', detail: '>95% of Fancy Orange diamonds on market are irradiated/treated. Natural Fancy Orange is extremely rare (Argyle source, now closed). Request origin documentation and lab report confirming natural color origin. Automatic penalty applied.', scoreImpact: -20, severity: 'CRITICAL' };
  }
  if (isGreen) {
    return { type: 'warning', label: 'WARNING: Fancy Green — Verify Natural Origin', detail: 'Over 95% of Fancy Green diamonds are irradiated. Natural green coloration comes from natural radiation exposure over millions of years. Cert must explicitly state "natural color" or "no evidence of treatment."', scoreImpact: -20, severity: 'HIGH' };
  }
  if (isYellow && color.includes('VIVID')) {
    return { type: 'warning', label: 'WARNING: Fancy Vivid Yellow — Verify Natural Origin', detail: 'Fancy Vivid Yellow diamonds may be HPHT-treated Type Ia cape stones with enhanced color saturation. Request color origin documentation. Natural Vivid Yellow is rare.', scoreImpact: -12, severity: 'HIGH' };
  }
  return null;
}

function checkFancyChameleon(data) {
  const color = (data.color || '').toUpperCase();
  if (!/CHAMELEON/i.test(color)) return null;
  const comments = (data.comments || []).join(' ').toLowerCase();
  const hasColorChange = /color\s*change|thermochrom|photochrom/i.test(comments);
  return {
    type: 'info',
    label: 'Chameleon Diamond — Color-Change Effect',
    detail: 'Chameleon diamonds exhibit temporary color change under heat (thermochromism) or after UV exposure (photochromism). Typically olive-green to brownish-yellow. Extremely rare collector\'s item.' + (hasColorChange ? ' Color-change effect confirmed in certificate comments.' : ''),
    scoreImpact: 10,
    severity: 'SUPER'
  };
}

function checkFancyDarkDeep(data) {
  const color = (data.color || '').toUpperCase();
  if (!color.includes('FANCY')) return null;

  if (/fancy\s*dark/i.test(color)) {
    return { type: 'warning', label: 'Fancy Dark = Too Dark, Loses Fire', detail: 'Fancy Dark color too deep, light cannot sufficiently enter stone resulting in severely reduced fire. Market discount 30-50% vs Fancy Intense.', scoreImpact: -20, severity: 'HIGH' };
  }
  if (/fancy\s*deep/i.test(color)) {
    const colorName = color.replace(/fancy\s*deep\s*/i, '').trim();
    return { type: 'info', label: 'Fancy Deep = Rich Saturation', detail: 'Fancy Deep ' + colorName + ' = deeply saturated color, light still penetrates, market value close to Fancy Intense.', scoreImpact: 3, severity: 'INFO' };
  }
  return null;
}

function checkPadparadscha(data) {
  const color = (data.color || '').toUpperCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combined = color + ' ' + comments;
  if (!/padparadscha|lotus/i.test(combined)) return null;
  const isPinkishOrange = /pinkish\s*orange|orange[-\s]pink/i.test(color);
  const hasLotusComment = /lotus\s*blossom|padparadscha\s*range/i.test(comments);
  const bonus = isPinkishOrange && hasLotusComment ? 40 : (isPinkishOrange || hasLotusComment ? 30 : 20);
  return { type: 'info', label: 'Padparadscha Color Detected', detail: 'Orange-Pink dual-tone lotus blossom color = second-rarest fancy color after pure Red. 30-50% premium over standard orange-pink.' + (bonus < 30 ? ' (Partial match — verify color origin)' : ''), scoreImpact: bonus, severity: 'SUPER' };
}

function checkYellowFluorImpact(data) {
  const fluor = (data.fluorescence || '').toLowerCase();
  const color = (data.color || '').toUpperCase();

  const hasYellowFluor = /yellow/i.test(fluor);
  if (!hasYellowFluor) return null;

  const isHighColor = ['D','E','F'].includes(color);
  const isMidColor = ['G','H','I'].includes(color);
  const isLowColor = ['J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'].includes(color);

  if (isHighColor) { return { type: 'critical', label: 'CRITICAL: Yellow Fluor + High Color (fatal combo)', detail: color + ' + Yellow fluorescence = white diamond with yellow base, destroys high color value. Reject immediately.', scoreImpact: -35, severity: 'CRITICAL' }; }
  if (isMidColor) { return { type: 'warning', label: 'Yellow Fluor + Mid Color', detail: color + ' + Yellow fluorescence = amplifies yellow tone, visual color downgrade 1-2 grades', scoreImpact: -15, severity: 'HIGH' }; }
  if (isLowColor) { return { type: 'info', label: 'Yellow Fluor + Low Color (minor impact)', detail: color + ' + Yellow fluorescence = minimal impact on low color, already not noticeable on low base', scoreImpact: -3, severity: 'LOW' }; }
  return null;
}

function checkWhiteFluorRisk(data) {
  const fluor = (data.fluorescence || '').toLowerCase();
  const color = (data.color || '').toUpperCase();
  const clarity = (data.clarity || '').toUpperCase();

  const hasWhiteFluor = /white/i.test(fluor);
  if (!hasWhiteFluor) return null;

  const isHighColor = ['D','E','F'].includes(color);
  const isStrong = /strong|very strong/i.test(fluor);

  if (isHighColor && isStrong) {
    const hasClouds = (data.keyToSymbols || []).some(function(s) { return /cloud/i.test(s || ''); });
    if (!hasClouds && ['IF','FL','VVS1','VVS2'].includes(clarity)) {
      return { type: 'info', label: 'White Fluor + High Clarity (Acceptable)', detail: color + ' + Strong White Fluor + high clarity no Cloud = white fluorescence minimal impact on top stone', scoreImpact: -2, severity: 'LOW' };
    }
    return { type: 'warning', label: 'White Fluor Oily Risk', detail: color + ' + Strong White Fluor = may produce oily appearance, reduces transparency', scoreImpact: -12, severity: 'MEDIUM' };
  }
  return null;
}

function checkInclusionPattern(data) {
  const keyToSymbols = data.keyToSymbols || [];
  if (!keyToSymbols || keyToSymbols.length < 2) return null;

  const symbolsLower = keyToSymbols.map(function(s) { return (s || '').toLowerCase(); });
  const clarity = (data.clarity || '').toUpperCase();
  const isFancy = isFancyColorExtended(data.color);

  const cloudIndex = symbolsLower.findIndex(function(s) { return s.includes('cloud'); });
  const crystalIndex = symbolsLower.findIndex(function(s) { return s.includes('crystal'); });

  if (cloudIndex === 0 && crystalIndex > 0) {
    const carat = parseFloat(data.carat) || 0;
    const penaltyMult = isFancy ? 0.5 : 1.0;
    if (carat >= 1) {
      return { type: 'warning', label: 'Cloud+Crystal Pattern (scatter+dark spot)', detail: 'Cloud listed first + Crystal = cloud scatters light making crystal inclusion more visible. ' + (carat >= 2 ? '2ct+ more noticeable.' : ''), scoreImpact: Math.round((carat >= 2 ? -8 : -5) * penaltyMult), severity: carat >= 2 ? 'HIGH' : 'MEDIUM' };
    }
  }

  const featherIndex = symbolsLower.findIndex(function(s) { return s.includes('feather'); });
  if (featherIndex >= 0 && cloudIndex >= 0 && clarityIsSI(data.clarity)) {
    const penaltyMult = isFancy ? 0.5 : 1.0;
    return { type: 'warning', label: 'Feather+Cloud Pattern (SI Range)', detail: 'Feather + Cloud both present in SI grade = cloud may distribute along feather crack, affecting durability', scoreImpact: Math.round(-5 * penaltyMult), severity: 'MEDIUM' };
  }
  return null;
}

function checkCaratMagicBonus(data) {
  const carat = parseFloat(data.carat) || 0;
  if (carat <= 0) return null;

  const magicNumbers = [
    { threshold: 10.00, bonus: 30, label: '10.00ct+ (Deca-Carat)' },
    { threshold: 5.00, bonus: 20, label: '5.00ct+ (Five-Carat)' },
    { threshold: 3.00, bonus: 15, label: '3.00ct+ (Three-Carat)' },
    { threshold: 2.00, bonus: 10, label: '2.00ct+ (Two-Carat)' },
    { threshold: 1.00, bonus: 5, label: '1.00ct+ (One-Carat)' },
    { threshold: 0.50, bonus: 2, label: '0.50ct+ (Half-Carat)' }
  ];

  for (let i = 0; i < magicNumbers.length; i++) {
    const mn = magicNumbers[i];
    if (Math.abs(carat - mn.threshold) < 0.02) {
      if (carat >= mn.threshold) {
        return { type: 'info', label: mn.label + ' Magic Number Bonus', detail: carat.toFixed(2) + 'ct reaches ' + mn.threshold + 'ct benchmark (Magic Number), scarcity premium.', scoreImpact: mn.bonus, severity: 'INFO' };
      }
    }
  }
  return null;
}

function checkOriginPremiumExtended(data) {
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + (data.reportNumber || '').toLowerCase();

  if (/botswana/i.test(combinedText)) { return { type: 'info', label: 'Origin: Botswana (African Star)', detail: 'De Beers mine, market premium 2-5%', scoreImpact: 8, severity: 'INFO' }; }
  if (/canada|canadian/i.test(combinedText)) { return { type: 'info', label: 'Origin: Canada (Conflict-Free)', detail: 'Canadian origin, conflict-free guarantee, market premium 3-7%', scoreImpact: 10, severity: 'INFO' }; }
  if (/argyle/i.test(combinedText)) { return { type: 'info', label: 'Origin: Argyle (Top Pink Diamonds)', detail: 'Argyle mine now closed, pink diamonds extremely scarce, auction premium 50-200%', scoreImpact: 25, severity: 'SUPER' }; }
  if (/golconda/i.test(combinedText)) { return { type: 'info', label: 'Origin: Golconda (Legendary Mine)', detail: 'Golconda mine depleted, historically highest purity Type IIa diamond source, auction premium 100-300%', scoreImpact: 30, severity: 'SUPER' }; }
  if (/russia|russian/i.test(combinedText) && !/botswana|canada|argyle|golconda/i.test(combinedText)) { return { type: 'warning', label: 'Origin: Russia (Sanctions Risk)', detail: 'Russian origin subject to sanctions, some markets refuse trade', scoreImpact: -5, severity: 'MEDIUM' }; }
  return null;
}

function checkClarityUpgradePotential(data) {
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const comments = (data.comments || []).join(' ').toLowerCase();
  const combinedText = keyToSymbols + ' ' + comments;
  const clarity = (data.clarity || '').toUpperCase();

  const hasCrystalAtEdge = /crystal.*(?:edge|near\s*girdle|crown|corner)/i.test(combinedText);
  const isWhiteCrystal = /white\s*crystal|colorless\s*crystal/i.test(combinedText);
  const isBlackCrystal = /black\s*crystal|dark\s*crystal/i.test(combinedText);
  const carat = parseFloat(data.carat) || 0;

  if (clarity === 'SI1' && hasCrystalAtEdge && isWhiteCrystal && carat >= 1) {
    const weightLoss = carat * 0.01;
    return { type: 'info', label: 'Clarity Upgrade Potential (SI1 to VS2)', detail: 'White Crystal at Crown/Edge = can be upgraded to VS2 via minor recut (approx -' + weightLoss.toFixed(2) + 'ct). Very high chance of eye-clean after recut.', scoreImpact: 3, severity: 'INFO', estimatedWeightLoss: weightLoss };
  }
  if (clarity === 'SI2' && hasCrystalAtEdge && isBlackCrystal) {
    return { type: 'info', label: 'Potential Recut Target', detail: 'Black Crystal at edge = can be removed via recut, but higher cost and black inclusion may be deeper', scoreImpact: 0, severity: 'INFO' };
  }
  return null;
}

function evaluateFancyShapeCutQuality(data) {
  const shape = (data.shape || '').toLowerCase();
  if (/round/i.test(shape)) return null;

  const polish = (data.polish || '').toLowerCase();
  const symmetry = (data.symmetry || '').toLowerCase();
  const depthPct = parseFloat(data.depthPct);

  let score = 10;
  const deductions = [];

  if (polish === 'excellent') { /* no deduction */ }
  else if (polish === 'very good') { score -= 1; deductions.push('Polish VG (-1)'); }
  else if (polish === 'good') { score -= 3; deductions.push('Polish Good (-3)'); }
  else if (polish === 'fair') { score -= 5; deductions.push('Polish Fair (-5)'); }
  else if (polish === 'poor') { score -= 8; deductions.push('Polish Poor (-8)'); }

  if (symmetry === 'excellent') { /* no deduction */ }
  else if (symmetry === 'very good') { score -= 1; deductions.push('Sym VG (-1)'); }
  else if (symmetry === 'good') { score -= 3; deductions.push('Sym Good (-3)'); }
  else if (symmetry === 'fair') { score -= 6; deductions.push('Sym Fair (-6)'); }
  else if (symmetry === 'poor') { score -= 10; deductions.push('Sym Poor (-10)'); }

  if (typeof depthPct === 'number' && !isNaN(depthPct)) {
    if (depthPct < 53 || depthPct > 75) { score -= 5; deductions.push('Extreme Depth ' + depthPct + '% (-5)'); }
  }

  let grade;
  if (score >= 9) grade = 'Excellent Equivalent';
  else if (score >= 7) grade = 'Very Good Equivalent';
  else if (score >= 5) grade = 'Good Equivalent';
  else if (score >= 3) grade = 'Fair Equivalent';
  else grade = 'Poor Equivalent';

  if (deductions.length === 0) {
    // Even with perfect polish/symmetry, give a baseline assessment
    return { type: 'info', label: 'Fancy Cut Quality: Excellent Equivalent', detail: 'Polish EX + Symmetry EX + proportions within range = equivalent to 3EX cut quality', scoreImpact: 0, severity: 'INFO', equivalentGrade: 'Excellent Equivalent', rawScore: score };
  }

  return { type: 'info', label: 'Fancy Cut Quality: ' + grade, detail: deductions.join(' | ') + ' | Fancy Shape has no official Cut Grade, this is equivalent assessment', scoreImpact: score < 7 ? -((10 - score)) : 0, severity: score < 5 ? 'MEDIUM' : 'INFO', equivalentGrade: grade, rawScore: score };
}

function checkDUndertone(data) {
  const color = (data.color || '').toUpperCase().trim();
  if (color !== 'D') return null;

  const comments = (data.comments || []).join(' ').toLowerCase();
  const keyToSymbols = (data.keyToSymbols || []).join(' ').toLowerCase();
  const combinedText = comments + ' ' + keyToSymbols;

  const isTypeIIa = /type\s*ii\s*a|type\s*iia/i.test(combinedText);
  const hasBrownGraining = /brown.*(grain|tint)|(grain|tint).*brown/i.test(combinedText);

  if (isTypeIIa && hasBrownGraining) {
    return { type: 'warning', label: 'D-Type IIa w/ Brown Graining (HPHT Indicator)', detail: 'D color Type IIa + brown graining = high probability of HPHT treatment removing brown tone. Stone may have slight brown undertone in person.', scoreImpact: -8, severity: 'HIGH' };
  }
  if (isTypeIIa && /type\s*ii\s*a/i.test(combinedText)) {
    return { type: 'info', label: 'D-Type IIa (Verify Undertone)', detail: 'D color Type IIa = highest chemical purity but this type often has very slight brown undertone, difficult to detect by eye. Suggest UV-Vis spectroscopy confirmation.', scoreImpact: 0, severity: 'INFO' };
  }
  return null;
}

// ============================================================================
// SECTION 7: UTILITY FUNCTIONS
// ============================================================================

function clarityIsSI(clarity) {
  if (!clarity) return false;
  return clarity === 'SI1' || clarity === 'SI2';
}

function safeParseNumeric(val) {
  if (val === null || val === undefined) return NaN;
  if (typeof val === 'number') return isFinite(val) ? val : NaN;
  const s = String(val).trim().toLowerCase();
  if (s === 'n/a' || s === 'na' || s === 'not applicable' || s === 'not graded' || s === 'none' || s === '') {
    return NaN;
  }
  return parseFloat(val);
}

function validateGIAReportNumber(reportNum) {
  if (!reportNum) return { valid: false, reason: 'Missing' };
  const cleaned = String(reportNum).replace(/\s/g, '').replace(/^GIA/i, '');
  if (/^\d{10,}$/.test(cleaned)) { return { valid: true, format: 'GIA_MODERN', cleaned: cleaned }; }
  if (/^\d{7,9}$/.test(cleaned)) { return { valid: true, format: 'GIA_LEGACY', cleaned: cleaned, warning: 'Old format certificate (7-9 digits), recommend verifying with GIA' }; }
  if (/^\d{1,6}$/.test(cleaned)) { return { valid: false, reason: 'Certificate number too short (' + cleaned.length + ' digits), possibly not GIA certified', cleaned: cleaned }; }
  return { valid: false, reason: 'Certificate number format does not match GIA standard (10 digits)', cleaned: cleaned };
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function checkBorderlineScore(score, verdict) {
  if (score === 84) return { warning: '84 points = borderline (1 point from STRONG BUY). Re-check every score', type: 'low_strong' };
  if (score === 85) return { warning: '85 points = just entered STRONG BUY. Confirm no missed risks', type: 'low_strong' };
  if (score === 69) return { warning: '69 points = borderline (1 point from BUY zone). Carefully review one improvable condition', type: 'low_buy' };
  if (score === 70) return { warning: '70 points = just entered BUY zone. Confirm all red flags correctly assessed', type: 'low_buy' };
  if (score === 49) return { warning: '49 points = borderline (1 point from CAUTION zone)', type: 'low_caution' };
  if (score === 50) return { warning: '50 points = just entered CAUTION zone', type: 'low_caution' };
  if (score === 29) return { warning: '29 points = borderline (1 point from CONDITIONAL, entering REJECT)', type: 'high_reject' };
  if (score === 30) return { warning: '30 points = just entered CONDITIONAL zone (borderline reject)', type: 'high_reject' };
  return null;
}

function safeScoreImpact(funcName, impact) {
  if (typeof impact !== 'number' || isNaN(impact) || !isFinite(impact)) {
    console.error('[GIA Analyzer] WARNING: ' + funcName + ' returned non-numeric score impact: ' + impact);
    return 0;
  }
  if (impact < -100) return -100;
  if (impact > 100) return 100;
  return impact;
}

const DataGuard = {
  safeArray: function(arr) { return Array.isArray(arr) ? arr.filter(Boolean) : []; },
  safeStr: function(str, fallback) { const fb = fallback !== undefined ? fallback : ''; return typeof str === 'string' ? str.trim() : String(str || fb).trim(); },
  safeNum: function(val, fallback) { const n = parseFloat(val); return isNaN(n) || !isFinite(n) ? (fallback !== undefined ? fallback : NaN) : n; },
  safeJoin: function(arr) { return this.safeArray(arr).join(' ').toLowerCase(); },
  safeField: function(data, field, type) {
    if (!data) return type === 'num' ? NaN : (type === 'arr' ? [] : '');
    const val = data[field];
    if (type === 'arr') return this.safeArray(val);
    if (type === 'num') return this.safeNum(val);
    return this.safeStr(val);
  },
  combinedText: function(data) {
    return this.safeField(data, 'comments', 'arr').join(' ').toLowerCase() + ' ' +
           this.safeField(data, 'keyToSymbols', 'arr').join(' ').toLowerCase();
  },
  hasKeywordInSymbols: function(data, pattern) {
    const symbols = this.safeField(data, 'keyToSymbols', 'arr');
    const re = new RegExp(pattern, 'i');
    return symbols.some(function(s) { return re.test(String(s)); });
  }
};

function classifyFlags(flags) {
  const result = { critical: [], high: [], medium: [], low: [], info: [], super: [] };
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    switch (f.severity) {
      case 'CRITICAL': result.critical.push(f); break;
      case 'HIGH': result.high.push(f); break;
      case 'MEDIUM': result.medium.push(f); break;
      case 'LOW': result.low.push(f); break;
      case 'INFO': case 'SUPER': case 'SUPER_IDEAL': case 'SUPER_FIND': result.info.push(f); break;
      default: result.info.push(f);
    }
  }
  return result;
}

function isFancyColorExtended(color) {
  if (!color) return false;
  const c = color.toUpperCase();
  return c.includes('FANCY') || c.includes('COLOURED') || c.includes('COLORED') ||
    /^(VIVID|INTENSE|DEEP|DARK|LIGHT|FAINT|PALE)\s+[A-Z]+/.test(c);
}

function parseCaratFraction(val) {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return NaN;

  const fractionMatch = val.match(/(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch) {
    return parseFloat(fractionMatch[1]) / parseFloat(fractionMatch[2]);
  }

  const mixedMatch = val.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixedMatch) {
    return parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
  }

  return parseFloat(val);
}

function parseMeasurementsWithUnit(measStr) {
  if (!measStr) return null;

  const mmMatch = String(measStr).match(/(\d+\.?\d*)\s*[xX]\s*(\d+\.?\d*)\s*[xX]\s*(\d+\.?\d*)\s*(?:mm)?/i);
  if (mmMatch) {
    return { length: parseFloat(mmMatch[1]), width: parseFloat(mmMatch[2]), depth: parseFloat(mmMatch[3]), unit: 'mm' };
  }

  const inchMatch = String(measStr).match(/(\d+\.?\d*)\s*[xX]\s*(\d+\.?\d*)\s*[xX]\s*(\d+\.?\d*)\s*(?:in|inch|")?/i);
  if (inchMatch) {
    const inchToMm = 25.4;
    return { length: parseFloat(inchMatch[1]) * inchToMm, width: parseFloat(inchMatch[2]) * inchToMm, depth: parseFloat(inchMatch[3]) * inchToMm, unit: 'in', originalUnit: 'inch' };
  }

  return null;
}

function generateResolutionRecommendation(score, flags, data) {
  const recs = [];
  const carat = parseFloat(data.carat) || 0;
  const clarity = (data.clarity || '').toUpperCase();
  const fluor = (data.fluorescence || '').toLowerCase();

  // STRONG BUY range (85-100)
  if (score >= 85) {
    recs.push('✅ Investment-quality stone. Verify ASET/IdealScope before finalizing.');
    if (carat >= 2) recs.push('Large stone — request independent lab report for insurance.');
    if (/strong/i.test(fluor) && /blue/i.test(fluor))
      recs.push('Strong Blue fluor — confirm no milky appearance in natural daylight.');
    return { recommendations: recs, upgradePossible: true, purchaseAdvice: 'RECOMMENDED', negotiation: 'At or slightly above market is acceptable for this quality.' };
  }

  // BUY range (70-84)
  if (score >= 70) {
    recs.push('Good value stone. Consider negotiating 5-10% below asking.');
    if (/medium|strong/i.test(fluor) && !/blue/i.test(fluor))
      recs.push('Non-blue fluorescence — may affect resale value.');
    if (clarity.startsWith('SI'))
      recs.push('SI clarity — inspect for eye-visible inclusions before purchase.');
    const depthPct = parseFloat(data.depthPct);
    const tablePct = parseFloat(data.tablePct);
    if (!isNaN(depthPct) && !isNaN(tablePct) && (depthPct - tablePct) < 43)
      recs.push('Depth/Table balance suboptimal — seek stones with better proportions for same price.');
    return { recommendations: recs, upgradePossible: true, purchaseAdvice: 'CONSIDER', negotiation: 'Aim for 5-10% below market asking price.' };
  }

  // CAUTION range (50-69)
  if (score >= 50) {
    recs.push('⚠️ Proceed with caution. Multiple risk factors present.');
    if (clarity === 'SI2' || clarity === 'I1')
      recs.push('Low clarity — resale market may be limited.');
    if (carat >= 3 && clarity.startsWith('SI'))
      recs.push('Large SI stone — inclusions more visible at larger sizes. Eye-clean inspection critical.');
    return { recommendations: recs, upgradePossible: false, purchaseAdvice: 'CAUTION', negotiation: 'Only consider at 15-25% below market. Strict return policy required.' };
  }

  // CONDITIONAL range (30-49)
  if (score >= 30) {
    recs.push('❌ Multiple significant issues detected. Seek alternative stones.');
    if (['I1','I2','I3'].includes(clarity))
      recs.push('Included clarity — extremely limited resale market.');
    return { recommendations: recs, upgradePossible: false, purchaseAdvice: 'AVOID', negotiation: 'Not recommended at any price without exceptional circumstances.' };
  }

  // REJECT range (<30)
  recs.push('🔴 Do not purchase. Critical risks outweigh any value.');
  if (carat >= 1)
    recs.push('This stone has been flagged with critical structural or treatment risks. Walk away.');
  return { recommendations: recs, upgradePossible: false, purchaseAdvice: 'REJECT', negotiation: 'Reject. Do not purchase.' };
}

function generateScoreConfidence(data, score) {
  const hasDataCorruption = data._hasDataCorruption === true;
  const hasMissingCritical = !data.tablePct || !data.depthPct || data.tablePct === 'N/A';

  let confidenceMin = score - 5;
  let confidenceMax = score + 5;

  if (hasDataCorruption) {
    confidenceMin = score - 15;
    confidenceMax = score + 10;
  }
  if (hasMissingCritical) {
    confidenceMin = score - 10;
    confidenceMax = score + 10;
  }

  return {
    bestCase: Math.min(100, confidenceMax),
    worstCase: Math.max(0, confidenceMin),
    confidenceLevel: hasDataCorruption ? 'LOW' : (hasMissingCritical ? 'MEDIUM' : 'HIGH')
  };
}

function generateRiskSummary(classifiedFlags) {
  const summary = {
    totalFlags: 0,
    criticalCount: classifiedFlags.critical.length,
    highCount: classifiedFlags.high.length,
    mediumCount: classifiedFlags.medium.length,
    totalRiskScore: 0,
    topRisks: [],
    recommendation: ''
  };

  summary.totalFlags = classifiedFlags.critical.length + classifiedFlags.high.length +
    classifiedFlags.medium.length + classifiedFlags.low.length + classifiedFlags.info.length;

  for (let i = 0; i < classifiedFlags.critical.length; i++) {
    const si = classifiedFlags.critical[i].scoreImpact;
    summary.totalRiskScore += (si != null && !isNaN(si) ? si : -25);
  }
  for (let j = 0; j < classifiedFlags.high.length; j++) {
    const si = classifiedFlags.high[j].scoreImpact;
    summary.totalRiskScore += (si != null && !isNaN(si) ? si : -15);
  }
  for (let k = 0; k < classifiedFlags.medium.length; k++) {
    const si = classifiedFlags.medium[k].scoreImpact;
    summary.totalRiskScore += (si != null && !isNaN(si) ? si : -5);
  }

  const allRisks = classifiedFlags.critical.concat(classifiedFlags.high, classifiedFlags.medium);
  allRisks.sort(function(a, b) { return (a.scoreImpact || 0) - (b.scoreImpact || 0); });
  summary.topRisks = allRisks.slice(0, 3).map(function(f) {
    return { label: f.label || '', detail: f.detail || '', scoreImpact: f.scoreImpact || 0 };
  });

  if (classifiedFlags.critical.length > 0) {
    summary.recommendation = 'Fatal risks present, strongly recommend rejecting';
  } else if (classifiedFlags.high.length >= 3) {
    summary.recommendation = 'Multiple high risks, only consider with significant discount';
  } else if (classifiedFlags.high.length >= 1) {
    summary.recommendation = 'High risks present, confirm all red flags with seller before considering';
  } else if (classifiedFlags.medium.length >= 3) {
    summary.recommendation = 'Multiple medium risks, suggest purchasing at 85-90% of market price';
  } else {
    summary.recommendation = 'Risks are manageable, can consider normally';
  }

  return summary;
}

function getPortraitCutResult(data) {
  if (data._portraitCutResult) return data._portraitCutResult;
  const shape = (data.shape || '').toLowerCase();
  const depthPct = parseFloat(data.depthPct) || 0;
  const isThinDesignerShape = shape.includes('triangular') || shape.includes('trillion') ||
    shape.includes('trilliant') || shape.includes('pear') ||
    shape.includes('marquise') || shape.includes('hexagonal') ||
    shape.includes('octagonal') || shape.includes('kite') ||
    shape.includes('shield') || shape.includes('portrait') ||
    shape.includes('rose') || shape.includes('briolette') ||
    shape.includes('modified');
  const result = {
    isPortraitCut: isThinDesignerShape && depthPct < 38 && depthPct > 0,
    detail: data.shape + ' depth ' + depthPct + '% ' + (depthPct < 38 && depthPct > 0 ? '< 38% = Portrait Cut (designer spec, not defect)' : '>= 38% = normal depth range')
  };
  data._portraitCutResult = result;
  return result;
}

function evaluateCrownPavilionBalance(data) {
  const shape = (data.shape || '').toLowerCase();
  const isRound = /round/i.test(shape) && !/briolet|rose|portrait|portuguese|candlelight/i.test(shape);
  if (!isRound) return null;

  const crownAngle = parseFloat(data.crownAngle);
  const pavilionAngle = parseFloat(data.pavilionAngle);
  const tablePct = parseFloat(data.tablePct);
  const depthPct = parseFloat(data.depthPct);

  let crownHeightPct = null, pavilionDepthPct = null;

  if (!isNaN(crownAngle) && !isNaN(pavilionAngle) && !isNaN(tablePct)) {
    const crownRad = crownAngle * Math.PI / 180;
    crownHeightPct = (1 - tablePct / 100) * Math.tan(crownRad) / 2 * 100;

    const pavilionRad = pavilionAngle * Math.PI / 180;
    pavilionDepthPct = 0.5 * Math.tan(pavilionRad) * 100;
    if (!isFinite(crownHeightPct) || !isFinite(pavilionDepthPct)) return null;
  }

  if (!crownHeightPct || !pavilionDepthPct || isNaN(crownHeightPct) || isNaN(pavilionDepthPct)) {
    if (!isNaN(depthPct) && !isNaN(tablePct)) {
      const girdleEstimate = 2.5;
      const remaining = depthPct - (tablePct / 100) - girdleEstimate;
      crownHeightPct = remaining * 0.30;
      pavilionDepthPct = remaining * 0.70;
    } else {
      return null;
    }
  }

  const idealCH = { min: 12.5, max: 17.0, ideal: 15.0 };
  const idealPD = { min: 41.5, max: 44.5, ideal: 43.0 };

  let flags = [];
  let scoreImpact = 0;

  if (crownHeightPct < idealCH.min) {
    flags.push('Crown Height ' + crownHeightPct.toFixed(1) + '% < ' + idealCH.min + '% (too shallow, weak fire)');
    scoreImpact -= 8;
  } else if (crownHeightPct > idealCH.max) {
    flags.push('Crown Height ' + crownHeightPct.toFixed(1) + '% > ' + idealCH.max + '% (too deep, light leakage)');
    scoreImpact -= 8;
  } else if (Math.abs(crownHeightPct - idealCH.ideal) <= 1.0) {
    flags.push('Crown Height ' + crownHeightPct.toFixed(1) + '% = Ideal');
    scoreImpact += 3;
  }

  if (pavilionDepthPct < idealPD.min) {
    flags.push('Pavilion Depth ' + pavilionDepthPct.toFixed(1) + '% < ' + idealPD.min + '% (too shallow, fish-eye risk)');
    scoreImpact -= 10;
  } else if (pavilionDepthPct > idealPD.max) {
    flags.push('Pavilion Depth ' + pavilionDepthPct.toFixed(1) + '% > ' + idealPD.max + '% (too deep, nailhead risk)');
    scoreImpact -= 10;
  } else if (Math.abs(pavilionDepthPct - idealPD.ideal) <= 0.5) {
    flags.push('Pavilion Depth ' + pavilionDepthPct.toFixed(1) + '% = Ideal');
    scoreImpact += 5;
  }

  const balanceRatio = pavilionDepthPct / Math.max(0.001, crownHeightPct);
  if (balanceRatio < 2.2) {
    flags.push('Crown-Pavilion ratio ' + balanceRatio.toFixed(1) + ':1 imbalanced (pavilion too shallow relative to crown)');
    scoreImpact -= 5;
  } else if (balanceRatio > 3.5) {
    flags.push('Crown-Pavilion ratio ' + balanceRatio.toFixed(1) + ':1 imbalanced (crown too shallow)');
    scoreImpact -= 5;
  } else if (flags.length > 0 && flags.every(function(f) { return f.includes('Ideal'); })) {
    flags.push('Crown-Pavilion ratio ' + balanceRatio.toFixed(1) + ':1 = Perfect Balance');
    scoreImpact += 2;
  }

  if (flags.length === 0) return null;

  const isIdeal = scoreImpact > 0;
  return {
    type: isIdeal ? 'info' : 'warning',
    label: isIdeal ? 'Crown-Pavilion Balance: Ideal' : 'Crown-Pavilion Balance Issue',
    detail: flags.join(' | '),
    scoreImpact: scoreImpact,
    severity: isIdeal ? 'INFO' : (scoreImpact <= -10 ? 'HIGH' : 'MEDIUM'),
    crownHeightPct: crownHeightPct,
    pavilionDepthPct: pavilionDepthPct,
    balanceRatio: balanceRatio
  };
}

function getVerdict(score, flags) {
  if (!flags) flags = [];
  let hasCriticalDepth = false, hasMilkyRisk = false, hasFraudLock = false;

  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const flagText = (f.label || '');
    if (!hasCriticalDepth && (flagText.includes('CRITICAL: Too Deep') ||
        flagText.includes('CRITICAL: Severe Windowing') ||
        flagText.includes('CRITICAL: Weight Hidden') ||
        flagText.includes('Probable Data Error'))) {
      hasCriticalDepth = true;
    }
    if (!hasMilkyRisk && (flagText.includes('MILKY') || flagText.includes('HAZY') ||
        flagText.includes('High Milky') || flagText.includes('Oily') || flagText.includes('Blurry'))) {
      hasMilkyRisk = true;
    }
    if (!hasFraudLock && flagText.includes('FRAUD LOCK')) {
      hasFraudLock = true;
    }
    if (hasCriticalDepth && hasMilkyRisk && hasFraudLock) break;
  }

  let effectiveScore = score;
  if (hasFraudLock) {
    return { grade: 'REJECT', emoji: 'R', label: 'REJECT', verdictText: 'REJECT', color: 0xE00000 };
  }
  if (effectiveScore >= 85) return { grade: 'STRONG_BUY', emoji: 'S', label: 'STRONG BUY', verdictText: 'STRONG BUY', color: 0x00E000 };
  if (effectiveScore >= 70) return { grade: 'BUY', emoji: 'B', label: 'BUY', verdictText: 'BUY', color: 0x0099FF };
  if (effectiveScore >= 50) return { grade: 'CAUTION', emoji: 'C', label: 'CAUTION', verdictText: 'CAUTION', color: 0xFFAA00 };
  if (effectiveScore >= 30) return { grade: 'CONDITIONAL', emoji: '?', label: 'CONDITIONAL', verdictText: 'CONDITIONAL', color: 0xFF6600 };
  return { grade: 'REJECT', emoji: 'R', label: 'REJECT', verdictText: 'REJECT', color: 0xE00000 };
}
// ============================================================================
// SECTION 6: SCORING SYSTEM (v17.1.0)
// ============================================================================

function calculateClawScore(cert) {
  let rawData = cert.data || cert;
  let humanInspection = cert.humanInspection || null;
  let data = {};
  data.shape = rawData.shape || '';
  data.color = rawData.color || '';
  data.clarity = rawData.clarity || '';
  data.carat = rawData.carat || '';
  data.depthPct = rawData.depthPct || '';
  data.tablePct = rawData.tablePct || '';
  data.crownAngle = rawData.crownAngle || '';
  data.pavilionAngle = rawData.pavilionAngle || '';
  data.girdle = rawData.girdle || '';
  data.culet = rawData.culet || '';
  data.polish = rawData.polish || '';
  data.symmetry = rawData.symmetry || '';
  data.fluorescence = rawData.fluorescence || '';
  data.comments = DataGuard.safeArray(rawData.comments);
  data.keyToSymbols = DataGuard.safeArray(rawData.keyToSymbols);
  data.inscription = rawData.inscription || '';
  data.reportNumber = rawData.reportNumber || '';
  data.measurements = rawData.measurements || '';
  data.reportType = rawData.reportType || '';
  data.gradingLab = rawData.gradingLab || '';
  data.cutGrade = rawData.cutGrade || '';
  data._hasDataCorruption = rawData._hasDataCorruption || false;
  data.reportDate = rawData.reportDate || '';
  data.gradingDate = rawData.gradingDate || '';
  data.issueDate = rawData.issueDate || '';
  data.origin = rawData.origin || '';
  data.laserInscription = rawData.laserInscription || '';
  data.girdleCondition = rawData.girdleCondition || '';

  let flags = [];
  let score = 100;
  let hasDepthCritical = false;
  let hasMilkyShortCircuit = false;
  let hasFraudLockFlag = false;
  let hasDataCorruptionScoreCap = false;

  // Data quality check: flag missing/invalid critical fields
  var isShapeMissing = !data.shape || data.shape === '' || data.shape === 'N/A';
  var isColorInvalid = !data.color || data.color === '' || /^grade$/i.test(data.color.trim()) || data.color === 'N/A';
  var isCaratInvalid = !data.carat || data.carat === '' || isNaN(parseFloat(data.carat)) || parseFloat(data.carat) <= 0;
  if (isShapeMissing) {
    flags.push({ type: 'warning', label: 'Data Quality: Shape Missing', detail: 'Shape field is empty — using default Round Brilliant assumptions. Verify certificate OCR output.', scoreImpact: -5, severity: 'MEDIUM' });
  }
  if (isColorInvalid) {
    flags.push({ type: 'critical', label: 'Data Quality: Color Invalid', detail: 'Color field is missing or unreadable ("' + (data.color || 'empty') + '"). Scoring reliability severely compromised.', scoreImpact: -15, severity: 'CRITICAL' });
    hasDataCorruptionScoreCap = true;
  }
  if (isCaratInvalid) {
    flags.push({ type: 'critical', label: 'Data Quality: Carat Invalid', detail: 'Carat field is missing, zero, or negative ("' + (data.carat || 'empty') + '"). Scoring reliability severely compromised.', scoreImpact: -15, severity: 'CRITICAL' });
    hasDataCorruptionScoreCap = true;
  }

  const colorUpper = (data.color || '').toUpperCase().trim();
  const clarityUpper = (data.clarity || '').toUpperCase().trim();
  let caratNum = parseFloat(data.carat) || 0;
  let fancyCaratMult = 1.0;
  const depthPctNum = parseFloat(data.depthPct);
  const tablePctNum = parseFloat(data.tablePct);
  const shapeLower = (data.shape || '').toLowerCase();

  const isRound = /round/i.test(shapeLower) && !/briolet|rose|portrait|portuguese|candlelight/i.test(shapeLower);
  const isFancyColor = isFancyColorExtended(data.color);

  const portraitResult = getPortraitCutResult(data);
  const isPortraitCut = portraitResult.isPortraitCut;

  // ================================================================
  // QUALITY TIER SYSTEM (Non-Linear Model)
  // Determines defect severity multiplier and bonus ceiling
  // ================================================================
  const qualityTier = (function getQualityTier(color, clarity, isFancy, carat) {
    let tier;
    if (isFancy) {
      if (color.includes('VIVID') || color.includes('INTENSE')) tier = 'INVESTMENT';
      else if (color.includes('DEEP')) tier = 'PREMIUM';
      else tier = 'COMMERCIAL';
      // Fancy rarity auto-upgrade: premium fancy colors get one tier boost
      const colorName = DIAMOND_TYPE.getFancyColorName(color);
      if (colorName && ['RED','BLUE','GREEN','VIOLET','CHAMELEON','PINK'].includes(colorName.toUpperCase())) {
        if (tier === 'PREMIUM') tier = 'INVESTMENT';
        if (tier === 'COMMERCIAL') tier = 'PREMIUM';
      }
    } else {
      const c = color.toUpperCase();
      const cl = clarity.toUpperCase();
      if (['D','E','F'].includes(c) && ['FL','IF','VVS1','VVS2'].includes(cl)) tier = 'INVESTMENT';
      else if (['D','E','F','G','H','I'].includes(c) && ['VVS1','VVS2','VS1','VS2'].includes(cl)) tier = 'PREMIUM';
      else if (['J','K','L','M'].includes(c)) tier = 'COMMERCIAL';
      else if (cl === 'SI1' || cl === 'SI2') tier = 'COMMERCIAL';
      else tier = 'BUDGET';
    }
    // Carat weight tier adjustment: large stones get tier boost
    // Mega-stones (50ct+): rarity of size overrides color/clarity tier limits
    const TIER_ORDER = ['BUDGET', 'COMMERCIAL', 'PREMIUM', 'INVESTMENT'];
    const tierIdx = TIER_ORDER.indexOf(tier);
    if (carat >= 50) { tier = 'INVESTMENT'; }                                   // 50ct+: always investment-grade
    else if (carat >= 10 && tierIdx < 3) tier = TIER_ORDER[Math.min(3, tierIdx + 2)];     // 10ct+: +2 tiers
    else if (carat >= 5 && tierIdx < 3) tier = TIER_ORDER[Math.min(3, tierIdx + 1)];  // 5ct+: +1 tier
    else if (carat >= 3 && tierIdx < 3 && tier !== 'INVESTMENT' && tier !== 'PREMIUM')
      tier = TIER_ORDER[Math.min(3, tierIdx + 1)]; // 3ct+ COMMERCIAL/BUDGET → +1

    return tier;
  })(data.color, data.clarity, isFancyColor, caratNum);

  const TIER_CONFIG = {
    INVESTMENT:  { defectMult: 1.5, bonusMult: 1.0, floor: 70, label: 'Investment Grade' },
    PREMIUM:     { defectMult: 1.2, bonusMult: 1.0, floor: 55, label: 'Premium Grade' },
    COMMERCIAL:  { defectMult: 0.8, bonusMult: 0.6, floor: 25, label: 'Commercial Grade' },
    BUDGET:      { defectMult: 0.5, bonusMult: 0.3, floor: 5,  label: 'Budget Grade' }
  };
  const tierCfg = TIER_CONFIG[qualityTier];

  function makeScoringResult(scoreVal, flagsArr) {
    const verdict = getVerdict(scoreVal, flagsArr);
    const classified = classifyFlags(deduplicateFlags(flagsArr));
    const riskSummary = generateRiskSummary(classified);
    const purchaseRec = generateResolutionRecommendation(scoreVal, flagsArr, data);

    // === DATA CONFIDENCE: Cert-Only Assessment Limitations ===
    // Score confidence decreases when relying solely on certificate data
    // without visual verification (photos, ASET, 360° video)
    let dataConfidence = 100;
    const confidenceFlags = [];

    // Step 1: Data completeness checks
    var hasCrownAngle = data.crownAngle && data.crownAngle !== 'N/A' && !isNaN(parseFloat(data.crownAngle));
    var hasPavilionAngle = data.pavilionAngle && data.pavilionAngle !== 'N/A' && !isNaN(parseFloat(data.pavilionAngle));
    var hasDepth = data.depthPct && data.depthPct !== 'N/A' && !isNaN(parseFloat(data.depthPct));
    var hasTable = data.tablePct && data.tablePct !== 'N/A' && !isNaN(parseFloat(data.tablePct));
    var hasGirdleCondition = data.girdleCondition && data.girdleCondition !== 'N/A';
    var hasReportDate = (data.reportDate || data.gradingDate || data.issueDate) ? true : false;
    var hasInscription = data.laserInscription || data.inscription;
    var isRoundShape = /round/i.test(data.shape || '') && !/briolet|rose|portrait|candlelight/i.test(data.shape || '');
    var isGIALab = !data.gradingLab || /GIA/i.test(data.gradingLab || '') || /GIA/i.test(data.reportNumber || '');

    // Core dimensions: Depth/Table
    if (!hasDepth) { dataConfidence -= 10; confidenceFlags.push('Depth data missing'); }
    if (!hasTable) { dataConfidence -= 10; confidenceFlags.push('Table data missing'); }

    // Crown/Pavilion angles: differentiate Round vs Fancy
    if (!hasCrownAngle && isRoundShape) { dataConfidence -= 7; confidenceFlags.push('Crown angle not available (Round cut)'); }
    else if (!hasCrownAngle && !isRoundShape) { dataConfidence -= 3; confidenceFlags.push('Crown angle not available (Fancy shape — normal)'); }
    if (!hasPavilionAngle && isRoundShape) { dataConfidence -= 7; confidenceFlags.push('Pavilion angle not available (Round cut)'); }
    else if (!hasPavilionAngle && !isRoundShape) { dataConfidence -= 3; confidenceFlags.push('Pavilion angle not available (Fancy shape — normal)'); }

    // Optical performance: varied penalty by data richness
    if (hasCrownAngle && hasPavilionAngle && hasDepth && hasTable) {
      dataConfidence -= 4; confidenceFlags.push('Optical performance inferred from proportions (no ASET/IdealScope data)');
    } else if (hasDepth && hasTable) {
      dataConfidence -= 8; confidenceFlags.push('Optical performance inferred from proportions (no ASET data, angles missing)');
    } else {
      dataConfidence -= 14; confidenceFlags.push('Optical performance uncertain (missing key proportion data)');
    }

    // Girdle/inscription/cert-date as confidence boosters
    if (!hasGirdleCondition) { dataConfidence -= 3; confidenceFlags.push('Girdle condition not specified'); }
    if (!hasReportDate) { dataConfidence -= 5; confidenceFlags.push('Certificate date unknown — era/age cannot be checked'); }
    if (!hasInscription) { dataConfidence -= 3; confidenceFlags.push('No laser inscription data — physical verification recommended'); }
    if (!isGIALab) { dataConfidence -= 12; confidenceFlags.push('Non-GIA laboratory — grading standard may differ'); }

    // Eye-clean assessment from cert alone is unreliable for SI grades
    if (clarityIsSI(data.clarity)) {
      dataConfidence -= 10;
      confidenceFlags.push('SI clarity: eye-clean status cannot be confirmed from cert alone — request 10× video');
    } else if (['I1','I2','I3'].includes(data.clarity || '')) {
      dataConfidence -= 15;
      confidenceFlags.push('I-grade clarity: heavy inclusions present — visual inspection mandatory');
    }

    // Color in real light vs lab light
    if (['D','E','F'].includes((data.color || '').toUpperCase()) && /strong/i.test(data.fluorescence || '')) {
      dataConfidence -= 5;
      confidenceFlags.push('High color + Strong fluor: milky risk needs visual confirmation');
    }

    // Data corruption from OCR
    if (data._hasDataCorruption) {
      dataConfidence -= 20;
      confidenceFlags.push('Data corruption detected — OCR errors may affect accuracy');
    }

    // Inclusions: position/color/size are described but not visible
    if (data.keyToSymbols && data.keyToSymbols.length > 0) {
      dataConfidence -= 5;
      confidenceFlags.push('Inclusion visibility cannot be determined from cert plot alone');
    }

    // Step 2: Score-modulated confidence cap
    // LOW score stones can't have HIGH confidence — the data may be complete but
    // the stone has severe quality issues that require visual confirmation
    if (scoreVal <= 40) { dataConfidence = Math.min(dataConfidence, 70); }
    else if (scoreVal <= 55) { dataConfidence = Math.min(dataConfidence, 79); }

    dataConfidence = Math.max(25, Math.min(100, dataConfidence));
    const confidenceLevel = dataConfidence >= 85 ? 'HIGH' : (dataConfidence >= 65 ? 'MEDIUM' : 'LOW');

    return {
      score: clampScore(scoreVal), verdict, flags: deduplicateFlags(flagsArr),
      riskSummary, isPortraitCut, qualityTier: tierCfg.label,
      purchaseAdvice: purchaseRec,
      dataConfidence: { score: dataConfidence, level: confidenceLevel, flags: confidenceFlags }
    };
  }

  // --- Check for critical treatment (short-circuit to score 0) ---
  const laserDrillResult = checkLaserDrillEnhanced(data);
  if (laserDrillResult) {
    flags.push(laserDrillResult);
    score += safeScoreImpact('checkLaserDrillEnhanced', laserDrillResult.scoreImpact);
    if (laserDrillResult.scoreImpact <= -100) {
      return makeScoringResult(clampScore(0), flags);
    }
  }

  // --- Check Haze Matrix (may short-circuit) ---
  const hazeResult = checkHazeMatrix(data, flags);
  if (hazeResult) {
    flags.push(hazeResult);
    if (hazeResult.isShortCircuit) {
      hasMilkyShortCircuit = true;
      score += safeScoreImpact('checkHazeMatrix', hazeResult.scoreImpact);
    }
  }

  if (hasMilkyShortCircuit) {
    score = Math.min(score, 69);
    return makeScoringResult(score, flags);
  }

  // --- Antique Cut Exception (partial optical exemption) ---
  const antiqueResult = checkAntiqueCutException(data);
  if (antiqueResult) {
    flags.push(antiqueResult);
    score += safeScoreImpact('checkAntiqueCutException', antiqueResult.scoreImpact);
  }

  // --- COLOR: base penalty ---
  const colorIndex = DIAMOND_TYPE.WHITE_COLORS.indexOf(colorUpper);
  if (!isFancyColor && colorIndex >= 0) {
    if (colorIndex >= 14) { score -= 25; flags.push({ type: 'critical', label: 'Low Color R-Z', detail: colorUpper + ' color = lowest market tier', scoreImpact: -25, severity: 'CRITICAL' }); }
    else if (colorIndex >= 10) { score -= 20; flags.push({ type: 'warning', label: 'Very Low Color N-Q', detail: colorUpper + ' color = very yellow tint', scoreImpact: -20, severity: 'HIGH' }); }
    else if (colorIndex >= 6) { score -= 15; flags.push({ type: 'warning', label: 'Low Color J-M', detail: colorUpper + ' color = noticeable yellow tint', scoreImpact: -15, severity: 'HIGH' }); }
    else if (colorIndex >= 3) { score -= 10; flags.push({ type: 'info', label: 'Near Colorless G-I', detail: colorUpper + ' color = near colorless, good value', scoreImpact: -10, severity: 'LOW' }); }
    else if (colorIndex >= 0) { score -= 5; flags.push({ type: 'info', label: 'Colorless D-F', detail: colorUpper + ' color = colorless range', scoreImpact: -5, severity: 'INFO' }); }
  }

  // --- FANCY COLOR: Color-First Logic (independent base score system) ---
  // Unlike white diamonds (subtractive from 100), fancy colors start from a BASE
  // determined by color intensity, then add for other qualities.
  if (isFancyColor) {
    const FANCY_BASE = { 'FANCY VIVID': 92, 'FANCY INTENSE': 82, 'FANCY DEEP': 73, 'FANCY DARK': 30, 'FANCY LIGHT': 55, 'FANCY': 68, 'FAINT': 35, 'VERY LIGHT': 40, 'LIGHT': 45, 'PALE': 32 };
    let fancyBase = 68; // default = FANCY
    for (const [key, val] of Object.entries(FANCY_BASE)) {
      if (colorUpper.includes(key)) { fancyBase = val; break; }
    }
    score = fancyBase;
    flags.push({ type: 'info', label: 'Color-First Base: ' + colorUpper, detail: 'Fancy color starts from base ' + fancyBase + ' (color intensity determines floor). Non-color qualities add from here.', scoreImpact: 0, severity: 'INFO' });

    // Rarity bonus
    const rarityColor = DIAMOND_TYPE.getFancyColorName(data.color);
    if (rarityColor && FANCY_RARITY_RULE[rarityColor.toUpperCase()]) {
      const rarityBonus = FANCY_RARITY_RULE[rarityColor.toUpperCase()].bonus;
      score += rarityBonus;
      flags.push({ type: 'info', label: FANCY_RARITY_RULE[rarityColor.toUpperCase()].label, detail: rarityColor + ' rarity premium: +' + rarityBonus, scoreImpact: rarityBonus, severity: 'SUPER' });
    }

    // FANCY-ADAPTED DEPTH: wider tolerance for color retention
    if (!isPortraitCut && depthPctNum && !isNaN(depthPctNum)) {
      if (depthPctNum > 78) { score -= 20; flags.push({ type: 'critical', label: 'Fancy Depth Extremely Deep', detail: 'Depth ' + depthPctNum.toFixed(1) + '% > 78% — color becomes black, fire lost', scoreImpact: -20, severity: 'CRITICAL' }); }
      else if (depthPctNum > 72 && !colorUpper.includes('VIVID') && !colorUpper.includes('INTENSE')) {
        score += 5; flags.push({ type: 'info', label: 'Fancy Depth Bonus (Color Retention)', detail: 'Depth ' + depthPctNum.toFixed(1) + '% — deep cut enhances visual saturation for lighter fancy colors', scoreImpact: 5, severity: 'INFO' });
      }
      else if (depthPctNum > 72) { score -= 5; flags.push({ type: 'warning', label: 'Fancy Depth Too Deep (Intense Color)', detail: 'Depth ' + depthPctNum.toFixed(1) + '% — already intense color, deep cut adds weight without benefit', scoreImpact: -5, severity: 'MEDIUM' }); }
      else if (depthPctNum >= 68 && depthPctNum <= 72) { score += 1; } // Acceptable deep
      else if (depthPctNum >= 62 && depthPctNum <= 68) { score += 3; flags.push({ type: 'info', label: 'Fancy Depth: Ideal', detail: 'Depth ' + depthPctNum.toFixed(1) + '% = ideal for fancy color brilliance + saturation', scoreImpact: 3, severity: 'INFO' }); }
      else if (depthPctNum >= 55 && depthPctNum < 62) { score -= 5; flags.push({ type: 'warning', label: 'Fancy Depth Slightly Shallow', detail: 'Depth ' + depthPctNum.toFixed(1) + '% = somewhat shallow, mild windowing possible', scoreImpact: -5, severity: 'MEDIUM' }); }
      else if (depthPctNum >= 50 && depthPctNum < 55) { score -= 10; flags.push({ type: 'warning', label: 'Fancy Depth Shallow', detail: 'Depth ' + depthPctNum.toFixed(1) + '% = noticeable windowing, color appears washed out', scoreImpact: -10, severity: 'HIGH' }); }
      else if (depthPctNum < 50) { score -= 15; flags.push({ type: 'critical', label: 'Fancy Depth Too Shallow', detail: 'Depth ' + depthPctNum.toFixed(1) + '% < 50% — excessive windowing even for fancy color', scoreImpact: -15, severity: 'CRITICAL' }); }
    } else if (!isPortraitCut && (!depthPctNum || isNaN(depthPctNum))) {
      score -= 3;
      flags.push({ type: 'info', label: 'Fancy Depth Data Missing', detail: 'Depth not available — optical assessment limited.', scoreImpact: -3, severity: 'LOW' });
    }

    // FANCY CARAT MULTIPLIER: intensity-graded (uses FANCY_COLOR_MODIFIER factor)
    // Look up intensity factor, scaled to carat bonus multiplier range
    let fancyModifierFactor = 1.0;
    for (const [key, mod] of Object.entries(FANCY_COLOR_MODIFIER)) {
      if (colorUpper.includes(key)) { fancyModifierFactor = mod.factor; break; }
    }
    fancyCaratMult = Math.min(1.0, Math.max(0.3, fancyModifierFactor * 0.6));

    // FANCY-ADAPTED CLARITY: structural risk only, SI not fatal
    if (clarityUpper === 'SI1') {
      const hasStructuralDanger = DataGuard.hasKeywordInSymbols(data, 'cavity|knot|chip');
      if (hasStructuralDanger) {
        score -= 30; flags.push({ type: 'critical', label: 'Fancy SI1 + Structural Defect', detail: 'SI1 + Cavity/Knot/Chip on fancy color = setting integrity compromised. Structural risk overrides color value.', scoreImpact: -30, severity: 'CRITICAL' });
      } else {
        score -= 5; flags.push({ type: 'info', label: 'Fancy SI1 (Color-First Tolerance)', detail: 'SI1 on fancy color — clarity tolerance applied. Color dominates value for fancy diamonds.', scoreImpact: -5, severity: 'LOW' });
      }
    } else if (clarityUpper === 'SI2') {
      const hasStructuralDanger2 = DataGuard.hasKeywordInSymbols(data, 'cavity|knot|chip');
      if (hasStructuralDanger2) {
        score -= 40; flags.push({ type: 'critical', label: 'Fancy SI2 + Structural Defect (REJECT)', detail: 'SI2 + Cavity/Knot/Chip on fancy color — setting killer. Reject regardless of color.', scoreImpact: -40, severity: 'CRITICAL' });
      } else {
        score -= 10; flags.push({ type: 'info', label: 'Fancy SI2 (Color-First Tolerance)', detail: 'SI2 on fancy color — higher tolerance. Color is 90% of fancy diamond value.', scoreImpact: -10, severity: 'LOW' });
      }
    } else if (clarityUpper === 'I1') {
      score -= 20;
      flags.push({ type: 'warning', label: 'Fancy I1 (Color-First Tolerance)', detail: 'I1 on fancy color — clarity tolerance applied but structural integrity concerns remain', scoreImpact: -20, severity: 'MEDIUM' });
    } else if (clarityUpper === 'I2') {
      score -= 35;
      flags.push({ type: 'warning', label: 'Fancy I2 (Severe Clarity Issue)', detail: 'I2 on fancy color — significant inclusions. Color value severely compromised by clarity.', scoreImpact: -35, severity: 'HIGH' });
    } else if (clarityUpper === 'I3') {
      score -= 50;
      flags.push({ type: 'critical', label: 'Fancy I3 (Industrial Grade)', detail: 'I3 on fancy color — industrial grade clarity. Color value nearly nullified.', scoreImpact: -50, severity: 'CRITICAL' });
    }
  }

  // Re-apply haze penalty for fancy colors (score was reset by fancyBase)
  if (isFancyColor && hazeResult && !hazeResult.isShortCircuit) {
    score += safeScoreImpact('checkHazeMatrix', hazeResult.scoreImpact);
  }

  // --- FLUORESCENCE: base check ---
  const fluorColorResult = checkFluorescenceColor(data);
  if (fluorColorResult) {
    flags.push(fluorColorResult);
    score += safeScoreImpact('checkFluorescenceColor', fluorColorResult.scoreImpact);
  }

  // --- FLUORESCENCE EVENNESS ---
  const fluorEvennessResult = checkFluorescenceEvenness(data);
  if (fluorEvennessResult) {
    flags.push(fluorEvennessResult);
    score += safeScoreImpact('checkFluorescenceEvenness', fluorEvennessResult.scoreImpact);
  }

  // --- FLUORESCENCE OFFSET (compensation for low color + blue fluor) ---
  const fluorOffset = checkFluorescenceOffset(data);
  if (fluorOffset) {
    flags.push(fluorOffset);
    score += safeScoreImpact('checkFluorescenceOffset', fluorOffset.scoreImpact);
  }

  // --- YELLOW FLUOR IMPACT ---
  const yfiResult = checkYellowFluorImpact(data);
  if (yfiResult) {
    flags.push(yfiResult);
    score += safeScoreImpact('checkYellowFluorImpact', yfiResult.scoreImpact);
  }

  // --- WHITE FLUOR RISK ---
  const wfrResult = checkWhiteFluorRisk(data);
  if (wfrResult) {
    flags.push(wfrResult);
    score += safeScoreImpact('checkWhiteFluorRisk', wfrResult.scoreImpact);
  }

  // --- FLUOR CLARITY MASKING ---
  const fcmResult = checkFluorClarityMasking(data);
  if (fcmResult) {
    flags.push(fcmResult);
    score += safeScoreImpact('checkFluorClarityMasking', fcmResult.scoreImpact);
  }

  // --- CLARITY: base penalty (Fancy uses Color-First tolerance above, skip here) ---
  if (!isFancyColor) {
    const clarityIndex = CLARITY_RANK.getIndex(clarityUpper);
    if (clarityIndex >= 0) {
      const clarityPenalties = [0, 0, -3, -5, -8, -12, -20, -30, -42, -55, -65];
      const cp = Math.round((clarityPenalties[clarityIndex] || 0));
      if (cp < 0) {
        score += cp;
        flags.push({ type: clarityIndex >= 8 ? 'critical' : 'warning', label: 'Clarity Base Penalty', detail: clarityUpper + ' clarity = base penalty', scoreImpact: cp, severity: clarityIndex >= 8 ? 'CRITICAL' : (clarityIndex >= 6 ? 'HIGH' : 'MEDIUM') });
      }
    }
  }

  // --- CARAT: micro-stone multiplicative penalty + negative carat guard ---
  if (caratNum <= 0) {
    flags.push({ type: 'critical', label: 'Invalid Carat Weight', detail: 'Carat weight is zero or negative (' + caratNum + ') — possible data corruption', scoreImpact: -15, severity: 'CRITICAL' });
    caratNum = 0;
    // Corrupt carat data severely limits scoring potential
    hasDataCorruptionScoreCap = true;
  }
  if (caratNum < 0.10 && caratNum > 0) {
    // Micro-stones: multiplicative penalty (exponential value decay below 0.10ct)
    // 0.09ct → 0.93x, 0.05ct → 0.65x, 0.02ct → 0.44x
    const microMult = 0.3 + caratNum * 7;
    const oldScore = score;
    score = Math.round(score * microMult);
    flags.push({ type: 'warning', label: 'Micro-Stone (<0.10ct)', detail: 'Diamonds below 0.10ct have exponentially reduced market value. Score scaled to ' + Math.round(microMult * 100) + '%.', scoreImpact: score - oldScore, severity: 'HIGH' });
  }
  // Carat bonus scaled by clarity (Fancy uses intensity-graded multiplier above)
  const caratClarityMult = isFancyColor ? fancyCaratMult // Fancy: intensity-graded
    : (['FL','IF','VVS1','VVS2','VS1','VS2'].includes(clarityUpper) ? 1.0 :
       (clarityUpper === 'SI1' ? 0.5 : (clarityUpper === 'SI2' ? 0.25 : 0.15)));
  if (caratNum >= 0.30) { score += Math.round(2 * caratClarityMult); }
  if (caratNum >= 0.50) { score += Math.round(3 * caratClarityMult); }
  if (caratNum >= 0.70) { score += Math.round(4 * caratClarityMult); }
  if (caratNum >= 1.00) { score += Math.round(6 * caratClarityMult); }
  if (caratNum >= 1.50) { score += Math.round(8 * caratClarityMult); }
  if (caratNum >= 2.00) { score += Math.round(10 * caratClarityMult); }
  if (caratNum >= 3.00) { score += Math.round(13 * caratClarityMult); }
  if (caratNum >= 5.00) { score += Math.round(18 * caratClarityMult); }
  if (caratNum >= 10.00) { score += Math.round(25 * caratClarityMult); }

  // --- DEPTH DIAGNOSTICS (white diamonds only — fancy uses Color-First depth above) ---
  if (!isFancyColor && !isPortraitCut) {
    const depthResult = evaluateDepth(data.depthPct, data.shape, isFancyColor, data.carat);
    if (depthResult.status === 'critical') {
      hasDepthCritical = true;
      score -= 15;
      flags.push({ type: 'critical', label: depthResult.label, detail: depthResult.detail, scoreImpact: -15, severity: 'CRITICAL' });
    } else if (depthResult.status === 'normal') {
      flags.push({ type: 'info', label: depthResult.label, detail: depthResult.detail, scoreImpact: 0, severity: 'INFO' });
    } else if (depthResult.status === 'ideal') {
      score += 3;
      flags.push({ type: 'info', label: depthResult.label, detail: depthResult.detail, scoreImpact: 3, severity: 'INFO' });
    } else if (depthResult.status !== 'bypass') {
      flags.push({ type: 'info', label: depthResult.label || 'Depth Assessment', detail: depthResult.detail || '', scoreImpact: 0, severity: 'INFO' });
    }

    // --- TABLE PENALTY ---
    const tableResult = checkTableRisk(data);
    if (tableResult) {
      flags.push(tableResult);
      score += safeScoreImpact('checkTableRisk', tableResult.scoreImpact);
    }
  }

  // --- FISH-EYE RISK ---
  const fishEyeResult = checkFishEyeEnhanced(data);
  if (fishEyeResult) {
    flags.push(fishEyeResult);
    score += safeScoreImpact('checkFishEyeEnhanced', fishEyeResult.scoreImpact);
  }

  // --- GIRDLE PENALTY ---
  const girdlePenalty = calculateGirdlePenalty(data.girdle, data.carat);
  if (girdlePenalty !== 0) {
    score += girdlePenalty;
    flags.push({ type: 'info', label: 'Girdle Adjustment', detail: 'Girdle condition penalty/credit: ' + (girdlePenalty > 0 ? '+' : '') + girdlePenalty, scoreImpact: girdlePenalty, severity: girdlePenalty < -5 ? 'MEDIUM' : 'LOW' });
  }

  // --- GIRDLE DEAD WEIGHT RISK ---
  const gdwResult = checkGirdleDeadWeightRisk(data);
  if (gdwResult) {
    flags.push(gdwResult);
    score += safeScoreImpact('checkGirdleDeadWeightRisk', gdwResult.scoreImpact);
  }

  // --- GIRDLE CONDITION ---
  const girdleCondResult = checkGirdleCondition(data);
  if (girdleCondResult) {
    flags.push(girdleCondResult);
    score += safeScoreImpact('checkGirdleCondition', girdleCondResult.scoreImpact);
  }

  // --- GIRDLE CONSISTENCY ---
  const girdleConsResult = evaluateGirdleConsistency(data);
  if (girdleConsResult) {
    flags.push(girdleConsResult);
    score += safeScoreImpact('evaluateGirdleConsistency', girdleConsResult.scoreImpact);
  }

  // --- CULET RISK ---
  const culetResult = checkCuletRisk(data);
  if (culetResult) {
    flags.push(culetResult);
    score += safeScoreImpact('checkCuletRisk', culetResult.scoreImpact);
  }

  // --- CULET SIZE EVAL ---
  const culetSizeResult = evaluateCuletSize(data);
  if (culetSizeResult && culetSizeResult.scoreImpact !== 0) {
    score += culetSizeResult.scoreImpact;
    flags.push({ type: culetSizeResult.scoreImpact > 0 ? 'info' : 'warning', label: culetSizeResult.label || 'Culet Size', detail: 'Culet size evaluation', scoreImpact: culetSizeResult.scoreImpact, severity: culetSizeResult.scoreImpact < 0 ? 'MEDIUM' : 'INFO' });
  }

  // --- CULET-CLARITY REFLECTOR INTERACTION ---
  const culetClarityResult = checkCuletClarityInteraction(data);
  if (culetClarityResult) {
    flags.push(culetClarityResult);
    score += safeScoreImpact('checkCuletClarityInteraction', culetClarityResult.scoreImpact);
  }

  // --- DIAMOND TYPE & TREATMENT ---
  const treatmentResult = checkTreatmentRisk(data);
  if (treatmentResult) {
    flags.push(treatmentResult);
    score += safeScoreImpact('checkTreatmentRisk', treatmentResult.scoreImpact);
    if (treatmentResult.scoreImpact <= -100) return makeScoringResult(0, flags);
  }

  const labGrown = LAB_TREATMENT.detectLabGrown(data);
  if (labGrown && labGrown.isLabGrown) {
    score += -100;
    flags.push({ type: 'critical', label: 'LAB GROWN DIAMOND', detail: 'Lab grown diamond detected - not natural', scoreImpact: -100, severity: 'CRITICAL' });
    return makeScoringResult(0, flags);
  }

  // --- STRUCTURAL RISK ---
  const structResult = checkStructuralRisk(data);
  if (structResult) {
    flags.push(structResult);
    score += safeScoreImpact('checkStructuralRisk', structResult.scoreImpact);
  }

  // --- SURFACE-REACHING INCLUSION ---
  const surfaceResult = checkSurfaceReaching(data);
  if (surfaceResult) {
    flags.push(surfaceResult);
    score += safeScoreImpact('checkSurfaceReaching', surfaceResult.scoreImpact);
  }

  // --- CLARITY BASED ON CLOUDS ---
  const cbcResult = checkClarityBasedOnClouds(data);
  if (cbcResult) {
    flags.push(cbcResult);
    score += safeScoreImpact('checkClarityBasedOnClouds', cbcResult.scoreImpact);
  }

  // --- EYE-CLEAN RISK ---
  const ecResult = checkEyeCleanRisk(data);
  if (ecResult) {
    flags.push(ecResult);
    score += safeScoreImpact('checkEyeCleanRisk', ecResult.scoreImpact);
  }

  // --- SI2 LUSTER PENALTY ---
  const si2Result = checkSI2LusterPenalty(data);
  if (si2Result) {
    flags.push(si2Result);
    score += safeScoreImpact('checkSI2LusterPenalty', si2Result.scoreImpact);
  }

  // --- CLARITY SUB-GRADE ---
  const subGradeResult = evaluateClaritySubGrade(data);
  if (subGradeResult) {
    flags.push(subGradeResult);
    score += safeScoreImpact('evaluateClaritySubGrade', subGradeResult.scoreImpact);
  }

  // --- FIRST INCLUSION RISK ---
  const firstIncResult = evaluateFirstInclusionRisk(data);
  if (firstIncResult) {
    flags.push(firstIncResult);
  }

  // --- GRADING LAB INFO ---
  const labInfoResult = checkGradingLabInfo(data);
  if (labInfoResult) {
    flags.push(labInfoResult);
  }

  // --- CUT GRADE APPLICABLE ---
  const cutGradeAppResult = checkCutGradeApplicable(data);
  if (cutGradeAppResult) {
    flags.push(cutGradeAppResult);
  }

  // --- REPORT TYPE LIMITATIONS ---
  const rptLimitResult = checkReportTypeLimitations(data);
  if (rptLimitResult) {
    flags.push(rptLimitResult);
  }

  // --- ADDITIONAL INSCRIPTION ---
  const addlInscriptionResult = checkAdditionalInscription(data);
  if (addlInscriptionResult) {
    flags.push(addlInscriptionResult);
    score += safeScoreImpact('checkAdditionalInscription', addlInscriptionResult.scoreImpact);
  }

  // --- MEASUREMENT TOLERANCE ---
  const measTolResult = checkMeasurementTolerance(data);
  if (measTolResult) {
    flags.push(measTolResult);
  }

  // --- CLARITY CONSISTENCY ---
  const clarityConsistencyResult = validateClarityConsistency(data);
  if (clarityConsistencyResult) {
    flags.push(clarityConsistencyResult);
  }

  // --- CREAMY STONE RISK ---
  const creamyResult = checkCreamyStoneRisk(data);
  if (creamyResult) {
    flags.push(creamyResult);
    score += safeScoreImpact('checkCreamyStoneRisk', creamyResult.scoreImpact);
  }

  // --- STRUCTURAL HAZE ---
  const hazeStructResult = checkStructuralHaze(data);
  if (hazeStructResult) {
    flags.push(hazeStructResult);
    score += safeScoreImpact('checkStructuralHaze', hazeStructResult.scoreImpact);
  }

  // --- D-COLOR BLUE FLUOR MILKY TRAP ---
  const dcbfResult = checkDColorBlueFluorMilky(data);
  if (dcbfResult) {
    flags.push(dcbfResult);
    score += safeScoreImpact('checkDColorBlueFluorMilky', dcbfResult.scoreImpact);
  }

  // --- TYPE IIa RISK ---
  const typeIIaResult = checkTypeIIaRisk(data);
  if (typeIIaResult) {
    flags.push(typeIIaResult);
    score += safeScoreImpact('checkTypeIIaRisk', typeIIaResult.scoreImpact);
  }

  // --- TYPE IIb ULTRA-WHITE ---
  const typeIIbUWResult = checkTypeIIbUltraWhite(data);
  if (typeIIbUWResult) {
    flags.push(typeIIbUWResult);
    score += safeScoreImpact('checkTypeIIbUltraWhite', typeIIbUWResult.scoreImpact);
  }

  // --- HPA TREATMENT CHECK ---
  const hpaResult = checkHPATreatment(data);
  if (hpaResult) {
    flags.push(hpaResult);
    score += safeScoreImpact('checkHPATreatment', hpaResult.scoreImpact);
  }

  // --- HEARTS & ARROWS ---
  const heartsArrowsResult = checkHeartsAndArrows(data);
  if (heartsArrowsResult) {
    const bonusMult = isFancyColor ? 0.5 : 1.0;
    heartsArrowsResult.scoreImpact = Math.round(heartsArrowsResult.scoreImpact * bonusMult);
    flags.push(heartsArrowsResult);
    score += safeScoreImpact('checkHeartsAndArrows', heartsArrowsResult.scoreImpact);
  }

  // --- D-UNDERTONE ---
  const dUndertoneResult = checkDUndertone(data);
  if (dUndertoneResult) {
    flags.push(dUndertoneResult);
    score += safeScoreImpact('checkDUndertone', dUndertoneResult.scoreImpact);
  }

  // --- UNIFIED TINT RISK (replaces checkBrownishTint + checkBGMTintRisk) ---
  const unifiedTintResult = checkUnifiedTintRisk(data);
  if (unifiedTintResult) {
    flags.push(unifiedTintResult);
    score += safeScoreImpact('checkUnifiedTintRisk', unifiedTintResult.scoreImpact);
  }

  // --- PHOSPHORESCENCE ---
  const phosphResult = checkPhosphorescence(data);
  if (phosphResult) {
    flags.push(phosphResult);
    score += safeScoreImpact('checkPhosphorescence', phosphResult.scoreImpact);
  }

  // --- SILK EFFECT ---
  const silkResult = checkSilkEffect(data);
  if (silkResult) {
    flags.push(silkResult);
    score += safeScoreImpact('checkSilkEffect', silkResult.scoreImpact);
  }

  // --- PAVILION BULGE ---
  const bulgeResult = checkPavilionBulge(data);
  if (bulgeResult) {
    flags.push(bulgeResult);
    score += safeScoreImpact('checkPavilionBulge', bulgeResult.scoreImpact);
  }

  // --- INCLUSION PATTERN ---
  const patternResult = checkInclusionPattern(data);
  if (patternResult) {
    flags.push(patternResult);
    score += safeScoreImpact('checkInclusionPattern', patternResult.scoreImpact);
  }

  // --- INCLUSION POSITION ---
  const incPositionResult = evaluateInclusionPosition(data);
  if (incPositionResult) {
    flags.push(incPositionResult);
    score += safeScoreImpact('evaluateInclusionPosition', incPositionResult.scoreImpact);
  }

  // --- INCLUSION COLOR ---
  const incColorResult = evaluateInclusionColor(data);
  if (incColorResult) {
    flags.push(incColorResult);
    score += safeScoreImpact('evaluateInclusionColor', incColorResult.scoreImpact);
  }

  // --- INCLUSION SIZE ---
  const incSizeResult = evaluateInclusionSize(data);
  if (incSizeResult && incSizeResult.scoreImpact !== 0) {
    score += incSizeResult.scoreImpact;
    flags.push({ type: incSizeResult.scoreImpact < 0 ? 'warning' : 'info', label: incSizeResult.label, detail: 'Inclusion size assessment', scoreImpact: incSizeResult.scoreImpact, severity: incSizeResult.scoreImpact <= -10 ? 'HIGH' : (incSizeResult.scoreImpact > 0 ? 'INFO' : 'MEDIUM') });
  }

  // --- EXTENDED INCLUSION TYPES (Indented Natural, Etch Channel, Twinning Wisp, Bruise, etc.) ---
  const extIncResult = checkExtendedInclusionTypes(data);
  if (extIncResult) {
    flags.push(extIncResult);
    score += safeScoreImpact('checkExtendedInclusionTypes', extIncResult.scoreImpact);
  }

  // --- GRAINING DETAIL ---
  const grainingDetailResult = evaluateGrainingDetail(data);
  if (grainingDetailResult) {
    flags.push(grainingDetailResult);
    score += safeScoreImpact('evaluateGrainingDetail', grainingDetailResult.scoreImpact);
  }

  // --- GRAINING SEVERITY (multiplier for heavy/reflective graining) ---
  const grainingSeverityResult = evaluateGrainingSeverity(data);
  if (grainingSeverityResult && grainingSeverityResult.multiplier > 1.0) {
    flags.push(grainingSeverityResult);
    score += safeScoreImpact('evaluateGrainingSeverity', grainingSeverityResult.scoreImpact);
  }

  // --- GRAINING RISK (wired with isInvestmentGrade check) ---
  const isInvestmentGrade = qualityTier === 'INVESTMENT';
  const grainingRiskPenalty = evaluateGrainingRisk(data, flags, isInvestmentGrade);
  if (grainingRiskPenalty !== 0) {
    score += safeScoreImpact('evaluateGrainingRisk', grainingRiskPenalty);
  }

  // --- BEARDING ---
  const beardingResult = checkBearding(data);
  if (beardingResult) {
    flags.push(beardingResult);
    score += safeScoreImpact('checkBearding', beardingResult.scoreImpact);
  }

  // --- NATURALS / EXTRA FACET ---
  const nefResult = checkNaturalsExtraFacet(data);
  if (nefResult) {
    flags.push(nefResult);
    score += safeScoreImpact('checkNaturalsExtraFacet', nefResult.scoreImpact);
  }

  // --- NATURAL EXTENDED ---
  const naturalExtResult = checkNaturalExtended(data);
  if (naturalExtResult) {
    flags.push(naturalExtResult);
    score += safeScoreImpact('checkNaturalExtended', naturalExtResult.scoreImpact);
  }

  // --- DEPTH-TABLE BALANCE ---
  const dtbResult = checkDepthTableBalance(data);
  if (dtbResult) {
    flags.push(dtbResult);
    score += safeScoreImpact('checkDepthTableBalance', dtbResult.scoreImpact);
  }

  // --- EMERALD CROWN HEIGHT ---
  const echResult = evaluateEmeraldCrownHeight(data);
  if (echResult) {
    flags.push(echResult);
    score += safeScoreImpact('evaluateEmeraldCrownHeight', echResult.scoreImpact);
  }

  // --- STAR / LOWER HALF LENGTH ---
  const slhResult = evaluateStarLowerHalfLength(data);
  if (slhResult) {
    flags.push(slhResult);
    score += safeScoreImpact('evaluateStarLowerHalfLength', slhResult.scoreImpact);
  }

  // --- FACET CONSISTENCY (proportions range) ---
  const facetConsistencyResult = checkFacetConsistency(data);
  if (facetConsistencyResult) {
    flags.push(facetConsistencyResult);
    score += safeScoreImpact('checkFacetConsistency', facetConsistencyResult.scoreImpact);
  }

  // --- CROWN HEIGHT ROUND ---
  const chRoundResult = evaluateCrownHeightRound(data);
  if (chRoundResult) {
    flags.push(chRoundResult);
    score += safeScoreImpact('evaluateCrownHeightRound', chRoundResult.scoreImpact);
  }

  // --- TABLE-CROWN INTERACTION ---
  const tableCrownResult = checkTableCrownInteraction(data);
  if (tableCrownResult) {
    flags.push(tableCrownResult);
    score += safeScoreImpact('checkTableCrownInteraction', tableCrownResult.scoreImpact);
  }

  // --- CROWN-PAVILION BALANCE ---
  const cpBalanceResult = evaluateCrownPavilionBalance(data);
  if (cpBalanceResult) {
    const bonusMult = isFancyColor ? 0.5 : 1.0;
    cpBalanceResult.scoreImpact = Math.round(cpBalanceResult.scoreImpact * bonusMult);
    flags.push(cpBalanceResult);
    score += safeScoreImpact('evaluateCrownPavilionBalance', cpBalanceResult.scoreImpact);
  }

  // --- COLOR GRADE CEILING (non-Fancy only, applied BEFORE optical bonuses) ---
  // D-F can reach 100. G+ capped at base. Optical excellence limited to +10 above ceiling.
  var colorCeilingCap = 100;
  if (!isFancyColor) {
    const COLOR_CEILING = { D:100, E:100, F:100, G:85, H:82, I:78, J:74, K:70, L:65, M:60, N:52, O:48, P:45, Q:42, R:40, S:38, T:35, U:32, V:30, W:28, X:26, Y:24, Z:22 };
    const cap = COLOR_CEILING[colorUpper];
    if (cap !== undefined && score > cap) {
      score = cap;
      colorCeilingCap = cap + 10;
      flags.push({ type: 'info', label: 'Color Ceiling: ' + colorUpper + ' (MAX ' + cap + ')', detail: colorUpper + ' color ceiling applied. Optical excellence limited to +10 above (max ' + colorCeilingCap + ').', scoreImpact: 0, severity: 'INFO' });
    }
  }

  // --- CROWN-PAVILION AGS PAIRING ---
  const cpPairingResult = checkCrownPavilionPairing(data);
  if (cpPairingResult) {
    const bonusMult = isFancyColor ? 0.5 : 1.0;
    cpPairingResult.scoreImpact = Math.round(cpPairingResult.scoreImpact * bonusMult);
    flags.push(cpPairingResult);
    score += safeScoreImpact('checkCrownPavilionPairing', cpPairingResult.scoreImpact);
  }

  // --- SUPER IDEAL ---
  const superIdealResult = checkSuperIdeal(data);
  if (superIdealResult) {
    const bonusMult = isFancyColor ? 0.5 : 1.0;
    superIdealResult.scoreImpact = Math.round(superIdealResult.scoreImpact * bonusMult);
    flags.push(superIdealResult);
    score += safeScoreImpact('checkSuperIdeal', superIdealResult.scoreImpact);
  }

  // --- ROUND CUT GRADE PYRAMID ---
  const roundCutResult = evaluateRoundCutGradePyramid(data);
  if (roundCutResult) {
    const bonusMult = isFancyColor ? 0.5 : 1.0;
    roundCutResult.scoreImpact = Math.round(roundCutResult.scoreImpact * bonusMult);
    flags.push(roundCutResult);
    score += safeScoreImpact('evaluateRoundCutGradePyramid', roundCutResult.scoreImpact);
  }

  // --- FACET LUSTRE ---
  const lustreResult = evaluateFacetLustre(data);
  if (lustreResult) {
    flags.push(lustreResult);
    score += safeScoreImpact('evaluateFacetLustre', lustreResult.scoreImpact);
  }

  // --- FANCY SHAPE CUT QUALITY ---
  const fancyCutResult = evaluateFancyShapeCutQuality(data);
  if (fancyCutResult) {
    flags.push(fancyCutResult);
    score += safeScoreImpact('evaluateFancyShapeCutQuality', fancyCutResult.scoreImpact);
  }

  // --- Enforce color ceiling soft cap (max +10 above ceiling for optical excellence) ---
  if (!isFancyColor && colorCeilingCap < 100 && score > colorCeilingCap) {
    flags.push({ type: 'info', label: 'Color Ceiling + Optical Cap: ' + colorUpper + ' (MAX ' + colorCeilingCap + ')', detail: 'Optical bonuses capped at color ceiling + 10. Score limited to ' + colorCeilingCap + '.', scoreImpact: score - colorCeilingCap, severity: 'INFO' });
    score = colorCeilingCap;
  }

  // --- BOW-TIE RISK ---
  const bowTieResult = checkBowTieRiskEnhanced(data);
  if (bowTieResult) {
    flags.push(bowTieResult);
    score += safeScoreImpact('checkBowTieRiskEnhanced', bowTieResult.scoreImpact);
  }

  // --- SPREAD & WINDOWING RISK (cached single call) ---
  const spreadFactorResult = evaluateSpreadFactor(data);
  if (spreadFactorResult) {
    const windowingResult = checkWindowingRisk(data, spreadFactorResult, data.depthPct);
    if (windowingResult) {
      flags.push(windowingResult);
      score += safeScoreImpact('checkWindowingRisk', windowingResult.scoreImpact);
    }
    flags.push(spreadFactorResult);
    score += safeScoreImpact('evaluateSpreadFactor', spreadFactorResult.scoreImpact);
  }

  // --- RATIO EVALUATION ---
  let ratioVal = null;
  const measMatch = String(data.measurements || '').match(/(\d+\.?\d*)\s*[xX\-–]\s*(\d+\.?\d*)/);
  if (measMatch) {
    const rl = parseFloat(measMatch[1]), rw = parseFloat(measMatch[2]);
    if (rw > 0) {
      const ratio = rl / rw;
      if (ratio && !isNaN(ratio) && isFinite(ratio)) {
        const ratioResult = evaluateRatio(ratio, data.shape);
        if (ratioResult) {
          if (ratioResult.score) {
            score += safeScoreImpact('evaluateRatio', ratioResult.score);
            flags.push({ type: 'info', label: ratioResult.label, detail: ratioResult.detail, scoreImpact: ratioResult.score, severity: 'INFO' });
          } else if (ratioResult.status === 'warning') {
            score -= 5;
            flags.push({ type: 'warning', label: ratioResult.label, detail: ratioResult.detail, scoreImpact: -5, severity: 'MEDIUM' });
          } else {
            flags.push({ type: 'info', label: ratioResult.label || 'Normal Ratio', detail: ratioResult.detail || 'Ratio within expected range', scoreImpact: 0, severity: 'INFO' });
          }
        }
      }
    }
  }

  // --- SYMMETRY SPECIFICS ---
  const symResult = checkSymmetrySpecifics(data);
  if (symResult) {
    flags.push(symResult);
    score += safeScoreImpact('checkSymmetrySpecifics', symResult.scoreImpact);
  }

  // --- CARAT THRESHOLD RISK ---
  const ctrResult = checkCaratThresholdRisk(data);
  if (ctrResult) {
    flags.push(ctrResult);
    score += safeScoreImpact('checkCaratThresholdRisk', ctrResult.scoreImpact);
  }

  // --- CARAT MAGIC BONUS ---
  const magicBonusResult = checkCaratMagicBonus(data);
  if (magicBonusResult) {
    flags.push(magicBonusResult);
    score += safeScoreImpact('checkCaratMagicBonus', magicBonusResult.scoreImpact);
  }

  // --- MEASUREMENTS-CARAT CONSISTENCY ---
  const mccResult = checkMeasurementsCaratConsistency(data);
  if (mccResult) {
    flags.push(mccResult);
    score += safeScoreImpact('checkMeasurementsCaratConsistency', mccResult.scoreImpact);
    if (mccResult.fraudLock) {
      hasFraudLockFlag = true;
      flags.push({ type: 'critical', label: 'FRAUD LOCK: Score capped due to extreme measurement-carat mismatch', detail: 'Severe deviation between measurements and carat weight — possible fraud or severe data error. Score capped.', scoreImpact: 0, severity: 'CRITICAL' });
    }
  }

  // --- INSCRIPTION MATCH ---
  const insMatchResult = checkInscriptionMatch(data);
  if (insMatchResult) {
    flags.push(insMatchResult);
    score += safeScoreImpact('checkInscriptionMatch', insMatchResult.scoreImpact);
  }

  // --- CERTIFICATE ERA ---
  const certEraResult = checkCertificateEra(data);
  if (certEraResult) {
    flags.push(certEraResult);
  }

  // --- CERTIFICATE AGE RISK ---
  const certAgeResult = checkCertificateAgeRisk(data);
  if (certAgeResult) {
    flags.push(certAgeResult);
    score += safeScoreImpact('checkCertificateAgeRisk', certAgeResult.scoreImpact);
  }

  // --- INVESTMENT GRADE ---
  const investResult = checkInvestmentGrade(data);
  if (investResult) {
    flags.push(investResult);
    score += safeScoreImpact('checkInvestmentGrade', investResult.scoreImpact);
  }

  // --- AUCTION GRADE COMPENSATION ---
  const auctionResult = checkAuctionGradeCompensation(data);
  if (auctionResult) {
    flags.push(auctionResult);
    score += safeScoreImpact('checkAuctionGradeCompensation', auctionResult.scoreImpact);
  }

  // --- ORIGIN PREMIUM (merged — single call avoids double-counting) ---
  const originResult = checkOriginPremiumExtended(data);
  if (originResult) {
    flags.push(originResult);
    score += safeScoreImpact('checkOriginPremiumExtended', originResult.scoreImpact);
  }

  // --- UNDER-GRADED HUNTER ---
  const ughResult = checkUnderGradedHunter(data);
  if (ughResult) {
    flags.push(ughResult);
    score += safeScoreImpact('checkUnderGradedHunter', ughResult.scoreImpact);
  }

  // --- FANCY COLOR DISTRIBUTION ---
  const fcdResult = checkFancyColorDistribution(data);
  if (fcdResult) {
    flags.push(fcdResult);
    score += safeScoreImpact('checkFancyColorDistribution', fcdResult.scoreImpact);
  }

  // --- FANCY COLOR SECONDARY HUE ---
  const fcshResult = checkFancyColorSecondaryHue(data);
  if (fcshResult) {
    flags.push(fcshResult);
    score += safeScoreImpact('checkFancyColorSecondaryHue', fcshResult.scoreImpact);
  }

  // --- FANCY DARK / DEEP ---
  const fddResult = checkFancyDarkDeep(data);
  if (fddResult) {
    flags.push(fddResult);
    score += safeScoreImpact('checkFancyDarkDeep', fddResult.scoreImpact);
  }

  // --- FANCY COLOR + FLUORESCENCE INTERACTION ---
  const ffiResult = checkFancyFluorInteraction(data);
  if (ffiResult) {
    flags.push(ffiResult);
    score += safeScoreImpact('checkFancyFluorInteraction', ffiResult.scoreImpact);
  }

  // --- FANCY TREATMENT RISK (Orange/Green verification) ---
  const ftrResult = checkFancyTreatmentRisk(data);
  if (ftrResult) {
    flags.push(ftrResult);
  }

  // --- CHAMELEON DIAMOND ---
  const chameleonResult = checkFancyChameleon(data);
  if (chameleonResult) {
    flags.push(chameleonResult);
    score += safeScoreImpact('checkFancyChameleon', chameleonResult.scoreImpact);
  }

  // --- PADPARADSCHA DETECTION ---
  const padResult = checkPadparadscha(data);
  if (padResult) {
    flags.push(padResult);
    score += safeScoreImpact('checkPadparadscha', padResult.scoreImpact);
  }

  // --- TYPE Ia / IaB NITROGEN CLASSIFICATION ---
  const typeIaResult = checkTypeIaClassification(data);
  if (typeIaResult) {
    flags.push(typeIaResult);
    score += safeScoreImpact('checkTypeIaClassification', typeIaResult.scoreImpact);
  }

  // --- CLARITY UPGRADE POTENTIAL ---
  const cuPotentialResult = checkClarityUpgradePotential(data);
  if (cuPotentialResult) {
    flags.push(cuPotentialResult);
  }

  // --- CHAMPAGNE EFFECT (C1-C7 brown segmentation) ---
  if (CHAMPAGNE_EFFECT.colorRange.includes(colorUpper)) {
    const combinedChamp = DataGuard.combinedText(data);
    const cMatch = combinedChamp.match(/\bC([1-7])\b/i);
    if (cMatch) {
      const cLevel = parseInt(cMatch[1], 10);
      if (cLevel <= 3) { score += 12; flags.push({ type: 'info', label: 'Champagne C' + cLevel + ' (Argyle Premium)', detail: 'C' + cLevel + ' = premium champagne range (light, market-desired)', scoreImpact: 12, severity: 'INFO' }); }
      else if (cLevel <= 5) { score += 5; flags.push({ type: 'info', label: 'Cognac C' + cLevel + ' (Market Value)', detail: 'C' + cLevel + ' = cognac range, standard market pricing', scoreImpact: 5, severity: 'INFO' }); }
      else { score -= 8; flags.push({ type: 'warning', label: 'Dark Champagne C' + cLevel + ' (Discount)', detail: 'C' + cLevel + ' = dark cognac/chocolate range, discounted', scoreImpact: -8, severity: 'MEDIUM' }); }
    } else if (/cognac/i.test(combinedChamp)) {
      score += CHAMPAGNE_EFFECT.modifiers.COGNAC.bonus;
      flags.push({ type: 'info', label: CHAMPAGNE_EFFECT.modifiers.COGNAC.label, detail: CHAMPAGNE_EFFECT.modifiers.COGNAC.label, scoreImpact: CHAMPAGNE_EFFECT.modifiers.COGNAC.bonus, severity: 'INFO' });
    } else if (/champagne/i.test(combinedChamp)) {
      score += CHAMPAGNE_EFFECT.modifiers.CHAMPAGNE.bonus;
      flags.push({ type: 'info', label: CHAMPAGNE_EFFECT.modifiers.CHAMPAGNE.label, detail: CHAMPAGNE_EFFECT.modifiers.CHAMPAGNE.label, scoreImpact: CHAMPAGNE_EFFECT.modifiers.CHAMPAGNE.bonus, severity: 'INFO' });
    } else if (/honey/i.test(combinedChamp)) {
      score += CHAMPAGNE_EFFECT.modifiers.HONEY.bonus;
      flags.push({ type: 'info', label: CHAMPAGNE_EFFECT.modifiers.HONEY.label, detail: CHAMPAGNE_EFFECT.modifiers.HONEY.label, scoreImpact: CHAMPAGNE_EFFECT.modifiers.HONEY.bonus, severity: 'INFO' });
    }
  }

  // --- DEPTH CRITICAL CAP (tier-aware) ---
  if (hasDepthCritical) {
    const tierDepthCaps = { INVESTMENT: 82, PREMIUM: 78, COMMERCIAL: 60, BUDGET: 45 };
    const depthCap = tierDepthCaps[qualityTier] || 84;
    score = Math.min(score, depthCap);
    flags.push({ type: 'warning', label: 'Depth Critical Cap (' + tierCfg.label + ')', detail: 'Critical depth issue limits maximum score to ' + depthCap + ' for ' + qualityTier + ' stones.', scoreImpact: 0, severity: 'HIGH' });
  }

  // --- QUALITY TIER: non-linear modifier ---
  // Investment-grade stones: defects hurt MORE (multiplicative).
  // Commercial/Budget stones: optical bonuses help LESS (scaled down).

  // A) Defect multiplier: critical issues on investment stones get multiplicative penalty
  if (hasDepthCritical && qualityTier === 'INVESTMENT') {
    const depthDefect = Math.round(score * (1 - tierCfg.defectMult * 0.15));
    flags.push({ type: 'critical', label: 'Investment Grade Defect Multiplier', detail: qualityTier + ': critical depth defect on investment stone = ' + Math.round(tierCfg.defectMult * 0.15 * 100) + '% multiplicative penalty applied', scoreImpact: depthDefect - score, severity: 'CRITICAL' });
    score = Math.min(score, depthDefect);
  }

  // B) Bonus scaling: commercial/budget stones get reduced benefit from optical perfection
  // (re-scored: the carat/clarity/optical bonuses already applied are adjusted post-hoc)
  if (tierCfg.bonusMult < 1.0) {
    // Calculate the net bonus amount (how much above the tier floor we are)
    const netBonus = Math.max(0, score - tierCfg.floor);
    if (netBonus > 0) {
      const scaledBonus = Math.round(netBonus * tierCfg.bonusMult);
      score = tierCfg.floor + scaledBonus;
      flags.push({ type: 'info', label: 'Tier Bonus Scaling (' + tierCfg.label + ')', detail: 'Optical bonuses scaled to ' + Math.round(tierCfg.bonusMult * 100) + '% for ' + qualityTier + ' stones. Limited value from perfect cut on budget-grade diamonds.', scoreImpact: scaledBonus - netBonus, severity: 'INFO' });
    }
  }

  // C) Rarity Floor — fancy colors have natural market floor
  if (isFancyColor) {
    const RARITY_FLOOR = { INVESTMENT: 75, PREMIUM: 55, COMMERCIAL: 35, BUDGET: 20 };
    const rarityFloor = RARITY_FLOOR[qualityTier] || 45;
    if (score < rarityFloor) {
      score = rarityFloor;
      flags.push({ type: 'info', label: 'Rarity Floor: ' + qualityTier, detail: 'Fancy color rarity floor applied at ' + rarityFloor + '. Even low-grade fancy colors retain minimum value.', scoreImpact: 0, severity: 'INFO' });
    }
  }

  // D) Tier floor — white diamonds only
  if (!isFancyColor && score < tierCfg.floor) {
    score = Math.max(score, tierCfg.floor - 5);
    flags.push({ type: 'info', label: 'Tier Floor: ' + tierCfg.label, detail: 'Quality tier floor applied. ' + qualityTier + ' stones retain minimum ' + tierCfg.floor + ' base value.', scoreImpact: 0, severity: 'INFO' });
  }

  // D) Tier ceiling — prevent budget stones from scoring investment-grade
  const TIER_CEILING = { INVESTMENT: 100, PREMIUM: 93, COMMERCIAL: 78, BUDGET: 58 };
  const tierCap = TIER_CEILING[qualityTier];
  const tierCapped = score > tierCap;
  if (tierCapped) {
    score = tierCap;
    flags.push({ type: 'info', label: 'Tier Ceiling: ' + tierCfg.label + ' (MAX ' + tierCap + ')', detail: qualityTier + ': maximum score capped at ' + tierCap + '. Cannot score as investment-grade.', scoreImpact: 0, severity: 'INFO' });
  }

  // ════════════════════════════════════════════════════════════
  // HUMAN INSPECTION LAYER (visual observations override cert assumptions)
  // ════════════════════════════════════════════════════════════
  if (humanInspection) {
    // --- Eye-clean confirmation: override SI penalty ---
    if (humanInspection.eyeClean === true) {
      const clarity = (data.clarity || '').toUpperCase();
      if (clarity === 'SI1') { score += 12; flags.push({ type: 'info', label: '👁 Human Verdict: Eye-Clean Confirmed (SI1)', detail: 'Human inspection confirms stone is eye-clean. SI1 clarity penalty partially refunded.', scoreImpact: 12, severity: 'INFO' }); }
      else if (clarity === 'SI2') { score += 20; flags.push({ type: 'info', label: '👁 Human Verdict: Eye-Clean Confirmed (SI2)', detail: 'Human inspection confirms SI2 is eye-clean — rare find. Major penalty refund applied.', scoreImpact: 20, severity: 'INFO' }); }
    } else if (humanInspection.eyeClean === false) {
      score -= 10;
      flags.push({ type: 'warning', label: '👁 Human Verdict: NOT Eye-Clean', detail: 'Human inspection confirms inclusions are eye-visible. Consider alternative if eye-cleanliness is important.', scoreImpact: -10, severity: 'HIGH' });
    }

    // --- Fluorescence milkiness: cert can't detect this ---
    if (humanInspection.fluorMilky === true) {
      score -= 30;
      flags.push({ type: 'critical', label: '👁 Human Verdict: Milky/Hazy Fluorescence Confirmed', detail: 'Strong fluorescence creates visible milkiness — cert alone cannot detect this. Severe value impact.', scoreImpact: -30, severity: 'CRITICAL' });
    } else if (humanInspection.fluorMilky === false) {
      const fluor = (data.fluorescence || '').toLowerCase();
      if (/strong|very strong/i.test(fluor)) {
        score += 10;
        flags.push({ type: 'info', label: '👁 Human Verdict: No Milky Effect (Strong Fluor)', detail: 'Despite strong fluorescence, human inspection confirms NO milky/hazy appearance. Fluor penalty overridden.', scoreImpact: 10, severity: 'INFO' });
      }
    }

    // --- Brown/gray undertone: invisible on cert ---
    if (humanInspection.brownUndertone === true) {
      const color = (data.color || '').toUpperCase();
      if (['D','E','F'].includes(color)) { score -= 20; flags.push({ type: 'critical', label: '👁 Human Verdict: Brown/Gray Undertone on D-F', detail: 'Top color grade undermined by visible brown/gray undertone. Not detectable from cert alone.', scoreImpact: -20, severity: 'CRITICAL' }); }
      else if (['G','H','I'].includes(color)) { score -= 12; flags.push({ type: 'warning', label: '👁 Human Verdict: Brown/Gray Undertone Detected', detail: 'Near-colorless stone has visible brown/gray undertone.', scoreImpact: -12, severity: 'HIGH' }); }
    }

    // --- Liveliness / brilliance: cert proportions can't guarantee this ---
    if (humanInspection.livelyAppearance === false) {
      score -= 15;
      flags.push({ type: 'warning', label: '👁 Human Verdict: Dull/Lifeless Appearance', detail: 'Proportions may be within ideal range but stone appears dull — possible light leakage or poor facet alignment.', scoreImpact: -15, severity: 'HIGH' });
    } else if (humanInspection.livelyAppearance === true) {
      score += 3;
      flags.push({ type: 'info', label: '👁 Human Verdict: Excellent Liveliness', detail: 'Stone appears bright and lively in person — confirms optical performance exceeds cert expectations.', scoreImpact: 3, severity: 'INFO' });
    }

    // --- Bow-tie severity (fancy shapes only) ---
    if (humanInspection.bowTie === 'strong') { score -= 12; flags.push({ type: 'warning', label: '👁 Human Verdict: Strong Bow-Tie', detail: 'Severe bow-tie effect confirmed by visual inspection.', scoreImpact: -12, severity: 'HIGH' }); }
    else if (humanInspection.bowTie === 'mild') { score -= 3; flags.push({ type: 'info', label: '👁 Human Verdict: Mild Bow-Tie', detail: 'Mild bow-tie visible, minor impact.', scoreImpact: -3, severity: 'LOW' }); }
    else if (humanInspection.bowTie === 'none') { score += 2; flags.push({ type: 'info', label: '👁 Human Verdict: No Bow-Tie', detail: 'No bow-tie effect visible — excellent for a fancy shape.', scoreImpact: 2, severity: 'INFO' }); }

    // --- Face-up inclusion visibility ---
    if (humanInspection.faceUpVisible === true) {
      score -= 15;
      flags.push({ type: 'warning', label: '👁 Human Verdict: Inclusions Face-Up Visible', detail: 'Inclusions visible when viewing stone face-up — significantly impacts desirability.', scoreImpact: -15, severity: 'HIGH' });
    }

    // --- Spread perception (does stone look its weight?) ---
    if (humanInspection.spreadPerception === 'larger') { score += 3; flags.push({ type: 'info', label: '👁 Human Verdict: Larger Than Expected', detail: 'Stone appears larger than its carat weight suggests — excellent spread.', scoreImpact: 3, severity: 'INFO' }); }
    else if (humanInspection.spreadPerception === 'smaller') { score -= 5; flags.push({ type: 'warning', label: '👁 Human Verdict: Smaller Than Expected', detail: 'Stone appears smaller than its carat weight suggests — likely deep cut/hidden weight.', scoreImpact: -5, severity: 'MEDIUM' }); }

    // --- Windowing / extinction ---
    if (humanInspection.windowing === true) {
      score -= 15;
      flags.push({ type: 'warning', label: '👁 Human Verdict: Windowing/Extinction Confirmed', detail: 'Stone shows visible windowing or extinction zones when viewed face-up.', scoreImpact: -15, severity: 'HIGH' });
    }

    // --- Color perception vs grade ---
    if (humanInspection.colorPerception === 'better') { score += 8; flags.push({ type: 'info', label: '👁 Human Verdict: Color Better Than Grade', detail: 'Stone appears whiter/more saturated than its color grade suggests — possible under-grade or excellent make.', scoreImpact: 8, severity: 'INFO' }); }
    else if (humanInspection.colorPerception === 'worse') { score -= 10; flags.push({ type: 'warning', label: '👁 Human Verdict: Color Worse Than Grade', detail: 'Stone appears more tinted than its color grade suggests.', scoreImpact: -10, severity: 'HIGH' }); }

    // --- Value judgment (relative to asking price) ---
    if (humanInspection.valueJudgment === 'excellent') { score += 5; flags.push({ type: 'info', label: '👁 Human Verdict: Excellent Value', detail: 'At the quoted price, this stone represents excellent value.', scoreImpact: 5, severity: 'INFO' }); }
    else if (humanInspection.valueJudgment === 'overpriced') { score -= 8; flags.push({ type: 'warning', label: '👁 Human Verdict: Overpriced', detail: 'At the quoted price, this stone appears overpriced relative to comparable stones.', scoreImpact: -8, severity: 'MEDIUM' }); }
  }

  // --- Final fraud-lock cap (applied after all bonuses/penalties, before clamp) ---
  if (hasFraudLockFlag) {
    score = Math.min(score, 35);
  }

  // --- ROUND CUT-GRADE KILL-SWITCH (v17.1.0) ---
  // Poor/Fair cut on a round brilliant destroys optical value regardless of carat.
  // Uses engine-calculated grade (from angles/proportions), not just GIA cert grade.
  var roundShape = /round/i.test(data.shape || '') && !/briolet|rose|portrait|candlelight/i.test(data.shape || '');
  var engineCutGrade = (roundCutResult && roundCutResult.grade) || data.cutGrade || '';
  if (roundShape && !isFancyColor) {
    if (/poor/i.test(engineCutGrade)) { score = Math.min(score, 40); }
    else if (/fair/i.test(engineCutGrade)) { score = Math.min(score, 60); }
    else if (/good/i.test(engineCutGrade)) { score = Math.min(score, 78); }
  }

  // --- STEEP-DEEP ANTI-PAIRING: Fire-Killer Penalty (v17.1.0) ---
  // Crown < 33° + Pavilion > 41.5° = light leaks through, no fire. Optical physics failure.
  var crownA = parseFloat(data.crownAngle);
  var pavA = parseFloat(data.pavilionAngle);
  if (!isNaN(crownA) && !isNaN(pavA) && crownA < 33 && pavA > 41.5) {
    score -= 25;
    flags.push({ type: 'critical', label: 'CRITICAL: Steep-Deep Anti-Pairing (Fire Killer)', detail: 'CA ' + crownA.toFixed(1) + '\u00B0 / PA ' + pavA.toFixed(1) + '\u00B0 = crown too shallow + pavilion too deep. Light leaks out bottom, fire near zero. Physics failure, cannot be compensated by carat size.', scoreImpact: -25, severity: 'CRITICAL' });
  }
  // Moderate anti-pairing: Crown 33-34° with Pavilion > 41.2°
  if (!isNaN(crownA) && !isNaN(pavA) && crownA >= 33 && crownA < 34 && pavA > 41.2) {
    score -= 15;
    flags.push({ type: 'warning', label: 'Crown-Pavilion Anti-Pairing (Reduced Fire)', detail: 'CA ' + crownA.toFixed(1) + '\u00B0 / PA ' + pavA.toFixed(1) + '\u00B0 = shallow crown + deep pavilion. Fire significantly reduced.', scoreImpact: -15, severity: 'HIGH' });
  }

  // --- COLOR CEILING: RE-APPLIED AFTER ALL BONUSES (v17.1.0) ---
  // Color ceiling must be the HARD limit — no bonus (auction, carat, origin) can exceed it.
  // Re-applied here to catch bonuses that were added after the first ceiling check.
  if (!isFancyColor) {
    var COLOR_CEILING_HARD = { D:100, E:100, F:100, G:85, H:82, I:78, J:74, K:70, L:65, M:60, N:52, O:48, P:45, Q:42, R:40, S:38, T:35, U:32, V:30, W:28, X:26, Y:24, Z:22 };
    var hardCap = COLOR_CEILING_HARD[colorUpper];
    if (hardCap !== undefined && score > hardCap) {
      flags.push({ type: 'info', label: 'Color Ceiling Enforced: ' + colorUpper + ' (MAX ' + hardCap + ')', detail: 'Score capped at J color ceiling (' + hardCap + '). Auction/carat bonuses cannot exceed color-grade limit.', scoreImpact: 0, severity: 'INFO' });
      score = hardCap;
    }
  }

  // --- Score cap for severe treatments and corrupted data ---
  if (hasDataCorruptionScoreCap) {
    score = Math.min(score, 50);
  }
  // Check flags for treatment-related caps
  var hasCriticalTreatment = flags.some(function(f) { return f.label && /HPHT|Irradiated|Coated|Fracture/i.test(f.label); });
  var hasFatalFluor = flags.some(function(f) { return f.label && /Yellow Fluor \+ High Color|Green Fluor \+ High Color|Yellow Fluor.*fatal/i.test(f.label); });
  if (hasCriticalTreatment) {
    score = Math.min(score, 55);
  }
  if (hasFatalFluor) {
    score = Math.min(score, 65);
  }
  // Cap for uneven/blotchy/patchy fluor (CRITICAL but wasn't capped)
  var hasUnevenFluor = flags.some(function(f) { return f.label && /Patchy|Uneven Fluor|Blotchy/i.test(f.label); });
  if (hasUnevenFluor) {
    score = Math.min(score, 70);
  }
  // Cap for severe structural inclusion risks
  var hasStructuralDanger = flags.some(function(f) { return f.label && /Twinning Plane|Etch Channel/i.test(f.label); });
  if (hasStructuralDanger) {
    score = Math.min(score, 75);
  }
  // Cap for Milky/Hazy/Oily risk (previously only in getVerdict, now in score pipeline)
  var hasMilkyHazy = flags.some(function(f) { return f.label && /MILKY|HAZY|Oily|Blurry/i.test(f.label); });
  if (hasMilkyHazy) {
    score = Math.min(score, 69);
  }
  // Cap for critical depth issues
  var hasCriticalDepthFlag = flags.some(function(f) { return f.label && /CRITICAL: Too Deep|CRITICAL: Severe Windowing|CRITICAL: Weight Hidden|Probable Data Error/i.test(f.label); });
  if (hasCriticalDepthFlag) {
    score = Math.min(score, 84);
  }

  // --- Final clamp ---
  const finalScore = clampScore(score);

  // --- NON-LINEAR SCORE STRETCH (extreme value precision) ---
  // Diamond market is non-linear at extremes:
  //   - High end (90-100): FL is 15-20% more valuable than VVS1, not 3%
  //   - Low end (0-15):  I1 vs I2 price gap is huge, not 2 points
  let displayScore = finalScore;
  if (finalScore >= 90 && !tierCapped) {
    // Stretch 90-100 → 85-100 (compress mid, expand top)
    displayScore = Math.round(85 + (finalScore - 90) * 1.5);
    displayScore = Math.min(100, displayScore);
  } else if (finalScore <= 15) {
    // Stretch 0-15 → 0-20 (expand bottom for better low-end distinction)
    displayScore = Math.round(finalScore * 1.33);
  }
  // Scores 16-89 remain linear (unchanged)

  const verdict = getVerdict(displayScore, flags);

  // --- BORDERLINE SCORE CHECK ---
  const borderlineResult = checkBorderlineScore(finalScore, verdict);
  if (borderlineResult) {
    flags.push({ type: 'info', label: 'Borderline Score Alert', detail: borderlineResult.warning, scoreImpact: 0, severity: 'LOW' });
  }

  return makeScoringResult(displayScore, flags);
}

// ============================================================================
// SECTION 7: REPORTING (v17.1.0)
// ============================================================================

function formatQuickSummary(data, scoring) {
  const s = scoring.score || 0;
  const v = scoring.verdict || {};
  const tier = scoring.qualityTier || '';
  const dc = scoring.dataConfidence || {};
  const risk = scoring.riskSummary || {};
  const flags = scoring.flags || [];

  const lines = [];
  lines.push('');
  lines.push('  ╔══════════════════════════════════════╗');
  lines.push('  ║     GIA DIAMOND ANALYSIS  v' + CONFIG.MODULE_VERSION + '     ║');
  lines.push('  ╠══════════════════════════════════════╣');
  lines.push('  ║  ' + (data.shape || 'Unknown').padEnd(36) + '║');
  lines.push('  ║  ' + (data.carat || '?') + 'ct  ' + (data.color || '?') + '  ' + (data.clarity || '?') + (' '.repeat(20)) + '║');
  lines.push('  ║  Report: ' + (data.reportNumber || 'N/A').substring(0, 29).padEnd(29) + '║');
  lines.push('  ╠══════════════════════════════════════╣');
  lines.push('  ║  SCORE: ' + String(s).padStart(3) + '/100  →  ' + (v.label || '?').padEnd(18) + '║');
  lines.push('  ║  Tier: ' + tier.padEnd(31) + '║');
  lines.push('  ║  Confidence: ' + String(dc.score || '?').padStart(3) + '% (' + (dc.level || '?') + ')'.padEnd(22) + '║');
  lines.push('  ╠══════════════════════════════════════╣');

  // Critical/High flags summary (compact)
  var criticals = flags.filter(function(f) { return f.type === 'critical'; });
  var highs = flags.filter(function(f) { return f.type === 'warning' && f.severity === 'HIGH'; });
  if (criticals.length > 0) {
    lines.push('  ║  🔴 CRITICAL (' + criticals.length + '):'.padEnd(37) + '║');
    for (var i = 0; i < Math.min(criticals.length, 3); i++) {
      lines.push('  ║    • ' + (criticals[i].label || '').substring(0, 31).padEnd(31) + '║');
    }
  }
  if (highs.length > 0) {
    lines.push('  ║  🟠 HIGH RISK (' + highs.length + '):'.padEnd(37) + '║');
    for (var i = 0; i < Math.min(highs.length, 2); i++) {
      lines.push('  ║    • ' + (highs[i].label || '').substring(0, 31).padEnd(31) + '║');
    }
  }
  if (criticals.length === 0 && highs.length === 0) {
    lines.push('  ║  ✅ No critical or high risks       ║');
  }
  lines.push('  ╠══════════════════════════════════════╣');
  lines.push('  ║  ' + (risk.recommendation || '').substring(0, 36).padEnd(36) + '║');
  lines.push('  ╚══════════════════════════════════════╝');
  lines.push('  Use --report for full analysis | --json for raw data');
  lines.push('');
  return lines.join('\n');
}

function formatProfessionalReport(cert) {
  const data = cert.data || cert;
  const scoring = cert.scoring || data.scoring || calculateClawScore(data);
  const score = scoring.score || 0;
  const verdict = scoring.verdict || getVerdict(score, scoring.flags || []);
  const flags = scoring.flags || [];
  const riskSummary = scoring.riskSummary || {};
  const isPortraitCut = scoring.isPortraitCut || false;

  const shape = data.shape || 'Unknown';
  const carat = safeParseNumeric(data.carat);
  const color = data.color || 'Unknown';
  const clarity = data.clarity || 'Unknown';
  const depthPct = data.depthPct || 'N/A';
  const tablePct = data.tablePct || 'N/A';
  const girdle = data.girdle || 'N/A';
  const culet = data.culet || 'N/A';
  const polish = data.polish || 'N/A';
  const symmetry = data.symmetry || 'N/A';
  const fluorescence = data.fluorescence || 'None';
  const measurements = data.measurements || 'N/A';
  const reportNumber = data.reportNumber || 'N/A';
  const crownAngle = data.crownAngle || 'N/A';
  const pavilionAngle = data.pavilionAngle || 'N/A';
  const inscription = data.inscription || 'N/A';
  const comments = DataGuard.safeArray(data.comments).join('\n') || 'N/A';

  const isRound = DIAMOND_TYPE.isRoundShape(shape);
  const isFancyColor = isFancyColorExtended(data.color);

  const lines = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('  GIA CERTIFICATE ANALYZER v' + CONFIG.MODULE_VERSION);
  lines.push('  Professional Diamond Assessment Report');
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  lines.push('📋 CERTIFICATE INFORMATION');
  lines.push('───────────────────────────────────────────');
  lines.push('  Report #:      ' + reportNumber);
  lines.push('  Shape:         ' + shape);
  lines.push('  Carat Weight:  ' + (!isNaN(carat) ? carat.toFixed(2) + ' ct' : 'N/A'));
  lines.push('  Color Grade:   ' + color);
  lines.push('  Clarity Grade:  ' + clarity);
  lines.push('  Measurements:   ' + measurements);
  const dpIsNum = !isNaN(parseFloat(depthPct)) && isFinite(depthPct);
  const tpIsNum = !isNaN(parseFloat(tablePct)) && isFinite(tablePct);
  lines.push('  Depth %:        ' + depthPct + (dpIsNum ? '%' : ''));
  lines.push('  Table %:        ' + tablePct + (tpIsNum ? '%' : ''));
  if (isRound || /\d/.test(crownAngle)) lines.push('  Crown Angle:    ' + (/[a-zA-Z]/i.test(String(crownAngle)) ? crownAngle : parseFloat(crownAngle).toFixed(1) + '\u00B0'));
  if (isRound || /\d/.test(pavilionAngle)) lines.push('  Pavilion Angle: ' + (/[a-zA-Z]/i.test(String(pavilionAngle)) ? pavilionAngle : parseFloat(pavilionAngle).toFixed(1) + '\u00B0'));
  lines.push('  Girdle:        ' + girdle);
  lines.push('  Culet:         ' + culet);
  lines.push('  Polish:        ' + polish);
  lines.push('  Symmetry:      ' + symmetry);
  lines.push('  Fluorescence:  ' + fluorescence);
  lines.push('  Inscription:   ' + inscription);
  lines.push('');
  lines.push('📊 SCORING RESULT');
  lines.push('───────────────────────────────────────────');
  lines.push('  Final Score:   ' + score + '/100');
  lines.push('  Verdict:       ' + verdict.label + ' ' + verdict.emoji);
  lines.push('  Grade:         ' + verdict.grade);
  if (scoring.qualityTier) lines.push('  Quality Tier:  ' + scoring.qualityTier);
  if (scoring.dataConfidence) {
    const dc = scoring.dataConfidence;
    lines.push('  Data Confidence: ' + dc.score + '% (' + dc.level + ')');
    lines.push('    ⚠️  Certificate-only assessment. Visual verification recommended.');
    for (const cf of dc.flags) {
      lines.push('    • ' + cf);
    }
  }
  if (riskSummary.totalFlags > 0) {
    lines.push('  Risk Flags:    ' + riskSummary.totalFlags + ' (' + riskSummary.criticalCount + ' critical, ' + riskSummary.highCount + ' high, ' + riskSummary.mediumCount + ' medium)');
  }
  if (riskSummary.recommendation) {
    lines.push('  Recommendation: ' + riskSummary.recommendation);
  }
  lines.push('');

  if (isPortraitCut) {
    lines.push('🔶 PORTRAIT CUT NOTICE');
    lines.push('───────────────────────────────────────────');
    lines.push('  This is a Portrait Cut/Designer Cut stone.');
    lines.push('  Standard depth evaluation has been bypassed.');
    lines.push('  Shallow depth is an artistic feature, not a flaw.');
    lines.push('');
  }

  // Optical diagnostics
  lines.push('📐 OPTICAL DIAGNOSTICS');
  lines.push('───────────────────────────────────────────');
  if (!isPortraitCut) {
    const depthResult = evaluateDepth(depthPct, shape, isFancyColor, data.carat);
    if (depthResult && depthResult.status !== 'bypass') {
      lines.push('  Depth:         ' + depthResult.emoji + ' ' + depthResult.label);
      lines.push('                 ' + depthResult.detail);
    }
  }
  if (!isNaN(carat) && !isNaN(safeParseNumeric(depthPct))) {
    const faceUp = evaluateFaceUpSize(carat, depthPct, shape);
    if (faceUp) {
      const fuLabel = faceUp.label || faceUp.status || '';
      const fuDetail = faceUp.detail || (typeof faceUp === 'string' ? faceUp : '');
      if (fuLabel) lines.push('  Face-up Size:  ' + fuLabel);
      if (fuDetail) lines.push('                 ' + fuDetail);
    }
  }
  const measMatch = String(measurements).match(/(\d+\.?\d*)\s*[xX]\s*(\d+\.?\d*)/);
  if (measMatch) {
    const rl = parseFloat(measMatch[1]), rw = parseFloat(measMatch[2]);
    if (rw > 0) {
      const ratio = rl / rw;
      if (!isNaN(ratio) && isFinite(ratio)) {
        const ratioResult = evaluateRatio(ratio, shape);
        if (ratioResult) {
          lines.push('  Ratio:         ' + ratioResult.label);
          lines.push('                 ' + ratioResult.detail);
        }
      }
    }
  }
  lines.push('');

  // Risk flags
  if (flags.length > 0) {
    lines.push('🚩 RISK FLAGS (' + flags.length + ' detected)');
    lines.push('───────────────────────────────────────────');

    const categorized = classifyFlags(flags);

    if (categorized.critical.length > 0) {
      lines.push('  🔴 CRITICAL:');
      for (const f of categorized.critical) {
        lines.push('    • ' + (f.label || 'Critical Flag'));
        if (f.detail) lines.push('      ' + f.detail.substring(0, 120));
      }
    }
    if (categorized.high.length > 0) {
      lines.push('  🟠 HIGH:');
      for (const f of categorized.high) {
        lines.push('    • ' + (f.label || 'High Risk Flag'));
        if (f.detail) lines.push('      ' + f.detail.substring(0, 120));
      }
    }
    if (categorized.medium.length > 0) {
      lines.push('  🟡 MEDIUM:');
      for (const f of categorized.medium) {
        lines.push('    • ' + (f.label || 'Medium Risk Flag'));
        if (f.detail) lines.push('      ' + f.detail.substring(0, 120));
      }
    }
    if (categorized.info.length > 0 && categorized.info.length <= 8) {
      lines.push('  🔵 INFO:');
      for (const f of categorized.info) {
        const label = f.label || 'Info';
        lines.push('    • ' + label);
      }
    } else if (categorized.info.length > 8) {
      lines.push('  🔵 INFO: ' + categorized.info.length + ' informational flags (see embed for details)');
    }
    lines.push('');
  }

  // Top risks summary
  if (riskSummary.topRisks && riskSummary.topRisks.length > 0) {
    lines.push('⚠️  TOP RISKS');
    lines.push('───────────────────────────────────────────');
    for (const risk of riskSummary.topRisks) {
      lines.push('  • ' + risk.label + ' [' + risk.scoreImpact + ' pts]');
    }
    lines.push('');
  }

  // Comments
  if (comments && comments !== 'N/A') {
    const commentPreview = comments.length > 200 ? comments.substring(0, 200) + '...' : comments;
    lines.push('💬 GIA COMMENTS');
    lines.push('───────────────────────────────────────────');
    lines.push('  ' + commentPreview.split('\n').join('\n  '));
    lines.push('');
  }

  // Treatment detected
  const labGrown = LAB_TREATMENT.detectLabGrown(data);
  if (labGrown && labGrown.isLabGrown) {
    lines.push('⚠️  LAB GROWN DETECTED');
    lines.push('───────────────────────────────────────────');
    lines.push('  Type: ' + labGrown.type);
    lines.push('  This is NOT a natural diamond.');
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════');
  lines.push('  GIA Analyzer v' + CONFIG.MODULE_VERSION + ' | Score: ' + score + '/100');
  lines.push('  Verdict: ' + verdict.label);
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  lines.push('⚠️  CERTIFICATE AUTHENTICITY DISCLAIMER');
  lines.push('───────────────────────────────────────────');
  lines.push('  This assessment assumes the GIA certificate is authentic.');
  lines.push('  Verify at: https://www.gia.edu/report-check');
  if (data.hasSecurityHologram === false) lines.push('  ⚠️ No hologram detected — verify physical security features.');
  if (data.hasQRCode === true) lines.push('  ℹ️ QR code present — scan to verify digital record.');
  lines.push('  If certificate security features appear compromised,');
  lines.push('  disregard this assessment entirely.');
  lines.push('');

  // Purchase recommendation
  if (scoring.purchaseAdvice) {
    const pa = scoring.purchaseAdvice;
    lines.push('💰 PURCHASE RECOMMENDATION');
    lines.push('───────────────────────────────────────────');
    lines.push('  Advice:     ' + pa.purchaseAdvice);
    lines.push('  Negotiate:  ' + pa.negotiation);
    for (const rec of pa.recommendations) {
      lines.push('  • ' + rec);
    }
    lines.push('');
  }

  // Visual verification checklist (cert-only blind spot mitigation)
  if (scoring.dataConfidence && scoring.dataConfidence.level !== 'HIGH') {
    lines.push('📸 VISUAL VERIFICATION CHECKLIST');
    lines.push('───────────────────────────────────────────');
    lines.push('  This assessment is based on certificate data only.');
    lines.push('  For higher confidence, request from seller:');
    const clarity = (data.clarity || '').toUpperCase();
    if (clarity.startsWith('SI') || clarity.startsWith('I'))
      lines.push('  ☐ 10× magnification video of inclusions (confirm eye-clean)');
    if (['D','E','F'].includes((data.color||'').toUpperCase()))
      lines.push('  ☐ Natural daylight photo/video (confirm no brown/gray undertone)');
    if (/strong|very strong/i.test(data.fluorescence || ''))
      lines.push('  ☐ UV light test video (confirm no milky/oily appearance)');
    lines.push('  ☐ ASET or IdealScope image (confirm actual light performance)');
    lines.push('  ☐ 360° rotation video (confirm overall appearance)');
    lines.push('');
  }

  return lines.join('\n');
}

function generateDiscordEmbed(cert) {
  const data = cert.data || cert;
  const scoring = cert.scoring || data.scoring || calculateClawScore(data);
  const score = typeof scoring === 'number' ? scoring : scoring.score;
  const verdict = scoring.verdict || getVerdict(score, scoring.flags || []);
  const flags = scoring.flags || [];
  const riskSummary = scoring.riskSummary || {};
  const purchaseRec = scoring.purchaseAdvice || {};
  const dataConfidence = scoring.dataConfidence || {};
  const qualityTier = scoring.qualityTier || '';

  const shape = data.shape || 'Unknown';
  const carat = safeParseNumeric(data.carat);
  const color = data.color || 'Unknown';
  const clarity = data.clarity || 'Unknown';
  const depthPct = data.depthPct || 'N/A';
  const tablePct = data.tablePct || 'N/A';
  const fluorescence = data.fluorescence || 'None';
  const polish = data.polish || 'N/A';
  const symmetry = data.symmetry || 'N/A';
  const reportNumber = data.reportNumber || 'N/A';
  const girdle = data.girdle || 'N/A';
  const culet = data.culet || 'N/A';
  const crownAngle = data.crownAngle || 'N/A';
  const pavilionAngle = data.pavilionAngle || 'N/A';
  const measurements = data.measurements || 'N/A';
  const isFancy = isFancyColorExtended(data.color);

  const categorized = classifyFlags(flags);
  const verdictColor = verdict.color || CONFIG.COLORS.DEFAULT;
  const verdictEmoji = verdict.emoji || '';
  const dpIsNum = !isNaN(parseFloat(depthPct)) && isFinite(depthPct);
  const tpIsNum = !isNaN(parseFloat(tablePct)) && isFinite(tablePct);

  var fields = [];

  // ── Section 1: Gem Specifications ──
  var specs = [];
  specs.push('**Shape:** ' + shape);
  specs.push('**Carat:** ' + (!isNaN(carat) ? carat.toFixed(2) + ' ct' : 'N/A'));
  specs.push('**Color:** ' + color + '  |  **Clarity:** ' + clarity);
  specs.push('**Depth:** ' + depthPct + (dpIsNum ? '%' : '') + '  |  **Table:** ' + tablePct + (tpIsNum ? '%' : ''));
  if (crownAngle && crownAngle !== 'N/A' && !/[a-zA-Z]/.test(String(crownAngle))) specs.push('**Crown Angle:** ' + parseFloat(crownAngle).toFixed(1) + '\u00B0  |  **Pavilion Angle:** ' + (/[a-zA-Z]/.test(String(pavilionAngle)) ? pavilionAngle : parseFloat(pavilionAngle).toFixed(1) + '\u00B0'));
  specs.push('**Polish:** ' + polish + '  |  **Symmetry:** ' + symmetry);
  specs.push('**Fluor:** ' + fluorescence + '  |  **Girdle:** ' + girdle);
  if (culet && culet !== 'N/A' && culet !== 'None') specs.push('**Culet:** ' + culet);
  specs.push('**Report:** ' + reportNumber);
  if (measurements && measurements !== 'N/A') specs.push('**Measurements:** ' + measurements);
  // Compute ratio from measurements
  var measMatch = String(data.measurements || '').match(/(\d+\.?\d*)\s*[xX\-–]\s*(\d+\.?\d*)/);
  if (measMatch) {
    var rl = parseFloat(measMatch[1]), rw = parseFloat(measMatch[2]);
    if (rw > 0) {
      var ratioVal = rl / rw;
      if (ratioVal && !isNaN(ratioVal) && isFinite(ratioVal)) specs.push('**L/W Ratio:** ' + ratioVal.toFixed(2));
    }
  }
  fields.push({ name: '\ud83d\udc8e Gem Specifications', value: specs.join('\n').substring(0, 1024), inline: false });

  // ── Section 2: Score & Verdict ──
  var scoreLines = [];
  scoreLines.push('**Score:** ' + score + '/100  |  **Verdict:** ' + verdict.label + ' ' + verdictEmoji);
  if (dataConfidence.score) {
    scoreLines.push('**Confidence:** ' + dataConfidence.score + '% (' + (dataConfidence.level || 'N/A') + ')');
  }
  if (qualityTier) scoreLines.push('**Tier:** ' + qualityTier);
  fields.push({ name: '\ud83d\udcca Score & Verdict', value: scoreLines.join('\n').substring(0, 1024), inline: false });

  // ── Section 3: Confidence Range ──
  if (dataConfidence.flags && dataConfidence.flags.length > 0) {
    var confLines = dataConfidence.flags.map(function(f) { return '\u2022 ' + f; });
    fields.push({ name: '\ud83d\udd0d Data Confidence Notes', value: confLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 4: Color Analysis ──
  var colorLines = [];
  var fancyFlags = flags.filter(function(f) { return f.label && /fancy|color-first|rarity|secondary hue|padparadscha/i.test(f.label); });
  var whiteColorFlags = flags.filter(function(f) { return f.label && /color ceiling|colorless|near colorless|champagne|cognac|honey/i.test(f.label); });
  if (isFancy && fancyFlags.length > 0) {
    colorLines = fancyFlags.slice(0, 6).map(function(f) {
      return '\u2022 **' + (f.label || '') + '** ' + (f.scoreImpact && f.scoreImpact !== 0 ? '[' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '');
    });
  } else if (!isFancy && whiteColorFlags.length > 0) {
    colorLines = whiteColorFlags.slice(0, 4).map(function(f) {
      return '\u2022 **' + (f.label || '') + '** ' + (f.scoreImpact && f.scoreImpact !== 0 ? '[' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '');
    });
  }
  if (colorLines.length > 0) {
    fields.push({ name: '\ud83c\udfa8 ' + (isFancy ? 'Fancy Color Analysis' : 'Color Analysis'), value: colorLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 5: Optical Analysis ──
  var opticalLines = [];
  var opticalFlags = flags.filter(function(f) {
    return f.label && /crown|pavilion|depth|table|proportion|super ideal|hearts.*arrow|bow.?tie|spread|face.?up|ratio|symmetry|facet|lustre|AGS|pairing/i.test(f.label) &&
      !/ceiling|color|fluor/i.test(f.label);
  });
  if (opticalFlags.length > 0) {
    opticalLines = opticalFlags.slice(0, 8).map(function(f) {
      return '\u2022 **' + (f.label || '') + '** ' + (f.scoreImpact && f.scoreImpact !== 0 ? '[' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '');
    });
  }
  // Always add basic proportion line
  var proportionLine = '';
  if (dpIsNum && tpIsNum) proportionLine = 'Depth ' + depthPct + '% / Table ' + tablePct + '%';
  if (crownAngle && crownAngle !== 'N/A' && !/[a-zA-Z]/.test(String(crownAngle))) proportionLine += ' / CA ' + parseFloat(crownAngle).toFixed(1) + '\u00B0';
  if (pavilionAngle && pavilionAngle !== 'N/A' && !/[a-zA-Z]/.test(String(pavilionAngle))) proportionLine += ' / PA ' + parseFloat(pavilionAngle).toFixed(1) + '\u00B0';
  if (proportionLine) opticalLines.unshift(proportionLine);
  if (opticalLines.length > 0) {
    fields.push({ name: '\ud83d\udd2c Optical Analysis', value: opticalLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 6: Fluorescence ──
  var fluorFlags = flags.filter(function(f) { return f.label && /fluor|phosphor/i.test(f.label); });
  if (fluorFlags.length > 0) {
    var fluorLines = fluorFlags.slice(0, 4).map(function(f) {
      return '\u2022 **' + (f.label || '') + '** ' + (f.scoreImpact && f.scoreImpact !== 0 ? '[' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '');
    });
    fields.push({ name: '\ud83d\udca1 Fluorescence Analysis', value: fluorLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 7: Inclusion & Clarity ──
  var incFlags = flags.filter(function(f) { return f.label && /inclusion|clarity|cloud|feather|crystal|eye.clean|SI|luster|sub.?grade|graining|bearding|natural|twinn|etch|bruise/i.test(f.label); });
  if (incFlags.length > 0) {
    var incLines = incFlags.slice(0, 6).map(function(f) {
      return '\u2022 **' + (f.label || '') + '** ' + (f.scoreImpact && f.scoreImpact !== 0 ? '[' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '');
    });
    fields.push({ name: '\ud83d\udd0d Inclusion & Clarity', value: incLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 8: Critical Flags ──
  if (categorized.critical.length > 0) {
    var critLines = categorized.critical.slice(0, 8).map(function(f) {
      var impact = (f.scoreImpact && f.scoreImpact !== 0) ? ' [' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '';
      return '\u2022 **' + (f.label || 'Critical') + '**' + impact;
    });
    fields.push({ name: '\ud83d\udd34 CRITICAL (' + categorized.critical.length + ')', value: critLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 9: High Risk ──
  if (categorized.high.length > 0) {
    var highLines = categorized.high.slice(0, 8).map(function(f) {
      var impact = (f.scoreImpact && f.scoreImpact !== 0) ? ' [' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '';
      return '\u2022 **' + (f.label || 'High') + '**' + impact;
    });
    fields.push({ name: '\ud83d\udfe0 HIGH Risk (' + categorized.high.length + ')', value: highLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 10: Medium & Low ──
  var medLowFlags = (categorized.medium || []).concat(categorized.low || []);
  if (medLowFlags.length > 0) {
    var medLowLines = medLowFlags.slice(0, 8).map(function(f) {
      var impact = (f.scoreImpact && f.scoreImpact !== 0) ? ' [' + (f.scoreImpact > 0 ? '+' : '') + f.scoreImpact + ']' : '';
      return '\u2022 ' + (f.label || '') + impact;
    });
    fields.push({ name: '\ud83d\udfe1\u26aa Medium & Low (' + medLowFlags.length + ')', value: medLowLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 11: Positive Highlights ──
  var positiveFlags = flags.filter(function(f) {
    return (f.severity === 'SUPER' || f.severity === 'SUPER_IDEAL' || f.severity === 'SUPER_FIND' || f.severity === 'INFO') &&
      f.scoreImpact > 0;
  });
  if (positiveFlags.length > 0) {
    var posLines = positiveFlags.slice(0, 6).map(function(f) {
      return '\u2728 **' + (f.label || '') + '** [+' + f.scoreImpact + ']';
    });
    fields.push({ name: '\u2728 Positive Highlights (' + positiveFlags.length + ')', value: posLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Section 12: Purchase Recommendation ──
  if (purchaseRec.purchaseAdvice || purchaseRec.recommendations) {
    var recLines = [];
    if (purchaseRec.purchaseAdvice) recLines.push('**Advice:** ' + purchaseRec.purchaseAdvice);
    if (purchaseRec.negotiation) recLines.push('**Negotiation:** ' + purchaseRec.negotiation);
    if (purchaseRec.recommendations && purchaseRec.recommendations.length > 0) {
      recLines.push('');
      recLines = recLines.concat(purchaseRec.recommendations.slice(0, 4).map(function(r) { return '\u2022 ' + r; }));
    }
    fields.push({ name: '\ud83d\udcb0 Purchase Recommendation', value: recLines.join('\n').substring(0, 1024), inline: false });
  }

  // ── Build embed ──
  var embed = {
    title: verdictEmoji + ' GIA Analysis — ' + verdict.label,
    color: verdictColor,
    fields: fields.slice(0, 25), // Discord limit: 25 fields max
    footer: { text: 'GIA Analyzer v' + CONFIG.MODULE_VERSION + '  |  ' + new Date().toISOString().split('T')[0] },
    timestamp: new Date().toISOString()
  };

  return embed;
}

function sendToDiscord(embed, customChannelId) {
  return new Promise(function(resolve, reject) {
    const channelId = customChannelId || CONFIG.DISCORD_CHANNEL_ID;
    if (!channelId) {
      reject(new Error('No Discord channel ID configured'));
      return;
    }

    // Read Discord token from OpenClaw config (same approach as system_check_generator)
    let apiKey = null;
    try {
      const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        apiKey = config.channels?.discord?.token;
      }
    } catch (_) {}

    if (!apiKey) {
      apiKey = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_WEBHOOK_URL;
    }

    if (!apiKey) {
      reject(new Error('No Discord API key found. Check openclaw.json discord.token or set DISCORD_BOT_TOKEN'));
      return;
    }

    const isWebhook = apiKey.includes('webhook') || apiKey.includes('/api/webhooks/');
    const payload = JSON.stringify({
      embeds: [embed],
      allowed_mentions: { parse: [] }
    });

    const isToken = !isWebhook;
    const url = isToken
      ? 'https://discord.com/api/v10/channels/' + channelId + '/messages'
      : apiKey;

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GIA-Analyzer/' + CONFIG.MODULE_VERSION
      },
      timeout: CONFIG.DISCORD_REQ_TIMEOUT || 15000
    };

    if (isToken) {
      options.headers['Authorization'] = 'Bot ' + apiKey;
    }

    const req = https.request(options, function(res) {
      let body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode, body: body });
        } else {
          resolve({ success: false, statusCode: res.statusCode, body: body, error: 'Discord API returned ' + res.statusCode });
        }
      });
    });

    req.on('error', function(err) { reject(err); });
    req.setTimeout(CONFIG.DISCORD_REQ_TIMEOUT || 15000, function() {
      req.destroy();
      reject(new Error('Discord request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

// ============================================================================
// SECTION 8: OCR & PARSING (v17.1.0)
// ============================================================================

const GIA_PROMPT = `Extract ALL details from this GIA diamond certificate image with ULTRA-HIGH precision.
Return ONLY valid JSON. Use null for missing fields.

CRITICAL RULES:
- For color grade: If the certificate shows "Fancy Vivid Yellow" write EXACTLY "Fancy Vivid Yellow" — do NOT abbreviate or summarize. Distinguish "Fancy Vivid" (capitalized, full) from "Fancy Intense", "Fancy Deep", "Fancy Dark", "Fancy Light", "Fancy", "Faint", "Very Light", "Light". Never write just "Yellow" when the certificate says "Fancy Vivid Yellow".
- For clarity grade: Distinguish IF (Internally Flawless) from I1 (Included 1). IF has two letters, I1 has letter I + number 1. SI1, SI2 have letters S + I + number. Never confuse VVS1 with SI, SI is always just SI1 or SI2.
- For measurements: Always include decimal with 2 decimal places if shown. Match exactly what appears on the certificate.
- For report number: Include the full GIA report number exactly as shown, including any leading "GIA" prefix. Format: GIA ########## (10 digits) or GIA ####### (7-9 digits for legacy).
- For comments, key_to_symbols, and additional_comments: Extract ALL text precisely, preserving original formatting where possible. Preserve original text including abbreviations, symbols, and special characters.
- KEY TO SYMBOLS ORDER MATTERS: List inclusions in the EXACT order they appear on the certificate (first = most significant).
- For proportions diagram: Extract crownHeightPct and pavilionDepthPct from the diagram if visible. These are separate from crownAngle/pavilionAngle.
- For inclusion plot: Describe the plot in inclusionPlotDescription. Note how many red (internal) vs green (surface) marks, approximate size of largest mark relative to table, and any overlapping/clustered marks.
- For security features: Note in hasSecurityHologram if a hologram seal is visible. Note in hasQRCode if a QR code is present. Note in isDigitalCert if this appears to be a digital/PDF certificate (not a photo of paper).
- REPORT TYPE: Identify the certificate type from the header. "GIA Diamond Grading Report" (full), "GIA Diamond Dossier" (compact, no inclusion plot), "Colored Diamond Grading Report" (fancy color), or "Laboratory-Grown Diamond Report" (synthetic). Put the exact header text in reportType.
- DATES: There are TWO dates on GIA certs. gradingDate = when the lab completed grading. issueDate = when report was printed/signed. They may differ by months. Extract both separately.
- PROPORTIONS RANGE: Crown angle and pavilion angle are often shown as RANGES (e.g. "33.5° - 35.0°"). Extract crownAngleMin, crownAngleMax, pavilionAngleMin, pavilionAngleMax. If only one value shown, use same for min and max.
- GRADING LAB: Note which GIA lab issued the report: "GIA New York", "GIA Carlsbad", "GIA Mumbai", "GIA Hong Kong", "GIA Tokyo", or other. Extract the full lab name to gradingLab.

Return this JSON structure:
{
  "reportNumber": "GIA 1234567890",
  "shape": "Round Brilliant",
  "measurements": "6.50 x 6.53 x 4.00 mm",
  "carat": "1.01",
  "color": "D",
  "clarity": "VVS2",
  "cutGrade": "Excellent",
  "polish": "Excellent",
  "symmetry": "Excellent",
  "fluorescence": "None",
  "girdle": "Medium to Slightly Thick",
  "culet": "None",
  "depthPct": "61.5",
  "tablePct": "57",
  "crownAngle": "34.5",
  "pavilionAngle": "40.8",
  "crownAngleMin": "33.5",
  "crownAngleMax": "35.0",
  "pavilionAngleMin": "40.6",
  "pavilionAngleMax": "41.0",
  "reportType": "GIA Diamond Grading Report",
  "gradingDate": "2024-01-10",
  "issueDate": "2024-01-15",
  "gradingLab": "GIA New York",
  "inscription": "GIA 1234567890",
  "comments": ["Additional clouds not shown.", "Surface graining is not shown."],
  "keyToSymbols": ["Crystal", "Feather", "Cloud"],
  "additionalComments": null,
  "clarityCharacteristics": "Crystal, Feather, Cloud",
  "cutGradeComments": null,
  "proportions": null,
  "origin": null,
  "reportDate": "2024-01-15",
  "laserInscription": "GIA 1234567890",
  "treatment": null,
  "fluorescenceIntensity": null,
  "fluorescenceColor": null,
  "girdleCondition": null,
  "girdlePercent": null,
  "starLength": null,
  "lowerHalfLength": null,
  "crownHeightPct": null,
  "pavilionDepthPct": null,
  "inclusionPlotDescription": null,
  "hasSecurityHologram": null,
  "hasQRCode": null,
  "isDigitalCert": null
}`;

function extractField(text, pattern, groupIndex) {
  if (!text || !pattern) return null;
  const idx = groupIndex !== undefined ? groupIndex : 1;
  let re;
  if (pattern instanceof RegExp) {
    re = pattern;
  } else {
    try {
      re = new RegExp(pattern, 'i');
    } catch (e) {
      return null;
    }
  }
  const match = text.match(re);
  return match && match[idx] ? match[idx].trim() : null;
}

function extractMultilineField(text, pattern) {
  if (!text || !pattern) return null;
  let re;
  if (pattern instanceof RegExp) {
    re = pattern;
  } else {
    try {
      re = new RegExp(pattern, 'im');
    } catch (e) {
      return null;
    }
  }
  const match = text.match(re);
  if (!match || !match[1]) return null;
  const content = match[1].trim();
  const lines = content.split(/[\n\r]+/).filter(function(l) { return l.trim(); });
  return lines;
}

function parseGIACertificateText(text) {
  if (!text || typeof text !== 'string') return null;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateParsedData(parsed);
    }
  } catch (_) {}

  // Fallback: structured text parsing
  const data = {};

  data.reportNumber = extractField(text, /report\s*(?:number|no|#)[:\s]*([A-Z]*\s*\d{7,12})/i) ||
    extractField(text, /GIA\s*(\d{7,12})/i) || null;

  data.shape = extractField(text, /shape\s*(?:and\s*cut\s*style)?[:\s]*(.+?)(?:\n|$|Report|Measure|Carat)/i) || null;

  data.measurements = extractField(text, /measurements[:\s]*(.+?)(?:\n|$|Carat|Color|Clarity)/i) || null;

  data.carat = extractField(text, /(?:carat\s*weight|weight)[:\s]*(\d+\.?\d*)\s*(?:carat|ct)?/i) || null;

  data.color = extractField(text, /color\s*(?:grade)?[:\s]*(.+?)(?:\n|$|Clarity|Cut)/i);
  if (data.color) {
    const fcMatch = data.color.match(/(Fancy\s*(?:Vivid|Intense|Deep|Dark|Light|Fancy)\s+[A-Za-z]+)/i);
    if (fcMatch) {
      data.color = fcMatch[1];
    } else {
      const simpleMatch = data.color.match(/([DEFGHIJKLMNOPQRSTUVWXYZ])\b/i);
      if (simpleMatch) data.color = simpleMatch[1];
    }
  }

  data.clarity = extractField(text, /clarity\s*(?:grade)?[:\s]*(IF|I1|I2|I3|FL|VVS1|VVS2|VS1|VS2|SI1|SI2)/i) || null;

  data.cutGrade = extractField(text, /cut\s*(?:grade)?[:\s]*(Excellent|Very\s*Good|Good|Fair|Poor)/i) || null;

  data.polish = extractField(text, /polish[:\s]*(Excellent|Very\s*Good|Good|Fair|Poor)/i) || null;

  data.symmetry = extractField(text, /symmetry[:\s]*(Excellent|Very\s*Good|Good|Fair|Poor)/i) || null;

  data.fluorescence = extractField(text, /fluorescence[:\s]*(.+?)(?:\n|$|Girdle|Culet)/i) || null;

  data.girdle = extractField(text, /girdle[:\s]*(.+?)(?:\n|$|Culet|Polish)/i) || null;

  data.culet = extractField(text, /culet[:\s]*(.+?)(?:\n|$|Polish|Symmetry)/i) || null;

  data.depthPct = extractField(text, /(?:total\s*)?depth[:\s]*(\d+\.?\d*)\s*%/i) || null;

  data.tablePct = extractField(text, /table[:\s]*(\d+\.?\d*)\s*%/i) || null;

  data.crownAngle = extractField(text, /crown\s*(?:angle)?[:\s]*(\d+\.?\d*)/i) || null;

  data.pavilionAngle = extractField(text, /pavilion\s*(?:angle)?[:\s]*(\d+\.?\d*)/i) || null;

  data.laserInscription = extractField(text, /laser\s*inscription[:\s]*(GIA\s*\d{7,12})/i) || null;

  // Additional inscription (beyond report number)
  const rawInscription = extractField(text, /(?:laser\s*)?inscription[:\s]*(.+?)(?:\n|$)/i);
  if (rawInscription) {
    data.inscription = rawInscription;
    const reportDigits = (data.reportNumber || '').replace(/\D/g, '');
    const remaining = rawInscription.replace(new RegExp('GIA\\s*' + reportDigits, 'i'), '').replace(/[,;]/g, ' ').trim();
    data.additionalInscription = remaining || null;
  } else {
    data.inscription = null;
    data.additionalInscription = null;
  }

  data.comments = extractMultilineField(text, /comments[\s\S]*?\n([\s\S]*?)(?:\n\s*\n|\n[A-Z]|\nKey\s*to|\nAdditional|$)/i) || [];
  if (data.comments.length === 0) {
    const singleComment = extractField(text, /comments?[:\s]*(.+?)(?:\n|$)/i);
    if (singleComment) data.comments = [singleComment];
  }

  const keySymbolsMatch = text.match(/key\s*to\s*symbols?[:\s]*([\s\S]*?)(?:\n\s*\n|\n[A-Z]|\nComments|\nAdditional|$)/i);
  if (keySymbolsMatch && keySymbolsMatch[1]) {
    const ktsText = keySymbolsMatch[1].trim();
    data.keyToSymbols = ktsText.split(/[,;*•·\n]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  } else {
    data.keyToSymbols = [];
  }

  data.clarityCharacteristics = extractField(text, /clarity\s*characteristics?[:\s]*(.+?)(?:\n|$)/i) || null;

  data.reportDate = extractField(text, /(?:date|issued)[:\s]*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i) || null;

  data.laserInscription = extractField(text, /laser\s*inscription[:\s]*(GIA\s*\d{7,12})/i) || null;

  // OCR corruption detection
  const garbledCount = (text.match(RE.GARBLED_TEXT) || []).length;
  const repeatedCharCount = (text.match(RE.REPEATED_CHARS) || []).length;
  if (garbledCount > 5 || repeatedCharCount > 3) {
    data._hasDataCorruption = true;
  }

  return validateParsedData(data);
}

function validateParsedData(data) {
  if (!data) return null;

  const result = {};

  result.reportNumber = String(data.reportNumber || '').trim() || null;
  result.shape = String(data.shape || '').trim() || null;
  result.measurements = String(data.measurements || '').trim() || null;

  const carat = parseCaratFraction(data.carat);
  result.carat = !isNaN(carat) && carat > 0 ? String(carat) : null;

  result.color = String(data.color || '').trim().toUpperCase();
  if (result.color) {
    const fcFixed = result.color.replace(/^(Fancy\s*)Fancy\s+/i, 'Fancy ');
    const vividFixed = fcFixed.replace(/\b(Vivy|Inrse)\b/gi, function(m) {
      return m.length <= 4 ? 'Vivid' : 'Intense';
    });
    result.color = vividFixed;
  } else {
    result.color = null;
  }

  result.clarity = String(data.clarity || '').trim().toUpperCase();
  // Normalize full-word clarity grades to abbreviations
  result.clarity = result.clarity
    .replace(/INTERNALLY\s*FLAWLESS/i, 'IF')
    .replace(/\bFLAWLESS\b/i, 'FL')
    .replace(/^IF$/i, 'IF');
  if (result.clarity && !/^(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3)$/.test(result.clarity)) {
    const fixed = result.clarity.replace(/11/g, 'I1').replace(/S11/g, 'SI1').replace(/S12/g, 'SI2');
    if (/^(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2|I3)$/.test(fixed)) {
      result.clarity = fixed;
    }
  }

  result.cutGrade = String(data.cutGrade || '').trim() || null;
  result.polish = String(data.polish || '').trim() || null;
  result.symmetry = String(data.symmetry || '').trim() || null;
  result.fluorescence = String(data.fluorescence || '').trim() || null;

  result.girdle = String(data.girdle || '').trim() || null;
  result.culet = String(data.culet || '').trim() || null;

  result.depthPct = typeof safeParseNumeric(data.depthPct) === 'number' ? String(safeParseNumeric(data.depthPct)) : null;
  result.tablePct = typeof safeParseNumeric(data.tablePct) === 'number' ? String(safeParseNumeric(data.tablePct)) : null;
  result.crownAngle = typeof safeParseNumeric(data.crownAngle) === 'number' ? String(safeParseNumeric(data.crownAngle)) : null;
  result.pavilionAngle = typeof safeParseNumeric(data.pavilionAngle) === 'number' ? String(safeParseNumeric(data.pavilionAngle)) : null;

  result.inscription = String(data.inscription || '').trim() || null;

  result.comments = Array.isArray(data.comments) ? data.comments.map(function(c) { return String(c || '').trim(); }).filter(Boolean) : (data.comments ? [String(data.comments).trim()] : []);

  result.keyToSymbols = Array.isArray(data.keyToSymbols) ? data.keyToSymbols.map(function(s) { return String(s || '').trim(); }).filter(Boolean) : (data.keyToSymbols ? [String(data.keyToSymbols).trim()] : []);

  result.clarityCharacteristics = String(data.clarityCharacteristics || '').trim() || null;
  result.reportDate = String(data.reportDate || '').trim() || null;
  result.laserInscription = String(data.laserInscription || '').trim() || null;
  result.origin = String(data.origin || '').trim() || null;
  result.treatment = String(data.treatment || '').trim() || null;
  result.fluorescenceIntensity = String(data.fluorescenceIntensity || '').trim() || null;
  result.fluorescenceColor = String(data.fluorescenceColor || '').trim() || null;
  result.girdleCondition = String(data.girdleCondition || '').trim() || null;
  result.girdlePercent = typeof safeParseNumeric(data.girdlePercent) === 'number' ? String(safeParseNumeric(data.girdlePercent)) : null;
  result.starLength = typeof safeParseNumeric(data.starLength) === 'number' ? String(safeParseNumeric(data.starLength)) : null;
  result.lowerHalfLength = typeof safeParseNumeric(data.lowerHalfLength) === 'number' ? String(safeParseNumeric(data.lowerHalfLength)) : null;
  result.crownHeightPct = typeof safeParseNumeric(data.crownHeightPct) === 'number' ? String(safeParseNumeric(data.crownHeightPct)) : null;
  result.pavilionDepthPct = typeof safeParseNumeric(data.pavilionDepthPct) === 'number' ? String(safeParseNumeric(data.pavilionDepthPct)) : null;
  result.crownAngleMin = typeof safeParseNumeric(data.crownAngleMin) === 'number' ? String(safeParseNumeric(data.crownAngleMin)) : null;
  result.crownAngleMax = typeof safeParseNumeric(data.crownAngleMax) === 'number' ? String(safeParseNumeric(data.crownAngleMax)) : null;
  result.pavilionAngleMin = typeof safeParseNumeric(data.pavilionAngleMin) === 'number' ? String(safeParseNumeric(data.pavilionAngleMin)) : null;
  result.pavilionAngleMax = typeof safeParseNumeric(data.pavilionAngleMax) === 'number' ? String(safeParseNumeric(data.pavilionAngleMax)) : null;
  result.reportType = String(data.reportType || '').trim() || null;
  result.gradingLab = String(data.gradingLab || '').trim() || null;
  result.gradingDate = String(data.gradingDate || '').trim() || null;
  result.issueDate = String(data.issueDate || '').trim() || null;
  result.inclusionPlotDescription = String(data.inclusionPlotDescription || '').trim() || null;
  result.hasSecurityHologram = data.hasSecurityHologram === true || data.hasSecurityHologram === 'true' || false;
  result.hasQRCode = data.hasQRCode === true || data.hasQRCode === 'true' || false;
  result.isDigitalCert = data.isDigitalCert === true || data.isDigitalCert === 'true' || false;
  result.proportions = data.proportions || null;
  result.cutGradeComments = data.cutGradeComments ? String(data.cutGradeComments).trim() : null;
  result.additionalComments = Array.isArray(data.additionalComments) ? data.additionalComments : (data.additionalComments ? [String(data.additionalComments).trim()] : null);

  result._hasDataCorruption = data._hasDataCorruption === true || false;

  return result;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.pdf': 'application/pdf'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function loadMinimaxApiKey() {
  let apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    try {
      if (fs.existsSync(AUTH_PROFILES)) {
        const data = JSON.parse(fs.readFileSync(AUTH_PROFILES, 'utf8'));
        const profile = data.profiles?.['minimax:default'];
        if (profile?.type === 'api_key' && profile?.key) {
          apiKey = profile.key.trim();
        }
      }
    } catch (_) {}
  }
  return apiKey;
}

function describeImageWithMinimaxVLM(imagePath, customPrompt) {
  return new Promise(function(resolve, reject) {
    const apiKey = loadMinimaxApiKey();
    if (!apiKey) {
      reject(new Error('MINIMAX_API_KEY not found. Set environment variable or configure in auth-profiles.json'));
      return;
    }

    let imageBuffer;
    try {
      imageBuffer = fs.readFileSync(imagePath);
    } catch (e) {
      reject(new Error('Error reading image: ' + e.message));
      return;
    }
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    const actualMime = mimeMap[ext] || 'image/jpeg';
    const imageDataUrl = 'data:' + actualMime + ';base64,' + base64Image;
    const prompt = customPrompt || GIA_PROMPT;

    const payload = JSON.stringify({
      prompt: prompt,
      image_url: imageDataUrl
    });

    const options = {
      hostname: 'api.minimax.io',
      path: '/v1/coding_plan/vlm',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'MM-API-Source': 'OpenClaw',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60000
    };

    const req = https.request(options, function(res) {
      let body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try {
          const result = JSON.parse(body);
          if (result.content && typeof result.content === 'string') {
            resolve(result.content);
          } else {
            const baseResp = result.base_resp;
            if (baseResp && baseResp.status_code !== 0) {
              reject(new Error('MiniMax VLM API error: ' + (baseResp.status_msg || 'Unknown error')));
            } else {
              reject(new Error('Unexpected MiniMax VLM response: ' + body.substring(0, 500)));
            }
          }
        } catch (e) {
          reject(new Error('Failed to parse MiniMax VLM response: ' + e.message));
        }
      });
    });

    req.on('error', function(err) {
      reject(err);
    });

    req.on('timeout', function() {
      req.destroy();
      reject(new Error('MiniMax API request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

// ============================================================================
// SECTION 9: MAIN & EXPORTS (v17.1.0)
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('GIA Certificate Analyzer v' + CONFIG.MODULE_VERSION);
    console.log('Usage: node gia_cert_analyzer_refactored_v17.1.0.js <image_or_pdf> [--json] [--report] [--discord] [--no-ocr]');
    console.log('');
    console.log('Options:');
    console.log('  --json      Output raw JSON (calculateClawScore return)');
    console.log('  --report    Output plain-text professional report only');
    console.log('  Default     Quick summary + auto-push to Discord webhook');
    console.log('  --no-ocr    Skip AI OCR, parse text input instead');
    console.log('  --test      Run automated test suite');
    console.log('  --help      Show this help');
    return;
  }

  const inputPath = args[0];
  const outputJson = args.includes('--json');
  const outputReport = args.includes('--report');
  const sendDiscord = !outputJson && !outputReport;  // Default: push to Discord
  const noOcr = args.includes('--no-ocr');
  const runTests = args.includes('--test');

  if (runTests) {
    var fixturesPath = path.join(__dirname, 'test_fixtures.json');
    if (!fs.existsSync(fixturesPath)) {
      console.error('Error: Test fixtures not found at ' + fixturesPath);
      console.error('Create test_fixtures.json in the same directory as the analyzer.');
      process.exit(1);
    }
    var allFixtures;
    try {
      allFixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
    } catch (e) {
      console.error('Error reading test fixtures:', e.message);
      process.exit(1);
    }
    var total = 0, passed = 0, failed = 0, crashed = 0;
    var failures = [];

    function runOneTest(category, fixture) {
      total++;
      var name = fixture.name;
      var data = fixture.data;
      var errors = [];
      var scoring;
      try {
        scoring = calculateClawScore(data);
      } catch (e) {
        crashed++;
        failures.push({ category: category, name: name, type: 'CRASH', detail: e.message || String(e) });
        return;
      }
      var score = scoring.score;
      var verdict = scoring.verdict;
      var flags = scoring.flags || [];
      if (typeof score !== 'number' || isNaN(score) || !isFinite(score)) errors.push('Score NaN/Infinity: ' + score);
      if (score < 0 || score > 100) errors.push('Score out of range: ' + score);
      if (!verdict || !verdict.grade) errors.push('Missing verdict');
      var isFancy = isFancyColorExtended(data.color);
      if (isFancy) {
        var whiteLeak = flags.filter(function(f) { return f.label && /color ceiling|colorless|near colorless/i.test(f.label); });
        if (whiteLeak.length > 0) errors.push('Fancy has white-only flag');
      }
      for (var i = 0; i < flags.length; i++) {
        var si = flags[i].scoreImpact;
        if (si !== undefined && si !== null && (typeof si !== 'number' || isNaN(si))) errors.push('Flag scoreImpact NaN: ' + flags[i].label);
      }
      if (scoring.dataConfidence && scoring.dataConfidence.score != null && (scoring.dataConfidence.score < 25 || scoring.dataConfidence.score > 100)) {
        errors.push('Bad confidence: ' + scoring.dataConfidence.score);
      }
      if (!scoring.qualityTier) errors.push('Missing qualityTier');
      if (errors.length > 0) {
        failed++;
        failures.push({ category: category, name: name, type: 'FAIL', detail: errors.join(' | '), score: score, verdict: verdict.grade });
      } else {
        passed++;
      }
    }

    console.log('═'.repeat(55));
    console.log('GIA ANALYZER — AUTOMATED TEST SUITE (46 fixtures)');
    console.log('═'.repeat(55));
    var cats = Object.keys(allFixtures);
    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      var fixtures = allFixtures[cat];
      if (!Array.isArray(fixtures)) continue;
      var before = passed + failed + crashed;
      for (var i = 0; i < fixtures.length; i++) runOneTest(cat, fixtures[i]);
      var after = passed + failed + crashed;
      var catPassed = passed - (before - (passed + failed + crashed - after));
      // Simpler: count within run
      var cp = 0, cf = 0, cc = 0;
      for (var j = 0; j < fixtures.length; j++) {
        var r = true; try { r = !!calculateClawScore(fixtures[j].data).score; } catch(e) { r = false; }
        // Actually let me just print summary per category
      }
      var catOk = failures.filter(function(f) { return f.category === cat; }).length === 0;
      console.log('  ' + (catOk ? '✅' : '❌') + ' ' + cat + ' (' + fixtures.length + ' fixtures)');
    }
    console.log('');
    console.log('═'.repeat(55));
    console.log('TOTAL: ' + total + ' | PASS: ' + passed + ' | FAIL: ' + failed + ' | CRASH: ' + crashed);
    console.log('═'.repeat(55));
    if (failures.length > 0) {
      console.log('');
      console.log('── FAILURES (' + failures.length + ') ──');
      for (var f = 0; f < failures.length; f++) {
        var fail = failures[f];
        console.log('  ❌ [' + fail.category + '] ' + fail.name);
        console.log('     ' + fail.detail);
      }
      console.log('');
    }
    console.log(failed + crashed === 0 ? '🏆 ALL TESTS PASSED' : '⚠️  ' + (failed + crashed) + ' FAILURES');
    process.exit(failed + crashed === 0 ? 0 : 1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error('Error: File not found: ' + inputPath);
    process.exit(1);
  }

  function processData(rawData) {
    const parsed = parseGIACertificateText(rawData);
    if (!parsed) {
      console.error('Error: Failed to parse certificate data');
      process.exit(1);
    }

    const scoring = calculateClawScore(parsed);
    const report = formatProfessionalReport({ data: parsed, scoring: scoring });
    const embed = generateDiscordEmbed({ data: parsed, scoring: scoring });

    if (outputJson) {
      console.log(JSON.stringify({ data: parsed, scoring: scoring }, null, 2));
    } else if (outputReport) {
      console.log(report);
    } else {
      // Default: concise summary (1 screen)
      console.log(formatQuickSummary(parsed, scoring));
    }

    if (sendDiscord) {
      sendToDiscord(embed).then(function(res) {
        if (res && res.success) {
          console.log('\n✅ Sent to Discord successfully.');
        } else {
          console.error('\nFailed to send to Discord:', res && res.body);
        }
      }).catch(function(err) {
        console.error('\nDiscord send error:', err.message);
      });
    }
  }

  const mimeType = getMimeType(inputPath);

  if (mimeType === 'application/pdf') {
    try {
      const outputDir = path.dirname(inputPath);
      const outputBase = path.basename(inputPath, path.extname(inputPath));
      const outputPng = path.join(outputDir, outputBase + '-1.png');

      execFileSync(PDF_CONFIG.command, [
        '-r', String(PDF_CONFIG.dpi),
        '-png',
        '-f', String(PDF_CONFIG.pageRange.first),
        '-l', String(PDF_CONFIG.pageRange.last),
        inputPath,
        path.join(outputDir, outputBase)
      ], { timeout: PDF_CONFIG.TIMEOUT_MS });

      if (!noOcr) {
        describeImageWithMinimaxVLM(outputPng).then(processData).catch(function(err) {
          console.error('AI OCR error:', err.message);
          process.exit(1);
        });
      } else {
        const text = fs.readFileSync(inputPath, 'utf8');
        processData(text);
      }
    } catch (e) {
      console.error('PDF conversion error:', e.message);
      process.exit(1);
    }
  } else if (mimeType.startsWith('image/')) {
    if (!noOcr) {
      describeImageWithMinimaxVLM(inputPath).then(processData).catch(function(err) {
        console.error('AI OCR error:', err.message);
        process.exit(1);
      });
    } else {
      let text;
      try {
        text = fs.readFileSync(inputPath, 'utf8');
      } catch (e) {
        console.error('Error reading file:', e.message);
        process.exit(1);
      }
      processData(text);
    }
  } else if (noOcr) {
    let text;
    try {
      text = fs.readFileSync(inputPath, 'utf8');
    } catch (e) {
      console.error('Error reading file:', e.message);
      process.exit(1);
    }
    processData(text);
  } else {
    console.error('Unsupported file type: ' + mimeType);
    process.exit(1);
  }
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = {
  CONFIG, RE,
  DIAMOND_TYPE, FLUOR_COLORS, CARAT_TIERS, CUT_GRADE, LAB_TREATMENT, CLARITY_RANK,
  DEPTH_RANGES, TABLE_RANGES, RATIO_RANGES, FANCY_DEPTH_RANGES, FANCY_TABLE_RANGES,
  FANCY_COLOR_MODIFIER, FANCY_RARITY_RULE, CHAMPAGNE_EFFECT,
  checkBothField, checkPortraitCut, evaluateFacetLustre, checkOriginPremiumExtended,
  checkUnderGradedHunter, checkHazeMatrix, evaluateGrainingRisk, checkWindowingRisk, checkInvestmentGrade,
  evaluateRoundCutGradePyramid, checkMeasurementsCaratConsistency, checkInscriptionMatch,
  evaluateCrownPavilionBalance, checkFancyColorDistribution, evaluateInclusionColor,
  evaluateCuletSize, checkNaturalsExtraFacet, evaluateGrainingDetail, evaluateInclusionSize, evaluateGirdleConsistency,
  evaluateDepth, evaluateRatio, evaluateFaceUpSize, evaluateSpreadFactor,
  checkAuctionGradeCompensation, checkSI2LusterPenalty,
  checkTreatmentRisk, checkStructuralRisk, checkUnifiedTintRisk,
  checkGirdleDeadWeightRisk, checkSymmetrySpecifics, checkEyeCleanRisk,
  checkClarityBasedOnClouds, checkCreamyStoneRisk, checkStructuralHaze,
  checkSuperIdeal, checkTypeIIaRisk, checkCuletRisk, checkGirdleCondition,
  checkFluorescenceColor, checkCertificateAgeRisk,
  checkCaratThresholdRisk, checkFluorescenceOffset, checkBowTieRiskEnhanced,
  checkTableRisk, checkFishEyeEnhanced, checkBearding,
  calculateClawScore, getVerdict, calculateGirdlePenalty,
  formatProfessionalReport, formatQuickSummary, generateDiscordEmbed, sendToDiscord, deduplicateFlags,
  parseGIACertificateText, describeImageWithMinimaxVLM, getMimeType, validateParsedData, GIA_PROMPT,
  extractField, extractMultilineField,
  checkPhosphorescence, evaluateEmeraldCrownHeight, checkSurfaceReaching, checkSilkEffect,
  checkFancyColorSecondaryHue, checkAntiqueCutException, evaluateStarLowerHalfLength, checkFancyFluorInteraction, checkFancyTreatmentRisk, checkFancyChameleon, checkPadparadscha, checkTypeIaClassification,
  checkDepthTableBalance,   checkLaserDrillEnhanced, checkFluorClarityMasking, checkDColorBlueFluorMilky, checkTypeIIbUltraWhite, checkHeartsAndArrows,
  checkPavilionBulge, checkNaturalExtended, checkFancyDarkDeep, checkYellowFluorImpact,
  checkWhiteFluorRisk, checkInclusionPattern, checkCaratMagicBonus, checkClarityUpgradePotential, evaluateInclusionPosition, evaluateGrainingSeverity, evaluateClaritySubGrade, evaluateFirstInclusionRisk, checkCertificateEra, checkFacetConsistency, checkGradingLabInfo, checkCutGradeApplicable, checkReportTypeLimitations, checkAdditionalInscription, checkMeasurementTolerance, validateClarityConsistency, checkFluorescenceEvenness, checkExtendedInclusionTypes,
  evaluateFancyShapeCutQuality, checkDUndertone, clarityIsSI, safeParseNumeric,
  checkCrownPavilionPairing, checkCuletClarityInteraction, evaluateCrownHeightRound, checkTableCrownInteraction, checkHPATreatment,
  validateGIAReportNumber, clampScore, checkBorderlineScore, safeScoreImpact,
  DataGuard, classifyFlags, isFancyColorExtended, parseCaratFraction,
  parseMeasurementsWithUnit, generateResolutionRecommendation, generateScoreConfidence,
  generateRiskSummary, getPortraitCutResult
};

// If run directly, execute main
if (require.main === module) {
  main();
}
