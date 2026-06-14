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

// Parse individual numbers from array
function parsePearRow(values, color) {
    // Pear tables have 11 values: IF, VVS1, VVS2, VS1, VS2, SI1, SI2, SI3, I1, I2, I3
    return {
        "IF": parseInt(values[0]) || 0,
        "VVS1": parseInt(values[1]) || 0,
        "VVS2": parseInt(values[2]) || 0,
        "VS1": parseInt(values[3]) || 0,
        "VS2": parseInt(values[4]) || 0,
        "SI1": parseInt(values[5]) || 0,
        "SI2": parseInt(values[6]) || 0,
        "SI3": parseInt(values[7]) || 0,
        "I1": parseInt(values[8]) || 0,
        "I2": parseInt(values[9]) || 0,
        "I3": parseInt(values[10]) || 0
    };
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    const db = {
        date: "01/30/26",
        round: {},
        pear: {}
    };
    
    // Process page 2 (main tables)
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
        const yKey = Math.round(t.y * 2) / 2;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    
    // Extract tables
    const tables = [
        { name: '.90-.99', startY: 8, endY: 17, leftX: 2, rightX: 14 },
        { name: '1.00-1.49', startY: 8, endY: 17, leftX: 14, rightX: 26 },
        { name: '1.50-1.99', startY: 17, endY: 28, leftX: 2, rightX: 14 },
        { name: '2.00-2.99', startY: 17, endY: 28, leftX: 14, rightX: 26 },
        { name: '3.00-3.99', startY: 28, endY: 37, leftX: 2, rightX: 14 },
        { name: '4.00-4.99', startY: 28, endY: 37, leftX: 14, rightX: 26 },
        { name: '5.00-5.99', startY: 37, endY: 50, leftX: 2, rightX: 14 },
        { name: '10.00-10.99', startY: 37, endY: 50, leftX: 14, rightX: 26 }
    ];
    
    console.log('=== Extracting Pear Tables ===\\n');
    
    tables.forEach(table => {
        console.log('\\n>>> ' + table.name + ' CT TABLE <<<');
        
        const tableData = {};
        
        sortedY.forEach(y => {
            if (y < table.startY || y > table.endY) return;
            
            const row = rows[y].sort((a, b) => a.x - b.x);
            const color = row[0]?.text;
            
            if (!colors.includes(color)) return;
            
            // Filter values in the correct X range
            const values = row
                .filter(t => t.x > table.leftX && t.x < table.rightX)
                .filter(t => /^\\d+$/.test(t.text))
                .map(t => parseInt(t.text));
            
            if (values.length >= 11) {
                tableData[color] = parsePearRow(values.slice(0, 11));
                console.log(color + ': ' + JSON.stringify(tableData[color]));
            }
        });
        
        if (Object.keys(tableData).length > 0) {
            db.pear[table.name] = tableData;
        }
    });
    
    // Load existing round data
    const existingDb = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', 'utf8'));
    db.round = existingDb.round;
    
    // Save combined database
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    
    console.log('\\n=== Summary ===');
    console.log('Date:', db.date);
    console.log('Pear tables:', Object.keys(db.pear).join(', '));
    Object.entries(db.pear).forEach(([range, data]) => {
        console.log('  ' + range + ': ' + Object.keys(data).length + ' colors');
    });
    
    console.log('\\n=== H VS2 Comparison (Pear vs Round) ===');
    console.log('Carat     | Pear H VS2 | Round H VS2');
    console.log('----------|------------|------------');
    ['.90-.99', '1.00-1.49', '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', '5.00-5.99', '10.00-10.99'].forEach(range => {
        const pearH = db.pear[range]?.H?.VS2 || 'N/A';
        const roundH = db.round[range]?.H?.VS2 || 'N/A';
        console.log(range.padEnd(10) + '| ' + String(pearH).padEnd(11) + '| ' + roundH);
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
