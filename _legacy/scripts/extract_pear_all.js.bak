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
    
    const rows = {};
    texts.forEach(t => {
        const yKey = Math.round(t.y * 2) / 2;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    
    // All Pear tables with correct Y ranges and X boundaries
    const tables = [
        { name: '.90-.99', startY: 8, endY: 17, minX: 3.5, maxX: 18.5 },
        { name: '1.00-1.49', startY: 8, endY: 17, minX: 19, maxX: 35 },
        { name: '1.50-1.99', startY: 17, endY: 28, minX: 3.5, maxX: 18.5 },
        { name: '2.00-2.99', startY: 17, endY: 28, minX: 19, maxX: 35 },
        { name: '3.00-3.99', startY: 28, endY: 37, minX: 3.5, maxX: 18.5 },
        { name: '4.00-4.99', startY: 28, endY: 37, minX: 19, maxX: 35 },
        { name: '5.00-5.99', startY: 37, endY: 50, minX: 3.5, maxX: 18.5 },
        { name: '10.00-10.99', startY: 37, endY: 50, minX: 19, maxX: 35 }
    ];
    
    const db = { pear: {} };
    
    console.log('=== Extracting All Pear Tables ===\\n');
    
    tables.forEach(table => {
        console.log('\\n>>> ' + table.name + ' CT TABLE <<<');
        
        const tableData = {};
        
        sortedY.forEach(y => {
            if (y < table.startY || y > table.endY) return;
            
            const row = rows[y].sort((a, b) => a.x - b.x);
            const color = row[0]?.text;
            
            if (!colors.includes(color)) return;
            
            // Get numeric values in range
            const values = row
                .filter(t => t.x > table.minX && t.x < table.maxX)
                .filter(t => /^\\d+$/.test(t.text))
                .map(t => parseInt(t.text));
            
            // Some colors (F, M) might have different X positions, try to be flexible
            if (values.length >= 11) {
                const colorData = {};
                clarities.forEach((c, i) => colorData[c] = values[i]);
                tableData[color] = colorData;
                console.log(color + ': ' + JSON.stringify(colorData));
            } else if (values.length >= 5) {
                // Partial data - still record it
                const colorData = {};
                clarities.slice(0, values.length).forEach((c, i) => colorData[c] = values[i]);
                console.log(color + ': ' + JSON.stringify(colorData) + ' (PARTIAL: ' + values.length + ' values)');
            }
        });
        
        if (Object.keys(tableData).length > 0) {
            db.pear[table.name] = tableData;
        }
    });
    
    // Load existing round data and save combined
    const existingDb = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', 'utf8'));
    const finalDb = {
        date: existingDb.date,
        round: existingDb.round,
        pear: db.pear
    };
    
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(finalDb, null, 2));
    
    console.log('\\n=== Summary ===');
    console.log('Date:', finalDb.date);
    console.log('Round tables:', Object.keys(finalDb.round).length);
    console.log('Pear tables:', Object.keys(finalDb.pear).length);
    
    console.log('\\n=== Pear H VS2 Comparison with Round ===');
    console.log('Carat       | Pear H VS2 | Round H VS2 | Diff');
    console.log('------------|------------|-------------|------');
    ['.90-.99', '1.00-1.49', '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', '5.00-5.99', '10.00-10.99'].forEach(range => {
        const pearH = finalDb.pear[range]?.H?.VS2 || 'N/A';
        const roundH = finalDb.round[range]?.H?.VS2 || 'N/A';
        const diff = (pearH !== 'N/A' && roundH !== 'N/A') ? Math.round((pearH - roundH) / roundH * 100) + '%' : 'N/A';
        console.log(range.padEnd(12) + '| ' + String(pearH).padEnd(11) + '| ' + String(roundH).padEnd(12) + '| ' + diff);
    });
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
