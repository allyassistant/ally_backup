#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * RapNet Weekly Workflow
 * 整合抓取 + 發送，一鍵運行
 *
 * Usage: node scripts/rapnet_weekly_workflow.js
 * Cron: 0 10 * * 1 (每周一 10:00)
 */

const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = __dirname;

function runScript(scriptName) {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    log(`\n▶️ 運行: ${scriptName}\n`);

    try {
        const output = execFileSync('node', [scriptPath], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 120000 // 2分鐘超時 (already const in caller)
        });
        log(output);
        return { success: true, output };
    } catch (err) {
        log(err.stdout || '');
        console.error(`❌ ${scriptName} 失敗:`, err.message);
        return { success: false, error: err.message, output: err.stdout };
    }
}

async function main() {
  try {
    const startTime = new Date();
    log('╔════════════════════════════════════════╗');
    log('║     RapNet Weekly Workflow Started     ║');
    log(`║     ${startTime.toLocaleString('zh-HK')}        ║`);
    log('╚════════════════════════════════════════╝');

    // Step 1: 抓取
    const scrapeResult = runScript('rapnet_weekly.js');

    // Step 2: 發送（即使抓取失敗也嘗試發送，讓用戶知道狀態）
    const sendResult = runScript('rapnet_sender.js');

    // 總結
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    log('\n╔════════════════════════════════════════╗');
    log('║           Workflow Complete            ║');
    log('╠════════════════════════════════════════╣');
    log(`║ 抓取: ${scrapeResult.success ? '✅ 成功' : '❌ 失敗'}                ║`);
    log(`║ 發送: ${sendResult.success ? '✅ 成功' : '❌ 失敗'}                ║`);
    log(`║ 用時: ${duration}秒                       ║`);
    log(`║ 時間: ${endTime.toLocaleString('zh-HK')}        ║`);
    log('╚════════════════════════════════════════╝\n');

    // 如果都成功，返回 0；否則返回 1
    if (scrapeResult.success && sendResult.success) {
        process.exit(0);
    } else {
        process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Workflow error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
    main();
}
