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

// Parse a long number string by trying different splits
function parseRapaportRow(str) {
    const result = [];
    let pos = 0;
    
    while (pos < str.length && result.length < 11) {
        // Try 4 digits first (for values like 1000, 1320)
        if (pos + 4 <= str.length) {
            const four = parseInt(str.substring(pos, pos + 4));
            if (four >= 1000 && four <= 9999) {
                result.push(four);
                pos += 4;
                continue;
            }
        }
        
        // Try 3 digits (for values like 835, 750)
        if (pos + 3 <= str.length) {
            const three = parseInt(str.substring(pos, pos + 3));
            if (three >= 100 && three <= 999) {
                result.push(three);
                pos += 3;
                continue;
            }
        }
        
        // Try 2 digits (for values like 60, 25)
        if (pos + 2 <= str.length) {
            const two = parseInt(str.substring(pos, pos + 2));
            if (two >= 10 && two <= 99) {
                result.push(two);
                pos += 2;
                continue;
            }
        }
        
        pos++;
    }
    
    return result;
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    const pages = pdfData.Pages || [];
    
    if (pages.length < 2) {
        console.log('Not enough pages');
        return;
    }
    
    const page = pages[1];
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
        const yKey = Math.round(t.y * 2) / 2;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    
    const db = {
        date: "01/30/26",
        round: {},
        pear: {}
    };
    
    let currentRange = null;
    let currentTable = {};
    let colorIdx = 0;
    let tableStartY = null;
    
    const caratRanges = [
        '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', 
        '5.00-5.99', '10.00-10.99'
    ];
    
    console.log('=== Extracting all carat ranges ===\n');
    
    sortedY.forEach(y => {
        const rowTexts = rows[y].sort((a, b) => a.x - b.x);
        const line = rowTexts.map(t => t.text).join(' ');
        
        // Detect table header
        for (const range of caratRanges) {
            const [start, end] = range.split('-');
            if (line.includes('RAPAPORT') && line.includes(start) && line.includes(end)) {
                // Save previous table
                if (currentRange && Object.keys(currentTable).length > 0) {
                    db.round[currentRange] = currentTable;
                    console.log(`\n✓ Saved ${currentRange}: ${Object.keys(currentTable).length} colors`);
                }
                
                currentRange = range;
                currentTable = {};
                colorIdx = 0;
                tableStartY = y;
                console.log(`\n>>> Found table: ${range} (Y=${y})`);
                return;
            }
        }
        
        // Parse color row
        if (currentRange && colorIdx < colors.length) {
            // Check if first element is the expected color
            const firstText = rowTexts[0]?.text;
            if (firstText === colors[colorIdx]) {
                // Look for long number string in this row
                const numElement = rowTexts.find(t => /^\d{20,}$/.test(t.text));
                
                if (numElement) {
                    const values = parseRapaportRow(numElement.text);
                    
                    if (values.length >= 11) {
                        const colorData = {};
                        clarities.forEach((clarity, i) => {
                            colorData[clarity] = values[i];
                        });
                        currentTable[colors[colorIdx]] = colorData;
                        console.log(`  ${colors[colorIdx]}: ${JSON.stringify(values.slice(0, 11))}`);
                        colorIdx++;
                    } else {
                        console.log(`  ${colors[colorIdx]}: WARNING - found ${values.length} values: ${JSON.stringify(values)}`);
                    }
                }
            }
        }
        
        // End of table detection
        if (currentRange && y > tableStartY + 25) {
            if (Object.keys(currentTable).length > 0) {
                db.round[currentRange] = currentTable;
                console.log(`\n✓ Saved ${currentRange}: ${Object.keys(currentTable).length} colors`);
            }
            currentRange = null;
            currentTable = {};
        }
    });
    
    // Save final table
    if (currentRange && Object.keys(currentTable).length > 0) {
        db.round[currentRange] = currentTable;
        console.log(`\n✓ Saved ${currentRange}: ${Object.keys(currentTable).length} colors`);
    }
    
    // Save to file
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    
    console.log('\n=== Summary ===');
    console.log('Date:', db.date);
    console.log('Round tables:', Object.keys(db.round).join(', '));
    Object.entries(db.round).forEach(([range, data]) => {
        const colorCount = Object.keys(data).length;
        const firstColor = Object.keys(data)[0];
        const lastColor = Object.keys(data).pop();
        console.log(`  ${range}: ${colorCount} colors (${firstColor}-${lastColor})`);
    });
    
    console.log('\n=== H VS2 verification ===');
    Object.entries(db.round).forEach(([range, data]) => {
        if (data.H && data.H.VS2) {
            console.log(`  ${range} H VS2: ${data.H.VS2}`);
        }
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
