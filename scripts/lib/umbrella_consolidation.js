#!/usr/bin/env node
/**
 * umbrella_consolidation.js — LLM-driven consolidation analysis for skills
 *
 * Analyzes pairs of similar skills and produces structured merge proposals.
 * Uses MiniMax M3 through the OpenClaw gateway when available; falls back
 * to a built-in heuristic analyzer when the LLM is unreachable.
 *
 * Phase B of the Umbrella Consolidation feature.
 *
 * Usage:
 *   const { analyzePair } = require('./umbrella_consolidation');
 *   const result = await analyzePair({ skillA, skillB, score, bodyA, bodyB });
 *   // → { shouldMerge: bool, umbrellaName: string, reason: string, supportFilesToMove: [{from, to}] }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isSafeSupportPath, MAX_SUPPORT_PATH_LEN } = require('./path_safety');

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER = 1024 * 256;
const PCT = 100;
// MAX_SUPPORT_PATH_LEN imported from lib/path_safety.js (Issue #133 DRY cleanup)

// ─── Prompt Template ────────────────────────────────────────────────────────

/**
 * Format a Hermes-style consolidation prompt for a skill pair.
 *
 * @param {{ skillA: string, skillB: string, score: number, bodyA: string, bodyB: string }} pair
 * @returns {string} Formatted prompt
 */
function formatConsolidationPrompt(pair) {
  const { skillA, skillB, score, bodyA, bodyB } = pair;

  return `You are analyzing two related skills for potential consolidation.

## Skill A
Name: ${skillA}
Body:
${bodyA}

## Skill B
Name: ${skillB}
Body:
${bodyB}

## Jaccard Similarity: ${score}

## Hermes consolidation rules:
1. PREFER one broad umbrella with labeled subsections over many narrow siblings
2. Only merge if the two skills share a clear class-level concept
3. If skill B is a session-specific instance of skill A's class, suggest absorption
4. If they're orthogonal (different topics), do NOT merge

## Output (strict YAML):
\`\`\`yaml
shouldMerge: bool
umbrellaName: string
reason: string
supportFilesToMove:
  - from: skill-name/references/file.md
    to: umbrella-name/references/file.md
\`\`\`
`;
}

// ─── LLM Call ──────────────────────────────────────────────────────────────

/**
 * Call the MiniMax M3 LLM via OpenClaw gateway agent command.
 *
 * Uses execSync to run: openclaw agent --local --json --model minimax-portal/MiniMax-M2.7
 *
 * Falls back to heuristic analysis if the LLM is unavailable (gateway down,
 * model timeout, or exec failure).
 *
 * @param {string} prompt - Consolidated prompt text
 * @returns {Promise<string>} Raw LLM response text
 */
async function callLLM(prompt) {
  // Strategy: try openclaw agent CLI first, then fallback
  try {
    return await callLLMViaGateway(prompt);
  } catch (err) {
    console.warn(`[umbrella] LLM via gateway failed: ${err.message}. Trying heuristic fallback.`);
    return null;
  }
}

/**
 * Call the LLM via `openclaw agent --json` subprocess.
 *
 * Uses a temp-file approach for the prompt to avoid shell escaping issues.
 * Temp file is always cleaned up via try/finally — even on execSync failure
 * or unexpected throw — so the temp dir is never littered (BUG-1 fix).
 */
async function callLLMViaGateway(prompt) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(
      require('os').tmpdir(),
      `umbrella-prompt-${Date.now()}.txt`
    );
    let tmpWritten = false;

    try {
      try {
        fs.writeFileSync(tmpFile, prompt, 'utf8');
        tmpWritten = true;
      } catch (writeErr) {
        return reject(new Error(`Failed to write prompt temp file: ${writeErr.message}`));
      }

      const cmd = `openclaw agent --local --json --model minimax-portal/MiniMax-M2.7 --message "$(cat ${tmpFile})" --thinking high 2>/dev/null`;

      let stdout;
      try {
        stdout = execSync(cmd, {
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: EXEC_MAX_BUFFER,
        });
      } catch (execErr) {
        return reject(new Error(`execSync failed: ${execErr.message}`));
      }

      const raw = stdout.toString('utf8').trim();
      if (!raw) {
        return reject(new Error('Empty LLM response'));
      }

      // Try to parse JSON response (openclaw agent --json returns JSON)
      try {
        const parsed = JSON.parse(raw);
        // Extract message content from OpenClaw agent response format
        const content = parsed?.reply || parsed?.message || parsed?.content || parsed?.text || raw;
        resolve(String(content));
      } catch {
        // Not JSON — use raw text
        resolve(raw);
      }
    } catch (err) {
      reject(err);
    } finally {
      // BUG-1 fix: always clean up temp file (write OR no-write, success OR failure)
      if (tmpWritten) {
        try { fs.unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
      }
    }
  });
}

// ─── Response Parser ────────────────────────────────────────────────────────

/**
 * Parse LLM YAML output into a structured result.
 *
 * Extracts YAML code blocks (```yaml ... ```) from the response and parses them.
 * Falls back to scanning for key: value patterns if no YAML block is found.
 *
 * @param {string} raw - Raw LLM response text
 * @returns {{ shouldMerge: boolean, umbrellaName: string, reason: string, supportFilesToMove: Array<{from: string, to: string}> }}
 */
function parseYAMLResponse(raw) {
  const result = {
    shouldMerge: false,
    umbrellaName: '',
    reason: '',
    supportFilesToMove: [],
  };

  if (!raw || typeof raw !== 'string') return result;

  // Extract YAML code block: ```yaml ... ```
  const yamlMatch = raw.match(/```(?:yaml)?\s*\n([\s\S]*?)```/);
  const yamlContent = yamlMatch ? yamlMatch[1].trim() : raw;

  // Parse shouldMerge
  const shouldMergeMatch = yamlContent.match(/shouldMerge:\s*(true|false|yes|no)/i);
  if (shouldMergeMatch) {
    result.shouldMerge = /true|yes/i.test(shouldMergeMatch[1]);
  }

  // Parse umbrellaName
  const nameMatch = yamlContent.match(/umbrellaName:\s*"?([^"\n]+)"?/);
  if (nameMatch) {
    result.umbrellaName = nameMatch[1].trim();
  }

  // Parse reason
  const reasonMatch = yamlContent.match(/reason:\s*"?([^"\n]+)"?/);
  if (reasonMatch) {
    result.reason = reasonMatch[1].trim();
  } else {
    // Multi-line reason fallback
    const reasonBlock = yamlContent.match(/reason:\s*("([^"]*)"|'([^']*)'|([\s\S]*?)(?=\n\w+:|\n$|$))/);
    if (reasonBlock) {
      result.reason = (reasonBlock[2] || reasonBlock[3] || reasonBlock[4] || '').trim();
    }
  }

  // Parse supportFilesToMove
  const fileSection = yamlContent.match(/supportFilesToMove:\s*\n((?:\s*-[^]*?)(?=\n\w|$))/);
  if (fileSection) {
    const filePattern = /-\s*from:\s*"?([^"\n]+)"?\s*\n\s*to:\s*"?([^"\n]+)"?/g;
    let fileMatch;
    while ((fileMatch = filePattern.exec(fileSection[1])) !== null) {
      // BUG-3 fix: sanitize paths to prevent path traversal / injection.
      // Reject values that escape the umbrella directory (containing `..`,
      // absolute paths, or control chars). This stops a malicious skill name
      // or YAML anchor from injecting `../etc/passwd` style payloads.
      // Uses shared isSafeSupportPath() from lib/path_safety.js (Issue #133 DRY cleanup).
      const rawFrom = fileMatch[1].trim();
      const rawTo = fileMatch[2].trim();
      const safeFrom = isSafeSupportPath(rawFrom);
      const safeTo = isSafeSupportPath(rawTo);
      if (safeFrom && safeTo) {
        result.supportFilesToMove.push({ from: safeFrom, to: safeTo });
      }
      // If isSafeSupportPath returns null, the entry is silently dropped —
      // safer than throwing mid-parse and losing the whole LLM response.
    }
  }

  return result;
}

/**
 * Sanitize a support-file path extracted from LLM YAML output (BUG-3 fix).
 * Moved to lib/path_safety.js as isSafeSupportPath() — see import above.
 * (Issue #133 DRY cleanup: this duplication removed.)
 */

// ─── Heuristic Fallback Analyzer ────────────────────────────────────────────

/**
 * Heuristic fallback analyzer — no LLM needed.
 *
 * Uses Jaccard overlap strength to determine merge:
 * - score > 0.7: always suggest merge
 * - score > 0.5: check topic overlap in names
 * - score ≤ 0.5: don't merge
 */
function heuristicAnalyzePair(pair) {
  const { skillA, skillB, score, bodyA, bodyB } = pair;
  const result = {
    shouldMerge: false,
    umbrellaName: '',
    reason: '',
    supportFilesToMove: [],
  };

  if (score >= 0.7) {
    result.shouldMerge = true;
    result.umbrellaName = skillA.length <= skillB.length ? skillA : skillB;
    result.reason = `High similarity (${(score * PCT).toFixed(0)}%) — strong lexical overlap suggests shared domain.`;
    result.supportFilesToMove = [
      { from: `${skillA}/SKILL.md`, to: `${result.umbrellaName}/skills/${skillA}.md` },
      { from: `${skillB}/SKILL.md`, to: `${result.umbrellaName}/skills/${skillB}.md` },
    ];
  } else if (score > 0.5) {
    // BUG-2 fix: strict-greater-than (>) prevents auto-trigger at exact 0.5 boundary.
    // Old `<=` / `>= 0.5` always fired at exactly 0.5, which violated the
    // "should NOT trigger below threshold" semantic.
    // Check if skill names share common tokens
    const tokensA = skillA.toLowerCase().split(/[\s_-]+/).filter(Boolean);
    const tokensB = skillB.toLowerCase().split(/[\s_-]+/).filter(Boolean);
    const commonTokens = tokensA.filter(t => tokensB.includes(t));

    if (commonTokens.length > 0) {
      result.shouldMerge = true;
      result.umbrellaName = commonTokens.join('-');
      result.reason = `Moderate similarity (${(score * PCT).toFixed(0)}%) with shared name tokens (${commonTokens.join(', ')}) — suggesting umbrella.`;
      result.supportFilesToMove = [
        { from: `${skillA}/SKILL.md`, to: `${result.umbrellaName}/skills/${skillA}.md` },
        { from: `${skillB}/SKILL.md`, to: `${result.umbrellaName}/skills/${skillB}.md` },
      ];
    } else {
      result.shouldMerge = false;
      result.umbrellaName = '';
      result.reason = `Moderate similarity (${(score * PCT).toFixed(0)}%) but no shared name tokens — needs manual review.`;
    }
  } else {
    result.shouldMerge = false;
    result.umbrellaName = '';
    result.reason = `Low similarity (${(score * PCT).toFixed(0)}%) — below consolidation threshold.`;
  }

  return result;
}

// ─── Main Analyzer ─────────────────────────────────────────────────────────

/**
 * Normalize a result object to the canonical LLM/heuristic schema (BUG-4 fix).
 *
 * Guarantees all callers see the same shape regardless of which path
 * (LLM response, regex parse, or heuristic fallback) produced the data.
 * Defensive against missing fields, wrong types, or extra junk fields.
 *
 * @param {object} r - Possibly-incomplete result object
 * @returns {{ shouldMerge: boolean, umbrellaName: string, reason: string, supportFilesToMove: Array<{from: string, to: string}> }}
 */
function normalizeResult(r) {
  const safe = (r && typeof r === 'object') ? r : {};
  return {
    shouldMerge: safe.shouldMerge === true,
    umbrellaName: typeof safe.umbrellaName === 'string' ? safe.umbrellaName : '',
    reason: typeof safe.reason === 'string' ? safe.reason : '',
    supportFilesToMove: Array.isArray(safe.supportFilesToMove)
      ? safe.supportFilesToMove
          .filter(e => e && typeof e === 'object' && typeof e.from === 'string' && typeof e.to === 'string')
          .map(e => ({ from: e.from, to: e.to }))
      : [],
  };
}

/**
 * Analyze a skill pair for potential consolidation.
 *
 * Tries LLM first; falls back to heuristic analysis if LLM unavailable.
 *
 * BUG-7 fix: validates `pair` input shape and returns a normalized
 * no-merge result on malformed input rather than throwing.
 * BUG-4 fix: every return value is normalized to the canonical schema
 * so callers (and tests) get a consistent shape.
 *
 * @param {{ skillA: string, skillB: string, score: number, bodyA: string, bodyB: string }} pair
 * @returns {Promise<{ shouldMerge: boolean, umbrellaName: string, reason: string, supportFilesToMove: Array<{from: string, to: string}> }>}
 */
async function analyzePair(pair) {
  // BUG-7 fix: defensive input validation — graceful no-merge on malformed input
  if (!pair || typeof pair !== 'object') {
    return normalizeResult({
      shouldMerge: false,
      reason: 'Invalid input: pair must be an object',
    });
  }
  const { skillA, skillB, score, bodyA, bodyB } = pair;
  if (typeof skillA !== 'string' || typeof skillB !== 'string' ||
      typeof score !== 'number' || !Number.isFinite(score)) {
    return normalizeResult({
      shouldMerge: false,
      reason: 'Invalid input: pair requires string skillA/skillB and numeric score',
    });
  }
  if (typeof bodyA !== 'string' || typeof bodyB !== 'string') {
    return normalizeResult({
      shouldMerge: false,
      reason: 'Invalid input: pair requires string bodyA and bodyB',
    });
  }

  const prompt = formatConsolidationPrompt(pair);
  let raw;
  try {
    raw = await callLLM(prompt);
  } catch (err) {
    // BUG-8 fix: wrap raw LLM error in user-friendly message; log raw to debug
    console.debug(`[umbrella] LLM call failed: ${err.stack || err.message}`);
    raw = null;
  }

  if (raw) {
    try {
      const result = parseYAMLResponse(raw);
      // BUG-4 fix: normalize LLM-parsed result so it matches heuristic schema exactly
      const normalized = normalizeResult(result);
      // Validate result has minimum required fields
      if (normalized.umbrellaName || normalized.shouldMerge) {
        return normalized;
      }
    } catch (parseErr) {
      // BUG-8 fix: user-friendly parse error, raw error logged at debug level
      console.debug(`[umbrella] YAML parse failed: ${parseErr.stack || parseErr.message}`);
    }
  }

  // Fallback to heuristic — also normalized so schema is identical
  return normalizeResult(heuristicAnalyzePair(pair));
}

// ─── Mock Analyzer (for testing) ────────────────────────────────────────────

/**
 * Mock version of analyzePair for testing — never calls the LLM.
 * Returns deterministic results based on score threshold.
 *
 * @param {{ skillA: string, skillB: string, score: number, bodyA: string, bodyB: string }} pair
 * @returns {{ shouldMerge: boolean, umbrellaName: string, reason: string, supportFilesToMove: Array<{from: string, to: string}> }}
 */
function mockAnalyzePair(pair) {
  const { skillA, skillB, score } = pair;

  // High similarity → merge with heuristic umbrella name
  if (score > 0.7) {
    const umbrella = skillA.length <= skillB.length ? skillA : skillB;
    return {
      shouldMerge: true,
      umbrellaName: umbrella,
      reason: `Mock LLM: High similarity (${score}) suggests consolidation under '${umbrella}'.`,
      supportFilesToMove: [
        { from: `${skillA}/SKILL.md`, to: `${umbrella}/skills/${skillA}.md` },
        { from: `${skillB}/SKILL.md`, to: `${umbrella}/skills/${skillB}.md` },
      ],
    };
  }

  // Moderate → sometimes merge
  if (score > 0.5) {
    return {
      shouldMerge: true,
      umbrellaName: `${skillA}-${skillB}-group`,
      reason: `Mock LLM: Moderate similarity (${score}) — merging as skill group.`,
      supportFilesToMove: [
        { from: `${skillA}/SKILL.md`, to: `${skillA}-${skillB}-group/skills/${skillA}.md` },
        { from: `${skillB}/SKILL.md`, to: `${skillA}-${skillB}-group/skills/${skillB}.md` },
      ],
    };
  }

  // Low → no merge
  return {
    shouldMerge: false,
    umbrellaName: '',
    reason: `Mock LLM: Low similarity (${score}) — no consolidation needed.`,
    supportFilesToMove: [],
  };
}

// ─── Proposal File Writer ───────────────────────────────────────────────────

/**
 * Save a consolidation proposal as a YAML file.
 *
 * BUG-6 fix: accepts an optional `dryRun` flag (4th arg) so callers can
 * invoke `saveProposal` safely in dry-run mode without touching the disk.
 * When `dryRun=true`, the function returns the proposed filepath without
 * creating the directory or writing the file.
 *
 * @param {{ shouldMerge: boolean, umbrellaName: string, reason: string, supportFilesToMove: Array<{from: string, to: string}> }} result
 * @param {string} proposalsDir - Directory to write proposals into
 * @param {{ skillA: string, skillB: string, score: number }} [pairInfo] - Original pair metadata
 * @param {{ dryRun?: boolean }} [options] - Options; pass `{ dryRun: true }` to skip disk writes
 * @returns {string} Path to the written (or proposed) proposal file
 */
function saveProposal(result, proposalsDir, pairInfo, options) {
  const dryRun = options && options.dryRun === true;

  if (!dryRun) {
    try {
      if (!fs.existsSync(proposalsDir)) {
        fs.mkdirSync(proposalsDir, { recursive: true, mode: 0o700 });
      }
    } catch (dirErr) {
      throw new Error(`Cannot create proposals dir ${proposalsDir}: ${dirErr.message}`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeNameA = (pairInfo?.skillA || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
  const safeNameB = (pairInfo?.skillB || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
  const filename = `proposal-${safeNameA}__${safeNameB}__${timestamp}.yaml`;
  const filepath = path.join(proposalsDir, filename);

  // BUG-6 fix: in dry-run mode, return the proposed path without writing
  if (dryRun) {
    return filepath;
  }

  const yamlLines = [
    '---',
    `# Consolidation Proposal — ${timestamp}`,
    `# Generated by umbrella_consolidation.js (Phase B)`,
    '# Review before applying.',
    '---',
    '',
    `shouldMerge: ${result.shouldMerge}`,
    `umbrellaName: "${result.umbrellaName}"`,
    `reason: "${result.reason}"`,
    'supportFilesToMove:',
  ];

  for (const entry of result.supportFilesToMove) {
    yamlLines.push(`  - from: "${entry.from}"`);
    yamlLines.push(`    to: "${entry.to}"`);
  }

  if (pairInfo) {
    yamlLines.push('');
    yamlLines.push('# Original pair metadata');
    yamlLines.push(`sourceSkillA: "${pairInfo.skillA}"`);
    yamlLines.push(`sourceSkillB: "${pairInfo.skillB}"`);
    yamlLines.push(`jaccardScore: ${pairInfo.score}`);
  }

  yamlLines.push('');

  try {
    fs.writeFileSync(filepath, yamlLines.join('\n'), 'utf8');
  } catch (writeErr) {
    throw new Error(`Cannot write proposal file ${filepath}: ${writeErr.message}`);
  }
  return filepath;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  formatConsolidationPrompt,
  callLLM,
  parseYAMLResponse,
  heuristicAnalyzePair,
  analyzePair,
  mockAnalyzePair,
  saveProposal,
};
