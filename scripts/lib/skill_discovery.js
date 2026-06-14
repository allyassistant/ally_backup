'use strict';

const fs = require('fs');
const path = require('path');

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
 */
function listSkillMetadata(skillsDir) {
  const dirs = discoverSkillDirs(skillsDir);
  return dirs.map(dir => {
    const sklPath = path.join(skillsDir, dir, 'SKILL.md');
    const meta = { dir, description: '(no description)', status: '(no status)', category: '(no category)' };
    try {
      if (fs.existsSync(sklPath)) {
        const content = fs.readFileSync(sklPath, 'utf8');
        const descMatch = content.match(/description:\s*["']([^"']+)["']/i);
        const statMatch = content.match(/status:\s*["']([^"']+)["']/i);
        const catMatch  = content.match(/category:\s*["']([^"']+)["']/i);
        if (descMatch) meta.description = descMatch[1];
        if (statMatch) meta.status = statMatch[1];
        if (catMatch)  meta.category  = catMatch[1];
      }
    } catch {}
    return meta;
  });
}

/**
 * List all skills from multiple base directories, grouped by category.
 * Skips duplicates (same dir name already seen).
 * Returns object: { "Category": [{ name, description }, ...], ... }
 */
function listCategorizedSkills(baseDirs) {
  const categorized = {};
  const seen = new Set();  // deduplicate skills by dir name
  for (const baseDir of baseDirs) {
    const dirs = discoverSkillDirs(baseDir);
    for (const dir of dirs) {
      if (seen.has(dir)) continue;
      seen.add(dir);

      const sklPath = path.join(baseDir, dir, 'SKILL.md');
      let name = dir;
      let description = '(no description)';
      let category = 'General';
      try {
        if (fs.existsSync(sklPath)) {
          const content = fs.readFileSync(sklPath, 'utf8');
          const descMatch = content.match(/description:\s*['"]?([^'"\n]+)['"]?/i);
          const catMatch  = content.match(/category:\s*['"]?([^'"\n]+)['"]?/i);
          if (descMatch) description = descMatch[1].trim();
          if (catMatch)  category  = catMatch[1].trim();
        }
      } catch {}
      if (!categorized[category]) categorized[category] = [];
      categorized[category].push({ name, description });
    }
  }
  return categorized;
}

module.exports = { discoverSkillDirs, listSkillDirs, listSkillMetadata, listCategorizedSkills };
