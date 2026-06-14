/**
 * scripts/lib/rules/index.js
 * 
 * 規則模組統一出口
 * 
 * 包含：
 *   - LOW_RISK_RULES (6 個自動修復規則)
 *   - HIGH_RISK_RULES (18 個高風險檢測規則)
 *   - 系統審計規則 (runSystemAudit)
 * 
 * 從 auto_fix.js 拆分出來的 Rules 層
 */

const lowRisk = require('./low-risk');
const highRisk = require('./high-risk');
const systemAudit = require('./system-audit');

module.exports = {
  LOW_RISK_RULES: lowRisk.LOW_RISK_RULES,
  HIGH_RISK_RULES: highRisk.HIGH_RISK_RULES,
  runSystemAudit: systemAudit.runSystemAudit,
};
