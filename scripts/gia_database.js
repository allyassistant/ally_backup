#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * GIA Database Integration
 * Syncs extracted certificate data with internal database
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

class GIADatabase {
  constructor(dbPath = './data/gia_database.json') {
    this.dbPath = dbPath;
    this.ensureDB();
  }

  ensureDB() {
    // 添加 try-catch 處理權限錯誤
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    } catch (err) {
      console.error(`⚠️ Failed to create directory: ${err.message}`);
      throw err;
    }
    if (!fs.existsSync(this.dbPath)) {
      try {
        fs.writeFileSync(this.dbPath, JSON.stringify({ certificates: [] }, null, 2));
      } catch (err) {
        console.error(`⚠️ Failed to write database: ${err.message}`);
        throw err;
      }
    }
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    } catch (e) {
      console.error(`⚠️ Failed to parse database: ${e.message}`);
      return { certificates: [], lastUpdated: null };
    }
  }

  save(data) {
    // 添加 try-catch 處理磁盤空間錯誤
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`⚠️ Failed to save database: ${err.message}`);
      throw err;
    }
  }

  addCertificate(certData) {
    const db = this.load();

    // Check for duplicates (使用可選鏈防止 undefined 錯誤)
    const exists = db.certificates?.find(c => c.reportNumber === certData.reportNumber);
    if (exists) {
      log(`Certificate ${certData.reportNumber} already exists, updating...`);
      Object.assign(exists, certData, { updatedAt: getHKTDateTime() });
    } else {
      db.certificates.push({
        ...certData,
        addedAt: getHKTDateTime()
      });
    }

    this.save(db);
    return certData.reportNumber;
  }

  findByReportNumber(number) {
    const db = this.load();
    return db.certificates.find(c => c.reportNumber === number);
  }

  findByCriteria(criteria) {
    const db = this.load();
    // 使用可選鏈防止 certificates 為 undefined
    return db.certificates?.filter(c => {
      if (criteria.shape && !c.shape?.toLowerCase().includes(criteria.shape?.toLowerCase())) return false;
      if (criteria.color && c.colorGrade !== criteria.color) return false;
      if (criteria.clarity && c.clarityGrade !== criteria.clarity) return false;
      if (criteria.minCarat && c.carat < criteria.minCarat) return false;
      if (criteria.maxCarat && c.carat > criteria.maxCarat) return false;
      return true;
    }) || [];
  }

  getStats() {
    const db = this.load();
    const certs = db.certificates;

    return {
      totalCertificates: certs.length,
      byShape: this.groupBy(certs, 'shape'),
      byColor: this.groupBy(certs, 'colorGrade'),
      byClarity: this.groupBy(certs, 'clarityGrade'),
      totalCarats: certs.reduce((s, c) => s + (c.carat || 0), 0)
    };
  }

  groupBy(items, key) {
    const groups = {};
    items.forEach(item => {
      const val = item[key] || 'Unknown';
      groups[val] = (groups[val] || 0) + 1;
    });
    return groups;
  }

  // CSV 字段轉義函數 - 防止 CSV 注入攻擊
  escapeCSVField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    // 如果包含特殊字符，使用引號包裹並轉義內部引號
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  exportToCSV(outputPath) {
    const db = this.load();
    const headers = [
      'ReportNumber', 'Shape', 'Carat', 'Color', 'Clarity',
      'Cut', 'Polish', 'Symmetry', 'Fluorescence'
    ];

    // 使用轉義函數防止 CSV 注入
    const rows = db.certificates?.map(c => [
      this.escapeCSVField(c.reportNumber),
      this.escapeCSVField(c.shape),
      this.escapeCSVField(c.carat),
      this.escapeCSVField(c.colorGrade),
      this.escapeCSVField(c.clarityGrade),
      this.escapeCSVField(c.cutGrade),
      this.escapeCSVField(c.polish),
      this.escapeCSVField(c.symmetry),
      this.escapeCSVField(c.fluorescence)
    ].join(',')) || [];

    const csv = [headers.join(','), ...rows].join('\n');
    try {
        fs.writeFileSync(outputPath, csv);
    } catch (err) {
        log(`❌ 導出 CSV 失敗: ${err.message}`);
        return;
    }
    log(`Exported ${rows.length} certificates to ${outputPath}`);
  }
}

module.exports = GIADatabase;
