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

// Parse concatenated number string
function parseConcatenatedNumbers(str) {
    const values = [];
    let i = 0;
    
    while (i < str.length && values.length < 11) {
        // Try 4 digits (1000-9999)
        let num = parseInt(str.substring(i, i + 4));
        if (num >= 1000 && num <= 9999) {
            values.push(num);
            i += 4;
            continue;
        }
        // Try 3 digits (100-999)
        num = parseInt(str.substring(i, i + 3));
        if (num >= 100 && num <= 999) {
            values.push(num);
            i += 3;
            continue;
        }
        // Try 2 digits (10-99)
        num = parseInt(str.substring(i, i + 2));
        if (num >= 10 && num <= 99) {
            values.push(num);
            i += 2;
            continue;
        }
        i++;
    }
    
    return values;
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
    
    const rows = {};
    texts.forEach(t => {
        const yKey = Math.round(t.y * 2) / 2;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    
    const caratRanges = [
        '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', 
        '5.00-5.99', '10.00-10.99'
    ];
    
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    
    const db = {
        date: "01/30/26",
        round: {},
        pear: {}
    };
    
    console.log('=== Extracting all carat ranges ===\n');
    
    let currentRange = null;
    let currentTable = {};
    let colorIdx = 0;
    let tableStartY = null;
    
    sortedY.forEach(y => {
        const rowTexts = rows[y].sort((a, b) => a.x - b.x);
        const line = rowTexts.map(t => t.text).join(' ');
        
        // Detect new table
        for (const range of caratRanges) {
            const [start, end] = range.split('-');
            if ((line.includes(start) && line.includes(end)) || 
                (line.includes(start.replace('.', '')) && line.includes(end.replace('.', '')))) {
                if (line.includes('RAPAPORT')) {
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
        }
        
        // Parse color rows within table
        if (currentRange && colorIdx < colors.length && y > tableStartY && y < tableStartY + 20) {
            // Find color in this row
            const colorInRow = rowTexts.find(t => colors.includes(t.text));
            
            if (colorInRow && colorInRow.text === colors[colorIdx]) {
                // Find concatenated number string
                const numStr = rowTexts.find(t => /^\d{20,}$/.test(t.text));
                
                if (numStr) {
                    const values = parseConcatenatedNumbers(numStr.text);
                    
                    if (values.length >= 11) {
                        const colorData = {};
                        clarities.forEach((clarity, i) => {
                            colorData[clarity] = values[i];
                        });
                        currentTable[colors[colorIdx]] = colorData;
                        console.log(`  ${colors[colorIdx]}: ${JSON.stringify(colorData)}`);
                        colorIdx++;
                    } else {
                        console.log(`  ${colors[colorIdx]}: WARNING - only ${values.length} values found`);
                    }
                }
            }
        }
        
        // Stop if we go too far
        if (currentRange && y > tableStartY + 20) {
            if (Object.keys(currentTable).length > 0) {
                db.round[currentRange] = currentTable;
                console.log(`\n✓ Saved ${currentRange}: ${Object.keys(currentTable).length} colors`);
            }
            currentRange = null;
            currentTable = {};
        }
    });
    
    // Save last table
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
        console.log(`  ${range}: ${Object.keys(data).length} colors (D-${Object.keys(data).pop()})`);
    });
    
    console.log('\n=== Verifying H VS2 across all tables ===');
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
