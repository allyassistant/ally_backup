const PDFParser = require('pdf2json');
const fs = require('fs');

const pdfFile = '/home/node/.clawdbot/media/inbound/51834b38-ab78-4a9d-9c5f-ba4a7edd92f3.pdf';
const outputFile = '/home/node/clawd/rapaport_extracted.json';

const pdfParser = new PDFParser();

function safeDecode(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

function parseTableRows(texts, tableName) {
    // Group by Y position
    const rows = {};
    texts.forEach(t => {
        const yKey = Math.round(t.y * 1) / 1;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    // Sort rows by Y
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const result = [];
    
    sortedY.forEach(y => {
        const rowTexts = rows[y].sort((a, b) => a.x - b.x);
        const text = rowTexts.map(t => t.text).join(' ').trim();
        
        // Skip empty or header rows
        if (text && text.length > 0) {
            result.push({ y, text, x: rowTexts[0]?.x });
        }
    });
    
    return result;
}

pdfParser.on('pdfParser_dataReady', pdfData => {
    const pages = pdfData.Pages || [];
    const extractedData = { pages: [] };
    
    pages.forEach((page, pageIdx) => {
        console.log(`Processing page ${pageIdx + 1}...`);
        
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
        const pageLines = [];
        
        sortedY.forEach(y => {
            const rowTexts = rows[y].sort((a, b) => a.x - b.x);
            const line = rowTexts.map(t => t.text).join(' ').trim();
            if (line.length > 0) {
                pageLines.push({ y, text: line });
            }
        });
        
        extractedData.pages.push({
            page: pageIdx + 1,
            lines: pageLines
        });
    });
    
    // Save to JSON
    fs.writeFileSync(outputFile, JSON.stringify(extractedData, null, 2));
    console.log(`Extraction complete! Saved to ${outputFile}`);
    
    // Also create a readable text version
    let textOutput = 'RAPAPORT PRICE LIST - EXTRACTED CONTENT\n';
    textOutput += '=====================================\n\n';
    
    extractedData.pages.forEach(page => {
        textOutput += `\n--- PAGE ${page.page} ---\n\n`;
        page.lines.forEach(line => {
            textOutput += `${String(line.y).padStart(4)}: ${line.text}\n`;
        });
    });
    
    fs.writeFileSync('/home/node/clawd/rapaport_extracted.txt', textOutput);
    console.log('Text version saved to rapaport_extracted.txt');
});

pdfParser.loadPDF(pdfFile);
