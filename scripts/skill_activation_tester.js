'use strict';

/**
 * Skill Activation Tester (M1.7)
 *
 * Verifies that manual skills (disable-model-invocation: true or activation: manual)
 * are NOT auto-recallable from the categorized skill catalog injected into prompts.
 *
 * Exit codes:
 *   0 = all manual skills correctly excluded
 *   1 = one or more manual skills still appear in auto-recall catalog
 */

const fs = require('fs');
const path = require('path');
const { listCategorizedSkills, isFrontmatterFieldTruthy } = require('./lib/skill_discovery');
const { extractField } = require('./lib/frontmatter');

const BASE_DIRS = [
  path.join(__dirname, '..', 'skills'),
  path.join(__dirname, '..', 'skills-learned'),
];

function discoverSkillDirs(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  try {
    return fs.readdirSync(baseDir)
      .filter(f => {
        const fp = path.join(baseDir, f);
        try {
          return fs.statSync(fp).isDirectory() && !f.startsWith('.') && f !== '_archive';
        } catch {
          return false;
        }
      });
  } catch (e) {
    console.error(`Failed to read ${baseDir}: ${e.message}`);
    return [];
  }
}

function findManualSkills() {
  const manual = [];
  const seen = new Set();
  for (const baseDir of BASE_DIRS) {
    for (const dir of discoverSkillDirs(baseDir)) {
      const name = dir.replace(/^_learned_/, '');
      if (seen.has(name)) continue;
      seen.add(name);

      const sklPath = path.join(baseDir, dir, 'SKILL.md');
      if (!fs.existsSync(sklPath)) continue;
      try {
        const content = fs.readFileSync(sklPath, 'utf8');
        const disabled = isFrontmatterFieldTruthy(content, 'disable-model-invocation');
        const activation = extractField(content, 'activation');
        const isManual = disabled || (activation && activation.toLowerCase() === 'manual');
        if (isManual) {
          manual.push({
            name,
            dir,
            path: sklPath,
            reason: disabled ? 'disable-model-invocation: true' : `activation: ${activation}`,
            activationReason: extractField(content, 'activationReason') || '(missing)',
          });
        }
      } catch (e) {
        console.error(`Failed to read ${sklPath}: ${e.message}`);
      }
    }
  }
  return manual;
}

function main() {
  const manualSkills = findManualSkills();
  const catalog = listCategorizedSkills(BASE_DIRS);
  const catalogNames = new Set();
  for (const category of Object.keys(catalog)) {
    for (const skill of catalog[category]) {
      catalogNames.add(skill.name);
    }
  }

  const leaks = [];
  for (const skill of manualSkills) {
    if (catalogNames.has(skill.name)) {
      leaks.push(skill);
    }
  }

  const missingReason = manualSkills.filter(s => s.activationReason === '(missing)');

  console.log(`═══ Skill Activation Tester (M1.7) ═══`);
  console.log(`Manual skills found: ${manualSkills.length}`);
  for (const skill of manualSkills) {
    const status = catalogNames.has(skill.name) ? '❌ LEAKED' : '✅ excluded';
    console.log(`  ${status} ${skill.name} (${skill.reason})`);
  }

  if (missingReason.length > 0) {
    console.warn(`\n⚠️  ${missingReason.length} manual skill(s) missing activationReason:`);
    for (const skill of missingReason) {
      console.warn(`  - ${skill.name}`);
    }
  }

  if (leaks.length > 0) {
    console.error(`\n❌ FAIL: ${leaks.length} manual skill(s) still appear in auto-recall catalog:`);
    for (const skill of leaks) {
      console.error(`  - ${skill.name}`);
    }
    process.exit(1);
  }

  console.log(`\n✅ PASS: all ${manualSkills.length} manual skill(s) are excluded from auto-recall catalog.`);
  process.exit(0);
}

main();
