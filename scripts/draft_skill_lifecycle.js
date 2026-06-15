#!/usr/bin/env node
/**
 * draft_skill_lifecycle.js — Promote or archive draft skills.
 *
 * Promote: set status: active, create skills/ symlink, set generatedAt.
 * Archive:  move directory to skills-learned/_archive/.
 *
 * Usage:
 *   node scripts/draft_skill_lifecycle.js --promote skill-a skill-b
 *   node scripts/draft_skill_lifecycle.js --archive skill-c skill-d
 *   node scripts/draft_skill_lifecycle.js --archive-all-stale 30
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SKILLS_DIR = path.join(HOME, '.openclaw', 'workspace', 'skills');
const SKILLS_LEARNED_DIR = path.join(HOME, '.openclaw', 'workspace', 'skills-learned');
const ARCHIVE_DIR = path.join(SKILLS_LEARNED_DIR, '_archive');

function readSkillMd(dir) {
  const file = path.join(dir, 'SKILL.md');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`[draft_skill_lifecycle] failed to read ${file}: ${err.message}`);
  }
  return '';
}

function writeSkillMd(dir, content) {
  const file = path.join(dir, 'SKILL.md');
  try {
    fs.writeFileSync(file, content, 'utf8');
  } catch (err) {
    console.error(`[draft_skill_lifecycle] failed to write ${file}: ${err.message}`);
    throw err;
  }
}

function setStatus(content, status) {
  if (/^status:/im.test(content)) {
    return content.replace(/^status:.*$/im, `status: ${status}`);
  }
  // Insert after frontmatter closing --- if present
  return content.replace(/^(---\r?\n)/m, `---\nstatus: ${status}\n`);
}

function updateGeneratedAt(content) {
  const now = new Date().toISOString();
  if (/^generatedAt:/im.test(content)) {
    return content.replace(/^generatedAt:.*$/im, `generatedAt: ${now}`);
  }
  return content.replace(/^(---\r?\n)/m, `---\ngeneratedAt: ${now}\n`);
}

function promoteSkill(name) {
  const sourceDir = path.join(SKILLS_LEARNED_DIR, name);
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ skill not found: ${name}`);
    return false;
  }

  let content = readSkillMd(sourceDir);
  content = setStatus(content, 'active');
  content = updateGeneratedAt(content);
  writeSkillMd(sourceDir, content);

  const linkName = `_learned_${name}`;
  const linkPath = path.join(SKILLS_DIR, linkName);
  const relTarget = path.join('..', 'skills-learned', name);

  try {
    if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
    fs.symlinkSync(relTarget, linkPath);
  } catch (err) {
    console.error(`❌ failed to create symlink for ${name}: ${err.message}`);
    return false;
  }

  console.log(`✅ Promoted ${name} to active and linked ${linkPath}`);
  return true;
}

function archiveSkill(name) {
  const sourceDir = path.join(SKILLS_LEARNED_DIR, name);
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ skill not found: ${name}`);
    return false;
  }

  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  // Move to archive with timestamp to avoid collisions
  const ts = Date.now();
  const destDir = path.join(ARCHIVE_DIR, `${name}-${ts}`);

  try {
    fs.renameSync(sourceDir, destDir);
  } catch (err) {
    console.error(`❌ failed to archive ${name}: ${err.message}`);
    return false;
  }

  // Remove active symlink if exists
  const linkPath = path.join(SKILLS_DIR, `_learned_${name}`);
  if (fs.existsSync(linkPath)) {
    try { fs.unlinkSync(linkPath); } catch {}
  }

  console.log(`✅ Archived ${name} → ${destDir}`);
  return true;
}

function archiveAllStale(days) {
  const entries = fs.readdirSync(SKILLS_LEARNED_DIR, { withFileTypes: true });
  const draftDirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_archive')
    .map(e => path.join(SKILLS_LEARNED_DIR, e.name))
    .filter(dir => {
      const content = readSkillMd(dir);
      const status = (content.match(/^status:\s*(.+)/im) || [])[1]?.trim().toLowerCase() || '';
      return status === 'draft';
    });

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let archived = 0;
  for (const dir of draftDirs) {
    const content = readSkillMd(dir);
    const generatedAt = (content.match(/^generatedAt:\s*(.+)/im) || [])[1]?.trim() || '';
    const d = new Date(generatedAt);
    if (!generatedAt || isNaN(d.getTime()) || d.getTime() < cutoff) {
      const name = path.basename(dir);
      if (archiveSkill(name)) archived++;
    }
  }
  console.log(`\nArchived ${archived} stale draft skill(s)`);
}

function main() {
  const args = process.argv.slice(2);
  const promoteIdx = args.indexOf('--promote');
  const archiveIdx = args.indexOf('--archive');
  const archiveStaleIdx = args.indexOf('--archive-all-stale');

  if (promoteIdx >= 0) {
    const names = args.slice(promoteIdx + 1).filter(a => !a.startsWith('--'));
    let ok = 0;
    for (const name of names) if (promoteSkill(name)) ok++;
    console.log(`\nPromoted ${ok}/${names.length}`);
    process.exit(ok === names.length ? 0 : 1);
  }

  if (archiveIdx >= 0) {
    const names = args.slice(archiveIdx + 1).filter(a => !a.startsWith('--'));
    let ok = 0;
    for (const name of names) if (archiveSkill(name)) ok++;
    console.log(`\nArchived ${ok}/${names.length}`);
    process.exit(ok === names.length ? 0 : 1);
  }

  if (archiveStaleIdx >= 0) {
    const days = parseInt(args[archiveStaleIdx + 1], 10) || 30;
    archiveAllStale(days);
    return;
  }

  console.error('Usage: node scripts/draft_skill_lifecycle.js --promote <skill>...');
  console.error('       node scripts/draft_skill_lifecycle.js --archive <skill>...');
  console.error('       node scripts/draft_skill_lifecycle.js --archive-all-stale <days>');
  process.exit(1);
}

main();
