const PDFParser = require('pdf2json');
const fs = require('fs');

const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

async function extractFromPDF(pdfFile, shapeName) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        const tables = {};
        
        pdfParser.on('pdfParser_dataReady', pdfData => {
            pdfData.Pages.forEach((page, pageIdx) => {
                const texts = [];
                
                page.Texts?.forEach(text => {
                    const txt = safeDecode(text.R?.[0]?.T || '').trim();
                    if (txt) {
                        texts.push({
                            x: Math.round(text.x * 10) / 10,
                            y: Math.round(text.y * 10) / 10,
                            text: txt
                        });
                    }
                });
                
                // Sort by Y then X
                texts.sort((a, b) => {
                    if (Math.abs(a.y - b.y) < 2) return a.x - b.x;
                    return a.y - b.y;
                });
                
                // Group by rows
                const rows = {};
                texts.forEach(t => {
                    const yKey = Math.round(t.y / 2) * 2; // Round to nearest 2
                    if (!rows[yKey]) rows[yKey] = [];
                    rows[yKey].push(t);
                });
                
                // Find table headers
                const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
                let currentTable = null;
                let clarityHeaderY = null;
                let tableXStart = null;
                let tableXEnd = null;
                
                sortedY.forEach(y => {
                    const rowTexts = rows[y].sort((a, b) => a.x - b.x);
                    const line = rowTexts.map(t => t.text).join(' ');
                    
                    // Detect table header
                    const headerMatch = line.match(/RAPAPORT.*\(\s*(\d+\.\d+).?\s*(\d+\.\d+)\s*CT/i);
                    if (headerMatch) {
                        const tableName = `${headerMatch[1]}-${headerMatch[2]}`;
                        currentTable = {
                            name: tableName,
                            data: {}
                        };
                        tables[tableName] = currentTable.data;
                        
                        // Find table boundaries
                        const headerText = rowTexts.find(t => t.text.includes('RAPAPORT'));
                        tableXStart = headerText ? headerText.x - 10 : 0;
                        tableXEnd = tableXStart + 90;
                        
                        // Look for clarity headers in next few rows
                        clarityHeaderY = y;
                        return;
                    }
                    
                    // Detect clarity header row (IF VVS1 VVS2 etc)
                    if (currentTable && Math.abs(y - clarityHeaderY) < 15 && line.includes('IF') && line.includes('VVS')) {
                        // This is the header row, figure out column positions
                        currentTable.colPositions = {};
                        rowTexts.forEach(t => {
                            const clarityIdx = clarities.indexOf(t.text.trim());
                            if (clarityIdx >= 0) {
                                currentTable.colPositions[clarities[clarityIdx]] = t.x;
                            }
                        });
                        return;
                    }
                    
                    // Extract color data
                    if (currentTable && currentTable.colPositions) {
                        const colorMatch = rowTexts.find(t => colors.includes(t.text.trim()));
                        if (colorMatch) {
                            const color = colorMatch.text.trim();
                            const colorX = colorMatch.x;
                            
                            // Find values for this color
                            const values = {};
                            rowTexts.forEach(t => {
                                if (t.text.match(/^\d+$/) && t.x > colorX) {
                                    // Find which clarity column this belongs to
                                    let closestClarity = null;
                                    let minDist = Infinity;
                                    
                                    Object.entries(currentTable.colPositions).forEach(([clarity, x]) => {
                                        const dist = Math.abs(t.x - x);
                                        if (dist < minDist && dist < 15) {
                                            minDist = dist;
                                            closestClarity = clarity;
                                        }
                                    });
                                    
                                    if (closestClarity && !values[closestClarity]) {
                                        values[closestClarity] = parseInt(t.text);
                                    }
                                }
                            });
                            
                            if (Object.keys(values).length >= 5) {
                                currentTable.data[color] = values;
                            }
                        }
                    }
                });
            });
            
            resolve(tables);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfFile);
    });
}

// Simple extraction - collect all text and parse
async function extractSimple(pdfFile) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        const result = {};
        
        pdfParser.on('pdfParser_dataReady', pdfData => {
            pdfData.Pages.forEach(page => {
                const texts = [];
                page.Texts?.forEach(text => {
                    texts.push({
                        x: text.x,
                        y: text.y,
                        text: safeDecode(text.R?.[0]?.T || '').trim()
                    });
                });
                
                // Sort by Y then X  
                texts.sort((a, b) => a.y === b.y ? a.x - b.x : a.y - b.y);
                
                // Find all text elements and their positions
                let currentTable = null;
                
                for (let i = 0; i < texts.length; i++) {
                    const t = texts[i];
                    
                    // Check for table header
                    if (t.text.includes('RAPAPORT') && t.text.includes('CT')) {
                        const match = t.text.match(/\(\s*(\d+\.\d+).?\s*(\d+\.\d+)\s*CT/i);
                        if (match) {
                            currentTable = {
                                name: `${match[1]}-${match[2]}`,
                                x: t.x,
                                data: {}
                            };
                            result[currentTable.name] = currentTable.data;
                        }
                        continue;
                    }
                    
                    // Check for color letter followed by numbers
                    if (currentTable && colors.includes(t.text) && t.text.length === 1) {
                        const color = t.text;
                        const colorX = t.x;
                        const colorY = t.y;
                        
                        // Collect numbers in this row
                        const values = [];
                        for (let j = i + 1; j < texts.length && texts[j].y === colorY && values.length < 15; j++) {
                            if (texts[j].text.match(/^\d{2,4}$/)) {
                                values.push(parseInt(texts[j].text));
                            }
                        }
                        
                        if (values.length >= 11) {
                            currentTable.data[color] = {
                                'IF': values[0], 'VVS1': values[1], 'VVS2': values[2],
                                'VS1': values[3], 'VS2': values[4], 'SI1': values[5],
                                'SI2': values[6], 'SI3': values[7], 'I1': values[8],
                                'I2': values[9], 'I3': values[10]
                            };
                        }
                    }
                }
            });
            
            resolve(result);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfFile);
    });
}

async function main() {
    console.log('Extracting Round prices (simple method)...');
    const roundData = await extractSimple('/Users/ally/Downloads/Round Price List 01.30.2026.pdf');
    
    console.log('\nExtracting Pear prices (simple method)...');
    const pearData = await extractSimple('/Users/ally/Downloads/Pear Price List 01.30.2026.pdf');
    
    console.log('\n--- Round Tables ---');
    Object.entries(roundData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
    });
    
    console.log('\n--- Pear Tables ---');
    Object.entries(pearData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
    });
    
    // Build database
    const db = {
        date: '01/30/26',
        round: roundData,
        pear: pearData
    };
    
    // Save
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    console.log('\n✅ Saved to memory/rapaport_db.json');
}

main().catch(console.error);
