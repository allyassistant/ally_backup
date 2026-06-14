#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Diamond Data Visualization Generator
 * Creates charts for price trends and inventory analysis
 */

const fs = require('fs');
const path = require('path');
const { WS } = require('./lib/config');

class ChartGenerator {
  constructor() {
    this.templates = {
      priceTrend: this.priceTrendTemplate,
      inventory: this.inventoryTemplate,
      comparison: this.comparisonTemplate
    };
  }

  generatePriceTrend(data, options = {}) {
    const { shape = 'RBC', months = 12 } = options;

    const chartData = {
      labels: this.generateMonthLabels(months),
      datasets: [
        { label: 'D/IF', data: data.d_if || [], color: '#2563EB' },
        { label: 'G/VS1', data: data.g_vs1 || [], color: '#10B981' },
        { label: 'J/SI2', data: data.j_si2 || [], color: '#F59E0B' }
      ]
    };

    const html = this.priceTrendTemplate(chartData, shape);
    return html;
  }

  generateMonthLabels(count) {
    const labels = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return labels;
  }

  priceTrendTemplate(data, shape) {
    return `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: system-ui; padding: 20px; }
    .chart-container { max-width: 800px; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="chart-container">
    <h2>${shape} Price Trend</h2>
    <canvas id="priceChart"></canvas>
  </div>
  <script>
    new Chart(document.getElementById('priceChart'), {
      type: 'line',
      data: ${JSON.stringify(data)},
      options: {
        responsive: true,
        plugins: { title: { display: true, text: 'Price per Carat (USD)' } },
        scales: { y: { beginAtZero: true } }
      }
    });
  </script>
</body>
</html>
    `.trim();
  }

  inventoryTemplate(inventory) {
    const data = {
      labels: Object.keys(inventory.byShape),
      datasets: [{
        label: 'Carats',
        data: Object.values(inventory.byShape),
        backgroundColor: ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']
      }]
    };

    return `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div style="max-width:600px;margin:20px auto;">
    <h2>Inventory by Shape</h2>
    <canvas id="inventoryChart"></canvas>
  </div>
  <script>
    new Chart(document.getElementById('inventoryChart'), {
      type: 'doughnut',
      data: ${JSON.stringify(data)},
      options: { responsive: true }
    });
  </script>
</body>
</html>
    `.trim();
  }

  saveToFile(html, filename) {
    const outputPath = path.join(WS, 'charts', filename);
    try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    } catch (err) {
        log(`❌ 創建目錄失敗: ${err.message}`);
        return null;
    }
    try {
        fs.writeFileSync(outputPath, html);
    } catch (err) {
        log(`❌ 保存 Chart 失敗: ${err.message}`);
        return null;
    }
    log(`Chart saved: ${outputPath}`);
    return outputPath;
  }
}

module.exports = ChartGenerator;
