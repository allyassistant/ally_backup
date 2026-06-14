const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/diamond_stock.json', 'utf8'));

// D color 3ct+ stones
const dStones = data.filter(s => {
  const c = s.Crt || s.carat || 0;
  const col = (s.Color || '').toUpperCase();
  return c >= 3.0 && col === 'D';
});

console.log(`=== D COLOR 3ct+ (${dStones.length} stones) ===\n`);
dStones.sort((a,b) => (s => parseFloat(s.Price||0))(a) - (s => parseFloat(s.Price||0))(b)).forEach(s => {
  const c = s.Crt || s.carat;
  const p = parseFloat(s.Price||0);
  console.log(`  ${c}ct | ${s.Color} ${s.Clarity} | ${s.Shape} | Price: ${p>0?'$'+p.toLocaleString():'TBC'} | ${s.Cut||'N/A'} Cut | Fluor: ${s.Fluor||'N/A'} | Cert: ${s['Cert No']||'N/A'}`);
});

// E color 3ct+ for reference
const eStones = data.filter(s => {
  const c = s.Crt || s.carat || 0;
  const col = (s.Color || '').toUpperCase();
  return c >= 3.0 && col === 'E';
});

console.log(`\n=== E COLOR 3ct+ (${eStones.length} stones) ===\n`);
eStones.slice(0,5).forEach(s => {
  const c = s.Crt || s.carat;
  const p = parseFloat(s.Price||0);
  console.log(`  ${c}ct | ${s.Color} ${s.Clarity} | ${s.Shape} | Price: ${p>0?'$'+p.toLocaleString():'TBC'} | Cert: ${s['Cert No']||'N/A'}`);
});

// What colors do we have in 3ct+ range?
console.log('\n=== 3ct+ BY COLOR ===');
const byColor = {};
data.filter(s => (s.Crt||s.carat||0) >= 3.0).forEach(s => {
  const col = (s.Color||'?').toUpperCase();
  if (!byColor[col]) byColor[col] = 0;
  byColor[col]++;
});
Object.keys(byColor).sort().forEach(col => console.log(`  ${col}: ${byColor[col]}`));
