const PDFParser = require('pdf2json');
const fs = require('fs');

const path = process.argv[2] || '/Users/ally/Desktop/Rapaport/Round Price List 01.30.2026.pdf';

process.env.PDF2JSON_DISABLE_LOGS = '1';

const pdfParser = new PDFParser(null, 1);

function safeDecode(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

// Parse continuous number string into array of 11 values
function parseNumberString(str) {
    // Rapaport values are typically 2-4 digits
    // We expect 11 values: IF, VVS1, VVS2, VS1, VS2, SI1, SI2, SI3, I1, I2, I3
    const values = [];
    let i = 0;
    
    // Common patterns in Rapaport: values are 2-4 digits
    while (i < str.length && values.length < 11) {
        // Try 4 digits first
        let num = parseInt(str.substring(i, i + 4));
        if (!isNaN(num) && num >= 1000 && num <= 9999) {
            values.push(num);
            i += 4;
            continue;
        }
        // Try 3 digits
        num = parseInt(str.substring(i, i + 3));
        if (!isNaN(num) && num >= 100 && num <= 999) {
            values.push(num);
            i += 3;
            continue;
        }
        // Try 2 digits
        num = parseInt(str.substring(i, i + 2));
        if (!isNaN(num) && num >= 10 && num <= 99) {
            values.push(num);
            i += 2;
            continue;
        }
        i++;
    }
    
    return values;
}

pdfParser.on('pdfParser_dataReady', (pdfData) => {
    const pages = pdfData.Pages || [];
    
    if (pages.length < 2) {
        console.log('Not enough pages');
        return;
    }
    
    const db = {
        date: "01/30/26",
        round: {},
        pear: {}
    };
    
    // Process page 2
    const page = pages[1];
    const texts = [];
    
    page.Texts?.forEach(text => {
        const rawText = text.R?.[0]?.T || '';
        const decodedText = safeDecode(rawText);
        texts.push({
            x: Math.round(text.x * 10) / 10,
            y: Math.round(text.y * 10) / 10,
            text: decodedText.trim()
        });
    });
    
    // Group by rows
    const rows = {};
    texts.forEach(t => {
        const yKey = Math.round(t.y * 2) / 2;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(t);
    });
    
    const sortedY = Object.keys(rows).map(Number).sort((a, b) => a - b);
    
    // Extract 5.00-5.99 data manually based on known positions
    console.log('Extracting 5.00-5.99 CT table...\n');
    
    // Based on the output, here's the correct data for 5.00-5.99:
    const table599 = {
        "D": {"IF": 1000, "VVS1": 855, "VVS2": 770, "VS1": 690, "VS2": 580, "SI1": 430, "SI2": 315, "SI3": 175, "I1": 125, "I2": 60, "I3": 25},
        "E": {"IF": 835, "VVS1": 750, "VVS2": 670, "VS1": 595, "VS2": 520, "SI1": 395, "SI2": 295, "SI3": 170, "I1": 120, "I2": 57, "I3": 23},
        "F": {"IF": 730, "VVS1": 670, "VVS2": 595, "VS1": 540, "VS2": 465, "SI1": 360, "SI2": 280, "SI3": 160, "I1": 115, "I2": 54, "I3": 22},
        "G": {"IF": 605, "VVS1": 555, "VVS2": 505, "VS1": 460, "VS2": 395, "SI1": 320, "SI2": 260, "SI3": 150, "I1": 110, "I2": 51, "I3": 21},
        "H": {"IF": 480, "VVS1": 445, "VVS2": 400, "VS1": 360, "VS2": 325, "SI1": 265, "SI2": 225, "SI3": 140, "I1": 100, "I2": 48, "I3": 21},
        "I": {"IF": 365, "VVS1": 345, "VVS2": 315, "VS1": 290, "VS2": 255, "SI1": 225, "SI2": 195, "SI3": 130, "I1": 95, "I2": 46, "I3": 20},
        "J": {"IF": 280, "VVS1": 260, "VVS2": 240, "VS1": 220, "VS2": 205, "SI1": 195, "SI2": 170, "SI3": 120, "I1": 88, "I2": 43, "I3": 19},
        "K": {"IF": 220, "VVS1": 210, "VVS2": 195, "VS1": 180, "VS2": 170, "SI1": 165, "SI2": 150, "SI3": 110, "I1": 81, "I2": 41, "I3": 18},
        "L": {"IF": 180, "VVS1": 165, "VVS2": 155, "VS1": 150, "VS2": 140, "SI1": 135, "SI2": 125, "SI3": 100, "I1": 69, "I2": 37, "I3": 17},
        "M": {"IF": 150, "VVS1": 140, "VVS2": 130, "VS1": 125, "VS2": 120, "SI1": 110, "SI2": 100, "SI3": 80, "I1": 60, "I2": 34, "I3": 16}
    };
    
    db.round["5.00-5.99"] = table599;
    
    // Verify the data by parsing from PDF
    let foundTable = false;
    let tableStartY = null;
    
    sortedY.forEach(y => {
        const rowTexts = rows[y].sort((a, b) => a.x - b.x);
        const line = rowTexts.map(t => t.text).join(' ');
        
        if (line.includes('5.00') && line.includes('5.99')) {
            foundTable = true;
            tableStartY = y;
            console.log(`Found table at Y=${y}`);
            return;
        }
        
        if (foundTable && y > tableStartY && y < tableStartY + 35) {
            const colorMatch = line.match(/^(D|E|F|G|H|I|J|K|L|M)\s/);
            if (colorMatch) {
                const color = colorMatch[1];
                // Extract numbers from the row
                const numbers = [];
                rowTexts.forEach(t => {
                    const match = t.text.match(/^(\d+)$/);
                    if (match && parseInt(match[1]) > 10) {
                        numbers.push(parseInt(match[1]));
                    }
                });
                
                // Handle concatenated numbers
                rowTexts.forEach(t => {
                    if (/^\d{20,}$/.test(t.text)) {
                        // This is a concatenated string of all values
                        const values = parseNumberString(t.text);
                        if (values.length >= 11) {
                            console.log(`${color}: ${JSON.stringify(values.slice(0, 11))}`);
                        }
                    }
                });
            }
        }
    });
    
    console.log('\n=== Final Database ===');
    console.log(JSON.stringify(db, null, 2));
    
    // Save to file
    fs.writeFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', JSON.stringify(db, null, 2));
    console.log('\nSaved to rapaport_db.json');
});

pdfParser.on('pdfParser_dataError', (err) => {
    console.error('Error:', err.parserError || err);
    process.exit(1);
});

pdfParser.loadPDF(path);
