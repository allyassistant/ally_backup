const PDFParser = require('pdf2json');
const fs = require('fs');

const path = process.argv[2] || '/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf';

process.env.PDF2JSON_DISABLE_LOGS = '1';

const pdfParser = new PDFParser(null, 1);

function safeDecode(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

// Extract numeric values for a specific color from a row
function extractColorValues(row, colorX, minX, maxX) {
    // Get all numeric values in the X range
    const values = row
        .filter(t => t.x > minX && t.x < maxX)
        .filter(t => /^\d+$/.test(t.text))
        .map(t => ({ x: t.x, val: parseInt(t.text) }))
        .sort((a, b) => a.x - b.x);
    
    return values.map(v => v.val);
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    const page = pdfData.Pages[1];
    const texts = [];
    
    page.Texts?.forEach(text => {
        const rawText = text.R?.[0]?.T || '';
        texts.push({
            x: text.x,
            y: text.y,
            text: safeDecode(rawText).trim()
        });
    });
    
    // Group by Y
    const rows = {};
    texts.forEach(t => {
        const yKey = Math.round(t.y * 2) / 2; // 0.5 precision
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    const db = { pear: {} };
    
    // Define all tables with their Y ranges and X boundaries
    // Left table: X=3.5 to 18.5, Right table: X=19 to 35
    const tableDefs = [
        { name: '.90-.99', yStart: 8, yEnd: 17, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 },
        { name: '1.00-1.49', yStart: 8, yEnd: 17, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 },
        { name: '1.50-1.99', yStart: 17, yEnd: 28, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 },
        { name: '2.00-2.99', yStart: 17, yEnd: 28, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 },
        { name: '3.00-3.99', yStart: 28, yEnd: 37, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 },
        { name: '4.00-4.99', yStart: 28, yEnd: 37, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 },
        { name: '5.00-5.99', yStart: 37, yEnd: 50, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 },
        { name: '10.00-10.99', yStart: 37, yEnd: 50, leftMinX: 3.5, leftMaxX: 18.5, rightMinX: 19, rightMaxX: 35 }
    ];
    
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    
    console.log('=== Extracting All Pear Tables ===\n');
    
    tableDefs.forEach(table => {
        console.log(`\n>>> ${table.name} CT TABLE <<<`);
        
        const leftData = {};
        const rightData = {};
        
        // Find all rows in this Y range
        const yValues = Object.keys(rows).map(Number).filter(y => y >= table.yStart && y <= table.yEnd);
        
        yValues.forEach(y => {
            const row = rows[y].sort((a, b) => a.x - b.x);
            
            // Find colors in this row (check first element and elements near X=2.5)
            const colorElements = row.filter(t => t.x < 5 && colors.includes(t.text));
            
            if (colorElements.length === 0) return;
            
            // If single color, extract directly
            if (colorElements.length === 1) {
                const color = colorElements[0].text;
                const leftVals = extractColorValues(row, colorElements[0].x, table.leftMinX, table.leftMaxX);
                const rightVals = extractColorValues(row, colorElements[0].x, table.rightMinX, table.rightMaxX);
                
                if (leftVals.length >= 11) {
                    const data = {};
                    clarities.forEach((c, i) => data[c] = leftVals[i]);
                    leftData[color] = data;
                    console.log(`${color} (left): ${JSON.stringify(data)}`);
                }
                if (rightVals.length >= 11) {
                    const data = {};
                    clarities.forEach((c, i) => data[c] = rightVals[i]);
                    rightData[color] = data;
                    console.log(`${color} (right): ${JSON.stringify(data)}`);
                }
            }
            // If two colors side by side (like D/E, G/H, K/L), need to separate
            else if (colorElements.length === 2) {
                const [c1, c2] = colorElements.sort((a, b) => a.x - b.x).map(t => t.text);
                
                // For side-by-side colors, we need to interleave the values
                // First color gets values at odd indices (0, 2, 4...), second gets even (1, 3, 5...)
                const leftVals = extractColorValues(row, 0, table.leftMinX, table.leftMaxX);
                const rightVals = extractColorValues(row, 0, table.rightMinX, table.rightMaxX);
                
                if (leftVals.length >= 22) { // Two colors = 22 values (11 each)
                    const c1Data = {}; const c2Data = {};
                    for (let i = 0; i < 11; i++) {
                        c1Data[clarities[i]] = leftVals[i * 2];     // Even indices
                        c2Data[clarities[i]] = leftVals[i * 2 + 1]; // Odd indices
                    }
                    leftData[c1] = c1Data;
                    leftData[c2] = c2Data;
                    console.log(`${c1} (left): ${JSON.stringify(c1Data)}`);
                    console.log(`${c2} (left): ${JSON.stringify(c2Data)}`);
                }
                
                if (rightVals.length >= 22) {
                    const c1Data = {}; const c2Data = {};
                    for (let i = 0; i < 11; i++) {
                        c1Data[clarities[i]] = rightVals[i * 2];
                        c2Data[clarities[i]] = rightVals[i * 2 + 1];
                    }
                    rightData[c1] = c1Data;
                    rightData[c2] = c2Data;
                    console.log(`${c1} (right): ${JSON.stringify(c1Data)}`);
                    console.log(`${c2} (right): ${JSON.stringify(c2Data)}`);
                }
            }
        });
        
        // Merge left and right data
        db.pear[table.name] = { ...leftData, ...rightData };
    });
    
    // Load existing round data and save
    const existingDb = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', 'utf8'));
    const finalDb = {
        date: existingDb.date,
        round: existingDb.round,
        pear: db.pear
    };
    
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(finalDb, null, 2));
    
    console.log('\n=== Summary ===');
    Object.entries(db.pear).forEach(([range, data]) => {
        console.log(`${range}: ${Object.keys(data).join(', ')} (${Object.keys(data).length} colors)`);
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
