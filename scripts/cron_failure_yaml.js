#!/usr/bin/env node
/**
 * cron_failure_yaml.js — Minimal line-based YAML parser
 *
 * Intentionally avoids the `js-yaml` npm dependency (cron-watch.yaml is
 * flat key:value + one nested array). Supports:
 *   - top-level scalars (string / number / boolean)
 *   - nested arrays under one key (`cronAllowList: [...]`, `cronDenyList: [...]`)
 *   - comments (`# ...`)
 *   - quoted strings (single or double)
 *
 * Returns an object. Unknown keys are preserved as strings.
 *
 * Phase 1 SHADOW only — diagnostic logging. No side effects.
 */

'use strict';

const fs = require('fs');

/**
 * Strip inline + full-line comments, leaving quoted content intact.
 * @param {string} line
 * @returns {string}
 */
function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Coerce a raw YAML scalar to a JS primitive.
 * @param {string} raw
 * @returns {string|number|boolean}
 */
function coerceScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // strip surrounding quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  // numeric
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  return trimmed;
}

/**
 * Parse a flat (one-deep array nesting) YAML string.
 * @param {string} text
 * @returns {object}
 */
function parseCronWatchYaml(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let currentArrayKey = null;

  for (let raw of lines) {
    const stripped = stripComment(raw).trim();
    if (stripped === '') continue;
    if (currentArrayKey !== null) {
      // we're inside an array block; look for `  - value`
      const arrMatch = stripped.match(/^-\s+(.+)$/);
      if (arrMatch) {
        out[currentArrayKey].push(coerceScalar(arrMatch[1]));
        continue;
      }
      // closing the array (next top-level key handles it; reset defensively)
      if (stripped.includes(':')) {
        currentArrayKey = null;
        // fall through to handle the new key
      } else {
        // not an array element, not a key — ignore (avoid throwing on whitespace)
        continue;
      }
    }
    const colonIdx = stripped.indexOf(':');
    if (colonIdx === -1) continue;
    const key = stripped.slice(0, colonIdx).trim();
    const rest = stripped.slice(colonIdx + 1).trim();
    if (rest === '') {
      // likely the start of an array block
      out[key] = [];
      currentArrayKey = key;
      continue;
    }
    // array inline syntax: `key: [a, b, c]`
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      if (inner === '') {
        out[key] = [];
      } else {
        out[key] = inner.split(',').map(s => coerceScalar(s.trim()));
      }
      continue;
    }
    out[key] = coerceScalar(rest);
  }
  return out;
}

/**
 * Read & parse `~/.openclaw/cron-watch.yaml`. Returns {} if the file is missing.
 * Throws only on hard parse errors (e.g. invalid UTF-8).
 * @param {string} filePath
 * @returns {object}
 */
function loadCronWatchYaml(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
  return parseCronWatchYaml(raw);
}

module.exports = {
  parseCronWatchYaml,
  loadCronWatchYaml,
};

// Allow `node cron_failure_yaml.js <file>` to dump as JSON for debugging.
if (require.main === module) {
  const [, , filePath] = process.argv;
  if (!filePath) {
    console.error('Usage: node cron_failure_yaml.js <yaml-file>');
    process.exit(2);
  }
  try {
    const result = loadCronWatchYaml(filePath);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`parse failed: ${err.message}`);
    process.exit(1);
  }
}
