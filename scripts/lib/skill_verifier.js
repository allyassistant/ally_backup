'use strict';

/**
 * unified_verifier.js — Tier-aware rule engine for SKILL.md validation.
 *
 * Replaces three divergent validators:
 *   1. Pre-write gate  (skill_reviewer_bot.js inline `<1500B` check)
 *   2. Post-write validator (scripts/validate_skill_file.js — 2-of-3 stub signals)
 *   3. Curator quarantine logic (periodic junk-rate scan)
 *
 * Design:
 *   - Each rule: { id, weight, blocking, tier: ['draft','active'] }
 *   - Composite score = weighted sum of passing rules (normalized 0..1)
 *   - Blocking rules must ALL pass (binary hard-fail regardless of score)
 *   - Output: { valid, errors[], warnings[], score (0..1), tier, ruleResults[] }
 *
 * Tier semantics:
 *   - 'draft'    — new skill from skill-reviewer (strict)
 *   - 'active'   — promoted skill in active pool (looser — may be a short reference)
 *   - 'deprecated' — read-only; verification still runs but only blocking+deprecated-specific rules
 *
 * Pure functions: no I/O side effects. Caller passes content / filePath.
 *
 * Backward compat: scripts/validate_skill_file.js wraps this with tier='draft'.
 * Pre-write gate in skill_reviewer_bot.js wraps this with tier='draft'.
 * Curator quarantine wraps this with tier='active'.
 */

const fs = require('fs');
const path = require('path');
const { extractField } = require('./frontmatter');

const VALID_TIERS = ['draft', 'active', 'deprecated'];

const FILE_SIZE_MIN_BYTES = 1500;
const WORKFLOW_STEPS_MIN = 3;
const PITFALLS_MIN = 3;
const WORD_COUNT_MIN = 30;
const DESC_TO_BODY_RATIO_MIN = 3;
const SCORE_PASS_THRESHOLD = 0.7;

// ── Helpers ──────────────────────────────────────────────────────────────────

function countBodyWords(content) {
  const body = stripFrontmatter(content).trim();
  if (!body) return 0;
  return body.split(/\s+/).filter(w => w.length > 0).length;
}

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '');
}

function countUnclosedCodeBlocks(content) {
  // Mirrors the validator's stateful fence tracker (BUG-05 fix)
  let inBlock = false;
  for (const line of content.split('\n')) {
    const fenceMatch = line.match(/^(\s*)(```+)/);
    if (!fenceMatch) continue;
    const fence = fenceMatch[2];
    if (fence.length === 3) {
      if (/^\s*```\s*$/.test(line)) {
        inBlock = !inBlock;
      } else if (/^\s*```[a-zA-Z0-9_-]/.test(line)) {
        if (!inBlock) inBlock = true;
      }
    } else if (fence.length > 3) {
      if (!inBlock) inBlock = true;
    }
  }
  return inBlock ? 1 : 0;
}

function countWorkflowSteps(content) {
  // Match `## Workflow` (or `### Workflow`) then count numbered steps within it
  // (H1-H3 prefix allowed — mirrors BUG-02 fix)
  const wfHeader = content.match(/^(?:#{1,3}\s+)Workflow\s*$/im);
  if (!wfHeader) return { hasHeader: false, steps: 0, sectionText: '' };
  const startIdx = wfHeader.index + wfHeader[0].length;
  const rest = content.slice(startIdx);
  const nextHeader = rest.match(/^##\s+(?!#)/m);
  const sectionText = nextHeader ? rest.slice(0, nextHeader.index) : rest;
  const steps = (sectionText.match(/^(?:#{1,3}\s+)?\d+\.\s+[^\n]+/gm) || []).length;
  return { hasHeader: true, steps, sectionText };
}

function countPitfalls(content) {
  // Match `## Pitfalls` / `### Pitfalls` / `**Pitfalls:**` (WARN-06 fix)
  const pitHeader = content.match(/^(?:#{1,3}\s+|\*\*)Pitfalls:?\s*(?:\*\*)?$/im);
  if (!pitHeader) return { hasHeader: false, items: 0, sectionText: '' };
  const startIdx = pitHeader.index + pitHeader[0].length;
  const rest = content.slice(startIdx);
  const nextHeader = rest.match(/^(?:#{1,3}\s+|\*\*)[^*\n]/m);
  const sectionText = nextHeader ? rest.slice(0, nextHeader.index) : rest;
  const items = (sectionText.match(/^(?:- (?:⚠️?\s*)?|###\s+(?:\d+\.\s+)?(?:⚠️?\s*)?)\S/gm) || []).length;
  return { hasHeader: true, items, sectionText };
}

function isKebabCase(name) {
  if (!name) return false;
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}

function hasSessionSpecificText(content, name) {
  // Heuristics: "today", "fix-bug-NNN", session timestamps in title,
  // "this-conversation", "this-session" etc.
  const sessionMarkers = [
    /\btoday['s]?\b/i,
    /\bthis[- ]?(conversation|session|chat)\b/i,
    /\bfix[- ]?bug[- ]?\d+\b/i,
    /\bissue[- ]?\d+\b/i,
    /\b\d{4}-\d{2}-\d{2}[- ]?(meeting|notes?)\b/i,
  ];
  const haystack = (name || '') + ' ' + content.slice(0, 500);  // only check name + first 500B
  for (const re of sessionMarkers) {
    if (re.test(haystack)) return true;
  }
  return false;
}

// Placeholder usernames we allow in /Users/<name>/... patterns
// (these are intentionally generic, not real machine accounts).
const PATH_PLACEHOLDER_NAMES = new Set([
  'name', 'user', 'username', 'who', 'me',
]);

/**
 * Find hardcoded personal paths in SKILL.md content.
 *
 * Flags:
 *   - `/Users/<real-username>/`       (real account, not a `<name>` placeholder)
 *   - `~/...`                         (home-relative tilde expansion)
 *
 * Allows:
 *   - `/Users/<placeholder>/...`      (placeholder syntax like `<name>`, `<user>`)
 *   - `/Users/<name>/workspace/...`   (intentional placeholder form)
 */
function findHardcodedPersonalPaths(content) {
  const findings = [];

  // /Users/<name>/... pattern
  // Skip when <name> is a placeholder (i.e. wrapped in angle brackets) or matches the
  // small set of conventional placeholder words.
  const usersRe = /\/Users\/([A-Za-z][A-Za-z0-9._-]*)\//g;
  let m;
  while ((m = usersRe.exec(content)) !== null) {
    const user = m[1];
    if (PATH_PLACEHOLDER_NAMES.has(user.toLowerCase())) continue;
    // Confirm this isn't an angle-bracket placeholder that slipped through
    // (e.g. "/Users/<name>/" — the regex above only captures ASCII names anyway).
    findings.push({
      line: lineNumberAt(content, m.index),
      snippet: m[0],
      kind: 'hardcoded-personal-path',
      detail: `Hardcoded user path "/Users/${user}/" — use a placeholder or workspace-relative path`,
    });
  }

  // ~/... tilde expansion (avoid matching `~~` strikethrough or `~/<WS>` placeholders).
  // Allow `~/workspace/...` or `~/<WS>/...` style placeholders — but per the spec we flag
  // them all and let the placeholder form be `/Users/<name>/workspace/...` instead.
  const tildeRe = /(?:^|[\s`(])~(\/[A-Za-z0-9._\-/]+)/g;
  while ((m = tildeRe.exec(content)) !== null) {
    findings.push({
      line: lineNumberAt(content, m.index),
      snippet: m[1],
      kind: 'tilde-expansion',
      detail: `Tilde-expanded path "~$1" — use a workspace-relative path instead`,
    });
  }

  return findings;
}

/**
 * Find script references of the form `node scripts/<name>.js` or `bash scripts/<name>.sh`
 * and check whether the referenced file exists on disk.
 *
 * Supports both flat (`scripts/foo.js`) and nested (`scripts/lib/foo.js`, `scripts/autoops/bar.sh`)
 * paths. Also handles absolute-path references (`node /Users/.../scripts/<path>`) by extracting
 * the suffix after `scripts/`.
 *
 * Fail-open: if `scriptsDir` is missing/not-a-directory, the rule returns [] (silent pass).
 * This is true fail-open: bad config → no findings, NOT flag-everything-as-missing.
 */
function findNonExistentScriptRefs(content, scriptsDir) {
  const findings = [];
  if (!scriptsDir) return findings;

  // True fail-open: verify scriptsDir is a real directory before checking anything.
  // If not, return [] rather than flagging every script as missing.
  try {
    const st = fs.statSync(scriptsDir);
    if (!st || !st.isDirectory()) return findings;
  } catch (_e) {
    return findings;
  }

  // Match: (node|bash|sh) <whitespace> <path containing scripts/<name>.<ext>
  // Path can be:
  //   - relative: `scripts/foo.js`, `scripts/lib/foo.js`
  //   - absolute: `/Users/.../scripts/foo.js`, `/Users/.../scripts/lib/foo.js`
  // Capture group 1 = the path-after-scripts/ (may include nested dirs).
  // Group 2 = the basename (used for placeholder check).
  const scriptRefRe = /(?:^|[\s`(])(?:node|bash|sh)\s+(?:(?:\.{0,2}\/)?(?:\S*?\/)?)?scripts\/((?:[A-Za-z0-9._\-]+\/)*[A-Za-z0-9._\-]+\.(?:js|sh|bash))\b/g;
  let m;
  while ((m = scriptRefRe.exec(content)) !== null) {
    const scriptPath = m[1];  // may include nested dirs
    const basename = scriptPath.split('/').pop();

    // Skip placeholder-style names like `<name>.js` or `xxx.js` (intentional placeholders)
    if (/^[<].+[>]$/.test(basename)) continue;
    if (/^(?:xxx|example|sample|placeholder)\.[a-z]+$/i.test(basename)) continue;

    let exists = false;
    try {
      exists = fs.existsSync(path.join(scriptsDir, scriptPath));
    } catch (_e) {
      // fail-open: treat any FS error as "could not verify"
      continue;
    }
    if (!exists) {
      findings.push({
        line: lineNumberAt(content, m.index),
        snippet: `scripts/${scriptPath}`,
        kind: 'missing-script-ref',
        detail: `Referenced script "scripts/${scriptPath}" does not exist in ${scriptsDir}`,
      });
    }
  }

  return findings;
}

/**
 * Find deprecated `crontab` command references.
 *
 * The workspace uses `openclaw cron` as the canonical scheduler; legacy `crontab`
 * invocations should not appear in skill workflow steps.
 *
 * Only flag occurrences that look like shell command usage: backtick-quoted, or
 * followed by a flag like `-l` / `-e` / `-r`.
 */
function findDeprecatedCronRefs(content) {
  const findings = [];

  // Backtick-quoted: `crontab -l`, `crontab -e`, bare `crontab`
  const backtickRe = /`\s*crontab\b([^\`]*)`/g;
  let m;
  while ((m = backtickRe.exec(content)) !== null) {
    findings.push({
      line: lineNumberAt(content, m.index),
      snippet: `crontab${m[1] || ''}`.trim(),
      kind: 'deprecated-crontab',
      detail: 'Legacy `crontab` command — use `openclaw cron` instead',
    });
  }

  // Bare "crontab" followed by a flag (e.g., a sentence like "Run `crontab -l` to list")
  // We catch this via the backtick regex above; the unquoted-bare-word case is rare and
  // usually not actionable, so we leave it alone to avoid false positives.

  return findings;
}

/**
 * Compute the 1-indexed line number for an offset into the content.
 */
function lineNumberAt(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

// ── Rule definitions ────────────────────────────────────────────────────────

const RULES = [
  {
    id: 'frontmatter_complete',
    weight: 0.20,
    blocking: true,
    tier: ['draft', 'active'],
    check(content) {
      const required = ['name', 'description', 'status', 'provenance'];
      const missing = required.filter(f => !extractField(content, f));
      if (missing.length === 0) return { pass: true };
      return {
        pass: false,
        error: `Missing frontmatter fields: ${missing.join(', ')}`,
        missing,
      };
    },
  },
  {
    id: 'workflow_min_3_steps',
    weight: 0.20,
    blocking: true,
    tier: ['draft', 'active'],
    check(content) {
      const { hasHeader, steps } = countWorkflowSteps(content);
      if (!hasHeader) {
        return { pass: false, error: 'Missing "## Workflow" section' };
      }
      if (steps < WORKFLOW_STEPS_MIN) {
        return { pass: false, error: `Workflow has only ${steps} steps — need at least ${WORKFLOW_STEPS_MIN}` };
      }
      return { pass: true };
    },
  },
  {
    id: 'pitfalls_min_3',
    weight: 0.20,
    blocking: true,
    tier: ['draft', 'active'],
    check(content) {
      const { hasHeader, items } = countPitfalls(content);
      if (!hasHeader) {
        return { pass: false, error: 'Missing "## Pitfalls" section' };
      }
      if (items < PITFALLS_MIN) {
        return { pass: false, error: `Only ${items} pitfalls — need at least ${PITFALLS_MIN}` };
      }
      return { pass: true };
    },
  },
  {
    id: 'file_size_min_1500B',
    weight: 0.15,
    blocking: true,
    tier: ['draft'],  // ACTIVE skills may be short reference cards
    check(content) {
      if (content.length >= FILE_SIZE_MIN_BYTES) return { pass: true };
      return {
        pass: false,
        error: `File size ${content.length}B < ${FILE_SIZE_MIN_BYTES}B`,
        bytes: content.length,
      };
    },
  },
  {
    id: 'unclosed_code_blocks',
    weight: 0.15,
    blocking: true,
    tier: ['draft', 'active'],
    check(content) {
      const unclosed = countUnclosedCodeBlocks(content);
      if (unclosed === 0) return { pass: true };
      return { pass: false, error: `Unclosed code block at end of file (${unclosed})` };
    },
  },
  {
    id: 'word_count_min',
    weight: 0.0,    // Diagnostic only — contributes nothing to score, blocking=false
    blocking: false,
    tier: ['draft'],
    check(content) {
      const words = countBodyWords(content);
      if (words >= WORD_COUNT_MIN) return { pass: true };
      return { pass: false, error: `Only ${words} words — need at least ${WORD_COUNT_MIN}`, warning: true };
    },
  },
  {
    id: 'class_level_name',
    weight: 0.05,
    blocking: false,
    tier: ['draft'],
    check(content) {
      const name = extractField(content, 'name');
      if (!name) return { pass: true, skip: 'no name to check' };
      if (isKebabCase(name)) return { pass: true };
      return {
        pass: false,
        warning: true,
        error: `Name "${name}" is not lowercase-kebab-case`,
      };
    },
  },
  {
    id: 'no_session_specific_text',
    weight: 0.05,
    blocking: false,
    tier: ['draft'],
    check(content) {
      const name = extractField(content, 'name') || '';
      if (!hasSessionSpecificText(content, name)) return { pass: true };
      return {
        pass: false,
        warning: true,
        error: 'Contains session-specific markers (today/fix-bug-NNN/this-conversation)',
      };
    },
  },
  {
    id: 'description_not_too_long',
    weight: 0.0,
    blocking: false,
    tier: ['draft', 'active'],
    check(content) {
      const desc = extractField(content, 'description') || '';
      if (desc.length <= 200) return { pass: true };
      return {
        pass: false,
        warning: true,
        error: `Description ${desc.length} chars > 200 max`,
      };
    },
  },
  // ── ACTIVE-only: weaker rules that ACTIVE skills pass via being cited ──
  {
    id: 'usage_in_l2_memory',
    weight: 0.10,
    blocking: false,
    tier: ['active'],
    check(content, ctx = {}) {
      // Soft signal: was this skill cited in MEMORY.md / SOUL.md / AGENTS.md?
      // Caller passes `ctx.citedInL2` (boolean) — defaults to true if unknown.
      if (ctx.citedInL2 === false) {
        return {
          pass: false,
          warning: true,
          error: 'Active skill not cited in MEMORY.md/SOUL.md/AGENTS.md',
        };
      }
      return { pass: true };
    },
  },
  {
    /**
     * `unsupported_command_check` — content-level checks for paths / scripts / commands
     * that have caused real-world skill failures:
     *   1. Hardcoded personal paths (`/Users/<realname>/...` or `~/...`)
     *   2. References to scripts that don't exist under `scripts/`
     *   3. Deprecated `crontab` command usage (use `openclaw cron` instead)
     *
     * Soft-warn only (`blocking: false`, `weight: 0.15`): these are quality signals,
     * not structure violations, so a skill with one of these issues still loads.
     *
     * The caller may pass:
     *   - `ctx.scriptsDir`  absolute path to the scripts directory to verify against
     *                      (defaults to `<workspace>/scripts/` inferred from this file).
     *   - `ctx.filePath`    original SKILL.md path, used for nicer error reporting only.
     */
    id: 'unsupported_command_check',
    weight: 0.15,
    blocking: false,
    tier: ['draft', 'active'],
    check(content, ctx = {}) {
      const warnings = [];
      try {
        const pathFindings = findHardcodedPersonalPaths(content);
        for (const f of pathFindings) {
          warnings.push(`line ${f.line}: ${f.detail} (matched "${f.snippet}")`);
        }

        const scriptsDir = ctx.scriptsDir
          || path.resolve(__dirname, '..', '..', 'scripts');
        const scriptFindings = findNonExistentScriptRefs(content, scriptsDir);
        for (const f of scriptFindings) {
          warnings.push(`line ${f.line}: ${f.detail}`);
        }

        const cronFindings = findDeprecatedCronRefs(content);
        for (const f of cronFindings) {
          warnings.push(`line ${f.line}: ${f.detail}`);
        }
      } catch (e) {
        // Fail-open: a bug in the content checker must not crash the whole validator.
        return {
          pass: false,
          warning: true,
          error: `unsupported_command_check internal error: ${e.message}`,
        };
      }

      if (warnings.length === 0) return { pass: true };

      return {
        pass: false,
        warning: true,
        error: warnings.join('; '),
        findings: warnings.length,
      };
    },
  },
];

// ── Engine ──────────────────────────────────────────────────────────────────

function getRulesForTier(tier) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Invalid tier "${tier}" — must be one of ${VALID_TIERS.join(', ')}`);
  }
  return RULES.filter(r => r?.tier?.includes(tier));
}

function verifySkillContent(content, tier = 'draft', ctx = {}) {
  if (typeof content !== 'string' || !content) {
    return {
      valid: false,
      errors: ['Empty or non-string content'],
      warnings: [],
      score: 0,
      tier,
      ruleResults: [],
    };
  }

  const tierRules = getRulesForTier(tier);
  const ruleResults = [];
  const errors = [];
  const warnings = [];

  for (const rule of tierRules) {
    let result;
    try {
      result = rule.check(content, ctx);
    } catch (e) {
      result = { pass: false, error: `Rule ${rule.id} threw: ${e.message}` };
    }
    const { skip, ...rest } = result;
    ruleResults.push({
      id: rule.id,
      weight: rule.weight,
      blocking: rule.blocking,
      tier: rule.tier,
      ...rest,
    });
    if (rest.pass) continue;
    if (rest.warning || !rule.blocking) {
      warnings.push(`${rule.id}: ${rest.error}`);
    } else {
      errors.push(`${rule.id}: ${rest.error}`);
    }
  }

  // Composite score: sum of passing rule weights, normalized by total weight
  const totalWeight = tierRules.reduce((s, r) => s + r.weight, 0);
  const earnedWeight = ruleResults
    .filter(r => r.pass)
    .reduce((s, r) => s + r.weight, 0);
  const score = totalWeight === 0 ? 1 : Number((earnedWeight / totalWeight).toFixed(4));

  const blockingClean = errors.length === 0;
  const scoreOK = score >= SCORE_PASS_THRESHOLD;
  const valid = blockingClean && scoreOK;

  return {
    valid,
    errors,
    warnings,
    score,
    tier,
    ruleResults,
  };
}

function verifySkill(filePath, tier = 'draft', ctx = {}) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return {
      valid: false,
      errors: [`File read failed: ${e.message}`],
      warnings: [],
      score: 0,
      tier,
      ruleResults: [],
    };
  }
  return verifySkillContent(content, tier, ctx);
}

// CLI entry point — for ad-hoc verification from the command line.
// Usage: node unified_verifier.js <path> [tier]
function main() {
  const filePath = process.argv[2];
  const tier = process.argv[3] || 'draft';
  if (!filePath) {
    console.error('Usage: node unified_verifier.js <path-to-SKILL.md> [draft|active|deprecated]');
    process.exit(2);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const result = verifySkill(filePath, tier);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

module.exports = {
  verifySkill,
  verifySkillContent,
  RULES,
  getRulesForTier,
  VALID_TIERS,
  SCORE_PASS_THRESHOLD,
  FILE_SIZE_MIN_BYTES,
  WORKFLOW_STEPS_MIN,
  PITFALLS_MIN,
  WORD_COUNT_MIN,
};

if (require.main === module) {
  main();
}
