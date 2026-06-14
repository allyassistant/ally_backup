const PDFParser = require('pdf2json');
const pdfParser = new PDFParser();

const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function cleanText(text) {
    return text.replace(/[,)]996[\d,]*/g, '').trim();
}

// Parse concatenated number string
function parseValues(str) {
    const cleaned = str.replace(/\D/g, '');
    // Try pattern: 4,3,3,3,3,3,3,3,3,2,2
    const values = [];
    let pos = 0;
    const pattern = [4,3,3,3,3,3,3,3,3,2,2];
    for (const len of pattern) {
        if (pos >= cleaned.length) break;
        const num = parseInt(cleaned.substring(pos, pos + len));
        if (!isNaN(num)) values.push(num);
        pos += len;
    }
    return values;
}

pdfParser.on('pdfParser_dataReady', pdfData => {
    pdfData.Pages.forEach(page => {
        const texts = [];
        page.Texts?.forEach(text => {
            const txt = cleanText(safeDecode(text.R?.[0]?.T || ''));
            if (txt) texts.push({ x: text.x, y: text.y, text: txt });
        });
        
        // Find 4.00-4.99 header
        const header = texts.find(t => t.text.match(/4\.00.*4\.99.*CT/i) && t.text.includes('RAPAPORT'));
        if (!header) return;
        
        console.log('Found 4.00-4.99 table at X=' + header.x.toFixed(1) + ' Y=' + header.y.toFixed(1));
        
        // Find F color
        const minX = header.x - 3;
        const maxX = header.x + 14;
        const fColor = texts.find(t => t.text === 'F' && t.x >= minX && t.x <= maxX && t.y > header.y && t.y < header.y + 15);
        
        if (!fColor) {
            console.log('F color not found');
            return;
        }
        
        console.log('Found F at X=' + fColor.x.toFixed(1) + ' Y=' + fColor.y.toFixed(1));
        
        // Find number string
        const numText = texts.find(t => 
            t.text.match(/^\d{20,}$/) &&
            Math.abs(t.y - fColor.y) < 1.5 &&
            t.x > fColor.x && t.x <= fColor.x + 14
        );
        
        if (!numText) {
            console.log('Number text not found');
            return;
        }
        
        console.log('Number text: ' + numText.text.substring(0, 35));
        
        const values = parseValues(numText.text);
        console.log('\\nParsed values:');
        clarities.forEach((c, i) => {
            console.log('  ' + c + ': ' + values[i]);
        });
        
        // Calculate price for 4.45 F SI1 -47%
        const si1Value = values[5]; // SI1 is index 5
        const carat = 4.45;
        const discount = 0.47;
        
        const listPricePerCt = si1Value * 100;
        const totalListPrice = listPricePerCt * carat;
        const finalPrice = totalListPrice * (1 - discount);
        
        console.log('\\n=== PRICE CALCULATION ===');
        console.log('Stone: 4.45 F SI1');
        console.log('Rapaport value: ' + si1Value);
        console.log('List Price/ct: $' + listPricePerCt.toLocaleString());
        console.log('Total List Price: $' + totalListPrice.toLocaleString());
        console.log('Discount: -47%');
        console.log('FINAL PRICE: USD $' + finalPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
    });
});

pdfParser.loadPDF('/Users/ally/Downloads/Round Price List 01.30.2026.pdf');
