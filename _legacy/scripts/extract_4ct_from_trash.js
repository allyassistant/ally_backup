const PDFParser = require('pdf2json');
const fs = require('fs');

const pdfFile = '/Users/ally/.Trash/Round Price List 01.30.2026.pdf';
const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function cleanText(text) {
    return text.replace(/[,)]996[\d,]*/g, '').trim();
}

function parseValues(str) {
    const cleaned = str.replace(/\D/g, '');
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
    let found = false;
    
    pdfData.Pages.forEach((page, pageIdx) => {
        if (found) return;
        
        const texts = [];
        page.Texts?.forEach((text) => {
            const rawText = text.R?.[0]?.T || '';
            const decoded = safeDecode(rawText);
            if (decoded) {
                texts.push({ x: text.x, y: text.y, text: cleanText(decoded) });
            }
        });
        
        // Find 4.00-4.99 header
        const header = texts.find(t => t.text.match(/4\.00.*4\.99/i) && t.text.includes('RAPAPORT'));
        if (!header) return;
        
        console.log(`Found 4.00-4.99 table on page ${pageIdx + 1}`);
        console.log(`Header at X=${header.x.toFixed(1)}, Y=${header.y.toFixed(1)}`);
        
        // Define table boundaries (colors are ~2 units left of header)
        const colorX = header.x - 2;
        const minX = colorX - 1;
        const maxX = colorX + 14;
        const minY = header.y + 1;
        const maxY = header.y + 14;
        
        // Find F color
        const fColor = texts.find(t => 
            t.text === 'F' && 
            t.x >= minX && t.x <= maxX &&
            t.y >= minY && t.y <= maxY
        );
        
        if (!fColor) {
            console.log('F color not found in table boundaries');
            return;
        }
        
        console.log(`Found F at X=${fColor.x.toFixed(1)}, Y=${fColor.y.toFixed(1)}`);
        
        // Find number string for F
        const numText = texts.find(t => 
            t.text.match(/^\d{20,}$/) &&
            Math.abs(t.y - fColor.y) < 1.5 &&
            t.x > fColor.x &&
            t.x <= fColor.x + 14
        );
        
        if (!numText) {
            console.log('Number text not found for F');
            return;
        }
        
        console.log(`Number string: ${numText.text.substring(0, 35)}...`);
        
        const values = parseValues(numText.text);
        if (values.length < 11) {
            console.log('Failed to parse values');
            return;
        }
        
        console.log('\n=== 4.00-4.99 F COLOR VALUES ===');
        clarities.forEach((c, i) => {
            console.log(`  ${c}: ${values[i]}`);
        });
        
        // Calculate price for 4.45 F SI1 -47%
        const si1Value = values[5]; // SI1 is index 5
        const carat = 4.45;
        const discount = 0.47;
        
        const listPricePerCt = si1Value * 100;
        const totalListPrice = listPricePerCt * carat;
        const finalPrice = totalListPrice * (1 - discount);
        
        console.log('\n=== PRICE CALCULATION ===');
        console.log('Stone: RBC 4.45 F SI1');
        console.log(`Rapaport 4.00-4.99 F SI1: ${si1Value}`);
        console.log(`List Price/ct: $${listPricePerCt.toLocaleString()}`);
        console.log(`Total List Price: $${totalListPrice.toLocaleString()}`);
        console.log(`Discount: -47%`);
        console.log(`\n*** FINAL PRICE: USD $${finalPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ***`);
        
        found = true;
    });
    
    if (!found) {
        console.log('4.00-4.99 table not found in PDF');
    }
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('PDF parsing error:', err);
});

console.log('Parsing PDF from Trash...');
pdfParser.loadPDF(pdfFile);
