const PDFParser = require('pdf2json');
const fs = require('fs');

const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function cleanText(text) {
    return text.replace(/[,)]996[\d,]*/g, '').trim();
}

async function extractRapaport(pdfFile, shapeType) {
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
                
                // Find all table headers and their positions
                const tableHeaders = [];
                texts.forEach(t => {
                    const match = t.text.match(/\(\s*(\d+\.\d+).?\s*(\d+\.\d+)\s*CT/i);
                    if (match && t.text.toUpperCase().includes('RAPAPORT')) {
                        tableHeaders.push({
                            name: `${match[1]}-${match[2]}`,
                            x: t.x,
                            y: t.y
                        });
                    }
                });
                
                // For each table, find its color rows and values
                tableHeaders.forEach(header => {
                    const tableData = {};
                    
                    // Find colors for this table
                    // Table boundaries: X within +/- 15 of header, Y below header
                    const tableTexts = texts.filter(t => 
                        t.x >= header.x - 5 && 
                        t.x <= header.x + 80 && 
                        t.y > header.y && 
                        t.y < header.y + 20
                    );
                    
                    // Group by row (Y position, rounded)
                    const rows = {};
                    tableTexts.forEach(t => {
                        const yKey = Math.round(t.y);
                        if (!rows[yKey]) rows[yKey] = [];
                        rows[yKey].push(t);
                    });
                    
                    // Find color rows and extract values
                    Object.entries(rows).forEach(([y, rowTexts]) => {
                        const sorted = rowTexts.sort((a, b) => a.x - b.x);
                        const colorText = sorted.find(t => colors.includes(t.text) && t.text.length === 1);
                        
                        if (colorText) {
                            const color = colorText.text;
                            const values = [];
                            
                            // Get all numbers to the right of color
                            sorted.forEach(t => {
                                if (t.x > colorText.x && t.text.match(/^\d{2,4}$/)) {
                                    values.push(parseInt(t.text));
                                }
                            });
                            
                            if (values.length >= 11) {
                                tableData[color] = {
                                    'IF': values[0], 'VVS1': values[1], 'VVS2': values[2],
                                    'VS1': values[3], 'VS2': values[4], 'SI1': values[5],
                                    'SI2': values[6], 'SI3': values[7], 'I1': values[8],
                                    'I2': values[9], 'I3': values[10]
                                };
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
    const roundData = await extractRapaport('/Users/ally/Downloads/Round Price List 01.30.2026.pdf', 'round');
    
    console.log('Extracting Pear prices...');
    const pearData = await extractRapaport('/Users/ally/Downloads/Pear Price List 01.30.2026.pdf', 'pear');
    
    console.log('\n--- Round Tables ---');
    Object.entries(roundData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
        if (Object.keys(data).length > 0) {
            console.log('  Sample D VVS1:', data['D']?.['VVS1']);
        }
    });
    
    console.log('\n--- Pear Tables ---');
    Object.entries(pearData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
        if (Object.keys(data).length > 0) {
            console.log('  Sample D VVS1:', data['D']?.['VVS1']);
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
