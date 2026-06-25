#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const DRY_RUN = process.argv.includes('--dry-run');
const INACTIVITY_TRIGGER = process.argv.includes('--inactivity-trigger');
const METRICS_FLAG = process.argv.includes('--metrics');
const log = (...args) => { if (!_quiet) console.log(...args); };

if (DRY_RUN) log('🔍 DRY-RUN MODE: no files will be modified');

/**
 * Weekly Correction Loop v2 — Behavior-Focused
 * 每周日自動運行：
 * 1. 讀取 decision_log.jsonl 分析行為 pattern
 * 2. 讀取 errors.json 做 system health（次要）
 * 3. 生成 suggestion file（唔再 auto-apply AGENTS.md）
 *
 * Run: node scripts/weekly_correction_loop.js
 * Trigger: Sunday 3:00 HKT (cron + 30min stagger)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { CONFIG: TEMPLATE_CONFIG } = require('./weekly_correction_templates');
const { WeeklyCorrectionReportGenerator } = require('./weekly_correction_generator');

let ERRORS_JSON, WS, MEMORY_DIR;
try {
  ({ ERRORS_JSON, WS, MEMORY_DIR } = require('./lib/config'));
} catch (e) {
  console.error('❌ Failed to load config:', e.message);
  process.exit(1);
}
if (!WS || typeof WS !== 'string') {
  console.error('❌ WORKSPACE path not properly configured');
  process.exit(1);
}
if (!ERRORS_JSON || typeof ERRORS_JSON !== 'string') {
  console.error('❌ ERRORS_JSON path not properly configured');
  process.exit(1);
}

const { getHKTDate, getHKTDateTime } = require('./lib/time');
const { ONE_DAY_MS } = require('./lib/time_constants');

// Phase B: LLM Umbrella Consolidation (see scripts/lib/umbrella_consolidation.js)
const umbrellaConsolidation = require('./lib/umbrella_consolidation');

const HKT_TIMEZONE_OFFSET = '+08:00';
const STATE_FILE = (() => {
  try { return path.join(MEMORY_DIR || '/tmp', 'correction-loop-state.json'); }
  catch (e) { return '/tmp/correction-loop-state.json'; }
})();

const CONFIG = {
  RECENT_ERRORS_DAYS: TEMPLATE_CONFIG.RECENT_ERRORS_DAYS || 7,
  FALLBACK_DAYS: TEMPLATE_CONFIG.FALLBACK_DAYS || 7,
  MAX_PROCESSED_ERRORS: TEMPLATE_CONFIG.MAX_PROCESSED_ERRORS || 100,
  DISCORD_CHANNEL_ID: TEMPLATE_CONFIG.DISCORD_CHANNEL_ID || '1473376125584670872',
};

const SCRIPT_START_TIME = Date.now();

const SKILLS_DIR = path.join(WS, 'skills-learned');
const SKILLS_ACTIVE = path.join(WS, 'skills');
const CONSOLIDATION_DIR = path.join(WS, '.skill_consolidation_proposals');
const SIMILARITY_THRESHOLD = 0.3;
const PROPOSALS_DIR = path.join(WS, 'skills', 'proposals');

// Phase 4: Inactivity-based curator trigger
const CURATOR_RUN_FILE = path.join(WS, '.last_curator_run.json');
const CURATOR_RUN_MIN_DAYS = 3;
const CURATOR_RUN_MIN_NEW = 1;

// Phase 4: Performance telemetry
const METRICS_FILE = path.join(WS, '.skill_metrics.json');
const MAX_METRICS_ENTRIES = 100;

// ═══════════════════════════════════════════════════════════════
// Pin Semantics Helper
// ═══════════════════════════════════════════════════════════════

/**
 * Check if an action is blocked for pinned skills.
 * Pin blocks destructive / status-altering actions only;
 * content patches, provenance changes, renames, and new support
 * files are always allowed regardless of pin state.
 *
 * @param {string} action - The action being attempted.
 *        Supported values: 'delete', 'archive', 'consolidate',
 *        'status_change_to_archived', 'status_change_to_stale'
 * @returns {boolean} true if pinned skills should block this action
 */
const { isActionBlockedByPin } = require('./lib/pin_semantics');

/**
 * Collected modifications that would have been made in dry-run mode.
 * Populated throughout the curator loop, printed in the summary.
 * @type {string[]}
 */
const dryRunModifications = DRY_RUN ? [] : null;

/**
 * Record a dry-run modification for the summary.
 * No-op when not in dry-run mode.
 */
function recordDryRunMod(mod) {
  if (DRY_RUN && dryRunModifications) dryRunModifications.push(mod);
}

const reportGenerator = new WeeklyCorrectionReportGenerator();
const DEFAULT_STATE = () => ({
  lastRun: null, lastRunDate: null, processedErrors: [],
  proposedRules: [], confirmedRules: [], suggestions: [],
  lastErrorStats: { total: 0, patterns: 0, errorTypes: {} },
});

log('=== Weekly Correction Loop v2 ===\n');
log(`📅 Run time: ${getHKTDateTime()}\n`);

// ── Stale temp file cleanup ──
try {
  const wsDir = WS;
  const files = fs.readdirSync(wsDir);
  for (const f of files) {
    if (f.startsWith('.skill_prompt_cache.json.tmp') ||
        f.startsWith('.skill_metrics.json.tmp') ||
        f.startsWith('.last_curator_run.json.tmp') ||
        f.startsWith('correction-loop-state.json.tmp')) {
      try { fs.unlinkSync(path.join(wsDir, f)); } catch {}
    }
  }
} catch {}

// ── Load state ──
let state = DEFAULT_STATE();
try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = fs.readFileSync(STATE_FILE, 'utf8').trim();
    if (raw) {
      try { state = { ...DEFAULT_STATE(), ...JSON.parse(raw) }; }
      catch (e) { console.error('⚠️ State parse failed:', e.message); }
    }
  }
} catch (e) { log('⚠️ Could not load state:', e.message); }

const todayDate = getHKTDate();

// ── Phase 4: Metrics flag ──
if (METRICS_FLAG) {
  const metricsPath = METRICS_FILE;
  if (!fs.existsSync(metricsPath)) {
    log('📊 No metrics data yet.');
    process.exit(0);
  }
  try {
    const metrics = safeParseJson(metricsPath, { reviewer_runs: [], curator_runs: [] });
    const reviewerRuns = Array.isArray(metrics.reviewer_runs) ? metrics.reviewer_runs : [];
    const curatorRuns = Array.isArray(metrics.curator_runs) ? metrics.curator_runs : [];
    log('\n📊 === Performance Metrics (last 10 runs each) ===\n');
    log(`--- Reviewer Runs (${reviewerRuns.length} total) ---`);
    const recentReviewers = reviewerRuns.slice(-10);
    for (const r of recentReviewers) {
      const ts = new Date(r.ts).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
      log(`  ${ts} | ${r.durationMs}ms | cache:${r.cacheHit ? '✅' : '❌'} | signals:${r.signalsCount}`);
    }
    log(`\n--- Curator Runs (${curatorRuns.length} total) ---`);
    const recentCurators = curatorRuns.slice(-10);
    for (const r of recentCurators) {
      const ts = new Date(r.ts).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
      log(`  ${ts} | ${r.durationMs}ms | scanned:${r.skillsScanned} | promoted:${r.promoted} | trigger:${r.triggeredBy}`);
    }
    // Cache hit rate
    const totalReviewers = reviewerRuns.length;
    const cacheHits = reviewerRuns.filter(r => r.cacheHit).length;
    if (totalReviewers > 0) {
      const hitRate = Math.round(cacheHits / totalReviewers * 100);
      log(`\n📈 Cache hit rate: ${cacheHits}/${totalReviewers} (${hitRate}%)`);
    }
    log('');
  } catch (e) {
    log(`❌ Failed to read metrics: ${e.message}`);
  }
  process.exit(0);
}

// ── Phase 4: Inactivity-based curator trigger ──
if (INACTIVITY_TRIGGER) {
  log('🔔 Inactivity-based mini-curator triggered\n');
  handleMiniCurator();
  process.exit(0);
}

// ── Last-run-date check: skip if already ran today ──
if (state.lastRunDate === todayDate) {
  log(`⏭️ Already ran today. Skipping.`);
  process.exit(0);
}

// ── Consolidation flag handling ──
// These are standalone operations; run before any Sunday-only logic.

const CONSOLIDATE_MODE = process.argv.includes('--consolidate');
const APPLY_CONSOLIDATION_IDX = process.argv.indexOf('--apply-consolidation');
const APPLY_CONSOLIDATION = APPLY_CONSOLIDATION_IDX >= 0 && APPLY_CONSOLIDATION_IDX + 1 < process.argv.length
  ? process.argv[APPLY_CONSOLIDATION_IDX + 1]
  : null;

if (CONSOLIDATE_MODE) {
  log('🔍 Umbrella consolidation mode — scanning for similar skills...\n');
  handleConsolidation();
  process.exit(0);
}

if (APPLY_CONSOLIDATION) {
  log(`🔧 Applying consolidation from: ${APPLY_CONSOLIDATION}\n`);
  try {
    applyConsolidation(APPLY_CONSOLIDATION);
  } catch (e) {
    console.error(`❌ Consolidation apply failed: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Day check ──
const todayDayOfWeek = new Date(getHKTDate() + 'T00:00:00' + HKT_TIMEZONE_OFFSET).getDay();
if (state.lastRunDate) {
  const lastRunTime = new Date(state.lastRunDate + 'T00:00:00' + HKT_TIMEZONE_OFFSET);
  const now = new Date(getHKTDate() + 'T00:00:00' + HKT_TIMEZONE_OFFSET);
  const daysSince = Math.floor((now - lastRunTime) / 86400000);
  if (daysSince < CONFIG.FALLBACK_DAYS && todayDayOfWeek !== 0) {
    log(`⏭️ Not Sunday. Skipping.`);
    process.exit(0);
  }
} else if (todayDayOfWeek !== 0) {
  log(`⏭️ Never run before and not Sunday. Skipping.`);
  process.exit(0);
}

// ── Umbrella Consolidation Functions ──

/**
 * Read a skill file and extract its first 200 chars of body for similarity comparison.
 */
function readSkillBody(skillDir) {
  const skillFile = path.join(SKILLS_DIR, skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) return null;
  try {
    const content = fs.readFileSync(skillFile, 'utf8');
    const fm = content.match(FRONTMATTER_RE);
    const body = fm ? content.slice(fm[0].length).trim() : content.trim();
    return body.slice(0, 200);
  } catch { return null; }
}

// Frontmatter regex (shared constant for both literal and constructor use)
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

// Stop words for Jaccard similarity (BUG-08 fix: prevent inflation from common words)
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'and', 'or', 'but', 'if', 'while', 'that',
  'this', 'these', 'those', 'it', 'its'
]);

/**
 * Compute Jaccard similarity on word tokens of two strings.
 * Normalization: lowercase, strip punctuation, remove stop words.
 * Returns null if either input is empty or has <10 meaningful tokens.
 *
 * TODO (BUG-14): Future: use embeddings for semantic similarity
 */
function jaccardSimilarity(a, b) {
  if (!a || !b) return null;
  const tokensA = a.toLowerCase().split(/[\s\W]+/).filter(Boolean).filter(t => !STOP_WORDS.has(t));
  const tokensB = b.toLowerCase().split(/[\s\W]+/).filter(Boolean).filter(t => !STOP_WORDS.has(t));
  if (tokensA.length === 0 || tokensB.length === 0) return null;
  if (tokensA.length < 10 || tokensB.length < 10) return null; // too short for meaningful comparison (BUG-07)
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = new Set([...setA].filter(t => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Read SKILL.md frontmatter field safely.
 */
function readFrontmatterField(skillDir, field) {
  const skillFile = path.join(SKILLS_DIR, skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) return null;
  try {
    const content = fs.readFileSync(skillFile, 'utf8');
    // Use FRONTMATTER_RE directly instead of RegExp constructor to avoid escaping issues
    const m = content.match(FRONTMATTER_RE);
    if (!m) return null;
    const re = new RegExp(field + ':' + '\\s*(.+)');
    const f = m[0].match(re);
    return f ? f[1].trim() : null;
  } catch { return null; }
}

/**
 * Find pairs of similar agent-provenance skills using Jaccard similarity.
 * Only considers provenance: agent skills. Excludes pinned skills.
 * Returns: [{ skillA, skillB, score, bodyA, bodyB }]
 */
function findSimilarSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    log('   📁 skills-learned/ does not exist — no skills to compare.');
    return [];
  }

let dirs;
  try {
    dirs = fs.readdirSync(SKILLS_DIR).filter(f => {
      if (f === ".backups" || f === "_archive") return false;
      try { return fs.lstatSync(path.join(SKILLS_DIR, f)).isDirectory(); }
      catch { return false; }
    });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
    return [];
  }

  // Filter: only provenance:agent and not pin-blocked (consolidation is blocked)
  const agentDirs = dirs.filter(d => {
    const prov = readFrontmatterField(d, 'provenance');
    if (prov && (prov === 'bundled' || prov === 'user')) return false;
    const pinned = readFrontmatterField(d, 'pinned');
    // Block consolidation (similarity scanning is consolidation precursor)
    if (pinned === 'true' && isActionBlockedByPin('consolidate')) return false;
    return true;
  });

  if (agentDirs.length < 2) {
    log('   ⏭️  Fewer than 2 agent-provenance skills — no similarity scan needed.');
    return [];
  }

  const bodies = {};
  for (const d of agentDirs) {
    const body = readSkillBody(d);
    if (body) bodies[d] = body;
  }

  const pairs = [];
  const names = Object.keys(bodies);
  // BUG-10: O(n²) pair comparison — fine for <50 skills. Log warning if >50.
  if (names.length > 50) {
    log(`   ⚠️  ${names.length} skills — pair comparison may be slow (O(n²)).`);
  }
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const score = jaccardSimilarity(bodies[names[i]], bodies[names[j]]);
      // jaccardSimilarity returns null for too-short or empty inputs (BUG-07)
      if (score !== null && score >= SIMILARITY_THRESHOLD) {
        pairs.push({
          skillA: names[i],
          skillB: names[j],
          score: Math.round(score * 100) / 100,
          bodyA: bodies[names[i]],
          bodyB: bodies[names[j]]
        });
      }
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  return pairs;
}

/**
 * Generate a consolidation proposal for a pair of similar skills.
 */
function generateConsolidationProposal(pair) {
  const { skillA, skillB, score, bodyA, bodyB } = pair;

  // Suggest umbrella name: combination of both skill names, or the more general one
  // Heuristic: shorter name is likely more general; use it as base
  const baseName = skillA.length <= skillB.length ? skillA : skillB;
  const umbrellaName = `${baseName}-umbrella`;

  const explanation = [];
  explanation.push(`Skills "${skillA}" and "${skillB}" share ${Math.round(score * 100)}% word similarity in their workflow bodies.`);

  // Detect overlap areas from body text
  const wordsA = new Set(bodyA.toLowerCase().split(/[\s\W]+/).filter(Boolean));
  const wordsB = new Set(bodyB.toLowerCase().split(/[\s\W]+/).filter(Boolean));
  const overlap = [...wordsA].filter(w => wordsB.has(w) && w.length > 3);
  if (overlap.length > 0) {
    const topOverlap = overlap.slice(0, 5).join(', ');
    explanation.push(`Common themes: ${topOverlap}.`);
  }

  // BUG-06: Deterministic UID based on sorted skill names + similarity score.
  // Re-running with the same pair overwrites the previous proposal.
  const uid = `consolidation-${skillA}__${skillB}__${score.toFixed(2)}`.replace(/[^a-z0-9._-]/g, '_').slice(0, 120);
  const proposal = `# Umbrella Consolidation Proposal

Source skills: ${skillA}, ${skillB}
Similarity: ${score} (Jaccard on first 200 chars)
Timestamp: ${getHKTDateTime()}

## Why these should merge
${explanation.join(' ')}

## Suggested umbrella name
${umbrellaName}

## Proposed structure
skills-learned/${umbrellaName}/
├── SKILL.md (parent skill, references children)
├── ${skillA}/
│   └── SKILL.md (moved here as detail)
└── ${skillB}/
    └── SKILL.md (moved here as detail)

## How to apply
node scripts/weekly_correction_loop.js --apply-consolidation .skill_consolidation_proposals/${uid}.md
`;

  return { uid, proposal, umbrellaName };
}

/**
 * Handle --consolidate mode: find similar skills, write proposals.
 */
function handleConsolidation() {
  log('📊 Scanning for similar agent-provenance skills...');
  const similar = findSimilarSkills();

  if (similar.length === 0) {
    log('✅ No similar skill pairs found above threshold.');
    return;
  }

  log(`🔍 Found ${similar.length} similar skill pair(s):\n`);

  if (!fs.existsSync(CONSOLIDATION_DIR)) {
    if (DRY_RUN) {
      log(`   📋 [DRY RUN] Would create: ${CONSOLIDATION_DIR}`);
    } else {
      try {
        fs.mkdirSync(CONSOLIDATION_DIR, { recursive: true, mode: 0o700 });
      } catch (e) {
        console.error(`Directory creation failed: ${e.message}`);
      }
    }
  }

  const FORCE = process.argv.includes('--force');

  for (const pair of similar) {
    log(`   ${pair.skillA} ↔ ${pair.skillB} (score: ${pair.score})`);

    if (DRY_RUN) {
      log(`     📋 [DRY RUN] Would write proposal for ${pair.skillA} + ${pair.skillB}`);
      continue;
    }

    const { uid, proposal, umbrellaName } = generateConsolidationProposal(pair);
    const proposalFile = path.join(CONSOLIDATION_DIR, `${uid}.md`);

    // BUG-06: Check for existing matching proposal before writing
    if (!FORCE && fs.existsSync(proposalFile)) {
      log(`     ⏭️  Proposal already exists (use --force to overwrite): ${uid}.md`);
      continue;
    }

    try {
      fs.writeFileSync(proposalFile, proposal, 'utf8');
      log(`     ✅ Proposal written: ${proposalFile}`);
      log(`     💡 Suggested umbrella: ${umbrellaName}`);
    } catch (e) {
      log(`     ❌ Failed to write proposal: ${e.message}`);
    }
  }

  // TODO (BUG-15): Future: log apply events to memory/errors.json or similar

  log(`\n📝 ${similar.length} proposal(s) written to ${CONSOLIDATION_DIR}/`);
  log('💡 Review proposals before applying: node scripts/weekly_correction_loop.js --apply-consolidation <file>');

  log('\n🔮 Phase B: LLM Umbrella Consolidation Pass — analyzing pairs with AI...\n');

  // LLM pass: analyze each pair and write structured YAML proposals
  const llmProposalsDir = PROPOSALS_DIR;
  if (!fs.existsSync(llmProposalsDir) && !DRY_RUN) {
    fs.mkdirSync(llmProposalsDir, { recursive: true, mode: 0o700 });
  }

  let llmProposalCount = 0;
  // Filter pairs above Jaccard > 0.5 for LLM analysis (more confident merges only)
  const llmPairs = similar.filter(p => p.score > 0.5);

  for (const pair of llmPairs) {
    log(`   📋 ${pair.skillA} ↔ ${pair.skillB} (score: ${pair.score})`);

    if (DRY_RUN) {
      log(`     [DRY RUN] Would analyze ${pair.skillA} + ${pair.skillB} with LLM`);
      continue;
    }

    try {
      // Use mockAnalyzePair for now (avoids real LLM call in cron context);
      // Future: switch to analyzePair() when gateway LLM endpoint is stable.
      const result = umbrellaConsolidation.mockAnalyzePair(pair);

      if (result.shouldMerge) {
        const proposalPath = umbrellaConsolidation.saveProposal(result, llmProposalsDir, {
          skillA: pair.skillA,
          skillB: pair.skillB,
          score: pair.score,
        }, { dryRun: DRY_RUN });
        log(`     ✅ LLM suggests MERGE → umbrella: "${result.umbrellaName}"`);
        log(`     📄 Proposal: ${proposalPath}`);
        llmProposalCount++;
      } else {
        log(`     ⏭️  LLM suggests no merge: ${result.reason}`);
      }
    } catch (e) {
      log(`     ❌ LLM analysis failed: ${e.message}`);
    }
  }

  if (llmPairs.length === 0) {
    log('   ⏭️  No pairs above Jaccard > 0.5 threshold for LLM analysis.');
  }

  log(`\n📋 ${llmProposalCount} LLM consolidation proposal(s) created in ${llmProposalsDir}/`);
  if (llmProposalCount > 0) {
    log('💡 Review YAML proposals before applying: cat skills/proposals/proposal-*.yaml');
  }
}

/**
 * Handle --apply-consolidation mode: read a proposal file, restructure skills.
 */
function applyConsolidation(proposalFile) {
  const resolvedFile = proposalFile.startsWith('/')
    ? proposalFile
    : path.join(WS, proposalFile);

  if (!fs.existsSync(resolvedFile)) {
    throw new Error(`Proposal file not found: ${resolvedFile}`);
  }

  let content;
  try {
    content = fs.readFileSync(resolvedFile, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }

  // Parse proposal fields
  const sourceMatch = content.match(/Source skills: (.+?), (.+)/);
  const umbrellaMatch = content.match(/^## Suggested umbrella name\n(.+)/m);

  if (!sourceMatch || !umbrellaMatch) {
    throw new Error('Invalid proposal format — missing source skills or umbrella name');
  }

  const skillA = sourceMatch[1].trim();
  const skillB = sourceMatch[2].trim();
  const umbrellaName = umbrellaMatch[1].trim();

  log(`📦 Consolidating: ${skillA} + ${skillB} → ${umbrellaName}\n`);

  // Validate source skills exist
  const dirA = path.join(SKILLS_DIR, skillA);
  const dirB = path.join(SKILLS_DIR, skillB);

  if (!fs.existsSync(dirA) || !fs.existsSync(path.join(dirA, 'SKILL.md'))) {
    throw new Error(`Source skill missing: ${skillA}`);
  }
  if (!fs.existsSync(dirB) || !fs.existsSync(path.join(dirB, 'SKILL.md'))) {
    throw new Error(`Source skill missing: ${skillB}`);
  }

  // Check provenance: don't apply consolidation to bundled/user/pinned
  for (const dir of [skillA, skillB]) {
    const prov = readFrontmatterField(dir, 'provenance');
    if (prov === 'bundled' || prov === 'user') {
      throw new Error(`Cannot consolidate ${dir}: provenance=${prov}`);
    }
    const pinned = readFrontmatterField(dir, 'pinned');
    if (pinned === 'true' && isActionBlockedByPin('consolidate')) {
      throw new Error(`Cannot consolidate ${dir}: skill is pinned`);
    }
  }

  // ── BUG-05: Check for support files ──
  const supportDirs = ['references', 'templates', 'scripts'];
  for (const [name, dir] of [[skillA, dirA], [skillB, dirB]]) {
    for (const sub of supportDirs) {
      const subPath = path.join(dir, sub);
      if (fs.existsSync(subPath)) {
        try {
          const files = fs.readdirSync(subPath).filter(f => !f.startsWith('.'));
          if (files.length > 0) {
            const flag = '--i-know-what-im-doing';
            if (!process.argv.includes(flag)) {
              throw new Error(`Support files detected in ${name}/${sub}/ (${files.length} files). Use ${flag} to proceed with consolidation.`);
            }
            log(`   📎 ${name} has ${files.length} support file(s) in ${sub}/ — proceeding with ${flag}`);
          }
        } catch (e) {
          if (e.message.includes('--i-know-what-im-doing')) throw e;
        }
      }
    }
  }

  if (DRY_RUN) {
    log(`📋 [DRY RUN] Would perform consolidation: ${skillA} + ${skillB} → ${umbrellaName}`);
    log(`   - Create: ${umbrellaName}/`);
    log(`   - Move: ${skillA}/ → ${umbrellaName}/${skillA}/`);
    log(`   - Move: ${skillB}/ → ${umbrellaName}/${skillB}/`);
    log(`   - Write: ${umbrellaName}/SKILL.md`);
    return;
  }

  // ── BUG-02: Create pre-consolidation backup before any destructive mutations ──
  {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(SKILLS_DIR, '.backups');
    try {
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
    const backupFile = path.join(backupDir, `pre-consolidation-${stamp}.tar.gz`);
    try {
      execSync(`tar czf "${backupFile}" -C "${path.dirname(SKILLS_DIR)}" "${path.basename(SKILLS_DIR)}"`, { stdio: 'pipe' });
      log(`   📦 Pre-consolidation backup: ${backupFile}`);
    } catch (e) {
      throw new Error(`Backup failed before consolidation: ${e.message}. Aborting to prevent data loss.`);
    }
  }

  // ── Perform consolidation ──
  const umbrellaDir = path.join(SKILLS_DIR, umbrellaName);

  // 1. Create umbrella directory
  if (!fs.existsSync(umbrellaDir)) {
    fs.mkdirSync(umbrellaDir, { recursive: true, mode: 0o700 });
  }

  // 2. Read source skill SKILL.md contents
  let skillAContent;
  try {
    skillAContent = fs.readFileSync(path.join(dirA, 'SKILL.md'), 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  let skillBContent;
  try {
    skillBContent = fs.readFileSync(path.join(dirB, 'SKILL.md'), 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }

  // 3. Move source directories INTO umbrella
  const targetA = path.join(umbrellaDir, skillA);
  const targetB = path.join(umbrellaDir, skillB);

  if (fs.existsSync(targetA) || fs.existsSync(targetB)) {
    throw new Error(`Target directories already exist inside umbrella: ${targetA} or ${targetB}`);
  }

  fs.renameSync(dirA, targetA);
  log(`   📦 Moved: ${skillA}/ → ${umbrellaName}/${skillA}/`);
  fs.renameSync(dirB, targetB);
  log(`   📦 Moved: ${skillB}/ → ${umbrellaName}/${skillB}/`);

  // 4. Add parent field to moved skills' frontmatter
  function addParentField(filePath, parent) {
    let c;
    try {
      c = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    const fm = c.match(/^---\n[\s\S]*?\n---\n?/);
    if (fm) {
      if (!fm[0].includes('parent:')) {
        c = c.replace(/^---\n([\s\S]*?)\n---/, (_, fmBody) => {
          return `---\n${fmBody}\nparent: ${parent}\n---`;
        });
        try {
          fs.writeFileSync(filePath, c, 'utf8');
        } catch (e) {
          console.error(`File write failed: ${e.message}`);
        }
      }
    }
  }
  addParentField(path.join(targetA, 'SKILL.md'), umbrellaName);
  addParentField(path.join(targetB, 'SKILL.md'), umbrellaName);

  // 5. Write umbrella SKILL.md stub
  const now = new Date().toISOString();

  // Compute overlap themes (outside template literal to avoid nesting issues)
  const bodyA = readSkillBody(skillA) || skillAContent.slice(0, 200);
  const bodyB = readSkillBody(skillB) || skillBContent.slice(0, 200);
  const wordsA = new Set(bodyA.toLowerCase().split(/[\s\W]+/).filter(Boolean));
  const wordsB = new Set(bodyB.toLowerCase().split(/[\s\W]+/).filter(Boolean));
  const overlap = [...wordsA].filter(w => wordsB.has(w) && w.length > 3);
  const overlapLines = overlap.length > 0
    ? overlap.slice(0, 8).map(w => '- ' + w).join('\n')
    : '- (auto-detected themes)';

  const umbrellaContent = [
    '---',
    'name: ' + umbrellaName,
    'description: Umbrella skill consolidating ' + skillA + ' and ' + skillB,
    'status: draft',
    'source: umbrella-consolidation',
    'provenance: agent',
    'umbrella: true',
    'generatedAt: ' + now,
    '---',
    '',
    '## Umbrella Workflow',
    '',
    'This umbrella skill consolidates the following related skills:',
    '',
    '- **' + skillA + '** — see [' + skillA + '](' + skillA + '/SKILL.md)',
    '- **' + skillB + '** — see [' + skillB + '](' + skillB + '/SKILL.md)',
    '',
    '### Common context',
    '',
    'Both skills share workflow patterns related to:',
    overlapLines,
    '',
    '### Usage',
    '',
    'Consult the individual skills below for detailed workflows, then apply the shared patterns above.'
  ].join('\n');

  try {
    fs.writeFileSync(path.join(umbrellaDir, 'SKILL.md'), umbrellaContent, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  log(`   📝 Written: ${umbrellaName}/SKILL.md (umbrella stub)`);

  // Clean up old symlinks if any
  for (const skill of [skillA, skillB]) {
    const symlinkPath = path.join(SKILLS_ACTIVE, `_learned_${skill}`);
    try {
      if (fs.existsSync(symlinkPath) && fs.lstatSync(symlinkPath).isSymbolicLink()) {
        fs.unlinkSync(symlinkPath);
        log(`   🧹 Removed old symlink: skills/_learned_${skill}`);
      }
    } catch (_) {}
  }

  log(`\n✅ Consolidation complete: ${skillA} + ${skillB} → ${umbrellaName}`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: Performance Telemetry + Inactivity-Based Curator
// ═══════════════════════════════════════════════════════════════

/**
 * Atomic JSON write: write to .tmp first, then rename (atomic on most filesystems).
 * Safe: on any failure, clean up the tmp file and re-throw.
 */
function atomicWriteJson(filepath, data) {
  // Include process pid + random suffix to avoid race between concurrent
  // atomic writes to the same filepath in the same millisecond
  const tmp = filepath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* best effort cleanup */ }
    throw err;
  }
}

/**
 * Safe JSON parse with structure validation and default fallback.
 */
function safeParseJson(filepath, defaultValue) {
  if (!fs.existsSync(filepath)) return defaultValue;
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    if (typeof data !== 'object' || data === null) {
      log(`   \u26a0\ufe0f ${filepath} is not an object, using defaults`);
      return defaultValue;
    }
    return data;
  } catch (err) {
    log(`   \u26a0\ufe0f Failed to parse ${filepath}: ${err.message}, using defaults`);
    return defaultValue;
  }
}

/**
 * Track a curator run to .skill_metrics.json
 */
function trackMetrics(run) {
  try {
    let metrics = safeParseJson(METRICS_FILE, { reviewer_runs: [], curator_runs: [] });
    if (run.type === 'curator') {
      const entry = {
        ts: Date.now(),
        durationMs: run.durationMs || 0,
        skillsScanned: run.skillsScanned || 0,
        promoted: run.promoted || 0,
        triggeredBy: run.triggeredBy || 'weekly'
      };
      metrics.curator_runs.push(entry);
      if (metrics.curator_runs.length > MAX_METRICS_ENTRIES) {
        metrics.curator_runs = metrics.curator_runs.slice(-MAX_METRICS_ENTRIES);
      }
    }
    atomicWriteJson(METRICS_FILE, metrics);
  } catch (err) {
    log(`   ⚠️ Metrics write failed: ${err.message}`);
  }
}

/**
 * Read the last curator run from .last_curator_run.json
 */
function readCuratorRun() {
  return safeParseJson(CURATOR_RUN_FILE, null);
}

/**
 * Write curator run stats to .last_curator_run.json
 */
function writeCuratorRun(stats) {
  const run = {
    lastRun: Date.now(),
    skillsScanned: stats.skillsScanned || 0,
    promoted: stats.promoted || 0,
    archived: stats.archived || 0,
    migrated: stats.migrated || 0,
    notes: stats.notes || ''
  };
  try {
    atomicWriteJson(CURATOR_RUN_FILE, run);
  } catch (err) {
    log(`   ⚠️ Curator run file write failed: ${err.message}`);
  }
}

/**
 * Handle the inactivity-based mini-curator pass.
 * Checks if new skills exist since last run and min days have passed.
 */
function handleMiniCurator() {
  const curatorRun = readCuratorRun();
  const now = Date.now();
  const lastRun = curatorRun ? curatorRun.lastRun : 0;
  const daysSinceLastRun = lastRun > 0 ? (now - lastRun) / ONE_DAY_MS : 999;

  // Count new skills since last run
  let newSkillsCount = 0;
  if (fs.existsSync(SKILLS_DIR)) {
    try {
      const dirs = fs.readdirSync(SKILLS_DIR).filter(f => {
        if (f === '.backups' || f === '_archive') return false;
        try { return fs.lstatSync(path.join(SKILLS_DIR, f)).isDirectory(); } catch { return false; }
      });
      for (const d of dirs) {
        const sp = path.join(SKILLS_DIR, d);
        try {
          const dirStat = fs.statSync(sp);
          if (dirStat.birthtimeMs > lastRun) {
            newSkillsCount++;
          }
        } catch { /* skip */ }
      }
    } catch (e) {
      log(`   ⚠️ Failed to scan skills: ${e.message}`);
    }
  }

  const thresholdDays = CURATOR_RUN_MIN_DAYS;
  const thresholdNew = CURATOR_RUN_MIN_NEW;

  if (daysSinceLastRun >= thresholdDays && newSkillsCount >= thresholdNew) {
    const startTime = Date.now();
    log(`🔔 Mini-curator triggered: ${Math.round(daysSinceLastRun)} days, ${newSkillsCount} new skills`);

    // Mini-curator: just verify new skills have valid frontmatter
    let skillsScanned = 0;
    let promoted = 0;

    if (fs.existsSync(SKILLS_DIR)) {
      try {
        const dirs = fs.readdirSync(SKILLS_DIR).filter(f => {
          if (f === '.backups' || f === '_archive') return false;
          try { return fs.lstatSync(path.join(SKILLS_DIR, f)).isDirectory(); } catch { return false; }
        });
        for (const d of dirs) {
          const sp = path.join(SKILLS_DIR, d);
          let isNew = false;
          try {
            const dirStat = fs.statSync(sp);
            if (dirStat.birthtimeMs > lastRun) isNew = true;
          } catch { continue; }
          if (!isNew) continue;

          skillsScanned++;
          const skillFile = path.join(sp, 'SKILL.md');
          if (!fs.existsSync(skillFile)) {
            log(`   ⚠️ New skill missing SKILL.md: ${d}`);
            continue;
          }
          try {
            const content = fs.readFileSync(skillFile, 'utf8');
            const fm = content.match(/^---\n[\s\S]*?\n---/);
            if (!fm) {
              log(`   ⚠️ New skill missing frontmatter: ${d}`);
              continue;
            }
            const fields = {};
            for (const line of fm[1].split('\n')) {
              const idx = line.indexOf(':');
              if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
            const missing = [];
            if (!fields.name) missing.push('name');
            if (!fields.description) missing.push('description');
            if (!fields.provenance) {
              missing.push('provenance');
              // Auto-set provenance: agent as default
              const fmBody = content.match(/^---\n([\s\S]*?)\n---/);
              const needsProvenance = fmBody && !fmBody[1].includes('provenance:');
              if (!DRY_RUN) {
                if (needsProvenance) {
                  const newContent = content.replace(/^---\n([\s\S]*?)\n---/, (match, fmBody) => {
                    return '---\n' + fmBody + '\nprovenance: agent\n---';
                  });
                  if (newContent !== content) {
                    try {
                      fs.writeFileSync(skillFile, newContent, 'utf8');
                    } catch (e) {
                      console.error(`File write failed: ${e.message}`);
                    }
                    log(`   🔧 Auto-set provenance: agent on ${d}`);
                  }
                }
              } else if (needsProvenance) {
                log(`   📋 [DRY RUN] Would set provenance: agent on ${d}`);
                recordDryRunMod(`Would set provenance: agent on ${d}`);
              }
            }
            if (missing.filter(m => m !== 'provenance').length > 0) {
              log(`   ⚠️ New skill ${d} missing fields: ${missing.join(', ')}`);
            } else {
              const body = content.slice(fm[0].length).trim();
              if (body.length >= 200) {
                promoted++;
                log(`   ✅ New skill validated: ${d} (${fields.status || 'draft'}, ${body.length}c body)`);
              } else {
                log(`   📝 New skill (minimal): ${d} (${body.length}c body)`);
              }
            }
          } catch (e) {
            log(`   ⚠️ Failed to check ${d}: ${e.message}`);
          }
        }
      } catch (e) {
        log(`   ⚠️ Skills scan failed: ${e.message}`);
      }
    }

    const duration = Date.now() - startTime;
    log(`\n📊 Mini-curator: ${skillsScanned} scanned, ${promoted} validated (${duration}ms)`);

    if (!DRY_RUN) {
      writeCuratorRun({
        skillsScanned,
        promoted,
        archived: 0,
        migrated: 0,
        notes: `Mini-curator (${Math.round(daysSinceLastRun)}d idle, ${newSkillsCount} new since last run)`
      });

      trackMetrics({ type: 'curator', durationMs: duration, skillsScanned, promoted, triggeredBy: 'inactivity' });
    } else {
      recordDryRunMod('Would update curator run (mini-curator threshold met)');
    }
  } else {
    log(`⏭️ Mini-curator: ${Math.round(daysSinceLastRun)} days, ${newSkillsCount} new skills (threshold: ${thresholdDays}d/${thresholdNew}new)`);
  }

  // Always update tracker, even on no-op — prevents repeated skips
  if (!DRY_RUN) {
    writeCuratorRun({
      skillsScanned: newSkillsCount,
      promoted: 0,
      archived: 0,
      migrated: 0,
      notes: newSkillsCount > 0 ? `Checked ${newSkillsCount} new skills` : 'No new skills'
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: Behavior Analysis (primary — always runs)
// ═══════════════════════════════════════════════════════════════
const DECISION_LOG = path.join(WS, 'scripts', 'router', 'decision_log.jsonl');
let decisions = [];
try {
  if (fs.existsSync(DECISION_LOG)) {
    const raw = fs.readFileSync(DECISION_LOG, 'utf8');
    decisions = raw.split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  }
} catch (e) { log(`⚠️ Could not read decision log: ${e.message}`); }
log(`📊 Decision log entries (all time): ${decisions.length}`);

const suggestions = [];
if (decisions.length > 5) {
  const byRoute = {};
  for (const d of decisions) {
    const route = d.route || d.decision || 'unknown';
    byRoute[route] = (byRoute[route] || 0) + 1;
  }
  log(`   Route distribution: ${JSON.stringify(byRoute)}`);

  // ── Inferred analysis（唔使 extra fields，從 data 推斷）──

  // 1. Manual override: rule says 'manual_override' when route != classifier suggestion
  const overrides = decisions.filter(d => d.rule === 'manual_override' || d.extra?.corrected === true);
  if (overrides.length >= 3) {
    suggestions.push({
      severity: 'MEDIUM',
      title: `${overrides.length} 次手動 override — classifier 可能需要調整`,
      detail: `Route decisions were manually overridden ${overrides.length} times.`,
    });
  }

  // 2. FDQ sensitivity: if FDQ > 30% of non-catchall decisions, may be too aggressive
  const nonCatchall = decisions.filter(d => d.rule !== 'AGENTS.md Rule 7 (catch-all)' && d.rule !== 'manual_override');
  const fqCount = nonCatchall.filter(d => d.route === 'FDQ').length;
  if (nonCatchall.length > 5 && fqCount / nonCatchall.length > 0.3) {
    suggestions.push({
      severity: 'LOW',
      title: `FDQ 佔 ${(fqCount / nonCatchall.length * 100).toFixed(0)}% of decisions — 可能太進取`,
      detail: `${fqCount} out of ${nonCatchall.length} non-catchall decisions were FDQ. Trigger threshold may need adjustment.`,
    });
  }

  // 3. Catch-all ratio: too many catch-all = classifier missing patterns
  const catchall = decisions.filter(d => d.rule === 'AGENTS.md Rule 7 (catch-all)');
  if (decisions.length > 5 && catchall.length / decisions.length > 0.4) {
    suggestions.push({
      severity: 'MEDIUM',
      title: `${catchall.length}/${decisions.length} 決策行 catch-all — classifier 可能 miss 太多`,
      detail: `Catch-all rate: ${(catchall.length / decisions.length * 100).toFixed(0)}%. May need new rules for common patterns.`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1b: Skill Curation — mtime + content-based (format agnostic)
// ═══════════════════════════════════════════════════════════════
// Principle: mtime = last activity signal. Content length = value signal.
// No reliance on frontmatter count fields (useCount, patternRepeats).
// Works for ANY skill file format — hash-based or Hermes-style.

const ARCHIVE_DIR = path.join(SKILLS_DIR, '_archive');
const BACKUP_DIR = path.join(SKILLS_DIR, '.backups');
const KEEP_BACKUPS = 5;
const MIN_CONTENT_CHARS = 2000;   // minimum body length to be considered "useful" (was 200 — 10x gap, align with code-review-checklist gate)
const ARCHIVE_AFTER_DAYS = 30;    // junk content archived after this many idle days

let skillStats = { total: 0, active: 0, draft: 0, archived: 0, promoted: 0 };

if (fs.existsSync(SKILLS_DIR)) {
  // ── Pre-run backup ──
  try {
    if (!DRY_RUN) {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupFile = path.join(BACKUP_DIR, `skills-${stamp}.tar.gz`);
      execSync(`tar czf "${backupFile}" -C "${path.dirname(SKILLS_DIR)}" "${path.basename(SKILLS_DIR)}"`, { stdio: 'pipe' });
      log(`📦 Pre-run backup: ${backupFile}`);
      const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.tar.gz')).sort();
      while (backups.length > KEEP_BACKUPS) {
        const old = backups.shift();
        try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
      }
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupFile = path.join(BACKUP_DIR, `skills-${stamp}.tar.gz`);
      recordDryRunMod(`Would create backup: ${backupFile}`);
      log(`   📋 [DRY RUN] Would create backup: ${backupFile}`);
    }
  } catch (e) { log(`   ⚠️ Backup failed: ${e.message}`); }

  if (!DRY_RUN && !fs.existsSync(ARCHIVE_DIR)) {
    try { fs.mkdirSync(ARCHIVE_DIR, { recursive: true, mode: 0o700 }); } catch (_) {}
  }

  const now = Date.now();

  // ── Migration: convert remaining flat .md files to subdirectory form ──
  let entries;
  try {
    entries = fs.readdirSync(SKILLS_DIR).filter(f => f !== '.backups' && f !== '_archive' && f !== '.backups');
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
    entries = [];
  }

  for (const entry of entries) {
    const entryPath = path.join(SKILLS_DIR, entry);
    if (fs.lstatSync(entryPath).isFile() && entry.endsWith('.md')) {
      // Migrate flat .md file to subdirectory
      const skillName = entry.slice(0, -3); // remove .md
      const dirPath = path.join(SKILLS_DIR, skillName);
      const skillFilePath = path.join(dirPath, 'SKILL.md');
      try {
        if (!fs.existsSync(dirPath) && !DRY_RUN) {
          fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
        }
        // Only move content if SKILL.md doesn't already exist (avoid overwrite)
        if (!fs.existsSync(skillFilePath)) {
          const content = fs.readFileSync(entryPath, 'utf8');
          if (DRY_RUN) {
            log(`   📋 [DRY RUN] Would migrate: ${entry} → ${skillName}/SKILL.md`);
            recordDryRunMod(`Would migrate flat file ${entry} → ${skillName}/SKILL.md`);
          } else {
            fs.writeFileSync(skillFilePath, content, 'utf8');
          }
        }
        if (DRY_RUN) {
          log(`   📋 [DRY RUN] Would delete flat file: ${entry}`);
          recordDryRunMod(`Would delete flat file: ${entry}`);
        } else {
          fs.unlinkSync(entryPath);
          log(`   🔄 Migrated: ${entry} → ${skillName}/SKILL.md`);
        }
      } catch (e) {
        log(`   ⚠️ Migration failed for ${entry}: ${e.message}`);
      }
    }
  }

  // ── Scan for skill subdirectories ──
  let dirs;
  try {
    dirs = fs.readdirSync(SKILLS_DIR).filter(f => {
      if (f === '.backups' || f === '_archive') return false;
      try { return fs.lstatSync(path.join(SKILLS_DIR, f)).isDirectory(); }
      catch (_) { return false; }
    });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
    dirs = [];
  }
  skillStats.total = dirs.length;
  log(`📊 Skill directories found: ${skillStats.total}`);

  // ── Helper: list support files in skill subdirectory ──
  function listSupportFiles(dirPath) {
    const result = { references: [], templates: [], scripts: [] };
    for (const sub of ['references', 'templates', 'scripts']) {
      const subPath = path.join(dirPath, sub);
      if (fs.existsSync(subPath)) {
        try {
          const files = fs.readdirSync(subPath);
          for (const f of files) {
            if (f.startsWith('.')) continue;
            result[sub].push(f);
          }
        } catch (_) {}
      }
    }
    return result;
  }

  for (const dir of dirs) {
    const dirPath = path.join(SKILLS_DIR, dir);
    const skillFile = path.join(dirPath, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      log(`   ⚠️ No SKILL.md in ${dir}, skipping`);
      continue;
    }
    try {
      const content = fs.readFileSync(skillFile, 'utf8');
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatter) continue;

      const fields = {};
      for (const line of frontmatter[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }

      // ── Provenance check ──
      const provenance = fields.provenance || 'agent';  // default agent for backward compat
      if (provenance === 'bundled' || provenance === 'user') {
        skillStats.active++;
        log(`   🔒 Skipped (${provenance}): ${dir}`);
        continue;
      }

      const isPinned = fields.pinned === 'true' || fields.pinned === true;
      const currentStatus = fields.status || 'draft';
      const body = content.slice(frontmatter[0].length).trim();
      const bodyLength = body.length;
      let stat;
      try {
        stat = fs.statSync(skillFile);
      } catch (e) {
        console.error(`Operation failed: ${e.message}`);
      }
      const daysSinceMtime = (now - stat.mtimeMs) / 86400000;

      // ── Decision: content-based ──

      if (bodyLength < MIN_CONTENT_CHARS) {
        // JUNK: minimal or no workflow content
        const support = listSupportFiles(dirPath);
        const hasSupport = support.references.length + support.templates.length + support.scripts.length > 0;
        if (hasSupport) {
          // Skill has support files — keep it as draft, don't archive
          skillStats.draft++;
          log(`   📝 Draft (with support files): ${dir}`);
          continue;
        }
        if (daysSinceMtime >= ARCHIVE_AFTER_DAYS) {
          if (isPinned && isActionBlockedByPin('archive')) {
            skillStats.draft++;
            log(`   📌 Pinned — skip archive: ${dir}`);
            recordDryRunMod(`Would skip archive ${dir} (pinned blocks by pin semantics)`);
          } else if (DRY_RUN) {
            log(`   📋 [DRY RUN] Would archive junk: ${dir} (${Math.round(daysSinceMtime)}d idle, ${bodyLength}c)`);
            recordDryRunMod(`Would archive junk: ${dir}`);
          } else {
            // Old junk → archive
            try {
              fs.renameSync(dirPath, path.join(ARCHIVE_DIR, dir));
              const sp = path.join(SKILLS_ACTIVE, `_learned_${dir}`);
              try { if (fs.existsSync(sp)) fs.unlinkSync(sp); } catch (_) {}
              skillStats.archived++;
              log(`   📦 Archived junk: ${dir} (${Math.round(daysSinceMtime)}d idle, ${bodyLength}c)`);
            } catch (e) { log(`   ⚠️ Archive failed: ${dir}: ${e.message}`); }
          }
        } else {
          // Recent junk — keep as draft, NO symlink
          skillStats.draft++;
          log(`   📝 Draft (minimal): ${dir} (${bodyLength}c, ${Math.round(daysSinceMtime)}d)`);
        }
        continue;
      }

      // HAS CONTENT (>= 200 chars of workflow) — useful skill

      // Log support files when promoting (call once, cache)
      const sup = listSupportFiles(dirPath);
      const supCount = sup.references.length + sup.templates.length + sup.scripts.length;
      if (supCount > 0) {
        log(`   📎 Support files: ${sup.references.length} ref, ${sup.templates.length} tpl, ${sup.scripts.length} scripts`);
      }

      // Promote draft → active (mtime-based: recently modified = active)
      if (currentStatus === 'draft') {
        if (DRY_RUN) {
          log(`   📋 [DRY RUN] Would promote: ${dir} (${bodyLength}c content)`);
          recordDryRunMod(`Would promote ${dir} (${bodyLength}c content)`);
          skillStats.promoted++;
        } else {
          try {
            const newContent = content.replace(/\nstatus: draft\n/, '\nstatus: active\n');
            fs.writeFileSync(skillFile, newContent, 'utf8');
            skillStats.promoted++;
            log(`   📈 Promoted: ${dir} (${bodyLength}c content)`);
          } catch (e) { log(`   ⚠️ Promote failed: ${dir}: ${e.message}`); }
        }
      }

      // Idempotent directory symlink
      const symlinkPath = path.join(SKILLS_ACTIVE, `_learned_${dir}`);
      if (!fs.existsSync(symlinkPath)) {
        if (DRY_RUN) {
          log(`   📋 [DRY RUN] Would symlink: ${dir} → skills/_learned_${dir}`);
          recordDryRunMod(`Would symlink ${dir} → skills/_learned_${dir}`);
          skillStats.promoted++;
        } else {
          try {
            fs.symlinkSync(dirPath, symlinkPath, 'dir');
            skillStats.promoted++;
            log(`   🔗 Symlinked: ${dir} → skills/_learned_${dir}`);
          } catch (e) { log(`   ⚠️ Symlink failed: ${e.message}`); }
        }
      }
      skillStats.active++;

    } catch (e) {
      log(`   ⚠️ Could not process skill ${dir}: ${e.message}`);
    }
  }

  // ── Orphan symlink cleanup (directory symlinks) ──
  if (fs.existsSync(SKILLS_ACTIVE)) {
    try {
      const links = fs.readdirSync(SKILLS_ACTIVE).filter(f => f.startsWith('_learned_'));
      for (const link of links) {
        const linkPath = path.join(SKILLS_ACTIVE, link);
        try {
          const lstat = fs.lstatSync(linkPath);

          if (!lstat.isSymbolicLink()) {
            // Not a symlink — could be a regular directory named _learned_*
            if (lstat.isDirectory()) {
              const skillFile = path.join(linkPath, 'SKILL.md');
              if (fs.existsSync(skillFile)) {
                // This is a real skill directory directly in skills/ — don't touch
                log(`   ℹ️ Not a symlink, has SKILL.md: ${link} (skipping cleanup)`);
              } else {
                // True orphan directory — no SKILL.md, not recognized
                log(`   ℹ️ Orphan directory (no SKILL.md): ${link}`);
                if (DRY_RUN) {
                  log(`   📋 [DRY RUN] Would remove orphan directory: ${link}`);
                  recordDryRunMod(`Would remove orphan directory: ${link}`);
                } else {
                  fs.rmSync(linkPath, { recursive: true, force: true });
                  log(`   🧹 Removed orphan directory: ${link} (no SKILL.md)`);
                }
              }
            }
            continue;
          }

          // It's a symlink — read target and resolve relative path
          const target = fs.readlinkSync(linkPath);
          const absoluteTarget = path.isAbsolute(target)
            ? target
            : path.resolve(path.dirname(linkPath), target);

          if (!fs.existsSync(absoluteTarget)) {
            if (DRY_RUN) {
              log(`   📋 [DRY RUN] Would remove orphan symlink: ${link} (target: ${target})`);
              recordDryRunMod(`Would remove orphan symlink: ${link} (target missing: ${target})`);
            } else {
              try {
                fs.unlinkSync(linkPath);
              } catch (e) {
                console.error(`File deletion failed: ${e.message}`);
              }
              log(`   🧹 Orphan symlink removed: ${link} (target missing: ${target})`);
            }
          }
        } catch (e) {
          // lstat/readlink may fail (race, permissions) — skip
        }
      }
    } catch (e) { log(`   ⚠️ Orphan cleanup failed: ${e.message}`); }
  }

  log(`   Summary: ${skillStats.active} active, ${skillStats.draft} draft, ${skillStats.archived} archived, ${skillStats.promoted} promoted`);

  if (skillStats.total > 0) {
    suggestions.push({
      severity: 'LOW',
      title: `Skills maintenance: ${skillStats.promoted} promoted, ${skillStats.archived} archived`,
      detail: `${skillStats.total} skills total — ${skillStats.active} active, ${skillStats.draft} draft, ${skillStats.archived} archived.`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: System Health (secondary — errors.json summary)
// ═══════════════════════════════════════════════════════════════
let errorsData = { errors: [] };
try {
  if (fs.existsSync(ERRORS_JSON)) {
    const raw = fs.readFileSync(ERRORS_JSON, 'utf8').trim();
    if (raw) {
      try { errorsData = JSON.parse(raw); }
      catch (e) { console.error('⚠️ errors.json parse failed:', e.message); }
    }
  }
} catch (e) { log('⚠️ Could not read errors.json:', e.message); }

const oneWeekAgo = Date.now() - CONFIG.RECENT_ERRORS_DAYS * 86400000;
const recentErrors = (errorsData.errors || []).filter(e => {
  try { return new Date(e.date || e.timestamp).getTime() >= oneWeekAgo; }
  catch (_) { return false; }
});
log(`📊 System errors this week: ${recentErrors.length}`);

// Simple category counts (replaces the 100+ line AI_ASSISTED_CATEGORIES)
const categorizedErrors = {};
const CATEGORY_KEYWORDS = {
  timeout:   ['timeout', 'timed out', 'ETIMEDOUT'],
  network:   ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'socket', 'fetch'],
  file:      ['ENOENT', 'file not found', 'EACCES', 'ENOSPC'],
  api:       ['429', 'rate limit', '401', '403', 'MiniMax', 'Kimi', 'DiscordAPIError'],
  parse:     ['JSON.parse', 'SyntaxError', 'unexpected token'],
};
function simpleCategorize(err) {
  const text = ((err.problem || '') + ' ' + (err.message || '') + ' ' + (err.stack || '')).toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return cat;
  }
  return 'other';
}
for (const err of recentErrors) {
  const cat = err.category || simpleCategorize(err);
  if (!categorizedErrors[cat]) categorizedErrors[cat] = { count: 0, errors: [] };
  categorizedErrors[cat].count++;
  categorizedErrors[cat].errors.push(err);
}
log(`   Categories: ${Object.keys(categorizedErrors).join(', ') || '(none)'}`);

// ═══════════════════════════════════════════════════════════════
// PHASE 3: Generate suggestions file
// ═══════════════════════════════════════════════════════════════
const SUGGESTIONS_FILE = path.join(WS, 'memory', 'correction_suggestions.json');
const suggestionData = {
  generatedAt: getHKTDateTime(),
  date: todayDate,
  systemHealth: {
    errorsThisWeek: recentErrors.length,
    categories: Object.keys(categorizedErrors),
  },
  behaviour: {
    decisionsLogged: decisions.length,
    routeDistribution: {},
  },
  suggestions,
};

if (decisions.length > 0) {
  const byRoute = {};
  for (const d of decisions) {
    byRoute[d.route || d.decision || 'unknown'] = (byRoute[d.route || d.decision || 'unknown'] || 0) + 1;
  }
  suggestionData.behaviour.routeDistribution = byRoute;
}

if (!DRY_RUN) {
  // Include process pid + random suffix to avoid race between concurrent writes
  const tmpF = SUGGESTIONS_FILE + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
  try {
    fs.writeFileSync(tmpF, JSON.stringify(suggestionData, null, 2));
    fs.renameSync(tmpF, SUGGESTIONS_FILE);
    log(`✅ Suggestions written to correction_suggestions.json`);
  } catch (e) {
    console.error(`⚠️ Failed to write suggestions: ${e.message}`);
    try { fs.unlinkSync(tmpF); } catch (_) {}
  }
} else {
  recordDryRunMod('Would write correction_suggestions.json');
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: Update state
// ═══════════════════════════════════════════════════════════════
state.lastRun = getHKTDateTime();
state.lastRunDate = todayDate;
state.suggestions = suggestions;
state.lastErrorStats = {
  total: recentErrors.length,
  patterns: Object.keys(categorizedErrors).length,
  errorTypes: Object.fromEntries(Object.entries(categorizedErrors).map(([k, v]) => [k, v.count])),
};

if (!DRY_RUN) {
  try {
    atomicWriteJson(STATE_FILE, state);
  } catch (e) { console.error('⚠️ State write failed:', e.message); }
} else {
  recordDryRunMod('Would write state to ' + STATE_FILE);
}

log('\n=== 總結 ===');
log(`Decision Log entries: ${decisions.length}`);
log(`行為建議: ${suggestions.length}`);
log(`系統錯誤: ${recentErrors.length} (${Object.keys(categorizedErrors).length} categories)`);

if (DRY_RUN && dryRunModifications && dryRunModifications.length > 0) {
  log('\n📋 Would have modified:');
  for (const mod of dryRunModifications) log('   - ' + mod);
} else if (DRY_RUN) {
  log('\n📋 Would have modified: (none)');
}

log('\n✅ 每周校正循環完成！(v2 — behavior-focused, no auto-apply)');


// ── Phase 4: Track weekly curator run ──
if (!DRY_RUN && SKILLS_DIR && fs.existsSync(SKILLS_DIR)) {
  writeCuratorRun({
    skillsScanned: skillStats.total || 0,
    promoted: skillStats.promoted || 0,
    archived: skillStats.archived || 0,
    migrated: 0,
    notes: 'Sunday weekly run (' + getHKTDate() + ')'
  });
  trackMetrics({
    type: 'curator',
    durationMs: Date.now() - SCRIPT_START_TIME,
    skillsScanned: skillStats.total || 0,
    promoted: skillStats.promoted || 0,
    triggeredBy: 'weekly'
  });
}

// ═══════════════════════════════════════════════════════════════
// PHASE 5: Log this run to decision_log + Discord report
// ═══════════════════════════════════════════════════════════════
try {
  const { logDecision } = require('./router/classifier');
  logDecision(
    { route: 'WEEKLY_CORRECTION', matched: true, rule: 'scheduled' },
    'Weekly Correction Loop run: ' + suggestions.length + ' suggestions, ' + recentErrors.length + ' errors',
    { channel: 'system', extra: { suggestions: suggestions.length, errorsFound: recentErrors.length } }
  );
} catch (e) { log('⚠️ Could not log decision:', e.message); }

if (!DRY_RUN) {
  // Fire-and-forget, but the underlying https.request keeps the event loop
  // alive until the request completes (or the 30s timeout we added fires).
  // .catch() here just logs; it doesn't change the script's exit code.
  sendWeeklyReport(recentErrors, categorizedErrors, suggestions, state, skillStats)
    .catch(e => log('⚠️ Weekly report failed:', e.message));
} else {
  log('   📋 [DRY RUN] Would send weekly report to Discord');
  recordDryRunMod('Would send weekly report to Discord');
}

// ── Helpers ──

function getDiscordToken() {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.channels?.discord?.token || null;
  } catch (e) {
    log('⚠️ Failed to get Discord token:', e.message);
    return null;
  }
}

function sendDiscordNotification(message) {
  const token = getDiscordToken();
  if (!token) {
    log('❌ No Discord token, skipping notification');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request({
      hostname: 'discord.com',
      path: `/api/v10/channels/${CONFIG.DISCORD_CHANNEL_ID}/messages`,
      method: 'POST',
      headers: { 'Authorization': 'Bot ' + token, 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 204) {
          log('✅ Discord notification sent');
          resolve({ status: res.statusCode });
        } else {
          log(`❌ Discord API error: ${res.statusCode}`);
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', (err) => { log('❌ Discord failed:', err.message); reject(err); });
    // Bug fix: cap Discord request at 30s — without this, a hung Discord API
    // would keep the cron process alive past the cron timeout and cause
    // the LLM delivery step to fail. Matches our cron timeout budget.
    req.setTimeout(30000, () => {
      req.destroy(new Error('Discord request timeout (30s)'));
      reject(new Error('Discord request timeout (30s)'));
    });
    req.write(JSON.stringify({ content: message }));
    req.end();
  });
}

async function sendWeeklyReport(recentErrors, categorizedErrors, suggestions, state, skillStats = null) {
  const totalErrors = recentErrors.length;
  const patternCount = Object.keys(categorizedErrors).length;
  const newRulesCount = suggestions.length;
  const todayStr = getHKTDate();

  const prevStats = state.lastErrorStats || { total: 0, patterns: 0, errorTypes: {} };
  const trendChange = prevStats.total > 0
    ? Math.round((totalErrors - prevStats.total) / prevStats.total * 100)
    : 0;

  // Patterns formatted for template engine: { key: { count: N, errors: [...] } }
  const patternsForTemplate = Object.fromEntries(
    Object.entries(categorizedErrors).map(([k, v]) => [k, { count: v.count, errors: v.errors || [] }])
  );

  const reportData = {
    totalErrors,
    patternCount,
    categorizedErrors,
    trendChange,
    lastErrorStats: prevStats,
    newRulesCount,
    skillStats: skillStats || { total: 0, active: 0, draft: 0, archived: 0, promoted: 0 },
    auditRulesCount: 0,
    patterns: patternsForTemplate,
    // Template engine expects these (kept for compatibility)
    autoAppliedRules: [],
    auditChanged: false,
    p0Count: 0,
    p1Count: 0,
    lastAuditReportDate: null,
  };

  const discordMessage = reportGenerator.format('discord', reportData, todayStr);
  await sendDiscordNotification(discordMessage).catch(e => log('⚠️ Discord report failed:', e.message));

  const newState = {
    lastRun: getHKTDateTime(),
    lastRunDate: todayStr,
    processedErrors: recentErrors.slice(0, CONFIG.MAX_PROCESSED_ERRORS).map(e => e.id || e.title || 'unknown'),
    proposedRules: [],
    confirmedRules: [],
    suggestions: suggestions || [],
    lastErrorStats: {
      total: totalErrors,
      patterns: patternCount,
      errorTypes: Object.fromEntries(Object.entries(categorizedErrors).map(([k, v]) => [k, v.count])),
    },
  };

  try {
    atomicWriteJson(STATE_FILE, newState);
  } catch (e) {
    console.error('⚠️ State write failed:', e.message);
  }
}
