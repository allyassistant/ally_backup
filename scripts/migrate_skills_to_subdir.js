#!/usr/bin/env node

/**
 * migrate_skills_to_subdir.js
 *
 * Converts flat .md skill files in skills-learned/ to Hermes-style
 * subdirectory structure (skills-learned/<name>/SKILL.md).
 *
 * Also cleans up old file-based symlinks in skills/ and replaces
 * them with directory symlinks where appropriate.
 *
 * Usage: node scripts/migrate_skills_to_subdir.js [--dry-run]
 *
 * Migration from:
 *   skills-learned/<name>.md
 *   skills/_learned_<name>.md  → file symlink → skills-learned/<name>.md
 *
 * To:
 *   skills-learned/<name>/SKILL.md
 *   skills/_learned_<name>     → dir symlink  → skills-learned/<name>
 *
 * Idempotent: safe to run multiple times.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');
const SKILLS_DIR = path.join(WORKSPACE, 'skills-learned');
const SKILLS_ACTIVE = path.join(WORKSPACE, 'skills');
const ARCHIVE_DIR = path.join(SKILLS_DIR, '_archive');

const isDryRun = process.argv.includes('--dry-run');
const provenanceFlag = (() => {
  const idx = process.argv.indexOf('--provenance');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  const val = process.argv[idx + 1];
  if (!['agent', 'user', 'bundled'].includes(val)) {
    console.error(`❌ Invalid provenance: "${val}". Must be agent, user, or bundled.`);
    process.exit(1);
  }
  return val;
})();
const categoryFlag = (() => {
  const idx = process.argv.indexOf('--category');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
})();
let stats = { migrated: 0, skipped: 0, symlinksFixed: 0, orphanRemoved: 0, errors: 0 };

function log(msg) {
  console.log(isDryRun ? `[DRY-RUN] ${msg}` : msg);
}

function warn(msg) {
  console.warn(`  ⚠️ ${msg}`);
}

/**
 * Inject provenance field into SKILL.md frontmatter.
 * Adds `provenance: <value>` to existing frontmatter, or wraps content
 * in a minimal frontmatter block if none exists.
 */
/**
 * Inject category field into SKILL.md frontmatter.
 * Adds \`category: <value>\` to existing frontmatter, or wraps content
 * in a minimal frontmatter block if none exists.
 */
function injectCategory(content, category, skillFilePath) {
  if (!category) return content;
  const cleanCategory = category.replace(/^['"]|['"]$/g, '');
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match) {
    const fmBody = match[1];
    if (fmBody.includes('category:')) return content; // already has category
    const newFm = fmBody + '\ncategory: ' + cleanCategory;
    return content.replace(fmBody, newFm);
  }
  // No frontmatter — wrap in one
  const name = skillFilePath ? path.basename(path.dirname(skillFilePath)) : 'unnamed';
  return '---\nname: ' + name + '\ndescription: "(no description)"\nstatus: draft\ncategory: ' + cleanCategory + '\n---\n\n' + content.trim();
}

function injectProvenance(content, provenance, skillFilePath) {
  if (!provenance) return content;
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match) {
    const fmBody = match[1];
    if (fmBody.includes('provenance:')) return content; // already has provenance
    const newFm = fmBody + '\nprovenance: ' + provenance;
    return content.replace(fmBody, newFm);
  }
  // No frontmatter — wrap in one
  const name = skillFilePath ? path.basename(path.dirname(skillFilePath)) : 'unnamed';
  return '---\nname: ' + name + '\ndescription: "(no description)"\nstatus: draft\nprovenance: ' + provenance + '\n---\n\n' + content.trim();
}

// ── Phase 1: Migrate flat .md files → subdirectories ──

function migrateFlatFiles() {
  if (!fs.existsSync(SKILLS_DIR)) {
    log('📁 skills-learned/ does not exist, skipping.');
    return;
  }

  log('\n=== Phase 1: Migrate flat .md files ===');

  let entries;
  try {
    entries = fs.readdirSync(SKILLS_DIR);
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  let found = 0;

  for (const entry of entries) {
    const entryPath = path.join(SKILLS_DIR, entry);

    // Skip directories, backups, archive
    if (entry === '.backups' || entry === '_archive') continue;
    try {
      if (fs.statSync(entryPath).isDirectory()) continue;
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }

    // Must be a .md file
    if (!entry.endsWith('.md')) continue;
    found++;

    const skillName = entry.slice(0, -3); // remove .md
    const dirPath = path.join(SKILLS_DIR, skillName);
    const skillFilePath = path.join(dirPath, 'SKILL.md');

    if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) {
      warn(`Invalid skill name "${skillName}" — must be lowercase-kebab-case. Skipping.`);
      stats.skipped++;
      continue;
    }

    if (fs.existsSync(dirPath)) {
      if (fs.existsSync(skillFilePath)) {
        log(`   ⏭️  Already migrated: ${entry} → ${skillName}/SKILL.md`);
        stats.skipped++;
        continue;
      }
      // Directory exists but no SKILL.md — create it from flat file content
    }

    log(`   🔄 Migrating: ${entry} → ${skillName}/SKILL.md`);

    if (isDryRun) {
      stats.migrated++;
      continue;
    }

    try {
      // Read flat file content
      const content = fs.readFileSync(entryPath, 'utf8');

      // Tag with provenance if flag provided
      // Tag with category if flag provided
  let finalContent = provenanceFlag ? injectProvenance(content, provenanceFlag, skillFilePath) : content;
  finalContent = categoryFlag ? injectCategory(finalContent, categoryFlag, skillFilePath) : finalContent;

      // Create subdirectory
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Write SKILL.md
      fs.writeFileSync(skillFilePath, finalContent, 'utf8');

      // Remove old flat file
      fs.unlinkSync(entryPath);

      stats.migrated++;
      log(`   ✅ Created: ${dirPath}/SKILL.md (${finalContent.length} chars)`);
    } catch (e) {
      warn(`Failed to migrate ${entry}: ${e.message}`);
      stats.errors++;
    }
  }

  if (found === 0) {
    log('   No flat .md files found — nothing to migrate.');
  }
}

// ── Phase 2: Fix old file-based symlinks → directory symlinks ──

function fixSymlinks() {
  if (!fs.existsSync(SKILLS_ACTIVE)) {
    log('\n📁 skills/ does not exist, skipping symlink fix.');
    return;
  }

  log('\n=== Phase 2: Fix symlinks (file → directory) ===');

  let links;
  try {
    links = fs.readdirSync(SKILLS_ACTIVE).filter(f => f.startsWith('_learned_'));
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }

  for (const link of links) {
    const linkPath = path.join(SKILLS_ACTIVE, link);

    try {
      const stat = fs.lstatSync(linkPath);

      if (!stat.isSymbolicLink()) {
        // Not a symlink — leave it alone
        continue;
      }

      const target = fs.readlinkSync(linkPath);
      const isFileSymlink = stat.isSymbolicLink() && target.endsWith('.md');

      if (!isFileSymlink) {
        // Already a directory symlink (or other) — check validity
        if (fs.existsSync(target)) {
          log(`   ✅ Already correct: ${link} → ${target}`);
          continue;
        }
        // Broken symlink — remove
        log(`   🧹 Removing broken symlink: ${link}`);
        if (!isDryRun) {
          fs.unlinkSync(linkPath);
          stats.orphanRemoved++;
        } else {
          stats.orphanRemoved++;
        }
        continue;
      }

      // Old style: symlink to skills-learned/<name>.md
      // We need to convert to: symlink to skills-learned/<name>
      const targetBase = target.replace(/\.md$/, '');
      const newTarget = path.join(SKILLS_DIR, path.basename(targetBase));

      try {
        if (!fs.existsSync(newTarget) || !fs.statSync(newTarget).isDirectory()) {}
      } catch (e) {
        console.error(`Operation failed: ${e.message}`);
      }
        warn(`Target directory ${newTarget} does not exist — cannot fix ${link}`);
        stats.errors++;
        continue;

      log(`   🔗 Fixing symlink: ${link} (was file→.md, now dir→${path.basename(newTarget)})`);

      if (isDryRun) {
        stats.symlinksFixed++;
        continue;
      }

      // Remove old file symlink
      try {
        fs.unlinkSync(linkPath);
      } catch (e) {
        console.error(`File deletion failed: ${e.message}`);
      }

      // Create new directory symlink
      const relTarget = path.relative(path.dirname(linkPath), newTarget);
      fs.symlinkSync(relTarget, linkPath, 'dir');

      stats.symlinksFixed++;
      log(`   ✅ Symlink updated: ${link} → ${relTarget}`);

    } catch (e) {
      if (e.code === 'ENOENT') {
        // Symlink target doesn't exist — orphan
        log(`   🧹 Removing orphan symlink: ${link}`);
        if (!isDryRun) {
          try { fs.unlinkSync(linkPath); } catch (_) {}
          stats.orphanRemoved++;
        } else {
          stats.orphanRemoved++;
        }
      } else {
        warn(`Failed to process ${link}: ${e.message}`);
        stats.errors++;
      }
    }
  }
}

// ── Phase 3: Clean-up orphan archive entries (flat-file refs) ──

function cleanupArchive() {
  if (!fs.existsSync(ARCHIVE_DIR)) return;

  log('\n=== Phase 3: Clean up archived flat-file refs ===');

  let archived;
  try {
    archived = fs.readdirSync(ARCHIVE_DIR);
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  let found = 0;

  for (const entry of archived) {
    const entryPath = path.join(ARCHIVE_DIR, entry);
    try {
      if (entry.endsWith('.md') && fs.statSync(entryPath).isFile()) {}
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
      found++;
      const dirName = entry.slice(0, -3);
      const dirPath = path.join(ARCHIVE_DIR, dirName);
      const skillPath = path.join(dirPath, 'SKILL.md');

      log(`   🔄 Restructuring archived: ${entry} → ${dirName}/SKILL.md`);

      if (isDryRun) {
        stats.migrated++;
        continue;
      }

      try {
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        if (!fs.existsSync(skillPath)) {
          const content = fs.readFileSync(entryPath, 'utf8');
          fs.writeFileSync(skillPath, content, 'utf8');
        }
        fs.unlinkSync(entryPath);
        stats.migrated++;
      } catch (e) {
        warn(`Failed to restructure archived ${entry}: ${e.message}`);
        stats.errors++;
      }
    }
  }

  if (found === 0) log('   No archived flat .md files.');

// ── Report ──

function report() {
  console.log('\n═══════════════════════════════════════');
  console.log('Migration Report:');
  console.log(`  ✅  Migrated flat→subdir:       ${stats.migrated}`);
  console.log(`  ⏭️  Skipped (already done):    ${stats.skipped}`);
  console.log(`  🔗  Symlinks fixed (file→dir): ${stats.symlinksFixed}`);
  console.log(`  🧹  Orphan symlinks removed:   ${stats.orphanRemoved}`);
  console.log(`  ❌  Errors:                     ${stats.errors}`);
  console.log('═══════════════════════════════════════\n');

  // Show final state
  console.log('skills-learned/ contents:');
  if (fs.existsSync(SKILLS_DIR)) {
    try {
      for (const entry of fs.readdirSync(SKILLS_DIR)) {}
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
      const entryPath = path.join(SKILLS_DIR, entry);
      let isDir;
      try {
        isDir = fs.statSync(entryPath).isDirectory();
      } catch (e) {
        console.error(`Operation failed: ${e.message}`);
      }
      if (entry === '.backups' || entry === '_archive') {
        console.log(`  📁 ${entry}/ (system dir)`);
      } else if (isDir) {
        const hasSkill = fs.existsSync(path.join(entryPath, 'SKILL.md'));
        console.log(`  📂 ${entry}/${hasSkill ? ' ✅ has SKILL.md' : ' ❌ missing SKILL.md'}`);
      } else {
        console.log(`  📄 ${entry} (⚠️ flat file — will be handled next run)`);
      }
    }
  }

  console.log('\nskills/ learned symlinks:');
  if (fs.existsSync(SKILLS_ACTIVE)) {
    let links;
    try {
      links = fs.readdirSync(SKILLS_ACTIVE).filter(f => f.startsWith('_learned_'));
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
    if (links.length === 0) {
      console.log('  (none)');
    } else {
      for (const link of links) {
        const linkPath = path.join(SKILLS_ACTIVE, link);
        try {
          const stat = fs.lstatSync(linkPath);
          if (stat.isSymbolicLink()) {
            const target = fs.readlinkSync(linkPath);
            const exists = fs.existsSync(linkPath);
            console.log(`  🔗 ${link} → ${target} ${exists ? '✅' : '💥 broken'}`);
          } else {
            console.log(`  📄 ${link} (not a symlink)`);
          }
        } catch (e) {
          console.log(`  ❓ ${link} (error: ${e.message})`);
        }
      }
    }
  }

// ── tagExistingSkills — Scan & report provenance status ──

function tagExistingSkills() {
  console.log('\n=== tagExistingSkills() — Scan existing skills ===');
  console.log('🔍 This helper scans all skills and suggests provenance taggings.');
  console.log('   Run manually with: node -e "require(\'./migrate_skills_to_subdir.js\').tagExistingSkills()"\n');

  const untagged = [];
  const byCategory = {};
  let uncategorizedCount = 0;

  // Scan skills-learned/
  if (fs.existsSync(SKILLS_DIR)) {
    let dirs;
    try {
      dirs = fs.readdirSync(SKILLS_DIR).filter(f => true);
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
      if (f === '.backups' || f === '_archive') return false;
      try { return fs.statSync(path.join(SKILLS_DIR, f)).isDirectory(); }
      catch (_) { return false; }
    for (const dir of dirs) {
      const skillFile = path.join(SKILLS_DIR, dir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf8');
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) { untagged.push({ dir, reason: 'no frontmatter', source: 'skills-learned' }); continue; }
      if (!fm[1].includes('provenance:')) {
        untagged.push({ dir, reason: 'missing provenance', source: 'skills-learned' });
      }
      // Report category status — strip surrounding quotes
      const catMatch = fm[1].match(/category:\s*['"]?([^'"]+?)['"]?\s*$/m);
      const cat = catMatch ? catMatch[1].trim() : 'uncategorized';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(dir);
      if (cat === 'uncategorized') {
        uncategorizedCount++;
      }
    }
  }

  // Scan skills/ (built-ins) — DO NOT auto-tag, just list for reference
  if (fs.existsSync(SKILLS_ACTIVE)) {
    let dirs;
    try {
      dirs = fs.readdirSync(SKILLS_ACTIVE).filter(f => true);
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
      try { return fs.statSync(path.join(SKILLS_ACTIVE, f)).isDirectory(); }
      catch (_) { return false; }
    for (const dir of dirs) {
      // Skip _learned_ symlinks
      if (dir.startsWith('_learned_')) continue;
      const skillFile = path.join(SKILLS_ACTIVE, dir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf8');
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fm || !fm[1].includes('provenance:')) {
        untagged.push({ dir, reason: 'missing provenance', source: 'skills (built-in)' });
      }
    }
  }

  // Category summary
  console.log('\n📁 Skills by category:\n');
  const sortedCats = Object.keys(byCategory).sort();
  for (const cat of sortedCats) {
    console.log(`   ${cat}: ${byCategory[cat].length} skills`);
    for (const d of byCategory[cat]) {
      console.log(`     - ${d}`);
    }
  }
  if (uncategorizedCount > 0) {
    console.log(`\n⚠️ ${uncategorizedCount} skill(s) uncategorized. Use --category flag to assign.`);
  }

  if (untagged.length === 0) {
    console.log('\n✅ All skills have provenance tags.');
  } else {
    console.log(`⚠️ ${untagged.length} skills need provenance tagging:\n`);
    for (const u of untagged) {
      console.log(`   - ${u.dir} (${u.source}): ${u.reason}`);
    }
    console.log('\n💡 To tag skills-learned skills, run:');
    console.log('   node scripts/migrate_skills_to_subdir.js --provenance agent');
    console.log('\n💡 Built-in skills in skills/ require manual frontmatter updates.');
  }

  return untagged;
}

// ── Main ──

function main() {
  log(`🔧 Skill subdirectory migration script`);
  log(`   Workspace: ${WORKSPACE}`);
  log(`   Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  log(`   Time: ${new Date().toISOString()}\n`);

  migrateFlatFiles();
  fixSymlinks();
  cleanupArchive();
  report();
}

if (require.main === module) {
  main();
}

module.exports = { tagExistingSkills };
