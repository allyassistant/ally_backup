const PDFParser = require('pdf2json');
const fs = require('fs');

const path = '/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf';
process.env.PDF2JSON_DISABLE_LOGS = '1';

const pdfParser = new PDFParser(null, 1);

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    // Use page 1 (index 1) which contains the Pear price list
    const page = pdfData.Pages[1];
    const texts = [];
    
    page.Texts?.forEach(text => {
        const rawText = text.R?.[0]?.T || '';
        texts.push({ x: text.x, y: text.y, text: safeDecode(rawText).trim() });
    });
    
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    const db = { pear: {} };
    
    // Define correct table structure based on page 1 Y coordinates
    // Each row has: y position, color, left table, right table
    const tableRows = [
        // .90-.99 / 1.00-1.49 (first set of tables on page 1)
        { y: 9.35, color: 'D', left: '.90-.99', right: '1.00-1.49' },
        { y: 10.06, color: 'E', left: '.90-.99', right: '1.00-1.49' },
        { y: 10.78, color: 'F', left: '.90-.99', right: '1.00-1.49' },
        { y: 11.49, color: 'G', left: '.90-.99', right: '1.00-1.49' },
        { y: 12.15, color: 'H', left: '.90-.99', right: '1.00-1.49' },
        { y: 12.87, color: 'I', left: '.90-.99', right: '1.00-1.49' },
        { y: 13.58, color: 'J', left: '.90-.99', right: '1.00-1.49' },
        { y: 14.29, color: 'K', left: '.90-.99', right: '1.00-1.49' },
        { y: 15.01, color: 'L', left: '.90-.99', right: '1.00-1.49' },
        { y: 15.73, color: 'M', left: '.90-.99', right: '1.00-1.49' },
        
        // 1.50-1.99 / 2.00-2.99
        { y: 18.68, color: 'D', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 19.40, color: 'E', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 20.12, color: 'F', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 20.83, color: 'G', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 21.49, color: 'H', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 22.20, color: 'I', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 22.92, color: 'J', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 23.64, color: 'K', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 24.35, color: 'L', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 25.07, color: 'M', left: '1.50-1.99', right: '2.00-2.99' },
        
        // 3.00-3.99 / 4.00-4.99
        { y: 29.41, color: 'D', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 30.13, color: 'E', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 30.84, color: 'F', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 31.56, color: 'G', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 32.21, color: 'H', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 32.93, color: 'I', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 33.64, color: 'J', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 34.36, color: 'K', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 35.08, color: 'L', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 35.80, color: 'M', left: '3.00-3.99', right: '4.00-4.99' },
        
        // 5.00-5.99 / 10.00-10.99
        { y: 38.73, color: 'D', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 39.45, color: 'E', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 40.16, color: 'F', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 40.88, color: 'G', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 41.53, color: 'H', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 42.25, color: 'I', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 42.97, color: 'J', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 43.69, color: 'K', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 44.40, color: 'L', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 45.12, color: 'M', left: '5.00-5.99', right: '10.00-10.99' },
    ];
    
    console.log('=== Extracting from Page 1 ===\n');
    
    // Initialize tables
    ['.90-.99', '1.00-1.49', '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', '5.00-5.99', '10.00-10.99'].forEach(t => {
        db.pear[t] = {};
    });
    
    tableRows.forEach(({ y, color, left, right }) => {
        const row = texts.filter(t => Math.abs(t.y - y) < 0.3).sort((a, b) => a.x - b.x);
        
        // Extract numeric values for left and right tables
        const leftNums = row.filter(t => t.x > 3 && t.x < 18 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
        const rightNums = row.filter(t => t.x > 19 && t.x < 35 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
        
        console.log(`${color} @ Y=${y}: left=${leftNums.length}, right=${rightNums.length}`);
        
        if (leftNums.length >= 11) {
            const data = {};
            clarities.forEach((c, i) => data[c] = leftNums[i]);
            db.pear[left][color] = data;
        }
        
        if (rightNums.length >= 11) {
            const data = {};
            clarities.forEach((c, i) => data[c] = rightNums[i]);
            db.pear[right][color] = data;
        }
    });
    
    // Load existing round data
    const existingDb = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', 'utf8'));
    const finalDb = {
        date: existingDb.date,
        round: existingDb.round,
        pear: db.pear
    };
    
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(finalDb, null, 2));
    
    console.log('\n=== Extraction Complete ===');
    Object.entries(db.pear).forEach(([range, data]) => {
        console.log(`${range}: ${Object.keys(data).length} colors`);
    });
});

pdfParser.loadPDF(path);
