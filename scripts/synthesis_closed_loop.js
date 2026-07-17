#!/usr/bin/env node
/**
 * synthesis_closed_loop.js — Bi-weekly Synthesis + Closed Loop
 * Issue #122 Item 4
 *
 * Merge of NeilXbt's Synthesis Session + 0x小師妹 Closed Loop re-ingest.
 *
 * Usage:
 *   node scripts/synthesis_closed_loop.js
 *
 * Output:
 *   05-Synthesis/synthesis-YYYY-MM-DD.md       — PART A
 *   03-Output/re-ingest-YYYY-MM-DD.md           — PART B
 *
 * Spawn sub-agent for actual LLM analysis.
 */

const fs = require('fs');
const path = require('path');

const VAULT = path.join(process.env.HOME, 'obsidian-vault');
const SYNTHESIS_DIR = path.join(VAULT, '05-Synthesis');
const OUTPUT_DIR = path.join(VAULT, '03-Output');
const KNOWLEDGE_DIR = path.join(VAULT, 'Knowledge');
const STATE_PATH = path.join(__dirname, '..', '.state', 'synthesis_state.json');

const CONFIG = {
  CYCLE_DAYS: 14,
  OUTPUT_ARCHIVE_DAYS: 30,
  MIN_NOTES: 10,
};

const { atomicWriteSync } = require('./lib/state');

// ===== State =====
function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch {}
  return { last_run: null, total_runs: 0, patterns_found: [] };
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

// ===== Scanning =====
function getAllNotes(dir) {
  const notes = [];
  if (!fs.existsSync(dir)) return notes;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error(`Directory read failed: ${e.message}`);
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      notes.push(...getAllNotes(fullPath));
    } else if (entry.name.endsWith('.md')) {
      try {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        notes.push({
          path: path.relative(VAULT, fullPath),
          title: entry.name.replace(/\.md$/, ''),
          content,
          mtime: stat.mtimeMs,
        });
      } catch {}
    }
  }
  return notes;
}

function getRecentOutputs() {
  const outputs = [];
  if (!fs.existsSync(OUTPUT_DIR)) return outputs;
  let months;
  try {
    months = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  const cutoff = Date.now() - CONFIG.OUTPUT_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

  for (const month of months) {
    if (!month.isDirectory()) continue;
    const monthDir = path.join(OUTPUT_DIR, month.name);
    let files;
    try {
      files = fs.readdirSync(monthDir).filter(f => f.endsWith('.md'));
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
    for (const file of files) {
      try {
        const filePath = path.join(monthDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          outputs.push({
            path: path.relative(VAULT, filePath),
            title: file.replace(/\.md$/, ''),
            mtime: stat.mtime,
          });
        }
      } catch {}
    }
  }
  return outputs;
}

// ===== Prompt generation =====
function generateSynthesisPrompt(allNotes, state) {
  if (allNotes.length < CONFIG.MIN_NOTES) {
    return { reason: `vault_too_small: ${allNotes.length}/${CONFIG.MIN_NOTES}` };
  }

  const prompt = `PART A — SYNTHESIS（NeilXbt Module 5）

Read all Knowledge notes. Analyze:

1. PATTERN IDENTIFICATION — What patterns emerge not stated in any individual note?
2. THE DEEPEST CONNECTION — Single most important relationship tying most concepts together
3. PREDICTIVE TEST — Generate 3 novel scenarios; predict, then evaluate
4. GAP ANALYSIS — 3 most important concepts not yet studied
5. SYNTHESIS DOCUMENT — 400-600 word integrated understanding → save to 05-Synthesis/

Previous patterns found:
${(state.patterns_found || []).map(p => `- ${p}`).join('\n')}

Notes (${allNotes.length}):
${allNotes.map(n => `- ${n.title} (${path.dirname(n.path)})`).join('\n')}

Output format (pure JSON, no markdown):
{
  "patterns": [{"name": "...", "description": "...", "from_notes": ["..."]}],
  "deepest_connection": "...",
  "predictions": [{"scenario": "...", "prediction": "...", "evaluation": "..."}],
  "gaps": ["..."],
  "synthesis": "400-600 word integrated understanding"
}`;

  return { prompt, reason: 'needs_llm' };
}

function generateClosedLoopPrompt(recentOutputs, allNotes) {
  if (recentOutputs.length === 0) {
    return { reason: 'no_old_outputs' };
  }

  const existing = allNotes.map(n => n.title);

  const prompt = `PART B — CLOSED LOOP（0x小師妹 re-ingest）

Scan 03-Output/ older than 30 days:
- Any insights not yet in Knowledge/ or wiki?
- Cross-output patterns suggesting a new concept?
- Most/least referenced outputs?

Output:
- New concept suggestions (title + brief description + why it's not in existing notes)
- Cross-output pattern summary
- Archive recommendations

Outputs to analyze (${recentOutputs.length}):
${recentOutputs.map(o => `- ${o.title} (${new Date(o.mtime).toISOString().split('T')[0]})`).join('\n')}

Existing concepts: ${existing.join(', ')}

Output format (pure JSON, no markdown):
{
  "new_concepts": [{"title": "...", "description": "...", "reason": "..."}],
  "cross_patterns": [{"name": "...", "description": "..."}],
  "archive": [{"file": "...", "reason": "..."}],
  "summary": "..."
}`;

  return { prompt, recentOutputs, reason: 'needs_llm' };
}

// ===== Report =====
function writeSynthesisReport(synthesisPrompt) {
  const today = new Date().toISOString().split('T')[0];
  try {
    if (!fs.existsSync(SYNTHESIS_DIR)) fs.mkdirSync(SYNTHESIS_DIR, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }

  const content = `---
title: Synthesis - ${today}
date: ${today}
type: synthesis
cycle: ${CONFIG.CYCLE_DAYS}d
---

# Synthesis — ${today}

⏳ **LLM analysis pending. Spawn sub-agent with:**

\`\`\`
${synthesisPrompt}
\`\`\`

---

🔗 [[03-Output/re-ingest-${today}]]
`;

  const outputPath = path.join(SYNTHESIS_DIR, `synthesis-${today}.md`);
  try {
    atomicWriteSync(outputPath, content);
    return path.relative(VAULT, outputPath);
  } catch (e) {
    console.error(`❌ Failed to write synthesis report: ${e.message}`);
    return null;
  }
}

function writeClosedLoopReport(loopPrompt, recentOutputs) {
  const today = new Date().toISOString().split('T')[0];
  if (!fs.existsSync(OUTPUT_DIR))   try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  } catch (e) {
    console.error(`Directory creation failed: ${e.message}`);
  }

  const outputs = recentOutputs.map(o =>
    `- ${o.title} (${new Date(o.mtime).toISOString().split('T')[0]})`
  ).join('\n');

  const content = `---
title: Re-ingest - ${today}
date: ${today}
type: re_ingest
archive_days: ${CONFIG.OUTPUT_ARCHIVE_DAYS}d
---

# Re-ingest — ${today}

**Outputs older than ${CONFIG.OUTPUT_ARCHIVE_DAYS} days:** ${recentOutputs.length}

${outputs}

---

⏳ **LLM analysis pending. Spawn sub-agent with:**

\`\`\`
${loopPrompt}
\`\`\`

---

🔗 [[05-Synthesis/synthesis-${today}]]
`;

  const outputPath = path.join(OUTPUT_DIR, `re-ingest-${today}.md`);
  try {
    atomicWriteSync(outputPath, content);
    return path.relative(VAULT, outputPath);
  } catch (e) {
    console.error(`❌ Failed to write re-ingest report: ${e.message}`);
    return null;
  }
}

// ===== Main =====
function main() {
  console.log('=== Synthesis + Closed Loop ===');
  console.log(`⏱️  ${new Date().toISOString()}`);
  console.log('');

  const state = loadState();
  const allNotes = getAllNotes(KNOWLEDGE_DIR);
  console.log(`📚 Knowledge notes: ${allNotes.length}`);

  const recentOutputs = getRecentOutputs();
  console.log(`📦 Old outputs (>${CONFIG.OUTPUT_ARCHIVE_DAYS}d): ${recentOutputs.length}`);
  console.log('');

  // PART A — Synthesis
  const synthesisResult = generateSynthesisPrompt(allNotes, state);
  if (synthesisResult.reason === 'needs_llm') {
    const synPath = writeSynthesisReport(synthesisResult.prompt);
    console.log(`📄 ${synPath}`);
  } else {
    console.log(`⚠️  Synthesis skipped: ${synthesisResult.reason}`);
  }

  // PART B — Closed Loop
  const loopResult = generateClosedLoopPrompt(recentOutputs, allNotes);
  if (loopResult.reason === 'needs_llm') {
    const loopPath = writeClosedLoopReport(loopResult.prompt, loopResult.recentOutputs);
    console.log(`📄 ${loopPath}`);
  } else {
    console.log(`ℹ️  Closed Loop skipped: ${loopResult.reason}`);
  }

  console.log('');
  console.log('✅ Synthesis + Closed Loop scan complete');
  console.log('   Spawn sub-agent for LLM analysis to get actual results.');
}

main();
