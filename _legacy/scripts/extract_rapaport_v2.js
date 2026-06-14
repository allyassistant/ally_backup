const PDFParser = require('pdf2json');
const fs = require('fs');

const path = process.argv[2] || '/Users/ally/Desktop/Rapaport/Round Price List 01.30.2026.pdf';

process.env.PDF2JSON_DISABLE_LOGS = '1';

const pdfParser = new PDFParser(null, 1);

function safeDecode(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    const pages = pdfData.Pages || [];
    
    if (pages.length === 0) {
        console.log('No pages found');
        return;
    }
    
    console.log(`Total pages: ${pages.length}`);
    
    // Process all pages to find 5.00-5.99 and 6.00+ tables
    pages.forEach((page, pageIdx) => {
        const texts = [];
        
        page.Texts?.forEach(text => {
            const rawText = text.R?.[0]?.T || '';
            const decodedText = safeDecode(rawText);
            texts.push({
                x: Math.round(text.x * 10) / 10,
                y: Math.round(text.y * 10) / 10,
                text: decodedText.trim()
            });
        });
        
        // Sort by Y then X
        texts.sort((a, b) => {
            if (Math.abs(a.y - b.y) < 1.0) return a.x - b.x;
            return a.y - b.y;
        });
        
        // Group by rows
        const rows = {};
        texts.forEach(t => {
            const yKey = Math.round(t.y * 2) / 2; // Group by 0.5 units
            if (!rows[yKey]) rows[yKey] = [];
            rows[yKey].push(t);
        });
        
        // Find all carat range sections
        const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
        
        sortedY.forEach(y => {
            const rowTexts = rows[y].sort((a, b) => a.x - b.x);
            const line = rowTexts.map(t => t.text).join(' | ');
            
            // Look for 5.00-5.99 or 6.00-6.99 or 5.00+
            if ((line.includes('5.00') && line.includes('5.99')) || 
                (line.includes('6.00') && line.includes('6.99')) ||
                line.includes('5.00 - 5.99') ||
                line.includes('6.00 - 6.99')) {
                console.log(`\n>>> PAGE ${pageIdx + 1} Y=${y}: ${line} <<<`);
                
                // Print next 30 rows (the table)
                let count = 0;
                for (let checkY of sortedY) {
                    if (checkY > y && count < 30) {
                        const checkRow = rows[checkY].sort((a, b) => a.x - b.x);
                        const checkLine = checkRow.map(t => t.text).join(' | ');
                        console.log(`${String(checkY).padEnd(6)}: ${checkLine}`);
                        count++;
                        
                        // Stop if we hit another RAPAPORT header
                        if (checkLine.includes('RAPAPORT') && checkLine.includes('CT')) {
                            break;
                        }
                    }
                }
            }
        });
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
