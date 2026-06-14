const fs = require('fs');

const rapExists = fs.existsSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json');
console.log('Rapaport DB exists:', rapExists);

if (rapExists) {
  const rap = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/rapaport_db.json', 'utf8'));
  console.log('Keys:', Object.keys(rap).join(', '));
  // Show round 3ct+ D price reference
  if (rap.round && rap.round['3.00-3.99']) {
    console.log('D FL:', rap.round['3.00-3.99'].D?.FL);
    console.log('D IF:', rap.round['3.00-3.99'].D?.IF);
    console.log('D VVS1:', rap.round['3.00-3.99'].D?.VVS1);
    console.log('D VVS2:', rap.round['3.00-3.99'].D?.VVS2);
    console.log('D VS1:', rap.round['3.00-3.99'].D?.VS1);
    console.log('D VS2:', rap.round['3.00-3.99'].D?.VS2);
    console.log('D SI1:', rap.round['3.00-3.99'].D?.SI1);
  }
} else {
  console.log('No rapaport db found');
}

// Estimate based on market rates
console.log('\n=== ESTIMATED RAPAPORT PRICES (Round, 3.00-3.99ct) ===');
const estimates = {
  'D FL': 180000,
  'D IF': 175000,
  'D VVS1': 155000,
  'D VVS2': 140000,
  'D VS1': 120000,
  'D VS2': 105000,
  'D SI1': 85000,
  'D SI2': 65000
};

Object.entries(estimates).forEach(([k, v]) => {
  const priceAtMarket = v * 0.75; // -25% market
  const priceAtConservative = v * 0.65; // -35% conservative
  console.log(`${k}: Rap $${v.toLocaleString()}/ct → Market $${priceAtMarket.toLocaleString()}/ct → Conservative $${priceAtConservative.toLocaleString()}/ct`);
});
