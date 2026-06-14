#!/usr/bin/env node
/**
 * Stock List 混合估值系統 (Optimized v2)
 * 結合 Rapaport + IDEX 數據進行估價
 * 
 * 優化 (2026-03-16):
 * - 加 try-catch 錯誤處理
 * - 減少 console.log，改用 batched 輸出
 * - 檢查目錄存在
 * - 加 process error handling
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const RAPAPORT_DB = path.join(__dirname, '../memory/rapaport_db.json');
const IDEX_CACHE = path.join(__dirname, '../memory/idex_index_cache.json');
const STOCK_DIR = path.join(process.env.HOME, 'Desktop/Stock list');

// 收集輸出，最後一次性顯示
const outputBuffer = [];
function log(msg) {
  outputBuffer.push(msg);
}
function flush() {
  console.log(outputBuffer.join('\n'));
}

// 載入 Rapaport 數據
function loadRapaport() {
  if (!fs.existsSync(RAPAPORT_DB)) {
    log('⚠️ 找不到 Rapaport 數據庫');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(RAPAPORT_DB, 'utf8'));
  } catch (err) {
    log(`❌ 讀取 Rapaport 失敗: ${err.message}`);
    return null;
  }
}

// 載入 IDEX 數據
function loadIDEX() {
  if (!fs.existsSync(IDEX_CACHE)) {
    log('⚠️ 找不到 IDEX 數據，請先運行: node scripts/idex_fetcher.js update');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(IDEX_CACHE, 'utf8'));
  } catch (err) {
    log(`❌ 讀取 IDEX 失敗: ${err.message}`);
    return null;
  }
}

// 載入 Stock List
function loadStockList() {
  // 檢查目錄存在
  if (!fs.existsSync(STOCK_DIR)) {
    log(`⚠️ Stock list 目錄不存在: ${STOCK_DIR}`);
    return null;
  }

  try {
    // 找最新嘅 Stock list 文件
    const files = fs.readdirSync(STOCK_DIR)
      .filter(f => f.toLowerCase().startsWith('stock list') && f.endsWith('.xlsx'))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      log('⚠️ 找不到 Stock list 文件');
      return null;
    }
    
    const latestFile = path.join(STOCK_DIR, files[0]);
    log(`📂 使用 Stock list: ${files[0]}`);
    
    // 加 try-catch 讀取 Excel
    let workbook;
    try {
      workbook = XLSX.readFile(latestFile);
    } catch (err) {
      log(`❌ 讀取 Excel 失敗: ${err.message}`);
      return null;
    }
    
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  } catch (err) {
    log(`❌ 載入 Stock list 失敗: ${err.message}`);
    return null;
  }
}

// 從 Rapaport 計算基準價格
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
  
  // 找顏色淨度價格
  const colorRow = caratTable[color.toUpperCase()];
  if (!colorRow) return null;
  
  let pricePer100ct = colorRow[clarity.toUpperCase()];
  
  // FL 用 IF 價格
  if (!pricePer100ct && clarity.toUpperCase() === 'FL') {
    pricePer100ct = colorRow['IF'];
  }
  
  if (!pricePer100ct) return null;
  
  return {
    pricePerCt: pricePer100ct * 100,
    basePrice: pricePer100ct * 100 * carat
  };
}

// 從 IDEX 獲取市場指數調整
function getIDEXAdjustment(idexData, shape, carat) {
  if (!idexData || !idexData.data) return { adjustment: 0, confidence: 'low' };
  
  let bestMatch = null;
  let bestScore = 0;
  
  const shapeLower = shape.toLowerCase();
  
  for (const item of idexData.data) {
    const cat = item.category.toLowerCase();
    let score = 0;
    
    if (shapeLower.includes('round') && cat.includes('round')) score += 3;
    else if (shapeLower.includes('princess') && cat.includes('princess')) score += 3;
    else if (shapeLower.includes('emerald') && cat.includes('emerald')) score += 2;
    else if (shapeLower.includes('radiant') && cat.includes('radiant')) score += 2;
    
    if (cat.includes(carat.toFixed(1)) || cat.includes(Math.floor(carat).toString())) {
      score += 2;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }
  
  if (bestMatch && bestScore >= 3) {
    return {
      adjustment: bestMatch.change,
      index: bestMatch.index,
      marketShare: bestMatch.marketShare,
      confidence: bestScore >= 5 ? 'high' : 'medium',
      category: bestMatch.category
    };
  }
  
  return { adjustment: 0, confidence: 'low' };
}

// 計算單顆鑽石估價
function evaluateDiamond(diamond, rapaportData, idexData) {
  const shape = diamond.Shape || diamond.shape || '';
  const carat = parseFloat(diamond.Crt || diamond.carat || diamond['Carat'] || 0);
  const color = diamond.Color || diamond.color || '';
  const clarity = diamond.Clarity || diamond.clarity || '';
  
  if (!shape || !carat || !color || !clarity) {
    return null;
  }
  
  const rapaport = calculateRapaportPrice(rapaportData, shape, carat, color, clarity);
  if (!rapaport) {
    return { error: '無法計算 Rapaport 價格' };
  }
  
  const idexAdj = getIDEXAdjustment(idexData, shape, carat);
  const basePrice = rapaport.basePrice;
  
  const conservativePrice = basePrice * 0.65;
  const marketPrice = basePrice * 0.75 * (1 + idexAdj.adjustment / 100);
  const optimisticPrice = basePrice * 0.85;
  
  return {
    shape, carat, color, clarity,
    rapaportBase: basePrice.toFixed(2),
    conservative: conservativePrice.toFixed(2),
    market: marketPrice.toFixed(2),
    optimistic: optimisticPrice.toFixed(2),
    idexAdjustment: idexAdj.adjustment,
    idexConfidence: idexAdj.confidence
  };
}

// 主估值函數
async function evaluateStockList() {
  try {
    log('\n💎 Stock List 混合估值系統 (Optimized)');
    log('=' .repeat(60));
    
    const rapaportData = loadRapaport();
    const idexData = loadIDEX();
    const stockList = loadStockList();
    
    if (!rapaportData || !stockList) {
      log('❌ 缺少必要數據');
      flush();
      return;
    }
    
    log(`📊 載入 ${stockList.length} 顆鑽石`);
    if (idexData) {
      log(`📈 IDEX 數據: ${new Date(idexData.timestamp).toLocaleDateString('zh-HK')}`);
    }
    log('');
    
    const results = [];
    let totalConservative = 0;
    let totalMarket = 0;
    let totalOptimistic = 0;
    let errorCount = 0;
    
    // 逐顆估值
    for (const diamond of stockList) {
      try {
        const evaluation = evaluateDiamond(diamond, rapaportData, idexData);
        if (evaluation && !evaluation.error) {
          results.push({
            ...evaluation,
            parcelName: diamond['Parcel Name'] || diamond.parcelName || 'N/A'
          });
          
          totalConservative += parseFloat(evaluation.conservative);
          totalMarket += parseFloat(evaluation.market);
          totalOptimistic += parseFloat(evaluation.optimistic);
        } else if (evaluation?.error) {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
        // 繼續處理下一顆，唔中斷
      }
    }
    
    // 顯示結果 (只顯示前20個，減少輸出量)
    log('估值結果:');
    log('-'.repeat(60));
    log(`${'Parcel'.padEnd(15)} ${'Shape'.padEnd(6)} ${'Crt'.padEnd(6)} ${'Color'.padEnd(5)} ${'Clarity'.padEnd(7)} ${'保守價'.padEnd(10)} ${'市場價'.padEnd(10)} ${'樂觀價'.padEnd(10)}`);
    log('-'.repeat(60));
    
    results.slice(0, 20).forEach(r => {
      log(`${r.parcelName.substring(0, 14).padEnd(15)} ` +
          `${r.shape.substring(0, 5).padEnd(6)} ` +
          `${r.carat.toString().padEnd(6)} ` +
          `${r.color.padEnd(5)} ` +
          `${r.clarity.padEnd(7)} ` +
          `$${parseFloat(r.conservative).toLocaleString().padEnd(9)} ` +
          `$${parseFloat(r.market).toLocaleString().padEnd(9)} ` +
          `$${parseFloat(r.optimistic).toLocaleString().padEnd(9)}`);
    });
    
    if (results.length > 20) {
      log(`...還有 ${results.length - 20} 顆`);
    }
    
    if (errorCount > 0) {
      log(`⚠️ ${errorCount} 顆無法估值`);
    }
    
    log('-'.repeat(60));
    log('\n📊 總估值:');
    log(`  保守總值:  $${totalConservative.toLocaleString()}`);
    log(`  市場總值:  $${totalMarket.toLocaleString()}`);
    log(`  樂觀總值:  $${totalOptimistic.toLocaleString()}`);
    log(`\n  共 ${results.length} 顆鑽石`);
    
    // 保存結果
    const resultFile = path.join(__dirname, '../memory/stock_evaluation_latest.json');
    fs.writeFileSync(resultFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalDiamonds: results.length,
        errorCount,
        conservative: totalConservative,
        market: totalMarket,
        optimistic: totalOptimistic
      },
      details: results
    }, null, 2));
    
    log(`\n💾 詳細結果已保存: memory/stock_evaluation_latest.json`);
    
    // 一次性輸出所有結果
    flush();
    
  } catch (err) {
    console.error(`❌ 估值失敗: ${err.message}`);
    process.exit(1);
  }
}

// 顯示歷史趨勢
function showTrends() {
  try {
    const historyFile = path.join(__dirname, '../memory/idex_price_history.json');
    if (!fs.existsSync(historyFile)) {
      console.log('⚠️ 無歷史數據');
      return;
    }
    
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    console.log('\n📈 IDEX 價格趨勢（最近7天）');
    console.log('='.repeat(60));
    
    const recent = history.slice(-7);
    recent.forEach(h => {
      const date = new Date(h.timestamp).toLocaleDateString('zh-HK');
      const round1ct = h.data.find(d => d.category.includes('1.00-1.49') && d.category.includes('Round'));
      if (round1ct) {
        console.log(`${date}: Round 1ct 指數 ${round1ct.index} (${round1ct.change >= 0 ? '+' : ''}${round1ct.change}%)`);
      }
    });
  } catch (err) {
    console.error(`❌ 顯示趨勢失敗: ${err.message}`);
  }
}

// Main
const cmd = process.argv[2];

// 加全局錯誤處理
process.on('uncaughtException', (err) => {
  console.error(`❌ 未捕獲錯誤: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`❌ 未處理 Promise: ${reason}`);
  process.exit(1);
});

switch(cmd) {
  case 'evaluate':
    evaluateStockList();
    break;
  case 'trend':
    showTrends();
    break;
  default:
    console.log('Stock List 混合估值系統 (Optimized v2)');
    console.log('');
    console.log('用法:');
    console.log('  node scripts/stock_valuation.js evaluate  # 估值 Stock list');
    console.log('  node scripts/stock_valuation.js trend     # 顯示價格趨勢');
}
