---
name: webbridge-youtube-analysis
description: Analyze YouTube videos and web articles via browser/web_fetch, write structured Obsidian notes, and post Discord summaries with graceful degradation when tools are blocked.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T22:35:00.000Z
---

## Workflow

1. **Parse the request and route to the right tool.**
   - YouTube URL → use browser tool to extract transcript and page content.
   - Discord message with embedded links → extract the link, then route by URL type.
   - Any URL → check Kimi WebBridge status first: `~/.kimi-webbridge/bin/kimi-webbridge status`. If ✅ connected, proceed.

2. **Attempt primary analysis — Gemini via WebBridge.**
   - Use `gemini` tool or `webbridge` to send the content for structured analysis.
   - If the response contains a coherent structured summary → proceed to step 4.
   - If the tool yields an error or empty response → fall through to step 3 immediately. Do NOT loop retrying the same tool.

3. **Graceful degradation — browser + web_fetch fallback.**
   - If Gemini is blocked (e.g., HK region → "發生錯誤，請稍後再試" loop), pivot to browser tool for page extraction.
   - Supplement with `web_fetch` on authoritative sources (OpenAI官网, 官方文檔) to gather structured context.
   - Parse the combined output manually to extract key facts.
   - ⚠️ Always explain the pivot proactively: tell the user "Gemini 被 block，轉用 alternative 方法" — do not silently switch tools.

4. **Write results to Obsidian and Discord.**
   - Run the Obsidian write script with the analyzed content.
   - Post a concise Cantonese summary (2-4 key bullet points) to the requesting Discord channel.
   - Format: 🔥 for key facts, numbered bullets for structured highlights, bold for emphasis.

## Pitfalls

- ⚠️ Gemini HK regional block — attempting gemini.google.com in Hong Kong returns "發生錯誤，請稍後再試" and loops. Detection: check for this error on first attempt. Mitigation: immediately switch to browser + web_fetch, do not retry gemini more than once.
- ⚠️ Browser tool returns "No current window" — WebBridge Chrome extension context lost. Fix: reinitialize the browser session or use `exec` to run `kimi-webbridge` status check and restart if needed.
- ⚠️ web_fetch returns empty on video pages — YouTube video pages with no transcript block web_fetch. Fallback: extract title and description from the page metadata instead, supplemented by manual web search.
- ⚠️ Silent tool pivot — changing analysis strategy without informing the user erodes trust. Always state the fallback: "Gemini 被 block，改用 browser + web_fetch。"
- ⚠️ Gemini output too verbose for Discord — structured analysis can be 800+ tokens. Trim to 3-4 bullet points before posting; link to the Obsidian note for full details.
