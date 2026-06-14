#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const WIKI_DIR = path.join(process.env.HOME, '.openclaw', 'wiki', 'main', 'sources');
const KNOWLEDGE = path.join(process.env.HOME, 'Documents', 'Obsidian Vault', 'Knowledge');

function extractContent(raw) {
  let body = raw.replace(/^---[\s\S]*?---\n*/, '');
  // Try ## Content with 3 or 4 backticks
  const cm = body.match(/## Content\n(`{3,4})text\n([\s\S]*?)\1/);
  if (cm) body = cm[2];
  // Strip inner YAML
  body = body.replace(/^---[\s\S]*?---\n*/, '');
  return body.trim();
}

let fixed = 0;
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
    return;
  }
  entries.forEach(f => {
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).isDirectory()) { walk(p); return; };
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
    if (!f.endsWith('.md')) return;

    let content;
    try {
      content = fs.readFileSync(p, 'utf-8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    if (!content.includes('## Source')) return; // already clean

    const srcMatch = content.match(/^source: (.+)$/m);
    if (!srcMatch) return;

    const srcFile = srcMatch[1].trim();
    const srcPath = path.join(WIKI_DIR, srcFile);
    if (!fs.existsSync(srcPath)) return;

    let raw;
    try {
      raw = fs.readFileSync(srcPath, 'utf-8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    const body = extractContent(raw);
    if (body.length < 30) return;

    const title = (body.match(/^# (.+)$/m) || ['', 'Untitled'])[1];
    const cat = path.basename(path.dirname(p));

    const newContent = `---
tags: [wiki_imported]
source: ${srcFile}
imported: 2026-05-23
category: ${cat}
---

# ${title}

${body}

---
> 來源：Wiki | 2026-05-23 自動匯入
`;
    try {
      fs.writeFileSync(p, newContent);
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
    console.log(`✅ Fixed: ${path.relative(KNOWLEDGE, p)}`);
    fixed++;
  });
}

walk(KNOWLEDGE);
console.log(`\nDone: ${fixed} files fixed`);
