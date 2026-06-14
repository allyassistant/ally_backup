const PDFParser = require('pdf2json');
const fs = require('fs');

const path = '/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf';
process.env.PDF2JSON_DISABLE_LOGS = '1';

const pdfParser = new PDFParser(null, 1);

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    const page1 = pdfData.Pages[1];
    const texts = [];
    
    page1.Texts?.forEach(text => {
        const rawText = text.R?.[0]?.T || '';
        texts.push({ x: text.x, y: text.y, text: safeDecode(rawText).trim() });
    });
    
    const db = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', 'utf8'));
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    
    // Correct table structure based on actual PDF coordinates
    const corrections = [
        // Format: { y, color, leftTable, rightTable }
        
        // 1.50-1.99 corrections
        { y: 21.0, color: 'G', left: '1.50-1.99', right: '2.00-2.99' },  // G is alone at Y=21
        { y: 21.5, color: 'H', left: '1.50-1.99', right: '2.00-2.99' },  // H is at Y=21.5
        
        // Check I row too
        { y: 22.0, color: 'I', left: '1.50-1.99', right: '2.00-2.99' },
        
        // 3.00-3.99 corrections - check if G/H are at correct Y
        { y: 31.0, color: 'F', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 32.0, colors: ['G', 'H'], left: '3.00-3.99', right: '4.00-4.99' },  // Side by side
        
        // 5.00-5.99 corrections - check J row
        { y: 42.0, color: 'J', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 42.5, color: 'I', left: '5.00-5.99', right: '10.00-10.99' },  // Check if I is at 42.5
    ];
    
    console.log('=== Applying Corrections ===\n');
    
    corrections.forEach(({ y, color, colors, left, right }) => {
        const row = texts.filter(t => Math.abs(t.y - y) < 0.3).sort((a, b) => a.x - b.x);
        
        if (color) {
            // Single color
            const hasColor = row.some(t => t.text === color && t.x < 5);
            if (!hasColor) return;
            
            const leftNums = row.filter(t => t.x > 3.5 && t.x < 18.5 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
            const rightNums = row.filter(t => t.x > 19 && t.x < 35 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
            
            console.log(`Y=${y} ${color}: left=${leftNums.length}, right=${rightNums.length}`);
            
            if (leftNums.length >= 11) {
                const data = {};
                clarities.forEach((c, i) => data[c] = leftNums[i]);
                db.pear[left][color] = data;
                console.log(`  -> ${left} ${color} updated`);
            }
            if (rightNums.length >= 11) {
                const data = {};
                clarities.forEach((c, i) => data[c] = rightNums[i]);
                db.pear[right][color] = data;
                console.log(`  -> ${right} ${color} updated`);
            }
        } else if (colors) {
            // Side by side
            const colorElements = row.filter(t => colors.includes(t.text) && t.x < 5);
            if (colorElements.length !== 2) return;
            
            const sortedColors = colorElements.sort((a, b) => a.x - b.y).map(t => t.text);
            const [c1, c2] = sortedColors;
            
            const leftNums = row.filter(t => t.x > 3.5 && t.x < 18.5 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
            const rightNums = row.filter(t => t.x > 19 && t.x < 35 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
            
            console.log(`Y=${y} ${c1}/${c2}: left=${leftNums.length}, right=${rightNums.length}`);
            
            if (leftNums.length >= 22) {
                for (let i = 0; i < 11; i++) {
                    db.pear[left][c1][clarities[i]] = leftNums[i * 2];
                    db.pear[left][c2][clarities[i]] = leftNums[i * 2 + 1];
                }
                console.log(`  -> ${left} ${c1}/${c2} updated`);
            }
            if (rightNums.length >= 22) {
                for (let i = 0; i < 11; i++) {
                    db.pear[right][c1][clarities[i]] = rightNums[i * 2];
                    db.pear[right][c2][clarities[i]] = rightNums[i * 2 + 1];
                }
                console.log(`  -> ${right} ${c1}/${c2} updated`);
            }
        }
    });
    
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    
    console.log('\n=== Done ===');
});

pdfParser.loadPDF(path);
