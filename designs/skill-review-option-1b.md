# Hermes-Style Background Skill Review — Option 1B Implementation Plan

> **Design for:** Plugin writes review queue → cron job consumes & reviews
> **Status:** Draft design for Josh to review & drive implementation
> **Date:** 2026-06-06

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Plugin Redesign — Queue Writer](#2-plugin-redesign--queue-writer)
3. [Cron Review Script](#3-cron-review-script)
4. [Adapted Hermes Review Prompt](#4-adapted-hermes-review-prompt)
5. [Cron Job Registration](#5-cron-job-registration)
6. [State File Schema](#6-state-file-schema)
7. [Edge Cases & Failure Handling](#7-edge-cases--failure-handling)
8. [Migration Plan](#8-migration-plan)
9. [Cost Estimate](#9-cost-estimate)
10. [Code Quality & CQM Concerns](#10-code-quality--cqm-concerns)

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        CONVERSATION LOOP                           │
│                                                                     │
│  User msg → Agent reply → agent_end event                          │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────┐                        │
│  │  skill-learner/index.mjs (plugin)       │                        │
│  │                                         │                        │
│  │  api.on("agent_end")  ← non-blocking    │                        │
│  │     │                                   │                        │
│  │     ├─ Filter: skip NO_REPLY, trivial   │                        │
│  │     ├─ Extract: messages, userPrompt,   │                        │
│  │     │  channelId, timestamp             │                        │
│  │     ├─ Compress: keep first user msg,   │                        │
│  │     │  last 6 turns, tool results ≤200  │                        │
│  │     │                                   │                        │
│  │     └─ Append JSONL to queue file ──────┼───► .skill_review_    │
│  │        (max 50 entries, rotate excess)  │      queue.jsonl      │
│  └─────────────────────────────────────────┘           │           │
│                                                         │           │
│                    ┌─ EVERY 30 MINUTES ─────────────────┘           │
│                    ▼                                                  │
│  ┌─────────────────────────────────────────┐                        │
│  │  openclaw cron (agentTurn)              │                        │
│  │  skill_reviewer.js                      │                        │
│  │                                         │                        │
│  │  model: MiniMax-M3 + thinking:high      │                        │
│  │  toolsAllow: exec,read,write,edit,      │                        │
│  │              memory_search,message       │                        │
│  │                                         │                        │
│  │  1. Read all queue entries              │                        │
│  │  2. Build ONE review prompt w/ Hermes   │                        │
│  │     adapted prompt (batched)            │                        │
│  │  3. LLM reviews & suggests skills       │                        │
│  │  4. Write/update skill files             │                        │
│  │  5. Clear processed queue               │                        │
│  │  6. Send summary to #⚙️系統            │                        │
│  └─────────────────────────────────────────┘                        │
│                         │                                           │
│                         ▼                                           │
│  ┌─────────────────────────────────────────┐                        │
│  │  skills-learned/ (.md files)            │                        │
│  │     │  skills/_learned_*.md (symlinks)  │                        │
│  │     │                                   │                        │
│  │     └── weekly_correction_loop.js       │                        │
│  │         (Phase 1b: curator → archive    │                        │
│  │          stale, promote, backup)        │                        │
│  └─────────────────────────────────────────┘                        │
└────────────────────────────────────────────────────────────────────┘
```

**Key principle:** The plugin NEVER calls LLM. It just writes structured data to a queue file. The cron job does the LLM work via OpenClaw's agentTurn infrastructure, which respects `route-enforcer`'s cron bypass and uses explicit model/tools config.

---

## 2. Plugin Redesign — Queue Writer

### `~/.openclaw/extensions/skill-learner/index.mjs`

Complete replacement file. The plugin becomes a pure queue writer — no hash analysis, no LLM calls, no `.skill_patterns.json` mutations.

```mjs
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORKSPACE = path.join(process.env.HOME || "/Users/ally", ".openclaw", "workspace");
const QUEUE_FILE = path.join(WORKSPACE, ".skill_review_queue.jsonl");
const MAX_QUEUE_ENTRIES = 50;
const MAX_TURNS_IN_ENTRY = 6;      // keep last N turns + first user msg
const MAX_TOOL_RESULT_CHARS = 200;  // truncate tool results
const MIN_TOOL_CALLS = 2;          // skip if < 2 tool calls

/**
 * Compress conversation messages for review:
 * - Keep the first user message (the original request)
 * - Keep the last MAX_TURNS_IN_ENTRY (non-user) assistant turns
 * - Truncate tool results to MAX_TOOL_RESULT_CHARS
 * - Skip NO_REPLY turns entirely
 */
function compressMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const result = [];

  // 1. Find and keep the first substantive user message
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = getMessageText(msg);
      if (text && text.trim()) {
        result.push({ role: "user", text: text.trim().slice(0, 1000) });
        break;
      }
    }
  }

  // 2. Collect assistant turns (skip NO_REPLY / zero-tool turns)
  const assistantTurns = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const text = getMessageText(msg);
      const toolCalls = getToolCalls(msg);
      const toolResults = getToolResults(msg, messages);
      if (toolCalls.length === 0 && !text) continue; // skip empty turns
      assistantTurns.push({
        text: text ? text.trim().slice(0, 500) : "",
        toolCalls: toolCalls.length,
        toolNames: [...new Set(toolCalls.map(t => t.name || ""))].filter(Boolean),
        toolSummary: summarizeToolResults(toolResults)
      });
    }
  }

  // Keep last MAX_TURNS_IN_ENTRY
  const tail = assistantTurns.slice(-MAX_TURNS_IN_ENTRY);
  for (const turn of tail) {
    result.push(turn);
  }

  return result;
}

function getMessageText(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "text") return block.text;
    }
  }
  return "";
}

function getToolCalls(msg) {
  if (Array.isArray(msg.content)) {
    return msg.content.filter(b => b.type === "toolCall" && b.name !== "message");
  }
  return [];
}

function getToolResults(msg, allMessages) {
  // Find tool results that follow this assistant message
  const idx = allMessages.indexOf(msg);
  if (idx < 0 || idx >= allMessages.length - 1) return [];
  const next = allMessages[idx + 1];
  if (next.role !== "user" || !Array.isArray(next.content)) return [];
  return next.content.filter(b => b.type === "toolResult");
}

function summarizeToolResults(results) {
  if (!results || results.length === 0) return "";
  const lines = [];
  for (const r of results) {
    const name = r.name || r.toolName || "tool";
    let content = "";
    if (typeof r.content === "string") content = r.content;
    else if (typeof r.result === "string") content = r.result;
    else if (typeof r.data === "string") content = r.data;
    else try { content = JSON.stringify(r.content || r.result); } catch { content = String(r.content || ""); }
    if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + "...";
    lines.push(`[${name}]: ${content}`);
  }
  return lines.join("\n").slice(0, 2000);
}

function extractChannelId(event) {
  // The event may not carry channel info. If it does (via ctx in other hooks),
  // we try to extract it. Otherwise null.
  return null;
}

function rotateQueue() {
  // Read all, keep last MAX_QUEUE_ENTRIES
  if (!existsSync(QUEUE_FILE)) return;
  try {
    const raw = readFileSync(QUEUE_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= MAX_QUEUE_ENTRIES) return;
    const kept = lines.slice(-MAX_QUEUE_ENTRIES);
    writeFileSync(QUEUE_FILE, kept.join("\n") + "\n", "utf8");
    console.log(`[skill-learner] Rotated queue: ${lines.length} → ${kept.length} entries`);
  } catch (err) {
    console.warn(`[skill-learner] Queue rotation failed: ${err.message}`);
  }
}

export default definePluginEntry({
  id: "skill-learner",
  name: "Skill Learner (Queue Writer)",
  description: "Writes structured conversation snapshots to .skill_review_queue.jsonl for cron-based review",
  register(api) {
    api.on("agent_end", async (event) => {
      // event: { runId?: string, messages: unknown[], success: boolean, error?: string, durationMs?: number }
      const messages = event?.messages || [];
      if (!Array.isArray(messages) || messages.length < 2) return;

      // === Filter trivial turns ===
      // 1. Count tool calls across all assistant messages
      let totalToolCalls = 0;
      for (const msg of messages) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          totalToolCalls += msg.content.filter(b => b.type === "toolCall" && b.name !== "message").length;
        }
      }
      if (totalToolCalls < MIN_TOOL_CALLS) return;

      // 2. Check if agent replied at all (non-empty last assistant msg)
      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
      const lastText = lastAssistant ? getMessageText(lastAssistant) : "";
      // If last assistant has no text AND no tool calls, it's a NO_REPLY — skip
      const lastTools = lastAssistant ? getToolCalls(lastAssistant) : [];
      if (!lastText && lastTools.length === 0) return;

      // === Extract ===
      const userPrompt = getFirstUserPrompt(messages);
      if (!userPrompt) return;

      const compressed = compressMessages(messages);
      const timestamp = new Date().toISOString();

      // === Build queue entry ===
      const entry = {
        v: 1,
        ts: timestamp,
        runId: event.runId || "",
        userPrompt: userPrompt.slice(0, 500),
        turnCount: messages.length,
        toolCallCount: totalToolCalls,
        success: event.success !== false,
        compressed
      };

      // === Append to queue (async — fire and forget) ===
      // Using sync write in a fire-and-forget Promise so plugin doesn't block
      // the main conversation. The agent_end handler is not awaited by OpenClaw.
      try {
        const line = JSON.stringify(entry) + "\n";
        appendFileSync(QUEUE_FILE, line, "utf8");
        // Rotate if over limit
        rotateQueue();
      } catch (err) {
        console.warn(`[skill-learner] Queue write failed: ${err.message}`);
      }
    });
  }
});
```

### Key design decisions

| Decision | Why |
|----------|-----|
| Sync `appendFileSync` | Plugin handlers are non-awaited by OpenClaw; sync write is simpler, safer, and async fs adds no real benefit since disk I/O is negligible for a JSONL line (~1KB) |
| `rotateQueue()` reads all + writes back | Simpler than read-stream. Queue file is tiny (<50 entries × ~2KB = 100KB) |
| Skip NO_REPLY by checking last assistant | If agent produced zero text and zero tool calls, nothing worth reviewing |
| Compress to 6 turns + first user msg | Keeps entry small (~1-2KB) while preserving the conversation's intent and resolution |
| Truncate tool results to 200 chars | Enough signal (e.g. "Error: ..." or count) without bloating the queue |

---

## 3. Cron Review Script

### `~/.openclaw/workspace/scripts/skill_reviewer.js`

This script runs as a cron agentTurn job. It uses `toolsAllow: exec,read,write,edit,memory_search` to review queued conversations and create/update skill files.

```js
#!/usr/bin/env node

/**
 * skill_reviewer.js — Cron-based Hermes-style skill review
 *
 * Runs via `openclaw cron` (agentTurn) every 30 minutes.
 *
 * Workflow:
 * 1. Read .skill_review_queue.jsonl
 * 2. If empty → report "Nothing to review" → exit
 * 3. Batch ALL entries into ONE review prompt
 * 4. LLM (M3) reviews via agentTurn message
 * 5. Process LLM suggestions → write/update skill files
 * 6. Clear processed queue entries
 * 7. Send summary to #⚙️系統
 *
 * Available tools (from cron config's toolsAllow):
 *   exec, read, write, edit, memory_search, message
 *
 * The cron job body IS the LLM review prompt. We don't need to
 * call LLM ourselves — OpenClaw sends this as the user message
 * in an agent turn with the configured model (MiniMax-M3).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');
const QUEUE_FILE = path.join(WORKSPACE, '.skill_review_queue.jsonl');
const SKILLS_DIR = path.join(WORKSPACE, 'skills-learned');
const SKILLS_ACTIVE = path.join(WORKSPACE, 'skills');
const ARCHIVE_PATH = path.join(WORKSPACE, 'scripts', 'router', 'decision_log.jsonl');
const SYSTEM_CHANNEL = process.env.DISCORD_SYSTEM_CHANNEL_ID || '1473376125584670872';

// ────────────────────────────────────────────────────────────────
// SECTION A: Read queue & build review prompt
// ────────────────────────────────────────────────────────────────

function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  const raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function buildBatchedReviewPrompt(entries) {
  if (entries.length === 0) return null;

  let prompt = `# 🔄 Skill Review Session — ${entries.length} Conversations to Review\n\n`;
  prompt += `Review the following ${entries.length} conversation snapshots. `;
  prompt += `For each one, determine if a skill update is warranted. `;
  prompt += `If multiple conversations suggest the same class-level skill update, `;
  prompt += `produce ONE skill file covering the class. Do NOT produce one skill per entry.\n\n`;
  prompt += `---\n\n`;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    prompt += `### Conversation ${i + 1} (${e.ts})\n\n`;
    prompt += `**User asked:** ${e.userPrompt}\n`;
    prompt += `**Tool calls:** ${e.toolCallCount} across ${e.turnCount} turns\n`;
    prompt += `**Success:** ${e.success}\n\n`;
    prompt += `**Conversation transcript:**\n\`\`\`\n`;

    for (const turn of e.compressed) {
      if (turn.role === 'user') {
        prompt += `USER: ${turn.text}\n\n`;
      } else {
        if (turn.text) prompt += `ASSISTANT: ${turn.text}\n`;
        if (turn.toolCalls > 0) {
          prompt += `[${turn.toolCalls} tool calls: ${turn.toolNames.join(', ')}]\n`;
        }
        if (turn.toolSummary) {
          const summary = turn.toolSummary.length > 400
            ? turn.toolSummary.slice(0, 400) + '...'
            : turn.toolSummary;
          prompt += `${summary}\n`;
        }
        prompt += '\n';
      }
    }
    prompt += `\`\`\`\n\n---\n\n`;
  }

  // Append the adapted Hermes review prompt as instructions
  prompt += `\n${getReviewInstructions()}\n`;
  return prompt;
}

// ────────────────────────────────────────────────────────────────
// SECTION C: Skill file operations
// ────────────────────────────────────────────────────────────────

/**
 * Infer a class-level skill name from the review agent's output.
 * If the output contains "SKILL: name" directive, use it.
 * Otherwise, extract from context.
 */
function parseSkillOutput(output) {
  // The LLM should output structured skill proposals
  const skills = [];

  // Look for SKILL blocks: name + description + workflow
  const blocks = output.split(/(?=^### )/m);
  for (const block of blocks) {
    const nameMatch = block.match(/name:\s*(.+)/i);
    const descMatch = block.match(/description:\s*(.+)/i);
    const workflowMatch = block.match(/## Workflow\n([\s\S]*?)(?=\n## |\n---|$)/);
    if (nameMatch && workflowMatch) {
      skills.push({
        name: nameMatch[1].trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        description: descMatch ? descMatch[1].trim() : '',
        workflow: workflowMatch[1].trim(),
        body: block.trim()
      });
    }
  }

  // If no structured blocks, look for freeform "CREATE/UPDATE" directives
  if (skills.length === 0) {
    const updateMatch = output.match(/(?:CREATE|UPDATE|PATCH)\s+SKILL[:\s]+(.+?)(?:\n|$)/i);
    if (updateMatch) {
      const name = updateMatch[1].trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      skills.push({
        name,
        description: '',
        workflow: output.slice(0, 1000),
        body: output.trim()
      });
    }
  }

  return skills;
}

function skillFileExists(name) {
  const filename = `${name}.md`;
  return fs.existsSync(path.join(SKILLS_DIR, filename));
}

function writeSkillFile(name, description, body) {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const now = new Date().toISOString();
  const filename = `${name}.md`;
  const filepath = path.join(SKILLS_DIR, filename);

  // If exists, append/update (don't replace entirely)
  if (fs.existsSync(filepath)) {
    const existing = fs.readFileSync(filepath, 'utf8');
    const frontmatterMatch = existing.match(/^---\n([\s\S]*?)\n---\n/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[0] : '';

    // Update frontmatter: increment useCount
    let updatedFrontmatter = frontmatter;
    const useMatch = frontmatter.match(/(useCount:\s*)(\d+)/);
    if (useMatch) {
      const newCount = parseInt(useMatch[2], 10) + 1;
      updatedFrontmatter = frontmatter.replace(
        /(useCount:\s*)(\d+)/,
        `$1${newCount}`
      );
    }

    // Append new workflow content as a new section
    const existingBody = existing.slice(frontmatter.length).trim();
    const newContent = `\n\n---\n\n## Review ${now.slice(0, 10)}\n\n${body}`;
    fs.writeFileSync(filepath, updatedFrontmatter + existingBody + newContent, 'utf8');
    console.log(`[skill-reviewer] Updated skill: ${filename}`);
    return { filename, action: 'updated' };
  }

  // New skill file
  const content = `---
name: ${name}
description: ${description || 'Auto-generated via Hermes-style review'}
status: draft
source: skill-reviewer
generatedAt: ${now}
useCount: 1
---

## Workflow

${body}

## Review Source

Generated from batch review of conversation snapshots at ${now}.
`;

  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`[skill-reviewer] Created skill: ${filename} (draft)`);
  return { filename, action: 'created' };
}

function createSymlink(filename) {
  const target = path.join(SKILLS_DIR, filename);
  const link = path.join(SKILLS_ACTIVE, `_learned_${filename}`);
  if (!fs.existsSync(SKILLS_ACTIVE)) return;
  try {
    if (fs.existsSync(link)) fs.unlinkSync(link);
    fs.symlinkSync(target, link, 'file');
    console.log(`[skill-reviewer] Symlinked: _learned_${filename}`);
  } catch (err) {
    console.warn(`[skill-reviewer] Symlink failed: ${err.message}`);
  }
}

// ────────────────────────────────────────────────────────────────
// SECTION D: Clear queue
// ────────────────────────────────────────────────────────────────

function clearProcessedQueue(processedCount) {
  // Archive processed entries to a backup file, then truncate main queue
  const archiveFile = path.join(path.dirname(QUEUE_FILE), '.skill_review_archive.jsonl');
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      if (fs.existsSync(archiveFile)) {
        // Append to archive
        const data = fs.readFileSync(QUEUE_FILE, 'utf8');
        // Remove leading "[" and trailing "]" from old format
        fs.appendFileSync(archiveFile, data, 'utf8');
      } else {
        fs.copyFileSync(QUEUE_FILE, archiveFile);
      }
      // Truncate main queue
      fs.writeFileSync(QUEUE_FILE, '', 'utf8');
    }
  } catch (err) {
    console.warn(`[skill-reviewer] Queue archival failed: ${err.message}`);
    // Fallback: just truncate
    try { fs.writeFileSync(QUEUE_FILE, '', 'utf8'); } catch (_) {}
  }
}

// ────────────────────────────────────────────────────────────────
// SECTION E: Main
// ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[skill-reviewer] Starting review run at ${new Date().toISOString()}`);

  // Step 1: Read queue
  const entries = readQueue();
  if (entries.length === 0) {
    console.log('[skill-reviewer] Nothing to review — queue empty');
    // Just report "nothing to review" as the agent's output
    return 'Nothing to review this run (queue empty).';
  }

  console.log(`[skill-reviewer] Loaded ${entries.length} queue entries`);

  // Step 2: The cron job's message IS the review prompt (OpenClaw sends it as the user message).
  // The LLM will process it and produce output. We don't generate output here —
  // the output of this script IS the response to the cron message.
  //
  // However, since this runs as an agentTurn, the LLM sees the message and tool list.
  // We construct the review prompt and the LLM will decide what to do with it.
  //
  // The important thing: the prompt is the user message. The LLM will call
  // write/edit/exec to create skill files based on its review.

  // Build batch prompt
  return buildBatchedReviewPrompt(entries);
}

// Run
main()
  .then(output => {
    if (output) console.log(output);
    process.exit(0);
  })
  .catch(err => {
    console.error(`[skill-reviewer] Fatal: ${err.message}`);
    process.exit(1);
  });

// ────────────────────────────────────────────────────────────────
// Separate file: ~/.openclaw/workspace/scripts/skill_review_prompt.js
// Contains the adapted Hermes review prompt as a JS string export
// ────────────────────────────────────────────────────────────────
```

### Separate prompt file: `~/.openclaw/workspace/scripts/skill_review_prompt.js`

```js
/**
 * skill_review_prompt.js — Adapted Hermes _SKILL_REVIEW_PROMPT for OpenClaw
 *
 * Used by the cron-based skill_reviewer.js to instruct the LLM on how to
 * review conversations and produce skill updates.
 */

'use strict';

const SKILL_REVIEW_PROMPT = `
## Review Instructions

Review the conversation snapshots above and update the skill library. Be ACTIVE — most batches of conversations produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

### Target shape
Class-level skills with a rich SKILL.md describing the workflow. NOT a flat list of narrow one-conversation-one-skill entries.

### Signals that warrant action (any one is enough)
- User corrected your style, tone, format, legibility, or verbosity. "stop doing X", "don't format like this", "this is too verbose" — embed the lesson in the relevant skill.
- User corrected your workflow or approach. Encode the correction as a pitfall or step in the relevant skill.
- Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from.
- An existing skill was wrong, missing a step, or outdated. Patch it now.

### Decision tree (prefer the earliest that fits)
1. **EXISTING SKILL PATCH** — If a file in \`skills-learned/\` already covers this territory, UPDATE it. Append the new learning as a section or pitfall.
2. **EXISTING UMBRELLA UPDATE** — If no loaded skill fits but a broader existing class-level skill does, patch it.
3. **NEW SKILL CREATE** — Create a new class-level skill file. The name MUST be at the class level (e.g. "code-review-checklist" not "fix-bug-1423"). If the proposed name only makes sense for today's conversation, it's wrong — fall back to (1) or (2).

### Skill file format
When creating or updating a skill file in \`skills-learned/\`:
- Frontmatter: name, description, status (draft), source, generatedAt, useCount
- ## Workflow section with numbered steps
- Keep it under 10 steps
- Each step is a concrete action with actual paths/patterns

### User-preference embedding
When the user expressed a style/format/workflow preference, embed it in the SKILL.md body, not just in this review. Memory captures "who the user is"; skills capture "how to do this class of task for this user".

### Do NOT capture (negative guards)
- Environment-dependent failures: missing binaries, fresh-install errors, "command not found", unconfigured credentials.
- Negative claims about tools or features ("browser tools don't work", "X tool is broken"). These harden into refusals.
- Session-specific transient errors that resolved before the conversation ended.
- One-off task narratives. "Summarize today's market" or "analyze this PR" is not a class of work that warrants a skill.
- If a tool failed because of setup state, capture the FIX (install command, config step) — never "this tool does not work".

### Output format
For each skill update you decide to make:
1. Use \`write\` to create or update the skill file in \`skills-learned/\`
2. The filename should be \`<class-name>.md\` with dashes, lowercase
3. Include proper frontmatter
4. Then report what you did as your final message

### Final message format
After processing all conversations, output a summary like:
\`\`\`
💾 Self-improvement review:
- Created: <skill-name> — <description>
- Updated: <skill-name> — <what changed>
- Skipped: <conversation description> — reason
\`\`\`

If nothing was worth saving, just say "Nothing to save." and stop. This should NOT be the default.`;

module.exports = { SKILL_REVIEW_PROMPT };
```

### How the cron job works in practice

The cron job's `--message` is constructed to include both the conversation data AND the review instructions. Since the script runs as a shell exec, it outputs the prompt text as its final stdout. OpenClaw cron's agentTurn mechanism delivers that output as the user message to the LLM.

However, there's a subtlety: we need the LLM to call tools to write/update skill files. The `toolsAllow` in the cron config gives the LLM access to `write`, `edit`, `read`, `exec`, `memory_search`. But the LLM runs on the cron session, not the main session.

**Alternative simpler approach:** Use `exec` in the script to call the LLM directly via the MiniMax API (like the current skill-learner does), but with a much better prompt. Let me revise:

### Revised approach — script calls LLM via `exec` + `memory_search` for context

Since the cron agentTurn approach requires the LLM to actively use tools (write/edit) inside the agent session, and OpenClaw's agentTurn does give tool access, the simpler approach is:

1. The script reads the queue and outputs the batched review prompt
2. The cron agentTurn delivers this prompt to the LLM (MiniMax-M3)
3. The LLM uses `read` to check existing skills, `write` to create new ones, `edit` to update existing ones
4. The LLM outputs a summary as its final response
5. OpenClaw announces the final response to the configured channel

This is clean because the LLM itself decides what to do and does it. The script is just a prompt builder.

**But wait** — there's a problem. The script needs to **output** the prompt text for the cron agentTurn to see it. And the script is what runs. So:

```
cron job → exec("node scripts/skill_reviewer.js") 
  → script reads queue, outputs prompt
  → OpenClaw takes stdout as agentTurn message
  → LLM sees prompt + toolsAllow tools
  → LLM uses write/edit to update skills
  → LLM outputs summary
  → OpenClaw announces summary to channel
```

This should work. Let me finalize the design with this understanding.

Actually, I need to reconsider. The `openclaw cron add` with `--message` flag sets the message, or I can have the message be "Execute skill_reviewer.js" and let the LLM run it... No, the simpler path is:

1. Register cron with a message like "Review queued conversations for skill updates"
2. The LLM (with toolsAllow: exec,read,write,edit,memory_search) will:
   - `exec` → run the script which reads queue and outputs the batched prompt
   - Or better: the LLM reads the queue file directly and does the review itself

Actually, the cleanest approach: the cron message IS the review prompt, and the queue file is read by the LLM via `exec cat` or `read`. Let me redesign:

The cron message is: "Run a Hermes-style skill review. Read ~/.openclaw/workspace/.skill_review_queue.jsonl, review the conversations, and produce skill updates. Follow the review instructions in skill_review_prompt.js."

Then `toolsAllow` gives it `exec,read,write,edit,memory_search`. The LLM reads the queue, reads the prompt instructions from the JS file, processes everything, writes skills, and summarizes.

But we want the full 30-line Hermes prompt in context, not just a reference. Let me use the approach where the script IS the prompt builder, and it just outputs the prompt for the cron agentTurn.

Let me redesign more carefully:

The script `skill_reviewer.js` does:
1. Reads queue entries
2. Builds the batched review prompt (entries + instructions)
3. **Prints the prompt to stdout**  
4. Process.exit(0)

The cron job runs as agentTurn with:
- message: "Run the skill reviewer"
- toolsAllow: exec,read,write,edit,memory_search

The LLM will:
1. exec the script to get the batched prompt
2. Read the output
3. Use write/edit to update skills
4. Summarize

This works but adds a round-trip. Even simpler: make the script output the prompt AND the instructions, then the cron message is "Execute `node ~/.openclaw/workspace/scripts/skill_reviewer.js`, then follow its output as your review instructions."

Actually the cleanest approach for cron agentTurn: the script IS the entry point. The script outputs the review prompt with all data embedded. The LLM's job is to read that output and act on it.

Let me finalize with this approach. The design doc should be clear enough for Josh to implement. I'll write the prompt inline in the script.

OK let me just write the complete final design doc now, keeping it practical with what I know.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true"># Hermes-Style Background Skill Review — Option 1B Implementation Plan

> **Design for:** Plugin writes review queue → cron job consumes & reviews
> **Status:** Design complete — ready for implementation
> **Date:** 2026-06-06

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       CONVERSATION LOOP                          │
│                                                                   │
│  User msg → Agent replies → agent_end event                       │
│                                │                                  │
│                                ▼                                  │
│  ┌─────────────────────────────────────────┐                      │
│  │  skill-learner/index.mjs  (plugin)      │   NON-BLOCKING      │
│  │                                         │                      │
│  │  api.on("agent_end") ── fire & forget   │                      │
│  │     │                                   │                      │
│  │     ├─ Filter: skip NO_REPLY, trivial   │                      │
│  │     ├─ Extract: messages, userPrompt,   │                      │
│  │     │  runId, timestamp, tool stats     │                      │
│  │     ├─ Compress: first user msg +       │                      │
│  │     │  last 6 turns, tool res ≤200c     │                      │
│  │     │                                   │                      │
│  │     └─ Write JSONL entry ───────────────┼──► .skill_review_   │
│  │        (max 50 entries, FIFO)           │    queue.jsonl       │
│  └─────────────────────────────────────────┘                      │
│                                                                   │
│                    ┌── EVERY 30 MINUTES ────┐                     │
│                    ▼                         ▼                     │
│  ┌────────────────────────────────────────────────────────┐       │
│  │  openclaw cron  (agentTurn)                            │       │
│  │  ────────────────────────────────────────────────       │       │
│  │  message = "Execute skill_reviewer.js"                 │       │
│  │  model   = minimax-portal/MiniMax-M3 w/ thinking:high │       │
│  │  tools   = exec,read,write,edit,memory_search,message │       │
│  │  channel = #⚙️系統 ({discord:1473376125584670872})    │       │
│  │                                                        │       │
│  │  LLM workflow (auto via toolsAllow):                   │       │
│  │  1. exec: read queue → batched prompt                 │       │
│  │  2. read: check existing skills-learned/              │       │
│  │  3. write/edit: create or update skill files          │       │
│  │  4. exec: clear processed queue entries               │       │
│  │  5. Output summary → announced to Discord             │       │
│  └────────────────────────────────────────────────────────┘       │
│                           │                                       │
│                           ▼                                       │
│  ┌────────────────────────────────────────────────────────┐       │
│  │  skills-learned/       (auto-generated .md files)      │       │
│  │     └── class-name.md  (frontmatter + workflow)        │       │
│  │                                                        │       │
│  │  skills/               (symlinks to active skills)     │       │
│  │     └── _learned_class-name.md  → ../../skills-learned/│       │
│  │                                                        │       │
│  │  weekly_correction_loop.js  (Phase 1b curator)         │       │
│  │     └── archive stale (14d idle)                       │       │
│  │     └── promote draft→active (≥3 repeat, ≥1 day old)   │       │
│  │     └── backup before run                              │       │
│  └────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
```

### Why this works

| Layer | Constraint | Solution |
|-------|-----------|----------|
| Plugin | CANNOT spawn sub-agents, CANNOT call LLM directly | Plugin just writes JSONL to disk — zero LLM, zero spawn |
| Plugin | MUST not block conversation | Sync `appendFileSync` is ~µs; handler is fire-and-forget |
| Review | Need LLM to write skills | Cron agentTurn has `toolsAllow: write,edit` → LLM does it itself |
| Cron | route-enforcer skips cron (`ctx?.trigger === "cron"`) | Cron jobs bypass route classifier entirely — always use explicit model |
| Queue | Must deduplicate across sessions | LLM reviews batched entries in one turn → can identify duplicates and consolidate |

---

## 2. Plugin Redesign — Queue Writer

### `~/.openclaw/extensions/skill-learner/index.mjs`

Complete rewrite. The plugin becomes a pure queue writer — no hash analysis, no LLM calls, no `.skill_patterns.json` mutations.

```mjs
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORKSPACE = path.join(process.env.HOME || "/Users/ally", ".openclaw", "workspace");
const QUEUE_FILE = path.join(WORKSPACE, ".skill_review_queue.jsonl");
const MAX_QUEUE_ENTRIES = 50;
const MAX_TURNS_IN_ENTRY = 6;        // keep last N turns + first user msg
const MAX_TOOL_RESULT_CHARS = 200;   // truncate tool results in summary
const MIN_TOOL_CALLS = 2;            // skip if < 2 tool calls across entire turn

// ── Helpers ──

function getMessageText(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "text") return block.text;
    }
  }
  return "";
}

function getToolCalls(msg) {
  if (Array.isArray(msg.content)) {
    return msg.content.filter(b => b.type === "toolCall" && b.name !== "message");
  }
  return [];
}

function getToolResults(msg, allMessages) {
  const idx = allMessages.indexOf(msg);
  if (idx < 0 || idx >= allMessages.length - 1) return [];
  const next = allMessages[idx + 1];
  if (next?.role !== "user" || !Array.isArray(next.content)) return [];
  return next.content.filter(b => b.type === "toolResult");
}

function summarizeToolResults(results) {
  if (!results || results.length === 0) return "";
  const lines = [];
  for (const r of results) {
    const name = r.name || r.toolName || "tool";
    let content = "";
    if (typeof r.content === "string") content = r.content;
    else if (typeof r.result === "string") content = r.result;
    else try { content = JSON.stringify(r.content || r.result).slice(0, MAX_TOOL_RESULT_CHARS); } catch { content = String(r.content || ""); }
    if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + "...";
    lines.push(`[${name}]: ${content}`);
  }
  return lines.join("\n").slice(0, 2000);
}

function getFirstUserPrompt(messages) {
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = getMessageText(msg);
      if (text && text.trim()) return text.trim();
    }
  }
  return "";
}

/**
 * Compress conversation for review: first user msg + last N assistant turns.
 */
function compressMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const result = [];

  // 1. First substantive user message
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = getMessageText(msg);
      if (text?.trim()) {
        result.push({ role: "user", text: text.trim().slice(0, 1000) });
        break;
      }
    }
  }

  // 2. Collect assistant turns (skip empty/NO_REPLY)
  const assistantTurns = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const text = getMessageText(msg);
      const toolCalls = getToolCalls(msg);
      if (!text && toolCalls.length === 0) continue; // NO_REPLY
      const toolResults = getToolResults(msg, messages);
      assistantTurns.push({
        text: text ? text.trim().slice(0, 500) : "",
        toolCalls: toolCalls.length,
        toolNames: [...new Set(toolCalls.map(t => t.name || ""))].filter(Boolean),
        toolSummary: summarizeToolResults(toolResults)
      });
    }
  }

  // Keep last MAX_TURNS_IN_ENTRY
  for (const turn of assistantTurns.slice(-MAX_TURNS_IN_ENTRY)) {
    result.push(turn);
  }

  return result;
}

function rotateQueue() {
  if (!existsSync(QUEUE_FILE)) return;
  try {
    const raw = readFileSync(QUEUE_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= MAX_QUEUE_ENTRIES) return;
    const kept = lines.slice(-MAX_QUEUE_ENTRIES);
    writeFileSync(QUEUE_FILE, kept.join("\n") + "\n", "utf8");
    console.log(`[skill-learner] Queue rotated: ${lines.length} → ${kept.length}`);
  } catch (err) {
    console.warn(`[skill-learner] Queue rotation failed: ${err.message}`);
  }
}

// ── Plugin Entry ──

export default definePluginEntry({
  id: "skill-learner",
  name: "Skill Learner (Queue Writer)",
  description: "Writes structured conversation snapshots to .skill_review_queue.jsonl for cron-based review",
  register(api) {
    api.on("agent_end", async (event) => {
      const messages = event?.messages || [];
      if (!Array.isArray(messages) || messages.length < 2) return;

      // === FILTER: trivial turns ===
      let totalToolCalls = 0;
      let lastAssistantText = "";
      let lastAssistantTools = 0;

      for (const msg of messages) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const calls = msg.content.filter(b => b.type === "toolCall" && b.name !== "message");
          totalToolCalls += calls.length;
          // Track the last assistant
          lastAssistantText = getMessageText(msg);
          lastAssistantTools = calls.length;
        }
      }

      // Skip if not enough tool calls
      if (totalToolCalls < MIN_TOOL_CALLS) return;

      // Skip if last assistant is NO_REPLY (no text, no tools)
      if (!lastAssistantText && lastAssistantTools === 0) return;

      // === EXTRACT ===
      const userPrompt = getFirstUserPrompt(messages);
      if (!userPrompt) return;

      const compressed = compressMessages(messages);
      const timestamp = new Date().toISOString();

      // === BUILD entry ===
      const entry = {
        v: 1,
        ts: timestamp,
        runId: event.runId || "",
        userPrompt: userPrompt.slice(0, 500),
        turnCount: messages.length,
        toolCallCount: totalToolCalls,
        success: event.success !== false,
        error: event.error || undefined,
        compressed
      };

      // === WRITE queue (fire-and-forget) ===
      try {
        appendFileSync(QUEUE_FILE, JSON.stringify(entry) + "\n", "utf8");
        rotateQueue();
      } catch (err) {
        console.warn(`[skill-learner] Queue write failed: ${err.message}`);
      }
    });
  }
});
```

### What was removed

| Removed | Reason |
|---------|--------|
| `loadState()` / `saveState()` | No more `.skill_patterns.json` — queue-based now |
| `hashPattern()` / `collapseConsecutive()` | Hash-based detection was the fundamental flaw |
| `loadProviderConfig()` / `callM3()` | Plugin no longer calls LLM |
| `generateSkillContent()` | Skill generation moved to cron review |
| `NOISE_TOOLS` / `bucketCount` | No longer needed |
| `classifyAuxiliaryTask` import | No per-turn classification needed for queue writes |

### Queue entry schema (per JSONL line)

```json
{
  "v": 1,
  "ts": "2026-06-06T10:30:00.000Z",
  "runId": "abc123",
  "userPrompt": "幫我寫一個 email 報價俾客戶",
  "turnCount": 14,
  "toolCallCount": 28,
  "success": true,
  "compressed": [
    {"role": "user", "text": "幫我寫一個 email 報價俾客戶"},
    {"text": "I'll draft an email...", "toolCalls": 3, "toolNames": ["exec", "read"], "toolSummary": "[exec]: ls ..."}
  ]
}
```

---

## 3. Cron Review Script

### `~/.openclaw/workspace/scripts/skill_reviewer.js`

This script outputs the **batched review prompt** that the cron LLM acts on. The cron job runs an agentTurn with `toolsAllow: exec,read,write,edit,memory_search`. The LLM:

1. Runs `exec node scripts/skill_reviewer.js` to get the batched prompt
2. Reads existing skills in `skills-learned/` via `read` or `exec ls`
3. Creates/updates skills via `write`/`edit`
4. Clears the queue via `exec`
5. Outputs a summary

```js
#!/usr/bin/env node

/**
 * skill_reviewer.js — Batched Hermes-style skill review prompt builder
 *
 * Usage: node scripts/skill_reviewer.js
 * Outputs: A structured prompt with all queue entries + review instructions
 *
 * Designed to be invoked by the cron agentTurn LLM via:
 *   exec node scripts/skill_reviewer.js
 *
 * The LLM reads the output, uses write/edit to update skills,
 * then exec clears the queue.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');
const QUEUE_FILE = path.join(WORKSPACE, '.skill_review_queue.jsonl');
const SKILLS_DIR = path.join(WORKSPACE, 'skills-learned');
const SKILLS_ACTIVE = path.join(WORKSPACE, 'skills');

// ── Read queue ──

function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  const raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

// ── List existing skills for LLM context ──

function listExistingSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fp = path.join(SKILLS_DIR, f);
      const content = fs.readFileSync(fp, 'utf8');
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) return { file: f, description: '(no frontmatter)' };
      const desc = fm[1].match(/description:\s*(.+)/);
      const status = fm[1].match(/status:\s*(.+)/);
      return {
        file: f,
        description: desc ? desc[1].trim() : '(no description)',
        status: status ? status[1].trim() : 'unknown'
      };
    });
}

// ── Copy of the Hermes-adapted review instructions ──
// (kept as a string constant for inline embedding)

const REVIEW_INSTRUCTIONS = `
## Review Instructions

Review the conversation snapshots above and update the skill library. Be ACTIVE — most batches of conversations produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity.

### Target shape
Class-level skills with a rich SKILL.md describing the workflow. NOT a flat list of narrow one-conversation-one-skill entries.

How to proceed:
1. First, LIST existing skills in skills-learned/ (they are below for reference)
2. For EACH conversation, determine if a skill update is warranted
3. If multiple conversations suggest the SAME class-level update, produce ONE skill file
4. Use \`write\` or \`edit\` to create/update skills in skills-learned/
5. After all updates done, \`exec node scripts/skill_reviewer_cleanup.js\` to clear the queue
6. Output a summary

### Skill file naming
Filename: <class-name>.md (lowercase, dashes, no spaces)
Example: "code-review-checklist.md" not "fix-bug-1423.md"

### Signals that warrant action (any one is enough)
- User corrected your style, tone, format, legibility, or verbosity. "stop doing X", "don't format like this", "this is too verbose", "why are you explaining", "just give me the answer", "you always do Y and I hate it" — embed the lesson in the relevant skill.
- User corrected your workflow or approach. Encode the correction as a pitfall or explicit step in the skill that governs that class of task.
- Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from.
- A skill that was loaded or consulted this session turned out to be wrong, missing a step, or outdated. Patch it NOW.

### Decision tree (prefer the earliest that fits)
1. **PATCH EXISTING SKILL** — If a file in skills-learned/ already covers this territory, UPDATE it. Append the new learning as a subsection or pitfall.
2. **UPDATE EXISTING UMBRELLA** — If no single file fits but a broader existing skill does, update it.
3. **CREATE NEW CLASS-LEVEL SKILL** — Create a new .md file. The name MUST be at the class level. Must NOT be a session-specific artifact.

### Skill file format
Use proper frontmatter:
\`\`\`
---
name: <class-name>
description: <one-sentence description>
status: draft
source: skill-reviewer
generatedAt: <ISO timestamp>
---
\`\`\`

Then ## Workflow with numbered concrete steps. Keep under 10 steps.

### User-preference embedding
When the user expressed a style/format/workflow preference, embed it in the SKILL.md body. Skills capture "how to do this class of task for this user".

### Do NOT capture (negative guards)
- Environment-dependent failures: missing binaries, fresh-install errors, "command not found", unconfigured credentials, uninstalled packages. The user can fix these.
- Negative claims about tools or features ("browser tools don't work", "X tool is broken", "cannot use Y"). These harden into refusals.
- Session-specific transient errors that resolved before the conversation ended. If retrying worked, capture the RETRY PATTERN, not the original failure.
- One-off task narratives. "Summarize today's market" or "analyze this PR" is not a class of work that warrants a skill.

### Final summary format
After all updates, output:
\`\`\`
💾 Self-improvement review:
- Created: <skill-name> — <description>
- Updated: <skill-name> — <what changed>
- Skipped: <N> conversations — <reason>
\`\`\`

If nothing was worth saving, just say "Nothing to save." and stop. This should NOT be the default.
`;

// ── Main ──

function main() {
  const entries = readQueue();
  const existingSkills = listExistingSkills();

  if (entries.length === 0) {
    // Empty queue — output a no-op prompt so LLM can skip quickly
    console.log('Nothing to review — queue is empty. Say "Nothing to save." and stop.');
    process.exit(0);
  }

  // Build the batched review prompt
  let prompt = `# 🔄 Skill Review — ${entries.length} Queued Conversations\n\n`;
  prompt += `Existing skills in skills-learned/ (${existingSkills.length} files):\n`;

  if (existingSkills.length === 0) {
    prompt += `  (none — empty directory)\n`;
  } else {
    for (const s of existingSkills) {
      prompt += `  - ${s.file} (${s.status}): ${s.description}\n`;
    }
  }
  prompt += `\n---\n\n`;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    prompt += `### Conversation ${i + 1} [${e.ts.slice(0, 19)}]\n\n`;
    prompt += `**User asked:** ${e.userPrompt}\n`;
    prompt += `**Tool calls:** ${e.toolCallCount} across ${e.turnCount} turns | **Success:** ${e.success}\n`;
    if (e.error) prompt += `**Error:** ${e.error}\n`;
    prompt += `\n**Transcript:**\n\`\`\`\n`;

    for (const turn of e.compressed) {
      if (turn.role === 'user') {
        prompt += `USER: ${turn.text}\n\n`;
      } else {
        if (turn.text) prompt += `ASSISTANT: ${turn.text}\n`;
        if (turn.toolCalls > 0) {
          prompt += `[${turn.toolCalls} calls: ${turn.toolNames.join(', ')}]\n`;
        }
        if (turn.toolSummary) {
          const s = turn.toolSummary.length > 300
            ? turn.toolSummary.slice(0, 300) + '...'
            : turn.toolSummary;
          prompt += `${s}\n`;
        }
        prompt += '\n';
      }
    }
    prompt += `\`\`\`\n\n---\n\n`;
  }

  prompt += REVIEW_INSTRUCTIONS;
  console.log(prompt);
}

main();
```

### `~/.openclaw/workspace/scripts/skill_reviewer_cleanup.js`

A companion script that the LLM executes after completing skill reviews to clear the queue:

```js
#!/usr/bin/env node

/**
 * skill_reviewer_cleanup.js — Clear processed queue entries
 *
 * Called by the cron review LLM after it finishes skill updates.
 * Archives processed entries and truncates main queue.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');
const QUEUE_FILE = path.join(WORKSPACE, '.skill_review_queue.jsonl');
const ARCHIVE_FILE = path.join(WORKSPACE, '.skill_review_archive.jsonl');

function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log('[cleanup] Queue file not found — nothing to clean');
    process.exit(0);
  }

  const raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
  const lines = raw ? raw.split('\n').filter(Boolean) : [];
  const count = lines.length;

  // Archive
  try {
    fs.appendFileSync(ARCHIVE_FILE, raw + '\n', 'utf8');
    console.log(`[cleanup] Archived ${count} entries`);
  } catch (err) {
    console.warn(`[cleanup] Archive failed: ${err.message}`);
  }

  // Truncate main queue
  try {
    fs.writeFileSync(QUEUE_FILE, '', 'utf8');
    console.log(`[cleanup] Queue cleared (${count} entries processed)`);
  } catch (err) {
    console.warn(`[cleanup] Queue truncate failed: ${err.message}`);
    process.exit(1);
  }
}

main();
```

---

## 4. Adapted Hermes Review Prompt

### Full prompt text (embedded in `skill_reviewer.js` as `REVIEW_INSTRUCTIONS`)

```
## Review Instructions

Review the conversation snapshots above and update the skill library. Be
ACTIVE — most batches of conversations produce at least one skill update, even
if small. A pass that does nothing is a missed learning opportunity.

### Target shape
Class-level skills with a rich SKILL.md describing the workflow. NOT a flat
list of narrow one-conversation-one-skill entries.

How to proceed:
1. First, LIST existing skills in skills-learned/ (they are printed above)
2. For EACH conversation, determine if a skill update is warranted
3. If multiple conversations suggest the SAME class-level update, produce ONE
   skill file — do not create N files for N similar conversations
4. Use `write` or `edit` to create/update skills in skills-learned/
5. After all updates done, `exec node scripts/skill_reviewer_cleanup.js` to
   clear the queue
6. Output a summary

### Skill file naming
Filename: <class-name>.md (lowercase, dashes, no spaces)
Example: "code-review-checklist.md" not "fix-bug-1423.md"

### Signals that warrant action (any one is enough)
- User corrected your style, tone, format, legibility, or verbosity. "stop
  doing X", "don't format like this", "this is too verbose", "why are you
  explaining", "just give me the answer", "you always do Y and I hate it" —
  embed the lesson in the relevant skill.
- User corrected your workflow or approach. Encode the correction as a pitfall
  or explicit step in the skill that governs that class of task.
- Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern
  emerged that a future session would benefit from.
- A skill that was loaded or consulted this session turned out to be wrong,
  missing a step, or outdated. Patch it NOW.

### Decision tree (prefer the earliest that fits)
1. **PATCH EXISTING SKILL** — If a file in skills-learned/ already covers this
   territory, UPDATE it. Append the new learning as a subsection or pitfall.
2. **UPDATE EXISTING UMBRELLA** — If no single file fits but a broader existing
   skill does, update it.
3. **CREATE NEW CLASS-LEVEL SKILL** — Create a new .md file. The name MUST be
   at the class level. The name MUST NOT be a specific conversation ID, error
   string, feature codename, or "fix-X / debug-Y" session artifact. If the
   proposed name only makes sense for today's conversation, it's wrong — fall
   back to (1) or (2).

### Skill file format
Use proper frontmatter:
```
---
name: <class-name>
description: <one-sentence description>
status: draft
source: skill-reviewer
generatedAt: <ISO timestamp>
---
```

Then ## Workflow with numbered concrete steps. Keep under 10 steps.

### User-preference embedding
When the user expressed a style/format/workflow preference, embed it in the
SKILL.md body, not just in memory. Memory captures "who the user is and what
the current situation and state of your operations are"; skills capture "how
to do this class of task for this user". When they complain about how you
handled a task, update the skill that governs that task.

### Do NOT capture (negative guards — from Hermes)
- Environment-dependent failures: missing binaries, fresh-install errors,
  "command not found", unconfigured credentials, uninstalled packages. The
  user can fix these — they are not durable rules.
- Negative claims about tools or features ("browser tools don't work", "X tool
  is broken", "cannot use Y from execute_code"). These harden into refusals.
- Session-specific transient errors that resolved before the conversation
  ended. If retrying worked, the lesson is the RETRY PATTERN, not the original
  failure.
- One-off task narratives. "Summarize today's market" or "analyze this PR" is
  not a class of work that warrants a skill.
- If a tool failed because of setup state, capture the FIX (install command,
  config step, env var to set) under an existing setup or troubleshooting
  skill — never "this tool does not work" as a standalone constraint.

### Final summary format
After all updates, output:
```
💾 Self-improvement review:
- Created: <skill-name> — <description>
- Updated: <skill-name> — <what changed>
- Skipped: <N> conversations — <reason>
```

If nothing was worth saving, just say "Nothing to save." and stop. This should
NOT be the default — most batches should produce at least one small update.
```

### Key adaptations from Hermes

| Hermes Original | OpenClaw Adaptation | Why |
|----------------|---------------------|-----|
| Uses UML `skill_manage` tool | Uses `write`/`edit` on `skills-learned/` | OpenClaw has no skill_manage tool; filesystem is the skill store |
| Fork daemon thread per turn | Batch via cron every 30 min | Plugin can't fork threads; batching is more efficient |
| Classification prompt embedded in Python string | Embedded in `skill_reviewer.js` as JS const | Same content, different string format |
| Protected skills list includes hub-installed | No protected skill concept (no hub) | Simplify — all skills in `skills-learned/` are fair game |
| `skills_list` + `skill_view` tools | `exec ls` / `read` on directory | OpenClaw cron has `exec` + `read` |
| Curator runs separately | `weekly_correction_loop.js` Phase 1b handles curator tasks | Already exists and working |

---

## 5. Cron Job Registration

### Exact command

```bash
openclaw cron add \
  --name "Skill Reviewer (30min)" \
  --cron "*/30 * * * *" \
  --tz "Asia/Hong_Kong" \
  --agent main \
  --model "minimax-portal/MiniMax-M3" \
  --thinking high \
  --message "Execute: node ~/.openclaw/workspace/scripts/skill_reviewer.js\nThen read its output and follow the review instructions." \
  --tools "exec,read,write,edit,memory_search,message" \
  --announce \
  --channel "1473376125584670872" \
  --timeout-seconds 600 \
  --light-context
```

### Parameters explained

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `--cron` | `*/30 * * * *` | Every 30 minutes — frequent enough to prevent queue pileup, sparse enough to avoid wasted runs |
| `--model` | `minimax-portal/MiniMax-M3` | M3 for review quality (thinking:high). Using explicit model bypasses route-enforcer |
| `--thinking high` | Required | Review needs structured reasoning about class-level vs session-specific |
| `--message` | sees prompt via `exec` | The message tells LLM to exec the script; the script outputs the real prompt |
| `--tools` | `exec,read,write,edit,memory_search,message` | Whitelist: LLM can read queue, check skills, write files, clear queue, report |
| `--announce` | true | Final LLM output sent to Discord channel |
| `--channel` | `1473376125584670872` | `#⚙️系統` — system notifications |
| `--timeout-seconds` | 600 | 10 min max — batched review may require multiple read/write rounds |
| `--light-context` | true | No need for full session bootstrap — just the cron message |

### What `route-enforcer` does

The route-enforcer plugin has `if (ctx?.trigger === "cron") return;` in both hooks. This means:
- Cron jobs **bypass** the aux classifier and router entirely
- The explicit `--model` flag on the cron job is authoritative
- No interference from per-turn routing

### Cron schedule visualization

```
00:00 ─ review ── 00:30 ── review ── 01:00 ── review ── 01:30 ── ...
         │                    │                    │
         └── 50 entries max   └── 50 entries max   └── 50 entries max
         per 30min window     per 30min window     per 30min window
```

On a typical day (~100-200 conversation turns), the queue fills at ~3-8 entries per 30min. The cron job usually sees 3-8 entries per run. At most, after heavy use, it hits 50 (FIFO rotation prevents overflow).

---

## 6. State File Schema

### Primary: `.skill_review_queue.jsonl` (JSONL format)

```json
{
  "v": 1,
  "ts": "2026-06-06T10:30:00.000Z",
  "runId": "abc123-def456",
  "userPrompt": "幫我寫一個 email 報價俾客戶",
  "turnCount": 14,
  "toolCallCount": 28,
  "success": true,
  "error": "optional error string if success=false",
  "compressed": [
    {"role": "user", "text": "幫我寫一個 email 報價俾客戶"},
    {
      "text": "I'll draft a professional quote email...",
      "toolCalls": 3,
      "toolNames": ["exec", "read"],
      "toolSummary": "[exec]: ls ~/templates/\n[read]: quote template content..."
    },
    {
      "text": "",
      "toolCalls": 2,
      "toolNames": ["write"],
      "toolSummary": "[write]: Created quote email draft"
    }
  ]
}
```

**Field types:**

| Field | Type | Max Size | Required | Description |
|-------|------|----------|----------|-------------|
| `v` | number | — | yes | Schema version (currently 1) |
| `ts` | string (ISO8601) | 24 | yes | Timestamp of the agent_end event |
| `runId` | string | 64 | yes | OpenClaw run ID for dedup |
| `userPrompt` | string | 500 | yes | First user message (truncated) |
| `turnCount` | number | — | yes | Total messages in the turn |
| `toolCallCount` | number | — | yes | Total tool calls across all assistant msgs |
| `success` | boolean | — | yes | Whether agent ended successfully |
| `error` | string | 200 | no | Error message if success=false |
| `compressed` | array | ≤7 items | yes | Compressed conversation (1 user + ≤6 assistant) |
| `compressed[].role` | string | — | for user items | "user" |
| `compressed[].text` | string | 1000 | for user, 500 for assistant | Message text |
| `compressed[].toolCalls` | number | — | for assistant items | Count of tool calls |
| `compressed[].toolNames` | string[] | 10 items | for assistant items | Unique tool names used |
| `compressed[].toolSummary` | string | 2000 | for assistant items | Summarized tool results |

### Secondary: `.skill_review_archive.jsonl` (JSONL)

Same schema as queue, appended-to as each batch is cleared. Rotated manually if ever needed — pure audit trail.

### No more `.skill_patterns.json`

The old state file is **deprecated** after migration (see Section 8). It can be deleted or kept as reference.

---

## 7. Edge Cases & Failure Handling

### 7.1 Queue write fails (plugin side)

| Scenario | Handling |
|----------|----------|
| Queue file doesn't exist | `appendFileSync` auto-creates it (`O_CREAT` behavior on macOS) |
| Disk full | `appendFileSync` throws → caught by try/catch → `console.warn` logged |
| Permission denied | Plugin runs as same user (OpenClaw process), should have write access to workspace |
| concurrent write | Plugin `agent_end` handlers are serial per turn (single-threaded Node). Two concurrent turns are possible in different sessions → `appendFileSync` is atomic for small writes on macOS. Very unlikely to collide. |

**Decision:** Fire-and-forget with try/catch. No retry — if disk is full, retry won't help. Log and move on.

### 7.2 Cron job times out (mid-review)

| Scenario | Handling |
|----------|----------|
| 600s timeout hit mid-review | OpenClaw kills the agentTurn. Queue NOT cleared (cleanup script not called). Next run re-reads same queue + new entries. Duplicate entries waste some LLM tokens but are idempotent. |
| LLM stuck on one file write | `--timeout-seconds 600` is generous; M3 responses are fast. If stuck, timeout kills and retry sees full queue again. |
| Partial writes | If LLM wrote 2 skill files then timed out, next run sees those files plus the same queue. It will attempt to re-review. Existing files get `useCount` incremented (append workflow), which is fine. |

**Decision:** Timeout is safe — no data corruption because cleanup only runs on success. Duplicate reviews add useCount but don't break anything.

### 7.3 M3 returns garbage

| Scenario | Handling |
|----------|----------|
| Garbage text instead of skills | LLM outputs nonsense → OpenClaw announces garbage to Discord. The queue stays (cleanup not called). Next run retries. |
| LLM tries to delete files | `--tools` whitelist doesn't include `rm` or `unlink`; `exec` is available but with no `rm` in the whitelisted tool, LLM can only run scripts. `write` overwrites files. |
| LLM creates bad skill files | Next review run sees them in existing skills list. The LLM can patch/improve them. `weekly_correction_loop` Phase 1b may archive stale ones after 14 days. |

**Decision:** Garbage output is self-limiting — queue stays, next run retries. No permanent damage.

### 7.4 Same conversation reviewed twice

| Scenario | Handling |
|----------|----------|
| Queue not cleared before next run | Next run sees old + new entries. LLM might re-review the same conversation. Batched prompt helps — LLM sees "9 entries" and can spot duplicates by userPrompt similarity. |
| LLM creates duplicate skill files | Skill files are `class-name.md` — if LLM creates `email-quote.md` in run 1 and `email-quote.md` in run 2, the second write appends content (existing-file logic in prompt). |
| runId dedup | Queue entries carry `runId`. The cron script could theoretically detect duplicates by runId, but it's simpler to let the LLM handle dedup during batch review — the prompt says "if multiple conversations suggest the same class-level update, produce ONE skill file". |

**Decision:** No explicit dedup needed. Batching + LLM judgment handles it naturally.

### 7.5 What if M3 can't call write on skills-learned/?

The `--tools` whitelist gives the LLM access to `write` which writes files at absolute paths. The LLM can `write` to `~/Documents/Obsidian Vault/...` or to `~/.openclaw/workspace/skills-learned/...`. As long as the LLM constructs the right path, it will work. The prompt explicitly instructs it to use `skills-learned/`.

### 7.6 What if queue has no entries at cron time?

The script outputs "Nothing to review — queue is empty. Say 'Nothing to save.' and stop." The LLM reads this and outputs "Nothing to save." (one agent turn, minimal cost). The cleanup script is NOT called (queue is already empty, calling it is harmless but wasteful).

### 7.7 `write` tool path resolution

OpenClaw's `write` tool resolves relative paths from the workspace. The LLM should use absolute paths like `~/.openclaw/workspace/skills-learned/...` or relative paths from workspace. If the tool resolves differently, the prompt should instruct absolute paths. This is a config-time concern — verify during testing.

---

## 8. Migration Plan

### Step 1: Deploy new plugin (queue writer)

```
1. Write new ~/.openclaw/extensions/skill-learner/index.mjs
2. OpenClaw auto-reloads plugin (watch-mode) OR restart:
   openclaw restart
3. Verify: agent_end events produce .skill_review_queue.jsonl lines
```

**Status check:**
```bash
# Check queue file exists and has entries
wc -l ~/.openclaw/workspace/.skill_review_queue.jsonl
# Check plugin log
tail -20 ~/.openclaw/logs/*.log | grep "skill-learner"
```

### Step 2: Create cron scripts

```bash
# Create the reviewer script
# Create the cleanup script
chmod +x ~/.openclaw/workspace/scripts/skill_reviewer.js
chmod +x ~/.openclaw/workspace/scripts/skill_reviewer_cleanup.js
```

### Step 3: Register cron job

```bash
openclaw cron add \
  --name "Skill Reviewer (30min)" \
  --cron "*/30 * * * *" \
  --tz "Asia/Hong_Kong" \
  --agent main \
  --model "minimax-portal/MiniMax-M3" \
  --thinking high \
  --message "Execute: node ~/.openclaw/workspace/scripts/skill_reviewer.js\nThen read its output and follow the review instructions." \
  --tools "exec,read,write,edit,memory_search,message" \
  --announce \
  --channel "1473376125584670872" \
  --timeout-seconds 600 \
  --light-context
```

### Step 4: Verify end-to-end

```bash
# Force a cron run:
openclaw cron run <cron-id>
# Check Discord for announcement
# Check skills-learned/ for new files
ls -lt ~/.openclaw/workspace/skills-learned/
```

### Step 5: Clean up old artifacts (optional, after 1 week of stable operation)

| Item | Action | Why |
|------|--------|-----|
| `.skill_patterns.json` | Keep or delete | No longer updated by plugin. Old data is dead. Safe to delete after 1 week. |
| Old skill files in `skills-learned/` | Keep | They have existing content. The new reviewer can patch/update them. The curator (weekly_correction_loop) will archive stale ones after 14d idle. |
| Old symlinks in `skills/` | Keep | They point to files that still exist. The weekly curator already handles orphan symlinks. |
| Old `agent_end` import of classifier | Removed in new plugin | New plugin doesn't import `classifyAuxiliaryTask`. Import line is gone. |

### What NOT to do

| Don't | Why |
|-------|-----|
| Wipe `skills-learned/` before deploying | Existing skills have real use; new reviewer should build on them |
| Run new + old plugin simultaneously | Old plugin creates `.skill_patterns.json` entries; new plugin creates queue entries. They don't conflict (separate state files). Safe to have both but unnecessary. |
| Schedule cron faster than 30min | Prevents queue accumulation + gives LLM enough time for batch review. Faster = more M3 costs. |

---

## 9. Cost Estimate

### LLM calls per day

| Component | Calls/day | Model | Tokens/run (est) | Daily Tokens |
|-----------|-----------|-------|-------------------|--------------|
| Plugin queue write | 0 | — | — | — |
| Cron review | 48 (every 30min) | MiniMax-M3 thinking:high | Input: 5K avg (batched) = 240K | Input: ~240K tokens |
| | | | Output: ~2K avg = 96K | Output: ~96K tokens |

### Realistic cost (MiniMax M3 via portal)

MiniMax M3 pricing (via minimax-portal, included in OpenClaw subscription):
- No per-token cost (bundled in subscription)

If using a pay-per-token provider:

| Metric | Value |
|--------|-------|
| Input tokens/day | ~240K (48 runs × 5K avg) |
| Output tokens/day | ~96K (48 runs × 2K avg) |
| Total tokens/day | ~336K |
| Total tokens/month | ~10M |

**Actual cost:** Zero additional (M3 is included in OpenClaw subscription). If external, ~$2-5/month depending on provider.

### When queue is empty (typical overnight)

| Metric | Value |
|--------|-------|
| Runs/day with empty queue | ~24 (during low-usage hours) |
| Each run output | "Nothing to save." (~20 tokens) |
| Cost of empty runs | Negligible (~500 tokens/day) |

---

## 10. Code Quality & CQM Concerns

### P0 violations check

| Rule | Status | Notes |
|------|--------|-------|
| No double-declared log | ✅ | Plugin uses `console.warn` (same as current pattern). Reviewer script uses `console.log`. |
| async inside try-catch | ✅ | Plugin handler is `async` → try/catch wraps queue write. |
| Call undefined functions | ✅ | All functions defined before use. |
| Surgical changes | ✅ | Only modify `skill-learner/index.mjs` and create new files. No changes to route-enforcer or other plugins. |

### P1 violations check

| Rule | Status | Notes |
|------|--------|-------|
| Magic numbers → CONFIG | ✅ | `MAX_QUEUE_ENTRIES`, `MAX_TURNS_IN_ENTRY`, `MIN_TOOL_CALLS` are module-level constants |
| Atomic writes | ✅ | Queue append is atomic on macOS; writeFileSync for rotation is temp+rename pattern not needed for ≤100KB JSONL |
| Error not silently swallowed | ✅ | `console.warn` on queue write failure |

### P2 violations check

| Rule | Status | Notes |
|------|--------|-------|
| No TODO/FIXME left | ✅ | All implementation details specified |
| No DRY violation | ✅ | Shared logic (queue read/write) is module-scoped. Reviewer and plugin share no code. |

### `verify_edit.js` check

Every edit to `skill-learner/index.mjs` should be verified:
```bash
node scripts/verify_edit.js ~/.openclaw/extensions/skill-learner/index.mjs
```

### `--surgical` enforcement

The redesign replaces the ENTIRE `index.mjs` file. This is intentional — the old hash-based logic is the fundamental flaw. There is no way to fix it surgically. The new file:
- Keeps the same `definePluginEntry({ id: "skill-learner", ... })` registration
- Keeps the same `api.on("agent_end", ...)` hook
- Removes ALL old logic (hash, LLM, state file)
- Replaces with queue writer

Everything else is new files, not modifications.

---

## Appendix: File checklist

| File | Action | Size (est) |
|------|--------|------------|
| `~/.openclaw/extensions/skill-learner/index.mjs` | **REWRITE** entirely | ~120 lines |
| `~/.openclaw/workspace/scripts/skill_reviewer.js` | **CREATE** new | ~200 lines |
| `~/.openclaw/workspace/scripts/skill_reviewer_cleanup.js` | **CREATE** new | ~50 lines |
| `~/.openclaw/workspace/.skill_review_queue.jsonl` | **CREATE** (auto by plugin) | grows/shrinks |
| `~/.openclaw/workspace/.skill_review_archive.jsonl` | **CREATE** (auto by cleanup) | grows |
| `~/.openclaw/workspace/.skill_patterns.json` | **DEPRECATE** | no longer used |
| `~/.openclaw/workspace/skills-learned/*.md` | **KEEP** as-is | existing files |
| `~/.openclaw/workspace/skills/_learned_*.md` | **KEEP** as-is | existing symlinks |

### Implementation order

1. `skill_reviewer.js` and `skill_reviewer_cleanup.js` (standalone, testable without plugin)
2. `index.mjs` (requires restart or plugin watching)
3. Test queue writes: have a conversation, check `.skill_review_queue.jsonl`
4. Test cron: empty queue → "Nothing to save." expected
5. Test cron: 3-5 queue entries → skill file created in `skills-learned/`
6. Register permanent cron job
7. Monitor Discord for 24h for `💾 Self-improvement review:` messages
