const pdfParse = require('pdf-parse');
const fs = require('fs');

const pdfFile = '/Users/ally/Downloads/Round Price List 01.30.2026.pdf';

async function extractRapaport() {
    try {
        console.log('Reading PDF...');
        const dataBuffer = fs.readFileSync(pdfFile);
        const data = await pdfParse(dataBuffer);
        
        const text = data.text;
        console.log('PDF loaded, text length:', text.length);
        console.log('');
        
        // Search for 4.00-4.99 section
        // Pattern: look for "4.00" followed by table data
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        let inTable = false;
        let tableLines = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Find 4.00-4.99 header
            if (line.match(/4\.00.*4\.99/i) && line.includes('CT')) {
                console.log('Found header:', line);
                inTable = true;
                continue;
            }
            
            // Find 5.00-5.99 header (stop here)
            if (line.match(/5\.00.*5\.99/i) && line.includes('CT')) {
                break;
            }
            
            if (inTable) {
                // Look for color rows (D, E, F, G, etc followed by numbers)
                if (line.match(/^[D-M]\s+\d/)) {
                    tableLines.push(line);
                }
            }
        }
        
        console.log('\nTable lines found:', tableLines.length);
        tableLines.forEach(l => console.log(l));
        
        // Parse F color row
        const fLine = tableLines.find(l => l.startsWith('F '));
        if (fLine) {
            console.log('\n=== F COLOR ROW ===');
            console.log(fLine);
            
            // Extract numbers
            const numbers = fLine.match(/\d+/g);
            if (numbers && numbers.length >= 11) {
                const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
                console.log('\nParsed values:');
                clarities.forEach((c, i) => {
                    console.log(`  ${c}: ${numbers[i]}`);
                });
                
                // Calculate price
                const si1Value = parseInt(numbers[5]);
                const carat = 4.45;
                const discount = 0.47;
                
                const listPricePerCt = si1Value * 100;
                const totalListPrice = listPricePerCt * carat;
                const finalPrice = totalListPrice * (1 - discount);
                
                console.log('\n=== PRICE CALCULATION ===');
                console.log('Stone: RBC 4.45 F SI1');
                console.log(`Rapaport 4.00-4.99 F SI1: ${si1Value}`);
                console.log(`List Price/ct: $${listPricePerCt.toLocaleString()}`);
                console.log(`Total List: $${totalListPrice.toLocaleString()}`);
                console.log(`Discount: -47%`);
                console.log(`\n*** FINAL: USD $${finalPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ***`);
            }
        }
        
    } catch (err) {
        console.error('Error:', err.message);
        console.error(err.stack);
    }
}

extractRapaport();
