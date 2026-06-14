#!/usr/bin/env node
/**
 * frontmatter.js — Shared YAML frontmatter parser/serializer for SKILL.md
 *
 * Replaces 9+ inline regex copies of /^---\n([\s\S]*?)\n---/ across:
 *   - scripts/weekly_correction_loop.js (3 sites)
 *   - scripts/skill_reviewer.js (2 sites)
 *   - scripts/migrate_skills_to_subdir.js (3 sites)
 *   - extensions/skill-learner/index.mjs (2 sites)
 *   - extensions/skill-tools/index.mjs (2 sites)
 *
 * Issue #133: DRY violation cleanup (Phase B)
 *
 * Usage:
 *   const { parseFrontmatter, extractField, serializeFrontmatter } = require('./lib/frontmatter');
 *   const { fields, body } = parseFrontmatter(content);
 *   const desc = extractField(content, 'description');
 *   const newContent = serializeFrontmatter({ name, description, status }, body);
 */

'use strict';

// Match the YAML frontmatter block at the start of a file.
// Captures everything between the two `---` markers (greedy match safe due to fixed delimiters).
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// Single-line field extractor: ^field:\s*value$ (with optional quoting)
const FIELD_RE = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'm');

/**
 * Parse YAML frontmatter into structured fields + body.
 * Returns { fields: {name, description, ...}, body: string } or null if no frontmatter.
 *
 * @param {string} content - Full file content
 * @returns {{ fields: Object<string, string>, body: string } | null}
 */
function parseFrontmatter(content) {
  if (typeof content !== 'string' || !content) return null;
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;

  const yaml = match[1];
  const body = match[2];

  // Parse YAML key:value lines (simple format — no nested objects)
  const fields = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (m) {
      const key = m[1];
      let value = m[2].trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fields[key] = value;
    }
  }

  return { fields, body };
}

/**
 * Extract a single frontmatter field by name. Returns null if not found.
 * More efficient than parseFrontmatter when you only need one field.
 *
 * @param {string} content - Full file content
 * @param {string} fieldName - Field to extract (e.g. 'description')
 * @returns {string | null}
 */
function extractField(content, fieldName) {
  if (typeof content !== 'string') return null;
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const yaml = match[1];
  const fieldRe = FIELD_RE(fieldName);
  const m = yaml.match(fieldRe);
  if (!m) return null;
  let value = m[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

/**
 * Build a YAML frontmatter block from an object of fields.
 * Used when creating new SKILL.md files.
 *
 * @param {Object<string, string>} fields - Key-value pairs for frontmatter
 * @returns {string} - YAML block with leading and trailing `---` markers
 */
function serializeFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    // Quote values that contain special YAML chars or look like booleans/numbers
    if (typeof value === 'string' && /[:"#{}[\]&*!|>%@`\n]/.test(value)) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

module.exports = {
  parseFrontmatter,
  extractField,
  serializeFrontmatter,
  FRONTMATTER_RE,  // exported for advanced cases
};
