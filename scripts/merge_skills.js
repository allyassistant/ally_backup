#!/usr/bin/env node
/**
 * merge_skills.js — Consolidate source skills into target skills
 *
 * For each (source, target) pair:
 *   1. Read source SKILL.md
 *   2. Strip source frontmatter
 *   3. Append as `## Absorbed from <source>` section to target SKILL.md
 *   4. Move source dir to skills-learned/_archive/merged-2026-06-20/<source>/
 *   5. Remove source symlink from skills/_learned_<source>
 *
 * Usage:
 *   node scripts/merge_skills.js --dry-run     # preview
 *   node scripts/merge_skills.js               # execute
 *
 * Reversible: source dir preserved in _archive/merged-2026-06-20/
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WS = (process.env.HOME || '/Users/ally') + '/.openclaw/workspace';
const SKILLS_LEARNED = path.join(WS, 'skills-learned');
const SKILLS_ACTIVE = path.join(WS, 'skills');
const ARCHIVE_DIR = path.join(SKILLS_LEARNED, '_archive', 'merged-2026-06-20');

const MERGES = [
  ['code-quality-proactive-scan',         'code-review-checklist'],
  ['issue-consolidation-via-subagent',    'issue-triage-via-subagent'],
  ['openclaw-managed-upgrade',            'openclaw-remote-config-ops'],
  ['pipeline-orchestration-pattern',     'pipeline-llm-call-timeout-debugging'],
  ['skill-automation-analysis',           'skill-curation-pattern'],
  ['subagent-fix-orchestration',          'subagent-investigation-orchestration'],
  ['subagent-m3-retry-resilience',        'subagent-fallback-chain'],
  ['subagent-quality-gating',             'subagent-m3-reliability'],
];

const DRY_RUN = process.argv.includes('--dry-run');

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '');
}

function log(msg) { if (!process.argv.includes('--quiet')) console.log(msg); }
function err(msg) { console.error(msg); }

function main() {
  if (!DRY_RUN && !fs.existsSync(ARCHIVE_DIR)) {
    try {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
    log(`Created archive dir: ${ARCHIVE_DIR}`);
  }

  let okCount = 0;
  let errCount = 0;

  for (const [src, tgt] of MERGES) {
    const srcDir = path.join(SKILLS_LEARNED, src);
    const srcFile = path.join(srcDir, 'SKILL.md');
    const tgtFile = path.join(SKILLS_LEARNED, tgt, 'SKILL.md');
    const symlink = path.join(SKILLS_ACTIVE, '_learned_' + src);

    log(`\n━━━ ${src} → ${tgt} ━━━`);

    if (!fs.existsSync(srcFile)) { err(`  ✗ missing source: ${srcFile}`); errCount++; continue; }
    if (!fs.existsSync(tgtFile)) { err(`  ✗ missing target: ${tgtFile}`); errCount++; continue; }

    // Read both
    let srcContent;
    try {
      srcContent = stripFrontmatter(fs.readFileSync(srcFile, 'utf8')).trim();
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    let tgtContent;
    try {
      tgtContent = fs.readFileSync(tgtFile, 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }

    // Build appendix
    const appendix = `\n\n## Absorbed from \`${src}\` (2026-06-20)\n\n> **Provenance:** score=${process.env.MERGE_SCORE || '?'}, verdict=${process.env.MERGE_VERDICT || 'MERGE'}, merged via \`scripts/merge_skills.js\`\n> **Original location:** \`${src}/SKILL.md\` (now in \`_archive/merged-2026-06-20/${src}/\`)\n\n${srcContent}\n`;

    if (DRY_RUN) {
      log(`  [DRY] would append ${srcContent.length}B to ${tgtFile}`);
      log(`  [DRY] would move ${srcDir} → ${ARCHIVE_DIR}/${src}`);
      log(`  [DRY] would remove symlink ${symlink}`);
      okCount++;
      continue;
    }

    try {
      // 1. Append source content to target
      fs.appendFileSync(tgtFile, appendix, 'utf8');
      log(`  ✓ appended ${srcContent.length}B to target`);

      // 2. Move source dir to archive
      const destDir = path.join(ARCHIVE_DIR, src);
      if (fs.existsSync(destDir)) {
        // Use timestamp suffix to avoid collision
        const stamp = '-' + Date.now();
        fs.renameSync(srcDir, destDir + stamp);
        log(`  ✓ moved source (renamed to avoid collision): ${src} → ${src}${stamp}`);
      } else {
        fs.renameSync(srcDir, destDir);
        log(`  ✓ moved source: ${src} → _archive/merged-2026-06-20/${src}`);
      }

      // 3. Remove source symlink
      if (fs.existsSync(symlink)) {
        fs.unlinkSync(symlink);
        log(`  ✓ removed symlink: _learned_${src}`);
      } else {
        log(`  ⚠ symlink not found: ${symlink} (already removed?)`);
      }

      okCount++;
    } catch (e) {
      err(`  ✗ failed: ${e.message}`);
      errCount++;
    }
  }

  log(`\n═══════════════════════════════════════`);
  log(`Done: ${okCount} merged, ${errCount} failed (of ${MERGES.length} planned)`);
  log(`Archive: ${ARCHIVE_DIR}`);
  log(`═══════════════════════════════════════`);
  process.exit(errCount > 0 ? 1 : 0);
}

main();
