#!/usr/bin/env node

/**
 * skill_reviewer_bot.js — Self-contained Skill Review Bot
 *
 * 跟 daily_summary_bot.js 相同模式：所有 LLM call 直接用
 * `openclaw infer model run` CLI，唔經 agent internal model routing。
 *
 * 流程：
 *   1. 讀 queue + 用現有 skill_reviewer.js 建立 prompt
 *   2. execSync(`openclaw infer model run`) 做分析
 *   3. Parse LLM response 提取 skill file content
 *   4. fs.writeFile 寫技能檔案
 *   5. exec skill_reviewer_cleanup.js 清 queue
 *   6. HTTPS POST → Discord #⚙️系統（如有更新）
 *
 * 使用：
 *   node scripts/skill_reviewer_bot.js [--quiet]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, execFileSync } = require('child_process');
const { WS, OPENCLAW_CONFIG, SKILLS_ACTIVE } = require('./lib/config');

// ── Config ──
const MODEL = 'minimax-portal/MiniMax-M2.7';
const MODEL_FALLBACKS = ['deepseek/deepseek-v4-flash'];  // M2.5 removed: has max_tokens constraint incompatibility with long prompts
const TIMEOUT_MS = 300000;
const REVIEWER_SCRIPT = path.join(WS, 'scripts', 'skill_reviewer.js');
const CLEANUP_SCRIPT = path.join(WS, 'scripts', 'skill_reviewer_cleanup.js');
const QUEUE_FILE = path.join(WS, '.skill_review_queue.jsonl');
const DISCORD_CHANNEL = '1473376125584670872';
const LOCK_DIR = path.join(WS, '.skill_reviewer_bot.lockdir');
const SKILL_CREATED_LOG = path.join(WS, '.skill_created.jsonl');

// ── Helpers ──

function log() {
  if (!process.argv.includes('--quiet')) console.log(...arguments);
}

function err() {
  console.error(...arguments);
}

/**
 * Record a skill_created event to .skill_created.jsonl (append-only).
 * Used for quality trend telemetry: pitfalls count, workflow steps,
 * quarantine rate over time. Separate from .skill_metrics.json (run-level
 * telemetry) to keep this lightweight and event-sourced.
 */
function recordSkillCreated(event) {
  try {
    fs.appendFileSync(SKILL_CREATED_LOG, JSON.stringify(event) + '\n', 'utf8');
  } catch (e) {
    err('skill_created event write failed: ' + e.message);
  }
}

function getDiscordToken() {
  try {
    var config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return (config.channels && config.channels.discord && config.channels.discord.token) || '';
  } catch (e) {
    err('Failed to read Discord token: ' + e.message);
    return '';
  }
}

function sendDiscordMessage(content) {
  return new Promise((resolve, reject) => {
    const token = getDiscordToken();
    const body = JSON.stringify({ content });
    const options = {
      hostname: 'discord.com',
      path: '/api/v10/channels/' + DISCORD_CHANNEL + '/messages',
      method: 'POST',
      headers: {
        'Authorization': 'Bot ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        if (res.statusCode === 200) resolve(true);
        else reject(new Error('HTTP ' + res.statusCode + ': ' + data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── WARN-03 fix: Discord delivery with retry + exponential backoff ──
function sendDiscordMessageWithRetry(content, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  return new Promise(function (resolve, reject) {
    var attempt = 0;
    function tryOnce() {
      attempt++;
      sendDiscordMessage(content)
        .then(resolve)
        .catch(function (err) {
          var transient = err.message.indexOf('429') !== -1 || err.message.indexOf('rate') !== -1 || /\b5\d{2}\b/.test(err.message) || err.message.indexOf('ETIMEDOUT') !== -1 || err.message.indexOf('ECONNRESET') !== -1;
          if (transient && attempt < maxAttempts) {
            var delay = 1000 * Math.pow(2, attempt - 1);  // 1s, 2s, 4s
            log('Discord send failed (attempt ' + attempt + '/' + maxAttempts + '): ' + err.message + ' — retrying in ' + delay + 'ms');
            setTimeout(tryOnce, delay);
          } else {
            if (attempt >= maxAttempts) err('Discord delivery failed after ' + attempt + ' attempts: ' + err.message);
            reject(err);
          }
        });
    }
    tryOnce();
  });
}

function readQueueCount() {
  if (!fs.existsSync(QUEUE_FILE)) return 0;
  try {
    var raw = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
    return raw ? raw.split('\n').filter(Boolean).length : 0;
  } catch (e) {
    return 0;
  }
}

// ── Prompt building ──

function buildReviewPrompt() {
  var basePrompt = execSync('node "' + REVIEWER_SCRIPT + '" --batch', {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' })
  });

  if (basePrompt.indexOf('Nothing to review') !== -1) return null;

  // Batch mode instructions — use single quotes for literal backticks
  var instructions =

    '\n\n' +
    '## \u26a0\ufe0f BATCH MODE \u2014 TOOLS NOT AVAILABLE\n\n' +
    'IMPORTANT: You are running in batch mode. You do NOT have write/edit/message tools.\n' +
    'Output skill file content directly in your response, not tool calls.\n\n' +
    '### How to output skill files\n\n' +
    'For each skill you create or update, output a fenced code block\n' +
    'with the RELATIVE file path as the language tag.\n\n' +
    'IMPORTANT: Do NOT wrap your output blocks in an extra ``` wrapper.\n' +
    'Start DIRECTLY with the skill fence. Example format:\n\n' +
    '  ```skills-learned/my-skill/SKILL.md\n' +
    '  ---\n' +
    '  name: my-skill\n' +
    '  description: Workflow for doing X\n' +
    '  status: draft\n' +
    '  source: skill-reviewer\n' +
    '  provenance: agent\n' +
    '  generatedAt: ' + new Date().toISOString() + '\n' +
    '  ---\n\n' +
    '  ## Workflow\n' +
    '  1. Step one\n' +
    '  2. Step two\n\n' +
    '  ## Pitfalls\n' +
    '  - Watch out for X\n' +
    '  ```\n\n' +
    '### Final JSON summary (REQUIRED)\n\n' +
    'After ALL file blocks, output a summary JSON block as the LAST thing:\n\n' +
    '```json\n' +
    '{\n' +
    '  "summary": "\uD83D\uDCBE Skill Self-improvement:\\n- \u65b0\u5efa: name \u2014 desc\\n- \u66f4\u65b0: name \u2014 desc\\n- \u968a\u5217: N \u689d\u5df2\u6b78\u6a94\u4e26\u6e05\u7a7a",\n' +
    '  "hasUpdates": true,\n' +
    '  "filesWritten": ["skills-learned/my-skill/SKILL.md"]\n' +
    '}\n' +
    '```\n\n' +
    'If NO updates:\n' +
    '```json\n' +
    '{"summary":"no-updates","hasUpdates":false,"filesWritten":[]}\n' +
    '```\n\n' +
    '### Rules\n' +
    '- Follow Analysis \u2192 Decision \u2192 Implementation structure\n' +
    '- DO NOT mention tools (write/edit/message)\n' +
    '- Output each file as ```skills-learned/... fenced block\n' +
    '- End with JSON summary, NOTHING after it\n\n' +
    'Continue review.\n';

  return basePrompt + instructions;
}

// ── Response parsing ──

function extractFileBlocks(response) {
  // ── H-4 fix: detect unclosed code fences (odd ``` count) ──
  // If the LLM truncated or malformed its output, fence pairs may be
  // unbalanced. Bail early with an error rather than silently dropping
  // the malformed block (or worse, writing a half-formed file).
  var fenceCount = (response.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    err('Aborting extract: unclosed code fence (odd ``` count: ' + fenceCount + ')');
    return { files: [], error: 'unclosed code fence' };
  }
  var blocks = [];
  // Match ```[lang]skills-learned/<path>.md\n...content...```
  // B7 fix: allow leading whitespace (LLM sometimes indents)
  // B8 fix: allow optional info string (e.g. ```markdown or ```md) before the path
  var startIdx = 0;
  while (true) {
    // Find next ``` possibly followed by a language tag, then skills-learned/
    // Use a regex that matches optional whitespace + ``` + optional lang + skills-learned/
    var fenceRegex = /^\s*```[a-zA-Z0-9_-]*\s*skills-learned\/[^\n]+$/gm;
    fenceRegex.lastIndex = startIdx;
    var match = fenceRegex.exec(response);
    if (!match) break;

    var open = match.index;
    // Find the line that contains the fence opening
    var lineStart = open;
    // ── BUG-01 fix: use match's own end position to find the line ending ──
    // The previous implementation used response.indexOf('\n', open), which
    // incorrectly matched a \n in the match's leading whitespace (e.g. a
    // blank line before this block). When that happened, contentStart
    // pointed to the opening ``` of the NEXT block, causing the inner
    // fence-tracking loop to treat that opening as an internal code-block
    // open and fail to find the outer close — silently dropping every block
    // after the first when blocks were separated by a blank line.
    // Using match[0].length is robust because the regex `...$/gm` anchors
    // the match to a complete line, so match[0] IS the line content and
    // match[0].length == (position of trailing \n) - match.index.
    var lineEnd = match.index + match[0].length;
    if (lineEnd >= response.length) break;  // no \n after opening fence, bail

    // The path starts after the ``` and optional lang
    var fenceContent = match[0];
    var pathStart = fenceContent.indexOf('skills-learned/') + 'skills-learned/'.length;
    var pathPart = fenceContent.slice(pathStart).trim();
    var filePath = 'skills-learned/' + pathPart;

    var contentStart = lineEnd + 1;
    // ── BUG-02 fix: stateful code-block tracking ──
    // The previous regex `/^\s*```\s*$/gm` matched any bare ``` line as the
    // closing fence — but LLM output often contains INTERNAL code blocks
    // (e.g. ```bash) that get incorrectly interpreted as the outer close.
    // Track open/close state to find the actual outer close.
    // Pair-finding logic: an outer CLOSE must be a bare ``` (no lang tag) AND
    // it must NOT be the closing of an internal block. We detect this by
    // requiring TWO consecutive bare ``` (the first closes the internal block,
    // the second is the outer close), OR a bare ``` that is preceded by
    // non-code content.
    var pos = contentStart;
    var openCount = 0;
    var close = -1;
    var lastFenceWasBareClose = false;  // tracks if previous ``` was a closing fence
    var anyFenceRegex = /^\s*```.*$/gm;
    while (true) {
      anyFenceRegex.lastIndex = pos;
      var fenceMatch = anyFenceRegex.exec(response);
      if (!fenceMatch) break;
      var fenceLine = fenceMatch[0].trim();
      var isBare = /^\s*```\s*$/.test(fenceLine);
      var isLangFence = /^\s*```[a-zA-Z0-9_-]/.test(fenceLine);

      if (isLangFence) {
        // ```lang — always opens a code block
        if (openCount === 0) openCount = 1;
        lastFenceWasBareClose = false;
      } else if (isBare) {
        if (openCount === 0) {
          // This is the OUTER close (we are not inside any block)
          close = fenceMatch.index;
          break;
        } else {
          // This closes an internal block
          openCount = 0;
          lastFenceWasBareClose = true;
        }
      } else {
        // 4+ backticks — opens a code block
        if (openCount === 0) openCount = 1;
        lastFenceWasBareClose = false;
      }
      pos = fenceMatch.index + fenceMatch[0].length;
    }
    if (close === -1) break;

    var content = response.slice(contentStart, close).trim();
    // ── B9 fix + WARN-07: Strip ALL accidental fence duplications ──
    // LLM sometimes duplicates the opening fence inside the block
    // (confused by the prompt template's nested-fence example).
    // Loop until no more leading duplicate fences (handles multi-duplication).
    while (/^```[a-zA-Z0-9_-]*\s*skills-learned\//.test(content)) {
      var firstNewline = content.indexOf('\n');
      content = firstNewline !== -1 ? content.slice(firstNewline + 1).trim() : '';
    }
    // Also strip a trailing standalone ``` if the LLM accidentally
    // embedded a code-fence close inside the content block.
    if (content.length > 0 && /\n```\s*$/.test(content)) {
      content = content.replace(/\n```\s*$/, '');
    }
    // Accept any skills-learned/ file (SKILL.md + support files like references/, scripts/)
    if (content && filePath.indexOf('skills-learned/') === 0 && !filePath.includes('..')) {
      blocks.push({ filePath: filePath, content: content });
    }

    startIdx = close + fenceMatch[0].length;
  }
  return { files: blocks, error: null };
}

function extractSummaryBlock(response) {
  // Find the ```json ... ``` block
  var jsonStart = response.indexOf('```json\n');
  if (jsonStart === -1) return null;

  var contentStart = jsonStart + 8; // length of ```json\n
  var jsonEnd = response.indexOf('```', contentStart);
  if (jsonEnd === -1) return null;

  var raw = response.slice(contentStart, jsonEnd).trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    err('Failed to parse summary JSON: ' + e.message);
    return null;
  }
}

// ── File writing ──

// Check which target files already exist BEFORE writing
function checkExistingFiles(blocks) {
  var existing = {};
  for (var i = 0; i < blocks.length; i++) {
    var absPath = path.join(WS, blocks[i].filePath);
    existing[blocks[i].filePath] = fs.existsSync(absPath);
  }
  return existing;
}

function writeSkillFiles(blocks) {
  var written = [];
  var { safeWriteFileSync } = require('./lib/disk_guard');
  var { validateSkillContent } = require('./validate_skill_file');
  var PRE_WRITE_STUB_SIZE_MIN = 1500;   // bytes — refuse to write <1500B SKILL.md (BUG-04 fix)
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var absPath = path.join(WS, block.filePath);
    var dir = path.dirname(absPath);
    try {
      // ── QW-2 fix: pre-write self-referential filter ──
      // Hard block filePaths that would create skills about the bot itself.
      // Prevents the feedback loop where LLM observes its own failures and
      // generates "skill-reviewer-bot-self-improvement" recursively.
      var selfRefPattern = /(skill-reviewer|curator|self-improvement|bot-self|skill-validation-failure-cleanup)/i;
      if (selfRefPattern.test(block.filePath)) {
        err('Refusing self-referential skill: ' + block.filePath);
        recordSkillCreated({v:1, ts:new Date().toISOString(), name:path.basename(dir), file:block.filePath, bytes:block.content.length, validationPassed:false, symlinked:false, reason:'self-referential block (QW-2)'});
        log('SKIP self-ref: ' + block.filePath);
        continue;
      }
      // ── QW-3 fix: use validator's composite stub detection ──
      // Previously: pre-write gate only checked file size (<1500B) but post-write
      // validator uses 2-of-3 signals (size / workflow structure / word count).
      // The two checks diverged. Now: run the validator's content check BEFORE
      // writing so we use the SAME criteria as the post-write gate.
      if (path.basename(absPath) === 'SKILL.md') {
        var preResult = validateSkillContent(block.content);
        if (!preResult.valid) {
          err('Refusing to write skill that would fail post-write validation: ' + block.filePath);
          err('  Reasons: ' + preResult.errors.join('; '));
          var qDirName = 'quarantine-' + Date.now() + '-' + path.basename(dir);
          var qDir = path.join(WS, 'skills-learned/_archive', qDirName);
          if (!fs.existsSync(qDir)) {
            fs.mkdirSync(qDir, { recursive: true });
          }
          safeWriteFileSync(path.join(qDir, 'SKILL.md'), block.content + '\n');
          recordSkillCreated({v:1, ts:new Date().toISOString(), name:path.basename(dir), file:block.filePath, bytes:block.content.length, validationPassed:false, symlinked:false, reason:'pre-write validator fail (QW-3): ' + preResult.errors.join('; ')});
          log('Quarantined (pre-validator fail): ' + qDirName);
          continue;
        }
        // Legacy single-signal check (size-only) — kept for backward compat logging
        if (block.content.length < PRE_WRITE_STUB_SIZE_MIN) {
          log('NOTE: size < 1500B but composite check passed — allowing write');
        }
      }
      // ── BUG-04 fix (legacy, now superseded by QW-3 above) ──
      // (Old size-only stub check removed — QW-3 uses validator's composite check)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log('Created directory: ' + dir.replace(WS, ''));
      }
      // ── BUG-06 fix: atomic write via safeWriteFileSync ──
      // Previously fs.writeFileSync — non-atomic. If bot crashes mid-write, file is
      // left half-written. Now uses tmp + rename for atomic replacement.
      safeWriteFileSync(absPath, block.content + '\n');
      log('Wrote: ' + block.filePath);
      written.push(block.filePath);

      // ── P0 Integrity Gate: validate skill before symlinking ──
      // Reject stubs/truncated skills from being promoted to active skills/.
      // If validation fails, keep the file as draft in skills-learned/ but do
      // NOT create the symlink (which would inject a broken skill into
      // <available_skills> system prompt).
      if (path.basename(absPath) === 'SKILL.md' && block.filePath.indexOf('skills-learned/') === 0) {
        var validationPassed = true;
        try {
          var validatorOut = require('child_process').execFileSync(
            'node',
            [path.join(WS, 'scripts/validate_skill_file.js'), absPath],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
          );
          log('Validation OK: ' + block.filePath);
        } catch (valErr) {
          validationPassed = false;
          var stderr = (valErr.stderr ? valErr.stderr.toString() : '').trim();
          err('Validation FAILED for ' + block.filePath + ' — keeping as draft, no symlink');
          if (stderr) {
            stderr.split('\n').forEach(function (line) {
              if (line.trim()) err('  ' + line.trim());
            });
          }
        }
        if (validationPassed) {
          // ── QW3: Symlink instant-create to skills/ (idempotent) ──
          // Solves 7-day latency: new skills in skills-learned/ are immediately
          // discoverable via a symlink in skills/, no need to wait for the
          // weekly_correction_loop migration. Use _learned_ prefix (matches
          // weekly_correction_loop.js convention) to avoid duplicate detection
          // when listCategorizedSkills scans both skills/ and skills-learned/.
          try {
            var className = path.basename(dir);
            var symlinkPath = path.join(SKILLS_ACTIVE, '_learned_' + className);
            if (!fs.existsSync(symlinkPath)) {
              fs.symlinkSync(dir, symlinkPath, 'dir');
              log('Symlinked: skills/_learned_' + className + ' -> ' + dir.replace(WS, ''));
            }
          } catch (symErr) {
            if (symErr.code !== 'EEXIST') {
              err('Symlink failed for ' + className + ': ' + symErr.message);
            }
          }
        } else {
          // ── H-1 fix: Remove stale symlink on validation failure ──
          // If a previous valid version of this skill had a symlink in skills/,
          // an UPDATE that just wrote flawed content would leave the symlink
          // pointing at the new (broken) file, polluting <available_skills>.
          // Unlink it so the bad content does not get injected into the
          // system prompt.
          try {
            var failClassName = path.basename(dir);
            var staleSymlinkPath = path.join(SKILLS_ACTIVE, '_learned_' + failClassName);
            if (fs.existsSync(staleSymlinkPath)) {
              fs.unlinkSync(staleSymlinkPath);
              log('WARN', 'Removed stale symlink: ' + staleSymlinkPath);
            }
          } catch (symUnlinkErr) {
            err('Failed to remove stale symlink for ' + path.basename(dir) + ': ' + symUnlinkErr.message);
          }
          // ── H-2 fix: Quarantine failed SKILL.md ──
          // Move the just-written (now known-bad) SKILL.md to a
          // failed-validations archive so the LLM's bad content is preserved
          // for inspection without staying in skills-learned/ where it could
          // be re-promoted on the next run. Mirrors the pre-write stub
          // quarantine pattern (BUG-04) but uses 'failed-validations/' to
          // distinguish the two failure modes.
          try {
            var qClassName = path.basename(dir);
            var failQDir = path.join(WS, 'skills-learned/_archive/failed-validations', qClassName + '-' + Date.now());
            if (!fs.existsSync(failQDir)) {
              fs.mkdirSync(failQDir, { recursive: true });
            }
            fs.renameSync(absPath, path.join(failQDir, 'SKILL.md'));
            log('Quarantined failed validation: ' + path.relative(WS, failQDir));
          } catch (qErr) {
            err('Failed to quarantine ' + block.filePath + ': ' + qErr.message);
          }
        }

        // ── skill_created event tracking ──
        // Append-only JSONL event for quality trend telemetry. Tracks
        // pitfalls count, workflow steps, validation outcome, symlink state.
        // See .skill_created.jsonl — separate from .skill_metrics.json (run-level).
        try {
          // H-2 may have moved SKILL.md to failed-validations/ — statSync would
          // then throw. Default to 0 bytes so the failure case still records a
          // telemetry event with accurate validationPassed/symlinked fields.
          var fileBytes = 0;
          try { fileBytes = fs.statSync(absPath).size; } catch (statErr) { /* quarantined */ }
          var content = block.content;
          // Count pitfalls: top-level bullets under "## Pitfalls" section.
          // Use line-anchored header (^## Pitfalls) to avoid false matches when
          // "## Pitfalls" is mentioned inside backticks/code blocks earlier in
          // the file. Take the LAST line-anchored header (real section is at
          // the end; earlier mentions are template/text references).
          // Accept both bold (**) and plain bullets — many skills use plain text.
          var pitHeaders = content.match(/^## Pitfalls[ \t]*$/gm);
          var pitfallsCount = 0;
          if (pitHeaders) {
            var lastHeader = pitHeaders[pitHeaders.length - 1];
            var lastIdx = content.lastIndexOf(lastHeader);
            var startIdx = lastIdx + lastHeader.length;
            var rest = content.slice(startIdx);
            var nextH2 = rest.match(/^##\s+(?!#)/m);
            var pitfallsBody = nextH2 ? rest.slice(0, nextH2.index) : rest;
            // Strip code blocks so bullets inside ```...``` are not counted
            pitfallsBody = pitfallsBody.replace(/```[\s\S]*?```/g, '');
            // ── BUG-03 fix: use the same pitfalls regex as validate_skill_file.js ──
            // The previous regex `/^- (?:⚠️?\s*)?\S/gm` only matched plain bullets
            // and missed H3-prefixed pitfalls (`### ⚠️ foo` / `### 1. foo`) that
            // the H-3 validator fix started accepting. Skills that pass H-3 with
            // H3-prefixed pitfalls would be recorded with pitfallsCount=0 here,
            // making trending data inaccurate. Use the unified pattern that
            // matches both plain bullets and H3-prefixed pitfalls.
            pitfallsCount = (pitfallsBody.match(/^(?:- (?:⚠️?\s*)?|###\s+(?:\d+\.\s+)?(?:⚠️?\s*)?)\S/gm) || []).length;
          }
          // Count workflow steps: numbered list under "## Workflow" section
          var stepsMatch = content.match(/## Workflow[^\n]*\n([\s\S]*?)(?=\n## |\s*$)/);
          var workflowSteps = stepsMatch
            ? (stepsMatch[1].match(/^(?:#{1,3}\s+)?\s*\d+\.\s+/gm) || []).length
            : 0;
          recordSkillCreated({
            v: 1,
            ts: new Date().toISOString(),
            name: path.basename(dir),
            file: block.filePath,
            bytes: fileBytes,
            pitfallsCount: pitfallsCount,
            workflowSteps: workflowSteps,
            validationPassed: validationPassed,
            symlinked: validationPassed
          });
        } catch (telemetryErr) {
          err('skill_created telemetry failed: ' + telemetryErr.message);
        }
      }
    } catch (e) {
      err('Failed to write ' + block.filePath + ': ' + e.message);
      // ── WARN-01 fix: record failed write in JSONL audit trail ──
      // Without this, failed writes (disk full, EACCES) leave no trace.
      try {
        recordSkillCreated({v:1, ts:new Date().toISOString(), name:path.basename(dir), file:block.filePath, bytes:block.content.length, validationPassed:false, symlinked:false, reason:'write failed: ' + e.code || e.message});
      } catch (auditErr) {
        err('Audit trail also failed: ' + auditErr.message);
      }
    }
  }
  return written;
}

// ── Main ──

async function main() {
  // Lock (mkdir as mutex — atomic directory creation)
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: false });
  } catch (e) {
    log('Already running (lock exists). Skipping.');
    return;
  }

  var cleanup = false;

  try {
    // 1. Check queue
    var count = readQueueCount();
    if (count === 0) {
      log('Nothing to review \u2014 queue is empty.');
      return;
    }
    log(count + ' entries to review');

    // 2. Build prompt
    log('Building review prompt...');
    var prompt = buildReviewPrompt();
    if (!prompt) {
      log('Nothing to review.');
      return;
    }
    log('Prompt: ' + (prompt.length / 1024).toFixed(1) + ' KB');

    // 3. Call LLM via openclaw infer model run, with fallbacks
    log('Calling ' + MODEL + '...');
    var startTime = Date.now();

    var modelsToTry = [MODEL].concat(MODEL_FALLBACKS);
    var stdout = null;
    var lastError = null;

    for (var mi = 0; mi < modelsToTry.length; mi++) {
      var currentModel = modelsToTry[mi];
      if (mi > 0) {
        log('Fallback to ' + currentModel + '...');
      }

      try {
        stdout = execFileSync('openclaw', [
          'infer', 'model', 'run',
          '--model', currentModel,
          '--prompt', prompt,
          '--json'
        ], {
          timeout: TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf8',
          env: Object.assign({}, process.env, { OPENCLAW_NO_COLOR: '1' })
        });
        // Success — break out of fallback loop
        break;
      } catch (e) {
        lastError = e;
        var isRateLimit = e.message.indexOf('429') !== -1 || e.message.indexOf('rate_limit') !== -1 || e.message.indexOf('usage limit') !== -1;
        var isOverload = e.message.indexOf('overloaded') !== -1;
        var is5xx = /\b5\d{2}\b/.test(e.message);
        var isNetError = e.message.indexOf('ETIMEDOUT') !== -1 || e.message.indexOf('ECONNRESET') !== -1 || e.message.indexOf('ENOTFOUND') !== -1 || e.message.indexOf('EAI_AGAIN') !== -1;
        if (isRateLimit || isOverload || is5xx || isNetError) {
          var reason = isRateLimit ? 'rate limit' : isOverload ? 'overload' : is5xx ? '5xx' : 'net';
          log(currentModel + ' unavailable (' + reason + '), trying next...');
          continue;
        }
        // Non-retryable error — stop trying
        err('LLM call failed: ' + e.message);
        log('No updates \u2014 LLM error.');
        return;
      }
    }

    if (!stdout) {
      err('All models exhausted. Last error: ' + (lastError ? lastError.message : 'unknown'));
      log('No updates \u2014 all models unavailable.');
      return;
    }

    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('LLM responded in ' + elapsed + 's');

    var output = stdout.toString();
    var jsonStart = output.indexOf('{');
    if (jsonStart === -1) {
      err('No JSON in CLI output');
      return;
    }

    var parsed;
    try {
      parsed = JSON.parse(output.slice(jsonStart));
    } catch (e) {
      err('Failed to parse LLM JSON output: ' + e.message);
      return;
    }

    var outputs = parsed.outputs || [];
    if (!outputs.length || !outputs[0].text) {
      err('No text output from LLM');
      return;
    }

    var response = outputs[0].text.trim();
    log('Response: ' + response.length + ' chars');

    // 4. Parse response
    var extractResult = extractFileBlocks(response);
    if (extractResult.error) {
      // Keep queue intact so the next run can retry (cleanup is still false here).
      err('Aborting: ' + extractResult.error + ' \u2014 keeping queue for retry');
      return;
    }
    var blocks = extractResult.files;
    var summaryBlock = extractSummaryBlock(response);
    log('Extracted ' + blocks.length + ' file block(s)');

    // 5. Check existing files BEFORE writing
    var existingFiles = checkExistingFiles(blocks);

    // 6. Schedule cleanup (BEFORE write so failed writes don't re-process queue)
    cleanup = true;

    // 7. Write files
    var filesWritten = [];
    if (blocks.length > 0) {
      filesWritten = writeSkillFiles(blocks);
    }

    // 8. Build summary (use pre-write existence for correct new/update label)
    var summary = null;
    if (summaryBlock && summaryBlock.hasUpdates) {
      summary = summaryBlock.summary;
    } else if (filesWritten.length > 0) {
      var lines = ['\uD83D\uDCBE Skill Self-improvement (batch):'];
      for (var i = 0; i < blocks.length; i++) {
        var fp = blocks[i].filePath;
        var name = fp.split('/')[1] || fp;
        lines.push((existingFiles[fp] ? '- \u66f4\u65b0: ' : '- \u65b0\u5efa: ') + name);
      }
      summary = lines.join('\n');
    }

    // 9. Send Discord
    if (summary) {
      log('Sending to Discord #\u2699\ufe0f\u7cfb\u7d71...');
      try {
        await sendDiscordMessageWithRetry(summary);
        log('Done.');
      } catch (e) {
        err('Discord send failed: ' + e.message);
        console.log('\n=== Summary ===\n' + summary + '\n==============');
      }
    } else {
      log('No updates \u2014 nothing to report.');
    }

  } finally {
    if (cleanup) {
      try {
        execSync('node "' + CLEANUP_SCRIPT + '"', { timeout: 10000, stdio: 'pipe' });
        log('Queue cleaned.');
      } catch (e) {
        err('Cleanup: ' + e.message);
      }
    }
    try {
      fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

if (require.main === module) {
  main().then(function() { process.exit(0); }).catch(function(e) {
    err('Fatal: ' + e.message);
    process.exit(1);
  });
}

module.exports = { main };
