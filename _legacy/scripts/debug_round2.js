const PDFParser = require('pdf2json');
const pdfFile = '/Users/ally/Downloads/Round Price List 01.30.2026.pdf';
const pdfParser = new PDFParser();

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

pdfParser.on('pdfParser_dataReady', pdfData => {
    console.log('Total pages:', pdfData.Pages.length);
    
    // Check each page for data rows
    pdfData.Pages.forEach((page, idx) => {
        const texts = [];
        
        page.Texts?.forEach(text => {
            const rawText = text.R?.[0]?.T || '';
            texts.push({
                x: Math.round(text.x * 10) / 10,
                y: Math.round(text.y * 10) / 10,
                text: safeDecode(rawText)
            });
        });
        
        texts.sort((a, b) => {
            if (Math.abs(a.y - b.y) < 1.0) return a.x - b.x;
            return a.y - b.y;
        });
        
        const rows = {};
        texts.forEach(t => {
            const yKey = Math.round(t.y * 1) / 1;
            if (!rows[yKey]) rows[yKey] = [];
            rows[yKey].push(t);
        });
        
        const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
        
        console.log(`\n--- Page ${idx + 1} ---`);
        let foundData = false;
        sortedY.forEach(y => {
            const rowTexts = rows[y].sort((a, b) => a.x - b.x);
            const line = rowTexts.map(t => t.text).join(' ');
            
            // Look for color data rows
            if (line.match(/^\s*[D-M]\s+\d+/)) {
                console.log(`Y=${y}: ${line.substring(0, 100)}`);
                foundData = true;
            }
        });
        
        if (!foundData) {
            console.log('(No color data rows found)');
        }
    });
});

pdfParser.loadPDF(pdfFile);
