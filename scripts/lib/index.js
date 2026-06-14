#!/usr/bin/env node
/**
 * lib/index.js - 統一導出所有 lib 模組
 *
 * Created: 2026-04-05
 */

const config = require('./config');
const state = require('./state');
const time = require('./time');
const fileDiscovery = require('./fileDiscovery');
const issueAggregator = require('./issueAggregator');

module.exports = {
  // 基礎模組
  config,
  state,
  time,

  // Phase 1: 代碼質量管理基礎設施
  fileDiscovery,
  issueAggregator,

  // 便捷導出
  ...config,
  ...state,
  ...time,
  ...fileDiscovery,
  ...issueAggregator
};
