---
id: 133
title: Skill Self-Learning — Hermes-style background review (rewrite)
status: archive
priority: P2
created: 2026-06-06
due: 2026-06-27
updated: 2026-07-12
progress: 8/9
---

## Description

OpenClaw skill self-learning system. Migrated from hash-based tool-sequence detection to Hermes-style background review (Jun 6, 2026).

## Current Architecture

```
agent_end (skill-learner plugin) → queue (.jsonl)
    ↓
skill_reviewer.js (cron 56e09616, every 30 min) → prompt with cache
    ↓
Cron LLM (M3 + deepseek fallback) → edits skills-learned/ + runs cleanup
    ↓
skill_reviewer_cleanup.js → archive + truncate queue
    ↓
weekly_correction_loop.js (Sun 03:00) / mini-curator (daily 02:00)
    ↓
skills/  ← symlinks to skills-learned/ (via _learned_<name>)
```

### Shared libs (Issue #133 refactor)
- `scripts/lib/config.js` — WS + 7 skill path constants
- `scripts/lib/frontmatter.js` — parseFrontmatter / extractField / serializeFrontmatter
- `scripts/lib/skill_discovery.js` — listSkillDirs / listSkillMetadata / listCategorizedSkills
- `scripts/lib/path_safety.js` — isPathWithin / resolveSafePath / isSafeSupportPath

---

## ✅ Completed (8/9)

### 1. Deep Architecture Audit (2026-06-07) — 3 parallel sub-agents
- **Pipeline Integrity:** 27 pass / 6 warnings / 0 failures
- **Content Quality:** 9 skills classified (2 PROMOTE / 5 KEEP-FIX / 1 ARCHIVE)
- **Architecture:** Dead code, DRY violations, legacy cohabitation mapped

### 2. Safety Fixes
- Archive failure now `process.exit(1)` before truncating (prevent silent data loss)
- 4 skills had `provenance: agent` added (cron-job-testing, hermes-comparison-pattern, provider-response-sanitization, skill-curation-pattern)

### 3. Promotions
- `parallel-subagent-implementation` → active (status + symlink)
- `rapaport-email-summary` → active (status + symlink)

### 4. Archivals
- `hermes-comparison-pattern` → `skills-learned/_archive/` (was static reference disguised as skill)

### 5. Dead Code Cleanup
- `getRecentSignals()` + `SIGNAL_WINDOW` deleted from skill-learner/index.mjs
- `skills_manager.js` (568L) + `auto_skill_router.js` (397L) → `scripts/_legacy/`

### 6. Script Integration Refactor (4 DRY violations eliminated)
| New lib | Lines | Eliminates duplicates from |
|---------|-------|---------------------------|
| `lib/frontmatter.js` | 121 | 9+ inline regex copies across 5 files |
| `lib/skill_discovery.js` | 124 | 4+ readdirSync patterns across 5 files |
| `lib/path_safety.js` | 80 | 2 path sanitizers (skill-tools + umbrella_consolidation) |

**Files migrated:** skill_reviewer.js, skill_reviewer_cleanup.js, umbrella_consolidation.js, skill-learner/index.mjs, skill-tools/index.mjs
**Net reduction:** ~875 lines duplicated → 325 lines shared

### 7. Comprehensive Validation (30/30 tests)
| Layer | Tests | Status |
|-------|-------|--------|
| config.js (paths) | 3/3 | ✅ |
| frontmatter.js (parse/extract/serialize) | 5/5 | ✅ |
| skill_discovery.js (list/scan/categorize) | 4/4 | ✅ |
| path_safety.js (traversal guards) | 3/3 | ✅ |
| skill_reviewer.js (no inline DRY + live build) | 6/6 | ✅ |
| skill_reviewer_cleanup.js (paths + safety) | 3/3 | ✅ |
| ESM plugins (skill-learner + skill-tools) | 4/4 | ✅ |
| umbrella_consolidation.js (delegation) | 1/1 | ✅ |
| Backward compat (existing output shape) | 1/1 | ✅ |
| Content integrity (9 SKILL.md uncorrupted) | 1/1 | ✅ |

### 8. Minor Fixes During Audit
- Dead import `extractField` removed from skill_reviewer.js (imported but unused)
- `validatePathWithin` in skill-tools reduced to 3-line thin wrapper delegating to resolveSafePath
- Queue accidentally cleared by manual cleanup test → restored from backup

---

## ⏳ Remaining

### Step 9: Trim oversized skills
- `cron-job-testing` (17 steps, 9844b) — split core 8 steps + extract wakeMode/silent-push edge cases into references/
- `skill-curation-pattern` (16 steps, 8878b) — front half is reference material, back half is workflow; restructure

### Observation period
- Monitor pipeline until Jun 27 (due date)
- 7-day review one-shot: Jun 10-11
- Look for: false negatives (queue entries that should have triggered but didn't), archive quality

---

## Open questions
- Should the cron frequency adapt? (e.g. faster on weekdays, slower on weekends)
- Should there be a separate `skill_reviewer` for the `general` category to encourage class-level grouping?
- When M3 detects a previous skill is outdated, should it auto-archive instead of just patching?
