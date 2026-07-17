#!/usr/bin/env node
/**
 * llm_judge.js - LLM-as-a-Judge Pipeline
 *
 * 生成 Domain Expert Role Prompt，透過 spawn MiniMax sub-agent 執行 judge。
 * 唔直接 call model，避免 isolated session 問題。
 *
 * Phase 1: 生成 judge prompt (CLI mode)
 * Phase 2: 解析 MiniMax 回覆做結構化輸出
 * Phase 3: 記錄歷史到 memory/evals/history.json
 *
 * Created: 2026-05-08
 * Mode: MiniMax sub-agent only (no Ollama)
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

// ==================== 配置常量 ====================
const JUDGE_CONFIG = {
  VERSION: '1.0.0',
  NAME: 'LLM Judge',

  // 輸出目錄
  OUTPUT_DIR: path.join(__dirname, '..', 'memory', 'evals'),
  HISTORY_FILE: 'history.json',

  // 預設維度（generic fallback）
  DEFAULT_DIMENSIONS: ['completeness', 'accuracy', 'clarity'],

  // Script type presets: default expert role + dimensions + threshold
  SCRIPT_TYPES: {
    'content':     { expert: 'trainer',   dims: ['completeness','accuracy','usefulness'],      desc: 'AI-generated summaries, journals, reports' },
    'log':         { expert: 'engineer',  dims: ['clarity','completeness','actionability'],    desc: 'Cron logs, maintenance output, system logs' },
    'tech':        { expert: 'engineer',  dims: ['accuracy','structure','usefulness'],         desc: 'Code artifacts, SYMBOLS.md, technical docs' },
    'communication': { expert: 'customer-service', dims: ['tone','clarity','completeness'],    desc: 'Discord/Signal messages, group replies' },
    'diamond':     { expert: 'gemologist', dims: ['accuracy','completeness','fairness'],       desc: 'Diamond reports, GIA certificates' },
    'generic':     { expert: 'trainer',   dims: ['completeness','accuracy','clarity'],          desc: 'Fallback for anything else' },
  },

  // Verdict threshold：based on average score across all dimensions
  VERDICT_THRESHOLDS: {
    ACCEPT: { min: 7 },           // avg >= 7
    REVISE: { min: 4, max: 7 },   // avg >= 4 && avg < 7
    REJECT: { max: 4 },           // avg < 4 （not inclusive）
  },

  // Expert prompts templates
  EXPERT_TEMPLATES: {
    'gemologist': '你係資深 GIA 寶石學家，專注評級準確度同完整性',
    'trainer': '你係虛擬助理訓練師，專注清晰度同有用性',
    'engineer': '你係資深工程師，專注代碼質素同安全性',
    'accountant': '你係專業會計師，專注數字準確同合規',
    'customer-service': '你係客戶服務經理，專注語氣恰當同解決問題'
  }
};

// ==================== Expert Prompt Builder ====================
class ExpertPromptBuilder {
  /**
   * Build judge prompt with domain expert role
   */
  static build(expertRole, content, dimensions, options = {}) {
    const dimensionList = Array.isArray(dimensions) ? dimensions : [dimensions];

    // Get expert context
    const expertContext = JUDGE_CONFIG.EXPERT_TEMPLATES[expertRole]
      ? `${JUDGE_CONFIG.EXPERT_TEMPLATES[expertRole]}。`
      : `你係 ${expertRole} 領域既專家。`;

    // Build dimension scoring section
    const scoringSection = dimensionList.map((dim, idx) => {
      return `${idx + 1}. [${dim}]：評分 1-10 + 原因`;
    }).join('\n');

    // Build the full prompt
    const prompt = `${expertContext}

評估以下 [內容類型]：
${content}

請用 [${expertRole}] 既業界標準評分：
${scoringSection}

額外評估（如果有要求）:
${options.additional评估 || '無'}

最後，根據以上評估，請俾出最終裁決：
Verdict: ACCEPT / REVISE / REJECT

如果 ACCEPT：內容可以接受
如果 REVISE：需要少量修改後再提交
如果 REJECT：需要重大修改或重新生成
`;

    return prompt;
  }

  /**
   * Parse judge response to structured output
   */
  /**
   * Get default config for a script type
   * @param {string} type - Script type key from SCRIPT_TYPES
   * @returns {{ expert: string, dimensions: string[], description: string }}
   */
  static getDefaults(type) {
    const entry = JUDGE_CONFIG.SCRIPT_TYPES[type];
    if (entry) {
      return { expert: entry.expert, dimensions: entry.dims, description: entry.desc };
    }
    // Fallback to generic
    return {
      expert: JUDGE_CONFIG.SCRIPT_TYPES['generic'].expert,
      dimensions: [...JUDGE_CONFIG.SCRIPT_TYPES['generic'].dims],
      description: JUDGE_CONFIG.SCRIPT_TYPES['generic'].desc
    };
  }

  /**
   * Get verdict based on average score
   * Overrides LLM's subjective verdict with objective threshold
   * @param {number} avgScore - Average score across all dimensions (0-10)
   * @returns {'ACCEPT'|'REVISE'|'REJECT'}
   */
  static getVerdictByScore(avgScore) {
    if (avgScore >= JUDGE_CONFIG.VERDICT_THRESHOLDS.ACCEPT.min) return 'ACCEPT';
    if (avgScore >= JUDGE_CONFIG.VERDICT_THRESHOLDS.REVISE.min) return 'REVISE';
    return 'REJECT';
  }

  static parse(response) {
    const result = {
      dimensions: {},
      strengths: [],
      weaknesses: [],
      verdict: 'UNKNOWN',
      reasoning: ''
    };

    // Extract dimension scores - support multiple formats:
    //   [clarity]: 7 - reason
    //   [clarity]：8 - reason
    //   [clarity] 7/10 reason
    //   1. [clarity]: 7 reason
    const dimensionRegex = /\[(\w+)\]\s*[:：]?\s*(\d{1,2})\s*(?:\/10)?\s*[-–—]?\s*(.*)/g;
    let match;
    while ((match = dimensionRegex.exec(response)) !== null) {
      const score = parseInt(match[2], 10);
      if (score >= 1 && score <= 10) {
        result.dimensions[match[1]] = {
          score: score,
          reason: match[3].trim()
        };
      }
    }

    // Fallback: try to find any "X/10" pattern near dimension names
    if (Object.keys(result.dimensions).length === 0) {
      const fallbackRegex = /(\w+)\s*[:：]\s*(\d{1,2})\s*\/10/g;
      let fm;
      while ((fm = fallbackRegex.exec(response)) !== null) {
        const score = parseInt(fm[2], 10);
        if (score >= 1 && score <= 10) {
          result.dimensions[fm[1].toLowerCase()] = { score, reason: '' };
        }
      }
    }

    // Extract verdict - support multiple formats:
    //   Verdict: ACCEPT / REVISE / REJECT
    //   Verdict: REVISE
    //   [REVISE]
    //   **最終裁決:** REVISE
    const verdictPatterns = [
      /Verdict\s*[:：]?\s*(ACCEPT|REVISE|REJECT)/i,
      /最終裁決\s*[:：]?\s*(ACCEPT|REVISE|REJECT)/i,
      /verdict\s*[:：]?\s*(ACCEPT|REVISE|REJECT)/i,
      /\[(ACCEPT|REVISE|REJECT)\]/i
    ];
    for (const pattern of verdictPatterns) {
      const m = response.match(pattern);
      if (m) {
        result.verdict = m[1].toUpperCase();
        break;
      }
    }

    // Also capture any mention of REVISE/REJECT in the response for fallback
    if (result.verdict === 'UNKNOWN') {
      if (/\bREVISE\b|\bREVISION\b|\b修正/i.test(response)) {
        result.verdict = 'REVISE';
      } else if (/\bREJECT\b|\b拒絕/i.test(response)) {
        result.verdict = 'REJECT';
      } else if (/\bACCEPT\b|\b接受/i.test(response)) {
        result.verdict = 'ACCEPT';
      }
    }

    // Calculate average score for threshold-based verdict
    const scores = Object.values(result.dimensions).map(d => d.score);
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    // Override LLM verdict with objective threshold if score is available
    if (avgScore > 0) {
      const thresholdVerdict = ExpertPromptBuilder.getVerdictByScore(avgScore);
      // Only override if LLM verdict is missing or clearly wrong
      if (result.verdict === 'UNKNOWN' ||
          (result.verdict === 'ACCEPT' && avgScore < 5) ||
          (result.verdict === 'REJECT' && avgScore > 6)) {
        result.verdict = thresholdVerdict;
      }
    }

    // Extract strengths/weaknesses if present
    const strengthMatch = response.match(/Strengths?:?[\s\n]+(.+?)(?=\n\n|$)/i);
    const weaknessMatch = response.match(/Weaknesses?:?[\s\n]+(.+?)(?=\n\n|$)/i);

    if (strengthMatch) {
      result.strengths = strengthMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean);
    }
    if (weaknessMatch) {
      result.weaknesses = weaknessMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean);
    }

    // Store raw reasoning
    result.reasoning = response;

    return result;
  }
}

// ==================== Eval Record Keeper ====================
class EvalRecordKeeper {
  constructor(options = {}) {
    this.outputDir = options.outputDir || JUDGE_CONFIG.OUTPUT_DIR;
    this.historyFile = path.join(this.outputDir, JUDGE_CONFIG.HISTORY_FILE);
  }

  /**
   * Save evaluation result
   */
  save(result) {
    try {
      fs.mkdirSync(this.outputDir, { recursive: true });
    } catch (err) {
      // ignore if exists
    }

    const history = this._loadHistory();

    history.evaluations = history.evaluations || [];
    history.evaluations.push(result);

    // Keep only last 100 evaluations
    if (history.evaluations.length > 100) {
      history.evaluations = history.evaluations.slice(-100);
    }

    history.stats = this._calculateStats(history.evaluations);

    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }

    return history;
  }

  /**
   * Save from raw MiniMax response (parse + save in one step)
   */
  saveFromRaw(content, expertRole, dimensions, rawResponse, options = {}) {
    const dims = dimensions || JUDGE_CONFIG.DEFAULT_DIMENSIONS;
    const parsed = ExpertPromptBuilder.parse(rawResponse);

    const scores = Object.values(parsed.dimensions).map(d => d.score);
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    // Use threshold-based verdict for consistency (parse() may have already overridden it)
    const thresholdVerdict = ExpertPromptBuilder.getVerdictByScore(avgScore);

    const result = {
      target: options.target || 'unknown',
      expert_role: expertRole,
      judge_model: 'minimax-portal/MiniMax-M2.7 (via sub-agent)',
      generator_model: 'deepseek/deepseek-v4-flash',
      dimensions: parsed.dimensions,
      average_score: avgScore,
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      // Use threshold verdict, but preserve LLM's if they agree
      verdict: thresholdVerdict,
      reasoning: parsed.reasoning,
      threshold_verdict: true,
      timestamp: getHKTDateTime()
    };

    return result;
  }

  /**
   * Load history
   */
  _loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      }
    } catch (err) {
      // ignore
    }
    return { evaluations: [], stats: {} };
  }

  /**
   * Calculate stats from evaluations
   */
  _calculateStats(evaluations) {
    const byVerdict = { ACCEPT: 0, REVISE: 0, REJECT: 0 };
    const byExpert = {};
    const byDimension = {};

    for (const item of evaluations) {
      if (byVerdict[item.verdict] !== undefined) {
        byVerdict[item.verdict]++;
      }
      byExpert[item.expert_role] = (byExpert[item.expert_role] || 0) + 1;
      for (const [dim, data] of Object.entries(item.dimensions || {})) {
        if (!byDimension[dim]) {
          byDimension[dim] = { total: 0, count: 0 };
        }
        byDimension[dim].total += data.score;
        byDimension[dim].count++;
      }
    }

    for (const dim of Object.keys(byDimension)) {
      byDimension[dim] = {
        avg: (byDimension[dim].total / byDimension[dim].count).toFixed(2),
        count: byDimension[dim].count
      };
    }

    return {
      total: evaluations.length,
      by_verdict: byVerdict,
      by_expert_role: byExpert,
      by_dimension: byDimension
    };
  }

  /**
   * Get history
   */
  getHistory(options = {}) {
    const history = this._loadHistory();
    if (options.limit) {
      history.evaluations = history.evaluations.slice(-options.limit);
    }
    return history;
  }

  /**
   * Print history summary
   */
  printHistory(options = {}) {
    const history = this.getHistory(options);
    const stats = history.stats;

    console.log(`\n📊 Evaluation History (${stats.total} total)`);
    console.log(`\n🏷️ By Verdict:`);
    console.log(`   ✅ ACCEPT: ${stats.by_verdict?.ACCEPT || 0}`);
    console.log(`   👀 REVISE: ${stats.by_verdict?.REVISE || 0}`);
    console.log(`   ❌ REJECT: ${stats.by_verdict?.REJECT || 0}`);

    console.log(`\n🎯 By Expert Role:`);
    for (const [role, count] of Object.entries(stats.by_expert_role || {})) {
      console.log(`   ${role}: ${count}`);
    }

    console.log(`\n📈 Dimension Averages:`);
    for (const [dim, data] of Object.entries(stats.by_dimension || {})) {
      console.log(`   ${dim}: ${data.avg} (${data.count} samples)`);
    }

    return history;
  }
}

// ==================== CLI Handler ====================
class CLIHandler {
  constructor() {
    this.commands = new Map();
    this.setupCommands();
  }

  setupCommands() {
    this.commands.set('gen-prompt', {
      description: 'Generate judge prompt for MiniMax sub-agent',
      options: [
        { flag: '--content <text>', desc: 'Content to judge' },
        { flag: '--file <path>', desc: 'File containing content to judge' },
        { flag: '--stdin', desc: 'Read content from stdin' },
        { flag: '--type <type>', desc: 'Script type preset (content, log, tech, communication, diamond, generic) — auto-sets expert+dims' },
        { flag: '--expert <role>', desc: 'Override expert role (gemologist, trainer, engineer, accountant, customer-service)' },
        { flag: '--dimensions <dims>', desc: 'Comma-separated dimensions (default: from --type, or completeness,accuracy,clarity)' },
        { flag: '--target <name>', desc: 'Target name for tracking (e.g., daily_summary_bot.js)' }
      ],
      action: this.cmdGenPrompt.bind(this)
    });

    this.commands.set('history', {
      description: 'Show evaluation history',
      options: [
        { flag: '--limit <N>', desc: 'Number of recent evaluations to show' },
        { flag: '--json', desc: 'Output as JSON' }
      ],
      action: this.cmdHistory.bind(this)
    });

    this.commands.set('stats', {
      description: 'Show evaluation statistics',
      options: [],
      action: this.cmdStats.bind(this)
    });

    this.commands.set('help', {
      description: 'Show help',
      options: [],
      action: this.cmdHelp.bind(this)
    });
  }

  parseArgs(args) {
    const options = {};
    const positional = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const key = arg.replace(/^--/, '');
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          options[key] = args[i + 1];
          i++;
        } else {
          options[key] = true;
        }
      } else if (arg.startsWith('-')) {
        options[arg.replace(/^-/, '')] = true;
      } else {
        positional.push(arg);
      }
    }

    return { command: positional[0], args: positional.slice(1), options };
  }

  /**
   * gen-prompt: Output judge prompt + instructions for spawning MiniMax sub-agent
   */
  async cmdGenPrompt(parsed) {
    let content = parsed.options.content || '';
    const targetFile = parsed.options.file;
    const useStdin = parsed.options.stdin;

    if (targetFile) {
      try {
        content = fs.readFileSync(targetFile, 'utf8');
      } catch (err) {
        console.error(`❌ Failed to read file: ${err.message}`);
        process.exit(1);
      }
    } else if (useStdin) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      for await (const line of rl) {
        content += line + '\n';
      }
    }

    if (!content.trim()) {
      console.error('❌ No content to judge. Use --content, --file, or --stdin');
      process.exit(1);
    }

    // Resolve expert + dimensions from --type preset, overridable by --expert/--dimensions
    const scriptType = parsed.options.type || 'generic';
    const defaults = ExpertPromptBuilder.getDefaults(scriptType);
    const expert = parsed.options.expert || defaults.expert;
    const dimensions = parsed.options.dimensions
      ? parsed.options.dimensions.split(',')
      : defaults.dimensions;
    const target = parsed.options.target || targetFile || 'unknown';

    // Generate the prompt
    const prompt = ExpertPromptBuilder.build(expert, content, dimensions);

    // Output instructions for main agent
    console.log(`⚖️ LLM Judge v${JUDGE_CONFIG.VERSION}`);
    console.log(`   Type: ${scriptType} (${defaults.description})`);
    console.log(`   Expert: ${expert}`);
    console.log(`   Dimensions: ${dimensions.join(', ')}`);
    console.log(`   Target: ${target}`);
    console.log(`   Verdict Threshold: avg >= 7 = ACCEPT | avg >= 4 = REVISE | avg < 4 = REJECT`);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 Judge Prompt (copy this to MiniMax sub-agent):`);
    console.log(`${'='.repeat(60)}\n`);
    console.log(prompt);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 Spawn MiniMax sub-agent with:`);
    console.log(`   sessions_spawn({`);
    console.log(`     model: "minimax-portal/MiniMax-M2.7",`);
    console.log(`     task: \`${prompt.slice(0, 60).replace(/`/g, '\\`')}...\``);
    console.log(`   })`);
    console.log(`\n💾 After judge completes, save result:`);
    console.log(`   const keeper = new (require('./llm_judge').EvalRecordKeeper)();`);
    console.log(`   keeper.save(parsedResult);`);
    console.log(`${'='.repeat(60)}`);

    // Also output JSON version of instructions
    const instructions = judgeViaMessageTool(content, expert, dimensions, { target });
    console.log(`\n📦 JSON instructions (for automated parsing):`);
    console.log(JSON.stringify(instructions, null, 2));
  }

  /**
   * history: Show evaluation history
   */
  async cmdHistory(parsed) {
    const keeper = new EvalRecordKeeper();
    const limit = parsed.options.limit ? parseInt(parsed.options.limit, 10) : 10;
    const asJson = parsed.options.json;

    if (asJson) {
      const history = keeper.getHistory({ limit });
      console.log(JSON.stringify(history, null, 2));
    } else {
      keeper.printHistory({ limit });
    }
  }

  /**
   * stats: Show evaluation statistics
   */
  async cmdStats() {
    const keeper = new EvalRecordKeeper();
    keeper.printHistory();
  }

  /**
   * help: Show help
   */
  cmdHelp() {
    console.log(`\n${JUDGE_CONFIG.NAME} v${JUDGE_CONFIG.VERSION}`);
    console.log('\nUsage: llm_judge.js <command> [options]\n');
    console.log(`Commands:`);
    console.log(`\n  gen-prompt    Generate judge prompt for MiniMax sub-agent`);
    console.log(`    --type <type>        Script type preset (overrides expert+dims)`);
    console.log(`                          content | log | tech | communication | diamond | generic`);
    console.log(`    --content <text>     Content to judge`);
    console.log(`    --file <path>        File containing content`);
    console.log(`    --stdin              Read from stdin`);
    console.log(`    --expert <role>      Override expert role`);
    console.log(`    --dimensions <dims>  Override dimensions (comma-separated)`);
    console.log(`    --target <name>      Target name for tracking`);
    console.log(`\n  history       Show evaluation history`);
    console.log(`    --limit <N>          Recent evaluations to show`);
    console.log(`    --json               JSON output`);
    console.log(`\n  stats         Show evaluation statistics`);
    console.log(`\n  help          Show this help`);
    console.log('');
  }

  async run(args) {
    const parsed = this.parseArgs(args);
    const command = parsed.command || 'help';

    if (!this.commands.has(command)) {
      console.error(`Unknown command: ${command}`);
      this.cmdHelp();
      process.exit(1);
    }

    await this.commands.get(command).action(parsed);
  }
}

// ==================== Exports ====================

/**
 * Generate judge prompt without executing
 * Use when you need to spawn MiniMax sub-agent manually
 */
function generateJudgePrompt(content, expertRole, dimensions, options = {}) {
  const dims = dimensions || JUDGE_CONFIG.DEFAULT_DIMENSIONS;
  return ExpertPromptBuilder.build(expertRole, content, dims, options);
}

/**
 * Convenience wrapper for spawning judge via main agent
 * Accepts --type for preset defaults (overridable by explicit expertRole/dimensions)
 * Default judge model: minimax-portal/MiniMax-M2.7
 */
function judgeViaMessageTool(content, expertRole, dimensions, options = {}) {
  // Resolve from --type if no explicit expert/dims given
  const scriptType = options.type || null;
  let resolvedRole = expertRole;
  let resolvedDims = dimensions;

  if (!resolvedRole && scriptType) {
    const defaults = ExpertPromptBuilder.getDefaults(scriptType);
    resolvedRole = defaults.expert;
    resolvedDims = resolvedDims || defaults.dimensions;
  }
  resolvedRole = resolvedRole || 'trainer';
  resolvedDims = resolvedDims || JUDGE_CONFIG.DEFAULT_DIMENSIONS;

  const prompt = generateJudgePrompt(content, resolvedRole, resolvedDims, options);
  return {
    prompt,
    instructions: `Evaluate the following content and return structured result with:\n` +
      `1. Scores for each dimension (1-10)\n` +
      `2. Strengths and weaknesses\n` +
      `3. Verdict: ACCEPT / REVISE / REJECT\n` +
      `Format the response so I can parse it with ExpertPromptBuilder.parse()`,
    expertRole: resolvedRole,
    dimensions: resolvedDims,
    type: scriptType || null,
    target: options.target || 'unknown'
  };
}

module.exports = {
  ExpertPromptBuilder,
  EvalRecordKeeper,
  CLIHandler,
  JUDGE_CONFIG,
  generateJudgePrompt,
  judgeViaMessageTool
};

// ==================== CLI Entry ====================
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
    const cli = new CLIHandler();
    cli.cmdHelp();
    return;
  }

  const cli = new CLIHandler();
  await cli.run(args);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
