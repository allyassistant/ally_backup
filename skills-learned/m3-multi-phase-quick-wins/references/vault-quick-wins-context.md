# Obsidian Vault Quick Wins — Reference Context

This reference documents the specific facts established during the 2026-07-09
Obsidian vault quick wins session. These are domain facts, not reusable
workflow — they belong in a reference doc, not the SKILL.md.

## Vault Structure (as of 2026-07-09)

| Folder | Count | Notes |
|--------|-------|-------|
| Knowledge/AI/ | 147 | agents, models, frameworks, prompts |
| Knowledge/Tech/ | 90 | tools, Obsidian workflows, hardware |
| Knowledge/Business/ | 39 | HK 商業, AI 變現, side hustles |
| Knowledge/Concepts/ | 28 | Loop Engineering, 2nd brain, mindset |
| Knowledge/Diamond/ | 0 | ⚠️ folder did not exist (drift) — created in QW-3 |
| MOCs/ | 6 | AI Agent, Loop Engineering, Business, Obsidian, Tech, Wiki |
| Daily/ | 31 | auto-written by daily_synthesis.js |
| 03-Output/ | 2 months | auto-written by general_topic_analysis.js |
| Templates/ | 0 | empty before QW-5 |

## Quick Wins Delivered (2026-07-09)

| # | Item | File/Script | Status |
|---|------|-------------|--------|
| QW-1 | Navigation hub | 00-Index.md | ✅ Done |
| QW-2 | Instruction manual | .ally.md | ✅ Done |
| QW-3 | Drift fixes | mkdir Diamond + orphan reclassification | ✅ Done |
| QW-4 | Index refresh script | scripts/vault_index_refresh.js | ✅ Done |
| QW-5 | Note template | Templates/Note.md | ✅ Done |

## Drift Issues Found by Audit

| Issue | Root Cause | Fix Applied |
|-------|-----------|-------------|
| Knowledge/Diamond/ missing | CATEGORY_FOLDERS mapped Diamond but folder not created | mkdir + .gitkeep |
| Orphan notes in vault root | Files added without categorization | Moved to Knowledge/Tech, Knowledge/Concepts, Knowledge/AI |
| Templates/ empty | No template existed | Created Templates/Note.md |
| .ally.md stale drift claims | Written before QW-3/QW-4 done | Updated §1 table + §8 heading |
| HEARTBEAT.md missing cron entry | Script created but not scheduled | Added Vault Index Refresh row |

## Key Source Files (do not modify)

- `scripts/write_to_obsidian.js` — canonical note writer, CATEGORY_FOLDERS enum source
- `scripts/vault_index_refresh.js` — auto-refresh script for 00-Index.md
- `~/.openclaw/workspace/SOUL.md` — Ally identity rules
- `~/.openclaw/workspace/AGENTS.md` — spawn / encoding / output rules
- `~/Documents/Obsidian Vault/.ally.md` — vault SOP (Ally instruction manual)
- `~/Documents/Obsidian Vault/00-Index.md` — navigation hub

## Index Refresh Script Spec

- **Schedule:** `0 3 * * *` (03:00 HKT daily)
- **Session:** isolated
- **Markers:** `<!-- BEGIN auto-refresh:recent -->` … `<!-- END auto-refresh:recent -->`
- **Logic:** scan Knowledge/*, MOCs/, Daily/ for files modified in last 7 days; inject Dataview table
- **Flags:** `--dry-run`, `--days N`, `--vault PATH`, `--help`
