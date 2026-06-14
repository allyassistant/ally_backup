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
function parseNumberString(str) {
    const values = [];
    let i = 0;
    
    while (i < str.length && values.length < 11) {
        // Try 4 digits
        let num = parseInt(str.substring(i, i + 4));
        if (num >= 1000 && num <= 9999) {
            values.push(num);
            i += 4;
            continue;
        }
        // Try 3 digits
        num = parseInt(str.substring(i, i + 3));
        if (num >= 100 && num <= 999) {
            values.push(num);
            i += 3;
            continue;
        }
        // Try 2 digits
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
    
    // Group by rows
    const rows = {};
    texts.forEach(t => {
        const yKey = Math.round(t.y * 2) / 2;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    
    // Extract data from each table
    const tables = [
        { name: '1.50-1.99', search: ['1.50', '1.99'] },
        { name: '2.00-2.99', search: ['2.00', '2.99'] },
        { name: '3.00-3.99', search: ['3.00', '3.99'] },
        { name: '4.00-4.99', search: ['4.00', '4.99'] },
        { name: '5.00-5.99', search: ['5.00', '5.99'] },
        { name: '10.00-10.99', search: ['10.00', '10.99'] }
    ];
    
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    
    const db = {
        date: "01/30/26",
        round: {},
        pear: {}
    };
    
    console.log('=== Extracting all carat ranges ===\n');
    
    tables.forEach(table => {
        // Find table header
        let tableY = null;
        for (const y of sortedY) {
            const line = rows[y].map(t => t.text).join(' ');
            if (line.includes(table.search[0]) && line.includes(table.search[1]) && line.includes('RAPAPORT')) {
                tableY = y;
                break;
            }
        }
        
        if (!tableY) {
            console.log(`Table ${table.name}: NOT FOUND`);
            return;
        }
        
        console.log(`\n>>> ${table.name} (Y=${tableY})`);
        
        // Extract rows for this table
        const tableData = {};
        let colorIdx = 0;
        
        for (const y of sortedY) {
            if (y <= tableY) continue;
            if (colorIdx >= colors.length) break;
            
            const row = rows[y].sort((a, b) => a.x - b.x);
            const firstText = row[0]?.text;
            
            if (firstText === colors[colorIdx]) {
                // Find concatenated number string
                const numStr = row.find(t => /^\d{20,}$/.test(t.text));
                
                if (numStr) {
                    const values = parseNumberString(numStr.text);
                    
                    if (values.length >= 11) {
                        const colorData = {};
                        clarities.forEach((clarity, i) => {
                            colorData[clarity] = values[i];
                        });
                        tableData[colors[colorIdx]] = colorData;
                        console.log(`  ${colors[colorIdx]}: ${JSON.stringify(values.slice(0, 11))}`);
                        colorIdx++;
                    } else {
                        console.log(`  ${colors[colorIdx]}: WARNING - only ${values.length} values`);
                    }
                }
            }
            
            // Stop if we hit another RAPAPORT header
            const line = row.map(t => t.text).join(' ');
            if (line.includes('RAPAPORT') && line.includes('CT') && !line.includes(table.search[0])) {
                break;
            }
        }
        
        if (Object.keys(tableData).length > 0) {
            db.round[table.name] = tableData;
            console.log(`  ✓ Saved ${Object.keys(tableData).length} colors`);
        }
    });
    
    // Save to file
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    
    console.log('\n=== Summary ===');
    console.log('Date:', db.date);
    console.log('Round tables:', Object.keys(db.round).join(', '));
    Object.entries(db.round).forEach(([range, data]) => {
        console.log(`  ${range}: ${Object.keys(data).length} colors (D-${Object.keys(data).pop()})`);
    });
    
    console.log('\n=== H VS2 comparison ===');
    Object.entries(db.round).forEach(([range, data]) => {
        if (data.H && data.H.VS2) {
            console.log(`  ${range.padEnd(12)} H VS2: ${data.H.VS2}`);
        }
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
