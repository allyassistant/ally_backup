#!/usr/bin/env node
/**
 * scripts/after_task_skill_candidate.js — Real-time failure → skill candidate bridge
 *
 * Detects failure signals in a completed task and emits v=3 skill candidate
 * entries to .skill_review_queue.jsonl, so the next time the same task pattern
 * occurs, there's already a skill in the review queue.
 *
 * Triggered by extensions/skill-auto-suggest's after-task-triage hook on
 * every agent_end (Phase A, 2026-06-20).
 *
 * Three failure signals detected (any one triggers emit):
 *   1. error_keyword_density   — LLM output has ≥3 occurrences of error
 *                                keywords ("error", "failed", "錯誤", "崩潰",
 *                                "exception") in a single assistant message.
 *   2. tool_retry_loop         — Same tool called 3+ times with the same
 *                                params (or near-identical) in the same task.
 *                                Indicates LLM is stuck.
 *   3. tool_error_rate_high    — Tool error rate > 30% (3+ errors out of 10+
 *                                tool calls). Indicates broken environment.
 *
 * Skill candidate generation:
 *   - name: derived from the dominant failure pattern
 *           (e.g., "fix-tool-retry-loop", "handle-tool-errors")
 *   - description: 3-segment trigger formula
 *           ("Use when: <pattern detection>. <What to do>. <Example>")
 *
 * Output: v=3 entry in .skill_review_queue.jsonl (matches dedup_gate schema)
 *
 * Usage:
 *   # From CLI (manual):
 *   echo '{"messages":[...],"sessionKey":"..."}' | node scripts/after_task_skill_candidate.js
 *   node scripts/after_task_skill_candidate.js /path/to/event.json
 *
 *   # From extension (preferred): spawned by after-task-triage.mjs hook
 *
 * Exit codes:
 *   0  success (always — fail-open by design)
 *   1  hard error (malformed input, can't proceed)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { WS, SKILL_REVIEW_QUEUE } = require('./lib/config');

// Phase 2h: pre-emit cosine-similarity filter (2026-06-21). Same dedup logic
// as audit/pattern emitters. Loaded via dynamic import (.mjs filter).
let _preEmitFilter = null;
async function getPreEmitFilter() {
  if (_preEmitFilter) return _preEmitFilter;
  try {
    const mod = await import('../extensions/skill-auto-suggest/pre-emit-dedup.mjs');
    _preEmitFilter = mod.preEmitFilter;
    return _preEmitFilter;
  } catch (e) {
    console.error(`[after-task-triage] pre-emit-dedup load failed, falling back to append-only: ${e.message}`);
    _preEmitFilter = async () => ({ action: 'append', reason: 'filter_load_failed' });
    return _preEmitFilter;
  }
}

// ── Failure signals ───────────────────────────────────────────────────────
const ERROR_KEYWORDS_EN = /\b(error|failed|exception|crash|fatal|panic)\b/gi;
const ERROR_KEYWORDS_ZH = /(錯誤|失敗|崩潰|異常|報錯)/g;
const TOOL_RETRY_THRESHOLD = 3;       // same tool+params N times = retry loop
const TOOL_ERROR_RATE_THRESHOLD = 0.3; // >30% tool errors = broken env

function detectErrorKeywordDensity(messages) {
  const matches = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.text) continue;
    const en = (m?.text?.match(ERROR_KEYWORDS_EN) || []).length;
    const zh = (m?.text?.match(ERROR_KEYWORDS_ZH) || []).length;
    if (en + zh >= 3) {
      matches.push({ role: m.role, errorCount: en + zh, snippet: m?.text?.slice(0, 100) });
    }
  }
  return matches;
}

function detectToolRetryLoop(messages) {
  // Tool calls typically live in messages[].toolCalls[] with {name, params} shape.
  const toolCallSig = new Map(); // sig → count
  for (const m of messages) {
    const calls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    for (const c of calls) {
      const name = c.name || c.tool || 'unknown';
      const params = JSON.stringify(c.params || {}).slice(0, 200);
      const sig = `${name}::${params}`;
      toolCallSig.set(sig, (toolCallSig.get(sig) || 0) + 1);
    }
  }
  const loops = [];
  for (const [sig, count] of toolCallSig) {
    if (count >= TOOL_RETRY_THRESHOLD) {
      const [name] = sig.split('::');
      loops.push({ tool: name, count });
    }
  }
  return loops;
}

function detectToolErrorRate(messages) {
  let total = 0;
  let errors = 0;
  for (const m of messages) {
    // Tool errors usually appear as messages with role='tool' + isError=true,
    // or as assistant messages referencing an error.
    if (m.role === 'tool' && (m.isError || m.error)) errors++;
    if (Array.isArray(m.toolCalls)) total += m?.toolCalls?.length;
  }
  if (total < 5) return null; // too few samples
  const rate = errors / total;
  if (rate > TOOL_ERROR_RATE_THRESHOLD) {
    return { total, errors, rate: Number(rate.toFixed(2)) };
  }
  return null;
}

// ── Skill candidate generation ────────────────────────────────────────────
function makeCandidate(name, description, sourceSignals) {
  return {
    proposedSkill: { name, description },
    qualitative_signals: sourceSignals,
  };
}

function buildQueueEntry(candidate, sessionKey, messages, now, runId) {
  const userPrompt = `[auto-triage] session ${sessionKey}: detected failure signals`;
  return {
    v: 3,
    ts: now,
    runId,
    sessionKey,
    userPrompt: userPrompt.slice(0, 500),
    turnCount: messages.length,
    toolCallCount: messages.reduce((s, m) => s + (Array.isArray(m.toolCalls) ? m?.toolCalls?.length : 0), 0),
    success: false, // we only emit on detected failure
    proposedSkill: candidate.proposedSkill,
    qualitative_signals: candidate.qualitative_signals,
    compressed: messages.slice(-3).map(m => ({ role: m.role, text: (m.text || '').slice(0, 200) })), // last 3 msgs
    source: 'after_task_skill_candidate',
    pattern_kind: 'task_failure_signal',
    detection_method: candidate?.qualitative_signals?.detection_method,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  // Read input: stdin OR argv[2] (file path)
  let raw;
  if (process.argv[2]) {
    try {
      raw = fs.readFileSync(process.argv[2], 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
  } else {
    raw = await readStdin();
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch (e) {
    console.error(`[after-task-triage] malformed input JSON: ${e.message}`);
    process.exit(1);
  }

  const messages = Array.isArray(event.messages) ? event.messages : [];
  const sessionKey = event.sessionKey || 'unknown';
  if (messages.length === 0) {
    console.log(JSON.stringify({ ok: true, skipped: 'no_messages' }));
    return;
  }

  // Run all 3 detectors
  const errorDensityHits = detectErrorKeywordDensity(messages);
  const retryLoops = detectToolRetryLoop(messages);
  const errorRate = detectToolErrorRate(messages);

  const candidates = [];

  if (errorDensityHits.length > 0) {
    candidates.push(makeCandidate(
      'recover-from-errors',
      `Use when: an assistant message contains 3+ error keywords (error/failed/錯誤/崩潰) in close succession. The skill should guide recovery: parse the dominant error, check the most recent successful state, retry with adjusted params, and surface remaining issues to the user. Example: when a build script repeatedly fails, isolate the failing step and propose a minimal fix.`,
      { detection_method: 'error_keyword_density', hits: errorDensityHits.length }
    ));
  }

  if (retryLoops.length > 0) {
    const worstLoop = retryLoops.sort((a, b) => b.count - a.count)[0];
    candidates.push(makeCandidate(
      `break-tool-retry-loop-${worstLoop?.tool?.toLowerCase()}`,
      `Use when: the same tool "${worstLoop.tool}" is called ${worstLoop.count}+ times with identical or near-identical params in a single task. The skill should detect the loop, abort the retry, audit the last error, and pivot strategy (different params, different tool, or escalate to user). Example: when read() returns the same file 4 times, stop reading and ask the user for clarification.`,
      { detection_method: 'tool_retry_loop', loops: retryLoops }
    ));
  }

  if (errorRate) {
    candidates.push(makeCandidate(
      'handle-high-tool-error-rate',
      `Use when: tool error rate exceeds 30% (${errorRate.errors}/${errorRate.total} = ${Math.round(errorRate.rate * 100)}%). The skill should diagnose the environment (is openclaw running? are paths correct? are permissions ok?), surface the dominant error, and either auto-fix or pause for user input. Example: when exec() repeatedly fails with ENOENT, check PATH and cwd before retrying.`,
      { detection_method: 'tool_error_rate_high', rate: errorRate.rate, total: errorRate.total, errors: errorRate.errors }
    ));
  }

  if (candidates.length === 0) {
    console.log(JSON.stringify({ ok: true, skipped: 'no_failure_signals', sessionKey }));
    return;
  }

  // Deduplicate by proposedSkill.name (don't queue same candidate twice in same run)
  const seen = new Set();
  const unique = candidates.filter(c => {
    if (seen.has(c?.proposedSkill?.name)) return false;
    seen.add(c?.proposedSkill?.name);
    return true;
  });

  // Append to queue (with pre-emit cosine filter, Phase 2h, 2026-06-21)
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  let appended = 0;
  let skippedPreEmit = 0;
  let patchedPreEmit = 0;
  const preEmitFilter = await getPreEmitFilter();
  for (const c of unique) {
    const entry = buildQueueEntry(c, sessionKey, messages, now, runId);

    // Pre-emit filter — fail-open per design.
    let decision = { action: 'append', reason: 'no_filter' };
    try {
      decision = await preEmitFilter(entry, { source: 'after_task_skill_candidate' });
    } catch (e) {
      console.error(`[after-task-triage] pre-emit filter threw, appending anyway: ${e.message}`);
    }
    if (decision.action === 'skip') {
      skippedPreEmit++;
      continue;
    }
    if (decision.action === 'patch') {
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
      patchedPreEmit++;
    }

    try {
      fs.appendFileSync(SKILL_REVIEW_QUEUE, JSON.stringify(entry) + '\n', 'utf8');
      appended++;
    } catch (e) {
      console.error(`[after-task-triage] queue write failed: ${e.message}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    sessionKey,
    appended,
    skipped_pre_emit: skippedPreEmit,
    patched_pre_emit: patchedPreEmit,
    candidates: unique.map(c => c?.proposedSkill?.name),
    signals: { errorDensityHits: errorDensityHits.length, retryLoops: retryLoops.length, errorRate: errorRate?.rate || null },
  }));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

main().catch(e => {
  console.error(`[after-task-triage] fatal: ${e.message}`);
  process.exit(1);
});
