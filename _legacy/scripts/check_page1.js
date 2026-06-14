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
    
    console.log(`Total pages: ${pages.length}`);
    
    // Process page 1 for smaller carat ranges
    const page = pages[0];
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
    
    // Group by rows
    const rows = {};
    texts.forEach(t => {
        const yKey = Math.round(t.y);
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    
    // Print all rows to see structure
    console.log('\n=== Page 1 structure ===\n');
    sortedY.forEach(y => {
        const row = rows[y].sort((a, b) => a.x - b.x);
        const line = row.map(t => `"${t.text}"`).join(' | ');
        console.log(`Y=${y}: ${line}`);
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
