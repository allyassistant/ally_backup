#!/usr/bin/env node

/**
 * skill_reviewer_bot.js — Self-contained Skill Review Bot
 *
 * 跟 daily_summary_bot.js 相同模式：所有 LLM call 直接用
 * `openclaw infer model run` CLI，唔經 agent internal model routing。
 *
 * 流程：
 *   1. 讀 queue + 用現有 skill_reviewer.js 建立 prompt
 *   2. `execSync`(`openclaw infer model run`) 做分析
 *   3. Parse LLM response 提取 skill file content
 *   4. fs.writeFile 寫技能檔案
 *   5. exec skill_reviewer_cleanup.js 清 queue
 *   6. HTTPS POST → Discord #⚙️系統（如有更新）
 *
 * 使用：
 *   node scripts/skill_reviewer_bot.js [--quiet] [--json] [--no-discord]
 *
 * Flags:
 *   --quiet       Suppress non-essential log output
 *   --json        Emit a single `@@SKILL_REVIEWER_JSON@@{...}@@END@@` line on
 *                 stdout (bypasses --quiet) for skill_reviewer_pipeline.js to
 *                 parse and decide whether to push a smart Discord notification.
 *   --no-discord  Skip the in-bot Discord push. The pipeline takes over delivery
 *                 so it can implement "notify only on real changes".
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, execFileSync } = require('child_process');
const { WS, OPENCLAW_CONFIG, SKILLS_ACTIVE } = require('./lib/config');
const { extractField } = require('./lib/frontmatter');
const { isFrontmatterFieldTruthy } = require('./lib/skill_discovery');
// Phase A+ (2026-06-20): bridge to dedup_gate so the bot picks up cross-source
// duplicates (similar skills already in skills/ from other generators),
// not just content-hash matches against the same file. Without this bridge,
// the bot would happily write a near-duplicate skill under a different name.
// Behavior is controlled by SKILL_REVIEWER_BOT_DEDUP env var:
//   "warn"   — log warning, still write (default; safe to enable)
//   "strict" — skip write if cosine similarity ≥ DEDUP_THRESHOLD
//   "off"    — disable dedup_gate call entirely (only content-hash dedup runs)
const {
  computeDedupWarningsSync,
  embedWithOllama,
  buildProposalText,
  proposalKey,
  loadEmbeddingsCache,
} = require('./lib/skill_dedup_gate');
const BOT_DEDUP_MODE = (process.env.SKILL_REVIEWER_BOT_DEDUP || 'strict').toLowerCase();
const BOT_DEDUP_THRESHOLD = Number(process.env.SKILL_REVIEWER_BOT_THRESHOLD || 0.85);
// Stage 2 (2026-06-21): post-LLM preEmitFilter. Runs AFTER extractFileBlocks()
// parses the LLM's output and BEFORE fs.writeFileSync() persists it. Uses the
// canonical pre-emit-dedup.mjs module (v=3 path) to check the proposed skill
// name + description against existing skills. If similarity ≥ SKIP_THRESHOLD,
// the block is dropped (with telemetry + injected tool-call result); if it's
// in [PATCH, SKIP) range, the LLM is patching an existing skill and we proceed.
// Fail-open on any error (e.g. Ollama down) — never break the write path.
// Env:
//   SKILL_REVIEWER_POST_LLM_DEDUP_DISABLED=1   (kill switch)
const PRE_EMIT_DEDUP_PATH = path.join(WS, 'extensions/skill-auto-suggest/pre-emit-dedup.mjs');
const POST_LLM_DEDUP_TELEMETRY = path.join(WS, '.skill_reviewer_post_llm_dedup.jsonl');
const POST_LLM_DEDUP_DISABLED = process.env.SKILL_REVIEWER_POST_LLM_DEDUP_DISABLED === '1';
let _preEmitFilter = null;
async function _getPreEmitFilter() {
  if (_preEmitFilter !== null) return _preEmitFilter;
  try {
    _preEmitFilter = (await import(PRE_EMIT_DEDUP_PATH)).preEmitFilter;
  } catch (e) {
    err('Failed to load pre-emit-dedup.mjs (fail-open): ' + (e.message || e));
    _preEmitFilter = false; // sentinel: load failed → never try again
  }
  return _preEmitFilter || null;
}
function _logPostLlmDedupTelemetry(records) {
  if (!records || records.length === 0) return;
  try {
    const lines = records.map(r => JSON.stringify({ ts: new Date().toISOString(), ...r })).join('\n') + '\n';
    fs.appendFileSync(POST_LLM_DEDUP_TELEMETRY, lines, 'utf8');
  } catch (e) {
    err('post-llm dedup telemetry write failed: ' + (e.message || e));
  }
}
// Stage 2 follow-up (2026-06-21): when Stage 2 SKIPs a block because the LLM
// regenerated an existing skill, we feed the inject messages back to the LLM
// so it can either (a) PATCH the existing skill or (b) emit a structured SKIP
// marker. Without this loop, the LLM never learns to PATCH and the pathology
// recurs on the next cron cycle. Bounded: max 2 follow-ups, 5min total time.
// Env:
//   STAGE_2_FOLLOWUP_DISABLED=1   (kill switch → fall back to write-side veto only)
const FOLLOWUP_TELEMETRY = path.join(WS, '.skill_reviewer_followup.jsonl');
const STAGE_2_FOLLOWUP_DISABLED = process.env.STAGE_2_FOLLOWUP_DISABLED === '1';
const STAGE_2_FOLLOWUP_MAX_CALLS = 2;
const STAGE_2_FOLLOWUP_TIME_BUDGET_MS = 5 * 60 * 1000;
// Spec field aliases (2026-06-21): the task spec lists these exact field
// names in the telemetry contract. We emit BOTH the spec names
// (followupCallCount, durationMs, originalBlockCount, skippedCount) AND
// the internal names (followupCalls, elapsedMs, stillInjectedCount) for
// downstream tool compatibility.
function _logFollowupTelemetry(entry) {
  try {
    const aliased = Object.assign({}, entry);
    if ('followupCalls' in aliased) aliased.followupCallCount = aliased.followupCalls;
    if ('elapsedMs' in aliased) aliased.durationMs = aliased.elapsedMs;
    fs.appendFileSync(FOLLOWUP_TELEMETRY, JSON.stringify({ ts: new Date().toISOString(), ...aliased }) + '\n', 'utf8');
  } catch (e) {
    err('followup telemetry write failed: ' + (e.message || e));
  }
}
// Pre-load the skill embeddings cache once at startup so per-write dedup checks
// don't re-read the JSON file. Cache is small (~600KB for 41 skills).
let _skillsEmbeddingCache = null;
function getSkillEmbeddings() {
  if (!_skillsEmbeddingCache) {
    try {
      _skillsEmbeddingCache = loadEmbeddingsCache().embeddings || {};
    } catch (_) {
      _skillsEmbeddingCache = {};
    }
  }
  return _skillsEmbeddingCache;
}

// ── Config ──
const MODEL = 'minimax-portal/MiniMax-M2.7';
const MODEL_FALLBACKS = ['kimi/kimi-for-coding'];
// OPENCLAW_CLI path resolution (v3 pattern): known paths first, which fallback, raw name last.
// Cron isolated sessions have truncated PATH — 'which' alone fails there.
const OPENCLAW_CLI = (function() {
  const knownPaths = ['/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw'];
  for (const p of knownPaths) {
    try { fs.accessSync(p, fs?.constants?.X_OK); return p; } catch (_) {}
  }
  try { return require('child_process').execFileSync('which', ['openclaw'], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch (_) { return 'openclaw'; }
})();
const TIMEOUT_MS = 300000;
const REVIEWER_SCRIPT = path.join(WS, 'scripts', 'skill_reviewer.js');
const CLEANUP_SCRIPT = path.join(WS, 'scripts', 'skill_reviewer_cleanup.js');
const QUEUE_FILE = path.join(WS, '.skill_review_queue.jsonl');
const DISCORD_CHANNEL = '1473376125584670872';
const LOCK_DIR = path.join(WS, '.skill_reviewer_bot.lockdir');
const SKILL_CREATED_LOG = path.join(WS, '.skill_created.jsonl');
const LLM_JUDGE_SHADOW_LOG = path.join(WS, '.llm_judge_shadow.jsonl');

// ── S1 mismatch escalation (Phase 1) ──
// Event log: every mark-mismatch invocation, with the source event,
// destination, and actions taken (or planned, for --dry-run).
const S1_MISMATCH_HISTORY_LOG = path.join(WS, '.s1_mismatch_history.jsonl');
// Alert log: written only on a successful (non-dry-run) quarantine,
// so downstream consumers (Discord / dashboards) can pick them up.
const S1_ALERTS_LOG = path.join(WS, '.s1_alerts.jsonl');

// ── Option A (Cooldown) + Option C (Stability Frontmatter) ──
// Issue: two draft skills regenerated 5-8x/day by pipeline (LLM keeps
// re-writing stable content). Two-layer gate prevents re-review of
// stable/cooldown skills. See parseStability() + buildSkillGates() below.
const SKILL_COOLDOWN_HOURS = parseInt(process.env.SKILL_COOLDOWN_HOURS, 10) || 24;
const SKILL_COOLDOWN_MS = SKILL_COOLDOWN_HOURS * 3600000;
const SKILL_GATE_TELEMETRY = path.join(WS, '.skill_reviewer_gates.jsonl');

// ── Week 1 Safety Nets (Issue #154) ──
// Make auto-symlink behavior EXPLICIT + guard-railed.
// Previously, validation-passed skills were silently symlinked into skills/.
// Now: pause + threshold + env override give Josh a kill switch.
const CONFIG = {
  // SKILL_REVIEWER_AUTO_APPLY=false → skip symlink, keep as draft in skills-learned/
  AUTO_APPLY: process.env.SKILL_REVIEWER_AUTO_APPLY === 'false' ? false : true,
  // 24h junk rate above this → skill_junk_pause.js writes .skill_reviewer_pause.json
  // 2026-06-20: relaxed from 0.15 → 0.30 — LLM-judgment pass on 72 skills found
  // 0 quarantinable, indicating the 15% threshold was over-cautious (90% FP rate
  // on auto-quarantine). The LLM-override in skill_junk_tracker.js now excludes
  // LLM-approved skills (score ≥70) from passedAndQuarantined, so a higher
  // 30% threshold is safe.
  AUTO_PAUSE_THRESHOLD: 0.30,       // 30% (was 15%; 2026-06-20 relaxed per LLM-judgment audit)
  AUTO_PAUSE_DURATION_MS: 86400000, // 24h
  DAILY_REPORT_TIME: '23:55 HKT',   // cron time, soft hint (not enforced here)
  PAUSE_FILE: path.join(WS, '.skill_reviewer_pause.json'),
  JUNK_RATE_FILE: path.join(WS, '.skill_junk_rate.jsonl'),
  DISCORD_CHANNEL_ID: '1473376125584670872',
  MS_PER_HOUR: 3600000,
  STATUS_OK: 200,
  BACKOFF_BASE_MS: 1000,
  HTTP_TIMEOUT_MS: 30000,
  MAX_BUFFER_BYTES: 10 * 1024 * 1024,
  PRE_WRITE_STUB_SIZE_MIN: 1500,
  MS_PER_MINUTE: 60000,
  KB_DIVISOR: 1024,
  ELAPSED_MS_DIVISOR: 1000,
  CLEANUP_TIMEOUT_MS: 10000
};

// Track dedup outcome per file path (set in writeSkillFiles, read in recordSkillCreated)
var lastWriteDedup = new Map();

// ── Helpers ──

function log() {
  if (!process.argv.includes('--quiet')) console.log(...arguments);
}

function err() {
  console.error(...arguments);
}

/**
 * Record a skill_created event to .skill_created.jsonl (append-only).
 * Used for quality trend telemetry: pitfalls count, workflow steps,
 * quarantine rate over time. Separate from .skill_metrics.json (run-level
 * telemetry) to keep this lightweight and event-sourced.
 */
function recordSkillCreated(event) {
  try {
    fs.appendFileSync(SKILL_CREATED_LOG, JSON.stringify(event) + '\n', 'utf8');
  } catch (e) {
    err('skill_created event write failed: ' + e.message);
  }
}

/**
 * Phase 2: Record an LLM judge shadow event to .llm_judge_shadow.jsonl.
 * Append-only, used by the calibration report (7-day analysis).
 * Silent on failure — shadow logging must never block the pipeline.
 */
function recordLlmJudgeShadow(event) {
  try {
    fs.appendFileSync(LLM_JUDGE_SHADOW_LOG, JSON.stringify(event) + '\n', 'utf8');
    return true;
  } catch (e) {
    err('llm_judge_shadow write failed: ' + e.message);
    return false;
  }
}

/**
 * Option C: Parse `stability` field from SKILL.md frontmatter.
 * Returns one of: 'stable' (skip review), 'auto' (default, allow review),
 * 'volatile' (review every run regardless of cooldown).
 * Fails open: missing or unparseable → 'auto'.
 */
// P1-6: existsSync returns false for broken (dangling) symlinks.
// Use lstatSync to distinguish 'not exist' from 'broken symlink'.
function isBrokenSymlink(p) {
  try {
    var st = fs.lstatSync(p);
    if (!st.isSymbolicLink()) return false;
    try { fs.accessSync(p, fs?.constants?.F_OK); return false; } catch (_) { return true; }
  } catch (_) { return false; }
}

function parseStability(skillPath) {
  try {
    if (!fs.existsSync(skillPath)) return 'auto';
    var content = fs.readFileSync(skillPath, 'utf8');
    var match = content.match(/^---\n([\s\S]+?)\n---/);
    if (!match) return 'auto';
    var frontmatter = match[1];
    var stabilityMatch = frontmatter.match(/^stability:\s*(\S+)/m);
    if (!stabilityMatch) return 'auto';
    var value = stabilityMatch[1].toLowerCase();
    if (value === 'stable') return 'stable';
    if (value === 'volatile') return 'volatile';
    return 'auto';
  } catch (e) {
    err('parseStability: fail-open: ' + e.message);
    return 'auto';
  }
}

/**
 * Option A + C: Scan skills-learned/ for skills that should be excluded
 * from review this run. Two gates applied:
 *   - Stable: frontmatter `stability: stable` → always excluded
 *   - Cooldown: mtime within SKILL_COOLDOWN_MS AND no new queue entry
 *     with ts > mtime → excluded
 *   - Volatile: frontmatter `stability: volatile` → never excluded
 * Fails open: any error → return empty gates (no exclusions).
 *
 * Returns { stable: [path,...], cooldown: [{path, ageHours},...] }.
 */
function buildSkillGates() {
  var skillsLearned = path.join(WS, 'skills-learned');
  var gates = { stable: [], cooldown: [] };
  if (!fs.existsSync(skillsLearned)) return gates;

  // Determine the most recent queue entry timestamp. If queue has any entry
  // with ts newer than the skill's mtime, treat as "new context exists" and
  // let the cooldown skip NOT apply (skill may need updating for the new
  // context). If queue is empty or all entries are older than mtime, treat
  // as "no new context" and apply cooldown skip.
  var lastQueueTs = null;
  if (fs.existsSync(QUEUE_FILE)) {
    try {
      var lines = fs.readFileSync(QUEUE_FILE, 'utf8').split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          var ev = JSON.parse(line);
          if (ev.ts && (lastQueueTs === null || ev.ts > lastQueueTs)) {
            lastQueueTs = ev.ts;
          }
        } catch (e) { /* skip malformed */ }
      }
    } catch (e) { /* fail-open: leave lastQueueTs null */ }
  }

  try {
    var dirs = fs.readdirSync(skillsLearned, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory() && !d?.name?.startsWith('_'); });
    var now = Date.now();
    for (var i = 0; i < dirs.length; i++) {
      var dir = dirs[i];
      var skillPath = path.join(skillsLearned, dir.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      var relDirPath = 'skills-learned/' + dir.name + '/';

      // Gate 1: stability frontmatter (highest priority)
      var stability = parseStability(skillPath);
      if (stability === 'stable') {
        gates?.stable?.push(relDirPath);
        continue;
      }
      if (stability === 'volatile') {
        // Volatile = intentionally review every run; skip cooldown gate entirely.
        continue;
      }

      // Gate 2: cooldown (mtime within window AND no new context since mtime)
      var stat;
      try { stat = fs.statSync(skillPath); } catch (e) { continue; }
      var mtimeMs = stat?.mtime?.getTime();
      var ageMs = now - mtimeMs;
      if (ageMs < SKILL_COOLDOWN_MS) {
        // On cooldown. Check if any new queue context exists since mtime.
        // mtime serializes as ISO string via toISOString(); queue ts is already
        // ISO string. Lexicographic comparison works for ISO 8601 timestamps.
        var mtimeIso = stat?.mtime?.toISOString();
        var hasNewContext = lastQueueTs !== null && lastQueueTs > mtimeIso;
        if (!hasNewContext) {
          var ageHours = parseFloat((ageMs / CONFIG.MS_PER_HOUR).toFixed(2));
          gates?.cooldown?.push({ path: relDirPath, ageHours: ageHours });
        }
      }
    }
  } catch (e) {
    err('buildSkillGates: fail-open (returning empty gates): ' + e.message);
    return { stable: [], cooldown: [] };
  }
  return gates;
}

/**
 * Build a catalog of ALL existing skills (not just stable/cooldown).
 * Returns array of {name, description} for prompt injection.
 */
function buildExistingSkillCatalog() {
  var skillsLearned = path.join(WS, 'skills-learned');
  var catalog = [];
  if (!fs.existsSync(skillsLearned)) return catalog;

  try {
    var dirs = fs.readdirSync(skillsLearned, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory() && !d?.name?.startsWith('_'); });
    
    for (var i = 0; i < dirs.length; i++) {
      var dir = dirs[i];
      var skillPath = path.join(skillsLearned, dir.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      
      try {
        var content = fs.readFileSync(skillPath, 'utf8');
        var desc = extractField(content, 'description');
        if (desc) {
          catalog.push({
            name: dir.name,
            description: desc.length > 120 ? desc.substring(0, 120) + '...' : desc
          });
        }
      } catch (e) { /* skip malformed */ }
    }
  } catch (e) {
    err('buildExistingSkillCatalog: fail-open: ' + e.message);
  }
  
  // Sort alphabetically for consistent output
  catalog.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return catalog;
}

/**
 * Format the existing skill catalog for prompt injection.
 */
function formatSkillCatalog(catalog) {
  if (!catalog || catalog.length === 0) return '';
  
  var lines = [
    '',
    '## 📚 EXISTING SKILL CATALOG',
    '',
    'The following skills ALREADY EXIST. Before creating a new skill, check if',
    'your topic is already covered. If it is, you should PATCH the existing skill,',
    'not create a duplicate with a different name.',
    '',
    'Existing skills (' + catalog.length + ' total):',
    ''
  ];
  
  for (var i = 0; i < catalog.length; i++) {
    var skill = catalog[i];
    lines.push('- `' + skill.name + '`: ' + skill.description);
  }
  
  lines.push('');
  lines.push('RULE: If your new skill overlaps with any of the above, output PATCH or SKIP,');
  lines.push('not a new CREATE. Duplicates will be rejected by the dedup gate.');
  lines.push('');
  
  return lines.join('\n');
}
function recordGateSkip(event) {
  try {
    fs.appendFileSync(SKILL_GATE_TELEMETRY, JSON.stringify(event) + '\n', 'utf8');
    return true;
  } catch (e) {
    err('skill_reviewer_gates write failed: ' + e.message);
    return false;
  }
}

// ── Internal Automation Bypass (2026-07-14) ──
// Skills whose names start with one of these prefixes are workspace-internal
// automation (cron jobs, email tools, heartbeat, HA, pipeline orchestration,
// etc.). They are needed by cron pipelines regardless of validator outcome
// and have nothing to do with the user-facing skill catalog quality.
// The validator (validate_skill_file.js) is correct for normal skills — it
// just does not have the context to evaluate these internal utilities.
// Behavior: skip post-write validation, directly symlink, log with
// autoApplied:true (so junk_tracker and junk_pause also exclude them).
// To extend: add prefix to INTERNAL_AUTOMATION_PREFIXES; no other change.
// Must stay in sync with skill_junk_tracker.js INTERNAL_AUTOMATION_PREFIXES.
var INTERNAL_AUTOMATION_PREFIXES = [
  'cron', 'email', 'ha-', 'bliss', 'failover',
  'daily-', 'weekly-', 'skill-',
  'heartbeat', 'anomaly', 'subagent', 'wiki', 'memory',
  'llm', 'connection', 'pattern'
];
// Env kill switch so a bad promotion can be disabled without code change.
// Set SKILL_REVIEWER_BYPASS_INTERNAL=0 to force internal skills through the
// normal validator path. Default = bypass enabled (1).
var INTERNAL_AUTOMATION_BYPASS = process.env.SKILL_REVIEWER_BYPASS_INTERNAL !== '0';

function isInternalAutomationName(name) {
  if (!name) return false;
  var n = String(name).toLowerCase();
  for (var i = 0; i < INTERNAL_AUTOMATION_PREFIXES.length; i++) {
    if (n.indexOf(INTERNAL_AUTOMATION_PREFIXES[i]) === 0) return true;
  }
  return false;
}
function internalBypassEnabled() {
  return INTERNAL_AUTOMATION_BYPASS;
}

/**
 * Post-LLM hard gate filter: drop any file block that targets a
 * stable or cooldown-blocked skill. This is the DEFINITIVE filter
 * (prompt-level exclusion list is just a hint; this is the wall).
 * Records telemetry for every skip.
 */
function filterBlocksByGates(blocks, gates) {
  if (!gates) return { filtered: blocks || [], skipped: [] };
  var stableSet = {};
  for (var i = 0; i < gates.stable.length; i++) stableSet[gates.stable[i]] = true;
  var cooldownMap = {};
  for (var j = 0; j < gates?.cooldown?.length; j++) {
    cooldownMap[gates.cooldown[j].path] = gates.cooldown[j].ageHours;
  }

  var filtered = [];
  var skipped = [];
  var blocksArr = blocks || [];
  for (var k = 0; k < blocksArr.length; k++) {
    var block = blocksArr[k];
    // Derive the directory form: "skills-learned/<name>/SKILL.md" → "skills-learned/<name>/"
    // (also catches support files like references/, scripts/ under the same dir).
    var dirPath = block?.filePath?.replace(/[^/]*$/, '');
    if (stableSet[dirPath]) {
      log('STABLE: gate filter excluded ' + block.filePath);
      recordGateSkip({
        v: 1, ts: new Date().toISOString(),
        event: 'skill_skipped',
        reason: 'stable',
        path: block.filePath
      });
      skipped.push(block);
      continue;
    }
    if (cooldownMap.hasOwnProperty(dirPath)) {
      var ageHours = cooldownMap[dirPath];
      log('COOLDOWN: ' + block.filePath + ' was updated ' + ageHours + 'h ago, skipping write');
      recordGateSkip({
        v: 1, ts: new Date().toISOString(),
        event: 'skill_skipped',
        reason: 'cooldown',
        path: block.filePath,
        ageHours: ageHours
      });
      skipped.push(block);
      continue;
    }
    filtered.push(block);
  }
  return { filtered: filtered, skipped: skipped };
}

/**
 * Determine whether a skill should be promoted to an active symlink.
 * Skips: status draft/archived, disable-model-invocation: true, activation: manual.
 *
 * Uses shared frontmatter parser so symlink gating stays in sync with
 * skill_discovery.js and skill-auto-suggest (see tracker / M1.7).
 */
function shouldSymlinkSkill(content) {
  const status = extractField(content, 'status');
  if (status && (status.toLowerCase() === 'draft' || status.toLowerCase() === 'archived')) {
    return false;
  }
  if (isFrontmatterFieldTruthy(content, 'disable-model-invocation')) {
    return false;
  }
  const activation = extractField(content, 'activation');
  if (activation && activation.toLowerCase() === 'manual') {
    return false;
  }
  return true;
}

/**
 * Normalize SKILL.md content for content-hash dedup comparison.
 * Strips timestamp-like frontmatter fields that legitimately change every run,
 * plus trailing whitespace, so two equivalent contents hash to the same value.
 */
function normalizeForDedup(content) {
  if (typeof content !== 'string') return '';
  return content
    .replace(/^generatedAt:.*$/gm, '')
    .replace(/^updated:.*$/gm, '')
    .replace(/^lastReviewed:.*$/gm, '')
    .replace(/^reviewedAt:.*$/gm, '')
    .replace(/\s+$/g, '');
}

/**
 * Decide whether we actually need to write `newContent` to `targetPath`.
 * Returns true (rewrite needed) on first write OR when normalized content differs.
 * Returns false (skip rewrite) when content is semantically equivalent.
 * Fails open: any error → return true (write, don't risk losing content).
 */
function shouldRewrite(targetPath, newContent) {
  try {
    if (!fs.existsSync(targetPath)) return true;
    var existing = fs.readFileSync(targetPath, 'utf8');
    var crypto = require('crypto');
    var h1 = crypto.createHash('sha256').update(normalizeForDedup(existing)).digest('hex');
    var h2 = crypto.createHash('sha256').update(normalizeForDedup(newContent)).digest('hex');
    return h1 !== h2;
  } catch (e) {
    err('shouldRewrite: fail-open on error: ' + e.message);
    return true;
  }
}

function getDiscordToken() {
  try {
    var config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return (config.channels && config?.channels?.discord && config?.channels?.discord?.token) || '';
  } catch (e) {
    err('Failed to read Discord token: ' + e.message);
    return '';
  }
}

function sendDiscordMessage(content) {
  return new Promise((resolve, reject) => {
    const token = getDiscordToken();
    const body = JSON.stringify({ content });
    const options = {
      hostname: 'discord.com',
      path: '/api/v10/channels/' + DISCORD_CHANNEL + '/messages',
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
        if (res.statusCode === CONFIG.STATUS_OK) resolve(true);
        else reject(new Error('HTTP ' + res.statusCode + ': ' + data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── WARN-03 fix: Discord delivery with retry + exponential backoff ──
function sendDiscordMessageWithRetry(content, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  return new Promise(function (resolve, reject) {
    var attempt = 0;
    function tryOnce() {
      attempt++;
      sendDiscordMessage(content)
        .then(resolve)
        .catch(function (err) {
          var transient = err?.message?.indexOf('429') !== -1 || err?.message?.indexOf('rate') !== -1 || /\b5\d{2}\b/.test(err.message) || err?.message?.indexOf('ETIMEDOUT') !== -1 || err?.message?.indexOf('ECONNRESET') !== -1;
          if (transient && attempt < maxAttempts) {
            var delay = CONFIG.BACKOFF_BASE_MS * Math.pow(2, attempt - 1);  // 1s, 2s, 4s
            log('Discord send failed (attempt ' + attempt + '/' + maxAttempts + '): ' + err.message + ' — retrying in ' + delay + 'ms');
            setTimeout(tryOnce, delay);
          } else {
            if (attempt >= maxAttempts) err('Discord delivery failed after ' + attempt + ' attempts: ' + err.message);
            reject(err);
          }
        });
    }
    tryOnce();
  });
}

/**
 * Deduplicate queue entries by userPrompt (content hash).
 * Returns { uniqueEntries: [], duplicateCount: number }.
 */
function deduplicateQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return { uniqueEntries: [], duplicateCount: 0 };
  try {
    var raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
    if (!raw) return { uniqueEntries: [], duplicateCount: 0 };
    
    var lines = raw.split('\n').filter(Boolean);
    var seen = {};
    var unique = [];
    var duplicates = 0;
    
    for (var i = 0; i < lines.length; i++) {
      try {
        var entry = JSON.parse(lines[i]);
        // Use userPrompt as dedup key (first 100 chars)
        var key = (entry.userPrompt || '').substring(0, 100);
        if (!key) continue;
        
        if (seen[key]) {
          duplicates++;
        } else {
          seen[key] = true;
          unique.push(entry);
        }
      } catch (e) { /* skip malformed */ }
    }
    
    return { uniqueEntries: unique, duplicateCount: duplicates };
  } catch (e) {
    return { uniqueEntries: [], duplicateCount: 0 };
  }
}

function readQueueCount() {
  if (!fs.existsSync(QUEUE_FILE)) return 0;
  try {
    var raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
    return raw ? raw.split('\n').filter(Boolean).length : 0;
  } catch (e) {
    return 0;
  }
}

// ── Prompt building ──

function buildReviewPrompt() {
  var basePrompt = execFileSync('node', [REVIEWER_SCRIPT, '--batch'], {
    timeout: CONFIG.HTTP_TIMEOUT_MS,
    maxBuffer: CONFIG.MAX_BUFFER_BYTES,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' })
  });

  if (basePrompt.indexOf('Nothing to review') !== -1) return null;

  // ── Option A + C: compute gates (stable + cooldown) ──
  // Gates inform BOTH the prompt (exclusion list as a hint) AND the
  // post-LLM hard filter (filterBlocksByGates in main()). Prompt-level
  // hints save tokens; hard filter is the wall.
  var gates = buildSkillGates();
  if (gates?.stable?.length > 0) {
    log('Gates: ' + gates?.stable?.length + ' stable skill(s) excluded from review: ' + gates?.stable?.join(', '));
  }
  if (gates?.cooldown?.length > 0) {
    log('Gates: ' + gates?.cooldown?.length + ' cooldown skill(s) excluded from review: ' +
      gates?.cooldown?.map(function (c) { return c.path + '(' + c.ageHours + 'h)'; }).join(', '));
  }

  // Batch mode instructions — use single quotes for literal backticks
  var instructions =

    '\n\n' +
    '## ⚠️ BATCH MODE — TOOLS NOT AVAILABLE\n\n' +
    'IMPORTANT: You are running in batch mode. You do NOT have write/edit/message tools.\n' +
    'Output skill file content directly in your response, not tool calls.\n\n' +
    '### 🚫 OUTPUT LIMIT (HARD CAP)\n\n' +
    '**Maximum 2 skills per response.** Write EACH skill COMPLETELY before\n' +
    'starting the next — frontmatter + Workflow (≥3 steps) + Pitfalls (≥3 bullets).\n' +
    'If you reach the token limit mid-skill, finish the current skill\'s ALL sections\n' +
    'before stopping. Partial skills will be rejected by the validator.\n\n' +
    '### \ud83c\udfaf Description Specification (HARD GATE)\n\n' +
    'The `description` field is the ONLY signal the agent sees when deciding whether\n' +
    'to load this skill. It must be searchable, concise, and label-less.\n\n' +
    '**Formula:** `Action verb + when/if trigger + payoff/output` in ONE sentence.\n\n' +
    '**Rules:**\n' +
    '- Length: 50–250 characters (hard gate); 80–200 ideal.\n' +
    '- MUST start with an action verb. Safe choices: Diagnose, Route, Audit, Migrate,\n' +
    '  Detect, Verify, Spawn, Scan, Convert, Build, Analyze, Review, Update, Clean.\n' +
    '- Prefer label-less: `Do X when Y happens or Z is needed, producing W.`\n' +
    '- If you must label, use at most ONE plain `Use when` (no colon) — never combine\n' +
    '  it with `Key capabilities:`.\n' +
    '- Banned: XML/angle brackets, ALL CAPS words, exclamation marks, vague words\n' +
    '  (`helper`, `utility`, `stuff`, `various`), more than one quality keyword\n' +
    '  (`systematic`, `structured`, `comprehensive`).\n\n' +
    '**Good (label-less, ~145 chars):**\n' +
    '> Route spawn requests to M2.7 by default and M3 only when high-quality analysis\n' +
    '> is explicitly requested, preserving quality through the fallback chain.\n\n' +
    '**Bad (labeled spam):**\n' +
    '> Apply intent-based quality tiering to the SPAWN route... Use when: routing spawn\n' +
    '> requests... Key capabilities: parse user intent...\n\n' +
    '### ⚠️ MANDATORY: Pitfalls Section\n\n' +
    'Every skill MUST have `## Pitfalls` (≥3 bullets). Validator rejects missing Pitfalls.\n' +
    'Each bullet: specific failure mode + consequence. No generic "be careful" filler.\n\n' +
    '### Output format\n\n' +
    '```skills-learned/<name>/SKILL.md\n' +
    '---\n' +
    'name: <name>\n' +
    'description: <50-250 chars, action-verb-first>\n' +
    'status: draft\n' +
    'source: skill-reviewer\n' +
    'provenance: agent\n' +
    'generatedAt: <timestamp>\n' +
    '---\n\n' +
    '## Workflow\n' +
    '1. <step with concrete command>\n' +
    '...\n\n' +
    '## Pitfalls\n' +
    '- ⚠️ <specific failure mode> — <consequence>\n' +
    '- ⚠️ <specific failure mode> — <consequence>\n' +
    '- ⚠️ <specific failure mode> — <consequence>\n' +
    '```\n\n' +
    '### 🛑 Pre-output checklist (MANDATORY before JSON)\n\n' +
    'Before JSON: verify each skill has ALL of — missing any = REJECTED:\n' +
    '□ description 50–250 chars, action verb first\n' +
    '□ ## Workflow ≥3 steps, each with concrete command/file\n' +
    '□ ## Pitfalls ≥3 bullets, each with specific failure + consequence\n' +
    '□ body ≥1500 bytes (not counting frontmatter)\n\n' +
    '### Final JSON summary (REQUIRED)\n\n' +
    'After ALL file blocks, output a summary JSON block as the LAST thing:\n\n' +
    '```json\n' +
    '{\n' +
    '  "summary": "\uD83D\uDCBE Skill Self-improvement:\\n- \u65b0\u5efa: cron-failure-diagnosis — \u8a3a\u65b7 cron \u5931\u6557\u4e26\u5efa\u7acb\u6642\u9593\u7dda\u9694\u96e2\u6839\u56e0\\n- \u968a\u5217: 1 \u689d\u5df2\u6b78\u6a94\u4e26\u6e05\u7a7a",\n' +
    '  "hasUpdates": true,\n' +
    '  "filesWritten": ["skills-learned/cron-failure-diagnosis/SKILL.md"]\n' +
    '}\n' +
    '```\n\n' +
    'If NO updates:\n' +
    '```json\n' +
    '{"summary":"no-updates","hasUpdates":false,"filesWritten":[]}\n' +
    '```\n\n' +
    '### Rules\n' +
    '- Follow Analysis → Decision → Implementation structure\n' +
    '- DO NOT mention tools (write/edit/message)\n' +
    '- Output each file as ```skills-learned/... fenced block\n' +
    '- End with JSON summary, NOTHING after it\n\n' +
    '### \ud83c\udfaf Writing Quality\n\n' +
    'When generating skill content, follow these quality guidelines:\n\n' +
    '1. **Explain the why, not just the what** — Workflow steps that say "run X" should\n' +
    '   say "run X because Y". This is what makes skills transferable to novel contexts.\n' +
    '2. **Progressive disclosure** — Lead with one-line description. Workflow in middle.\n' +
    '   Pitfalls / edge cases last. Don\'t front-load everything into Workflow.\n' +
    '3. **Lean prompts, concrete examples** — "Use terse output" beats "be concise in\n' +
    '   your responses". Examples > abstractions.\n' +
    '4. **Avoid ALL CAPS, exclamation marks, filler** — This is a reference doc, not a\n' +
    '   tutorial. Professional tone.\n' +
    '5. **Self-contained** — A skill should work even if the surrounding conversation is\n' +
    '   gone. Don\'t reference "as discussed above" or "in the context above".\n\n' +
    '### ⚠️ Reverse-Thinking Quality Gates (QW-6)\n\n' +
    'Before outputting ANY skill file, run this checklist. If the answer is "yes",\n' +
    'rewrite or output `SKIP` instead of writing the file. These rules are derived\n' +
    'from actual skills that ended up quarantined in `skills-learned/_archive/`.\n\n' +
    '#### 1. Description hard constraints\n\n' +
    'The description is what the agent sees in `<available_skills>`. It MUST be\n' +
    'searchable, concise, and free of boilerplate. The post-write validator\n' +
    '(`validate_skill_file.js`) now enforces these as HARD gates — failure\n' +
    'blocks symlink promotion.\n\n' +
    '- Length: HARD gate 50–250 characters; IDEAL 80–200 characters.\n' +
    '- MUST start with an action verb (e.g. Diagnose, Route, Migrate, Detect,\n' +
    '  Clean). Do NOT start with nouns like `Workflow for...`, `Full...`,\n' +
    '  `Systematic...`, or `Sequential...`.\n' +
    '- Structure: ONE sentence, THREE segments: (a) what it does, (b) concrete\n' +
    '  trigger scenario, (c) payoff / output. Prefer label-less forms; write\n' +
    '  "Do X when Y happens, Z occurs, or W is needed" instead of\n' +
    '  "Use when: Y. Key capabilities: Z."\n' +
    '- Avoid labels. If you must use a trigger label, use at most ONE plain\n' +
    '  `Use when` (no colon) and never combine it with `Key capabilities:` or\n' +
    '  multiple trigger phrases.\n' +
    '- Banned style: ALL CAPS, XML/angle brackets, exclamation marks, vague words\n' +
    '  (`helper`, `utility`, `miscellaneous`, `stuff`, `various`).\n' +
    '- No more than ONE quality keyword (`systematic`, `structured`, `comprehensive`).\n\n' +
    '**Bad example** (464 chars, real failure — `intent-based-spawn-model-selection`):\n' +
    '> Apply intent-based quality tiering to the SPAWN route: default to M2.7 for\n' +
    '> cost-effective speed, M3 when high quality is explicitly requested, with\n' +
    '> fallback chains preserving quality expectations. Use when: routing spawn\n' +
    '> requests, selecting between M2.7 and M3 model tiers, configuring\n' +
    '> non-degrading fallback chains. Key capabilities: parse user intent for\n' +
    '> quality keywords, route via spawn_config.js to appropriate tier, enforce\n' +
    '> quality-preserving fallback rules.\n\n' +
    '**Good label-less example** (~145 chars):\n' +
    '> Route spawn requests to M2.7 by default and M3 only when high-quality\n' +
    '> analysis is explicitly requested, preserving quality through the fallback chain.\n\n' +
    '**Acceptable labeled example** (~130 chars):\n' +
    '> Diagnose cron failures via timeline and issue isolation when cron fails,\n' +
    '> timeline is needed, or root cause is unclear.\n\n' +
    '#### 2. Pitfall concreteness rule\n\n' +
    'Every `## Pitfalls` bullet must name a specific failure mode + observable signal\n' +
    '+ consequence.\n\n' +
    '- BAD: `- ⚠️ Be careful with timeouts` (no failure mode, no signal).\n' +
    '- BAD: `- ⚠️ Make sure to test` (generic instruction).\n' +
    '- GOOD: `- ⚠️ Swapping cron model without adjusting timeoutSeconds —\n' +
    '  120s timeout remains after moving to slower DeepSeek — still times out.`\n\n' +
    '#### 3. Self-referential hard block\n\n' +
    'DO NOT create skills about the skill pipeline itself. If the conversation is about\n' +
    '`skill_reviewer_bot.js`, `validate_skill_file.js`, skill quarantine, junk rate,\n' +
    'symlink management, or improving the reviewer, output `SKIP` and explain why.\n\n' +
    'Blocked name/description fragments: `skill-reviewer`, `skill reviewer`, `curator`,\n' +
    '`self-improvement`, `skill-validation`, `skill curation`, `skill quality`,\n' +
    '`skill audit`, `skill pipeline`, `auto-skill`.\n\n' +
    'Real failures that should have been SKIPped:\n' +
    '- `skills-audit-workflow` — workflow about auditing the skill reviewer.\n' +
    '- `auto-skill-pipeline-feasibility` — feasibility study of the auto-skill pipeline.\n' +
    '- `skill-validation-failure-cleanup` — cleanup logic for the reviewer validator.\n\n' +
    '#### 4. Duplication avoidance rule\n\n' +
    'Before creating, cite the closest existing skill from the catalog. If the topic\n' +
    'already appears, your action is PATCH, not CREATE. Required analysis sentence:\n' +
    '> Overlap check: `<existing-skill>` already covers `<topic>`; decision = PATCH / SKIP / CREATE.\n\n' +
    'Watch for redundant clusters:\n' +
    '- cron failure modes → update `cron-troubleshooting`, don\'t create another `cron-*`.\n' +
    '- M3 sub-agent spawn → update `subagent-m3-reliability` or `context-gather-subagent-orchestrate`.\n' +
    '- email/Rapaport summaries → one skill, not one per email type.\n\n' +
    '#### 5. Workflow actionability rule\n\n' +
    '- Target 5–8 numbered steps. If >10, move deep-dive material to\n' +
    '  `references/<topic>.md` and keep the Workflow lean.\n' +
    '- Each step must start with a verb + concrete object + specific command/file.\n' +
    '- BAD: `1. Identify the issue.`\n' +
    '- GOOD: `1. Run openclaw cron runs <id> and flag runs that timeout exactly at timeoutSeconds.`\n\n' +
    '#### 6. Thin-content rejection\n\n' +
    'If the body is <150 words AND the workflow is a thin wrapper around an existing\n' +
    'cron/script, do not create the skill. A skill must add transferable know-how,\n' +
    'not just describe a cron entry.\n\n' +
    '#### 7. Final self-audit before output\n\n' +
    'For every skill, mentally verify:\n' +
    '- `DESC_LEN=80-200` (hard gate 50-250)\n' +
    '- `DESC_VERB=action-verb-first` (not `Workflow for...` / `Full...`)\n' +
    '- `PREFER_NO_LABELS=yes` (avoid `Use when:` / `Key capabilities:`)\n' +
    '- `SELF_REF=no`\n' +
    '- `OVERLAP=<existing-skill-or-none>`\n' +
    '- `PITFALLS_CONCRETE=yes`\n' +
    'If any is wrong, rewrite before emitting the code block.\n';

  // ── Option A + C: exclusion section for stable / cooldown skills ──
  // Gentle hint to LLM; the post-LLM hard filter (filterBlocksByGates)
  // is the definitive gate. Only emitted when there ARE exclusions —
  // empty list means no noise in prompt.
  var exclusionSection = '';
  if (gates?.stable?.length > 0 || gates?.cooldown?.length > 0) {
    exclusionSection = '\n\n' +
      '## \ud83d\udeab Skills EXCLUDED from this review (DO NOT TOUCH)\n\n' +
      'The following existing skills are EXCLUDED from this review run.\n' +
      'Do NOT update, patch, or re-create them — even if you see them mentioned\n' +
      'in the conversation context above. They are either marked `stability: stable`\n' +
      '(explicitly frozen) or were updated within the last ' + SKILL_COOLDOWN_HOURS + 'h\n' +
      'with no new conversation context to justify a refresh.\n\n';
    if (gates?.stable?.length > 0) {
      exclusionSection += '### Stable (frontmatter `stability: stable`)\n';
      gates?.stable?.forEach(function (p) { exclusionSection += '- `' + p + 'SKILL.md`\n'; });
      exclusionSection += '\n';
    }
    if (gates?.cooldown?.length > 0) {
      exclusionSection += '### Cooldown (recently updated, no new context)\n';
      gates?.cooldown?.forEach(function (c) {
        exclusionSection += '- `' + c.path + 'SKILL.md` (' + c.ageHours + 'h ago)\n';
      });
      exclusionSection += '\n';
    }
    exclusionSection +=
      'If a new skill genuinely does NOT overlap with any of the above,\n' +
      'you may still CREATE it. The exclusion list only blocks UPDATES to\n' +
      'the listed skills — not new creations in unrelated territory.\n';
  }

  // Build existing skill catalog for duplication avoidance
  var skillCatalog = buildExistingSkillCatalog();
  var catalogSection = formatSkillCatalog(skillCatalog);

  return { prompt: basePrompt + catalogSection + exclusionSection + instructions, gates: gates };
}

// ── Response parsing ──

function extractFileBlocks(response) {
  // ── H-4 fix: detect unclosed code fences (odd ``` count) ──
  // If the LLM truncated or malformed its output, fence pairs may be
  // unbalanced. Bail early with an error rather than silently dropping
  // the malformed block (or worse, writing a half-formed file).
  var fenceCount = (response.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    err('Aborting extract: unclosed code fence (odd ``` count: ' + fenceCount + ')');
    return { files: [], error: 'unclosed code fence' };
  }
  var blocks = [];
  // Match ```[lang]skills-learned/<path>.md\n...content...```
  // B7 fix: allow leading whitespace (LLM sometimes indents)
  // B8 fix: allow optional info string (e.g. ```markdown or ```md) before the path
  var startIdx = 0;
  while (true) {
    // Find next ``` possibly followed by a language tag, then skills-learned/
    // Use a regex that matches optional whitespace + ``` + optional lang + skills-learned/
    var fenceRegex = /^\s*```[a-zA-Z0-9_-]*\s*skills-learned\/[^\n]+$/gm;
    fenceRegex.lastIndex = startIdx;
    var match = fenceRegex.exec(response);
    if (!match) break;

    var open = match.index;
    // Find the line that contains the fence opening
    var lineStart = open;
    // ── BUG-01 fix: use match's own end position to find the line ending ──
    // The previous implementation used response.indexOf('\n', open), which
    // incorrectly matched a \n in the match's leading whitespace (e.g. a
    // blank line before this block). When that happened, contentStart
    // pointed to the opening ``` of the NEXT block, causing the inner
    // fence-tracking loop to treat that opening as an internal code-block
    // open and fail to find the outer close — silently dropping every block
    // after the first when blocks were separated by a blank line.
    // Using match[0].length is robust because the regex `...$/gm` anchors
    // the match to a complete line, so match[0] IS the line content and
    // match[0].length == (position of trailing \n) - match.index.
    var lineEnd = match.index + match[0].length;
    if (lineEnd >= response.length) break;  // no \n after opening fence, bail

    // The path starts after the ``` and optional lang
    var fenceContent = match[0];
    var pathStart = fenceContent.indexOf('skills-learned/') + 'skills-learned/'.length;
    var pathPart = fenceContent.slice(pathStart).trim();
    var filePath = 'skills-learned/' + pathPart;

    var contentStart = lineEnd + 1;
    // ── BUG-02 fix: stateful code-block tracking ──
    // The previous regex `/^\s*```\s*$/gm` matched any bare ``` line as the
    // closing fence — but LLM output often contains INTERNAL code blocks
    // (e.g. ```bash) that get incorrectly interpreted as the outer close.
    // Track open/close state to find the actual outer close.
    // Pair-finding logic: an outer CLOSE must be a bare ``` (no lang tag) AND
    // it must NOT be the closing of an internal block. We detect this by
    // requiring TWO consecutive bare ``` (the first closes the internal block,
    // the second is the outer close), OR a bare ``` that is preceded by
    // non-code content.
    var pos = contentStart;
    var openCount = 0;
    var close = -1;
    var lastFenceWasBareClose = false;  // tracks if previous ``` was a closing fence
    var anyFenceRegex = /^\s*```.*$/gm;
    while (true) {
      anyFenceRegex.lastIndex = pos;
      var fenceMatch = anyFenceRegex.exec(response);
      if (!fenceMatch) break;
      var fenceLine = fenceMatch[0].trim();
      var isBare = /^\s*```\s*$/.test(fenceLine);
      var isLangFence = /^\s*```[a-zA-Z0-9_-]/.test(fenceLine);

      if (isLangFence) {
        // ```lang — always opens a code block
        if (openCount === 0) openCount = 1;
        lastFenceWasBareClose = false;
      } else if (isBare) {
        if (openCount === 0) {
          // This is the OUTER close (we are not inside any block)
          close = fenceMatch.index;
          break;
        } else {
          // This closes an internal block
          openCount = 0;
          lastFenceWasBareClose = true;
        }
      } else {
        // 4+ backticks — opens a code block
        if (openCount === 0) openCount = 1;
        lastFenceWasBareClose = false;
      }
      pos = fenceMatch.index + fenceMatch[0].length;
    }
    if (close === -1) break;

    var content = response.slice(contentStart, close).trim();
    // ── B9 fix + WARN-07: Strip ALL accidental fence duplications ──
    // LLM sometimes duplicates the opening fence inside the block
    // (confused by the prompt template's nested-fence example).
    // Loop until no more leading duplicate fences (handles multi-duplication).
    while (/^```[a-zA-Z0-9_-]*\s*skills-learned\//.test(content)) {
      var firstNewline = content.indexOf('\n');
      content = firstNewline !== -1 ? content.slice(firstNewline + 1).trim() : '';
    }
    // Also strip a trailing standalone ``` if the LLM accidentally
    // embedded a code-fence close inside the content block.
    if (content.length > 0 && /\n```\s*$/.test(content)) {
      content = content.replace(/\n```\s*$/, '');
    }
    // Accept any skills-learned/ file (SKILL.md + support files like references/, scripts/)
    if (content && filePath.indexOf('skills-learned/') === 0 && !filePath.includes('..')) {
      blocks.push({ filePath: filePath, content: content });
    }

    startIdx = close + fenceMatch[0].length;
  }
  return { files: blocks, error: null };
}

function extractSummaryBlock(response) {
  // Find the ```json ... ``` block
  var jsonStart = response.indexOf('```json\n');
  if (jsonStart === -1) return null;

  var contentStart = jsonStart + 8; // length of ```json\n
  var jsonEnd = response.indexOf('```', contentStart);
  if (jsonEnd === -1) return null;

  var raw = response.slice(contentStart, jsonEnd).trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    err('Failed to parse summary JSON: ' + e.message);
    return null;
  }
}

// ── File writing ──

// Check which target files already exist BEFORE writing
function checkExistingFiles(blocks) {
  var existing = {};
  for (var i = 0; i < blocks.length; i++) {
    var absPath = path.join(WS, blocks[i].filePath);
    existing[blocks[i].filePath] = fs.existsSync(absPath);
  }
  return existing;
}

async function writeSkillFiles(blocks) {
  var written = [];
  // Stage 2: list of "tool-call result" messages to inject back to the LLM
  // when a block is skipped due to pre-emit dedup. The caller (the function
  // that invokes writeSkillFiles) reads this and appends to the LLM's
  // message stream so the next pass patches existing skills instead of
  // creating duplicates. Default: empty.
  var injectedToolResults = [];
  var { safeWriteFileSync } = require('./lib/disk_guard');
  // Phase 2g: pre-write gate now uses the unified tier-aware verifier
  // (scripts/lib/skill_verifier.js) via the validate_skill_file.js wrapper.
  // Tier='draft' (strict) — same composite 2-of-3 stub signals the post-write
  // gate uses, so the two checks can no longer diverge.
  var { validateSkillContent } = require('./validate_skill_file');


  var PRE_WRITE_STUB_SIZE_MIN = CONFIG.PRE_WRITE_STUB_SIZE_MIN;   // bytes — refuse to write <1500B SKILL.md (BUG-04 fix)
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var absPath = path.join(WS, block.filePath);
    var dir = path.dirname(absPath);
    try {
      // ── QW-2 fix: pre-write self-referential filter ──
      // Hard block filePaths that would create skills about the bot itself.
      // Prevents the feedback loop where LLM observes its own failures and
      // generates "skill-reviewer-bot-self-improvement" recursively.
      var selfRefPattern = /(skill-reviewer|curator|self-improvement|bot-self|skill-validation-failure-cleanup)/i;
      if (selfRefPattern.test(block.filePath)) {
        err('Refusing self-referential skill: ' + block.filePath);
        recordSkillCreated({v:1, ts:new Date().toISOString(), name:path.basename(dir), file:block.filePath, bytes:block?.content?.length, validationPassed:false, symlinked:false, dedup: false, reason:'self-referential block (QW-2)'});
        log('SKIP self-ref: ' + block.filePath);
        continue;
      }
      // ── H-6 Quarantine Pre-Write Gate: drop block for quarantined skills ──
      // H-5 (symlink gate) prevents quarantined skills from being symlinked, but the
      // SKILL.md itself still gets re-written each cron run because:
      //   1. dedup `patch` action (sim 0.65-0.85) lets the write proceed
      //   2. Internal-automation prefix bypasses post-write validator
      //   3. SKILL.md in skills-learned/ stays, gets re-quarantined
      // Result: a re-creation loop. The proper fix is to drop the block BEFORE
      // any write, so the SKILL.md never lands on disk for quarantined skills.
      // This is the second layer of quarantine defense (H-5 is the first).
      if (path.basename(absPath) === 'SKILL.md' && block?.filePath?.indexOf('skills-learned/') === 0) {
        try {
          var proposedNameQ = (extractField(block.content, 'name') || path.basename(dir)).trim();
          var quarantineRootQ = path.join(WS, 'skills-learned/_archive');
          var quarantinedQ = false;
          if (fs.existsSync(quarantineRootQ)) {
            var qTopQ = fs.readdirSync(quarantineRootQ, { withFileTypes: true });
            for (var qti = 0; qti < qTopQ.length; qti++) {
              var qe = qTopQ[qti];
              if (!qe.isDirectory()) continue;
              if (qe.name === 'failed-validations') {
                var fvQ = fs.readdirSync(path.join(quarantineRootQ, qe.name), { withFileTypes: true });
                for (var qfi = 0; qfi < fvQ.length; qfi++) {
                  if (fvQ[qfi].isDirectory() && fvQ[qfi].name === proposedNameQ) {
                    quarantinedQ = true; break;
                  }
                }
              } else if (qe.name.startsWith('quarantine-')) {
                var qmQ = qe.name.match(/^quarantine-[\d-]+-(.+)$/);
                if (qmQ && qmQ[1] === proposedNameQ) {
                  quarantinedQ = true; break;
                }
              }
              if (quarantinedQ) break;
            }
          }
          if (quarantinedQ) {
            err('H-6: refusing to write ' + block.filePath + ' — skill "' + proposedNameQ + '" is quarantined (H-5 quarantine gate)');
            recordSkillCreated({v:1, ts:new Date().toISOString(), name:proposedNameQ, file:block.filePath, bytes:block?.content?.length, validationPassed:false, symlinked:false, dedup: false, reason:'H-6 quarantine pre-write block: ' + proposedNameQ + ' is quarantined'});
            log('SKIP H-6 quarantine: ' + block.filePath);
            continue;
          }
        } catch (qErr) {
          err('H-6 quarantine scan failed (fail-open): ' + (qErr.message || qErr));
        }
      }
      // ── Stage 2: post-LLM preEmitFilter (2026-06-21) ─────────────────
      // The LLM has decided on a name and emitted a SKILL.md block. Before
      // we write to disk, check the proposed name+description against
      // existing skills via the canonical pre-emit-dedup.mjs filter.
      //   - skip    (similarity ≥ SKIP_THRESHOLD): drop the block, inject
      //              a tool-call result telling the LLM to PATCH the
      //              existing skill instead. This is the dominant case
      //              in the v=2 regen pathology.
      //   - patch   (similarity in [PATCH, SKIP)): proceed (LLM is patching)
      //   - append  (no match / fail-open):       proceed
      // Fail-open: any internal error → allow write (do not block).
      if (!POST_LLM_DEDUP_DISABLED && path.basename(absPath) === 'SKILL.md') {
        try {
          var preEmitFn = await _getPreEmitFilter();
          if (preEmitFn) {
            var proposedName = (extractField(block.content, 'name') || path.basename(dir)).trim();
            var proposedDesc = (extractField(block.content, 'description') || '').trim();
            if (proposedName && proposedDesc) {
              var decision = await preEmitFn(
                { name: proposedName, description: proposedDesc },
                { source: 'skill_reviewer_bot_post_llm' }
              );
              _logPostLlmDedupTelemetry([{
                event: 'post_llm_pre_emit',
                blockFile: block.filePath,
                proposedName,
                action: decision.action,
                reason: decision.reason,
                similarity: decision.similarity,
                matchedSkill: decision.matchedSkill,
              }]);
              if (decision.action === 'skip') {
                err('POST-LLM DEDUP: skipping ' + block.filePath +
                    ' — similar to existing "' + decision.matchedSkill +
                    '" (' + (decision.similarity * 100).toFixed(1) + '%)');
                recordSkillCreated({
                  v: 1,
                  ts: new Date().toISOString(),
                  name: path.basename(dir),
                  file: block.filePath,
                  bytes: block?.content?.length,
                  validationPassed: false,
                  symlinked: false,
                  dedup: true,
                  reason: 'post-llm pre-emit skip: similar to "' + decision.matchedSkill +
                          '" (' + (decision.similarity * 100).toFixed(1) + '%)',
                });
                log('SKIP post-llm-dedup: ' + block.filePath);
                // Inject a tool-call result back to LLM so the next pass
                // knows to PATCH the existing skill instead of creating.
                injectedToolResults.push(
                  "Skill '" + proposedName + "' already exists with high similarity (" +
                  (decision.similarity * 100).toFixed(1) + '% to "' + decision.matchedSkill +
                  '"). PATCH the existing skill at skills-learned/' + decision.matchedSkill +
                  '/SKILL.md instead of creating new.'
                );
                continue;
              }
              // patch / append: proceed to write
            }
          }
        } catch (postLlmErr) {
          // Fail-open: preEmitFilter failure (Ollama down, embeddings cache
          // missing, etc.) must NEVER break the write path.
          err('post-llm preEmitFilter error (fail-open): ' + (postLlmErr.message || postLlmErr));
        }
      }
      // ── QW-3 fix: use validator's composite stub detection ──
      // Previously: pre-write gate only checked file size (<1500B) but post-write
      // validator uses 2-of-3 signals (size / workflow structure / word count).
      // The two checks diverged. Now: run the validator's content check BEFORE
      // writing so we use the SAME criteria as the post-write gate.
      if (path.basename(absPath) === 'SKILL.md') {
        var preResult = validateSkillContent(block.content);
        if (!preResult.valid) {
          err('Refusing to write skill that would fail post-write validation: ' + block.filePath);
          err('  Reasons: ' + preResult?.errors?.join('; '));
          var qDirName = 'quarantine-' + Date.now() + '-' + path.basename(dir);
          var qDir = path.join(WS, 'skills-learned/_archive', qDirName);
          if (!fs.existsSync(qDir)) {
            try {
              fs.mkdirSync(qDir, { recursive: true });
            } catch (e) {
              console.error(`Directory creation failed: ${e.message}`);
            }
          }
          safeWriteFileSync(path.join(qDir, 'SKILL.md'), block.content + '\n');
          recordSkillCreated({v:1, ts:new Date().toISOString(), name:path.basename(dir), file:block.filePath, bytes:block?.content?.length, validationPassed:false, symlinked:false, reason:'pre-write validator fail (QW-3): ' + preResult?.errors?.join('; ')});
          log('Quarantined (pre-validator fail): ' + qDirName);
          continue;
        }
        // Legacy single-signal check (size-only) — kept for backward compat logging
        if (block?.content?.length < PRE_WRITE_STUB_SIZE_MIN) {
          log('NOTE: size < ' + CONFIG.PRE_WRITE_STUB_SIZE_MIN + 'B but composite check passed — allowing write');
        }
      }
      // ── BUG-04 fix (legacy, now superseded by QW-3 above) ──
      // (Old size-only stub check removed — QW-3 uses validator's composite check)
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
          console.error(`Directory creation failed: ${e.message}`);
        }
        log('Created directory: ' + dir.replace(WS, ''));
      }
      // ── BUG-06 fix: atomic write via safeWriteFileSync ──
      // Previously fs.writeFileSync — non-atomic. If bot crashes mid-write, file is
      // left half-written. Now uses tmp + rename for atomic replacement.

      // ── Cross-source dedup (Phase A+, 2026-06-20) ──────────────────────────
      // The local shouldRewrite() check below only compares against THIS file's
      // existing content. It misses duplicates across skills/ (e.g. same skill
      // generated from a different source, or content rewritten with the same
      // semantic intent under a different name). The dedup_gate module computes
      // cosine similarity between the proposed skill name+description and
      // every skill embedding in the workspace. If a similar skill exists
      // above BOT_DEDUP_THRESHOLD, we either warn (default) or skip (strict).
      let crossSourceDup = null;
      if (BOT_DEDUP_MODE !== 'off') {
        try {
          const proposedName = (extractField(block.content, 'name') || path.basename(dir)).trim();
          const proposedDesc = (extractField(block.content, 'description') || '').trim();
          if (proposedName && proposedDesc) {
            // Compute the proposal's embedding on-the-fly (fast, ~200ms for
            // nomic-embed-text). Required because computeDedupWarningsSync
            // returns [] when the proposal isn't in the embeddings cache.
            const proposalText = buildProposalText(proposedName, proposedDesc);
            const proposalVector = await embedWithOllama(proposalText);
            const key = proposalKey(proposedName, proposedDesc);
            const skillEmbeddings = getSkillEmbeddings();
            skillEmbeddings[key] = proposalVector; // inject for this query

            const warnings = computeDedupWarningsSync(proposedName, proposedDesc, {
              threshold: BOT_DEDUP_THRESHOLD,
              skillEmbeddings,
            });
            if (warnings && warnings.length > 0) {
              crossSourceDup = warnings[0]; // highest-scoring match
              log('DEDUP-GATE: ' + proposedName + ' is ' + (crossSourceDup.score * 100).toFixed(1) +
                  '% similar to existing skill "' + crossSourceDup.similarSkill + '"');
              if (BOT_DEDUP_MODE === 'strict') {
                log('DEDUP-GATE: strict mode → skipping write of ' + block.filePath);
                lastWriteDedup.set(absPath, 'duplicate');
                written.push(block.filePath); // count as written for cleanup flow, but didn't actually write
                continue;
              }
              // warn mode: continue to shouldRewrite below; record outcome at end
            }
          }
        } catch (e) {
          // Fail-open: dedup_gate failure must NEVER break the write path
          err('cross-source dedup error (fail-open): ' + (e.message || e));
        }
      }

      // ── Dedup gate: skip write when content is semantically equivalent ──
      // Tracks outcome in `lastWriteDedup` so recordSkillCreated can record
      // 'wrote' vs 'skipped' in the event log for telemetry.
      if (shouldRewrite(absPath, block.content)) {
        safeWriteFileSync(absPath, block.content + '\n');
        log('Wrote: ' + block.filePath);
        if (crossSourceDup) {
          // Track that this was a cross-source duplicate (warn mode wrote anyway)
          lastWriteDedup.set(absPath, 'wrote_duplicate');
        } else {
          lastWriteDedup.set(absPath, 'wrote');
        }
      } else {
        lastWriteDedup.set(absPath, 'skipped');
        log('DEDUP: ' + block.filePath + ' content unchanged, skipping write');
      }
      written.push(block.filePath);

      // ── Internal Automation Bypass (2026-07-14) ──
      // Skills whose names start with one of INTERNAL_AUTOMATION_PREFIXES
      // (cron, email, ha-, bliss, failover, daily-, weekly-, skill-,
      // heartbeat, anomaly, subagent, wiki, memory, llm, connection,
      // pattern) are workspace-internal utilities needed by cron
      // pipelines. They bypass the post-write validator entirely and
      // get direct-symlinked to skills/, regardless of validator
      // outcome.
      //
      // The event is logged with autoApplied:true and
      // reason:'internal-automation' so skill_junk_tracker.js and
      // skill_junk_pause.js can also exclude these skills from junk-rate
      // calculation. This eliminates the false-positive junk-rate
      // inflation that triggered auto-pause on otherwise-healthy cron
      // skill writes.
      //
      // Env kill switch: SKILL_REVIEWER_BYPASS_INTERNAL=0 forces the
      // normal validator path.
      var internalAutoApplied = false;
      var internalBypassReason = '';
      if (
        internalBypassEnabled() &&
        path.basename(absPath) === 'SKILL.md' &&
        block?.filePath?.indexOf('skills-learned/') === 0
      ) {
        var proposedNameIA = (extractField(block.content, 'name') || path.basename(dir)).trim();
        if (isInternalAutomationName(proposedNameIA)) {
          internalAutoApplied = true;
          internalBypassReason = 'internal-automation';
          log('INTERNAL-AUTOMATION: auto-applying ' + block.filePath + ' (bypass validator, direct-symlink)');
        }
      }

      // ── P0 Integrity Gate: validate skill before symlinking ──
      // Reject stubs/truncated skills from being promoted to active skills/.
      // If validation fails, keep the file as draft in skills-learned/ but do
      // NOT create the symlink (which would inject a broken skill into
      // <available_skills> system prompt).
      if (path.basename(absPath) === 'SKILL.md' && block?.filePath?.indexOf('skills-learned/') === 0) {
        var validationPassed = true;
        // Hoist symlinkedActual so it is visible to the unified telemetry
        // block below regardless of validationPassed branch. Default true
        // (matches the historical assumption); flipped to false by the
        // pause / AUTO_APPLY safety nets above.
        var symlinkedActual = true;
        // Internal-automation bypass path: skip validator entirely. Treat as
        // if validationPassed=true (since validator is N/A for internal tools),
        // and proceed straight to symlinking.
        if (internalAutoApplied) {
          log('INTERNAL-AUTOMATION: skipping validator for ' + block.filePath + ' (direct-symlink)');
        } else {
          try {
            var validatorOut = require('child_process').execFileSync(
              'node',
              [path.join(WS, 'scripts/validate_skill_file.js'), absPath],
              { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
            );
            log('Validation OK: ' + block.filePath);
          } catch (valErr) {
            validationPassed = false;
            var stderr = (valErr.stderr ? valErr?.stderr?.toString() : '').trim();
            err('Validation FAILED for ' + block.filePath + ' — keeping as draft, no symlink');
            if (stderr) {
              stderr.split('\n').forEach(function (line) {
                if (line.trim()) err('  ' + line.trim());
              });
            }
          }
        }
        if (validationPassed) {
          // Week 1 Safety Nets (Issue #154) — track actual symlink state.
          // We set symlinkedActual=false when we decide to skip the symlink
          // (paused or AUTO_APPLY=false), so the unified telemetry block
          // below records the correct state. This ensures accurate
          // symlinked:false telemetry without duplicate recordSkillCreated
          // calls.
          // ── Week 1 Safety Net #2: pause state check ──
          // skill_junk_pause.js writes .skill_reviewer_pause.json when 24h junk
          // rate > AUTO_PAUSE_THRESHOLD. If active, skip symlink so junk does
          // not get injected into <available_skills>. Auto-expire when until
          // passes (cron will eventually re-evaluate).
          var pausedHere = false;
          if (fs.existsSync(CONFIG.PAUSE_FILE)) {
            try {
              var pauseState = JSON.parse(fs.readFileSync(CONFIG.PAUSE_FILE, 'utf8'));
              if (Date.now() < pauseState.until) {
                log('PAUSED: skipping symlink for ' + block.filePath + ' (junk rate was ' + pauseState.junkRateAtPause + ' at ' + pauseState.pausedAt + ')');
                written.push(block.filePath); // count as written but NOT symlinked
                symlinkedActual = false;  // recorded by unified telemetry below
                pausedHere = true;
              } else {
                log('Pause expired; resuming normal flow');
                try { fs.unlinkSync(CONFIG.PAUSE_FILE); } catch (e) {}
              }
            } catch (pauseParseErr) {
              err('Failed to read pause state: ' + pauseParseErr.message);
            }
          }
          if (!pausedHere) {
            // ── Week 1 Safety Net #1: AUTO_APPLY env override ──
            // SKILL_REVIEWER_AUTO_APPLY=false → keep as draft, no symlink.
            // Gives Josh a kill switch without code changes.
            if (!CONFIG.AUTO_APPLY) {
              log('AUTO_APPLY=false: skipping symlink for ' + block.filePath + ' (kept as draft)');
              written.push(block.filePath);
              symlinkedActual = false;  // recorded by unified telemetry below
            } else {
              // ── P0 Quarantine Gate: block symlink for quarantined skills ──
              // email-analysis-cantonese was quarantined but cron re-created it and
              // auto-applied it anyway. This gate stops any quarantined skill from
              // being promoted to active skills/ regardless of validation outcome.
              // Mirror of scanQuarantinedSkills() from skill_junk_tracker.js.
              var skillNameQu = path.basename(dir);
              var quarantineBlocked = false;
              try {
                var quarantineRoot = path.join(WS, 'skills-learned/_archive');
                if (fs.existsSync(quarantineRoot)) {
                  var quarantineNames = new Set();
                  var qTop = fs.readdirSync(quarantineRoot, { withFileTypes: true });
                  for (var qi = 0; qi < qTop.length; qi++) {
                    var qEntry = qTop[qi];
                    if (!qEntry.isDirectory()) continue;
                    var qTopName = qEntry.name;
                    if (qTopName === 'failed-validations') {
                      var fvSubs = fs.readdirSync(path.join(quarantineRoot, qTopName), { withFileTypes: true });
                      for (var fi = 0; fi < fvSubs.length; fi++) {
                        if (fvSubs[fi].isDirectory()) {
                          quarantineNames.add(fvSubs[fi].name.replace(/-\d{8,}$/, ''));
                        }
                      }
                    } else if (qTopName.startsWith('quarantine-')) {
                      var qSubs = fs.readdirSync(path.join(quarantineRoot, qTopName), { withFileTypes: true });
                      var qSubdirs = qSubs.filter(function (s) { return s.isDirectory(); });
                      if (qSubdirs.length > 0) {
                        for (var qi2 = 0; qi2 < qSubdirs.length; qi2++) {
                          quarantineNames.add(qSubdirs[qi2].name);
                        }
                      } else {
                        var qm = qTopName.match(/^quarantine-[\d-]+-(.+)$/);
                        if (qm) quarantineNames.add(qm[1]);
                      }
                    }
                  }
                  if (quarantineNames.has(skillNameQu)) {
                    quarantineBlocked = true;
                    log('QUARANTINE: skipping symlink for ' + block.filePath + ' (skill is quarantined — manual review required)');
                    written.push(block.filePath);
                    symlinkedActual = false;
                  }
                }
              } catch (quarantineScanErr) {
                err('Quarantine scan failed (allow symlink): ' + quarantineScanErr.message);
              }
              if (!quarantineBlocked) {
                if (!shouldSymlinkSkill(block.content)) {
                  // ── M1 recall-quality gate: do not symlink draft/manual skills ──
                  // Filtering only downstream in skill_discovery.js is insufficient;
                  // the filesystem state must also match AGENTS.md recall rules.
                  log('Recall gate: skipping symlink for ' + block.filePath + ' (draft/manual)');
                  // Also remove any pre-existing symlink from a previous active version.
                  try {
                    var recallClassName = path.basename(dir);
                    var recallStaleSymlinkPath = path.join(SKILLS_ACTIVE, '_learned_' + recallClassName);
                    if (fs.existsSync(recallStaleSymlinkPath) || isBrokenSymlink(recallStaleSymlinkPath)) {
                      try { fs.unlinkSync(recallStaleSymlinkPath); } catch (e) { throw e; }
                      log('Removed stale symlink (now draft/manual): ' + recallStaleSymlinkPath.replace(WS, ''));
                    }
                  } catch (recallUnlinkErr) {
                    err('Failed to remove stale symlink for ' + path.basename(dir) + ': ' + recallUnlinkErr.message);
                  }
                  written.push(block.filePath);
                  symlinkedActual = false;
                } else {
                  // ── QW3: Symlink instant-create to skills/ (idempotent) ──
                  // Solves 7-day latency: new skills in skills-learned/ are immediately
                  // discoverable via a symlink in skills/, no need to wait for the
                  // weekly_correction_loop migration. Use _learned_ prefix (matches
                  // weekly_correction_loop.js convention) to avoid duplicate detection
                  // when listCategorizedSkills scans both skills/ and skills-learned/.
                  try {
                    var className = path.basename(dir);
                    var symlinkPath = path.join(SKILLS_ACTIVE, '_learned_' + className);
                    // P1-6: clean up broken symlink before re-creating
                    if (isBrokenSymlink(symlinkPath)) {
                      try { fs.unlinkSync(symlinkPath); } catch (e) { throw e; }
                      log('Removed broken symlink: ' + symlinkPath.replace(WS, ''));
                    }
                    if (!fs.existsSync(symlinkPath)) {
                      // ── WARN-05 fix: normalize symlink target to absolute path ──
                      // Defensive: even though `dir` is normally already absolute
                      // (path.dirname(path.join(WS, block.filePath))), historical
                      // 3 relative symlinks in skills/_learned_* still exist from
                      // before WS was always absolute. Future-proof by resolving
                      // any non-absolute target against WS before symlinking.
                      var absTarget = path.isAbsolute(dir) ? dir : path.resolve(WS, dir);
                      fs.symlinkSync(absTarget, symlinkPath, 'dir');
                      log('Symlinked: skills/_learned_' + className + ' -> ' + absTarget.replace(WS, ''));
                    }
                  } catch (symErr) {
                    if (symErr.code !== 'EEXIST') {
                      err('Symlink failed for ' + className + ': ' + symErr.message);
                    }
                  }
                }
              }
            }
          }
        } else {
          // Validation failed: file moved to failed-validations/ and stale
          // symlink removed (H-1). Symlink state is false.
          symlinkedActual = false;
          // ── H-1 fix: Remove stale symlink on validation failure ──
          // If a previous valid version of this skill had a symlink in skills/,
          // an UPDATE that just wrote flawed content would leave the symlink
          // pointing at the new (broken) file, polluting <available_skills>.
          // Unlink it so the bad content does not get injected into the
          // system prompt.
          try {
            var failClassName = path.basename(dir);
            var staleSymlinkPath = path.join(SKILLS_ACTIVE, '_learned_' + failClassName);
            if (fs.existsSync(staleSymlinkPath) || isBrokenSymlink(staleSymlinkPath)) {
              try { fs.unlinkSync(staleSymlinkPath); } catch (e) { throw e; }
              log('WARN', 'Removed stale symlink: ' + staleSymlinkPath);
            }
          } catch (symUnlinkErr) {
            err('Failed to remove stale symlink for ' + path.basename(dir) + ': ' + symUnlinkErr.message);
          }
          // ── H-2 fix: Quarantine failed SKILL.md ──
          // Move the just-written (now known-bad) SKILL.md to a
          // failed-validations archive so the LLM's bad content is preserved
          // for inspection without staying in skills-learned/ where it could
          // be re-promoted on the next run. Mirrors the pre-write stub
          // quarantine pattern (BUG-04) but uses 'failed-validations/' to
          // distinguish the two failure modes.
          try {
            var qClassName = path.basename(dir);
            var failQDir = path.join(WS, 'skills-learned/_archive/failed-validations', qClassName + '-' + Date.now());
            if (!fs.existsSync(failQDir)) {
              try { fs.mkdirSync(failQDir, { recursive: true }); } catch (e) { throw e; }
            }
            try { fs.renameSync(absPath, path.join(failQDir, 'SKILL.md')); } catch (e) { throw e; }
            log('Quarantined failed validation: ' + path.relative(WS, failQDir));
          } catch (qErr) {
            err('Failed to quarantine ' + block.filePath + ': ' + qErr.message);
          }
        }

        // ── skill_created event tracking ──
        // Append-only JSONL event for quality trend telemetry. Tracks
        // pitfalls count, workflow steps, validation outcome, symlink state.
        // See .skill_created.jsonl — separate from .skill_metrics.json (run-level).
        try {
          // H-2 may have moved SKILL.md to failed-validations/ — statSync would
          // then throw. Default to 0 bytes so the failure case still records a
          // telemetry event with accurate validationPassed/symlinked fields.
          var fileBytes = 0;
          try { fileBytes = fs.statSync(absPath).size; } catch (statErr) { /* quarantined */ }
          var content = block.content;
          // Count pitfalls: top-level bullets under "## Pitfalls" section.
          // Use line-anchored header (^## Pitfalls) to avoid false matches when
          // "## Pitfalls" is mentioned inside backticks/code blocks earlier in
          // the file. Take the LAST line-anchored header (real section is at
          // the end; earlier mentions are template/text references).
          // Accept both bold (**) and plain bullets — many skills use plain text.
          // ── WARN-06 follow-up #172 fix: also accept H3 (`### Pitfalls`) and
          // bold (`**Pitfalls:**`) headings. Same canonical regex as
          // validate_skill_file.js line 99 + skill_pitfalls_fallback.js line 65.
          var pitHeaders = content.match(/^(?:#{1,3}\s+|\*\*)Pitfalls:?\s*(?:\*\*)?$/gim);
          var pitfallsCount = 0;
          if (pitHeaders) {
            var lastHeader = pitHeaders[pitHeaders.length - 1];
            var lastIdx = content.lastIndexOf(lastHeader);
            var startIdx = lastIdx + lastHeader.length;
            var rest = content.slice(startIdx);
            // ── WARN-06 follow-up #172 fix: accept H2/H3/bold as next-section marker ──
            var nextH2 = rest.match(/^(?:#{1,3}\s+|\*\*)[^*\n]/m);
            var pitfallsBody = nextH2 ? rest.slice(0, nextH2.index) : rest;
            // Strip code blocks so bullets inside ```...``` are not counted
            pitfallsBody = pitfallsBody.replace(/```[\s\S]*?```/g, '');
            // ── BUG-03 fix: use the same pitfalls regex as validate_skill_file.js ──
            // The previous regex `/^- (?:⚠️?\s*)?\S/gm` only matched plain bullets
            // and missed H3-prefixed pitfalls (`### ⚠️ foo` / `### 1. foo`) that
            // the H-3 validator fix started accepting. Skills that pass H-3 with
            // H3-prefixed pitfalls would be recorded with pitfallsCount=0 here,
            // making trending data inaccurate. Use the unified pattern that
            // matches both plain bullets and H3-prefixed pitfalls.
            pitfallsCount = (pitfallsBody.match(/^(?:- (?:⚠️?\s*)?|###\s+(?:\d+\.\s+)?(?:⚠️?\s*)?)\S/gm) || []).length;
          }
          // Count workflow steps: numbered list under "## Workflow" section
          var stepsMatch = content.match(/## Workflow[^\n]*\n([\s\S]*?)(?=\n## |\s*$)/);
          var workflowSteps = stepsMatch
            ? (stepsMatch[1].match(/^(?:#{1,3}\s+)?\s*\d+\.\s+/gm) || []).length
            : 0;
          // Use symlinkedActual (computed by safety nets above) instead of
          // assuming validationPassed==symlinked. The pause and AUTO_APPLY
          // cases set symlinkedActual=false even when validationPassed=true.
          // Internal-automation bypass telemetry: include autoApplied + reason
          // so skill_junk_tracker.js and skill_junk_pause.js can correctly
          // exclude these events from junk-rate calculation. Without these
          // fields, downstream consumers would see validationPassed=true
          // passthroughs as regular writes and could double-count.
          var recordEvent = {
            v: 1,
            ts: new Date().toISOString(),
            name: path.basename(dir),
            file: block.filePath,
            bytes: fileBytes,
            pitfallsCount: pitfallsCount,
            workflowSteps: workflowSteps,
            validationPassed: validationPassed,
            symlinked: symlinkedActual,
            dedup: lastWriteDedup.has(absPath) ? lastWriteDedup.get(absPath) : 'wrote'
          };
          if (internalAutoApplied) {
            recordEvent.autoApplied = true;
            recordEvent.reason = (recordEvent.reason ? recordEvent.reason + '; ' : '') + 'internal-automation';
          }
          recordSkillCreated(recordEvent);
        } catch (telemetryErr) {
          err('skill_created telemetry failed: ' + telemetryErr.message);
        }
      }
    } catch (e) {
      err('Failed to write ' + block.filePath + ': ' + e.message);
      // ── WARN-01 fix: record failed write in JSONL audit trail ──
      // Without this, failed writes (disk full, EACCES) leave no trace.
      try {
        recordSkillCreated({v:1, ts:new Date().toISOString(), name:path.basename(dir), file:block.filePath, bytes:block?.content?.length, validationPassed:false, symlinked:false, reason:'write failed: ' + e.code || e.message});
      } catch (auditErr) {
        err('Audit trail also failed: ' + auditErr.message);
      }
    }
  }
  return { written, injectedToolResults };
}

// ── S1 mismatch escalation (Phase 1) ──
// Surgical add for Step 1: 0-token mismatch detector. Looks up a skill
// in .skill_created.jsonl (filter: validationPassed=true AND symlinked=true),
// quarantines the source + symlink, and writes history/alert logs.
// No LLM judge call (deferred to Step 2 shadow mode).

function parseMarkMismatchArgs(args) {
  var name = null;
  var reason = '';
  var dryRun = false;
  var showHelp = false;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--help' || a === '-h') showHelp = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--reason' || a === '-r') {
      reason = args[++i] || '';
    } else if (a.indexOf('--reason=') === 0) {
      reason = a.slice('--reason='.length);
    } else if (a.indexOf('-r=') === 0) {
      reason = a.slice(3);
    } else if (name === null) name = a;
    else throw new Error('Unknown argument: ' + a);
  }
  return { name: name, reason: reason, dryRun: dryRun, showHelp: showHelp };
}

function findSkillCreatedEvent(name) {
  if (!fs.existsSync(SKILL_CREATED_LOG)) return null;
  let lines;
  try {
    lines = fs.readFileSync(SKILL_CREATED_LOG, 'utf8').split('\n');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  var latest = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try {
      var ev = JSON.parse(line);
      if (ev.name === name && ev.validationPassed === true && ev.symlinked === true) {
        if (!latest || (ev.ts && ev.ts > latest.ts)) latest = ev;
      }
    } catch (e) { /* skip malformed */ }
  }
  return latest;
}

function writeS1MismatchEvent(event) {
  try {
    fs.appendFileSync(S1_MISMATCH_HISTORY_LOG, JSON.stringify(event) + '\n', 'utf8');
    return true;
  } catch (e) {
    err('s1_mismatch_history write failed: ' + e.message);
    return false;
  }
}

function writeS1Alert(alert) {
  try {
    fs.appendFileSync(S1_ALERTS_LOG, JSON.stringify(alert) + '\n', 'utf8');
    return true;
  } catch (e) {
    err('s1_alerts write failed: ' + e.message);
    return false;
  }
}

function quarantineSkillS1(name, reason, dryRun) {
  var srcDir = path.join(WS, 'skills-learned', name);
  var symlinkPath = path.join(SKILLS_ACTIVE, '_learned_' + name);
  var dateStr = new Date().toISOString().slice(0, 10);
  var qParent = path.join(SKILLS_ACTIVE, '_archive', 's1-mismatch-' + dateStr);
  var qDest = path.join(qParent, name);
  var actions = [];
  if (dryRun) {
    actions.push(fs.existsSync(symlinkPath) ? 'would-remove-symlink: ' + symlinkPath : 'WARN: symlinkPath not found: ' + symlinkPath);
    actions.push(fs.existsSync(srcDir) ? 'would-move: ' + srcDir + ' -> ' + qDest : 'WARN: source not found: ' + srcDir);
    return { ok: true, actions: actions, qDest: qDest, symlinkPath: symlinkPath, srcDir: srcDir };
  }
  // 1. Remove symlink (best effort — may already be gone)
  try {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
      actions.push('removed symlink: ' + symlinkPath);
    } else {
      actions.push('WARN: symlinkPath not found (already removed?): ' + symlinkPath);
    }
  } catch (symErr) {
    actions.push('ERROR: failed to remove symlink: ' + symErr.message);
  }
  // 2. Move source to archive
  try {
    if (fs.existsSync(srcDir)) {
      if (!fs.existsSync(qParent)) {
        fs.mkdirSync(qParent, { recursive: true });
        actions.push('created archive dir: ' + qParent);
      }
      if (fs.existsSync(qDest)) {
        qDest = path.join(qParent, name + '-' + Date.now());
        actions.push('WARN: dest exists, renaming to: ' + qDest);
      }
      try { fs.renameSync(srcDir, qDest); } catch (e) { throw e; }
      actions.push('moved: ' + srcDir + ' -> ' + qDest);
    } else {
      actions.push('WARN: source not found: ' + srcDir);
    }
  } catch (mvErr) {
    actions.push('ERROR: failed to move source: ' + mvErr.message);
    return { ok: false, actions: actions, qDest: qDest, symlinkPath: symlinkPath, srcDir: srcDir };
  }
  return { ok: true, actions: actions, qDest: qDest, symlinkPath: symlinkPath, srcDir: srcDir };
}

async function markMismatchHandler(args) {
  var parsed;
  try {
    parsed = parseMarkMismatchArgs(args);
  } catch (e) {
    err('ERROR: ' + e.message);
    printMarkMismatchHelp();
    return 2;
  }
  if (parsed.showHelp) {
    printMarkMismatchHelp();
    return 0;
  }
  if (parsed.name === null) {
    printMarkMismatchHelp();
    return 2;
  }
  log('S1 mismatch escalation: looking up event for name=' + parsed.name);
  var ev = findSkillCreatedEvent(parsed.name);
  if (!ev) {
    err('No matching skill_created event found for name="' + parsed.name + '" with validationPassed=true AND symlinked=true.');
    err('Refusing to mark mismatch — this skill was either never validated as passed+symlinked, or the event log is missing.');
    return 3;
  }
  log('Found event: ts=' + ev.ts + ', file=' + ev.file + ', bytes=' + ev.bytes);
  var result = quarantineSkillS1(parsed.name, parsed.reason, parsed.dryRun);
  var timestamp = new Date().toISOString();
  var event = {
    v: 1,
    ts: timestamp,
    name: parsed.name,
    reason: parsed.reason || '(no reason given)',
    dryRun: parsed.dryRun,
    sourceFile: ev.file,
    sourceBytes: ev.bytes,
    sourceTs: ev.ts,
    qDest: result.qDest,
    symlinkPath: result.symlinkPath,
    srcDir: result.srcDir,
    actions: result.actions,
    ok: result.ok
  };
  if (result.ok) {
    log('S1 mismatch quarantine complete:');
    result?.actions?.forEach(function (a) { log('  - ' + a); });
    log('Archived to: ' + result.qDest);
  } else {
    err('S1 mismatch quarantine FAILED:');
    result?.actions?.forEach(function (a) { err('  - ' + a); });
  }
  writeS1MismatchEvent(event);
  if (!parsed.dryRun && result.ok) {
    var alert = {
      v: 1,
      ts: timestamp,
      severity: 'warning',
      kind: 's1_mismatch',
      name: parsed.name,
      reason: parsed.reason || '(no reason given)',
      qDest: result.qDest,
      sourceFile: ev.file
    };
    writeS1Alert(alert);
    log('Alert written to ' + path.relative(WS, S1_ALERTS_LOG));
  } else if (parsed.dryRun) {
    log('(dry-run: skipping alert)');
  }
  return result.ok ? 0 : 1;
}

function printMarkMismatchHelp() {
  console.log('Usage: node scripts/skill_reviewer_bot.js mark-mismatch <name> [--reason "..."] [--dry-run]');
  console.log('');
  console.log('  Mark a skill that passed validation+symlink as a S1 mismatch (false positive).');
  console.log('  The skill will be:');
  console.log('    1. Symlink removed from skills/_learned_<name>');
  console.log('    2. Source moved from skills-learned/<name>/ to skills/_archive/s1-mismatch-YYYY-MM-DD/<name>/');
  console.log('    3. Event logged to .s1_mismatch_history.jsonl');
  console.log('    4. Alert written to .s1_alerts.jsonl (skipped on --dry-run)');
  console.log('');
  console.log('Options:');
  console.log('  --reason "..."   Free-text reason for the mismatch (recommended)');
  console.log('  --dry-run        Show actions without modifying filesystem');
  console.log('  --help, -h       Show this help');
  console.log('');
  console.log('Exit codes:');
  console.log('  0  success (or dry-run)');
  console.log('  1  quarantine failed');
  console.log('  2  bad arguments');
  console.log('  3  no matching skill_created event (refused)');
}

// ── Main ──

/**
 * Startup self-healing: remove active symlinks that point to skills which are
 * now draft, archived, manual, or disabled. This prevents stale links from
 * leaking into the recall pool when a skill is demoted outside the normal
 * write-symlink code path (e.g. manual edit or weekly curation).
 */
function cleanupStaleSymlinks() {
  try {
    if (!fs.existsSync(SKILLS_ACTIVE)) return;
    const links = fs.readdirSync(SKILLS_ACTIVE).filter(f => f.startsWith('_learned_'));
    let removed = 0;
    for (const link of links) {
      const symlinkPath = path.join(SKILLS_ACTIVE, link);
      const target = fs.readlinkSync(symlinkPath);
      const name = link.replace('_learned_', '');
      const skillPath = path.join(WS, 'skills-learned', name, 'SKILL.md');
      let shouldRemove = false;
      let reason = '';
      if (!fs.existsSync(skillPath)) {
        shouldRemove = true;
        reason = 'target missing';
      } else {
        try { var content = fs.readFileSync(skillPath, 'utf8'); } catch (e) { throw e; }
        if (!shouldSymlinkSkill(content)) {
          shouldRemove = true;
          reason = 'shouldSymlinkSkill()=false';
        }
      }
      if (shouldRemove) {
        try {
          fs.unlinkSync(symlinkPath);
          removed++;
          log('Self-healing: removed stale symlink ' + link + ' (' + reason + ')');
        } catch (e) {
          err('Self-healing: failed to remove stale symlink ' + link + ': ' + e.message);
        }
      }
    }
    if (removed > 0) {
      log('Self-healing: removed ' + removed + ' stale symlink(s)');
    }
  } catch (e) {
    err('Self-healing symlink cleanup failed: ' + e.message);
  }
}

// ── LLM call helper (used by main() and the Stage 2 follow-up loop) ──

/**
 * Call the LLM via `openclaw infer model run` with the configured fallback
 * chain. Returns { text, model, durationMs } on success or { error, lastError }
 * on failure. Never throws — caller decides whether to abort or fall through.
 *
 * Test seam: SKILL_REVIEWER_BOT_LLM_STUB=1 short-circuits the real CLI and
 * reads a canned response from SKILL_REVIEWER_BOT_LLM_STUB_TEXT. Used by
 * the B-1 unit test to exercise the follow-up loop without invoking the
 * real LLM. NOT for production use.
 */
async function callLlm(promptText) {
  // Test seam (see comment above)
  if (process.env.SKILL_REVIEWER_BOT_LLM_STUB === '1') {
    return _callLlmStub(promptText);
  }
  var modelsToTry = [MODEL].concat(MODEL_FALLBACKS);
  var stdout = null;
  var lastError = null;
  var startedAt = Date.now();
  for (var mi = 0; mi < modelsToTry.length; mi++) {
    var currentModel = modelsToTry[mi];
    if (mi > 0) {
      log('Fallback to ' + currentModel + '...');
    }
    try {
      stdout = execFileSync(OPENCLAW_CLI, [
        'infer', 'model', 'run',
        '--model', currentModel,
        '--prompt', promptText,
        '--json'
      ], {
        timeout: TIMEOUT_MS,
        maxBuffer: CONFIG.MAX_BUFFER_BYTES,
        encoding: 'utf8',
        env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' })
      });
      break;
    } catch (e) {
      lastError = e;
      var isRateLimit = e?.message?.indexOf('429') !== -1 || e?.message?.indexOf('rate_limit') !== -1 || e?.message?.indexOf('usage limit') !== -1;
      var isOverload = e?.message?.indexOf('overloaded') !== -1;
      var is5xx = /\b5\d{2}\b/.test(e.message);
      var isNetError = e?.message?.indexOf('ETIMEDOUT') !== -1 || e?.message?.indexOf('ECONNRESET') !== -1 || e?.message?.indexOf('ENOTFOUND') !== -1 || e?.message?.indexOf('EAI_AGAIN') !== -1;
      if (isRateLimit || isOverload || is5xx || isNetError) {
        var reason = isRateLimit ? 'rate limit' : isOverload ? 'overload' : is5xx ? '5xx' : 'net';
        log(currentModel + ' unavailable (' + reason + '), trying next...');
        continue;
      }
      return { error: e.message || 'unknown_llm_error', lastError: e };
    }
  }
  if (!stdout) {
    return { error: 'all_models_exhausted', lastError };
  }
  var elapsed = ((Date.now() - startedAt) / CONFIG.ELAPSED_MS_DIVISOR).toFixed(1);
  log('LLM responded in ' + elapsed + 's');
  var output = stdout.toString();
  var jsonStart = output.indexOf('{');
  if (jsonStart === -1) return { error: 'no_json_in_output' };
  var parsed;
  try {
    parsed = JSON.parse(output.slice(jsonStart));
  } catch (e) {
    return { error: 'json_parse_failed: ' + e.message };
  }
  var outputs = parsed.outputs || [];
  if (!outputs.length || !outputs[0].text) return { error: 'no_text_output' };
  return { text: outputs[0].text.trim(), durationMs: Date.now() - startedAt };
}

/**
 * Test stub. Reads responses from SKILL_REVIEWER_BOT_LLM_STUB_TEXT (one
 * JSON response per call, FIFO separated by `\n---NEXT---\n`), or returns
 * an error if the env var SKILL_REVIEWER_BOT_LLM_STUB_ERROR is set to a
 * non-empty value. Used by the B-1 unit test.
 */
function _callLlmStub(promptText) {
  var errMsg = process.env.SKILL_REVIEWER_BOT_LLM_STUB_ERROR;
  if (errMsg) {
    return Promise.resolve({ error: errMsg });
  }
  var stub = process.env.SKILL_REVIEWER_BOT_LLM_STUB_TEXT || '';
  if (!stub) {
    return Promise.resolve({ error: 'stub_empty' });
  }
  var parts = stub.split('\n---NEXT---\n');
  var first = parts.shift();
  process.env.SKILL_REVIEWER_BOT_LLM_STUB_TEXT = parts.length > 0 ? parts.join('\n---NEXT---\n') : '';
  try {
    var parsed = JSON.parse(first);
    var out = parsed.outputs && parsed.outputs[0] && parsed.outputs[0].text;
    if (!out) return Promise.resolve({ error: 'stub_no_text' });
    return Promise.resolve({ text: out, durationMs: 1 });
  } catch (e) {
    return Promise.resolve({ error: 'stub_json_parse: ' + e.message });
  }
}

// ── Stage 2 follow-up loop ──

/**
 * Build a follow-up prompt that re-injects the original prompt along with
 * the Stage 2 skip messages. The LLM sees:
 *   "Your previous attempt would have created X but it already exists at
 *    skills-learned/<matchedSkill>/SKILL.md with similarity Y. Either
 *    PATCH the existing skill or emit a structured SKIP marker."
 */
function buildFollowupPrompt(originalPrompt, injectedToolResults, existingFiles) {
  var injectBlock = injectedToolResults.map(function (msg, i) {
    return '[Tool result ' + (i + 1) + '/' + injectedToolResults.length + ']\n' + msg;
  }).join('\n\n');
  var existingBlock = '';
  if (existingFiles && Object.keys(existingFiles).length > 0) {
    existingBlock = '\n\nExisting skill files on disk (read these before PATCHing):\n' +
      Object.keys(existingFiles).filter(function (k) { return existingFiles[k]; }).map(function (k) { return '- ' + k; }).join('\n');
  }
  return [
    '--- ORIGINAL PROMPT ---',
    originalPrompt,
    '--- POST-LLM DEDUP INJECT ---',
    'Your previous response attempted to create skill(s) that already exist in this workspace.',
    'For each inject message below, you MUST either:',
    '  (a) PATCH the existing skill at the indicated path (emit a SKILL.md block targeting the existing filePath, preserving the existing frontmatter and adding the new content); OR',
    '  (b) Emit a structured SKIP marker: a JSON block `{"action":"skip","reason":"<short>"}` wrapped in a `<!-- skill-reviewer-bot:skip -->` comment — this signals you have acknowledged the inject and intentionally chose not to write.',
    'Do NOT recreate the same skill under a different name. Do NOT emit an empty file. Either PATCH or SKIP.',
    existingBlock,
    injectBlock
  ].filter(Boolean).join('\n\n');
}

/**
 * Stage 2 follow-up loop. When writeSkillFiles() produced inject messages
 * (Stage 2 SKIPs), call the LLM again with a follow-up prompt that includes
 * the inject context. Bound: max STAGE_2_FOLLOWUP_MAX_CALLS follow-up calls
 * and STAGE_2_FOLLOWUP_TIME_BUDGET_MS total time. Returns updated
 * { filesWritten, postLlmInjectedResults, followupCalls }.
 *
 * Fail-open: if any LLM call fails, log telemetry and stop — the original
 * veto is preserved (we never re-write a SKIPped block as a CREATE).
 */
async function runFollowupLoop(initialCtx, filesWritten, postLlmInjectedResults, existingFiles, opts = {}) {
  var t0 = Date.now();
  var followupCalls = 0;
  var stillInjected = postLlmInjectedResults.slice();
  var totalNewWrites = 0;
  // Medium-1 (2026-06-21): track the actual exit reason so the followup_summary
  // telemetry can distinguish LLM errors / parse errors / max calls / time
  // budget. Previously the summary used a binary heuristic that mislabelled
  // LLM/parse errors as 'time_budget_exhausted' whenever followupCalls < MAX_CALLS.
  var abortedReason = null;
  var followupCompleted = false;
  // Initial context for follow-up prompts
  var promptContext = {
    originalPrompt: initialCtx.prompt,
    gates: initialCtx.gates,
  };
  while (stillInjected.length > 0 && followupCalls < STAGE_2_FOLLOWUP_MAX_CALLS) {
    var elapsedMs = Date.now() - t0;
    if (elapsedMs >= STAGE_2_FOLLOWUP_TIME_BUDGET_MS) {
      log('STAGE_2_FOLLOWUP: time budget exhausted (' + elapsedMs + 'ms >= ' + STAGE_2_FOLLOWUP_TIME_BUDGET_MS + 'ms) — accepting original vetoes');
      _logFollowupTelemetry({
        event: 'followup_aborted',
        reason: 'time_budget_exhausted',
        elapsedMs,
        followupCalls,
        stillInjectedCount: stillInjected.length,
      });
      abortedReason = 'time_budget_exhausted';
      break;
    }
    // Medium-3 (2026-06-21): backoff between follow-up LLM calls to avoid
    // bursting the rate limit (DeepSeek 5/min). Tunable via env.
    if (followupCalls > 0) {
      var backoffMs = Number(process.env.STAGE_2_FOLLOWUP_BACKOFF_MS) || 7000;
      if (backoffMs > 0) {
        log('STAGE_2_FOLLOWUP: backoff ' + backoffMs + 'ms before call ' + (followupCalls + 1));
        await new Promise(function (r) { setTimeout(r, backoffMs); });
      }
    }
    followupCalls++;
    log('STAGE_2_FOLLOWUP: call ' + followupCalls + '/' + STAGE_2_FOLLOWUP_MAX_CALLS +
        ' (stillInjected=' + stillInjected.length + ', elapsed=' + elapsedMs + 'ms)');
    var followupPrompt = buildFollowupPrompt(promptContext.originalPrompt, stillInjected, existingFiles);
    var followupResult = await callLlm(followupPrompt);
    if (followupResult.error) {
      log('STAGE_2_FOLLOWUP: LLM error on call ' + followupCalls + ' (fail-open, accepting original vetoes): ' + followupResult.error);
      _logFollowupTelemetry({
        event: 'followup_llm_error',
        error: followupResult.error,
        followupCalls,
        stillInjectedCount: stillInjected.length,
        elapsedMs: Date.now() - t0,
      });
      abortedReason = 'followup_llm_error';
      break;
    }
    // Parse response
    var fuExtract = extractFileBlocks(followupResult.text);
    if (fuExtract.error) {
      log('STAGE_2_FOLLOWUP: extractFileBlocks error: ' + fuExtract.error + ' (stopping loop)');
      _logFollowupTelemetry({
        event: 'followup_parse_error',
        error: fuExtract.error,
        followupCalls,
        elapsedMs: Date.now() - t0,
      });
      abortedReason = 'followup_parse_error';
      break;
    }
    var fuBlocks = fuExtract.files || [];
    // Apply the same hard gate filter (stable / cooldown)
    var fuGateResult = filterBlocksByGates(fuBlocks, promptContext.gates);
    fuBlocks = fuGateResult.filtered;
    if (fuBlocks.length === 0) {
      log('STAGE_2_FOLLOWUP: LLM emitted SKIP marker or 0 blocks after gates — accepting original vetoes');
      _logFollowupTelemetry({
        event: 'followup_llm_skipped',
        followupCalls,
        elapsedMs: Date.now() - t0,
        stillInjectedCount: stillInjected.length,
      });
      // LLM chose to SKIP — clear the stillInjected list to stop the loop
      stillInjected = [];
      followupCompleted = true;
      break;
    }
    // Write the follow-up blocks. writeSkillFiles will run Stage 2 again,
    // which may produce new inject messages (e.g. PATCHing a different skill).
    var fuWrite = await writeSkillFiles(fuBlocks);
    var fuWritten = Array.isArray(fuWrite) ? fuWrite : (fuWrite && fuWrite.written) || [];
    var fuNewInjected = (fuWrite && fuWrite.injectedToolResults) || [];
    totalNewWrites += fuWritten.length;
    filesWritten = filesWritten.concat(fuWritten);
    log('STAGE_2_FOLLOWUP: wrote ' + fuWritten.length + ' of ' + fuBlocks.length + ' block(s)' +
        (fuNewInjected.length > 0 ? ' (still ' + fuNewInjected.length + ' injected)' : ''));
    // If follow-up still produces inject messages, the loop continues until
    // either LLM SKIPs, max calls hit, or time runs out.
    stillInjected = fuNewInjected;
  }
  // If the loop exited naturally (stillInjected exhausted, e.g. follow-up
  // wrote files with no new injects), mark as completed. If stillInjected
  // is non-empty at this point, the loop must have hit the max-calls bound.
  if (!followupCompleted && stillInjected.length === 0) {
    followupCompleted = true;
  }
  if (!followupCompleted && !abortedReason && followupCalls >= STAGE_2_FOLLOWUP_MAX_CALLS) {
    abortedReason = 'max_calls_reached';
  }
  var finalElapsedMs = Date.now() - t0;
  _logFollowupTelemetry({
    event: 'followup_summary',
    runId: opts.runId || null,
    originalBlockCount: opts.originalBlockCount || (filesWritten.length + postLlmInjectedResults.length - (postLlmInjectedResults.length - stillInjected.length)),
    skippedCount: postLlmInjectedResults.length - stillInjected.length,
    followupCalls,
    finalBlockCount: totalNewWrites,
    stillInjectedCount: stillInjected.length,
    elapsedMs: finalElapsedMs,
    abortedReason: followupCompleted ? 'completed' : abortedReason,
  });
  return {
    filesWritten: filesWritten,
    postLlmInjectedResults: stillInjected, // remaining injects (if any) — for logging
    followupCalls: followupCalls,
  };
}

// P3 label-spam check (Sub-2 fix): exported for backfill script.
// Detects injected "Use when:" / "Key capabilities:" markers added by M1.4 prompt
// to skills that didn't originally have them — pollutes catalog with generic boilerplate.
var _validateSkillContent = require('./validate_skill_file').validateSkillContent;
function validateSkillContentStrict(content) {
  var errors = _validateSkillContent(content);
  var body = content.replace(/^---[\s\S]*?---\n/, '');
  var labelSpamRegex = /\.\s*(Use\s+when|Apply\s+when|Key\s+capabilities|Capabilities|When\s+to\s+use)\s*:[\s\S]*?\.(?=\s+[A-Z]|$)/gi;
  var matches = body.match(labelSpamRegex) || [];
  if (matches.length > 0) {
    errors.push('P3 label-spam detected: ' + matches.length + ' instance(s) — strip "' + matches[0].slice(0, 40) + '..."');
  }
  return errors;
}

async function main() {
  // P0-1: Lock self-heal — if lock dir is stale (>30min), remove before acquire.
  // Protects against SIGKILL/OOM leaving a permanent lock that silently skips all runs.
  const LOCK_MAX_AGE_MS = 30 * CONFIG.MS_PER_MINUTE;
  try {
    const st = fs.statSync(LOCK_DIR);
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs > LOCK_MAX_AGE_MS) {
      log('Stale lock detected (age: ' + Math.round(ageMs / CONFIG.MS_PER_MINUTE) + ' min) — auto-removing');
      fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    }
  } catch (e) {
    // No lock exists — proceed normally
  }
  // Lock (mkdir as mutex — atomic directory creation)
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: false });
  } catch (e) {
    log('Already running (lock exists). Skipping.');
    return;
  }

  var cleanup = false;
  // Per-run ID for telemetry correlation. ISO timestamp with short suffix.
  var runId = 'sr-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) +
              '-' + Math.random().toString(36).slice(2, 6);

  // Smart-notification plumbing (pipeline consumes this).
  //   --json         emit a single JSON line on stdout (bypasses --quiet)
  //                  for the pipeline to parse and decide whether to push to Discord.
  //   --no-discord   skip the in-bot Discord push (pipeline takes over).
  var jsonMode = process.argv.includes('--json');
  var suppressDiscord = process.argv.includes('--no-discord');
  var stats = {
    action: 'review',
    runId: runId,
    queueEmpty: true,
    deduplicated: 0,
    uniqueCount: 0,
    newCount: 0,
    updatedCount: 0,
    newNames: [],
    updatedNames: [],
    llmError: null,
    hadError: false,
    reason: ''
  };

  try {
    // 0. Self-healing: remove stale active symlinks before processing queue
    cleanupStaleSymlinks();

    // 1. Check queue and deduplicate
    var dedupResult = deduplicateQueue();
    stats.deduplicated = dedupResult.duplicateCount;
    stats.uniqueCount = dedupResult.uniqueEntries.length;
    if (dedupResult.uniqueEntries.length === 0) {
      stats.queueEmpty = true;
      stats.reason = 'queue_empty';
      log('Nothing to review — queue is empty.');
      return;
    }
    stats.queueEmpty = false;
    if (dedupResult.duplicateCount > 0) {
      log('Queue deduplication: removed ' + dedupResult.duplicateCount + ' duplicate entries, ' + dedupResult.uniqueEntries.length + ' unique entries remain.');
      // Rewrite queue with deduplicated entries
      try {
        fs.writeFileSync(QUEUE_FILE, dedupResult.uniqueEntries.map(function(e) { return JSON.stringify(e); }).join('\n') + '\n', 'utf8');
      } catch (e) {
        err('Failed to rewrite deduplicated queue: ' + e.message);
      }
    }
    var count = dedupResult.uniqueEntries.length;
    log(count + ' entries to review');

    // 2. Build prompt
    log('Building review prompt...');
    var promptResult = buildReviewPrompt();
    if (!promptResult) {
      log('Nothing to review.');
      return;
    }
    // Unpack the new return shape: { prompt, gates }.
    // `gates` is used later by filterBlocksByGates to drop any blocks
    // targeting stable / cooldown skills (defense in depth — the prompt
    // exclusion list is a hint, this is the wall).
    var prompt = promptResult.prompt;
    var gates = promptResult.gates || { stable: [], cooldown: [] };
    log('Prompt: ' + (prompt.length / CONFIG.KB_DIVISOR).toFixed(1) + ' KB');

    // 3. Call LLM via openclaw infer model run, with fallbacks.
    // Extracted into callLlm() so the Stage 2 follow-up loop can reuse it
    // without duplicating the fallback chain.
    log('Calling ' + MODEL + '...');
    var initialLlmResult = await callLlm(prompt);
    if (initialLlmResult.error) {
      stats.llmError = initialLlmResult.error;
      stats.reason = 'llm_error';
      err('Initial LLM call failed: ' + initialLlmResult.error);
      log('No updates — LLM error.');
      return;
    }
    var response = initialLlmResult.text;
    log('Response: ' + response.length + ' chars');

    // 4. Parse response
    var extractResult = extractFileBlocks(response);
    if (extractResult.error) {
      stats.llmError = 'extract: ' + extractResult.error;
      stats.reason = 'extract_error';
      // Keep queue intact so the next run can retry (cleanup is still false here).
      err('Aborting: ' + extractResult.error + ' — keeping queue for retry');
      return;
    }
    var blocks = extractResult.files;
    log('extractFileBlocks: ' + blocks.length + ' raw block(s) from LLM response');

    // ── Option A + C: post-LLM hard gate filter ──
    // Drop any block that targets a stable or cooldown-blocked skill.
    // This is the definitive wall (prompt-level hint is gentle; this is hard).
    // Telemetry is recorded inside filterBlocksByGates for every skip.
    var gateFilterResult = filterBlocksByGates(blocks, gates);
    if (gateFilterResult?.skipped?.length > 0) {
      log('Gates: dropped ' + gateFilterResult?.skipped?.length + ' block(s) targeting excluded skills');
    }
    blocks = gateFilterResult.filtered;

    var summaryBlock = extractSummaryBlock(response);
    log('Extracted ' + blocks.length + ' file block(s) (after gates)');

    // 5. Check existing files BEFORE writing
    var existingFiles = checkExistingFiles(blocks);

    // 7. Write files (deferred — see below)
    var filesWritten = [];
    var postLlmInjectedResults = [];
    if (blocks.length > 0) {
      var writeResult = await writeSkillFiles(blocks);
      // Stage 2: writeSkillFiles now returns { written, injectedToolResults }.
      // Be defensive against older call paths that returned an array.
      if (Array.isArray(writeResult)) {
        filesWritten = writeResult;
      } else if (writeResult && Array.isArray(writeResult.written)) {
        filesWritten = writeResult.written;
        postLlmInjectedResults = writeResult.injectedToolResults || [];
      }
    }
    log('writeSkillFiles: wrote ' + filesWritten.length + ' of ' + blocks.length + ' block(s)');
    if (postLlmInjectedResults.length > 0) {
      log('writeSkillFiles: injected ' + postLlmInjectedResults.length +
          ' tool-call result(s) for LLM (post-LLM dedup skipped these blocks)');
    }

    // ── B-1 fix (2026-06-21): Stage 2 follow-up loop ──
    // When Stage 2 produced inject messages, the LLM was working off stale
    // knowledge. Re-prompt it with the inject context so it can PATCH
    // existing skills (or emit a structured SKIP marker). Without this
    // loop, the LLM never learns to PATCH and the same pathology recurs.
    // Kill switch: STAGE_2_FOLLOWUP_DISABLED=1 → fall back to write-side
    // veto only (original behavior).
    if (postLlmInjectedResults.length > 0 && !STAGE_2_FOLLOWUP_DISABLED) {
      log('STAGE_2_FOLLOWUP: ' + postLlmInjectedResults.length + ' inject(s) — entering follow-up loop');
      var followupOutcome = await runFollowupLoop(
        { prompt: prompt, gates: gates },
        filesWritten,
        postLlmInjectedResults,
        existingFiles,
        { runId: runId, originalBlockCount: blocks.length }
      );
      filesWritten = followupOutcome.filesWritten;
      log('STAGE_2_FOLLOWUP: complete (followupCalls=' + followupOutcome.followupCalls +
          ', newWrites=' + (filesWritten.length - (postLlmInjectedResults.length === 0 ? 0 : 0)) +
          ', stillInjected=' + followupOutcome.postLlmInjectedResults.length + ')');
      if (followupOutcome.postLlmInjectedResults.length > 0) {
        log('STAGE_2_FOLLOWUP: WARNING — ' + followupOutcome.postLlmInjectedResults.length +
            ' inject(s) unresolved after follow-up (max calls or time budget hit)');
      }
    } else if (postLlmInjectedResults.length > 0 && STAGE_2_FOLLOWUP_DISABLED) {
      log('STAGE_2_FOLLOWUP: disabled via STAGE_2_FOLLOWUP_DISABLED — accepting write-side veto only');
    }

    // 6. Conditional cleanup — was: `cleanup = true` set unconditionally at line 1654
    // (BUG: queue was archived even when LLM produced 0 SKILL.md files, silently
    // losing the v=3 candidates — the "0 v=3 candidates became real skills"
    // observation from 2026-06-21 was caused by this).
    // Only cleanup if at least one SKILL.md was actually written (new or updated).
    var hasExistingFileUpdate = false;
    for (var i = 0; i < filesWritten.length; i++) {
      if (existingFiles[filesWritten[i]]) {
        hasExistingFileUpdate = true;
        break;
      }
    }
    // Smart-notification plumbing: split new vs updated using the pre-write map.
    // existingFiles[fp] is truthy if the file existed before this run → "updated".
    // Otherwise → "new". Names are derived from the filePath (skills-learned/<name>/SKILL.md).
    // Deduplicate filesWritten — Stage 1 + follow-up can write the same path twice,
    // causing newNames to contain the same name twice in the notification.
    var uniqueFilesWritten = [...new Set(filesWritten)];
    for (var fi = 0; fi < uniqueFilesWritten.length; fi++) {
      var fp2 = uniqueFilesWritten[fi];
      var name2 = (fp2.split('/').slice(-2, -1)[0]) || fp2;
      if (existingFiles[fp2]) {
        stats.updatedCount++;
        stats.updatedNames.push(name2);
      } else {
        stats.newCount++;
        stats.newNames.push(name2);
      }
    }
    cleanup = (filesWritten.length > 0);  // any new or updated file = cleanup queue
    if (cleanup) {
      log('Cleanup: scheduling (filesWritten=' + filesWritten.length +
          ', hasExistingUpdate=' + hasExistingFileUpdate + ')');
    } else {
      log('Cleanup: SKIPPED (filesWritten=0, blocks=' + blocks.length +
          ') — queue will be retried on next run. ' +
          'If this repeats, investigate LLM output format or writeSkillFiles failures.');
    }

    // 8. Build summary (use pre-write existence for correct new/update label)
    var summary = null;
    if (summaryBlock && summaryBlock.hasUpdates) {
      summary = summaryBlock.summary;
    } else if (filesWritten.length > 0) {
      var lines = ['\uD83D\uDCBE Skill Self-improvement (batch):'];
      for (var i = 0; i < blocks.length; i++) {
        var fp = blocks[i].filePath;
        var name = fp.split('/')[1] || fp;
        lines.push((existingFiles[fp] ? '- \u66f4\u65b0: ' : '- \u65b0\u5efa: ') + name);
      }
      summary = lines.join('\n');
    }

    // 9. Send Discord (skipped when --no-discord; pipeline handles smart notification)
    if (summary) {
      if (suppressDiscord) {
        log('Discord send suppressed (--no-discord) — pipeline will decide.');
      } else {
        log('Sending to Discord #⚙️系統...');
        try {
          await sendDiscordMessageWithRetry(summary);
          log('Done.');
        } catch (e) {
          err('Discord send failed: ' + e.message);
          console.log('\n=== Summary ===\n' + summary + '\n==============');
        }
      }
    } else {
      log('No updates — nothing to report.');
    }

  } catch (e) {
    stats.hadError = true;
    stats.llmError = stats.llmError || ('uncaught: ' + (e && e.message ? e.message : String(e)));
    throw e;
  } finally {
    // Smart-notification plumbing: emit JSON line for the pipeline to consume.
    // Bypasses --quiet (uses raw console.log) because the pipeline ALWAYS needs
    // the stats, even when log() is silenced. Marker delimiters (rather than a
    // bare JSON line) keep the line trivially greppable in cron logs and
    // tolerant of any other stdout noise. Always run in finally so every code
    // path emits stats (queue-empty, llm-error, extract-error, uncaught, etc.).
    if (jsonMode) {
      var jsonLine = '@@SKILL_REVIEWER_JSON@@' + JSON.stringify(stats) + '@@END@@';
      console.log(jsonLine);
    }
    if (cleanup) {
      try {
        execFileSync('node', [CLEANUP_SCRIPT], { timeout: CONFIG.CLEANUP_TIMEOUT_MS, stdio: 'pipe' });
        log('Queue cleaned.');
      } catch (e) {
        err('Cleanup: ' + e.message);
      }
    }
    try {
      fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

if (require.main === module) {
  var _cliArgv = process.argv.slice(2);
  if (_cliArgv[0] === 'mark-mismatch') {
    markMismatchHandler(_cliArgv.slice(1)).then(function(code) { process.exit(code || 0); }).catch(function(e) {
      err('Fatal: ' + e.message);
      process.exit(1);
    });
  } else {
    main().then(function() { process.exit(0); }).catch(function(e) {
      err('Fatal: ' + e.message);
      process.exit(1);
    });
  }
}

module.exports = {
  main,
  validateSkillContentStrict,
  // Internal helpers exported for unit tests (B-1 follow-up loop).
  // Not for production use; behavior depends on test mocks.
  _test: { callLlm, buildFollowupPrompt, runFollowupLoop },
};
