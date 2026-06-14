const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/diamond_stock.json', 'utf8'));

// First: what's the D color 3ct+ landscape?
const dStones = data.filter(s => {
  const c = s.Crt || s.carat || 0;
  const col = (s.Color || '').toUpperCase();
  const p = parseFloat(s.Price || 0);
  return c >= 3.0 && col === 'D' && p > 0;
});

console.log('=== D COLOR 3ct+ STOCK ===');
console.log(`Total: ${dStones.length} stones\n`);

dStones.sort((a,b) => (parseFloat(a.Price||0)) - (parseFloat(b.Price||0))).forEach(s => {
  const c = s.Crt || s.carat;
  const p = parseFloat(s.Price || 0);
  console.log(`  ${c}ct | ${s.Color} ${s.Clarity} | ${s.Shape} | $${p.toLocaleString()} | ${s.Cut||'N/A'} Cut | Fluor: ${s.Fluor||'N/A'} | Cert: ${s['Cert No'] || 'N/A'}`);
});

// Also check near-budget: what's the cheapest D 3ct+?
if (dStones.length > 0) {
  const cheapest = dStones.reduce((min, s) => parseFloat(s.Price||0) < parseFloat(min.Price||0) ? s : min);
  console.log(`\nCheapest D 3ct+: $${parseFloat(cheapest.Price||0).toLocaleString()}`);
}
