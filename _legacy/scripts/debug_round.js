const PDFParser = require('pdf2json');

const pdfFile = '/Users/ally/Downloads/Round Price List 01.30.2026.pdf';
const pdfParser = new PDFParser();

function safeDecode(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

pdfParser.on('pdfParser_dataReady', pdfData => {
    const pages = pdfData.Pages || [];
    
    pages.forEach((page, pageIdx) => {
        console.log(`\n========== PAGE ${pageIdx + 1} ==========`);
        
        const texts = [];
        
        page.Texts?.forEach(text => {
            const rawText = text.R?.[0]?.T || '';
            const decodedText = safeDecode(rawText);
            texts.push({
                x: Math.round(text.x * 10) / 10,
                y: Math.round(text.y * 10) / 10,
                text: decodedText
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
            const yKey = Math.round(t.y * 1) / 1;
            if (!rows[yKey]) rows[yKey] = [];
            rows[yKey].push(t);
        });
        
        const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
        
        sortedY.forEach(y => {
            const rowTexts = rows[y].sort((a, b) => a.x - b.x);
            const line = rowTexts.map(t => t.text).join(' | ');
            
            // Only print lines that look like data rows or headers
            if (line.includes('CT') || line.match(/^[D-M]\s+\d/) || line.includes('RAPAPORT')) {
                console.log(`${String(y).padEnd(6)}: ${line}`);
            }
        });
    });
});

pdfParser.loadPDF(pdfFile);
