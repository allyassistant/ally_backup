#!/usr/bin/env node
/**
 * backfill_skill_tiers.js — Add `status:` field to SKILL.md frontmatter if missing
 *
 * Phase 2g deliverable. Tier inference rules:
 *   - skill in skills-learned/_archive/                → archived
 *   - skill with active symlink in skills/_learned_*   → active
 *   - otherwise (top-level skills-learned/ entry, no symlink) → draft
 *   - if `status:` already present in frontmatter      → preserve (do not overwrite)
 *
 * Properties:
 *   - Idempotent: running twice produces no further changes.
 *   - Fail-open: any I/O error on a single skill is logged and skipped; other
 *     skills continue processing.
 *   - Atomic write: writes to a `.tmp` file then `fs.renameSync` to the target.
 *
 * Usage:
 *   node scripts/backfill_skill_tiers.js [--dry-run] [--verbose]
 *
 *   --dry-run   print planned changes without writing
 *   --verbose   log every skill processed, not just the changed ones
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WS = process.env.WORKSPACE || path.resolve(__dirname, '..');
const SKILLS_LEARNED = path.join(WS, 'skills-learned');
const SKILLS_LEARNED_ARCHIVE = path.join(SKILLS_LEARNED, '_archive');
const SKILLS = path.join(WS, 'skills');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// Skip these prefixes inside _archive — they're the curator's stash, not real archived skills.
const SKIP_ARCHIVE_PREFIXES = [
  'quarantine-',
  'failed-validations',
  'quarantine-2026-',
];

function listActiveSymlinks() {
  if (!fs.existsSync(SKILLS)) return new Set();
  const names = new Set();
  try {
    for (const entry of fs.readdirSync(SKILLS, { withFileTypes: true })) {
      if (!entry?.name?.startsWith('_learned_')) continue;
      const full = path.join(SKILLS, entry.name);
      try {
        const lstat = fs.lstatSync(full);
        if (lstat.isSymbolicLink()) {
          const target = fs.readlinkSync(full);
          names.add(path.basename(target));
        }
      } catch (_) { /* skip */ }
    }
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  return names;
}

function walkSkills(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_ARCHIVE_PREFIXES.some(p => entry?.name?.startsWith(p))) continue;
    const skillPath = path.join(rootDir, entry.name, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      out.push({ name: entry.name, skillPath, rootDir });
    }
  }
  return out;
}

function parseFrontmatter(content) {
  // Frontmatter must begin at column 0 of the FIRST line of the file (after a
  // single optional BOM). Reject any `---` that's inside a code block or that
  // appears later in the file.
  if (!content.startsWith('---')) return { hasFm: false, fm: '', body: content };
  // Skip BOM if present
  const stripped = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
  if (!stripped.startsWith('---')) return { hasFm: false, fm: '', body: content };
  const m = stripped.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { hasFm: false, fm: '', body: stripped };
  return { hasFm: true, fm: m[1], body: stripped.slice(m[0].length) };
}

function getStatusFromFrontmatter(fmText) {
  const m = fmText.match(/^status:\s*(.+?)\s*$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function inferTier(skillName, isInArchive, hasActiveSymlink, existingStatus) {
  if (existingStatus) return existingStatus;
  if (isInArchive) return 'archived';
  if (hasActiveSymlink) return 'active';
  return 'draft';
}

function buildNewFrontmatter(fmText, newStatus) {
  // Insert `status:` line as the last line of the frontmatter, before the closing `---`.
  // Frontmatter must end with `---` on its own line. We append `status:` before that.
  if (fmText.length === 0) return `status: ${newStatus}\n`;
  // Strip a trailing newline if present, then add our line + newline.
  const trimmed = fmText.endsWith('\n') ? fmText.slice(0, -1) : fmText;
  return trimmed + `\nstatus: ${newStatus}\n`;
}

function applyStatusToFile(skillPath, newStatus) {
  let content;
  try {
    content = fs.readFileSync(skillPath, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  const { hasFm, fm, body } = parseFrontmatter(content);
  const existing = hasFm ? getStatusFromFrontmatter(fm) : null;
  if (existing) {
    return { changed: false, reason: 'already has status', existing };
  }
  if (!hasFm) {
    // Fail-open: file has no real YAML frontmatter (likely corrupted or a
    // bare code fence embed). Refuse to prepend a phantom frontmatter —
    // log it as skipped and let the curator / a human repair the file.
    return { changed: false, reason: 'no frontmatter (fail-open skip)' };
  }
  const newFm = buildNewFrontmatter(fm, newStatus);
  const newContent = `---\n${newFm}---${body}`;
  if (DRY_RUN) return { changed: true, newContent };
  // Atomic write: write to .tmp then rename
  const tmpPath = skillPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, newContent, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  fs.renameSync(tmpPath, skillPath);
  return { changed: true, newContent };
}

function main() {
  if (!fs.existsSync(SKILLS_LEARNED)) {
    console.error(`skills-learned/ not found at ${SKILLS_LEARNED}`);
    process.exit(1);
  }

  const activeSymlinks = listActiveSymlinks();
  const activeSkills = walkSkills(SKILLS_LEARNED);
  const archivedSkills = walkSkills(SKILLS_LEARNED_ARCHIVE);
  const allSkills = activeSkills.concat(archivedSkills);

  const report = {
    dryRun: DRY_RUN,
    scannedTotal: allSkills.length,
    activeSymlinks: Array.from(activeSymlinks).sort(),
    changed: [],
    skipped: [],
    skippedNoFrontmatter: [],
    errors: [],
  };

  for (const skill of allSkills) {
    const isInArchive = skill.rootDir === SKILLS_LEARNED_ARCHIVE;
    const hasActiveSymlink = activeSymlinks.has(skill.name);
    try {
      const content = fs.readFileSync(skill.skillPath, 'utf8');
      const { hasFm, fm } = parseFrontmatter(content);
      const existingStatus = hasFm ? getStatusFromFrontmatter(fm) : null;
      const newStatus = inferTier(skill.name, isInArchive, hasActiveSymlink, existingStatus);
      if (existingStatus) {
        report?.skipped?.push({
          name: skill.name,
          inArchive: isInArchive,
          hasActiveSymlink,
          existingStatus,
          inferredTier: newStatus,
        });
        if (VERBOSE) console.log(`[skip] ${skill.name} already status=${existingStatus}`);
        continue;
      }
      if (!hasFm) {
        report?.skippedNoFrontmatter?.push({
          name: skill.name,
          inArchive: isInArchive,
          hasActiveSymlink,
          inferredTier: newStatus,
        });
        console.log(`[skip-no-fm] ${skill.name} (no frontmatter — fail-open)`);
        continue;
      }
      const result = applyStatusToFile(skill.skillPath, newStatus);
      if (result.changed) {
        report?.changed?.push({
          name: skill.name,
          inArchive: isInArchive,
          hasActiveSymlink,
          inferredTier: newStatus,
        });
        console.log(`[${DRY_RUN ? 'plan' : 'wrote'}] ${skill.name} → status: ${newStatus}` +
          (isInArchive ? ' (archived by location)' :
           hasActiveSymlink ? ' (active by symlink)' : ' (default: draft)'));
      }
    } catch (e) {
      report?.errors?.push({ name: skill.name, error: e.message });
      console.error(`[error] ${skill.name}: ${e.message}`);
    }
  }

  console.log('');
  console.log(`Scanned: ${report.scannedTotal} (active=${activeSkills.length}, archived=${archivedSkills.length})`);
  console.log(`Active symlinks: ${report?.activeSymlinks?.length}`);
  console.log(`Changed: ${report?.changed?.length}`);
  console.log(`Skipped (already had status): ${report?.skipped?.length}`);
  console.log(`Skipped (no frontmatter — fail-open): ${report?.skippedNoFrontmatter?.length}`);
  console.log(`Errors: ${report?.errors?.length}`);

  // Emit machine-readable summary next to the audit JSON
  const dateStr = new Date().toISOString().slice(0, 10);
  const summaryPath = path.join(WS, '.analysis', `backfill-report-${dateStr}.json`);
  try {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }
  try {
    fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  console.log(`Wrote ${summaryPath}`);

  // Idempotency guard: exit non-zero on errors so cron can detect partial failure.
  process.exit(report?.errors?.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { inferTier, applyStatusToFile, listActiveSymlinks };
