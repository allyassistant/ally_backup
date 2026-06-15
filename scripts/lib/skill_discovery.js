'use strict';

const fs = require('fs');
const path = require('path');
const { extractField } = require('./frontmatter');

/**
 * Discover skill directories in baseDir.
 */
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
    console.error(`Operation failed: ${e.message}`);
  }
  return [];
}

// Alias for compatibility
const listSkillDirs = discoverSkillDirs;

/**
 * List skill metadata from skills-learned/ directory.
 * Returns array of { dir, description, status, category } objects.
 *
 * Uses shared frontmatter parser (Issue #133 DRY cleanup) instead of inline
 * regex so skill discovery stays in sync with skill-auto-suggest and the
 * skill reviewer pipeline.
 */
function listSkillMetadata(skillsDir) {
  const dirs = discoverSkillDirs(skillsDir);
  return dirs.map(dir => {
    const sklPath = path.join(skillsDir, dir, 'SKILL.md');
    const meta = { dir, description: '(no description)', status: '(no status)', category: '(no category)' };
    try {
      if (fs.existsSync(sklPath)) {
        const content = fs.readFileSync(sklPath, 'utf8');
        const description = extractField(content, 'description');
        const status = extractField(content, 'status');
        const category = extractField(content, 'category');
        if (description) meta.description = description;
        if (status) meta.status = status;
        if (category) meta.category = category;
      }
    } catch {}
    return meta;
  });
}

/**
 * Check whether a frontmatter field is set to a truthy value (true/yes/1).
 * Uses shared frontmatter parser to stay consistent with the rest of the
 * skill pipeline.
 */
function isFrontmatterFieldTruthy(content, fieldName) {
  const value = extractField(content, fieldName);
  if (!value) return false;
  return /^(true|yes|1)$/i.test(value.trim());
}

/**
 * List all skills from multiple base directories, grouped by category.
 * Skips duplicates (same dir name already seen), draft/archived skills,
 * and skills with disable-model-invocation: true.
 * Returns object: { "Category": [{ name, description }, ...], ... }
 */
function listCategorizedSkills(baseDirs) {
  const categorized = {};
  const seen = new Set();  // deduplicate skills by canonical name
  for (const baseDir of baseDirs) {
    const dirs = discoverSkillDirs(baseDir);
    for (const dir of dirs) {
      // Normalize learned-skill symlinks: skills/_learned_foo -> foo
      const name = dir.replace(/^_learned_/, '');
      if (seen.has(name)) continue;
      seen.add(name);

      const sklPath = path.join(baseDir, dir, 'SKILL.md');
      let description = '(no description)';
      let category = 'General';
      let skip = false;
      try {
        if (fs.existsSync(sklPath)) {
          const content = fs.readFileSync(sklPath, 'utf8');
          const descriptionField = extractField(content, 'description');
          const categoryField = extractField(content, 'category');
          const statusField = extractField(content, 'status');
          if (descriptionField) description = descriptionField.trim();
          if (categoryField) category = categoryField.trim();
          const status = statusField ? statusField.trim().toLowerCase() : 'active';
          if (status === 'draft' || status === 'archived') skip = true;
          if (!skip && isFrontmatterFieldTruthy(content, 'disable-model-invocation')) skip = true;
        }
      } catch {}
      if (skip) continue;
      if (!categorized[category]) categorized[category] = [];
      categorized[category].push({ name, description });
    }
  }
  return categorized;
}

module.exports = {
  discoverSkillDirs,
  listSkillDirs,
  listSkillMetadata,
  listCategorizedSkills,
  isFrontmatterFieldTruthy,
};
