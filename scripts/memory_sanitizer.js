#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Memory Sanitizer
 * 檢查併清理 memory 檔案中嘅 binary content
 * 防止 Excel/media attachments 污染 memory 檔案
 *
 * 使用方法:
 *   node scripts/memory_sanitizer.js --check     # 檢查所有 memory 檔案
 *   node scripts/memory_sanitizer.js --auto      # 自動清理 (Heartbeat 用)
 *   node scripts/memory_sanitizer.js --fix FILE  # 清理指定檔案
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { MEMORY_DIR, atomicWriteSync } = require('./lib/config');
const BACKUP_DIR = path.join(MEMORY_DIR, '_binary_backups');

// Binary signatures to detect
const BINARY_SIGNATURES = [
  { name: 'Excel OLE', hex: 'D0CF11E0', offset: 0 },  // application/x-cfb
  { name: 'Excel ZIP', hex: '504B0304', offset: 0 },  // Modern .xlsx
  { name: 'PDF', hex: '25504446', offset: 0 },        // %PDF
  { name: 'JPEG', hex: 'FFD8FF', offset: 0 },         // JPEG
  { name: 'PNG', hex: '89504E47', offset: 0 },        // PNG
  { name: 'GIF', hex: '47494638', offset: 0 },        // GIF
  { name: 'Null bytes', pattern: /\x00{4,}/ },        // 4+ null bytes
];

// Ensure backup dir exists
try {
  if (!fs.existsSync(BACKUP_DIR)) {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    } catch (e) {
      console.error('Error creating directory: ' + e.message);
    }
  }
} catch (err) {
  console.error('Error checking file: ' + err.message);
}

/**
 * 檢查檔案係咪有 binary content
 */
function hasBinaryContent(filePath) {
  try {
    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch (e) {
      console.error('Error: ' + e.message);
      return { hasBinary: false, error: e.message };
    }
    if (stats.size < 100) return { hasBinary: false }; // Too small

    // Read first 8KB
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch (e) {
      console.error('Error: ' + e.message);
      return { hasBinary: false, error: e.message };
    }
    const buffer = Buffer.alloc(8192);
    let bytesRead;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
    } catch (e) {
      console.error('Error: ' + e.message);
      fs.closeSync(fd);
      return { hasBinary: false, error: e.message };
    }
    try {
      fs.closeSync(fd);
    } catch (e) {
      console.error('Error: ' + e.message);
    }

    const content = buffer.toString('utf8', 0, bytesRead);
    const hexStart = buffer.toString('hex', 0, 8).toUpperCase();

    // Check signatures
    for (const sig of BINARY_SIGNATURES) {
      if (sig.hex && hexStart.startsWith(sig.hex)) {
        return {
          hasBinary: true,
          type: sig.name,
          position: 'start',
          hex: hexStart
        };
      }
      if (sig.pattern && sig.pattern.test(content)) {
        return {
          hasBinary: true,
          type: sig.name,
          position: 'content'
        };
      }
    }

    // Check for high ratio of non-printable chars
    const nonPrintable = (content.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || []).length;
    const ratio = nonPrintable / content.length;
    if (ratio > 0.1) { // More than 10% binary
      return {
        hasBinary: true,
        type: 'High binary ratio',
        position: 'scattered',
        ratio: Math.round(ratio * 100)
      };
    }

    return { hasBinary: false };
  } catch (err) {
    return { hasBinary: false, error: err.message };
  }
}

/**
 * 清理 binary content (只保留可讀文字)
 */
function sanitizeFile(filePath, dryRun = false) {
  try {
    // Backup first
    const fileName = path.basename(filePath);
    const backupPath = path.join(BACKUP_DIR, `${fileName}.backup-${Date.now()}`);

    if (!dryRun) {
      try {
        fs.copyFileSync(filePath, backupPath);
      } catch (e) {
        console.error('Error: ' + e.message);
        return { success: false, error: e.message };
      }
    }

    // Read and clean
    let content;
    try {
      content = fs.readFileSync(filePath);
    } catch (e) {
      console.error('Error: ' + e.message);
      return { success: false, error: e.message };
    }

    // Method: Use strings-like approach - keep only valid UTF-8 sequences
    // Replace null bytes and control chars with newlines
    let cleaned;
    try {
      cleaned = content.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '\n');
    } catch (e) {
      console.error('Error converting buffer to UTF-8 string: ' + e.message);
      return { success: false, error: 'Invalid UTF-8 encoding in file: ' + e.message };
    }

    // Remove excessive newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    if (!dryRun) {
      try {
        atomicWriteSync(filePath, cleaned);
      } catch (e) {
        console.error('Error writing file atomically: ' + e.message);
        return { success: false, error: e.message };
      }
    }

    const originalSize = content.length;
    const cleanedSize = Buffer.byteLength(cleaned, 'utf8');

    return {
      success: true,
      originalSize,
      cleanedSize,
      reduction: Math.round((1 - cleanedSize/originalSize) * 100),
      backupPath: dryRun ? null : backupPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Log contamination error via error_tracker.js CLI
 * 當發現污染時，透過 CLI 記錄錯誤以便 Error AutoFix 追蹤
 */
function logContaminationError(fileName, checkResult) {
  try {
    // Call error_tracker.js CLI
    execFileSync('node', [
      'scripts/error_tracker.js',
      'add',
      '--title', `Memory file contamination detected: ${fileName}`,
      '--problem', `Binary content (${checkResult.type}) found in memory file`,
      '--solution', 'Auto-cleaned by memory_sanitizer.js. File backed up to _binary_backups/'
    ], {
      cwd: path.dirname(__dirname),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    log(`   📝 Logged via error_tracker.js`);
  } catch (e) {
    // CLI 失敗，記錄但唔 block 主流程
    console.error(`⚠️ addErrorViaTracker failed: ${e.message}`);
  }
}

/**
 * 檢查所有 memory 檔案
 */
function checkAll() {
  log('🔍 Checking memory files for binary content...\n');

  let files = [];
  try {
    files = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => ({
        name: f,
        path: path.join(MEMORY_DIR, f)
      }));
  } catch (err) {
    log(`❌ Failed to read memory directory: ${err.message}`);
    return 0;
  }

  let found = 0;
  let totalSize = 0;
  let binarySize = 0;

  for (const file of files) {
    let stats;
    try {
      stats = fs.statSync(file.path);
    } catch (err) {
      log(`⚠️  ${file.name}: stat failed - ${err.message}`);
      continue;
    }
    totalSize += stats.size;

    const check = hasBinaryContent(file.path);
    if (check.hasBinary) {
      found++;
      binarySize += stats.size;
      log(`⚠️  ${file.name}`);
      log(`   Type: ${check.type}`);
      log(`   Size: ${(stats.size / 1024).toFixed(1)} KB`);
      if (check.position) log(`   Position: ${check.position}`);
      log('');
    }
  }

  log('='.repeat(50));
  log(`Checked: ${files.length} files`);
  log(`Clean: ${files.length - found} files`);
  log(`⚠️  Contaminated: ${found} files`);
  log(`Total size: ${(totalSize / 1024).toFixed(1)} KB`);
  if (binarySize > 0) {
    log(`Binary waste: ${(binarySize / 1024).toFixed(1)} KB`);
  }

  return found;
}

/**
 * Auto-clean (for Heartbeat)
 */
function autoClean() {
  log('🧹 Memory Sanitizer (Auto mode)\n');

  let files = [];
  try {
    files = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => path.join(MEMORY_DIR, f));
  } catch (err) {
    log(`❌ Failed to read memory directory: ${err.message}`);
    return 0;
  }

  let cleaned = 0;
  let saved = 0;

  for (const filePath of files) {
    const check = hasBinaryContent(filePath);
    if (check.hasBinary) {
      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch (err) {
        log(`⚠️  ${path.basename(filePath)}: stat failed - ${err.message}`);
        continue;
      }
      const result = sanitizeFile(filePath, false);
      if (result.success) {
        cleaned++;
        saved += (stats.size - result.cleanedSize);
        log(`✅ Cleaned: ${path.basename(filePath)} (-${result.reduction}%)`);
        // Log to errors.json for Error AutoFix integration
        logContaminationError(path.basename(filePath), check);
      }
    }
  }

  if (cleaned === 0) {
    log('✅ All memory files are clean');
  } else {
    log(`\n🎉 Cleaned ${cleaned} file(s), saved ${(saved / 1024).toFixed(1)} KB`);
  }

  return cleaned;
}

// Main
const args = process.argv.slice(2);

if (args.includes('--check')) {
  const found = checkAll();
  process.exit(found > 0 ? 1 : 0);
} else if (args.includes('--auto')) {
  const cleaned = autoClean();
  process.exit(0);
} else if (args.includes('--fix') && args[args.indexOf('--fix') + 1]) {
  const filePath = args[args.indexOf('--fix') + 1];
  const fullPath = path.resolve(filePath);

  log(`🔧 Fixing: ${filePath}\n`);
  const check = hasBinaryContent(fullPath);

  if (!check.hasBinary) {
    log('✅ File is already clean');
    process.exit(0);
  }

  log(`Found: ${check.type}`);
  const result = sanitizeFile(fullPath, false);

  if (result.success) {
    log(`✅ Cleaned successfully`);
    log(`   Size: ${(result.originalSize / 1024).toFixed(1)} KB → ${(result.cleanedSize / 1024).toFixed(1)} KB`);
    log(`   Reduction: ${result.reduction}%`);
    log(`   Backup: ${result.backupPath}`);
  } else {
    log(`❌ Failed: ${result.error}`);
    process.exit(1);
  }
} else {
  log(`
Memory Sanitizer
================

Prevents binary content (Excel, images, etc.) from contaminating memory files.

Usage:
  node scripts/memory_sanitizer.js --check          # Check all files
  node scripts/memory_sanitizer.js --auto           # Auto-clean (Heartbeat)
  node scripts/memory_sanitizer.js --fix FILE       # Fix specific file

Examples:
  node scripts/memory_sanitizer.js --check
  node scripts/memory_sanitizer.js --fix memory/2026-02-24-0717.md
  `);
}
