#!/usr/bin/env node
/**
 * Update Stock List - 鑽石庫存更新腳本
 * 
 * 功能：
 * 1. 讀取 Desktop/Stock list/ 既最新 Excel 檔案（或指定檔案）
 * 2. 解析數據（支持 DN 格式同傳統格式）
 * 3. 同現有庫存合併（新增 + 移除已售）
 * 4. 生成 Excel 報表同變更報告
 * 5. 可選：發送到 Discord
 * 
 * 用法：
 *   node scripts/update_stock_list.js                     # 正常模式（自動搵最新檔案）
 *   node scripts/update_stock_list.js --quiet             # 簡潔模式
 *   node scripts/update_stock_list.js --discord           # 發送到 Discord
 *   node scripts/update_stock_list.js --file /path/to/file.xlsx  # 指定檔案
 *   node scripts/update_stock_list.js -f /path/to/file.xlsx      # 短選項
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { execSync } = require('child_process');

// ==================== 配置 ====================
const CONFIG = {
  inputDir: '/Users/ally/Desktop/Stock list',
  outputDir: '/Users/ally/.openclaw/workspace/memory',
  dbFile: '/Users/ally/.openclaw/workspace/memory/diamond_stock.json',
  minCarat: 1.00,
  discordChannel: '1473376125584670872', // ⚙️系統
};

// ==================== 工具函數 ====================
const quiet = process.argv.includes('--quiet') || process.argv.includes('-q');
const sendDiscord = process.argv.includes('--discord');

// 檢查係咪有指定檔案路徑
const customFileIndex = process.argv.findIndex(arg => arg === '--file' || arg === '-f');
const customFilePath = customFileIndex !== -1 && process.argv[customFileIndex + 1] 
  ? process.argv[customFileIndex + 1] 
  : null;

function log(msg, force = false) {
  if (!quiet || force) console.log(msg);
}

function getToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
}

function getYYYYMMDD() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// ==================== 核心功能 ====================

/**
 * 搵到最新既 Stock list 檔案
 */
function findLatestFile() {
  // 如果指定咗檔案路徑，直接用
  if (customFilePath && fs.existsSync(customFilePath)) {
    log(`   使用指定檔案: ${path.basename(customFilePath)}`);
    return customFilePath;
  }
  
  const files = fs.readdirSync(CONFIG.inputDir)
    .filter(f => (f.toLowerCase().startsWith('stock list') || f.startsWith('DN_')) && (f.endsWith('.xlsx') || f.endsWith('.xls')))
    .sort().reverse();
  
  if (files.length === 0) {
    throw new Error('喺 Desktop/Stock list/ 搵唔到檔案');
  }
  
  return path.join(CONFIG.inputDir, files[0]);
}

/**
 * 讀取 Excel 並解析
 */
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  
  // 檢測係咪 DN 格式（有 Rapnet 欄）
  const sampleRow = data.find(r => r['Cert No']);
  const isDNFormat = sampleRow && 'Rapnet' in sampleRow;
  
  log(`   格式: ${isDNFormat ? 'DN' : '傳統'}`);
  
  // 篩選同映射
  return data.filter(row => {
    const carat = parseFloat(row.Crt || row.Carat);
    const certNo = row['Cert No']?.toString().trim();
    return row['Parcel Name'] && 
           row['Parcel Name'] !== 'TOTAL' &&
           !isNaN(carat) && 
           carat >= CONFIG.minCarat &&
           certNo;
  }).map(row => ({
    parcel: row['Parcel Name'],
    shape: row.Rapnet || row.Shape || '',
    carat: parseFloat(row.Crt || row.Carat) || 0,
    color: row.Color || '',
    clarity: row.Clarity || '',
    cut: row.Cut || '',
    polish: row.Polish || '',
    symmetry: row.Symm || '',
    lab: row.Lab || '',
    certNo: row['Cert No']?.toString(),
    memoPrice: parseFloat(row['Memo Out T.List']) || 0,
    price: parseFloat(row['Price 4']) || 0,
    updated: getToday()
  }));
}

/**
 * 讀取現有庫存
 */
function loadExisting() {
  if (!fs.existsSync(CONFIG.dbFile)) return [];
  return JSON.parse(fs.readFileSync(CONFIG.dbFile, 'utf8'));
}

/**
 * 合併數據
 */
function mergeData(existing, incoming) {
  const existingMap = new Map(existing.map(item => [item.certNo, item]));
  const incomingMap = new Map(incoming.map(item => [item.certNo, item]));
  
  // 新增：incoming 有但 existing 冇
  const newItems = incoming.filter(item => !existingMap.has(item.certNo));
  
  // 已售：existing 有但 incoming 冇
  const soldItems = existing.filter(item => !incomingMap.has(item.certNo));
  
  // 更新：保留 incoming 既所有項目（新 + 舊更新）
  const merged = incoming.map(item => ({
    ...item,
    addedDate: existingMap.has(item.certNo) 
      ? existingMap.get(item.certNo).addedDate 
      : getToday()
  }));
  
  return { merged, newItems, soldItems };
}

/**
 * 生成 Excel
 */
async function generateExcel(data, filename) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Stock');
  
  // 標題
  sheet.columns = [
    { header: 'Parcel', key: 'parcel', width: 20 },
    { header: 'Shape', key: 'shape', width: 12 },
    { header: 'Carat', key: 'carat', width: 10 },
    { header: 'Color', key: 'color', width: 8 },
    { header: 'Clarity', key: 'clarity', width: 10 },
    { header: 'Lab', key: 'lab', width: 8 },
    { header: 'Cert No', key: 'certNo', width: 15 },
    { header: 'Memo Price', key: 'memoPrice', width: 12 },
    { header: 'Price', key: 'price', width: 12 },
  ];
  
  // 數據
  data.forEach(item => sheet.addRow(item));
  
  // 樣式
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: 'center' };
  
  await workbook.xlsx.writeFile(filename);
  return filename;
}

/**
 * 發送到 Discord
 */
function notifyDiscord(newCount, soldCount) {
  if (!sendDiscord) return;
  
  const msg = `📦 Stock List Updated\n\n• New items: ${newCount}\n• Sold items: ${soldCount}\n• Total: ${newCount + soldCount} items processed`;
  
  try {
    execSync(`openclaw message send --channel discord -t "${CONFIG.discordChannel}" -m "${msg}"`, { stdio: 'pipe' });
    log('   ✅ Discord 通知已發送', true);
  } catch (e) {
    log('   ⚠️ Discord 發送失敗', true);
  }
}

// ==================== 主程式 ====================

async function main() {
  try {
    log('🔷 Update Stock List\n', true);
    
    // 1. 搵檔案
    const inputFile = findLatestFile();
    log(`📁 檔案: ${path.basename(inputFile)}`);
    
    // 2. 解析
    log('📖 讀取中...');
    const incomingData = parseExcel(inputFile);
    log(`   ✓ ${incomingData.length} 粒鑽石`, true);
    
    // 3. 讀取現有庫存
    const existingData = loadExisting();
    log(`📊 現有庫存: ${existingData.length} 粒`);
    
    // 4. 合併
    const { merged, newItems, soldItems } = mergeData(existingData, incomingData);
    
    log(`\n📈 變更摘要:`, true);
    log(`   新增: ${newItems.length} 粒`, true);
    log(`   已售: ${soldItems.length} 粒`, true);
    log(`   總數: ${merged.length} 粒`, true);
    
    // 5. 保存數據庫
    fs.writeFileSync(CONFIG.dbFile, JSON.stringify(merged, null, 2));
    log(`\n💾 已更新: ${CONFIG.dbFile}`, true);
    
    // 6. 生成 Excel
    const dateStr = getYYYYMMDD();
    const mainFile = await generateExcel(merged, `${CONFIG.outputDir}/Stock_List (${dateStr}).xlsx`);
    
    if (newItems.length > 0) {
      await generateExcel(newItems, `${CONFIG.outputDir}/New_Items (${dateStr}).xlsx`);
    }
    if (soldItems.length > 0) {
      await generateExcel(soldItems, `${CONFIG.outputDir}/Sold_Items (${dateStr}).xlsx`);
    }
    
    log(`📄 Excel: ${path.basename(mainFile)}`, true);
    
    // 7. Discord 通知
    notifyDiscord(newItems.length, soldItems.length);
    
    log('\n✅ 完成', true);
    
  } catch (error) {
    log(`\n❌ 錯誤: ${error.message}`, true);
    process.exit(1);
  }
}

main();
