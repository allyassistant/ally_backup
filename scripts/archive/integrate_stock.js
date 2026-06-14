#!/usr/bin/env node
/**
 * Stock List Integrator (Full Smart Detection)
 * 全面自動偵測：用 header 名 + 數據內容模式判斷
 * 
 * 用法: node scripts/integrate_stock.js <source_excel_path>
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const CLARITY_ORDER = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];
const COMMON_SHAPES = ['RBC', 'RD', 'ROUND', 'BR', 'PS', 'PEAR', 'EM', 'EMERALD', 'PR', 'PRINCESS', 'OV', 'OVAL', 'CU', 'CUSHION', 'MQ', 'MARQUISE', 'HS', 'HEART', 'RAD', 'RADIANT', 'AS', 'ASSCHER'];
const COLOR_PATTERNS = /^[DEFGHIJKLMNOPQRSTUVWXYZ](?:\+|-|\d)?$/i;
const CLARITY_PATTERNS = /^(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I[123])$/i;

function isFancyColor(color) {
  if (!color) return false;
  const c = color.toString().trim();
  return c.startsWith('F') && c.length >= 2 || 
         c.includes('Fancy') ||
         ['FY', 'FVY', 'FBY', 'FIY', 'FPY', 'FGB', 'FVB', 'FSB', 'FLB', 'FP', 'FDB'].some(fc => c.startsWith(fc));
}

// 分析每個 column 的數據類型
function analyzeColumns(data, headers) {
  const analysis = {};
  // 分析更多行數，確保搵到有數據嘅行
  const sampleSize = Math.min(200, data.length);
  
  for (const header of headers) {
    if (!header) continue;
    
    const stats = {
      numeric: 0,
      text: 0,
      empty: 0,
      uniqueValues: new Set(),
      sampleValues: [],
      matchesShape: 0,
      matchesColor: 0,
      matchesClarity: 0,
      matchesCertNo: 0,
      minNum: Infinity,
      maxNum: -Infinity
    };
    
    for (let i = 0; i < sampleSize; i++) {
      const val = data[i][header];
      const strVal = val !== undefined && val !== null ? val.toString().trim() : '';
      
      if (strVal === '') {
        stats.empty++;
        continue;
      }
      
      stats.sampleValues.push(strVal);
      stats.uniqueValues.add(strVal);
      
      const numVal = parseFloat(strVal);
      if (!isNaN(numVal) && strVal.match(/^\d*\.?\d+$/)) {
        stats.numeric++;
        stats.minNum = Math.min(stats.minNum, numVal);
        stats.maxNum = Math.max(stats.maxNum, numVal);
      } else {
        stats.text++;
        
        // 檢查是否匹配特定模式
        const upperVal = strVal.toUpperCase();
        if (COMMON_SHAPES.includes(upperVal)) stats.matchesShape++;
        if (COLOR_PATTERNS.test(strVal)) stats.matchesColor++;
        if (CLARITY_PATTERNS.test(strVal)) stats.matchesClarity++;
        if (/^\d{5,12}$/.test(strVal.replace(/\s/g, ''))) stats.matchesCertNo++;
      }
    }
    
    analysis[header] = stats;
  }
  
  return analysis;
}

// 根據 header 名初步映射
function mapByHeaderName(headers) {
  const mapping = {};
  
  const headerMap = {
    'parcel name': 'Parcel Name',
    'parcel': 'Parcel Name',
    'stock no': 'Parcel Name',
    'ref': 'Parcel Name',
    'shape': 'Shape',
    'cutting': 'Shape',
    'rapnet': 'Rapnet',
    'carat': 'Crt',
    'crt': 'Crt',
    'ct': 'Crt',
    'weight': 'Crt',
    'color': 'Color',
    'colour': 'Color',
    'clarity': 'Clarity',
    'cut': 'Cut',
    'polish': 'Pol',
    'pol': 'Pol',
    'symmetry': 'Symm',
    'symm': 'Symm',
    'sym': 'Symm',
    'measurement': 'Measurement',
    'measur': 'Measurement',
    'meas': 'Measurement',
    'depth': 'Depth',
    'total depth': 'Depth',
    'table': 'Table',
    'tbl': 'Table',
    'fluorescence': 'Fluor',
    'fluor': 'Fluor',
    'flour': 'Fluor',
    'lab': 'Lab',
    'cert no': 'Cert No',
    'certificate no': 'Cert No',
    'report no': 'Cert No',
    'gia no': 'Cert No',
    'cert#': 'Cert No',
    'memo out': 'Memo In Price',
    'memo in': 'Memo In Price',
    'memo price': 'Memo In Price',
    't.list': 'Memo In Price',
    'price': 'Memo In Price'
  };
  
  for (const header of headers) {
    if (!header) continue;
    const lowerHeader = header.toLowerCase().trim();
    for (const [pattern, standard] of Object.entries(headerMap)) {
      if (lowerHeader.includes(pattern)) {
        mapping[standard] = header;
        break;
      }
    }
  }
  
  return mapping;
}

// 根據數據內容修正映射
function correctMappingByData(mapping, analysis) {
  console.log('\n🔍 分析數據內容...');
  
  // 計算總行數
  const totalRows = Object.values(analysis)[0]?.sampleValues?.length || 0;
  
  // 找出所有 numeric columns (可能是 Carat, Price 等)
  const numericCols = [];
  const textCols = [];
  
  for (const [header, stats] of Object.entries(analysis)) {
    // 跳過主要係空嘅 column (超過90%空)
    if (stats.empty > totalRows * 0.9) continue;
    
    if (stats.numeric > stats.text && stats.numeric > 3) {
      numericCols.push({ header, stats });
    } else if (stats.text > 3) {
      textCols.push({ header, stats });
    }
  }
  
  // 按數值範圍排序 numeric columns
  numericCols.sort((a, b) => b.stats.maxNum - a.stats.maxNum);
  
  console.log('   Numeric columns (可能係 Carat/Price):');
  numericCols.slice(0, 5).forEach(col => {
    console.log(`     "${col.header}": ${col.stats.minNum.toFixed(2)}-${col.stats.maxNum.toFixed(2)}, 樣本: ${col.stats.sampleValues.slice(0, 3).join(', ')}`);
  });
  
  console.log('   Text columns (可能係 Shape/Color/Clarity):');
  textCols.slice(0, 5).forEach(col => {
    console.log(`     "${col.header}": 樣本: ${col.stats.sampleValues.slice(0, 3).join(', ')}`);
  });
  
  // ===== 修正 1: Shape/Crt 錯位 =====
  // 情況: Shape column 有數字 (Carat), Rapnet column 有文字 (Shape), Crt column 係空
  const shapeHeader = mapping['Shape'];
  const crtHeader = mapping['Crt'];
  const rapnetHeader = mapping['Rapnet'];
  
  if (shapeHeader && analysis[shapeHeader]) {
    const shapeStats = analysis[shapeHeader];
    
    // 如果 Shape column 主要係數字 (應該係 Carat)
    if (shapeStats.numeric > shapeStats.text) {
      console.log('\n⚠️  偵測到 Shape/Crt 錯位！');
      console.log(`   "${shapeHeader}" 有數值 (應該係 Carat)`);
      
      // 檢查 Rapnet 是否有 Shape 文字 (EM, PS, etc.)
      if (rapnetHeader && analysis[rapnetHeader]) {
        const rapnetStats = analysis[rapnetHeader];
        const hasShapePatterns = rapnetStats.sampleValues.some(v => 
          COMMON_SHAPES.includes(v.toUpperCase())
        );
        
        if (hasShapePatterns || rapnetStats.text > rapnetStats.numeric) {
          console.log(`   ✓ "${rapnetHeader}" 有 Shape 數據，應該係 Shape`);
          
          // 修正: Rapnet column -> Shape, Shape column -> Crt
          mapping['Shape'] = rapnetHeader;
          mapping['Crt'] = shapeHeader;
          
          console.log(`   修正: Shape → "${rapnetHeader}"`);
          console.log(`   修正: Crt → "${shapeHeader}"`);
        }
      }
    }
  }
  
  // ===== 修正 2: Color/Clarity 檢查 =====
  // 如果 Color column 有數據，通常係正確
  const colorHeader = mapping['Color'];
  if (colorHeader && analysis[colorHeader]) {
    const colorStats = analysis[colorHeader];
    const hasValidColors = colorStats.sampleValues.some(v => COLOR_PATTERNS.test(v));
    
    if (!hasValidColors || colorStats.empty > colorStats.text * 2) {
      console.log('\n⚠️  Color column 可能唔正確，尋找替代...');
      
      // 尋找有 Color pattern 的 column
      for (const { header, stats } of textCols) {
        if (header === colorHeader) continue;
        if (stats.matchesColor > 3) {
          console.log(`   ✓ "${header}" 有 Color 模式 (${stats.matchesColor} 個)`);
          mapping['Color'] = header;
          console.log(`   修正: Color → "${header}"`);
          break;
        }
      }
    } else {
      console.log(`   ✓ Color column "${colorHeader}" 有有效 Color 數據`);
    }
  }
  
  // Clarity 檢查
  const clarityHeader = mapping['Clarity'];
  if (clarityHeader && analysis[clarityHeader]) {
    const clarityStats = analysis[clarityHeader];
    const hasValidClarity = clarityStats.sampleValues.some(v => CLARITY_PATTERNS.test(v));
    
    if (!hasValidClarity || clarityStats.empty > clarityStats.text * 2) {
      console.log('\n⚠️  Clarity column 可能唔正確，尋找替代...');
      
      for (const { header, stats } of textCols) {
        if (header === mapping['Color'] || header === clarityHeader) continue;
        if (stats.matchesClarity > 3) {
          console.log(`   ✓ "${header}" 有 Clarity 模式 (${stats.matchesClarity} 個)`);
          mapping['Clarity'] = header;
          console.log(`   修正: Clarity → "${header}"`);
          break;
        }
      }
    } else {
      console.log(`   ✓ Clarity column "${clarityHeader}" 有有效 Clarity 數據`);
    }
  }
  
  return mapping;
}

function detectColumns(data, headers) {
  console.log('🔍 偵測 headers:', headers.filter(h => h).join(', '));
  
  // Step 1: 根據 header 名初步映射
  let mapping = mapByHeaderName(headers);
  
  console.log('\n📋 Header 名映射:');
  for (const [standard, actual] of Object.entries(mapping)) {
    console.log(`   ${standard} → "${actual}"`);
  }
  
  // Step 2: 分析數據內容
  const analysis = analyzeColumns(data, headers);
  
  // Step 3: 根據數據內容修正
  mapping = correctMappingByData(mapping, analysis);
  
  // Step 4: 檢查缺失
  const required = ['Parcel Name', 'Crt', 'Cert No'];
  const missing = required.filter(r => !mapping[r]);
  if (missing.length > 0) {
    console.warn('\n⚠️  未能偵測:', missing.join(', '));
  }
  
  return mapping;
}

function readSourceFile(filePath) {
  console.log(`📖 讀取: ${path.basename(filePath)}\n`);
  
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  if (rawData.length < 2) {
    console.log('⚠️  No data found');
    return { data: [], mapping: {} };
  }
  
  const headers = rawData[0];
  
  const data = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = row[j];
    }
    data.push(obj);
  }
  
  const mapping = detectColumns(data, headers);
  
  console.log(`\n✅ 最終映射:`);
  for (const [standard, actual] of Object.entries(mapping)) {
    console.log(`   ${standard} → "${actual}"`);
  }
  
  console.log(`\n   讀取到 ${data.length} 行\n`);
  return { data, mapping };
}

function transformData(data, mapping) {
  console.log('🔄 轉換數據...');
  
  return data.map(row => {
    const getValue = (standardName) => {
      const colName = mapping[standardName];
      return colName !== undefined ? row[colName] : undefined;
    };
    
    return {
      'Parcel Name': getValue('Parcel Name'),
      'Shape': getValue('Shape'),
      'Crt': getValue('Crt'),
      'Color': getValue('Color'),
      'Clarity': getValue('Clarity'),
      'Cut': getValue('Cut'),
      'Pol': getValue('Pol'),
      'Symm': getValue('Symm'),
      'Measurement': getValue('Measurement'),
      'Depth': getValue('Depth'),
      'Table': getValue('Table'),
      'Fluor': getValue('Fluor'),
      'Lab': getValue('Lab'),
      'Cert No': getValue('Cert No'),
      'Memo In Price': getValue('Memo In Price')
    };
  }).filter(row => {
    const carat = parseFloat(row['Crt']);
    const certNo = row['Cert No'];
    return certNo && certNo.toString().trim() !== '' && 
           !isNaN(carat) && carat >= 1.00 &&
           row['Parcel Name'];
  });
}

function sortData(data) {
  console.log('📊 排序數據...');
  
  const regular = data.filter(r => !isFancyColor(r['Color']));
  const fancy = data.filter(r => isFancyColor(r['Color']));
  
  console.log(`   Regular: ${regular.length} 行`);
  console.log(`   Fancy: ${fancy.length} 行`);
  
  const sortFn = (a, b, isFancy = false) => {
    const shapeA = (a['Shape'] || '').toString().trim();
    const shapeB = (b['Shape'] || '').toString().trim();
    const isRBC_A = shapeA === 'RBC' || shapeA === 'RD' || shapeA === 'Round';
    const isRBC_B = shapeB === 'RBC' || shapeB === 'RD' || shapeB === 'Round';
    
    if (isRBC_A && !isRBC_B) return -1;
    if (!isRBC_A && isRBC_B) return 1;
    if (shapeA !== shapeB) return shapeA.localeCompare(shapeB);
    
    const caratA = parseFloat(a['Crt']) || 0;
    const caratB = parseFloat(b['Crt']) || 0;
    if (caratB !== caratA) return caratB - caratA;
    
    const colorA = (a['Color'] || '').toString().trim();
    const colorB = (b['Color'] || '').toString().trim();
    
    if (!isFancy) {
      const idxA = COLOR_ORDER.indexOf(colorA);
      const idxB = COLOR_ORDER.indexOf(colorB);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    }
    return colorA.localeCompare(colorB);
  };
  
  regular.sort((a, b) => sortFn(a, b, false));
  fancy.sort((a, b) => sortFn(a, b, true));
  
  return { regular, fancy };
}

function groupByShape(data) {
  const groups = {};
  data.forEach(row => {
    const shape = (row['Shape'] || 'UNKNOWN').toString().trim();
    if (!groups[shape]) groups[shape] = [];
    groups[shape].push(row);
  });
  return groups;
}

function prepareOutput(regular, fancy) {
  console.log('📝 準備輸出...');
  
  const headers = ['Parcel Name', 'Shape', 'Crt', 'Color', 'Clarity', 'Cut', 'Pol', 'Symm', 'Measurement', 'Depth', 'Table', 'Fluor', 'Lab', 'Cert No', 'Memo In Price'];
  const output = [headers];
  
  let totalCarat = 0;
  let totalPrice = 0;
  
  const addRows = (groups, isFancy) => {
    const sortedShapes = Object.keys(groups).sort((a, b) => {
      const isRBC_A = a === 'RBC' || a === 'RD' || a === 'Round';
      const isRBC_B = b === 'RBC' || b === 'RD' || b === 'Round';
      if (isRBC_A && !isRBC_B) return -1;
      if (!isRBC_A && isRBC_B) return 1;
      return a.localeCompare(b);
    });
    
    sortedShapes.forEach((shape, idx) => {
      if (idx > 0) output.push(new Array(15).fill(''));
      
      groups[shape].forEach(row => {
        const carat = parseFloat(row['Crt']) || 0;
        const price = parseFloat(row['Memo In Price']) || 0;
        totalCarat += carat;
        totalPrice += price;
        
        output.push([
          row['Parcel Name'] || '',
          row['Shape'] || '',
          carat.toFixed(2),
          row['Color'] || '',
          row['Clarity'] || '',
          row['Cut'] || '',
          row['Pol'] || '',
          row['Symm'] || '',
          row['Measurement'] || '',
          row['Depth'] || '',
          row['Table'] || '',
          row['Fluor'] || '',
          row['Lab'] || '',
          row['Cert No'] ? row['Cert No'].toString() : '',
          price > 0 ? price.toFixed(2) : ''
        ]);
      });
    });
  };
  
  addRows(groupByShape(regular), false);
  
  if (fancy.length > 0 && regular.length > 0) {
    output.push(new Array(15).fill(''));
    output.push(['=== FANCY COLOR ===', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(new Array(15).fill(''));
  }
  
  addRows(groupByShape(fancy), true);
  
  output.push(new Array(15).fill(''));
  output.push(['TOTAL', '', totalCarat.toFixed(2), '', '', '', '', '', '', '', '', '', '', `${regular.length + fancy.length} items`, totalPrice.toFixed(2)]);
  
  return { output, totalCarat, totalPrice, count: regular.length + fancy.length };
}

function saveToExcel(output, outputPath) {
  console.log('\n💾 儲存檔案...');
  
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(output);
  
  ws['!cols'] = [
    { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 10 },
    { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 18 }, { wch: 18 }
  ];
  
  XLSX.utils.book_append_sheet(wb, ws, 'Stock List');
  XLSX.writeFile(wb, outputPath);
  
  console.log(`   ✅ 已儲存: ${outputPath}`);
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('用法: node scripts/integrate_stock.js <source_excel_path>');
    console.log('');
    console.log('範例:');
    console.log('  node scripts/integrate_stock.js "/Users/ally/Desktop/source.xlsx"');
    process.exit(1);
  }
  
  const sourcePath = args[0];
  
  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ 檔案不存在: ${sourcePath}`);
    process.exit(1);
  }
  
  const today = new Date().toISOString().split('T')[0];
  const outputPath = path.join('/Users/ally/Desktop/Stock list', `Stock list (${today}).xlsx`);
  
  console.log('🔷 Stock List Integrator (Full Smart Detection)\n');
  console.log(`來源: ${sourcePath}`);
  console.log(`輸出: ${outputPath}\n`);
  
  const { data, mapping } = readSourceFile(sourcePath);
  if (data.length === 0) {
    console.log('❌ 沒有可處理的數據');
    process.exit(1);
  }
  
  const transformed = transformData(data, mapping);
  if (transformed.length === 0) {
    console.log('❌ 過濾後沒有有效數據（需要 Cert No + Carat >= 1.00）');
    process.exit(1);
  }
  
  const { regular, fancy } = sortData(transformed);
  const { output, totalCarat, totalPrice, count } = prepareOutput(regular, fancy);
  
  saveToExcel(output, outputPath);
  
  console.log('\n📊 完成!');
  console.log(`   總行數: ${count}`);
  console.log(`   Regular: ${regular.length}`);
  console.log(`   Fancy: ${fancy.length}`);
  console.log(`   總 Carat: ${totalCarat.toFixed(2)}`);
  console.log(`   總 Price: $${totalPrice.toLocaleString()}`);
  
  console.log('\n🔄 更新 database...');
  try {
    require('child_process').execSync('node scripts/merge_stock.js', {
      cwd: '/Users/ally/.openclaw/workspace',
      stdio: 'pipe'
    });
    console.log('   ✅ Database 已更新');
  } catch (err) {
    console.log('   ⚠️  更新 database 失敗，請手動運行: node scripts/merge_stock.js');
  }
}

main();
