---
name: webbridge-youtube-analysis
description: Analyze YouTube videos and web content via browser, write structured Obsidian notes, and post Discord summaries with graceful degradation.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-13T13:35:00.000Z
---

## Workflow

1. **Fetch content via browser** — Use the `browser` tool to navigate to the URL (YouTube, Twitter/X, blog post, or any public URL). If the page loads a SPA or requires interaction, use `focus` mode to wait for full content hydration.

2. **Extract structured information** — Scroll and extract the key facts: title, author, publication date, core argument or findings, and any numerical data or bullet points. For YouTube: also note timestamp segments, chapter markers, and thumbnail metadata. For Twitter threads: reconstruct thread continuity across paginated loads.

3. **Write Obsidian note** — Compose a structured note in `YYYY-MM-DD` datestamp format under the appropriate vault category. Use YAML frontmatter (`title`, `source`, `url`, `date`, `tags`). Include an `## Overview` summary paragraph, `## Key Points` as a bulleted list, and `## Context` for personal relevance. Save via `exec` using `fs.writeFileSync`.

4. **Post Discord summary** — Format a concise Discord message (max 500 chars, plain text preferred) with the source URL, a one-line takeaway, and a bullet list of key points. Use `exec` to call the Discord webhook via `curl` with JSON payload.

5. **Graceful degradation** — If `browser` tool is blocked or unavailable, fall back to `web_fetch`. If `web_fetch` also fails, output the Obsidian note content directly in the response and note that Discord delivery was skipped.

## Pitfalls

- ⚠️ Twitter/X threads paginate — a single scroll only fetches the first ~3-4 tweets; use focus mode or repeated scroll calls to capture full thread before summarizing.
- ⚠️ SPA pages (YouTube, Medium, Substack) load content via JavaScript after initial HTML — a single browser call may return empty body; wait for `focus` mode to hydrate before extracting.
- ⚠️ YouTube shorts and restricted videos may block browser scraping entirely — detect empty extraction and fall back to `web_fetch` or skip with a note.
- ⚠️ Discord webhook `curl` call with `--data-raw` must escape special characters in the message payload; use `jq` to construct the JSON or pipe through `printf '%s'` to avoid shell interpolation issues.
- ⚠️ Obsidian note path conflicts — if the same URL is processed twice, `writeFileSync` overwrites without warning; check existence first with `fs.existsSync` if idempotency matters.

## Context Notes

**Why Obsidian over plain notes:**
Obsidian's JSON node structure (especially in Canvas) is directly machine-readable. Canvas nodes store structured data that agents can parse without OCR — this makes spatial organization a form of structured feedback between human and agent.

**Research context (from @阿哲Phil analysis):**
- Canvas conversations average 34.1 minutes vs. 13 minutes for regular chat
- Chat is suitable for quick exchanges; Canvas is suitable for complex work organization and reflection
- Spatial manipulation (moving nodes) = implicit feedback, no need for long prompt corrections
