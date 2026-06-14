---
name: daily-synthesis
description: 每日跨系統學習合成 — 掃描 L2 memory + Obsidian 新 content，highlight 新 patterns/connections/contradictions，輸出 note + Discord message
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2025-01-15T00:00:00.000Z
---

## Workflow

1. **Scan L2 memory** — Read all files in `memory/` directory:
   - `memory/L2/` — raw conversation logs from last 24h
   - `memory/errors.json` — error patterns
   Focus on entries since last synthesis run (compare timestamps)

2. **Scan Obsidian vault** — Walk `~/Documents/Obsidian Vault/` directory:
   - Filter by mtime (files modified since last run)
   - Extract frontmatter `tags:` and `created:` metadata
   - Build a map of recent notes by topic cluster

3. **Cross-reference** — For each new L2 entry:
   - Search Obsidian for related notes (by tag or keyword overlap)
   - Check wiki/ for relevant pages
   - Flag any contradictions between new data and existing notes

4. **Synthesize** — Generate a synthesis note covering:
   - **New patterns**: recurring themes across recent conversations
   - **Connections**: non-obvious links between previously separate topics
   - **Contradictions**: new information that conflicts with existing knowledge
   - **Action items**: concrete next steps discovered during synthesis

5. **Write output** — Create `memory/L1/<date>-synthesis.md` with structured sections:
