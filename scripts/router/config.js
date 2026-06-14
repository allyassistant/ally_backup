/**
 * Router Configuration — Phase 0
 *
 * Defines paths and settings for the routing system.
 */

const path = require('path');

const ROUTER_DIR = path.join(__dirname);

module.exports = {
  ROUTER_DIR,
  decisionLogPath: path.join(ROUTER_DIR, 'decision_log.jsonl'),
  feedbackLogPath: path.join(ROUTER_DIR, 'feedback_log.jsonl'),
  logRetentionDays: 7,
  features: {
    autoClassify: true,
    autoSuggest: false,
    autoRoute: false,
  },
};
