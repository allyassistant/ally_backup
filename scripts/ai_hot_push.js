#!/usr/bin/env node
/**
 * ai_hot_push.js - AI HOT 每日精選推送 (thin executor, v2.0)
 *
 * v2.0 (2026-06-10): 繞過 cron announce LLM — script 直接 POST Discord API。
 *   用法: node scripts/ai_hot_push.js [--count N] [--feed curated|all|daily] [--channel-id ID] [--no-send]
 *   --channel-id: Discord channel ID (default: 1483099702512713829 = #AI🔥熱門)
 *   --no-send: stdout only, skip Discord POST (dry-run / test)
 * v1.1: 5 段分類 + dedup (.ai_hot_seen.json, 200-entry FIFO) + top-N 頭條 promotion.
 * 失敗 exit 1 (stderr); stdout 純 markdown.
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

// ── Discord direct-post config (v2.0) ──
const AI_HOT_CHANNEL = '1483099702512713829';  // #AI🔥熱門

const FEEDS = {
  curated: 'https://aihot.virxact.com/feed.xml',
  all: 'https://aihot.virxact.com/feed/all.xml',
  daily: 'https://aihot.virxact.com/feed/daily.xml'
};

// Dedup state (workspace root, 200-entry FIFO)
const SEEN_FILE = path.join(__dirname, '..', '.ai_hot_seen.json');
const SEEN_CAP = 200;

// -------- Category rules (apply in this order; 行業動態 = default catch-all) --------
// 1. 頭條  2. 產品更新  3. 研究/觀點  4. 行業動態  5. 開發者
const HEADLINE_AUTHORS = ['openai', 'anthropic', 'nvidia', 'minimax'];
const HEADLINE_MODELS = ['gpt-5', 'gpt-4.5', 'gpt-4o', 'claude-opus', 'claude-3.5', 'claude-3', 'h100', 'h200', 'a100', 'minimax-m3'];
const PRODUCT_VERBS = ['發布', 'launch', 'release', '上線', 'update', 'unveil', 'introducing', 'rolling out', 'ships', 'v2.0', 'beta', 'preview', 'early access', '新功能', 'feature'];
const PRODUCT_SOURCES = ['openrouter', 'suno', 'cursor', 'replit', 'midjourney', 'runway', 'elevenlabs', 'perplexity', 'figma', 'notion'];
const RESEARCH_KEYWORDS = ['論文', 'paper', 'stanford', 'mit ', 'berkeley', 'research', 'arxiv', 'benchmark', 'study', 'analysis'];
const RESEARCH_AUTHORS = ['marktechpost', 'gary marcus', 'ylecun', 'andrej karpathy', 'simon willison'];
const INDUSTRY_KEYWORDS = ['bloomberg', 'techcrunch', 'ipo', 'regulation', '政府', '法院', 'lawsuit', 'acquisition', '億', 'billion', 'antitrust', 'sec ', 'ftc', 'parliament', '估值', '融資', 'funding', 'market cap', 'microsoft', 'google', 'meta', 'apple', 'amazon', '合作', 'partnership'];
const DEVELOPER_KEYWORDS = ['github', 'python', 'rust', 'hugging face', 'sdk', 'cli', 'codex', '工具', 'library', 'framework', 'tutorial', 'open source', 'api', 'devtools', '開源', 'spec', 'toolkit', '工具包', '指令', 'command', 'agent framework', 'function call'];
const DEVELOPER_AUTHORS = ['hacker news', 'github blog', 'github releases'];

// Per-category caps (total target: 12-15 items)
const CATEGORY_CAPS = { headline: 3, product: 3, research: 3, industry: 4, developer: 3 };

// Display order (matches spec)
const CATEGORY_ORDER = [
  { key: 'headline',  label: '頭條' },
  { key: 'product',   label: '產品更新' },
  { key: 'research',  label: '研究/觀點' },
  { key: 'industry',  label: '行業動態' },
  { key: 'developer', label: '開發者' }
];

// -------- CLI args --------
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { count: 0, feed: 'curated', channelId: AI_HOT_CHANNEL, noSend: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (Number.isFinite(n) && n > 0) out.count = Math.min(n, 30);
      i++;
    } else if (args[i] === '--feed' && args[i + 1]) {
      const f = args[i + 1];
      if (FEEDS[f]) {
        out.feed = f;
      } else {
        console.error(`Unknown feed: ${f}. Available: ${Object.keys(FEEDS).join(', ')}`);
        process.exit(2);
      }
      i++;
    } else if (args[i] === '--channel-id' && args[i + 1]) {
      out.channelId = args[i + 1];
      i++;
    } else if (args[i] === '--no-send') {
      out.noSend = true;
    }
  }
  return out;
}

// -------- Discord direct-post (v2.0) --------
function getDiscordToken() {
  try {
    const configPath = path.join(process.env.HOME || '/home/ally', '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return (config.channels && config.channels.discord && config.channels.discord.token) || '';
  } catch (e) {
    return process.env.DISCORD_BOT_TOKEN || '';
  }
}

function sendToDiscord(content, channelId) {
  return new Promise((resolve, reject) => {
    const token = getDiscordToken();
    if (!token) return reject(new Error('No Discord bot token available'));
    const body = JSON.stringify({ content });
    const options = {
      hostname: 'discord.com',
      path: '/api/v10/channels/' + channelId + '/messages',
      method: 'POST',
      headers: {
        'Authorization': 'Bot ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        if (res.statusCode === 200 || res.statusCode === 201) resolve(true);
        else reject(new Error('HTTP ' + res.statusCode + ': ' + data.slice(0, 200)));
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Discord POST timeout')); });
    req.write(body);
    req.end();
  });
}

// ── v2.0: retry wrapper (exponential backoff, 3 attempts) ──
async function sendToDiscordWithRetry(content, channelId) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendToDiscord(content, channelId);
      return;
    } catch (err) {
      const transient = err.message.includes('429') || err.message.includes('rate') ||
                        /\b5\d{2}\b/.test(err.message) ||
                        err.message.includes('ETIMEDOUT') || err.message.includes('ECONNRESET');
      if (transient && attempt < maxAttempts) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.error(`Discord send attempt ${attempt}/${maxAttempts} failed (${err.message}) — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// -------- HTTPS fetch (no redirect) --------
function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (AI HOT push; +https://aihot.virxact.com)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 20000
      },
      (res) => {
        // Handle redirects
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchUrl(next, redirects + 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          // RSS feeds are usually < 1MB; hard cap 5MB
          if (data.length > 5 * 1024 * 1024) {
            req.destroy(new Error('Response too large'));
          }
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timeout (20s)')));
    req.on('error', reject);
  });
}

// -------- RSS parser (regex-based, no deps) --------
// Extract <item>...</item> blocks first, then sub-fields per block.
// v1.1: also extracts <guid> for dedup.
function parseRss(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const re = new RegExp(
        `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
        'i'
      );
      const r = block.match(re);
      return r ? stripCdata(r[1]).trim() : '';
    };
    items.push({
      title: get('title'),
      link: get('link'),
      description: get('description'),
      pubDate: get('pubDate'),
      author: get('author'),
      guid: get('guid') // v1.1: used for dedup (falls back to link in main)
    });
  }
  return items;
}

function stripCdata(s) {
  // Remove <![CDATA[ ... ]]> wrappers but keep inner content
  return s
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .trim();
}

// -------- Classification (v1.1) --------
// Apply in order: headline → product → research → industry → developer; 行業動態 = default.
function classifyItem(item) {
  const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  const author = cleanSource(item.author).toLowerCase();
  const inText = (kw) => text.includes(kw.toLowerCase());
  if (HEADLINE_AUTHORS.some(a => author.includes(a) || inText(a))) return 'headline';
  if (HEADLINE_MODELS.some(inText)) return 'headline';
  if (PRODUCT_SOURCES.some(p => inText(p) || author.includes(p))) return 'product';
  if (DEVELOPER_KEYWORDS.some(inText)) return 'developer';
  if (DEVELOPER_AUTHORS.some(a => author.includes(a))) return 'developer';
  if (PRODUCT_VERBS.some(inText)) return 'product';
  if (RESEARCH_KEYWORDS.some(inText)) return 'research';
  if (RESEARCH_AUTHORS.some(a => author.includes(a))) return 'research';
  if (INDUSTRY_KEYWORDS.some(inText)) return 'industry';
  return 'industry';
}

// -------- Scoring (v1.1) --------
// Recency (decays over ~200h) + source weight (headline authors highest).
function scoreItem(item) {
  const pubTime = new Date(item.pubDate).getTime();
  const ageHours = isNaN(pubTime) ? 9999 : (Date.now() - pubTime) / 3600000;
  const recency = Math.max(0, 100 - ageHours * 0.5); // 0-100, decays over 200h

  const author = cleanSource(item.author).toLowerCase();
  let sourceWeight = 10;
  if (HEADLINE_AUTHORS.some(a => author.includes(a))) sourceWeight = 50;
  else if (RESEARCH_AUTHORS.some(a => author.includes(a))) sourceWeight = 30;

  return recency + sourceWeight;
}

// -------- Categorization (v1.1) --------
// 1) Top-N promotion: latest 1-2 items (by pubDate) always go to 頭條.
// 2) Classify remaining into buckets. 3) Sort each bucket by score desc.
function categorizeItems(items) {
  const byPubDate = [...items].sort((a, b) => {
    const da = new Date(a.pubDate).getTime();
    const db = new Date(b.pubDate).getTime();
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });
  const promoteCount = Math.min(2, byPubDate.length);
  const buckets = { headline: [], product: [], research: [], industry: [], developer: [] };
  const promoted = new Set();
  for (let i = 0; i < promoteCount; i++) {
    buckets.headline.push(byPubDate[i]);
    promoted.add(byPubDate[i]);
  }
  for (const item of items) {
    if (promoted.has(item)) continue;
    buckets[classifyItem(item)].push(item);
  }
  // Sort: headline keeps promoted items at top (per spec "always promote"),
  // then fills with classified items by score. Other buckets: score desc.
  for (const key of Object.keys(buckets)) {
    if (key === 'headline') {
      const promotedItems = buckets.headline.filter(it => promoted.has(it));
      const classified = buckets.headline.filter(it => !promoted.has(it));
      classified.sort((a, b) => scoreItem(b) - scoreItem(a));
      buckets.headline = [...promotedItems, ...classified];
    } else {
      buckets[key].sort((a, b) => scoreItem(b) - scoreItem(a));
    }
  }
  return buckets;
}

// -------- Dedup state (v1.1) --------
function loadSeenGuids() {
  try {
    if (!fs.existsSync(SEEN_FILE)) return new Set();
    const raw = fs.readFileSync(SEEN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.guids)) return new Set(parsed.guids);
    return new Set();
  } catch (err) {
    // Corrupt/missing: treat as empty, don't fail the script
    return new Set();
  }
}

function saveSeenGuids(guids) {
  try {
    const arr = Array.from(guids);
    // FIFO: keep last SEEN_CAP entries
    const trimmed = arr.slice(-SEEN_CAP);
    fs.writeFileSync(SEEN_FILE, JSON.stringify({ guids: trimmed }, null, 2));
  } catch (err) {
    // Don't fail the script on save error
    console.error(`Warning: failed to save seen GUIDs: ${err.message}`);
  }
}

// -------- Discord formatting --------
function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).replace(/[\s,;:.!?。，；：！？]+$/, '') + '…';
}

function formatPubDate(pubDate) {
  if (!pubDate) return '';
  // RSS pubDate: "Sun, 07 Jun 2026 23:26:02 GMT"
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return '';
  // HKT = UTC+8
  const hkt = new Date(d.getTime() + 8 * 3600 * 1000);
  const mm = String(hkt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(hkt.getUTCDate()).padStart(2, '0');
  const hh = String(hkt.getUTCHours()).padStart(2, '0');
  const mi = String(hkt.getUTCMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function cleanSource(author) {
  // author format: "noreply@aihot.virxact.com (X：宝玉 (@dotey))"
  // 提取外層括號內容; 內部可以有 nested parens (@dotey 內的 () ).
  // 用 indexOf(' (') 拎第一個外層 open, lastIndexOf(')') 拎最尾個外層 close.
  if (!author) return 'AI HOT';
  const start = author.indexOf(' (');
  const end = author.lastIndexOf(')');
  if (start >= 0 && end > start + 1) {
    return author.slice(start + 2, end);
  }
  return author;
}

// Pre-render an item's static parts (title, meta) once; the variable part is summary length.
function preRenderItem(it, idx) {
  const title = it.title || '(無標題)';
  const url = it.link || '';
  const source = cleanSource(it.author);
  const time = formatPubDate(it.pubDate);
  const meta = [];
  meta.push(`📰 ${source}`);
  if (time) meta.push(`🕐 ${time}`);
  if (url) meta.push(`🔗 <${url}>`);
  const metaStr = meta.join(' · ');
  return {
    title: escapeMd(title),
    metaStr,
    block(summaryLen) {
      const summary = truncate(it.description || '', summaryLen);
      let s = `**${idx}. ${escapeMd(title)}**\n`;
      if (summary) {
        s += `> ${escapeMd(summary)}\n`;
      }
      s += metaStr + '\n';
      return s;
    }
  };
}

// Discord uses its own markdown subset; escape characters that could break formatting.
function escapeMd(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/(?<!\\)[*_`~|>]/g, (c) => `\\${c}`);
}

// -------- formatForDiscord (v1.2) --------
// 5-section categorized output, per-category caps, MULTI-MESSAGE support.
function formatForDiscord(items, opts) {
  const today = new Date();
  const hkt = new Date(today.getTime() + 8 * 3600 * 1000);
  const dateStr = `${hkt.getUTCFullYear()}-${String(hkt.getUTCMonth() + 1).padStart(2, '0')}-${String(hkt.getUTCDate()).padStart(2, '0')}`;
  const feedLabels = { curated: '精選', all: '全部動態', daily: '日報' };
  const label = feedLabels[opts.feed] || '精選';
  const header = `🔥 **AI HOT · ${label}** · ${dateStr}\n`;
  const MAX = 1900; // Discord cap is 2000, keep headroom

  const buckets = categorizeItems(items);
  const sections = [];
  let globalIdx = 0;
  let totalRemaining = opts.count > 0 ? opts.count : 16;
  for (const { key, label: catLabel } of CATEGORY_ORDER) {
    if (totalRemaining <= 0) break;
    const cap = Math.min(CATEGORY_CAPS[key], totalRemaining);
    const sectionItems = buckets[key].slice(0, cap);
    if (sectionItems.length === 0) continue;
    const sectionHeader = `### ${catLabel}（${sectionItems.length} 條）\n`;
    const itemsRendered = sectionItems.map(item => {
      globalIdx++;
      return preRenderItem(item, globalIdx);
    });
    sections.push({ header: sectionHeader, items: itemsRendered });
    totalRemaining -= sectionItems.length;
  }

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  if (totalItems === 0) {
    return [`${header}\n— 無新內容 — 來源 aihot.virxact.com\n`];
  }

  const SUMMARY_LEN = 180;
  const messages = [];
  let currentParts = [];
  let currentBytes = 0;

  function flush(isLast) {
    if (currentParts.length === 0) return;
    let msgHeaderStr;
    if (messages.length === 0) {
      msgHeaderStr = header;
    } else {
      msgHeaderStr = `🔥 **AI HOT · ${label}** · ${dateStr}（續 ${messages.length + 1}）\n`;
    }
    let body = currentParts.join('\n');
    let footer = isLast
      ? `\n— 共 ${totalItems} 條 — 來源 aihot.virxact.com`
      : `\n— 共 ${totalItems} 條（續 ${messages.length + 1}/~）—`;
    const finalMsg = msgHeaderStr + body + footer;
    if (Buffer.byteLength(finalMsg, 'utf8') > MAX) {
      footer = isLast ? `\n— 共 ${totalItems} 條 —` : `\n— 續 —`;
    }
    messages.push(msgHeaderStr + body + footer);
    currentParts = [];
    currentBytes = 0;
  }

  for (const section of sections) {
    const sectionPart = section.header.replace(/\n$/, '');
    const sectionBytes = Buffer.byteLength(sectionPart, 'utf8');

    for (const item of section.items) {
      const block = item.block(SUMMARY_LEN);
      const blockBytes = Buffer.byteLength(block, 'utf8');

      // Lazy-add section header: check if header + first item fit together.
      // If not, flush first so the header isn't orphaned in the previous message.
      const needsHeader = !currentParts.some(p => p === sectionPart);
      const totalAdd = (needsHeader ? sectionBytes + 1 : 0) + blockBytes + 10;

      if (currentBytes + totalAdd > MAX && currentParts.length > 0) {
        flush(false);
      }

      // Lazy-add section header (now confirmed to fit or in a fresh message)
      if (needsHeader) {
        currentParts.push(sectionPart);
        currentBytes += sectionBytes + 1;
      }

      currentParts.push(block);
      currentBytes += blockBytes + 1;
    }
  }

  flush(true);
  return messages;
}

// -------- Multi-message send (v1.2) --------
async function sendMessages(messages, opts) {
  for (let i = 0; i < messages.length; i++) {
    const channelId = opts.channelId || AI_HOT_CHANNEL;
    if (opts.noSend) {
      if (i === 0) {
        process.stdout.write(messages[i] + '\n');
      } else {
        // Print continuation messages to stderr in dry-run mode
        console.error('--- message ' + (i + 1) + ' ---');
        console.error(messages[i]);
      }
    } else {
      await sendToDiscordWithRetry(messages[i], channelId);
      if (i < messages.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  if (!opts.noSend && messages.length > 1) {
    console.error('Sent ' + messages.length + ' messages');
  }
}

// -------- Main --------
async function main() {
  const opts = parseArgs();
  const url = FEEDS[opts.feed];

  let xml;
  try {
    xml = await fetchUrl(url);
  } catch (err) {
    console.error(`AI HOT push failed (fetch): ${err.message}`);
    process.exit(1);
  }

  let items;
  try {
    items = parseRss(xml);
    // Convert Simplified Chinese → Traditional Chinese for all text fields
    const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
    for (const item of items) {
      item.title = s2t(item.title || '');
      item.description = s2t(item.description || '');
      item.author = s2t(item.author || '');
    }
  } catch (err) {
    console.error(`AI HOT push failed (parse): ${err.message}`);
    process.exit(1);
  }

  if (items.length === 0) {
    console.error('AI HOT push failed: RSS feed returned 0 items');
    process.exit(1);
  }

  // v1.1 dedup
  const seen = loadSeenGuids();
  const fresh = items.filter(item => {
    const id = item.guid || item.link;
    return id && !seen.has(id);
  });

  // If all seen, fall back to top 3 most recent (don't pollute seen list)
  let outputItems = fresh;
  if (fresh.length === 0) {
    const byDate = [...items].sort((a, b) => {
      const da = new Date(a.pubDate).getTime();
      const db = new Date(b.pubDate).getTime();
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });
    outputItems = byDate.slice(0, 3);
  }

  const messages = formatForDiscord(outputItems, opts);

  // ── v2.0: Direct Discord send (bypass cron announce LLM wrapping) ──
  if (opts.noSend) {
    // sendMessages handles dry-run: stdout for msg1, stderr for continuation msgs
    await sendMessages(messages, opts);
    console.error('--no-send: stdout only, skipping Discord POST (seen state not saved)');
  } else {
    try {
      await sendMessages(messages, opts);
      // Only save seen GUIDs on successful send
      if (fresh.length > 0) {
        const newGuids = outputItems.map(i => i.guid || i.link).filter(Boolean);
        saveSeenGuids(new Set([...seen, ...newGuids]));
      }
      console.error('Discord send OK → channel ' + (opts.channelId || AI_HOT_CHANNEL));
    } catch (discordErr) {
      console.error('Discord send FAILED (output still printed above): ' + discordErr.message);
    }
  }
}

main().catch((err) => {
  console.error(`AI HOT push failed (unexpected): ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
