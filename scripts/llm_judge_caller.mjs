#!/usr/bin/env node
/**
 * llm_judge_caller.mjs — Phase 2: 2-model LLM consensus judge (shadow mode)
 *
 * Calls M3 (minimax-portal/MiniMax-M3) + deepseek-v4-flash in parallel-style
 * (sequential here for shell reliability) → computes consensus verdict.
 *
 * Config (env):
 *   SKILL_JUDGE_MODEL_1       (default minimax-portal/MiniMax-M3)
 *   SKILL_JUDGE_MODEL_2       (default deepseek/deepseek-v4-flash)
 *   SKILL_JUDGE_TIMEOUT_MS    (default 30000)
 *   SKILL_JUDGE_WORKSPACE     (default parent of __dirname)
 *   OPENCLAW_CLI              (default 'openclaw')
 *
 * Usage:
 *   node scripts/llm_judge_caller.mjs --skill-name <name> [--quiet]
 *
 * Output (stdout, single JSON line):
 *   { v:1, ts, skillName, skillDir,
 *     judge1: { model, verdict, confidence, reason, latencyMs, ok },
 *     judge2: { model, verdict, confidence, reason, latencyMs, ok },
 *     consensus: 'both-pass'|'both-junk'|'split'|'skip'|'error',
 *     action: 'symlink'|'quarantine'|'defer-to-M3'|'defer-to-available'|'error',
 *     heuristicResult: { validationPassed, symlinked, sourceEvent } | undefined,
 *     costUsd, shadowMode: true }
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──
const WS = process.env.SKILL_JUDGE_WORKSPACE || path.resolve(__dirname, '..');
const SKILL_LEARNED_DIR = path.join(WS, 'skills-learned');
const SKILL_CREATED_LOG = path.join(WS, '.skill_created.jsonl');
const JUDGE_MODEL_1 = process.env.SKILL_JUDGE_MODEL_1 || 'minimax-portal/MiniMax-M3';
const JUDGE_MODEL_2 = process.env.SKILL_JUDGE_MODEL_2 || 'deepseek/deepseek-v4-flash';
const TIMEOUT_MS = parseInt(process.env.SKILL_JUDGE_TIMEOUT_MS || '45000', 10); // H3: 45s for M3 P95
// C1-fix v3 (14:08 HKT 06-13): OPENCLAW_CLI='1' by OpenClaw runtime. 'which' fails in cron isolated session (no PATH).
// Strategy: known paths first (works in restricted cron env) → which fallback → raw binary name.
const OPENCLAW = (function() {
  const knownPaths = ['/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw'];
  for (const p of knownPaths) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) {}
  }
  try { return execFileSync('which', ['openclaw'], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch (_) { return 'openclaw'; }
})();

const isQuiet = process.argv.includes('--quiet');
const skillNameArgIndex = process.argv.indexOf('--skill-name');
const SKILL_NAME = skillNameArgIndex >= 0 ? process.argv[skillNameArgIndex + 1] : null;

function debug(msg) { if (!isQuiet) console.error('[judge]', msg); }
function err(msg)   { console.error('[judge:ERROR]', msg); }

// ── Prompt builder ──
function buildJudgePrompt(skillName, skillDir) {
  const skPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skPath)) return null;
  const content = fs.readFileSync(skPath, 'utf8').trim();
  if (content.length === 0) return null;

  return [
    '你係 skill file 審計員。評估以下 SKILL.md 質量。',
    '',
    '檢查清單：',
    '1. Frontmatter (name / description / tags) 係唔係完整且合理',
    '2. Description ≤ 160 bytes (Anthropic 標準)',
    '3. Content 係 actionable instruction，定係 stub / placeholder / vague',
    '4. 有冇 meaningful steps (具體可執行嘅步驟)',
    '5. 有冇 pitfalls / warnings (好嘅 skill 通常有)',
    '',
    '--- SKILL.md ---',
    content,
    '--- END ---',
    '',
    'Output 純 JSON，唔好加任何其他文字、解釋、markdown fence：',
    '{"verdict":"pass|junk","confidence":0.0,"reason":"簡短原因"}'
  ].join('\n');
}

// ── Model call (uses openclaw CLI; thin-executor friendly) ──
function callModel(model, prompt) {
  const start = Date.now();
  const promptFile = path.join(WS, '.llm_judge_prompt_' + process.pid + '_' + Date.now() + '.txt');
  try {
    fs.writeFileSync(promptFile, prompt, 'utf8');
    // Use execFileSync with arg array (no shell interpolation; safer).
    // Verified working flags via `openclaw infer model run --help`:
    //   --model <provider/model>  Model override (required)
    //   --prompt <text>           Prompt text (REQUIRED — `--file` is for images only)
    //   --json                    Wrap output in { outputs: [{ text }] } envelope
    // Previously broken flags (all rejected by CLI):
    //   --prompt-file, --quiet, --max-tokens  → all NOT supported
    const out = execFileSync(OPENCLAW, [
      'infer', 'model', 'run',
      '--model', model,
      '--prompt', prompt,
      '--json'
    ], {
      timeout: TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    // Unwrap --json envelope: CLI returns { outputs: [{ text: "<llm text>" }] }.
    // parseVerdict() (out of scope) expects raw LLM text, so extract outputs[0].text.
    let text = (out || '').trim();
    try {
      const outer = JSON.parse(text);
      if (outer && Array.isArray(outer.outputs) && outer.outputs[0] && outer.outputs[0].text) {
        text = outer.outputs[0].text;
      }
    } catch (_) { /* not an envelope, pass through */ }
    return { ok: true, output: text, latencyMs: Date.now() - start, model };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    return {
      ok: false,
      error: stderr || e.message || String(e),
      latencyMs: Date.now() - start,
      model
    };
  } finally {
    try { fs.unlinkSync(promptFile); } catch (_) { /* ignore */ }
  }
}

// ── Verdict parsing ──
function parseVerdict(raw) {
  if (!raw) return { verdict: 'error', confidence: 0, reason: 'empty output' };
  // H2: Balanced-brace JSON extraction (was greedy /\{[\s\S]*\}/)
  function extractJSON(text) {
    var start = text.indexOf('{');
    if (start === -1) return null;
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < text.length; i++) {
      var ch = text[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === '\\') { esc = true; }
        else if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') { depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null; // unbalanced
  }
  var jsonStr = extractJSON(raw);
  if (!jsonStr) return { verdict: 'error', confidence: 0, reason: 'no balanced JSON in model output' };
  try {
    var parsed = JSON.parse(jsonStr);
    var verdict = parsed.verdict === 'pass' ? 'pass'
      : parsed.verdict === 'junk' ? 'junk'
      : 'error';
    var confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    return { verdict: verdict, confidence: confidence, reason: String(parsed.reason || '(no reason)').slice(0, 200) };
  } catch (e) {
    return { verdict: 'error', confidence: 0, reason: 'JSON parse failed: ' + e.message };
  }
}

// ── Consensus logic ──
function computeConsensus(v1, v2) {
  if (v1.verdict === 'error' && v2.verdict === 'error') return 'error';
  if (v1.verdict === 'pass'  && v2.verdict === 'pass')  return 'both-pass';
  if (v1.verdict === 'junk'  && v2.verdict === 'junk')  return 'both-junk';
  // One error + one ok → use the OK side
  if (v1.verdict === 'error' && v2.verdict !== 'error') return 'skip';
  if (v1.verdict !== 'error' && v2.verdict === 'error') return 'skip';
  // Both non-error but disagree → split (M3 wins as tiebreaker)
  return 'split';
}

function getResolvedAction(consensus) {
  switch (consensus) {
    case 'both-pass': return 'symlink';
    case 'both-junk': return 'quarantine';
    case 'split':     return 'defer-to-M3';         // M3 verdict wins (judge1)
    case 'skip':      return 'defer-to-available';  // use OK side
    default:          return 'error';
  }
}

// ── Heuristic cross-reference ──
function findHeuristicResult(skillName) {
  if (!fs.existsSync(SKILL_CREATED_LOG)) return undefined;
  let lines;
  try {
    lines = fs.readFileSync(SKILL_CREATED_LOG, 'utf8').trim().split('\n');
  } catch (_) { return undefined; }
  // Walk backwards — newest event is most relevant
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.name === skillName) {
        return {
          validationPassed: ev.validationPassed,
          symlinked: ev.symlinked,
          sourceEvent: ev.ts
        };
      }
    } catch (_) { /* skip malformed lines */ }
  }
  return undefined;
}

// ── Main judge function (exportable for testing) ──
function judgeSkill(skillName, skillDir) {
  const prompt = buildJudgePrompt(skillName, skillDir);
  if (!prompt) {
    return { error: 'SKILL.md not found or empty', skillName, skillDir, shadowMode: true };
  }

  // Judge 1 (M3)
  const r1 = callModel(JUDGE_MODEL_1, prompt);
  const v1 = r1.ok
    ? parseVerdict(r1.output)
    : { verdict: 'error', confidence: 0, reason: 'call failed: ' + (r1.error || 'unknown').slice(0, 200) };

  // Judge 2 (deepseek-v4-flash)
  const r2 = callModel(JUDGE_MODEL_2, prompt);
  const v2 = r2.ok
    ? parseVerdict(r2.output)
    : { verdict: 'error', confidence: 0, reason: 'call failed: ' + (r2.error || 'unknown').slice(0, 200) };

  const consensus = computeConsensus(v1, v2);
  const action = getResolvedAction(consensus);

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    skillName,
    skillDir,
    judge1: {
      model: JUDGE_MODEL_1,
      verdict: v1.verdict,
      confidence: v1.confidence,
      reason: v1.reason,
      latencyMs: r1.latencyMs,
      ok: r1.ok
    },
    judge2: {
      model: JUDGE_MODEL_2,
      verdict: v2.verdict,
      confidence: v2.confidence,
      reason: v2.reason,
      latencyMs: r2.latencyMs,
      ok: r2.ok
    },
    consensus,
    action,
    shadowMode: true
  };

  const heuristic = findHeuristicResult(skillName);
  if (heuristic) event.heuristicResult = heuristic;

  // Cost estimate (rough): M3 ~$0.02/judge, deepseek-flash ~$0.005/judge
  event.costUsd = (r1.ok ? 0.02 : 0) + (r2.ok ? 0.005 : 0);

  return event;
}

// ── CLI entry ──
if (!SKILL_NAME) {
  console.error('Usage: node scripts/llm_judge_caller.mjs --skill-name <name> [--quiet]');
  process.exit(1);
}

const skillDir = path.join(SKILL_LEARNED_DIR, SKILL_NAME);
if (!fs.existsSync(skillDir)) {
  console.error('Skill directory not found: ' + skillDir);
  process.exit(1);
}

const result = judgeSkill(SKILL_NAME, skillDir);
console.log(JSON.stringify(result));

export { judgeSkill, parseVerdict, computeConsensus, buildJudgePrompt };
