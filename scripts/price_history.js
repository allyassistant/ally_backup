#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * 鑽石價格歷史記錄系統
 * 記錄查詢過嘅鑽石價格，提供相近規格參考
 */

const fs = require('fs');
const path = require('path');

const { MEMORY_DIR } = require('./lib/config');
const { getHKTDate, getHKTDateTime } = require('./lib/time');
const HISTORY_FILE = path.join(MEMORY_DIR, 'diamond_price_history.json');

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      return { records: [], lastUpdated: '' };
    }
  } catch (e) {
    console.error('Error: ' + e.message);
    return { records: [], lastUpdated: '' };
  }
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    console.error('Error: ' + e.message);
    return { records: [], lastUpdated: '' };
  }
}

function saveHistory(data) {
  try {
    const tmpPath = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, HISTORY_FILE);
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }
}

// 計算4C相似度分數
function calculateSimilarity(record, shape, carat, color, clarity) {
  let score = 0;

  // 形狀必須完全相同 (最高3分)
  if (record.shape.toUpperCase() === shape.toUpperCase()) {
    score += 3;
  }

  // 重量相近度 (最高3分)
  const caratDiff = Math.abs(record.carat - carat);
  if (caratDiff <= 0.1) score += 3;
  else if (caratDiff <= 0.3) score += 2;
  else if (caratDiff <= 0.5) score += 1;

  // 顏色相近度 (最高2分)
  const colorOrder = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
  const recordColorIdx = colorOrder.indexOf(record.color.toUpperCase());
  const queryColorIdx = colorOrder.indexOf(color.toUpperCase());
  const colorDiff = Math.abs(recordColorIdx - queryColorIdx);
  if (colorDiff === 0) score += 2;
  else if (colorDiff <= 1) score += 1;

  // 淨度相近度 (最高2分)
  const clarityOrder = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];
  const recordClarityIdx = clarityOrder.indexOf(record.clarity.toUpperCase());
  const queryClarityIdx = clarityOrder.indexOf(clarity.toUpperCase());
  const clarityDiff = Math.abs(recordClarityIdx - queryClarityIdx);
  if (clarityDiff === 0) score += 2;
  else if (clarityDiff <= 1) score += 1;

  return score;
}

// 添加新記錄
function addRecord(shape, carat, color, clarity, rapaportPrice, marketPrice, source = 'query') {
  const data = loadHistory();

  const record = {
    id: Date.now().toString(),
    timestamp: getHKTDateTime(),
    date: getHKTDate(),
    shape,
    carat,
    color,
    clarity,
    rapaportPrice,
    marketPrice,
    source
  };

  data.records.push(record);
  data.lastUpdated = getHKTDateTime();

  // 只保留最近 100 條記錄
  if (data.records.length > 100) {
    data.records = data.records.slice(-100);
  }

  saveHistory(data);
  return record;
}

// 查找相近記錄
function findSimilar(shape, carat, color, clarity, limit = 3) {
  const data = loadHistory();

  if (data.records.length === 0) {
    return [];
  }

  // 計算每條記錄嘅相似度
  const scored = data.records.map(record => ({
    ...record,
    similarity: calculateSimilarity(record, shape, carat, color, clarity)
  }));

  // 排序並返回最相似嘅
  scored.sort((a, b) => b.similarity - a.similarity);

  // 只返回相似度 >= 6 分嘅（形狀相同 + 至少一個其他條件高度匹配）
  return scored.filter(s => s.similarity >= 6).slice(0, limit);
}

// 顯示相近記錄
function showSimilarRecords(shape, carat, color, clarity) {
  const similar = findSimilar(shape, carat, color, clarity);

  if (similar.length === 0) {
    log('📭 暫無相近規格嘅歷史記錄');
    return;
  }

  log('\n📚 相近規格歷史成交參考:');
  log('-'.repeat(70));
  log(`${'日期'.padEnd(12)} ${'規格'.padEnd(25)} ${'相似度'.padEnd(8)} ${'當時市場價'.padEnd(15)}`);
  log('-'.repeat(70));

  similar.forEach(s => {
    const spec = `${s.shape} ${s.carat.toFixed(2)}ct ${s.color} ${s.clarity}`;
    const similarity = `${s.similarity}/10`;
    const price = `$${parseFloat(s.marketPrice).toLocaleString()}`;
    log(`${s.date.padEnd(12)} ${spec.substring(0, 24).padEnd(25)} ${similarity.padEnd(8)} ${price.padEnd(15)}`);
  });
  log('-'.repeat(70));
  log('💡 以與係之前查詢過嘅相近規格價格，供參考比較');
}

// 顯示所有記錄
function showAllRecords() {
  const data = loadHistory();

  log(`\n📊 共有 ${data.records.length} 條價格記錄`);

  if (data.records.length === 0) {
    log('暫無記錄');
    return;
  }

  log('-'.repeat(80));
  log(`${'日期'.padEnd(12)} ${'規格'.padEnd(30)} ${'Rapaport'.padEnd(12)} ${'市場價'.padEnd(12)}`);
  log('-'.repeat(80));

  data.records.slice(-10).reverse().forEach(r => {
    const spec = `${r.shape} ${r.carat.toFixed(2)}ct ${r.color} ${r.clarity}`;
    const rap = `$${parseFloat(r.rapaportPrice).toLocaleString()}`;
    const mkt = `$${parseFloat(r.marketPrice).toLocaleString()}`;
    log(`${r.date.padEnd(12)} ${spec.substring(0, 29).padEnd(30)} ${rap.padEnd(12)} ${mkt.padEnd(12)}`);
  });

  if (data.records.length > 10) {
    log(`...還有 ${data.records.length - 10} 條記錄`);
  }
}

// Main
const cmd = process.argv[2];

switch(cmd) {
  case 'add':
    const [shape, caratStr, color, clarity, rapPrice, mktPrice] = process.argv.slice(3);
    const caratNum = parseFloat(caratStr);
    const rapNum = parseFloat(rapPrice);
    const mktNum = parseFloat(mktPrice);
    if (isNaN(caratNum) || isNaN(rapNum) || isNaN(mktNum)) {
      console.error('❌ Invalid numeric arguments');
      process.exit(1);
    }
    const record = addRecord(shape, caratNum, color, clarity, rapNum, mktNum);
    log('✅ 已添加記錄:', record.id);
    break;

  case 'similar':
    const [sShape, sCarat, sColor, sClarity] = process.argv.slice(3);
    const sCaratNum = parseFloat(sCarat);
    if (isNaN(sCaratNum)) {
      console.error('❌ Invalid carat value');
      process.exit(1);
    }
    showSimilarRecords(sShape, sCaratNum, sColor, sClarity);
    break;

  case 'list':
    showAllRecords();
    break;

  default:
    log('鑽石價格歷史記錄系統');
    log('');
    log('用法:');
    log('  node scripts/price_history.js add <shape> <carat> <color> <clarity> <rapaport> <market>');
    log('  node scripts/price_history.js similar <shape> <carat> <color> <clarity>');
    log('  node scripts/price_history.js list');
    log('');
    log('例子:');
    log('  node scripts/price_history.js add EM 3.50 F VVS2 94500 70875');
    log('  node scripts/price_history.js similar EM 3.60 F VVS1');
}

module.exports = { addRecord, findSimilar, showSimilarRecords };
