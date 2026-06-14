const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * V9 Stock List Integrator - Updated Version
 * Based on Josh's formatting requirements
 * 
 * Features:
 * - Columns: Parcel Name → Memo Price (15 columns)
 * - Filter: Must have GIA No
 * - Sort: Shape (RBC first) → Carat (desc) → Color (D→Z)
 * - Blank rows between different shapes
 * - Format: Center align, bold headers, auto-width
 * - Totals: Carat + Memo Price
 */

// Color order for sorting (D to Z)
const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

// Output columns in required order
const OUTPUT_COLUMNS = [
  { header: 'Parcel Name', key: 'Parcel Name', width: 15 },
  { header: 'Shape', key: 'Shape', width: 10 },
  { header: 'Crt', key: 'Crt', width: 8 },
  { header: 'Color', key: 'Color', width: 8 },
  { header: 'Clarity', key: 'Clarity', width: 10 },
  { header: 'Cut', key: 'Cut', width: 8 },
  { header: 'Polish', key: 'Polish', width: 8 },
  { header: 'Symm', key: 'Symm', width: 8 },
  { header: 'Measurement', key: 'Measurement', width: 18 },
  { header: 'Depth', key: 'Depth', width: 8 },
  { header: 'Table', key: 'Table', width: 8 },
  { header: 'Fluor', key: 'Fluor', width: 12 },
  { header: 'Lab', key: 'Lab', width: 8 },
  { header: 'Cert No', key: 'Cert No', width: 15 },
  { header: 'Memo Price', key: 'Memo Price', width: 14 },
];

// Shape priority (RBC/BR/Round first, then alphabetical)
function getShapePriority(shape) {
  const upperShape = (shape || '').toString().toUpperCase().trim();
  if (['RBC', 'BR', 'ROUND', 'RD'].includes(upperShape)) return 0;
  return 1;
}

// Normalize shape names
function normalizeShape(shape) {
  const upperShape = (shape || '').toString().toUpperCase().trim();
  if (upperShape === 'RD') return 'RAD';
  if (upperShape === 'BR') return 'RBC';
  if (upperShape === 'ROUND') return 'RBC';
  return shape;
}

// Parse carat value
function parseCarat(crt) {
  if (typeof crt === 'number') return crt;
  if (typeof crt === 'string') {
    const parsed = parseFloat(crt.replace(/,/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// Get color index for sorting
function getColorIndex(color) {
  const upperColor = (color || '').toString().toUpperCase().trim();
  const index = COLOR_ORDER.indexOf(upperColor);
  return index === -1 ? 999 : index;
}

// Check if GIA number is valid
function isValidGiaNumber(certNo) {
  if (!certNo) return false;
  const str = certNo.toString().trim();
  if (str === '' || str.toLowerCase().includes('total') || str.toLowerCase().includes('subtotal')) return false;
  return /^\d{5,20}$/.test(str.replace(/\s/g, ''));
}

// Read Excel file and extract data
async function readExcelFile(filePath) {
  console.log(`\n📖 Reading: ${filePath}`);
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  // Read all worksheets
  const allData = [];
  
  workbook.eachSheet((worksheet, sheetId) => {
    console.log(`   Sheet ${sheetId}: ${worksheet.name}`);
    
    const data = [];
    let headerRow = null;
    let headerMap = {};
    
    // Find header row
    worksheet.eachRow((row, rowNumber) => {
      if (headerRow) return;
      
      const values = row.values;
      const hasParcelName = values.some(v => v && v.toString().toLowerCase().includes('parcel'));
      const hasShape = values.some(v => v && v.toString().toLowerCase().includes('shape'));
      const hasCertNo = values.some(v => v && v.toString().toLowerCase().includes('cert'));
      
      if (hasParcelName || hasShape || hasCertNo) {
        headerRow = rowNumber;
        row.eachCell((cell, colNumber) => {
          const headerValue = cell.value ? cell.value.toString().trim() : '';
          headerMap[headerValue.toLowerCase()] = colNumber;
        });
      }
    });
    
    if (!headerRow) {
      console.warn(`   No header found in sheet: ${worksheet.name}`);
      return;
    }
    
    // Helper: Check if Shape/Crt columns are swapped
    function isRowSwapped(row) {
      const shapeCol = headerMap['shape'] || headerMap['shape '];
      const crtCol = headerMap['crt'] || headerMap[' crt'];
      
      if (!shapeCol || !crtCol) return false;
      
      const shapeValue = row.getCell(shapeCol).value;
      const crtValue = row.getCell(crtCol).value;
      
      const shapeIsNumber = !isNaN(parseFloat(shapeValue));
      const crtIsText = typeof crtValue === 'string' && isNaN(parseFloat(crtValue));
      
      return shapeIsNumber && crtIsText;
    }
    
    // Helper to get cell value
    function getValue(row, possibleNames, rowIsSwapped) {
      for (const name of possibleNames) {
        let colIndex = headerMap[name.toLowerCase()];
        
        if (rowIsSwapped) {
          if (name.toLowerCase() === 'crt' || name.toLowerCase() === 'carat') {
            colIndex = headerMap['shape'] || headerMap['shape '];
          } else if (name.toLowerCase() === 'shape' || name.toLowerCase() === 'shape ') {
            colIndex = headerMap['crt'] || headerMap[' crt'];
          }
        }
        
        if (colIndex) {
          return row.getCell(colIndex).value;
        }
      }
      return null;
    }
    
    // Read data rows
    for (let i = headerRow + 1; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const rowIsSwapped = isRowSwapped(row);
      
      const parcelName = getValue(row, ['Parcel Name', 'ParcelName', 'parcel name'], rowIsSwapped);
      const certNo = getValue(row, ['Cert No', 'CertNo', 'cert no', 'GIA NO', 'Cert#'], rowIsSwapped);
      const shape = getValue(row, ['Shape', 'shape', 'SHAPE'], rowIsSwapped);
      
      // Filter: Must have GIA No
      if (!parcelName || !shape) continue;
      if (!certNo || certNo.toString().toLowerCase().includes('total')) continue;
      if (parcelName.toString().toLowerCase().includes('total')) continue;
      if (!isValidGiaNumber(certNo)) continue;
      
      const item = {
        'Parcel Name': parcelName,
        'Shape': normalizeShape(shape),
        'Crt': getValue(row, ['Crt', 'crt', 'Carat', 'carat', 'CRT'], rowIsSwapped),
        'Color': getValue(row, ['Color', 'color', 'COLOR'], rowIsSwapped),
        'Clarity': getValue(row, ['Clarity', 'clarity', 'CLARITY'], rowIsSwapped),
        'Cut': getValue(row, ['Cut', 'cut', 'CUT'], rowIsSwapped),
        'Polish': getValue(row, ['Polish', 'polish', 'POLISH', 'Pol', 'pol', 'POL'], rowIsSwapped),
        'Symm': getValue(row, ['Symm', 'symm', 'SYMM', 'Sym', 'sym'], rowIsSwapped),
        'Measurement': getValue(row, ['Measurement', 'measurement', 'Measur', 'measur', 'MEASUR'], rowIsSwapped),
        'Depth': getValue(row, ['Depth', 'depth', 'DEPTH'], rowIsSwapped),
        'Table': getValue(row, ['Table', 'table', 'TABLE'], rowIsSwapped),
        'Fluor': getValue(row, ['Fluor', 'fluor', 'FLUOR', 'Fluorescence'], rowIsSwapped),
        'Lab': getValue(row, ['Lab', 'lab', 'LAB'], rowIsSwapped),
        'Cert No': certNo,
        'Memo Price': getValue(row, [
          'Memo Price', 'MemoPrice', 'memo price', 
          'Memo In Price', 'Memo In Price (NY)', 'Memo In Price ',
          'Memo Out Price', ' Memo Out Price ', 'Memo Out Price ',
          'Price', 'price'
        ], rowIsSwapped),
      };
      
      data.push(item);
    }
    
    // Count items with price
    const itemsWithPrice = data.filter(item => item['Memo Price'] && parseFloat(item['Memo Price']) > 0).length;
    const totalPrice = data.reduce((sum, item) => sum + (parseFloat(item['Memo Price']) || 0), 0);
    console.log(`   Read ${data.length} items (${itemsWithPrice} with price, total: $${totalPrice.toLocaleString()})`);
    allData.push(...data);
  });
  
  return allData;
}

// Sort data: Shape (RBC first) → Carat (desc) → Color (D→Z)
function sortData(data) {
  return data.sort((a, b) => {
    // Primary: Shape priority
    const shapePriorityA = getShapePriority(a['Shape']);
    const shapePriorityB = getShapePriority(b['Shape']);
    if (shapePriorityA !== shapePriorityB) return shapePriorityA - shapePriorityB;
    
    // Secondary: Shape name alphabetically
    const shapeA = (a['Shape'] || '').toString().toUpperCase();
    const shapeB = (b['Shape'] || '').toString().toUpperCase();
    if (shapeA !== shapeB) return shapeA.localeCompare(shapeB);
    
    // Tertiary: Carat descending
    const caratA = parseCarat(a['Crt']);
    const caratB = parseCarat(b['Crt']);
    if (caratB !== caratA) return caratB - caratA;
    
    // Quaternary: Color D→Z
    return getColorIndex(a['Color']) - getColorIndex(b['Color']);
  });
}

// Group by shape for blank row insertion
function groupByShape(data) {
  const groups = [];
  let currentGroup = [];
  let currentShape = null;
  
  for (const item of data) {
    const shape = (item['Shape'] || '').toString().toUpperCase();
    if (shape !== currentShape) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [item];
      currentShape = shape;
    } else {
      currentGroup.push(item);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);
  
  return groups;
}

// Remove duplicates by Cert No + Parcel Name + Carat
// When duplicate found, keep the one with Memo Price (prefer the one with price)
function removeDuplicates(data) {
  const seen = new Map(); // Use Map to store items by key
  const duplicates = [];
  
  for (const item of data) {
    const cert = (item['Cert No'] || '').toString().trim();
    const parcel = (item['Parcel Name'] || '').toString().trim();
    const carat = parseCarat(item['Crt']);
    
    const key = `${cert}_${parcel}_${carat}`;
    const currentPrice = parseFloat(item['Memo Price']) || 0;
    
    if (seen.has(key)) {
      // Duplicate found - compare prices and keep the one with higher price
      const existingItem = seen.get(key);
      const existingPrice = parseFloat(existingItem['Memo Price']) || 0;
      
      if (currentPrice > existingPrice) {
        // Current item has higher price, replace existing
        duplicates.push(existingItem);
        seen.set(key, item);
      } else {
        // Existing item has higher or same price, keep it
        duplicates.push(item);
      }
    } else {
      seen.set(key, item);
    }
  }
  
  const unique = Array.from(seen.values());
  
  if (duplicates.length > 0) {
    console.log(`\n⚠️  Found ${duplicates.length} duplicate(s), kept the ones with higher Memo Price`);
  }
  
  return unique;
}

// Create output Excel with professional formatting
async function createOutputExcel(data, outputPath) {
  console.log('\n📝 Creating formatted Excel...');
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Stock List');
  
  // Set columns
  worksheet.columns = OUTPUT_COLUMNS;
  
  // Style header row - bold and center
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'center' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // Group data by shape
  const groups = groupByShape(data);
  
  let totalCarat = 0;
  let totalPrice = 0;
  let rowNumber = 2;
  
  // Add data rows with blank rows between shapes
  groups.forEach((group, groupIndex) => {
    group.forEach(item => {
      const row = worksheet.getRow(rowNumber);
      
      // Set values for all columns
      OUTPUT_COLUMNS.forEach(col => {
        const key = col.key;
        if (key === 'Crt') {
          row.getCell(key).value = parseCarat(item[key]);
        } else if (key === 'Memo Price') {
          row.getCell(key).value = parseFloat(item[key]) || 0;
        } else {
          row.getCell(key).value = item[key] || '';
        }
      });
      
      // Format Crt column
      row.getCell('Crt').numFmt = '0.00';
      
      // Format Memo Price
      const priceCell = row.getCell('Memo Price');
      if (priceCell.value && priceCell.value !== 0) {
        priceCell.numFmt = '#,##0.00';
      }
      
      // Center alignment for all cells
      row.eachCell(cell => {
        cell.alignment = { horizontal: 'center', vertical: 'center' };
      });
      
      totalCarat += parseCarat(item['Crt']);
      totalPrice += parseFloat(item['Memo Price']) || 0;
      
      rowNumber++;
    });
    
    // Add blank row between shapes (except after last group)
    if (groupIndex < groups.length - 1) {
      rowNumber++;
    }
  });
  
  // Add totals row
  const totalRow = worksheet.getRow(rowNumber);
  totalRow.getCell('Parcel Name').value = 'TOTAL';
  totalRow.getCell('Crt').value = totalCarat;
  totalRow.getCell('Memo Price').value = totalPrice;
  
  // Format totals row
  totalRow.font = { bold: true };
  totalRow.getCell('Crt').numFmt = '0.00';
  totalRow.getCell('Memo Price').numFmt = '#,##0.00';
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFE0E0' }
  };
  
  // Center alignment for totals
  totalRow.eachCell(cell => {
    cell.alignment = { horizontal: 'center', vertical: 'center' };
  });
  
  // Auto-fit column widths
  worksheet.columns.forEach(column => {
    let maxLength = column.header.length;
    column.eachCell({ includeEmpty: true }, cell => {
      const cellValue = cell.value ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 8), 25);
  });
  
  await workbook.xlsx.writeFile(outputPath);
  
  console.log(`   ✅ Saved: ${path.basename(outputPath)}`);
  console.log(`   📊 ${data.length} items, ${totalCarat.toFixed(2)} carats, $${totalPrice.toLocaleString()}`);
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('V9 Stock List Integrator (Updated)');
    console.log('==================================\n');
    console.log('Usage: node v9_stock_integrator.js <input.xlsx> [output.xlsx]');
    console.log('\nFeatures:');
    console.log('  - Reads all sheets from input file');
    console.log('  - Filters: Must have GIA No');
    console.log('  - Sorts: Shape (RBC first) → Carat → Color');
    console.log('  - Blank rows between shapes');
    console.log('  - Professional formatting with totals');
    process.exit(0);
  }
  
  const inputFile = args[0];
  const outputFile = args[1] || `integrated_stock_v9_${new Date().toISOString().split('T')[0]}.xlsx`;
  
  console.log('V9 Stock List Integrator (Updated)');
  console.log('==================================\n');
  console.log(`Input: ${inputFile}`);
  console.log(`Output: ${outputFile}\n`);
  
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
  }
  
  // Read data
  const allData = await readExcelFile(inputFile);
  console.log(`\n📊 Total before filtering: ${allData.length}`);
  
  // Remove duplicates
  const uniqueData = removeDuplicates(allData);
  console.log(`   After dedup: ${uniqueData.length}`);
  
  // Sort data
  console.log('\n🔄 Sorting (Shape → Carat → Color)...');
  const sortedData = sortData(uniqueData);
  
  // Create output
  await createOutputExcel(sortedData, outputFile);
  
  console.log('\n✨ Done!');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

module.exports = { readExcelFile, sortData, createOutputExcel, removeDuplicates };
