#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * RapNet Weekly Scraper
 * 使用 Browser 工具抓取 RapNet Resources 並保存到 JSON
 * 支援去重邏輯
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { getHKTDate, getHKTDateTime } = require('./lib/time');

const RAPNET_URL = 'https://www.rapnet.com/resources/';
const RAPNET_BASE_URL = 'https://www.rapnet.com';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SUMMARY_MAX_CHARS = 6000;
const MAX_ARTICLES = 5;
const { MEMORY_DIR } = require('./lib/config');
const DATA_FILE = path.join(MEMORY_DIR, 'rapnet-latest.json');
const STATE_FILE = path.join(MEMORY_DIR, 'rapnet-weekly-state.json');
const { createStateManager } = require('./lib/state');
const { load: loadState, save: saveState } = createStateManager(STATE_FILE, { lastCheck: null, lastArticleIds: [] });

const IMPORTANT_KEYWORDS = [
  'rapaport', 'price', 'prices', 'market', 'markets',
  'diamond', 'diamonds', 'trend', 'trends', 'report',
  'analysis', 'forecast', 'news', 'update', 'industry'
];

function saveData(data) {
  try {
    const tmpPath = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, DATA_FILE);
  } catch (e) {
    console.error('Error: ' + e.message);
  }
}

function isImportantArticle(title, excerpt = '') {
  const text = (title + ' ' + excerpt).toLowerCase();
  return IMPORTANT_KEYWORDS.some(keyword => text.includes(keyword));
}

// 去重 helper
function isDuplicate(articles, title, url) {
  // 完全相同既 title 或 URL
  if (articles.some(a => a.title === title || a.url === url)) return true;

  // URL 相同既（即使query strings唔同）
  const baseUrl1 = url.split('?')[0];
  const baseUrl2 = articles.map(a => a.url.split('?')[0]);
  if (baseUrl2.includes(baseUrl1)) return true;

  return false;
}

// 使用 Browser 工具抓取頁面
async function scrapeWithBrowser() {
  try {
    log('🌐 啟動 Browser 抓取 RapNet...');
    let targetId = null;

    log('  → 開啟瀏覽器...');
    let openResult;
    try {
      openResult = execFileSync('openclaw', ['browser', 'open', RAPNET_URL], { encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      console.error('Browser open failed: ' + e.message);
      throw e;
    }

    const idMatch = openResult.match(/id:\s*([A-F0-9]+)/i);
    if (idMatch) targetId = idMatch[1];
    if (!targetId) throw new Error('無法獲取 browser target ID');

    log(`  → Browser ID: ${targetId}`);
    log('  → 聚焦到頁面...');
    try {
      execFileSync('openclaw', ['browser', 'focus', targetId], { timeout: 10000 });
    } catch (e) {
      console.error('Browser focus failed: ' + e.message);
      throw e;
    }

    log('  → 等待頁面載入 (3秒)...');
    await new Promise(r => setTimeout(r, 3000));

    log('  → 獲取頁面內容...');
    let snapshotResult;
    try {
      snapshotResult = execFileSync('openclaw', ['browser', 'snapshot'], { encoding: 'utf8', timeout: 30000 });
    } catch (e) {
      console.error('Browser snapshot failed: ' + e.message);
      throw e;
    }

    log('  → 關閉瀏覽器...');
    try {
      execFileSync('openclaw', ['browser', 'close', targetId], { timeout: 10000 });
    } catch (e) {}

    return snapshotResult;

  } catch (err) {
    if (targetId) {
      try {
        execFileSync('openclaw', ['browser', 'close', targetId], { timeout: 10000 });
      } catch (e) {}
    }
    throw err;
  }
}

// 從頁面內容提取文章（加強去重）
function extractArticles(content) {
  try {
    const articles = [];
    const addedUrls = new Set();

    const headingPattern = /heading "([^"]+)" \[level=(\d+)\](?: \[ref=e(\d+)\])?:\s*\n\s*- link "[^"]*"(?: \[ref=e(\d+)\])?:\s*\n\s*- \/url: ([^\n]+)/gi;

    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      const title = match[1].trim();
      const url = match[5].trim();

      // 過濾無效標題
      if (title.length < 10 || title.length > 200) continue;
      if (title.toLowerCase().includes('thumbnail')) continue;
      if (title.toLowerCase().includes('read more')) continue;
      if (title.toLowerCase().includes('watch now')) continue;
      if (!url.startsWith('http')) continue;

      // 去重：用 URL base path 比較
      const urlBase = url.split('?')[0];
      if (addedUrls.has(urlBase)) continue;
      addedUrls.add(urlBase);

      articles.push({
        title,
        url: url,
        summary: '',
        date: getHKTDate(),
        important: isImportantArticle(title)
      });

      if (articles.length >= MAX_ARTICLES) break;
    }

    // Pattern 2 fallback
    if (articles.length === 0) {
      const simplePattern = /- link "([^"]{20,150})" [^\n]*\n\s*- \/url: (https?:\/\/[^\n]+)/gi;
      while ((match = simplePattern.exec(content)) !== null) {
        const title = match[1].trim();
        const url = match[2].trim();

        if (title.length < 15 || title.length > 150) continue;
        if (title.toLowerCase().includes('menu')) continue;
        if (title.toLowerCase().includes('login')) continue;
        if (!url.includes('/blog/') && !url.includes('/case-studies/') && !url.includes('/webinar/') && !url.includes('/guides/')) continue;

        // 去重
        const urlBase = url.split('?')[0];
        if (addedUrls.has(urlBase)) continue;
        addedUrls.add(urlBase);

        articles.push({
          title,
          url: url,
          summary: '',
          date: getHKTDate(),
          important: isImportantArticle(title)
        });

        if (articles.length >= MAX_ARTICLES) break;
      }
    }

    return articles.slice(0, MAX_ARTICLES);
  } catch (e) {
    console.error('Error extracting articles: ' + e.message);
    return [];
  }
}

// 主函數
async function main() {
  try {
    log('🔍 RapNet Weekly Scraper - Starting...\n');

    const state = loadState();
    let html = null;
    let usedBrowser = false;

    try {
      html = await scrapeWithBrowser();
      usedBrowser = true;
      log('✅ Browser 抓取成功\n');
    } catch (err) {
      log(`⚠️ Browser 抓取失敗: ${err.message}`);
    }

    let articles = [];
    if (html) {
      articles = extractArticles(html);
      log(`📊 提取到 ${articles.length} 篇文章`);

      articles.forEach((a, i) => {
        log(`   ${i + 1}. ${a.title.substring(0, 60)}`);
      });
      log();
    }

    const data = {
      scrapedAt: getHKTDateTime(),
      source: usedBrowser ? 'browser' : 'none',
      url: RAPNET_URL,
      articles: articles
    };

    saveData(data);
    log(`💾 數據已保存到: ${DATA_FILE}`);

    state.lastCheck = getHKTDateTime();
    saveState(state);

    if (articles.length === 0) {
      log('\n⚠️ 警告: 未能提取任何文章');
      process.exit(1);
    } else {
      log(`\n✅ 成功! 已提取 ${articles.length} 篇文章`);
      log(`   重要文章: ${articles.filter(a => a.important).length} 篇`);
    }
  } catch (err) {
    console.error('Error: ' + err.message);
    throw err;
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error:', err.message);
    saveData({
      scrapedAt: getHKTDateTime(),
      source: 'error',
      error: err.message,
      articles: []
    });
    process.exit(1);
  });
}

module.exports = { scrapeWithBrowser, extractArticles };
