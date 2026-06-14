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

// Split concatenated numbers like "1000855770690580..." into [1000, 855, 770, ...]
function splitNumbers(text) {
    // Rapaport values are typically 2-4 digits
    // Try splitting into groups of 3 or 4 digits
    const cleaned = text.replace(/\D/g, '');
    const results = [];
    
    // Try groups of 4
    for (let i = 0; i < cleaned.length; i += 4) {
        const num = parseInt(cleaned.substring(i, i + 4));
        if (!isNaN(num) && num > 0) {
            results.push(num);
        }
    }
    
    // If we got reasonable count, use it
    if (results.length >= 10) {
        return results.slice(0, 11); // We need exactly 11 values
    }
    
    // Otherwise try groups of 3
    const results3 = [];
    for (let i = 0; i < cleaned.length; i += 3) {
        const num = parseInt(cleaned.substring(i, i + 3));
        if (!isNaN(num) && num > 0) {
            results3.push(num);
        }
    }
    
    if (results3.length >= 10) {
        return results3.slice(0, 11);
    }
    
    return results.length > results3.length ? results.slice(0, 11) : results3.slice(0, 11);
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
                    
                    // Find colors for this table
                    const minX = header.x - 2;
                    const maxX = header.x + 16;
                    
                    colors.forEach(color => {
                        // Find this color text
                        const colorText = texts.find(t => 
                            t.text === color &&
                            t.x >= minX && t.x <= maxX &&
                            t.y > header.y && t.y < header.y + 15
                        );
                        
                        if (colorText) {
                            // Find the long number string on the same row
                            const numberText = texts.find(t => 
                                t.text.match(/^\d{20,50}$/) && // Long concatenated number
                                Math.abs(t.y - colorText.y) < 1 &&
                                t.x > colorText.x
                            );
                            
                            if (numberText) {
                                const values = splitNumbers(numberText.text);
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
        if (data['D']) {
            console.log('  D:', data['D']);
        }
    });
    
    console.log('\n--- Pear Tables ---');
    Object.entries(pearData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
        if (data['D']) {
            console.log('  D:', data['D']);
        }
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
