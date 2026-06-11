#!/usr/bin/env node
/**
 * validate_skill_file.js — Post-write integrity gate for skill creation
 *
 * Runs before a skill file is committed to disk or promoted to active.
 * Rejects:
 *   - body < 200 words
 *   - unclosed code blocks (``` without closing ```)
 *   - truncated workflow sections (last ## Workflow step ends without punctuation)
 *   - missing "## Workflow" section entirely
 *   - body word count < 3x the description length (template spam detection)
 *
 * Usage:
 *   node scripts/validate_skill_file.js <path-to-SKILL.md>
 *   exit 0 = valid, exit 1 = invalid (with reason to stderr)
 */

'use strict';

const fs = require('fs');
const path = require('path');

function validateSkill(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  return validateSkillContent(content);
}

function validateSkillContent(content) {
  const errors = [];

  // 1. Word count (body only — strip frontmatter)
  // 1. Stub detection (revised 2026-06-08) — composite of 3 truncation signals
  //    Old: words < 200 → stub (false-positive killed 5 useful thin skills:
  //    pipeline-heartbeat-debugging 82w, cron-thin-executor-migration 133w,
  //    ai-hot-push-workflow 169w, subagent-code-tuning-workflow 215w,
  //    model-migration-workflow 217w)
  //    New: flag as stub if ≥2 of 3 signals (file size / workflow structure / word count)
  //    Rationale: word count measures verbosity, not quality. Real stubs have
  //    STRUCTURAL deficiencies — file too small, no workflow, no pitfalls.
  const body = content.replace(/^---[\s\S]*?---\n/, '').trim();
  const words = body.split(/\s+/).filter(w => w.length > 0).length;
  const bytes = content.length;
  const hasWorkflow = /^##\s+Workflow/m.test(content);
  // ── BUG-02 fix: also match H3-prefixed numbered steps ──
  // The previous regex `/^\d+\.\s+/gm` only matched top-level numbered list
  // items. Skills that use `### 1. Setup\n### 2. Deploy\n### 3. Verify` (H3
  // subheaders as workflow steps) would falsely be flagged as STUBs because
  // numSteps < STUB_WORKFLOW_STEPS_MIN. Allow optional H1–H3 prefix to match
  // the same pattern used by workflow step detection below.
  const numSteps = (content.match(/^(?:#{1,3}\s+)?\d+\.\s+/gm) || []).length;

  const STUB_FILE_SIZE_MIN = 1500;      // bytes — frontmatter+workflow+pitfalls minimum (matches prompt docs)
  const STUB_WORKFLOW_STEPS_MIN = 3;    // a real workflow has ≥3 steps
  const STUB_WORD_COUNT_MIN = 30;       // <30 words can't explain any meaningful workflow
  const PITFALLS_MIN = 3;               // a real skill has ≥3 pitfall items (matches prompt docs)

  const fileTooSmall = bytes < STUB_FILE_SIZE_MIN;
  const noWorkflowStructure = !hasWorkflow || numSteps < STUB_WORKFLOW_STEPS_MIN;
  const isPathologicallyThin = words < STUB_WORD_COUNT_MIN;
  const truncationSignals = [fileTooSmall, noWorkflowStructure, isPathologicallyThin].filter(Boolean).length;
  if (truncationSignals >= 2) {
    const reasons = [];
    if (fileTooSmall) reasons.push(`${bytes}B < ${STUB_FILE_SIZE_MIN}B`);
    if (noWorkflowStructure) reasons.push(hasWorkflow ? `only ${numSteps} steps` : 'no Workflow section');
    if (isPathologicallyThin) reasons.push(`only ${words} words`);
    errors.push(`Stub detected (${reasons.join(' + ')})`);
  }

  // 2. Unclosed code blocks (BUG-05 fix: stateful line-by-line tracking)
  var inBlock = false;
  for (const line of content.split('\n')) {
    const fenceMatch = line.match(/^(\s*)(```+)/);
    if (!fenceMatch) continue;
    const fence = fenceMatch[2];
    const fenceLen = fence.length;
    if (fenceLen === 3) {
      if (/^\s*```\s*$/.test(line)) {
        // Bare ``` — toggle
        inBlock = !inBlock;
      } else if (/^\s*```[a-zA-Z0-9_-]/.test(line)) {
        // ```lang — always opens
        if (!inBlock) inBlock = true;
      }
    } else if (fenceLen > 3) {
      // 4+ backticks — open
      if (!inBlock) inBlock = true;
    }
  }
  if (inBlock) {
    errors.push('Unclosed code block at end of file');
  }

  // 2b. Pitfalls count check (BUG-03 fix: matches prompt docs)
  const pitHeader = content.match(/^##\s+Pitfalls\s*$/m);
  if (pitHeader) {
    const pitStart = pitHeader.index + pitHeader[0].length;
    const pitRest = content.slice(pitStart);
    const pitNextHeader = pitRest.match(/^##\s+(?!#)/m);
    const pitContent = pitNextHeader ? pitRest.slice(0, pitNextHeader.index) : pitRest;
    const pitBullets = pitContent.match(/^(?:- (?:⚠️?\s*)?|###\s+(?:\d+\.\s+)?(?:⚠️?\s*)?)\S/gm) || [];
    if (pitBullets.length < PITFALLS_MIN) {
      errors.push(`Only ${pitBullets.length} pitfalls — need at least ${PITFALLS_MIN}`);
    }
  } else {
    errors.push('Missing "## Pitfalls" section');
  }

  // 3. Workflow section check.
  //    Strategy: find the "## Workflow" line, then capture content greedily
  //    to end of file, then split off any subsequent "## " section.
  //    (Using (?=$) or (?=\Z) in JS m-mode has a quirk: $ matches at position
  //    immediately after \n, so non-greedy capture stops at 0 chars.)
  const workflowHeader = content.match(/^##\s+Workflow\s*$/m);
  if (!workflowHeader) {
    errors.push('Missing "## Workflow" section');
  } else {
    const startIdx = workflowHeader.index + workflowHeader[0].length;
    const rest = content.slice(startIdx);
    // Cut at the next "## " (level-2) header line, but not "###"
    const nextHeader = rest.match(/^##\s+(?!#)/m);
    const workflowContent = nextHeader ? rest.slice(0, nextHeader.index) : rest;
    const workflowSteps = workflowContent.match(/^(?:#{1,3}\s+)?\d+\.\s+[^\n]+/gm) || [];
    if (workflowSteps.length < 3) {
      errors.push(`Workflow has only ${workflowSteps.length} steps — need at least 3`);
    }
    // Truncation detection: check if the workflow content ends mid-sentence.
    // Strategy: take the last "non-empty" line of workflow content; if it ends
    // with a colon (likely introducing a code block/list that was never written)
    // or with no sentence-final punctuation AND no following content, flag it.
    if (workflowContent.trim().length > 0) {
      const trimmed = workflowContent.trim();
      const lastLine = trimmed.split('\n').filter(l => l.trim().length > 0).pop();
      // Strip trailing whitespace
      const last = lastLine.trimEnd();
      // Heuristic 1: ends with colon (likely truncated before code/list)
      const endsWithColon = /[:：]\s*$/.test(last);
      // Heuristic 2: the file itself ends without proper punctuation AND has no
      // content after the workflow (i.e., last step was the last thing written)
      const fileEndsAbruptly = !/[.!?。)\]】」』]"?$|'?$]$/.test(content.trimEnd())
        && !/\n##\s+\w+/.test(content.slice(startIdx + workflowContent.length));
      if (endsWithColon && fileEndsAbruptly) {
        errors.push(`Workflow ends with colon "${last.slice(-40)}" — likely truncated before code block/list`);
      }
    }
  }

  // 4. Template spam detection: body should be > 3x description length
  const descMatch = content.match(/description:\s*["']([^"']{10,})["']/i);
  if (descMatch && words < descMatch[1].length * 3) {
    errors.push(`Body (${words} words) is less than 3x description length — possible template spam`);
  }

  return { valid: errors.length === 0, errors };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node validate_skill_file.js <path-to-SKILL.md>');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const { valid, errors } = validateSkill(filePath);
  if (valid) {
    console.log(`OK: ${path.basename(filePath)}`);
    process.exit(0);
  } else {
    for (const err of errors) {
      console.error(`INVALID: ${err}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateSkill, validateSkillContent };
