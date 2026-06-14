const PDFParser = require('pdf2json');
const fs = require('fs');

const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function cleanText(text) {
    return text.replace(/[,)]996[\d,]*/g, '').trim();
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
                    
                    // Find colors for this table - look for colors within X range and below header
                    const minX = header.x - 2;
                    const maxX = header.x + 16; // Each table is about 16-18 units wide
                    const minY = header.y + 2;
                    const maxY = header.y + 14; // Color rows span about 12-14 units vertically
                    
                    const colorTexts = texts.filter(t => 
                        colors.includes(t.text) && 
                        t.text.length === 1 &&
                        t.x >= minX && t.x <= maxX &&
                        t.y >= minY && t.y <= maxY
                    );
                    
                    colorTexts.forEach(colorText => {
                        const color = colorText.text;
                        const colorY = colorText.y;
                        
                        // Find all numbers on the same row (within 0.5 Y units)
                        const values = [];
                        texts.forEach(t => {
                            if (t.text.match(/^\d{2,4}$/) && Math.abs(t.y - colorY) < 0.5 && t.x > colorText.x) {
                                values.push({x: t.x, val: parseInt(t.text)});
                            }
                        });
                        
                        // Sort by X position and take first 11
                        values.sort((a, b) => a.x - b.x);
                        const nums = values.slice(0, 11).map(v => v.val);
                        
                        if (nums.length >= 11) {
                            tableData[color] = {
                                'IF': nums[0], 'VVS1': nums[1], 'VVS2': nums[2],
                                'VS1': nums[3], 'VS2': nums[4], 'SI1': nums[5],
                                'SI2': nums[6], 'SI3': nums[7], 'I1': nums[8],
                                'I2': nums[9], 'I3': nums[10]
                            };
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
            console.log('  D VVS1:', data['D']['VVS1']);
        }
    });
    
    console.log('\n--- Pear Tables ---');
    Object.entries(pearData).forEach(([name, data]) => {
        console.log(`${name}: ${Object.keys(data).length} colors`);
        if (data['D']) {
            console.log('  D VVS1:', data['D']['VVS1']);
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
