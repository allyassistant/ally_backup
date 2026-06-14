const PDFParser = require('pdf2json');
const fs = require('fs');

const pdfFile = '/Users/ally/Downloads/Round Price List 01.30.2026.pdf';
const pdfParser = new PDFParser();

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function cleanText(text) {
    return text.replace(/[,)]996[\d,]*/g, '').trim();
}

pdfParser.on('pdfParser_dataReady', pdfData => {
    const allData = {};
    
    pdfData.Pages.forEach((page, pageIdx) => {
        console.log(`\n========== PAGE ${pageIdx + 1} ==========`);
        
        const texts = [];
        page.Texts?.forEach(text => {
            texts.push({
                x: text.x,
                y: text.y,
                text: cleanText(safeDecode(text.R?.[0]?.T || ''))
            });
        });
        
        // Group by rows
        const rows = {};
        texts.forEach(t => {
            const yKey = Math.round(t.y);
            if (!rows[yKey]) rows[yKey] = [];
            rows[yKey].push(t);
        });
        
        // Find tables and their X boundaries
        const tables = [];
        const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
        
        sortedY.forEach(y => {
            const rowTexts = rows[y].sort((a, b) => a.x - b.x);
            const line = rowTexts.map(t => t.text).join(' ');
            
            // Look for table header
            const match = line.match(/RAPAPORT.*\(\s*(\d+\.\d+).?\s*(\d+\.\d+)\s*CT/i);
            if (match) {
                const tableName = `${match[1]}-${match[2]}`;
                // Find leftmost text that looks like header
                const headerText = rowTexts.find(t => t.text.includes('RAPAPORT'));
                const xStart = headerText ? headerText.x - 5 : 0;
                tables.push({
                    name: tableName,
                    xStart: xStart,
                    xEnd: xStart + 100,
                    data: {}
                });
                console.log(`Found table: ${tableName} at X=${xStart.toFixed(1)}`);
            }
        });
        
        // Now extract data rows
        sortedY.forEach(y => {
            const rowTexts = rows[y].sort((a, b) => a.x - b.x);
            
            rowTexts.forEach(t => {
                // Check if this text belongs to a table
                tables.forEach(table => {
                    if (t.x >= table.xStart - 10 && t.x <= table.xEnd) {
                        const text = t.text.trim();
                        
                        // Check if it's a color row
                        if (text.match(/^[D-M]\s/)) {
                            const color = text.charAt(0);
                            const nums = text.match(/\d+/g);
                            if (nums && nums.length >= 11) {
                                table.data[color] = {
                                    'IF': parseInt(nums[0]),
                                    'VVS1': parseInt(nums[1]),
                                    'VVS2': parseInt(nums[2]),
                                    'VS1': parseInt(nums[3]),
                                    'VS2': parseInt(nums[4]),
                                    'SI1': parseInt(nums[5]),
                                    'SI2': parseInt(nums[6]),
                                    'SI3': parseInt(nums[7]),
                                    'I1': parseInt(nums[8]),
                                    'I2': parseInt(nums[9]),
                                    'I3': parseInt(nums[10])
                                };
                            }
                        }
                    }
                });
            });
        });
        
        // Merge into allData
        tables.forEach(table => {
            if (Object.keys(table.data).length > 0) {
                allData[table.name] = table.data;
                console.log(`  ${table.name}: ${Object.keys(table.data).length} colors`);
            }
        });
    });
    
    console.log('\n--- Final Summary ---');
    console.log('Tables extracted:', Object.keys(allData));
    Object.entries(allData).forEach(([name, data]) => {
        console.log(`  ${name}: ${Object.keys(data).length} colors`);
    });
    
    // Save
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/round_extracted.json', JSON.stringify(allData, null, 2));
});

pdfParser.loadPDF(pdfFile);
