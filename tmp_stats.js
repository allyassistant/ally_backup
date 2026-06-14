const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/diamond_stock.json', 'utf8'));

console.log(`Total stones in DB: ${data.length}`);
console.log('');

// Check carat distribution
const carats = data.map(s => s.Crt || s.carat || 0).filter(c => c > 0);
carats.sort((a,b) => b - a);
console.log(`Carat range: ${carats[carats.length-1]} - ${carats[0]}`);
console.log(`3ct+ stones: ${carats.filter(c => c >= 3).length}`);
console.log(`2ct+ stones: ${carats.filter(c => c >= 2).length}`);
console.log(`1ct+ stones: ${carats.filter(c => c >= 1).length}`);
console.log('');

// Show top 10 largest
console.log('=== TOP 10 LARGEST ===');
carats.slice(0,10).forEach(c => {
  const stone = data.find(s => (s.Crt||s.carat||0) === c);
  if (stone) {
    const p = parseFloat(stone.Price||0);
    console.log(`  ${c}ct | ${stone.Color} ${stone.Clarity} | $${p>0?p.toLocaleString():'NO PRICE'} | Cert: ${stone['Cert No']||'N/A'}`);
  }
});

// Price distribution
const priced = data.filter(s => parseFloat(s.Price||0) > 0);
const unpriced = data.filter(s => !s.Price || parseFloat(s.Price||0) === 0);
console.log(`\nPriced: ${priced.length} | Unpriced: ${unpriced.length}`);
