#!/usr/bin/env node
/**
 * fix_m3_advisory.js — M3 advisory for audit_repair_proposer decisions
 *
 * Each fix decision (auto-fix vs propose) is consulted with M3 (MiniMax-M3)
 * in shadow mode by default. M3's verdict is logged for alignment analysis
 * but does NOT affect the action in shadow mode.
 *
 * After 7+ days of shadow with low catastrophic-mismatch rate, this can be
 * promoted to ACTIVE mode (FIX_M3_MODE=active) where M3 verdict becomes
 * the source of truth for novel rules.
 *
 * Mode:
 *   FIX_M3_MODE=off      Default: do not call M3 (no overhead)
 *   FIX_M3_MODE=shadow   Default once enabled: call M3, log verdict, do NOT affect action
 *   FIX_M3_MODE=active   M3 verdict is authoritative (with safety overrides for critical)
 *
 * Skips M3 for:
 *   - Already-trusted rules (cumulative approval, no need)
 *   - Critical severity (always manual regardless)
 *   - low risk rules (heuristic sufficient, M3 would just confirm)
 *
 * Usage:
 *   const m3 = require('./fix_m3_advisory');
 *   const result = m3.consultM3({ ruleId, file, severity, tier, message, heuristicDecision });
 *
 *   result = { ok, verdict: 'approve'|'reject'|'uncertain', confidence, reasoning, latencyMs }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { WS, STATE_DIR } = require('./lib/config');
const cumulativeApprovals = require('./lib/cumulative_approvals');

const ADVISORY_LOG = path.join(STATE_DIR, 'fix_m3_advisory.jsonl');
const ADVISORY_CURSOR = path.join(STATE_DIR, 'fix_m3_advisory_cursor.json');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const M3_MODEL = 'minimax-portal/MiniMax-M3';
const ADVISORY_TIMEOUT_MS = 15000; // 15s, fail-soft
const MAX_BUFFER_BYTES = 1024 * 1024;

// FIX_M3_MODE env:
//   off    — never call M3 (zero overhead)
//   shadow — call M3, log verdict, do NOT change action (default when ENABLE=true)
//   active — M3 verdict is authoritative (with safety overrides)
const MODE = process.env.FIX_M3_MODE || 'off';
const ENABLED = MODE !== 'off';

// Per-run call cap (avoid runaway cost if heuristic misses many novel rules)
const MAX_CALLS_PER_RUN = parseInt(process.env.FIX_M3_MAX_PER_RUN || '20', 10);

// Track calls per process (so each audit_repair_proposer run caps at MAX_CALLS_PER_RUN)
let _callsThisRun = 0;
let _shadowCounts = { agree: 0, disagree: 0, m3_error: 0, m3_uncertain: 0, skip: 0 };

function logErr(msg) { try { console.error(`[fix-m3] ${msg}`); } catch (_) {} }
function logInfo(msg) { try { console.log(`[fix-m3] ${msg}`); } catch (_) {} }

function resetRunState() {
  _callsThisRun = 0;
  _shadowCounts = { agree: 0, disagree: 0, m3_error: 0, m3_uncertain: 0, skip: 0 };
}

function getRunCounts() {
  return { ..._shadowCounts, total: _callsThisRun };
}

// ── Build M3 prompt ─────────────────────────────────────────────────────
// Returns a focused prompt asking M3 to verify a fix decision.
function buildPrompt({ ruleId, file, line, severity, tier, message, heuristicDecision, heuristicReason }) {
  return `You are an advisory LLM judging whether a code fix should be auto-applied.

# Decision context
- Rule: ${ruleId}
- File: ${file}${line ? ':' + line : ''}
- Severity: ${severity}
- Tier: ${tier}
${message ? `- Issue: ${message.slice(0, 200)}` : ''}

# Heuristic decision
${heuristicDecision} (${heuristicReason})

# Your task
Respond with JSON only, no other text:
{
  "verdict": "approve" | "reject" | "uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "1-2 sentence explanation"
}

Verdict semantics:
- approve: the fix is safe to apply as proposed
- reject: the fix is unsafe, has bugs, or the issue is misdiagnosed
- uncertain: insufficient context or genuinely ambiguous (fall back to human review)

Be conservative. If the fix touches:
- Configuration (e.g., paths, env vars) → usually approve but flag if risky
- fs operations (writeFileSync etc) → usually approve (well-trodden pattern)
- Logic flow / control flow → be more careful, may be uncertain
- Multi-line structural change → usually uncertain (needs human eyes)
- Delete operations → reject (too risky without backup verification)`;
}

// ── Call M3 via openclaw CLI ────────────────────────────────────────────
function callM3(prompt) {
  const start = Date.now();
  try {
    const out = execFileSync(OPENCLAW_BIN, [
      'infer', 'model', 'run',
      '--model', M3_MODEL,
      '--prompt', prompt,
      '--json'
    ], {
      timeout: ADVISORY_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let text = (out || '').trim();
    // Unwrap --json envelope
    try {
      const outer = JSON.parse(text);
      if (outer && Array.isArray(outer.outputs) && outer.outputs[0] && outer.outputs[0].text) {
        text = outer.outputs[0].text;
      }
    } catch (_) {}
    return { ok: true, output: text, latencyMs: Date.now() - start };
  } catch (e) {
    const isTimeout = e.code === 'ETIMEDOUT' || /timeout/i.test(e.message || '');
    return {
      ok: false,
      isTimeout,
      error: (e.stderr || e.message || String(e)).slice(0, 300),
      latencyMs: Date.now() - start,
    };
  }
}

// ── Parse M3 response ───────────────────────────────────────────────────
function parseM3Response(raw) {
  if (!raw) return { verdict: 'uncertain', confidence: 0, reasoning: 'empty output' };
  // Find balanced JSON
  const start = raw.indexOf('{');
  if (start === -1) return { verdict: 'uncertain', confidence: 0, reasoning: 'no JSON in response' };
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return { verdict: 'uncertain', confidence: 0, reasoning: 'unbalanced JSON' };
  try {
    const parsed = JSON.parse(raw.slice(start, end));
    if (typeof parsed.verdict !== 'string') {
      return { verdict: 'uncertain', confidence: 0, reasoning: 'missing verdict field' };
    }
    const verdict = ['approve', 'reject', 'uncertain'].includes(parsed.verdict) ? parsed.verdict : 'uncertain';
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    const reasoning = String(parsed.reasoning || '(no reasoning)').slice(0, 200);
    return { verdict, confidence, reasoning };
  } catch (e) {
    return { verdict: 'uncertain', confidence: 0, reasoning: 'JSON parse failed: ' + e.message };
  }
}

// ── Log advisory ────────────────────────────────────────────────────────
function logAdvisory(record) {
  try {
    if (!fs.existsSync(ADVISORY_LOG)) {
      fs.writeFileSync(ADVISORY_LOG, '', { mode: 0o644, flag: 'a' });
      try { fs.chmodSync(ADVISORY_LOG, 0o644); } catch (_) {}
    }
    // Rotation protection
    try {
      const stats = fs.statSync(ADVISORY_LOG);
      if (stats.size > 10 * 1024 * 1024) { // 10MB
        fs.renameSync(ADVISORY_LOG, ADVISORY_LOG + '.old');
      }
    } catch (_) {}
    fs.appendFileSync(ADVISORY_LOG, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    logErr(`log write failed: ${e.message}`);
  }
}

// ── Main API ────────────────────────────────────────────────────────────
/**
 * Consult M3 on a fix decision.
 *
 * @param {object} args
 * @param {string} args.ruleId      — audit rule id (e.g., 'fsSync_missing_trycatch')
 * @param {string} args.file        — file path
 * @param {number} [args.line]      — line number
 * @param {string} args.severity    — critical | high | medium | low
 * @param {string} args.tier        — production | utility | debug
 * @param {string} [args.message]   — issue description
 * @param {string} args.heuristicDecision — 'auto-fix' | 'propose'
 * @param {string} args.heuristicReason   — why heuristic made this decision
 *
 * @returns {object} { skipped, ok, verdict, confidence, reasoning, latencyMs, alignment }
 *   - skipped: true if M3 not consulted (off mode, already trusted, critical, etc.)
 *   - ok: true if M3 was consulted and responded
 *   - verdict: 'approve' | 'reject' | 'uncertain' | 'skip'
 *   - alignment: 'agree' | 'disagree' | 'uncertain' | 'm3-error' | 'm3-timeout'
 */
function consultM3(args) {
  const skipReason = shouldSkip(args);
  if (skipReason) {
    _shadowCounts.skip++;
    return { skipped: true, reason: skipReason };
  }

  if (_callsThisRun >= MAX_CALLS_PER_RUN) {
    _shadowCounts.skip++;
    return { skipped: true, reason: `max calls per run (${MAX_CALLS_PER_RUN}) reached` };
  }

  _callsThisRun++;
  const prompt = buildPrompt(args);
  const callResult = callM3(prompt);

  let m3Verdict, m3Confidence, m3Reasoning, alignment;
  if (!callResult.ok) {
    if (callResult.isTimeout) {
      _shadowCounts.m3_error++;
      alignment = 'm3-timeout';
    } else {
      _shadowCounts.m3_error++;
      alignment = 'm3-error';
    }
    m3Verdict = 'uncertain';
    m3Confidence = 0;
    m3Reasoning = `M3 ${alignment}: ${callResult.error}`;
  } else {
    const parsed = parseM3Response(callResult.output);
    m3Verdict = parsed.verdict;
    m3Confidence = parsed.confidence;
    m3Reasoning = parsed.reasoning;
    // Compute alignment with heuristic
    if (args.heuristicDecision === 'auto-fix' && m3Verdict === 'approve') alignment = 'agree';
    else if (args.heuristicDecision === 'propose' && m3Verdict === 'reject') alignment = 'agree';
    else if (m3Verdict === 'uncertain') { _shadowCounts.m3_uncertain++; alignment = 'uncertain'; }
    else { _shadowCounts.disagree++; alignment = 'disagree'; }
    if (alignment === 'agree') _shadowCounts.agree++;
  }

  // Log
  logAdvisory({
    ts: new Date().toISOString(),
    rule: args.ruleId,
    file: args.file,
    line: args.line,
    severity: args.severity,
    tier: args.tier,
    heuristic_decision: args.heuristicDecision,
    heuristic_reason: args.heuristicReason,
    m3_verdict: m3Verdict,
    m3_confidence: m3Confidence,
    m3_reasoning: m3Reasoning,
    alignment,
    latency_ms: callResult.latencyMs,
    mode: MODE,
  });

  return {
    skipped: false,
    ok: callResult.ok,
    verdict: m3Verdict,
    confidence: m3Confidence,
    reasoning: m3Reasoning,
    latencyMs: callResult.latencyMs,
    alignment,
  };
}

function shouldSkip(args) {
  if (!ENABLED) return `FIX_M3_MODE=off`;
  if (args.severity === 'critical') return 'critical severity always manual';
  if (cumulativeApprovals.isTrusted(args.ruleId)) return 'cumulative trust — already human-approved';
  if (cumulativeApprovals.getRisk(args.ruleId) === 'low' && args.tier === 'utility') {
    return 'low risk + utility tier — heuristic sufficient';
  }
  return null;
}

// ── Mode helpers ────────────────────────────────────────────────────────
function getMode() { return MODE; }
function isActive() { return MODE === 'active'; }
function isShadow() { return MODE === 'shadow'; }
function isEnabled() { return ENABLED; }

module.exports = {
  MODE,
  ENABLED,
  MAX_CALLS_PER_RUN,
  ADVISORY_LOG,
  consultM3,
  shouldSkip,
  resetRunState,
  getRunCounts,
  getMode,
  isActive,
  isShadow,
  isEnabled,
};

// CLI entry point — analyze shadow log
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'summary' && fs.existsSync(ADVISORY_LOG)) {
    let lines;
    try {
      lines = fs.readFileSync(ADVISORY_LOG, 'utf8').split('\n').filter(Boolean);
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    const summary = { total: lines.length, agree: 0, disagree: 0, uncertain: 0, m3_error: 0, m3_timeout: 0 };
    const byMode = {};
    const byRule = {};
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        summary[e.alignment] = (summary[e.alignment] || 0) + 1;
        byMode[e.mode] = (byMode[e.mode] || 0) + 1;
        if (!byRule[e.rule]) byRule[e.rule] = { agree: 0, disagree: 0, uncertain: 0, m3_error: 0, m3_timeout: 0, total: 0 };
        byRule[e.rule][e.alignment] = (byRule[e.rule][e.alignment] || 0) + 1;
        byRule[e.rule].total++;
      } catch (_) {}
    }
    console.log(JSON.stringify({ summary, byMode, byRule }, null, 2));
  } else if (args[0] === 'mode') {
    console.log(`FIX_M3_MODE: ${MODE}`);
    console.log(`ENABLED: ${ENABLED}`);
    console.log(`MAX_CALLS_PER_RUN: ${MAX_CALLS_PER_RUN}`);
  } else {
    console.log(`fix_m3_advisory.js — M3 advisory for fix decisions

Env:
  FIX_M3_MODE=off|shadow|active    (default: off)
  FIX_M3_MAX_PER_RUN=N            (default: 20)

Usage:
  node scripts/fix_m3_advisory.js summary    # show alignment stats
  node scripts/fix_m3_advisory.js mode      # show current mode

Module:
  const m3 = require('./fix_m3_advisory');
  m3.consultM3({ ruleId, file, severity, tier, message, heuristicDecision, heuristicReason });
`);
  }
}
