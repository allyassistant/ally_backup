#!/usr/bin/env node
/**
 * connection_surface.js — Obsidian Connection Surface
 *
 * 每週 scan Obsidian vault Knowledge/ 搵 non-obvious note connections。
 *
 * Usage:
 *   node scripts/connection_surface.js
 *
 * Output:
 *   03-Output/connections-YYYY-MM-DD.md
 *
 * State:
 *   .state/connection_surface_state.json — dedup tracking
 */

const fs = require('fs');
const path = require('path');

const VAULT = path.join(process.env.HOME, 'Documents', 'Obsidian Vault');
const STATE_PATH = path.join(__dirname, '..', '.state', 'connection_surface_state.json');
const KNOWLEDGE_DIR = path.join(VAULT, 'Knowledge');
const OUTPUT_DIR = path.join(VAULT, '03-Output');

// Config
const CONFIG = {
  RECENT_DAYS: 7,
  MIN_NOTES_FOR_CONNECTIONS: 10,
  STATE_KEY: 'connected_pairs',
};

const { atomicWriteSync } = require('./lib/state');

// ===== State =====
function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch {
    // ignore corrupt state
  }
  return { [CONFIG.STATE_KEY]: [], last_run: null, total_runs: 0 };
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(STATE_PATH, state);
  } catch (e) {
    console.error('⚠️  Failed to save state:', e.message);
  }
}

// ===== Note scanning =====
function getAllNotes() {
  const notes = [];
  if (!fs.existsSync(KNOWLEDGE_DIR)) return notes;

  let categories;
  try {
    categories = fs.readdirSync(KNOWLEDGE_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`Directory read failed: ${e.message}`);
  }
  for (const cat of categories) {
    if (!cat.isDirectory()) continue;
    const catDir = path.join(KNOWLEDGE_DIR, cat.name);
    let files;
    try {
      files = fs.readdirSync(catDir).filter(f => f.endsWith('.md'));
    } catch (e) {
      console.error(`Directory read failed: ${e.message}`);
    }
    for (const file of files) {
      const filePath = path.join(catDir, file);
      try {
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const title = file.replace(/\.md$/, '');
        notes.push({
          path: path.relative(VAULT, filePath),
          title,
          content,
          mtime: stat.mtimeMs,
          category: cat.name,
        });
      } catch {
        // skip unreadable
      }
    }
  }
  return notes;
}

function findRecentNotes(allNotes) {
  const cutoff = Date.now() - CONFIG.RECENT_DAYS * 24 * 60 * 60 * 1000;
  return allNotes.filter(n => n.mtime > cutoff);
}

// ===== Connection detection =====
function findConnections(recentNotes, allNotes) {
  const state = loadState();
  const connected = state[CONFIG.STATE_KEY] || [];

  if (allNotes.length < CONFIG.MIN_NOTES_FOR_CONNECTIONS) {
    return {
      prompt: null,
      recentNotes,
      allNotes,
      reason: `vault_too_small: ${allNotes.length}/${CONFIG.MIN_NOTES_FOR_CONNECTIONS}`,
    };
  }

  if (recentNotes.length === 0) {
    return {
      prompt: null,
      recentNotes,
      allNotes,
      reason: 'no_recent_notes',
    };
  }

  const prompt = `Read all permanent notes created or modified in the last 7 days.
For each new note, scan the entire vault for existing notes that share a meaningful connection.

Meaningful connections include:
- The same underlying principle applied in different domains
- Contradictory claims worth examining together
- One note providing evidence for or against a claim in another
- A pattern that appears across multiple notes that no individual note names explicitly

For each connection found: name both notes, describe the connection, explain why connecting them makes both more useful.

Only surface non-obvious connections.
Skip already-connected pairs: ${JSON.stringify(connected)}

Recent notes (${recentNotes.length}):
${recentNotes.map(n => `- ${n.title} (${n.path})`).join('\n')}

All existing notes (${allNotes.length}):
${allNotes.map(n => `- ${n.title}`).join('\n')}

Output format (JSON array):
[
  {
    "note1": "Note Title A",
    "note2": "Note Title B",
    "connection": "Description of connection",
    "why_useful": "Why connecting them makes both more useful",
    "type": "principle|contradiction|evidence|pattern"
  }
]

Return empty array [] if no meaningful connections found.`;

  return { prompt, recentNotes, allNotes, reason: 'needs_llm' };
}

// ===== Report generation =====
function generateReport(result) {
  const { connections, recentNotes, allNotes, reason } = result;
  const today = new Date().toISOString().split('T')[0];
  const connCount = Array.isArray(connections) ? connections.length : 0;

  let report = `---
title: Connection Surface - ${today}
date: ${today}
type: connection_report
---

# Connection Surface — ${today}

**Notes scanned:** ${allNotes.length}
**Recent notes (7d):** ${recentNotes.length}
**Connections found:** ${connCount}

`;

  if (reason === 'vault_too_small') {
    report += `⚠️ **Vault 未達 threshold** — 需要 ${CONFIG.MIN_NOTES_FOR_CONNECTIONS}+ notes，目前 ${allNotes.length}。\n`;
  } else if (reason === 'no_recent_notes') {
    report += `ℹ️ **今週冇新 notes** — 最近 7 日冇新增或修改。\n`;
  } else if (reason === 'needs_llm') {
    report += `⏳ **Connection analysis pending** — 需要 spawn sub-agent 進行 LLM-based 分析。\n\n`;
    report += `<details>\n<summary>📋 分析 prompt（click to expand）</summary>\n\n\`\`\`\n${result.prompt}\n\`\`\`\n\n</details>\n\n`;

    report += `### 📝 今週新 notes\n`;
    report += recentNotes
      .map(n => `- **${n.title}** (${n.category}) — 最後修改: ${new Date(n.mtime).toISOString().split('T')[0]}`)
      .join('\n') + '\n\n';

    report += `### 📊 Vault 分佈\n`;
    const catCount = {};
    allNotes.forEach(n => {
      catCount[n.category] = (catCount[n.category] || 0) + 1;
    });
    Object.entries(catCount).forEach(([cat, count]) => {
      report += `- **${cat}:** ${count} notes\n`;
    });
  } else if (connections && connections.length > 0) {
    connections.forEach((c, i) => {
      report += `### ${i + 1}. ${c.note1} ↔ ${c.note2}\n`;
      report += `- **Type:** ${c.type}\n`;
      report += `- **Connection:** ${c.connection}\n`;
      report += `- **Why useful:** ${c.why_useful}\n\n`;
    });

    // Update state
    const state = loadState();
    const newPairs = connections.map(c => [c.note1, c.note2].sort());
    state[CONFIG.STATE_KEY] = [
      ...new Set([...(state[CONFIG.STATE_KEY] || []), ...newPairs].map(p => JSON.stringify(p))),
    ].map(p => JSON.parse(p));
    state.last_run = today;
    state.total_runs = (state.total_runs || 0) + 1;
    saveState(state);
  }

  return report;
}

// ===== Write Knowledge note (via write_to_obsidian.js) =====
function writeKnowledgeNote(connections, reportContent) {
  const { execSync } = require('child_process');
  const today = new Date().toISOString().split('T')[0];

  // Build connection summary for the note
  let summary = '';
  connections.forEach((c, i) => {
    summary += `### ${i + 1}. ${c.note1} ↔ ${c.note2}\n`;
    summary += `**Type:** ${c.type}  \n`;
    summary += `**Connection:** ${c.connection}  \n`;
    if (c.why_useful) summary += `**Why useful:** ${c.why_useful}  \n`;
    summary += '\n';
  });

  const noteBody = `## Summary\nFound ${connections.length} non-obvious connections.\n\n${summary}\n---\n📎 **Source:** Connection Surface scan (${today})\n🔗 **[[03-Output/connections-${today}]]**`;

  try {
    const filepath = path.join(VAULT, 'Knowledge', 'AI', `Connection Surface - ${today}.md`);
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filepath, noteBody);
    console.log(`✅ Knowledge note: ${path.relative(VAULT, filepath)}`);
  } catch (e) {
    console.error('⚠️  Failed to write Knowledge note:', e.message);
  }
}

// ===== Main =====
function main() {
  const args = process.argv.slice(2);
  const applyIndex = args.indexOf('--apply');
  const applyFile = applyIndex !== -1 ? args[applyIndex + 1] : null;

  if (applyFile) {
    // Apply mode: read connections from JSON file, write Knowledge note
    console.log('=== Connection Surface (apply mode) ===');
    let connections;
    try {
      connections = JSON.parse(fs.readFileSync(applyFile, 'utf8'));
    } catch (e) {
      console.error(`❌ Failed to read/parse ${applyFile}: ${e.message}`);
      process.exit(1);
    }
    console.log(`📥 Loaded ${connections.length} connections from ${applyFile}`);
    writeKnowledgeNote(connections, '');
    return;
  }

  console.log('=== Connection Surface ===');
  console.log(`⏱️  ${new Date().toISOString()}`);
  console.log('');

  const allNotes = getAllNotes();
  console.log(`📚 Total vault: ${allNotes.length} notes`);

  const recentNotes = findRecentNotes(allNotes);
  console.log(`🆕 Recent (${CONFIG.RECENT_DAYS}d): ${recentNotes.length} notes`);
  console.log('');

  // Categorize by category
  const catCount = {};
  allNotes.forEach(n => {
    catCount[n.category] = (catCount[n.category] || 0) + 1;
  });
  Object.entries(catCount).forEach(([cat, count]) => {
    console.log(`   ${cat.padEnd(12)} ${count} notes`);
  });
  console.log('');

  if (recentNotes.length > 0) {
    console.log('📝 Recent notes:');
    recentNotes.forEach(n =>
      console.log(`   - ${n.title} (${n.category}, ${new Date(n.mtime).toISOString().split('T')[0]})`)
    );
    console.log('');
  }

  // Generate report
  const result = findConnections(recentNotes, allNotes);
  const report = generateReport(result);

  // Write output
  const today = new Date().toISOString().split('T')[0];
  const outputDir = path.join(OUTPUT_DIR);
  try {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }

  const outputPath = path.join(outputDir, `connections-${today}.md`);
  try {
    atomicWriteSync(outputPath, report);
    console.log(`📄 Output: ${path.relative(VAULT, outputPath)}`);
  } catch (e) {
    console.error(`❌ Failed to write output: ${e.message}`);
    process.exit(1);
  }
  console.log('');

  // Summary
  if (result.reason === 'vault_too_small') {
    console.log(`⚠️  Vault too small: ${allNotes.length}/${CONFIG.MIN_NOTES_FOR_CONNECTIONS} notes`);
  } else if (result.reason === 'no_recent_notes') {
    console.log(`ℹ️  No new notes in last ${CONFIG.RECENT_DAYS} days`);
  } else if (result.reason === 'needs_llm') {
    console.log('⏳  Dry scan complete. To get actual connections, spawn a sub-agent with:');
    console.log('    Read 03-Output/connections-YYYY-MM-DD.md');
    console.log('    Analyze notes for non-obvious connections');
    console.log('    Return JSON array of connections');
    console.log('    The sub-agent will auto-write the Knowledge note via write_to_obsidian.js');
  }

  console.log('');
  console.log('✅ Connection Surface scan complete');
}

main();
