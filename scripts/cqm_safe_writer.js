#!/usr/bin/env node
/**
 * cqm_safe_writer.js — Atomic write with backup and auto-revert
 *
 * Part of the Safe Auto-Fix Architecture (#189 Phase 4):
 * - Backup original to .bak before write
 * - Write to .tmp file (atomic intermediate)
 * - node --check validation after write
 * - On fail: delete .tmp, keep .bak
 * - On success: atomic rename .tmp → original
 * - Post-verify: re-run node --check, revert if fails
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const WORKSPACE_DIR = path.join(__dirname, '..');
const QUARANTINE_DIR = path.join(WORKSPACE_DIR, 'scripts', 'quarantine');
const BACKUP_TTL_DAYS = 7;

/**
 * Ensure quarantine directory exists
 */
function ensureQuarantineDir() {
  if (!fs.existsSync(QUARANTINE_DIR)) {
    fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  }
}

/**
 * Generate a unique fix ID
 */
function generateFixId(file, line) {
  const timestamp = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  const basename = path.basename(file, '.js');
  return `fix-${basename}-${line}-${timestamp}-${hash}`;
}

/**
 * Get backup file path
 */
function getBackupPath(file) {
  return `${file}.bak`;
}

/**
 * Get tmp file path
 */
function getTmpPath(file) {
  return `${file}.tmp.js`;
}

/**
 * Validate JavaScript syntax using node --check
 * @param {string} filePath - Path to file to validate
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateSyntax(filePath) {
  try {
    const result = spawnSync('node', ['--check', filePath], {
      encoding: 'utf8',
      timeout: 10000
    });

    if (result.status !== 0) {
      return {
        valid: false,
        error: result.stderr || `Exit code: ${result.status}`
      };
    }

    return { valid: true, error: null };
  } catch (err) {
    return {
      valid: false,
      error: err.message
    };
  }
}

/**
 * Create a backup of the original file
 * @param {string} file - Original file path
 * @returns {string|null} - Backup path or null on failure
 */
function createBackup(file) {
  const backupPath = getBackupPath(file);
  try {
    fs.copyFileSync(file, backupPath);
    return backupPath;
  } catch (err) {
    console.error(`[cqm_safe_writer] Backup failed for ${file}: ${err.message}`);
    return null;
  }
}

/**
 * Write content to a temp file
 * @param {string} file - Target file path
 * @param {string} content - Content to write
 * @returns {string|null} - Temp file path or null on failure
 */
function writeTmp(file, content) {
  const tmpPath = getTmpPath(file);
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    return tmpPath;
  } catch (err) {
    console.error(`[cqm_safe_writer] TMP write failed for ${file}: ${err.message}`);
    return null;
  }
}

/**
 * Atomic rename tmp → original
 * @param {string} file - Target file path
 * @returns {boolean} - Success
 */
function atomicRename(file) {
  const tmpPath = getTmpPath(file);
  try {
    fs.renameSync(tmpPath, file);
    return true;
  } catch (err) {
    console.error(`[cqm_safe_writer] Atomic rename failed for ${file}: ${err.message}`);
    return false;
  }
}

/**
 * Revert from backup
 * @param {string} file - Original file path
 * @returns {boolean} - Success
 */
function revertFromBackup(file) {
  const backupPath = getBackupPath(file);
  try {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, file);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[cqm_safe_writer] Revert failed for ${file}: ${err.message}`);
    return false;
  }
}

/**
 * Clean up tmp file if exists
 * @param {string} file - Target file path
 */
function cleanupTmp(file) {
  const tmpPath = getTmpPath(file);
  try {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  } catch (err) {
    // ignore cleanup errors
  }
}

/**
 * Perform a safe fix with full safety net
 * @param {string} file - File to fix
 * @param {string} originalCode - Original content
 * @param {string} fixedCode - Fixed content
 * @param {object} metadata - Fix metadata (confidence, reason, etc.)
 * @returns {{ status: 'success'|'failed'|'reverted', reason: string|null, backupPath: string|null }}
 */
function safeFix(file, originalCode, fixedCode, metadata = {}) {
  const { confidence = 1.0, reason = '', rule = '' } = metadata;
  const backupPath = getBackupPath(file);
  const tmpPath = getTmpPath(file);

  // Step 1: Create backup
  const backup = createBackup(file);
  if (!backup) {
    return { status: 'failed', reason: 'backup_failed', backupPath: null };
  }

  // Step 2: Write to tmp
  const tmp = writeTmp(file, fixedCode);
  if (!tmp) {
    return { status: 'failed', reason: 'tmp_write_failed', backupPath };
  }

  // Step 3: Validate tmp syntax
  const syntaxCheck = validateSyntax(tmpPath);
  if (!syntaxCheck.valid) {
    console.error(`[cqm_safe_writer] Syntax check failed for ${file}: ${syntaxCheck.error}`);
    cleanupTmp(file);
    return { status: 'failed', reason: 'syntax_invalid', backupPath };
  }

  // Step 4: Atomic rename
  if (!atomicRename(file)) {
    cleanupTmp(file);
    return { status: 'failed', reason: 'atomic_rename_failed', backupPath };
  }

  // Step 5: Post-write verification
  const postCheck = validateSyntax(file);
  if (!postCheck.valid) {
    console.error(`[cqm_safe_writer] Post-write check failed for ${file}: ${postCheck.error}`);
    console.log(`[cqm_safe_writer] Reverting from backup...`);
    revertFromBackup(file);
    return { status: 'reverted', reason: 'post_write_check_failed', backupPath };
  }

  // Success
  return {
    status: 'success',
    reason: null,
    backupPath
  };
}

/**
 * Write a quarantined fix (for MEDIUM confidence)
 * Writes to quarantine/ instead of overwriting the live file
 * @param {string} file - Original file path
 * @param {string} fixedCode - Fixed content
 * @param {object} metadata - Fix metadata
 * @returns {{ status: 'success'|'failed', quarantineId: string|null, quarantinePath: string|null }}
 */
function quarantineFix(file, fixedCode, metadata = {}) {
  ensureQuarantineDir();

  const fixId = generateFixId(file, metadata.line || 0);
  const { confidence = 0.75, reason = '', rule = '', originalCode = '' } = metadata;

  // Create quarantine entry
  const quarantineEntry = {
    id: fixId,
    originalFile: file,
    line: metadata.line || 0,
    confidence,
    reason,
    rule,
    originalCode,
    fixedCode,
    createdAt: new Date().toISOString(),
    status: 'pending',
    reviewedAt: null,
    reviewedBy: null
  };

  const entryPath = path.join(QUARANTINE_DIR, `${fixId}.meta.json`);
  const diffPath = path.join(QUARANTINE_DIR, `${fixId}.diff`);
  const originalPath = path.join(QUARANTINE_DIR, `${fixId}.original.js`);

  try {
    // Write metadata
    fs.writeFileSync(entryPath, JSON.stringify(quarantineEntry, null, 2), 'utf8');

    // Write original code
    if (originalCode) {
      fs.writeFileSync(originalPath, originalCode, 'utf8');
    }

    // Write diff (simplified)
    if (originalCode && fixedCode) {
      fs.writeFileSync(diffPath, `--- original\n+++ fixed\n${generateSimpleDiff(originalCode, fixedCode)}`, 'utf8');
    }

    return {
      status: 'success',
      quarantineId: fixId,
      quarantinePath: entryPath
    };
  } catch (err) {
    console.error(`[cqm_safe_writer] Quarantine write failed: ${err.message}`);
    return {
      status: 'failed',
      quarantineId: null,
      quarantinePath: null
    };
  }
}

/**
 * Generate a simple unified diff
 */
function generateSimpleDiff(original, fixed) {
  const originalLines = original.split('\n');
  const fixedLines = fixed.split('\n');
  const diff = [];

  let start = 0;
  let end = originalLines.length;

  // Find first difference
  while (start < originalLines.length && start < fixedLines.length && originalLines[start] === fixedLines[start]) {
    start++;
  }

  // Find last difference
  while (end > start && end > 0 && originalLines[end - 1] === fixedLines[end - 1]) {
    end--;
  }

  for (let i = start; i < end; i++) {
    if (originalLines[i] !== fixedLines[i]) {
      diff.push(`- ${originalLines[i]}`);
      diff.push(`+ ${fixedLines[i] || ''}`);
    }
  }

  return diff.slice(0, 20).join('\n'); // Cap at 20 lines
}

/**
 * Clean old backups (older than BACKUP_TTL_DAYS)
 */
function cleanOldBackups() {
  try {
    const files = fs.readdirSync(WORKSPACE_DIR);
    const now = Date.now();
    const maxAge = BACKUP_TTL_DAYS * 24 * 60 * 60 * 1000;

    let cleaned = 0;
    for (const file of files) {
      if (file.endsWith('.bak')) {
        const filePath = path.join(WORKSPACE_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
    }

    return cleaned;
  } catch (err) {
    return 0;
  }
}

/**
 * CLI entry point
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
cqm_safe_writer.js — Atomic write with backup and auto-revert

Usage:
  node cqm_safe_writer.js --fix <file> --code <content> [--confidence <n>] [--reason <text>]
  node cqm_safe_writer.js --quarantine <file> --code <content> [--confidence <n>]
  node cqm_safe_writer.js --clean-backups
  node cqm_safe_writer.js --validate <file>

Options:
  --fix <file>       Perform safe fix
  --code <content>   Fixed code (use @ to read from file)
  --confidence <n>   Confidence score (0.0-1.0)
  --reason <text>    Reason for the fix
  --quarantine       Write to quarantine instead of live file
  --clean-backups    Remove backups older than ${BACKUP_TTL_DAYS} days
  --validate <file>  Validate syntax of a file
`);
    process.exit(0);
  }

  if (args.includes('--clean-backups')) {
    const cleaned = cleanOldBackups();
    console.log(`Cleaned ${cleaned} old backup files`);
    process.exit(0);
  }

  const fixIdx = args.indexOf('--fix');
  const validateIdx = args.indexOf('--validate');

  if (validateIdx !== -1 && args[validateIdx + 1]) {
    const file = path.resolve(args[validateIdx + 1]);
    const result = validateSyntax(file);
    if (result.valid) {
      console.log(`✅ ${file} — syntax valid`);
    } else {
      console.error(`❌ ${file} — syntax invalid: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (fixIdx !== -1 && args[fixIdx + 1]) {
    const file = path.resolve(args[fixIdx + 1]);
    const codeIdx = args.indexOf('--code');
    const confIdx = args.indexOf('--confidence');
    const reasonIdx = args.indexOf('--reason');
    const isQuarantine = args.includes('--quarantine');

    let code = codeIdx !== -1 ? args[codeIdx + 1] : '';
    if (code.startsWith('@')) {
      code = fs.readFileSync(path.resolve(code.slice(1)), 'utf8');
    }

    const confidence = confIdx !== -1 ? parseFloat(args[confIdx + 1]) : 1.0;
    const reason = reasonIdx !== -1 ? args[reasonIdx + 1] : '';

    // Read original for metadata
    let originalCode = '';
    try {
      originalCode = fs.readFileSync(file, 'utf8');
    } catch (err) {
      console.error(`Cannot read original file: ${err.message}`);
      process.exit(1);
    }

    const metadata = { confidence, reason, originalCode };

    if (isQuarantine) {
      const result = quarantineFix(file, code, metadata);
      if (result.status === 'success') {
        console.log(`✅ Quarantined: ${result.quarantineId}`);
        console.log(`   Path: ${result.quarantinePath}`);
      } else {
        console.error(`❌ Quarantine failed`);
        process.exit(1);
      }
    } else {
      const result = safeFix(file, originalCode, code, metadata);
      if (result.status === 'success') {
        console.log(`✅ Fixed: ${file}`);
        console.log(`   Backup: ${result.backupPath}`);
      } else if (result.status === 'reverted') {
        console.error(`❌ Fix reverted: ${result.reason}`);
        console.error(`   Backup preserved: ${result.backupPath}`);
        process.exit(1);
      } else {
        console.error(`❌ Fix failed: ${result.reason}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  console.error('Usage: cqm_safe_writer.js [--fix <file> --code <content>] [--validate <file>] [--clean-backups] [--help]');
  process.exit(1);
}

module.exports = {
  safeFix,
  quarantineFix,
  validateSyntax,
  createBackup,
  revertFromBackup,
  cleanOldBackups,
  generateFixId,
  QUARANTINE_DIR
};

if (require.main === module) {
  main();
}
