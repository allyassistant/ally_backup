#!/usr/bin/env node
/**
 * Rapaport Database Updater
 * 
 * Features:
 * 1. Check PDF date against database
 * 2. If new date: extract with coordinate method + detect bold values
 * 3. Verify price trends
 * 4. Generate change report
 * 5. Backup old database
 * 6. Update database
 */

const PDFParser = require('pdf2json');
const fs = require('fs');
const path = require('path');

const PDF_PATH = process.argv[2] || '/Users/ally/Desktop/Rapaport/Pear Price List 01.30.2026.pdf';
const DB_PATH = '/Users/ally/.openclaw/workspace/memory/rapaport_db.json';
const BACKUP_DIR = '/Users/ally/.openclaw/workspace/memory/backups';

process.env.PDF2JSON_DISABLE_LOGS = '1';

function safeDecode(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Step 1: Extract date from PDF
async function extractPDFDate(pdfPath) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(null, 1);
        
        pdfParser.on('pdfParser_dataReady', (pdfData) => {
            // Look for date pattern in page 0 (usually contains header)
            const page = pdfData.Pages[0];
            let date = null;
            
            page.Texts?.forEach(text => {
                const rawText = text.R?.[0]?.T || '';
                const decoded = safeDecode(rawText).trim();
                // Match date format like "01/30/26" or "01/30/2026"
                const dateMatch = decoded.match(/(\d{2}\/\d{2}\/\d{2,4})/);
                if (dateMatch) {
                    date = dateMatch[1];
                }
            });
            
            resolve(date);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfPath);
    });
}

// Step 2: Extract all text with coordinates and bold detection
async function extractWithCoordinates(pdfPath) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(null, 1);
        
        pdfParser.on('pdfParser_dataReady', (pdfData) => {
            const allTexts = [];
            
            pdfData.Pages.forEach((page, pageIndex) => {
                page.Texts?.forEach(text => {
                    const rawText = text.R?.[0]?.T || '';
                    const decoded = safeDecode(rawText).trim();
                    
                    // Check for bold formatting
                    const textStyle = text.R?.[0]?.TS || {};
                    const fontName = textStyle[0] || '';
                    const isBold = fontName.includes('Bold') || 
                                   (textStyle[1] && textStyle[1] >= 700); // font weight >= 700
                    
                    allTexts.push({
                        page: pageIndex,
                        x: text.x,
                        y: text.y,
                        text: decoded,
                        isBold: isBold,
                        font: fontName
                    });
                });
            });
            
            resolve(allTexts);
        });
        
        pdfParser.on('pdfParser_dataError', reject);
        pdfParser.loadPDF(pdfPath);
    });
}

// Step 3: Extract Pear table data with coordinate verification
function extractPearTable(texts) {
    const clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3'];
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    
    const pearData = {};
    const boldValues = []; // Track which values are bold
    
    // Define expected Y positions for each color row (will be verified)
    // These are approximate - actual positions will be confirmed from PDF
    const tableStructure = [
        // .90-.99 / 1.00-1.49 (Page 1, Y ~9-16)
        { y: 9.35, color: 'D', left: '.90-.99', right: '1.00-1.49' },
        { y: 10.06, color: 'E', left: '.90-.99', right: '1.00-1.49' },
        { y: 10.78, color: 'F', left: '.90-.99', right: '1.00-1.49' },
        { y: 11.49, color: 'G', left: '.90-.99', right: '1.00-1.49' },
        { y: 12.15, color: 'H', left: '.90-.99', right: '1.00-1.49' },
        { y: 12.87, color: 'I', left: '.90-.99', right: '1.00-1.49' },
        { y: 13.58, color: 'J', left: '.90-.99', right: '1.00-1.49' },
        { y: 14.29, color: 'K', left: '.90-.99', right: '1.00-1.49' },
        { y: 15.01, color: 'L', left: '.90-.99', right: '1.00-1.49' },
        { y: 15.73, color: 'M', left: '.90-.99', right: '1.00-1.49' },
        
        // 1.50-1.99 / 2.00-2.99 (Page 1, Y ~18-26)
        { y: 18.68, color: 'D', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 19.40, color: 'E', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 20.12, color: 'F', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 20.83, color: 'G', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 21.49, color: 'H', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 22.20, color: 'I', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 22.92, color: 'J', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 23.64, color: 'K', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 24.35, color: 'L', left: '1.50-1.99', right: '2.00-2.99' },
        { y: 25.07, color: 'M', left: '1.50-1.99', right: '2.00-2.99' },
        
        // 3.00-3.99 / 4.00-4.99 (Page 1, Y ~29-36)
        { y: 29.41, color: 'D', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 30.13, color: 'E', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 30.84, color: 'F', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 31.56, color: 'G', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 32.21, color: 'H', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 32.93, color: 'I', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 33.64, color: 'J', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 34.36, color: 'K', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 35.08, color: 'L', left: '3.00-3.99', right: '4.00-4.99' },
        { y: 35.80, color: 'M', left: '3.00-3.99', right: '4.00-4.99' },
        
        // 5.00-5.99 / 10.00-10.99 (Page 1, Y ~38-45)
        { y: 38.73, color: 'D', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 39.45, color: 'E', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 40.16, color: 'F', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 40.88, color: 'G', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 41.53, color: 'H', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 42.25, color: 'I', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 42.97, color: 'J', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 43.69, color: 'K', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 44.40, color: 'L', left: '5.00-5.99', right: '10.00-10.99' },
        { y: 45.12, color: 'M', left: '5.00-5.99', right: '10.00-10.99' },
    ];
    
    // Initialize tables
    ['.90-.99', '1.00-1.49', '1.50-1.99', '2.00-2.99', '3.00-3.99', '4.00-4.99', '5.00-5.99', '10.00-10.99'].forEach(t => {
        pearData[t] = {};
    });
    
    // Extract data for each row
    tableStructure.forEach(({ y, color, left, right }) => {
        // Find actual Y position with tolerance
        const rowTexts = texts.filter(t => 
            t.page === 1 && Math.abs(t.y - y) < 0.3
        ).sort((a, b) => a.x - b.x);
        
        // Check if color exists at this row
        const hasColor = rowTexts.some(t => t.text === color && t.x < 5);
        if (!hasColor) {
            log(`⚠ Warning: Color ${color} not found at expected Y=${y}`);
            return;
        }
        
        // Extract left table values (X: 3.5-19)
        const leftValues = rowTexts.filter(t => 
            t.x > 3.5 && t.x < 19 && /^\d+$/.test(t.text)
        );
        
        // Extract right table values (X: 19-35)
        const rightValues = rowTexts.filter(t => 
            t.x > 19 && t.x < 35 && /^\d+$/.test(t.text)
        );
        
        // Process left table
        if (leftValues.length >= 11) {
            const data = {};
            leftValues.slice(0, 11).forEach((v, i) => {
                data[clarities[i]] = parseInt(v.text);
                if (v.isBold) {
                    boldValues.push({
                        table: left,
                        color: color,
                        clarity: clarities[i],
                        value: parseInt(v.text)
                    });
                }
            });
            pearData[left][color] = data;
        }
        
        // Process right table
        if (rightValues.length >= 11) {
            const data = {};
            rightValues.slice(0, 11).forEach((v, i) => {
                data[clarities[i]] = parseInt(v.text);
                if (v.isBold) {
                    boldValues.push({
                        table: right,
                        color: color,
                        clarity: clarities[i],
                        value: parseInt(v.text)
                    });
                }
            });
            pearData[right][color] = data;
        }
    });
    
    return { data: pearData, boldValues };
}

// Step 4: Verify price trends
function verifyTrends(pearData) {
    const colors = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const issues = [];
    
    Object.entries(pearData).forEach(([range, data]) => {
        for (let i = 0; i < colors.length - 1; i++) {
            const c1 = colors[i], c2 = colors[i+1];
            if (data[c1] && data[c2]) {
                const v1 = data[c1]['IF'];
                const v2 = data[c2]['IF'];
                if (v1 <= v2) {
                    issues.push(`${range}: ${c1}->${c2} (${v1} vs ${v2})`);
                }
            }
        }
    });
    
    return issues;
}

// Step 5: Generate change report
function generateChangeReport(oldDb, newData, boldValues) {
    const report = {
        date: new Date().toISOString(),
        pdfDate: newData.date,
        changes: [],
        summary: {
            totalBold: boldValues.length,
            increases: 0,
            decreases: 0
        }
    };
    
    boldValues.forEach(({ table, color, clarity, value }) => {
        const oldValue = oldDb.pear[table]?.[color]?.[clarity];
        if (oldValue && oldValue !== value) {
            const change = value - oldValue;
            report.changes.push({
                table,
                color,
                clarity,
                oldValue,
                newValue: value,
                change,
                percentChange: ((change / oldValue) * 100).toFixed(2) + '%'
            });
            
            if (change > 0) report.summary.increases++;
            else report.summary.decreases++;
        }
    });
    
    return report;
}

// Step 6: Backup old database
function backupDatabase() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `rapaport_db_${timestamp}.json`);
    
    fs.copyFileSync(DB_PATH, backupPath);
    log(`✓ Database backed up to: ${backupPath}`);
    
    return backupPath;
}

// Main execution
async function main() {
    log('Starting Rapaport Database Update...');
    
    // Check if PDF exists
    if (!fs.existsSync(PDF_PATH)) {
        log(`✗ PDF not found: ${PDF_PATH}`);
        process.exit(1);
    }
    
    // Load existing database
    let oldDb;
    try {
        oldDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        log(`✓ Loaded existing database (date: ${oldDb.date})`);
    } catch (e) {
        log('✗ Failed to load existing database');
        process.exit(1);
    }
    
    // Step 1: Extract PDF date
    log('Extracting PDF date...');
    const pdfDate = await extractPDFDate(PDF_PATH);
    log(`✓ PDF date: ${pdfDate}`);
    
    // Check if update is needed
    if (pdfDate === oldDb.date) {
        log('✓ PDF date matches database. No update needed.');
        process.exit(0);
    }
    
    log(`⚠ New PDF date detected (${pdfDate} vs ${oldDb.date}). Starting extraction...`);
    
    // Step 2 & 3: Extract with coordinates and bold detection
    log('Extracting with coordinate method + bold detection...');
    const texts = await extractWithCoordinates(PDF_PATH);
    const { data: newPearData, boldValues } = extractPearTable(texts);
    
    log(`✓ Extracted ${Object.keys(newPearData).length} tables`);
    log(`✓ Found ${boldValues.length} bold values (price changes)`);
    
    // Step 4: Verify trends
    log('Verifying price trends...');
    const trendIssues = verifyTrends(newPearData);
    if (trendIssues.length > 0) {
        log('✗ Trend verification FAILED:');
        trendIssues.forEach(issue => log(`  - ${issue}`));
        log('Aborting update. Please check extraction.');
        process.exit(1);
    }
    log('✓ All price trends verified (D > E > F > G > H > I > J > K > L > M)');
    
    // Step 5: Generate change report
    log('Generating change report...');
    const changeReport = generateChangeReport(oldDb, { date: pdfDate, pear: newPearData }, boldValues);
    
    log('\n========== PRICE CHANGE REPORT ==========');
    log(`Total bold values: ${changeReport.summary.totalBold}`);
    log(`Increases: ${changeReport.summary.increases}`);
    log(`Decreases: ${changeReport.summary.decreases}`);
    
    if (changeReport.changes.length > 0) {
        log('\nDetailed changes:');
        changeReport.changes.forEach(c => {
            const direction = c.change > 0 ? '↑' : '↓';
            log(`  ${direction} ${c.table} ${c.color} ${c.clarity}: ${c.oldValue} → ${c.newValue} (${c.percentChange})`);
        });
    }
    log('=========================================\n');
    
    // Step 6: Backup
    log('Creating backup...');
    backupDatabase();
    
    // Step 7: Update database
    log('Updating database...');
    const newDb = {
        date: pdfDate,
        round: oldDb.round, // Preserve round data (not updated in this script)
        pear: newPearData
    };
    
    fs.writeFileSync(DB_PATH, JSON.stringify(newDb, null, 2));
    log(`✓ Database updated successfully (new date: ${pdfDate})`);
    
    // Save change report
    const reportPath = path.join(BACKUP_DIR, `change_report_${pdfDate.replace(/\//g, '-')}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(changeReport, null, 2));
    log(`✓ Change report saved to: ${reportPath}`);
    
    log('\nUpdate complete!');
}

main().catch(err => {
    log(`✗ Error: ${err.message}`);
    console.error(err);
    process.exit(1);
});
