#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };
const { getHKTDate } = require('./lib/time');

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

const { HOME, MEMORY_DIR } = require('./lib/config');
const DESKTOP_STOCK_DIR = path.join(HOME, 'Desktop', 'Stock list');
const OUTPUT_JSON = path.join(MEMORY_DIR, 'diamond_stock.json');

const { atomicWriteSync } = require('./lib/state');

function readConsolidatedStockList(filePath) {
  log(`📖 Reading: ${path.basename(filePath)}`);

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (jsonData.length === 0) {
      log(`⚠️  No data found`);
      return [];
    }

    log(`   Found ${jsonData.length} rows`);

    // Filter: >=1ct + 有 Cert No
    const filtered = jsonData.filter(row => {
      const carat = parseFloat(row['Shape']);  // Column D (labeled "Shape" but actual Carat)
      const certNo = row['Cert No'];

      return carat >= 1.00 &&
             certNo &&
             certNo.toString().trim() !== '';
    });

    log(`   Filtered: ${filtered.length} items (>=1ct + has cert)`);

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
      'Memo In Price': row['Memo Out T.List'] || '',  // Keep for Excel output
      'Price': row['Price 4'] || ''           // From Price 4 column (Discount %)
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

    // 2. Same group (both RBC or both non-RBC) - sort by Shape first
    if (shapeA !== shapeB) {
      return shapeA.localeCompare(shapeB);
    }

    // 3. Same Shape - sort by Carat descending
    return caratB - caratA;
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
  log('📝 Creating formatted Excel...');

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
  try {
    XLSX.writeFile(newWb, outputPath);
    log(`   ✅ Formatted Excel saved: ${path.basename(outputPath)}`);
  } catch (err) {
    console.error(`❌ Failed to write Excel file: ${err.message}`);
  }
}

function backupExistingData() {
  try {
    if (fs.existsSync(OUTPUT_JSON)) {
      const today = getHKTDate();
      const backupPath = OUTPUT_JSON.replace('.json', `.bak.${today}`);
      try {
        fs.copyFileSync(OUTPUT_JSON, backupPath);
      } catch (err) {
        console.error(`❌ Backup copy failed: ${err.message}`);
      }
      log(`📦 Backup created: ${backupPath}\n`);

      let oldData = [];
      try {
        try {
          oldData = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf8'));
        } catch (e) {
          console.error('⚠️ Failed to parse output JSON:', e.message);
          oldData = null;
        }
      } catch (err) {
        console.error(`❌ Failed to read existing data: ${err.message}`);
      }
      log(`📊 Existing data: ${oldData.length} items\n`);
      return oldData;
    }
    log('⚠️  No existing data found, starting fresh\n');
    return [];
  } catch (err) {
    console.error(`❌ Backup failed: ${err.message}`);
    return [];
  }
}

function findSoldItems(oldData, newData) {
  if (!Array.isArray(oldData) || !Array.isArray(newData)) {
    return [];
  }
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

// 抽出 cert 驗證 — 區分「成功」(有 cert) 同「跳過」(冇 cert)
function cert(row) {
  const certNo = row['Cert No'];
  if (!certNo) {
    return { success: false, skipped: true, reason: 'missing cert number' };
  }
  return { success: true, skipped: false, reason: null, value: certNo };
}

function removeDuplicates(data) {
  const seen = new Set();
  const seenNoCert = new Set();  // Medium Fix: Track no-cert items by parcel+shape+carat
  const duplicates = [];
  const noCertDuplicates = [];   // Track duplicates among no-cert items
  let skippedCount = 0;
  let keptCount = 0;

  const unique = data.filter(d => {
    try {
      const c = cert(d);
      if (c.skipped) {
        // Medium Fix: No-cert items still need dedup — use Parcel+Shape+Carat as fallback key
        skippedCount++;
        const parcel = d['Parcel Name'] || '';
        const shape = d['Shape'] || '';
        const carat = d['Crt'] || '';
        const noCertKey = `${parcel}|${shape}|${carat}`;

        if (seenNoCert.has(noCertKey)) {
          noCertDuplicates.push(d);
          return false;  // Remove duplicate no-cert item
        }
        seenNoCert.add(noCertKey);
        return true;  // Keep unique no-cert item
      }
      if (seen.has(c.value)) {
        duplicates.push(d);
        return false;
      }
      seen.add(c.value);
      keptCount++;  // 成功 dedup
      return true;
    } catch (err) {
      log(`⚠️ Failed to process item: ${err.message}`);
      return false;  // Remove items that fail processing
    }
  });

  if (duplicates.length > 0) {
    log(`\n⚠️  Found ${duplicates.length} duplicate(s) - removed:`);
    duplicates.forEach(d => log(`   ${d['Parcel Name']} ${d['Shape']} ${d['Crt']} ${d['Cert No']}`));
  } else {
    log(`\n✅ No duplicates found`);
  }
  if (noCertDuplicates.length > 0) {
    log(`   ⚠️  ${noCertDuplicates.length} no-cert duplicate(s) also removed`);
  }
  if (skippedCount > 0) {
    log(`   ℹ️  ${skippedCount} no-cert item(s) processed (with fallback dedup by parcel)`);
  }

  return { data: unique, kept: keptCount, skipped: skippedCount, duplicates: duplicates.length, noCertDuplicates: noCertDuplicates.length };
}

function createSoldStockNote(soldItems) {
  if (soldItems.length === 0) {
    log('ℹ️  No sold items to record\n');
    return;
  }

  const today = getHKTDate();
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
    log(`✅ Created Sold stock note: ${noteTitle} (${soldItems.length} items)\n`);
  } else {
    console.error('❌ Failed to create Sold stock note');
  }
}

function main() {
  log('🔷 Stock List Merger - Starting...\n');
  log('📋 Mode: Read consolidated Stock List file\n');

  // Check if XLSX is available
  try {
    require.resolve('xlsx');
  } catch {
    console.error('❌ xlsx module not found. Please run: npm install xlsx');
    process.exit(1);
  }

  // Backup existing data
  const oldData = backupExistingData();

  // Get file path from command line argument
  const inputFile = process.argv[2];

  // Input validation
  if (inputFile && (inputFile.includes('..') || inputFile.includes('\0'))) {
    console.error('❌ Invalid file path');
    process.exit(1);
  }

  if (!inputFile) {
    log('📝 Usage: node stock_updater.js <file_path>');
    log('   Example: node stock_updater.js ~/Desktop/Stock\\ list/Stock\\ List.xlsx');
    log('\n   Or without argument to use latest file in Desktop/Stock list/');
    process.exit(0);
  }

  try {
    if (!fs.existsSync(inputFile)) {
      console.error(`❌ File not found: ${inputFile}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`❌ Error checking file: ${e.message}`);
    process.exit(1);
  }

  log(`📁 Using file: ${inputFile}\n`);

  // Read the consolidated stock list (with correct mapping)
  const rawData = readConsolidatedStockList(inputFile);

  if (rawData.length === 0) {
    log('⚠️  No valid data found in file');
    process.exit(0);
  }

  // Remove duplicates by Cert No
  const dedupResult = removeDuplicates(rawData);
  const uniqueData = dedupResult.data;

  // Sort: RBC first, then by Carat descending
  const sortedData = sortStockData(uniqueData);

  // Add blank rows between shapes
  const finalData = addBlankRowsBetweenShapes(sortedData);

  log(`\n📈 Results:`);
  log(`   Old database: ${oldData.length} items`);
  log(`   New items: ${uniqueData.length}`);
  log(`   Final (with blanks): ${finalData.length}`);

  // Find sold items
  log('\n🔍 Checking for sold items...');
  const soldItems = findSoldItems(oldData, uniqueData);
  log(`   Sold items: ${soldItems.length}`);

  // Record sold items
  log('\n📝 Recording sold items to Apple Notes...');
  createSoldStockNote(soldItems);

  // Save JSON data (use uniqueData) - without Memo In Price
  const jsonData = uniqueData.map(item => {
    const { 'Memo In Price': _, ...rest } = item;
    return rest;
  });
  try {
    atomicWriteSync(OUTPUT_JSON, jsonData);
    log(`\n✅ Saved to: ${OUTPUT_JSON}`);
  } catch (err) {
    console.error(`❌ Failed to save JSON: ${err.message}`);
    process.exit(1);
  }

  // Create formatted Excel with auto-width and centering
  const excelPath = path.join(DESKTOP_STOCK_DIR, `Stock List (${getHKTDate()}).xlsx`);
  createFormattedExcel(finalData, excelPath);

  // Summary by shape
  const shapeCount = {};
  for (const item of rawData) {
    const shape = item['Shape'] || 'Unknown';
    shapeCount[shape] = (shapeCount[shape] || 0) + 1;
  }

  log('\n📋 Shape Summary:');
  for (const [shape, count] of Object.entries(shapeCount).sort((a, b) => b[1] - a[1])) {
    log(`   ${shape}: ${count}`);
  }

  log('\n✨ Done!');
}

main();
