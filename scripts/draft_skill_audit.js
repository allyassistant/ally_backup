#!/usr/bin/env node
/**
 * draft_skill_audit.js — Audit draft skills and recommend promote / archive / keep.
 *
 * Scoring:
 *   - description length and structure
 *   - presence of trigger phrases ("Use when:", "Use if:")
 *   - overlap with active skills (description similarity)
 *   - frontmatter generatedAt age
 *
 * Usage:
 *   node scripts/draft_skill_audit.js
 *   node scripts/draft_skill_audit.js --promote <skill-dir>
 *   node scripts/draft_skill_audit.js --archive <skill-dir>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILLS_LEARNED_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'skills-learned');

function listSkills() {
  let entries;
  try {
    entries = fs.readdirSync(SKILLS_LEARNED_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`[draft_skill_audit] failed to read skills dir: ${err.message}`);
    return [];
  }
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_archive')
    .map(e => {
      const dir = path.join(SKILLS_LEARNED_DIR, e.name);
      const file = path.join(dir, 'SKILL.md');
      let content = '';
      try {
        if (fs.existsSync(file)) content = fs.readFileSync(file, 'utf8');
      } catch (err) {
        console.error(`[draft_skill_audit] failed to read ${file}: ${err.message}`);
      }
      const status = (content.match(/^status:\s*(.+)/im) || [])[1]?.trim().toLowerCase() || '';
      const description = (content.match(/^description:\s*(.+)/im) || [])[1]?.trim() || '';
      const generatedAt = (content.match(/^generatedAt:\s*(.+)/im) || [])[1]?.trim() || '';
      return { name: e.name, dir, content, status, description, generatedAt };
    });
}

function scoreDescription(desc) {
  let score = 0;
  const issues = [];
  if (!desc) return { score: 0, issues: ['missing description'] };
  if (desc.length >= 80) score += 2;
  else if (desc.length >= 40) score += 1;
  else issues.push('description too short');

  if (/Use when:/i.test(desc)) score += 2;
  else if (/Use if:/i.test(desc)) score += 1;
  else issues.push('no clear trigger phrase');

  if (/capabilities|steps|workflow|checklist/i.test(desc)) score += 1;

  return { score, issues };
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function wordOverlap(a, b) {
  const normalize = s => (s || '').toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, ' ').split(' ').filter(Boolean);
  const wa = new Set(normalize(a));
  const wb = normalize(b);
  const overlap = wb.filter(w => wa.has(w)).length;
  return wb.length > 0 ? overlap / wb.length : 0;
}

function findOverlap(draft, activeSkills) {
  const overlaps = activeSkills
    .map(a => ({ skill: a.name, score: wordOverlap(draft.description, a.description) }))
    .filter(o => o.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return overlaps;
}

function classify(draft, activeSkills) {
  const desc = scoreDescription(draft.description);
  const ageDays = daysSince(draft.generatedAt);
  const overlaps = findOverlap(draft, activeSkills);

  const reasons = [];
  let recommendation = 'KEEP_DRAFT';

  if (overlaps.length > 0 && overlaps[0].score > 0.5) {
    reasons.push(`high overlap with active skill "${overlaps[0].skill}" (${(overlaps[0].score * 100).toFixed(0)}%)`);
    recommendation = 'ARCHIVE';
  }

  if (desc.score >= 4 && overlaps.length === 0) {
    recommendation = 'PROMOTE';
    reasons.push('good description, no active overlap');
  } else if (desc.score < 2) {
    recommendation = 'KEEP_DRAFT';
    reasons.push(...desc.issues);
  }

  if (ageDays > 30 && recommendation !== 'PROMOTE') {
    reasons.push(`stale draft (${Math.round(ageDays)} days)`);
    if (recommendation === 'KEEP_DRAFT') recommendation = 'ARCHIVE';
  }

  return {
    ...draft,
    descScore: desc.score,
    descIssues: desc.issues,
    ageDays,
    overlaps,
    recommendation,
    reasons,
  };
}

function printReport(rows) {
  const grouped = { PROMOTE: [], KEEP_DRAFT: [], ARCHIVE: [] };
  for (const r of rows) grouped[r.recommendation].push(r);

  console.log('═══ Draft Skill Audit Report ═══\n');
  console.log(`Total draft skills: ${rows.length}\n`);

  for (const rec of ['PROMOTE', 'KEEP_DRAFT', 'ARCHIVE']) {
    const list = grouped[rec];
    if (list.length === 0) continue;
    console.log(`\n## ${rec} (${list.length})`);
    for (const r of list) {
      console.log(`\n  • ${r.name}`);
      console.log(`    description: ${r.description.slice(0, 100)}${r.description.length > 100 ? '...' : ''}`);
      console.log(`    descScore: ${r.descScore}/5, age: ${r.ageDays === Infinity ? 'unknown' : Math.round(r.ageDays) + ' days'}`);
      console.log(`    reasons: ${r.reasons.join('; ')}`);
      if (r.overlaps.length > 0) {
        console.log(`    overlaps: ${r.overlaps.map(o => `${o.skill}(${(o.score * 100).toFixed(0)}%)`).join(', ')}`);
      }
    }
  }

  console.log('\n─── Batch commands ───');
  const promoteNames = grouped.PROMOTE.map(r => r.name).join(' ');
  const archiveNames = grouped.ARCHIVE.map(r => r.name).join(' ');
  if (promoteNames) console.log(`# Promote:\nnode scripts/draft_skill_lifecycle.js --promote ${promoteNames}`);
  if (archiveNames) console.log(`# Archive:\nnode scripts/draft_skill_lifecycle.js --archive ${archiveNames}`);
}

function main() {
  const skills = listSkills();
  const draftSkills = skills.filter(s => s.status === 'draft');
  const activeSkills = skills.filter(s => s.status === 'active');

  if (draftSkills.length === 0) {
    console.log('No draft skills found.');
    return;
  }

  const report = draftSkills.map(d => classify(d, activeSkills));
  printReport(report);
}

main();
