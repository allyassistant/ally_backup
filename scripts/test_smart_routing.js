#!/usr/bin/env node
/**
 * Smart Routing 自動測試腳本
 * Usage: node test_smart_routing.js
 */

const fs = require('fs');
const { routeModel } = require('./router/model_router.js');
const { classifySync } = require('./router/classifier.js');

const ROUTE_FILE = '/tmp/last_routing_decision.json';

const TEST_CASES = [
  { text: '幫我 research 下 Rust async runtime', expectedRoute: 'SPAWN', expectedProvider: 'minimax-portal' },
  { text: '改個 bug', expectedRoute: 'CODE', expectedProvider: 'minimax-portal' },
  { text: '今日 status 點？', expectedRoute: 'DIRECT_ANSWER', expectedProvider: 'deepseek' },
  { text: '食咗飯未', expectedRoute: 'NONE', expectedProvider: 'deepseek' },
  { text: '幫我寫個 Python script 抓取網頁', expectedRoute: 'CODE', expectedProvider: 'minimax-portal' },
  { text: '分析下呢個數據', expectedRoute: 'SPAWN', expectedProvider: 'minimax-portal' },
  { text: '有冇收到email', expectedRoute: 'SOP', expectedProvider: 'deepseek' },
];

async function run() {
  let pass = 0;
  let fail = 0;

  console.log('═══════════════════════════════════════════════════');
  console.log('  Smart Routing 自動測試');
  console.log('═══════════════════════════════════════════════════\n');

  for (const t of TEST_CASES) {
    // 1. 測試 classifier
    const cls = classifySync(t.text);
    const routeOk = cls.route === t.expectedRoute;

    // 2. 測試 model router
    const cfg = await routeModel({ text: t.text, route: cls.route.toLowerCase(), context: {} });
    const providerOk = cfg.provider === t.expectedProvider;
    const success = routeOk && providerOk;

    const status = success ? '✅ PASS' : '❌ FAIL';
    if (success) pass++; else fail++;

    console.log(`${status}  ${t.text}`);
    if (!success) {
      console.log(`       expected: route=${t.expectedRoute} provider=${t.expectedProvider}`);
      console.log(`       actual:   route=${cls.route} provider=${cfg.provider} model=${cfg.model}`);
    } else {
      console.log(`       -> ${cfg.provider} / ${cfg.model}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  結果: ${pass}/${TEST_CASES.length} 通過, ${fail} 失敗`);
  console.log('═══════════════════════════════════════════════════');

  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('測試出錯:', e);
  process.exit(1);
});
