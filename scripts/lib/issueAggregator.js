#!/usr/bin/env node
/**
 * issueAggregator.js - 統一 Issue 聚合模組
 * 統一 Issue 格式、去重邏輯、按 severity 分類
 *
 * Created: 2026-04-05
 */

const crypto = require('crypto');

// ==================== 常量定義 ====================
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const VALID_CATEGORIES = ['security', 'performance', 'reliability', 'style'];
const VALID_SOURCES = ['local', 'ai', 'error_json', 'batch', 'batch_verification'];
const VALID_STATUSES = ['open', 'in_progress', 'resolved'];

const SEVERITY_WEIGHTS = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

// ==================== Issue Builder ====================
class IssueBuilder {
  constructor() {
    this.issue = {
      status: 'open',
      createdAt: new Date().toISOString()
    };
  }

  id(value) {
    this.issue.id = value;
    return this;
  }

  source(value) {
    if (!VALID_SOURCES.includes(value)) {
      throw new Error(`Invalid source: ${value}. Must be one of: ${VALID_SOURCES.join(', ')}`);
    }
    this.issue.source = value;
    return this;
  }

  severity(value) {
    if (!VALID_SEVERITIES.includes(value)) {
      throw new Error(`Invalid severity: ${value}. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
    }
    this.issue.severity = value;
    return this;
  }

  category(value) {
    if (!VALID_CATEGORIES.includes(value)) {
      throw new Error(`Invalid category: ${value}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
    this.issue.category = value;
    return this;
  }

  file(value) {
    this.issue.file = value;
    return this;
  }

  line(value) {
    this.issue.line = typeof value === 'number' ? value : parseInt(value, 10) || 0;
    return this;
  }

  rule(value) {
    this.issue.rule = value;
    return this;
  }

  title(value) {
    this.issue.title = value;
    return this;
  }

  description(value) {
    this.issue.description = value;
    return this;
  }

  suggestion(value) {
    this.issue.suggestion = value;
    return this;
  }

  autoFixable(value) {
    this.issue.autoFixable = Boolean(value);
    return this;
  }

  status(value) {
    if (!VALID_STATUSES.includes(value)) {
      throw new Error(`Invalid status: ${value}. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    this.issue.status = value;
    return this;
  }

  metadata(key, value) {
    if (!this.issue.metadata) this.issue.metadata = {};
    this.issue.metadata[key] = value;
    return this;
  }

  build() {
    // 驗證必填欄位
    const required = ['source', 'severity', 'category', 'file', 'title'];
    const missing = required.filter(field => !this.issue[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // 自動生成 ID（如果未提供）
    if (!this.issue.id) {
      this.issue.id = this.generateId();
    }

    return { ...this.issue };
  }

  generateId() {
    const data = `${this.issue.source}:${this.issue.file}:${this.issue.line}:${this.issue.rule}:${this.issue.title}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }
}

// ==================== Issue Aggregator ====================
class IssueAggregator {
  constructor(options = {}) {
    this.issues = new Map();
    this.options = {
      autoDeduplicate: options.autoDeduplicate !== false,
      dedupStrategy: options.dedupStrategy || 'hash', // 'hash' | 'location' | 'title'
      ...options
    };
  }

  /**
   * 創建新的 IssueBuilder
   */
  static builder() {
    return new IssueBuilder();
  }

  /**
   * 驗證 Issue 格式
   */
  validate(issue) {
    const errors = [];

    // 必填欄位
    const required = ['id', 'source', 'severity', 'category', 'file', 'title'];
    for (const field of required) {
      if (!issue[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // 驗證枚舉值
    if (issue.severity && !VALID_SEVERITIES.includes(issue.severity)) {
      errors.push(`Invalid severity: ${issue.severity}`);
    }
    if (issue.category && !VALID_CATEGORIES.includes(issue.category)) {
      errors.push(`Invalid category: ${issue.category}`);
    }
    if (issue.source && !VALID_SOURCES.includes(issue.source)) {
      errors.push(`Invalid source: ${issue.source}`);
    }
    if (issue.status && !VALID_STATUSES.includes(issue.status)) {
      errors.push(`Invalid status: ${issue.status}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 計算 Issue 的 dedup key
   */
  getDedupKey(issue) {
    switch (this.options.dedupStrategy) {
      case 'hash':
        return issue.id;
      case 'location':
        return `${issue.file}:${issue.line}:${issue.rule}`;
      case 'title':
        return `${issue.file}:${issue.title}`;
      default:
        return issue.id;
    }
  }

  /**
   * 添加單個 Issue
   */
  add(issue) {
    const validation = this.validate(issue);
    if (!validation.valid) {
      throw new Error(`Invalid issue: ${validation.errors.join(', ')}`);
    }

    const key = this.getDedupKey(issue);

    if (this.issues.has(key)) {
      const existing = this.issues.get(key);
      // 合併邏輯：保留更高 severity 的
      if (SEVERITY_WEIGHTS[issue.severity] > SEVERITY_WEIGHTS[existing.severity]) {
        this.issues.set(key, { ...issue, duplicates: [...(existing.duplicates || []), existing] });
      } else {
        existing.duplicates = [...(existing.duplicates || []), issue];
      }
      return { added: false, key, existing: true };
    }

    this.issues.set(key, issue);
    return { added: true, key, existing: false };
  }

  /**
   * 批量添加 Issues
   */
  addMany(issues) {
    const results = { added: 0, duplicates: 0, errors: [] };

    for (const issue of issues) {
      try {
        const result = this.add(issue);
        if (result.added) {
          results.added++;
        } else {
          results.duplicates++;
        }
      } catch (err) {
        results.errors.push({ issue, error: err.message });
      }
    }

    return results;
  }

  /**
   * 移除 Issue
   */
  remove(id) {
    for (const [key, issue] of this.issues) {
      if (issue.id === id) {
        this.issues.delete(key);
        return true;
      }
    }
    return false;
  }

  /**
   * 更新 Issue 狀態
   */
  updateStatus(id, status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    for (const [key, issue] of this.issues) {
      if (issue.id === id) {
        issue.status = status;
        issue.updatedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  /**
   * 獲取所有 Issues
   */
  getAll(options = {}) {
    let results = Array.from(this.issues.values());

    // 過濾
    if (options.severity) {
      const severities = Array.isArray(options.severity) ? options.severity : [options.severity];
      results = results.filter(i => severities.includes(i.severity));
    }

    if (options.category) {
      const categories = Array.isArray(options.category) ? options.category : [options.category];
      results = results.filter(i => categories.includes(i.category));
    }

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      results = results.filter(i => statuses.includes(i.status));
    }

    if (options.source) {
      const sources = Array.isArray(options.source) ? options.source : [options.source];
      results = results.filter(i => sources.includes(i.source));
    }

    if (options.file) {
      results = results.filter(i => i.file.includes(options.file));
    }

    if (options.autoFixable !== undefined) {
      results = results.filter(i => i.autoFixable === options.autoFixable);
    }

    // 排序
    const sortBy = options.sortBy || 'severity';
    const sortOrder = options.sortOrder || 'desc';

    results.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'severity':
          comparison = SEVERITY_WEIGHTS[b.severity] - SEVERITY_WEIGHTS[a.severity];
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt) - new Date(b.createdAt);
          break;
        case 'file':
          comparison = a.file.localeCompare(b.file);
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        default:
          comparison = String(a[sortBy]).localeCompare(String(b[sortBy]));
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // 分頁
    if (options.limit) {
      const offset = options.offset || 0;
      results = results.slice(offset, offset + options.limit);
    }

    return results;
  }

  /**
   * 按 severity 分組
   */
  groupBySeverity() {
    const groups = { critical: [], high: [], medium: [], low: [] };
    for (const issue of this.issues.values()) {
      if (groups[issue.severity]) {
        groups[issue.severity].push(issue);
      }
    }
    return groups;
  }

  /**
   * 按 category 分組
   */
  groupByCategory() {
    const groups = { security: [], performance: [], reliability: [], style: [] };
    for (const issue of this.issues.values()) {
      if (groups[issue.category]) {
        groups[issue.category].push(issue);
      }
    }
    return groups;
  }

  /**
   * 按文件分組
   */
  groupByFile() {
    const groups = {};
    for (const issue of this.issues.values()) {
      if (!groups[issue.file]) {
        groups[issue.file] = [];
      }
      groups[issue.file].push(issue);
    }
    return groups;
  }

  /**
   * 獲取統計信息
   */
  getStats() {
    const stats = {
      total: this.issues.size,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byCategory: { security: 0, performance: 0, reliability: 0, style: 0 },
      byStatus: { open: 0, in_progress: 0, resolved: 0 },
      bySource: { local: 0, ai: 0, error_json: 0 },
      autoFixable: 0
    };

    for (const issue of this.issues.values()) {
      if (stats.bySeverity[issue.severity] !== undefined) {
        stats.bySeverity[issue.severity]++;
      }
      if (stats.byCategory[issue.category] !== undefined) {
        stats.byCategory[issue.category]++;
      }
      if (stats.byStatus[issue.status] !== undefined) {
        stats.byStatus[issue.status]++;
      }
      if (stats.bySource[issue.source] !== undefined) {
        stats.bySource[issue.source]++;
      }
      if (issue.autoFixable) {
        stats.autoFixable++;
      }
    }

    return stats;
  }

  /**
   * 獲取摘要報告
   */
  getSummary() {
    const stats = this.getStats();
    return {
      total: stats.total,
      critical: stats.bySeverity.critical,
      high: stats.bySeverity.high,
      medium: stats.bySeverity.medium,
      low: stats.bySeverity.low,
      open: stats.byStatus.open,
      inProgress: stats.byStatus.in_progress,
      resolved: stats.byStatus.resolved,
      autoFixable: stats.autoFixable
    };
  }

  /**
   * 導出為 JSON
   */
  export(format = 'json') {
    const issues = this.getAll();

    switch (format) {
      case 'json':
        return JSON.stringify({ issues, stats: this.getStats() }, null, 2);
      case 'sarif':
        return this.toSarif(issues);
      case 'simple':
        return issues.map(i => `${i.severity.toUpperCase()}: ${i.file}:${i.line} - ${i.title}`).join('\n');
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * 轉換為 SARIF 格式
   */
  toSarif(issues) {
    return JSON.stringify({
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [{
        tool: { driver: { name: 'issueAggregator' } },
        results: issues.map(i => ({
          ruleId: i.rule,
          level: i.severity === 'critical' ? 'error' : i.severity === 'high' ? 'error' : i.severity === 'medium' ? 'warning' : 'note',
          message: { text: i.title },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: i.file },
              region: { startLine: i.line }
            }
          }]
        }))
      }]
    }, null, 2);
  }

  /**
   * 清空所有 Issues
   */
  clear() {
    this.issues.clear();
  }

  /**
   * 獲取 Issue 據量
   */
  size() {
    return this.issues.size;
  }
}

// ==================== 便捷函數 ====================
function createIssue(data) {
  const builder = new IssueBuilder();

  if (data.id) builder.id(data.id);
  if (data.source) builder.source(data.source);
  if (data.severity) builder.severity(data.severity);
  if (data.category) builder.category(data.category);
  if (data.file) builder.file(data.file);
  if (data.line !== undefined) builder.line(data.line);
  if (data.rule) builder.rule(data.rule);
  if (data.title) builder.title(data.title);
  if (data.description) builder.description(data.description);
  if (data.suggestion) builder.suggestion(data.suggestion);
  if (data.autoFixable !== undefined) builder.autoFixable(data.autoFixable);
  if (data.status) builder.status(data.status);

  // P0-2 Fix: 保留額外欄位 via metadata
  if (data.metadata && typeof data.metadata === 'object') {
    for (const [key, value] of Object.entries(data.metadata)) {
      builder.metadata(key, value);
    }
  }

  return builder.build();
}

function createAggregator(options) {
  return new IssueAggregator(options);
}

// ==================== Export ====================
module.exports = {
  IssueAggregator,
  IssueBuilder,
  createIssue,
  createAggregator,
  VALID_SEVERITIES,
  VALID_CATEGORIES,
  VALID_SOURCES,
  VALID_STATUSES,
  SEVERITY_WEIGHTS
};
