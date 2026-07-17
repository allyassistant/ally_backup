#!/usr/bin/env node
/**
 * Baseline Store — 簡易 Rolling Window Baseline
 *
 * 用於記錄 system metrics 嘅 baseline，支援 rolling window average + stddev。
 * 第一次行自動建立 baseline，之後每次更新。
 *
 * 用法：
 *   const { BaselineStore } = require('./lib/baseline_store');
 *   const store = new BaselineStore();
 *   await store.record('error_tracker.count', 15);
 *   const baseline = await store.getBaseline('error_tracker.count');
 *   // → { avg: 4.2, stddev: 2.1, count: 30, isAnomaly: true }
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace');

class BaselineStore {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(WORKSPACE_DIR, '.baseline_store.json');
    this.windowSize = options.windowSize || 30; // 保留最近 30 個 samples
    this.anomalyThreshold = options.anomalyThreshold || 2.0; // > 2 stddev = anomaly
    this.data = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return { metrics: {} };
    }
  }

  _save() {
    const tmp = this.filePath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
    fs.renameSync(tmp, this.filePath);
  }

  /**
   * Record a metric value
   * @param {string} key - Metric name (e.g. 'error_tracker.count')
   * @param {number} value - Observed value
   * @param {Object} [meta] - Optional metadata (e.g. { file: '...', size: 1234 })
   */
  record(key, value, meta = {}) {
    if (!this.data.metrics[key]) {
      this.data.metrics[key] = { samples: [], meta: {} };
    }

    const metric = this.data.metrics[key];
    metric.samples.push({ value, timestamp: Date.now(), ...meta });

    // Trim to window size
    if (metric.samples.length > this.windowSize) {
      metric.samples = metric.samples.slice(-this.windowSize);
    }

    this._save();
  }

  /**
   * Get baseline stats for a metric
   * @param {string} key - Metric name
   * @returns {{ avg: number|null, stddev: number|null, count: number, isAnomaly: boolean, lastValue: number|null }}
   */
  getBaseline(key) {
    const metric = this.data.metrics[key];
    if (!metric || metric.samples.length < 3) {
      return { avg: null, stddev: null, count: metric?.samples?.length || 0, isAnomaly: false, lastValue: null };
    }

    const values = metric.samples.map(s => s.value);
    const n = values.length;
    const avg = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / n;
    const stddev = Math.sqrt(variance);
    const lastValue = values[values.length - 1];

    return {
      avg: Math.round(avg * 100) / 100,
      stddev: Math.round(stddev * 100) / 100,
      count: n,
      lastValue,
      isAnomaly: lastValue !== null && stddev > 0 && Math.abs(lastValue - avg) > this.anomalyThreshold * stddev,
    };
  }

  /**
   * Get all metric keys
   */
  getKeys() {
    return Object.keys(this.data.metrics);
  }

  /**
   * Get recent samples for a key
   */
  getSamples(key, count = 5) {
    const metric = this.data.metrics[key];
    if (!metric) return [];
    return metric.samples.slice(-count);
  }

  /**
   * List all metrics that have anomalies
   */
  getAnomalies() {
    const anomalies = [];
    for (const key of this.getKeys()) {
      const baseline = this.getBaseline(key);
      if (baseline.isAnomaly) {
        anomalies.push({ key, ...baseline });
      }
    }
    return anomalies;
  }
}

module.exports = { BaselineStore };
