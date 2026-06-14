#!/usr/bin/env node
/**
 * Stock List Import - Merge new stock into template and update database
 * 
 * Usage: node scripts/import_stock.js <new_stock_file.xlsx>
 * 
 * Flow:
 * 1. Read new stock list from input file
 * 2. Map columns using template format
 * 3. Merge with existing diamond_stock.json
 * 4. Save as new file: Stock List (YYYY-MM-DD).xlsx
 * 5. Update diamond_stock.json
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const TEMPLATE_PATH = '/Users/ally/Desktop/Stock list Template/Stock list Template.xlsx';
const OUTPUT_DIR = '/Users/ally/Desktop/Stock list';
const DATABASE_PATH = '/Users/ally/.openclaw/workspace/memory/diamond_stock.json';

// Column mapping from template
const COLUMN_MAP = {
  'Parcel Name': 'parcel',
  'Shape': 'shape',
  'Crt': 'carat',
  'Color': 'color',
  'Clarity': 'clarity',
  'Cut': 'cut',
  'Pol': 'pol',
  'Symm': 'symm',
  'Measurement': 'measurement',
  'Depth': 'depth',
  'Table': 'table',
  'Fluor': 'fluor',
  'Lab': 'lab',
  'Cert No': 'certNo',
  'Memo In Price': 'memoInPrice',
  'Price': 'price'
};

function loadDatabase() {
  if (fs.existsSync(DATABASE_PATH)) {
    const data = fs.readFileSync(DATABASE_PATH, 'utf8');
    return JSON.parse(data);
  }
  return [];
}

function saveDatabase(data) {
  // Backup first
  if (fs.existsSync(DATABASE_PATH)) {
    const backupPath = `${DATABASE_PATH}.bak.${new Date().toISOString().split('T')[0]}`;
    fs.copyFileSync(DATABASE_PATH, backupPath);
    console.log(`📦 Backup created: ${backupPath}`);
  }
  fs.writeFileSync(DATABASE_PATH, JSON.stringify(data, null, 2));
  console.log(`💾 Database saved: ${DATABASE_PATH}`);
}

function readNewStock(filePath) {
  console.log(`📖 Reading new stock: ${path.basename(filePath)}`);
  
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet);
  
  console.log(`   Total rows: ${jsonData.length}`);
  
  // Extract date from filename
  const dateMatch = path.basename(filePath).match(/\((\d{4})-(\d{2})-(\d{2})\)/);
  const stockDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toISOString().split('T')[0];
  
  // Filter and map data
  const items = jsonData.filter(row => {
    const parcel = row['Parcel Name'];
    const carat = parseFloat(row['Crt']);
    const certNo = row['Cert No'];
    
    return parcel && 
           parcel !== 'TOTAL' && 
           !isNaN(carat) && 
           carat >= 1.00 &&
           certNo &&
           certNo.toString().trim() !== '';
  }).map(row => {
    const item = {
      stockDate: stockDate
    };
    
    for (const [excelCol, jsonKey] of Object.entries(COLUMN_MAP)) {
      let value = row[excelCol];
      
      // Type conversions
      if (jsonKey === 'carat' || jsonKey === 'depth' || jsonKey === 'table') {
        value = parseFloat(value);
      } else if (jsonKey === 'memoInPrice' || jsonKey === 'price') {
        value = parseInt(value) || 0;
      }
      
      item[jsonKey] = value;
    }
    
    return item;
  });
  
  console.log(`   Valid items: ${items.length}`);
  return { items, stockDate };
}

function mergeWithExisting(newItems, existingData) {
  console.log(`\n🔍 Merging with existing database...`);
  console.log(`   Existing: ${existingData.length} items`);
  console.log(`   New: ${newItems.length} items`);
  
  // Create map of existing items by certNo
  const existingMap = new Map();
  for (const item of existingData) {
    if (item.certNo) {
      existingMap.set(item.certNo.toString(), item);
    }
  }
  
  let added = 0;
  let updated = 0;
  const soldItems = [];
  
  // Check for sold items (exist in DB but not in new)
  const newCertNos = new Set(newItems.map(i => i.certNo?.toString()));
  for (const [certNo, item] of existingMap) {
    if (!newCertNos.has(certNo)) {
      soldItems.push(item);
    }
  }
  
  // Merge new items
  const merged = [];
  const seenCertNos = new Set();
  
  for (const newItem of newItems) {
    const certNo = newItem.certNo?.toString();
    if (!certNo) continue;
    
    seenCertNos.add(certNo);
    
    if (existingMap.has(certNo)) {
      // Update existing
      merged.push({ ...existingMap.get(certNo), ...newItem });
      updated++;
    } else {
      // Add new
      merged.push(newItem);
      added++;
    }
  }
  
  console.log(`\n📈 Results:`);
  console.log(`   Added: ${added}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Sold: ${soldItems.length}`);
  
  return { merged, soldItems };
}

function saveToTemplate(items, stockDate) {
  console.log(`\n💾 Saving to template...`);
  
  // Load template
  const templateWorkbook = XLSX.readFile(TEMPLATE_PATH);
  const templateSheet = templateWorkbook.Sheets['Stock'];
  
  // Clear existing data (keep header row)
  const newSheet = { ...templateSheet };
  newSheet['!ref'] = `A1:P${items.length + 1}`;
  
  // Write header
  const headers = Object.keys(COLUMN_MAP);
  
  // Write data
  let rowIndex = 2;
  for (const item of items) {
    let colIndex = 0;
    for (const header of headers) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex - 1, c: colIndex });
      const jsonKey = COLUMN_MAP[header];
      let value = item[jsonKey];
      
      // Handle undefined/null
      if (value === undefined || value === null) {
        value = '';
      }
      
      newSheet[cellRef] = { t: typeof value === 'number' ? 'n' : 's', v: value };
      colIndex++;
    }
    rowIndex++;
  }
  
  // Create new workbook with the sheet
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, newSheet, 'Stock');
  
  // Save with date
  const outputPath = path.join(OUTPUT_DIR, `Stock List (${stockDate}).xlsx`);
  XLSX.writeFile(newWorkbook, outputPath);
  
  console.log(`✅ Saved: ${outputPath}`);
  return outputPath;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node scripts/import_stock.js <new_stock_file.xlsx>');
    console.log('\nExample:');
    console.log('  node scripts/import_stock.js ~/Downloads/Stock\ List\ \(2026-02-24\).xlsx');
    process.exit(1);
  }
  
  const newStockFile = args[0];
  
  if (!fs.existsSync(newStockFile)) {
    console.error(`❌ File not found: ${newStockFile}`);
    process.exit(1);
  }
  
  console.log('🔷 Stock List Import - Starting...\n');
  
  // Step 1: Read new stock
  const { items: newItems, stockDate } = readNewStock(newStockFile);
  
  if (newItems.length === 0) {
    console.log('⚠️  No valid items found in file');
    process.exit(1);
  }
  
  // Step 2: Load existing database
  const existingData = loadDatabase();
  
  // Step 3: Merge
  const { merged, soldItems } = mergeWithExisting(newItems, existingData);
  
  // Step 4: Save to template (new file)
  const outputPath = saveToTemplate(merged, stockDate);
  
  // Step 5: Update database
  saveDatabase(merged);
  
  // Summary
  console.log('\n✨ Done!');
  console.log(`   Output: ${outputPath}`);
  console.log(`   Total items: ${merged.length}`);
}

main();
