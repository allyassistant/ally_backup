const PDFParser = require('pdf2json');
const fs = require('fs');

const path = process.argv[2] || '/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf';
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
    
    // Function to extract data for a specific Y with side-by-side colors
    function extractRowAtY(targetY, leftTable, rightTable) {
        const rowTexts = texts.filter(t => Math.abs(t.y - targetY) < 0.5);
        const sorted = rowTexts.sort((a, b) => a.x - b.x);
        
        // Find colors at X < 5
        const colors = sorted.filter(t => t.x < 5 && /^[A-Z]$/.test(t.text));
        
        if (colors.length === 0) return null;
        
        // Get numeric values
        const leftNums = sorted.filter(t => t.x > 3.5 && t.x < 18.5 && /^\d+$/.test(t.text))
            .map(t => parseInt(t.text));
        const rightNums = sorted.filter(t => t.x > 19 && t.x < 35 && /^\d+$/.test(t.text))
            .map(t => parseInt(t.text));
        
        if (colors.length === 1) {
            // Single color
            const color = colors[0].text;
            if (leftNums.length >= 11) {
                const data = {};
                clarities.forEach((c, i) => data[c] = leftNums[i]);
                db.pear[leftTable][color] = data;
                console.log(`${leftTable} ${color}: ${JSON.stringify(data)}`);
            }
            if (rightNums.length >= 11) {
                const data = {};
                clarities.forEach((c, i) => data[c] = rightNums[i]);
                db.pear[rightTable][color] = data;
                console.log(`${rightTable} ${color}: ${JSON.stringify(data)}`);
            }
        } else if (colors.length === 2) {
            // Side-by-side: determine order by X position
            const sortedColors = colors.sort((a, b) => a.x - b.x);
            const [c1, c2] = [sortedColors[0].text, sortedColors[1].text];
            
            if (leftNums.length >= 22) {
                // Interleave: c1 gets indices 0,2,4... c2 gets 1,3,5...
                const c1Data = {}; const c2Data = {};
                for (let i = 0; i < 11; i++) {
                    c1Data[clarities[i]] = leftNums[i * 2];
                    c2Data[clarities[i]] = leftNums[i * 2 + 1];
                }
                db.pear[leftTable][c1] = c1Data;
                db.pear[leftTable][c2] = c2Data;
                console.log(`${leftTable} ${c1}: ${JSON.stringify(c1Data)}`);
                console.log(`${leftTable} ${c2}: ${JSON.stringify(c2Data)}`);
            }
            if (rightNums.length >= 22) {
                const c1Data = {}; const c2Data = {};
                for (let i = 0; i < 11; i++) {
                    c1Data[clarities[i]] = rightNums[i * 2];
                    c2Data[clarities[i]] = rightNums[i * 2 + 1];
                }
                db.pear[rightTable][c1] = c1Data;
                db.pear[rightTable][c2] = c2Data;
                console.log(`${rightTable} ${c1}: ${JSON.stringify(c1Data)}`);
                console.log(`${rightTable} ${c2}: ${JSON.stringify(c2Data)}`);
            }
        }
        
        return colors.map(c => c.text);
    }
    
    console.log('=== Extracting missing colors ===\n');
    
    // 1. F and G at Y=11 (.90-.99, 1.00-1.49)
    console.log('--- Y=11 (F/G) ---');
    extractRowAtY(11, '.90-.99', '1.00-1.49');
    
    // 2. L and M at Y=15.5 (.90-.99, 1.00-1.49)
    console.log('\n--- Y=15.7 (L/M) ---');
    extractRowAtY(15.7, '.90-.99', '1.00-1.49');
    
    // 3. I at Y=22 (1.50-1.99, 2.00-2.99) - check if it's side by side
    console.log('\n--- Y=22 (I) ---');
    extractRowAtY(22, '1.50-1.99', '2.00-2.99');
    
    // 4. H at Y=32 (3.00-3.99, 4.00-4.99)
    console.log('\n--- Y=32 (H) ---');
    extractRowAtY(32, '3.00-3.99', '4.00-4.99');
    
    // 5. D and E at Y=38 (5.00-5.99, 10.00-10.99)
    console.log('\n--- Y=38 (D/E) ---');
    extractRowAtY(38, '5.00-5.99', '10.00-10.99');
    
    // 6. K at Y=42 (5.00-5.99, 10.00-10.99)
    console.log('\n--- Y=42 (K) ---');
    extractRowAtY(42, '5.00-5.99', '10.00-10.99');
    
    // Save
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    
    console.log('\n=== Summary ===');
    Object.entries(db.pear).forEach(([range, data]) => {
        console.log(`${range}: ${Object.keys(data).sort().join(', ')} (${Object.keys(data).length})`);
    });
});

pdfParser.loadPDF(path);
