# Issue #118: Daily Synthesis System — L2 Logger Fix + Thinking Partner Contract

**Priority:** P0
**Created:** 2026-05-28
**Due:** 2026-05-29 (first run)
**Status:** Setup complete, awaiting first run

---

## Background

From the discussion around Dami-Defi's article "I Connected Claude to My Obsidian Vault", we identified the need for a Daily Synthesis system that scans recent activity and produces 4 sections: Connections / Patterns / Contradictions / Open Questions.

This required fixing the L2 memory logger (which was only capturing system noise) and establishing a Thinking Partner Contract for output quality.

---

## What Was Done

### 1. L2 Logger Fix (`log_to_daily_memory.js`)

**Problem:** L2 memory was capturing system logs (CQM scans, cron outputs) instead of real conversation content.

**Changes:**
- CONFIG: `TAIL_LINES` 50→300, `MAX_MESSAGES_TO_LOG` 5→30, `MAX_CONTENT_PREVIEW` 150→300
- SKIP_PATTERNS: Removed ~40 aggressive filters that were catching real conversation (e.g. "讓我", "等陣", "等我", "Let me add", "Let me check")
- Added **position tracking** (`.session_positions.json`): tracks byte position per session file, only reads new content on each cron run
- Removed double-read of `.trajectory.jsonl` files (filtered out alongside `.deleted.` files)

**Bugs Fixed:**
- Saved position BEFORE content processing (could lose data on crash) → moved AFTER
- Assistant message bracket format was malformed (`[content` → `[] content`)
- Removed dead code: `POSITION_READY`, `channelMap`, old `getLastLoggedTimestamp` functions

**Result:** Last test captured 30 real conversation messages vs original 5 system messages.

### 2. Daily Synthesis Cron Job

- Cron: Daily 08:00 HKT, triggers Ally via system event
- Scope: Scan new content (not re-scan all 3 days), compare with previous synthesis
- Progressive dedup format: Yesterday's continuation (brief) + Today's new (detailed) + Resolved items
- Output: Written to Obsidian daily synthesis note + Discord #🎓學習

**First run:** 2026-05-29 08:00 HKT

### 3. AGENTS.md Restructure

Cleaned up from 472 lines to 252 lines with clearer grouping:

| Section | Before | After |
|---------|--------|-------|
| X link format | Split across sections | Fixed, dedup removed |
| Pipeline architecture table | Present | Removed (unused) |
| Kimi CLI | Own section (8 lines) | Decision Tree footnote |
| Auto check | Own section | Removed (Decision Tree covers) |
| HA rules / Performance / Testing | Present | Removed (not behavior rules) |
| **Thinking Partner Contract** | **Didn't exist** | **Added** |

### 4. Thinking Partner Contract

New section in AGENTS.md based on Dami-Defi's CLAUDE.md concept:

4 core principles:
1. Never summarise. Always synthesise. (traceable to specific source)
2. Challenge, don't just confirm.
3. Surface contradictions without judgment.
4. Flag uncertainty explicitly.

### 5. Note Type System

Added `--type` parameter to `write_to_obsidian.js`:
- Valid types: observation, reaction, pattern, question, number, reference
- Appears in frontmatter `type:` field
- 5 existing notes backfilled

---

## What's Pending

- [ ] **First Daily Synthesis run**: 2026-05-29 08:00 HKT
- [ ] **Telegram bot for quick capture** (3-second forward → auto Obsidian)
- [ ] **Whisper voice → inbox** (speak idea → auto transcribe → vault)
- [ ] **Readwise sync** (newsletter highlights auto-import)
- [ ] **Weekly deep connection session** (Sunday 30-day scan — date TBD)

---

## Related Links

- Obsidian: `Knowledge/Tech/I Connected Claude to My Obsidian Vault — Dami-Defi.md`
- Script: `scripts/log_to_daily_memory.js`
- Config: `AGENTS.md → Thinking Partner Contract`
- Script: `scripts/write_to_obsidian.js` (new `--type` parameter)
- Cron: `3c11c009-ac02-4ead-8b61-646af5e46408`
