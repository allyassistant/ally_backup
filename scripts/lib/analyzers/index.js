/**
 * scripts/lib/analyzers/index.js
 * 
 * 分析器模組統一出口
 * 
 * 從 auto_fix.js 拆分出來的核心分析邏輯
 */

const fileAnalyzer = require('./file-analyzer');

module.exports = {
  analyzeFile: fileAnalyzer.analyzeFile,
  autoFixFile: fileAnalyzer.autoFixFile,
  FILE_CACHE: fileAnalyzer.FILE_CACHE,
  getFileContent: fileAnalyzer.getFileContent,
};
