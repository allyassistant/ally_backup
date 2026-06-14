---
name: knowledge-curation-from-browser
description: Workflow for reading X/article links shared by the user, summarizing in Cantonese, and saving structured Obsidian knowledge notes with proper frontmatter, tags, cross-links, and a ##啟發 reflection section
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-07T14:01:00+08:00
---

# Knowledge Curation from Browser

## Workflow

1. **Identify the content source** — The user typically shares X.com links, URLs, or titles of interesting articles. Recognize these as knowledge curation opportunities, even if the user's primary question is something else (e.g., asking about a cron failure while also sharing links). Batch the browser reads if multiple links arrive in one message.

2. **Read the content via browser tool** — Use the `browser` tool to open the link. Navigate to the full content:
   - For X links: scroll past replies to get the full thread
   - For blog articles: identify the main body text
   - For social media posts: capture key points, bookmarks, and engagement metrics (views, bookmarks count)
   
   If multiple links are shared, read them in parallel in one exec call if possible.

3. **Summarize in Cantonese for the user** — After reading, immediately produce a Cantonese inline summary with:
   - Title and source attribution (e.g., `**@author — Title** (N views | M bookmarks)`)
   - Core argument/message in 2-4 bullet-style paragraphs
   - Key practical takeaways (specific techniques, prompts, frameworks mentioned)
   - If multiple links are read, connect them thematically (e.g., "同頭先篇文思路相通")

4. **Choose the correct Knowledge/ subdirectory** — Based on content category:
   - `Knowledge/Tech/` — technology, AI, coding, robotics, tools, engineering
   - `Knowledge/Business/` — entrepreneurship, side projects, marketing, monetization, SOPs
   - `Knowledge/Finance/` — investing, economics, personal finance
   - `Knowledge/Design/` — UI/UX, visual design, product design
   - Default: if unsure, create a generic `Knowledge/Other/` or ask the user
   
   Name the file using the pattern: `<author> - <Clean Title>.md` (e.g., `Tw93 - 你不知道的具身智能：从小机器狗到 Optimus.md`)

5. **Write the Obsidian note with full structure** — Every note must have:

   ```markdown
   ---
   category: <Tech|Business|Finance|Design|Other>
   tags: [<tag1>, <tag2>, <tag3>]
   source: <original URL>
   created: <YYYY-MM-DD>
   ---
   
   # <Title>
   
   [2-4 paragraphs of content summary]
   
   ## Key Takeaways
   
   - [Bullet 1]
   - [Bullet 2]
   - [Bullet 3]
   
   ## Cross-links
   
   - [[Relevant Obsidian Note 1]]
   - [[Relevant Obsidian Note 2]]
   - ...
   
   ## 啟發
   
   [1-2 paragraphs of personal reflection — how this connects to existing knowledge, what the user might act on, or what implications it has]
   ```

   Key rules:
   - **tags** should be lowercase-kebab-case (e.g., `ai-productivity`, `embodied-ai`)
   - **Cross-links** should reference existing Obsidian notes the user already has — use `^[[Note Name]]` syntax (double brackets)
   - **## 啟發** is REQUIRED — this is the reflection section that adds value beyond raw summarization
   - Content summary should be substantive (2-4 paragraphs), not just bullet points

6. **Verify the file** — After writing, verify the file was created by reading it back or using `exec ls -la` on the file. Check:
   - Frontmatter is valid YAML
   - Tags are properly formatted
   - Cross-links use double brackets
   - File size is reasonable (1KB+ for substantive content)
   - Output confirmation to the user: `📄 \`Knowledge/<Category>/<filename>.md\`` with tags listed

7. **Report back to the user** — Send a confirmation message with:
   - The file path in the Obsidian vault
   - Tags applied
   - A brief note on what was captured (e.g., "已寫入 frontmatter、tags、cross-links、##啟發")
   - If the user asked about something else first (e.g., a cron investigation), complete the primary task first, then handle curation as a secondary action

## Pitfalls

- **Don't re-read the same article twice** — If the user shares the same link in a follow-up message (e.g., "你睇咗未？"), check session history or memory before re-reading. Say "已睇過，上次已寫入 Obsidian" and reference the file path.
- **Don't let curation distract from the primary task** — If the user's main question is about a failure/issue, investigate that first. Save the article links for after the primary analysis is delivered. The user shared links while waiting for investigation results — don't reorder priorities.
- **Tags must be useful for recall** — Don't use generic tags like `article` or `reference`. Each tag should be a category the user would search for: `embodied-ai`, `ai-productivity`, `business`, `sop`, `ux-design`, `product-management`. 3-5 tags per note is the sweet spot.
- **Cross-links connect to existing notes** — Don't cross-link to notes that don't exist. Use canonical note names from the user's existing Obsidian vault (e.g., `AI Agents`, `System Design`, `Robot Control`). If uncertain, include fewer links rather than broken ones.
- **## 啟發 is NOT optional** — This is the most valuable section. If you skip it, the note is just a copy-paste summary. The 啟發 should connect the article to the user's existing interests, projects, or worldview. It's what makes the knowledge note worth re-reading weeks later.
- **Filename length** — Keep filenames under ~80 characters. For long Chinese titles, abbreviate the non-essential parts: `yoyo - 如何用AI把副业拆解成SOP.md` instead of including every character.
- **Browser tool on X URLs can time out** — X threads with many replies may take multiple scroll calls to reach the full main post. Use the `browser` tool with `action=scroll` and specific coordinates/selectors rather than scrolling indefinitely.
