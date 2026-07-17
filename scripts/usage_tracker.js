#!/usr/bin/env node
/**
 * usage_tracker.js — Contribution Usage Tracking
 * Issue #122 Item 6
 *
 * Tracks how often Obsidian notes are referenced/used.
 * Adds contributions count to frontmatter.
 *
 * Usage:
 *   node scripts/usage_tracker.js scan          # Scan vault, count usage
 *   node scripts/usage_tracker.js report        # Generate monthly report
 *   node scripts/usage_tracker.js increment     # Increment usage counter
 */

const fs = require('fs');
const path = require('path');

const VAULT = path.join(process.env.HOME, 'obsidian-vault');
const STATE_PATH = path.join(__dirname, '..', '.state', 'usage_tracker_state.json');

const CONFIG = {
  STATE_KEY: 'usage',
};

const { atomicWriteSync } = require('./lib/state');

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {}
  return { usage: {}, last_scan: null };
}

function saveState(state) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir))   try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }
  atomicWriteSync(STATE_PATH, state);
}

function getAllNotes() {
  const notes = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          notes.push({ path: path.relative(VAULT, p), title: e.name.replace(/\.md$/, ''), content });
        } catch {}
      }
    });
    } catch (e) {
      console.error(`Directory read failed: ${e.message}`);
    }
  }
  walk(path.join(VAULT, 'Knowledge'));
  walk(path.join(VAULT, '04-Skills'));
  walk(path.join(VAULT, 'Daily'));
  return notes;
}

function scanUsage(notes) {
  const state = loadState();
  const fresh = {};
  let updated = [];

  notes.forEach(note => {
    const title = note.title;
    fresh[title] = { count: 0, links_from: [], last_used: null };

    // Find wikilinks to this note from other notes
    notes.forEach(other => {
      if (other.path === note.path) return;
      const linkPattern = new RegExp(`\\[\\[${escapeRegex(title)}(\\|[^\\]]*)?]]`, 'gi');
      const matches = other.content.match(linkPattern);
      if (matches) {
        fresh[title].count += matches.length;
        fresh[title].links_from.push(other.title);
        fresh[title].last_used = new Date().toISOString().split('T')[0];
        updated.push(title);
      }
    });
  });

  state.usage = fresh;
  state.last_scan = new Date().toISOString().split('T')[0];
  try { saveState(state); } catch (e) { console.error('⚠️  Failed to save usage state:', e.message); }
  return { updated: [...new Set(updated)], total: Object.keys(fresh).length };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateReport() {
  const state = loadState();
  const usage = state.usage || {};
  const today = new Date().toISOString().split('T')[0];

  const sorted = Object.entries(usage).sort((a, b) => b[1].count - a[1].count);
  const top10 = sorted.slice(0, 10);
  const unused = sorted.filter(([_, d]) => d.count === 0).length;

  let report = `# Usage Report — ${today}\n\n`;
  report += `| Rank | Note | References | Last Used |\n`;
  report += `|------|------|-----------|-----------|\n`;
  top10.forEach(([title, data], i) => {
    report += `| ${i+1} | [[${title}]] | ${data.count} | ${data.last_used || '-'} |\n`;
  });
  report += `\n**Total notes tracked:** ${sorted.length}\n`;
  const total = sorted.length || 1;
  report += `**Unreferenced notes:** ${unused} (${(unused/total*100).toFixed(0)}%)\n`;
  report += `**Scan date:** ${today}\n`;

  const reportDir = path.join(VAULT, '03-Output');
  try {
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }
  const reportPath = path.join(reportDir, `usage-report-${today}.md`);
  try {
    fs.writeFileSync(reportPath, report);
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  return path.relative(VAULT, reportPath);
}

function main() {
  const cmd = process.argv[2] || 'scan';

  switch (cmd) {
    case 'scan':
      const notes = getAllNotes();
      const result = scanUsage(notes);
      console.log(`📊 Scan complete: ${result.total} notes tracked, ${result.updated.length} updated`);
      break;
    case 'report':
      const reportPath = generateReport();
      console.log(`📄 Report: ${reportPath}`);
      break;
    default:
      console.log('Usage: node usage_tracker.js [scan|report]');
  }
}

main();
