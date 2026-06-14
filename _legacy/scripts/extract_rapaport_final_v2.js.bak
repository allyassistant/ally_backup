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

// Parse Rapaport values from concatenated string
// Pattern: first value 3-4 digits, most middle values 3 digits, I2/I3 often 2 digits
function parseRapaportValues(str) {
    const cleaned = str.replace(/\D/g, '');
    
    // Try different patterns and pick the one that produces most reasonable values
    const attempts = [];
    
    // Pattern 1: 4,3,3,3,3,3,3,3,3,2,2 (D color typical)
    attempts.push(tryPattern(cleaned, [4,3,3,3,3,3,3,3,3,2,2]));
    
    // Pattern 2: 3,3,3,3,3,3,3,3,3,2,2 (other colors typical)
    attempts.push(tryPattern(cleaned, [3,3,3,3,3,3,3,3,3,2,2]));
    
    // Pattern 3: All 3 digits
    attempts.push(tryPattern(cleaned, [3,3,3,3,3,3,3,3,3,3,3]));
    
    // Pattern 4: 4,3,3,3,3,3,3,3,3,3,2
    attempts.push(tryPattern(cleaned, [4,3,3,3,3,3,3,3,3,3,2]));
    
    // Pattern 5: 4,3,3,3,3,3,3,3,3,3,3
    attempts.push(tryPattern(cleaned, [4,3,3,3,3,3,3,3,3,3,3]));
    
    // Score each attempt and pick the best
    const scored = attempts.map(values => ({
        values,
        score: scoreValues(values)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0].values;
}

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
    // Rapaport values should be decreasing as clarity decreases
    for (let i = 0; i < values.length - 1; i++) {
        if (values[i] >= values[i+1]) score += 10;
    }
    
    // Values should be in reasonable range (10-2000)
    values.forEach(v => {
        if (v >= 10 && v <= 2000) score += 5;
    });
    
    return score;
}

async function extractRapaport(pdfFile) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        const tables = {};
        
        pdfParser.on('pdfParser_dataReady', pdfData => {
            pdfData.Pages.forEach((page, pageIdx) => {
                const texts = [];
                
                page.Texts?.forEach(text => {
                    const txt = cleanText(safeDecode(text.R?.[0]?.T || ''));
                    if (txt) {
                        texts.push({ x: text.x, y: text.y, text: txt });
                    }
                });
                
                // Find all table headers
                const tableHeaders = [];
                texts.forEach(t => {
                    const match = t.text.match(/\(\s*(\d*\.?\d+).?\s*(\d*\.?\d+)\s*CT/i);
                    if (match && t.text.toUpperCase().includes('RAPAPORT')) {
                        tableHeaders.push({
                            name: `${match[1]}-${match[2]}`,
                            x: t.x,
                            y: t.y
                        });
                    }
                });
                
                // For each table, find its color rows
                tableHeaders.forEach(header => {
                    const tableData = {};
                    const minX = header.x - 2;
                    const maxX = header.x + 16;
                    
                    colors.forEach(color => {
                        const colorText = texts.find(t => 
                            t.text === color &&
                            t.x >= minX && t.x <= maxX &&
                            t.y > header.y && t.y < header.y + 15
                        );
                        
                        if (colorText) {
                            // Find number string on same row (within 1.5 Y units)
                            const numberText = texts.find(t => 
                                t.text.match(/^\d{20,}$/) &&
                                Math.abs(t.y - colorText.y) < 1.5 &&
                                t.x > colorText.x &&
                                t.x < colorText.x + 15
                            );
                            
                            if (numberText) {
                                const values = parseRapaportValues(numberText.text);
                                if (values.length >= 11) {
                                    tableData[color] = {};
                                    clarities.forEach((c, i) => {
                                        tableData[color][c] = values[i];
                                    });
                                }
                            }
                        }
                    });
                    
                    if (Object.keys(tableData).length > 0) {
                        tables[header.name] = tableData;
                    }
                });
            });
            
            resolve(tables);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfFile);
    });
}

async function main() {
    console.log('Extracting Round prices...');
    const roundData = await extractRapaport('/Users/ally/Downloads/Round Price List 01.30.2026.pdf');
    
    console.log('Extracting Pear prices...');
    const pearData = await extractRapaport('/Users/ally/Downloads/Pear Price List 01.30.2026.pdf');
    
    console.log('\n--- Round Tables ---');
    Object.entries(roundData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
        if (data['D']) console.log('  D:', data['D']);
        if (data['E']) console.log('  E:', data['E']);
    });
    
    console.log('\n--- Pear Tables ---');
    Object.entries(pearData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
        if (data['D']) console.log('  D:', data['D']);
    });
    
    // Build database
    const db = {
        date: '01/30/26',
        round: roundData,
        pear: pearData
    };
    
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    console.log('\n✅ Saved to memory/rapaport_db.json');
}

main().catch(console.error);
