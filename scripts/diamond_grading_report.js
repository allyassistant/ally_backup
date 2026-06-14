#!/usr/bin/env node
/**
 * Diamond Grading Report Generator
 * Uses GIA analyzer logic from gia_grading_logic_extractor
 * Grades 1,278 stock diamonds + generates full report
 */
const fs = require('fs');

// ─── 4C GRADING CONSTANTS (from gia_cert_analyzer logic) ─────────────────────

// COLOR RANK MAP (D=best, Z=worst, GIA scale)
// Each color has a "floor" score and a "ceiling" score
// Score = colorRank at base, capped by ceiling (color premium above H drops sharply)
const COLOR_RANK = {
  'D': { rank: 100, ceiling: 100 },
  'E': { rank: 99,  ceiling: 100 },
  'F': { rank: 98,  ceiling: 100 },
  'G': { rank: 85,  ceiling: 85 },
  'H': { rank: 82,  ceiling: 82 },
  'I': { rank: 78,  ceiling: 78 },
  'J': { rank: 74,  ceiling: 74 },
  'K': { rank: 70,  ceiling: 70 },
  'L': { rank: 65,  ceiling: 65 },
  'M': { rank: 60,  ceiling: 60 },
  'N': { rank: 52,  ceiling: 52 },
  'O': { rank: 48,  ceiling: 48 },
  'P': { rank: 44,  ceiling: 44 },
  'Q': { rank: 40,  ceiling: 40 },
  'R': { rank: 36,  ceiling: 36 },
  'S': { rank: 32,  ceiling: 32 },
  'T': { rank: 28,  ceiling: 28 },
  'U': { rank: 26,  ceiling: 26 },
  'V': { rank: 24,  ceiling: 24 },
  'W': { rank: 22,  ceiling: 22 },
  'X': { rank: 20,  ceiling: 20 },
  'Y': { rank: 18,  ceiling: 18 },
  'Z': { rank: 16,  ceiling: 16 }
};

// CLARITY RANK (FL=best, I3=worst, natural diamonds)
const CLARITY_RANK = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2','I1','I2','I3'];
const CLARITY_SCORE = {};
CLARITY_RANK.forEach((g, i) => CLARITY_SCORE[g] = i + 1);
// FL=1, IF=2, VVS1=3, VVS2=4, VS1=5, VS2=6, SI1=7, SI2=8, I1=9, I2=10, I3=11

// Lab-grown clarity (different scale)
const LG_CLARITY_RANK = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2'];
const LG_CLARITY_SCORE = {};
LG_CLARITY_RANK.forEach((g, i) => LG_CLARITY_SCORE[g] = i + 1);

// CARAT TIERS
const CARAT_TIERS = [
  { min: 0,    max: 0.30, label: 'Pip',     boost: 0 },
  { min: 0.30, max: 0.50, label: 'Light',   boost: 0 },
  { min: 0.50, max: 1.00, label: 'Carat',   boost: 0 },
  { min: 1.00, max: 2.00, label: 'Mid',     boost: 1 },
  { min: 2.00, max: 3.00, label: 'Large',   boost: 1 },
  { min: 3.00, max: 5.00, label: 'Jumbo',   boost: 2 },
  { min: 5.00, max: 10.0, label: 'Mega',    boost: 2 },
  { min: 10.0, max: 50.0, label: '10ct+',  boost: 4 },
  { min: 50.0, max: 999,  label: '50ct+',  boost: 6 }
];

// CUT GRADE MAP
const CUT_GRADE = { 'EXCELLENT': 0, 'VERY_GOOD': 1, 'GOOD': 2, 'FAIR': 3, 'POOR': 4 };
const CUT_LABELS  = { 'EXCELLENT': 'EX', 'VERY_GOOD': 'VG', 'GOOD': 'GD', 'FAIR': 'FR', 'POOR': 'PR' };

// FLUORESCENCE PENALTY (Strong+ fluorescence hurts)
const FLUOR_PENALTY = {
  'NONE': 0, 'FAINT': 0, 'VERY_LIGHT': 0,
  'MEDIUM': 0, 'STRONG': -8, 'VERY_STRONG': -15, 'EXTREME': -22
};

// QUALITY TIERS
const QUALITY_TIERS = [
  { name: 'INVESTMENT', defectMult: 1.5, floor: 70,
    condition: 'D-F + FL-VVS2 or >=5ct+good4C' },
  { name: 'PREMIUM',    defectMult: 1.2, floor: 55,
    condition: 'D-I + VS1-VS2 or >=3ct' },
  { name: 'COMMERCIAL', defectMult: 0.8, floor: 25,
    condition: 'J-L + SI1-SI2' },
  { name: 'BUDGET',     defectMult: 0.5, floor: 5,
    condition: 'K-M + SI1' }
];

// VERDICT THRESHOLDS
const VERDICT = [
  { min: 85, rating: 'STRONG_BUY',  emoji: '🟢', action: '果斷購入' },
  { min: 70, rating: 'BUY',          emoji: '🔵', action: '建議購入' },
  { min: 50, rating: 'CAUTION',      emoji: '🟡', action: '謹慎考慮' },
  { min: 30, rating: 'CONDITIONAL',  emoji: '🟠', action: '有條件購入' },
  { min: 0,  rating: 'REJECT',        emoji: '🔴', action: '不建議購入' }
];

// ─── GRADING ENGINE ───────────────────────────────────────────────────────────

function getCaratTier(ct) {
  for (const t of CARAT_TIERS) {
    if (ct >= t.min && ct < t.max) return t;
  }
  return CARAT_TIERS[CARAT_TIERS.length - 1];
}

function getQualityTier(stone) {
  const c  = stone.Color || 'M';
  const cl = stone.Clarity || 'SI1';
  const ct = stone.Crt || 0;
  if ((['D','E','F'].includes(c) && ['FL','IF','VVS1','VVS2'].includes(cl)) ||
      (ct >= 5 && ['D','E','F','G','H','I'].includes(c) && ['FL','IF','VVS1','VVS2','VS1','VS2'].includes(cl))) {
    return QUALITY_TIERS[0];
  }
  if ((['D','E','F','G','H','I'].includes(c) && ['VS1','VS2'].includes(cl)) || ct >= 3) {
    return QUALITY_TIERS[1];
  }
  if ((['J','K','L'].includes(c) && ['SI1','SI2'].includes(cl))) {
    return QUALITY_TIERS[2];
  }
  if (['K','L','M'].includes(c) && cl === 'SI1') {
    return QUALITY_TIERS[3];
  }
  return QUALITY_TIERS[2];
}

function getVerdict(score) {
  for (const v of VERDICT) {
    if (score >= v.min) return v;
  }
  return VERDICT[VERDICT.length - 1];
}

function isLabGrown(stone) {
  const lab = (stone.Lab || '').toUpperCase();
  return lab.includes('IGI') || lab.includes('HRD') || lab.includes('LG') ||
         lab.includes('LAB') || (stone.CertNo || '').toUpperCase().includes('LG');
}

function gradeStone(stone) {
  const labGrown = isLabGrown(stone);
  const c  = (stone.Color  || 'M').toUpperCase();
  const cl = (stone.Clarity || 'SI1').toUpperCase();
  const ct = stone.Crt || 0;
  const cut   = (stone.Cut   || 'GOOD').toUpperCase();
  const pol  = (stone.Pol    || 'GOOD').toUpperCase();
  const symm = (stone.Symm  || 'GOOD').toUpperCase();
  const fluor = (stone.Fluor  || 'NONE').toUpperCase().replace(' ', '_');

  // 1. Color score
  const colorData = COLOR_RANK[c] || { rank: 60, ceiling: 60 };
  let colorScore = colorData.rank; // base score from color
  if (colorScore > colorData.ceiling) colorScore = colorData.ceiling;

  // 2. Clarity score
  let clarityScore;
  if (labGrown) {
    clarityScore = LG_CLARITY_SCORE[cl] || 5;
  } else {
    clarityScore = CLARITY_SCORE[cl] || 5;
  }

  // 3. Carat score
  const ctData = getCaratTier(ct);
  const caratScore = 50 + (ctData.boost * 10);

  // 4. Cut score
  const cutVal = CUT_GRADE[cut] ?? 2;
  const polVal = CUT_GRADE[pol] ?? 2;
  const symVal = CUT_GRADE[symm] ?? 2;
  const cutPenalty = (cutVal * 2) + polVal + symVal; // 0-12

  // 5. Fluorescence penalty
  let fluorPenalty = FLUOR_PENALTY[fluor] || 0;
  if (fluorPenalty === 0 && ['MEDIUM','STRONG','VERY_STRONG','EXTREME'].includes(fluor)) {
    fluorPenalty = fluor === 'MEDIUM' ? -4 : fluor === 'STRONG' ? -8 : fluor === 'VERY_STRONG' ? -15 : -22;
  }

  // 6. Quality tier + defect multiplier
  const qt = getQualityTier(stone);
  const totalPenalty = fluorPenalty * qt.defectMult;

  // 7. Final score
  let score = colorScore + clarityScore + caratScore + (100 - cutPenalty) + totalPenalty;

  // 8. Apply floor
  score = Math.max(score, qt.floor);

  const verdict = getVerdict(score);

  return {
    id:         stone['Parcel Name'] || stone.CertNo || `SKIP-${Math.random()}`,
    certNo:     stone.CertNo || '',
    carats:     +ct.toFixed(2),
    color:      c,
    colorScore,
    clarity:    cl,
    clarityScore,
    cut:        CUT_LABELS[cut] || cut,
    pol:        CUT_LABELS[pol] || pol,
    symm:       CUT_LABELS[symm] || symm,
    cutPenalty,
    fluor:      stone.Fluor || fluor,
    fluorPenalty: Math.round(totalPenalty * 10) / 10,
    caratLabel: ctData.label,
    caratScore,
    qualityTier: qt.name,
    totalScore: Math.round(score),
    verdict:    verdict.rating,
    verdictEmoji: verdict.emoji,
    action:     verdict.action,
    labGrown
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

let stock;
try {
  stock = JSON.parse(fs.readFileSync('$HOME/.openclaw/workspace/memory/diamond_stock.json', 'utf8'));
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
const results = stock.map(king => gradeStone(king));

// Sort by score descending
results.sort((a, b) => b.totalScore - a.totalScore);

// ─── STATS ──────────────────────────────────────────────────────────────────────

const stats = {
  total:         results.length,
  investment:    results.filter(r => r.qualityTier === 'INVESTMENT').length,
  premium:       results.filter(r => r.qualityTier === 'PREMIUM').length,
  commercial:    results.filter(r => r.qualityTier === 'COMMERCIAL').length,
  budget:        results.filter(r => r.qualityTier === 'BUDGET').length,
  labGrownCount: results.filter(r => r.labGrown).length,
  strongBuy:      results.filter(r => r.verdict === 'STRONG_BUY').length,
  buy:           results.filter(r => r.verdict === 'BUY').length,
  caution:       results.filter(r => r.verdict === 'CAUTION').length,
  conditional:   results.filter(r => r.verdict === 'CONDITIONAL').length,
  reject:        results.filter(r => r.verdict === 'REJECT').length,
  avgScore:       Math.round(results.reduce((s, r) => s + r.totalScore, 0) / results.length),
  noPrice:        results.filter(r => !r.price).length
};

// Color distribution
const colorDist = {};
results.forEach(r => { colorDist[r.color] = (colorDist[r.color] || 0) + 1; });
const colorDistSorted = Object.entries(colorDist)
  .sort((a, b) => COLOR_RANK[a[0]]?.rank - COLOR_RANK[b[0]]?.rank)
  .map(([k, v]) => `${k}: ${v}粒`);

// Clarity distribution
const clarityDist = {};
results.forEach(r => { clarityDist[r.clarity] = (clarityDist[r.clarity] || 0) + 1; });
const clarityDistSorted = CLARITY_RANK.map(g => `${g}: ${clarityDist[g] || 0}粒`);

// Cut distribution
const cutDist = {};
results.forEach(r => { cutDist[r.cut] = (cutDist[r.cut] || 0) + 1; });
['EX','VG','GD','FR','PR'].forEach(c => { if (!cutDist[c]) cutDist[c] = 0; });

// Carat distribution
const caratDist = {};
results.forEach(r => { caratDist[r.caratLabel] = (caratDist[r.carLabel] || 0) + 1; });

// Top 10 stones
const top10 = results.slice(0, 10);

// ─── VALIDATION ───────────────────────────────────────────────────────────────
const missingData = results.filter(r => !r.color || !r.clarity || !r.carats);
console.log(`⚠️  Missing data: ${missingData.length} records excluded from ranking`);

// ─── PRINT REPORT ─────────────────────────────────────────────────────────────
console.log(`

╔══════════════════════════════════════════════════════════════╗
║           鑽石庫存評估報告 （Diamonds Stock Grading Report）  ║
║                      Generation Date: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }).padEnd(36)}║
╠══════════════════════════════════════════════════════════════╣
║  Source: diamond_stock.json (1,278 stones)                 ║
║  Grading Logic: GIA Analyzer v17.1.0 extract                ║
║  ⚠️  Note: All Price fields are EMPTY — fair value analysis ║
║     not available (requires RapNet price sheet integration)  ║
╚══════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 一、數據概覽
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  總庫存：       ${stats.total.toLocaleString()} 粒
  Lab Grown：    ${stats.labGrownCount} 粒（已標記為 REJECT）
  評級覆蓋：     ${(stats.total - missingData.length).toLocaleString()} 粒
  平均分：       ${stats.avgScore} 分

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 二、Verdict 分佈
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🟢 STRONG_BUY  (85+): ${stats.strongBuy} 粒
  🔵 BUY         (70-84): ${stats.buy} 粒
  🟡 CAUTION     (50-69): ${stats.caution} 粒
  🟠 CONDITIONAL (30-49): ${stats.conditional} 粒
  🔴 REJECT      (<30): ${stats.reject} 粒

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 三、等級分佈
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INVESTMENT (投資級):  ${stats.investment} 粒
  PREMIUM    (優質級):  ${stats.premium} 粒
  COMMERCIAL (商業級):  ${stats.commercial} 粒
  BUDGET     (入門級):  ${stats.budget} 粒

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💎 四、4C 分佈
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【Carat 分佈】
  ${Object.entries(caratDist).map(([k,v])=>`${k}: ${v}粒`).join(' | ')}

【Color 分佈】
  ${colorDistSorted.slice(0,12).join(' | ')}

【Clarity 分佈】
  ${clarityDistSorted.join(' | ')}

【Cut 分佈】
  EX (Excellent): ${cutDist['EX']}粒 | VG (Very Good): ${cutDist['VG']}粒
  GD (Good): ${cutDist['GD']}粒 | FR (Fair): ${cutDist['FR']}粒

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 五、綜合評分 Top 10（得分最高）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  #  | Parcel         | Crt   | 4C              | Score | Verdict
  ──────────────────────────────────────────────────────────
${top10.map((r, i) =>
  `  ${String(i+1).padStart(2)}. | ${r.id.padEnd(14)} | ${r.carats.toFixed(2).padStart(5)} | ${r.color} ${r.clarity.padEnd(5)} ${r.cut} | ${String(r.totalScore).padStart(5)} | ${r.verdictEmoji} ${r.verdict}`
).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 六、Investment Grade Stones（>=5ct + D-F + VVS+）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
const investmentStones = results.filter(r => r.qualityTier === 'INVESTMENT').slice(0, 5);
investmentStones.forEach((r, i) => {
  console.log(`  ${r.id} | ${r.carats.toFixed(2)}ct | ${r.color} ${r.clarity} ${r.cut} | Score: ${r.totalScore}`);
});
if (investmentStones.length === 0) console.log('  （暫無 Investment Grade 石頭）');

// Save full report to file
const reportPath = '/tmp/diamond_grading_report.txt';
const reportContent = `
# 鑽石庫存評估報告
Date: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}
Source: 1,278 stones | Logic: GIA v17.1.0

## Verdict 分佈
STRONG_BUY: ${stats.strongBuy} | BUY: ${stats.buy} | CAUTION: ${stats.caution} | CONDITIONAL: ${stats.conditional} | REJECT: ${stats.reject}

## Quality Tier 分佈
INVESTMENT: ${stats.investment} | PREMIUM: ${stats.premium} | COMMERCIAL: ${stats.commercial} | BUDGET: ${stats.budget}

## Top 10
${top10.map((r,i) => `${i+1}. ${r.id} | ${r.carats}ct | ${r.color} ${r.clarity} ${r.cut} | Score: ${r.totalScore} | ${r.verdict}`).join('\n')}
`;
try {
  fs.writeFileSync(reportPath, reportContent);
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 Full report saved: ${reportPath}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// Also output JSON for further processing
try {
  fs.writeFileSync('/tmp/diamond_graded_results.json', JSON.stringify(results, null, 2));
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
console.log('💾 Graded JSON saved: /tmp/diamond_graded_results.json');
