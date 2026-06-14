const PDFParser = require('pdf2json');
const fs = require('fs');
const path = '/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf';
process.env.PDF2JSON_DISABLE_LOGS = '1';
const pdfParser = new PDFParser(null, 1);

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    const page = pdfData.Pages[1];
    const texts = [];
    page.Texts?.forEach(text => {
        const rawText = text.R?.[0]?.T || '';
        texts.push({ x: text.x, y: text.y, text: safeDecode(rawText).trim() });
    });
    
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    const db = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', 'utf8'));
    
    // Correct table rows with updated X range
    const tableRows = [
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
    ];
    
    console.log('=== Re-extracting .90-.99 / 1.00-1.49 ===\n');
    
    tableRows.forEach(({ y, color, left, right }) => {
        const row = texts.filter(t => Math.abs(t.y - y) < 0.3).sort((a, b) => a.x - b.x);
        
        // Updated X range: > 3.5 and < 19 (to include X=18.02)
        const leftNums = row.filter(t => t.x > 3.5 && t.x < 19 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
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
    
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    console.log('\nDone!');
});

pdfParser.loadPDF(path);
