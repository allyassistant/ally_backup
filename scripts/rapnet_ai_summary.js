#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * RapNet AI Summary Generator
 * 生成文章摘要（實際生成由主session調用sessions_spawn處理）
 */

const fs = require('fs');
const path = require('path');

const { MEMORY_DIR } = require('./lib/config');
const DATA_FILE = path.join(MEMORY_DIR, 'rapnet-latest.json');

// 檢查是否已有完整 summary（所有文章都有且最少20字符）
function hasExistingSummaries(articles) {
  return articles.length > 0 && articles.every(a => a.summary && a.summary.length > 20);
}

async function main() {
  log('🤖 RapNet AI Summary - Starting...\n');

  // 讀取數據
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    log('❌ 找不到數據文件，請先運行 rapnet_weekly.js');
    process.exit(1);
  }

  const articles = data.articles || [];
  if (articles.length === 0) {
    log('⚠️ 沒有文章');
    return;
  }

  // 檢查是否已有 summary
  if (hasExistingSummaries(articles)) {
    log('✅ 文章已有摘要，跳過');
    articles.forEach((a, i) => {
      if (a.summary) {
        log(`  ${i + 1}. ${a.summary.substring(0, 60)}...`);
      }
    });
    return;
  }

  log(`📝 準備生成 ${articles.length} 篇摘要...\n`);

  // 生成 prompt
  const articleList = articles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');

  const prompt = `用繁體中文生成以下 ${articles.length} 篇 RapNet 文章既摘要，每篇 2-3 句：

${articleList}

Output JSON：
[
  {"title": "標題", "summary": "2-3句摘要內容"},
  ...
]

請只返回 JSON array，格式要正確可以直接 parse。`;

  log('─'.repeat(50));
  log('\n📋 請用 sessions_spawn 生成摘要：\n');
  log(`openclaw sessions spawn --model "minimax-portal/MiniMax-M2.7" --task "YOUR_PROMPT" --mode run\n`);
  log('─'.repeat(50));
  log('\n✅ 或者等我幫你叫...');
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
