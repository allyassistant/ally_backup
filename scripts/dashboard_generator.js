#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Inventory Dashboard Generator
 * Creates interactive HTML dashboards
 */

const fs = require('fs');
const path = require('path');

class DashboardGenerator {
  generate(stockData) {
    const stats = this.calculateStats(stockData);
    
    const html = `
<!DOCTYPE html>
<html lang="zh-HK">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diamond Inventory Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f5f5f5; padding: 20px;
    }
    .dashboard { max-width: 1200px; margin: 0 auto; }
    .header { 
      background: linear-gradient(135deg, #2563EB, #1d4ed8);
      color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px;
    }
    .stats-grid { 
      display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px; margin-bottom: 20px;
    }
    .stat-card { 
      background: white; padding: 20px; border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .stat-value { font-size: 32px; font-weight: 700; color: #2563EB; }
    .stat-label { color: #6b7280; font-size: 14px; margin-top: 4px; }
    .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .chart-card { background: white; padding: 20px; border-radius: 8px; }
    @media (max-width: 768px) { .chart-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <h1>💎 Diamond Inventory Dashboard</h1>
      <p>Last updated: ${new Date().toLocaleString('zh-HK')}</p>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.totalItems}</div>
        <div class="stat-label">Total Items</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.totalCarats.toFixed(2)}</div>
        <div class="stat-label">Total Carats</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">USD ${stats.totalValue.toLocaleString()}</div>
        <div class="stat-label">Total Value</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.avgPrice}</div>
        <div class="stat-label">Avg Price/carat</div>
      </div>
    </div>
    
    <div class="chart-grid">
      <div class="chart-card">
        <h3>By Shape</h3>
        <canvas id="shapeChart"></canvas>
      </div>
      <div class="chart-card">
        <h3>By Color</h3>
        <canvas id="colorChart"></canvas>
      </div>
    </div>
  </div>
  
  <script>
    // Charts would be initialized here with real data
    log('Dashboard loaded');
  </script>
</body>
</html>
    `.trim();

    return html;
  }

  calculateStats(stock) {
    return {
      totalItems: stock.length,
      totalCarats: stock.reduce((s, d) => s + (d.carat || 0), 0),
      totalValue: stock.reduce((s, d) => s + (d.price || 0), 0),
      avgPrice: stock.length ? Math.round(stock.reduce((s, d) => s + (d.price || 0), 0) / stock.reduce((s, d) => s + (d.carat || 0), 0)) : 0
    };
  }
}

module.exports = DashboardGenerator;
