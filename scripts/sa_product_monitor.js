#!/usr/bin/env node
/**
 * S.A Group Product Monitor
 * 監察產品頁面：
 * - 有 HTTP 200 回應 = 可訪問
 * - 冇 redirect 去主頁 = 可訪問
 */

const PRODUCTS = [
  'https://www.sagroup.com.hk/products/demo-macbook-pro-14-m4-pro-chip-1216%E2%80%91core24gb512gb-silver-2024',
  'https://www.sagroup.com.hk/products/demo-macbook-pro-16-m4-pro-chip-1420%E2%80%91core24gb512gb-space-black-2024'
];

const HOME_PAGE_SHORT = '/';
const HOME_PAGE_FULL = 'https://www.sagroup.com.hk/';

const discord = require('./lib/discord_push');

async function checkProduct(url) {
  try {
    const { default: fetch } = await import('node-fetch-native');
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const status = response.status;
    const locationHeader = response.headers.get('location') || '';

    // 判斷邏輯：
    // 1. HTTP 200 = 直接load到，100% available
    // 2. HTTP 301/302 + location 去產品頁面 = available
    // 3. HTTP 301/302 + location = / 或主頁 = NOT available

    const isOK = status === 200;
    const isRedirectToHome = locationHeader === HOME_PAGE_SHORT ||
                             locationHeader === HOME_PAGE_FULL ||
                             locationHeader === 'https://www.sagroup.com.hk';
    const isRedirectToProduct = status >= 300 && status < 400 && locationHeader && !isRedirectToHome;

    const available = isOK || isRedirectToProduct;

    return {
      url,
      status,
      location: locationHeader || '(none)',
      available,
      isOK,
      isRedirectToProduct,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return { url, error: e.message };
  }
}

async function main() {
  console.log('🔍 Checking products...');

  for (const url of PRODUCTS) {
    const result = await checkProduct(url);

    if (result.available) {
      console.log(`✅ ${url} - AVAILABLE!`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Location: ${result.location}`);

      // Send Discord notification
      const msg = result.isOK
        ? `🚨 產品已經可以訪問！(200 OK)\n${url}`
        : `🚨 產品已經可以訪問！(Redirect)\n${url}`;
      // discord.push is fail-soft: returns { ok, error } instead of throwing.
      const result2 = discord.push({ message: msg, target: 'channel:1483875735377805434' });
      if (!result2.ok) console.log('Notify error:', result2.error);
    } else if (result.error) {
      console.log(`❌ ${url} - Error: ${result.error}`);
    } else {
      // Silent - still redirected to home
    }
  }
}

main();
