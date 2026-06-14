const PDFParser = require('pdf2json');
const fs = require('fs');

const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function cleanText(text) {
    return text.replace(/[,)]996[\d,]*/g, '').trim();
}

// Parse concatenated number string (for Round PDF)
function tryPattern(str, pattern) {
    const values = [];
    let pos = 0;
    for (const len of pattern) {
        if (pos >= str.length) break;
        const num = parseInt(str.substring(pos, pos + len));
        if (!isNaN(num)) values.push(num);
        pos += len;
    }
    return values;
}

function scoreValues(values) {
    if (values.length < 11) return -1000;
    let score = 0;
    for (let i = 0; i < values.length - 1; i++) {
        if (values[i] >= values[i+1]) score += 10;
    }
    values.forEach(v => {
        if (v >= 10 && v <= 2000) score += 5;
    });
    return score;
}

function parseConcatenatedValues(str) {
    const cleaned = str.replace(/\D/g, '');
    const attempts = [];
    attempts.push(tryPattern(cleaned, [4,3,3,3,3,3,3,3,3,2,2]));
    attempts.push(tryPattern(cleaned, [3,3,3,3,3,3,3,3,3,2,2]));
    attempts.push(tryPattern(cleaned, [3,3,3,3,3,3,3,3,3,3,3]));
    const scored = attempts.map(values => ({values, score: scoreValues(values)}));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].values;
}

// Extract Round PDF (concatenated numbers)
async function extractRound(pdfFile) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        const allTables = {};
        
        pdfParser.on('pdfParser_dataReady', pdfData => {
            pdfData.Pages.forEach(page => {
                const texts = [];
                page.Texts?.forEach(text => {
                    const txt = cleanText(safeDecode(text.R?.[0]?.T || ''));
                    if (txt) texts.push({ x: text.x, y: text.y, text: txt });
                });
                
                const tableHeaders = [];
                texts.forEach(t => {
                    const match = t.text.match(/\(\s*(\d*\.?\d+)\s*[-.]\s*(\d*\.?\d+)\s*CT/i);
                    if (match && t.text.toUpperCase().includes('RAPAPORT')) {
                        tableHeaders.push({ name: `${match[1]}-${match[2]}`, x: t.x, y: t.y });
                    }
                });
                
                tableHeaders.forEach(header => {
                    const tableData = {};
                    const minX = header.x - 3;
                    const maxX = header.x + 14;
                    
                    colors.forEach(color => {
                        const colorText = texts.find(t => 
                            t.text === color && t.x >= minX && t.x <= maxX &&
                            t.y > header.y && t.y < header.y + 15
                        );
                        
                        if (colorText) {
                            const numberText = texts.find(t => 
                                t.text.match(/^\d{20,}$/) &&
                                Math.abs(t.y - colorText.y) < 1.5 &&
                                t.x > colorText.x && t.x <= colorText.x + 14
                            );
                            
                            if (numberText) {
                                const values = parseConcatenatedValues(numberText.text);
                                if (values.length >= 11) {
                                    tableData[color] = {};
                                    clarities.forEach((c, i) => tableData[color][c] = values[i]);
                                }
                            }
                        }
                    });
                    
                    if (Object.keys(tableData).length > 0) {
                        allTables[header.name] = tableData;
                    }
                });
            });
            resolve(allTables);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfFile);
    });
}

// Extract Pear PDF (individual numbers)
async function extractPear(pdfFile) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        const allTables = {};
        
        pdfParser.on('pdfParser_dataReady', pdfData => {
            pdfData.Pages.forEach(page => {
                const texts = [];
                page.Texts?.forEach(text => {
                    const txt = cleanText(safeDecode(text.R?.[0]?.T || ''));
                    if (txt) texts.push({ x: text.x, y: text.y, text: txt });
                });
                
                const tableHeaders = [];
                texts.forEach(t => {
                    const match = t.text.match(/\(\s*(\d*\.?\d+)\s*[-.]\s*(\d*\.?\d+)\s*CT/i);
                    if (match && t.text.toUpperCase().includes('RAPAPORT')) {
                        tableHeaders.push({ name: `${match[1]}-${match[2]}`, x: t.x, y: t.y });
                    }
                });
                
                tableHeaders.forEach(header => {
                    const tableData = {};
                    const minX = header.x - 3;
                    const maxX = header.x + 14;
                    
                    colors.forEach(color => {
                        const colorText = texts.find(t => 
                            t.text === color && t.x >= minX && t.x <= maxX &&
                            t.y > header.y && t.y < header.y + 15
                        );
                        
                        if (colorText) {
                            // Find individual numbers on the same row
                            const numbers = texts.filter(t => 
                                t.text.match(/^\d{2,4}$/) &&
                                Math.abs(t.y - colorText.y) < 0.8 &&
                                t.x > colorText.x && t.x < colorText.x + 16
                            ).sort((a, b) => a.x - b.x);
                            
                            if (numbers.length >= 11) {
                                const values = numbers.slice(0, 11).map(n => parseInt(n.text));
                                tableData[color] = {};
                                clarities.forEach((c, i) => tableData[color][c] = values[i]);
                            }
                        }
                    });
                    
                    if (Object.keys(tableData).length > 0) {
                        allTables[header.name] = tableData;
                    }
                });
            });
            resolve(allTables);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfFile);
    });
}

async function main() {
    console.log('Extracting Round prices...');
    const roundData = await extractRound('/Users/ally/Downloads/Round Price List 01.30.2026.pdf');
    
    console.log('Extracting Pear prices...');
    const pearData = await extractPear('/Users/ally/Downloads/Pear Price List 01.30.2026.pdf');
    
    console.log('\n--- Round Tables ---');
    Object.entries(roundData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
    });
    
    console.log('\n--- Pear Tables ---');
    Object.entries(pearData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
    });
    
    const db = { date: '01/30/26', round: roundData, pear: pearData };
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    console.log('\n✅ Saved to memory/rapaport_db.json');
    
    if (roundData['5.00-5.99']?.['D']) {
        console.log('\n--- Round 5.00-5.99 D ---');
        console.log(roundData['5.00-5.99']['D']);
    }
    if (pearData['5.00-5.99']?.['D']) {
        console.log('\n--- Pear 5.00-5.99 D ---');
        console.log(pearData['5.00-5.99']['D']);
    }
}

main().catch(console.error);
