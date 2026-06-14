#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const _log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Universal Rapaport Database Updater - Using pdfplumber for reliable extraction
 */
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PDF_PATH = process.argv[2];
const FORCE_TYPE = process.argv[3];

// ==================== FIX: Move require after variable declarations ====================
const { HOME, MEMORY_DIR, WS: WORKSPACE } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const { atomicWriteSync } = require('./lib/state');
const DB_PATH = path.join(MEMORY_DIR, 'rapaport_db.json');
const BACKUP_DIR = (() => { try { return path.join(MEMORY_DIR, 'backups'); } catch (e) { log(`⚠️ Failed to create BACKUP_DIR: ${e.message}`); return '/tmp/backups'; } })();
const DATA_JSON_PATH = (() => { try { return path.join(WORKSPACE, 'data.json'); } catch (e) { log(`⚠️ Failed to create DATA_JSON_PATH: ${e.message}`); return '/tmp/data.json'; } })();
const EXTRACT_SCRIPT = (() => { try { return path.join(WORKSPACE, 'scripts', 'extract_rapaport.py'); } catch (e) { log(`⚠️ Failed to create EXTRACT_SCRIPT: ${e.message}`); return ''; } })();

// ==================== FIX: Use console.log instead of recursive log() ====================
function log(msg) { console.log(`[${getHKTDateTime()}] ${msg}`); }

function compareChanges(oldDb, newDb) {
    const carats = ['.90-.99', '1.00-1.49', '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', '5.00-5.99', '10.00-10.99'];
    const shapes = ['round', 'pear'];

    log('\n=== 卡重範圍變動 Summary ===\n');

    shapes.forEach(shape => {
        if (!newDb[shape]) return;
        log(shape.toUpperCase() + ':');
        carats.forEach(c => {
            let hasChange = false;
            ['D','E','F','G','H'].forEach(clr => {
                if (oldDb[shape]?.[c]?.[clr] && newDb[shape]?.[c]?.[clr]) {
                    if (JSON.stringify(oldDb[shape][c][clr]) !== JSON.stringify(newDb[shape][c][clr])) {
                        hasChange = true;
                    }
                }
            });
            log('  ' + c + ': ' + (hasChange ? '❌ 有變動' : '✅ 無變動'));
        });
        log('');
    });
}

function detectPDFType(pdfPath) {
    const fn = path.basename(pdfPath).toLowerCase();
    if (fn.includes('pear')) return 'pear';
    if (fn.includes('round')) return 'round';
    return null;
}

function extractWithPython(pdfPath, pdfType) {
    const venvPython = path.join(WORKSPACE, '.venv', 'bin', 'python3');
    let pythonCmd;
    try {
        pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
    } catch (e) {
        console.error('Error checking file: ' + e.message);
        pythonCmd = 'python3';
    }

    // Validate pdfPath to prevent command injection
    if (!pdfPath || typeof pdfPath !== 'string') {
        log('✗ Invalid PDF path');
        return {};
    }
    // Only allow alphanumeric, dash, underscore, dot, slash
    if (!/^[/\w\-. ]+$/.test(pdfPath) || pdfPath.includes('..')) {
        log('✗ PDF path contains invalid characters');
        return {};
    }

    try {
        const output = execFileSync(pythonCmd, [
            EXTRACT_SCRIPT,
            pdfPath
        ], {
            encoding: 'utf8',
            maxBuffer: 10*1024*1024
        });
        const parsed = JSON.parse(output);
        return { data: parsed.data, date: parsed.date };
    } catch (e) {
        log(`✗ Extraction failed: ${e.message}`);
        return {};
    }
}

function verifyTrends(data) {
    const colorOrder = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const issues = [];
    Object.entries(data).forEach(([range, rangeData]) => {
        for (let i = 0; i < colorOrder.length - 1; i++) {
            const c1 = colorOrder[i], c2 = colorOrder[i+1];
            if (rangeData[c1]?.IF && rangeData[c2]?.IF) {
                if (rangeData[c1].IF <= rangeData[c2].IF) {
                    issues.push(`${range}: ${c1}->${c2} (${rangeData[c1].IF} vs ${rangeData[c2].IF})`);
                }
            }
        }
    });
    return issues;
}

function backupDatabase() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            try {
                fs.mkdirSync(BACKUP_DIR, { recursive: true });
            } catch (e) {
                console.error('⚠️ mkdir failed: ' + e.message);
                return;
            }
        }
        const ts = getHKTDateTime().replace(/[:.]/g, '-');
        const bp = path.join(BACKUP_DIR, `rapaport_db_${ts}.json`);
        try {
            fs.copyFileSync(DB_PATH, bp);
        } catch (e) {
            console.error('⚠️ copyFile failed: ' + e.message);
            return;
        }
        log(`✓ Backup: ${bp}`);
    } catch (err) {
        log(`⚠️ Backup failed: ${err.message}`);
    }
}

function copyToDataJson(newDb) {
    try {
        atomicWriteSync(DATA_JSON_PATH, newDb);
        log(`✓ Copied to data.json (${DATA_JSON_PATH})`);
    } catch (err) {
        log(`⚠️ Failed to copy to data.json: ${err.message}`);
    }
}

async function uploadToGitHub() {
    try {
        // Pre-flight checks
        log('⚠ Uploading to GitHub...');

        // Check if git is available
        try {
            execSync('which git', { stdio: 'ignore' });
        } catch {
            log('✗ Git not found in PATH');
            return false;
        }

        // Check if we're in a git repository
        try {
            execSync('git rev-parse --git-dir', { cwd: WORKSPACE, stdio: 'ignore' });
        } catch {
            log('✗ Not a git repository');
            return false;
        }

        // Check git configuration
        let userName, userEmail;
        try {
            userName = execSync('git config user.name', { cwd: WORKSPACE, encoding: 'utf8' }).trim();
        } catch (e) {
            console.error('⚠️ Command failed: ' + e.message);
            return;
        }
        try {
            userEmail = execSync('git config user.email', { cwd: WORKSPACE, encoding: 'utf8' }).trim();
        } catch (e) {
            console.error('⚠️ Command failed: ' + e.message);
            return;
        }
        if (!userName || !userEmail) {
            log('✗ Git user.name or user.email not configured');
            return false;
        }

        try {
            execSync('git add data.json', { cwd: WORKSPACE });
        } catch (e) {
            console.error('⚠️ Command failed: ' + e.message);
            return;
        }
        try {
            execSync('git commit -m "Update Rapaport data"', { cwd: WORKSPACE });
        } catch (e) {
            console.error('⚠️ Command failed: ' + e.message);
            return;
        }
        try {
            execSync('git push origin master:main', { cwd: WORKSPACE });
        } catch (e) {
            console.error('⚠️ Command failed: ' + e.message);
            return;
        }
        log('✓ Uploaded to GitHub');
        return true;
    } catch (e) {
        log(`⚠ GitHub upload failed: ${e.message}`);
        log('💡 You can manually upload with: git push origin master:main');
        return false;
    }
}

async function main() {
  try {
    log('=== Universal Rapaport Database Updater ===');
    if (!PDF_PATH) { log('✗ Usage: node scripts/update_rapaport_universal.js <pdf_path>'); process.exit(1); }
    if (!fs.existsSync(PDF_PATH)) { log(`✗ PDF not found`); process.exit(1); }

    let pdfType = FORCE_TYPE;
    if (!pdfType || pdfType === 'auto') pdfType = detectPDFType(PDF_PATH);
    if (!pdfType) { log('✗ Cannot detect PDF type'); process.exit(1); }
    log(`PDF type: ${pdfType.toUpperCase()}`);

    let oldDb;
    try {
      const fileContent = fs.readFileSync(DB_PATH, 'utf8');
      oldDb = JSON.parse(fileContent);
    } catch (e) {
      console.error('⚠️ File read failed: ' + e.message);
      return;
    }
    log(`✓ Loaded database (${oldDb.date})`);

    log(`⚠ Extracting from PDF...`);
    const extractionResult = extractWithPython(PDF_PATH, pdfType);
    const newData = extractionResult.data || {};
    const pdfDate = extractionResult.date;
    log(`✓ PDF date: ${pdfDate}`);

    if (!pdfDate || pdfDate === 'Unknown') { log('✗ Could not extract date from PDF'); process.exit(1); }
    if (pdfDate === oldDb.date) { log('✓ Same date, no update needed'); process.exit(0); }
    log(`⚠ New date detected (${pdfDate}), updating...`);

    Object.keys(newData).forEach(table => {
        const colors = Object.keys(newData[table]).length;
        if (colors > 0) log(`✓ Extracted ${table}: ${colors} colors`);
    });

    const issues = verifyTrends(newData);
    if (issues.length > 0) {
        log('✗ Trend verification failed:'); issues.forEach(i => log(`  - ${i}`)); process.exit(1);
    }
    log('✓ Price trends verified');

    backupDatabase();

    const newDb = { ...oldDb, date: pdfDate };
    newDb[pdfType] = newData;
    try {
        atomicWriteSync(DB_PATH, newDb);
        log(`✓ Database updated (${pdfDate})`);
    } catch (err) {
        log(`✗ Failed to update database: ${err.message}`);
        process.exit(1);
    }

    // Copy to data.json for GitHub
    copyToDataJson(newDb);

    // Upload to GitHub
    await uploadToGitHub();

    // Show change summary
    compareChanges(oldDb, newDb);

    log('\n✓ Update complete!');
  } catch (err) {
    log(`✗ Error: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => { log(`✗ Error: ${err.message}`); process.exit(1); });
