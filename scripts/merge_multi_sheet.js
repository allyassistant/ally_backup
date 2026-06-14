#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Multi-Sheet Stock Merger - Professional Format
 * Merge sheets with Josh's specific formatting requirements
 *
 * Requirements:
 * - Columns: Parcel Name → Memo Price
 * - Filter: Must have GIA No
 * - Sort: Shape (RBC first) → Carat (desc) → Color (D→Z)
 * - Blank rows between different shapes
 * - Format: Center align, bold headers, auto-width
 * - Totals: Carat + Memo Price
 */

const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Output columns order
const OUTPUT_COLUMNS = [
  'Parcel Name', 'Shape', 'Crt', 'Color', 'Clarity',
  'Cut', 'Polish', 'Symm', 'Measurement', 'Depth',
  'Table', 'Fluor', 'Lab', 'Cert No', 'Memo Price'
];

// Color order for sorting (D to Z, then fancy colors)
const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

// Column mapping for each sheet format
const COLUMN_MAPPINGS = {
  'PRINT STOCK LIST': {
    'Parcel Name': 'Parcel Name', 'Shape': 'Shape', 'Crt': 'Crt',
    'Color': 'Color', 'Clarity': 'Clarity', 'Cut': 'Cut',
    'Polish': 'Polish', 'Symm': 'Symm', 'Measurement': 'Measurement',
    'Depth': 'Depth', 'Table': 'Table', 'Fluor': 'Fluor',
    'Lab': 'Lab', 'Cert No': 'Cert No',
    'Memo In Price': 'Memo Price', 'Memo Out T.List': 'Memo Price'
  },
  'HK Stock': {
    'Parcel Name': 'Parcel Name', 'Shape': 'Shape', 'Crt': 'Crt',
    'Color': 'Color', 'Clarity': 'Clarity', 'Cut': 'Cut',
    'Polish': 'Polish', 'Symm': 'Symm', 'Measurement': 'Measurement',
    'Depth': 'Depth', 'Table': 'Table', 'Fluor': 'Fluor',
    'Lab': 'Lab', 'Cert No': 'Cert No',
    'Memo In Price (NY)': 'Memo Price'
  },
  'TLV Stock': {
    'Parcel Name': 'Parcel Name', 'Shape': 'Shape', ' Crt': 'Crt',
    'Color': 'Color', 'Clarity': 'Clarity', 'Cut': 'Cut',
    'Pol': 'Polish', 'Symm': 'Symm', 'Measur': 'Measurement',
    'Depth': 'Depth', 'Table': 'Table', 'Fluor': 'Fluor',
    'Lab': 'Lab', 'Cert No': 'Cert No',
    ' Memo Out Price ': 'Memo Price', 'Price': 'Memo Price'
  },
  'NY stock': {
    'Parcel Name': 'Parcel Name', 'Shape': 'Shape', 'Crt': 'Crt',
    'Color': 'Color', 'Clarity': 'Clarity', 'Cut': 'Cut',
    'Pol': 'Polish', 'Symm': 'Symm', 'Measur': 'Measurement',
    'Depth': 'Depth', 'Table': 'Table', 'Fluor': 'Fluor',
    'Lab': 'Lab', 'Cert No': 'Cert No',
    ' Memo Price ': 'Memo Price'
  },
  'OTHER': {
    'Parcel Name': 'Parcel Name', 'Shape': 'Shape', ' Crt': 'Crt',
    'Color': 'Color', 'Clarity': 'Clarity', 'Cut': 'Cut',
    'Pol': 'Polish', 'Symm': 'Symm', 'Measur': 'Measurement',
    'Depth': 'Depth', 'Table': 'Table', 'Fluor': 'Fluor',
    'Lab': 'Lab', 'Cert No': 'Cert No',
    ' Memo In Price ': 'Memo Price', 'Price': 'Memo Price'
  }
};

// Detect and fix swapped Crt/Shape columns
function fixSwappedColumns(row) {
  const crtValue = row['Crt'];
  const shapeValue = row['Shape'];

  const crtIsText = typeof crtValue === 'string' && isNaN(parseFloat(crtValue));
  const shapeIsNumber = typeof shapeValue === 'number' ||
    (typeof shapeValue === 'string' && !isNaN(parseFloat(shapeValue)));

  if (crtIsText && shapeIsNumber) {
    return { ...row, 'Crt': shapeValue, 'Shape': crtValue };
  }
  return row;
}

function readSheet(wb, sheetName) {
  log(`\n📖 Reading: ${sheetName}`);

  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws);

  log(`   Found ${data.length} rows`);

  if (data.length === 0) return [];

  const actualHeaders = Object.keys(data[0]);
  log(`   Headers: ${actualHeaders.slice(0, 5).join(', ')}...`);

  const mapped = data.map((row, index) => {
    row = fixSwappedColumns(row);
    const mappedRow = {};

    OUTPUT_COLUMNS.forEach(col => mappedRow[col] = '');

    const mapping = COLUMN_MAPPINGS[sheetName] || {};

    for (const [actualCol, standardCol] of Object.entries(mapping)) {
      if (row[actualCol] !== undefined) {
        mappedRow[standardCol] = row[actualCol];
      } else {
        const foundKey = Object.keys(row).find(k =>
          k.toString().trim().toLowerCase() === actualCol.toLowerCase()
        );
        if (foundKey) mappedRow[standardCol] = row[foundKey];
      }
    }

    mappedRow['_Source'] = sheetName;
    return mappedRow;
  });

  return mapped;
}

function filterValidRows(rows) {
  return rows.filter(row => {
    const parcel = row['Parcel Name'];
    const carat = parseFloat(row['Crt']);
    const certNo = row['Cert No'];

    // Must have GIA No (Cert No)
    if (!certNo || certNo.toString().trim() === '') {
      return false;
    }

    // Skip empty/total rows
    if (!parcel || parcel.toString().toLowerCase().includes('total')) {
      return false;
    }

    // Must have valid carat
    if (isNaN(carat) || carat === 0) {
      return false;
    }

    return true;
  });
}

function sortRows(rows) {
  function getShapePriority(shape) {
    const upperShape = (shape || '').toString().toUpperCase().trim();
    if (['RBC', 'BR', 'ROUND', 'RD'].includes(upperShape)) return 0;
    return 1;
  }

  function getColorIndex(color) {
    const upperColor = (color || '').toString().toUpperCase().trim();
    const index = COLOR_ORDER.indexOf(upperColor);
    return index === -1 ? 999 : index;
  }

  return rows.sort((a, b) => {
    const shapeA = (a['Shape'] || '').toString().toUpperCase().trim();
    const shapeB = (b['Shape'] || '').toString().toUpperCase().trim();

    // 1. Shape priority (RBC first)
    const priorityA = getShapePriority(shapeA);
    const priorityB = getShapePriority(shapeB);
    if (priorityA !== priorityB) return priorityA - priorityB;

    // 2. Shape name alphabetically
    if (shapeA !== shapeB) return shapeA.localeCompare(shapeB);

    // 3. Carat descending
    const caratA = parseFloat(a['Crt']) || 0;
    const caratB = parseFloat(b['Crt']) || 0;
    if (caratB !== caratA) return caratB - caratA;

    // 4. Color D→Z
    return getColorIndex(a['Color']) - getColorIndex(b['Color']);
  });
}

// 抽出 key generation — 區分「成功」(有 key) 同「跳過」(冇 key)
function key(row) {
  const cert = row['Cert No']?.toString().trim();
  const parcel = row['Parcel Name']?.toString().trim();
  if (!cert || !parcel) {
    return { valid: false, value: null, reason: 'missing cert or parcel' };
  }
  return { valid: true, value: `${cert}_${parcel}_${row['Crt']}` };
}

// Return value semantics:
//   - included[] : rows in final output (valid+unique OR invalid-key)
//   - excluded[] : duplicate rows removed from output
//   - stats: { kept: valid+unique count, skipped: invalid-key count, duplicates: removed count }
function removeDuplicates(rows) {
  const seen = new Set();
  const excluded = [];  // duplicates removed
  const stats = { kept: 0, skipped: 0, duplicates: 0 };

  const included = rows.filter(row => {
    const k = key(row);

    if (!k.valid) {
      stats.skipped++;  // 跳過 dedup（冇 key）— 仍包含喺 output
      return true;
    }
    if (seen.has(k.value)) {
      excluded.push(row);
      stats.duplicates++;
      return false;
    }
    seen.add(k.value);
    stats.kept++;  // 成功 dedup
    return true;
  });

  if (excluded.length > 0) {
    log(`\n⚠️  Found ${excluded.length} duplicate(s) - removed`);
  }
  if (stats.skipped > 0) {
    log(`   ℹ️  ${stats.skipped} row(s) skipped dedup (missing cert/parcel)`);
  }

  return { included, excluded, stats };
}

function addBlankRowsBetweenShapes(rows) {
  const result = [];
  let lastShape = '';

  rows.forEach(row => {
    const currentShape = (row['Shape'] || '').toString().toUpperCase().trim();
    if (lastShape && currentShape !== lastShape && currentShape !== '') {
      // Add blank row
      const blankRow = {};
      OUTPUT_COLUMNS.forEach(col => blankRow[col] = '');
      result.push(blankRow);
    }
    result.push(row);
    lastShape = currentShape;
  });

  return result;
}

async function createFormattedExcel(data, outputPath) {
  log('\n📝 Creating formatted Excel...');

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Stock List');

  // Add headers
  worksheet.columns = OUTPUT_COLUMNS.map(col => ({
    header: col,
    key: col,
    width: 15
  }));

  // Style header row
  worksheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'center' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  });

  // Add data rows
  data.forEach(rowData => {
    const row = {};
    OUTPUT_COLUMNS.forEach(col => {
      row[col] = rowData[col] !== undefined ? rowData[col] : '';
    });
    worksheet.addRow(row);
  });

  // Calculate totals
  let totalCarat = 0;
  let totalPrice = 0;

  data.forEach(row => {
    const carat = parseFloat(row['Crt']) || 0;
    const price = parseFloat(row['Memo Price']) || 0;
    totalCarat += carat;
    totalPrice += price;
  });

  // Add blank row before totals
  worksheet.addRow({});

  // Add total row
  const totalRow = worksheet.addRow({
    'Parcel Name': 'TOTAL',
    'Crt': totalCarat.toFixed(2),
    'Memo Price': totalPrice.toFixed(2)
  });

  // Style total row
  totalRow.eachCell(cell => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'center' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE0E0' }
    };
  });

  // Center align all data cells
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) { // Skip header
      row.eachCell(cell => {
        cell.alignment = { horizontal: 'center', vertical: 'center' };
      });
    }
  });

  // Auto-fit columns
  worksheet.columns.forEach(column => {
    let maxLength = column.header.length;
    column.eachCell({ includeEmpty: false }, cell => {
      const cellValue = cell.value ? cell.value.toString().length : 0;
      if (cellValue > maxLength) maxLength = cellValue;
    });
    column.width = Math.min(maxLength + 4, 25);
  });

  await workbook.xlsx.writeFile(outputPath);
  log(`   ✅ Saved: ${path.basename(outputPath)}`);
  log(`   📊 Totals: ${totalCarat.toFixed(2)} carats, $${totalPrice.toFixed(2)}`);
}

async function main() {
  const inputFile = process.argv[2] || process.env.HOME + '/Desktop/Print Stock List (9.2025).xlsx';
  const outputFile = process.argv[3] || 'merged_stock_formatted.xlsx';

  // Input validation
  if (inputFile.includes('..') || inputFile.includes('\0') || outputFile.includes('..') || outputFile.includes('\0')) {
    console.error('❌ Invalid file path');
    process.exit(1);
  }

  log('🔷 Multi-Sheet Stock Merger (Professional Format)');
  log('================================================\n');
  log(`Input: ${inputFile}`);
  log(`Output: ${outputFile}\n`);

  // Read workbook
  log('📂 Reading workbook...');
  let wb;
  try {
    wb = XLSX.readFile(inputFile);
  } catch (e) {
    console.error(`❌ Failed to read workbook: ${e.message}`);
    process.exit(1);
  }

  log(`\nFound ${wb.SheetNames.length} sheets:`);
  wb.SheetNames.forEach((name, i) => log(`  ${i + 1}. ${name}`));

  // Read all sheets
  let allData = [];
  for (const sheetName of wb.SheetNames) {
    const sheetData = readSheet(wb, sheetName);
    allData = allData.concat(sheetData);
  }

  log(`\n📊 Total before filtering: ${allData.length}`);

  // Filter (must have GIA No)
  const validData = filterValidRows(allData);
  log(`   After filtering (must have GIA): ${validData.length}`);

  // Remove duplicates
  log('\n🔍 Checking for duplicates...');
  const { included: uniqueData, stats } = removeDuplicates(validData);
  log(`   After dedup: ${uniqueData.length} (kept: ${stats.kept}, skipped: ${stats.skipped}, duplicates removed: ${stats.duplicates})`);

  // Sort
  log('\n🔄 Sorting (Shape → Carat → Color)...');
  const sortedData = sortRows(uniqueData);

  // Add blank rows between shapes
  log('   Adding blank rows between shapes...');
  const finalData = addBlankRowsBetweenShapes(sortedData);

  // Create formatted output
  await createFormattedExcel(finalData, outputFile);

  log(`\n✅ Total items: ${uniqueData.length}`);
  log(`   Rows with blanks: ${finalData.length}`);
  log('\n✨ Done!');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
