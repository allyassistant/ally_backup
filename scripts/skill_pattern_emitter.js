#!/usr/bin/env node
/**
 * pattern_to_queue_bridge.js — Phase 2c bridge: emit pattern_learner candidates
 *                                into the skill review queue.
 *
 * Design rationale (Phase 2c):
 *   - pattern_learner.js stores learned patterns in:
 *       ~/.openclaw/workspace/memory/patterns/{fp_whitelist,tp_tracker,semantic_whitelist}.json
 *   - skill_reviewer.js consumes queue entries from:
 *       ~/.openclaw/workspace/.skill_review_queue.jsonl
 *   - This bridge connects the two: when a pattern has accumulated enough
 *     samples AND confidence, it is promoted to a queue entry so the LLM
 *     judge in skill_reviewer.js can decide whether to CREATE / PATCH /
 *     SKIP a skill from it.
 *
 * Idempotency:
 *   - A sidecar file `.pattern_bridge_emitted.json` records every pattern_id
 *     that has been emitted, plus its last-seen date and the entry ts.
 *   - Re-running the bridge does NOT duplicate entries. A pattern is only
 *     re-emitted if its `last_seen` has advanced since the prior emission
 *     (so newly added samples are surfaced, but stable patterns are silent).
 *
 * Fail-open:
 *   - Every external call is wrapped in try/catch. Errors are logged via
 *     console.error and the script returns 0. It MUST never throw.
 *
 * Threshold semantics (mirror pattern_learner PL_CONFIG):
 *   - semantic:  auto_apply && confidence >= 0.85 && examples.length >= 3
 *   - fp:        confidence >= 85   && count >= 3
 *   - tp (per rule): count >= 3
 *
 * Invocation:
 *   node scripts/pattern_to_queue_bridge.js            # normal run
 *   node scripts/pattern_to_queue_bridge.js --dry-run  # show what would emit
 *   node scripts/pattern_to_queue_bridge.js --reset    # clear sidecar (debug)
 *
 * Phase: 2c — bridge pattern_learner → skill-learner queue.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { WS, SKILL_REVIEW_QUEUE } = require('./lib/config');
const { PatternLearner, PL_CONFIG } = require('./lib/pattern_learner');

const PATTERNS_DIR = path.join(WS, 'memory', 'patterns');
const EMITTED_SIDECAR = path.join(WS, '.pattern_bridge_emitted.json');
const DRY_RUN = process.argv.includes('--dry-run');
const RESET = process.argv.includes('--reset');

// ── Fail-open logger ──
function logErr(msg, err) {
  try { console.error(`[pattern-bridge] ${msg}${err ? ': ' + err.message : ''}`); } catch (_) {}
}
function logInfo(msg) {
  try { console.log(`[pattern-bridge] ${msg}`); } catch (_) {}
}

// ── Phase 2h: pre-emit cosine-similarity filter (2026-06-21) ──
// Stops pattern_learner from re-emitting candidates that match existing skills.
// Loaded via dynamic import because the filter is .mjs.
let _preEmitFilter = null;
async function getPreEmitFilter() {
  if (_preEmitFilter) return _preEmitFilter;
  try {
    const mod = await import('../extensions/skill-auto-suggest/pre-emit-dedup.mjs');
    _preEmitFilter = mod.preEmitFilter;
    return _preEmitFilter;
  } catch (e) {
    logErr('pre-emit-dedup load failed, falling back to append-only', e);
    _preEmitFilter = async () => ({ action: 'append', reason: 'filter_load_failed' });
    return _preEmitFilter;
  }
}

// ── Sidecar I/O ──
function loadEmitted() {
  if (!fs.existsSync(EMITTED_SIDECAR)) return {};
  try {
    const raw = fs.readFileSync(EMITTED_SIDECAR, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    logErr('sidecar load failed, starting fresh', err);
    return {};
  }
}

function saveEmitted(map) {
  try {
    fs.writeFileSync(EMITTED_SIDECAR, JSON.stringify(map, null, 2), 'utf8');
  } catch (err) {
    logErr('sidecar save failed', err);
  }
}

// ── Threshold helpers (mirror PL_CONFIG semantics) ──
function isReadySemantic(p) {
  if (!p || p.type !== 'semantic') return false;
  if (p.auto_apply !== true) return false;
  if (typeof p.confidence !== 'number' || p.confidence < PL_CONFIG.FP_CONF_THRESHOLD) return false;
  const samples = Array.isArray(p.examples) ? p?.examples?.length : 0;
  return samples >= PL_CONFIG.MIN_SAMPLES_FOR_AUTO_LEARN;
}

function isReadyFp(p) {
  if (!p || typeof p.confidence !== 'number') return false;
  if (p.confidence < PL_CONFIG.FP_CONF_THRESHOLD * 100) return false;  // FP uses 0-100 scale
  const samples = p.count || 0;
  return samples >= PL_CONFIG.MIN_SAMPLES_FOR_AUTO_LEARN;
}

function isReadyTp(ruleGroup) {
  if (!ruleGroup || !Array.isArray(ruleGroup.patterns)) return false;
  return ruleGroup?.patterns?.length >= PL_CONFIG.MIN_SAMPLES_FOR_AUTO_LEARN;
}

// ── Pattern walk ──
// Returns array of { id, kind, pattern, lastSeen, samples } objects
// ready to be emitted.
function collectReadyPatterns(learner) {
  const ready = [];
  try {
    // 1. Semantic whitelist (the most class-level signal — best skill candidate)
    const semanticPath = path.join(PATTERNS_DIR, PL_CONFIG.SEMANTIC_WHITELIST_FILE);
    if (fs.existsSync(semanticPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(semanticPath, 'utf8'));
        for (const p of (data.patterns || [])) {
          if (isReadySemantic(p)) {
            ready.push({
              id: `semantic:${p.name}:${p.rule}`,
              kind: 'semantic',
              pattern: p,
              lastSeen: p.last_seen || p.learned_at || '',
              samples: (p.examples || []).length
            });
          }
        }
      } catch (err) { logErr('semantic whitelist read failed', err); }
    }

    // 2. FP whitelist (file:line patterns — narrower, useful for PATCH)
    const fpPath = path.join(PATTERNS_DIR, PL_CONFIG.FP_WHITELIST_FILE);
    if (fs.existsSync(fpPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(fpPath, 'utf8'));
        for (const p of (data.patterns || [])) {
          if (isReadyFp(p)) {
            ready.push({
              id: `fp:${p.pattern_key || p.id}`,
              kind: 'fp',
              pattern: p,
              lastSeen: p.last_seen || p.learned_at || '',
              samples: p.count || 0
            });
          }
        }
      } catch (err) { logErr('fp whitelist read failed', err); }
    }

    // 3. TP tracker (per-rule group) — emit one candidate per rule group
    const tpPath = path.join(PATTERNS_DIR, PL_CONFIG.TP_TRACKER_FILE);
    if (fs.existsSync(tpPath)) {
      try {
        const raw = fs.readFileSync(tpPath, 'utf8');
        const data = raw.trim() ? JSON.parse(raw) : null;
        // tp_tracker.json in production is sometimes literal null or '{}'
        // — mirror PatternLearner._loadTpTracker and treat as empty.
        const safeData = (data && typeof data === 'object') ? data : { by_rule: {} };
        const byRule = safeData.by_rule || {};
        for (const [rule, group] of Object.entries(byRule)) {
          if (isReadyTp(group)) {
            // Synthesize an id from rule + first/last seen
            const lastEntry = group.patterns[group?.patterns?.length - 1] || {};
            const lastSeen = lastEntry.learned_at || '';
            ready.push({
              id: `tp:${rule}`,
              kind: 'tp',
              pattern: {
                rule,
                patterns: group.patterns,
                count: group?.patterns?.length
              },
              lastSeen,
              samples: group?.patterns?.length
            });
          }
        }
      } catch (err) { logErr('tp tracker read failed', err); }
    }
  } catch (err) {
    logErr('collectReadyPatterns failed', err);
  }
  return ready;
}

// ── Queue entry builder ──
// Schema is v=3, extending v=2 with two new optional fields:
//   source: "pattern_learner"
//   pattern_kind: "semantic" | "fp" | "tp"
//   pattern: { ...pattern-specific payload... }
//
// skill_reviewer.js's readQueue() and aggregate_signals.js's
// aggregateSignals() are both backward-compatible: they only require
// `compressed` (or `toolCallCount`) to be present, and the new fields
// are simply ignored by aggregates. The LLM prompt builder at line 875
// reads `userPrompt` and `compressed`, so the entry shows up like a
// normal candidate with a special "user asked" message.
function buildQueueEntry(ready, now) {
  const ts = now || new Date().toISOString();
  const runId = 'pattern_bridge_' + crypto.randomBytes(6).toString('hex');

  let userPrompt, kindLabel, extra = {}, proposedSkill;
  if (ready.kind === 'semantic') {
    const p = ready.pattern;
    kindLabel = `semantic pattern "${p.name}" for rule "${p.rule}"`;
    userPrompt = `[Pattern bridge] ${kindLabel} (${ready.samples} samples, confidence ${Math.round((p.confidence || 0) * 100)}%) — candidate skill: document when to apply and when to ignore`;
    extra = {
      semantic_name: p.name,
      semantic_rule: p.rule,
      matcher: p.matcher || null,
      explanation: p.matcher?.explanation || '',
      auto_apply: !!p.auto_apply,
      examples: (p.examples || []).slice(0, 3),
      learned_at: p.learned_at || ''
    };
    // Top-level proposedSkill: dedup_gate contract (scripts/lib/skill_dedup_gate.js:337).
    // Without this, the entry is silently skipped and the LLM judge treats it as junk.
    proposedSkill = {
      name: p.name || `semantic-${p.rule}`,
      description: p.matcher?.explanation || `Semantic pattern detector for rule "${p.rule}" (${ready.samples} samples)`,
    };
  } else if (ready.kind === 'fp') {
    const p = ready.pattern;
    kindLabel = `FP pattern "${p.rule}" at ${p.file || p.pattern_key}`;
    userPrompt = `[Pattern bridge] ${kindLabel} (${ready.samples} samples, confidence ${p.confidence}%) — candidate skill: add to scanner pitfall list`;
    extra = {
      fp_file: p.file,
      fp_line: p.line,
      fp_rule: p.rule,
      confidence: p.confidence,
      sample_reasoning: (p.examples || []).slice(0, 3).map(e => e.reasoning).filter(Boolean)
    };
    proposedSkill = {
      name: `fp-${p.rule}-pitfall`,
      description: `Pitfall detector for false-positive "${p.rule}" patterns (${ready.samples} samples, ${p.confidence}% confidence at ${p.file || p.pattern_key || 'unknown'})`,
    };
  } else if (ready.kind === 'tp') {
    const p = ready.pattern;
    kindLabel = `TP pattern for rule "${p.rule}" (${ready.samples} hits)`;
    userPrompt = `[Pattern bridge] ${kindLabel} — candidate skill: encode as explicit check / test pattern`;
    extra = {
      tp_rule: p.rule,
      hit_count: ready.samples,
      sample_paths: (p.patterns || []).slice(0, 3).map(x => `${x.file}:${x.line}`)
    };
    proposedSkill = {
      name: `tp-${p.rule}-pattern`,
      description: `Test pattern encoder for "${p.rule}" (${ready.samples} historical hits, encode as explicit check)`,
    };
  } else {
    userPrompt = `[Pattern bridge] unknown pattern kind: ${ready.kind}`;
    proposedSkill = { name: `unknown-pattern-${ready.kind}`, description: userPrompt };
  }

  return {
    v: 3,
    ts,
    runId,
    userPrompt: userPrompt.slice(0, 500),
    turnCount: 1,
    toolCallCount: 0,
    success: true,
    error: null,
    // Top-level proposedSkill: dedup_gate contract. Fix added 2026-06-20.
    proposedSkill,
    qualitative_signals: {},
    compressed: [
      { role: 'user', text: userPrompt.slice(0, 1000), toolCalls: 0, toolNames: [], toolSummary: '' }
    ],
    source: 'pattern_learner',
    pattern_kind: ready.kind,
    pattern: {
      id: ready.id,
      kind: ready.kind,
      last_seen: ready.lastSeen,
      samples: ready.samples,
      ...extra
    }
  };
}

// ── Idempotency: re-emit only if last_seen changed since prior emission ──
function shouldEmit(id, lastSeen, emitted) {
  const prior = emitted[id];
  if (!prior) return true;
  if (!lastSeen) return false;
  return lastSeen !== prior.lastSeen;
}

// ── Main ──
async function main() {
  if (RESET) {
    try { if (fs.existsSync(EMITTED_SIDECAR)) fs.unlinkSync(EMITTED_SIDECAR); } catch (_) {}
    logInfo('sidecar reset');
    process.exit(0);
  }

  // Use PatternLearner for stats (no learn() call — read-only).
  // Wrap in try/catch so a broken pattern_learner can't fail the bridge.
  let learner;
  try { learner = new PatternLearner(); } catch (err) { logErr('PatternLearner construct failed', err); learner = null; }

  let stats = null;
  try { stats = learner ? learner.getStats() : null; } catch (err) { logErr('getStats failed', err); }
  // Semantic whitelist count isn't in getStats() — count directly from disk.
  let semanticCount = 0;
  try {
    const semPath = path.join(PATTERNS_DIR, PL_CONFIG.SEMANTIC_WHITELIST_FILE);
    if (fs.existsSync(semPath)) {
      const d = JSON.parse(fs.readFileSync(semPath, 'utf8'));
      semanticCount = (d.patterns || []).length;
    }
  } catch (_) { /* fail-open */ }
  if (stats) logInfo(`PatternLearner state — fp=${stats?.fp_whitelist?.total}, tp=${stats?.tp_tracker?.total}, semantic=${semanticCount}`);

  const ready = collectReadyPatterns(learner);
  logInfo(`ready patterns: ${ready.length}`);

  const emitted = loadEmitted();
  const now = new Date().toISOString();
  let emittedCount = 0;
  let skippedCount = 0;
  let skippedPreEmit = 0;
  let patchedPreEmit = 0;

  const preEmitFilter = await getPreEmitFilter();

  for (const r of ready) {
    if (!shouldEmit(r.id, r.lastSeen, emitted)) {
      skippedCount++;
      continue;
    }

    const entry = buildQueueEntry(r, now);

    if (DRY_RUN) {
      // Run the filter in dry-run mode so we see what it would do.
      const decision = await preEmitFilter(entry, { dryRun: true, source: 'skill_pattern_emitter' });
      const tag = decision.action === 'skip' ? '⏭️  SKIP' : decision.action === 'patch' ? '🔧 PATCH' : '✅ APPEND';
      logInfo(`DRY-RUN ${tag}: ${r.id} (last_seen=${r.lastSeen}, samples=${r.samples}, reason=${decision.reason}${decision.matchedSkill ? `, matched=${decision.matchedSkill}` : ''})`);
      if (decision.action === 'skip') skippedPreEmit++;
      else if (decision.action === 'patch') { patchedPreEmit++; emittedCount++; }
      else emittedCount++;
    } else {
      // Live path: pre-emit filter decides whether to actually append.
      let decision = { action: 'append', reason: 'no_filter' };
      try {
        decision = await preEmitFilter(entry, { source: 'skill_pattern_emitter' });
      } catch (e) {
        logErr('pre-emit filter threw, appending anyway', e);
      }
      if (decision.action === 'skip') {
        logInfo(`⏭️  pre-emit SKIP: ${r.id} (${decision.reason}, matched=${decision.matchedSkill})`);
        skippedPreEmit++;
        // Still record the skip in sidecar so we don't re-attempt next run
        emitted[r.id] = { ts: now, lastSeen: r.lastSeen, samples: r.samples, skipped_pre_emit: true, matched: decision.matchedSkill };
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
        logInfo(`🔧 pre-emit PATCH: ${r.id} (${decision.reason}, matched=${decision.matchedSkill})`);
        patchedPreEmit++;
      }
      try {
        fs.appendFileSync(SKILL_REVIEW_QUEUE, JSON.stringify(entry) + '\n', 'utf8');
        emitted[r.id] = { ts: now, lastSeen: r.lastSeen, samples: r.samples };
        emittedCount++;
        logInfo(`emitted: ${r.id}`);
      } catch (err) {
        logErr(`emit failed for ${r.id}`, err);
      }
    }
  }

  if (!DRY_RUN) saveEmitted(emitted);

  logInfo(`done — emitted=${emittedCount} skipped=${skippedCount} skipped_pre_emit=${skippedPreEmit} patched_pre_emit=${patchedPreEmit} dry_run=${DRY_RUN}`);

  // ALWAYS exit 0 — fail-open per design
  process.exit(0);
}

// Wrap the entire main in a top-level try/catch so the script
// can never throw uncaught (e.g. if require() of pattern_learner fails).
try {
  main();
} catch (err) {
  logErr('unhandled exception in main()', err);
  process.exit(0);
}
