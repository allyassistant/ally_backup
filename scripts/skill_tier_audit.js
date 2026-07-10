#!/usr/bin/env node
/**
 * skill-tier-audit.js — Phase 2g migration audit
 *
 * Walks skills-learned/ and skills-learned/_archive/, classifies each skill by
 * tier from frontmatter, runs scripts/validate_skill_file.js, and cross-references
 * .skill_junk_rate.jsonl passedAndQuarantined list.
 *
 * Output: .analysis/skill-tier-audit-<date>.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WS = process.env.WORKSPACE || path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(WS, 'skills-learned');
const ARCHIVE_DIR = path.join(SKILLS_DIR, '_archive');
const VALIDATOR = path.join(WS, 'scripts', 'validate_skill_file.js');
const JUNK_LOG = path.join(WS, '.skill_junk_rate.jsonl');
const ANALYSIS_DIR = path.join(WS, '.analysis');

function findSkillFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
    return out;
  }
  for (const entry of entries) {
    if (entry?.name?.startsWith('.')) continue;
    if (entry?.name?.startsWith('quarantine-') && entry.isDirectory()) continue;
    if (entry.name === 'failed-validations') continue;
    if (entry.name === 'quarantine-2026-06-10') continue;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const skill = path.join(full, 'SKILL.md');
      if (fs.existsSync(skill)) {
        out.push({ name: entry.name, skillPath: skill, inArchive: rootDir === ARCHIVE_DIR });
      }
    }
  }
  return out;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { status: null, name: null, source: null };
  const fm = m[1];
  const get = (key) => {
    const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm');
    const mm = fm.match(re);
    return mm ? mm[1].replace(/^["']|["']$/g, '').trim() : null;
  };
  return {
    status: get('status'),
    name: get('name'),
    source: get('source'),
  };
}

function classifyTier(fmStatus, inArchive) {
  if (inArchive) return 'archived';
  if (fmStatus === 'draft') return 'draft';
  if (fmStatus === 'archived') return 'archived';
  if (fmStatus === 'active') return 'active';
  return 'unknown';
}

function countWorkflowSteps(content) {
  const m = content.match(/^##\s+Workflow\s*$/m);
  if (!m) return 0;
  const startIdx = m.index + m[0].length;
  const rest = content.slice(startIdx);
  const nextHeader = rest.match(/^##\s+(?!#)/m);
  const wc = nextHeader ? rest.slice(0, nextHeader.index) : rest;
  const steps = wc.match(/^(?:#{1,3}\s+)?\d+\.\s+[^\n]+/gm) || [];
  return steps.length;
}

function countPitfalls(content) {
  const m = content.match(/^(?:#{1,3}\s+|\*\*)Pitfalls:?\s*(?:\*\*)?$/im);
  if (!m) return 0;
  const startIdx = m.index + m[0].length;
  const rest = content.slice(startIdx);
  const nextHeader = rest.match(/^(?:#{1,3}\s+|\*\*)[^*\n]/m);
  const pc = nextHeader ? rest.slice(0, nextHeader.index) : rest;
  return (pc.match(/^(?:- (?:⚠️?\s*)?|###\s+(?:\d+\.\s+)?(?:⚠️?\s*)?)\S/gm) || []).length;
}

function runValidator(skillPath) {
  try {
    execFileSync('node', [VALIDATOR, skillPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { result: 'pass', reasons: [] };
  } catch (e) {
    const stderr = (e.stderr ? e?.stderr?.toString() : '').trim();
    const reasons = stderr.split('\n')
      .filter(l => l.startsWith('INVALID:'))
      .map(l => l.replace(/^INVALID:\s*/, ''));
    return { result: 'fail', reasons };
  }
}

function loadPassedAndQuarantined() {
  if (!fs.existsSync(JUNK_LOG)) return [];
  // take the most recent 7-day window entry (the one that shows 6 inconsistencies)
  let latest;
  const lines = fs.readFileSync(JUNK_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.windowDays === 7 && Array.isArray(d.passedAndQuarantined)) {
      if (!latest || d.ts > latest.ts) latest = d;
    }
  }
  return latest ? latest.passedAndQuarantined : [];
}

function main() {
  const activeSkills = findSkillFiles(SKILLS_DIR);
  const archivedSkills = findSkillFiles(ARCHIVE_DIR);
  const allSkills = activeSkills.concat(archivedSkills);

  const perSkill = [];
  let validatePasses = 0;
  let validateFails = 0;
  const byTier = { draft: 0, active: 0, archived: 0, unknown: 0 };

  for (const s of allSkills) {
    const content = fs.readFileSync(s.skillPath, 'utf8');
    const fm = parseFrontmatter(content);
    const tier = classifyTier(fm.status, s.inArchive);
    const currentStatus = fm.status || (s.inArchive ? 'archived' : 'unknown');
    byTier[tier] = (byTier[tier] || 0) + 1;

    const hasWorkflow = /^##\s+Workflow/m.test(content);
    const pitHeader = content.match(/^(?:#{1,3}\s+|\*\*)Pitfalls:?\s*(?:\*\*)?$/im);
    const hasPitfalls = !!pitHeader;
    const workflowStepCount = countWorkflowSteps(content);
    const pitfallCount = countPitfalls(content);

    const v = runValidator(s.skillPath);
    if (v.result === 'pass') validatePasses++;
    else validateFails++;

    perSkill.push({
      name: s.name,
      currentStatus,
      proposedTier: tier,
      fileSize: content.length,
      hasWorkflow,
      hasPitfalls,
      workflowStepCount,
      pitfallCount,
      validateSkillFileResult: v.result,
      validatorReasons: v.reasons,
      inArchive: s.inArchive,
      frontmatterStatus: fm.status,
      frontmatterName: fm.name,
      frontmatterSource: fm.source,
    });
  }

  const passedAndQuarantined = loadPassedAndQuarantined();
  const summary = {
    totalActive: activeSkills.length,
    totalArchived: archivedSkills.length,
    byTier: {
      draft: byTier.draft || 0,
      active: byTier.active || 0,
      archived: byTier.archived || 0,
      unknown: byTier.unknown || 0,
    },
    validateSkillFilePasses: validatePasses,
    validateSkillFileFails: validateFails,
    passedAndQuarantined,
  };

  const report = {
    auditDate: new Date().toISOString(),
    summary,
    perSkill: perSkill.sort((a, b) => a?.name?.localeCompare(b.name)),
  };

  try {
    if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const outFile = path.join(ANALYSIS_DIR, `skill-tier-audit-${dateStr}.json`);
  try {
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  console.log(`Wrote ${outFile}`);
  console.log(`Summary: ${activeSkills.length} active + ${archivedSkills.length} archived = ${allSkills.length} total`);
  console.log(`Tiers: draft=${byTier.draft} active=${byTier.active} archived=${byTier.archived} unknown=${byTier.unknown}`);
  console.log(`Validator: ${validatePasses} pass / ${validateFails} fail`);
  console.log(`passedAndQuarantined (7-day window): ${passedAndQuarantined.length} skills`);
  if (passedAndQuarantined.length) console.log('  ' + passedAndQuarantined.join(', '));
}

main();
