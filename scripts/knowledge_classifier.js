#!/usr/bin/env node
/**
 * 知識庫內容分類器 (Knowledge Base Classifier)
 *
 * 用途：自動將外部輸入分類到 Wiki/L0/L1/Memory
 * 依據：memory/knowledge-base-design.md 分類規則
 *
 * 用法：
 *   node knowledge_classifier.js --content "內容文字" --source "learning|x-link|discord|youtube"
 *   node knowledge_classifier.js --file /path/to/file --source "..."
 *   node knowledge_classifier.js --interactive
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ============================================================
// LLM 分類（v3.3 — thin executor pattern，唔依賴 agent LLM）
// ============================================================

// 默認 LLM model + fallback chain
const LLM_MODELS = [
  'minimax-portal/MiniMax-M2.7',
  'kimi/kimi-for-coding'
];
const LLM_TIMEOUT_MS = 30000;

/**
 * 用 `openclaw infer model run` 直接 call LLM 做分類。
 * 失敗/timeout → 回傳 null，caller fallback 去 keyword 分類。
 *
 * Thin executor pattern：避免 cron session 嘅 agent LLM fail 連累成個 job，
 * 改為 script 自己 call LLM，內部有 fallback chain。
 */
function classifyWithLLM(content, source) {
  if (!content || !content.trim()) return null;

  // 截短 content 避免 prompt 過大
  const truncated = content.length > 2000
    ? content.slice(0, 2000) + '\n\n[... truncated, total ' + content.length + ' chars]'
    : content;

  const prompt = [
    '你係知識分類器。分析以下內容，輸出 JSON（只輸出 JSON，唔好加解釋）：',
    '{',
    '  "category": "technical|trend|insight|decision|default",',
    '  "confidence": 0.0-1.0,',
    '  "tags": ["tag1", "tag2"],',
    '  "summary": "2-3 句廣東話總結"',
    '}',
    '',
    '內容：' + truncated,
    '來源：' + (source || 'unknown')
  ].join('\n');

  for (let mi = 0; mi < LLM_MODELS.length; mi++) {
    const model = LLM_MODELS[mi];
    if (mi > 0) {
      // 第一次 model 失敗，silent retry
    }
    try {
      const stdout = execFileSync('openclaw', [
        'infer', 'model', 'run',
        '--model', model,
        '--prompt', prompt,
        '--json'
      ], {
        timeout: LLM_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' })
      });

      if (!stdout) continue;

      // LLM CLI 包住 { outputs: [{ text: "..." }] } 結構，抽出 text
      let text = stdout;
      try {
        const outer = JSON.parse(stdout);
        if (outer && Array.isArray(outer.outputs) && outer.outputs[0] && outer.outputs[0].text) {
          text = outer.outputs[0].text;
        }
      } catch (_) {
        // stdout 唔係 JSON，直接當 text 用
      }

      // 從 text 入面搵 JSON block { ... }
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;

      const parsed = JSON.parse(match[0]);
      if (!parsed || !parsed.category) continue;

      // 規範化 category
      const allowed = Object.values(CATEGORIES);
      if (!allowed.includes(parsed.category)) {
        parsed.category = CATEGORIES.DEFAULT;
      }
      // confidence clamp
      if (typeof parsed.confidence !== 'number') {
        parsed.confidence = 0.5;
      } else {
        parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
      }
      // tags 規範化
      if (!Array.isArray(parsed.tags)) parsed.tags = [];

      return Object.assign({}, parsed, { source: (source || 'unknown').toLowerCase(), llmModel: model });
    } catch (e) {
      // Rate limit / overload / timeout / parse fail → 試下一個 model
      // Non-retryable 都係 fallback（始終有 keyword 兜底）
      continue;
    }
  }

  return null; // 全部 LLM 都失敗
}

/**
 * 合併 LLM + keyword 結果。LLM 成功 → 用 LLM；失敗 → 用 keyword。
 * LLM 嘅 category 會 override keyword，但保留 keyword 嘅 matchedKeywords。
 */
function classifyContentHybrid(content, source) {
  const keywordResult = classifyContent(content, source);
  const llmResult = classifyWithLLM(content, source);

  if (!llmResult) {
    return keywordResult;
  }

  // LLM 成功：合併結果
  const dest = DESTINATION_MAP[llmResult.category] || DESTINATION_MAP[CATEGORIES.DEFAULT];
  return {
    category: llmResult.category,
    confidence: llmResult.confidence,
    source: llmResult.source,
    destination: {
      primary: dest.primary,
      secondary: dest.secondary,
      priority: dest.priority,
      retention: dest.retention
    },
    tags: llmResult.tags || [],
    summary: llmResult.summary || '',
    llmModel: llmResult.llmModel,
    matchedKeywords: keywordResult.matchedKeywords,
    reasoning: 'LLM (' + llmResult.llmModel + '): ' + llmResult.category + ' | ' + keywordResult.reasoning
  };
}

// ============================================================
// 分類維度定義
// ============================================================

const CATEGORIES = {
  TECHNICAL: 'technical',     // 技術操作文檔 → Wiki
  TREND: 'trend',             // 行業趨勢 → L1
  INSIGHT: 'insight',         // 重要洞察 → L0 + Memory
  DECISION: 'decision',       // 決策事項 → Wiki + Issue
  DEFAULT: 'default'          // 預設 → Memory
};

// 識別關鍵詞 - 正則表達式
const KEYWORD_PATTERNS = {
  // 技術操作關鍵詞
  technical: /\b(cli|command|script|install|setup|config|docker|git|npm|pip|compile|build|deploy|api|endpoint|framework|library|module|package|dependencies)\b/i,

  // 行業趨勢關鍵詞
  trend: /\b(token|cost|performance|speed|growth|market|industry|trend|forecast|revenue|profit|adoption|demand|supply|price|valuation|billion|million|percent|%)\b/i,

  // 重要洞察關鍵詞
  insight: /\b(recommend|suggest|conclusion|decision|important|key|main|critical|essential|breakthrough|innovation|game.?changer|paradigm|shift)\b/i,

  // 決策事項關鍵詞
  decision: /\b(approve|reject|implement|deploy|launch|choose|pick|select|commit|adopt|migrate|upgrade|invest|buy|sell|partner|acquire)\b/i,

  // 數據/分析關鍵詞
  data: /\b(data|analysis|research|report|study|survey|metric|figure|statistics|result|findings|evidence)\b/i,

  // 教學/學習關鍵詞
  tutorial: /\b(learn|tutorial|guide|how.to|step.by.step|introduction|beginner|example|demo|sample)\b/i
};

// 來源默認分類映射
const SOURCE_DEFAULT = {
  'learning': CATEGORIES.TREND,      // 學習 channel → 趨勢
  'x-link': CATEGORIES.INSIGHT,       // X link → 洞察
  'discord': CATEGORIES.DEFAULT,      // Discord → 預設
  'youtube': CATEGORIES.TREND,        // YouTube → 趨勢
  'file': CATEGORIES.DEFAULT          // 文件 → 預設
};

// 目的地映射表
const DESTINATION_MAP = {
  [CATEGORIES.TECHNICAL]: {
    primary: 'wiki',
    secondary: null,
    priority: 'P0',
    retention: 'permanent'
  },
  [CATEGORIES.TREND]: {
    primary: 'l1',
    secondary: 'memory',
    priority: 'P1',
    retention: '90'
  },
  [CATEGORIES.INSIGHT]: {
    primary: 'l0',
    secondary: 'memory',
    priority: 'P1',
    retention: '180'
  },
  [CATEGORIES.DECISION]: {
    primary: 'wiki',
    secondary: 'issue',
    priority: 'P0',
    retention: 'permanent'
  },
  [CATEGORIES.DEFAULT]: {
    primary: 'memory',
    secondary: null,
    priority: 'P2',
    retention: '30'
  }
};

// ============================================================
// 分類引擎
// ============================================================

/**
 * 分析內容並返回分類
 * @param {string} content - 內容文字
 * @param {string} source - 來源 (learning/x-link/discord/youtube/file)
 * @returns {Object} 分類結果
 */
function classifyContent(content, source) {
  const normalizedSource = (source || 'unknown').toLowerCase();

  // 計算每個分類的匹配分數
  const scores = {
    [CATEGORIES.TECHNICAL]: 0,
    [CATEGORIES.TREND]: 0,
    [CATEGORIES.INSIGHT]: 0,
    [CATEGORIES.DECISION]: 0
  };

  // 計算關鍵詞匹配
  for (const [category, pattern] of Object.entries(KEYWORD_PATTERNS)) {
    if (category === 'tutorial' || category === 'data') continue; // 這些不改變主分類
    const matches = content.match(pattern);
    if (matches) {
      scores[category === 'technical' ? CATEGORIES.TECHNICAL :
             category === 'trend' ? CATEGORIES.TREND :
             category === 'insight' ? CATEGORIES.INSIGHT :
             category === 'decision' ? CATEGORIES.DECISION : CATEGORIES.DEFAULT] += matches.length;
    }
  }

  // 特殊檢測：代碼塊存在 = 技術內容
  if (content.includes('```') || content.includes('function ') ||
      content.includes('const ') || content.includes('import ') ||
      content.includes('#!/') || content.includes('npm ') ||
      content.includes('pip ') || content.includes('git ')) {
    scores[CATEGORIES.TECHNICAL] += 5;
  }

  // URL/Link 存在 → 可能是外部資訊
  if (content.match(/https?:\/\//)) {
    scores[CATEGORIES.TREND] += 1;
    scores[CATEGORIES.INSIGHT] += 1;
  }

  // X link 文章分析格式檢測 → 直接 Wiki
  if (content.includes('1️⃣ 文章核心內容') ||
      (content.includes('x.com/') && content.includes('五大要點')) ||
      (content.includes('twitter.com') && content.includes('1️⃣'))) {
    scores['technical'] += 10;
  }

  // 決策動詞檢測（高權重）
  // Note: \b 喺 JS 唔支援 CJK 字，所以要分開處理中英文
  const decisionVerbsEN = /\b(must|should|need to|have to|choose|pick|decide|implement|deploy)\b/i;
  const decisionWordsCN = ['應該', '要', '必須'];
  const hasDecisionVerb = decisionWordsCN.some(w => content.includes(w)) || content.match(decisionVerbsEN);
  if (hasDecisionVerb) {
    scores[CATEGORIES.DECISION] += 3;
  }

  // 找到最高分
  let bestCategory = CATEGORIES.DEFAULT;
  let bestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // 如果分數都很低，使用來源默認分類
  if (bestScore === 0) {
    bestCategory = SOURCE_DEFAULT[normalizedSource] || CATEGORIES.DEFAULT;
  }

  // 獲取目的地信息
  const destination = DESTINATION_MAP[bestCategory];

  return {
    category: bestCategory,
    confidence: Math.min(bestScore / 5, 1), // 信心度 0-1
    source: normalizedSource,
    destination: {
      primary: destination.primary,
      secondary: destination.secondary,
      priority: destination.priority,
      retention: destination.retention
    },
    matchedKeywords: Object.entries(KEYWORD_PATTERNS)
      .map(([cat, pattern]) => ({ category: cat, matches: content.match(pattern) }))
      .filter(item => item.matches)
      .map(item => ({ category: item.category, count: item.matches.length })),
    reasoning: buildReasoning(scores, bestCategory, normalizedSource)
  };
}

/**
 * 建立推理說明
 */
function buildReasoning(scores, bestCategory, source) {
  const reasons = [];

  if (scores[CATEGORIES.TECHNICAL] > 0) {
    reasons.push(`技術關鍵詞匹配 x${scores[CATEGORIES.TECHNICAL]}`);
  }
  if (scores[CATEGORIES.TREND] > 0) {
    reasons.push(`趨勢關鍵詞匹配 x${scores[CATEGORIES.TREND]}`);
  }
  if (scores[CATEGORIES.INSIGHT] > 0) {
    reasons.push(`洞察關鍵詞匹配 x${scores[CATEGORIES.INSIGHT]}`);
  }
  if (scores[CATEGORIES.DECISION] > 0) {
    reasons.push(`決策關鍵詞匹配 x${scores[CATEGORIES.DECISION]}`);
  }

  reasons.push(`來源: ${source}`);
  reasons.push(`分類: ${bestCategory}`);

  return reasons.join(' | ');
}

/**
 * 獲取目的地的實際路徑
 */
function getDestinationPath(category, date = new Date()) {
  const dest = DESTINATION_MAP[category];
  const dateStr = date.toISOString().split('T')[0];
  const baseDir = process.env.WORKSPACE_DIR || '~/.openclaw/workspace';

  const paths = {
    wiki: `${baseDir}/wiki/main/`,
    l0: `${baseDir}/memory/l0-abstract/${dateStr}.md`,
    l1: `${baseDir}/memory/l1-overview/${dateStr}.md`,
    memory: `${baseDir}/memory/${dateStr}.md`,
    issue: `${baseDir}/.issues/active/`
  };

  return {
    primary: paths[dest.primary] || paths.memory,
    secondary: dest.secondary ? paths[dest.secondary] : null
  };
}

// ============================================================
// CLI 界面
// ============================================================

function printHelp() {
  console.log(`
知識庫內容分類器 (Knowledge Base Classifier)
=============================================

用法:
  node knowledge_classifier.js --content "內容文字" --source "來源"
  node knowledge_classifier.js --file /path/to/file --source "來源"
  node knowledge_classifier.js --interactive

來源: learning | x-link | discord | youtube | file

範例:
  node knowledge_classifier.js --content "M5 Max has 128GB memory and runs Claude Code" --source "learning"
  node knowledge_classifier.js --file ./article.txt --source "x-link"
  node knowledge_classifier.js --interactive

輸出:
  - category: 分類 (technical/trend/insight/decision/default)
  - confidence: 信心度 (0-1)
  - destination: 目的地 (wiki/l0/l1/memory)
  - priority: 優先級 (P0/P1/P2)
  - retention: 保留期限
`);
}

function main() {
  const args = process.argv.slice(2);

  // 解析參數
  let content = '';
  let source = 'unknown';
  let filePath = null;
  let interactive = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--content':
      case '-c':
        content = args[++i] || '';
        break;
      case '--source':
      case '-s':
        source = args[++i] || 'unknown';
        break;
      case '--file':
      case '-f':
        filePath = args[++i] || null;
        break;
      case '--interactive':
      case '-i':
        interactive = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        return;
      default:
        if (!args[i].startsWith('-')) {
          content = args[i]; // 第一個非flag引數當作content
        }
    }
  }

  // Interactive 模式
  if (interactive) {
    console.log('知識庫分類器 - 互動模式 (輸入 exit 結束)\n');
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ask = () => {
      rl.question('內容 > ', (input) => {
        if (input.toLowerCase() === 'exit') {
          rl.close();
          return;
        }
        if (input.trim()) {
          const result = classifyContent(input, source);
          console.log('\n📊 分類結果:');
          console.log(JSON.stringify(result, null, 2));
          console.log('\n');
        }
        ask();
      });
    };
    ask();
    return;
  }

  // 從檔案讀取
  if (filePath) {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error(`❌ 無法讀取檔案: ${e.message}`);
      process.exit(1);
    }
  }

  // 執行分類
  if (!content) {
    console.error('❌ 請提供內容 (--content 或 --file)');
    printHelp();
    process.exit(1);
  }

  const result = classifyContent(content, source);

  // 輸出結果
  console.log('\n📊 知識庫分類結果');
  console.log('==================');
  console.log(`Category:     ${result.category}`);
  console.log(`Confidence:  ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`Source:      ${result.source}`);
  console.log('');
  console.log('📍 目的地:');
  console.log(`  Primary:   ${result.destination.primary} [${result.destination.priority}]`);
  if (result.destination.secondary) {
    console.log(`  Secondary: ${result.destination.secondary}`);
  }
  console.log(`  Retention: ${result.destination.retention} days`);
  console.log('');
  console.log('🔍 推理:');
  console.log(`  ${result.reasoning}`);

  if (result.matchedKeywords.length > 0) {
    console.log('');
    console.log('🏷️  匹配關鍵詞:');
    result.matchedKeywords.forEach(item => {
      console.log(`  ${item.category}: ${item.count}x`);
    });
  }

  console.log('');
}

// ============================================================
// 模組匯出 (供其他腳本使用)
// ============================================================

module.exports = {
  classifyContent,
  classifyWithLLM,
  classifyContentHybrid,
  getDestinationPath,
  CATEGORIES,
  DESTINATION_MAP,
  KEYWORD_PATTERNS,
  LLM_MODELS
};

// 直接執行
if (require.main === module) {
  main();
}
