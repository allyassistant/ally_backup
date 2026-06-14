#!/usr/bin/env node
/**
 * path_safety.js — Shared path traversal guards.
 *
 * Consolidates two near-duplicate implementations:
 *   - skill-tools/index.mjs: validatePathWithin(base, target) — checks target is within base
 *   - umbrella_consolidation.js: sanitizeSupportPath(p) — checks LLM-provided path is safe
 *
 * Issue #133: DRY violation cleanup (Phase D)
 *
 * Usage:
 *   const { isPathWithin, isSafeSupportPath } = require('./lib/path_safety');
 *   if (isPathWithin(baseDir, userPath)) { ... }
 *   const safe = isSafeSupportPath(llmPath);  // returns null if unsafe
 */

'use strict';

const path = require('path');

const MAX_PATH_LEN = 512;

/**
 * Verify that a target path resolves to a location within a base directory.
 * Returns true if target is base or a descendant of base.
 *
 * @param {string} base - The allowed base directory (absolute path)
 * @param {string} target - The path to validate (relative or absolute)
 * @returns {boolean} true if target is within base
 */
function isPathWithin(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(base, target);
  return resolvedTarget === resolvedBase ||
         resolvedTarget.startsWith(resolvedBase + path.sep);
}

/**
 * Validate a target path and return the absolute path if safe.
 * Throws on path traversal attempt (unlike isPathWithin which returns boolean).
 *
 * @param {string} base - The allowed base directory
 * @param {string} target - The path to validate
 * @returns {string} The resolved absolute path
 * @throws {Error} If target is outside base
 */
function resolveSafePath(base, target) {
  const resolved = path.resolve(base, target);
  if (!isPathWithin(base, resolved)) {
    throw new Error(`Path traversal blocked: "${target}" resolves outside ${base}`);
  }
  return resolved;
}

/**
 * Validate a support-file path extracted from LLM YAML output.
 * Defends against:
 *   - Path traversal: `..` segments, absolute paths (`/etc/passwd`)
 *   - YAML anchor / control char injection: null bytes, newlines, `\r`
 *
 * Returns the cleaned path on success, or null if the path is unsafe.
 *
 * @param {string} p - Path to sanitize
 * @returns {string | null} Cleaned path or null if unsafe
 */
function isSafeSupportPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > MAX_PATH_LEN) return null;
  // Reject path traversal and absolute paths
  if (p.includes('..') || p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return null;
  // Reject control chars
  if (/[\x00-\x1f\r\n]/.test(p)) return null;
  return p;
}

module.exports = {
  isPathWithin,
  resolveSafePath,
  isSafeSupportPath,
  MAX_PATH_LEN,
};
