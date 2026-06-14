const PDFParser = require('pdf2json');

const pdfFile = '/home/node/.clawdbot/media/inbound/51834b38-ab78-4a9d-9c5f-ba4a7edd92f3.pdf';

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
        if (pageIdx !== 1) return; // Only process page 2
        
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
        
        // Find 5.00-5.99 section
        let in5ctSection = false;
        let sectionStartY = null;
        
        const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
        
        sortedY.forEach(y => {
            const rowTexts = rows[y].sort((a, b) => a.x - b.x);
            const line = rowTexts.map(t => t.text).join(' | ');
            
            // Detect 5.00-5.99 section
            if (line.includes('5.00') && line.includes('5.99')) {
                in5ctSection = true;
                sectionStartY = y;
                console.log(`\n>>> 5.00-5.99 CT TABLE STARTS AT Y=${y} <<<\n`);
            }
            
            // Print rows in 5ct section
            if (in5ctSection && y <= sectionStartY + 35) {
                console.log(`${String(y).padEnd(6)}: ${line}`);
            }
            
            // Stop after 5ct section
            if (in5ctSection && y > sectionStartY + 35) {
                in5ctSection = false;
            }
        });
    });
});

pdfParser.loadPDF(pdfFile);
