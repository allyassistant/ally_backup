#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * 單顆鑽石估值計算器
 * 提供 Rapaport +/- % 估值參考
 */

const fs = require('fs');
const path = require('path');

const { MEMORY_DIR } = require('./lib/config');
const RAPAPORT_DB = path.join(MEMORY_DIR, 'rapaport_db.json');
const IDEX_CACHE = path.join(MEMORY_DIR, 'idex_index_cache.json');

// 載入 Rapaport 數據
function loadRapaport() {
  let rapaportExists = false;
  try {
      rapaportExists = fs.existsSync(RAPAPORT_DB);
  } catch (err) {
      log(`⚠️ 檢查 Rapaport 據據庫失敗: ${err.message}`);
  }
  if (!rapaportExists) {
    log('⚠️ 找不到 Rapaport 據據庫');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(RAPAPORT_DB, 'utf8'));
  } catch (err) {
    log(`⚠️ 解析 Rapaport 據據庫失敗: ${err.message}`);
    return null;
  }
}

// 計算 Rapaport 價格
function calculateRapaportPrice(rapaportData, shape, carat, color, clarity) {
  // 確定用邊個表
  const isRound = shape.toUpperCase().includes('RBC') ||
                  shape.toUpperCase().includes('ROUND') ||
                  shape.toUpperCase().includes('RD');

  const table = isRound ? rapaportData.round : rapaportData.pear;
  if (!table) return null;

  // 找重量類別
  let caratKey = null;
  if (carat < 1.5) caratKey = '1.00-1.49';
  else if (carat < 2.0) caratKey = '1.50-1.99';
  else if (carat < 3.0) caratKey = '2.00-2.99';
  else if (carat < 4.0) caratKey = '3.00-3.99';
  else if (carat < 5.0) caratKey = '4.00-4.99';
  else caratKey = '5.00-5.99';

  const caratTable = table[caratKey];
  if (!caratTable) return null;

  const colorRow = caratTable[color.toUpperCase()];
  if (!colorRow) return null;

  let pricePer100ct = colorRow[clarity.toUpperCase()];

  // FL 用 IF 價格
  if (!pricePer100ct && clarity.toUpperCase() === 'FL') {
    pricePer100ct = colorRow['IF'];
  }

  if (!pricePer100ct) return null;

  const pricePerCt = pricePer100ct * 100; // 轉換為每卡價格
  const basePrice = pricePerCt * carat;

  return { pricePerCt, basePrice, caratKey };
}

// 獲取估值等級
function getValuationLevel(discountPercent) {
  if (discountPercent <= -35) {
    return { level: '🔴 偏低', desc: '急於套現 / 市場弱勢' };
  } else if (discountPercent <= -25) {
    return { level: '🟡 合理', desc: '正常市場價格' };
  } else if (discountPercent <= -15) {
    return { level: '🟢 偏高', desc: '優質貨 / 市場強勢' };
  } else {
    return { level: '💎 極高', desc: '頂級貨 / 稀有規格' };
  }
}

// 計算單顆鑽石估值
function evaluateSingleDiamond(shape, carat, color, clarity, memoPrice = null) {
  const rapaportData = loadRapaport();
  if (!rapaportData) {
    return { error: '無法載入 Rapaport 據據' };
  }

  const rapaport = calculateRapaportPrice(rapaportData, shape, carat, color, clarity);
  if (!rapaport) {
    return { error: '無法計算 Rapaport 價格，請檢查參據' };
  }

  // 計算不同折扣的價格
  const valuations = {
    conservative: { discount: -35, price: rapaport.basePrice * 0.65 },
    market: { discount: -25, price: rapaport.basePrice * 0.75 },
    optimistic: { discount: -15, price: rapaport.basePrice * 0.85 },
    premium: { discount: -5, price: rapaport.basePrice * 0.95 }
  };

  // 如果有 memo price，計算實際折扣
  let actualDiscount = null;
  let valuationLevel = null;
  if (memoPrice && memoPrice > 0) {
    actualDiscount = ((memoPrice - rapaport.basePrice) / rapaport.basePrice * 100).toFixed(1);
    valuationLevel = getValuationLevel(parseFloat(actualDiscount));
  }

  return {
    shape,
    carat,
    color,
    clarity,
    rapaportBase: rapaport.basePrice.toFixed(2),
    pricePerCt: rapaport.pricePerCt.toFixed(2),
    valuations,
    memoPrice: memoPrice ? memoPrice.toFixed(2) : null,
    actualDiscount,
    valuationLevel,
    caratRange: rapaport.caratKey
  };
}

// 格式化輸出
function formatOutput(result) {
  if (result.error) {
    return `❌ ${result.error}`;
  }

  let output = `\n💎 *${result.shape} ${result.carat.toFixed(2)}ct ${result.color} ${result.clarity}*\n`;
  output += `📊 重量類別: ${result.caratRange}\n\n`;

  output += `💰 *價格參考:*\n`;
  output += `• Rapaport 基準: USD ${parseFloat(result.rapaportBase).toLocaleString()} ($${result.pricePerCt}/ct)\n\n`;

  output += `📈 *估值範圍 (相對 Rapaport):*\n`;
  output += `• 保守估值 (-35%): USD ${result.valuations.conservative.price.toFixed(0).toLocaleString()}\n`;
  output += `• 市場估值 (-25%): USD ${result.valuations.market.price.toFixed(0).toLocaleString()}\n`;
  output += `• 樂觀估值 (-15%): USD ${result.valuations.optimistic.price.toFixed(0).toLocaleString()}\n`;
  output += `• 頂級估值 (-5%):  USD ${result.valuations.premium.price.toFixed(0).toLocaleString()}\n\n`;

  output += `💡 *估值等級說明:*\n`;
  output += `🔴 -35%~-45% | 🟡 -20%~-35% | 🟢 -10%~-20% | 💎 0%~+10%`;

  return output;
}

// Main
const args = process.argv.slice(2);

if (args.length < 4) {
  log('單顆鑽石估值計算器');
  log('');
  log('用法:');
  log('  node scripts/diamond_valuation.js <shape> <carat> <color> <clarity>');
  log('');
  log('例子:');
  log('  node scripts/diamond_valuation.js RBC 2.5 D VS1');
  log('  node scripts/diamond_valuation.js PS 7.02 H IF');
  log('');
  log('形狀簡寫: RBC, PS, PR, EM, CU, OV, RAD, HS, MQ, SEM');
  process.exit(0);
}

const [shape, caratStr, color, clarity] = args;

// Input validation
const validShapes = ['RBC', 'RD', 'ROUND', 'PS', 'PEAR', 'PR', 'EM', 'EMERALD', 'CU', 'CUSHION', 'OV', 'OVAL', 'RAD', 'RADIANT', 'HS', 'HEART', 'MQ', 'MARQUISE', 'SEM'];
const validColors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
const validClarity = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];

if (!validShapes.includes(shape.toUpperCase())) {
  log(`❌ Invalid shape: ${shape}. Valid shapes: ${validShapes.join(', ')}`);
  process.exit(1);
}

const carat = parseFloat(caratStr);
if (isNaN(carat) || carat <= 0 || carat > 100) {
  log(`❌ Invalid carat weight: ${caratStr}. Must be a positive number between 0 and 100.`);
  process.exit(1);
}

if (!validColors.includes(color.toUpperCase())) {
  log(`❌ Invalid color: ${color}. Valid colors: ${validColors.join(', ')}`);
  process.exit(1);
}

if (!validClarity.includes(clarity.toUpperCase())) {
  log(`❌ Invalid clarity: ${clarity}. Valid clarity: ${validClarity.join(', ')}`);
  process.exit(1);
}

const result = evaluateSingleDiamond(shape, carat, color, clarity);
log(formatOutput(result));
