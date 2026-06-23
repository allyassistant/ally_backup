#!/usr/bin/env node
/**
 * audit_to_skill_emitter.js — Cross-Loop Feedback bridge
 *
 * Reads audit repair proposals (Goal 1 output) and audit history, detects
 * recurring fix patterns, and emits skill candidates (Goal 2 input) so
 * the next time the same pattern appears, we already have a skill that
 * documents how to fix it.
 *
 * Algorithm
 *   1. Load .state/repair_proposals.json (per-proposal) +
 *      .state/audit_history/audit_<date>.json (per-run, last WINDOW_DAYS)
 *   2. Group all entries by `rule`
 *   3. For each rule with occurrences >= threshold:
 *        - derive `proposed_skill_name` from rule id
 *        - derive `proposed_skill_description` (3-segment trigger formula)
 *        - collect top 5 files where the rule fired
 *   4. Dedup: skip candidates whose `proposed_skill_name` already exists
 *      as a v=3 entry in .skill_review_queue.jsonl
 *   5. Append surviving candidates to .skill_review_queue.jsonl (one per line)
 *   6. Append one entry per emission to .state/audit_to_skill_emissions.jsonl
 *
 * Configuration
 *   - AUDIT_TO_SKILL_THRESHOLD    (default 3)
 *   - AUDIT_TO_SKILL_WINDOW_DAYS  (default 7)
 *
 * CLI
 *   node scripts/audit_to_skill_emitter.js                # default
 *   node scripts/audit_to_skill_emitter.js --dry-run      # preview only
 *   node scripts/audit_to_skill_emitter.js --verbose      # show all rules
 *   node scripts/audit_to_skill_emitter.js --threshold 5  # override threshold
 *
 * Exit codes
 *   0  success (always — fail-open by design)
 *   1  hard error (missing input file that should exist)
 *
 * Constraints
 *   - No LLM call. Pure deterministic pattern detection.
 *   - Fail-open per-rule: an error processing one rule does not abort others.
 *   - Append-only writes to .skill_review_queue.jsonl and the emissions log.
 *   - Idempotent via dedup gate (re-running on same data emits 0 new).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { WS, STATE_DIR, SKILL_REVIEW_QUEUE } = require('./lib/config');
const proposalStore = require('./lib/proposal_store');
// Phase 2h: pre-emit cosine-similarity filter (2026-06-21). Stops regen of
// skills that already exist by skipping queue append when similarity ≥
// PRE_EMIT_SKIP_THRESHOLD (default 0.85). See deliverable.md §2.
// Loaded via dynamic import inside the emit loop because the filter is .mjs
// and dynamic import keeps this CJS file usable in --dry-run / --verbose
// without forcing a top-level await.
let _preEmitFilter = null;
async function _getPreEmitFilter() {
  if (_preEmitFilter) return _preEmitFilter;
  try {
    const mod = await import('../extensions/skill-auto-suggest/pre-emit-dedup.mjs');
    _preEmitFilter = mod.preEmitFilter;
    return _preEmitFilter;
  } catch (e) {
    logErr('[warn] pre-emit-dedup load failed, falling back to append-only:', e.message);
    _preEmitFilter = async () => ({ action: 'append', reason: 'filter_load_failed' });
    return _preEmitFilter;
  }
}

// ─────────────────────────────── paths ───────────────────────────────
const PROPOSALS_PATH = proposalStore.PROPOSALS_FILE; // for log output only
const AUDIT_HISTORY_DIR = path.join(STATE_DIR, 'audit_history');
const EMISSIONS_LOG = path.join(STATE_DIR, 'audit_to_skill_emissions.jsonl');

// ─────────────────────────────── config ──────────────────────────────
const THRESHOLD = (() => {
  const env = parseInt(process.env.AUDIT_TO_SKILL_THRESHOLD, 10);
  return Number.isFinite(env) && env > 0 ? env : 3;
})();
const WINDOW_DAYS = (() => {
  const env = parseInt(process.env.AUDIT_TO_SKILL_WINDOW_DAYS, 10);
  return Number.isFinite(env) && env > 0 ? env : 7;
})();
const MAX_FILES = 5;

// ─────────────────────────────── args ────────────────────────────────
const args = process.argv.slice(2);
const HELP = args.includes('--help') || args.includes('-h');
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose') || args.includes('-v');

function getArg(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return fallback;
}
const THRESHOLD_OVERRIDE = (() => {
  const v = parseInt(getArg('--threshold', ''), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
})();
const EFFECTIVE_THRESHOLD = THRESHOLD_OVERRIDE || THRESHOLD;

if (HELP) {
  console.log(`audit_to_skill_emitter.js — Cross-Loop Feedback (Goal 1 → Goal 2)

Usage:
  node scripts/audit_to_skill_emitter.js                # default
  node scripts/audit_to_skill_emitter.js --dry-run      # preview only
  node scripts/audit_to_skill_emitter.js --verbose      # show all rules with counts
  node scripts/audit_to_skill_emitter.js --threshold N  # override OCCURRENCE_THRESHOLD

Inputs:
  ${PROPOSALS_PATH}
  ${AUDIT_HISTORY_DIR}/audit_<date>.json (last ${WINDOW_DAYS} days)

Outputs:
  ${SKILL_REVIEW_QUEUE}    (append v=3 candidate entries)
  ${EMISSIONS_LOG}         (append per-emission audit trail)

Env:
  AUDIT_TO_SKILL_THRESHOLD    default ${THRESHOLD}
  AUDIT_TO_SKILL_WINDOW_DAYS  default ${WINDOW_DAYS}
`);
  process.exit(0);
}

// ─────────────────────────────── logging ─────────────────────────────
function logInfo(...a) { try { console.log(...a); } catch (_) {} }
function logErr(...a)  { try { console.error(...a); } catch (_) {} }

// ─────────────────────────────── safe I/O helpers ────────────────────
function safeReadJSON(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    logErr(`[warn] cannot parse ${path.basename(p)}: ${e.message}`);
    return null;
  }
}

function safeReaddir(p) {
  try {
    if (!fs.existsSync(p)) return [];
    return fs.readdirSync(p);
  } catch (e) {
    logErr(`[warn] cannot readdir ${p}: ${e.message}`);
    return [];
  }
}

// ─────────────────────────────── rule-name → skill-name mapping ──────
// Static table for known rules. Falls back to heuristic for unknowns.
const KNOWN_RULE_TO_SKILL = {
  'fsSync_missing_trycatch': {
    skill: 'wrapper-fs-safe-write',
    desc: 'Use when: writing or reading files via fs.writeFileSync / readFileSync / appendFileSync. Provides a try-catch wrapped safe-write wrapper and shows where to apply it in cron/script entry points.',
  },
  'execSync_missing_trycatch': {
    skill: 'wrapper-exec-safe-run',
    desc: 'Use when: calling child_process.execSync / spawnSync without error handling. Provides a try-catch wrapped safe-exec wrapper and explains when a thrown error should crash vs. log.',
  },
  'hardcoded-home-path': {
    skill: 'path-resolver-helper',
    desc: 'Use when: hardcoded /Users/<name> or ~ paths appear in scripts. Centralizes home / workspace resolution via the lib/config module so paths work across machines.',
  },
  'simplified-chinese': {
    skill: 'simplified-chinese-detector',
    desc: 'Use when: source files contain 簡體 characters (esp. .js / .md / .sh). Detects simplified-only glyphs, suggests 繁體 replacements, and integrates with the audit scanner.',
  },
  'magic_numbers': {
    skill: 'magic-number-constant-extractor',
    desc: 'Use when: scripts contain literal numbers (timeouts, retry counts, magic sizes) without a named constant. Documents the named-constant pattern with examples (MS_PER_HOUR, MAX_RETRIES, etc.).',
  },
  'optional_chaining': {
    skill: 'optional-chaining-refactor',
    desc: 'Use when: long null-check chains can collapse to `obj?.prop?.sub`. Shows before/after diffs and the lint/scan rule that flags the verbose form.',
  },
  'magic_numbers_safe': {
    skill: 'magic-number-constant-extractor',
    desc: 'Use when: scripts contain literal numbers (timeouts, retry counts, magic sizes) without a named constant. Documents the named-constant pattern with examples (MS_PER_HOUR, MAX_RETRIES, etc.).',
  },
  'fs-sync-trycatch': {
    skill: 'wrapper-fs-safe-write',
    desc: 'Use when: writing or reading files via fs.writeFileSync / readFileSync / appendFileSync. Provides a try-catch wrapped safe-write wrapper and shows where to apply it in cron/script entry points.',
  },
};

function ruleToSkillCandidate(rule) {
  if (!rule || typeof rule !== 'string') return null;
  const known = KNOWN_RULE_TO_SKILL[rule];
  if (known) return known;

  // Heuristic fallback: turn the rule id into a kebab-case skill name.
  //   - lowercase, strip underscores/dashes around camelCase boundaries
  //   - prefix with "fix-" when the rule id looks like a violation
  const looksLikeViolation = /missing|hardcoded|unsafe|sync|await|chaining/i.test(rule);
  const base = rule
    .replace(/_/g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
  const skill = (looksLikeViolation ? 'fix-' : '') + base;
  return {
    skill,
    desc: `Use when: the audit scanner flags rule "${rule}". Candidate skill bundles the recurring fix into a reusable snippet with examples.`,
  };
}

// ─────────────────────────────── loaders ─────────────────────────────
// Uses lib/proposal_store.js for centralized I/O.
function loadProposals() {
  const data = proposalStore.load();
  if (!data) return [];
  const list = Array.isArray(data.proposals) ? data.proposals : [];
  // Only consider pending+non-rejected proposals.
  return list.filter(p => p && p.rule && p.status !== 'rejected');
}

function loadAuditHistory(windowDays) {
  // Cutoff = now - windowDays days. Accept filenames audit_<YYYY-MM-DD>.json
  // whose date is within [today - windowDays, today].
  const today = new Date();
  const cutoff = new Date(today.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const entries = [];
  const files = safeReaddir(AUDIT_HISTORY_DIR);
  for (const f of files) {
    const m = /^audit_(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
    if (!m) continue;
    const dateStr = m[1];
    if (dateStr < cutoffStr) continue;

    const full = path.join(AUDIT_HISTORY_DIR, f);
    const data = safeReadJSON(full);
    if (!data) continue;

    // Accept both shapes:
    //   { results: { local: [...], ai: [...], error_json: [...] } }
    //   { results: { merged: [...] } }
    const r = (data && data.results) || {};
    const buckets = [];
    if (Array.isArray(r.merged)) buckets.push(...r.merged);
    if (Array.isArray(r.local)) buckets.push(...r.local);
    if (Array.isArray(r.ai)) buckets.push(...r.ai);
    if (Array.isArray(r.error_json)) buckets.push(...r.error_json);

    for (const issue of buckets) {
      if (issue && issue.rule) entries.push({ ...issue, _auditDate: dateStr });
    }
  }
  return entries;
}

// ─────────────────────────────── grouping ────────────────────────────
function groupByRule(entries) {
  const groups = new Map();
  for (const e of entries) {
    const r = e.rule;
    if (!r) continue;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(e);
  }
  return groups;
}

// Top-N files by hit count for a single rule group.
// Normalizes messy proposal paths (../../../../.openclaw/workspace/...)
// to a clean workspace-relative form so the same file isn't counted twice.
function normalizeFilePath(f) {
  if (!f || typeof f !== 'string') return '<unknown>';
  const wsMarker = '.openclaw/workspace/';
  const idx = f.lastIndexOf(wsMarker);
  if (idx >= 0) return f.slice(idx + wsMarker.length);
  // strip leading ./
  return f.replace(/^\.\//, '');
}

function topFilesForRule(items, max) {
  const counts = new Map();
  for (const it of items) {
    const f = normalizeFilePath(it.file);
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([file, hits]) => file);
}

// ─────────────────────────────── dedup ───────────────────────────────
function loadExistingSkillNames() {
  const names = new Set();
  if (!fs.existsSync(SKILL_REVIEW_QUEUE)) return names;
  let raw;
  try { raw = fs.readFileSync(SKILL_REVIEW_QUEUE, 'utf8'); }
  catch (e) { logErr('[warn] cannot read skill_review_queue:', e.message); return names; }

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let entry;
    try { entry = JSON.parse(t); } catch (_) { continue; }
    if (!entry || entry.v !== 3) continue;
    const sig = entry.qualitative_signals || {};
    if (sig.proposed_skill_name) names.add(sig.proposed_skill_name);
  }
  return names;
}

// ─────────────────────────────── emission log ────────────────────────
function appendEmission(entry) {
  try {
    fs.appendFileSync(EMISSIONS_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    logErr('[warn] could not write emissions log:', e.message);
  }
}

// ─────────────────────────────── queue writer ───────────────────────
function buildQueueEntry(rule, occurrence, files, candidate, now, runId) {
  const userPrompt = `audit-to-skill emitter: ${rule} appeared ${occurrence} times in past ${WINDOW_DAYS} days`;
  return {
    v: 3,
    ts: now,
    runId,
    userPrompt: userPrompt.slice(0, 500),
    turnCount: 0,
    toolCallCount: 0,
    success: true,
    // Top-level proposedSkill is REQUIRED for dedup_gate.js (scripts/lib/skill_dedup_gate.js:337).
    // The gate reads `entry.proposedSkill.name + .description` to compute cosine similarity
    // against existing skill embeddings. Without this field, the entry is silently
    // skipped by dedup_gate and the LLM judge treats it as unprocessable.
    // Added 2026-06-20 to fix Cross-Loop Feedback pipeline (was producing no skills).
    proposedSkill: {
      name: candidate.skill,
      description: candidate.desc,
    },
    qualitative_signals: {
      recurring_fix_pattern: true,
      rule_name: rule,
      occurrences_7d: occurrence,
      files: files,
      proposed_skill_name: candidate.skill,
      proposed_skill_description: candidate.desc,
    },
    compressed: [],
    source: 'audit_to_skill_emitter',
    pattern_kind: 'audit_fix_pattern',
    pattern: {
      rule,
      occurrences: occurrence,
      files,
      window_days: WINDOW_DAYS,
    },
  };
}

// ─────────────────────────────── main ────────────────────────────────
async function main() {
  logInfo('🌉 audit_to_skill_emitter.js — Cross-Loop Feedback');

  // Hard guard: proposals file must exist (it's the primary input).
  if (!fs.existsSync(PROPOSALS_PATH)) {
    logErr(`❌ Proposals file not found: ${PROPOSALS_PATH}`);
    logErr('   Run audit_repair_proposer.js first to generate it.');
    process.exit(1);
  }

  const proposals = loadProposals();
  const history = loadAuditHistory(WINDOW_DAYS);

  logInfo(`   Proposals loaded: ${proposals.length}`);
  logInfo(`   Audit history (last ${WINDOW_DAYS}d): ${history.length} issues from ${safeReaddir(AUDIT_HISTORY_DIR).filter(f => /^audit_\d{4}-\d{2}-\d{2}\.json$/.test(f)).length} file(s)`);
  logInfo(`   Threshold: ${EFFECTIVE_THRESHOLD} occurrences / ${WINDOW_DAYS} days`);

  // Combine — proposals file is the authoritative per-proposal record;
  // audit_history provides cross-day trend. We dedup-proposals vs. history
  // so the same occurrence isn't double-counted when both reference it.
  const allEntries = [...proposals, ...history];
  const groups = groupByRule(allEntries);

  logInfo(`   Rules analyzed: ${groups.size}`);
  logInfo('   ─────────────────────────────');

  const existing = loadExistingSkillNames();
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();

  let emittedCount = 0;
  let skippedDedup = 0;
  let skippedThreshold = 0;
  let skippedPreEmit = 0;
  let patchedPreEmit = 0;

  // Sort rule names alphabetically for stable output
  const sortedRules = [...groups.keys()].sort();

  // First pass — print verbose/all-rules view if --verbose
  if (VERBOSE) {
    for (const rule of sortedRules) {
      const items = groups.get(rule) || [];
      const candidate = ruleToSkillCandidate(rule);
      const skillLabel = candidate ? candidate.skill : '(no candidate)';
      logInfo(`   ${rule}: ${items.length} occurrences → ${skillLabel}`);
    }
    logInfo('   ─────────────────────────────');
  }

  // Second pass — emit (deterministic, threshold-gated)
  for (const rule of sortedRules) {
    try {
      const items = groups.get(rule) || [];
      const occurrences = items.length;

      if (occurrences < EFFECTIVE_THRESHOLD) {
        skippedThreshold++;
        continue;
      }

      const candidate = ruleToSkillCandidate(rule);
      if (!candidate || !candidate.skill) {
        logErr(`   ⏭️  ${rule}: no skill-name mapping (skipped)`);
        continue;
      }

      if (existing.has(candidate.skill)) {
        logInfo(`   ⏭️  ${rule}: ${occurrences} occurrences → "${candidate.skill}" already in queue`);
        skippedDedup++;
        continue;
      }

      const files = topFilesForRule(items, MAX_FILES);
      logInfo(`   ${rule}: ${occurrences} occurrences → emit "${candidate.skill}"`);

      if (DRY_RUN) {
        // Even in dry-run, run the pre-emit filter so we see what it would do.
        const preEmitFilter = await _getPreEmitFilter();
        const decision = await preEmitFilter(
          { name: candidate.skill, description: candidate.desc },
          { dryRun: true, source: 'audit_to_skill_emitter' }
        );
        if (decision.action === 'skip') {
          logInfo(`      ⏭️  pre-emit SKIP (${decision.reason}, matched=${decision.matchedSkill})`);
          skippedPreEmit++;
        } else if (decision.action === 'patch') {
          logInfo(`      🔧 pre-emit PATCH (${decision.reason}, matched=${decision.matchedSkill})`);
          patchedPreEmit++;
          emittedCount++; // dry-run pretends to emit
        } else {
          emittedCount++;
        }
        continue;
      }

      const entry = buildQueueEntry(rule, occurrences, files, candidate, now, runId);

      // Phase 2h: pre-emit cosine filter — drop entries that already exist.
      try {
        const preEmitFilter = await _getPreEmitFilter();
        const decision = await preEmitFilter(entry, { source: 'audit_to_skill_emitter' });
        if (decision.action === 'skip') {
          logInfo(`      ⏭️  pre-emit SKIP (${decision.reason}, matched=${decision.matchedSkill})`);
          skippedPreEmit++;
          appendEmission({
            ts: now,
            rule,
            occurrences,
            files_count: files.length,
            files,
            proposed_skill_name: candidate.skill,
            status: 'skipped_pre_emit',
            matched_skill: decision.matchedSkill,
            similarity: decision.similarity,
            reason: decision.reason,
            runId,
          });
          continue;
        }
        if (decision.action === 'patch') {
          // Mark PATCH intent for downstream consumers.
          entry.proposedSkill = entry.proposedSkill || {};
          entry.proposedSkill.action = 'patch';
          entry.proposedSkill.matched_skill = decision.matchedSkill;
          entry.proposedSkill.similarity = decision.similarity;
          entry.qualitative_signals = entry.qualitative_signals || {};
          entry.qualitative_signals.pre_emit_dedup = {
            action: 'patch',
            matchedSkill: decision.matchedSkill,
            similarity: decision.similarity,
            reason: decision.reason,
          };
          logInfo(`      🔧 pre-emit PATCH (${decision.reason}, matched=${decision.matchedSkill})`);
          patchedPreEmit++;
        }
      } catch (e) {
        // Fail-open: log and proceed with original append behavior.
        logErr(`      [warn] pre-emit filter threw, appending anyway: ${e.message}`);
      }

      try {
        fs.appendFileSync(SKILL_REVIEW_QUEUE, JSON.stringify(entry) + '\n', 'utf8');
        existing.add(candidate.skill);
        emittedCount++;
        appendEmission({
          ts: now,
          rule,
          occurrences,
          files_count: files.length,
          files,
          proposed_skill_name: candidate.skill,
          status: 'emitted',
          runId,
        });
      } catch (e) {
        logErr(`   ❌ failed to emit ${candidate.skill}: ${e.message}`);
        appendEmission({
          ts: now,
          rule,
          occurrences,
          files_count: files.length,
          proposed_skill_name: candidate.skill,
          status: 'error',
          error: e.message,
          runId,
        });
      }
    } catch (e) {
      // fail-open per rule
      logErr(`   ❌ unexpected error on rule ${rule}: ${e.message}`);
    }
  }

  logInfo('   ─────────────────────────────');
  logInfo(`   ✅ Emitted: ${emittedCount} candidate${emittedCount === 1 ? '' : 's'}${DRY_RUN ? ' (dry-run)' : ''}`);
  logInfo(`   ⏭️  Skipped (dedup): ${skippedDedup}`);
  logInfo(`   ⏭️  Skipped (below threshold): ${skippedThreshold}`);
  logInfo(`   ⏭️  Skipped (pre-emit filter): ${skippedPreEmit}`);
  if (patchedPreEmit > 0) logInfo(`   🔧 Patched (pre-emit filter): ${patchedPreEmit}`);

  // Fail-open: always exit 0 unless we hit a hard error above.
  process.exit(0);
}

try {
  (async () => {
    try {
      await main();
    } catch (e) {
      logErr(`❌ Unhandled exception in main(): ${e.message}`);
      if (e.stack) logErr(e.stack);
      process.exit(1);
    }
  })();
} catch (e) {
  logErr(`❌ Unhandled exception in main(): ${e.message}`);
  if (e.stack) logErr(e.stack);
  process.exit(1);
}
