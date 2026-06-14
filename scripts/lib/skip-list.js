/**
 * skip-list.js - Skip List for Pattern Scanner
 *
 * Defines patterns and locations that should be skipped during scanning.
 * This complements the whitelist_patterns.js for FP management.
 *
 * Created: 2026-04-06
 */

const path = require('path');

// ==================== Skip List 配置 ====================
const SKIP_LIST_CONFIG = {
  VERSION: '1.0.0',

  // 目錄級別跳過（這些目錄完全不做掃描）
  skipDirectories: [
    'node_modules',
    '.git',
    'archive',
    '_legacy',
    '.state',
    '.cache',
    'coverage',
    'dist',
    'build',
    '.next'
  ],

  // 文件級別跳過
  skipFiles: [
    '.gitkeep',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml'
  ],

  // 文件擴展名跳過
  skipExtensions: [
    '.json',
    '.md',
    '.txt',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.log'
  ],

  // 行內模式跳過（註釋中的數字不應被標記為 magic_numbers）
  commentPatterns: [
    /^\s*\/\//,              // Single line comment: //
    /^\s*\*\//,              // Block comment end: */
    /^\s*\/\*/,              // Block comment start: /*
    /^\s*<!--/,               // HTML comment
    /^\s*#/,                 // Python/shell comment
    /^\s*--/,                // SQL comment
  ],

  // 安全的數字模式（不應被標記為 magic_numbers）
  safeNumberPatterns: [
    // 版本號
    /ecmaVersion:\s*\d{4}/,                    // ecmaVersion: 2022
    /es\d{4}/,                                 // es2022, es2023
    /version:\s*"\d+\.\d+/,                   // version: "1.0"

    // 時間相關
    /timeout:\s*\d{4,}/,                       // timeout: 5000, 10000
    /delay:\s*\d{4,}/,                         // delay: 1000, 5000
    /interval:\s*\d{4,}/,                      // interval: 30000

    // 字節轉換
    /\/\s*\d{3,4}\b/,                          // / 1024, / 3600

    // Discord ID patterns
    /\d{16,20}/,                               // Discord snowflakes

    // 日期年份（常見格式）
    /\b(19|20)\d{2}\b/,                        // 2022, 2026

    // 行號引用
    /原\s*Lines?\s*\d+[-\d]*/,                // 原 Lines 1100-1600
    /Lines?\s*\d+[-\d]*/,                      // Lines 100-200

    // 修復標記
    /\(修復\s*\d{4}-\d{2}-\d{2}\)/,           // (修復 2026-04-04)

    // Buffer sizes
    /maxBuffer:\s*\d+/,                        // maxBuffer: 1024*1024
  ],

  // 安全的 execSync 模式（已有 try-catch 包裝的）
  safeExecPatterns: [
    /require\s*\(\s*['"]child_process['"]\s*\)/,  // require('child_process')
    /import\s*\{[^}]*execSync[^}]*\}\s*from/,      // import { execSync } from 'child_process'
    /const\s*\{[^}]*execSync[^}]*\}\s*=\s*require/, // const { execSync } = require(...)
  ]
};

// ==================== SkipList 類別 ====================
class SkipList {
  constructor(options = {}) {
    this.options = { ...SKIP_LIST_CONFIG, ...options };
  }

  /**
   * shouldSkipDirectory - 檢查是否應該跳過目錄
   */
  shouldSkipDirectory(dirPath) {
    const basename = path.basename(dirPath);
    return this.options.skipDirectories.some(
      skip => basename === skip || basename.startsWith(skip + '/')
    );
  }

  /**
   * shouldSkipFile - 檢查是否應該跳過文件
   */
  shouldSkipFile(filePath) {
    const basename = path.basename(filePath);

    // 完整文件名校對
    if (this.options.skipFiles.includes(basename)) {
      return true;
    }

    // 擴展名校對
    const ext = path.extname(filePath).toLowerCase();
    if (this.options.skipExtensions.includes(ext)) {
      return true;
    }

    return false;
  }

  /**
   * isCommentLine - 檢查是否為註釋行
   */
  isCommentLine(line) {
    const trimmed = line.trim();
    return this.options.commentPatterns.some(pattern => pattern.test(trimmed));
  }

  /**
   * isSafeNumber - 檢查據字是否安全（不應被標記為 magic number）
   */
  isSafeNumber(line, matchStart, matchEnd) {
    // 檢查周圍上下文
    const context = line.substring(
      Math.max(0, matchStart - 30),
      Math.min(line.length, matchEnd + 30)
    );

    return this.options.safeNumberPatterns.some(pattern => pattern.test(context));
  }

  /**
   * isSafeExec - 檢查是否為安全的 execSync 使用
   */
  isSafeExec(line) {
    return this.options.safeExecPatterns.some(pattern => pattern.test(line));
  }

  /**
   * getSkipPatterns - 獲取跳過模式（用於 Scanner）
   */
  getSkipPatterns() {
    return {
      directories: this.options.skipDirectories,
      files: this.options.skipFiles,
      extensions: this.options.skipExtensions,
      patterns: this.options.commentPatterns.map(p => p.source)
    };
  }
}

// ==================== Export ====================
module.exports = {
  SkipList,
  SKIP_LIST_CONFIG
};

// Run if called directly
if (require.main === module) {
  const skipList = new SkipList();

  console.log('\n📋 Skip List Configuration:');
  console.log(JSON.stringify(skipList.getSkipPatterns(), null, 2));

  // Test some cases
  console.log('\n🧪 Test Cases:');
  console.log(`  "archive/": ${skipList.shouldSkipDirectory('archive/')}`);
  console.log(`  "node_modules": ${skipList.shouldSkipDirectory('node_modules')}`);
  console.log(`  "test.js": ${skipList.shouldSkipFile('test.js')}`);
  console.log(`  "README.md": ${skipList.shouldSkipFile('README.md')}`);
  console.log(`  "// comment": ${skipList.isCommentLine('// comment')}`);
  console.log(`  "ecmaVersion: 2022": ${skipList.isSafeNumber('ecmaVersion: 2022', 15, 19)}`);
}
