/**
 * V9 Stock List Formatter - Basic Version
 * 
 * Features:
 * - Auto-detects column swaps (Crt/Shape)
 * - V9 format compliance
 * - NO Checked column
 * - NO conditional formatting
 * - Clean and simple
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Complete list of diamond shapes
const VALID_SHAPES = [
    'RBC', 'Round', 'BR', 'PS', 'CU', 'CUS', 'EM', 'EME',
    'RAD', 'RD', 'OV', 'OVAL', 'MQ', 'MAR', 'PR', 'PC',
    'HS', 'HEART', 'AS', 'ASSCHER', 'SEM', 'BG', 'TRI',
    'CAB', 'FAN', 'CUSTOM', 'SPECIAL'
];

function normalizeShape(shape) {
    if (!shape) return '';
    const s = String(shape).toUpperCase().trim();
    const mapping = {
        'RD': 'RAD', 'BR': 'RBC', 'ROUND': 'RBC',
        'CUS': 'CU', 'EME': 'EM', 'MAR': 'MQ',
        'OVAL': 'OV', 'HEART': 'HS', 'ASSCHER': 'AS', 'PC': 'PR'
    };
    return mapping[s] || s;
}

function isShape(value) {
    if (typeof value !== 'string') return false;
    const normalized = String(value).toUpperCase().trim();
    return VALID_SHAPES.includes(normalized) || VALID_SHAPES.includes(normalizeShape(normalized));
}

function isNumber(value) {
    if (typeof value === 'number') return true;
    if (typeof value === 'string') {
        return !isNaN(parseFloat(value)) && !isShape(value);
    }
    return false;
}

async function analyzeExcel(inputPath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputPath);
    const worksheet = workbook.getWorksheet(1);
    
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
        const values = row.values.slice(1);
        rows.push({ values, rowNumber });
    });
    
    let headerIndex = -1;
    const headerKeywords = ['Parcel', 'Shape', 'Cert', 'GIA'];
    
    for (let i = 0; i < Math.min(15, rows.length); i++) {
        const rowValues = rows[i].values.map(v => String(v || '').toLowerCase());
        const hasKeywords = headerKeywords.some(kw => 
            rowValues.some(v => v.includes(kw.toLowerCase()))
        );
        if (hasKeywords) {
            headerIndex = i;
            break;
        }
    }
    
    if (headerIndex === -1) {
        throw new Error('❌ Cannot find header row');
    }
    
    // Check if columns need swapping
    let swappedCount = 0;
    const maxSample = Math.min(20, rows.length - headerIndex - 1);
    
    for (let i = headerIndex + 1; i < headerIndex + 1 + maxSample; i++) {
        if (i >= rows.length) break;
        const row = rows[i].values;
        const col1IsShape = isShape(row[1]);
        const col2IsNumber = isNumber(row[2]);
        if (col1IsShape && col2IsNumber) swappedCount++;
    }
    
    const needsSwap = swappedCount > 0;
    return { rows, headerIndex, needsSwap };
}

async function processData(rows, headerIndex, needsSwap) {
    const processedData = [];
    let fixCount = 0;
    
    for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i].values;
        const parcelName = String(row[0] || '').trim();
        
        if (!parcelName || 
            parcelName.toLowerCase().includes('total') ||
            parcelName.toLowerCase().includes('blue') ||
            parcelName.toLowerCase().includes('subtotal')) {
            continue;
        }
        
        const certNo = row[13];
        if (!certNo || String(certNo).trim() === '') {
            continue;
        }
        
        let crt, shape;
        const col1 = row[1];
        const col2 = row[2];
        
        const col1IsShape = isShape(col1);
        const col2IsNumber = isNumber(col2);
        
        if (col1IsShape && col2IsNumber) {
            shape = normalizeShape(col1);
            crt = parseFloat(col2) || 0;
            fixCount++;
        } else {
            crt = parseFloat(col1) || 0;
            shape = normalizeShape(col2);
        }
        
        processedData.push({
            'Parcel Name': parcelName,
            'Shape': shape,
            'Crt': crt,
            'Color': row[3] || '',
            'Clarity': row[4] || '',
            'Cut': row[5] || '',
            'Pol': row[6] || '',
            'Symm': row[7] || '',
            'Measur': row[8] || '',
            'Depth': row[9] !== undefined ? row[9] : '',
            'Table': row[10] !== undefined ? row[10] : '',
            'Fluor': row[11] || '',
            'Lab': row[12] || '',
            'Cert No': certNo,
            'Memo Price': parseFloat(row[14]) || 0
        });
    }
    
    return processedData;
}

function sortData(data) {
    return data.sort((a, b) => {
        if (a['Shape'] !== b['Shape']) {
            if (a['Shape'] === 'RBC') return -1;
            if (b['Shape'] === 'RBC') return 1;
            return String(a['Shape'] || '').localeCompare(String(b['Shape'] || ''));
        }
        if (a['Crt'] !== b['Crt']) return b['Crt'] - a['Crt'];
        
        const colorOrder = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        const colorIndexA = colorOrder.indexOf(a['Color']);
        const colorIndexB = colorOrder.indexOf(b['Color']);
        if (colorIndexA !== colorIndexB) return colorIndexA - colorIndexB;
        
        return 0;
    });
}

function groupByShape(data) {
    const grouped = [];
    let currentShape = null;
    
    for (const item of data) {
        if (currentShape !== null && currentShape !== item['Shape']) {
            grouped.push({ isBlank: true });
        }
        currentShape = item['Shape'];
        grouped.push(item);
    }
    
    return grouped;
}

async function createOutput(data, outputPath) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock List');
    
    // Columns - NO Checked column
    sheet.columns = [
        { header: 'Parcel Name', key: 'Parcel Name', width: 15 },
        { header: 'Shape', key: 'Shape', width: 8 },
        { header: 'Crt', key: 'Crt', width: 8 },
        { header: 'Color', key: 'Color', width: 8 },
        { header: 'Clarity', key: 'Clarity', width: 10 },
        { header: 'Cut', key: 'Cut', width: 8 },
        { header: 'Pol', key: 'Pol', width: 8 },
        { header: 'Symm', key: 'Symm', width: 8 },
        { header: 'Measur', key: 'Measur', width: 20 },
        { header: 'Depth', key: 'Depth', width: 8 },
        { header: 'Table', key: 'Table', width: 8 },
        { header: 'Fluor', key: 'Fluor', width: 10 },
        { header: 'Lab', key: 'Lab', width: 8 },
        { header: 'Cert No', key: 'Cert No', width: 15 },
        { header: 'Memo Price', key: 'Memo Price', width: 12 }
    ];
    
    // Header style
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center', vertical: 'center' };
    
    // Group data
    const grouped = groupByShape(data);
    
    let totalCarats = 0;
    let totalPrice = 0;
    
    // Add rows
    for (const item of grouped) {
        if (item.isBlank) {
            sheet.addRow({});
            continue;
        }
        
        const row = {
            'Parcel Name': item['Parcel Name'],
            'Shape': item['Shape'],
            'Crt': item['Crt'] ? item['Crt'].toFixed(2) : '',
            'Color': item['Color'],
            'Clarity': item['Clarity'],
            'Cut': item['Cut'] || '',
            'Pol': item['Pol'] || '',
            'Symm': item['Symm'] || '',
            'Measur': item['Measur'] || '',
            'Depth': item['Depth'] !== undefined && item['Depth'] !== '' ? item['Depth'] : '',
            'Table': item['Table'] !== undefined && item['Table'] !== '' ? item['Table'] : '',
            'Fluor': item['Fluor'] || '',
            'Lab': item['Lab'] || '',
            'Cert No': item['Cert No'],
            'Memo Price': item['Memo Price'] ? item['Memo Price'].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
        };
        
        const newRow = sheet.addRow(row);
        newRow.eachCell((cell) => {
            cell.alignment = { horizontal: 'center', vertical: 'center' };
        });
        
        totalCarats += item['Crt'];
        totalPrice += item['Memo Price'];
    }
    
    // Add totals
    sheet.addRow({});
    const totalRow = sheet.addRow({
        'Parcel Name': 'TOTAL:',
        'Crt': totalCarats.toFixed(2),
        'Memo Price': totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    });
    
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
        cell.alignment = { horizontal: 'center', vertical: 'center' };
    });
    
    // Auto-fit columns
    sheet.columns.forEach(column => {
        let maxLength = column.header.length;
        column.eachCell({ includeEmpty: true }, cell => {
            const length = cell.value ? String(cell.value).length : 0;
            if (length > maxLength) maxLength = length;
        });
        column.width = Math.max(column.width, maxLength + 2);
    });
    
    await workbook.xlsx.writeFile(outputPath);
    
    return { totalItems: data.length, totalCarats, totalPrice };
}

async function main() {
    const inputFile = process.argv[2];
    const outputFile = process.argv[3] || 'organized_stock.xlsx';
    
    if (!inputFile) {
        console.log('Usage: node excel_formatter_basic.js <input.xlsx> [output.xlsx]');
        process.exit(1);
    }
    
    if (!fs.existsSync(inputFile)) {
        console.error(`❌ File not found: ${inputFile}`);
        process.exit(1);
    }
    
    try {
        const { rows, headerIndex, needsSwap } = await analyzeExcel(inputFile);
        
        console.log('\n🔄 Processing data...');
        const processedData = await processData(rows, headerIndex, needsSwap);
        
        if (processedData.length === 0) {
            console.error('❌ No valid data found');
            process.exit(1);
        }

        console.log('📊 Sorting data...');
        const sortedData = sortData(processedData);
        
        console.log('📝 Creating output...');
        const result = await createOutput(sortedData, outputFile);
        
        console.log('\n' + '='.repeat(50));
        console.log('✅ COMPLETED - Basic Version');
        console.log('='.repeat(50));
        console.log(`📁 Output: ${outputFile}`);
        console.log(`📦 Total items: ${result.totalItems}`);
        console.log(`💎 Total carats: ${result.totalCarats.toFixed(2)}`);
        console.log(`💰 Total price: $${result.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        console.log('='.repeat(50));
        console.log('\nℹ️  Features:');
        console.log('   - NO Checked column');
        console.log('   - NO conditional formatting');
        console.log('   - Clean V9 format');
        console.log('='.repeat(50));
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
