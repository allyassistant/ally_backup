const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/diamond_stock.json', 'utf8'));

const matches = data.filter(s => {
  const c = s.Crt || s.carat || 0;
  const col = (s.Color || '').toUpperCase();
  const p = parseFloat(s.Price || 0);
  return c >= 3 && col === 'D' && p <= 50000 && p > 0;
});

console.log('Found:', matches.length, 'stones (3ct+, D color, ≤$50k)');
console.log('');

matches.slice(0, 10).forEach(s => {
  const c = s.Crt || s.carat;
  const p = parseFloat(s.Price || 0);
  console.log(`  ${c}ct | ${s.Color} ${s.Clarity} | ${s.Shape} | $${p.toLocaleString()} | Cert: ${s['Cert No'] || 'N/A'}`);
});