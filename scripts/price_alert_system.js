#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Price Alert System
 * Monitors price changes and sends notifications
 */

const fs = require('fs');
const path = require('path');
const { MEMORY_DIR } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');

class PriceAlertSystem {
  constructor(config = {}) {
    this.alerts = [];
    this.config = {
      defaultThreshold: config.defaultThreshold || 5, // 5%
      dataFile: config.dataFile || path.join(MEMORY_DIR, 'price-alerts.json')
    };
    this.loadAlerts();
  }

  loadAlerts() {
    let data;
    try {
      data = fs.readFileSync(this.config.dataFile, 'utf8');
    } catch (e) {
      console.error('Error: ' + e.message);
      this.alerts = [];
      return;
    }
    try {
      this.alerts = JSON.parse(data);
    } catch (e) {
      console.error('Error: ' + e.message);
      this.alerts = [];
      return;
    }
  }

  saveAlerts() {
    try {
      fs.mkdirSync(path.dirname(this.config.dataFile), { recursive: true });
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
    try {
      const tmpPath = this.config.dataFile + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.alerts, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.config.dataFile);
    } catch (e) {
      console.error('Error: ' + e.message);
      return;
    }
  }

  addAlert(specs) {
    const alert = {
      id: Date.now().toString(36),
      createdAt: getHKTDateTime(),
      specs: {
        shape: specs.shape,
        caratMin: specs.caratMin,
        caratMax: specs.caratMax,
        color: specs.color,
        clarity: specs.clarity,
        maxPrice: specs.maxPrice,
        threshold: specs.threshold || this.config.defaultThreshold
      },
      active: true,
      triggered: false
    };

    this.alerts.push(alert);
    this.saveAlerts();

    log(`Alert added: ${alert.id}`);
    return alert;
  }

  checkPrice(alertId, currentPrice) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert || !alert.active) return null;

    const { specs } = alert;
    let triggered = false;
    let message = '';

    if (currentPrice <= specs.maxPrice) {
      triggered = true;
      message = `Price alert triggered! ${specs.shape} ${specs.caratMin}-${specs.caratMax}ct ${specs.color} ${specs.clarity} now at USD ${currentPrice}`;
    }

    if (triggered) {
      alert.triggered = true;
      alert.triggeredAt = getHKTDateTime();
      alert.triggeredPrice = currentPrice;
      this.saveAlerts();
    }

    return triggered ? { alert, message } : null;
  }

  getActiveAlerts() {
    return this.alerts.filter(a => a.active && !a.triggered);
  }

  removeAlert(id) {
    this.alerts = this.alerts.filter(a => a.id !== id);
    this.saveAlerts();
  }

  generateAlertMessage(alert, currentPrice) {
    return `💎 Price Alert!

Specification: ${alert.specs.shape} ${alert.specs.caratMin}-${alert.specs.caratMax}ct ${alert.specs.color} ${alert.specs.clarity}
Target Price: USD ${alert.specs.maxPrice}
Current Price: USD ${currentPrice}

This diamond is now within your target price range!
    `.trim();
  }
}

module.exports = PriceAlertSystem;
