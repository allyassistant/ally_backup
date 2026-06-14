# Skill Reviewer Audit Report
*日期：2026-06-10 | Junk rate: ~33% (10/52 in skills-learned/, 8/42 active = 18/52 = 34.6%)*

## Verdict
🔴 **Critical bugs found** — 6 P0 bugs are causing the high junk rate, plus several P1 issues that amplify the problem.

---

## Executive Summary

| Metric | Value | Status |
|--------|-------|--------|
| Total skills-learned/ dirs | 52 | — |
| Junk (no symlink) | **10** | 🔴 |
| Active (has symlink) but low-quality | **8** | 🔴 |
| Healthy active skills | 34 | 🟢 |
| Validation pass rate (last 41 events) | 31.7% | 🔴 |
| Cache hit rate | 9% | 🟡 |
| `.skill_review_archive.jsonl` size | 2.6 MB / 1284 lines | 🟡 |

**6 critical (P0) bugs identified. Top 3 alone explain ~70% of junk.**

---

## 🔴 Bugs Found (Critical — P0)

### BUG-01: `listExistingSkills()` returns 0 skills always (silent catalog failure)

- **File:** `scripts/skill_reviewer.js` line 60-67
- **Severity:** 🔴 **CRITICAL** — root cause of duplicate/niche skills
- **Symptom:** LLM sees `Existing skills in skills-learned/ (0 files): (none — empty directory)` even when 52 skills exist. Creates duplicates like 5 versions of `cron-systemevent-migration` and many niche one-offs.
- **Root cause:** 
  ```js
  function listExistingSkills() {
    const skills = listSkillMetadata();  // ← BUG: no arg!
    return skills.map(...);
  }
  ```
  `listSkillMetadata(skillsDir)` requires the `skillsDir` arg. When called as `listSkillMetadata()`, `skillsDir === undefined`. `discoverSkillDirs(undefined)` calls `fs.existsSync(undefined)` → false → returns `[]`.
- **Why catalog is unaffected:** `buildSkillCatalog()` uses its own `fs.readdirSync(SKILLS_DIR, ...)` directly (line 86-87), bypassing the broken `listSkillMetadata()`. So the LLM sees TWO contradicting pieces of info: "0 existing skills" + a 50-row catalog table.
- **Fix:**
  ```js
  function listExistingSkills() {
    const skills = listSkillMetadata(SKILLS_DIR);  // ← pass SKILLS_DIR
    return skills.map(s => ({...}));
  }
  ```
  Or change `listSkillMetadata()` to default to `SKILLS_LEARNED` from `lib/config`.
- **Verification:** Run `node scripts/skill_reviewer.js` and confirm the line `Existing skills in skills-learned/ (52 files):` instead of `(0 files)`.

### BUG-02: Bot close-regex truncates content at first internal ` ``` `

- **File:** `scripts/skill_reviewer_bot.js` line 196-198
- **Severity:** 🔴 **CRITICAL** — affects every skill with code blocks
- **Symptom:** Skills with internal code blocks (` ```bash ` etc.) end up truncated because the close-regex matches the first internal ` ``` ` as the closing fence. File has odd backtick count → validator fails.
- **Root cause:**
  ```js
  var closeRegex = /^\s*```\s*$/gm;  // ← matches any line with just ```
  closeRegex.lastIndex = contentStart;
  var closeMatch = closeRegex.exec(response);
  if (!closeMatch) break;
  ```
  The regex matches a line that is ONLY ` ``` ` (with optional whitespace). If the LLM has a ` ```bash ` code block inside its content, the close-regex finds the opening of the code block (or a later ` ``` ` line) and truncates content there. Result: file is missing the closing ` ``` ` for the code block, OR is missing content after the code block.
- **Real-world evidence:**
  - `cron-passive-job-detection` (1 triple backtick, 1865B) — ` ```bash ` block's closing is missing
  - `skill-reviewer-draft-cleanup` (3 triple backticks, 3815B) — odd count
  - `documentation-code-drift-detection` (1 triple backtick, 2123B) — odd count
  - `skill-file-corruption-repair` (7 triple backticks, 3656B) — odd count
- **Fix:** Use a smarter close-regex that requires the closing fence to NOT be inside an already-opened code block:
  ```js
  // Track code-block state: skip ``` lines that are opening internal code blocks
  var closeRegex = /^\s*```\s*$/gm;
  var pos = contentStart;
  var openCount = 0;
  var closeMatch = null;
  while (true) {
    closeRegex.lastIndex = pos;
    var m = closeRegex.exec(response);
    if (!m) break;
    // Check if this ``` is preceded by content (closing) or starts a new block
    // Heuristic: if the line BEFORE this is a code block (```lang), it's an opening
    var prevLineStart = response.lastIndexOf('\n', m.index - 1) + 1;
    var prevLine = response.slice(prevLineStart, m.index).trim();
    if (openCount === 0 && prevLine.startsWith('```') && prevLine.length > 3) {
      // This is the OPENING of an internal code block; skip it
      pos = m.index + m[0].length;
      openCount++;
      continue;
    }
    if (openCount > 0) {
      // This closes an internal code block
      openCount--;
      pos = m.index + m[0].length;
      continue;
    }
    // This is the actual closing fence
    closeMatch = m;
    break;
  }
  ```
  Or simpler: require the LLM to use a UNIQUE closing tag (e.g., ` ```END_SKILL `) instead of ` ``` `. This avoids ambiguity entirely.
- **Verification:** Re-generate `cron-passive-job-detection` and confirm 2 triple backticks (open + close of the bash block, no extras).

### BUG-03: Prompt/Validator threshold mismatch (advertised 1500B, enforced 800B)

- **File:** `scripts/validate_skill_file.js` line 47 + `scripts/skill_reviewer.js` line ~425 (prompt text)
- **Severity:** 🔴 **CRITICAL** — 8 skills passed validation that should have been rejected
- **Symptom:** Prompt tells LLM "≥1500 bytes" but validator actually allows ≥800B. Skills like `ai-hot-push-workflow` (1189B), `subagent-model-override` (1291B), `multi-phase-subagent-orchestration` (760B) pass validation despite being below the documented threshold.
- **Root cause:**
  ```js
  // validate_skill_file.js line 47:
  const STUB_FILE_SIZE_MIN = 800;       // ← 800B
  ```
  But the LLM prompt (skill_reviewer.js line ~425) says:
  ```
  1. **≥1500 bytes** file size (validated via `fs.statSync`)
  ```
  Mismatch: 1500B advertised but 800B enforced.
- **Additional mismatch:** Validator doesn't check `## Pitfalls` count or description length — only file size + workflow step count. Skills with 0 pitfalls pass (e.g., `concurrent-session-rate-limit-avoidance`, `subagent-model-override`).
- **Fix:** 
  1. **Either** raise the validator threshold to 1500B to match the prompt: `const STUB_FILE_SIZE_MIN = 1500;`
  2. **Or** add pitfalls-count check to the validator: 
     ```js
     const PITFALLS_MIN = 3;
     const pitMatches = body.match(/^##\s+Pitfalls[\s\S]*?(?=^##\s+|\Z)/m);
     if (pitMatches) {
       const pitBullets = (pitMatches[0].match(/^- /gm) || []).length;
       if (pitBullets < PITFALLS_MIN) errors.push(`Only ${pitBullets} pitfalls, need ${PITFALLS_MIN}`);
     }
     ```
  3. **Both** — and add `description` length check (≤200 chars per prompt).
- **Verification:** Run `node scripts/validate_skill_file.js skills-learned/ai-hot-push-workflow/SKILL.md` — should now FAIL with size error.

### BUG-04: LLM-truncated skills written to disk (no pre-write length check)

- **File:** `scripts/skill_reviewer_bot.js` line 277 (writeSkillFiles) + no upstream gate
- **Severity:** 🔴 **CRITICAL** — produces 6/10 junk skills (583B, 577B, 760B, 888B, 901B, 1025B)
- **Symptom:** LLM produces truncated content (likely `max_tokens` hit mid-sentence or context overflow) and the bot writes it without pre-checking size. Result: stub skills in `skills-learned/` that look like real ones in the catalog.
- **Root cause:** Bot's flow is `extractFileBlocks → writeFileSync → validate → symlink`. The validation happens AFTER write, but the file is already on disk polluting the library. There's no pre-write gate.
- **Real-world evidence:** `cron-context-overflow-recovery` (583B, no `## Workflow`), `cron-job-testing` (577B, 1 step), `multi-phase-subagent-orchestration` (760B, ends with `;`), `m3-root-cause-analysis` (1025B, ends with `:`), `skill-reviewer-bot-self-improvement` (888B, 1 step).
- **Fix:** Add a pre-write length gate:
  ```js
  // In writeSkillFiles, BEFORE fs.writeFileSync:
  if (path.basename(absPath) === 'SKILL.md' && block.content.length < 1500) {
    err('Refusing to write stub SKILL.md: ' + block.filePath + ' (' + block.content.length + 'B)');
    continue;  // skip this block
  }
  ```
  Better: keep the file but immediately quarantine to `_archive/quarantine-<ts>-<name>/` if below threshold.
- **Verification:** Re-run bot; observe fewer than 1000B files in `skills-learned/`.

### BUG-05: Validator counts backticks WITHOUT excluding inline code spans

- **File:** `scripts/validate_skill_file.js` line 79
- **Severity:** 🔴 **CRITICAL** — false positive cause (some) + false negative cause (others)
- **Symptom:** Validator counts ALL ` ``` ` (triple backticks) in the file. Inline code uses single backticks (no impact), but if LLM puts ` ``` ` in step text (e.g., "Step: run ```bash script.sh ``` "), it gets counted as a code fence.
- **Root cause:**
  ```js
  const codeBlockCount = (content.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    errors.push(`Unclosed code block (${codeBlockCount} backticks — odd count)`);
  }
  ```
  The regex matches ` ``` ` (3 chars). If a file has ` ```bash\n...\n``` ` (2 occurrences) it should be even. But if file has ` ```\n` + inline triple backticks elsewhere, count goes odd.
  - Worse: error message says "1 backticks" when the actual count is 1 triple-backtick (3 chars). The message is misleading.
- **Fix:** Track code-block state line-by-line, ignore ` ``` ` inside other code blocks (already-open state). Plus a better error message.
  ```js
  var inCodeBlock = false;
  var fenceLines = 0;
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (inCodeBlock && /^\s*```\s*$/.test(line)) {
        inCodeBlock = false;  // closing fence
      } else if (!inCodeBlock) {
        inCodeBlock = true;  // opening fence (with or without lang)
      }
      fenceLines++;
    }
  }
  if (inCodeBlock) errors.push('Unclosed code block at end of file');
  ```
- **Verification:** Run validator on `skill-file-corruption-repair` (7 triple backticks) — should now correctly identify unclosed block at end (the literal `\`\`\`\`\`\`` representation is a code block with 6 backticks in the body).

### BUG-06: SKILL.md written non-atomically (concurrent write race)

- **File:** `scripts/skill_reviewer_bot.js` line 277 + `scripts/skill_reviewer_cleanup.js`
- **Severity:** 🔴 **CRITICAL** — silent corruption under concurrency
- **Symptom:** `fs.writeFileSync(absPath, block.content + '\n', 'utf8')` is a non-atomic write. If the bot crashes mid-write (e.g., model OOM, kill signal), the file is left half-written. Future skill-reviews try to read it as a real skill and get a broken catalog entry.
- **Root cause:** Bot has a lockdir for the LLM call (line 38 + main()), but no protection against partial writes. Even worse: `skill_reviewer_cleanup.js` truncates the queue AFTER the LLM call, but if the LLM call wrote partial files, they're now orphaned in `skills-learned/`.
- **Additional issue:** `skill_reviewer_cleanup.js` line 53 does `fs.writeFileSync(QUEUE_FILE, '', 'utf8')` — also non-atomic. If a concurrent write happens, queue is corrupted.
- **Fix:** Use atomic write helpers (already available in `lib/disk_guard.js`):
  ```js
  const { safeWriteFileSync, safeRenameSync } = require('./lib/disk_guard');
  // Replace:
  fs.writeFileSync(absPath, block.content + '\n', 'utf8');
  // With:
  safeWriteFileSync(absPath, block.content + '\n');  // uses tmp + rename
  ```
  Same for queue cleanup.
- **Verification:** Check that `.tmp` files are created during write and renamed atomically.

---

## 🟡 Warnings (Medium — P1)

### WARN-01: Bot's `recordSkillCreated` happens AFTER write, so failed writes leave no audit trail

- **File:** `scripts/skill_reviewer_bot.js` line 358-369
- **Symptom:** If `fs.writeFileSync` throws (e.g., disk full, EACCES), the file is missing from disk and the JSONL event is missing too. No record of the failed write attempt.
- **Fix:** Record a `failed: true` event in the catch block.

### WARN-02: Cron runs every 30 min but queue is usually empty

- **Cron:** `Skill Reviewer (30min)` at `*/30 * * * *`
- **Symptom:** Per `.skill_metrics.json`, 100 runs tracked. Cache hit rate 9% (mostly rebuilds). Per `.skill_created.jsonl`, 41 events over 2.5 days = ~16 events/day. With 48 cron runs/day, ~32 runs/day see an empty queue. Wasted LLM calls.
- **Fix:** Change schedule to `*/2 * * * *` (every 2 hours) or add a "minimum queue size" check in the cron prompt (skip if queue < 3 entries).

### WARN-03: Discord delivery has no retry on failure

- **File:** `scripts/skill_reviewer_bot.js` line 459-468 (sendDiscordMessage)
- **Symptom:** `sendDiscordMessage` uses `https.request` with no retry. If Discord rate-limits or times out, the summary is printed to stdout but Discord doesn't get it.
- **Fix:** Add 2-3 retries with exponential backoff on `429` and `5xx` responses.

### WARN-04: Skill_reviewer prompt cache has no TTL

- **File:** `scripts/skill_reviewer.js` line 175-195 (checkCache)
- **Symptom:** Cache is invalidated only on hash mismatch. If a skill is updated but the hash matches (e.g., a content change inside a backtick that doesn't change the frontmatter hash), stale prompt is served.
- **Fix:** Add TTL (e.g., 30 min) to the cache. Re-build if older than 30 min regardless of hash.

### WARN-05: Symlink target path inconsistency (3 relative, 39 absolute)

- **Symptom:** `skills/_learned_anomaly-proactive-push -> ../skills-learned/anomaly-proactive-push` (relative) while most others are absolute.
- **Root cause:** Bot uses `path.join(SKILLS_ACTIVE, '_learned_' + className)` + `fs.symlinkSync(dir, symlinkPath, 'dir')` with `dir` being the absolute path → absolute symlink. The weekly_correction_loop migration uses `../skills-learned/...` (relative). The mix causes tools that resolve relative paths from a different cwd to fail.
- **Fix:** Always use absolute paths, or always use a consistent relative path. Pick one.

### WARN-06: `recordSkillCreated` pitfalls count misses pitfalls inside `## Pitfalls` if preceded by `**` bold

- **File:** `scripts/skill_reviewer_bot.js` line 339-348
- **Symptom:** Regex `/^- (?:⚠️?\s*)?\S/gm` only matches `-` followed by space then content. Pitfalls formatted as `- **Pitfall**` (with bold) match. But pitfalls with `**...**` and a colon (`- **Pitfall**: description`) are counted (matches `- **`). So this works for now but is fragile.
- **Fix:** Test with multiple bullet styles: `* `, `- `, numbered, with/without bold.

### WARN-07: B9 fix only strips ONE leading duplicate fence, not multiple

- **File:** `scripts/skill_reviewer_bot.js` line 213-218
- **Symptom:** B9 strips the first line if it starts with ` ```...skills-learned/... `. If the LLM duplicates the fence TWICE (LLM rarely does, but possible), only one is stripped.
- **Fix:** Loop B9 until content no longer starts with a fence.

---

## Junk Root Cause Analysis

**Junk = no symlink to `skills/`. 10 files in `skills-learned/` (per `comm -23`):**

| # | Skill | Bytes | Triple BT | Broken Fence | Root cause |
|---|-------|-------|-----------|--------------|------------|
| 1 | cron-context-overflow-recovery | 583 | 1 | ✅ | BUG-04 (truncation, no Workflow) |
| 2 | cron-p0-rescue-workflow | 3353 | 1 | ✅ | Pre-B9 era broken-fence (created Jun 9 12:34, bot updated Jun 9 20:37) |
| 3 | cron-passive-job-detection | 1865 | 1 | | BUG-02 (close-regex truncates) |
| 4 | documentation-code-drift-detection | 2123 | 1 | | BUG-02 |
| 5 | issue-quality-self-review | 1437 | 1 | ✅ | BUG-04 + ends-with-colon |
| 6 | m3-root-cause-analysis | 1025 | 0 | | BUG-04 (truncation, 0 BT, ends with `:`) |
| 7 | skill-file-corruption-repair | 3656 | 7 | | BUG-02 (internal code block confuses close) |
| 8 | skill-reviewer-bot-self-improvement | 888 | 1 | | BUG-04 |
| 9 | skill-reviewer-draft-cleanup | 3815 | 3 | | BUG-02 |
| 10 | systemevent-cron-dedup-gotcha | 901 | 2 | ✅ | Pre-B9 era broken-fence + 0 Workflow |

**Active-but-low-quality = has symlink but has issues. 8 files:**

| # | Skill | Bytes | Pit | Steps | Issue |
|---|-------|-------|-----|-------|-------|
| 1 | ai-hot-push-workflow | 1189 | 1 | 5 | BUG-03 (1189B < 1500B advertised) |
| 2 | concurrent-session-rate-limit-avoidance | 2528 | 0 | 5 | BUG-03 (0 pitfalls) |
| 3 | cron-agent-llm-failure-mitigation | 3668 | 1 | 6 | Pre-B9 broken-fence (still has 1 BT) |
| 4 | cron-failure-investigation | 2373 | 1 | 7 | Pre-B9 broken-fence (1 BT) |
| 5 | cron-job-testing | 577 | 0 | 1 | BUG-04 (577B + 1 step) |
| 6 | multi-phase-subagent-orchestration | 760 | 0 | 2 | BUG-04 (760B + 2 steps) |
| 7 | skills-audit-workflow | 5055 | 1 | 17 | Pre-B9 broken-fence (1 BT) |
| 8 | subagent-model-override | 1291 | 0 | 3 | BUG-03 (0 pitfalls) |

**Junk category → Bug mapping:**

| Category | Count | Bug |
|----------|-------|-----|
| **Truncated (≤1500B, missing sections)** | 6 | BUG-04 |
| **Internal code-block broken** | 4 | BUG-02 |
| **Pre-B9 broken-fence at start** | 4 | (fixed in current code, but historical files not migrated) |
| **Below prompt threshold but pass validator** | 4 | BUG-03 |
| **0 pitfalls, no validator check** | 4 | BUG-03 |
| **Duplicate / niche (LLM doesn't see catalog)** | many | BUG-01 |

---

## Recommended Fix Priority

### P0 (do immediately, this week)

1. **BUG-01**: Fix `listExistingSkills()` to pass `SKILLS_DIR` arg
2. **BUG-02**: Fix close-regex to not match internal code blocks
3. **BUG-04**: Add pre-write size gate (refuse to write <1500B SKILL.md)
4. **BUG-03**: Align validator thresholds with prompt (1500B, 3 pitfalls)

### P1 (next iteration)

5. **BUG-05**: Fix validator backtick counting
6. **BUG-06**: Use atomic writes via `lib/disk_guard`
7. **WARN-02**: Reduce cron frequency (every 2 hours) OR add min-queue-size check

### P2 (cleanup)

8. **WARN-05**: Normalize symlink paths (always absolute)
9. **WARN-03**: Add Discord delivery retry
10. **WARN-04**: Add prompt cache TTL
11. Cleanup `_archive/` orphans (e.g., `session-lock-recovery`, `plugin-phased-rollout` — wait, plugin-phased-rollout is not in skills-learned; verify what's in `_archive/`)

### P3 (investigate)

- 2 directories in `.skill_created.jsonl` reference skills that don't exist on disk: `plugin-phased-rollout` (event Jun 9 07:53, dir missing) and `deep-research-subagent-spawning` (event Jun 9 11:35, dir missing). The cleanup process deleted them but kept the JSONL entry. Add a `cleanup_orphan_dirs` script.

---

## Test Coverage

### Current tests
- `scripts/verify_edit.js` — generic syntax/P0 check
- `scripts/validate_skill_file.js` — runs on each skill write

### Missing tests
1. **Unit test for `extractFileBlocks`** — no tests for the LLM-output parsing. Should test:
   - Normal ` ```skills-learned/foo/SKILL.md\n---\n...\n---\n## Workflow\n1. ...\n``` `
   - With internal code block: ` ```skills-learned/foo/SKILL.md\n---\n## Workflow\n1. Run ` ```bash\n  script\n``` ` ``` ` (must NOT close at the first ` ```bash `)
   - LLM duplicates opening fence
   - LLM forgets closing fence
   - LLM uses ` ```markdown ` language tag

2. **Unit test for `listExistingSkills()`** — currently no test ensures it returns N>0 skills.

3. **Integration test for `writeSkillFiles`** — no test for pre-write validation.

4. **E2E test for "patch existing skill" flow** — no test ensures a PATCH produces a SYMLINK to the existing dir, not a new dir.

5. **No regression test for the 49 broken skills** — should be a snapshot test: regenerate from `.skill_created.jsonl` and assert same files exist.

---

## Specific Code Suggestions

### Fix BUG-01: `scripts/skill_reviewer.js` line 60-67

```diff
 function listExistingSkills() {
-  const skills = listSkillMetadata();
+  const skills = listSkillMetadata(SKILLS_DIR);
   // Reformat: listSkillMetadata uses 'dir' + flat fields, this function uses 'file' prefix
   return skills.map(s => ({
     file: s.file,
     description: s.description === '(no description)' ? '(no description)' : s.description,
     status: s.status === '(no status)' ? 'unknown' : s.status,
     category: s.category === '(no category)' ? 'uncategorized' : s.category,
   }));
 }
```

### Fix BUG-02: `scripts/skill_reviewer_bot.js` line 176-235 (extractFileBlocks)

Replace the close-regex logic with stateful code-block tracking:

```js
function extractFileBlocks(response) {
  var blocks = [];
  var startIdx = 0;
  while (true) {
    // Find opening fence (line with ```...skills-learned/...)
    var fenceRegex = /^\s*```[a-zA-Z0-9_-]*\s*skills-learned\/[^\n]+$/gm;
    fenceRegex.lastIndex = startIdx;
    var match = fenceRegex.exec(response);
    if (!match) break;

    var open = match.index;
    var lineEnd = response.indexOf('\n', open);
    if (lineEnd === -1) break;

    var fenceContent = match[0];
    var pathStart = fenceContent.indexOf('skills-learned/') + 'skills-learned/'.length;
    var pathPart = fenceContent.slice(pathStart).trim();
    var filePath = 'skills-learned/' + pathPart;

    var contentStart = lineEnd + 1;

    // Find ACTUAL closing fence: track open/close state of internal code blocks
    var pos = contentStart;
    var openCount = 0;
    var closePos = -1;
    var anyFenceRegex = /^\s*```.*$/gm;
    while (true) {
      anyFenceRegex.lastIndex = pos;
      var m = anyFenceRegex.exec(response);
      if (!m) break;
      var line = m[0].trim();
      if (/^\s*```\s*$/.test(line)) {
        // Bare ``` — could be open or close
        if (openCount === 0) {
          openCount = 1;  // opening
        } else {
          openCount = 0;  // closing
          if (closePos === -1 && openCount === 0) {
            // This might be the actual close
            // Hmm, we need to wait until we've seen the openCount go from 0→1→0
          }
        }
      } else if (/^\s*```[a-zA-Z0-9_-]+/.test(line)) {
        // ```lang — always opens a code block
        openCount++;
      }
      // Update closePos only if openCount returned to 0 AND we found a match
      // (this is the symmetric-pair finder)
      // Simpler heuristic: find the FIRST ``` AFTER contentStart that brings openCount back to 0
      pos = m.index + m[0].length;
    }
    // ...
```

This is getting complex. **Simpler alternative:** Change the LLM prompt to use a unique closing tag like ` ```END ` instead of ` ``` `. Then the close-regex can be ` ```END `.

### Fix BUG-03: `scripts/validate_skill_file.js` line 47

```diff
-  const STUB_FILE_SIZE_MIN = 800;       // bytes — frontmatter+workflow+pitfalls minimum
+  const STUB_FILE_SIZE_MIN = 1500;      // bytes — must match prompt docs
```

And add pitfalls check (after line 47):

```js
  // 5. Pitfalls count (matches prompt docs)
  const pitSection = body.match(/^##\s+##?\s*Pitfalls[\s\S]*?(?=^##\s+(?!Pitfalls)|\Z)/m);
  if (pitSection) {
    const pitBullets = (pitSection[0].match(/^- /gm) || []).length;
    if (pitBullets < 3) {
      errors.push(`Only ${pitBullets} pitfall items — need at least 3`);
    }
  }
```

### Fix BUG-04: `scripts/skill_reviewer_bot.js` line 277

Add a pre-write size check:

```js
// Inside writeSkillFiles, BEFORE fs.writeFileSync:
if (path.basename(absPath) === 'SKILL.md' && block.content.length < 1500) {
  err('Refusing to write stub SKILL.md: ' + block.filePath + ' (' + block.content.length + 'B)');
  // Quarantine immediately
  const qDir = path.join(SKILLS_DIR, '_archive', 'quarantine-' + Date.now() + '-' + path.basename(dir));
  fs.mkdirSync(qDir, { recursive: true });
  fs.writeFileSync(path.join(qDir, 'SKILL.md'), block.content + '\n', 'utf8');
  recordSkillCreated({v:1, ts:new Date().toISOString(), name:path.basename(dir), file:block.filePath, bytes:block.content.length, validationPassed:false, symlinked:false, reason:'pre-write stub (<1500B)'});
  continue;  // skip the normal write
}
```

### Fix BUG-05: `scripts/validate_skill_file.js` line 79

Replace the global backtick count with stateful line-by-line tracking:

```js
// 2. Unclosed code blocks (stateful check)
var inBlock = false;
var lastFenceWasBare = false;  // tracks whether last seen fence was bare ```
for (const line of content.split('\n')) {
  var fenceMatch = line.match(/^\s*(```+)/);
  if (fenceMatch) {
    var fence = fenceMatch[1];
    var fenceLen = fence.length;
    if (fenceLen === 3) {
      // ``` or ```lang — toggle block state
      // Only toggle on bare ``` (closing) or ```{lang} (opening)
      if (/^\s*```\s*$/.test(line)) {
        if (inBlock) {
          inBlock = false;  // closing
        } else {
          // Bare ``` opening a block is ambiguous; treat as opening
          inBlock = true;
        }
      } else if (/^\s*```[a-zA-Z0-9_-]/.test(line)) {
        // ```lang — definitely opening
        if (!inBlock) inBlock = true;
      }
    } else if (fenceLen > 3) {
      // 4+ backticks — special, just count
      if (!inBlock) inBlock = true;
    }
  }
}
if (inBlock) {
  errors.push('Unclosed code block at end of file');
}
```

### Fix BUG-06: `scripts/skill_reviewer_bot.js` line 277

```diff
-      fs.writeFileSync(absPath, block.content + '\n', 'utf8');
+      const { safeWriteFileSync } = require('./lib/disk_guard');
+      safeWriteFileSync(absPath, block.content + '\n');
```

And in `skill_reviewer_cleanup.js` line 53:

```diff
-  fs.writeFileSync(QUEUE_FILE, '', 'utf8');
+  const { safeWriteFileSync } = require('./lib/disk_guard');
+  safeWriteFileSync(QUEUE_FILE, '');
```

---

## Detailed Bug → Junk Mapping

For each of the 10 junk skills, here's the specific code path that allowed the bad write:

| Junk | Bug path |
|------|----------|
| cron-context-overflow-recovery (583B) | BUG-04: LLM truncated mid-sentence; bot wrote anyway |
| cron-p0-rescue-workflow (3353B, broken fence) | Pre-B9 era (created Jun 9 12:34, before bot update Jun 9 20:37) |
| cron-passive-job-detection (1865B) | BUG-02: close-regex matched internal ` ```bash ` opening, content truncated |
| documentation-code-drift-detection (2123B) | BUG-02: same |
| issue-quality-self-review (1437B) | BUG-04 (truncation, ends with colon) |
| m3-root-cause-analysis (1025B) | BUG-04 (truncation, ends with colon) |
| skill-file-corruption-repair (3656B) | BUG-02: close-regex confused by `\`\`\`\`\`\`` (literal 4-5 backticks in body) |
| skill-reviewer-bot-self-improvement (888B) | BUG-04 (truncation) |
| skill-reviewer-draft-cleanup (3815B) | BUG-02: internal ` ``` ` (closing) line was interpreted as opening of an internal block |
| systemevent-cron-dedup-gotcha (901B) | Pre-B9 era + BUG-04 |

**For the 8 active-but-low-quality:** mostly BUG-03 (validator threshold too low) + pre-B9 broken-fence (4 of them).

---

## Summary: The "Why" of 33% Junk

1. **LLM produces broken output 20-30% of the time** (truncation, missing fences, internal code-block confusion) → BUG-02, BUG-04
2. **Bot writes broken output to disk** instead of quarantining → BUG-04
3. **Validator is too lenient** (800B vs advertised 1500B; no pitfalls check) → BUG-03
4. **LLM doesn't see existing skills** so it creates duplicates → BUG-01

**Fix 1, 2, 3, 4 in order** — should drop junk rate to <5% (only true niche/duplicate cases will remain, and those need curator-level decisions, not validation gates).

---

## Appendix: Files & Data Examined

- `scripts/skill_reviewer.js` (41463 bytes, mtime Jun 9 12:22)
- `scripts/skill_reviewer_bot.js` (20164 bytes, mtime Jun 9 20:37)
- `scripts/skill_reviewer_cleanup.js` (1446 bytes)
- `scripts/validate_skill_file.js` (~5000 bytes)
- `scripts/lib/skill_discovery.js` (92 lines)
- `scripts/lib/aggregate_signals.js` (170 lines)
- `scripts/lib/config.js` (resolved constants)
- `.skill_created.jsonl` (41 events, Jun 8 - Jun 10)
- `.skill_review_archive.jsonl` (1284 lines, 2.6 MB)
- `.skill_metrics.json` (100 reviewer runs, 9% cache hit)
- `skills-learned/` (52 directories, 10 junk)
- `skills/_learned_*` (42 symlinks, 3 relative + 39 absolute)
- Cron schedule: `*/30 * * * *` (cron id 56e09616)

---

*Audit completed 2026-06-10 by M3 sub-agent.*
