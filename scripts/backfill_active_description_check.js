#!/usr/bin/env node
/**
 * backfill_active_description_check.js — Backfill the P3 description_no_label_spam
 * check on ACTIVE skills.
 *
 * Sub-2 fix (2026-06-28): Root Cause #3 — `validateSkillContentStrict()` in
 * skill_reviewer_bot.js has been enforcing the P3 label-spam check on the
 * DRAFT path (skill writes), but ACTIVE skills were never re-validated.
 * 64/66 active skills still carry M1.4-injected label-spam ("Use when:" /
 * "Key capabilities:" markers).
 *
 * This script is the backfill: scan every active SKILL.md, run the same
 * P3 check, and append any violations to .backfill_description_audit.jsonl
 * so downstream cleanup (issue tracking, batch rewrite) can pick them up.
 *
 * Usage:
 *   node scripts/backfill_active_description_check.js               # write audit log
 *   node scripts/backfill_active_description_check.js --dry-run     # print only
 *
 * Exit codes:
 *   0 = all active skills clean (no violations)
 *   1 = label-spam violations found OR error
 *
 * Scope (in/out):
 *   ✅ scans skills/ (top-level + _learned_* subdirs)
 *   ❌ does NOT touch skills-learned/, skills/_archive/, or .DS_Store
 *   ❌ does NOT modify any SKILL.md file (read-only)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '/Users/ally';
const WS = path.join(HOME, '.openclaw/workspace');
const SKILLS_DIR = path.join(WS, 'skills');
const AUDIT_LOG = path.join(WS, '.backfill_description_audit.jsonl');
const LABEL_SPAM_PREFIX = 'description_no_label_spam:';

function loadValidator() {
  try {
    const mod = require('./skill_reviewer_bot');
    if (typeof mod.validateSkillContentStrict !== 'function') {
      console.error('FATAL: skill_reviewer_bot.validateSkillContentStrict is not exported');
      process.exit(1);
    }
    return mod.validateSkillContentStrict;
  } catch (e) {
    console.error('FATAL: failed to load validateSkillContentStrict: ' + e.message);
    process.exit(1);
  }
}

function discoverActiveSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) {
    console.error('Skills dir not found: ' + skillsDir);
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  const skillPaths = [];

  for (const entry of entries) {
    // Skip archive / quarantine / hidden dirs (top-level only).
    // But _learned_* IS active — they're symlinks for activated skills.
    const name = entry.name;

    // Skip non-directory entries (files like .DS_Store)
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    if (name === '_archive' || name === '_quarantine') continue;

    // _learned_* are active skills (symlinks to skills-learned/)
    // Top-level non-_learned dirs are also active skills
    const skillMdPath = path.join(skillsDir, name, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      skillPaths.push(skillMdPath);
    }
  }

  return skillPaths;
}

function parseDescription(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const descLine = m[1].match(/^description:\s*(.*)$/m);
  if (!descLine) return null;
  let raw = descLine[1].trim();
  // Strip wrapping quotes (single or double), tolerant of trailing punctuation
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      raw = raw.slice(1, -1);
    }
  }
  return raw.length > 0 ? raw : null;
}

function suggestClean(description) {
  // Heuristic: strip label-spam segments while preserving the rest.
  // We do NOT replace the entire description — that would lose domain context.
  //
  // Strip pattern: ".\s*<label>: ... ." — the trailing period must be
  // followed by either a space + capital letter (start of next sentence) or
  // end-of-string. This avoids stopping at periods inside identifiers like
  // "spawn_config.js" or URLs.
  let clean = description;
  const stripRegex = /\.\s*(Use\s+when|Apply\s+when|Key\s+capabilities|Capabilities|When\s+to\s+use)\s*:[\s\S]*?\.(?=\s+[A-Z]|$)/gi;

  // Apply repeatedly until no more matches (in case label segments chain)
  let prev;
  do {
    prev = clean;
    clean = clean.replace(stripRegex, '.');
  } while (clean !== prev);

  // Collapse whitespace and trailing punctuation artifacts
  clean = clean
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/^\s*[\.\,]\s*/, '')
    .replace(/\.\s*$/, '')
    .trim();

  // Fallback: if everything got stripped (unlikely), return original
  if (!clean) return description;

  return clean;
}

function parseArgs() {
  const args = { dryRun: false, help: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--skills-dir') {
      // Override (for testing); default is WS/skills
      const override = process.argv[++i];
      if (override) args.skillsDirOverride = override;
    }
  }
  return args;
}

function printHelp() {
  console.log(`backfill_active_description_check.js — backfill P3 label-spam check on ACTIVE skills

Usage:
  node scripts/backfill_active_description_check.js [options]

Options:
  --dry-run        Print violations but do not write audit log
  --skills-dir PATH  Override skills dir (default: ~/.openclaw/workspace/skills)
  -h, --help       Show this help

Modes:
  (default)  Scan + write violations to .backfill_description_audit.jsonl
  --dry-run  Scan + print violations, no disk write

Exit codes:
  0 = all active skills clean
  1 = label-spam violations found OR error
`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const validateSkillContentStrict = loadValidator();
  const skillsDir = args.skillsDirOverride || SKILLS_DIR;
  const skillPaths = discoverActiveSkills(skillsDir);

  console.log('Backfill P3 description_no_label_spam check on ACTIVE skills');
  console.log('Skills dir: ' + skillsDir);
  console.log('Mode: ' + (args.dryRun ? 'DRY-RUN (no audit log)' : 'WRITE (audit log)'));
  console.log('Found ' + skillPaths.length + ' active SKILL.md to scan');
  console.log('');

  const violations = [];
  let scanned = 0;
  let skippedReadError = 0;

  for (const skillPath of skillPaths) {
    scanned++;
    let content;
    try {
      content = fs.readFileSync(skillPath, 'utf8');
    } catch (e) {
      console.error('SKIP (read failed): ' + path.relative(WS, skillPath) + ' — ' + e.message);
      skippedReadError++;
      continue;
    }

    let result;
    try {
      result = validateSkillContentStrict(content);
    } catch (e) {
      console.error('SKIP (validate failed): ' + path.relative(WS, skillPath) + ' — ' + e.message);
      skippedReadError++;
      continue;
    }

    // Filter for P3 label-spam violations specifically
    const errors = Array.isArray(result.errors) ? result.errors : [];
    const labelSpamErrors = errors.filter(e => e.startsWith(LABEL_SPAM_PREFIX));

    if (labelSpamErrors.length === 0) continue;

    const currentDesc = parseDescription(content) || '(unparseable)';
    const violation = {
      timestamp: new Date().toISOString(),
      skillPath: path.relative(WS, skillPath),
      violations: labelSpamErrors,
      suggestedClean: suggestClean(currentDesc),
      currentDescription: currentDesc
    };
    violations.push(violation);

    const rel = path.relative(WS, skillPath);
    console.log('\u274c ' + rel);
    console.log('   ' + labelSpamErrors.join('; '));
    console.log('   current: ' + currentDesc.slice(0, 80) + (currentDesc.length > 80 ? '...' : ''));
    console.log('   suggested: ' + violation?.suggestedClean?.slice(0, 80) + (violation?.suggestedClean?.length > 80 ? '...' : ''));
  }

  console.log('');
  console.log('========================================');
  console.log('Summary');
  console.log('========================================');
  console.log('Scanned:  ' + scanned);
  console.log('Clean:    ' + (scanned - violations.length - skippedReadError));
  console.log('Violations: ' + violations.length);
  console.log('Skipped:  ' + skippedReadError + ' (read/validate errors)');
  console.log('');

  if (args.dryRun) {
    console.log('(dry-run: not writing audit log)');
  } else if (violations.length > 0) {
    try {
      const lines = violations.map(v => JSON.stringify(v)).join('\n') + '\n';
      fs.appendFileSync(AUDIT_LOG, lines, 'utf8');
      console.log('Audit log appended: ' + path.relative(WS, AUDIT_LOG) + ' (' + violations.length + ' entries)');
    } catch (e) {
      console.error('FATAL: failed to write audit log: ' + e.message);
      process.exit(1);
    }
  } else {
    console.log('No violations — audit log not modified.');
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('FATAL: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

module.exports = {
  discoverActiveSkills,
  suggestClean,
  parseDescription,
  AUDIT_LOG,
  SKILLS_DIR
};
