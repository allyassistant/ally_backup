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

// Parse a concatenated number string into 11 values
function extractNumbers(str) {
    const result = [];
    let buffer = '';
    
    for (let i = 0; i < str.length; i++) {
        buffer += str[i];
        
        // Check if buffer forms a valid Rapaport value
        if (buffer.length >= 2) {
            const num = parseInt(buffer);
            // Valid Rapaport values are typically 10-9999
            if (num >= 10 && num <= 9999) {
                // Look ahead to see if this is a complete number
                const nextChar = str[i + 1];
                if (!nextChar || isNaN(parseInt(nextChar))) {
                    result.push(num);
                    buffer = '';
                }
            }
        }
        
        // If buffer gets too long without valid number, reset
        if (buffer.length > 4) {
            // Try to extract what we can
            for (let j = 2; j <= 4 && buffer.length >= j; j++) {
                const testNum = parseInt(buffer.substring(0, j));
                if (testNum >= 10 && testNum <= 9999) {
                    result.push(testNum);
                    buffer = buffer.substring(j);
                    break;
                }
            }
            if (buffer.length > 4) buffer = buffer.substring(1);
        }
    }
    
    return result;
}

// Smart parse: Rapaport values are always 2-4 digits
function smartParse(str) {
    const values = [];
    let i = 0;
    
    while (i < str.length && values.length < 11) {
        let found = false;
        
        // Try lengths from 4 down to 2
        for (let len = 4; len >= 2; len--) {
            if (i + len > str.length) continue;
            
            const substr = str.substring(i, i + len);
            const num = parseInt(substr);
            
            // Check if it's a reasonable Rapaport value
            if (num >= 10 && num <= 9999) {
                values.push(num);
                i += len;
                found = true;
                break;
            }
        }
        
        if (!found) i++;
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
            x: text.x,
            y: text.y,
            text: decodedText.trim()
        });
    });
    
    // Sort by Y then X
    texts.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 1.0) return a.x - b.x;
        return a.y - b.y;
    });
    
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    
    const db = {
        date: "01/30/26",
        round: {},
        pear: {}
    };
    
    console.log('=== Extracting all carat ranges ===\n');
    
    // Find "RAPAPORT : (X.XX - X.XX CT.)" headers
    const tables = [];
    
    for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        if (t.text.includes('RAPAPORT') && t.text.includes('CT.')) {
            // Extract range from this header
            const match = t.text.match(/\(([\d.]+)\s*-\s*([\d.]+)\s*CT\.\)/);
            if (match) {
                const range = `${match[1]}-${match[2]}`;
                tables.push({
                    range: range,
                    y: t.y,
                    index: i
                });
                console.log(`Found table: ${range} at Y=${Math.round(t.y)}`);
            }
        }
    }
    
    // For each table, extract data
    tables.forEach((table, idx) => {
        const nextTable = tables[idx + 1];
        const endY = nextTable ? nextTable.y : table.y + 100;
        
        const tableTexts = texts.filter(t => t.y > table.y && t.y < endY);
        
        // Group by Y
        const rows = {};
        tableTexts.forEach(t => {
            const yKey = Math.round(t.y);
            if (!rows[yKey]) rows[yKey] = [];
            rows[yKey].push(t);
        });
        
        const tableData = {};
        let colorIdx = 0;
        
        Object.keys(rows).sort((a, b) => a - b).forEach(y => {
            if (colorIdx >= colors.length) return;
            
            const row = rows[y].sort((a, b) => a.x - b.x);
            const firstText = row[0]?.text;
            
            if (firstText === colors[colorIdx]) {
                // Found a color row - look for the number string
                // It should be a text element with many digits
                const numText = row.find(t => /^\d{15,}$/.test(t.text));
                
                if (numText) {
                    const values = smartParse(numText.text);
                    
                    if (values.length >= 11) {
                        const colorData = {};
                        clarities.forEach((clarity, i) => {
                            colorData[clarity] = values[i];
                        });
                        tableData[colors[colorIdx]] = colorData;
                        colorIdx++;
                    }
                }
            }
        });
        
        if (Object.keys(tableData).length > 0) {
            db.round[table.range] = tableData;
            console.log(`  ✓ Extracted ${Object.keys(tableData).length} colors`);
        }
    });
    
    // Save to file
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    
    console.log('\n=== Summary ===');
    console.log('Date:', db.date);
    console.log('Round tables:', Object.keys(db.round).join(', '));
    Object.entries(db.round).forEach(([range, data]) => {
        console.log(`  ${range}: ${Object.keys(data).length} colors`);
    });
    
    console.log('\n=== Sample data verification ===');
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
