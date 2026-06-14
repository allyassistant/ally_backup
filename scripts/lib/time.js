// scripts/lib/time.js
// HKT 時間 helper - 統一時區處理
// Created: 2026-03-30

const os = require('os');
const HOME = process.env.HOME || os.homedir();
if (!HOME) throw new Error('HOME environment variable required');

function getHKTDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
}

function getHKTDateTime() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

function getHKTTime() {
  return new Date().toLocaleTimeString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

module.exports = { getHKTDate, getHKTDateTime, getHKTTime };
