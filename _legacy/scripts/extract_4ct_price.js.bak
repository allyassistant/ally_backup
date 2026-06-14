#!/usr/bin/env node
const PDFParser = require('pdf2json');
const fs = require('fs');

const pdfFile = '/Users/ally/Downloads/Round Price List 01.30.2026.pdf';
const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];

function safeDecode(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

function cleanText(text) {
    if (!text) return '';
    return text.replace(/[,)]996[\d,]*/g, '').trim();
}

// Parse concatenated numbers like "73067059554046536028016011554222"
function parseValues(str) {
    const cleaned = str.replace(/\D/g, '');
    // Pattern for Rapaport: first value 4 digits, then 3 digits each, last two 2 digits
    const pattern = [4, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2];
    const values = [];
    let pos = 0;
    
    for (const len of pattern) {
        if (pos >= cleaned.length) break;
        const num = parseInt(cleaned.substring(pos, pos + len));
        if (!isNaN(num)) values.push(num);
        pos += len;
    }
    
    return values;
}

const pdfParser = new PDFParser();

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    let foundTable = false;
    
    pdfData.Pages.forEach((page, pageIdx) => {
        if (foundTable) return;
        
        // Extract all text elements
        const texts = [];
        page.Texts?.forEach((text) => {
            const rawText = text.R?.[0]?.T || '';
            const decoded = safeDecode(rawText);
            if (decoded) {
                texts.push({
                    x: text.x,
                    y: text.y,
                    text: cleanText(decoded)
                });
            }
        });
        
        // Find 4.00-4.99 table header
        let tableHeader = null;
        texts.forEach((t) => {
            if (t.text.match(/4\.00.*4\.99.*CT/i) && t.text.includes('RAPAPORT')) {
                tableHeader = t;
            }
        });
        
        if (!tableHeader) return;
        
        console.log(`Found 4.00-4.99 table on page ${pageIdx + 1}`);
        console.log(`Header at X=${tableHeader.x.toFixed(1)}, Y=${tableHeader.y.toFixed(1)}`);
        
        // Define table boundaries
        const minX = tableHeader.x - 3;
        const maxX = tableHeader.x + 16;
        const minY = tableHeader.y + 1;
        const maxY = tableHeader.y + 14;
        
        // Find all colors in this table
        const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
        const tableData = {};
        
        colors.forEach((color) => {
            const colorText = texts.find((t) => 
                t.text === color && 
                t.x >= minX && t.x <= maxX &&
                t.y >= minY && t.y <= maxY
            );
            
            if (colorText) {
                // Find the number string for this color
                const numText = texts.find((t) => 
                    t.text.match(/^\d{20,}$/) &&
                    Math.abs(t.y - colorText.y) < 1.0 &&
                    t.x > colorText.x &&
                    t.x <= colorText.x + 15
                );
                
                if (numText) {
                    const values = parseValues(numText.text);
                    if (values.length >= 11) {
                        tableData[color] = {};
                        clarities.forEach((c, i) => {
                            tableData[color][c] = values[i];
                        });
                    }
                }
            }
        });
        
        if (Object.keys(tableData).length > 0) {
            foundTable = true;
            console.log(`\nExtracted ${Object.keys(tableData).length} colors from 4.00-4.99 table:\n`);
            
            // Display F color values
            if (tableData['F']) {
                console.log('F Color values:');
                clarities.forEach((c) => {
                    console.log(`  ${c}: ${tableData['F'][c]}`);
                });
                
                // Calculate price for 4.45 F SI1 -47%
                const si1Value = tableData['F']['SI1'];
                const carat = 4.45;
                const discount = 0.47;
                
                const listPricePerCt = si1Value * 100;
                const totalListPrice = listPricePerCt * carat;
                const finalPrice = totalListPrice * (1 - discount);
                
                console.log('\n=== PRICE CALCULATION ===');
                console.log('Stone: RBC 4.45 F SI1');
                console.log(`Rapaport 4.00-4.99 F SI1 value: ${si1Value}`);
                console.log(`List Price/ct: $${listPricePerCt.toLocaleString()}`);
                console.log(`Total List Price: $${totalListPrice.toLocaleString()}`);
                console.log(`Discount: -${(discount*100)}%`);
                console.log(`\n*** FINAL PRICE: USD $${finalPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ***`);
            } else {
                console.log('F color not found in extracted data');
                console.log('Available colors:', Object.keys(tableData).join(', '));
            }
        }
    });
    
    if (!foundTable) {
        console.log('4.00-4.99 table not found in PDF');
    }
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('PDF parsing error:', err);
    process.exit(1);
});

console.log('Parsing PDF...');
pdfParser.loadPDF(pdfFile);
