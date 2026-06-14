#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Diamond Market Monitor
 * Tracks competitor prices and market trends
 */

const fs = require('fs');
const path = require('path');
const { WS } = require('./lib/config');
const { getHKTDate, getHKTDateTime } = require('./lib/time');

const DEFAULT_CHECK_INTERVAL_MS = 3600000; // 1 hour

class MarketMonitor {
  constructor(config = {}) {
    this.config = {
      checkInterval: config.checkInterval || DEFAULT_CHECK_INTERVAL_MS,
      priceThreshold: config.priceThreshold || 5, // 5% change
      competitors: config.competitors || [],
      dataDir: config.dataDir || path.join(WS, 'market_data')
    };

    try {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
  }

  async scrapeCompetitor(url) {
    log(`Scraping ${url}...`);
    // Implementation would use puppeteer or similar
    return {
      url,
      timestamp: getHKTDateTime(),
      listings: []
    };
  }

  async checkRapaportUpdate() {
    // Check if new Rapaport prices released (usually Friday)
    const today = new Date();
    const isFriday = today.getDay() === 5;

    if (isFriday) {
      log('📅 New Rapaport prices expected today');
      return { expected: true, date: getHKTDateTime() };
    }

    return { expected: false };
  }

  analyzeTrends(historicalData) {
    const trends = {
      upward: [],
      downward: [],
      stable: []
    };

    // Analyze price movements
    historicalData.forEach(item => {
      const change = this.calculateChange(item.current, item.previous);

      if (change > this.config.priceThreshold) {
        trends.upward.push({ ...item, change });
      } else if (change < -this.config.priceThreshold) {
        trends.downward.push({ ...item, change });
      } else {
        trends.stable.push({ ...item, change });
      }
    });

    return trends;
  }

  calculateChange(current, previous) {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  generateAlert(trends) {
    const alerts = [];

    if (trends.upward.length > 0) {
      alerts.push({
        type: 'price_increase',
        severity: 'medium',
        message: `${trends.upward.length} categories showing price increases`,
        items: trends.upward
      });
    }

    if (trends.downward.length > 0) {
      alerts.push({
        type: 'price_decrease',
        severity: 'info',
        message: `${trends.downward.length} categories showing price decreases`,
        items: trends.downward
      });
    }

    return alerts;
  }

  saveSnapshot(data) {
    try {
      const filename = `market_${getHKTDate()}.json`;
      const safeFilename = path.basename(filename); // Sanitize
      const filepath = path.join(this.config.dataDir, safeFilename);
      const tmpPath = filepath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, filepath);
      log(`Market snapshot saved: ${filepath}`);
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
  }
}

module.exports = MarketMonitor;
