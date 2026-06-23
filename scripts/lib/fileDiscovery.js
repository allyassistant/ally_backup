#!/usr/bin/env node
/**
 * fileDiscovery.js - 統一文件發現模組
 * 支援增量掃描（mtime + hash）、統一緩存機制
 *
 * Created: 2026-04-05
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteSync } = require('./config');

// ==================== 常量定義 ====================
const DEFAULT_CACHE_DIR = path.join(process.env.HOME || require('os').homedir(), '.openclaw', 'workspace', '.cache', 'file-discovery');
const DEFAULT_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h'];
const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', 'coverage', '.cache'];
const DEFAULT_EXCLUDE_FILES = ['.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

// CQM-005: 文件大小限制常量
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB for discovery module

// ==================== Cache Manager ====================
class CacheManager {
  constructor(cacheFile) {
    this.cacheFile = cacheFile;
    this.cache = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      }
    } catch (err) {
      console.error(`⚠️ Failed to load cache: ${err.message}`);
    }
    return { files: {}, lastScan: null, version: '1.0' };
  }

  save() {
    try {
      atomicWriteSync(this.cacheFile, this.cache);
    } catch (err) {
      console.error(`⚠️ Failed to save cache: ${err.message}`);
    }
  }

  get(filePath) {
    return this?.cache?.files[filePath];
  }

  set(filePath, entry) {
    this.cache.files[filePath] = {
      mtime: entry.mtime,
      hash: entry.hash,
      size: entry.size,
      scannedAt: new Date().toISOString()
    };
  }

  isValid(filePath, mtime, size) {
    const cached = this?.cache?.files[filePath];
    if (!cached) return false;
    return cached.mtime === mtime && cached.size === size;
  }

  clear() {
    this.cache = { files: {}, lastScan: null, version: '1.0' };
    this.save();
  }

  getStats() {
    const files = Object.keys(this?.cache?.files);
    return {
      totalCached: files.length,
      lastScan: this?.cache?.lastScan,
      version: this?.cache?.version
    };
  }

  updateLastScan() {
    if (this?.cache) {
      this.cache.lastScan = new Date().toISOString();
    }
  }
}

// ==================== File Discovery ====================
class FileDiscovery {
  constructor(options = {}) {
    this.extensions = options.extensions || DEFAULT_EXTENSIONS;
    this.excludeDirs = new Set(options.excludeDirs || DEFAULT_EXCLUDE_DIRS);
    this.excludeFiles = new Set(options.excludeFiles || DEFAULT_EXCLUDE_FILES);
    this.cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
    this.enableCache = options.enableCache !== false;
    this.cacheName = options.cacheName || 'default';

    // Initialize cache
    if (this.enableCache) {
      try {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      } catch (e) {
        throw new Error(`Failed to create cache dir: ${e.message}`);
      }
      this.cache = new CacheManager(path.join(this.cacheDir, `${this.cacheName}.json`));
    } else {
      this.cache = null;
    }
  }

  /**
   * 計算文件 hash
   * CQM-005: 添加文件大小檢查
   * CQM-012: 明確編碼處理
   */
  computeHash(filePath) {
    try {
      // CQM-005: 檢查文件大小
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        console.warn(`⚠️ File too large, skipping hash: ${filePath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
        return null;
      }

      // CQM-012: 使用二進制讀取計算 hash
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    } catch (err) {
      return null;
    }
  }

  /**
   * 檢查是否為目標文件
   */
  isTargetFile(fileName) {
    if (this?.excludeFiles?.has(fileName)) return false;
    const ext = path.extname(fileName).toLowerCase();
    return this?.extensions?.includes(ext);
  }

  /**
   * 檢查是否應該跳過目錄
   */
  shouldSkipDir(dirName) {
    return this?.excludeDirs?.has(dirName);
  }

  /**
   * 掃描單個目錄
   * CQM-003: 添加參數驗證
   */
  scanDirectory(dirPath, options = {}) {
    // CQM-003: null/undefined 輸入驗證
    if (!dirPath) {
      throw new Error('dirPath is required and cannot be null/undefined');
    }

    if (typeof dirPath !== 'string') {
      throw new Error(`dirPath must be a string, got ${typeof dirPath}`);
    }

    const results = [];
    const changed = [];
    const unchanged = [];
    const errors = [];

    const recursiveScan = (currentPath, relativePath = '', depth = 0) => {
      // Cap recursion depth (default 10) to prevent infinite loops on symlink
      // cycles or accidentally-deep trees.
      const maxDepth = options.maxDepth ?? 10;
      if (depth > maxDepth) return;

      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          const relPath = path.join(relativePath, entry.name);

          if (entry.isDirectory()) {
            if (!this.shouldSkipDir(entry.name)) {
              // Use lstat (not stat) to detect symlinks — skip them to avoid
              // following symlink loops
              try {
                const lstat = fs.lstatSync(fullPath);
                if (lstat.isSymbolicLink()) continue;
              } catch (_) { /* lstat failure: skip the entry defensively */ }
              recursiveScan(fullPath, relPath, depth + 1);
            }
          } else if (entry.isFile() && this.isTargetFile(entry.name)) {
            try {
              const stat = fs.statSync(fullPath);
              const mtime = stat?.mtime?.getTime();
              const size = stat.size;

              const fileInfo = {
                path: fullPath,
                relativePath: relPath,
                name: entry.name,
                ext: path.extname(entry.name).toLowerCase(),
                size,
                mtime,
                mtimeISO: stat?.mtime?.toISOString()
              };

              // 檢查緩存
              if (this.cache && this?.cache?.isValid(fullPath, mtime, size)) {
                const cached = this?.cache?.get(fullPath);
                fileInfo.hash = cached.hash;
                fileInfo.fromCache = true;
                unchanged.push(fileInfo);
              } else {
                // 計算 hash
                fileInfo.hash = this.computeHash(fullPath);
                fileInfo.fromCache = false;

                if (this.cache) {
                  this?.cache?.set(fullPath, fileInfo);
                }
                changed.push(fileInfo);
              }

              results.push(fileInfo);
            } catch (err) {
              errors.push({ path: fullPath, error: err.message });
            }
          }
        }
      } catch (err) {
        errors.push({ path: currentPath, error: err.message });
      }
    };

    recursiveScan(dirPath);

    if (this.cache) {
      this?.cache?.updateLastScan();
      this?.cache?.save();
    }

    return {
      files: results,
      changed,
      unchanged,
      errors,
      stats: {
        total: results.length,
        changed: changed.length,
        unchanged: unchanged.length,
        errors: errors.length,
        cacheHitRate: results.length > 0 ? (unchanged.length / results.length * 100).toFixed(1) : 0
      }
    };
  }

  /**
   * 掃描多個目錄
   * CQM-003: 添加參數驗證
   */
  scanDirectories(dirPaths, options = {}) {
    // CQM-003: null/undefined 輸入驗證
    if (!dirPaths) {
      throw new Error('dirPaths is required and cannot be null/undefined');
    }

    if (!Array.isArray(dirPaths)) {
      throw new Error(`dirPaths must be an array, got ${typeof dirPaths}`);
    }

    const allResults = {
      files: [],
      changed: [],
      unchanged: [],
      errors: [],
      stats: {
        total: 0,
        changed: 0,
        unchanged: 0,
        errors: 0,
        cacheHitRate: 0
      }
    };

    for (const dirPath of dirPaths) {
      try {
        if (!fs.existsSync(dirPath)) {
          allResults?.errors?.push({ path: dirPath, error: 'Directory does not exist' });
          continue;
        }
      } catch (e) {
        allResults?.errors?.push({ path: dirPath, error: `existsSync failed: ${e.message}` });
        continue;
      }

      const result = this.scanDirectory(dirPath, options);
      allResults?.files?.push(...result.files);
      allResults?.changed?.push(...result.changed);
      allResults?.unchanged?.push(...result.unchanged);
      allResults?.errors?.push(...result.errors);
    }

    // 重新計算統計
    allResults.stats.total = allResults?.files?.length;
    allResults.stats.changed = allResults?.changed?.length;
    allResults.stats.unchanged = allResults?.unchanged?.length;
    allResults.stats.errors = allResults?.errors?.length;
    allResults.stats.cacheHitRate = allResults?.stats?.total > 0
      ? (allResults?.stats?.unchanged / allResults.stats.total * 100).toFixed(1)
      : 0;

    return allResults;
  }

  /**
   * 比較兩次掃描結果的差異
   */
  diff(previousFiles, currentFiles) {
    const prevMap = new Map(previousFiles.map(f => [f.path, f]));
    const currMap = new Map(currentFiles.map(f => [f.path, f]));

    const added = [];
    const removed = [];
    const modified = [];

    for (const [path, file] of currMap) {
      if (!prevMap.has(path)) {
        added.push(file);
      } else if (prevMap.get(path).hash !== file.hash) {
        modified.push({
          previous: prevMap.get(path),
          current: file
        });
      }
    }

    for (const [path, file] of prevMap) {
      if (!currMap.has(path)) {
        removed.push(file);
      }
    }

    return { added, removed, modified };
  }

  /**
   * 獲取緩存統計
   */
  getCacheStats() {
    return this.cache ? this?.cache?.getStats() : null;
  }

  /**
   * 清除緩存
   */
  clearCache() {
    if (this.cache) {
      this?.cache?.clear();
    }
  }
}

// ==================== 便捷函數 ====================
function createFileDiscovery(options = {}) {
  return new FileDiscovery(options);
}

function quickScan(dirPath, options = {}) {
  const discovery = new FileDiscovery(options);
  return discovery.scanDirectory(dirPath);
}

// ==================== Export ====================
module.exports = {
  FileDiscovery,
  CacheManager,
  createFileDiscovery,
  quickScan,
  DEFAULT_EXTENSIONS,
  DEFAULT_EXCLUDE_DIRS,
  DEFAULT_EXCLUDE_FILES
};
