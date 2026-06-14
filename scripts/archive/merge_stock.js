#!/usr/bin/env node
/**
 * Stock List Merger - Read consolidated Stock List into diamond_stock.json
 * Updated: 2026-02-24 - Fixed column mapping, template structure, sorting, formatting
 * 
 * Column Mapping (source → target):
 * - Shape (col D labeled wrong) → Carat
 * - Rapnet (col F labeled wrong) → Shape
 * - Price 4 → Price
 */

const fs = require('fs');
const path = require('path');
const { createNote } = require('./apple_notes')
const XLSX = require('xlsx');

const DESKTOP_STOCK_DIR = '/Users/ally/Desktop/Stock list';
const OUTPUT_JSON = '/Users/ally/.openclaw/workspace/memory/diamond_stock.json';

function readConsolidatedStockList(filePath) {
  console.log(`📖 Reading: ${path.basename(filePath)}`);
  
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    if (jsonData.length === 0) {
      console.log(`⚠️  No data found`);
      return [];
    }
    
    console.log(`   Found ${jsonData.length} rows`);
    
    // Filter: >=1ct + 有 Cert No
    const filtered = jsonData.filter(row => {
      const carat = parseFloat(row['Shape']);  // Column D (labeled "Shape" but actual Carat)
      const certNo = row['Cert No'];
      
      return carat >= 1.00 && 
             certNo && 
             certNo.toString().trim() !== '';
    });
    
    console.log(`   Filtered: ${filtered.length} items (>=1ct + has cert)`);
    
    // Map with Template column structure
    // Note: Column D (labeled "Shape") = actual Carat
    //       Column F (labeled "Rapnet") = actual Shape
    const mapped = filtered.map(row => ({
      'Parcel Name': row['Parcel Name'],
      'Shape': row['Rapnet'] || '',           // F → Shape
      'Crt': parseFloat(row['Shape']) || 0, // D → Carat (Crt)
      'Color': row['Color'] || '',
      'Clarity': row['Clarity'] || '',
      'Cut': row['Cut'] || '',
      'Pol': row['Polish'] || '',
      'Symm': row['Symm'] || '',
      'Measurement': row['Measurement'] || '',
      'Depth': row['Total Depth'] || '',
      'Table': row['Table Size'] || '',
      'Fluor': row['Flour'] || '',
      'Lab': row['Lab'] || '',
      'Cert No': row['Cert No']?.toString() || '',
      'Memo In Price': row['Memo Out T.List'] || '',
      'Price': row['Price 4'] || ''           // From Price 4 column
    }));
    
    return mapped;
    
  } catch (err) {
    console.error(`❌ Error reading ${filePath}: ${err.message}`);
    return [];
  }
}

function sortStockData(data) {
  // Sort: RBC first, then other shapes, within each group sort by Carat descending
  return data.sort((a, b) => {
    const shapeA = (a['Shape'] || '').toString().toUpperCase();
    const shapeB = (b['Shape'] || '').toString().toUpperCase();
    const caratA = a['Crt'] || 0;
    const caratB = b['Crt'] || 0;
    
    const isRBC_A = shapeA === 'RBC' || shapeA === 'RD' || shapeA === 'ROUND';
    const isRBC_B = shapeB === 'RBC' || shapeB === 'RD' || shapeB === 'ROUND';
    
    if (isRBC_A && !isRBC_B) return -1;
    if (!isRBC_A && isRBC_B) return 1;
    return caratB - caratA;  // Descending carat
  });
}

function addBlankRowsBetweenShapes(data) {
  // Add blank row between different shapes
  const result = [];
  let lastShape = '';
  
  data.forEach(row => {
    const currentShape = (row['Shape'] || '').toString().toUpperCase();
    if (lastShape && currentShape !== lastShape && currentShape !== '') {
      result.push({});  // Blank row
    }
    result.push(row);
    lastShape = currentShape;
  });
  
  return result;
}

function createFormattedExcel(data, outputPath) {
  console.log('📝 Creating formatted Excel...');
  
  const newWb = XLSX.utils.book_new();
  const newSheet = XLSX.utils.json_to_sheet(data);
  
  // Auto-fit column widths
  const headers = Object.keys(data[0] || {});
  const colWidthsAuto = headers.map((h) => {
    let maxLen = h.length;
    data.slice(0, 100).forEach(row => {
      const val = String(row[h] || '').length;
      if (val > maxLen) maxLen = val;
    });
    return {wch: Math.min(maxLen + 2, 30)};  // Cap at 30
  });
  
  newSheet['!cols'] = colWidthsAuto;
  
  // Apply center alignment + carat format
  const range = XLSX.utils.decode_range(newSheet['!ref']);
  const centerAlign = { alignment: { horizontal: 'center', vertical: 'center' } };
  
  for (let R = 0; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({r: R, c: C});
      if (!newSheet[addr]) continue;
      
      // Center alignment for ALL cells
      newSheet[addr].s = centerAlign;
      
      // Crt column (index 2) = 2 decimal places
      if (C === 2 && R > 0) {
        newSheet[addr].z = '0.00';
      }
    }
  }
  
  XLSX.utils.book_append_sheet(newWb, newSheet, 'Stock List');
  XLSX.writeFile(newWb, outputPath);
  console.log(`   ✅ Formatted Excel saved: ${path.basename(outputPath)}`);
}

function backupExistingData() {
  if (fs.existsSync(OUTPUT_JSON)) {
    const today = new Date().toISOString().split('T')[0];
    const backupPath = OUTPUT_JSON.replace('.json', `.bak.${today}`);
    fs.copyFileSync(OUTPUT_JSON, backupPath);
    console.log(`📦 Backup created: ${backupPath}\n`);
    
    const oldData = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf8'));
    console.log(`📊 Existing data: ${oldData.length} items\n`);
    return oldData;
  }
  console.log('⚠️  No existing data found, starting fresh\n');
  return [];
}

function findSoldItems(oldData, newData) {
  const newCertNos = new Set(newData.map(d => d['Cert No']).filter(Boolean));
  const newParcels = new Set(newData.map(d => d['Parcel Name']).filter(Boolean));
  
  return oldData.filter(old => {
    // 支持新舊兩種數據格式
    const oldCert = old['Cert No'] || old.certNo;
    const oldParcel = old['Parcel Name'] || old.parcel;
    
    const certSold = oldCert && !newCertNos.has(oldCert.toString());
    const parcelSold = oldParcel && !newParcels.has(oldParcel);
    return certSold || (!oldCert && parcelSold);
  });
}

function removeDuplicates(data) {
  const seen = new Set();
  const duplicates = [];
  
  const unique = data.filter(d => {
    const cert = d['Cert No'];
    if (!cert) return true;  // Keep items without cert
    if (seen.has(cert)) {
      duplicates.push(d);
      return false;
    }
    seen.add(cert);
    return true;
  });
  
  if (duplicates.length > 0) {
    console.log(`\n⚠️  Found ${duplicates.length} duplicate(s) - removed:`);
    duplicates.forEach(d => console.log(`   ${d['Parcel Name']} ${d['Shape']} ${d['Crt']} ${d['Cert No']}`));
  } else {
    console.log(`\n✅ No duplicates found`);
  }
  
  return unique;
}

function createSoldStockNote(soldItems) {
  if (soldItems.length === 0) {
    console.log('ℹ️  No sold items to record\n');
    return;
  }
  
  const today = new Date().toISOString().split('T')[0];
  const noteTitle = `Sold Stock - ${today}`;
  
  const contentLines = soldItems.map(item => {
    // 支持新舊兩種數據格式
    const parcel = item['Parcel Name'] || item.parcel || 'N/A';
    const shape = item['Shape'] || item.shape || 'N/A';
    const carat = item['Crt'] || item.carat || 0;
    const color = item['Color'] || item.color || 'N/A';
    const clarity = item['Clarity'] || item.clarity || 'N/A';
    const certNo = item['Cert No'] || item.certNo || 'N/A';
    
    return `${parcel} ${shape} ${carat}ct ${color} ${clarity} GIA:${certNo}`;
  });
  
  const bodyContent = contentLines.join('<br>');
  
  const success = createNote(noteTitle, bodyContent, "Sold stock");
  
  if (success) {
    console.log(`✅ Created Sold stock note: ${noteTitle} (${soldItems.length} items)\n`);
  } else {
    console.error('❌ Failed to create Sold stock note');
  }
}

function main() {
  console.log('🔷 Stock List Merger - Starting...\n');
  console.log('📋 Mode: Read consolidated Stock List file\n');
  
  // Check if XLSX is available
  try {
    require.resolve('xlsx');
  } catch {
    console.error('❌ xlsx module not found. Please run: npm install xlsx');
    process.exit(1);
  }
  
  // Backup existing data
  const oldData = backupExistingData();
  
  // Manual mode: user must specify file path
  console.log('📝 Usage: node merge_stock.js <file_path>');
  console.log('   Example: node merge_stock.js ~/Desktop/Stock\\ list/Stock\\ List.xlsx');
  process.exit(0);
  
  // Read the consolidated stock list (with correct mapping)
  const rawData = readConsolidatedStockList(inputFile);
  
  if (rawData.length === 0) {
    console.log('⚠️  No valid data found in file');
    process.exit(0);
  }
  
  // Remove duplicates by Cert No
  const uniqueData = removeDuplicates(rawData);
  
  // Sort: RBC first, then by Carat descending
  const sortedData = sortStockData(uniqueData);
  
  // Add blank rows between shapes
  const finalData = addBlankRowsBetweenShapes(sortedData);
  
  console.log(`\n📈 Results:`);
  console.log(`   Old database: ${oldData.length} items`);
  console.log(`   New items: ${uniqueData.length}`);
  console.log(`   Final (with blanks): ${finalData.length}`);
  
  // Find sold items
  console.log('\n🔍 Checking for sold items...');
  const soldItems = findSoldItems(oldData, uniqueData);
  console.log(`   Sold items: ${soldItems.length}`);
  
  // Record sold items
  console.log('\n📝 Recording sold items to Apple Notes...');
  createSoldStockNote(soldItems);
  
  // Save JSON data (use uniqueData)
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(uniqueData, null, 2));
  console.log(`\n✅ Saved to: ${OUTPUT_JSON}`);
  
  // Create formatted Excel with auto-width and centering
  const excelPath = path.join(DESKTOP_STOCK_DIR, `Stock List (${new Date().toISOString().split('T')[0]}).xlsx`);
  createFormattedExcel(finalData, excelPath);
  
  // Summary by shape
  const shapeCount = {};
  for (const item of rawData) {
    const shape = item['Shape'] || 'Unknown';
    shapeCount[shape] = (shapeCount[shape] || 0) + 1;
  }
  
  console.log('\n📋 Shape Summary:');
  for (const [shape, count] of Object.entries(shapeCount).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${shape}: ${count}`);
  }
  
  console.log('\n✨ Done!');
}

main();
