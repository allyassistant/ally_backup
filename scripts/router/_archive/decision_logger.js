/**
 * Router Decision Logger — 手動記錄 routing decision
 *
 * 用法：喺 message 處理流程入面 call 呢個 function
 * 取代 internal hook（OpenClaw 呢個版本唔 support custom script hooks）
 *
 * Module Usage:
 *   const { logRoute } = require('./scripts/router/decision_logger');
 *   logRoute({ text: "幫我分析 report", route: "SPAWN", channel: "discord" });
 *
 * CLI Usage (via exec):
 *   node scripts/router/decision_logger.js --text "幫我分析" --route SPAWN --channel discord
 *   node scripts/router/decision_logger.js --text "check status" --channel discord
 */

const { classifySync, logDecision } = require('./classifier');
const fs = require('fs');

/**
 * 記錄 routing decision（手動版本）
 * 自動行 classifier + write log
 *
 * @param {Object} opts
 * @param {string} opts.text        - 原始訊息文字
 * @param {string} [opts.route]     - 實際採用嘅 route（省略 = 用 classifier suggestion）
 * @param {string} [opts.channel]   - 頻道
 * @param {string} [opts.messageId] - Discord message ID
 * @param {boolean} [opts.trivialSpawn]  - 係咪 trivial spawn（應該 direct answer）
 * @param {boolean} [opts.browserTabLeft] - browser 用完冇 close
 * @param {boolean} [opts.corrected]       - Josh 之後糾正咗呢個 decision
 */
function logRoute({ text, route, channel, messageId, trivialSpawn, browserTabLeft, corrected }) {
  const suggestion = classifySync(text);
  const actualRoute = route || suggestion.route;

  const extra = {};
  if (trivialSpawn !== undefined) extra.trivialSpawn = trivialSpawn;
  if (browserTabLeft !== undefined) extra.browserTabLeft = browserTabLeft;
  if (corrected !== undefined) extra.corrected = corrected;

  logDecision(
    {
      route: actualRoute,
      matched: suggestion.matched,
      rule: actualRoute === suggestion.route ? suggestion.rule : 'manual_override',
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    },
    text,
    { channel, messageId, suggested: suggestion.route }
  );

  return { actualRoute, suggestion };
}

/**
 * Check current log size
 */
function logStats() {
  const { decisionLogPath } = require('./config');
  if (!fs.existsSync(decisionLogPath)) return { entries: 0 };
  let lines;
  try {
    lines = fs.readFileSync(decisionLogPath, 'utf8').trim().split('\n').filter(Boolean);
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  return { entries: lines.length };
}

// ── CLI mode ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  if (flags.stats) {
    const s = logStats();
    console.log(`決策記錄: ${s.entries} 條`);
    process.exit(0);
  }

  if (!flags.text) {
    console.log('用法: node scripts/router/decision_logger.js --text "訊息" [--route X] [--channel discord]');
    console.log('      node scripts/router/decision_logger.js --stats');
    process.exit(1);
  }

  const result = logRoute({
    text: flags.text,
    route: flags.route || null,
    channel: flags.channel || 'webchat',
    messageId: flags['message-id'] || '',
  });
  console.log(`✅ 已記錄: ${result.actualRoute} (suggested: ${result.suggestion.route})`);
}

module.exports = { logRoute, logStats };
