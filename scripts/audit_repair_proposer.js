#!/usr/bin/env node
/**
 * scripts/audit_repair_proposer.js — Phase 2e wiring
 *
 * Reads audit_orchestrator_results.json (output of Phase 2d audit_daily_cron),
 * classifies each issue by (severity × file-tier), and either:
 *   - Auto-fixes (HIGH confidence, utility/debug tier only) with snapshot/rollback
 *   - Appends a repair proposal to .state/repair_proposals.json
 *
 * Tier policy (Phase 2e simplified):
 *   critical + any tier         → snapshot + auto-fix (LOW_RISK_RULES eligible)
 *   high     + utility/debug    → snapshot + auto-fix (LOW_RISK_RULES eligible)
 *   high     + production       → propose only
 *   medium   + any tier         → propose only
 *   low      + any tier         → propose only (also logged)
 *
 * File-tier classifier (heuristic):
 *   production  → matches /scripts/(cron_|auto_|daily_|session_|.*_runner|.*_monitor|.*_triage)\.js$/
 *                 or ends in .sh, or under /archive/
 *   utility     → everything else (scripts/lib/, scripts/*_lib, etc.)
 *
 * Auto-fix path:
 *   For each issue in (critical OR high+utility):
 *     1. Snapshot file → .fix_snapshots/<base>.<ts>.<pid>.pre
 *     2. Find matching LOW_RISK_RULES entry by issue.rule
 *     3. Run rule.detect() to confirm problem still present
 *     4. Apply rule.fix(content) and write back
 *     5. Re-verify with rule.detect(); if still found → rollback
 *     6. Record success or rollback in result JSON
 *
 * Fail-open: any error in one issue does not abort the whole run. Errors
 * are recorded in the result file for human review.
 *
 * Usage:
 *   node scripts/audit_repair_proposer.js                       # default input
 *   node scripts/audit_repair_proposer.js --input <path>        # custom audit JSON
 *   node scripts/audit_repair_proposer.js --dry-run             # propose only, no writes
 *   node scripts/audit_repair_proposer.js --no-snapshot         # skip snapshot (dangerous)
 *   node scripts/audit_repair_proposer.js --verbose
 *   node scripts/audit_repair_proposer.js --help
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { WS, STATE_DIR, SCRIPTS_DIR, atomicWriteSync } = require('./lib/config');
const { LOW_RISK_RULES } = require('./lib/rules/low-risk');
const { validateFix, logValidation } = require('./lib/rules/validation');
const snapshot = require('./lib/file_snapshot');
// Layer 2 — cross-script dependency propagation
// enableLayer2: when true, after each successful auto-fix we extract the
// function signatures of the fixed file (pre + post) and run
// findIncompatibleCallers on the dependency graph. Broken callers are
// emitted as additional proposals so the next audit cycle can fix them.
const depGraph = require('./lib/dependency_graph');
const sigDetector = require('./lib/script_signature_detector');
const cumulativeApprovals = require('./lib/cumulative_approvals');
const proposalStore = require('./lib/proposal_store');
const fixM3 = require('./fix_m3_advisory');
const ENABLE_LAYER2 = process.env.AUDIT_REPAIR_LAYER2 !== 'false'; // default ON (2026-06-20)
// Cumulative auto-apply: when a rule has been manually approved N times
// (default N=3), future production-tier proposals of that rule are
// auto-applied without human review. Honors user's "high LLM trust"
// preference while keeping safety net for novel rules.
const ENABLE_CUMULATIVE = process.env.AUDIT_REPAIR_CUMULATIVE !== 'false'; // default ON (2026-06-20)

const DEFAULT_INPUT = path.join(STATE_DIR, 'audit_orchestrator_results.json');
const PROPOSALS_OUT = proposalStore.PROPOSALS_FILE; // for log output only
const WIRE_RESULTS_OUT = path.join(STATE_DIR, 'audit_repair_wire_results.json');

const args = new Set(process.argv.slice(2));
const HELP = args.has('--help') || args.has('-h');
const DRY_RUN = args.has('--dry-run');
const VERBOSE = args.has('--verbose') || args.has('-v');
const NO_SNAPSHOT = args.has('--no-snapshot');
const LAYER2_OFF = args.has('--no-layer2');

function getArg(flag, fallback) {
  const all = process.argv.slice(2);
  const i = all.indexOf(flag);
  if (i >= 0 && i + 1 < all.length) return all[i + 1];
  return fallback;
}

const INPUT_PATH = getArg('--input', DEFAULT_INPUT);

// ----------------- CLI -----------------
function printHelp() {
  console.log(`audit_repair_proposer.js — Phase 2e: audit → auto-repair/propose (Phase 2e)

Usage:
  node scripts/audit_repair_proposer.js                 # default input
  node scripts/audit_repair_proposer.js --input <path>  # custom audit JSON
  node scripts/audit_repair_proposer.js --dry-run       # propose only, no writes
  node scripts/audit_repair_proposer.js --no-snapshot   # skip snapshot (debug only)
  node scripts/audit_repair_proposer.js --verbose       # verbose logging
  node scripts/audit_repair_proposer.js --help

Inputs:
  ${DEFAULT_INPUT}

Outputs:
  ${PROPOSALS_OUT}
  ${WIRE_RESULTS_OUT}
  ${snapshot.SNAPSHOT_DIR}/<file>.<ts>.<pid>.pre   (per auto-fix)
`);
}

// Only intercept --help when this file is the entrypoint. When imported by
// another script (e.g. proposal_action.js), the importer owns argv and we
// must NOT exit early or print help on its behalf.
if (require.main === module && HELP) {
  printHelp();
  process.exit(0);
}

function log(...a) { if (VERBOSE) console.log(...a); }

// ----------------- File path normalization -----------------
/**
 * auditOrchestrator writes paths relative to its CWD. When run from inside
 * the workspace (e.g. scripts/lib/) the CWD was deep enough that paths come
 * out like
 *   ../../../../.openclaw/workspace/scripts/foo.js
 * — the substring after the `../` chain is already anchored to WS/scripts.
 *
 * Strategy: detect the "WS suffix" inside the path, then build an absolute
 * path from there. If no WS suffix exists, fall back to path.resolve(WS, p)
 * and finally to returning p unchanged.
 */
// Cache the realpath of WS to avoid repeated syscalls. WS itself is
// module-constant; symlink resolution only needs to happen once.
let _WS_REAL = null;
function getRealWS() {
  if (_WS_REAL !== null) return _WS_REAL;
  try {
    _WS_REAL = fs.realpathSync(WS);
  } catch (e) {
    // WS doesn't exist (e.g. workspace deleted) — fall back to symlinked
    // form. Downstream callers will surface the real error.
    _WS_REAL = WS;
  }
  return _WS_REAL;
}

// Canonicalize a path: realpath if it exists, return as-is if not.
// This resolves symlinks (e.g. ~/.openclaw → /Volumes/Backup/.openclaw)
// so that in-memory paths match what other code paths see, while still
// gracefully handling ENOENT for paths that don't exist on disk yet.
function canonicalize(p) {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    // ENOENT, EACCES, etc. — return as-is so caller can produce a clear
    // "file not found" error rather than silently using a non-canonical form.
    return p;
  }
}

function normalizeIssuePath(p) {
  if (!p) return null;

  // Already absolute → canonicalize
  if (path.isAbsolute(p)) {
    return canonicalize(p);
  }

  // Find ".openclaw/workspace/" anywhere in the relative path.
  // That's the workspace boundary the orchestrator's `path.relative` produced.
  const wsMarker = '.openclaw' + path.sep + 'workspace' + path.sep;
  const idx = p.lastIndexOf(wsMarker);
  if (idx >= 0) {
    // Take everything AFTER the marker as workspace-relative, then resolve.
    const wsRelative = p.slice(idx + wsMarker.length);
    // Resolve against the REAL WS (not symlinked) so the result is canonical.
    const candidate = path.join(getRealWS(), wsRelative);
    // Path may not exist on disk (e.g. archive deleted) — return the
    // candidate anyway so downstream code can produce a clear "file not
    // found" error rather than silently using the original relative form.
    return canonicalize(candidate);
  }

  // Generic relative — resolve against the REAL WS, then canonicalize
  return canonicalize(path.resolve(getRealWS(), p));
}

// ----------------- Tier classifier -----------------
// Production patterns:
//   1. Path-based: scripts/cron_*.js, scripts/auto_*.js (top-level only),
//      scripts/*_runner, *monitor, *triage, archive/, *.sh
//   2. Basename-based fallback: cron_*.js, daily_*.js, session_*.js anywhere
//      (covers out-of-tree test/demo files). We deliberately exclude
//      'auto_' from the basename rule because auto_repair.js lives in
//      scripts/lib/ and is library code, not a cron entrypoint.
const PRODUCTION_PATH_RE = new RegExp(
  '^scripts/(' +
  '(cron_|auto_|daily_|session_|.*_runner|.*_monitor|.*_triage)' +
  ')[^/]*\\.js$',
  'i'
);
const PRODUCTION_BASENAME_RE = /^(cron_|daily_|session_).*\.js$/i;

function classifyTier(relPath) {
  const p = relPath.replace(/^\.\//, '');
  const base = path.basename(p);

  if (/\.sh$|\.bash$|\.zsh$/i.test(p)) return 'production';
  if (/\.sh$|\.bash$|\.zsh$/i.test(base)) return 'production';
  if (/\/archive\//.test(p)) return 'production';
  if (PRODUCTION_PATH_RE.test(p)) return 'production';
  // Basename fallback for cron/daily/session only (NOT auto_)
  if (PRODUCTION_BASENAME_RE.test(base)) return 'production';
  return 'utility';
}

// ----------------- LOW_RISK_RULES lookup -----------------
const RULE_MAP = new Map();
for (const rule of LOW_RISK_RULES) {
  RULE_MAP.set(rule.id, rule);
}

function findLowRiskRule(issue) {
  // Direct match by rule id
  if (RULE_MAP.has(issue.rule)) return RULE_MAP.get(issue.rule);
  // Fuzzy match — some orchestrator rules map to low-risk rules
  // (audit_to_skill_emitter emits `magic_numbers`; LOW_RISK_RULES has `magic-numbers-safe`)
  const aliases = {
    'fsSync_missing_trycatch': 'fs-sync-trycatch',
    'execSync_missing_trycatch': 'fs-sync-trycatch',
    'simplified-chinese': 'simplified-chinese',
    'optional_chaining': 'optional-chaining',
    'magic_numbers': 'magic-numbers-safe',
    'magic_numbers_safe': 'magic-numbers-safe',  // legacy alias, kept for back-compat
  };
  const aliased = aliases[issue.rule];
  if (aliased && RULE_MAP.has(aliased)) return RULE_MAP.get(aliased);
  return null;
}

// ----------------- Decision -----------------
// v2 heuristic (2026-06-20): relax medium/low in utility/debug tier to auto-fix.
// Rationale: LOW_RISK_RULES covers mechanical edits (whitespace, magic numbers,
// simplified-chinese, etc.) that are safe to apply without human review in
// non-production code. Production tier + high severity still needs cumulative
// approval gate. This focuses human review on truly critical issues.
//
// Decision matrix (rule gate precedes severity — fail-closed on unknown rules):
//   rule gate (must be in LOW_RISK_RULES or alias) precedes all severity checks
//   critical + any           → auto-fix (always, when rule is known)
//   high + utility/debug      → auto-fix (mechanical, no production impact)
//   high + production         → propose (cumulative gate), auto-fix if trusted
//   medium + utility/debug    → auto-fix (NEW in v2, was: propose)
//   medium + production       → propose (cumulative gate), auto-fix if trusted
//   low + utility/debug        → auto-fix (NEW in v2, was: propose)
//   low + production           → propose (rare, still needs human eye)
function decideAction(issue) {
  const tier = classifyTier(issue.file || '');
  const sev = issue.severity;
  const ruleId = issue.rule;
  const isNonProduction = tier === 'utility' || tier === 'debug';

  // Rule gate FIRST: unknown rules always propose (fail-closed).
  // A new orchestrator rule without a LOW_RISK_RULES entry is a config gap,
  // not an auto-fix candidate. Force human review until registered.
  const rule = ruleId ? findLowRiskRule({ rule: ruleId }) : null;
  if (!rule) {
    return {
      action: 'propose',
      tier,
      reason: ruleId
        ? `rule "${ruleId}" not in LOW_RISK_RULES (no direct match or alias) — needs registration before auto-fix`
        : 'no rule id on issue — needs manual triage',
      unknownRule: true,
    };
  }
  // Known rule, but detection-only (autoFixable: false) → always propose.
  if (rule.autoFixable === false) {
    return {
      action: 'propose',
      tier,
      reason: `rule "${ruleId}" is detection-only (autoFixable: false), needs manual fix`,
    };
  }

  // Critical + any tier → auto-fix (only fires when rule is known)
  if (sev === 'critical') {
    return { action: 'auto-fix', tier, reason: 'critical severity overrides tier' };
  }
  // High + non-production → auto-fix
  if (sev === 'high' && isNonProduction) {
    return { action: 'auto-fix', tier, reason: 'high severity on utility/debug file' };
  }
  // High + production → check cumulative approval
  if (sev === 'high' && tier === 'production') {
    if (ENABLE_CUMULATIVE && ruleId) {
      const check = cumulativeApprovals.checkAutoApply({ ruleId, severity: sev, tier });
      if (check.trusted) {
        return {
          action: 'auto-fix',
          tier,
          reason: `cumulative approval: rule "${ruleId}" trusted after ${check.count} manual approvals`,
          cumulative: true,
        };
      }
    }
    return { action: 'propose', tier, reason: 'high severity on production file requires approval' };
  }
  // Medium + non-production → auto-fix (v2 — was: propose)
  if (sev === 'medium' && isNonProduction) {
    return { action: 'auto-fix', tier, reason: 'medium severity on utility/debug file (mechanical edit)' };
  }
  // Medium + production → also check cumulative
  if (sev === 'medium' && tier === 'production' && ENABLE_CUMULATIVE && ruleId) {
    const check = cumulativeApprovals.checkAutoApply({ ruleId, severity: sev, tier });
    if (check.trusted) {
      return {
        action: 'auto-fix',
        tier,
        reason: `cumulative approval: rule "${ruleId}" trusted after ${check.count} manual approvals`,
        cumulative: true,
      };
    }
  }
  // Low + non-production → auto-fix (v2 — was: propose)
  if (sev === 'low' && isNonProduction) {
    return { action: 'auto-fix', tier, reason: 'low severity on utility/debug file (mechanical edit)' };
  }
  // Everything else → propose (production + medium/low without trust, or low + production)
  if (sev === 'low' && tier === 'production') {
    return { action: 'propose', tier, reason: 'low severity on production file (rare)' };
  }
  return { action: 'propose', tier, reason: 'medium/low severity on production file requires approval' };
}

// ----------------- Auto-fix executor -----------------
async function applyFix(absPath, issue, dryRun, graph) {
  const rule = findLowRiskRule(issue);
  if (!rule) {
    return { ok: false, error: `no LOW_RISK_RULES entry for rule '${issue.rule}'` };
  }

  let snapPath = null;
  let original = null;
  try {
    original = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return { ok: false, error: `cannot read source: ${e.message}` };
  }

  // Step 1: snapshot
  if (!NO_SNAPSHOT && !dryRun) {
    try {
      snapPath = snapshot.snapshotFile(absPath);
      log(`   📸 snapshot → ${snapPath}`);
    } catch (e) {
      return { ok: false, error: `snapshot failed: ${e.message}` };
    }
  }

  // Step 2: detect (sanity check — the problem still present?)
  let detectResult;
  try {
    detectResult = rule.detect(original, absPath);
  } catch (e) {
    if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return { ok: false, error: `detect threw: ${e.message}`, snapPath };
  }
  if (!detectResult || !detectResult.found) {
    if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return { ok: false, error: 'detect() reports issue no longer present (race/duplicate?)', snapPath };
  }

  // Step 3: apply fix
  let fixed;
  try {
    fixed = rule.fix(original, absPath);
  } catch (e) {
    if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return { ok: false, error: `fix() threw: ${e.message}`, snapPath };
  }
  if (fixed === null || fixed === undefined) {
    if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return { ok: false, error: 'fix() returned null (rule declined)', snapPath };
  }
  if (fixed === original) {
    // No change — treat as failure rather than success
    if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return { ok: false, error: 'fix() returned identical content (no-op)', snapPath };
  }

  // Step 3.5: validate fix (Phase 1+3 gate) — reject bad fixes BEFORE writing.
  // Same gate used by auto_fix.js: syntax + identifiers + semantic equivalence.
  // If validation rejects, rollback snapshot and skip the write.
  let validation;
  try {
    validation = validateFix({
      oldContent: original,
      newContent: fixed,
      filePath: absPath,
      rule,
    });
  } catch (e) {
    if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return { ok: false, error: `validateFix threw: ${e.message}`, snapPath };
  }
  if (!validation.valid) {
    const failedChecks = validation.checks
      .filter(c => !c.valid)
      .map(c => `${c.name}: ${c.details || 'failed'}`)
      .join('; ');
    logValidation({
      ruleId: rule.id,
      filePath: absPath,
      status: 'SKIPPED',
      details: failedChecks,
    });
    if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return {
      ok: false,
      error: `validation rejected (${failedChecks})`,
      snapPath,
      rolledBack: !!snapPath,
    };
  }

  // Step 4: write atomically (if not dry-run)
  if (!dryRun) {
    try {
      const tmp = absPath + '.fix.tmp';
      fs.writeFileSync(tmp, fixed, 'utf8');
      fs.renameSync(tmp, absPath);
    } catch (e) {
      if (snapPath) try { rollback(snapPath, absPath); } catch (_) {}
      return { ok: false, error: `write failed: ${e.message}`, snapPath };
    }
  }

  // Step 5: re-verify
  let reDetect;
  try {
    reDetect = rule.detect(fixed, absPath);
  } catch (e) {
    if (!dryRun && snapPath) try { rollback(snapPath, absPath); } catch (_) {}
    return { ok: false, error: `re-detect threw: ${e.message}`, snapPath };
  }
  if (reDetect && reDetect.found) {
    // Fix did not eliminate the problem → rollback
    if (!dryRun && snapPath) {
      try { rollback(snapPath, absPath); } catch (_) {}
    }
    return {
      ok: false,
      error: `re-detect still finds issue: ${reDetect.details || 'unspecified'}`,
      snapPath,
      rolledBack: !dryRun,
    };
  }

  // Step 6: Layer 2 — cross-script signature propagation
  // After a successful fix, check if the function signatures of the file
  // changed. If yes, find callers in dependent files that are now broken
  // and emit follow-up proposals. Pure detection — no file writes here.
  let crossScriptFixes = [];
  if (ENABLE_LAYER2 && !LAYER2_OFF && graph) {
    try {
      const preSigs = sigDetector.extractFunctionSignaturesFromSource(original, absPath);
      const postSigs = sigDetector.extractFunctionSignaturesFromSource(fixed, absPath);
      const incompatible = sigDetector.findIncompatibleCallers(graph, preSigs, postSigs, absPath);
      if (incompatible.length > 0) {
        for (const ic of incompatible) {
          crossScriptFixes.push({
            file: path.relative(WS, ic.file),
            line: ic.line,
            rule: 'cross-script-incompatible-caller',
            severity: 'high',
            message: `Layer 2: ${ic.reason}`,
            reason: `Layer 2 cross-script propagation: ${ic.func}() signature changed in ${path.relative(WS, absPath)}`,
            absPath: ic.file,
            tier: classifyTier(ic.file),
            autoFixCandidate: false, // require human review
            layer2: true,
            sourceFunction: ic.func,
          });
        }
        log(`   🌐 Layer 2: ${incompatible.length} cross-script follow-up(s) detected`);
      }
    } catch (e) {
      log(`   ⚠️  Layer 2 propagation failed (non-fatal): ${e.message}`);
    }
  }

  return {
    ok: true,
    snapPath,
    ruleId: rule.id,
    details: detectResult.details,
    crossScriptFixes,
  };
}

// ----------------- Proposals writer -----------------
// Delegates to lib/proposal_store.js (shared with propose_fix_notifier.js,
// proposal_action.js, audit_to_skill_emitter.js, daily_telemetry_digest.js).
function appendProposal(proposal) {
  const appended = proposalStore.appendAndSave(proposal);
  if (!appended) {
    log(`   ⏭️  duplicate proposal suppressed: ${proposal.file}:${proposal.line}:${proposal.rule}`);
    return false;
  }
  return true;
}

// ----------------- Main -----------------
async function main() {
  log(`🔧 audit_repair_proposer.js — Phase 2e`);
  log(`   input:  ${INPUT_PATH}`);
  log(`   output: ${PROPOSALS_OUT}`);
  log(`   snap:   ${snapshot.SNAPSHOT_DIR}`);

  // 1. Load audit results
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`❌ Input not found: ${INPUT_PATH}`);
    console.error(`   Run audit_daily_cron.js first to generate it.`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
  } catch (e) {
    console.error(`❌ Cannot parse ${INPUT_PATH}: ${e.message}`);
    process.exit(1);
  }

  const issues = (payload.results && payload?.results?.merged) || [];
  log(`   loaded ${issues.length} merged issues`);

  // 2. Build dependency graph (Layer 2 setup). One-time cost; cached.
  let graph = null;
  if (ENABLE_LAYER2 && !LAYER2_OFF) {
    try {
      log(`\n🌐 Layer 2: building dependency graph (one-time)...`);
      graph = depGraph.buildDependencyGraph(WS);
      const nodeCount = graph && graph.nodes ? graph?.nodes?.length : 0;
      const edgeCount = graph && graph.edges ? graph?.edges?.length : 0;
      log(`   graph: ${nodeCount} nodes, ${edgeCount} edges`);
    } catch (e) {
      log(`   ⚠️  graph build failed (non-fatal): ${e.message}`);
    }
  }

  // 3. Bucket by action
  const results = {
    autoFixes: [],
    proposals: [],
    crossScriptProposals: [],
    skipped: [],
    summary: {},
    meta: {
      inputPath: INPUT_PATH,
      dryRun: DRY_RUN,
      layer2Enabled: !!(ENABLE_LAYER2 && !LAYER2_OFF),
      startedAt: new Date().toISOString(),
    },
  };

  let autoFixCount = 0;
  let proposeCount = 0;
  let crossScriptCount = 0;
  let skippedCount = 0;

  for (const issue of issues) {
    let decision = decideAction(issue);
    const absPath = normalizeIssuePath(issue.file);
    const baseIssue = {
      id: issue.id,
      file: issue.file,
      line: issue.line,
      rule: issue.rule,
      severity: issue.severity,
      message: issue.message,
      absPath,
    };

    // ── M3 advisory (shadow: log only; active: override heuristic) ──
    // Skips M3 for: critical severity, cumulative-trusted rules, low+utility.
    // In active mode, M3 verdict can upgrade propose→auto-fix (or downgrade).
    let m3Result = { skipped: true };
    if (!DRY_RUN && fixM3.isEnabled()) {  // skip M3 in dry-run mode; only call in real runs when M3 enabled
      try {
        m3Result = fixM3.consultM3({
          ruleId: issue.rule,
          file: issue.file,
          line: issue.line,
          severity: issue.severity,
          tier: classifyTier(issue.file || ''),
          message: issue.message,
          heuristicDecision: decision.action,
          heuristicReason: decision.reason,
        });
        // In active mode: M3 verdict can override heuristic
        if (fixM3.isActive() && m3Result.verdict && m3Result.verdict !== 'uncertain' && !m3Result.skipped) {
          const tier = classifyTier(issue.file || '');
          const risk = cumulativeApprovals.getRisk(issue.rule);
          // M3 approve: upgrade propose→auto-fix for non-critical low/medium risk
          if (m3Result.verdict === 'approve' && decision.action === 'propose' &&
              issue.severity !== 'critical' && (risk === 'low' || risk === 'medium')) {
            decision = {
              action: 'auto-fix',
              tier,
              reason: `M3 active: approved with confidence ${m3Result.confidence} — ${m3Result?.reasoning?.slice(0, 100)}`,
              m3Override: true,
            };
          }
          // M3 reject: downgrade auto-fix→propose for non-critical
          if (m3Result.verdict === 'reject' && decision.action === 'auto-fix' &&
              issue.severity !== 'critical' && risk !== 'high') {
            decision = {
              action: 'propose',
              tier,
              reason: `M3 active: rejected with confidence ${m3Result.confidence} — ${m3Result?.reasoning?.slice(0, 100)}`,
              m3Override: true,
            };
          }
        }
      } catch (e) {
        log(`   ⚠️  M3 advisory failed (non-fatal): ${e.message}`);
      }
    }

    if (decision.action === 'auto-fix') {
      if (!absPath || !fs.existsSync(absPath)) {
        results?.autoFixes?.push({
          ...baseIssue,
          tier: decision.tier,
          ok: false,
          error: `file not found: ${absPath || issue.file}`,
        });
        skippedCount++;
        continue;
      }
      log(`\n🔧 Auto-fix: ${issue.file}:${issue.line} (${issue.rule}, ${issue.severity}/${decision.tier})`);
      const r = await applyFix(absPath, issue, DRY_RUN, graph);
      results?.autoFixes?.push({
        ...baseIssue,
        tier: decision.tier,
        reason: decision.reason,
        ruleId: r.ruleId,
        ok: r.ok,
        error: r.error,
        snapPath: r.snapPath,
        rolledBack: r.rolledBack || false,
        dryRun: DRY_RUN,
        crossScriptFixes: r.crossScriptFixes || [],
        m3Advisory: m3Result.skipped ? null : {
          verdict: m3Result.verdict,
          confidence: m3Result.confidence,
          alignment: m3Result.alignment,
        },
        m3Override: decision.m3Override || false,
      });
      if (r.ok) {
        autoFixCount++;
        // Emit Layer 2 cross-script follow-ups as separate proposals
        if (r.crossScriptFixes && r?.crossScriptFixes?.length > 0) {
          for (const csf of r.crossScriptFixes) {
            const wrote = appendProposal(csf);
            results?.crossScriptProposals?.push({ ...csf, writtenToFile: wrote });
            if (wrote) crossScriptCount++;
          }
        }
      } else {
        skippedCount++;
      }
    } else {
      // Propose
      log(`\n📝 Propose: ${issue.file}:${issue.line} (${issue.rule}, ${issue.severity}/${decision.tier})`);
      const proposal = {
        ...baseIssue,
        tier: decision.tier,
        reason: decision.reason,
        autoFixCandidate: !!findLowRiskRule(issue),
        m3Advisory: m3Result.skipped ? null : {
          verdict: m3Result.verdict,
          confidence: m3Result.confidence,
          alignment: m3Result.alignment,
        },
        m3Override: decision.m3Override || false,
      };
      const wrote = appendProposal(proposal);
      results?.proposals?.push({ ...proposal, writtenToFile: wrote });
      if (wrote) proposeCount++; else skippedCount++;
    }
  }

  // 4. Cleanup old snapshots
  let removed = 0;
  try { removed = snapshot.cleanOldSnapshots(14); } catch (_) {}

  // 5. Final summary
  results.summary = {
    totalIssues: issues.length,
    autoFixOk: autoFixCount,
    propose: proposeCount,
    crossScriptProposals: crossScriptCount,
    skipped: skippedCount,
    oldSnapshotsRemoved: removed,
    m3Advisory: fixM3.getRunCounts(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - new Date(results?.meta?.startedAt).getTime(),
  };

  atomicWriteSync(WIRE_RESULTS_OUT, results);

  // 5. Console summary (always shown)
  console.log(`\n📊 audit_repair_proposer.js — Summary`);
  console.log(`   Total issues:        ${issues.length}`);
  console.log(`   ✅ Auto-fix OK:      ${autoFixCount}`);
  console.log(`   📝 Proposals added:  ${proposeCount}`);
  console.log(`   🌐 Layer 2 cross-script follow-ups: ${crossScriptCount}`);
  console.log(`   ⏭️  Skipped/errors:  ${skippedCount}`);
  console.log(`   🗑️  Old snapshots:   ${removed}`);
  if (fixM3.isEnabled()) {
    const c = fixM3.getRunCounts();
    console.log(`   🤖 M3 advisory (${fixM3.getMode()}):`);
    console.log(`      calls: ${c.total}, agree: ${c.agree}, disagree: ${c.disagree}, uncertain: ${c.m3_uncertain}, errors: ${c.m3_error}, skip: ${c.skip}`);
  }
  console.log(`   results → ${WIRE_RESULTS_OUT}`);
  console.log(`   proposals → ${PROPOSALS_OUT}`);
  if (DRY_RUN) console.log(`   ⚠️  DRY RUN — no files were modified`);
  if (ENABLE_LAYER2 && !LAYER2_OFF) console.log(`   🌐 Layer 2 (cross-script propagation): ENABLED`);
}

if (require.main === module) {
  // CLI mode — run the full audit→repair pipeline (cron path).
  main().catch(e => {
    console.error(`❌ Fatal: ${e.message}`);
    if (e.stack && VERBOSE) console.error(e.stack);
    process.exit(1);
  });
} else {
  // Module being required by other scripts (e.g. proposal_action.js).
  // Export the public API surface without triggering main().
  module.exports = {
    applyFix,
    decideAction,
    findLowRiskRule,
    classifyTier,
    ENABLE_LAYER2,
    ENABLE_CUMULATIVE,
    NO_SNAPSHOT,
  };
}
