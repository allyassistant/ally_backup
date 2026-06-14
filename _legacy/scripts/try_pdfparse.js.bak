const pdfParse = require('pdf-parse');
const fs = require('fs');

const pdfFile = '/Users/ally/Downloads/Round Price List 01.30.2026.pdf';

async function extractFromPDF() {
    try {
        const dataBuffer = fs.readFileSync(pdfFile);
        const data = await pdfParse(dataBuffer);
        
        console.log('PDF Text extracted, length:', data.text.length);
        console.log('');
        
        // Look for 4.00-4.99 section
        const text = data.text;
        
        // Find 4.00-4.99 table
        const match = text.match(/4\.00[^\n]*4\.99[^\n]*CT[\s\S]*?(?=RAPAPORT|$)/i);
        if (match) {
            console.log('Found 4.00-4.99 section:');
            console.log(match[0].substring(0, 1000));
        } else {
            console.log('4.00-4.99 section not found');
        }
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

extractFromPDF();
