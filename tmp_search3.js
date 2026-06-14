const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/diamond_stock.json', 'utf8'));

// Landscape: 3ct+ stones by color
const large = data.filter(s => {
  const c = s.Crt || s.carat || 0;
  const p = parseFloat(s.Price || 0);
  return c >= 3.0 && p > 0;
});

console.log(`=== 3ct+ STOCK OVERVIEW (${large.length} stones) ===\n`);

// Group by color
const byColor = {};
large.forEach(s => {
  const col = (s.Color || '?').toUpperCase();
  if (!byColor[col]) byColor[col] = [];
  byColor[col].push(s);
});

Object.keys(byColor).sort().forEach(col => {
  const stones = byColor[col];
  stones.sort((a,b) => parseFloat(a.Price||0) - parseFloat(b.Price||0));
  const cheapest = stones[0];
  const cheapestPrice = parseFloat(cheapest.Price||0).toLocaleString();
  const c = cheapest.Crt || cheapest.carat;
  console.log(`${col}: ${stones.length} stones | cheapest: ${c}ct ${col} ${cheapest.Clarity} @ $${cheapestPrice}`);
});

console.log('\n=== TOP 10 CHEAPEST 3ct+ ===\n');
large.sort((a,b) => parseFloat(a.Price||0) - parseFloat(b.Price||0));
large.slice(0,10).forEach(s => {
  const c = s.Crt || s.carat;
  const p = parseFloat(s.Price || 0);
  console.log(`  ${c}ct | ${s.Color} ${s.Clarity} | ${s.Shape} | $${p.toLocaleString()} | Cert: ${s['Cert No'] || 'N/A'}`);
});
