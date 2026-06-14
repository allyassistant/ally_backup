const XLSX = require('xlsx');

// Read both files
const dnWB = XLSX.readFile('/Users/ally/.openclaw/media/inbound/DN_NY_LIST---317d9cef-90da-4c19-94da-54dec84bebc6.xlsx');
const stockWB = XLSX.readFile('/Users/ally/Desktop/Stock list/Merged_Stocklist (2026-02-24).xlsx');

const dnData = XLSX.utils.sheet_to_json(dnWB.Sheets[dnWB.SheetNames[0]]);
const stockData = XLSX.utils.sheet_to_json(stockWB.Sheets[stockWB.SheetNames[0]]);

// Create maps by Cert No
const stockMap = new Map();
stockData.forEach(d => {
  const cert = String(d['Cert No']);
  stockMap.set(cert, d);
});

const dnMap = new Map();
dnData.forEach(d => {
  const cert = String(d['Cert No']);
  dnMap.set(cert, d);
});

// Find differences
const newInDN = [];
const removed = [];
const changed = [];

dnData.forEach(d => {
  const cert = String(d['Cert No']);
  if (!stockMap.has(cert)) {
    newInDN.push(d);
  } else {
    const old = stockMap.get(cert);
    const oldPrice = old['Memo Price'] || old['Memo In Price'];
    const newPrice = d['Memo In Price'] || d['Memo Price'];
    if (oldPrice !== newPrice) {
      changed.push({ old, new: d });
    }
  }
});

stockData.forEach(d => {
  const cert = String(d['Cert No']);
  if (!dnMap.has(cert)) {
    removed.push(d);
  }
});

console.log('=== COMPARISON RESULTS ===');
console.log('New in DN (new stock):', newInDN.length);
console.log('Removed from DN (sold):', removed.length);
console.log('Price changed:', changed.length);

function formatDiamond(d) {
  const shape = d['Shape'] || '';
  const crt = d['Crt'] || d['Carat'] || '';
  const color = d['Color'] || '';
  const clarity = d['Clarity'] || '';
  const cut = d['Cut'] || d['Polish'] || '';
  const pol = d['Pol'] || d['Polish'] || '';
  const sym = d['Symm'] || d['Sym'] || '';
  const fluor = d['Fluor'] || d['Fluorescence'] || '';
  const meas = d['Measurement'] || '';
  const cert = d['Cert No'] || '';
  const parcel = d['Parcel Name'] || '';
  
  return `*${parcel}
${shape} ${crt} ${color} ${clarity}
${cut} ${pol} ${sym} ${fluor}
${meas}
GIA No: ${cert}
Link: https://www.gia.edu/report-check?reportno=${cert}
`;
}

console.log('\n=== NEW STOCK (IN DN BUT NOT IN PREVIOUS) ===');
newInDN.forEach(d => {
  console.log(formatDiamond(d));
});

console.log('\n=== SOLD / REMOVED (IN PREVIOUS BUT NOT IN DN) ===');
removed.forEach(d => {
  console.log(formatDiamond(d));
});

console.log('\n=== PRICE CHANGED ===');
changed.forEach(c => {
  console.log(formatDiamond(c.new));
  console.log(`(Old Price: ${c.old['Memo Price']} → New Price: ${c.new['Memo In Price']})`);
});
