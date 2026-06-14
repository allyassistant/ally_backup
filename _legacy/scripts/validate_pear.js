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
    
    // Define expected table structure based on PDF layout
    // Each entry: { y, colors: ['color1', 'color2', ...], leftTable, rightTable }
    const tableStructure = [
        // .90-.99 / 1.00-1.49 (Y ~8-17)
        { y: 9.1, colors: ['D'], left: '.90-.99', right: '1.00-1.49' },
        { y: 10.1, colors: ['E'], left: '.90-.99', right: '1.00-1.49' },
        { y: 11.0, colors: ['G', 'F'], left: '.90-.99', right: '1.00-1.49' },  // G/F side by side
        { y: 12.0, colors: ['H'], left: '.90-.99', right: '1.00-1.49' },
        { y: 13.0, colors: ['I'], left: '.90-.99', right: '1.00-1.49' },
        { y: 14.0, colors: ['K', 'J'], left: '.90-.99', right: '1.00-1.49' },  // K/J side by side
        { y: 15.0, colors: ['L'], left: '.90-.99', right: '1.00-1.49' },
        { y: 15.7, colors: ['M'], left: '.90-.99', right: '1.00-1.49' },
        
        // 1.50-1.99 / 2.00-2.99 (Y ~17-28)
        { y: 19.0, colors: ['D', 'E'], left: '1.50-1.99', right: '2.00-2.99' },  // D/E side by side
        { y: 20.0, colors: ['F'], left: '1.50-1.99', right: '2.00-2.99' },
        { y: 21.0, colors: ['G', 'H'], left: '1.50-1.99', right: '2.00-2.99' },  // G/H side by side
        { y: 22.0, colors: ['I'], left: '1.50-1.99', right: '2.00-2.99' },
        { y: 23.0, colors: ['J'], left: '1.50-1.99', right: '2.00-2.99' },
        { y: 24.0, colors: ['K', 'L'], left: '1.50-1.99', right: '2.00-2.99' },  // K/L side by side
        { y: 25.0, colors: ['M'], left: '1.50-1.99', right: '2.00-2.99' },
        
        // 3.00-3.99 / 4.00-4.99 (Y ~28-37)
        { y: 30.0, colors: ['D', 'E'], left: '3.00-3.99', right: '4.00-4.99' },  // D/E side by side
        { y: 31.0, colors: ['F'], left: '3.00-3.99', right: '4.00-4.99' },
        { y: 32.0, colors: ['G', 'H'], left: '3.00-3.99', right: '4.00-4.99' },  // G/H side by side
        { y: 33.0, colors: ['I'], left: '3.00-3.99', right: '4.00-4.99' },
        { y: 35.0, colors: ['J', 'K'], left: '3.00-3.99', right: '4.00-4.99' },  // J/K side by side
        { y: 36.0, colors: ['L', 'M'], left: '3.00-3.99', right: '4.00-4.99' },  // L/M side by side
        
        // 5.00-5.99 / 10.00-10.99 (Y ~37-50)
        { y: 38.8, colors: ['D'], left: '5.00-5.99', right: '10.00-10.99' },
        { y: 39.5, colors: ['E'], left: '5.00-5.99', right: '10.00-10.99' },
        { y: 40.0, colors: ['F'], left: '5.00-5.99', right: '10.00-10.99' },
        { y: 41.0, colors: ['G'], left: '5.00-5.99', right: '10.00-10.99' },
        { y: 42.5, colors: ['J'], left: '5.00-5.99', right: '10.00-10.99' },
        { y: 43.7, colors: ['K'], left: '5.00-5.99', right: '10.00-10.99' },
        { y: 44.5, colors: ['M'], left: '5.00-5.99', right: '10.00-10.99' },
    ];
    
    console.log('=== Validating Database Against PDF ===\n');
    
    let hasErrors = false;
    
    tableStructure.forEach(({ y, colors, left, right }) => {
        const row = texts.filter(t => Math.abs(t.y - y) < 0.5).sort((a, b) => a.x - b.x);
        
        // Extract numeric values
        const leftNums = row.filter(t => t.x > 3.5 && t.x < 18.5 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
        const rightNums = row.filter(t => t.x > 19 && t.x < 35 && /^\d+$/.test(t.text)).map(t => parseInt(t.text));
        
        if (colors.length === 1) {
            const color = colors[0];
            
            // Check left table
            if (leftNums.length >= 11 && db.pear[left] && db.pear[left][color]) {
                for (let i = 0; i < 11; i++) {
                    const dbVal = db.pear[left][color][clarities[i]];
                    const pdfVal = leftNums[i];
                    if (dbVal !== pdfVal) {
                        console.log(`MISMATCH: ${left} ${color} ${clarities[i]}: DB=${dbVal}, PDF=${pdfVal}`);
                        db.pear[left][color][clarities[i]] = pdfVal;
                        hasErrors = true;
                    }
                }
            }
            
            // Check right table
            if (rightNums.length >= 11 && db.pear[right] && db.pear[right][color]) {
                for (let i = 0; i < 11; i++) {
                    const dbVal = db.pear[right][color][clarities[i]];
                    const pdfVal = rightNums[i];
                    if (dbVal !== pdfVal) {
                        console.log(`MISMATCH: ${right} ${color} ${clarities[i]}: DB=${dbVal}, PDF=${pdfVal}`);
                        db.pear[right][color][clarities[i]] = pdfVal;
                        hasErrors = true;
                    }
                }
            }
        } else if (colors.length === 2) {
            // Side by side colors - determine order by X position
            const colorElements = row.filter(t => colors.includes(t.text) && t.x < 5);
            const sortedColors = colorElements.sort((a, b) => a.x - b.x).map(t => t.text);
            const [c1, c2] = sortedColors.length === 2 ? sortedColors : colors;
            
            if (leftNums.length >= 22) {
                // Interleaved: c1 gets even indices (0,2,4...), c2 gets odd (1,3,5...)
                for (let i = 0; i < 11; i++) {
                    const c1PdfVal = leftNums[i * 2];
                    const c2PdfVal = leftNums[i * 2 + 1];
                    
                    if (db.pear[left] && db.pear[left][c1]) {
                        const dbVal = db.pear[left][c1][clarities[i]];
                        if (dbVal !== c1PdfVal) {
                            console.log(`MISMATCH: ${left} ${c1} ${clarities[i]}: DB=${dbVal}, PDF=${c1PdfVal}`);
                            db.pear[left][c1][clarities[i]] = c1PdfVal;
                            hasErrors = true;
                        }
                    }
                    
                    if (db.pear[left] && db.pear[left][c2]) {
                        const dbVal = db.pear[left][c2][clarities[i]];
                        if (dbVal !== c2PdfVal) {
                            console.log(`MISMATCH: ${left} ${c2} ${clarities[i]}: DB=${dbVal}, PDF=${c2PdfVal}`);
                            db.pear[left][c2][clarities[i]] = c2PdfVal;
                            hasErrors = true;
                        }
                    }
                }
            }
            
            if (rightNums.length >= 22) {
                for (let i = 0; i < 11; i++) {
                    const c1PdfVal = rightNums[i * 2];
                    const c2PdfVal = rightNums[i * 2 + 1];
                    
                    if (db.pear[right] && db.pear[right][c1]) {
                        const dbVal = db.pear[right][c1][clarities[i]];
                        if (dbVal !== c1PdfVal) {
                            console.log(`MISMATCH: ${right} ${c1} ${clarities[i]}: DB=${dbVal}, PDF=${c1PdfVal}`);
                            db.pear[right][c1][clarities[i]] = c1PdfVal;
                            hasErrors = true;
                        }
                    }
                    
                    if (db.pear[right] && db.pear[right][c2]) {
                        const dbVal = db.pear[right][c2][clarities[i]];
                        if (dbVal !== c2PdfVal) {
                            console.log(`MISMATCH: ${right} ${c2} ${clarities[i]}: DB=${dbVal}, PDF=${c2PdfVal}`);
                            db.pear[right][c2][clarities[i]] = c2PdfVal;
                            hasErrors = true;
                        }
                    }
                }
            }
        }
    });
    
    // Save corrected database
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    
    if (hasErrors) {
        console.log('\n=== Corrections Applied ===');
    } else {
        console.log('\n=== No Errors Found - Database Matches PDF ===');
    }
    
    // Also check for missing entries
    console.log('\n=== Checking for Missing Entries ===');
    tableStructure.forEach(({ y, colors, left, right }) => {
        colors.forEach(color => {
            if (!db.pear[left] || !db.pear[left][color]) {
                console.log(`MISSING: ${left} ${color}`);
            }
            if (!db.pear[right] || !db.pear[right][color]) {
                console.log(`MISSING: ${right} ${color}`);
            }
        });
    });
});

pdfParser.loadPDF(path);
