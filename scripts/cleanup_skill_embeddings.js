#!/usr/bin/env node
/**
 * cleanup_skill_embeddings.js — One-time cleanup of phantom entries in
 * `.skill_auto_suggest_embeddings.json`
 *
 * Loads the embedding cache, removes entries for skills that no longer
 * have a SKILL.md in skills/ or skills-learned/, and saves the clean version.
 *
 * Bug: core.mjs:333-359 only pruned in-memory; disk cache never saved on
 * prune-only. This script fixes the disk cache.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_FILE = path.join(os.homedir(), '.openclaw', 'workspace', '.skill_auto_suggest_embeddings.json');
const SKILLS_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'skills');
const SKILLS_LEARNED = path.join(os.homedir(), '.openclaw', 'workspace', 'skills-learned');

if (!fs.existsSync(CACHE_FILE)) {
  console.error('Cache file not found:', CACHE_FILE);
  process.exit(1);
}

let cache;
try {
  cache = fs.readFileSync(CACHE_FILE, 'utf8');
} catch (e) {
  console.error(`File read failed: ${e.message}`);
}
const before = Object.keys(cache.embeddings || {}).length;

// Build set of known skill names (from skills/ + skills-learned/)
const knownNames = new Set();

// Scan skills/ (symlinks to skills-learned/ or direct)
if (fs.existsSync(SKILLS_DIR)) {
  let __iter_33_1;
  try {
    __iter_33_1 = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`Directory read failed: ${e.message}`);
    __iter_33_1 = [];
  }
  for (entry of __iter_33_1) {
    const skillMd = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      const name = entry.name.replace(/^_learned_/, '');
      knownNames.add(name);
    }
  }
}

// Scan skills-learned/ (real skill dirs)
if (fs.existsSync(SKILLS_LEARNED)) {
  let __iter_44_2;
  try {
    __iter_44_2 = fs.readdirSync(SKILLS_LEARNED, { withFileTypes: true });
  } catch (e) {
    console.error(`Directory read failed: ${e.message}`);
    __iter_44_2 = [];
  }
  for (entry of __iter_44_2) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip .backup, _archive etc.
    const skillMd = path.join(SKILLS_LEARNED, entry.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      knownNames.add(entry.name);
    }
  }
}

const phantoms = Object.keys(cache.embeddings).filter(n => !knownNames.has(n));

for (const name of phantoms) {
  delete cache.embeddings[name];
}

const after = Object.keys(cache.embeddings).length;
const removed = before - after;

console.log(`Before: ${before} embedded skills`);
console.log(`After:  ${after} embedded skills`);
console.log(`Removed ${removed} phantom entries`);

// Persist
const tmpFile = CACHE_FILE + '.tmp' + Date.now();
try {
  fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2), 'utf8');
} catch (e) {
  console.error(`File write failed: ${e.message}`);
}
fs.renameSync(tmpFile, CACHE_FILE);
console.log(`Saved cleaned cache to ${CACHE_FILE}`);

// Exit with count for scripting
process.exit(removed > 0 ? 0 : 0);
