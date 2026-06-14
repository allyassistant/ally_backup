#!/usr/bin/env node
/**
 * system_check_bot.js - System Check Bot (Refactored)
 * =====================================================
 * 每日系統健康報告發送到 Discord #⚙️系統
 *
 * 重構版本：
 * - 所有 CONFIG/Templates → system_check_templates.js
 * - 所有 Generator 邏輯 → system_check_generator.js
 * - Main script 只保留：數據收集 + 發送
 *
 * 用法：
 *   node system_check_bot.js           # 正常模式
 *   node system_check_bot.js --quiet   # 安靜模式
 *   node system_check_bot.js --json    # 輸出 JSON
 *   node system_check_bot.js --md      # 輸出 Markdown
 *
 * VERSION: 2.0.0 (Refactored)
 * AUTHOR: Ally (2026-04-14)
 */

'use strict';

const { SystemCheckGenerator } = require('./lib/system_check_generator');

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const outputFormat = args.includes('--json') ? 'json' :
    args.includes('--md') ? 'markdown' : 'discord';

  const log = (...args) => { if (!quiet) console.log(...args); };

  log('🔧 Running system check...');

  try {
    // Create generator
    const generator = new SystemCheckGenerator({
      format: outputFormat,
      quiet
    });

    // Collect all data
    await generator.collectAll();

    // Generate output
    const output = generator.generate(outputFormat);

    if (outputFormat === 'json') {
      console.log(output);
    } else if (outputFormat === 'markdown') {
      console.log(output);
    }

    // Send to Discord (default)
    if (outputFormat === 'discord') {
      const sent = await generator.sendToDiscord();
      if (sent) {
        log('✅ 已發送到 Discord #⚙️系統');
      } else {
        console.error('❌ 發送到 Discord 失敗');
        process.exitCode = 1;
      }
    }

    log('System check complete');

  } catch (e) {
    console.error('❌ System check failed:', e.message, '\nStack:', e.stack);
    process.exitCode = 1;
  }
}

// Run
main().catch(e => {
  console.error(e);
  process.exit(1);
});
