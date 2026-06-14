/**
 * Email Router — Phase 2
 *
 * Cost-aware email routing: 根據 email type 選擇最經濟嘅處理方式。
 *
 * Route Logic:
 * - MALCA_AMIT / TRACKING     → extract (零 LLM cost, static regex)
 * - RAPAPORT / RAPNET         → MiniMax (月費已包, subscription tier)
 * - CLIENT_EMAIL / OTHER      → DeepSeek V4 Flash (pay-per-token)
 *
 * Usage:
 *   const { routeEmail, EMAIL_TYPES } = require('./email_router');
 *   const { type, handler, model } = routeEmail({ subject, from, body });
 */

const path = require('path');

// ─── Email Type Definitions ───────────────────────────────────────────────────

/**
 * @typedef {Object} EmailTypeConfig
 * @property {'extract'|'llm_summarize'} handler  - Handler type
 * @property {string|null} model                  - Model name or null for extract
 * @property {'free'|'subscription'|'pay_per_token'} costTier
 * @property {string} description
 */

/** @type {Record<string, EmailTypeConfig>} */
const EMAIL_TYPES = {
  MALCA_AMIT: {
    handler: 'extract',
    model: null,
    costTier: 'free',
    description: 'Malca-Amit 珠寶物流運單通知 — static data extraction',
  },
  RAPAPORT: {
    handler: 'llm_summarize',
    model: 'minimax-portal/MiniMax-M2.7',
    costTier: 'subscription',
    description: 'Rapaport 官方價格表 — MiniMax 月費已包',
  },
  RAPNET: {
    handler: 'llm_summarize',
    model: 'minimax-portal/MiniMax-M2.7',
    costTier: 'subscription',
    description: 'RapNet 市場報告 — MiniMax 月費已包',
  },
  TRACKING: {
    handler: 'extract',
    model: null,
    costTier: 'free',
    description: '快遞/物流追蹤通知 — static regex extraction',
  },
  CLIENT_EMAIL: {
    handler: 'llm_summarize',
    model: 'deepseek/deepseek-v4-flash',
    costTier: 'pay_per_token',
    description: '客戶非結構化電郵 — 需要 LLM 理解複雜內容',
  },
  OTHER: {
    handler: 'llm_summarize',
    model: 'deepseek/deepseek-v4-flash',
    costTier: 'pay_per_token',
    description: '未能分類嘅電郵 — 預設 DeepSeek V4 Flash',
  },
};

// ─── Keyword Patterns ─────────────────────────────────────────────────────────

/** @type {Array<{type: string, patterns: RegExp[]}>} */
const TYPE_PATTERNS = [
  {
    type: 'MALCA_AMIT',
    patterns: [
      /malca[\-\s]?amit/i,
      /malcaamit/i,
    ],
  },
  {
    type: 'RAPNET',
    patterns: [
      /^.*@rapnet\.com/i,
      /rapnet\s*market/i,
      /rapnet\s*price/i,
    ],
  },
  {
    type: 'RAPAPORT',
    patterns: [
      /rapaport/i,
      /diamond\s*report/i,
      /polish\s*price/i,
      /round\s*price/i,
    ],
  },
  {
    type: 'TRACKING',
    patterns: [
      /tracking/i,
      /waybill/i,
      /air\s*waybill/i,
      /courier\s*notification/i,
      /delivery\s*update/i,
      /shipment\s*notification/i,
    ],
  },
  {
    type: 'CLIENT_EMAIL',
    patterns: [
      /re:\s*/i,           // Re: 回覆
      /fw:\s*/i,           // Fw: 轉寄
      /urgent/i,
      /please\s*find/i,
      /kindly\s*note/i,
      /per\s*our\s*conversation/i,
    ],
  },
];

// ─── Core Router ─────────────────────────────────────────────────────────────

/**
 * Detect email type from subject + sender using keyword/regex (no LLM).
 *
 * @param {Object} emailMetadata
 * @param {string} emailMetadata.subject  - Email subject line
 * @param {string} emailMetadata.from     - Sender address or display name
 * @param {string} [emailMetadata.body]  - Email body (optional, for deeper detection)
 * @returns {string} Detected email type key
 */
function detectEmailType({ subject, from, body = '' }) {
  const text = `${subject || ''} ${from || ''} ${body || ''}`.toLowerCase();

  for (const { type, patterns } of TYPE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return type;
      }
    }
  }

  // Default: if it looks like a regular email body content, treat as CLIENT_EMAIL
  if (body && body.trim().length > 50) {
    return 'CLIENT_EMAIL';
  }

  return 'OTHER';
}

/**
 * Route an email to the appropriate handler and model.
 * Cost priority: free > subscription > pay_per_token
 *
 * @param {Object} emailMetadata
 * @param {string} emailMetadata.subject
 * @param {string} emailMetadata.from
 * @param {string} [emailMetadata.body]
 * @returns {{ type: string, handler: string, model: string|null, costTier: string }}
 */
function routeEmail(emailMetadata) {
  const type = detectEmailType(emailMetadata);
  const config = EMAIL_TYPES[type] || EMAIL_TYPES.OTHER;

  return {
    type,
    handler: config.handler,
    model: config.model,
    costTier: config.costTier,
    description: config.description,
  };
}

// ─── Static Extract Handler ───────────────────────────────────────────────────

/**
 * Static extraction for Malca-Amit shipment emails.
 * Zero LLM cost — pure regex.
 *
 * @param {string} subject
 * @param {string} sender
 * @param {string} content
 * @returns {{ summary: string|null, extracted: Object|null }}
 */
function extractMalcaAmit(subject, sender, content) {
  const sClean = sender.replace(/<.*>/, '').trim().toLowerCase();
  const plain = content.replace(/\s+/g, ' ').trim();

  if (!sClean.includes('malca-amit') && !subject.toLowerCase().includes('malca')) {
    return { summary: null, extracted: null };
  }

  // Shipment notification
  if (subject.toLowerCase().includes('shipment')) {
    const ref = subject.match(/#?\s*(\d+)/);
    const mawb = plain.match(/MAWB.*?[:：]?\s*(\S+)/i);
    const ct = plain.match(/(\d+\.?\d*)\s*CTS/i);
    const val = plain.match(/USD?[\s,]*([0-9,.]+)/i);
    const from = plain.match(/From.*?[:：]?\s*(\S+)/i);
    const flight = plain.match(/Flight.*?[:：]?\s*(\S+\/\d{2}\.\d{2}\.\d{2,4})/i);
    const shipDate = plain.match(/Flight.*?[:：]?\s*\S+\/(\d{2}\.\d{2}\.\d{2,4})/i);
    const deliveryDate = plain.match(/DELIVERED ON\s*(.+?)(?:\s{2,}|$)/i);
    const shipper = plain.match(/Shipper.*?[:：]?\s*(.+?)(?:\s{2,}|$)/i);
    const receiver = plain.match(/^TO.*?[:：]?\s*(.+?)(?:\s{2,}|$)/m);
    const commodity = plain.match(/Commodity.*?[:：]?\s*(.+?)(?:\s{2,}|$)/i);

    const ori = from ? from[1] : '';
    let s = `📦 **Malca-Amit 運單${ref ? ' #' + ref[1] : ''}**`;
    if (shipper) s += `\n📤 ${shipper[1].trim()}  →  📥 ${receiver ? receiver[1].trim() : '?'}`;
    if (commodity) s += `\n📄 ${commodity[1].trim()}`;
    s += `\n🛫 由 ${ori ? '**' + ori + '**' : '?'}`;
    if (shipDate || deliveryDate) {
      if (shipDate) s += `　|　📅 ${shipDate[1]}`;
      if (shipDate && deliveryDate) s += ` → 送達 ${deliveryDate[1].trim().replace(/\s+/g, ' ')}`;
    }
    if (mawb || flight) {
      s += `\n📎 `;
      if (mawb) s += `MAWB: ${mawb[1]}`;
      if (mawb && flight) s += `　|　`;
      if (flight) s += `✈️ ${flight[1]}`;
    }
    s += `\n💎 **${ct ? ct[0] : '?'}**`;
    if (val) s += ` — **USD ${val[1]}**`;

    return {
      summary: s,
      extracted: { ref: ref?.[1], mawb: mawb?.[1], ct: ct?.[1], val: val?.[1], ori, flight: flight?.[1] },
    };
  }

  // HAWB
  if (subject.toLowerCase().includes('hawb')) {
    return {
      summary: '📄 **Export HAWB** — Malca-Amit 出口文件，請查看附件',
      extracted: { type: 'HAWB', source: 'Malca-Amit' },
    };
  }

  return { summary: null, extracted: null };
}

/**
 * Static extraction for tracking/waybill emails.
 *
 * @param {string} subject
 * @param {string} sender
 * @param {string} content
 * @returns {{ summary: string|null, extracted: Object|null }}
 */
function extractTracking(subject, sender, content) {
  const plain = content.replace(/\s+/g, ' ').trim();

  const refMatch = subject.match(/#?\s*([A-Z]{2,3}\d{6,})/i)
    || plain.match(/(?:waybill|ref|awb)[#:\s]*([A-Z]{2,3}\d{6,})/i);
  const statusMatch = plain.match(/status[:\s]*(delivered|in transit|picked up|pending)/i);
  const etaMatch = plain.match(/eta[:\s]*(.+?)(?:\.|$)/i);

  if (!refMatch) return { summary: null, extracted: null };

  let s = `📦 **追蹤通知**`;
  if (refMatch) s += ` \`${refMatch[1]}\``;
  if (statusMatch) s += ` — 狀態: **${statusMatch[1]}**`;
  if (etaMatch) s += `\n⏱ ETA: ${etaMatch[1].trim()}`;

  return {
    summary: s,
    extracted: { ref: refMatch?.[1], status: statusMatch?.[1], eta: etaMatch?.[1] },
  };
}

/**
 * Route-aware extraction dispatcher.
 * Returns null if email type doesn't have a static handler.
 *
 * @param {string} type   - Email type from routeEmail()
 * @param {string} subject
 * @param {string} sender
 * @param {string} content
 * @returns {{ summary: string|null, extracted: Object|null }}
 */
function extractByType(type, subject, sender, content) {
  switch (type) {
    case 'MALCA_AMIT':
      return extractMalcaAmit(subject, sender, content);
    case 'TRACKING':
      return extractTracking(subject, sender, content);
    default:
      return { summary: null, extracted: null };
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.subject) {
    console.log(`Usage: node email_router.js --subject "..." [--from "..."] [--body "..."] [--verbose]`);
    console.log(`Email types: ${Object.keys(EMAIL_TYPES).join(', ')}`);
    process.exit(0);
  }

  const result = routeEmail({
    subject: args.subject,
    from: args.from || '',
    body: args.body || '',
  });

  console.log(`Type:       ${result.type}`);
  console.log(`Handler:    ${result.handler}`);
  console.log(`Model:      ${result.model || '(none — extract)'}`);
  console.log(`Cost Tier:  ${result.costTier}`);

  if (args.verbose) {
    console.log(`Description: ${result.description}`);
  }

  if (args.extract) {
    const { summary } = extractByType(result.type, args.subject, args.from || '', args.body || '');
    if (summary) {
      console.log(`\nExtracted Summary:\n${summary}`);
    }
  }
}

module.exports = {
  EMAIL_TYPES,
  routeEmail,
  detectEmailType,
  extractByType,
  extractMalcaAmit,
  extractTracking,
};
