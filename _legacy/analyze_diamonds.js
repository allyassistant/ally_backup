const fs = require('fs');

// Read the diamond stock data
const data = JSON.parse(fs.readFileSync('/Users/ally/.openclaw/workspace/memory/diamond_stock.json', 'utf8'));

console.log(`總共 ${data.length} 粒鑽石\n`);

// 1. Count by Shape
const shapeCount = {};
const shapeCarats = {};

// 2. Count by Color
const colorCount = {};

// 5. Top 5 largest stones
const allStones = [];

// 6. Price analysis (check if memo price exists)
let hasPrice = false;
const prices = [];

data.forEach(diamond => {
  const shape = diamond.Shape || 'Unknown';
  const color = diamond.Color || 'Unknown';
  const carat = parseFloat(diamond[' Crt'] || diamond.Crt || 0);
  
  // Shape count and carats
  shapeCount[shape] = (shapeCount[shape] || 0) + 1;
  shapeCarats[shape] = (shapeCarats[shape] || 0) + carat;
  
  // Color count
  colorCount[color] = (colorCount[color] || 0) + 1;
  
  // Collect stones for top 5
  allStones.push({
    carat: carat,
    shape: shape,
    color: color,
    clarity: diamond.Clarity || 'N/A',
    certNo: diamond['Cert No'] || 'N/A'
  });
  
  // Check for price
  if (diamond['Memo Price'] || diamond['Price'] || diamond['memo_price']) {
    hasPrice = true;
    const price = parseFloat(diamond['Memo Price'] || diamond['Price'] || diamond['memo_price'] || 0);
    if (price > 0) prices.push(price);
  }
});

// Sort stones by carat (descending)
allStones.sort((a, b) => b.carat - a.carat);

// Calculate average carat
const totalCarats = allStones.reduce((sum, s) => sum + s.carat, 0);
const avgCarat = totalCarats / allStones.length;

console.log('=== 1. 形狀分佈 (Count by Shape) ===');
Object.entries(shapeCount)
  .sort((a, b) => b[1] - a[1])
  .forEach(([shape, count]) => {
    console.log(`${shape}: ${count} 粒 (${((count/data.length)*100).toFixed(1)}%)`);
  });

console.log('\n=== 2. 顏色分佈 (Count by Color) ===');
const colorOrder = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
colorOrder.forEach(color => {
  if (colorCount[color]) {
    console.log(`${color}: ${colorCount[color]} 粒`);
  }
});

console.log('\n=== 3. 各形狀總卡數 (Total Carats by Shape) ===');
Object.entries(shapeCarats)
  .sort((a, b) => b[1] - a[1])
  .forEach(([shape, carats]) => {
    console.log(`${shape}: ${carats.toFixed(2)} 卡`);
  });

console.log(`\n=== 4. 平均卡數 (Average Carat Size) ===`);
console.log(`整體平均: ${avgCarat.toFixed(3)} 卡`);
Object.entries(shapeCarats).forEach(([shape, carats]) => {
  const avg = carats / shapeCount[shape];
  console.log(`${shape} 平均: ${avg.toFixed(3)} 卡`);
});

console.log('\n=== 5. 最大5粒鑽石 (Top 5 Largest Stones) ===');
allStones.slice(0, 5).forEach((stone, i) => {
  console.log(`${i+1}. ${stone.carat} 卡 | ${stone.shape} | ${stone.color} | ${stone.clarity} | Cert: ${stone.certNo}`);
});

console.log('\n=== 6. 價格資料 (Price Information) ===');
if (hasPrice && prices.length > 0) {
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  console.log(`Memo Price 範圍: $${minPrice.toLocaleString()} - $${maxPrice.toLocaleString()}`);
  console.log(`有價格資料的石頭: ${prices.length} 粒`);
} else {
  console.log('資料庫中沒有 Memo Price 或價格資料');
}

console.log(`\n=== 總結 ===`);
console.log(`總數: ${data.length} 粒`);
console.log(`總卡數: ${totalCarats.toFixed(2)} 卡`);
console.log(`整體平均卡數: ${avgCarat.toFixed(3)} 卡`);
console.log(`最大石頭: ${allStones[0].carat} 卡 (${allStones[0].shape} ${allStones[0].color})`);
