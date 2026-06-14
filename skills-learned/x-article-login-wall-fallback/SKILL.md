---
name: x-article-login-wall-fallback
description: Workflow for bypassing X.com article login walls with 6-layer fallback chain, then saving to Obsidian and posting Discord summary
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T04:53:00.000Z
---

## Workflow

1. **Open X article in browser** — Use `browser` tool to open the X post URL. Extract preview text visible without login. Note key data: views, likes, bookmarks, replies, publish date, author handle.

2. **Try clicking article link** — If the X post contains an external article link, click it. If it hits a login wall, proceed to fallback chain.

3. **Execute 6-layer fallback chain** in order:
   - **Layer 1**: Click article link directly (may work if browser has session)
   - **Layer 2**: Google search for "author name + article keywords" — look for mirrors on other domains
   - **Layer 3**: Check author's X profile for external website links (Substack, Medium, personal blog)
   - **Layer 4**: Check the author's linked publication (e.g., substack.com/@username, thexpin.com, medium.com/@username)
   - **Layer 5**: Search Medium/Substack specifically for article title keywords
   - **Layer 6**: Accept preview-only analysis if all layers fail

4. **Analyze article content** — From whatever source is accessible (full text or preview):
   - Identify the core argument/thesis
   - Note author background and relevance to our system
   - Extract key data points (views, engagement metrics)
   - Note connections to other articles/patterns we track

5. **Save to Obsidian** — Write a note under `X/` in Obsidian vault:
   - Frontmatter: date, author, URL, source platform
   - Body: author background, article summary, key points, relevance/connections

6. **Post Discord summary** with proper format:
   - **Header**: Author (@handle) — Article title
   - **Stats line**: N Views · N Likes · N Bookmarks · N Replies · Date
   - **Author bio**: Brief background (1-2 sentences)
   - **Key points**: 3 numbered points covering the core argument
   - **Relevance**: How this connects to our system or ongoing work (if applicable)

## Pitfalls

- **Same URL returns different content**: The same X URL may show different preview text depending on login state. If the preview is too short, try opening in an incognito browser profile first.
- **Author profile has no external link**: Many authors don't list a website. In that case, skip directly to Google search (Layer 2).
- **Google redirect loops**: Some X articles cannot be found via Google because they're cross-posted to other platforms under different titles. Try searching by exact quote from the preview.
- **Preview-only is acceptable**: Not all analysis needs full text. If the preview is sufficient to understand the argument, document it with a note that full text was unavailable.
- **Bookmark rate signals value**: A high bookmark-to-view ratio (e.g., 24/4,300 ≈ 0.56%) often indicates the content is worth deeper analysis. Flag these for potential M3 deep-dive.
- **Avoid duplicate Obsidian notes**: Check if an Obsidian note already exists for this URL before creating a new one. Use `exec` to grep Obsidian vault.
- **Discord summary must be immediate**: Don't wait for Obsidian note completion. Post Discord summary first, then save full note. Users check Discord more frequently.
