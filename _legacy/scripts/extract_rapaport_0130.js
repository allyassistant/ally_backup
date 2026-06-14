const PDFParser = require('pdf2json');
const fs = require('fs');

// Extract Rapaport price data from PDF
async function extractRapaportData(pdfFile, shapeType) {
    return new Promise((resolve, reject) => {
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
            const extractedTables = {};
            let currentTable = null;
            let currentTableName = null;
            
            pages.forEach((page, pageIdx) => {
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
                    const line = rowTexts.map(t => t.text).join(' ').trim();
                    
                    // Detect table header (e.g., "RAPAPERT... 5.00 - 5.99 CT.")
                    const tableMatch = line.match(/(\d+\.\d+)\s*-\s*(\d+\.\d+)\s*CT/i);
                    if (tableMatch && line.toUpperCase().includes('RAPAPORT')) {
                        currentTableName = `${tableMatch[1]}-${tableMatch[2]}`;
                        currentTable = {
                            header: line,
                            data: {}
                        };
                        extractedTables[currentTableName] = currentTable.data;
                        return;
                    }
                    
                    // Extract color rows (D through M)
                    if (currentTable) {
                        const colorMatch = line.match(/^([D-M])\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
                        if (colorMatch) {
                            const color = colorMatch[1];
                            const values = colorMatch.slice(2).map(v => parseInt(v, 10));
                            currentTable.data[color] = {
                                'IF': values[0],
                                'VVS1': values[1],
                                'VVS2': values[2],
                                'VS1': values[3],
                                'VS2': values[4],
                                'SI1': values[5],
                                'SI2': values[6],
                                'SI3': values[7],
                                'I1': values[8],
                                'I2': values[9],
                                'I3': values[10]
                            };
                        }
                    }
                });
            });
            
            resolve(extractedTables);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfFile);
    });
}

// Main
async function main() {
    const roundPdf = '/Users/ally/Downloads/Round Price List 01.30.2026.pdf';
    const pearPdf = '/Users/ally/Downloads/Pear Price List 01.30.2026.pdf';
    
    console.log('Extracting Round prices...');
    const roundData = await extractRapaportData(roundPdf, 'round');
    console.log('Round tables found:', Object.keys(roundData));
    
    console.log('\nExtracting Pear prices...');
    const pearData = await extractRapaportData(pearPdf, 'pear');
    console.log('Pear tables found:', Object.keys(pearData));
    
    // Build database
    const db = {
        date: '01/30/26',
        round: roundData,
        pear: pearData
    };
    
    // Save
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    console.log('\n✅ Saved to memory/rapaport_db.json');
    
    // Print summary
    console.log('\n--- Summary ---');
    console.log('Round tables:', Object.keys(roundData).length);
    Object.entries(roundData).forEach(([range, colors]) => {
        const colorCount = Object.keys(colors).length;
        console.log(`  ${range}: ${colorCount} colors`);
    });
    console.log('\nPear tables:', Object.keys(pearData).length);
    Object.entries(pearData).forEach(([range, colors]) => {
        const colorCount = Object.keys(colors).length;
        console.log(`  ${range}: ${colorCount} colors`);
    });
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
