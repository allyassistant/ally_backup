#!/usr/bin/env node
/**
 * Magic Numbers Analysis Tool
 * 分析 Pure AI Audit 入面嘅 magic_numbers 問題
 */

const fs = require('fs');

// 讀取 audit results
let auditData;
try {
    auditData = JSON.parse(fs.readFileSync('.state/pure_ai_audit_results.json', 'utf8'));
} catch (err) {
    console.error(`❌ 讀取審計結果失敗: ${err.message}`);
    process.exit(1);
}

// 只篩選 magic_numbers 嘅 low severity 問題
const magicNumbers = auditData.findings.filter(
  f => f.rule === 'magic_numbers' && f.severity === 'low'
);

console.log(`\n📊 Magic Numbers 分析報告`);
console.log(`========================`);
console.log(`總據: ${magicNumbers.length} 個\n`);

// 定義分類規則
const categories = {
  discordChannelId: { pattern: /^1473\d{16}$/, desc: 'Discord Channel ID', count: 0, files: new Set() },
  phoneNumber: { pattern: /^852[29]\d{7}$/, desc: 'Phone Number (HK)', count: 0, files: new Set() },
  bufferSizes: { pattern: /^(1024|2048|4096|8192|16384)$/, desc: 'Buffer Sizes', count: 0, files: new Set() },
  timeMs: { pattern: /^(1000|60000|120000|180000|300000|3600000|86400000)$/, desc: 'Time (ms)', count: 0, files: new Set() },
  timeSec: { pattern: /^(1|60|300|3600)$/, desc: 'Time (sec)', count: 0, files: new Set() },
  fileSize: { pattern: /^(10000|100000|1073741824|17179869184|1536000)$/, desc: 'File Size', count: 0, files: new Set() },
  portNumbers: { pattern: /^(3000|3456|5000|5900|6000|8000|8080|11434)$/, desc: 'Port Numbers', count: 0, files: new Set() },
  priceAmount: { pattern: /^(15000|5000|10000)$/, desc: 'Price/Amount', count: 0, files: new Set() },
  testData: { pattern: /^(9999|1234|1234567|1234567890)$/, desc: 'Test/Placeholder Data', count: 0, files: new Set() },
  screenResolution: { pattern: /^(1100|1125|1145|1175|1200|1600)$/, desc: 'Screen Resolution', count: 0, files: new Set() },
  ollamaPorts: { pattern: /^(3167|9063|4834|2491|16054|1592|1291|6768|4327|1934|2670|20639|24748|3725|32130)$/, desc: 'Ollama/IDEX Ports', count: 0, files: new Set() },
  memorySize: { pattern: /^(4000|8000)$/, desc: 'Memory Size (tokens)', count: 0, files: new Set() },
  pdfMagic: { pattern: /^(25504446|47494638)$/, desc: 'PDF/GIF Magic Bytes', count: 0, files: new Set() },
  timeoutMs: { pattern: /^(30000|15000|10000|2700|1500)$/, desc: 'Timeout Values', count: 0, files: new Set() },
  imageDims: { pattern: /^(1630|1680|1683|1720)$/, desc: 'Image Dimensions', count: 0, files: new Set() },
  otherKnown: { pattern: /^$/, desc: 'Other Known Constants', count: 0, files: new Set() },
  unknown: { pattern: null, desc: 'Unknown/Custom Values', count: 0, files: new Set() }
};

// 特別處理嘅已知常量
const knownConstants = new Set([
  // Time durations
  1000, 60000, 120000, 180000, 300000, 3600000, 86400000,
  // Buffer sizes
  1024, 2048, 4096, 8192, 16384,
  // File/memory sizes
  10000, 100000, 1073741824, 17179869184, 1536000,
  // Ports
  3000, 3456, 5000, 5900, 6000, 8000, 8080, 11434,
  // Prices
  15000, 5000, 10000,
  // Test data
  9999, 1234, 1234567, 1234567890,
  // Timeouts
  30000, 15000, 10000, 2700, 1500,
  // Memory sizes
  4000, 8000,
  // PDF magic
  25504446, 47494638
]);

// 統計
const fileStats = {};
const numberStats = {};
const legacyFiles = new Set();
const activeFiles = new Set();

magicNumbers.forEach(finding => {
  const match = finding.title.match(/:\s(\d+)\.?/);
  if (!match) return;

  const num = parseInt(match[1]);
  const file = finding.file;

  // 統計數字出現次數
  numberStats[num] = (numberStats[num] || 0) + 1;

  // 統計文件
  if (!fileStats[file]) {
    fileStats[file] = { count: 0, numbers: [] };
  }
  fileStats[file].count++;
  fileStats[file].numbers.push(num);

  // 分類 legacy vs active
  if (file.startsWith('_legacy/')) {
    legacyFiles.add(file);
  } else {
    activeFiles.add(file);
  }

  // 分類數字
  let categorized = false;
  for (const [key, cat] of Object.entries(categories)) {
    if (cat.pattern && cat.pattern.test(num.toString())) {
      cat.count++;
      cat.files.add(file);
      categorized = true;
      break;
    }
  }

  if (!categorized) {
    if (knownConstants.has(num)) {
      categories.otherKnown.count++;
      categories.otherKnown.files.add(file);
    } else {
      categories.unknown.count++;
      categories.unknown.files.add(file);
    }
  }
});

// 輸出分類結果
console.log(`📁 分類結果：`);
console.log(`----------------`);

let totalCategorized = 0;
for (const [key, cat] of Object.entries(categories)) {
  if (cat.count > 0) {
    totalCategorized += cat.count;
    console.log(`${cat.desc.padEnd(25)}: ${cat.count.toString().padStart(3)} 個 (${cat.files.size} 個 files)`);
  }
}

console.log(`\n📈 統計：`);
console.log(`----------------`);
console.log(`Legacy files (_legacy/): ${legacyFiles.size} 個`);
console.log(`Active files (scripts/): ${activeFiles.size} 個`);

// 最多問題嘅 files
console.log(`\n📄 最多 Magic Numbers 嘅 Files (Top 15)：`);
console.log(`----------------`);
const sortedFiles = Object.entries(fileStats)
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 15);

sortedFiles.forEach(([file, stats], idx) => {
  const prefix = file.startsWith('_legacy/') ? '[L]' : '[A]';
  console.log(`${(idx + 1).toString().padStart(2)}. ${prefix} ${file.padEnd(45)}: ${stats.count.toString().padStart(2)} 個`);
});

// 最常見嘅數字
console.log(`\n🔢 最常見嘅 Magic Numbers (Top 15)：`);
console.log(`----------------`);
const sortedNumbers = Object.entries(numberStats)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

sortedNumbers.forEach(([num, count], idx) => {
  console.log(`${(idx + 1).toString().padStart(2)}. ${num.toString().padStart(20)}: ${count.toString().padStart(2)} 次`);
});

// Skip 建議分析
console.log(`\n✅ 建議 Skip Pattern：`);
console.log(`----------------`);

const skipPatterns = [
  { name: 'Discord Channel ID', count: categories.discordChannelId.count, reason: '外部系統 ID' },
  { name: 'Phone Number', count: categories.phoneNumber.count, reason: '聯絡電話' },
  { name: 'Buffer Sizes', count: categories.bufferSizes.count, reason: '標準 buffer size (1024, 4096等)' },
  { name: 'Time (ms)', count: categories.timeMs.count, reason: '時間常量 (1s, 1min, 1hr)' },
  { name: 'Port Numbers', count: categories.portNumbers.count, reason: '網絡端口' },
  { name: 'Ollama Ports', count: categories.ollamaPorts.count, reason: 'IDEX fetcher 專用端口' },
  { name: 'PDF/GIF Magic', count: categories.pdfMagic.count, reason: '文件 magic bytes' },
  { name: 'Test Data', count: categories.testData.count, reason: '測試/佔位據據' }
];

let totalSkip = 0;
skipPatterns.forEach(p => {
  if (p.count > 0) {
    totalSkip += p.count;
    console.log(`✓ ${p.name.padEnd(20)}: ${p.count.toString().padStart(3)} 個 - ${p.reason}`);
  }
});

console.log(`\n📊 Skip 影響分析：`);
console.log(`----------------`);
console.log(`可自動 skip: ${totalSkip} 個 (${((totalSkip/magicNumbers.length)*100).toFixed(1)}%)`);
console.log(`剩餘需關注: ${magicNumbers.length - totalSkip} 個`);

// 建議嘅 threshold
console.log(`\n🎯 建議 Implementation：`);
console.log(`----------------`);
console.log(`1. 喺 pure_ai_audit.js 加入 filter function：`);
console.log(`   - Skip Discord Channel IDs (1473xxxxxxxxxxxxxx)`);
console.log(`   - Skip Phone numbers (852xxxxxxx)`);
console.log(`   - Skip known constants (1024, 4096, 60000, 86400000)`);
console.log(`   - Skip port numbers (3000, 5000, 8000, 11434, IDEX ports)`);
console.log(`   - Skip test/placeholder values (9999, 1234)`);
console.log(`   - Skip legacy/ 目錄嘅 files`);
console.log(`\n2. Expected Results：`);
console.log(`   - 294 → ~${magicNumbers.length - totalSkip} 個 (減少 ~${((totalSkip/magicNumbers.length)*100).toFixed(0)}%)`);
console.log(`   - 只保留真正需要 refactor 嘅 custom values`);
