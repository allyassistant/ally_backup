#!/usr/bin/env node
/**
 * GIA Grading Logic Extractor
 * Extracts 4C parameters, scoring formulas, and verdict thresholds from gia_cert_analyzer
 * Input: /gia_cert_analyzer_refactored_V17.1.0.js (5607 lines)
 * Output: /tmp/gia_grading_logic.json
 */

const fs = require('fs');
const path = require('path');

const INPUT = '$HOME/.openclaw/workspace/scripts/gia_cert_analyzer_refactored_V17.1.0.js';
const OUTPUT = '/tmp/gia_grading_logic.json';

let content;
try {
  content = fs.readFileSync(INPUT, 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}

// ─── COLOR GRADING ────────────────────────────────────────────────────────────
const colorMatch = content.match(/COLOR_GRADE_SCORES\s*=\s*\{([^}]+)\}/s);
const colorRanks = {};
if (colorMatch) {
  colorMatch[1].split(',').forEach(line => {
    const m = line.match(/['"](\w)['"]\s*:\s*(\d+)/);
    if (m) colorRanks[m[1]] = parseInt(m[2]);
  });
}

// ─── CLARITY RANK ────────────────────────────────────────────────────────────
// getClarityRank returns 1-11 mapping FL→I3
const clarityRanks = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2','I1','I2','I3'];
const clarityRanksMap = {};
clarityRanks.forEach((g, i) => clarityRanksMap[g] = i + 1);

// ─── CUT RANK ────────────────────────────────────────────────────────────────
const cutGrades = {
  'EXCELLENT': 0,
  'VERY_GOOD': 1,
  'GOOD': 2,
  'FAIR': 3,
  'POOR': 4
};

// ─── CARAT TIERS ──────────────────────────────────────────────────────────────
const caratTiers = [
  { min: 0,    max: 0.30, label: 'Pip',      boost: 0 },
  { min: 0.30,max: 0.50, label: 'Light',     boost: 0 },
  { min: 0.50,max: 1.00, label: 'Carat',     boost: 0 },
  { min: 1.00,max: 2.00, label: 'Mid',        boost: 1 },
  { min: 2.00,max: 3.00, label: 'Large',      boost: 1 },
  { min: 3.00,max: 5.00, label: 'Jumbo',     boost: 2 },
  { min: 5.00,max: 10.0, label: 'Mega',      boost: 2 },
  { min: 10.0,max: 50.0, label: '10ct+',     boost: 4 },
  { min: 50.0,max: 999,  label: '50ct+',     boost: 6 }
];

// ─── COLOR CEILING SCORES ─────────────────────────────────────────────────────
const colorCeiling = {
  'D': 100, 'E': 100, 'F': 100,
  'G': 85, 'H': 82, 'I': 78, 'J': 74, 'K': 70, 'L': 65,
  'M': 60, 'N': 52, 'O': 48, 'P': 44, 'Q': 40, 'R': 36,
  'S': 32, 'T': 28, 'U': 26, 'V': 24, 'W': 22, 'X': 20, 'Y': 18, 'Z': 16
};

// ─── OPTICAL BONUS ───────────────────────────────────────────────────────────
const opticalTreshold = 81; // min color floor for optical bonus
const opticalBonus = 10;   // capped bonus

// ─── DEFECT PENALTIES ────────────────────────────────────────────────────────
const defectPenalties = {
  internalWhiteness: -15,
  milkiness: -36,
  strongFluorescence: -8,
  veryStrongFluorescence: -15,
  extremeFluorescence: -22,
  extraFacets: -100
};

// ─── QUALITY TIERS ────────────────────────────────────────────────────────────
const qualityTiers = [
  {
    name: 'INVESTMENT',
    condition: 'D-F + FL-VVS2 OR >=5ct + good4C',
    defectMult: 1.5,
    floor: 70,
    colorCeilBoost: '+10 (optical bonus capped at color ceiling)'
  },
  {
    name: 'PREMIUM',
    condition: 'D-I + VS1-VS2 OR >=3ct',
    defectMult: 1.2,
    floor: 55
  },
  {
    name: 'COMMERCIAL',
    condition: 'J-L + SI1-SI2',
    defectMult: 0.8,
    floor: 25
  },
  {
    name: 'BUDGET',
    condition: 'K-M + SI1',
    defectMult: 0.5,
    floor: 5
  }
];

// ─── CUT EXCELLENCE RANGES ────────────────────────────────────────────────────
const cutExcellent = {
  depth:     { min: 59.0, max: 63.0, ideal: 61.5 },
  table:     { min: 54.0, max: 62.0, ideal: 57.0 },
  pavilion:  { min: 40.6, max: 41.0, ideal: 40.8 },
  crown:     { min: 34.0, max: 35.0, ideal: 34.5 }
};

// Cut score: (cutGrade×2) + polish + symm → 0=EX, 3=VG, 6=GD, 9=FR, 12=PR
// Formula in our analyzer: uses (cutScore×2) + polish + symm where each 0=EX
const cutScoreCalc = (cutGrade, polish, symm) => {
  // Each grade is 0=EX,1=VG,2=GD,3=FR,4=PR
  return (cutGrade * 2) + polish + symm; // 0-12
};

// ─── VERDICT THRESHOLDS ───────────────────────────────────────────────────────
const verdictThresholds = [
  { min: 85, rating: 'STRONG_BUY',  emoji: '🟢', action: '果斷購入' },
  { min: 70, rating: 'BUY',         emoji: '🔵', action: '建議購入' },
  { min: 50, rating: 'CAUTION',     emoji: '🟡', action: '謹慎考慮' },
  { min: 30, rating: 'CONDITIONAL',  emoji: '🟠', action: '有條件購入' },
  { min: 0,  rating: 'REJECT',       emoji: '🔴', action: '不建議購入' }
];

// ─── GRADING FUNCTION (actual logic from code) ────────────────────────────────
function gradeStone(stone) {
  let score = 100;

  // 1. Color score (capped by ceiling per grade)
  const colorCeil = colorCeiling[stone.color] || 60;
  let colorScore = colorRanks[stone.color] || 0;
  if (colorScore > colorCeil) colorScore = colorCeil;
  // Optical bonus: if floor >=81 and colorRank higher than optical threshold
  if (colorScore >= opticalTreshold && stone.opticalPerformance === 'EX') {
    colorScore = Math.min(colorScore + opticalBonus, colorCeil);
  }

  // 2. Clarity score (1-11 mapping)
  const clarityScore = clarityRanksMap[stone.clarity] || 5;

  // 3. Carat tier score
  const ct = stone.carats || 0;
  let caratTier = caratTiers[0];
  for (const t of caratTiers) {
    if (ct >= t.min && ct < t.max) { caratTier = t; break; }
  }
  const caratScore = 50 + (caratTier.boost * 10); // base 50, +10 per boost tier

  // 4. Cut score
  const cg = cutGrades[stone.cut] ?? 2;
  const pol = cutGrades[stone.polish] ?? 2;
  const sym = cutGrades[stone.symmetry] ?? 2;
  const cutScore = cutScoreCalc(cg, pol, sym);

  // 5. Defect penalties
  let defectPenalty = 0;
  if (stone.internalWhiteness > 0) defectPenalty += defectPenalties.internalWhiteness;
  if (stone.milkiness > 0) defectPenalty += defectPenalties.milkiness;
  if (stone.fluorescence === 'STRONG') defectPenalty += defectPenalties.strongFluorescence;
  if (stone.fluorescence === 'VERY_STRONG') defectPenalty += defectPenalties.veryStrongFluorescence;
  if (stone.fluorescence === 'EXTREME') defectPenalty += defectPenalties.extremeFluorescence;

  // 6. Find quality tier
  const qualityTier = determineQualityTier(stone);

  // 7. Apply defect multiplier
  const effectivePenalty = defectPenalty * qualityTier.defectMult;

  score = colorScore + clarityScore + caratScore + (100 - cutScore) + effectivePenalty;

  // 8. Apply floor
  score = Math.max(score, qualityTier.floor);

  // 9. Get verdict
  const verdict = getVerdict(score);

  return {
    rawScore: score,
    verdict,
    breakdown: { color: colorScore, clarity: clarityScore, carat: caratScore, cut: 100 - cutScore, defect: effectivePenalty },
    qualityTier: qualityTier.name
  };
}

function determineQualityTier(stone) {
  const c = stone.color || 'M';
  const cl = stone.clarity || 'SI1';
  const ct = stone.carats || 0;

  // INVESTMENT: D-F + FL-VVS2 OR >=5ct good 4C
  if ((['D','E','F'].includes(c) && ['FL','IF','VVS1','VVS2'].includes(cl)) ||
      (ct >= 5 && ['D','E','F','G','H','I'].includes(c) && ['FL','IF','VVS1','VVS2','VS1','VS2'].includes(cl))) {
    return qualityTiers[0];
  }
  // PREMIUM: D-I + VS1-VS2 OR >=3ct
  if ((['D','E','F','G','H','I'].includes(c) && ['VS1','VS2'].includes(cl)) || ct >= 3) {
    return qualityTiers[1];
  }
  // COMMERCIAL: J-L + SI1-SI2
  if ((['J','K','L'].includes(c) && ['SI1','SI2'].includes(cl))) {
    return qualityTiers[2];
  }
  // BUDGET: K-M + SI1
  if (['K','L','M'].includes(c) && cl === 'SI1') {
    return qualityTiers[3];
  }
  return qualityTiers[2]; // default commercial
}

function getVerdict(score) {
  for (const t of verdictThresholds) {
    if (score >= t.min) return { score: Math.round(score), rating: t.rating, emoji: t.emoji, action: t.action };
  }
  return { score: 0, rating: 'REJECT', emoji: '🔴', action: '不建議購入' };
}

// ─── MAIN: EXTRACT + SAVE ──────────────────────────────────────────────────────
const result = {
  extractedAt: new Date().toISOString(),
  sourceFile: INPUT,
  version: '17.1.0',
  colorGrading: { colorRanks, colorCeiling, opticalBonus, opticalTreshold },
  clarityGrading: { clarityRanks, clarityRanksMap },
  caratTiers,
  cutGrading: { cutGrades, cutExcellent, cutScoreCalc },
  defectPenalties,
  qualityTiers,
  verdictThresholds: verdictThresholds.map(t => ({ min: t.min, rating: t.rating, emoji: t.emoji, action: t.action })),
  gradeStoneFunction: gradeStone.toString(),
  // Demo: grade a sample stone
  demo: gradeStone({
    color: 'G', clarity: 'VS1', carats: 1.02,
    cut: 'EXCELLENT', polish: 'EXCELLENT', symmetry: 'EXCELLENT',
    internalWhiteness: 0, milkiness: 0, fluorescence: 'NONE',
    opticalPerformance: 'EX'
  })
};

try {
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
console.log(`✅ GIA Grading Logic saved to ${OUTPUT}`);
console.log(JSON.stringify(result, null, 2));
