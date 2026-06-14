/**
 * scripts/lib/helpers/file-cache.js
 * 
 * File Cache 功能
 * 
 * 從 auto_fix.js 原 Lines 49-79 拆分出來
 * 
 * 用於快取檔案內容，避免重複讀取
 */

const fs = require('fs');

// Hash Cache - 避免同一檔案被重複讀取
// { path: { mtime, hash, content, lines, size } }
const FILE_CACHE = new Map();

/**
 * 獲取檔案內容（使用 Cache）
 * 首次讀取後快取，後續調用直接返回快取的內容
 * 
 * 原 Lines 60-79
 * 
 * @param {string} filePath - 檔案路徑
 * @returns {Object} - { mtime, content, lines, size }
 */
function getFileContent(filePath) {
  if (FILE_CACHE.has(filePath)) {
    return FILE_CACHE.get(filePath);
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = fs.statSync(filePath);
    const cached = {
      mtime: stats.mtimeMs,
      content,
      lines: content.split('\n'),
      size: stats.size,
    };
    FILE_CACHE.set(filePath, cached);
    return cached;
  } catch (e) {
    // 讀取失敗時返回空對象，調用方處理
    return { mtime: 0, content: '', lines: [], size: 0 };
  }
}

module.exports = {
  FILE_CACHE,
  getFileContent,
};
