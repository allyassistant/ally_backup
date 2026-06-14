#!/usr/bin/env node
/**
 * skill_description_auditor.js — Score skill SKILL.md descriptions against the
 * 3-segment Anthropic-style formula (做咩 | 幾時用 | 關鍵能力) and report
 * quality (0-1e2). Used by M1.2 to drive the description-quality cleanup
 * (M1.3 top-10, M1.4 remaining 31).
 *
 * M1.2 spec: .spawn/reports/m1-execution-plan-2026-06-14.md §3
 *
 * Usage:
 *   node scripts/skill_description_auditor.js --self-test              # 6 built-in test cases
 *   node scripts/skill_description_auditor.js --review                  # scan 48 skills, write JSONL+MD (default)
 *   node scripts/skill_description_auditor.js --review --format jsonl   # default
 *   node scripts/skill_description_auditor.js --review --min-score 50   # only flag below 50
 *   node scripts/skill_description_auditor.js --auto-fix \
 *     --min-score 90 --i-understand-this-modifies-files                 # gated, requires explicit ack
 *   node scripts/skill_description_auditor.js --skills-dir /custom/path # override dir
 *
 * Modes:
 *   --review  (default) — scan + report, NO disk write to skill files
 *   --auto-fix          — gated, writes new descriptions to disk via safeWriteFileSync
 *
 * Exit codes:
 *   0 = success (audit ran)
 *   1 = error (bad args, self-test fail, fatal I/O)
 *   2 = self-test had unexpected result (warning)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────────────────
// CONFIG — magic numbers / tunables
// ──────────────────────────────────────────────────────────────────
const CONFIG = {
  // Scoring weights (sum = 100)
  WEIGHTS: {
    action_verb: 20,
    trigger: 25,
    capabilities: 20,
    length: 10,
    vague_words: 10,
    xml_brackets: 5,
    trigger_spam: 5,
    perspective: 5
  },
  // Length ideal range (Anthropic skill description sweet spot)
  LENGTH_MIN: 80,
  LENGTH_MAX: 200,
  // Pass threshold
  PASS_SCORE: 70,
  // Auto-fix safety
  AUTO_FIX_MIN_SCORE: 90,           // skills must score >= 90 to be auto-fixed
  REWRITE_CONFIDENCE_MIN: 0.85,     // rewrite confidence must be >= 0.85
  // Default skills dir
  DEFAULT_SKILLS_DIR: path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace/skills'),
  // Reports dir
  REPORTS_DIR: path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace/.spawn/reports'),
  // Pattern detection
  VAGUE_WORD_REGEX: /\b(helper|utility|utilities|stuff|things|various|general purpose|miscellaneous|misc)\b/i,
  XML_REGEX: /<[a-zA-Z\/][^>]*>/,
  TRIGGER_PHRASE_REGEX: /\b(use when|use this when|apply this when|apply when|trigger this when)\b/gi,
  // First-person prefixes (Cantonese + English)
  FIRST_PERSON_REGEX: /^(\s*)(I\s|你|你應該|We\s|我)/,
  // Action verb whitelist (for partial credit detection)
  ACTION_VERB_WHITELIST: /\b(Migrate|Build|Diagnose|Scan|Spawn|Workflow|Convert|Audit|Deploy|Verify|Test|Troubleshoot|Refactor|Maintain|Schedule|Generate|Extract|Configure|Manage|Collect|Convert|Compose|Replace|Reorganize|Recalibrate|Reset|Repair|Review|Run|Update|Handle|Harden|Implement|Initialise|Initialize|Inspect|Install|Integrate|Iterate|List|Load|Make|Merge|Migrate|Monitor|Normalize|Optimize|Organize|Outline|Parse|Patch|Plan|Plot|Populate|Predict|Prepare|Present|Print|Process|Profile|Program|Project|Protect|Provide|Query|Quote|Raise|Randomize|Rate|Raw|Read|Recall|Receive|Reconcile|Record|Recreate|Reduce|Reference|Reflect|Register|Regulate|Reject|Release|Reload|Remove|Render|Repeat|Replace|Report|Request|Reset|Resolve|Restore|Restrict|Retrieve|Return|Reuse|Reverse|Review|Revise|Rewrite|Rotate|Round|Round-trip|Roundtrip|Route|Run|Sample|Save|Scan|Schedule|Score|Scrub|Search|Secure|Select|Send|Separate|Serialize|Server|Set|Settle|Sign|Simplify|Simulate|Skip|Sort|Source|Specify|Split|Stage|Stamp|Start|State|Store|Stream|Structure|Style|Submit|Subscribe|Substitute|Succeed|Suggest|Summarize|Supervise|Supply|Support|Survey|Suspend|Switch|Sync|Synchronize|Table|Tag|Take|Target|Task|Teach|Tell|Test|Think|Throw|Tie|Time|Toggle|Trace|Track|Trade|Train|Transfer|Transform|Translate|Transmit|Transport|Trap|Travel|Trigger|Trim|Trip|Troubleshoot|Tune|Turn|Type|Unify|Union|Unique|Unload|Unpack|Unsubscribe|Update|Upgrade|Upload|Use|Validate|Verify|Version|View|Visit|Walk|Wander|Warn|Watch|Weigh|Welcome|Widen|Win|Wipe|Wire|Withdraw|Work|Workaround|Workflow|Write)\b/,
  // Past-participle / gerund detection
  GERUND_REGEX: /\b\w+(ing|ed)\b/,
  // Trigger phrase found (separate from count for spam)
  HAS_TRIGGER_PHRASE: /\b(use when|use this when|apply this when|apply when|trigger this when)\b/i,
  // Capabilities segment header
  CAPABILITIES_HEADER: /\b(key capabilities|capabilities|key functions|key tools|capability)\b/i,
  // Tool names for partial capability credit
  TOOL_NAMES: /\b(node|git|cron|bash|ssh|openclaw|npm|docker|opencode|kimi|minimax|deepseek|qwen|obsidian|mem|skill|jq|grep|rg|sed|awk)\b|`[^`]+`/i,
  // Skill symlink pattern
  SKILL_LINK_PATTERN: /^_learned_(.+)$/
};

// ──────────────────────────────────────────────────────────────────
// SELF-TEST CASES (spec §3.4)
// ──────────────────────────────────────────────────────────────────
const SELF_TEST_CASES = [
  { name: 'cron-migration-target', desc: 'Migrate cron jobs 從 agentTurn 到 command kind. Use when: ...', expected: 'pass' },
  { name: 'discord-vague',         desc: 'Discord skill tools',                                            expected: 'fail' },
  { name: 'xml-brackets',          desc: '<tool>helper</tool>',                                            expected: 'fail' },
  { name: 'trigger-spam',          desc: 'Use when X. Use when Y. Use when Z.',                            expected: 'fail' },
  { name: 'first-person',          desc: 'I migrate your cron jobs for you',                               expected: 'fail' },
  { name: 'session-resume-target', desc: 'Diagnose session-resume failures via spawn_config.js + queue audit. Use when: ...', expected: 'pass' }
];

// ──────────────────────────────────────────────────────────────────
// FRONTMATTER PARSING
// ──────────────────────────────────────────────────────────────────
function parseFrontmatter(content) {
  // Match optional YAML frontmatter between --- markers
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const yaml = m[1];
  // Robust description extraction: handle unquoted / double-quoted / single-quoted,
  // AND allow apostrophes/quotes INSIDE the description (e.g. "OpenClaw's")
  // Strategy: find the line, detect leading quote, extract to EOL, strip optional trailing quote
  const descLine = yaml.match(/^description:\s*(.*)$/m);
  if (!descLine) {
    return { raw: yaml, description: null, full: content };
  }
  let raw = descLine[1].trim();
  // Detect wrapping quote style: only strip if the LAST char matches the FIRST char
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      raw = raw.slice(1, -1);
    } else if (first === '"' || first === "'") {
      // Leading quote but no closing — still strip the leading quote to avoid garbage
      raw = raw.slice(1);
    }
  }
  return {
    raw: yaml,
    description: raw.length > 0 ? raw : null,
    full: content
  };
}

// ──────────────────────────────────────────────────────────────────
// SCORING — 8 criteria (0-100 total)
// ──────────────────────────────────────────────────────────────────
function scoreActionVerb(desc) {
  // 1. Action verb (20 pts)
  // First 50 chars should start with capitalized verb OR contain whitelist verb
  const first50 = desc.slice(0, 50);
  // Check verb-first: starts with capital letter + has gerund/verb form within first 50
  const verbFirst = /^[A-Z][a-z]/.test(first50) && (CONFIG.GERUND_REGEX.test(first50) || /^[A-Z][a-z]+/.test(first50.split(/\s+/)[0] || ''));
  const hasWhitelistVerb = CONFIG.ACTION_VERB_WHITELIST.test(desc);
  // Cantonese verb particles
  const hasCantoneseVerb = /[動處作]/.test(first50);

  if (verbFirst || hasCantoneseVerb) {
    return { score: 20, max: 20, note: verbFirst ? 'Verb-first in first 50 chars' : 'Cantonese verb particle detected' };
  }
  if (hasWhitelistVerb) {
    return { score: 15, max: 20, note: 'Has whitelist verb but not verb-first' };
  }
  return { score: 0, max: 20, note: 'No action verb detected in first 50 chars' };
}

function scoreTrigger(desc) {
  // 2. Trigger phrase (25 pts)
  if (!CONFIG.HAS_TRIGGER_PHRASE.test(desc)) {
    return { score: 0, max: 25, note: 'No "Use when" / "Apply when" / "Trigger this when" phrase' };
  }
  // Has trigger — count comma-separated conditions after the trigger phrase
  const triggerMatch = desc.match(CONFIG.HAS_TRIGGER_PHRASE);
  if (!triggerMatch) return { score: 0, max: 25, note: 'No trigger' };
  const afterTrigger = desc.slice(triggerMatch.index + triggerMatch[0].length);
  // Count conditions: comma, period+space, or " / " separators
  const conditionCount = (afterTrigger.match(/[,，/]/g) || []).length + 1;
  if (conditionCount >= 3) {
    return { score: 25, max: 25, note: `Has trigger + ${conditionCount} conditions` };
  }
  return { score: 15, max: 25, note: `Has trigger but only ${conditionCount} condition(s)` };
}

function scoreCapabilities(desc) {
  // 3. Capabilities segment (20 pts)
  if (CONFIG.CAPABILITIES_HEADER.test(desc)) {
    return { score: 20, max: 20, note: 'Has "Key capabilities" / "Capabilities" header' };
  }
  if (CONFIG.TOOL_NAMES.test(desc)) {
    return { score: 15, max: 20, note: 'Has tool name / backtick code reference' };
  }
  return { score: 0, max: 20, note: 'No capabilities segment or tool names' };
}

function scoreLength(desc) {
  // 4. Length 80-200 (10 pts)
  const len = desc.length;
  if (len >= CONFIG.LENGTH_MIN && len <= CONFIG.LENGTH_MAX) {
    return { score: 10, max: 10, note: `${len} chars in ideal range` };
  }
  if (len >= 50 && len <= 300) {
    return { score: 5, max: 10, note: `${len} chars outside ideal 80-200` };
  }
  return { score: 0, max: 10, note: `${len} chars — way off ideal` };
}

function scoreVagueWords(desc) {
  // 5. No vague words (10 pts)
  if (CONFIG.VAGUE_WORD_REGEX.test(desc)) {
    const match = desc.match(CONFIG.VAGUE_WORD_REGEX);
    return { score: 0, max: 10, note: `Vague word: "${match[0]}"` };
  }
  return { score: 10, max: 10, note: 'Clean — no vague words' };
}

function scoreXmlBrackets(desc) {
  // 6. No XML/尖括號 (5 pts)
  if (CONFIG.XML_REGEX.test(desc)) {
    const match = desc.match(CONFIG.XML_REGEX);
    return { score: 0, max: 5, note: `Has XML/angle-bracket: "${match[0]}"` };
  }
  return { score: 5, max: 5, note: 'Clean — no XML patterns' };
}

function scoreTriggerSpam(desc) {
  // 7. No trigger spam (5 pts)
  const matches = desc.match(CONFIG.TRIGGER_PHRASE_REGEX) || [];
  if (matches.length > 1) {
    return { score: 0, max: 5, note: `Trigger phrase appears ${matches.length} times (spam)` };
  }
  return { score: 5, max: 5, note: 'Clean — ≤ 1 trigger phrase' };
}

function scorePerspective(desc) {
  // 8. 3-person perspective (5 pts)
  if (CONFIG.FIRST_PERSON_REGEX.test(desc)) {
    return { score: 0, max: 5, note: 'First-person perspective detected' };
  }
  return { score: 5, max: 5, note: '3rd-person perspective' };
}

function scoreDescription(desc) {
  // Defensive: non-string input
  if (typeof desc !== 'string' || desc.trim().length === 0) {
    return {
      skill: 'unknown',
      description: desc || '',
      length: 0,
      score: 0,
      passed: false,
      criteria: {
        action_verb:   { score: 0, max: 20, note: 'Empty description' },
        trigger:       { score: 0, max: 25, note: 'Empty description' },
        capabilities:  { score: 0, max: 20, note: 'Empty description' },
        length:        { score: 0, max: 10, note: 'Empty description' },
        vague_words:   { score: 0, max: 10, note: 'Empty description' },
        xml_brackets:  { score: 0, max: 5,  note: 'Empty description' },
        trigger_spam:  { score: 0, max: 5,  note: 'Empty description' },
        perspective:   { score: 0, max: 5,  note: 'Empty description' }
      },
      suggested_description: '',
      rewrite_confidence: 0,
      needs_human_review: true,
      _error: 'Empty description'
    };
  }
  const criteria = {
    action_verb:  scoreActionVerb(desc),
    trigger:      scoreTrigger(desc),
    capabilities: scoreCapabilities(desc),
    length:       scoreLength(desc),
    vague_words:  scoreVagueWords(desc),
    xml_brackets: scoreXmlBrackets(desc),
    trigger_spam: scoreTriggerSpam(desc),
    perspective:  scorePerspective(desc)
  };
  const totalScore = Object.values(criteria).reduce((sum, c) => sum + c.score, 0);
  return {
    description: desc,
    length: desc.length,
    score: totalScore,
    passed: totalScore >= CONFIG.PASS_SCORE,
    criteria
  };
}

// ──────────────────────────────────────────────────────────────────
// SUGGESTED DESCRIPTION (heuristic, not LLM rewrite — that's M1.3)
// ──────────────────────────────────────────────────────────────────
function suggestDescription(skillName, currentDesc) {
  // Build a 3-segment suggestion from current desc + skill name
  // Extract: action verb (or invent), domain, tools
  const cleanName = skillName.replace(/-/g, ' ');

  // Try to find an action verb in current desc
  const verbMatch = currentDesc.match(CONFIG.ACTION_VERB_WHITELIST);
  const verb = verbMatch ? verbMatch[0] : capitalize(cleanName.split(' ')[0] || 'Handle');

  // Detect domain keywords (cron, skill, agent, file, system, code, etc.)
  const domainMatch = currentDesc.match(/\b(cron|skill|agent|file|system|code|memory|issue|email|error|deploy|session|model|context|plugin|pipeline|review|audit|config|trigger|spawn|sub-agent|workflow|loop|knowledge)\b/i);
  const domain = domainMatch ? domainMatch[0].toLowerCase() : cleanName.split(' ').slice(0, 2).join(' ');

  // Detect tool names
  const toolMatches = currentDesc.match(/`[^`]+`/g) || [];
  const tools = toolMatches.slice(0, 3).map(t => t.replace(/`/g, ''));

  // Construct 3-segment
  const segment1 = `${verb} ${domain} related operations via ${tools.length > 0 ? tools.join(' + ') : 'CLI tools'}`;
  const segment2 = `Use when: ${domain} task needs structured workflow, ${tools.length > 0 ? 'tools are ' + tools.join(' / ') : 'standard CLI access'}, or multiple steps required.`;
  const segment3 = `Key capabilities: ${tools.length > 0 ? tools.map(t => '`' + t + '`').join(', ') : 'orchestration, validation, error handling'}.`;

  return `${segment1}. ${segment2} ${segment3}`;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function calcRewriteConfidence(audit) {
  // Heuristic confidence: based on how complete the input info is
  let conf = 0.5; // baseline
  // Boost if we found some keywords we can use
  if (audit.criteria.action_verb.score > 0) conf += 0.1;
  if (audit.criteria.capabilities.score > 0) conf += 0.1;
  if (audit.criteria.length.score > 0) conf += 0.1;
  if (audit.description && audit.description.length >= 40) conf += 0.1;
  // Penalty if we have an error
  if (audit._error) conf -= 0.3;
  return Math.max(0, Math.min(1, parseFloat(conf.toFixed(2))));
}

function needsHumanReview(audit) {
  if (audit._error) return true;
  if (audit.length < 30) return true;
  if (audit.criteria.action_verb.score === 0) return true;
  if (audit.criteria.xml_brackets.score === 0) return true; // structural problem
  return false;
}

// ──────────────────────────────────────────────────────────────────
// SKILL DISCOVERY + AUDIT
// ──────────────────────────────────────────────────────────────────
function discoverSkills(skillsDir) {
  let entries;
  try {
    entries = fs.readdirSync(skillsDir);
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`Skills dir not found: ${skillsDir}`);
    }
    throw e;
  }
  return entries
    .filter(name => CONFIG.SKILL_LINK_PATTERN.test(name))
    .map(name => {
      const m = name.match(CONFIG.SKILL_LINK_PATTERN);
      return { dirName: name, skillName: m[1], fullPath: path.join(skillsDir, name, 'SKILL.md') };
    });
}

function auditSkill(skillPath) {
  const dirName = path.basename(path.dirname(skillPath));
  // Strip _learned_ prefix for cleaner reporting
  const skillName = dirName.replace(/^_learned_/, '');
  const skill = {
    skill: skillName,
    path: path.relative(path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace'), skillPath)
  };
  let content;
  try {
    content = fs.readFileSync(skillPath, 'utf8');
  } catch (e) {
    return {
      ...skill,
      description: '',
      length: 0,
      score: 0,
      passed: false,
      criteria: {},
      suggested_description: '',
      rewrite_confidence: 0,
      needs_human_review: true,
      _error: `File read failed: ${e.message}`
    };
  }
  const fm = parseFrontmatter(content);
  if (!fm) {
    return {
      ...skill,
      description: '',
      length: 0,
      score: 0,
      passed: false,
      criteria: {
        action_verb:  { score: 0, max: 20, note: 'Malformed frontmatter' },
        trigger:      { score: 0, max: 25, note: 'Malformed frontmatter' },
        capabilities: { score: 0, max: 20, note: 'Malformed frontmatter' },
        length:       { score: 0, max: 10, note: 'Malformed frontmatter' },
        vague_words:  { score: 0, max: 10, note: 'Malformed frontmatter' },
        xml_brackets: { score: 0, max: 5,  note: 'Malformed frontmatter' },
        trigger_spam: { score: 0, max: 5,  note: 'Malformed frontmatter' },
        perspective:  { score: 0, max: 5,  note: 'Malformed frontmatter' }
      },
      suggested_description: '',
      rewrite_confidence: 0,
      needs_human_review: true,
      _error: 'Malformed frontmatter (no --- markers)'
    };
  }
  if (!fm.description) {
    return {
      ...skill,
      description: '',
      length: 0,
      score: 0,
      passed: false,
      criteria: {
        action_verb:  { score: 0, max: 20, note: 'No description field' },
        trigger:      { score: 0, max: 25, note: 'No description field' },
        capabilities: { score: 0, max: 20, note: 'No description field' },
        length:       { score: 0, max: 10, note: 'No description field' },
        vague_words:  { score: 0, max: 10, note: 'No description field' },
        xml_brackets: { score: 0, max: 5,  note: 'No description field' },
        trigger_spam: { score: 0, max: 5,  note: 'No description field' },
        perspective:  { score: 0, max: 5,  note: 'No description field' }
      },
      suggested_description: '',
      rewrite_confidence: 0,
      needs_human_review: true,
      _error: 'No description field in frontmatter'
    };
  }
  const audit = scoreDescription(fm.description);
  const result = { ...skill, ...audit };
  result.suggested_description = suggestDescription(result.skill, fm.description);
  result.rewrite_confidence = calcRewriteConfidence(audit);
  result.needs_human_review = needsHumanReview(audit);
  return result;
}

// ──────────────────────────────────────────────────────────────────
// REPORT GENERATION
// ──────────────────────────────────────────────────────────────────
function writeJsonlReport(results, date) {
  if (!fs.existsSync(CONFIG.REPORTS_DIR)) {
    try {
      fs.mkdirSync(CONFIG.REPORTS_DIR, { recursive: true });
    } catch (e) {
      throw new Error(`Cannot create reports dir: ${e.message}`);
    }
  }
  const outPath = path.join(CONFIG.REPORTS_DIR, `description_audit_${date}.jsonl`);
  const lines = results.map(r => JSON.stringify(r)).join('\n') + '\n';
  try {
    fs.writeFileSync(outPath, lines, 'utf8');
    return outPath;
  } catch (e) {
    throw new Error(`JSONL write failed: ${e.message}`);
  }
}

function writeMarkdownReport(results, date) {
  if (!fs.existsSync(CONFIG.REPORTS_DIR)) {
    try {
      fs.mkdirSync(CONFIG.REPORTS_DIR, { recursive: true });
    } catch (e) {
      throw new Error(`Cannot create reports dir: ${e.message}`);
    }
  }
  const outPath = path.join(CONFIG.REPORTS_DIR, `description_audit_${date}.md`);
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const avg = results.length > 0 ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1) : 0;

  const top10worst = sorted.slice(0, 10);
  const top5best = sorted.slice(-5).reverse();
  const needsReview = results.filter(r => r.needs_human_review).length;

  const lines = [];
  lines.push(`# Skill Description Audit — ${date}`);
  lines.push('');
  lines.push(`**Total skills audited:** ${results.length}  `);
  lines.push(`**Passed (≥70):** ${passed}  `);
  lines.push(`**Failed (<70):** ${failed}  `);
  lines.push(`**Needs human review:** ${needsReview}  `);
  lines.push(`**Average score:** ${avg}/100`);
  lines.push('');
  lines.push('## Score distribution');
  lines.push('');
  lines.push('| Range | Count |');
  lines.push('|-------|-------|');
  lines.push(`| 90–ideal | ${results.filter(r => r.score >= 90).length} |`);
  lines.push(`| 70–89    | ${results.filter(r => r.score >= 70 && r.score < 90).length} |`);
  lines.push(`| 50–69    | ${results.filter(r => r.score >= 50 && r.score < 70).length} |`);
  lines.push(`| 30–49    | ${results.filter(r => r.score >= 30 && r.score < 50).length} |`);
  lines.push(`| 0–29     | ${results.filter(r => r.score < 30).length} |`);
  lines.push('');
  lines.push('## Top 10 worst (priority for M1.3)');
  lines.push('');
  lines.push('| # | Skill | Score | Length | Issue |');
  lines.push('|---|-------|-------|--------|-------|');
  top10worst.forEach((r, i) => {
    const mainIssue = r.criteria.trigger && r.criteria.trigger.score === 0 ? 'no trigger' :
                      r.criteria.capabilities && r.criteria.capabilities.score === 0 ? 'no capabilities' :
                      r._error || 'mixed';
    lines.push(`| ${i + 1} | \`${r.skill}\` | ${r.score} | ${r.length} | ${mainIssue} |`);
  });
  lines.push('');
  lines.push('## Top 5 best (reference patterns for M1.3)');
  lines.push('');
  lines.push('| # | Skill | Score | Length | Description (first 100c) |');
  lines.push('|---|-------|-------|--------|------------------------------|');
  top5best.forEach((r, i) => {
    const desc = (r.description || '').slice(0, 1e2).replace(/\|/g, '\\|').replace(/\n/g, ' '); // 1e2c preview
    lines.push(`| ${i + 1} | \`${r.skill}\` | ${r.score} | ${r.length} | ${desc} |`);
  });
  lines.push('');
  lines.push('## Suggested actions');
  lines.push('');
  lines.push(`- **${top10worst.length} skills** need full rewrite (target M1.3 top-10)`);
  lines.push(`- **${results.filter(r => r.score >= 50 && r.score < 70).length} skills** need partial rewrite (target M1.4)`);
  lines.push(`- **${results.filter(r => r.score >= 70).length} skills** already pass — leave for now`);
  lines.push('');
  lines.push('## M1.3 / M1.4 selection criteria');
  lines.push('');
  lines.push('Priority = lowest score + highest frequency in `<categorized_skills>` block.');
  lines.push('See `.spawn/reports/description_audit_' + date + '.jsonl` for full per-skill data.');
  lines.push('');

  try {
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    return outPath;
  } catch (e) {
    throw new Error(`MD write failed: ${e.message}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// SELF-TEST
// ──────────────────────────────────────────────────────────────────
function runSelfTest() {
  console.log('Self-test: 6 built-in cases\n');
  console.log('  #  | name                  | expected | actual | note');
  console.log('  ---|-----------------------|----------|--------|-----');
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < SELF_TEST_CASES.length; i++) {
    const tc = SELF_TEST_CASES[i];
    const audit = scoreDescription(tc.desc);
    const actual = audit.passed ? 'pass' : 'fail';
    const ok = actual === tc.expected;
    if (ok) passed++; else failed++;
    // Build a short note explaining the actual
    let note = '';
    if (audit.criteria.xml_brackets && audit.criteria.xml_brackets.score === 0) {
      note = 'xml_brackets=0';
    } else if (audit.criteria.trigger_spam && audit.criteria.trigger_spam.score === 0) {
      note = `trigger_spam=0 (${tc.desc.match(/use when/gi)?.length || 0}x)`;
    } else if (audit.criteria.perspective && audit.criteria.perspective.score === 0) {
      note = 'first-person';
    } else if (audit.criteria.trigger && audit.criteria.trigger.score === 0) {
      note = 'no trigger';
    } else if (audit.criteria.vague_words && audit.criteria.vague_words.score === 0) {
      note = 'vague word';
    } else {
      note = `score=${audit.score}`;
    }
    console.log(`  ${String(i + 1).padStart(2)} | ${tc.name.padEnd(21)} | ${tc.expected.padEnd(8)} | ${actual.padEnd(6)} | ${note}${ok ? ' ✓' : ' ✗'}`);
  }
  console.log('');
  console.log(`Result: ${passed}/${SELF_TEST_CASES.length} expected match${failed > 0 ? `, ${failed} mismatched` : ''}`);
  return { passed, failed, total: SELF_TEST_CASES.length };
}

// ──────────────────────────────────────────────────────────────────
// REVIEW MODE
// ──────────────────────────────────────────────────────────────────
function runReview(skillsDir, minScore, verbose) {
  const date = new Date().toISOString().slice(0, 10);
  const skills = discoverSkills(skillsDir);
  if (verbose) console.log(`Discovered ${skills.length} skills in ${skillsDir}`);

  const results = [];
  let errors = 0;
  for (const s of skills) {
    try {
      const audit = auditSkill(s.fullPath);
      results.push(audit);
      if (audit._error) errors++;
    } catch (e) {
      if (verbose) console.error(`Error auditing ${s.skillName}: ${e.message}`);
      errors++;
    }
  }

  if (verbose) {
    const belowThreshold = results.filter(r => r.score < minScore);
    console.log(`Audited ${results.length} skills, ${belowThreshold.length} below --min-score ${minScore}, ${errors} errors`);
  }

  const jsonlPath = writeJsonlReport(results, date);
  const mdPath = writeMarkdownReport(results, date);
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const avg = results.length > 0 ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1) : 0;

  console.log(`Review complete: ${results.length} skills, ${passed} pass / ${failed} fail, avg ${avg}/1e2`);
  console.log(`JSONL: ${jsonlPath}`);
  console.log(`MD:    ${mdPath}`);
  return { results, jsonlPath, mdPath, passed, failed, avg, errors };
}

// ──────────────────────────────────────────────────────────────────
// AUTO-FIX MODE (gated, dangerous)
// ──────────────────────────────────────────────────────────────────
function runAutoFix(skillsDir, minScore, verbose) {
  if (minScore < CONFIG.AUTO_FIX_MIN_SCORE) {
    console.error(`ERROR: --auto-fix requires --min-score >= ${CONFIG.AUTO_FIX_MIN_SCORE} (got ${minScore})`);
    process.exit(1);
  }
  if (!process.argv.includes('--i-understand-this-modifies-files')) {
    console.error(`ERROR: --auto-fix requires explicit --i-understand-this-modifies-files flag`);
    process.exit(1);
  }
  const date = new Date().toISOString().slice(0, 10);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const skills = discoverSkills(skillsDir);
  if (verbose) console.log(`Auto-fix mode: discovered ${skills.length} skills`);

  let updated = 0;
  let skipped = 0;
  const auditLogPath = path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace', '.skill_description_audit.jsonl');
  for (const s of skills) {
    try {
      const audit = auditSkill(s.fullPath);
      // Skip if score not high enough OR rewrite_confidence too low
      if (audit.score < CONFIG.AUTO_FIX_MIN_SCORE || audit.rewrite_confidence < CONFIG.REWRITE_CONFIDENCE_MIN) {
        skipped++;
        continue;
      }
      // Backup first
      const backupPath = `${s.fullPath}.bak-${ts}`;
      try {
        fs.copyFileSync(s.fullPath, backupPath);
      } catch (e) {
        console.error(`Backup failed for ${s.skillName}: ${e.message}`);
        continue;
      }
      // Atomic write (tmp + rename) — read, transform, write, rename all guarded
      let content;
      try {
        content = fs.readFileSync(s.fullPath, 'utf8');
      } catch (e) {
        console.error(`Read failed for ${s.skillName}: ${e.message}`);
        continue;
      }
      const newContent = content.replace(
        /^description:\s*["']?[^"'\n]+["']?/m,
        `description: ${audit.suggested_description}`
      );
      const tmpPath = `${s.fullPath}.tmp-${ts}`;
      try {
        fs.writeFileSync(tmpPath, newContent, 'utf8');
        fs.renameSync(tmpPath, s.fullPath);
      } catch (e) {
        console.error(`Atomic write failed for ${s.skillName}: ${e.message}`);
        // Try to clean up tmp file
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        continue;
      }
      // Log to audit
      try {
        const logLine = JSON.stringify({
          ts: new Date().toISOString(),
          skill: s.skillName,
          old_score: audit.score,
          new_description: audit.suggested_description,
          backup: backupPath,
          confidence: audit.rewrite_confidence
        }) + '\n';
        fs.appendFileSync(auditLogPath, logLine);
      } catch (e) {
        console.warn(`Audit log append failed: ${e.message}`);
      }
      updated++;
      if (verbose) console.log(`Updated ${s.skillName} (score ${audit.score} → ${audit.score /* same, we don't re-audit */})`);
    } catch (e) {
      if (verbose) console.error(`Error fixing ${s.skillName}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`Auto-fix complete: ${updated} updated, ${skipped} skipped`);
  console.log(`Audit log: ${auditLogPath}`);
  return { updated, skipped };
}

// ──────────────────────────────────────────────────────────────────
// CLI PARSING
// ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {
    skillsDir: CONFIG.DEFAULT_SKILLS_DIR,
    format: 'jsonl',
    autoFix: false,
    review: false,
    selfTest: false,
    minScore: CONFIG.PASS_SCORE,
    verbose: false
  };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--skills-dir') args.skillsDir = process.argv[++i];
    else if (a === '--format') args.format = process.argv[++i];
    else if (a === '--auto-fix') args.autoFix = true;
    else if (a === '--review') args.review = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--min-score') args.minScore = parseInt(process.argv[++i], 10);
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--i-understand-this-modifies-files') { /* gate flag, consumed elsewhere */ }
    else if (a === '-h' || a === '--help') { args.help = true; }
  }
  return args;
}

function printHelp() {
  console.log(`skill_description_auditor.js — M1.2 deliverable

Usage:
  node scripts/skill_description_auditor.js --self-test
  node scripts/skill_description_auditor.js --review [--skills-dir PATH] [--min-score N] [--verbose]
  node scripts/skill_description_auditor.js --auto-fix \\
    --min-score 90 --i-understand-this-modifies-files

Modes:
  --self-test           Run 6 built-in test cases (cron-migration-target, discord-vague, xml-brackets,
                        trigger-spam, first-person, session-resume-target)
  --review (default)    Scan all skills, write JSONL + MD reports to .spawn/reports/
  --auto-fix (gated)    Write new descriptions to disk. Requires --min-score 90 AND
                        --i-understand-this-modifies-files.

Flags:
  --skills-dir PATH     Override skills dir (default: ~/.openclaw/workspace/skills)
  --format jsonl|md     Output format hint (default: jsonl)
  --min-score N         Threshold for "pass" (default: 70)
  --verbose             Show progress
  -h, --help            Show this help
`);
}

// ──────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.selfTest) {
    const r = runSelfTest();
    process.exit(r.failed > 0 ? 2 : 0);
  }
  if (args.autoFix) {
    runAutoFix(args.skillsDir, args.minScore, args.verbose);
    process.exit(0);
  }
  // Default: review mode
  try {
    const r = runReview(args.skillsDir, args.minScore, args.verbose);
    process.exit(r.errors > 0 ? 1 : 0);
  } catch (e) {
    console.error(`FATAL: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CONFIG,
  parseFrontmatter,
  scoreDescription,
  scoreActionVerb,
  scoreTrigger,
  scoreCapabilities,
  scoreLength,
  scoreVagueWords,
  scoreXmlBrackets,
  scoreTriggerSpam,
  scorePerspective,
  suggestDescription,
  calcRewriteConfidence,
  needsHumanReview,
  auditSkill,
  discoverSkills,
  runSelfTest,
  runReview,
  SELF_TEST_CASES
};
