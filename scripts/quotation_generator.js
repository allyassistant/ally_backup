#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

const { getHKTDate, getHKTDateTime } = require('./lib/time');

/**
 * Professional Quotation Generator
 * Creates PDF quotations for diamonds
 */

const fs = require('fs');
const path = require('path');

class QuotationGenerator {
  constructor(companyInfo) {
    this.company = companyInfo;
  }

  generate(diamonds, options = {}) {
    const quotation = {
      id: `Q-${Date.now()}`,
      date: getHKTDate(),
      diamonds: diamonds.map(d => ({
        ...d,
        totalPrice: this.calculatePrice(d)
      })),
      total: 0,
      validUntil: this.getValidUntil()
    };

    quotation.total = quotation.diamonds.reduce((sum, d) => sum + d.totalPrice, 0);

    log(`Generated quotation ${quotation.id}`);
    return quotation;
  }

  calculatePrice(diamond) {
    // Use Rapaport data + discount
    const basePrice = diamond.rapaportPrice || 0;
    const discount = diamond.discount || -30;
    return basePrice * (1 + discount / 100);
  }

  getValidUntil() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return getHKTDateTime();
  }

  toPDF(quotation, outputPath) {
    log(`Saving PDF to ${outputPath}`);
    // Would use pdf-lib or puppeteer
  }
}

module.exports = QuotationGenerator;
