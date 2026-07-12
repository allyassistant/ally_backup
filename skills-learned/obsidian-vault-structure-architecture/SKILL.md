---
name: obsidian-vault-structure-architecture
description: "Organize an Obsidian vault into three layers: Knowledge (categories), 03-Output (timeline), and MOCs (topic navigation). Use when: setting up a new vault, restructuring notes across categories, or adding MOC topic maps. Key capabilities: 3-layer taxonomy, knowledge/timeline/topic navigation, MOC linking, category-based filing."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-16T19:30:00.000Z
---

## Workflow

1. **Identify the note's primary dimension** — Is the reader looking by category (AI/Tech/Business), by date (timeline of learning), or by topic (cross-cutting MOC)? This determines the target layer.

2. **Write full content to Knowledge/<Category>/<Title>.md** — Include complete frontmatter (tags, links, category, source), `## 相關概念` cross-links, and `## 啟發` insight analysis. This is the primary knowledge store, organized by category folder (AI / Business / Tech / Concepts).

3. **Write lightweight metadata index to 03-Output/YYYY-MM/YYYY-MM-DD-type-slug.md** — Frontmatter only: title, date, source, tags, type. No cross-links or insight analysis. The body contains only a wikilink `📎 [[Title]]` pointing to the Knowledge/ version. Use `write_to_obsidian.js` which handles both layers automatically.

4. **Update or create MOCs/ topic maps when a note bridges categories** — If a note spans AI and Business, add it to existing MOCs or create a new MOC in `MOCs/` with heading-linked entries. MOCs are the third navigation axis: topic-based rather than category- or date-based.

5. **Verify completeness after vault operations** — After restore or migration, check all three layers are intact: `Knowledge/` has category folders with full notes, `03-Output/` has date-indexed files, `MOCs/` has at least one navigation overview.

6. **Propose changes to 03-Output format only with user confirmation** — Never convert 03-Output to metadata-only without explicit user agreement. The current design (full body in Knowledge/, lightweight in 03-Output/) is user-approved. Changes require `write_to_obsidian.js` line 221 modification.

## Pitfalls

- ⚠️ Writing full content to both Knowledge/ and 03-Output/ creates duplication — 03-Output/ should be a pure index, not a knowledge store. Avoid converting it accidentally to full-content format.
- ⚠️ Deleting 03-Output/ thinking it's redundant — it serves the unique function of date-based scanning ("what did I write today"), which Knowledge/ category folders cannot provide.
- ⚠️ Creating duplicate MOCs when topic maps already exist — always scan `MOCs/` directory before creating a new one. Six MOCs is the current baseline (5 topic-specific + 1 Wiki 知識庫總覽).
- ⚠️ Modifying `write_to_obsidian.js` without verifying cron scripts that depend on 03-Output/ — `connection_surface.js` (active Sun 09:00 cron) writes to 03-Output/ and assumes the folder exists.
- ⚠️ Treating the three layers as alternatives rather than complements — they serve three different search axes (category, date, topic) and are designed to coexist, not replace each other.
